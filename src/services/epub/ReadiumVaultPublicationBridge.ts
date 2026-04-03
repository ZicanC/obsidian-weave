import {
	type Fetcher,
	Link,
	Locator,
	LocatorLocations,
	LocatorText,
	Manifest,
	NumberRange,
	Publication,
	Resource,
} from "@readium/shared";
import JSZip from "jszip";
import { type App, TFile } from "obsidian";
import { logger } from "../../utils/logger";
import { normalizeVaultBinaryData } from "./EpubBinaryData";
import { EpubCFI } from "./legacy-epub-cfi";
import {
	ensureReadiumBootstrapThemeStyle,
	markReadiumThemeDocument,
	normalizeReadiumThemeInlineStyles,
} from "./readiumThemeSupport";
import type { TocItem } from "./types";

type ParsedManifestItem = {
	id: string;
	href: string;
	mediaType: string;
	properties: string[];
	fallback?: string;
};

type SpineItem = {
	idref: string;
	linear: boolean;
};

type SectionDescriptor = {
	index: number;
	id: string;
	href: string;
	mediaType: string;
	properties: string[];
	title: string;
	linear: boolean;
	textLength: number;
	positionCount: number;
};

type TextQuote = {
	highlight?: string;
	before?: string;
	after?: string;
};

type TextNodeSegment = {
	node: Text;
	start: number;
	end: number;
	text: string;
};

type TocLinkJson = {
	href: string;
	title: string;
	type?: string;
	children?: TocLinkJson[];
};

export interface ReadiumLoadedPublication {
	filePath: string;
	fileName: string;
	publication: Publication;
	positions: Locator[];
	tocItems: TocItem[];
	coverImage?: string;
	metadata: {
		title: string;
		author: string;
		publisher?: string;
		language?: string;
		identifier?: string;
		chapterCount: number;
		isFixedLayout: boolean;
	};
}

class MemoryZipResource extends Resource {
	private readonly linkValue: Link;
	private readonly reader: () => Promise<Uint8Array | undefined>;

	constructor(linkValue: Link, reader: () => Promise<Uint8Array | undefined>) {
		super();
		this.linkValue = linkValue;
		this.reader = reader;
	}

	async link(): Promise<Link> {
		return this.linkValue;
	}

	async length(): Promise<number | undefined> {
		const bytes = await this.reader();
		return bytes?.byteLength;
	}

	async read(range?: NumberRange): Promise<Uint8Array | undefined> {
		const bytes = await this.reader();
		if (!bytes) {
			return undefined;
		}
		if (!range) {
			return bytes;
		}
		const start = Math.max(0, range.start);
		const endExclusive = Math.min(bytes.byteLength, range.endInclusive + 1);
		return bytes.slice(start, endExclusive);
	}

	close(): void {
		// no-op
	}
}

class MemoryZipFetcher implements Fetcher {
	private readonly linksValue: Link[];
	private readonly reader: (link: Link) => Promise<Uint8Array | undefined>;

	constructor(linksValue: Link[], reader: (link: Link) => Promise<Uint8Array | undefined>) {
		this.linksValue = linksValue;
		this.reader = reader;
	}

	links(): Link[] {
		return this.linksValue;
	}

	get(link: Link): Resource {
		return new MemoryZipResource(link, () => this.reader(link));
	}

	close(): void {
		// no-op
	}
}

export class ReadiumVaultPublicationBridge {
	private static readonly LOCATOR_PREFIX = "readium:";
	private static readonly COMPACT_LOCATOR_MARKER = "loc";
	private static readonly COMPACT_LOCATOR_SEPARATOR = "~";
	private static readonly CONTEXT_SIZE = 48;
	private static readonly MAX_SEARCH_RESULTS = 120;
	private static readonly POSITION_CHAR_BUCKET = 1800;
	private static readonly TEXT_NODE_TAG_BLACKLIST = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);

	private readonly app: App;
	private archive: JSZip | null = null;
	private archiveEntryLookup = new Map<string, string>();
	private packageDocumentPath = "";
	private manifestById = new Map<string, ParsedManifestItem>();
	private manifestByHref = new Map<string, ParsedManifestItem>();
	private spine: SpineItem[] = [];
	private sections: SectionDescriptor[] = [];
	private tocItems: TocItem[] = [];
	private tocLinks: TocLinkJson[] = [];
	private sectionTitleByHref = new Map<string, string>();
	private rawDocumentCache = new Map<string, Document>();
	private rewrittenHtmlCache = new Map<string, string>();
	private binaryCache = new Map<string, Uint8Array>();
	private rawCssCache = new Map<string, string>();
	private resourceUrlCache = new Map<string, string>();
	private cssUrlCache = new Map<string, string>();
	private publication: Publication | null = null;
	private positions: Locator[] = [];
	private filePath = "";
	private fileName = "";
	private metadata: ReadiumLoadedPublication["metadata"] = {
		title: "",
		author: "",
		chapterCount: 0,
		isFixedLayout: false,
	};

	constructor(app: App) {
		this.app = app;
	}

	private static trimCompactFields(fields: string[]): string[] {
		const trimmed = [...fields];
		while (trimmed.length > 1 && trimmed[trimmed.length - 1] === "") {
			trimmed.pop();
		}
		return trimmed;
	}

	private static encodeCompactField(value?: string): string {
		if (!value) {
			return "";
		}
		const bytes = new TextEncoder().encode(value);
		let binary = "";
		const chunkSize = 0x8000;
		for (let offset = 0; offset < bytes.length; offset += chunkSize) {
			const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
			binary += String.fromCharCode(...chunk);
		}
		return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
	}

	private static decodeCompactField(value?: string): string | undefined {
		if (!value) {
			return undefined;
		}
		try {
			const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
			const paddingLength = (4 - (normalized.length % 4)) % 4;
			const binary = atob(`${normalized}${"=".repeat(paddingLength)}`);
			const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
			return new TextDecoder().decode(bytes);
		} catch (_error) {
			return undefined;
		}
	}

	private static formatCompactProgression(value?: number): string {
		if (typeof value !== "number" || !Number.isFinite(value)) {
			return "";
		}
		return value.toFixed(6).replace(/0+$/g, "").replace(/\.$/, "");
	}

	async extractCoverDataUrlFromFile(filePath: string): Promise<string | null> {
		this.dispose();
		this.filePath = filePath;
		this.fileName = filePath.split("/").pop() || "book.epub";

		const vaultFile = this.app.vault.getAbstractFileByPath(filePath);
		if (!(vaultFile instanceof TFile)) {
			throw new Error(`EPUB 文件不存在：${filePath}`);
		}

		const binary = await this.app.vault.readBinary(vaultFile);
		const normalizedBinary = normalizeVaultBinaryData(binary, filePath);
		this.archive = await JSZip.loadAsync(normalizedBinary);
		this.rebuildArchiveEntryLookup();
		this.packageDocumentPath = await this.findPackageDocumentPath();
		const packageDocument = await this.readXmlDocument(this.packageDocumentPath, "application/xml");
		this.parsePackageDocument(packageDocument);
		return this.extractCoverDataUrlFromPackage(packageDocument);
	}

	async load(filePath: string): Promise<ReadiumLoadedPublication> {
		this.dispose();
		this.filePath = filePath;
		this.fileName = filePath.split("/").pop() || "book.epub";

		const vaultFile = this.app.vault.getAbstractFileByPath(filePath);
		if (!(vaultFile instanceof TFile)) {
			throw new Error(`EPUB 文件不存在：${filePath}`);
		}

		const binary = await this.app.vault.readBinary(vaultFile);
		const normalizedBinary = normalizeVaultBinaryData(binary, filePath);
		this.archive = await JSZip.loadAsync(normalizedBinary);
		this.rebuildArchiveEntryLookup();
		this.packageDocumentPath = await this.findPackageDocumentPath();
		const packageDocument = await this.readXmlDocument(this.packageDocumentPath, "application/xml");
		this.parsePackageDocument(packageDocument);
		await this.buildToc(packageDocument);
		await this.prepareSections();

		const manifestJson = this.buildReadiumManifestJson();
		const manifest = Manifest.deserialize(manifestJson);
		if (!manifest) {
			throw new Error("Readium manifest 生成失败");
		}

		const linkValues = manifest.readingOrder.items
			.concat(manifest.resources?.items || [])
			.concat(manifest.links.items);
		this.publication = new Publication({
			manifest,
			fetcher: new MemoryZipFetcher(linkValues, async (link) => this.readPublicationResource(link)),
		});
		this.positions = this.buildPositions();

		return {
			filePath,
			fileName: this.fileName,
			publication: this.publication,
			positions: this.positions,
			tocItems: this.tocItems,
			coverImage: (await this.extractCoverDataUrlFromPackage(packageDocument)) || undefined,
			metadata: this.metadata,
		};
	}

	getPublication(): Publication {
		if (!this.publication) {
			throw new Error("Readium publication 尚未加载");
		}
		return this.publication;
	}

	getPositions(): Locator[] {
		return this.positions;
	}

	getTocItems(): TocItem[] {
		return this.tocItems;
	}

	getMetadata(): ReadiumLoadedPublication["metadata"] {
		return this.metadata;
	}

	getSectionIndexForHref(href: string): number {
		const normalized = this.normalizeSectionHref(href);
		return this.sections.findIndex((section) => section.href === normalized);
	}

	getSectionHrefByIndex(index: number): string {
		return this.sections[index]?.href || "";
	}

	getSectionTitleByHref(href: string): string {
		const normalized = this.normalizeSectionHref(href);
		return (
			this.sectionTitleByHref.get(normalized) ||
			this.sections.find((section) => section.href === normalized)?.title ||
			""
		);
	}

	getSectionMediaTypeByHref(href: string): string {
		const normalized = this.normalizeSectionHref(href);
		return this.manifestByHref.get(normalized)?.mediaType || "application/xhtml+xml";
	}

	isFixedLayout(): boolean {
		return this.metadata.isFixedLayout;
	}

	dispose(): void {
		this.publication = null;
		this.archive = null;
		this.archiveEntryLookup.clear();
		this.packageDocumentPath = "";
		this.manifestById.clear();
		this.manifestByHref.clear();
		this.spine = [];
		this.sections = [];
		this.tocItems = [];
		this.tocLinks = [];
		this.sectionTitleByHref.clear();
		this.rawDocumentCache.clear();
		this.rewrittenHtmlCache.clear();
		this.binaryCache.clear();
		this.rawCssCache.clear();
		for (const url of this.resourceUrlCache.values()) {
			URL.revokeObjectURL(url);
		}
		for (const url of this.cssUrlCache.values()) {
			URL.revokeObjectURL(url);
		}
		this.resourceUrlCache.clear();
		this.cssUrlCache.clear();
		this.positions = [];
		this.filePath = "";
		this.fileName = "";
		this.metadata = {
			title: "",
			author: "",
			chapterCount: 0,
			isFixedLayout: false,
		};
	}

	private async readPublicationResource(link: Link): Promise<Uint8Array | undefined> {
		const href = this.normalizeSectionHref(link.href);
		if (link.mediaType.isHTML) {
			const text = await this.getRewrittenHtml(href);
			return new TextEncoder().encode(text);
		}
		return this.getBinaryForHref(href);
	}

	private async findPackageDocumentPath(): Promise<string> {
		const containerDocument = await this.readXmlDocument(
			"META-INF/container.xml",
			"application/xml"
		);
		const rootfile = this.findFirstElementByLocalName(
			containerDocument.documentElement,
			"rootfile"
		);
		const fullPath = rootfile?.getAttribute("full-path")?.trim();
		if (!fullPath) {
			throw new Error("EPUB 缺少 package 文档路径");
		}
		return this.normalizePath(fullPath);
	}

	private parsePackageDocument(packageDocument: Document): void {
		const metadataElement = this.findFirstElementByLocalName(
			packageDocument.documentElement,
			"metadata"
		);
		const manifestElement = this.findFirstElementByLocalName(
			packageDocument.documentElement,
			"manifest"
		);
		const spineElement = this.findFirstElementByLocalName(packageDocument.documentElement, "spine");
		if (!manifestElement || !spineElement) {
			throw new Error("EPUB package 缺少 manifest 或 spine");
		}

		for (const itemElement of this.getChildElementsByLocalName(manifestElement, "item")) {
			const id = itemElement.getAttribute("id")?.trim();
			const href = itemElement.getAttribute("href")?.trim();
			if (!id || !href) {
				continue;
			}
			const manifestItem: ParsedManifestItem = {
				id,
				href: this.normalizeInternalHref(this.packageDocumentPath, href),
				mediaType: itemElement.getAttribute("media-type")?.trim() || this.inferMimeType(href),
				properties: (itemElement.getAttribute("properties") || "")
					.split(/\s+/)
					.map((value: string) => value.trim())
					.filter(Boolean),
				fallback: itemElement.getAttribute("fallback")?.trim() || undefined,
			};
			this.manifestById.set(id, manifestItem);
			this.manifestByHref.set(manifestItem.href, manifestItem);
		}

		this.spine = this.getChildElementsByLocalName(spineElement, "itemref")
			.map((itemRef) => ({
				idref: itemRef.getAttribute("idref")?.trim() || "",
				linear: (itemRef.getAttribute("linear") || "yes").trim().toLowerCase() !== "no",
			}))
			.filter((item) => item.idref && this.manifestById.has(item.idref));

		this.metadata = {
			title:
				this.readMetadataValue(metadataElement, "title") || this.fileName.replace(/\.epub$/i, ""),
			author: this.readMetadataValue(metadataElement, "creator") || "未知作者",
			publisher: this.readMetadataValue(metadataElement, "publisher") || undefined,
			language: this.readMetadataValue(metadataElement, "language") || undefined,
			identifier: this.readMetadataValue(metadataElement, "identifier") || undefined,
			chapterCount: this.spine.length,
			isFixedLayout: this.detectFixedLayout(metadataElement),
		};
	}

	private async buildToc(_packageDocument: Document): Promise<void> {
		const navItem = Array.from(this.manifestById.values()).find((item) =>
			item.properties.includes("nav")
		);
		if (navItem) {
			try {
				const navDocument = await this.getRawDocumentByHref(navItem.href);
				const navRoot = navDocument
					? Array.from(navDocument.querySelectorAll("nav")).find((element) => {
							const value = [
								element.getAttribute("epub:type") || "",
								element.getAttribute("type") || "",
								element.getAttribute("role") || "",
							]
								.join(" ")
								.toLowerCase();
							return value.includes("toc");
					  })
					: null;
				const topList = navRoot
					? Array.from(navRoot.children).find(
							(child) => child.localName === "ol" || child.localName === "ul"
					  )
					: null;
				if (topList) {
					this.tocItems = this.parseNavList(topList, 0, navItem.href);
					this.tocLinks = this.parseNavLinks(topList, navItem.href);
					return;
				}
			} catch (error) {
				logger.warn(
					"[ReadiumVaultPublicationBridge] Failed to parse EPUB navigation document, falling back to NCX/spine TOC:",
					{
						href: navItem.href,
						error,
					}
				);
			}
		}

		const ncxItem = Array.from(this.manifestById.values()).find((item) =>
			item.mediaType.includes("ncx")
		);
		if (ncxItem) {
			try {
				const ncxDocument = await this.readXmlDocument(ncxItem.href, "application/xml");
				const navMap = this.findFirstElementByLocalName(ncxDocument.documentElement, "navMap");
				if (navMap) {
					const navPoints = this.getChildElementsByLocalName(navMap, "navPoint");
					this.tocItems = this.parseNcxPoints(navPoints, 0, ncxItem.href);
					this.tocLinks = this.parseNcxLinks(navPoints, ncxItem.href);
					return;
				}
			} catch (error) {
				logger.warn(
					"[ReadiumVaultPublicationBridge] Failed to parse EPUB NCX document, falling back to spine TOC:",
					{
						href: ncxItem.href,
						error,
					}
				);
			}
		}

		this.tocItems = this.spine.map((item, index) => {
			const manifestItem = this.manifestById.get(item.idref)!;
			return {
				id: `${manifestItem.id}-${index}`,
				label: this.readableTitleFromHref(manifestItem.href),
				href: manifestItem.href,
				level: 0,
			};
		});
		this.tocLinks = this.tocItems.map((item) => ({
			href: item.href,
			title: item.label,
			type: this.getSectionMediaTypeByHref(item.href),
		}));
	}

	private async prepareSections(): Promise<void> {
		const nextSections: SectionDescriptor[] = [];
		for (const [index, item] of this.spine.entries()) {
			const manifestItem = this.manifestById.get(item.idref);
			if (!manifestItem) {
				continue;
			}
			const normalizedHref = this.normalizeSectionHref(manifestItem.href);
			const doc = await this.getRawDocumentByHref(manifestItem.href);
			const textLength = ((doc?.body || doc?.documentElement)?.textContent || "")
				.replace(/\s+/g, " ")
				.trim().length;
			const title =
				this.sectionTitleByHref.get(normalizedHref) ||
				this.findFirstTocLabel(manifestItem.href) ||
				this.readableTitleFromHref(manifestItem.href);
			const positionCount = this.metadata.isFixedLayout
				? 1
				: Math.max(
						1,
						Math.ceil(Math.max(textLength, 1) / ReadiumVaultPublicationBridge.POSITION_CHAR_BUCKET)
				  );
			nextSections.push({
				index,
				id: manifestItem.id,
				href: manifestItem.href,
				mediaType: manifestItem.mediaType,
				properties: manifestItem.properties,
				title,
				linear: item.linear,
				textLength,
				positionCount,
			});
			this.sectionTitleByHref.set(normalizedHref, title);
		}
		this.sections = nextSections;
		this.metadata.chapterCount = this.sections.length;
	}

	private buildReadiumManifestJson(): Record<string, unknown> {
		const readingOrder = this.sections.map((section) => ({
			href: section.href,
			type: section.mediaType,
			title: section.title,
			properties: section.properties.length > 0 ? { contains: section.properties } : undefined,
		}));

		const readingHrefSet = new Set(readingOrder.map((item) => item.href));
		const resources = Array.from(this.manifestByHref.values())
			.filter((item) => !readingHrefSet.has(item.href))
			.filter((item) => item.mediaType !== "application/x-dtbncx+xml")
			.map((item) => ({
				href: item.href,
				type: item.mediaType,
				title: this.sectionTitleByHref.get(this.normalizeSectionHref(item.href)) || undefined,
				properties: item.properties.length > 0 ? { contains: item.properties } : undefined,
			}));

		const links: Array<Record<string, unknown>> = [
			{
				href: this.createPublicationManifestUrl(),
				type: "application/webpub+json",
				rel: ["self"],
			},
		];
		const coverItem = this.findCoverManifestItem();
		if (coverItem) {
			links.unshift({
				href: coverItem.href,
				type: coverItem.mediaType,
				rel: ["cover"],
			});
		}

		return {
			"@context": ["https://readium.org/webpub-manifest/context.jsonld"],
			metadata: {
				title: this.metadata.title,
				author: this.metadata.author,
				identifier: this.metadata.identifier,
				language: this.metadata.language ? [this.metadata.language] : undefined,
				publisher: this.metadata.publisher ? [this.metadata.publisher] : undefined,
				layout: this.metadata.isFixedLayout ? "fixed" : "reflowable",
				conformsTo: ["https://readium.org/webpub-manifest/profiles/epub"],
			},
			links,
			readingOrder,
			resources,
			toc: this.tocLinks,
		};
	}

	private buildPositions(): Locator[] {
		const positions: Locator[] = [];
		const total = this.sections.reduce((sum, section) => sum + section.positionCount, 0);
		let positionNumber = 1;
		let beforeCount = 0;
		for (const section of this.sections) {
			const count = Math.max(1, section.positionCount);
			for (let index = 0; index < count; index += 1) {
				const progression = count === 1 ? 0 : index / (count - 1);
				const totalProgression = total <= 1 ? 0 : (beforeCount + index) / (total - 1);
				positions.push(
					this.createSectionLocator(section.href, progression, {
						position: positionNumber,
						totalProgression,
					})
				);
				positionNumber += 1;
			}
			beforeCount += count;
		}
		return positions;
	}

	private async getRawDocumentByHref(href: string): Promise<Document | null> {
		const normalized = this.normalizeSectionHref(href);
		if (!normalized) {
			return null;
		}
		if (this.rawDocumentCache.has(normalized)) {
			return this.rawDocumentCache.get(normalized) || null;
		}
		const entry = this.findArchiveEntry(this.stripFragmentAndQuery(normalized));
		if (!entry) {
			return null;
		}
		const mediaType = this.getSectionMediaTypeByHref(normalized);
		const content = await entry.async("text");
		const doc = this.parseMarkupDocument(
			content,
			mediaType.includes("html") ? "text/html" : "application/xhtml+xml",
			normalized,
			true
		);
		this.rawDocumentCache.set(normalized, doc);
		return doc;
	}

	private async extractCoverDataUrlFromPackage(packageDocument: Document): Promise<string | null> {
		const coverItem = this.findCoverManifestItem(packageDocument);
		if (!coverItem) {
			return null;
		}
		const entry = this.findArchiveEntry(this.stripFragmentAndQuery(coverItem.href));
		if (!entry) {
			return null;
		}
		try {
			const base64 = await entry.async("base64");
			return `data:${coverItem.mediaType || "image/jpeg"};base64,${base64}`;
		} catch (error) {
			logger.warn("[ReadiumVaultPublicationBridge] Failed to read cover image:", error);
			return null;
		}
	}

	private findCoverManifestItem(packageDocument?: Document): ParsedManifestItem | undefined {
		for (const item of this.manifestByHref.values()) {
			if (item.properties.includes("cover-image")) {
				return item;
			}
		}
		const metadataElement = packageDocument
			? this.findFirstElementByLocalName(packageDocument.documentElement, "metadata")
			: null;
		if (!metadataElement) {
			return undefined;
		}
		for (const metaElement of this.findElementsByLocalName(metadataElement, "meta")) {
			if ((metaElement.getAttribute("name") || "").trim() !== "cover") {
				continue;
			}
			const manifestId = metaElement.getAttribute("content")?.trim();
			if (manifestId && this.manifestById.has(manifestId)) {
				return this.manifestById.get(manifestId);
			}
		}
		return undefined;
	}

	serializeLocator(locator: Locator | null): string | null {
		if (!locator) {
			return null;
		}
		const cssSelector = locator.locations.getCssSelector?.() || "";
		const fragment =
			locator.locations.fragments?.find((item) => typeof item === "string" && item.trim()) || "";
		const highlight = locator.text?.highlight?.trim() || "";
		const compactFields = ReadiumVaultPublicationBridge.trimCompactFields([
			ReadiumVaultPublicationBridge.COMPACT_LOCATOR_MARKER,
			ReadiumVaultPublicationBridge.encodeCompactField(locator.href),
			ReadiumVaultPublicationBridge.formatCompactProgression(locator.locations.progression),
			ReadiumVaultPublicationBridge.encodeCompactField(fragment),
			ReadiumVaultPublicationBridge.encodeCompactField(cssSelector),
			ReadiumVaultPublicationBridge.encodeCompactField(highlight),
		]);
		return `${ReadiumVaultPublicationBridge.LOCATOR_PREFIX}${compactFields.join(
			ReadiumVaultPublicationBridge.COMPACT_LOCATOR_SEPARATOR
		)}`;
	}

	deserializeLocatorString(value: string): Locator | null {
		if (!value) {
			return null;
		}
		const normalized = this.normalizeLocationString(value);
		const raw = normalized.startsWith(ReadiumVaultPublicationBridge.LOCATOR_PREFIX)
			? normalized.slice(ReadiumVaultPublicationBridge.LOCATOR_PREFIX.length)
			: normalized.startsWith("{")
			? normalized
			: "";
		if (!raw) {
			return null;
		}
		const compactLocator = this.deserializeCompactLocatorString(raw);
		if (compactLocator) {
			return compactLocator;
		}
		try {
			const parsed = JSON.parse(raw.startsWith("{") ? raw : decodeURIComponent(raw));
			return this.coerceLocator(parsed);
		} catch (_error) {
			return null;
		}
	}

	private deserializeCompactLocatorString(raw: string): Locator | null {
		const separator = ReadiumVaultPublicationBridge.COMPACT_LOCATOR_SEPARATOR;
		if (!raw.startsWith(`${ReadiumVaultPublicationBridge.COMPACT_LOCATOR_MARKER}${separator}`)) {
			return null;
		}

		const parts = raw.split(separator);
		if (parts[0] !== ReadiumVaultPublicationBridge.COMPACT_LOCATOR_MARKER || parts.length < 2) {
			return null;
		}

		const href = ReadiumVaultPublicationBridge.decodeCompactField(parts[1]);
		if (!href) {
			return null;
		}

		const progressionRaw = parts[2] || "";
		const progression = progressionRaw ? Number.parseFloat(progressionRaw) : undefined;
		const fragment = ReadiumVaultPublicationBridge.decodeCompactField(parts[3]);
		const cssSelector = ReadiumVaultPublicationBridge.decodeCompactField(parts[4]);
		const highlight = ReadiumVaultPublicationBridge.decodeCompactField(parts[5]);

		return this.coerceLocator({
			href,
			locations: {
				fragments: fragment ? [fragment] : undefined,
				progression:
					typeof progression === "number" && Number.isFinite(progression) ? progression : undefined,
				otherLocations: cssSelector ? { cssSelector } : undefined,
			},
			text: highlight ? { highlight } : undefined,
		});
	}

	async canonicalizeLocation(value: string, textHint?: string): Promise<string | null> {
		if (!value) {
			return null;
		}

		const locator = this.deserializeLocatorString(value);
		if (locator) {
			return this.serializeLocator(this.coerceLocator(locator.serialize(), textHint));
		}

		const normalized = this.normalizeLocationString(value);
		if (this.isDocumentHrefLike(normalized)) {
			const hrefLocator = await this.createLocatorForHref(normalized, textHint);
			return this.serializeLocator(hrefLocator);
		}

		try {
			const wrapped = new EpubCFI(normalized).toString();
			const spinePos = new EpubCFI(wrapped).spinePos;
			if (typeof spinePos !== "number" || spinePos < 0 || spinePos >= this.sections.length) {
				return null;
			}
			const section = this.sections[spinePos];
			const doc = await this.getRawDocumentByHref(section.href);
			if (!doc) {
				return this.serializeLocator(await this.createLocatorForHref(section.href, textHint));
			}
			const range = new EpubCFI(wrapped).toRange(doc);
			if (!range) {
				return this.serializeLocator(await this.createLocatorForHref(section.href, textHint));
			}
			return this.createLocatorStringFromRange(section.href, range, textHint);
		} catch (_error) {
			return null;
		}
	}

	async createLocatorForHref(href: string, textHint?: string): Promise<Locator | null> {
		const normalized = this.normalizeSectionHref(href);
		const section = this.sections.find((item) => item.href === normalized);
		if (!section) {
			return null;
		}
		const doc = await this.getRawDocumentByHref(section.href);
		if (!doc) {
			return this.createSectionLocator(
				section.href,
				0,
				undefined,
				textHint ? { highlight: textHint.trim() } : undefined
			);
		}
		if (typeof textHint === "string" && textHint.trim()) {
			const range = this.findRangeByTextQuote(doc.body || doc.documentElement, {
				highlight: textHint.trim(),
			});
			if (range) {
				return this.createLocatorFromRange(section.href, range, textHint);
			}
		}
		const fragment = this.extractHrefFragment(href);
		if (fragment) {
			const node =
				doc.getElementById(fragment) || doc.querySelector(`[name="${CSS.escape(fragment)}"]`);
			if (node) {
				const range = this.createRangeForNode(node);
				if (range) {
					return this.createLocatorFromRange(section.href, range);
				}
			}
		}
		const startRange = this.createDocumentStartRange(doc);
		return startRange
			? this.createLocatorFromRange(section.href, startRange, textHint)
			: this.createSectionLocator(
					section.href,
					0,
					undefined,
					textHint ? { highlight: textHint.trim() } : undefined
			  );
	}

	createLocatorStringFromRange(href: string, range: Range, textHint?: string): string | null {
		return this.serializeLocator(this.createLocatorFromRange(href, range, textHint));
	}

	createLocatorFromRange(href: string, range: Range, textHint?: string): Locator | null {
		const normalizedHref = this.normalizeSectionHref(href);
		const doc =
			range.startContainer?.ownerDocument || range.commonAncestorContainer?.ownerDocument || null;
		if (!doc) {
			return null;
		}
		const root = this.pickLocatorRoot(range, doc);
		const cssSelector = this.buildCssSelector(root);
		const fragments = root.id ? [root.id] : undefined;
		const progression = this.computeProgressionForRange(doc, range);
		const quote = this.buildTextQuoteForRange(root, range, textHint);
		return this.createSectionLocator(
			normalizedHref,
			progression,
			{
				cssSelector,
				fragments,
			},
			quote
		);
	}

	resolveRangeInDocument(
		doc: Document,
		target: string,
		expectedHref?: string,
		textHint?: string
	): Range | null {
		const locator = this.deserializeLocatorString(target);
		if (locator) {
			const href = this.normalizeSectionHref(locator.href);
			if (expectedHref && href !== this.normalizeSectionHref(expectedHref)) {
				return null;
			}
			return this.rangeFromLocator(doc, locator);
		}
		const normalized = this.normalizeLocationString(target);
		if (!this.isDocumentHrefLike(normalized)) {
			return null;
		}
		const normalizedHref = this.normalizeSectionHref(normalized);
		if (expectedHref && normalizedHref !== this.normalizeSectionHref(expectedHref)) {
			return null;
		}
		const fragment = this.extractHrefFragment(normalized);
		if (fragment) {
			const node =
				doc.getElementById(fragment) || doc.querySelector(`[name="${CSS.escape(fragment)}"]`);
			return this.createRangeForNode(node);
		}
		if (typeof textHint === "string" && textHint.trim()) {
			const match = this.findRangeByTextQuote(doc.body || doc.documentElement, {
				highlight: textHint.trim(),
			});
			if (match) {
				return match;
			}
		}
		return this.createDocumentStartRange(doc);
	}

	async search(
		query: string
	): Promise<Array<{ cfi: string; excerpt: string; chapterTitle: string }>> {
		const needle = query.trim().toLowerCase();
		if (!needle) {
			return [];
		}
		const results: Array<{ cfi: string; excerpt: string; chapterTitle: string }> = [];
		for (const section of this.sections) {
			if (results.length >= ReadiumVaultPublicationBridge.MAX_SEARCH_RESULTS) {
				break;
			}
			const doc = await this.getRawDocumentByHref(section.href);
			if (!doc) {
				continue;
			}
			const root = doc.body || doc.documentElement;
			const segments = this.collectTextSegments(root);
			if (segments.length === 0) {
				continue;
			}
			const combined = segments.map((segment) => segment.text).join("");
			let searchFrom = 0;
			while (
				searchFrom < combined.length &&
				results.length < ReadiumVaultPublicationBridge.MAX_SEARCH_RESULTS
			) {
				const foundAt = combined.toLowerCase().indexOf(needle, searchFrom);
				if (foundAt < 0) {
					break;
				}
				const range = this.createRangeFromTextOffsets(
					doc,
					segments,
					foundAt,
					foundAt + needle.length
				);
				const locator = range ? this.createLocatorStringFromRange(section.href, range) : null;
				if (locator) {
					results.push({
						cfi: locator,
						excerpt: this.buildSearchSnippet(combined, foundAt, needle.length),
						chapterTitle: section.title,
					});
				}
				searchFrom = foundAt + Math.max(needle.length, 1);
			}
		}
		return results;
	}

	resolvePositionIndex(locator: Locator): number {
		const explicit = locator.locations.position;
		if (typeof explicit === "number" && explicit > 0) {
			return explicit;
		}
		const candidates = this.positions.filter((position) => position.href === locator.href);
		if (candidates.length === 0) {
			return 1;
		}
		const target = locator.locations.progression ?? 0;
		let nearest = candidates[0];
		let nearestDistance = Math.abs((nearest.locations.progression ?? 0) - target);
		for (const candidate of candidates.slice(1)) {
			const distance = Math.abs((candidate.locations.progression ?? 0) - target);
			if (distance < nearestDistance) {
				nearest = candidate;
				nearestDistance = distance;
			}
		}
		return nearest.locations.position || 1;
	}

	resolvePageNumber(value: string): number | undefined {
		const locator = this.deserializeLocatorString(value);
		return locator ? this.resolvePositionIndex(locator) : undefined;
	}

	private async getBinaryForHref(href: string): Promise<Uint8Array | undefined> {
		const normalized = this.normalizeSectionHref(href);
		if (this.binaryCache.has(normalized)) {
			return this.binaryCache.get(normalized);
		}
		const entry = this.findArchiveEntry(this.stripFragmentAndQuery(normalized));
		if (!entry) {
			return undefined;
		}
		const bytes = await entry.async("uint8array");
		this.binaryCache.set(normalized, bytes);
		return bytes;
	}

	private async getRawCssText(href: string): Promise<string> {
		const normalized = this.normalizeSectionHref(href);
		if (this.rawCssCache.has(normalized)) {
			return this.rawCssCache.get(normalized) || "";
		}
		const entry = this.findArchiveEntry(this.stripFragmentAndQuery(normalized));
		if (!entry) {
			return "";
		}
		const css = await entry.async("text");
		this.rawCssCache.set(normalized, css);
		return css;
	}

	private async getRewrittenHtml(href: string): Promise<string> {
		const normalized = this.normalizeSectionHref(href);
		if (this.rewrittenHtmlCache.has(normalized)) {
			return this.rewrittenHtmlCache.get(normalized) || "";
		}
		const entry = this.findArchiveEntry(this.stripFragmentAndQuery(normalized));
		if (!entry) {
			throw new Error(`EPUB 内缺少章节资源：${normalized}`);
		}
		const raw = await entry.async("text");
		const mediaType = this.getSectionMediaTypeByHref(normalized);
		const parserType: DOMParserSupportedType = mediaType.includes("html")
			? "text/html"
			: "application/xhtml+xml";
		const doc = this.parseMarkupDocument(raw, parserType, normalized, true);
		await this.rewriteHtmlDocumentResources(doc, normalized);
		const output = new XMLSerializer().serializeToString(doc);
		this.rewrittenHtmlCache.set(normalized, output);
		return output;
	}

	private async rewriteHtmlDocumentResources(doc: Document, href: string): Promise<void> {
		const srcRules: Array<{ selector: string; attribute: string }> = [
			{ selector: "img[src]", attribute: "src" },
			{ selector: "audio[src]", attribute: "src" },
			{ selector: "video[src]", attribute: "src" },
			{ selector: "video[poster]", attribute: "poster" },
			{ selector: "source[src]", attribute: "src" },
			{ selector: "track[src]", attribute: "src" },
			{ selector: "object[data]", attribute: "data" },
			{ selector: "embed[src]", attribute: "src" },
			{ selector: "image[href]", attribute: "href" },
			{ selector: "image[xlink\\:href]", attribute: "xlink:href" },
		];
		for (const rule of srcRules) {
			for (const element of Array.from(doc.querySelectorAll(rule.selector))) {
				const rawValue = element.getAttribute(rule.attribute);
				if (!rawValue || this.shouldKeepOriginalUrl(rawValue)) {
					continue;
				}
				const resourceUrl = await this.getResourceUrl(this.normalizeInternalHref(href, rawValue));
				if (resourceUrl) {
					element.setAttribute(rule.attribute, resourceUrl);
				}
			}
		}

		for (const sourceSetElement of Array.from(doc.querySelectorAll("[srcset]"))) {
			const rawValue = sourceSetElement.getAttribute("srcset");
			if (rawValue) {
				sourceSetElement.setAttribute("srcset", await this.rewriteSrcSet(rawValue, href));
			}
		}

		for (const linkElement of Array.from(doc.querySelectorAll("link[href]"))) {
			const rel = (linkElement.getAttribute("rel") || "").toLowerCase();
			const rawValue = linkElement.getAttribute("href");
			if (!rawValue || this.shouldKeepOriginalUrl(rawValue)) {
				continue;
			}
			if (rel.includes("stylesheet")) {
				const stylesheetUrl = await this.getCssUrl(this.normalizeInternalHref(href, rawValue));
				if (stylesheetUrl) {
					linkElement.setAttribute("href", stylesheetUrl);
				}
				continue;
			}
			const resourceUrl = await this.getResourceUrl(this.normalizeInternalHref(href, rawValue));
			if (resourceUrl) {
				linkElement.setAttribute("href", resourceUrl);
			}
		}

		for (const styleElement of Array.from(doc.querySelectorAll("style"))) {
			styleElement.textContent = await this.rewriteCssText(styleElement.textContent || "", href);
		}

		for (const styledElement of Array.from(doc.querySelectorAll("[style]"))) {
			const rawStyle = styledElement.getAttribute("style");
			if (rawStyle) {
				styledElement.setAttribute("style", await this.rewriteCssText(rawStyle, href));
			}
		}

		markReadiumThemeDocument(doc);
		ensureReadiumBootstrapThemeStyle(doc);
		normalizeReadiumThemeInlineStyles(doc);
	}

	private async rewriteSrcSet(value: string, baseHref: string): Promise<string> {
		const parts = value
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean);
		const rewritten = await Promise.all(
			parts.map(async (part) => {
				const [rawUrl, descriptor] = part.split(/\s+/, 2);
				if (!rawUrl || this.shouldKeepOriginalUrl(rawUrl)) {
					return part;
				}
				const resourceUrl = await this.getResourceUrl(this.normalizeInternalHref(baseHref, rawUrl));
				return resourceUrl ? `${resourceUrl}${descriptor ? ` ${descriptor}` : ""}` : part;
			})
		);
		return rewritten.join(", ");
	}

	private async rewriteCssText(cssText: string, baseHref: string): Promise<string> {
		let output = await this.inlineCssImports(cssText, baseHref);
		const matches = Array.from(output.matchAll(/url\(([^)]+)\)/gi));
		for (const match of matches) {
			const original = (match[1] || "").trim();
			const unquoted = original.replace(/^['"]|['"]$/g, "");
			if (!unquoted || this.shouldKeepOriginalUrl(unquoted)) {
				continue;
			}
			const resourceUrl = await this.getResourceUrl(this.normalizeInternalHref(baseHref, unquoted));
			if (resourceUrl) {
				output = output.replace(match[0], `url("${resourceUrl}")`);
			}
		}
		return output;
	}

	private async inlineCssImports(cssText: string, baseHref: string): Promise<string> {
		const importPattern = /@import\s+(?:url\()?['"]?([^'")]+)['"]?\)?\s*;/gi;
		let output = cssText;
		const matches = Array.from(cssText.matchAll(importPattern));
		for (const match of matches) {
			const importHref = match[1]?.trim();
			if (!importHref || this.shouldKeepOriginalUrl(importHref)) {
				continue;
			}
			const resolvedHref = this.normalizeInternalHref(baseHref, importHref);
			const importedCss = await this.getRawCssText(resolvedHref);
			const rewritten = await this.rewriteCssText(importedCss, resolvedHref);
			output = output.replace(match[0], rewritten);
		}
		return output;
	}

	private async getCssUrl(href: string): Promise<string | null> {
		const normalized = this.normalizeSectionHref(href);
		if (this.cssUrlCache.has(normalized)) {
			return this.cssUrlCache.get(normalized) || null;
		}
		const cssText = await this.getRawCssText(normalized);
		if (!cssText) {
			return null;
		}
		const rewritten = await this.rewriteCssText(cssText, normalized);
		const url = URL.createObjectURL(new Blob([rewritten], { type: "text/css" }));
		this.cssUrlCache.set(normalized, url);
		return url;
	}

	private async getResourceUrl(href: string): Promise<string | null> {
		const normalized = this.normalizeSectionHref(href);
		if (this.resourceUrlCache.has(normalized)) {
			return this.resourceUrlCache.get(normalized) || null;
		}
		const bytes = await this.getBinaryForHref(normalized);
		if (!bytes) {
			return null;
		}
		const mimeType =
			this.manifestByHref.get(normalized)?.mediaType || this.inferMimeType(normalized);
		const blobBytes = new Uint8Array(bytes);
		const url = URL.createObjectURL(new Blob([blobBytes], { type: mimeType }));
		this.resourceUrlCache.set(normalized, url);
		return url;
	}

	private parseNavList(listElement: Element, level: number, navHref: string): TocItem[] {
		const result: TocItem[] = [];
		for (const itemElement of Array.from(listElement.children).filter(
			(child) => child.localName === "li"
		)) {
			const linkElement = Array.from(itemElement.children).find(
				(child) => child.localName === "a" || child.localName === "span"
			);
			if (!linkElement) {
				continue;
			}
			const href =
				linkElement.localName === "a"
					? this.normalizeInternalHref(navHref, linkElement.getAttribute("href") || "")
					: "";
			const label = (linkElement.textContent || "").trim() || this.readableTitleFromHref(href);
			if (href) {
				const sectionHref = this.normalizeSectionHref(href);
				if (sectionHref && !this.sectionTitleByHref.has(sectionHref)) {
					this.sectionTitleByHref.set(sectionHref, label);
				}
			}
			const childList = Array.from(itemElement.children).find(
				(child) => child.localName === "ol" || child.localName === "ul"
			);
			result.push({
				id: `${level}-${result.length}-${href || label}`,
				label,
				href,
				level,
				subitems: childList ? this.parseNavList(childList, level + 1, navHref) : undefined,
			});
		}
		return result;
	}

	private parseNavLinks(listElement: Element, navHref: string): TocLinkJson[] {
		const items: TocLinkJson[] = [];
		for (const itemElement of Array.from(listElement.children).filter(
			(child) => child.localName === "li"
		)) {
			const linkElement = Array.from(itemElement.children).find(
				(child) => child.localName === "a" || child.localName === "span"
			);
			if (!linkElement) {
				continue;
			}
			const href =
				linkElement.localName === "a"
					? this.normalizeInternalHref(navHref, linkElement.getAttribute("href") || "")
					: "";
			const title = (linkElement.textContent || "").trim() || this.readableTitleFromHref(href);
			const childList = Array.from(itemElement.children).find(
				(child) => child.localName === "ol" || child.localName === "ul"
			);
			items.push({
				href,
				title,
				type: this.getSectionMediaTypeByHref(href),
				children: childList ? this.parseNavLinks(childList, navHref) : undefined,
			});
		}
		return items;
	}

	private parseNcxPoints(points: Element[], level: number, ncxHref: string): TocItem[] {
		return points.map((point, index) => {
			const label =
				this.findFirstElementByLocalName(point, "text")?.textContent?.trim() || `章节 ${index + 1}`;
			const contentElement = this.findFirstElementByLocalName(point, "content");
			const href = this.normalizeInternalHref(ncxHref, contentElement?.getAttribute("src") || "");
			if (href) {
				const sectionHref = this.normalizeSectionHref(href);
				if (sectionHref && !this.sectionTitleByHref.has(sectionHref)) {
					this.sectionTitleByHref.set(sectionHref, label);
				}
			}
			const children = this.getChildElementsByLocalName(point, "navPoint");
			return {
				id: point.getAttribute("id") || `${level}-${index}-${href}`,
				label,
				href,
				level,
				subitems:
					children.length > 0 ? this.parseNcxPoints(children, level + 1, ncxHref) : undefined,
			};
		});
	}

	private parseNcxLinks(points: Element[], ncxHref: string): TocLinkJson[] {
		return points.map((point, index) => {
			const title =
				this.findFirstElementByLocalName(point, "text")?.textContent?.trim() || `章节 ${index + 1}`;
			const contentElement = this.findFirstElementByLocalName(point, "content");
			const href = this.normalizeInternalHref(ncxHref, contentElement?.getAttribute("src") || "");
			const children = this.getChildElementsByLocalName(point, "navPoint");
			return {
				href,
				title,
				type: this.getSectionMediaTypeByHref(href),
				children: children.length > 0 ? this.parseNcxLinks(children, ncxHref) : undefined,
			};
		});
	}

	private findFirstTocLabel(href: string): string | null {
		const normalized = this.normalizeSectionHref(href);
		const visit = (items: TocItem[]): string | null => {
			for (const item of items) {
				if (this.normalizeSectionHref(item.href) === normalized) {
					return item.label;
				}
				if (item.subitems?.length) {
					const nested = visit(item.subitems);
					if (nested) {
						return nested;
					}
				}
			}
			return null;
		};
		return visit(this.tocItems);
	}

	private createPublicationManifestUrl(): string {
		const safeName = this.fileName.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase();
		return `https://weave.local/${safeName}/manifest.json`;
	}

	private createSectionLocator(
		href: string,
		progression = 0,
		options?: {
			position?: number;
			totalProgression?: number;
			cssSelector?: string;
			fragments?: string[];
		},
		text?: TextQuote
	): Locator {
		const normalizedHref = this.normalizeSectionHref(href);
		const section = this.sections.find((item) => item.href === normalizedHref);
		const type =
			section?.mediaType ||
			this.manifestByHref.get(normalizedHref)?.mediaType ||
			"application/xhtml+xml";
		const title =
			section?.title ||
			this.getSectionTitleByHref(normalizedHref) ||
			this.readableTitleFromHref(normalizedHref);
		const otherLocations = new Map<string, unknown>();
		if (options?.cssSelector) {
			otherLocations.set("cssSelector", options.cssSelector);
		}
		return new Locator({
			href: normalizedHref,
			type,
			title,
			locations: new LocatorLocations({
				fragments: options?.fragments,
				progression: this.clamp(progression, 0, 1),
				totalProgression:
					options?.totalProgression != null
						? this.clamp(options.totalProgression, 0, 1)
						: undefined,
				position: options?.position,
				otherLocations: otherLocations.size > 0 ? otherLocations : undefined,
			}),
			text: text?.highlight
				? new LocatorText({
						highlight: text.highlight,
						before: text.before,
						after: text.after,
				  })
				: undefined,
		});
	}

	private coerceLocator(raw: unknown, textHint?: string): Locator | null {
		const serialized =
			typeof raw === "object" && raw != null ? (raw as Record<string, unknown>) : null;
		const href =
			typeof serialized?.href === "string" ? this.normalizeSectionHref(serialized.href) : "";
		if (!href) {
			return null;
		}
		const locationsJson =
			typeof serialized?.locations === "object" && serialized.locations != null
				? (serialized.locations as Record<string, unknown>)
				: {};
		const textJson =
			typeof serialized?.text === "object" && serialized.text != null
				? (serialized.text as Record<string, unknown>)
				: {};
		const otherLocations = new Map<string, unknown>();
		const sourceOtherLocations = locationsJson.otherLocations;
		if (
			sourceOtherLocations &&
			typeof sourceOtherLocations === "object" &&
			!Array.isArray(sourceOtherLocations)
		) {
			for (const [key, value] of Object.entries(sourceOtherLocations as Record<string, unknown>)) {
				otherLocations.set(key, value);
			}
		}
		return new Locator({
			href,
			type:
				typeof serialized?.type === "string" && serialized.type
					? serialized.type
					: this.getSectionMediaTypeByHref(href),
			title:
				typeof serialized?.title === "string" && serialized.title
					? serialized.title
					: this.getSectionTitleByHref(href) || undefined,
			locations: new LocatorLocations({
				fragments: Array.isArray(locationsJson.fragments)
					? locationsJson.fragments.filter((item): item is string => typeof item === "string")
					: undefined,
				progression:
					typeof locationsJson.progression === "number"
						? this.clamp(locationsJson.progression, 0, 1)
						: undefined,
				totalProgression:
					typeof locationsJson.totalProgression === "number"
						? this.clamp(locationsJson.totalProgression, 0, 1)
						: undefined,
				position:
					typeof locationsJson.position === "number"
						? Math.max(1, Math.trunc(locationsJson.position))
						: undefined,
				otherLocations: otherLocations.size > 0 ? otherLocations : undefined,
			}),
			text:
				(typeof textJson.highlight === "string" && textJson.highlight.trim()) ||
				(typeof textHint === "string" && textHint.trim())
					? new LocatorText({
							highlight:
								typeof textJson.highlight === "string" && textJson.highlight.trim()
									? textJson.highlight.trim()
									: textHint?.trim(),
							before:
								typeof textJson.before === "string" && textJson.before
									? textJson.before
									: undefined,
							after:
								typeof textJson.after === "string" && textJson.after ? textJson.after : undefined,
					  })
					: undefined,
		});
	}

	private rangeFromLocator(doc: Document, locator: Locator): Range | null {
		const cssSelector = locator.locations.getCssSelector?.() || undefined;
		const fragments = locator.locations.fragments || [];
		const text = locator.text;
		if (text?.highlight?.trim()) {
			const root =
				(cssSelector ? doc.querySelector(cssSelector) : null) || doc.body || doc.documentElement;
			return this.findRangeByTextQuote(root, {
				highlight: text.highlight,
				before: text.before,
				after: text.after,
			});
		}
		if (cssSelector) {
			const target = doc.querySelector(cssSelector);
			const range = this.createRangeForNode(target);
			if (range) {
				return range;
			}
		}
		for (const fragment of fragments) {
			const cleaned = fragment.startsWith("#") ? fragment.slice(1) : fragment;
			const target =
				doc.getElementById(cleaned) || doc.querySelector(`[name="${CSS.escape(cleaned)}"]`);
			const range = this.createRangeForNode(target);
			if (range) {
				return range;
			}
		}
		return null;
	}

	private pickLocatorRoot(range: Range, doc: Document): Element {
		let node: Node | null = range.commonAncestorContainer;
		if (node.nodeType === Node.TEXT_NODE) {
			node = node.parentElement;
		}
		let element = node instanceof Element ? node : doc.body || doc.documentElement;
		while (
			element.parentElement &&
			element.parentElement !== doc.body &&
			!this.isBlockElement(element)
		) {
			element = element.parentElement;
		}
		return element;
	}

	private buildTextQuoteForRange(
		root: Element,
		range: Range,
		textHint?: string
	): TextQuote | undefined {
		const segments = this.collectTextSegments(root);
		if (segments.length === 0) {
			const text = textHint?.trim() || range.toString().trim();
			return text ? { highlight: text } : undefined;
		}
		const startOffset = this.computeTextOffsetForBoundary(
			segments,
			range.startContainer,
			range.startOffset
		);
		const endOffset = this.computeTextOffsetForBoundary(
			segments,
			range.endContainer,
			range.endOffset
		);
		const combined = segments.map((segment) => segment.text).join("");
		const highlight =
			combined.slice(startOffset, endOffset).trim() || textHint?.trim() || range.toString().trim();
		if (!highlight) {
			return undefined;
		}
		return {
			highlight,
			before:
				combined.slice(
					Math.max(0, startOffset - ReadiumVaultPublicationBridge.CONTEXT_SIZE),
					startOffset
				) || undefined,
			after:
				combined.slice(endOffset, endOffset + ReadiumVaultPublicationBridge.CONTEXT_SIZE) ||
				undefined,
		};
	}

	private computeProgressionForRange(doc: Document, range: Range): number {
		const root = doc.body || doc.documentElement;
		const segments = this.collectTextSegments(root);
		if (segments.length === 0) {
			return 0;
		}
		const totalLength = segments[segments.length - 1]?.end || 0;
		if (totalLength <= 0) {
			return 0;
		}
		const startOffset = this.computeTextOffsetForBoundary(
			segments,
			range.startContainer,
			range.startOffset
		);
		return this.clamp(startOffset / totalLength, 0, 1);
	}

	private findRangeByTextQuote(root: Element, text: TextQuote): Range | null {
		const highlight = text.highlight?.trim();
		if (!highlight) {
			return null;
		}
		const segments = this.collectTextSegments(root);
		if (segments.length === 0) {
			return null;
		}
		const combined = segments.map((segment) => segment.text).join("");
		let searchFrom = 0;
		let bestIndex = -1;
		let bestScore = -Infinity;
		while (searchFrom <= combined.length) {
			const foundAt = combined.indexOf(highlight, searchFrom);
			if (foundAt < 0) {
				break;
			}
			const score = this.scoreTextQuoteCandidate(
				combined,
				foundAt,
				highlight.length,
				text.before,
				text.after
			);
			if (score > bestScore) {
				bestScore = score;
				bestIndex = foundAt;
			}
			searchFrom = foundAt + Math.max(highlight.length, 1);
		}
		if (bestIndex < 0) {
			return null;
		}
		return this.createRangeFromTextOffsets(
			root.ownerDocument,
			segments,
			bestIndex,
			bestIndex + highlight.length
		);
	}

	private scoreTextQuoteCandidate(
		combined: string,
		index: number,
		highlightLength: number,
		before?: string,
		after?: string
	): number {
		let score = 0;
		if (before) {
			const actualBefore = combined.slice(Math.max(0, index - before.length), index);
			if (actualBefore === before) {
				score += before.length + 10;
			}
		}
		if (after) {
			const actualAfter = combined.slice(
				index + highlightLength,
				index + highlightLength + after.length
			);
			if (actualAfter === after) {
				score += after.length + 10;
			}
		}
		if (!before && !after) {
			score += 1;
		}
		return score;
	}

	private createRangeForNode(node: Element | Node | null | undefined): Range | null {
		if (!node?.ownerDocument) {
			return null;
		}
		const range = node.ownerDocument.createRange();
		if (node instanceof Element && node.childNodes.length > 0) {
			range.selectNodeContents(node);
		} else {
			range.selectNode(node);
		}
		return range;
	}

	private createDocumentStartRange(doc: Document): Range | null {
		const root = doc.body || doc.documentElement;
		const segments = this.collectTextSegments(root);
		if (segments.length > 0) {
			const range = doc.createRange();
			range.setStart(segments[0].node, 0);
			range.setEnd(segments[0].node, Math.min(1, segments[0].text.length));
			return range;
		}
		return this.createRangeForNode(root);
	}

	private collectTextSegments(root: Element): TextNodeSegment[] {
		const segments: TextNodeSegment[] = [];
		const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: (node) => {
				const parent = node.parentElement;
				if (
					!parent ||
					ReadiumVaultPublicationBridge.TEXT_NODE_TAG_BLACKLIST.has(parent.tagName.toUpperCase())
				) {
					return NodeFilter.FILTER_REJECT;
				}
				return (node.textContent || "").length > 0
					? NodeFilter.FILTER_ACCEPT
					: NodeFilter.FILTER_REJECT;
			},
		});
		let offset = 0;
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			const text = node.textContent || "";
			segments.push({ node, start: offset, end: offset + text.length, text });
			offset += text.length;
		}
		return segments;
	}

	private computeTextOffsetForBoundary(
		segments: TextNodeSegment[],
		node: Node,
		offset: number
	): number {
		if (node.nodeType === Node.TEXT_NODE) {
			const segment = segments.find((item) => item.node === node);
			if (segment) {
				return segment.start + Math.min(offset, segment.text.length);
			}
		}
		const rangeDoc = node.ownerDocument || document;
		const probe = rangeDoc.createRange();
		try {
			probe.setStart(segments[0].node, 0);
			probe.setEnd(node, offset);
			return probe.toString().length;
		} catch (_error) {
			return 0;
		}
	}

	private createRangeFromTextOffsets(
		doc: Document,
		segments: TextNodeSegment[],
		startOffset: number,
		endOffset: number
	): Range | null {
		const startSegment = segments.find(
			(segment) => startOffset >= segment.start && startOffset <= segment.end
		);
		const endSegment = segments.find(
			(segment) => endOffset >= segment.start && endOffset <= segment.end
		);
		if (!startSegment || !endSegment) {
			return null;
		}
		const range = doc.createRange();
		range.setStart(startSegment.node, Math.max(0, startOffset - startSegment.start));
		range.setEnd(endSegment.node, Math.max(0, endOffset - endSegment.start));
		return range;
	}

	private buildSearchSnippet(source: string, index: number, length: number): string {
		const start = Math.max(0, index - 40);
		const end = Math.min(source.length, index + length + 40);
		let snippet = source.slice(start, end).replace(/\s+/g, " ").trim();
		if (start > 0) {
			snippet = `...${snippet}`;
		}
		if (end < source.length) {
			snippet = `${snippet}...`;
		}
		return snippet;
	}

	private findFirstElementByLocalName(
		root: Element | Document | null | undefined,
		localName: string
	): Element | null {
		if (!root) {
			return null;
		}
		const normalizedLocalName = localName.toLowerCase();
		if (
			root instanceof Element &&
			(root.localName || root.tagName).toLowerCase() === normalizedLocalName
		) {
			return root;
		}
		const elements = this.findElementsByLocalName(root, localName);
		return elements[0] || null;
	}

	private findElementsByLocalName(
		root: Element | Document | null | undefined,
		localName: string
	): Element[] {
		if (!root) {
			return [];
		}
		const normalizedLocalName = localName.toLowerCase();
		return Array.from(root.getElementsByTagNameNS("*", localName)).filter(
			(element) => (element.localName || element.tagName).toLowerCase() === normalizedLocalName
		);
	}

	private getChildElementsByLocalName(
		parent: Element | null | undefined,
		localName: string
	): Element[] {
		if (!parent) {
			return [];
		}
		const normalizedLocalName = localName.toLowerCase();
		return Array.from(parent.children).filter(
			(child) => (child.localName || child.tagName).toLowerCase() === normalizedLocalName
		);
	}

	private readMetadataValue(
		metadataElement: Element | null | undefined,
		localName: string
	): string {
		if (!metadataElement) {
			return "";
		}
		const direct = this.findElementsByLocalName(metadataElement, localName)
			.map((element) => (element.textContent || "").trim())
			.find(Boolean);
		if (direct) {
			return direct;
		}
		for (const metaElement of this.findElementsByLocalName(metadataElement, "meta")) {
			const propertyName = (
				metaElement.getAttribute("property") ||
				metaElement.getAttribute("name") ||
				""
			)
				.trim()
				.toLowerCase();
			if (
				propertyName === localName.toLowerCase() ||
				propertyName.endsWith(`:${localName.toLowerCase()}`)
			) {
				const content = (
					metaElement.getAttribute("content") ||
					metaElement.textContent ||
					""
				).trim();
				if (content) {
					return content;
				}
			}
		}
		return "";
	}

	private detectFixedLayout(metadataElement: Element | null | undefined): boolean {
		const matchesFixedLayout = (value: string): boolean =>
			value.includes("pre-paginated") || value.includes("fixed");
		for (const metaElement of this.findElementsByLocalName(metadataElement || null, "meta")) {
			const propertyName = (
				metaElement.getAttribute("property") ||
				metaElement.getAttribute("name") ||
				""
			)
				.trim()
				.toLowerCase();
			const value = (metaElement.getAttribute("content") || metaElement.textContent || "")
				.trim()
				.toLowerCase();
			if (!propertyName || !value) {
				continue;
			}
			if (
				propertyName === "rendition:layout" ||
				propertyName === "layout" ||
				propertyName.endsWith(":layout")
			) {
				if (matchesFixedLayout(value)) {
					return true;
				}
			}
			if (
				propertyName === "fixed-layout" ||
				propertyName === "ibooks:fixed-layout" ||
				propertyName === "book-type"
			) {
				if (value === "true" || value === "yes" || value === "1" || matchesFixedLayout(value)) {
					return true;
				}
			}
		}
		return Array.from(this.manifestById.values()).some((item) =>
			item.properties.some((property) => {
				const normalizedProperty = property.trim().toLowerCase();
				return (
					normalizedProperty === "rendition:layout-pre-paginated" ||
					normalizedProperty === "layout-pre-paginated"
				);
			})
		);
	}

	private async readXmlDocument(
		path: string,
		parserType: DOMParserSupportedType
	): Promise<Document> {
		const normalizedPath = this.stripFragmentAndQuery(path);
		const entry = this.findArchiveEntry(normalizedPath);
		if (!entry) {
			throw new Error(`EPUB resource is missing: ${normalizedPath}`);
		}
		const raw = await entry.async("text");
		return this.parseMarkupDocument(raw, parserType, normalizedPath, true);
	}

	private parseMarkupDocument(
		raw: string,
		parserType: DOMParserSupportedType,
		path: string,
		allowHtmlFallback = false
	): Document {
		const primaryDoc = new DOMParser().parseFromString(raw, parserType);
		if (!this.hasParserError(primaryDoc)) {
			return primaryDoc;
		}
		if (!allowHtmlFallback || parserType === "text/html") {
			throw new Error(`EPUB XML parse failed: ${path}`);
		}

		const htmlDoc = new DOMParser().parseFromString(raw, "text/html");
		const expectedRootNames = this.getExpectedRootLocalNames(path);
		const hasExpectedRoot =
			expectedRootNames.length === 0 ||
			expectedRootNames.some((localName) =>
				Boolean(this.findFirstElementByLocalName(htmlDoc, localName))
			);
		if (!hasExpectedRoot) {
			throw new Error(`EPUB XML parse failed: ${path}`);
		}

		logger.warn(
			"[ReadiumVaultPublicationBridge] Falling back to HTML parser for malformed EPUB markup:",
			{
				path,
				parserType,
				expectedRootNames,
			}
		);
		return htmlDoc;
	}

	private hasParserError(doc: Document): boolean {
		return Boolean(this.findFirstElementByLocalName(doc, "parsererror")?.textContent?.trim());
	}

	private getExpectedRootLocalNames(path: string): string[] {
		const normalizedPath = this.stripFragmentAndQuery(path).toLowerCase();
		if (normalizedPath.endsWith("container.xml")) {
			return ["container"];
		}
		if (normalizedPath.endsWith(".opf")) {
			return ["package"];
		}
		if (normalizedPath.endsWith(".ncx")) {
			return ["ncx"];
		}
		if (
			normalizedPath.endsWith(".xhtml") ||
			normalizedPath.endsWith(".html") ||
			normalizedPath.endsWith(".htm")
		) {
			return ["html"];
		}
		return [];
	}

	private normalizeInternalHref(baseHref: string, rawHref: string): string {
		const normalizedRawHref = this.normalizeLocationString(rawHref);
		if (!normalizedRawHref) {
			return this.normalizeSectionHref(baseHref);
		}
		if (this.shouldKeepOriginalUrl(normalizedRawHref) && !normalizedRawHref.startsWith("#")) {
			return normalizedRawHref;
		}
		const target = this.splitHrefComponents(normalizedRawHref);
		const basePath = this.stripFragmentAndQuery(baseHref);
		const baseDirectory = this.dirname(basePath);
		const resolvedPath = target.path
			? target.path.startsWith("/")
				? this.normalizePath(target.path.replace(/^\/+/, ""))
				: this.normalizePath(baseDirectory ? `${baseDirectory}/${target.path}` : target.path)
			: this.normalizePath(basePath);
		return `${resolvedPath}${target.query}${target.fragment}`;
	}

	private normalizeSectionHref(href: string): string {
		const normalizedHref = this.normalizeLocationString(href);
		if (!normalizedHref) {
			return "";
		}
		if (this.shouldKeepOriginalUrl(normalizedHref) && !normalizedHref.startsWith("#")) {
			return normalizedHref;
		}
		const strippedHref = this.stripFragmentAndQuery(normalizedHref);
		if (!strippedHref) {
			return "";
		}
		if (
			strippedHref.startsWith("/") ||
			strippedHref === this.packageDocumentPath ||
			this.manifestByHref.has(strippedHref) ||
			Boolean(this.findArchiveEntry(strippedHref))
		) {
			return strippedHref;
		}
		return this.stripFragmentAndQuery(
			this.normalizeInternalHref(this.packageDocumentPath || normalizedHref, normalizedHref)
		);
	}

	private stripFragmentAndQuery(href: string): string {
		return this.normalizePath(this.splitHrefComponents(href).path);
	}

	private findArchiveEntry(path: string): JSZip.JSZipObject | null {
		if (!this.archive) {
			return null;
		}

		for (const candidate of this.getArchivePathCandidates(path)) {
			const entry = this.archive.file(candidate);
			if (entry) {
				return entry;
			}
		}

		for (const candidate of this.getArchivePathCandidates(path)) {
			const matchedPath = this.archiveEntryLookup.get(candidate.toLowerCase());
			if (!matchedPath) {
				continue;
			}
			const entry = this.archive.file(matchedPath);
			if (entry) {
				return entry;
			}
		}

		return null;
	}

	private rebuildArchiveEntryLookup(): void {
		this.archiveEntryLookup.clear();
		if (!this.archive) {
			return;
		}

		this.archive.forEach((relativePath, entry) => {
			if (entry.dir) {
				return;
			}
			const normalizedPath = this.normalizePath(relativePath);
			if (!normalizedPath) {
				return;
			}
			this.archiveEntryLookup.set(normalizedPath.toLowerCase(), relativePath);
			this.archiveEntryLookup.set(`/${normalizedPath}`.toLowerCase(), relativePath);
		});
	}

	private getArchivePathCandidates(path: string): string[] {
		const normalized = this.normalizePath(path);
		if (!normalized) {
			return [];
		}

		const candidates = new Set<string>([normalized]);
		if (normalized.startsWith("/")) {
			candidates.add(normalized.slice(1));
		} else {
			candidates.add(`/${normalized}`);
		}
		return Array.from(candidates).filter(Boolean);
	}

	private extractHrefFragment(href: string): string | null {
		const fragment = this.splitHrefComponents(href).fragment.replace(/^#/, "").trim();
		if (!fragment) {
			return null;
		}
		try {
			return decodeURIComponent(fragment);
		} catch (_error) {
			return fragment;
		}
	}

	private dirname(path: string): string {
		const normalized = this.normalizePath(path);
		const lastSlashIndex = normalized.lastIndexOf("/");
		return lastSlashIndex >= 0 ? normalized.slice(0, lastSlashIndex) : "";
	}

	private normalizePath(path: string): string {
		const normalized = String(path || "").replace(/\\/g, "/");
		const isAbsolute = normalized.startsWith("/");
		const parts = normalized.split("/");
		const output: string[] = [];
		for (const part of parts) {
			if (!part || part === ".") {
				continue;
			}
			if (part === "..") {
				if (output.length > 0) {
					output.pop();
				}
				continue;
			}
			output.push(part);
		}
		return `${isAbsolute ? "/" : ""}${output.join("/")}`;
	}

	private normalizeLocationString(value: string): string {
		let normalized = String(value || "")
			.replace(/%5B/gi, "[")
			.replace(/%5D/gi, "]")
			.replace(/%7C/gi, "|");
		if (normalized.includes("%")) {
			try {
				normalized = decodeURIComponent(normalized);
			} catch (_error) {
				// Keep the original string when decoding fails.
			}
		}
		return normalized.trim();
	}

	private shouldKeepOriginalUrl(value: string): boolean {
		const normalized = value.trim().toLowerCase();
		return (
			normalized.startsWith("data:") ||
			normalized.startsWith("blob:") ||
			normalized.startsWith("//") ||
			/^[a-z][a-z0-9+.-]*:/i.test(normalized) ||
			normalized.startsWith("#")
		);
	}

	private isDocumentHrefLike(value: string): boolean {
		const path = this.stripFragmentAndQuery(value).toLowerCase();
		return path.endsWith(".xhtml") || path.endsWith(".html") || path.endsWith(".htm");
	}

	private inferMimeType(href: string): string {
		const path = this.stripFragmentAndQuery(href).toLowerCase();
		if (path.endsWith(".xhtml") || path.endsWith(".html") || path.endsWith(".htm")) {
			return "application/xhtml+xml";
		}
		if (path.endsWith(".ncx")) {
			return "application/x-dtbncx+xml";
		}
		if (path.endsWith(".opf")) {
			return "application/oebps-package+xml";
		}
		if (path.endsWith(".css")) {
			return "text/css";
		}
		if (path.endsWith(".js") || path.endsWith(".mjs")) {
			return "text/javascript";
		}
		if (path.endsWith(".svg")) {
			return "image/svg+xml";
		}
		if (path.endsWith(".png")) {
			return "image/png";
		}
		if (path.endsWith(".jpg") || path.endsWith(".jpeg")) {
			return "image/jpeg";
		}
		if (path.endsWith(".gif")) {
			return "image/gif";
		}
		if (path.endsWith(".webp")) {
			return "image/webp";
		}
		if (path.endsWith(".avif")) {
			return "image/avif";
		}
		if (path.endsWith(".mp3")) {
			return "audio/mpeg";
		}
		if (path.endsWith(".m4a")) {
			return "audio/mp4";
		}
		if (path.endsWith(".ogg") || path.endsWith(".oga")) {
			return "audio/ogg";
		}
		if (path.endsWith(".mp4") || path.endsWith(".m4v")) {
			return "video/mp4";
		}
		if (path.endsWith(".webm")) {
			return "video/webm";
		}
		if (path.endsWith(".ttf")) {
			return "font/ttf";
		}
		if (path.endsWith(".otf")) {
			return "font/otf";
		}
		if (path.endsWith(".woff")) {
			return "font/woff";
		}
		if (path.endsWith(".woff2")) {
			return "font/woff2";
		}
		if (path.endsWith(".xml")) {
			return "application/xml";
		}
		return "application/octet-stream";
	}

	private readableTitleFromHref(href: string): string {
		const path = this.stripFragmentAndQuery(href);
		const lastSegment = path.split("/").pop() || path;
		const withoutExtension = lastSegment.replace(/\.[^.]+$/, "");
		const normalized = withoutExtension.replace(/[_-]+/g, " ").trim();
		if (!normalized) {
			return "章节";
		}
		try {
			return decodeURIComponent(normalized);
		} catch (_error) {
			return normalized;
		}
	}

	private buildCssSelector(element: Element): string {
		const segments: string[] = [];
		let current: Element | null = element;
		while (current) {
			const localName = (current.localName || current.tagName).toLowerCase();
			if (current.id) {
				segments.unshift(`#${CSS.escape(current.id)}`);
				break;
			}
			let selector = localName;
			if (current.parentElement) {
				const sameTagSiblings = Array.from(current.parentElement.children).filter(
					(sibling) => (sibling.localName || sibling.tagName).toLowerCase() === localName
				);
				if (sameTagSiblings.length > 1) {
					const index = sameTagSiblings.indexOf(current) + 1;
					selector += `:nth-of-type(${index})`;
				}
			}
			segments.unshift(selector);
			if (localName === "body" || localName === "html") {
				break;
			}
			current = current.parentElement;
		}
		return segments.join(" > ");
	}

	private isBlockElement(element: Element): boolean {
		return new Set([
			"ADDRESS",
			"ARTICLE",
			"ASIDE",
			"BLOCKQUOTE",
			"BODY",
			"CAPTION",
			"DIV",
			"DL",
			"DD",
			"DT",
			"FIGCAPTION",
			"FIGURE",
			"FOOTER",
			"FORM",
			"H1",
			"H2",
			"H3",
			"H4",
			"H5",
			"H6",
			"HEADER",
			"HR",
			"LI",
			"MAIN",
			"NAV",
			"OL",
			"P",
			"PRE",
			"SECTION",
			"TABLE",
			"TBODY",
			"TD",
			"TFOOT",
			"TH",
			"THEAD",
			"TR",
			"UL",
		]).has((element.tagName || "").toUpperCase());
	}

	private clamp(value: number, min: number, max: number): number {
		return Math.max(min, Math.min(max, value));
	}

	private splitHrefComponents(value: string): { path: string; query: string; fragment: string } {
		const normalized = this.normalizeLocationString(value);
		const hashIndex = normalized.indexOf("#");
		const queryIndex = normalized.indexOf("?");
		let pathEnd = normalized.length;
		if (queryIndex >= 0) {
			pathEnd = Math.min(pathEnd, queryIndex);
		}
		if (hashIndex >= 0) {
			pathEnd = Math.min(pathEnd, hashIndex);
		}
		const path = normalized.slice(0, pathEnd);
		const query =
			queryIndex >= 0
				? normalized.slice(
						queryIndex,
						hashIndex >= 0 && queryIndex < hashIndex ? hashIndex : undefined
				  )
				: "";
		const fragment = hashIndex >= 0 ? normalized.slice(hashIndex) : "";
		return { path, query, fragment };
	}
}
