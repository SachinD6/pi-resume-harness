import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

export function writeJsonl(path: string, records: unknown[]): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

export function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value, null, 2));
}
