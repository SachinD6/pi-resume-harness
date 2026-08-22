import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { slugifyClaude } from "../src/cwd.ts";
import { claudeReader } from "../src/readers/claude.ts";
import { tempDir, writeJsonl } from "./helpers.ts";

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

function claudeHome(cwd: string) {
	const home = tempDir("pi-resume-claude-");
	const slug = slugifyClaude(cwd);
	const file = join(home, "projects", slug, `${SESSION_A}.jsonl`);
	writeJsonl(file, [
		{ type: "custom-title", customTitle: "Fix auth redirect" },
		{
			type: "user",
			uuid: "u1",
			timestamp: "2026-08-01T10:00:00.000Z",
			cwd,
			gitBranch: "feat/auth",
			message: { role: "user", content: [{ type: "text", text: "Fix the login redirect" }] },
		},
		{
			type: "assistant",
			uuid: "a1",
			timestamp: "2026-08-01T10:00:05.000Z",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "I'll inspect src/auth.ts." },
					{ type: "tool_use", id: "t1", name: "Read", input: { path: "src/auth.ts" } },
				],
			},
		},
		{
			type: "user",
			uuid: "u2",
			timestamp: "2026-08-01T10:00:06.000Z",
			message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "export function login() {}" }] },
		},
	]);
	writeJsonl(join(home, "projects", slug, `${SESSION_B}.jsonl`), [
		{
			type: "user",
			timestamp: "2026-08-02T10:00:00.000Z",
			cwd,
			message: { role: "user", content: "Add rate limiting" },
		},
		{
			type: "assistant",
			timestamp: "2026-08-02T10:00:01.000Z",
			message: { role: "assistant", content: [{ type: "text", text: "Added a limiter." }] },
		},
	]);
	writeJsonl(join(home, "projects", slugifyClaude("/tmp/other-app"), `${OTHER}.jsonl`), [
		{
			type: "user",
			cwd: "/tmp/other-app",
			message: { role: "user", content: "Unrelated session" },
		},
	]);
	return home;
}

test("claude list is scoped to cwd and newest first", async () => {
	const cwd = "/tmp/demo-app";
	const home = claudeHome(cwd);
	const listed = await claudeReader.list({ cwd, home });
	assert.equal(listed.length, 2);
	assert.equal(listed[0].sessionId, SESSION_B);
	assert.equal(listed[1].title, "Fix auth redirect");
	assert.ok(!listed.some((session) => session.sessionId === OTHER));
});

test("claude latest and id and title resolve", async () => {
	const cwd = "/tmp/demo-app";
	const home = claudeHome(cwd);
	const latest = await claudeReader.show("latest", { cwd, home });
	assert.equal(latest.ok, true);
	if (latest.ok) {
		assert.equal(latest.session.sessionId, SESSION_B);
		assert.equal(latest.session.lastUserRequest, "Add rate limiting");
	}
	const byId = await claudeReader.show(SESSION_A, { cwd, home });
	assert.equal(byId.ok, true);
	if (byId.ok) {
		assert.equal(byId.session.branch, "feat/auth");
		assert.equal(byId.session.turns[0].text, "Fix the login redirect");
		assert.equal(byId.session.turns[1].toolCalls?.[0].name, "Read");
		assert.equal(byId.session.turns[1].toolCalls?.[0].inert, true);
	}
	const byTitle = await claudeReader.show("auth", { cwd, home });
	assert.equal(byTitle.ok, true);
	if (byTitle.ok) assert.equal(byTitle.session.sessionId, SESSION_A);
});

test("claude skips sidechain and meta records", async () => {
	const cwd = "/tmp/sidechain";
	const home = tempDir("pi-resume-claude-side-");
	const id = "44444444-4444-4444-8444-444444444444";
	writeJsonl(join(home, "projects", slugifyClaude(cwd), `${id}.jsonl`), [
		{
			type: "user",
			isMeta: true,
			message: { role: "user", content: "hidden meta" },
		},
		{
			type: "assistant",
			isSidechain: true,
			message: { role: "assistant", content: "subagent chatter" },
		},
		{
			type: "user",
			cwd,
			message: { role: "user", content: "Real prompt" },
		},
	]);
	const shown = await claudeReader.show("latest", { cwd, home });
	assert.equal(shown.ok, true);
	if (shown.ok) {
		assert.equal(shown.session.turns.length, 1);
		assert.equal(shown.session.turns[0].text, "Real prompt");
	}
});

test("claude list from $HOME does not swallow every project", async () => {
	const projectCwd = join(homedir(), "Desktop/Work/demo-app");
	const home = tempDir("pi-resume-claude-home-");
	const id = "55555555-5555-4555-8555-555555555555";
	writeJsonl(join(home, "projects", slugifyClaude(projectCwd), `${id}.jsonl`), [
		{
			type: "user",
			cwd: projectCwd,
			message: {
				role: "user",
				content: [
					{
						type: "text",
						text: "<user_query>\nfix the login redirect\n</user_query>",
					},
				],
			},
		},
	]);
	const fromHome = await claudeReader.list({ cwd: homedir(), home });
	assert.equal(fromHome.length, 0);
	const fromProject = await claudeReader.show("latest", { cwd: projectCwd, home });
	assert.equal(fromProject.ok, true);
	if (fromProject.ok) {
		assert.equal(fromProject.session.cwd, projectCwd);
		assert.equal(fromProject.session.lastUserRequest, "fix the login redirect");
		assert.equal(fromProject.session.title, "fix the login redirect");
	}
});

test("claude unwraps slash-command XML into the title", async () => {
	const cwd = "/tmp/slash-app";
	const home = tempDir("pi-resume-claude-slash-");
	const id = "66666666-6666-4666-8666-666666666666";
	writeJsonl(join(home, "projects", slugifyClaude(cwd), `${id}.jsonl`), [
		{
			type: "user",
			cwd,
			message: {
				role: "user",
				content: "<command-name>review</command-name>\n<command-args>the auth module</command-args>",
			},
		},
	]);
	const shown = await claudeReader.show("latest", { cwd, home });
	assert.equal(shown.ok, true);
	if (shown.ok) {
		assert.equal(shown.session.title, "review the auth module");
		assert.equal(shown.session.lastUserRequest, "review the auth module");
	}
});

test("claude rejects foreign jsonl transcripts given by path", async () => {
	const home = tempDir("pi-resume-claude-");
	const foreign = join(home, "chat_history.jsonl");
	writeJsonl(foreign, [
		{ type: "user", content: [{ type: "text", text: "<user_query> Grok work </user_query>" }] },
		{ type: "assistant", content: "Done." },
	]);

	const shown = await claudeReader.show(foreign, { cwd: "/tmp/claude-foreign", home });
	assert.equal(shown.ok, false);
	if (!shown.ok) assert.match(shown.message, /Could not read Claude session/);
});
