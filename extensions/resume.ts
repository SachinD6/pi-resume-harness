import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerResumeCommands } from "../src/command.ts";

export default function (pi: ExtensionAPI) {
	registerResumeCommands(pi);
}
