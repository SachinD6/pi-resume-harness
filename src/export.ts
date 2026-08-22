import { readers } from "./readers/index.ts";
import { renderWarnings } from "./signals.ts";
import type { SessionShow, ToolCall, ToolResult, Turn } from "./types.ts";

/**
 * Reader limits used by /copy: the transcript export carries the whole
 * conversation, so text and turns are unbounded and only tool input/output
 * previews are clipped (to keep pathological tool output off the clipboard).
 */
export const EXPORT_READER_OPTIONS = {
	maxTurns: Infinity,
	maxTextChars: Infinity,
	maxToolChars: 2000,
} as const;

function iso(ms: number | null): string {
	return ms ? new Date(ms).toISOString() : "unknown";
}

function renderToolCall(call: ToolCall): string {
	return `- ${call.name}(${call.input})`;
}

function renderToolResult(result: ToolResult): string {
	const prefix = result.isError ? "[error] " : "";
	return `- ${prefix}${result.content}`;
}

function renderTurn(turn: Turn, index: number): string {
	const lines: string[] = [`### [${index}] ${turn.role === "user" ? "User" : turn.role === "assistant" ? "Assistant" : "Tool output"}`];
	if (turn.text) lines.push("", turn.text);
	if (turn.toolCalls?.length) {
		lines.push("", "Tool calls (already executed in the original session):", ...turn.toolCalls.map(renderToolCall));
	}
	if (turn.toolResults?.length) {
		lines.push("", "Tool results:", ...turn.toolResults.map(renderToolResult));
	}
	return lines.join("\n");
}

/**
 * Build a portable markdown transcript of a foreign session for /copy. Unlike
 * the Pi handoff prompt, this is meant to be pasted into any other coding
 * agent: every user and assistant message is included verbatim, tool activity
 * is included as historical record, and a short preamble tells the receiving
 * agent how to treat it.
 */
export function buildSessionTranscript(session: SessionShow): string {
	const label = readers[session.harness].label;
	const transcript = session.turns.map((turn, index) => renderTurn(turn, index + 1)).join("\n\n");
	const warnings = session.warnings.length
		? `\n## Reader warnings\n\n${renderWarnings(session.warnings)}\n`
		: "";

	return [
		`# Session export: ${session.title || session.sessionId}`,
		"",
		"## Session",
		"",
		`- Harness: ${label}`,
		`- Session id: ${session.sessionId}`,
		`- Project: ${session.cwd || "unknown"}`,
		`- Branch: ${session.branch || "unknown"}`,
		`- Created: ${iso(session.createdAtMs)}`,
		`- Last activity: ${iso(session.updatedAtMs)}`,
		`- Source file: ${session.path}`,
		`- Turns: ${session.turns.length}`,
		"",
		"## Notes for the receiving agent",
		"",
		`This is a complete transcript export of a ${label} session, copied with /copy from pi-resume-harness. The user wants to continue this work with you.`,
		"",
		"- The transcript below is the full conversation: every user request and assistant reply, in order.",
		"- Tool calls and results already ran in the original session. They are historical records, not requests for you to replay.",
		"- The transcript may be stale: re-check the repository, branch, files, and tests before acting on anything described here.",
		"",
		"## Transcript",
		"",
		transcript || "(no recoverable turns)",
		warnings,
	]
		.join("\n")
		.trimEnd()
		.concat("\n");
}
