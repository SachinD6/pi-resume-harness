import { homedir } from "node:os";
import { posix, resolve, win32, type PlatformPath } from "node:path";

export function expandHome(value: string): string {
	if (value === "~") return homedir();
	if (value.startsWith("~/")) return `${homedir()}/${value.slice(2)}`;
	return value;
}

export function normalizeCwd(cwd: string): string {
	return resolve(expandHome(cwd));
}

function pathApi(cwd: string): PlatformPath {
	return looksWindowsPath(cwd) ? win32 : posix;
}

export function looksWindowsPath(cwd: string): boolean {
	return /^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith("\\\\");
}

export function filesystemRoot(cwd: string): string {
	const api = pathApi(cwd);
	return api.parse(api.normalize(cwd)).root;
}

export function isBroadRootFrom(cwd: string, home: string): boolean {
	const api = pathApi(cwd);
	const start = api.normalize(cwd);
	return start === api.normalize(home) || start === api.parse(start).root;
}

export function isBroadRoot(cwd: string): boolean {
	return isBroadRootFrom(normalizeCwd(cwd), homedir());
}

/** Walk parents until $HOME or the filesystem root. Empty for those roots. */
export function ancestorsOf(cwd: string, home: string): string[] {
	const api = pathApi(cwd);
	const start = api.normalize(cwd);
	const homeNorm = pathApi(home).normalize(home);
	const root = api.parse(start).root;
	if (!start || start === homeNorm || start === root) return [];
	const out: string[] = [];
	let current = start;
	while (true) {
		const next = api.dirname(current);
		if (next === current || next === root || next === homeNorm) break;
		current = next;
		out.push(current);
	}
	return out;
}

/** Walk parents until $HOME or `/`. Used to find a repo-root session from a subdir. */
export function ancestorProjectCwds(cwd: string): string[] {
	return ancestorsOf(normalizeCwd(cwd), homedir());
}

export function projectCwdMatchesFrom(
	sessionCwd: string,
	queryCwd: string,
	home: string,
): boolean {
	const api = pathApi(queryCwd);
	const session = api.normalize(sessionCwd);
	const query = api.normalize(queryCwd);
	if (session === query) return true;
	if (isBroadRootFrom(session, home) || isBroadRootFrom(query, home)) return false;
	const divider = api.sep;
	return session.startsWith(`${query}${divider}`) || query.startsWith(`${session}${divider}`);
}

/** Exact cwd, or a nested project path. Never treat $HOME/`/` as covering every child. */
export function projectCwdMatches(sessionCwd: string | null | undefined, queryCwd: string): boolean {
	if (!sessionCwd) return false;
	return projectCwdMatchesFrom(normalizeCwd(sessionCwd), normalizeCwd(queryCwd), homedir());
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
