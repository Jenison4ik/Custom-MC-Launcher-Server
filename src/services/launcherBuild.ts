import { createHash } from "crypto";
import { spawn } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import type { AppConfig } from "../config.js";
import { applySettings } from "./launcherPatch.js";
import {
  defaultLauncherSettings,
  iconPath,
  LauncherSettingsError,
  readLauncherSettings,
} from "./launcherSettings.js";
import { withFsLock } from "./lock.js";

const REF_PATTERN = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export type BuildPhase = "idle" | "running" | "success" | "failed";

export interface BuildState {
  status: BuildPhase;
  startedAt: string | null;
  finishedAt: string | null;
  commit: string | null;
  version: string | null;
  error: string | null;
}

export interface BuildStatus extends BuildState {
  log: string;
}

export class BuildInProgressError extends Error {
  status = 409;

  constructor(message = "Сборка уже выполняется") {
    super(message);
    this.name = "BuildInProgressError";
  }
}

const idleState = (): BuildState => ({
  status: "idle",
  startedAt: null,
  finishedAt: null,
  commit: null,
  version: null,
  error: null,
});

let state: BuildState = idleState();

export function startLauncherBuild(config: AppConfig): void {
  if (state.status === "running") throw new BuildInProgressError();
  state = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    commit: null,
    version: null,
    error: null,
  };
  void execute(config);
}

export async function getBuildStatus(config: AppConfig): Promise<BuildStatus> {
  return { ...state, log: await readLogTail(path.join(config.buildDir, "build.log")) };
}

async function execute(config: AppConfig): Promise<void> {
  let log: fs.WriteStream | null = null;
  try {
    await fsp.mkdir(config.buildDir, { recursive: true });
    log = fs.createWriteStream(path.join(config.buildDir, "build.log"), { flags: "w" });
    log.on("error", () => undefined);
    const env = buildEnv(config);
    assertRepo(config);
    const repoDir = path.join(config.buildDir, "repo");
    await syncRepo(config, repoDir, log, env);
    const commit = await capture("git", gitArgs("rev-parse", "HEAD"), repoDir, log, env);
    state = { ...state, commit };
    const settings = await readLauncherSettings(
      config.dataDir,
      defaultLauncherSettings(config.publicApiUrl)
    );
    if (!settings.apiUrl) throw new LauncherSettingsError(400, "Укажите адрес API");
    const icon = iconPath(config.dataDir);
    const hasIcon = await fsp
      .stat(icon)
      .then((stat) => stat.isFile())
      .catch(() => false);
    const appDir = repoDir;
    const applied = await applySettings(repoDir, settings, hasIcon ? icon : null);
    state = { ...state, version: applied.version };
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    await run(npm, ["ci", "--include=dev"], appDir, log, env);
    await run(npm, ["run", "build"], appDir, log, env);
    const builderArgs = ["electron-builder", "--win", "nsis", "--publish", "never"];
    // Wine 11 в образе сборки не запускает rcedit и падает при записи иконки в exe.
    // NSIS при этом собирается своим makensis, без Wine.
    if (process.platform !== "win32") builderArgs.push("-c.win.signAndEditExecutable=false");
    await run(npx, builderArgs, appDir, log, env);
    await publishInstaller(config, appDir, applied.version);
    state = { ...state, status: "success", finishedAt: new Date().toISOString(), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Сборка не удалась";
    log?.write(`\n${message}\n`);
    state = { ...state, status: "failed", finishedAt: new Date().toISOString(), error: message };
  } finally {
    if (log) {
      const stream = log;
      await new Promise<void>((resolve) => {
        stream.end(() => resolve());
      });
    }
  }
}

function assertRepo(config: AppConfig): void {
  let url: URL;
  try {
    url = new URL(config.launcherRepoUrl);
  } catch {
    throw new Error("LAUNCHER_REPO_URL должен быть http(s) адресом");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("LAUNCHER_REPO_URL должен быть http(s) адресом");
  }
  if (!REF_PATTERN.test(config.launcherRepoRef)) {
    throw new Error("LAUNCHER_REPO_REF должен быть веткой или тегом");
  }
}

async function syncRepo(
  config: AppConfig,
  repoDir: string,
  log: fs.WriteStream,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const gitMeta = path.join(repoDir, ".git");
  const hasGit = await fsp
    .stat(gitMeta)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
  if (!hasGit) {
    await fsp.rm(repoDir, { recursive: true, force: true });
    await run(
      "git",
      [
        ...gitArgs(
          "clone",
          "--depth",
          "1",
          "--branch",
          config.launcherRepoRef,
          config.launcherRepoUrl,
          repoDir
        ),
      ],
      config.buildDir,
      log,
      env
    );
  }
  await run("git", gitArgs("remote", "set-url", "origin", config.launcherRepoUrl), repoDir, log, env);
  await run("git", gitArgs("fetch", "--depth", "1", "origin", config.launcherRepoRef), repoDir, log, env);
  await run("git", gitArgs("checkout", "--force", "FETCH_HEAD"), repoDir, log, env);
  await run("git", gitArgs("reset", "--hard", "FETCH_HEAD"), repoDir, log, env);
  await run("git", gitArgs("clean", "-fdx"), repoDir, log, env);
}

function gitArgs(...args: string[]): string[] {
  return ["-c", "safe.directory=*", ...args];
}

async function publishInstaller(config: AppConfig, appDir: string, version: string): Promise<void> {
  const fileName = `launcher-setup-${version}.exe`;
  const exePath = path.join(appDir, "out", fileName);
  const bytes = await fsp.readFile(exePath).catch(() => {
    throw new Error(`Установщик ${fileName} не найден в out`);
  });
  const sha512 = createHash("sha512").update(bytes).digest("base64");
  const yml = [
    `version: ${JSON.stringify(version)}`,
    "files:",
    `  - url: ${fileName}`,
    `    sha512: ${JSON.stringify(sha512)}`,
    `    size: ${bytes.length}`,
    `path: ${fileName}`,
    `sha512: ${JSON.stringify(sha512)}`,
    `releaseDate: ${JSON.stringify(new Date().toISOString())}`,
    "",
  ].join("\n");

  await withFsLock(async () => {
    await fsp.mkdir(config.launcherDir, { recursive: true });
    const entries = await fsp.readdir(config.launcherDir);
    await Promise.all(
      entries.map((entry) => fsp.rm(path.join(config.launcherDir, entry), { recursive: true, force: true }))
    );
    await fsp.copyFile(exePath, path.join(config.launcherDir, fileName));
    await fsp.mkdir(config.dataDir, { recursive: true });
    await fsp.writeFile(path.join(config.dataDir, "latest.yml"), yml, "utf8");
    await fsp.writeFile(path.join(config.dataDir, "version.json"), JSON.stringify({ version }));
  });
}

function buildEnv(config: AppConfig): NodeJS.ProcessEnv {
  const cache = path.join(config.buildDir, "cache");
  return {
    ...process.env,
    ELECTRON_CACHE: path.join(cache, "electron"),
    ELECTRON_BUILDER_CACHE: path.join(cache, "electron-builder"),
    npm_config_cache: path.join(cache, "npm"),
    CI: "true",
  };
}

function run(
  command: string,
  args: string[],
  cwd: string,
  log: fs.WriteStream,
  env: NodeJS.ProcessEnv
): Promise<void> {
  return spawnCommand(command, args, cwd, log, env).then(() => undefined);
}

function capture(
  command: string,
  args: string[],
  cwd: string,
  log: fs.WriteStream,
  env: NodeJS.ProcessEnv
): Promise<string> {
  return spawnCommand(command, args, cwd, log, env);
}

function spawnCommand(
  command: string,
  args: string[],
  cwd: string,
  log: fs.WriteStream,
  env: NodeJS.ProcessEnv
): Promise<string> {
  return new Promise((resolve, reject) => {
    log.write(`\n$ ${command} ${args.join(" ")}\n`);
    const child = spawn(command, args, { cwd, env, shell: false });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      log.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      log.write(chunk);
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${command} завершился с кодом ${code}`));
    });
  });
}

async function readLogTail(file: string): Promise<string> {
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat?.isFile()) return "";
  const max = 64 * 1024;
  const handle = await fsp.open(file, "r");
  try {
    const start = Math.max(0, stat.size - max);
    const length = Number(stat.size - start);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer.toString("utf8").split(/\r?\n/).slice(-200).join("\n");
  } finally {
    await handle.close();
  }
}
