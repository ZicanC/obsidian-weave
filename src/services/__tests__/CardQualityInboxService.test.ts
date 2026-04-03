import { CardType } from '../../data/types';
import { CardQualityInboxService } from '../card-quality/CardQualityInboxService';

describe('CardQualityInboxService', () => {
	it('does not flag existing EPUB sources as missing when we_source contains EPUB links', async () => {
		const service = new CardQualityInboxService({
			app: {
				vault: {
					getAbstractFileByPath(path: string) {
						return path === 'Books/demo.epub' ? ({ path } as any) : null;
					},
				},
			},
		} as any);

		const card = {
			uuid: 'card-1',
			type: CardType.Basic,
			content: `---
we_source:
  - '[[notes/source.md]]'
  - '[[Books/demo.epub#weave-cfi=readium%3Aabc&chapter=3&text=Hello%20world|Demo]]'
---
Question

---div---

Answer`,
		} as any;

		const result = await service.scanCards([card], {
			detectDuplicates: false,
			detectEmpty: false,
			detectShort: false,
			detectLong: false,
			detectOrphans: false,
			detectMissingSource: true,
			detectFSRSIssues: false,
		});

		expect(result.issues.filter((issue) => issue.type === 'source_missing')).toHaveLength(0);
	});
});
