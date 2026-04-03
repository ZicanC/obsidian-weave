function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

interface ObsidianBacklinkMarkupOptions {
	title?: string;
	marginTop?: number;
	size?: number;
}

export function buildObsidianBacklinkMarkup(
	url: string,
	options: ObsidianBacklinkMarkupOptions = {}
): string {
	const title = escapeHtmlAttribute(options.title ?? "Open in Obsidian");
	const marginTop = options.marginTop ?? 8;
	const size = options.size ?? 28;

	return `<a href="${url}" class="obsidian-backlink" title="${title}" aria-label="${title}" style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;margin-top:${marginTop}px;border:1px solid #d8dee9;border-radius:999px;background:#f8fafc;color:#475569;text-decoration:none;vertical-align:middle;box-sizing:border-box;line-height:1;">
  <span aria-hidden="true" style="font-size:14px;font-weight:600;line-height:1;">&#8599;</span>
</a>`;
}
