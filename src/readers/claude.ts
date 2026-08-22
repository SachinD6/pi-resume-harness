import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	isLatestRef,
	isUuid,
	looksLikePath,
	matchEncodedProjectNames,
	projectCwdMatches,
	slugifyClaude,
} from "../cwd.ts";
import { isoToMs, mtimeMs, readJsonl, type JsonRecord } from "../jsonl.ts";
import { asShow, boundTurns, titleFromTurns } from "../signals.ts";
import { blocks, clip, jsonPreview, oneLine, visibleUserText } from "../text.ts";
import {
	DEFAULT_MAX_TEXT_CHARS,
	DEFAULT_MAX_TOOL_CHARS,
	DEFAULT_MAX_TURNS,
	type ReaderOptions,
	type SessionReader,
	type SessionShow,
	type SessionSummary,
	type ShowResult,
	type Turn,
	type Warning,
	UUID_RE,
} from "../types.ts";

const META_FLAGS = ["isMeta", "isCompactSummary", "isVirtual", "isVisibleInTranscriptOnly"] as const;

function claudeHome(home?: string): string {
	if (home) return home;
	if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR;
	return join(homedir(), ".claude");
}

function projectDirs(projectsRoot: string, cwd: string): string[] {
	if (!existsSync(projectsRoot)) return [];
	try {
		const names = readdirSync(projectsRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
		return matchEncodedProjectNames(names, cwd, slugifyClaude).map((match) => join(projectsRoot, match.name));
	} catch {
		return [];
	}
}

function sessionFiles(dir: string): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl") && UUID_RE.test(entry.name.slice(0, -6)))
			.map((entry) => join(dir, entry.name));
	} catch {
		return [];
	}
}

function skipRecord(record: JsonRecord): boolean {
	if (record.isSidechain) return true;
	return META_FLAGS.some((flag) => record[flag]);
}

function userDisplayText(content: unknown, maxText: number): string | null {
	const texts: string[] = [];
	for (const block of blocks(content)) {
		const type = block.type;
		if (type === "text" || type === "input_text" || type === "output_text") {
			if (typeof block.text === "string" && block.text.trim()) texts.push(block.text);
		}
	}
	const raw = texts.join("\n").trim();
	if (!raw) return null;
	const visible = visibleUserText(raw);
	return visible ? oneLine(visible, maxText) : null;
}

function renderTurn(record: JsonRecord, maxText: number, maxTool: number): Turn | null {
	if (record.type !== "user" && record.type !== "assistant") return null;
	if (skipRecord(record)) return null;
	const message = record.message;
	if (!message || typeof message !== "object") return null;
	const role =
		(message as JsonRecord).role === "user" || (message as JsonRecord).role === "assistant"
			? ((message as JsonRecord).role as "user" | "assistant")
			: record.type;
	const turn: Turn = { role, text: "" };
	const texts: string[] = [];
	const toolCalls: NonNullable<Turn["toolCalls"]> = [];
	const toolResults: NonNullable<Turn["toolResults"]> = [];
	for (const block of blocks((message as JsonRecord).content)) {
		const type = block.type;
		if (type === "thinking" || type === "redacted_thinking" || type === "signature") continue;
		if (type === "text" || type === "input_text" || type === "output_text") {
			if (typeof block.text !== "string" || !block.text.trim()) continue;
			const rendered = role === "user" ? visibleUserText(block.text) : block.text;
			if (rendered) texts.push(clip(rendered, maxText));
		} else if (type === "tool_use") {
			toolCalls.push({
				id: typeof block.id === "string" ? block.id : undefined,
				name: String(block.name || "unknown"),
				input: jsonPreview(block.input ?? {}, maxTool),
				inert: true,
			});
		} else if (type === "tool_result") {
			toolResults.push({
				toolUseId: typeof block.tool_use_id === "string" ? block.tool_use_id : undefined,
				content: oneLine(typeof block.content === "string" ? block.content : jsonPreview(block.content, maxTool), maxTool),
				isError: Boolean(block.is_error),
				inert: true,
			});
		} else if (type === "image") {
			texts.push("[image content unavailable]");
		}
	}
	turn.text = texts.filter(Boolean).join("\n");
	if (toolCalls.length) turn.toolCalls = toolCalls;
	if (toolResults.length) turn.toolResults = toolResults;
	if (!turn.text && !turn.toolCalls && !turn.toolResults) return null;
	return turn;
}

function claudeTitle(records: JsonRecord[], turns: Turn[]): string | null {
	const fields: Array<[string, string]> = [
		["custom-title", "customTitle"],
		["ai-title", "aiTitle"],
		["last-prompt", "lastPrompt"],
		["summary", "summary"],
	];
	const newest = new Map<string, string>();
	for (const record of [...records].reverse()) {
		const type = String(record.type ?? "");
		const field = fields.find(([name]) => name === type)?.[1];
		if (!field || newest.has(type)) continue;
		const value = record[field];
		if (typeof value === "string" && value.trim()) newest.set(type, value);
		if (newest.size === fields.length) break;
	}
	for (const [type] of fields) {
		const value = newest.get(type);
		if (!value) continue;
		const visible = visibleUserText(value) ?? value;
		if (visible.trim()) return oneLine(visible, 200);
	}
	for (const record of [...records].reverse()) {
		if (record.type !== "user" || skipRecord(record)) continue;
		const message = record.message;
		if (!message || typeof message !== "object") continue;
		const text = userDisplayText((message as JsonRecord).content, 200);
		if (text) return text;
	}
	return titleFromTurns(turns);
}

function sessionCwd(records: JsonRecord[]): string | null {
	for (const record of records) {
		if (typeof record.cwd === "string" && record.cwd) return record.cwd;
	}
	return null;
}

function sessionBranch(records: JsonRecord[]): string | null {
	for (const record of [...records].reverse()) {
		if (typeof record.gitBranch === "string" && record.gitBranch) return record.gitBranch;
	}
	return null;
}

function parseSession(path: string, options: ReaderOptions): SessionShow | null {
	const maxText = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
	const maxTool = options.maxToolChars ?? DEFAULT_MAX_TOOL_CHARS;
	const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
	let parsed: ReturnType<typeof readJsonl>;
	try {
		parsed = readJsonl(path);
	} catch {
		return null;
	}
	// Claude transcripts wrap every turn in a `message` envelope. Without one this
	// is foreign JSONL (e.g. a Grok history); refuse it rather than resume an
	// empty session under the wrong harness.
	if (!parsed.records.some((record) => record.message && typeof record.message === "object")) {
		return null;
	}
	const warnings: Warning[] = [];
	if (parsed.malformed) {
		warnings.push({
			code: "malformed_records_skipped",
			message: `Skipped ${parsed.malformed} malformed Claude transcript record(s).`,
		});
	}
	if (parsed.records.some((record) => record.type === "system" && record.subtype === "compact_boundary")) {
		warnings.push({
			code: "compaction_present",
			message: "Claude compaction markers were found; pre-compact history may be incomplete.",
		});
	}
	const turns = parsed.records
		.map((record) => renderTurn(record, maxText, maxTool))
		.filter((turn): turn is Turn => turn !== null);
	const bounded = boundTurns(turns, maxTurns);
	if (bounded.truncated) {
		warnings.push({
			code: "turns_truncated",
			message: `Only the last ${maxTurns} recoverable turns were included.`,
		});
	}
	const cwd = sessionCwd(parsed.records);
	const updated =
		isoToMs([...parsed.records].reverse().find((record) => typeof record.timestamp === "string")?.timestamp) ??
		mtimeMs(path);
	const created =
		isoToMs(parsed.records.find((record) => typeof record.timestamp === "string")?.timestamp) ?? updated;
	return asShow({
		harness: "claude",
		sessionId: path.replace(/^.*[\\/]/, "").replace(/\.jsonl$/, ""),
		title: claudeTitle(parsed.records, bounded.turns),
		cwd,
		branch: sessionBranch(parsed.records),
		updatedAtMs: updated,
		createdAtMs: created,
		source: "claude-code",
		path,
		turns: bounded.turns,
		warnings,
	});
}

function matchesCwd(session: SessionSummary, cwd: string, fromExpectedSlug: boolean): boolean {
	if (session.cwd) return projectCwdMatches(session.cwd, cwd);
	return fromExpectedSlug;
}

function listClaude(options: ReaderOptions): SessionSummary[] {
	const projects = join(claudeHome(options.home), "projects");
	const expectedDir = join(projects, slugifyClaude(options.cwd));
	const files = projectDirs(projects, options.cwd).flatMap(sessionFiles);
	const sessions: SessionSummary[] = [];
	const seen = new Set<string>();
	for (const file of files) {
		const parsed = parseSession(file, options);
		const fromExpected = dirname(file) === expectedDir;
		if (!parsed || seen.has(parsed.sessionId) || !matchesCwd(parsed, options.cwd, fromExpected)) continue;
		seen.add(parsed.sessionId);
		sessions.push(parsed);
	}
	return sessions.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
}

function showClaude(ref: string, options: ReaderOptions): ShowResult {
	const trimmed = ref.trim();
	if (looksLikePath(trimmed)) {
		const session = parseSession(trimmed.replace(/^~/, homedir()), options);
		if (!session) return { ok: false, message: `Could not read Claude session at ${trimmed}` };
		return { ok: true, session };
	}
	const sessions = listClaude(options);
	if (sessions.length === 0) {
		return { ok: false, message: `No Claude Code sessions found for ${options.cwd}` };
	}
	if (!trimmed || isLatestRef(trimmed)) {
		const newest = sessions[0];
		const session = parseSession(newest.path, options);
		if (!session) return { ok: false, message: `Could not read Claude session ${newest.sessionId}` };
		return { ok: true, session };
	}
	if (isUuid(trimmed)) {
		const match = sessions.find((session) => session.sessionId.toLowerCase() === trimmed.toLowerCase());
		if (!match) return { ok: false, message: `No Claude session matched id ${trimmed}` };
		const session = parseSession(match.path, options);
		if (!session) return { ok: false, message: `Could not read Claude session ${trimmed}` };
		return { ok: true, session };
	}
	const query = trimmed.toLowerCase();
	const matches = sessions.filter(
		(session) =>
			session.sessionId.toLowerCase().includes(query) || (session.title ?? "").toLowerCase().includes(query),
	);
	if (matches.length === 1) {
		const session = parseSession(matches[0].path, options);
		if (!session) return { ok: false, message: `Could not read Claude session ${matches[0].sessionId}` };
		return { ok: true, session };
	}
	if (matches.length === 0) return { ok: false, message: `No Claude session matched "${trimmed}"` };
	return { ok: false, message: `Multiple Claude sessions matched "${trimmed}"`, matches };
}

export const claudeReader: SessionReader = {
	harness: "claude",
	label: "Claude Code",
	async list(options) {
		return listClaude(options);
	},
	async show(ref, options) {
		return showClaude(ref, options);
	},
};
