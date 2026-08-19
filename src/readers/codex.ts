import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { cwdWithin, isLatestRef, isUuid, looksLikePath } from "../cwd.ts";
import { isoToMs, mtimeMs, readJsonl, readJsonlHead, type JsonRecord } from "../jsonl.ts";
import { asShow, boundTurns, titleFromTurns } from "../signals.ts";
import { clip, jsonPreview, oneLine } from "../text.ts";
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
} from "../types.ts";

const ROLLOUT_RE =
	/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-fA-F-]{36})\.jsonl$/;

function codexHome(home?: string): string {
	if (home) return home;
	if (process.env.CODEX_HOME) return process.env.CODEX_HOME;
	return join(homedir(), ".codex");
}

function walkRollouts(root: string, maxFiles = 500): string[] {
	const sessions = join(root, "sessions");
	if (!existsSync(sessions)) return [];
	const files: string[] = [];
	const walk = (dir: string, depth: number) => {
		if (files.length >= maxFiles || depth > 5) return;
		let entries: ReturnType<typeof readdirSync>;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path, depth + 1);
			else if (entry.isFile() && ROLLOUT_RE.test(entry.name)) files.push(path);
			if (files.length >= maxFiles) return;
		}
	};
	walk(sessions, 0);
	return files;
}

function rolloutId(path: string): string | null {
	const match = ROLLOUT_RE.exec(basename(path));
	return match?.[1] ?? null;
}

function payloadOf(record: JsonRecord): JsonRecord | null {
	if (record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)) {
		return record.payload as JsonRecord;
	}
	return null;
}

function sessionMeta(records: JsonRecord[]): JsonRecord | null {
	for (const record of records) {
		if (record.type === "session_meta") {
			return payloadOf(record) ?? record;
		}
	}
	return null;
}

function textFromPayload(payload: JsonRecord, maxText: number): string {
	if (typeof payload.message === "string") return clip(payload.message, maxText);
	if (typeof payload.text === "string") return clip(payload.text, maxText);
	if (typeof payload.content === "string") return clip(payload.content, maxText);
	if (Array.isArray(payload.content)) {
		return payload.content
			.map((item) => {
				if (typeof item === "string") return item;
				if (item && typeof item === "object" && typeof (item as JsonRecord).text === "string") {
					return String((item as JsonRecord).text);
				}
				return "";
			})
			.filter(Boolean)
			.map((text) => clip(text, maxText))
			.join("\n");
	}
	return "";
}

function renderCodexRecord(record: JsonRecord, maxText: number, maxTool: number): Turn | null {
	const outer = record.type;
	const payload = payloadOf(record) ?? record;
	if (outer === "event_msg") {
		const kind = payload.type;
		if (kind === "user_message") {
			const text = textFromPayload(payload, maxText);
			return text ? { role: "user", text } : null;
		}
		if (kind === "agent_message" || kind === "assistant_message") {
			const text = textFromPayload(payload, maxText);
			return text ? { role: "assistant", text } : null;
		}
		return null;
	}
	if (outer === "response_item") {
		const kind = payload.type;
		if (kind === "message") {
			const role = payload.role === "user" ? "user" : "assistant";
			const text = textFromPayload(payload, maxText);
			return text ? { role, text } : null;
		}
		if (kind === "function_call") {
			return {
				role: "assistant",
				text: "",
				toolCalls: [
					{
						id: typeof payload.call_id === "string" ? payload.call_id : undefined,
						name: String(payload.name || "unknown"),
						input: jsonPreview(payload.arguments ?? {}, maxTool),
						inert: true,
					},
				],
			};
		}
		if (kind === "function_call_output") {
			return {
				role: "tool",
				text: "",
				toolResults: [
					{
						toolUseId: typeof payload.call_id === "string" ? payload.call_id : undefined,
						content: oneLine(typeof payload.output === "string" ? payload.output : jsonPreview(payload.output, maxTool), maxTool),
						inert: true,
					},
				],
			};
		}
	}
	return null;
}

function parseRollout(path: string, options: ReaderOptions): SessionShow | null {
	const maxText = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
	const maxTool = options.maxToolChars ?? DEFAULT_MAX_TOOL_CHARS;
	const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
	let parsed: ReturnType<typeof readJsonl>;
	try {
		parsed = readJsonl(path);
	} catch {
		return null;
	}
	const warnings: Warning[] = [];
	if (parsed.malformed) {
		warnings.push({
			code: "malformed_records_skipped",
			message: `Skipped ${parsed.malformed} malformed Codex rollout record(s).`,
		});
	}
	const meta = sessionMeta(parsed.records);
	const metaId = typeof meta?.id === "string" ? meta.id : typeof meta?.session_id === "string" ? meta.session_id : null;
	const sessionId = rolloutId(path) ?? metaId ?? basename(path);
	const cwd = typeof meta?.cwd === "string" ? meta.cwd : null;
	const branch =
		typeof meta?.git_branch === "string"
			? meta.git_branch
			: typeof (meta?.git as JsonRecord | undefined)?.branch === "string"
				? String((meta?.git as JsonRecord).branch)
				: null;
	const turns = parsed.records
		.map((record) => renderCodexRecord(record, maxText, maxTool))
		.filter((turn): turn is Turn => turn !== null);
	const bounded = boundTurns(turns, maxTurns);
	if (bounded.truncated) {
		warnings.push({
			code: "turns_truncated",
			message: `Only the last ${maxTurns} recoverable turns were included.`,
		});
	}
	const updated =
		isoToMs([...parsed.records].reverse().find((record) => typeof record.timestamp === "string")?.timestamp) ??
		mtimeMs(path);
	const created =
		isoToMs(parsed.records.find((record) => record.type === "session_meta")?.timestamp) ?? updated;
	return asShow({
		harness: "codex",
		sessionId,
		title: titleFromTurns(bounded.turns),
		cwd,
		branch,
		updatedAtMs: updated,
		createdAtMs: created,
		source: "codex-rollout",
		path,
		turns: bounded.turns,
		warnings,
	});
}

function probeRollout(path: string): { cwd: string | null; sessionId: string; updatedAtMs: number } | null {
	const id = rolloutId(path);
	if (!id) return null;
	try {
		const { records } = readJsonlHead(path, 20);
		const meta = sessionMeta(records);
		return {
			sessionId: id,
			cwd: typeof meta?.cwd === "string" ? meta.cwd : null,
			updatedAtMs: mtimeMs(path),
		};
	} catch {
		return { sessionId: id, cwd: null, updatedAtMs: mtimeMs(path) };
	}
}

function listCodex(options: ReaderOptions): SessionSummary[] {
	const files = walkRollouts(codexHome(options.home));
	const sessions: SessionSummary[] = [];
	for (const file of files) {
		const probe = probeRollout(file);
		if (!probe) continue;
		if (probe.cwd && !cwdWithin(probe.cwd, options.cwd)) continue;
		if (!probe.cwd) continue;
		const parsed = parseRollout(file, options);
		if (!parsed) continue;
		sessions.push(parsed);
	}
	return sessions.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
}

function showCodex(ref: string, options: ReaderOptions): ShowResult {
	const trimmed = ref.trim();
	if (looksLikePath(trimmed)) {
		const expanded = trimmed.replace(/^~/, homedir());
		const session = parseRollout(expanded, options);
		if (!session) return { ok: false, message: `Could not read Codex session at ${trimmed}` };
		return { ok: true, session };
	}
	const sessions = listCodex(options);
	if (sessions.length === 0) {
		return { ok: false, message: `No Codex sessions found for ${options.cwd}` };
	}
	if (!trimmed || isLatestRef(trimmed)) {
		return { ok: true, session: sessions[0] as SessionShow };
	}
	if (isUuid(trimmed)) {
		const match = sessions.find((session) => session.sessionId.toLowerCase() === trimmed.toLowerCase());
		if (!match) return { ok: false, message: `No Codex session matched id ${trimmed}` };
		return { ok: true, session: match as SessionShow };
	}
	const query = trimmed.toLowerCase();
	const matches = sessions.filter(
		(session) =>
			session.sessionId.toLowerCase().includes(query) || (session.title ?? "").toLowerCase().includes(query),
	);
	if (matches.length === 1) return { ok: true, session: matches[0] as SessionShow };
	if (matches.length === 0) return { ok: false, message: `No Codex session matched "${trimmed}"` };
	return { ok: false, message: `Multiple Codex sessions matched "${trimmed}"`, matches };
}

export const codexReader: SessionReader = {
	harness: "codex",
	label: "Codex",
	async list(options) {
		return listCodex(options);
	},
	async show(ref, options) {
		return showCodex(ref, options);
	},
};
