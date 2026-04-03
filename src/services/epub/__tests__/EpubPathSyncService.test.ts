import { rewriteEpubReferences } from '../EpubPathSyncService';

describe('rewriteEpubReferences', () => {
	it('rewrites legacy weave-epub protocol links without truncating CFI parentheses', () => {
		const content =
			'[EPUB来源](obsidian://weave-epub?vault=Vault&file=Books%2Fold.epub&cfi=epubcfi(/6/2)&text=Hello)';

		const result = rewriteEpubReferences(content, 'Books/old.epub', 'Books/new.epub');

		expect(result.changed).toBe(true);
		expect(result.updatedLinks).toBe(1);
		expect(result.content).toBe(
			'[EPUB来源](obsidian://weave-epub?vault=Vault&file=Books%2Fnew.epub&cfi=epubcfi(/6/2)&text=Hello)',
		);
	});
});
