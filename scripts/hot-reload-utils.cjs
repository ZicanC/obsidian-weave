const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_RUNTIME_EXTENSIONS = new Set([".js", ".css", ".json", ".wasm"]);
const DEFAULT_PRUNABLE_RUNTIME_FILES = new Set([
	"main.js",
	"main.js.map",
	"styles.css",
	"styles.css.map",
	"manifest.json",
]);

function readEnvValueFromDotEnv(key) {
	const envPath = path.join(PROJECT_ROOT, ".env");
	if (!fs.existsSync(envPath)) {
		return null;
	}

	try {
		const parsed = dotenv.parse(fs.readFileSync(envPath, "utf8"));
		const value = parsed[key];
		return typeof value === "string" && value.trim() ? value.trim() : null;
	} catch {
		return null;
	}
}

function resolveVaultPath(processEnv = process.env) {
	return processEnv.OBSIDIAN_VAULT_PATH?.trim() || readEnvValueFromDotEnv("OBSIDIAN_VAULT_PATH");
}

function resolvePluginDir(pluginId, processEnv = process.env) {
	const vaultPath = resolveVaultPath(processEnv);
	if (!vaultPath) {
		return null;
	}

	return path.resolve(vaultPath, "plugins", pluginId);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function listRuntimeFiles(sourceDir, runtimeExtensions = DEFAULT_RUNTIME_EXTENSIONS) {
	if (!fs.existsSync(sourceDir)) {
		return [];
	}

	return fs
		.readdirSync(sourceDir, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.filter((name) => runtimeExtensions.has(path.extname(name).toLowerCase()))
		.sort((a, b) => a.localeCompare(b));
}

async function copyFileAtomicWithRetry(
	sourceFile,
	targetFile,
	{ retries = 24, delayMs = 180 } = {}
) {
	if (path.resolve(sourceFile) === path.resolve(targetFile)) {
		return false;
	}

	const tempFile = path.join(
		path.dirname(targetFile),
		`.weave-sync-${process.pid}-${Date.now()}-${path.basename(targetFile)}`
	);

	for (let attempt = 0; attempt <= retries; attempt += 1) {
		try {
			fs.mkdirSync(path.dirname(targetFile), { recursive: true });
			fs.copyFileSync(sourceFile, tempFile);

			if (fs.existsSync(targetFile)) {
				fs.rmSync(targetFile, { force: true });
			}

			fs.renameSync(tempFile, targetFile);
			return true;
		} catch (error) {
			try {
				if (fs.existsSync(tempFile)) {
					fs.rmSync(tempFile, { force: true });
				}
			} catch {}

			const code = error?.code;
			if (
				(code === "EBUSY" ||
					code === "EPERM" ||
					code === "ENOTEMPTY" ||
					code === "EMFILE" ||
					code === "ENOENT") &&
				attempt < retries
			) {
				await sleep(delayMs);
				continue;
			}

			throw error;
		}
	}

	return false;
}

function pruneManagedRuntimeFiles(
	targetDir,
	keepFiles = new Set(),
	managedFiles = DEFAULT_PRUNABLE_RUNTIME_FILES
) {
	if (!fs.existsSync(targetDir)) {
		return [];
	}

	const removed = [];

	for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
		if (!entry.isFile()) {
			continue;
		}

		if (!managedFiles.has(entry.name) || keepFiles.has(entry.name)) {
			continue;
		}

		fs.rmSync(path.join(targetDir, entry.name), { force: true });
		removed.push(entry.name);
	}

	return removed.sort((a, b) => a.localeCompare(b));
}

async function syncRuntimeFiles(
	sourceDir,
	targetDir,
	{
		runtimeExtensions = DEFAULT_RUNTIME_EXTENSIONS,
		retries = 24,
		delayMs = 180,
		pruneStaleManagedFiles = false,
		managedFiles = DEFAULT_PRUNABLE_RUNTIME_FILES,
	} = {}
) {
	const runtimeFiles = listRuntimeFiles(sourceDir, runtimeExtensions);
	const copied = [];

	for (const fileName of runtimeFiles) {
		const copiedFile = await copyFileAtomicWithRetry(
			path.join(sourceDir, fileName),
			path.join(targetDir, fileName),
			{ retries, delayMs }
		);

		if (copiedFile) {
			copied.push(fileName);
		}
	}

	const removed = pruneStaleManagedFiles
		? pruneManagedRuntimeFiles(targetDir, new Set(runtimeFiles), managedFiles)
		: [];

	return {
		runtimeFiles,
		copied,
		removed,
	};
}

module.exports = {
	DEFAULT_PRUNABLE_RUNTIME_FILES,
	DEFAULT_RUNTIME_EXTENSIONS,
	PROJECT_ROOT,
	copyFileAtomicWithRetry,
	listRuntimeFiles,
	pruneManagedRuntimeFiles,
	readEnvValueFromDotEnv,
	resolvePluginDir,
	resolveVaultPath,
	syncRuntimeFiles,
};
