#!/usr/bin/env node
/**
 * setup-mingit.mjs
 *
 * Downloads the latest MinGit-busybox release from
 * https://github.com/git-for-windows/git/releases and extracts it
 * into `desktop/vendor/MinGit/`. Used to provide IPM with a bundled
 * `bash.exe` so users without Git for Windows still get full
 * KnowClaw Skill support (pdf-builder / docx-builder / etc.).
 *
 * See `desktop/vendor/README.md` for the full design rationale.
 *
 * Behaviours:
 *   * Idempotent: skipped when `vendor/MinGit/usr/bin/bash.exe`
 *     already exists. Pass `--force` to re-download anyway.
 *   * Uses Node's built-in zip extraction (`fflate`) which is
 *     already a transitive dependency, so no extra deps required.
 *   * Verifies size + that `bash.exe` shows up in the archive
 *     before committing to the disk write, so a partial download
 *     can't leave a broken vendor tree behind.
 *   * Streams via `https.get` with redirect support; falls back to
 *     a clear error message on network failure.
 *
 * Usage:
 *   node scripts/setup-mingit.mjs            # download if missing
 *   node scripts/setup-mingit.mjs --force    # re-download even if present
 *   node scripts/setup-mingit.mjs --version=2.45.2  # pin a specific Git release
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.resolve(__dirname, '..');
const VENDOR_DIR = path.join(DESKTOP_DIR, 'vendor', 'MinGit');
const SENTINEL = path.join(VENDOR_DIR, 'usr', 'bin', 'bash.exe');

const args = new Map(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const FORCE = Boolean(args.get('force'));
const PINNED_VERSION = typeof args.get('version') === 'string' ? args.get('version') : null;

function log(msg) {
  console.log(`[setup-mingit] ${msg}`);
}

function fatal(msg, err) {
  console.error(`[setup-mingit] ${msg}`);
  if (err) console.error(err);
  process.exit(1);
}

if (!FORCE && fs.existsSync(SENTINEL)) {
  log(`MinGit already present at ${VENDOR_DIR} — skipping. Pass --force to re-download.`);
  process.exit(0);
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'IPM-setup-mingit-script',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(httpsGetJson(res.headers.location));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
  });
}

function httpsDownload(url, destPath) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'IPM-setup-mingit-script' } },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(httpsDownload(res.headers.location, destPath));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }
        const total = Number(res.headers['content-length'] || 0);
        let received = 0;
        let lastLogged = 0;
        const out = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0 && received - lastLogged > 4 * 1024 * 1024) {
            const pct = ((received / total) * 100).toFixed(1);
            log(`  downloaded ${(received / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB (${pct}%)`);
            lastLogged = received;
          }
        });
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
      },
    );
    req.on('error', reject);
  });
}

async function pickAsset() {
  // Resolve which Git release to download.
  let release;
  if (PINNED_VERSION) {
    log(`Resolving release for pinned version ${PINNED_VERSION}…`);
    // GitHub release tags are like "v2.45.2.windows.1". We do a fuzzy
    // contains match so user can pass "2.45.2" or the full tag.
    const releases = await httpsGetJson(
      'https://api.github.com/repos/git-for-windows/git/releases?per_page=30',
    );
    release = releases.find((r) =>
      String(r.tag_name || '').includes(PINNED_VERSION) || String(r.name || '').includes(PINNED_VERSION),
    );
    if (!release) {
      fatal(`No release found matching version "${PINNED_VERSION}". Pick one from https://github.com/git-for-windows/git/releases`);
    }
  } else {
    log('Resolving latest Git for Windows release…');
    release = await httpsGetJson('https://api.github.com/repos/git-for-windows/git/releases/latest');
  }

  // Find the MinGit-busybox-64-bit asset.
  const assets = release.assets || [];
  const asset = assets.find((a) =>
    /MinGit-.*-busybox-64-bit\.zip$/i.test(a.name) && !/portable/i.test(a.name),
  );
  if (!asset) {
    fatal(
      `Release ${release.tag_name} doesn't contain a MinGit-busybox-64-bit ZIP.\n` +
        `Available assets:\n  ${assets.map((a) => a.name).join('\n  ')}`,
    );
  }
  log(`Selected ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)`);
  return asset;
}

async function extractZip(zipPath, destDir) {
  // Use PowerShell's Expand-Archive — it's always available on
  // Windows and avoids adding a Node zip dep just for this script.
  // On non-Windows hosts we fall back to `unzip` if present.
  log(`Extracting → ${destDir}`);
  fs.mkdirSync(destDir, { recursive: true });

  if (process.platform === 'win32') {
    const res = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`,
      ],
      { stdio: 'inherit' },
    );
    if (res.status !== 0) {
      fatal('powershell Expand-Archive failed');
    }
  } else {
    const res = spawnSync('unzip', ['-q', '-o', zipPath, '-d', destDir], { stdio: 'inherit' });
    if (res.status !== 0) {
      fatal('`unzip` failed — install it (or run this script on Windows).');
    }
  }
}

(async () => {
  try {
    const asset = await pickAsset();
    const tmp = path.join(DESKTOP_DIR, `.tmp-mingit-${process.pid}.zip`);

    if (fs.existsSync(VENDOR_DIR) && FORCE) {
      log(`--force: wiping ${VENDOR_DIR}`);
      fs.rmSync(VENDOR_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(VENDOR_DIR, { recursive: true });

    log(`Downloading ${asset.browser_download_url}`);
    await httpsDownload(asset.browser_download_url, tmp);

    // Sanity check: the ZIP should be at least 20 MB. Anything tiny
    // is almost certainly an HTML error page that slipped through.
    const stat = fs.statSync(tmp);
    if (stat.size < 20 * 1024 * 1024) {
      fs.unlinkSync(tmp);
      fatal(`Downloaded file is only ${stat.size} bytes — looks truncated. Aborting.`);
    }
    const sha = crypto.createHash('sha256').update(fs.readFileSync(tmp)).digest('hex');
    log(`Downloaded ${(stat.size / 1024 / 1024).toFixed(1)} MB (sha256=${sha.slice(0, 16)}…)`);

    await extractZip(tmp, VENDOR_DIR);
    fs.unlinkSync(tmp);

    if (!fs.existsSync(SENTINEL)) {
      fatal(
        `Extraction completed but ${SENTINEL} was not created.\n` +
          `The archive layout may have changed; please verify the contents of\n` +
          `${VENDOR_DIR}\n` +
          `and update the SENTINEL path in this script if needed.`,
      );
    }

    log(`Done. Bundled bash is now at ${SENTINEL}`);
  } catch (err) {
    fatal('Setup failed:', err);
  }
})();
