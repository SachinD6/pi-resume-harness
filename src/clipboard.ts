import { spawn } from "node:child_process";

export type ClipboardResult = { ok: true; tool: string } | { ok: false };

/**
 * Ordered paste-target commands per platform. The session text is always piped
 * to stdin — never argv — so transcript contents never appear in the process list.
 */
export function clipboardCandidates(
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv = process.env,
): string[][] {
	if (platform === "darwin") return [["pbcopy"]];
	if (platform === "win32") return [["clip"]];
	// Linux and other Unix-likes: Wayland first, then X11, then WSL interop.
	const candidates = [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]];
	if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) candidates.push(["clip.exe"]);
	return candidates;
}

const COPY_DEADLINE_MS = 5000;

/** One clipboard attempt; resolves false on spawn failure, error, or timeout. */
export type ClipboardAttempt = (command: string[], text: string, timeoutMs: number) => Promise<boolean>;

function spawnClipboard(command: string[], text: string, timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const child = spawn(command[0], command.slice(1), {
				timeout: timeoutMs,
				stdio: ["pipe", "ignore", "ignore"],
			});
			child.on("error", () => resolve(false));
			child.on("close", (code) => resolve(code === 0));
			child.stdin.on("error", () => {});
			child.stdin.end(text);
		} catch {
			resolve(false);
		}
	});
}

/**
 * Copy text to the system clipboard. Returns the tool that succeeded. Every
 * candidate shares one deadline: each attempt gets only the time left, so a
 * stalled tool cannot stretch the operation past COPY_DEADLINE_MS.
 */
export async function copyText(
	text: string,
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
	attempt: ClipboardAttempt = spawnClipboard,
): Promise<ClipboardResult> {
	if (!text) return { ok: false };
	const deadline = Date.now() + COPY_DEADLINE_MS;
	for (const command of clipboardCandidates(platform, env)) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) return { ok: false };
		if (await attempt(command, text, remaining)) return { ok: true, tool: command.join(" ") };
	}
	return { ok: false };
}
