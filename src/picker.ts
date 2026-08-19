import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getSelectListTheme, keyHint, rawKeyHint } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter, Input, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { readers } from "./readers/index.ts";
import { filterSessions } from "./resolve.ts";
import type { SessionSummary } from "./types.ts";

const PICKER_MAX_VISIBLE = 10;

export function relativeTime(ms: number | null | undefined, now = Date.now()): string {
	if (!ms) return "?";
	const diff = now - ms;
	if (diff < 0) return "just now";
	const sec = Math.floor(diff / 1000);
	if (sec < 60) return `${sec}s ago`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	return `${Math.floor(hr / 24)}d ago`;
}

export function shortId(id: string): string {
	return id.length > 8 ? id.slice(0, 8) : id;
}

export function cleanTitle(session: SessionSummary): string {
	return (session.title || "(untitled)").replace(/\s+/g, " ").trim();
}

export function formatSessionLabel(session: SessionSummary, now = Date.now()): string {
	const title = cleanTitle(session);
	const clipped = title.length > 64 ? `${title.slice(0, 61)}...` : title;
	const branch = session.branch ? ` · ${session.branch}` : "";
	return `${session.harness} · ${relativeTime(session.updatedAtMs, now)} · ${clipped}${branch} · ${shortId(session.sessionId)}`;
}

export function renderSessionList(sessions: SessionSummary[], cwd: string): string {
	const labels = [...new Set(sessions.map((session) => readers[session.harness].label))];
	const rows = sessions.map(
		(session, index) =>
			`${index + 1}. ${session.harness} · ${relativeTime(session.updatedAtMs)} · ${cleanTitle(session)}\n   ${session.sessionId}`,
	);
	return [
		`${labels.join(" / ")} sessions for ${cwd} (${sessions.length}):`,
		...rows,
		"",
		"Resume one with /resume-foreign <session-id> or /resume-<harness> <session-id>.",
	].join("\n");
}

function searchText(session: SessionSummary): string {
	return `${session.harness} ${cleanTitle(session)} ${session.sessionId}`;
}

export async function pickSession(
	ctx: ExtensionCommandContext,
	sessions: SessionSummary[],
	title: string,
	initialFilter = "",
): Promise<SessionSummary | undefined> {
	if (sessions.length === 0) return undefined;
	if (sessions.length === 1 && !initialFilter) return sessions[0];
	if (!ctx.hasUI) return undefined;

	if (ctx.mode === "tui") {
		const selectedKey = await ctx.ui.custom<string | null>((tui, theme, kb, done) => {
			const input = new Input();
			input.focused = true;
			if (initialFilter) input.handleInput(initialFilter);

			const borderTop = new DynamicBorder((str) => theme.fg("accent", str));
			const borderBottom = new DynamicBorder((str) => theme.fg("accent", str));
			const titleText = new Text(theme.fg("accent", theme.bold(title)), 1, 0);
			const hintText = new Text(
				`${rawKeyHint("↑↓", "navigate")}  ${keyHint("tui.select.confirm", "select")}  ` +
					`${keyHint("tui.select.cancel", "cancel")}  ${rawKeyHint("type", "filter")}`,
				1,
				0,
			);
			const emptyText = new Text("  No matching sessions", 1, 0);

			let selectList: SelectList;
			let noMatches = false;
			const rebuild = () => {
				const query = input.getValue().trim();
				const filtered = query ? fuzzyFilter(sessions, query, searchText) : sessions;
				noMatches = filtered.length === 0;
				const items: SelectItem[] = filtered.map((session) => ({
					value: session.path,
					label: formatSessionLabel(session),
				}));
				selectList = new SelectList(items, PICKER_MAX_VISIBLE, getSelectListTheme());
				selectList.onSelect = (item) => done(item.value);
				selectList.onCancel = () => done(null);
			};
			rebuild();

			return {
				render: (width) => [
					...borderTop.render(width),
					...titleText.render(width),
					"",
					...input.render(width),
					"",
					...(noMatches ? emptyText.render(width) : selectList.render(width)),
					...hintText.render(width),
					...borderBottom.render(width),
				],
				invalidate: () => {
					input.invalidate();
					selectList.invalidate();
				},
				handleInput: (data) => {
					const listKey =
						kb.matches(data, "tui.select.up") ||
						kb.matches(data, "tui.select.down") ||
						kb.matches(data, "tui.select.pageUp") ||
						kb.matches(data, "tui.select.pageDown") ||
						kb.matches(data, "tui.select.confirm") ||
						kb.matches(data, "tui.select.cancel");
					if (listKey) {
						selectList.handleInput(data);
					} else {
						const before = input.getValue();
						input.handleInput(data);
						if (input.getValue() !== before) rebuild();
					}
					tui.requestRender();
				},
			};
		});
		return selectedKey ? sessions.find((session) => session.path === selectedKey) : undefined;
	}

	let pool = filterSessions(sessions, initialFilter);
	if (pool.length === 0) pool = sessions;
	const labels = pool.map((session) => formatSessionLabel(session));
	const selected = await ctx.ui.select(title, labels);
	if (!selected) return undefined;
	const index = labels.indexOf(selected);
	return index >= 0 ? pool[index] : undefined;
}
