import assert from "node:assert/strict";
import { test } from "node:test";
import { clipboardCandidates } from "../src/clipboard.ts";

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
