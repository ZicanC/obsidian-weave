const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOCK_FILE = path.join(PROJECT_ROOT, '.dev-watch.lock.json');
const VITE_ENTRY = path.join(PROJECT_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const MAX_OLD_SPACE_SIZE = process.env.WEAVE_DEV_MEMORY_MB || '4096';

function log(message) {
  console.log(`[dev-watch] ${message}`);
}

function readLock() {
  if (!fs.existsSync(LOCK_FILE)) return null;

  try {
    return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeLock(pid) {
  const payload = {
    pid,
    projectRoot: PROJECT_ROOT,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(LOCK_FILE, JSON.stringify(payload, null, 2));
}

function removeLock(expectedPid) {
  if (!fs.existsSync(LOCK_FILE)) return;

  if (typeof expectedPid === 'number') {
    const current = readLock();
    if (current?.pid && current.pid !== expectedPid) return;
  }

  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // Ignore lock cleanup failures.
  }
}

function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopPreviousWatcher(pid) {
  if (!isRunning(pid)) return;

  log(`Stopping previous watch process ${pid}...`);

  if (process.platform === 'win32') {
    const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${pid} /T /F`], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const notFound = /not found|no running instance/i.test(output);

    if (result.status !== 0 && !notFound) {
      throw new Error(output.trim() || `Failed to stop process ${pid}`);
    }

    return;
  }

  process.kill(pid, 'SIGTERM');
}

function runCleanup() {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'kill-vite.cjs')], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const previousLock = readLock();
if (previousLock?.pid) {
  try {
    stopPreviousWatcher(previousLock.pid);
  } catch (error) {
    console.error(`[dev-watch] ${error.message}`);
    process.exit(1);
  }
}
removeLock();
runCleanup();

const child = spawn(process.execPath, [
  `--max-old-space-size=${MAX_OLD_SPACE_SIZE}`,
  VITE_ENTRY,
  'build',
  '--mode',
  'development',
  '--watch',
], {
  cwd: PROJECT_ROOT,
  stdio: 'inherit',
});

writeLock(child.pid);
log(`Watching for changes with Vite (pid ${child.pid})`);

function shutdown(signal) {
  removeLock(child.pid);

  if (isRunning(child.pid)) {
    if (process.platform === 'win32') {
      spawnSync('cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${child.pid} /T /F`], {
        cwd: PROJECT_ROOT,
        stdio: 'ignore',
      });
    } else {
      child.kill(signal);
    }
  }
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
  process.exit(130);
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
  process.exit(143);
});

child.on('close', (code) => {
  removeLock(child.pid);
  process.exit(code ?? 0);
});
