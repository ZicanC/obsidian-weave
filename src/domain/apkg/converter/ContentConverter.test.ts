import { ContentConverter } from "./ContentConverter";

describe("ContentConverter", () => {
	test("should preserve raw html while rewriting media paths", () => {
		const converter = new ContentConverter();
		const mediaPathMap = new Map<string, string>([
			["word.png", "weave/media/word.png"],
			["audio.mp3", "weave/media/audio.mp3"],
			["clip.mp4", "weave/media/clip.mp4"],
		]);

		const html = [
			'<div class="card-shell"><img class="hero" src="word.png" alt="word"></div>',
			"[sound:audio.mp3]",
			'<video controls src="clip.mp4"></video>',
		].join("\n");

		const result = converter.convertRawHtml(html, mediaPathMap, {
			preserveComplexTables: true,
			convertSimpleTables: true,
			mediaFormat: "wikilink",
			clozeFormat: "==",
			preserveStyles: true,
			preserveCardContentHtml: true,
			tableComplexityThreshold: {
				maxColumns: 10,
				maxRows: 10,
				allowMergedCells: false,
			},
		});

		expect(result).toContain('<img class="hero" src="weave/media/word.png" alt="word">');
		expect(result).toContain('<audio controls preload="metadata" src="weave/media/audio.mp3"></audio>');
		expect(result).toContain('<video controls src="weave/media/clip.mp4"></video>');
		expect(result).toContain('<div class="card-shell">');
	});
});
