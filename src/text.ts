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
