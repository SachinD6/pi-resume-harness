import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { clipboardCandidates, copyText, type ClipboardAttempt } from "../src/clipboard.ts";

test("clipboard candidates per platform", () => {
	assert.deepEqual(clipboardCandidates("darwin"), [["pbcopy"]]);
	assert.deepEqual(clipboardCandidates("win32"), [["clip"]]);
	assert.deepEqual(clipboardCandidates("linux", {}), [
		["wl-copy"],
		["xclip", "-selection", "clipboard"],
		["xsel", "--clipboard", "--input"],
	]);
});

test("WSL environments append clip.exe as a fallback", () => {
	assert.deepEqual(clipboardCandidates("linux", { WSL_DISTRO_NAME: "Ubuntu" }), [
		["wl-copy"],
		["xclip", "-selection", "clipboard"],
		["xsel", "--clipboard", "--input"],
		["clip.exe"],
	]);
	assert.deepEqual(clipboardCandidates("linux", { WSL_INTEROP: "/run/WSL" }).at(-1), ["clip.exe"]);
});

test("every failing candidate is attempted within one five-second budget", async () => {
	const budgets: number[] = [];
	const failFast: ClipboardAttempt = (_command, _text, timeoutMs) => {
		budgets.push(timeoutMs);
		return Promise.resolve(false);
	};

	const result = await copyText("handoff", "linux", { WSL_DISTRO_NAME: "Ubuntu" }, failFast);

	assert.equal(result.ok, false);
	assert.equal(budgets.length, 4, "all four candidates get one attempt");
	assert.equal(budgets[0], 5000);
	assert.ok(budgets.every((budget) => budget > 0 && budget <= 5000));
});

test("a stalled candidate consumes the shared deadline and skips later candidates", async () => {
	mock.timers.enable({ now: 0 });
	try {
		let attempts = 0;
		const stalled: ClipboardAttempt = (_command, _text, timeoutMs) =>
			new Promise((resolve) => {
				attempts += 1;
				setTimeout(() => resolve(false), timeoutMs);
			});

		const pending = copyText("handoff", "linux", { WSL_DISTRO_NAME: "Ubuntu" }, stalled);
		mock.timers.tick(5000);
		const result = await pending;

		assert.equal(result.ok, false);
		assert.equal(attempts, 1, "the first stall ate the whole five-second deadline");
	} finally {
		mock.timers.reset();
	}
});
