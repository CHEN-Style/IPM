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

const VITE_EXTERNALS = ['better-sqlite3', 'jsdom'];

module.exports = {
  packagerConfig: {
    asar: {
      unpack: '**/*.node',
    },
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
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
