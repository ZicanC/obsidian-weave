import { buildReadiumPaginatedFrameSnapshot } from '../readiumPaginationSupport';

describe('buildReadiumPaginatedFrameSnapshot', () => {
	it('keeps standard horizontal LTR pagination inside the same resource', () => {
		const snapshot = buildReadiumPaginatedFrameSnapshot({
			writingMode: 'horizontal-tb',
			direction: 'ltr',
			scrollLeft: 800,
			scrollTop: 0,
			scrollWidth: 2400,
			scrollHeight: 900,
			viewportWidth: 800,
			viewportHeight: 900,
		});

		expect(snapshot.axis).toBe('horizontal');
		expect(snapshot.canGoForward).toBe(true);
		expect(snapshot.canGoBackward).toBe(true);
		expect(snapshot.targetForwardOffset).toBe(1600);
		expect(snapshot.targetBackwardOffset).toBe(0);
		expect(snapshot.targetForwardProgression).toBeCloseTo(1600 / 2400, 6);
	});

	it('supports RTL resources without jumping chapters prematurely', () => {
		const snapshot = buildReadiumPaginatedFrameSnapshot({
			writingMode: 'horizontal-tb',
			direction: 'rtl',
			scrollLeft: -800,
			scrollTop: 0,
			scrollWidth: 2400,
			scrollHeight: 900,
			viewportWidth: 800,
			viewportHeight: 900,
		});

		expect(snapshot.axis).toBe('horizontal');
		expect(snapshot.canGoForward).toBe(true);
		expect(snapshot.targetForwardOffset).toBe(-1600);
		expect(snapshot.targetBackwardOffset).toBe(0);
		expect(snapshot.targetForwardProgression).toBeCloseTo(1600 / 2400, 6);
	});

	it('switches to vertical fragmented pagination for vertical writing modes', () => {
		const snapshot = buildReadiumPaginatedFrameSnapshot({
			writingMode: 'vertical-rl',
			direction: 'rtl',
			scrollLeft: 0,
			scrollTop: 900,
			scrollWidth: 900,
			scrollHeight: 2700,
			viewportWidth: 900,
			viewportHeight: 900,
		});

		expect(snapshot.axis).toBe('vertical');
		expect(snapshot.canGoForward).toBe(true);
		expect(snapshot.targetForwardOffset).toBe(1800);
		expect(snapshot.targetBackwardOffset).toBe(0);
		expect(snapshot.targetForwardProgression).toBeCloseTo(1800 / 2700, 6);
	});

	it('falls back to vertical pagination when content only overflows vertically', () => {
		const snapshot = buildReadiumPaginatedFrameSnapshot({
			writingMode: 'horizontal-tb',
			direction: 'ltr',
			scrollLeft: 0,
			scrollTop: 0,
			scrollWidth: 900,
			scrollHeight: 2400,
			viewportWidth: 900,
			viewportHeight: 800,
		});

		expect(snapshot.axis).toBe('vertical');
		expect(snapshot.canGoForward).toBe(true);
		expect(snapshot.targetForwardOffset).toBe(800);
	});
});
