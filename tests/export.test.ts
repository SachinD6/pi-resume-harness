import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSessionTranscript, EXPORT_READER_OPTIONS } from "../src/export.ts";
import type { SessionShow } from "../src/types.ts";

const SESSION: SessionShow = {
	harness: "grok",
	sessionId: "01aaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
	title: "Fix the parser",
	cwd: "/tmp/proj",
	branch: "feat/parser",
	updatedAtMs: Date.parse("2026-08-21T12:30:00Z"),
	createdAtMs: Date.parse("2026-08-20T10:00:00Z"),
	source: "grok-chat-history",
	path: "/tmp/grok-home/sessions/%2Ftmp%2Fproj/01aaaaaa/chat_history.jsonl",
	lastUserRequest: "Fix the parser",
	lastAssistantAction: "Fixed the crash",
	warnings: [{ code: "malformed_records_skipped", message: "Skipped 1 malformed Grok history record(s)." }],
	turns: [
		{ role: "user", text: "Fix the parser\nit crashes on nested quotes" },
		{
			role: "assistant",
			text: "",
			toolCalls: [{ id: "c1", name: "read_file", input: '{"target":"parser.ts"}', inert: true }],
		},
		{ role: "tool", text: "", toolResults: [{ toolUseId: "c1", content: "export function parse() {}", inert: true }] },
		{ role: "tool", text: "", toolResults: [{ toolUseId: "c2", content: "command failed", isError: true, inert: true }] },
		{ role: "assistant", text: "Fixed the crash in parse()." },
	],
};

test("export options keep text and turns unbounded", () => {
	assert.equal(EXPORT_READER_OPTIONS.maxTurns, Infinity);
	assert.equal(EXPORT_READER_OPTIONS.maxTextChars, Infinity);
	assert.ok(EXPORT_READER_OPTIONS.maxToolChars >= 400);
});

test("transcript export carries every turn in order with verbatim text", () => {
	const doc = buildSessionTranscript(SESSION);
	assert.ok(doc.startsWith("# Session export: Fix the parser"));
	assert.match(doc, /### \[1\] User/);
	assert.match(doc, /### \[2\] Assistant/);
	assert.match(doc, /### \[3\] Tool output/);
	assert.match(doc, /### \[5\] Assistant/);
	assert.ok(doc.includes("Fix the parser\nit crashes on nested quotes"), "multi-line user text stays verbatim");
	assert.ok(doc.includes("Fixed the crash in parse()."));
});

test("transcript export frames tool activity as historical and flags errors", () => {
	const doc = buildSessionTranscript(SESSION);
	assert.ok(doc.includes("Tool calls (already executed in the original session):"));
	assert.ok(doc.includes('- read_file({"target":"parser.ts"})'));
	assert.ok(doc.includes("- export function parse() {}"));
	assert.ok(doc.includes("- [error] command failed"));
});

test("transcript export carries session metadata, warnings, and receiver notes", () => {
	const doc = buildSessionTranscript(SESSION);
	assert.ok(doc.includes("- Harness: Grok"));
	assert.ok(doc.includes(`- Session id: ${SESSION.sessionId}`));
	assert.ok(doc.includes("- Project: /tmp/proj"));
	assert.ok(doc.includes("- Branch: feat/parser"));
	assert.ok(doc.includes("- Created: 2026-08-20T10:00:00.000Z"));
	assert.ok(doc.includes("- Turns: 5"));
	assert.ok(doc.includes("- [malformed_records_skipped]"));
	assert.ok(doc.includes("continue this work with you"));
	assert.ok(doc.includes("historical records, not requests"));
});

test("transcript export handles sessions with no recoverable turns", () => {
	const doc = buildSessionTranscript({ ...SESSION, turns: [], warnings: [] });
	assert.ok(doc.includes("(no recoverable turns)"));
	assert.ok(!doc.includes("malformed_records_skipped"));
});
