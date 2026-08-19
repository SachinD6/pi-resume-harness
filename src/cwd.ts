import { homedir } from "node:os";
import { resolve, sep } from "node:path";

export function expandHome(value: string): string {
	if (value === "~") return homedir();
	if (value.startsWith("~/")) return `${homedir()}/${value.slice(2)}`;
	return value;
}

export function normalizeCwd(cwd: string): string {
	return resolve(expandHome(cwd));
}

export function cwdWithin(candidate: string | null | undefined, target: string): boolean {
	if (!candidate) return false;
	const a = normalizeCwd(candidate);
	const b = normalizeCwd(target);
	return a === b || a.startsWith(`${b}${sep}`) || b.startsWith(`${a}${sep}`);
}

export function slugifyClaude(cwd: string): string {
	return normalizeCwd(cwd)
		.split("")
		.map((char) => (/[A-Za-z0-9]/.test(char) ? char : "-"))
		.join("");
}

export function encodeCursorProject(cwd: string): string {
	return normalizeCwd(cwd)
		.replace(/\\/g, "/")
		.replace(/^\/+/, "")
		.replace(/\//g, "-");
}

export function isUuid(value: string): boolean {
	return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
		value.trim(),
	);
}

export function isLatestRef(value: string): boolean {
	return /^(--continue|continue|-c|latest)$/i.test(value.trim());
}

export function looksLikePath(value: string): boolean {
	const trimmed = value.trim();
	return trimmed.startsWith("/") || trimmed.startsWith("~") || trimmed.includes("/") || trimmed.includes("\\");
}
