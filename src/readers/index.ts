import type { Harness, SessionReader } from "../types.ts";
import { claudeReader } from "./claude.ts";
import { codexReader } from "./codex.ts";
import { cursorReader } from "./cursor.ts";

export const readers: Record<Harness, SessionReader> = {
	claude: claudeReader,
	cursor: cursorReader,
	codex: codexReader,
};

export { claudeReader, cursorReader, codexReader };
