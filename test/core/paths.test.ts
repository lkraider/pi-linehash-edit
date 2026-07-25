import { describe, expect, it } from "vitest";
import { homedir } from "os";
import { join } from "path";
import { configDir, configPath } from "../../src/paths";

describe("configDir", () => {
  it("returns the config directory under home", () => {
    const dir = configDir();
    expect(dir).toBe(join(homedir(), ".config", "pi-linehash-edit"));
  });
});

describe("configPath", () => {
  it("returns the config file path", () => {
    const path = configPath();
    expect(path).toBe(join(configDir(), "config.json"));
  });
});
