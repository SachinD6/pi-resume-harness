const USER_QUERY_RE = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/gi;
const BLOCKED_ENV_WRAPPER =
	/^<(timestamp|environment_context|user_instructions|system[-_]reminder|manually_attached_skills|user_info|git_status)\b/i;

/** Pull the visible user prompt out of Cursor/Claude XML wrappers. */
export function visibleUserText(text: string): string | null {
	const queries = [...text.matchAll(USER_QUERY_RE)].map((match) => match[1].trim()).filter(Boolean);
	if (queries.length) return queries.join("\n");
	const command = text.match(/<command-name>\s*([^<]+?)\s*<\/command-name>/i);
	if (command) {
		const args = text.match(/<command-args>\s*([^<]*?)\s*<\/command-args>/i);
		const name = command[1].trim();
		const argText = args?.[1]?.trim();
		return argText ? `${name} ${argText}` : name;
	}
	const stripped = text.trimStart();
	if (BLOCKED_ENV_WRAPPER.test(stripped)) return null;
	if (/^\s*\[Request interrupted by user/i.test(stripped)) return null;
	const cleaned = text.replace(/<\/?timestamp[^>]*>/gi, "").trim();
	return cleaned || null;
}

export function oneLine(value: unknown, limit: number): string {
	const text = String(value ?? "")
		.replace(/\s+/g, " ")
		.trim();
	if (limit < 1) return "";
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}...`;
}

export function clip(value: unknown, limit: number): string {
	const text = String(value ?? "");
	if (limit < 1) return "";
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}...`;
}

export function jsonPreview(value: unknown, limit: number): string {
	if (typeof value === "string") return oneLine(value, limit);
	try {
		return oneLine(JSON.stringify(value), limit);
	} catch {
		return oneLine(String(value), limit);
	}
}

export function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((item) => {
				if (typeof item === "string") return item;
				if (!item || typeof item !== "object") return "";
				const block = item as Record<string, unknown>;
				if (typeof block.text === "string") return block.text;
				if (typeof block.content === "string") return block.content;
				return "";
			})
			.filter(Boolean)
			.join("\n");
	}
	if (content && typeof content === "object" && "text" in content) {
		const text = (content as { text?: unknown }).text;
		return typeof text === "string" ? text : "";
	}
	return "";
}

export function blocks(content: unknown): Record<string, unknown>[] {
	if (typeof content === "string") return [{ type: "text", text: content }];
	if (Array.isArray(content)) {
		return content.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
	}
	if (content && typeof content === "object") return [content as Record<string, unknown>];
	return [];
}
