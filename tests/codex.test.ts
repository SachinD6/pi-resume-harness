import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { codexReader, newestRollouts } from "../src/readers/codex.ts";
import { tempDir, writeJsonl } from "./helpers.ts";

const SESSION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

test("codex list filters rollout files by session_meta cwd", async () => {
	const cwd = "/tmp/codex-app";
	const home = tempDir("pi-resume-codex-");
	writeJsonl(join(home, "sessions", "2026", "08", "01", `rollout-2026-08-01T09-15-22-${SESSION}.jsonl`), [
		{
			timestamp: "2026-08-01T09:15:22.000Z",
			type: "session_meta",
			payload: { id: SESSION, cwd, git_branch: "dev" },
		},
		{
			timestamp: "2026-08-01T09:15:23.000Z",
			type: "event_msg",
			payload: { type: "user_message", message: "Write the parser" },
		},
		{
			timestamp: "2026-08-01T09:15:24.000Z",
			type: "response_item",
			payload: { type: "function_call", name: "exec_command", arguments: "{\"command\":\"ls\"}", call_id: "c1" },
		},
		{
			timestamp: "2026-08-01T09:15:25.000Z",
			type: "response_item",
			payload: { type: "function_call_output", call_id: "c1", output: "ok" },
		},
		{
			timestamp: "2026-08-01T09:15:26.000Z",
			type: "response_item",
			payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Parser drafted." }] },
		},
	]);
	writeJsonl(join(home, "sessions", "2026", "08", "01", `rollout-2026-08-01T10-00-00-${OTHER}.jsonl`), [
		{
			timestamp: "2026-08-01T10:00:00.000Z",
			type: "session_meta",
			payload: { id: OTHER, cwd: "/tmp/elsewhere" },
		},
		{
			type: "event_msg",
			payload: { type: "user_message", message: "Wrong tree" },
		},
	]);

	const listed = await codexReader.list({ cwd, home });
	assert.equal(listed.length, 1);
	assert.equal(listed[0].sessionId, SESSION);
	const shown = await codexReader.show("latest", { cwd, home });
	assert.equal(shown.ok, true);
	if (shown.ok) {
		assert.equal(shown.session.lastUserRequest, "Write the parser");
		assert.equal(shown.session.lastAssistantAction, "Parser drafted.");
		assert.equal(shown.session.turns.some((turn) => turn.toolCalls?.[0]?.name === "exec_command"), true);
		assert.equal(shown.session.turns.some((turn) => turn.role === "tool"), true);
		assert.equal(shown.session.branch, "dev");
	}
});

test("codex list from $HOME does not swallow every project", async () => {
	const projectCwd = join(homedir(), "Desktop/Work/codex-app");
	const home = tempDir("pi-resume-codex-home-");
	const id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
	writeJsonl(join(home, "sessions", "2026", "08", "01", `rollout-2026-08-01T11-00-00-${id}.jsonl`), [
		{
			timestamp: "2026-08-01T11:00:00.000Z",
			type: "session_meta",
			payload: { id, cwd: projectCwd },
		},
		{
			type: "event_msg",
			payload: { type: "user_message", message: "<user_query>write tests</user_query>" },
		},
	]);
	const fromHome = await codexReader.list({ cwd: homedir(), home });
	assert.equal(fromHome.length, 0);
	const fromProject = await codexReader.show("latest", { cwd: projectCwd, home });
	assert.equal(fromProject.ok, true);
	if (fromProject.ok) {
		assert.equal(fromProject.session.cwd, projectCwd);
		assert.equal(fromProject.session.lastUserRequest, "write tests");
	}
});

test("codex list skips rollouts with no recoverable cwd", async () => {
	const cwd = "/tmp/codex-app";
	const home = tempDir("pi-resume-codex-nocwd-");
	const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
	writeJsonl(join(home, "sessions", "2026", "08", "01", `rollout-2026-08-01T12-00-00-${id}.jsonl`), [
		{
			timestamp: "2026-08-01T12:00:00.000Z",
			type: "session_meta",
			payload: { id },
		},
		{
			type: "event_msg",
			payload: { type: "user_message", message: "orphan rollout" },
		},
	]);
	const listed = await codexReader.list({ cwd, home });
	assert.equal(listed.length, 0);
});

test("codex unwraps user_query after a long prefix beyond maxText", async () => {
	const cwd = "/tmp/codex-long";
	const home = tempDir("pi-resume-codex-long-");
	const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
	const inner = "resume the parser work";
	const padded = `<user_query>${"x".repeat(80)}${inner}</user_query>`;
	writeJsonl(join(home, "sessions", "2026", "08", "01", `rollout-2026-08-01T13-00-00-${id}.jsonl`), [
		{
			timestamp: "2026-08-01T13:00:00.000Z",
			type: "session_meta",
			payload: { id, cwd },
		},
		{
			type: "event_msg",
			payload: { type: "user_message", message: padded },
		},
	]);
	const shown = await codexReader.show("latest", { cwd, home, maxTextChars: 40 });
	assert.equal(shown.ok, true);
	if (shown.ok) {
		assert.ok(!shown.session.lastUserRequest?.includes("<user_query>"));
		assert.ok(shown.session.lastUserRequest?.includes("x".repeat(20)));
	}
});

test("codex rollout cap keeps the newest sessions, not whichever the walk reached first", () => {
	const id = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
	const file = (stamp: string, n: number) =>
		join("/store", "sessions", "2026", "09", "14", `rollout-${stamp}-${id(n)}.jsonl`);
	// Walk order is filesystem-defined; feed the collector an arbitrary one.
	const walked = [
		file("2026-01-02T03-04-05", 1),
		file("2026-09-14T16-25-54", 9),
		file("2026-05-06T07-08-09", 4),
		file("2026-09-13T10-00-00", 8),
	];
	assert.deepEqual(newestRollouts(walked, 2), [
		file("2026-09-14T16-25-54", 9),
		file("2026-09-13T10-00-00", 8),
	]);
	assert.equal(newestRollouts(walked, 10).length, 4);
});

test("codex list reads past the walk cap so recent sessions survive a large store", async () => {
	const cwd = "/tmp/codex-crowded";
	const home = tempDir("pi-resume-codex-crowded-");
	const id = (n: number) => `${String(n).padStart(8, "0")}-2222-4222-8222-222222222222`;
	const total = 501;
	for (let i = 0; i < total; i++) {
		const stamp = new Date(Date.UTC(2026, 7, 1, 0, 0, i)).toISOString();
		const name = `rollout-${stamp.slice(0, 19).replace(/:/g, "-")}-${id(i)}.jsonl`;
		writeJsonl(join(home, "sessions", "2026", "08", "01", name), [
			{ timestamp: stamp, type: "session_meta", payload: { id: id(i), cwd } },
			{ timestamp: stamp, type: "event_msg", payload: { type: "user_message", message: `turn ${i}` } },
		]);
	}

	// The 500-file cap still applies, but it now keeps the newest 500 rather
	// than whichever 500 the walk happened to reach first.
	const listed = await codexReader.list({ cwd, home });
	assert.equal(listed.length, 500);
	assert.equal(listed[0].sessionId, id(total - 1));
	assert.equal(listed.some((session) => session.sessionId === id(0)), false);
	const shown = await codexReader.show("latest", { cwd, home });
	assert.equal(shown.ok, true);
	if (shown.ok) assert.equal(shown.session.sessionId, id(total - 1));
});

test("codex rejects foreign jsonl transcripts given by path", async () => {
	const home = tempDir("pi-resume-codex-");
	const foreign = join(home, "chat_history.jsonl");
	writeJsonl(foreign, [
		{ type: "user", content: [{ type: "text", text: "<user_query> Grok work </user_query>" }] },
		{ type: "assistant", content: "Done." },
	]);

	const shown = await codexReader.show(foreign, { cwd: "/tmp/codex-foreign", home });
	assert.equal(shown.ok, false);
	if (!shown.ok) assert.match(shown.message, /Could not read Codex session/);
});
