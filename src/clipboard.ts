import { spawnSync } from "node:child_process";

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

function spawnClipboard(command: string[], text: string): boolean {
	try {
		const result = spawnSync(command[0], command.slice(1), {
			input: text,
			timeout: 5000,
			stdio: ["pipe", "ignore", "ignore"],
		});
		return !result.error && result.status === 0;
	} catch {
		return false;
	}
}

/** Copy text to the system clipboard. Returns the tool that succeeded. */
export function copyText(
	text: string,
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): ClipboardResult {
	if (!text) return { ok: false };
	for (const command of clipboardCandidates(platform, env)) {
		if (spawnClipboard(command, text)) return { ok: true, tool: command.join(" ") };
	}
	return { ok: false };
}
