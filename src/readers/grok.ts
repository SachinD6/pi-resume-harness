import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { isLatestRef, isUuid, looksLikePath, projectCwdMatches } from "../cwd.ts";
import { isoToMs, mtimeMs, readJsonl, type JsonRecord } from "../jsonl.ts";
import { asShow, boundTurns, titleFromTurns } from "../signals.ts";
import { blocks, clip, jsonPreview, oneLine, visibleUserText } from "../text.ts";
import {
	DEFAULT_MAX_TEXT_CHARS,
	DEFAULT_MAX_TOOL_CHARS,
	DEFAULT_MAX_TURNS,
	UUID_RE,
	type ReaderOptions,
	type SessionReader,
	type SessionShow,
	type SessionSummary,
	type ShowResult,
	type Turn,
	type Warning,
} from "../types.ts";

const HISTORY_FILE = "chat_history.jsonl";
const SUMMARY_FILE = "summary.json";

function grokHome(home?: string): string {
	if (home) return home;
	if (process.env.GROK_HOME) return process.env.GROK_HOME;
	return join(homedir(), ".grok");
}

/** Decode a URL-encoded Grok project directory name (`%2Fhome%2F...`). */
function decodeProjectDir(name: string): string | null {
	if (!name.includes("%")) return null;
	try {
		return decodeURIComponent(name);
	} catch {
		return null;
	}
}

function matchingProjectDirs(sessionsRoot: string, cwd: string): string[] {
	if (!existsSync(sessionsRoot)) return [];
	let names: string[];
	try {
		names = readdirSync(sessionsRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
	const dirs: string[] = [];
	for (const name of names) {
		const decoded = decodeProjectDir(name);
		if (!decoded || !projectCwdMatches(decoded, cwd)) continue;
		dirs.push(join(sessionsRoot, name));
	}
	return dirs;
}

function summaryOf(sessionDir: string): JsonRecord | null {
	const path = join(sessionDir, SUMMARY_FILE);
	if (!existsSync(path)) return null;
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonRecord;
	} catch {
		// tolerate unreadable summaries; the transcript is still parseable
	}
	return null;
}

function stringField(record: JsonRecord | null, key: string): string | null {
	const value = record?.[key];
	return typeof value === "string" && value.trim() ? value : null;
}

function infoStringField(summary: JsonRecord | null, key: string): string | null {
	const info = summary?.info;
	if (!info || typeof info !== "object" || Array.isArray(info)) return null;
	return stringField(info as JsonRecord, key);
}

function textFromContent(content: unknown): string[] {
	if (typeof content === "string") return content ? [content] : [];
	const texts: string[] = [];
	for (const block of blocks(content)) {
		if (typeof block.text === "string" && block.text.trim()) texts.push(block.text);
	}
	return texts;
}

function toolCallsFrom(record: JsonRecord, maxTool: number): NonNullable<Turn["toolCalls"]> | null {
	const rawCalls = record.tool_calls;
	if (!Array.isArray(rawCalls)) return null;
	const calls = rawCalls
		.filter((call): call is JsonRecord => !!call && typeof call === "object" && !Array.isArray(call))
		.map((call) => ({
			id: typeof call.id === "string" ? call.id : undefined,
			name: String(call.name || "unknown"),
			input: jsonPreview(call.arguments ?? {}, maxTool),
			inert: true as const,
		}));
	return calls.length ? calls : null;
}

/**
 * Render one chat_history.jsonl record. System prompts and reasoning entries are
 * never surfaced: they are foreign instructions and encrypted content.
 */
function renderGrokRecord(record: JsonRecord, maxText: number, maxTool: number): Turn | null {
	const type = record.type;
	if (type === "user") {
		const rendered = textFromContent(record.content)
			.map(visibleUserText)
			.filter((text): text is string => !!text)
			.join("\n");
		return rendered ? { role: "user", text: clip(rendered, maxText) } : null;
	}
	if (type === "assistant") {
		const texts = textFromContent(record.content).map((text) => clip(text, maxText));
		const turn: Turn = { role: "assistant", text: texts.filter(Boolean).join("\n") };
		const toolCalls = toolCallsFrom(record, maxTool);
		if (toolCalls) turn.toolCalls = toolCalls;
		if (!turn.text && !turn.toolCalls) return null;
		return turn;
	}
	if (type === "tool_result") {
		const content =
			typeof record.content === "string" ? record.content : jsonPreview(record.content ?? "", maxTool);
		if (!content.trim()) return null;
		return {
			role: "tool",
			text: "",
			toolResults: [
				{
					toolUseId: typeof record.tool_call_id === "string" ? record.tool_call_id : undefined,
					content: oneLine(content, maxTool),
					inert: true,
				},
			],
		};
	}
	return null;
}

function transcriptPathFor(ref: string): string | null {
	const expanded = ref.replace(/^~(?=$|[\\/])/, homedir());
	if (basename(expanded) === HISTORY_FILE) return expanded;
	if (existsSync(join(expanded, HISTORY_FILE))) return join(expanded, HISTORY_FILE);
	return null;
}

function fallbackCwd(historyPath: string, options: ReaderOptions): string {
	const summary = summaryOf(dirname(historyPath));
	return infoStringField(summary, "cwd") ?? options.cwd;
}

function parseHistory(
	historyPath: string,
	sessionDir: string,
	options: ReaderOptions,
	fallbackCwdValue: string,
): SessionShow | null {
	const maxText = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
	const maxTool = options.maxToolChars ?? DEFAULT_MAX_TOOL_CHARS;
	const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
	let parsed: ReturnType<typeof readJsonl>;
	try {
		parsed = readJsonl(historyPath);
	} catch {
		return null;
	}
	const warnings: Warning[] = [];
	if (parsed.malformed) {
		warnings.push({
			code: "malformed_records_skipped",
			message: `Skipped ${parsed.malformed} malformed Grok history record(s).`,
		});
	}
	const turns = parsed.records
		.map((record) => renderGrokRecord(record, maxText, maxTool))
		.filter((turn): turn is Turn => turn !== null);
	const bounded = boundTurns(turns, maxTurns);
	if (bounded.truncated) {
		warnings.push({
			code: "turns_truncated",
			message: `Only the last ${maxTurns} recoverable turns were included.`,
		});
	}
	const summary = summaryOf(sessionDir);
	const updated =
		isoToMs(stringField(summary, "last_active_at") ?? stringField(summary, "updated_at")) ??
		mtimeMs(historyPath);
	const created = isoToMs(stringField(summary, "created_at")) ?? updated;
	const sessionId = infoStringField(summary, "id") ?? basename(sessionDir);
	return asShow({
		harness: "grok",
		sessionId,
		title:
			stringField(summary, "generated_title") ??
			stringField(summary, "session_summary") ??
			titleFromTurns(bounded.turns),
		cwd: infoStringField(summary, "cwd") ?? fallbackCwdValue,
		branch: stringField(summary, "head_branch"),
		updatedAtMs: updated,
		createdAtMs: created,
		source: "grok-chat-history",
		path: historyPath,
		turns: bounded.turns,
		warnings,
	});
}

function listSessions(options: ReaderOptions): SessionShow[] {
	const sessionsRoot = join(grokHome(options.home), "sessions");
	const sessions: SessionShow[] = [];
	for (const projectDir of matchingProjectDirs(sessionsRoot, options.cwd)) {
		let sessionDirs: string[] = [];
		try {
			sessionDirs = readdirSync(projectDir, { withFileTypes: true })
				.filter((entry) => entry.isDirectory() && UUID_RE.test(entry.name))
				.map((entry) => entry.name);
		} catch {
			continue;
		}
		for (const name of sessionDirs) {
			const sessionDir = join(projectDir, name);
			const historyPath = join(sessionDir, HISTORY_FILE);
			if (!existsSync(historyPath)) continue;
			// Strict project-cwd rule: the summary's cwd wins when present, and it
			// must still match the queried tree. Never treat broad roots as matches.
			const sessionCwd =
				infoStringField(summaryOf(sessionDir), "cwd") ?? decodeProjectDir(basename(projectDir));
			if (!sessionCwd || !projectCwdMatches(sessionCwd, options.cwd)) continue;
			const parsed = parseHistory(historyPath, sessionDir, options, sessionCwd);
			if (parsed) sessions.push(parsed);
		}
	}
	return sessions.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
}

function showGrok(ref: string, options: ReaderOptions): ShowResult {
	const trimmed = ref.trim();
	if (looksLikePath(trimmed)) {
		const historyPath = transcriptPathFor(trimmed);
		const dir = historyPath ? dirname(historyPath) : null;
		if (!historyPath || !dir) return { ok: false, message: `Could not read Grok session at ${trimmed}` };
		const session = parseHistory(historyPath, dir, options, fallbackCwd(historyPath, options));
		if (!session) return { ok: false, message: `Could not read Grok session at ${trimmed}` };
		return { ok: true, session };
	}
	const sessions = listSessions(options);
	if (sessions.length === 0) {
		return { ok: false, message: `No Grok sessions found for ${options.cwd}` };
	}
	if (!trimmed || isLatestRef(trimmed)) {
		return { ok: true, session: sessions[0] as SessionShow };
	}
	if (isUuid(trimmed)) {
		const match = sessions.find((session) => session.sessionId.toLowerCase() === trimmed.toLowerCase());
		if (!match) return { ok: false, message: `No Grok session matched id ${trimmed}` };
		return { ok: true, session: match as SessionShow };
	}
	const query = trimmed.toLowerCase();
	const matches = sessions.filter(
		(session) =>
			session.sessionId.toLowerCase().includes(query) || (session.title ?? "").toLowerCase().includes(query),
	);
	if (matches.length === 1) return { ok: true, session: matches[0] as SessionShow };
	if (matches.length === 0) return { ok: false, message: `No Grok session matched "${trimmed}"` };
	return { ok: false, message: `Multiple Grok sessions matched "${trimmed}"`, matches };
}

export const grokReader: SessionReader = {
	harness: "grok",
	label: "Grok",
	async list(options) {
		return listSessions(options);
	},
	async show(ref, options) {
		return showGrok(ref, options);
	},
};
