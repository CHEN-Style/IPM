#!/usr/bin/env node
/**
 * KnowClaw web-artifacts-builder: cross-platform bundler.
 *
 * Mirrors `bundle-artifact.sh`. Run from a project initialized by
 * init-artifact.js. Produces a self-contained `bundle.html` in the project
 * root by piping Parcel's build through html-inline.
 *
 * Usage (run from the project root):
 *   node "$KNOWCLAW_SKILLS_DIR/web-artifacts-builder/scripts/bundle-artifact.js"
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function fail(msg) {
  console.error(`X ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(msg);
}

function run(cmd, args, opts = {}) {
  const useShell = process.platform === "win32";
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: useShell,
    ...opts,
  });
  if (result.error) fail(`Failed to run ${cmd}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`Command failed (exit ${result.status}): ${cmd} ${args.join(" ")}`);
  }
}

if (!fs.existsSync("package.json")) {
  fail("No package.json found. Run this script from your project root.");
}
if (!fs.existsSync("index.html")) {
  fail("No index.html found in project root. Bundling requires an entry point.");
}

const pnpm = (args, opts) => run("npx", ["--yes", "pnpm", ...args], opts);

info("Installing bundling dependencies...");
pnpm([
  "add",
  "-D",
  "parcel",
  "@parcel/config-default",
  "parcel-resolver-tspaths",
  "html-inline",
]);

if (!fs.existsSync(".parcelrc")) {
  info("Creating Parcel configuration with path alias support...");
  fs.writeFileSync(
    ".parcelrc",
    JSON.stringify(
      {
        extends: "@parcel/config-default",
        resolvers: ["parcel-resolver-tspaths", "..."],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

info("Cleaning previous build...");
fs.rmSync(path.resolve("dist"), { recursive: true, force: true });
fs.rmSync(path.resolve("bundle.html"), { force: true });

info("Building with Parcel...");
pnpm([
  "exec",
  "parcel",
  "build",
  "index.html",
  "--dist-dir",
  "dist",
  "--no-source-maps",
]);

info("Inlining all assets into single HTML file...");
// pnpm exec html-inline streams to stdout — we capture and write it ourselves
// rather than rely on a shell `>` redirection (PowerShell's > handling
// produces UTF-16 BOM-prefixed files, which break browsers loading the
// bundle).
const useShell = process.platform === "win32";
const inlineResult = spawnSync(
  "npx",
  ["--yes", "pnpm", "exec", "html-inline", path.join("dist", "index.html")],
  { encoding: "buffer", shell: useShell, maxBuffer: 256 * 1024 * 1024 },
);
if (inlineResult.error) fail(`html-inline failed: ${inlineResult.error.message}`);
if (inlineResult.status !== 0) {
  process.stderr.write(inlineResult.stderr || "");
  fail(`html-inline exited with status ${inlineResult.status}`);
}
fs.writeFileSync("bundle.html", inlineResult.stdout);

const stats = fs.statSync("bundle.html");
info("");
info("Bundle complete!");
info(`Output: bundle.html (${(stats.size / 1024).toFixed(1)} KB)`);
info("Open bundle.html in a browser to preview.");
