import { readFile, writeFile, mkdir } from "node:fs/promises";
import { configDir, configPath } from "./paths";
import { errCode } from "./utils";

export interface Config { autoRead: boolean }
const DEFAULT_CONFIG: Config = { autoRead: true };
export async function readConfig(): Promise<Config> {
  try {
    const parsed = JSON.parse(await readFile(configPath(), "utf8")) as Partial<Config>;
    return { autoRead: typeof parsed.autoRead === "boolean" ? parsed.autoRead : DEFAULT_CONFIG.autoRead };
  } catch (error) {
    if (errCode(error) !== "ENOENT") console.error("Config file corrupted, using defaults:", error);
    return { ...DEFAULT_CONFIG };
  }
}
async function writeConfig(config: Config): Promise<void> { await mkdir(configDir(), { recursive: true }); await writeFile(configPath(), JSON.stringify(config, null, 2), "utf8"); }
export async function toggleAutoRead(): Promise<boolean> { const config = await readConfig(); config.autoRead = !config.autoRead; await writeConfig(config); return config.autoRead; }
