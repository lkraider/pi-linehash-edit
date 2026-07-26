import { describe, expect, it } from "vitest";
import { formatRegion } from "../../src/hashline";
import { fmtReadPreview } from "../../src/read";
import { useTestHome } from "../support/fixtures";

const home = useTestHome();

describe("fmtReadPreview", () => {
  it("returns all lines when no offset or limit given", async () => {
    const text = "alpha\nbeta\ngamma\n";
    const result = await fmtReadPreview(text, {}, undefined, home.testPath);
    expect(result.text).toContain("│alpha");
    expect(result.text).toContain("│beta");
    expect(result.text).toContain("│gamma");
  });

  it("hides the terminal newline sentinel from preview output", async () => {
    const text = "alpha\nbeta\n";
    const result = await fmtReadPreview(text, {}, undefined, home.testPath);
    expect(result.text).toContain("│alpha");
    expect(result.text).toContain("│beta");
    const lines = result.text.split("\n");
    const emptyContentLines = lines.filter((l) => /^\d+│$/.test(l));
    expect(emptyContentLines).toHaveLength(0);
  });

  it("keeps continuation hints for partial previews", async () => {
    const text = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n";
    const result = await fmtReadPreview(text, { limit: 3 }, undefined, home.testPath);
    expect(result.text).toContain("[Showing lines 1-3 of 10. Use offset=4 to continue.]");
  });

  it("reports when offset is beyond end of content", async () => {
    const text = "a\nb\n";
    const result = await fmtReadPreview(text, { offset: 5 }, undefined, home.testPath);
    expect(result.text).toContain("Offset 5 is beyond end of file");
  });

  it("rejects fractional offsets", async () => {
    await expect(fmtReadPreview("a\nb\n", { offset: 1.5 } as any, undefined, home.testPath)).rejects.toThrow("positive integer");
  });

  it("rejects non-positive limits", async () => {
    await expect(fmtReadPreview("a\nb\n", { limit: 0 } as any, undefined, home.testPath)).rejects.toThrow("positive integer");
  });

describe("formatRegion", () => {
  it("formats lines as LINE:HASH|content rows, defaulting to line 1", () => {
    const result = formatRegion(["AB", "DE"], ["hello", "world"]);
    expect(result).toBe("1AB│hello\n2DE│world");
  });

  it("offsets line numbers by the given startLine", () => {
    const result = formatRegion(["XY"], ["test"], 42);
    expect(result).toBe("42XY│test");
  });
});
});
