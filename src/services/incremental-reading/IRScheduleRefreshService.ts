import type { App } from "obsidian";
import { logger } from "../../utils/logger";
import {
	IRScheduleKernel,
	type RecomputeOptions,
	type ScheduleRecomputeReason,
} from "./IRScheduleKernel";

export const IR_DATA_UPDATED_EVENT = "Weave:ir-data-updated";

type UpdatedEventDetail = {
	reason: ScheduleRecomputeReason;
	generatedAt: number;
	deckIds?: string[];
};

const kernelByApp = new WeakMap<App, IRScheduleKernel>();

function getKernel(app: App): IRScheduleKernel {
	let kernel = kernelByApp.get(app);
	if (!kernel) {
		kernel = new IRScheduleKernel(app);
		kernelByApp.set(app, kernel);
	}
	return kernel;
}

export async function recomputeAndBroadcastIRData(
	app: App,
	reason: ScheduleRecomputeReason,
	options?: RecomputeOptions
): Promise<void> {
	try {
		const kernel = getKernel(app);
		const schedule = await kernel.recomputeScheduleForDeck(reason, options);
		window.dispatchEvent(
			new CustomEvent<UpdatedEventDetail>(IR_DATA_UPDATED_EVENT, {
				detail: {
					reason,
					generatedAt: schedule.generatedAt,
					deckIds: schedule.deckIds,
				},
			})
		);
	} catch (error) {
		logger.error("[IRScheduleRefreshService] 重排并广播失败:", { reason, options, error });
		window.dispatchEvent(
			new CustomEvent<UpdatedEventDetail>(IR_DATA_UPDATED_EVENT, {
				detail: {
					reason,
					generatedAt: Date.now(),
					deckIds: options?.deckIds,
				},
			})
		);
	}
}
