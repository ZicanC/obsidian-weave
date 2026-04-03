export type ReadiumPaginationAxis = "horizontal" | "vertical";

export interface ReadiumPaginatedFrameMetrics {
	writingMode?: string | null;
	direction?: string | null;
	scrollLeft: number;
	scrollTop: number;
	scrollWidth: number;
	scrollHeight: number;
	viewportWidth: number;
	viewportHeight: number;
}

export interface ReadiumPaginatedFrameSnapshot {
	axis: ReadiumPaginationAxis;
	currentOffset: number;
	minOffset: number;
	maxOffset: number;
	viewportExtent: number;
	contentExtent: number;
	startProgression: number;
	endProgression: number;
	canGoForward: boolean;
	canGoBackward: boolean;
	targetForwardOffset: number | null;
	targetBackwardOffset: number | null;
	targetForwardProgression: number | null;
	targetBackwardProgression: number | null;
}

const PAGE_TURN_TOLERANCE_PX = 2;

export function buildReadiumPaginatedFrameSnapshot(
	metrics: ReadiumPaginatedFrameMetrics
): ReadiumPaginatedFrameSnapshot {
	const viewportWidth = Math.max(0, Math.round(metrics.viewportWidth || 0));
	const viewportHeight = Math.max(0, Math.round(metrics.viewportHeight || 0));
	const scrollWidth = Math.max(viewportWidth, Math.round(metrics.scrollWidth || 0));
	const scrollHeight = Math.max(viewportHeight, Math.round(metrics.scrollHeight || 0));
	const horizontalOverflow = Math.max(0, scrollWidth - viewportWidth);
	const verticalOverflow = Math.max(0, scrollHeight - viewportHeight);
	const axis = resolvePaginationAxis(metrics.writingMode, horizontalOverflow, verticalOverflow);

	if (axis === "vertical") {
		const currentOffset = clamp(metrics.scrollTop || 0, 0, verticalOverflow);
		const targetForwardOffset =
			currentOffset < verticalOverflow - PAGE_TURN_TOLERANCE_PX
				? clamp(currentOffset + viewportHeight, 0, verticalOverflow)
				: null;
		const targetBackwardOffset =
			currentOffset > PAGE_TURN_TOLERANCE_PX
				? clamp(currentOffset - viewportHeight, 0, verticalOverflow)
				: null;
		return {
			axis,
			currentOffset,
			minOffset: 0,
			maxOffset: verticalOverflow,
			viewportExtent: viewportHeight,
			contentExtent: scrollHeight,
			startProgression: progressionForOffset(currentOffset, scrollHeight),
			endProgression: progressionForOffset(currentOffset + viewportHeight, scrollHeight),
			canGoForward: targetForwardOffset !== null,
			canGoBackward: targetBackwardOffset !== null,
			targetForwardOffset,
			targetBackwardOffset,
			targetForwardProgression:
				targetForwardOffset === null
					? null
					: progressionForOffset(targetForwardOffset, scrollHeight),
			targetBackwardProgression:
				targetBackwardOffset === null
					? null
					: progressionForOffset(targetBackwardOffset, scrollHeight),
		};
	}

	const isRtl =
		String(metrics.direction || "")
			.trim()
			.toLowerCase() === "rtl";
	const minOffset = isRtl ? -horizontalOverflow : 0;
	const maxOffset = isRtl ? 0 : horizontalOverflow;
	const currentOffset = clamp(metrics.scrollLeft || 0, minOffset, maxOffset);
	const targetForwardOffset = isRtl
		? currentOffset > minOffset + PAGE_TURN_TOLERANCE_PX
			? clamp(currentOffset - viewportWidth, minOffset, maxOffset)
			: null
		: currentOffset < maxOffset - PAGE_TURN_TOLERANCE_PX
		? clamp(currentOffset + viewportWidth, minOffset, maxOffset)
		: null;
	const targetBackwardOffset = isRtl
		? currentOffset < maxOffset - PAGE_TURN_TOLERANCE_PX
			? clamp(currentOffset + viewportWidth, minOffset, maxOffset)
			: null
		: currentOffset > minOffset + PAGE_TURN_TOLERANCE_PX
		? clamp(currentOffset - viewportWidth, minOffset, maxOffset)
		: null;

	return {
		axis,
		currentOffset,
		minOffset,
		maxOffset,
		viewportExtent: viewportWidth,
		contentExtent: scrollWidth,
		startProgression: progressionForOffset(
			isRtl ? Math.abs(currentOffset) : currentOffset,
			scrollWidth
		),
		endProgression: progressionForOffset(
			(isRtl ? Math.abs(currentOffset) : currentOffset) + viewportWidth,
			scrollWidth
		),
		canGoForward: targetForwardOffset !== null,
		canGoBackward: targetBackwardOffset !== null,
		targetForwardOffset,
		targetBackwardOffset,
		targetForwardProgression:
			targetForwardOffset === null
				? null
				: progressionForOffset(
						isRtl ? Math.abs(targetForwardOffset) : targetForwardOffset,
						scrollWidth
				  ),
		targetBackwardProgression:
			targetBackwardOffset === null
				? null
				: progressionForOffset(
						isRtl ? Math.abs(targetBackwardOffset) : targetBackwardOffset,
						scrollWidth
				  ),
	};
}

function resolvePaginationAxis(
	writingMode: string | null | undefined,
	horizontalOverflow: number,
	verticalOverflow: number
): ReadiumPaginationAxis {
	const normalizedWritingMode = String(writingMode || "")
		.trim()
		.toLowerCase();
	if (
		normalizedWritingMode.startsWith("vertical-") ||
		normalizedWritingMode.startsWith("sideways-")
	) {
		return "vertical";
	}

	if (
		verticalOverflow > PAGE_TURN_TOLERANCE_PX &&
		verticalOverflow > horizontalOverflow + PAGE_TURN_TOLERANCE_PX
	) {
		return "vertical";
	}

	return "horizontal";
}

function progressionForOffset(offset: number, extent: number): number {
	if (extent <= 0) {
		return 0;
	}
	return clamp(offset / extent, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
