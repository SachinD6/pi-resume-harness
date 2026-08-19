import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { encodeCursorProject } from "../src/cwd.ts";
import { cursorReader } from "../src/readers/cursor.ts";
import { cursorUserText } from "../src/text.ts";
import { tempDir, writeJson, writeJsonl } from "./helpers.ts";

const SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OLDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("cursor list reads agent transcripts for the encoded cwd", async () => {
	const cwd = "/tmp/cursor-app";
	const home = tempDir("pi-resume-cursor-");
	const project = join(home, "projects", encodeCursorProject(cwd));
	writeJsonl(join(project, "agent-transcripts", SESSION, `${SESSION}.jsonl`), [
		{ role: "user", message: { content: [{ type: "text", text: "Add dark mode" }] } },
		{ role: "assistant", message: { content: [{ type: "text", text: "I'll add a theme toggle." }] } },
		{ type: "turn_ended", status: "ok" },
	]);
	writeJsonl(join(project, "agent-transcripts", OLDER, `${OLDER}.jsonl`), [
		{ role: "user", message: { content: [{ type: "text", text: "Older chat" }] } },
	]);
	writeJsonl(
		join(home, "projects", encodeCursorProject("/tmp/other"), "agent-transcripts", OTHER, `${OTHER}.jsonl`),
		[{ role: "user", message: { content: [{ type: "text", text: "Wrong project" }] } }],
	);

	const listed = await cursorReader.list({ cwd, home });
	assert.equal(listed.length, 2);
	assert.ok(listed.every((session) => session.sessionId !== OTHER));
	const latest = await cursorReader.show("latest", { cwd, home });
	assert.equal(latest.ok, true);
	if (latest.ok) {
		assert.ok(["Add dark mode", "Older chat"].includes(latest.session.lastUserRequest ?? ""));
		assert.equal(latest.session.turns.some((turn) => turn.role === "user"), true);
	}
	const byTitle = await cursorReader.show("dark", { cwd, home });
	assert.equal(byTitle.ok, true);
	if (byTitle.ok) assert.equal(byTitle.session.sessionId, SESSION);
});

test("cursor does not treat hyphenated folder names as decoded paths", async () => {
	const cwd = "/tmp/bfc-global-frontend";
	const home = tempDir("pi-resume-cursor-hyphen-");
	writeJsonl(
		join(home, "projects", encodeCursorProject(cwd), "agent-transcripts", SESSION, `${SESSION}.jsonl`),
		[{ role: "user", message: { content: [{ type: "text", text: "Hyphen path works" }] } }],
	);
	writeJsonl(
		join(home, "projects", "tmp-bfc", "agent-transcripts", OTHER, `${OTHER}.jsonl`),
		[{ role: "user", message: { content: [{ type: "text", text: "False decode" }] } }],
	);
	const listed = await cursorReader.list({ cwd, home });
	assert.equal(listed.length, 1);
	assert.equal(listed[0].sessionId, SESSION);
});

test("cursor cli chats use metadata cwd", async () => {
	const cwd = "/tmp/cli-app";
	const home = tempDir("pi-resume-cursor-cli-");
	const dir = join(home, "chats", "abcd", SESSION);
	writeJson(join(dir, "metadata.json"), { cwd, title: "CLI chat", git_branch: "main" });
	writeJsonl(join(dir, "transcripts", "chat.jsonl"), [
		{ type: "message", role: "user", content: "From the CLI" },
		{ type: "message", role: "assistant", content: "Continuing." },
	]);
	writeJson(join(home, "chats", "abcd", OTHER, "metadata.json"), { cwd: "/tmp/elsewhere", title: "Nope" });
	const listed = await cursorReader.list({ cwd, home });
	assert.equal(listed.length, 1);
	assert.equal(listed[0].title, "CLI chat");
	assert.equal(listed[0].source, "cursor-cli-chat");
});

test("cursorUserText unwraps Desktop user_query wrappers", () => {
	assert.equal(
		cursorUserText(
			"<timestamp>Wednesday, Aug 19, 2026, 11:23 PM (UTC+5:30)</timestamp>\n<user_query>\nhey\n</user_query>",
		),
		"hey",
	);
	assert.equal(cursorUserText("<timestamp>now</timestamp>"), null);
	assert.equal(cursorUserText("Add dark mode"), "Add dark mode");
});

test("cursor list from $HOME does not swallow every project", async () => {
	const home = tempDir("pi-resume-cursor-home-");
	const projectCwd = "/tmp/bfc-global-frontend";
	writeJsonl(
		join(
			home,
			"projects",
			encodeCursorProject(projectCwd),
			"agent-transcripts",
			SESSION,
			`${SESSION}.jsonl`,
		),
		[
			{
				role: "user",
				message: {
					content: [
						{
							type: "text",
							text: "<timestamp>Wednesday, Aug 19, 2026, 11:23 PM (UTC+5:30)</timestamp>\n<user_query>\nhey\n</user_query>",
						},
					],
				},
			},
			{ role: "assistant", message: { content: [{ type: "text", text: "What do you want to work on?" }] } },
		],
	);

	const fromHome = await cursorReader.list({ cwd: homedir(), home });
	assert.equal(fromHome.length, 0);

	const fromProject = await cursorReader.list({ cwd: projectCwd, home });
	assert.equal(fromProject.length, 1);
	assert.equal(fromProject[0].cwd, projectCwd);
	assert.equal(fromProject[0].title, "hey");
	assert.equal(fromProject[0].lastUserRequest, "hey");
});
