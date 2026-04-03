import {
	type ParsedCfi,
	type ParsedCfiPart,
	type ParsedCfiRange,
	type ParsedCfiSegment,
	fake,
	fromRange as cfiFromRange,
	joinIndir,
	parse as parseCfi,
	toRange as cfiToRange,
} from "./vendor/epubcfi";

// This wrapper keeps legacy EPUB CFI handling stable while using a vendored
// copy of the standalone EPUB CFI utilities adapted from foliate-js (MIT).

function isRangeCfi(parsed: ParsedCfi): parsed is ParsedCfiRange {
	return !Array.isArray(parsed);
}

function normalizeBase(base?: string): string | null {
	const trimmed = base?.trim();
	if (!trimmed) {
		return null;
	}
	return trimmed.replace(/!+$/, "");
}

function wrapCfi(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new Error("Legacy EPUB CFI 不能为空");
	}
	return trimmed.startsWith("epubcfi(") ? trimmed : `epubcfi(${trimmed})`;
}

function getLocalDocumentParsed(parsed: ParsedCfi): ParsedCfi {
	if (isRangeCfi(parsed)) {
		const localParent = parsed.parent.at(-1);
		if (!localParent) {
			throw new Error("Legacy EPUB CFI 缺少内容文档路径，无法恢复选区");
		}
		return {
			parent: [localParent],
			start: parsed.start,
			end: parsed.end,
		};
	}

	const localSegment = parsed.at(-1);
	if (!localSegment) {
		throw new Error("Legacy EPUB CFI 缺少内容文档路径，无法恢复选区");
	}
	return [localSegment];
}

function getPackageSpinePart(parsed: ParsedCfi): ParsedCfiPart | null {
	const packageSegment = isRangeCfi(parsed) ? parsed.parent[0] : parsed[0];
	if (!packageSegment?.length) {
		return null;
	}
	return packageSegment.at(-1) || null;
}

function getSpineIndex(spinePart: ParsedCfiPart | null): number | undefined {
	if (!spinePart || !Number.isFinite(spinePart.index)) {
		return undefined;
	}
	const index = fake.toIndex([spinePart] as ParsedCfiSegment);
	return Number.isInteger(index) ? index : undefined;
}

export class EpubCFI {
	private readonly value: string;

	constructor(input: string | Range, base?: string) {
		if (typeof input === "string") {
			this.value = wrapCfi(input);
			return;
		}

		const localCfi = cfiFromRange(input);
		const normalizedBase = normalizeBase(base);
		this.value = normalizedBase ? joinIndir(normalizedBase, localCfi) : localCfi;
	}

	toString(): string {
		return this.value;
	}

	toRange(doc: Document): Range {
		return cfiToRange(doc, getLocalDocumentParsed(parseCfi(this.value)));
	}

	get spinePos(): number | undefined {
		return getSpineIndex(getPackageSpinePart(parseCfi(this.value)));
	}
}
