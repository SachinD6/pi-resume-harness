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

export function isBroadRoot(cwd: string): boolean {
	const normalized = normalizeCwd(cwd);
	return normalized === homedir() || normalized === "/";
}

/** Walk parents until $HOME or `/`. Used to find a repo-root session from a subdir. */
export function ancestorProjectCwds(cwd: string): string[] {
	const home = homedir();
	const out: string[] = [];
	let parent = normalizeCwd(cwd);
	while (true) {
		const slash = parent.lastIndexOf("/");
		const next = slash <= 0 ? "/" : parent.slice(0, slash);
		if (next === parent || next === "/" || next === home) break;
		parent = next;
		out.push(parent);
	}
	return out;
}

/** Exact cwd, or a nested project path. Never treat $HOME/`/` as covering every child. */
export function projectCwdMatches(sessionCwd: string | null | undefined, queryCwd: string): boolean {
	if (!sessionCwd) return false;
	const session = normalizeCwd(sessionCwd);
	const query = normalizeCwd(queryCwd);
	if (session === query) return true;
	if (isBroadRoot(session) || isBroadRoot(query)) return false;
	return session.startsWith(`${query}${sep}`) || query.startsWith(`${session}${sep}`);
}

export type EncodedProjectMatch = { name: string; cwd: string };

/** Pick on-disk project folder names that belong to `cwd` under the shared rule. */
export function matchEncodedProjectNames(
	names: string[],
	cwd: string,
	encode: (cwd: string) => string,
): EncodedProjectMatch[] {
	const expected = encode(cwd);
	const query = normalizeCwd(cwd);
	const ancestorByName = new Map(ancestorProjectCwds(cwd).map((path) => [encode(path), path]));
	const matches: EncodedProjectMatch[] = [];
	for (const name of names) {
		if (name === expected || (!isBroadRoot(cwd) && name.startsWith(`${expected}-`))) {
			matches.push({ name, cwd: query });
			continue;
		}
		const ancestor = ancestorByName.get(name);
		if (ancestor) matches.push({ name, cwd: ancestor });
	}
	return matches;
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
