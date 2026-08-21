import type { Harness, SessionReader } from "../types.ts";
import { claudeReader } from "./claude.ts";
import { codexReader } from "./codex.ts";
import { cursorReader } from "./cursor.ts";
import { grokReader } from "./grok.ts";

export const readers: Record<Harness, SessionReader> = {
	claude: claudeReader,
	cursor: cursorReader,
	codex: codexReader,
	grok: grokReader,
};

export { claudeReader, cursorReader, codexReader, grokReader };
