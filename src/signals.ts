import type { SessionShow, Turn, Warning } from "./types.ts";
import { oneLine } from "./text.ts";

export function lastOfRole(turns: Turn[], role: Turn["role"]): string | null {
	for (let i = turns.length - 1; i >= 0; i--) {
		const turn = turns[i];
		if (turn.role !== role) continue;
		if (turn.text.trim()) return oneLine(turn.text, 240);
		if (turn.toolCalls?.length) {
			return oneLine(turn.toolCalls.map((call) => call.name).join(", "), 240);
		}
	}
	return null;
}

export function titleFromTurns(turns: Turn[]): string | null {
	const lastUser = lastOfRole(turns, "user");
	return lastUser ? oneLine(lastUser, 80) : null;
}

export function withSignals<T extends { turns: Turn[]; warnings: Warning[] }>(
	session: T,
): T & { lastUserRequest: string | null; lastAssistantAction: string | null } {
	return {
		...session,
		lastUserRequest: lastOfRole(session.turns, "user"),
		lastAssistantAction: lastOfRole(session.turns, "assistant"),
	};
}

export function boundTurns(turns: Turn[], maxTurns: number): { turns: Turn[]; truncated: boolean } {
	if (turns.length <= maxTurns) return { turns, truncated: false };
	return { turns: turns.slice(-maxTurns), truncated: true };
}

export function asShow(
	session: Omit<SessionShow, "lastUserRequest" | "lastAssistantAction" | "warnings" | "turns"> & {
		turns: Turn[];
		warnings?: Warning[];
	},
): SessionShow {
	return withSignals({
		...session,
		warnings: session.warnings ?? [],
	});
}
