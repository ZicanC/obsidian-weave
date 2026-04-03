import { normalizePath } from "obsidian";
import type { Card } from "../../data/types";
import type { ReadingMaterial } from "../../types/incremental-reading-types";
import { extractAllSourcePaths, normalizePathForComparison } from "../../utils/source-path-matcher";

export interface IRAssociatedNoteSignal {
	notePath: string;
	cardCount: number;
	averagePriority: number;
	maxPriority: number;
	prioritySignal: number;
}

export type IRAssociatedNoteSignalIndex = Map<string, IRAssociatedNoteSignal>;

function roundValue(value: number): number {
	return Math.round(value * 10) / 10;
}

function clampCardPriority(value: number | undefined): number {
	if (typeof value !== "number" || Number.isNaN(value)) {
		return 2;
	}
	return Math.max(1, Math.min(4, value));
}

function hasExplicitExtension(path: string): boolean {
	return /\.[^/.]+$/i.test(path);
}

function isMarkdownPath(path: string): boolean {
	const normalized = normalizePath(path.trim());
	if (!normalized) {
		return false;
	}

	if (normalized.toLowerCase().endsWith(".md")) {
		return true;
	}

	// Obsidian wikilink can omit ".md". Treat extensionless paths as markdown notes.
	return !hasExplicitExtension(normalized);
}

function normalizeNotePath(path: string | undefined | null): string | null {
	if (!path || typeof path !== "string") {
		return null;
	}
	const normalized = normalizePath(path.trim());
	if (!normalized || !isMarkdownPath(normalized)) {
		return null;
	}
	return normalized;
}

function toAssociatedNoteKey(path: string | undefined | null): string | null {
	const normalized = normalizeNotePath(path);
	if (!normalized) {
		return null;
	}
	const key = normalizePathForComparison(normalized);
	return key || null;
}

function collectCardSourceNoteKeys(card: Card): string[] {
	const keys = new Set<string>();

	for (const sourcePath of extractAllSourcePaths(card)) {
		const key = toAssociatedNoteKey(sourcePath);
		if (key) {
			keys.add(key);
		}
	}

	const fallbackKey = toAssociatedNoteKey(card.sourceFile);
	if (fallbackKey) {
		keys.add(fallbackKey);
	}

	return Array.from(keys);
}

function isMemoryCard(card: Card): boolean {
	return card.cardPurpose !== "test";
}

export function resolveAssociatedNotePath(
	material?: Pick<ReadingMaterial, "associatedNotePath"> | null
): string | undefined {
	return normalizeNotePath(material?.associatedNotePath) ?? undefined;
}

export function buildAssociatedNoteSignalIndex(cards: Card[]): IRAssociatedNoteSignalIndex {
	const aggregates = new Map<string, { count: number; prioritySum: number; maxPriority: number }>();

	for (const card of cards) {
		if (!isMemoryCard(card)) {
			continue;
		}

		const noteKeys = collectCardSourceNoteKeys(card);
		if (noteKeys.length === 0) {
			continue;
		}

		const cardPriority = clampCardPriority(card.priority);
		for (const noteKey of noteKeys) {
			const current = aggregates.get(noteKey) ?? { count: 0, prioritySum: 0, maxPriority: 1 };
			current.count += 1;
			current.prioritySum += cardPriority;
			current.maxPriority = Math.max(current.maxPriority, cardPriority);
			aggregates.set(noteKey, current);
		}
	}

	const index: IRAssociatedNoteSignalIndex = new Map();
	for (const [noteKey, aggregate] of aggregates.entries()) {
		const averagePriority = aggregate.prioritySum / aggregate.count;
		const blendedPriority = averagePriority * 0.7 + aggregate.maxPriority * 0.3;
		const normalizedSignal = ((blendedPriority - 1) / 3) * 10;
		const confidenceFactor = aggregate.count <= 1 ? 0.85 : aggregate.count === 2 ? 0.93 : 1;

		index.set(noteKey, {
			notePath: noteKey,
			cardCount: aggregate.count,
			averagePriority: roundValue(averagePriority),
			maxPriority: aggregate.maxPriority,
			prioritySignal: roundValue(Math.max(0, Math.min(10, normalizedSignal * confidenceFactor))),
		});
	}

	return index;
}

export function getAssociatedNoteSignal(
	index: IRAssociatedNoteSignalIndex,
	notePath?: string | null
): IRAssociatedNoteSignal | undefined {
	const noteKey = toAssociatedNoteKey(notePath);
	if (!noteKey) {
		return undefined;
	}
	return index.get(noteKey);
}
