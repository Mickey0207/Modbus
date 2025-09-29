// Simple guard runner for Drizzle Studio to avoid failing the whole dev stack
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Try to patch drizzle-orm exports to expose package.json for drizzle-kit version check
try {
  const pkgPath = path.join(__dirname, '..', 'node_modules', 'drizzle-orm', 'package.json');
  if (fs.existsSync(pkgPath)) {
    const json = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    json.exports = json.exports || {};
    if (!json.exports['./package.json']) {
      json.exports['./package.json'] = './package.json';
      fs.writeFileSync(pkgPath, JSON.stringify(json, null, 2));
      console.log('[drizzle] Patched drizzle-orm exports to include ./package.json');
    }
  }
} catch (e) {
  console.warn('[drizzle] Patch failed:', e?.message || e);
}

function resolveLocalDrizzleKit() {
  const binName = process.platform === 'win32' ? 'drizzle-kit.cmd' : 'drizzle-kit';
  const binPath = path.join(__dirname, '..', 'node_modules', '.bin', binName);
  return fs.existsSync(binPath) ? binPath : null;
}

function runStudio() {
  const localBin = resolveLocalDrizzleKit();
  const cmd = localBin || 'npx';
  const args = localBin ? ['studio', '--port=5003'] : ['drizzle-kit', 'studio', '--port=5003'];
  console.log(`{drizzle} Starting Drizzle Studio on port 5003 using ${localBin ? 'local drizzle-kit' : 'npx drizzle-kit'}...`);

  const child = spawn(cmd, args, { stdio: 'inherit', shell: true });
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.warn(`[drizzle] Studio exited with code ${code}.`);
      console.warn('[drizzle] Keeping process alive to avoid stopping dev stack.');
      setInterval(() => {}, 1 << 30);
    } else {
      // Keep the process alive while Studio runs (so concurrently doesn't kill others)
      setInterval(() => {}, 1 << 30);
    }
  });
}

runStudio();
