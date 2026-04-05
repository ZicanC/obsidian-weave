const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const nodeModulesDir = path.join(projectRoot, "node_modules");

function removeDirectory(targetPath) {
	if (!fs.existsSync(targetPath)) {
		return false;
	}

	fs.rmSync(targetPath, { recursive: true, force: true });
	return true;
}

function findViteCacheDirs() {
	if (!fs.existsSync(nodeModulesDir)) {
		return [];
	}

	return fs
		.readdirSync(nodeModulesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name.startsWith(".vite"))
		.map((entry) => path.join(nodeModulesDir, entry.name))
		.sort();
}

const removed = [];

for (const cacheDir of findViteCacheDirs()) {
	if (removeDirectory(cacheDir)) {
		removed.push(path.relative(projectRoot, cacheDir));
	}
}

if (removed.length === 0) {
	console.log("No Vite cache directories found.");
	process.exit(0);
}

console.log("Removed Vite cache directories:");
for (const cacheDir of removed) {
	console.log(`- ${cacheDir}`);
}
