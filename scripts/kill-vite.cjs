const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const VITE_CACHE_DIR = path.join(__dirname, '..', 'node_modules', '.vite');
const RUNTIME_EXTENSIONS = new Set(['.js', '.css', '.json', '.wasm', '.map']);
const RUNTIME_FILES = new Set(['README.md']);

function isRuntimeArtifact(fileName) {
  return RUNTIME_FILES.has(fileName) || RUNTIME_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function cleanDistDir() {
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
    console.log('Created dist directory');
    return;
  }

  try {
    const entries = fs.readdirSync(DIST_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!isRuntimeArtifact(entry.name)) continue;

      fs.unlinkSync(path.join(DIST_DIR, entry.name));
    }

    console.log('Cleaned runtime artifacts from dist');
  } catch (error) {
    console.log(`Failed to clean dist runtime artifacts: ${error.message}`);
  }
}

function cleanViteCache() {
  if (!fs.existsSync(VITE_CACHE_DIR)) {
    return;
  }

  try {
    fs.rmSync(VITE_CACHE_DIR, { recursive: true, force: true });
    console.log('Cleaned Vite cache');
  } catch {
    // Ignore cache cleanup failures.
  }
}

cleanDistDir();
cleanViteCache();
console.log('Prebuild cleanup complete');
