export const HARNESSES = ["claude", "cursor", "codex", "grok"] as const;

export type Harness = (typeof HARNESSES)[number];

export type Warning = {
	code: string;
	message: string;
};

export type ToolCall = {
	id?: string;
	name: string;
	input: string;
	inert: true;
};

export type ToolResult = {
	toolUseId?: string;
	content: string;
	isError?: boolean;
	inert: true;
};

export type Turn = {
	role: "user" | "assistant" | "tool";
	text: string;
	toolCalls?: ToolCall[];
	toolResults?: ToolResult[];
};

export type SessionSummary = {
	harness: Harness;
	sessionId: string;
	title: string | null;
	cwd: string | null;
	branch: string | null;
	updatedAtMs: number | null;
	createdAtMs: number | null;
	source: string;
	path: string;
};

export type SessionShow = SessionSummary & {
	turns: Turn[];
	lastUserRequest: string | null;
	lastAssistantAction: string | null;
	warnings: Warning[];
};

export type ReaderOptions = {
	cwd: string;
	home?: string;
	nowMs?: number;
	maxTextChars?: number;
	maxToolChars?: number;
	maxTurns?: number;
};

export interface SessionReader {
	harness: Harness;
	label: string;
	list(options: ReaderOptions): Promise<SessionSummary[]>;
	show(ref: string, options: ReaderOptions): Promise<ShowResult>;
}

export type ShowOk = { ok: true; session: SessionShow };
export type ShowErr = { ok: false; message: string; matches?: SessionSummary[] };
export type ShowResult = ShowOk | ShowErr;

export const DEFAULT_MAX_TEXT_CHARS = 2000;
export const DEFAULT_MAX_TOOL_CHARS = 400;
export const DEFAULT_MAX_TURNS = 60;

export const UUID_RE =
	/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const LATEST_RE = /^(--continue|continue|-c|latest)$/i;
