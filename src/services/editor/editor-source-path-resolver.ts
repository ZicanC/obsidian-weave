import { normalizePath } from "obsidian";
import type { IRActiveBlockContext } from "../../stores/ir-active-block-context-store";
import { logger } from "../../utils/logger";
import { isDetachedEditorTempFilePath } from "./editor-temp-file-policy";

export interface ResolveEditorSourcePathOptions {
	sourcePath?: string | null;
	preferBlockContext?: boolean;
	resolveMissingSourcePath?: boolean;
	logScope?: string;
}

export interface EditorSourcePathResolution {
	sourcePath?: string;
	blockContext: IRActiveBlockContext | null;
	resolvedFrom: "original" | "block-context" | "active-document" | "unresolved";
}

function normalizeSourcePath(path?: string | null): string | undefined {
	if (typeof path !== "string") {
		return undefined;
	}

	const trimmedPath = path.trim();
	if (!trimmedPath) {
		return undefined;
	}

	return normalizePath(trimmedPath);
}

function logSourceResolutionWarning(
	logScope: string | undefined,
	message: string,
	error: unknown
): void {
	if (!logScope) {
		return;
	}

	logger.warn(`${logScope} ${message}:`, error);
}

export async function resolveEditorSourcePathFromIR(
	options: ResolveEditorSourcePathOptions = {}
): Promise<EditorSourcePathResolution> {
	const resolveMissingSourcePath = options.resolveMissingSourcePath ?? true;
	let sourcePath = normalizeSourcePath(options.sourcePath);
	let blockContext: IRActiveBlockContext | null = null;
	let resolvedFrom: EditorSourcePathResolution["resolvedFrom"] = sourcePath
		? "original"
		: "unresolved";

	const shouldCheckBlockContext =
		options.preferBlockContext ||
		isDetachedEditorTempFilePath(sourcePath) ||
		(!sourcePath && resolveMissingSourcePath);

	if (shouldCheckBlockContext) {
		try {
			const { irActiveBlockContextStore } = await import(
				"../../stores/ir-active-block-context-store"
			);
			blockContext = irActiveBlockContextStore.getActiveContext();

			const blockSourcePath = normalizeSourcePath(blockContext?.sourcePath);
			if (blockSourcePath) {
				sourcePath = blockSourcePath;
				resolvedFrom = "block-context";
			}
		} catch (error) {
			logSourceResolutionWarning(options.logScope, "无法读取 IR 块上下文信息", error);
		}
	}

	const shouldCheckActiveDocument =
		isDetachedEditorTempFilePath(sourcePath) || (!sourcePath && resolveMissingSourcePath);

	if (shouldCheckActiveDocument) {
		try {
			const { irActiveDocumentStore } = await import("../../stores/ir-active-document-store");
			const activeDocumentPath = normalizeSourcePath(irActiveDocumentStore.getActiveDocument());
			if (activeDocumentPath) {
				sourcePath = activeDocumentPath;
				resolvedFrom = "active-document";
			}
		} catch (error) {
			logSourceResolutionWarning(options.logScope, "无法读取 IR 活动文档信息", error);
		}
	}

	if (!sourcePath) {
		resolvedFrom = "unresolved";
	}

	return {
		sourcePath,
		blockContext,
		resolvedFrom,
	};
}
