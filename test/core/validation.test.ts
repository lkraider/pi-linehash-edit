import { describe, expect, it, vi } from "vitest";
import { validateAccess, validateKind } from "../../src/validation";
import { errCode } from "../../src/utils";

describe("errCode", () => {
	it("returns code from NodeJS.ErrnoException", () => {
		const error = new Error("test") as NodeJS.ErrnoException;
		error.code = "ENOENT";
		expect(errCode(error)).toBe("ENOENT");
	});

	it("returns undefined for non-Error values", () => {
		expect(errCode("string")).toBeUndefined();
		expect(errCode(null)).toBeUndefined();
		expect(errCode(undefined)).toBeUndefined();
		expect(errCode(42)).toBeUndefined();
	});

	it("returns undefined for Error without code", () => {
		expect(errCode(new Error("test"))).toBeUndefined();
	});
});

describe("validateKind", () => {
	it("throws for directory", () => {
		expect(() => validateKind({ kind: "directory" }, "test.txt"))
			.toThrow("Path is a directory: test.txt. Use ls to inspect directories.");
	});

	it("throws for binary file", () => {
		expect(() => validateKind({ kind: "binary", description: "application/octet-stream" }, "test.bin"))
			.toThrow("Path is a binary file: test.bin (application/octet-stream). Hashline edit only supports text files.");
	});

	it("throws for image file", () => {
		expect(() => validateKind({ kind: "image", mimeType: "image/png" }, "test.png"))
			.toThrow("Path is an image file: test.png. Hashline edit only supports text files.");
	});

	it("does not throw for text file", () => {
		expect(() => validateKind({ kind: "text", text: "content" }, "test.txt")).not.toThrow();
	});
});

describe("validateAccess", () => {
	it("throws ENOENT error for missing file", async () => {
		await expect(validateAccess("/nonexistent/path.txt", "path.txt"))
			.rejects.toThrow("File not found: path.txt");
	});

	it("throws EACCES error for unreadable file", async () => {
		const { mkdir, writeFile, chmod } = await import("fs/promises");
		const { join } = await import("path");
		const tmpDir = join(process.cwd(), "test-tmp-validation");
		await mkdir(tmpDir, { recursive: true });
		const testFile = join(tmpDir, "unreadable.txt");
		await writeFile(testFile, "content");
		await chmod(testFile, 0o000);

		try {
			await expect(validateAccess(testFile, "unreadable.txt"))
				.rejects.toThrow("File is not readable: unreadable.txt");
		} finally {
			await chmod(testFile, 0o644);
			const { rm } = await import("fs/promises");
			await rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("throws writable error when W_OK requested", async () => {
		const { mkdir, writeFile, chmod } = await import("fs/promises");
		const { join } = await import("path");
		const { constants } = await import("fs");
		const tmpDir = join(process.cwd(), "test-tmp-validation-w");
		await mkdir(tmpDir, { recursive: true });
		const testFile = join(tmpDir, "readonly.txt");
		await writeFile(testFile, "content");
		await chmod(testFile, 0o444);

		try {
			await expect(validateAccess(testFile, "readonly.txt", constants.R_OK | constants.W_OK))
				.rejects.toThrow("File is not writable: readonly.txt");
		} finally {
			await chmod(testFile, 0o644);
			const { rm } = await import("fs/promises");
			await rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("does not throw for accessible file", async () => {
		const { mkdir, writeFile } = await import("fs/promises");
		const { join } = await import("path");
		const tmpDir = join(process.cwd(), "test-tmp-validation-ok");
		await mkdir(tmpDir, { recursive: true });
		const testFile = join(tmpDir, "readable.txt");
		await writeFile(testFile, "content");

		try {
			await expect(validateAccess(testFile, "readable.txt")).resolves.toBeUndefined();
		} finally {
			const { rm } = await import("fs/promises");
			await rm(tmpDir, { recursive: true, force: true });
		}
	});
});
