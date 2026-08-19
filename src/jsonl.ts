import { readFileSync, statSync } from "node:fs";

export type JsonRecord = Record<string, unknown>;

export function mtimeMs(path: string): number {
	try {
		return Math.round(statSync(path).mtimeMs);
	} catch {
		return 0;
	}
}

export function parseJsonLine(line: string): { record?: JsonRecord; malformed: boolean } {
	const trimmed = line.trim();
	if (!trimmed) return { malformed: false };
	try {
		const value = JSON.parse(trimmed) as unknown;
		if (value && typeof value === "object" && !Array.isArray(value)) {
			return { record: value as JsonRecord, malformed: false };
		}
		return { malformed: true };
	} catch {
		return { malformed: true };
	}
}

export function readJsonl(path: string): { records: JsonRecord[]; malformed: number } {
	const text = readFileSync(path, "utf8");
	const records: JsonRecord[] = [];
	let malformed = 0;
	for (const line of text.split(/\r?\n/)) {
		const parsed = parseJsonLine(line);
		if (parsed.record) records.push(parsed.record);
		else if (parsed.malformed) malformed += 1;
	}
	return { records, malformed };
}

export function readJsonlHead(path: string, maxLines = 40): { records: JsonRecord[]; malformed: number } {
	const text = readFileSync(path, "utf8");
	const records: JsonRecord[] = [];
	let malformed = 0;
	let seen = 0;
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) continue;
		seen += 1;
		if (seen > maxLines) break;
		const parsed = parseJsonLine(line);
		if (parsed.record) records.push(parsed.record);
		else if (parsed.malformed) malformed += 1;
	}
	return { records, malformed };
}

export function isoToMs(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
	}
	if (typeof value !== "string" || !value.trim()) return null;
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? null : parsed;
}
