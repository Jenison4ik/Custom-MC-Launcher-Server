import fs from "fs/promises";
import path from "path";

export interface LauncherSettings {
  apiUrl: string;
  productName: string;
  appId: string;
  version: string;
  theme: Record<string, string>;
}

export interface LauncherSettingsView extends LauncherSettings {
  hasIcon: boolean;
  iconDataUrl: string | null;
}

export class LauncherSettingsError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LauncherSettingsError";
    this.status = status;
  }
}

const APP_ID = /^[a-zA-Z][a-zA-Z0-9-]*(\.[a-zA-Z][a-zA-Z0-9-]*)+$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const THEME_TOKEN = /^--color-[a-z0-9-]+$/;
const COLOR_VALUE =
  /^(?:#[0-9a-fA-F]{3,8}|rgba?\([0-9a-zA-Z.%\s,/+-]+\)|hsla?\([0-9a-zA-Z.%\s,/+-]+\)|color-mix\(in [a-z0-9-]+,\s*[^;{}]+\))$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_ICON_BYTES = 2 * 1024 * 1024;

export function defaultLauncherSettings(publicApiUrl: string): LauncherSettings {
  return {
    apiUrl: publicApiUrl,
    productName: "Custom Minecraft Launcher",
    appId: "ru.jenison.cml",
    version: "",
    theme: {},
  };
}

export function settingsPath(dataDir: string): string {
  return path.join(dataDir, "launcher-settings.json");
}

export function iconPath(dataDir: string): string {
  return path.join(dataDir, "launcher-icon.png");
}

export function parseLauncherSettings(value: unknown): LauncherSettings {
  if (typeof value !== "object" || value === null) {
    throw new LauncherSettingsError(400, "Настройки лаунчера заданы неверно");
  }
  const body = value as Record<string, unknown>;
  return {
    apiUrl: parseApiUrl(body.apiUrl),
    productName: parseProductName(body.productName),
    appId: parseAppId(body.appId),
    version: parseVersion(body.version),
    theme: parseTheme(body.theme),
  };
}

export async function readLauncherSettings(
  dataDir: string,
  defaults: LauncherSettings
): Promise<LauncherSettings> {
  const raw = await fs.readFile(settingsPath(dataDir), "utf8").catch(() => null);
  if (raw === null) return { ...defaults, theme: { ...defaults.theme } };
  try {
    return parseLauncherSettings(JSON.parse(raw) as unknown);
  } catch (error) {
    if (error instanceof LauncherSettingsError) throw error;
    throw new LauncherSettingsError(500, "Файл настроек лаунчера повреждён");
  }
}

export async function saveLauncherSettings(dataDir: string, value: unknown): Promise<LauncherSettings> {
  const settings = parseLauncherSettings(value);
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(settingsPath(dataDir), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settings;
}

export async function readLauncherSettingsView(
  dataDir: string,
  defaults: LauncherSettings
): Promise<LauncherSettingsView> {
  const settings = await readLauncherSettings(dataDir, defaults);
  const icon = await fs.readFile(iconPath(dataDir)).catch(() => null);
  return {
    ...settings,
    hasIcon: icon !== null,
    iconDataUrl: icon ? `data:image/png;base64,${icon.toString("base64")}` : null,
  };
}

export async function saveLauncherIcon(dataDir: string, sourcePath: string): Promise<void> {
  const bytes = await fs.readFile(sourcePath);
  assertPngIcon(bytes);
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(iconPath(dataDir), bytes);
}

export function assertPngIcon(bytes: Buffer): { width: number; height: number } {
  if (bytes.length > MAX_ICON_BYTES) {
    throw new LauncherSettingsError(400, "Иконка слишком большая");
  }
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new LauncherSettingsError(400, "Нужен файл PNG");
  }
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new LauncherSettingsError(400, "Нужен файл PNG");
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 256 || height < 256) {
    throw new LauncherSettingsError(400, "Иконка должна быть не меньше 256×256");
  }
  return { width, height };
}

function parseApiUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new LauncherSettingsError(400, "Укажите адрес API");
  }
  const trimmed = value.trim();
  if (trimmed.length > 500) {
    throw new LauncherSettingsError(400, "Адрес API слишком длинный");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new LauncherSettingsError(400, "Адрес API должен быть http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LauncherSettingsError(400, "Адрес API должен быть http(s) URL");
  }
  return trimmed.replace(/\/$/, "");
}

function parseProductName(value: unknown): string {
  if (typeof value !== "string") {
    throw new LauncherSettingsError(400, "Укажите название лаунчера");
  }
  const name = value.trim();
  if (name.length < 1 || name.length > 60 || /[\u0000-\u001F\u007F]/.test(name)) {
    throw new LauncherSettingsError(400, "Название лаунчера задано неверно");
  }
  return name;
}

function parseAppId(value: unknown): string {
  if (typeof value !== "string" || !APP_ID.test(value) || value.length > 100) {
    throw new LauncherSettingsError(400, "appId должен быть в формате reverse-domain, например ru.example.launcher");
  }
  return value;
}

function parseVersion(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || !SEMVER.test(value)) {
    throw new LauncherSettingsError(400, "Версия должна быть в формате X.Y.Z");
  }
  return value;
}

function parseTheme(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new LauncherSettingsError(400, "Цвета темы заданы неверно");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 32) {
    throw new LauncherSettingsError(400, "Слишком много цветов темы");
  }
  const theme: Record<string, string> = {};
  for (const [token, color] of entries) {
    if (!THEME_TOKEN.test(token)) {
      throw new LauncherSettingsError(400, `Неизвестный токен темы ${token}`);
    }
    if (typeof color !== "string" || !COLOR_VALUE.test(color.trim())) {
      throw new LauncherSettingsError(400, `Недопустимое значение цвета ${token}`);
    }
    theme[token] = color.trim();
  }
  return theme;
}
