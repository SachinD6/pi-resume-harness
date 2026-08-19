import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { buildHandoffPrompt } from "./handoff.ts";
import { pickSession, renderSessionList } from "./picker.ts";
import { readers } from "./readers/index.ts";
import { listHarnesses, resolveRef, shouldOpenPicker, showFromSummary } from "./resolve.ts";
import type { Harness, SessionShow, SessionSummary } from "./types.ts";

const COMPLETIONS = ["latest", "continue", "-c"];

function statusKey(harnesses: Harness[]): string {
	return harnesses.length === 1 ? `resume-${harnesses[0]}` : "resume-foreign";
}

function pickerTitle(harnesses: Harness[]): string {
	if (harnesses.length === 1) return `Resume ${readers[harnesses[0]].label} session`;
	return "Resume foreign session";
}

function notifyNoSelection(ctx: ExtensionCommandContext, candidates: SessionSummary[]): void {
	if (!ctx.hasUI && candidates.length > 1) {
		ctx.ui.notify(renderSessionList(candidates, ctx.cwd), "info");
		return;
	}
	ctx.ui.notify("Cancelled", "info");
}

async function pickAndShow(
	ctx: ExtensionCommandContext,
	candidates: SessionSummary[],
	title: string,
	initialFilter: string,
	options: { cwd: string },
): Promise<SessionShow | undefined> {
	const picked = await pickSession(ctx, candidates, title, initialFilter);
	if (!picked) {
		notifyNoSelection(ctx, candidates);
		return undefined;
	}
	const shown = await showFromSummary(picked, options);
	if (!shown.ok) {
		ctx.ui.notify(shown.message, "error");
		return undefined;
	}
	return shown.session;
}

export async function resumeHarness(
	args: string,
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	harnesses: Harness[],
): Promise<void> {
	const options = { cwd: ctx.cwd };
	const ref = args.trim();
	const usePicker = shouldOpenPicker(ref, Boolean(ctx.hasUI && ctx.mode === "tui"));

	let session: SessionShow | undefined;

	if (usePicker) {
		const listed = await listHarnesses(harnesses, options);
		if (listed.length === 0) {
			const names = harnesses.map((harness) => readers[harness].label).join(", ");
			ctx.ui.notify(`No ${names} sessions found for ${ctx.cwd}`, "warning");
			return;
		}
		session = await pickAndShow(ctx, listed, pickerTitle(harnesses), ref, options);
		if (!session) return;
	} else {
		const shown = await resolveRef(harnesses, ref, options);
		if (shown.ok) {
			session = shown.session;
		} else if (shown.matches?.length) {
			session = await pickAndShow(ctx, shown.matches, shown.message, ref, options);
			if (!session) return;
		} else {
			ctx.ui.notify(shown.message, "error");
			return;
		}
	}

	const prompt = buildHandoffPrompt(session);
	const label = session.title || session.sessionId;

	if (!ctx.isIdle()) {
		pi.sendUserMessage(prompt, { deliverAs: "followUp" });
		ctx.ui.notify(`Queued ${session.harness} resume: ${label}`, "info");
		return;
	}

	pi.sendUserMessage(prompt);
	ctx.ui.notify(`Resuming ${session.harness} session: ${label}`, "info");
}

export function registerResumeCommands(pi: ExtensionAPI): void {
	const register = (name: string, description: string, harnesses: Harness[]) => {
		pi.registerCommand(name, {
			description,
			getArgumentCompletions: (prefix: string) => {
				const items = COMPLETIONS.filter((value) => value.startsWith(prefix)).map((value) => ({
					value,
					label: value,
				}));
				return items.length > 0 ? items : null;
			},
			handler: async (args, ctx) => {
				const key = statusKey(harnesses);
				ctx.ui.setStatus(key, "Reading foreign sessions…");
				try {
					await resumeHarness(args, ctx, pi, harnesses);
				} finally {
					ctx.ui.setStatus(key, undefined);
				}
			},
		});
	};

	register("resume-claude", "Continue from a Claude Code session", ["claude"]);
	register("resume-cursor", "Continue from a Cursor session", ["cursor"]);
	register("resume-codex", "Continue from a Codex session", ["codex"]);
	register("resume-foreign", "Continue from a Claude, Cursor, or Codex session", ["claude", "cursor", "codex"]);
}
