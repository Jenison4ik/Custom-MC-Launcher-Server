import fs from "fs/promises";
import path from "path";
import pngToIco from "png-to-ico";
import type { LauncherSettings } from "./launcherSettings.js";

const ARTIFACT_NAME = "launcher-setup-${version}.${ext}";

interface LauncherPackage {
  version?: unknown;
  build?: {
    appId?: unknown;
    productName?: unknown;
    publish?: Array<{ url?: unknown; provider?: unknown } | null>;
    nsis?: Record<string, unknown>;
  };
}

export async function applySettings(
  repoDir: string,
  settings: LauncherSettings,
  iconFile: string | null
): Promise<{ version: string }> {
  const appDir = repoDir;
  await patchApiUrl(path.join(appDir, "packages", "main", "src", "config", "launcherProperties.ts"), settings.apiUrl);
  const version = await patchPackageJson(path.join(appDir, "package.json"), settings);
  await patchTitle(path.join(appDir, "packages", "renderer", "index.html"), settings.productName);
  await patchTheme(path.join(appDir, "packages", "renderer", "src", "styles", "theme.css"), settings.theme);
  if (iconFile) {
    await patchIcon(path.join(appDir, "packages", "renderer", "static"), iconFile);
  }
  return { version };
}

async function readSource(file: string, label: string): Promise<string> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    throw new Error(`В репозитории нет ${label}`);
  }
}

async function patchApiUrl(file: string, apiUrl: string): Promise<void> {
  const source = await readSource(file, "packages/main/src/config/launcherProperties.ts");
  const pattern = /(url\s*:\s*)(?:"[^"]*"|'[^']*'|`[^`]*`)/;
  if (!pattern.test(source)) {
    throw new Error("В launcherProperties.ts не найден адрес API (url)");
  }
  const next = source.replace(pattern, (_match, prefix: string) => `${prefix}${JSON.stringify(apiUrl)}`);
  await fs.writeFile(file, next, "utf8");
}

async function patchPackageJson(file: string, settings: LauncherSettings): Promise<string> {
  const source = await readSource(file, "package.json");
  let pkg: LauncherPackage;
  try {
    pkg = JSON.parse(source) as LauncherPackage;
  } catch {
    throw new Error("package.json лаунчера повреждён");
  }
  if (typeof pkg.version !== "string" || pkg.version.trim() === "") {
    throw new Error("В package.json лаунчера нет version");
  }
  const version = settings.version || pkg.version;
  pkg.version = version;
  if (!pkg.build || typeof pkg.build !== "object") {
    throw new Error("В package.json лаунчера нет секции build");
  }
  const publish = pkg.build.publish?.[0];
  if (!publish || typeof publish !== "object") {
    throw new Error("В package.json лаунчера нет build.publish");
  }
  pkg.build.productName = settings.productName;
  pkg.build.appId = settings.appId;
  publish.url = settings.apiUrl;
  pkg.build.nsis = { ...(pkg.build.nsis ?? {}), artifactName: ARTIFACT_NAME };
  await fs.writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return version;
}

async function patchTitle(file: string, productName: string): Promise<void> {
  const source = await readSource(file, "packages/renderer/index.html");
  if (!/<title>[^<]*<\/title>/.test(source)) {
    throw new Error("В index.html лаунчера не найден title");
  }
  const next = source.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(productName)}</title>`);
  await fs.writeFile(file, next, "utf8");
}

async function patchTheme(file: string, theme: Record<string, string>): Promise<void> {
  if (Object.keys(theme).length === 0) return;
  const source = await readSource(file, "packages/renderer/src/styles/theme.css");
  const start = source.indexOf(":root");
  if (start < 0) throw new Error("В theme.css не найден блок :root");
  const open = source.indexOf("{", start);
  if (open < 0) throw new Error("В theme.css не найден блок :root");
  let depth = 0;
  let close = -1;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0) throw new Error("В theme.css не закрыт блок :root");

  let block = source.slice(open + 1, close);
  for (const [token, value] of Object.entries(theme)) {
    const pattern = new RegExp(`(${escapeRegExp(token)}\\s*:\\s*)([^;]+)`);
    if (!pattern.test(block)) {
      throw new Error(`В theme.css нет токена ${token}`);
    }
    block = block.replace(pattern, (_match, prefix: string) => `${prefix}${value}`);
  }
  await fs.writeFile(file, source.slice(0, open + 1) + block + source.slice(close), "utf8");
}

async function patchIcon(staticDir: string, iconFile: string): Promise<void> {
  const png = await fs.readFile(iconFile);
  await fs.mkdir(staticDir, { recursive: true });
  await fs.writeFile(path.join(staticDir, "icon.png"), png);
  const ico = await pngToIco(png);
  await fs.writeFile(path.join(staticDir, "icon.ico"), ico);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
