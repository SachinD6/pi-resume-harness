import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	ancestorsOf,
	ancestorProjectCwds,
	isBroadRoot,
	isBroadRootFrom,
	projectCwdMatches,
	projectCwdMatchesFrom,
} from "../src/cwd.ts";

test("ancestorProjectCwds stops at $HOME and the filesystem root", () => {
	assert.deepEqual(ancestorProjectCwds(homedir()), []);
	assert.deepEqual(ancestorProjectCwds("/"), []);
	const project = join(homedir(), "Desktop/Work/app");
	assert.deepEqual(ancestorProjectCwds(project), [join(homedir(), "Desktop/Work"), join(homedir(), "Desktop")]);
	assert.ok(!ancestorProjectCwds(project).includes(homedir()));
	assert.ok(!ancestorProjectCwds(project).includes("/"));
});

test("isBroadRoot treats $HOME and / as broad", () => {
	assert.equal(isBroadRoot(homedir()), true);
	assert.equal(isBroadRoot("/"), true);
	assert.equal(isBroadRoot(join(homedir(), "Desktop")), false);
});

test("projectCwdMatches does not treat $HOME as every child project", () => {
	const project = join(homedir(), "Desktop/Work/app");
	assert.equal(projectCwdMatches(project, project), true);
	assert.equal(projectCwdMatches(project, homedir()), false);
	assert.equal(projectCwdMatches(homedir(), project), false);
	assert.equal(projectCwdMatches(join(project, "src"), project), true);
});

test("Windows ancestors stop at the user home and drive root", () => {
	assert.deepEqual(ancestorsOf("C:\\Users\\me", "C:\\Users\\me"), []);
	assert.deepEqual(ancestorsOf("C:\\", "C:\\Users\\me"), []);
	assert.deepEqual(ancestorsOf("C:\\Users\\me\\proj\\src", "C:\\Users\\me"), ["C:\\Users\\me\\proj"]);
	assert.equal(isBroadRootFrom("C:\\", "C:\\Users\\me"), true);
	assert.equal(isBroadRootFrom("C:\\Users\\me", "C:\\Users\\me"), true);
	assert.equal(projectCwdMatchesFrom("C:\\Users\\me\\proj", "C:\\Users\\me", "C:\\Users\\me"), false);
	assert.equal(projectCwdMatchesFrom("C:\\Users\\me\\proj\\src", "C:\\Users\\me\\proj", "C:\\Users\\me"), true);
});
