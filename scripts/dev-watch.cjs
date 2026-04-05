const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const LOCK_FILE = path.join(PROJECT_ROOT, ".dev-watch.lock.json");
const VITE_ENTRY = path.join("node_modules", "vite", "bin", "vite.js");
const MAX_OLD_SPACE_SIZE = process.env.WEAVE_DEV_MEMORY_MB || "4096";

function isProcessAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}

	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function readLockFile() {
	if (!fs.existsSync(LOCK_FILE)) {
		return null;
	}

	try {
		return JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
	} catch {
		return null;
	}
}

function removeLockFile() {
	if (fs.existsSync(LOCK_FILE)) {
		fs.rmSync(LOCK_FILE, { force: true });
	}
}

function writeLockFile() {
	fs.writeFileSync(
		LOCK_FILE,
		JSON.stringify(
			{
				pid: process.pid,
				projectRoot: PROJECT_ROOT,
				createdAt: new Date().toISOString()
			},
			null,
			2
		),
		"utf8"
	);
}

const existingLock = readLockFile();
if (existingLock?.pid && existingLock.pid !== process.pid) {
	if (isProcessAlive(existingLock.pid)) {
		console.log(`开发监听已在运行，PID: ${existingLock.pid}`);
		console.log("如需重启，请先执行: node scripts/kill-vite.cjs");
		process.exit(0);
	}

	removeLockFile();
}

writeLockFile();

const child = spawn(
	process.execPath,
	[`--max-old-space-size=${MAX_OLD_SPACE_SIZE}`, VITE_ENTRY, "build", "--mode", "development"],
	{
		cwd: PROJECT_ROOT,
		stdio: "inherit"
	}
);

let cleanedUp = false;

function cleanup() {
	if (cleanedUp) {
		return;
	}

	cleanedUp = true;
	const lock = readLockFile();
	if (lock?.pid === process.pid) {
		removeLockFile();
	}
}

process.on("SIGINT", () => {
	if (!child.killed) {
		child.kill("SIGINT");
	}
	cleanup();
	process.exit(0);
});

process.on("SIGTERM", () => {
	if (!child.killed) {
		child.kill("SIGTERM");
	}
	cleanup();
	process.exit(0);
});

process.on("exit", cleanup);

child.on("close", (code, signal) => {
	cleanup();

	if (signal) {
		process.kill(process.pid, signal);
		return;
	}

	process.exit(code ?? 0);
});
