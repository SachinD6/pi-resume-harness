import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { encodeCursorProject, slugifyClaude } from "../src/cwd.ts";
import { filterSessions, resolveRef, shouldOpenPicker } from "../src/resolve.ts";
import { tempDir, writeJsonl } from "./helpers.ts";

const CLAUDE = "11111111-1111-4111-8111-111111111111";
const CURSOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function homes(cwd: string) {
	const root = tempDir("pi-resume-resolve-");
	writeJsonl(join(root, "claude", "projects", slugifyClaude(cwd), `${CLAUDE}.jsonl`), [
		{
			type: "user",
			cwd,
			message: { role: "user", content: "Claude work" },
		},
	]);
	writeJsonl(
		join(root, "cursor", "projects", encodeCursorProject(cwd), "agent-transcripts", CURSOR, `${CURSOR}.jsonl`),
		[{ role: "user", message: { content: [{ type: "text", text: "Cursor work" }] } }],
	);
	return root;
}

test("latest resolves per harness home", async () => {
	const cwd = "/tmp/multi";
	const root = homes(cwd);
	const claude = await resolveRef(["claude"], "latest", { cwd, home: join(root, "claude") });
	const cursor = await resolveRef(["cursor"], "latest", { cwd, home: join(root, "cursor") });
	assert.equal(claude.ok, true);
	assert.equal(cursor.ok, true);
	if (claude.ok) {
		assert.equal(claude.session.harness, "claude");
		assert.equal(claude.session.lastUserRequest, "Claude work");
	}
	if (cursor.ok) {
		assert.equal(cursor.session.harness, "cursor");
		assert.equal(cursor.session.lastUserRequest, "Cursor work");
	}
});

test("shouldOpenPicker is false for latest, uuid, and paths", () => {
	assert.equal(shouldOpenPicker("latest", true), false);
	assert.equal(shouldOpenPicker("-c", true), false);
	assert.equal(shouldOpenPicker(CLAUDE, true), false);
	assert.equal(shouldOpenPicker("/tmp/session.jsonl", true), false);
	assert.equal(shouldOpenPicker("", true), true);
	assert.equal(shouldOpenPicker("auth", true), true);
	assert.equal(shouldOpenPicker("auth", false), false);
});

test("filterSessions matches harness, title, and id", () => {
	const sessions = [
		{
			harness: "claude" as const,
			sessionId: CLAUDE,
			title: "Fix auth",
			cwd: "/tmp",
			branch: null,
			updatedAtMs: 2,
			createdAtMs: 1,
			source: "claude-code",
			path: "/tmp/a.jsonl",
		},
		{
			harness: "cursor" as const,
			sessionId: CURSOR,
			title: "Dark mode",
			cwd: "/tmp",
			branch: null,
			updatedAtMs: 3,
			createdAtMs: 1,
			source: "cursor",
			path: "/tmp/b.jsonl",
		},
	];
	assert.equal(filterSessions(sessions, "auth")[0]?.harness, "claude");
	assert.equal(filterSessions(sessions, "cursor")[0]?.harness, "cursor");
	assert.equal(filterSessions(sessions, CLAUDE.slice(0, 8))[0]?.sessionId, CLAUDE);
});

test("foreign latest from $HOME does not pick another project's session", async () => {
	const projectCwd = join(homedir(), "Desktop/Work/foreign-app");
	const root = homes(projectCwd);
	const fromHome = await resolveRef(["claude"], "latest", { cwd: homedir(), home: join(root, "claude") });
	assert.equal(fromHome.ok, false);
	const fromProject = await resolveRef(["claude"], "latest", { cwd: projectCwd, home: join(root, "claude") });
	assert.equal(fromProject.ok, true);
});
