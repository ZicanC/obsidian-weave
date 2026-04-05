const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const MANIFEST_SOURCE = path.join(PROJECT_ROOT, "manifest.json");
const PLUGIN_ID = "weave";

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

function resolveVaultPath() {
	return process.env.OBSIDIAN_VAULT_PATH?.trim() || readEnvValueFromDotEnv("OBSIDIAN_VAULT_PATH");
}

function resolveTargetDirs() {
	const targets = new Set();
	targets.add(DIST_DIR);

	const vaultPath = resolveVaultPath();
	if (vaultPath) {
		targets.add(path.resolve(vaultPath, "plugins", PLUGIN_ID));
	}

	return [...targets];
}

if (!fs.existsSync(MANIFEST_SOURCE)) {
	console.error(`Manifest source not found: ${MANIFEST_SOURCE}`);
	process.exit(1);
}

for (const targetDir of resolveTargetDirs()) {
	fs.mkdirSync(targetDir, { recursive: true });
	const manifestTarget = path.join(targetDir, "manifest.json");
	fs.copyFileSync(MANIFEST_SOURCE, manifestTarget);
	console.log(`Copied manifest.json -> ${manifestTarget}`);
}
