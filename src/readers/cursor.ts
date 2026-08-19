import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
	ancestorProjectCwds,
	encodeCursorProject,
	isBroadRoot,
	isLatestRef,
	isUuid,
	looksLikePath,
	normalizeCwd,
	projectCwdMatches,
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

function cursorHome(home?: string): string {
	if (home) return home;
	if (process.env.CURSOR_HOME) return process.env.CURSOR_HOME;
	return join(homedir(), ".cursor");
}

function matchingProjectDirs(projectsRoot: string, cwd: string): Array<{ dir: string; cwd: string | null }> {
	if (!existsSync(projectsRoot)) return [];
	const encoded = encodeCursorProject(cwd);
	const encodedAncestors = new Map(ancestorProjectCwds(cwd).map((path) => [encodeCursorProject(path), path]));
	const matches: Array<{ dir: string; cwd: string | null }> = [];
	try {
		for (const entry of readdirSync(projectsRoot, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			if (entry.name === encoded) {
				matches.push({ dir: join(projectsRoot, entry.name), cwd: normalizeCwd(cwd) });
				continue;
			}
			// Subdirectory project folders (`<cwd-slug>-src`), but never every project under $HOME.
			if (!isBroadRoot(cwd) && entry.name.startsWith(`${encoded}-`)) {
				matches.push({ dir: join(projectsRoot, entry.name), cwd: normalizeCwd(cwd) });
				continue;
			}
			const ancestor = encodedAncestors.get(entry.name);
			if (ancestor) matches.push({ dir: join(projectsRoot, entry.name), cwd: ancestor });
		}
	} catch {
		// ignore unreadable project trees
	}
	return matches;
}

function transcriptFiles(projectDir: string): string[] {
	const root = join(projectDir, "agent-transcripts");
	if (!existsSync(root)) return [];
	const files: string[] = [];
	try {
		for (const entry of readdirSync(root, { withFileTypes: true })) {
			if (entry.isDirectory() && UUID_RE.test(entry.name)) {
				const nested = join(root, entry.name, `${entry.name}.jsonl`);
				if (existsSync(nested)) files.push(nested);
				continue;
			}
			if (entry.isFile() && entry.name.endsWith(".jsonl") && UUID_RE.test(entry.name.slice(0, -6))) {
				files.push(join(root, entry.name));
			}
		}
	} catch {
		// ignore
	}
	return files;
}

function renderCursorRecord(record: JsonRecord, maxText: number, maxTool: number): Turn | null {
	if (record.type && record.type !== "message") return null;
	const role = record.role;
	if (role !== "user" && role !== "assistant" && role !== "tool") return null;
	const message = record.message;
	const content = message && typeof message === "object" ? (message as JsonRecord).content : record.content;
	const texts: string[] = [];
	const toolCalls: NonNullable<Turn["toolCalls"]> = [];
	const toolResults: NonNullable<Turn["toolResults"]> = [];
	for (const block of blocks(content)) {
		const type = block.type;
		if (type === "text" || type === "input_text" || type === "output_text" || !type) {
			if (typeof block.text !== "string" || !block.text.trim()) continue;
			const rendered = role === "user" ? visibleUserText(block.text) : block.text;
			if (rendered) texts.push(clip(rendered, maxText));
		} else if (type === "tool_use" || type === "tool_call") {
			toolCalls.push({
				id: typeof block.id === "string" ? block.id : undefined,
				name: String(block.name || record.tool_name || "unknown"),
				input: jsonPreview(block.input ?? block.arguments ?? {}, maxTool),
				inert: true,
			});
		} else if (type === "tool_result") {
			toolResults.push({
				toolUseId: typeof block.tool_use_id === "string" ? block.tool_use_id : undefined,
				content: oneLine(typeof block.content === "string" ? block.content : jsonPreview(block.content, maxTool), maxTool),
				inert: true,
			});
		}
	}
	if (typeof content === "string" && content.trim()) {
		const rendered = role === "user" ? visibleUserText(content) : content;
		if (rendered) texts.push(clip(rendered, maxText));
	}
	if (role === "tool" && typeof record.tool_name === "string") {
		toolResults.push({
			content: oneLine(texts.join("\n") || jsonPreview(content, maxTool), maxTool),
			inert: true,
		});
		return { role: "tool", text: "", toolResults };
	}
	const turn: Turn = { role, text: texts.filter(Boolean).join("\n") };
	if (toolCalls.length) turn.toolCalls = toolCalls;
	if (toolResults.length) turn.toolResults = toolResults;
	if (!turn.text && !turn.toolCalls && !turn.toolResults) return null;
	return turn;
}

function parseTranscript(path: string, fallbackCwd: string | null, options: ReaderOptions): SessionShow | null {
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
			message: `Skipped ${parsed.malformed} malformed Cursor transcript record(s).`,
		});
	}
	const turns = parsed.records
		.map((record) => renderCursorRecord(record, maxText, maxTool))
		.filter((turn): turn is Turn => turn !== null);
	const bounded = boundTurns(turns, maxTurns);
	if (bounded.truncated) {
		warnings.push({
			code: "turns_truncated",
			message: `Only the last ${maxTurns} recoverable turns were included.`,
		});
	}
	const sessionId =
		basename(path).replace(/\.jsonl$/, "") ||
		basename(dirname(path));
	const updated = mtimeMs(path);
	const created =
		isoToMs(parsed.records.find((record) => typeof record.timestamp === "string")?.timestamp) ?? updated;
	return asShow({
		harness: "cursor",
		sessionId,
		title: titleFromTurns(bounded.turns),
		cwd: fallbackCwd,
		branch: null,
		updatedAtMs: updated,
		createdAtMs: created,
		source: "cursor-agent-transcripts",
		path,
		turns: bounded.turns,
		warnings,
	});
}

function cliChatSessions(root: string, cwd: string, options: ReaderOptions): SessionShow[] {
	const chats = join(root, "chats");
	if (!existsSync(chats)) return [];
	const sessions: SessionShow[] = [];
	try {
		for (const hashDir of readdirSync(chats, { withFileTypes: true })) {
			if (!hashDir.isDirectory()) continue;
			const hashPath = join(chats, hashDir.name);
			for (const sessionDir of readdirSync(hashPath, { withFileTypes: true })) {
				if (!sessionDir.isDirectory() || !UUID_RE.test(sessionDir.name)) continue;
				const dir = join(hashPath, sessionDir.name);
				const metaPath = join(dir, "metadata.json");
				let metaCwd: string | null = null;
				let title: string | null = null;
				let branch: string | null = null;
				if (existsSync(metaPath)) {
					try {
						const meta = JSON.parse(readFileSync(metaPath, "utf8")) as JsonRecord;
						if (typeof meta.cwd === "string") metaCwd = meta.cwd;
						if (typeof meta.title === "string") title = meta.title;
						if (typeof meta.git_branch === "string") branch = meta.git_branch;
					} catch {
						// ignore bad metadata
					}
				}
				if (!metaCwd || !projectCwdMatches(metaCwd, cwd)) continue;
				const transcriptDir = join(dir, "transcripts");
				const files = existsSync(transcriptDir)
					? readdirSync(transcriptDir)
							.filter((name) => name.endsWith(".jsonl"))
							.map((name) => join(transcriptDir, name))
					: [];
				const path = files[0] ?? metaPath;
				if (!existsSync(path)) continue;
				const parsed = files[0] ? parseTranscript(files[0], metaCwd ?? cwd, options) : null;
				if (parsed) {
					sessions.push({
						...parsed,
						sessionId: sessionDir.name,
						title: title ?? parsed.title,
						cwd: metaCwd ?? parsed.cwd,
						branch,
						source: "cursor-cli-chat",
						path: files[0] ?? dir,
					});
				}
			}
		}
	} catch {
		// ignore unreadable CLI chats
	}
	return sessions;
}

function listCursor(options: ReaderOptions): SessionSummary[] {
	const home = cursorHome(options.home);
	const sessions: SessionShow[] = [];
	const seen = new Set<string>();
	for (const project of matchingProjectDirs(join(home, "projects"), options.cwd)) {
		for (const file of transcriptFiles(project.dir)) {
			const parsed = parseTranscript(file, project.cwd, options);
			if (!parsed || seen.has(parsed.path)) continue;
			seen.add(parsed.path);
			sessions.push(parsed);
		}
	}
	for (const session of cliChatSessions(home, options.cwd, options)) {
		if (seen.has(session.path)) continue;
		seen.add(session.path);
		sessions.push(session);
	}
	return sessions.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
}

function showCursor(ref: string, options: ReaderOptions): ShowResult {
	const trimmed = ref.trim();
	if (looksLikePath(trimmed)) {
		const expanded = trimmed.replace(/^~/, homedir());
		const session = parseTranscript(expanded, options.cwd, options);
		if (!session) return { ok: false, message: `Could not read Cursor session at ${trimmed}` };
		return { ok: true, session };
	}
	const sessions = listCursor(options);
	if (sessions.length === 0) {
		return { ok: false, message: `No Cursor sessions found for ${options.cwd}` };
	}
	if (!trimmed || isLatestRef(trimmed)) {
		return { ok: true, session: sessions[0] as SessionShow };
	}
	if (isUuid(trimmed)) {
		const match = sessions.find((session) => session.sessionId.toLowerCase() === trimmed.toLowerCase());
		if (!match) return { ok: false, message: `No Cursor session matched id ${trimmed}` };
		return { ok: true, session: match as SessionShow };
	}
	const query = trimmed.toLowerCase();
	const matches = sessions.filter(
		(session) =>
			session.sessionId.toLowerCase().includes(query) || (session.title ?? "").toLowerCase().includes(query),
	);
	if (matches.length === 1) return { ok: true, session: matches[0] as SessionShow };
	if (matches.length === 0) return { ok: false, message: `No Cursor session matched "${trimmed}"` };
	return { ok: false, message: `Multiple Cursor sessions matched "${trimmed}"`, matches };
}

export const cursorReader: SessionReader = {
	harness: "cursor",
	label: "Cursor",
	async list(options) {
		return listCursor(options);
	},
	async show(ref, options) {
		return showCursor(ref, options);
	},
};
