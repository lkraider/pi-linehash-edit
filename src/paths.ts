import { homedir } from "os";
import { isAbsolute, resolve as resolvePath, join } from "path";


function homeBase(): string {
  const envHome = process.env.HOME;
  return envHome && envHome.length > 0 ? envHome : homedir();
}

export function configDir(): string {
  return join(homeBase(), ".config", "pi-linehash-edit");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

function expand(filePath: string): string {
  if (filePath.startsWith("@")) filePath = filePath.slice(1);
  const home = homeBase();
  if (filePath === "~") return home;
  if (filePath.startsWith("~/")) return home + filePath.slice(1);
  return filePath;
}

export function toCwd(filePath: string, cwd: string): string {
  const expanded = expand(filePath);
  return isAbsolute(expanded) ? expanded : resolvePath(cwd, expanded);
}
