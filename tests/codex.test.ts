import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { codexReader } from "../src/readers/codex.ts";
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
