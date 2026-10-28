import fs from "fs/promises";
import os from "os";
import path from "path";
import { deflateSync } from "zlib";
import { afterEach, describe, expect, it } from "vitest";
import { applySettings } from "../src/services/launcherPatch.js";
import type { LauncherSettings } from "../src/services/launcherSettings.js";

const settings: LauncherSettings = {
  apiUrl: 'https://example.test/a"b',
  productName: 'Tom & Jerry <3>',
  appId: "com.example.launcher",
  version: "2.0.0",
  theme: { "--color-bg": "#abcdef" },
};

describe("applySettings", () => {
  let root: string;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("patches launcher sources and escapes inserted values", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "launcher-patch-"));
    await writeFixture(root);

    const applied = await applySettings(root, settings, null);
    expect(applied.version).toBe("2.0.0");

    const properties = await fs.readFile(propertiesPath(root), "utf8");
    expect(properties).toContain('url: "https://example.test/a\\"b"');

    const pkg = JSON.parse(await fs.readFile(packagePath(root), "utf8")) as {
      version: string;
      build: {
        productName: string;
        appId: string;
        publish: Array<{ url: string }>;
        nsis: { artifactName: string };
      };
    };
    expect(pkg.version).toBe("2.0.0");
    expect(pkg.build.productName).toBe(settings.productName);
    expect(pkg.build.appId).toBe("com.example.launcher");
    expect(pkg.build.publish[0]?.url).toBe(settings.apiUrl);
    expect(pkg.build.nsis.artifactName).toBe("launcher-setup-${version}.${ext}");

    const html = await fs.readFile(htmlPath(root), "utf8");
    expect(html).toContain("<title>Tom &amp; Jerry &lt;3&gt;</title>");

    const theme = await fs.readFile(themePath(root), "utf8");
    expect(theme).toContain("--color-bg: #abcdef; /* фон */");
    expect(theme).toContain(".other {\n  --color-bg: #000000;");
  });

  it("keeps the repository version when settings version is empty", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "launcher-patch-"));
    await writeFixture(root);
    const applied = await applySettings(root, { ...settings, version: "", theme: {} }, null);
    expect(applied.version).toBe("1.7.0");
  });

  it("fails when the api url assignment is missing", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "launcher-patch-"));
    await writeFixture(root);
    await fs.writeFile(propertiesPath(root), "export default { name: \"x\" };\n", "utf8");
    await expect(applySettings(root, settings, null)).rejects.toThrow(/url/);
  });

  it("fails when a theme token is not in :root", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "launcher-patch-"));
    await writeFixture(root);
    await expect(
      applySettings(root, { ...settings, theme: { "--color-missing": "#ffffff" } }, null)
    ).rejects.toThrow(/--color-missing/);
  });

  it("writes png and ico icons", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "launcher-patch-"));
    await writeFixture(root);
    const icon = path.join(root, "source-icon.png");
    await fs.writeFile(icon, makePng(32));
    await applySettings(root, { ...settings, theme: {} }, icon);
    const written = await fs.readFile(path.join(root, "packages/renderer/static/icon.png"));
    expect(written.equals(await fs.readFile(icon))).toBe(true);
    const ico = await fs.readFile(path.join(root, "packages/renderer/static/icon.ico"));
    expect(ico.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))).toBe(true);
  });
});

function propertiesPath(root: string): string {
  return path.join(root, "packages/main/src/config/launcherProperties.ts");
}

function packagePath(root: string): string {
  return path.join(root, "package.json");
}

function htmlPath(root: string): string {
  return path.join(root, "packages/renderer/index.html");
}

function themePath(root: string): string {
  return path.join(root, "packages/renderer/src/styles/theme.css");
}

async function writeFixture(root: string): Promise<void> {
  await fs.mkdir(path.dirname(propertiesPath(root)), { recursive: true });
  await fs.mkdir(path.dirname(themePath(root)), { recursive: true });
  await fs.mkdir(path.join(root, "packages/renderer/static"), { recursive: true });
  await fs.writeFile(
    propertiesPath(root),
    'const launcherProperties = {\n  url: "http://localhost:3000/minecraft/api",\n};\n\nexport default launcherProperties;\n',
    "utf8"
  );
  await fs.writeFile(
    packagePath(root),
    JSON.stringify(
      {
        name: "custom-minecraft-launcher",
        version: "1.7.0",
        build: {
          appId: "ru.jenison.cml",
          productName: "Custom Minecraft Launcher",
          publish: [{ provider: "generic", url: "https://cml.jenison.ru/" }],
        },
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.writeFile(htmlPath(root), "<html><head><title>Jenison Launcher</title></head></html>\n", "utf8");
  await fs.writeFile(
    themePath(root),
    ":root {\n  --color-bg: #111111; /* фон */\n  --color-text: #eeeeee;\n}\n\n.other {\n  --color-bg: #000000;\n}\n",
    "utf8"
  );
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function makePng(size: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 4, 0x80)]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
