const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const path = require('path');
const fs = require('fs');

/**
 * BFS-collect a module and ALL its production + optional dependencies,
 * including deps required by packages nested inside another package's
 * own node_modules (which npm hoists to the top level).
 */
function collectProductionDeps(topModulesDir, seedNames) {
  const collected = new Set();
  const queue = [...seedNames];

  while (queue.length > 0) {
    const name = queue.shift();
    if (collected.has(name)) continue;
    const modDir = path.join(topModulesDir, name);
    if (!fs.existsSync(modDir)) continue;
    collected.add(name);

    const enqueue = (dep) => { if (!collected.has(dep)) queue.push(dep); };
    readDeps(path.join(modDir, 'package.json'), enqueue);
    scanNestedModules(modDir, enqueue);
  }
  return collected;
}

function readDeps(pkgJsonPath, onDep) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    for (const dep of Object.keys(pkg.dependencies || {})) onDep(dep);
    for (const dep of Object.keys(pkg.optionalDependencies || {})) onDep(dep);
  } catch { /* ignore */ }
}

function scanNestedModules(modDir, onDep) {
  const nmDir = path.join(modDir, 'node_modules');
  if (!fs.existsSync(nmDir)) return;
  try {
    for (const entry of fs.readdirSync(nmDir)) {
      if (entry.startsWith('.')) continue;
      if (entry.startsWith('@')) {
        const scopeDir = path.join(nmDir, entry);
        try {
          for (const sub of fs.readdirSync(scopeDir)) {
            const pkgDir = path.join(scopeDir, sub);
            readDeps(path.join(pkgDir, 'package.json'), onDep);
            scanNestedModules(pkgDir, onDep);
          }
        } catch { /* ignore */ }
      } else {
        const pkgDir = path.join(nmDir, entry);
        readDeps(path.join(pkgDir, 'package.json'), onDep);
        scanNestedModules(pkgDir, onDep);
      }
    }
  } catch { /* ignore */ }
}

const VITE_EXTERNALS = [
  'better-sqlite3',
  'jsdom',
  '@earendil-works/pi-coding-agent',
  'turndown',
  '@langchain/anthropic',
  '@langchain/google-genai',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
  // F3 OCR: ppu-paddle-ocr + onnxruntime-node/web + ppu-ocv
  // These are ESM modules that must stay outside Vite's bundle and be copied
  // to the packaged app's node_modules tree by the packageAfterCopy hook.
  // onnxruntime-node is shimmed at install time (see scripts/patch-onnxruntime.mjs)
  // to re-export onnxruntime-web (WASM), avoiding native DLL issues in Electron.
  'ppu-paddle-ocr',
  'onnxruntime-node',
  'onnxruntime-web',
  'onnxruntime-common',
  'ppu-ocv',
];

function shouldCopyAgentFile(agentSrc, srcPath) {
  const rel = path.relative(agentSrc, srcPath);
  if (!rel) return true;
  const parts = rel.split(path.sep);
  const base = parts[parts.length - 1];
  const isRootFile = parts.length === 1;

  // Root Agent/*.md files are development plans / reports, not runtime
  // assets. Keeping them in the MSI can introduce non-ANSI file names
  // (for example IPM Chinese report docs) and break WiX's default 1252
  // database encoding. Nested SKILL.md files remain included.
  if (isRootFile && base.toLowerCase().endsWith('.md')) return false;
  if (isRootFile && base === 'k3-floating-knowclaw-demo.html') return false;
  if (base === '.env') return false;
  if (parts.includes('__pycache__')) return false;
  if (base.toLowerCase().endsWith('.pyc')) return false;

  return true;
}

module.exports = {
  packagerConfig: {
    // ASAR is INTENTIONALLY DISABLED.
    //
    // We tried to keep ASAR on with `unpack` glob carve-outs for
    // `Agent/`, `node_modules/`, and `*.node`. In practice the
    // brace-expansion glob `'{**/*.node,Agent/**/*,node_modules/**/*}'`
    // is silently dropped by electron-packager's current asar
    // pipeline — only the leading `**/*.node` pattern actually takes
    // effect, leaving every other dependency archived inside asar.
    //
    // That's a hard-blocker for KnowClaw because:
    //
    //   1. The main process dynamic-`import()`s
    //      `Agent/pi-runtime/index.js` (ESM-only).
    //   2. That file in turn `import`s `@earendil-works/pi-coding-agent`,
    //      which transitively pulls in ~dozen production deps.
    //   3. Node's native ESM loader resolves bare specifiers by walking
    //      `node_modules/` up the **physical disk path** — it does NOT
    //      participate in Electron's ASAR `fs.*` patch.
    //   4. With deps stuck inside `app.asar`, ESM resolution silently
    //      fails and the KnowClaw model selector spins forever on
    //      "模型加载中...".
    //
    // Disabling asar entirely sidesteps all of this. The cost is
    // ~marginal startup time and source files visible on disk;
    // for an internal IPM tool that's an acceptable trade.
    //
    // If we ever want asar back, the only known reliable approach is
    // `asar: { unpack: '...' }` with a single non-brace glob (multiple
    // patterns require multiple successive packagings, which the
    // plugin-vite pipeline doesn't expose), or moving to
    // `extraResource` to ship `Agent/` and `node_modules/` outside
    // the app entirely.
    asar: false,
    icon: './assets/icon',
    rebuild: false,
  },
  rebuildConfig: {
    onlyModules: [],
  },
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      const srcModules = path.resolve(__dirname, 'node_modules');
      const destModules = path.join(buildPath, 'node_modules');

      const allDeps = collectProductionDeps(srcModules, VITE_EXTERNALS);

      for (const dep of allDeps) {
        const src = path.join(srcModules, dep);
        const dest = path.join(destModules, dep);
        if (fs.existsSync(src) && !fs.existsSync(dest)) {
          fs.cpSync(src, dest, { recursive: true });
        }
      }
      console.log(`[packageAfterCopy] Copied ${allDeps.size} external modules to build path`);

      // F3 OCR: bundle the PP-OCRv5 models so the packaged app works
      // fully offline. We ship them at `<resources>/models/ocr/` so the
      // main process can find them via `process.resourcesPath`. The
      // contributor populates `desktop/models/ocr/` via the
      // `npm run setup:ocr` helper before `npm run make`.
      const ocrModelsSrc = path.resolve(__dirname, 'models', 'ocr');
      if (fs.existsSync(ocrModelsSrc)) {
        const resourcesDir = path.dirname(buildPath); // .../resources/
        const ocrModelsDest = path.join(resourcesDir, 'models', 'ocr');
        fs.mkdirSync(path.dirname(ocrModelsDest), { recursive: true });
        if (!fs.existsSync(ocrModelsDest)) {
          fs.cpSync(ocrModelsSrc, ocrModelsDest, { recursive: true });
          console.log(`[packageAfterCopy] OCR models copied → ${ocrModelsDest}`);
        }
      } else {
        console.log(
          `[packageAfterCopy] models/ocr/ not populated — packaged app ` +
          `will download OCR models from the network on first use. ` +
          `Run \`npm run setup:ocr\` first to bundle them.`,
        );
      }

      // KnowClaw pi-runtime: the Agent/ directory contains ESM modules
      // loaded at runtime via dynamic `import()` (with @vite-ignore so
      // Vite doesn't bundle them). Since Vite/Forge don't know about
      // this tree, we copy it manually into the packaged app. The main
      // process code expects it at `<appRoot>/Agent/pi-runtime/` (two
      // levels up from `.vite/build/`).
      const agentSrc = path.resolve(__dirname, 'Agent');
      const agentDest = path.join(buildPath, 'Agent');
      if (fs.existsSync(agentSrc) && !fs.existsSync(agentDest)) {
        fs.cpSync(agentSrc, agentDest, {
          recursive: true,
          filter: (srcPath) => shouldCopyAgentFile(agentSrc, srcPath),
        });
        console.log(`[packageAfterCopy] Copied Agent/ directory to build path`);
      }

      // Bundled MinGit (optional). When present, surface it at
      // `<resources>/MinGit/` so the main process can find it via
      // `process.resourcesPath` (see `resolveBashShell()` in
      // `src/main/ipc/knowclaw.js`). This is what gives users
      // without Git for Windows a working `bash.exe` out of the
      // box for Skills like pdf-builder / docx-builder.
      //
      // It's intentionally OPT-IN: contributors run
      // `npm run setup:mingit` before `npm run make` to populate
      // `vendor/MinGit/`; a missing vendor tree just means the
      // packaged app falls back to "system Git or nothing" — the
      // same behaviour we had before this feature shipped.
      //
      // `buildPath` here is `<out>/<app>-<platform>-<arch>/resources/app`.
      // We need to write to the sibling `resources/MinGit/`, so we
      // pop up one level.
      const minGitSrc = path.resolve(__dirname, 'vendor', 'MinGit');
      const minGitHasBash = fs.existsSync(path.join(minGitSrc, 'usr', 'bin', 'bash.exe'));
      if (minGitHasBash) {
        const resourcesDir = path.dirname(buildPath); // .../resources/
        const minGitDest = path.join(resourcesDir, 'MinGit');
        if (!fs.existsSync(minGitDest)) {
          fs.cpSync(minGitSrc, minGitDest, { recursive: true });
          console.log(`[packageAfterCopy] Bundled MinGit copied → ${minGitDest}`);
        }
      } else {
        console.log(
          `[packageAfterCopy] vendor/MinGit/ not populated — packaged app will rely on system bash. ` +
          `Run \`npm run setup:mingit\` first if you want the bundled fallback.`,
        );
      }
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-wix',
      config: {
        name: 'IPM',
        manufacturer: 'IPM Team',
        description: 'Intelligent Project Manager - AI-driven knowledge and project management',
        icon: './assets/icon.ico',
        ui: {
          chooseDirectory: true,
        },
        beforeCreate: (creator) => {
          // WiX defaults the MSI database to code page 1252. Our packaged
          // app intentionally includes user-facing Chinese docs / skill
          // assets, so generated File/@Name values can contain CJK
          // characters. Force UTF-8 at the Product level before the WXS is
          // generated; otherwise light.exe fails with LGHT0311.
          if (typeof creator.wixTemplate === 'string' && !/Codepage=/.test(creator.wixTemplate)) {
            creator.wixTemplate = creator.wixTemplate.replace(
              'Language="{{Language}}">',
              'Language="{{Language}}"\n           Codepage="65001">',
            );
          }
        },
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
        // If you are familiar with Vite configuration, it will look really familiar.
        build: [
          {
            // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
            entry: 'src/main.js',
            config: 'vite.main.config.mjs',
            target: 'main',
          },
          {
            entry: 'src/preload.js',
            config: 'vite.preload.config.mjs',
            target: 'preload',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.mjs',
          },
        ],
      },
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application.
    //
    // IMPORTANT — these two MUST stay in sync with `packagerConfig.asar`:
    //
    //   - `OnlyLoadAppFromAsar`: when true, Electron refuses to start
    //     unless `<resources>/app.asar` exists. With `asar: false`
    //     above (forced because Node's native ESM loader cannot read
    //     inside an asar archive), the binary would silently exit on
    //     launch — exactly the "double-click does nothing" symptom.
    //   - `EnableEmbeddedAsarIntegrityValidation`: validates the
    //     asar header signature on launch. Same story — without an
    //     asar, validation fails.
    //
    // If we ever turn asar back on, flip both back to `true`.
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
};
