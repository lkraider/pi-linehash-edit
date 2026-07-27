import { constants } from "fs";
import { access as fsAccess } from "fs/promises";
import { errCode } from "./utils";

export async function validateAccess(
	absolutePath: string,
	path: string,
	accessMode: number = constants.R_OK,
): Promise<void> {
	try {
		await fsAccess(absolutePath, accessMode);
	} catch (error: unknown) {
		const code = errCode(error);
		if (code === "ENOENT") {
			throw new Error(`File not found: ${path}`);
		}
		if (code === "EACCES" || code === "EPERM") {
			const accessLabel = accessMode & constants.W_OK ? "not writable" : "not readable";
			throw new Error(`File is ${accessLabel}: ${path}`);
		}
		throw new Error(`Cannot access file: ${path}`);
	}
}



