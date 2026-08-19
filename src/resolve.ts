import type { Harness, ReaderOptions, SessionShow, SessionSummary, ShowResult } from "./types.ts";
import { isLatestRef, isUuid, looksLikePath } from "./cwd.ts";
import { readers } from "./readers/index.ts";

export async function listHarnesses(
	harnesses: Harness[],
	options: ReaderOptions,
): Promise<SessionSummary[]> {
	const groups = await Promise.all(harnesses.map((harness) => readers[harness].list(options)));
	return groups.flat().sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
}

function matchesQuery(session: SessionSummary, query: string): boolean {
	const needle = query.toLowerCase();
	return (
		session.sessionId.toLowerCase().includes(needle) ||
		session.harness.toLowerCase().includes(needle) ||
		(session.title ?? "").toLowerCase().includes(needle)
	);
}

export async function showFromSummary(
	session: SessionSummary,
	options: ReaderOptions,
): Promise<ShowResult> {
	return readers[session.harness].show(session.path, options);
}

export async function resolveRef(
	harnesses: Harness[],
	ref: string,
	options: ReaderOptions,
): Promise<ShowResult> {
	const trimmed = ref.trim();
	if (looksLikePath(trimmed) && harnesses.length === 1) {
		return readers[harnesses[0]].show(trimmed, options);
	}
	if (looksLikePath(trimmed)) {
		for (const harness of harnesses) {
			const shown = await readers[harness].show(trimmed, options);
			if (shown.ok) return shown;
		}
		return { ok: false, message: `Could not read foreign session at ${trimmed}` };
	}

	const sessions = await listHarnesses(harnesses, options);
	if (sessions.length === 0) {
		const names = harnesses.map((harness) => readers[harness].label).join(", ");
		return { ok: false, message: `No ${names} sessions found for ${options.cwd}` };
	}

	if (!trimmed || isLatestRef(trimmed)) {
		return showFromSummary(sessions[0], options);
	}

	if (isUuid(trimmed)) {
		const matches = sessions.filter((session) => session.sessionId.toLowerCase() === trimmed.toLowerCase());
		if (matches.length === 1) return showFromSummary(matches[0], options);
		if (matches.length === 0) return { ok: false, message: `No session matched id ${trimmed}` };
		return { ok: false, message: `Multiple sessions matched id ${trimmed}`, matches };
	}

	const matches = sessions.filter((session) => matchesQuery(session, trimmed));
	if (matches.length === 1) return showFromSummary(matches[0], options);
	if (matches.length === 0) return { ok: false, message: `No session matched "${trimmed}"`, matches: [] };
	return { ok: false, message: `Multiple sessions matched "${trimmed}"`, matches };
}

export function filterSessions(sessions: SessionSummary[], query: string): SessionSummary[] {
	const trimmed = query.trim();
	if (!trimmed) return sessions;
	return sessions.filter((session) => matchesQuery(session, trimmed));
}

export function shouldOpenPicker(ref: string, hasTui: boolean): boolean {
	const trimmed = ref.trim();
	if (isLatestRef(trimmed) || isUuid(trimmed) || looksLikePath(trimmed)) return false;
	return !trimmed || hasTui;
}
