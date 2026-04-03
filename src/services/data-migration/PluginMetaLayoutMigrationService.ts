import type { App } from "obsidian";
import { getLegacyPluginPaths, getPluginPaths } from "../../config/paths";
import { DirectoryUtils } from "../../utils/directory-utils";
import { logger } from "../../utils/logger";

interface MetaMoveTarget {
	label: string;
	from: string;
	to: string;
	kind: "file" | "dir";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class PluginMetaLayoutMigrationService {
	constructor(private app: App) {}

	async normalize(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const pluginPaths = getPluginPaths(this.app);
		const legacyPaths = getLegacyPluginPaths(this.app);

		await DirectoryUtils.ensureDirRecursive(adapter, pluginPaths.cache.root);
		await DirectoryUtils.ensureDirRecursive(adapter, pluginPaths.state.root);

		const moves: MetaMoveTarget[] = [
			{
				label: "indices",
				from: legacyPaths.indices,
				to: pluginPaths.indices.root,
				kind: "dir",
			},
			{
				label: "migration",
				from: legacyPaths.migration,
				to: pluginPaths.migration.root,
				kind: "dir",
			},
			{
				label: "config/user-profile",
				from: legacyPaths.config.userProfile,
				to: pluginPaths.state.userProfile,
				kind: "file",
			},
			{
				label: "user-profile",
				from: legacyPaths.userProfile,
				to: pluginPaths.state.userProfile,
				kind: "file",
			},
			{
				label: "importMappings",
				from: legacyPaths.importMappings,
				to: pluginPaths.state.importMappings,
				kind: "file",
			},
			{
				label: "quality-inbox",
				from: legacyPaths.qualityInbox,
				to: pluginPaths.state.qualityInbox,
				kind: "file",
			},
		];

		for (const move of moves) {
			if (move.kind === "dir") {
				await this.normalizeDirectory(move);
			} else {
				await this.normalizeFile(move);
			}
		}

		await this.normalizeLegacyUiStateFile();
	}

	private async normalizeDirectory(move: MetaMoveTarget): Promise<void> {
		const adapter = this.app.vault.adapter;
		try {
			if (move.from === move.to || !(await adapter.exists(move.from))) {
				return;
			}

			await DirectoryUtils.ensureDirRecursive(adapter, move.to);
			await this.mergeDirectory(move.from, move.to);
			await this.removeEmptyDirChain(move.from, getLegacyPluginPaths(this.app).root);
			logger.info(`[PluginMetaLayout] 已迁移目录 ${move.label}: ${move.from} -> ${move.to}`);
		} catch (error) {
			logger.warn(`[PluginMetaLayout] 迁移目录失败 ${move.label}: ${move.from}`, error);
		}
	}

	private async normalizeFile(move: MetaMoveTarget): Promise<void> {
		const adapter = this.app.vault.adapter;
		try {
			if (move.from === move.to || !(await adapter.exists(move.from))) {
				return;
			}

			await DirectoryUtils.ensureDirForFile(adapter, move.to);
			const sourceContent = await adapter.read(move.from);

			if (!(await adapter.exists(move.to))) {
				await adapter.write(move.to, sourceContent);
			} else {
				const targetContent = await adapter.read(move.to);
				if (targetContent !== sourceContent) {
					await this.writeConflictSnapshot(move.from, sourceContent);
					logger.warn(
						`[PluginMetaLayout] 检测到 ${move.label} 冲突，已保留新路径并写入冲突快照: ${move.to}`
					);
				}
			}

			await adapter.remove(move.from);
			await this.removeEmptyDirChain(
				this.parentPath(move.from),
				getLegacyPluginPaths(this.app).root
			);
			logger.info(`[PluginMetaLayout] 已迁移文件 ${move.label}: ${move.from} -> ${move.to}`);
		} catch (error) {
			logger.warn(`[PluginMetaLayout] 迁移文件失败 ${move.label}: ${move.from}`, error);
		}
	}

	private async mergeDirectory(fromRoot: string, toRoot: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		const listing = await adapter.list(fromRoot);

		for (const folder of listing.folders || []) {
			const name = folder.split("/").pop();
			if (!name) continue;
			const targetFolder = `${toRoot}/${name}`;
			await DirectoryUtils.ensureDirRecursive(adapter, targetFolder);
			await this.mergeDirectory(folder, targetFolder);
		}

		for (const file of listing.files || []) {
			const name = file.split("/").pop();
			if (!name) continue;
			const targetFile = `${toRoot}/${name}`;
			const sourceContent = await adapter.read(file);

			if (!(await adapter.exists(targetFile))) {
				await adapter.write(targetFile, sourceContent);
			} else {
				const targetContent = await adapter.read(targetFile);
				if (targetContent !== sourceContent) {
					await this.writeConflictSnapshot(file, sourceContent);
				}
			}

			await adapter.remove(file);
		}
	}

	private async writeConflictSnapshot(sourcePath: string, content: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		const conflictRoot = `${getPluginPaths(this.app).migration.root}/legacy-meta-conflicts`;
		await DirectoryUtils.ensureDirRecursive(adapter, conflictRoot);
		const safeName = sourcePath.replace(/[\\/:]/g, "__");
		const target = `${conflictRoot}/${Date.now()}-${safeName}`;
		await adapter.write(target, content);
	}

	private async normalizeLegacyUiStateFile(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const legacyPath = getLegacyPluginPaths(this.app).uiState;
		const targetPath = getPluginPaths(this.app).state.localStorage;

		try {
			if (!(await adapter.exists(legacyPath))) {
				return;
			}

			const legacyContent = await adapter.read(legacyPath);
			let legacyDeckView: string | null = null;

			try {
				const parsed = JSON.parse(legacyContent) as unknown;
				if (isRecord(parsed) && typeof parsed.deckView === "string") {
					legacyDeckView = parsed.deckView;
				}
			} catch (error) {
				logger.warn("[PluginMetaLayout] 读取旧 ui-state.json 失败，已保留冲突快照", error);
			}

			if (legacyDeckView) {
				const targetEntries = await this.readStringMapFile(targetPath);
				const currentDeckView = targetEntries["weave-deck-view"];

				if (!currentDeckView) {
					targetEntries["weave-deck-view"] = legacyDeckView;
					await DirectoryUtils.ensureDirForFile(adapter, targetPath);
					await adapter.write(targetPath, JSON.stringify(targetEntries, null, 2));
					logger.info(`[PluginMetaLayout] 已将旧 ui-state.json 合并到 ${targetPath}`);
				} else if (currentDeckView !== legacyDeckView) {
					await this.writeConflictSnapshot(legacyPath, legacyContent);
					logger.warn(
						"[PluginMetaLayout] 检测到旧 ui-state.json 与 local-storage.json 冲突，已保留新状态并写入快照"
					);
				}
			} else if (legacyContent.trim().length > 0) {
				await this.writeConflictSnapshot(legacyPath, legacyContent);
			}

			await adapter.remove(legacyPath);
			await this.removeEmptyDirChain(
				this.parentPath(legacyPath),
				getPluginPaths(this.app).state.root
			);
		} catch (error) {
			logger.warn(`[PluginMetaLayout] 迁移旧 ui-state.json 失败: ${legacyPath}`, error);
		}
	}

	private async readStringMapFile(path: string): Promise<Record<string, string>> {
		const adapter = this.app.vault.adapter;
		try {
			if (!(await adapter.exists(path))) {
				return {};
			}

			const parsed = JSON.parse(await adapter.read(path)) as unknown;
			if (!isRecord(parsed)) {
				return {};
			}

			const normalized: Record<string, string> = {};
			for (const [key, value] of Object.entries(parsed)) {
				if (typeof value === "string") {
					normalized[key] = value;
				}
			}
			return normalized;
		} catch (error) {
			logger.warn(`[PluginMetaLayout] 读取字符串映射失败: ${path}`, error);
			return {};
		}
	}

	private async removeEmptyDirChain(path: string, stopAt: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		let current = path;

		while (current && current !== stopAt) {
			try {
				if (!(await adapter.exists(current))) {
					break;
				}
				const listing = await adapter.list(current);
				if ((listing.files?.length || 0) > 0 || (listing.folders?.length || 0) > 0) {
					break;
				}
				await adapter.rmdir(current, false);
			} catch {
				break;
			}

			current = this.parentPath(current);
		}
	}

	private parentPath(path: string): string {
		const slash = path.lastIndexOf("/");
		return slash > 0 ? path.slice(0, slash) : "";
	}
}

export async function normalizePluginMetaLayout(app: App): Promise<void> {
	const service = new PluginMetaLayoutMigrationService(app);
	await service.normalize();
}
