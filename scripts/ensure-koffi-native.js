'use strict';

// Preflight for packaging/distribution commands: asserts that koffi's
// platform-native optional package is actually present on disk.
//
// koffi loads its `.node` addon at runtime by looking up
// `@koromix/koffi-${platform}-${arch}` from its own `optionalDependencies`
// (see node_modules/koffi/src/koffi/index.cjs wrapNative). When that
// package is missing — usually because the build host skipped optional
// dependencies at install time (`npm ci --omit=optional`, `NODE_ENV=production`,
// or a partial `npm install`) — every DWM API call the widget makes via
// koffi fails silently and the 1px DWM system border on frameless windows
// stays visible.
//
// We mirror scripts/ensure-vendored-tokscale.js: explicit, opt-in, and
// strict by default so the packaging path fails closed with a clear hint
// instead of producing a portable build that ships without its native
// dependency.

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = argv.slice(2);
  const platformArg = args.find((arg) => arg.startsWith('--platform='));
  const platform = platformArg ? platformArg.slice('--platform='.length) : null;
  const allowMissing = args.includes('--allow-missing-target-package');
  return { platform, allowMissing };
}

function packageDir(platform) {
  return path.join(repoRoot, 'node_modules', '@koromix', `koffi-${platform}`);
}

function nativeBinaryPath(platform) {
  // koffi ships a directory layout per triplet (e.g. win32-x64/koffi.node).
  // Pick the first `.node` we find under the package dir; the file's name is
  // stable across platforms.
  const root = packageDir(platform);
  if (!fs.existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith('.node')) return full;
    }
  }
  return null;
}

function ensureKoffiNative({ platform = null, allowMissingTargetPackage = false, log = console.log } = {}) {
  if (!platform) {
    throw new Error('ensure-koffi-native: pass --platform=<key>, e.g. --platform=win32-x64');
  }
  if (!/^[a-z0-9]+-[a-z0-9]+$/.test(platform)) {
    throw new Error(`ensure-koffi-native: invalid --platform value "${platform}" (expected e.g. win32-x64)`);
  }

  const dir = packageDir(platform);
  if (!fs.existsSync(dir)) {
    if (allowMissingTargetPackage) {
      log(`ensure-koffi-native: @koromix/koffi-${platform} is not installed on this host (cross-arch/cross-OS build, explicitly allowed) — packaging will proceed without koffi for this target.`);
      return { status: 'unavailable', platform };
    }
    throw new Error(
      `@koromix/koffi-${platform} is not installed — koffi's native addon cannot load without it. ` +
        `Run \`npm ci\` (or \`npm install --include=optional\`) on a host whose platform matches ${platform}, ` +
        `or pass --allow-missing-target-package if this is a source-only structural build that never ships its output.`,
      { code: 'MODULE_NOT_FOUND' }
    );
  }

  const nativePath = nativeBinaryPath(platform);
  if (!nativePath) {
    throw new Error(
      `ensure-koffi-native: @koromix/koffi-${platform} is installed but no .node binary was found under ${dir}. ` +
        'The package may be corrupt — reinstall it (`npm install --force @koromix/koffi-' + platform + '`).'
    );
  }

  log(`ensure-koffi-native: @koromix/koffi-${platform} native binding present at ${nativePath}`);
  return { status: 'ok', platform, nativePath };
}

function main() {
  const { platform, allowMissing } = parseArgs(process.argv);
  return ensureKoffiNative({ platform, allowMissingTargetPackage: allowMissing });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`ensure-koffi-native failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  ensureKoffiNative,
  nativeBinaryPath,
  packageDir,
  parseArgs
};