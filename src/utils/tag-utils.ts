/** 标签筛选和聚合工具。 */

import { TagExtractor } from "./tag-extractor";

/** 规范化标签前缀，统一返回不含 `#` 的形式。 */
export function removeHashPrefix(tag: string): string {
	return tag.startsWith("#") ? tag.slice(1) : tag;
}

/** 标签筛选支持精确匹配，也支持父标签匹配其子标签。 */
export function matchesTagFilter(cardTags: string[], selectedTag: string): boolean {
	if (!cardTags || cardTags.length === 0) return false;

	const cleanSelected = removeHashPrefix(selectedTag);

	return cardTags.some((_tag) => {
		const cleanTag = removeHashPrefix(_tag);
		if (cleanTag === cleanSelected) return true;
		return cleanTag.startsWith(`${cleanSelected}/`);
	});
}

/** 统计标签及其祖先路径的去重卡片数。 */
export function calculateTagCounts(
	cards: Array<{ id: string; tags?: string[]; content?: string }>
): { aggregatedCounts: Record<string, number>; allTags: string[] } {
	const tagToCardIds = new Map<string, Set<string>>();
	const allTagPaths = new Set<string>();

	function processTag(cardId: string, tag: string) {
		const cleanTag = removeHashPrefix(tag);
		const parts = cleanTag.split("/").filter(Boolean);
		for (let i = 1; i <= parts.length; i++) {
			const path = parts.slice(0, i).join("/");
			allTagPaths.add(path);
			if (!tagToCardIds.has(path)) {
				tagToCardIds.set(path, new Set());
			}
			tagToCardIds.get(path)?.add(cardId);
		}
	}

	cards.forEach((_card) => {
		if (Array.isArray(_card.tags)) {
			_card.tags.forEach((_tag) => processTag(_card.id, _tag));
		}

		if (typeof _card.content === "string" && _card.content) {
			const contentTags = TagExtractor.extractTagsExcludingCode(_card.content);
			contentTags.forEach((_tag) => processTag(_card.id, _tag));
		}
	});

	const aggregatedCounts: Record<string, number> = {};
	allTagPaths.forEach((_path) => {
		aggregatedCounts[_path] = tagToCardIds.get(_path)?.size || 0;
	});

	return {
		aggregatedCounts,
		allTags: Array.from(allTagPaths),
	};
}
