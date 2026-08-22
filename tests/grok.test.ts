import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { grokReader } from "../src/readers/grok.ts";
import { tempDir, writeJson, writeJsonl } from "./helpers.ts";

const SESSION = "01a01406-45d3-7140-b01a-469ad3977d2e";
const NEWER = "01a01999-45d3-7140-b01a-469ad3977d2e";
const OTHER = "01a02000-45d3-7140-b01a-469ad3977d2e";

const CWD = "/tmp/grok-app";

function encoded(cwd: string): string {
	return encodeURIComponent(cwd);
}

type HistoryRecord = Record<string, unknown>;

function baseHistory(): HistoryRecord[] {
	return [
		{ type: "system", content: "You are Grok 4.6 released by xAI." },
		{
			type: "user",
			content: [
				{
					type: "text",
					text: "<user_info>\nOS Version: linux\nShell: /usr/bin/bash\nWorkspace Path: /tmp/grok-app\n</user_info>",
				},
			],
		},
		{
			type: "user",
			content: [{ type: "text", text: "<system-reminder>\nThe following skills are available:\n</system-reminder>" }],
		},
		{ type: "user", content: [{ type: "text", text: "<user_query> Ship the parser </user_query>" }] },
		{
			type: "assistant",
			content: "Starting work.",
			tool_calls: [
				{ id: "call-1", name: "read_file", arguments: "{\"target_file\":\"parser.ts\"}" },
			],
		},
		{ type: "tool_result", content: "export function parse() {}", tool_call_id: "call-1" },
		{ type: "reasoning", encrypted_content: "opaque-blob", summary: [] },
		{ type: "assistant", content: [{ type: "text", text: "Done." }] },
	];
}

function writeGrokSession(
	home: string,
	cwd: string,
	sessionId: string,
	history: HistoryRecord[],
	summaryExtra: Record<string, unknown> = {},
): string {
	const sessionDir = join(home, "sessions", encoded(cwd), sessionId);
	writeJsonl(join(sessionDir, "chat_history.jsonl"), history);
	writeJson(join(sessionDir, "summary.json"), {
		info: { id: sessionId, cwd },
		generated_title: `Title for ${sessionId.slice(0, 8)}`,
		session_summary: `Summary for ${sessionId.slice(0, 8)}`,
		created_at: "2026-08-20T10:00:00Z",
		updated_at: "2026-08-21T12:00:00Z",
		last_active_at: "2026-08-21T12:30:00Z",
		head_branch: "feat/parser",
		...summaryExtra,
	});
	return sessionDir;
}

test("grok list filters sessions by decoded project cwd and orders newest first", async () => {
	const home = tempDir("pi-resume-grok-");
	writeGrokSession(home, CWD, SESSION, baseHistory(), { last_active_at: "2026-08-20T12:30:00Z" });
	writeGrokSession(home, CWD, NEWER, baseHistory());
	writeGrokSession(home, "/tmp/other-app", OTHER, baseHistory());

	const listed = await grokReader.list({ cwd: CWD, home });
	assert.deepEqual(
		listed.map((session) => session.sessionId),
		[NEWER, SESSION],
	);
	assert.equal(listed[0].harness, "grok");
	assert.equal(listed[0].cwd, CWD);
	assert.equal(listed[0].title, `Title for ${NEWER.slice(0, 8)}`);
	assert.equal(listed[0].branch, "feat/parser");
});

test("grok latest recovers turns, drops wrappers, and keeps tool calls inert", async () => {
	const home = tempDir("pi-resume-grok-");
	writeGrokSession(home, CWD, SESSION, baseHistory());

	const shown = await grokReader.show("latest", { cwd: CWD, home });
	assert.equal(shown.ok, true);
	if (!shown.ok) return;
	const { session } = shown;
	assert.equal(session.lastUserRequest, "Ship the parser");
	assert.equal(session.lastAssistantAction, "Done.");
	assert.equal(session.createdAtMs, Date.parse("2026-08-20T10:00:00Z"));
	assert.equal(session.updatedAtMs, Date.parse("2026-08-21T12:30:00Z"));
	assert.equal(session.source, "grok-chat-history");

	const serialized = JSON.stringify(session.turns);
	assert.ok(!serialized.includes("You are Grok"), "system prompt must never surface");
	assert.ok(!serialized.includes("opaque-blob"), "reasoning content must never surface");
	assert.ok(!serialized.includes("user_info"), "environment wrappers must not surface");
	assert.ok(
		!serialized.includes("The following skills are available"),
		"system-reminder content must not surface",
	);

	const assistant = session.turns.find((turn) => turn.role === "assistant" && turn.toolCalls);
	assert.ok(assistant?.toolCalls?.[0]);
	assert.equal(assistant.toolCalls[0].name, "read_file");
	assert.equal(assistant.toolCalls[0].inert, true);

	const toolTurn = session.turns.find((turn) => turn.role === "tool");
	assert.ok(toolTurn?.toolResults?.[0]);
	assert.equal(toolTurn.toolResults[0].toolUseId, "call-1");
	assert.equal(toolTurn.toolResults[0].inert, true);
});

test("grok resolves by id, keyword, transcript path, and session directory path", async () => {
	const home = tempDir("pi-resume-grok-");
	const sessionDir = writeGrokSession(home, CWD, SESSION, baseHistory());

	const byId = await grokReader.show(SESSION, { cwd: CWD, home });
	assert.ok(byId.ok && byId.session.sessionId === SESSION);

	const byKeyword = await grokReader.show(`title for ${SESSION.slice(0, 8)}`, { cwd: CWD, home });
	assert.ok(byKeyword.ok && byKeyword.session.sessionId === SESSION);

	const byHistoryPath = await grokReader.show(join(sessionDir, "chat_history.jsonl"), { cwd: CWD, home });
	assert.ok(byHistoryPath.ok && byHistoryPath.session.path === join(sessionDir, "chat_history.jsonl"));

	const byDirPath = await grokReader.show(`~/.grok/sessions/${encoded(CWD)}/${SESSION}`, {
		cwd: CWD,
		home,
	});
	assert.equal(byDirPath.ok, false, "tilde expansion uses the real HOME, not the fixture");

	const realPath = await grokReader.show(sessionDir, { cwd: CWD, home });
	assert.ok(realPath.ok && realPath.session.sessionId === SESSION);

	const miss = await grokReader.show(OTHER, { cwd: CWD, home });
	assert.equal(miss.ok, false);
});

test("grok warns about malformed history records", async () => {
	const home = tempDir("pi-resume-grok-");
	const sessionDir = writeGrokSession(home, CWD, SESSION, baseHistory());
	const historyPath = join(sessionDir, "chat_history.jsonl");
	const { appendFileSync } = await import("node:fs");
	appendFileSync(historyPath, "{not json}\n");

	const shown = await grokReader.show("latest", { cwd: CWD, home });
	assert.ok(shown.ok);
	if (!shown.ok) return;
	assert.deepEqual(
		shown.session.warnings.map((warning) => warning.code),
		["malformed_records_skipped"],
	);
});

test("grok truncates long transcripts with a warning and keeps the tail", async () => {
	const home = tempDir("pi-resume-grok-");
	const longHistory: HistoryRecord[] = [];
	for (let index = 0; index < 80; index += 1) {
		longHistory.push({ type: "user", content: [{ type: "text", text: `<user_query> msg ${index} </user_query>` }] });
	}
	writeGrokSession(home, CWD, SESSION, longHistory, { generated_title: null });

	const shown = await grokReader.show(SESSION, { cwd: CWD, home, maxTurns: 10 });
	assert.ok(shown.ok);
	if (!shown.ok) return;
	assert.equal(shown.session.turns.length, 10);
	assert.equal(shown.session.turns[0].text, "msg 70");
	assert.ok(shown.session.warnings.some((warning) => warning.code === "turns_truncated"));
});

test("grok falls back to transcript-derived title when summary has none", async () => {
	const home = tempDir("pi-resume-grok-");
	writeGrokSession(home, CWD, SESSION, baseHistory(), {
		generated_title: null,
		session_summary: null,
	});
	const shown = await grokReader.show("latest", { cwd: CWD, home });
	assert.ok(shown.ok);
	if (!shown.ok) return;
	assert.equal(shown.session.title, "Ship the parser");
});

test("grok list ignores non-UUID directories and sessions without transcripts", async () => {
	const home = tempDir("pi-resume-grok-");
	const project = join(home, "sessions", encoded(CWD));
	writeJson(join(project, "01a01406-45d3-7140-b01a-not-a-uuid", "summary.json"), {});
	writeJson(join(project, `${SESSION}-shell`), { info: { id: "x" } });
	const empty = join(project, NEWER);
	writeJson(join(empty, "summary.json"), { info: { id: NEWER, cwd: CWD } });

	const listed = await grokReader.list({ cwd: CWD, home });
	assert.deepEqual(listed, []);
});

test("grok does not treat a home-directory query as matching a project session", async () => {
	const fakeGrokHome = tempDir("pi-resume-grok-home-");
	const projectCwd = join(homedir(), "Desktop", "Work", "grok-app");
	writeGrokSession(fakeGrokHome, projectCwd, SESSION, baseHistory());

	const fromHome = await grokReader.list({ cwd: homedir(), home: fakeGrokHome });
	assert.deepEqual(fromHome, [], "querying from $HOME must not match a child-project session");

	const fromProject = await grokReader.list({ cwd: projectCwd, home: fakeGrokHome });
	assert.deepEqual(fromProject.map((session) => session.cwd), [projectCwd]);
});

test("grok decodes Windows-encoded project directories on any host", async () => {
	const home = tempDir("pi-resume-grok-");
	const winCwd = "C:\\Users\\amy\\app";
	writeGrokSession(home, winCwd, SESSION, baseHistory());

	const listed = await grokReader.list({ cwd: winCwd, home });
	assert.equal(listed.length, 1);
	assert.equal(listed[0].sessionId, SESSION);
	assert.equal(listed[0].cwd, winCwd);
});

test("grok show without any sessions reports a clear error", async () => {
	const home = tempDir("pi-resume-grok-empty-");
	const shown = await grokReader.show("latest", { cwd: CWD, home });
	assert.equal(shown.ok, false);
	if (shown.ok) return;
	assert.match(shown.message, /No Grok sessions found/);
});
