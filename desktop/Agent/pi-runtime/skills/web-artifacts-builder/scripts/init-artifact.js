#!/usr/bin/env node
/**
 * KnowClaw web-artifacts-builder: cross-platform initializer.
 *
 * Mirrors the original `init-artifact.sh` but rewritten in Node so it runs
 * uniformly on Windows / macOS / Linux without depending on bash, sed, or
 * a Unix shell. Designed to be invoked from the user's current workspace
 * (cwd), which is where the new project directory will land.
 *
 * Usage:
 *   node "$KNOWCLAW_SKILLS_DIR/web-artifacts-builder/scripts/init-artifact.js" <project-name>
 *
 * Prereqs (the script will surface a clear error if missing):
 *   - Node 18+
 *   - npm (bundled with Node) — pnpm is auto-installed on first run via npx
 *   - `tar` available on PATH (built-in on Win10+, macOS, Linux)
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SCRIPT_DIR = __dirname;
const COMPONENTS_TARBALL = path.join(SCRIPT_DIR, "shadcn-components.tar.gz");

function fail(msg) {
  console.error(`X ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(msg);
}

function run(cmd, args, opts = {}) {
  // Use shell:true on Windows so .cmd shims (npm.cmd / pnpm.cmd / npx.cmd)
  // resolve correctly. Otherwise spawnSync errors with ENOENT for those
  // .cmd wrappers.
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

function runQuiet(cmd, args, opts = {}) {
  const useShell = process.platform === "win32";
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: useShell,
    ...opts,
  });
  return result;
}

function writeFile(target, contents) {
  fs.writeFileSync(target, contents, "utf8");
}

function patchJsonFile(file, patcher) {
  // tsconfig*.json from Vite templates may contain // comments and trailing
  // commas. Strip them before parsing — JSON.parse won't accept either.
  const raw = fs.readFileSync(file, "utf8");
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
  const obj = JSON.parse(stripped);
  patcher(obj);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

const projectName = process.argv[2];
if (!projectName) fail("Usage: init-artifact.js <project-name>");

const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
info(`Detected Node.js version: v${process.versions.node}`);
if (nodeMajor < 18) fail("Node.js 18 or higher is required.");

const viteVersion = nodeMajor >= 20 ? "latest" : "5.4.11";
info(`Using Vite ${viteVersion}`);

if (!fs.existsSync(COMPONENTS_TARBALL)) {
  fail(`shadcn-components.tar.gz not found at ${COMPONENTS_TARBALL}`);
}

const tarCheck = runQuiet("tar", ["--version"]);
if (tarCheck.status !== 0) {
  fail("`tar` not available on PATH. Install GNU/BSD tar (Win10+ ships with it).");
}

// Use npx to invoke pnpm so we don't require a global install. This is
// slower on first run but works without elevated permissions on Windows.
const pnpm = (args, opts) => run("npx", ["--yes", "pnpm", ...args], opts);

info(`Creating new React + Vite project: ${projectName}`);
pnpm(["create", "vite", projectName, "--template", "react-ts"]);

const projectPath = path.resolve(process.cwd(), projectName);
if (!fs.existsSync(projectPath)) fail(`Project directory not created: ${projectPath}`);
process.chdir(projectPath);

info("Cleaning up Vite template...");
const indexHtmlPath = path.join(projectPath, "index.html");
let indexHtml = fs.readFileSync(indexHtmlPath, "utf8");
indexHtml = indexHtml
  .replace(/<link rel="icon"[^>]*vite\.svg[^>]*\/?>(\r?\n)?/g, "")
  .replace(/<title>.*<\/title>/, `<title>${projectName}</title>`);
writeFile(indexHtmlPath, indexHtml);

info("Installing base dependencies...");
pnpm(["install"]);

if (nodeMajor < 20) {
  info(`Pinning Vite to ${viteVersion} for Node 18 compatibility...`);
  pnpm(["add", "-D", `vite@${viteVersion}`]);
}

info("Installing Tailwind CSS and dependencies...");
pnpm([
  "install",
  "-D",
  "tailwindcss@3.4.1",
  "postcss",
  "autoprefixer",
  "@types/node",
  "tailwindcss-animate",
]);
pnpm([
  "install",
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
  "lucide-react",
  "next-themes",
]);

info("Creating Tailwind and PostCSS configuration...");
writeFile(
  "postcss.config.js",
  `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`,
);

writeFile(
  "tailwind.config.js",
  `/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
`,
);

info("Adding Tailwind directives and CSS variables...");
const indexCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 0 0% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 3.9%;
    --primary: 0 0% 9%;
    --primary-foreground: 0 0% 98%;
    --secondary: 0 0% 96.1%;
    --secondary-foreground: 0 0% 9%;
    --muted: 0 0% 96.1%;
    --muted-foreground: 0 0% 45.1%;
    --accent: 0 0% 96.1%;
    --accent-foreground: 0 0% 9%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 0 0% 89.8%;
    --input: 0 0% 89.8%;
    --ring: 0 0% 3.9%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 0 0% 3.9%;
    --foreground: 0 0% 98%;
    --card: 0 0% 3.9%;
    --card-foreground: 0 0% 98%;
    --popover: 0 0% 3.9%;
    --popover-foreground: 0 0% 98%;
    --primary: 0 0% 98%;
    --primary-foreground: 0 0% 9%;
    --secondary: 0 0% 14.9%;
    --secondary-foreground: 0 0% 98%;
    --muted: 0 0% 14.9%;
    --muted-foreground: 0 0% 63.9%;
    --accent: 0 0% 14.9%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 0 0% 98%;
    --border: 0 0% 14.9%;
    --input: 0 0% 14.9%;
    --ring: 0 0% 83.1%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
`;
writeFile(path.join("src", "index.css"), indexCss);

info("Adding path aliases to tsconfig.json...");
patchJsonFile("tsconfig.json", (cfg) => {
  cfg.compilerOptions = cfg.compilerOptions || {};
  cfg.compilerOptions.baseUrl = ".";
  cfg.compilerOptions.paths = { "@/*": ["./src/*"] };
});

if (fs.existsSync("tsconfig.app.json")) {
  info("Adding path aliases to tsconfig.app.json...");
  patchJsonFile("tsconfig.app.json", (cfg) => {
    cfg.compilerOptions = cfg.compilerOptions || {};
    cfg.compilerOptions.baseUrl = ".";
    cfg.compilerOptions.paths = { "@/*": ["./src/*"] };
  });
}

info("Updating Vite configuration...");
writeFile(
  "vite.config.ts",
  `import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
`,
);

info("Installing shadcn/ui dependencies...");
pnpm([
  "install",
  "@radix-ui/react-accordion",
  "@radix-ui/react-aspect-ratio",
  "@radix-ui/react-avatar",
  "@radix-ui/react-checkbox",
  "@radix-ui/react-collapsible",
  "@radix-ui/react-context-menu",
  "@radix-ui/react-dialog",
  "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-hover-card",
  "@radix-ui/react-label",
  "@radix-ui/react-menubar",
  "@radix-ui/react-navigation-menu",
  "@radix-ui/react-popover",
  "@radix-ui/react-progress",
  "@radix-ui/react-radio-group",
  "@radix-ui/react-scroll-area",
  "@radix-ui/react-select",
  "@radix-ui/react-separator",
  "@radix-ui/react-slider",
  "@radix-ui/react-slot",
  "@radix-ui/react-switch",
  "@radix-ui/react-tabs",
  "@radix-ui/react-toast",
  "@radix-ui/react-toggle",
  "@radix-ui/react-toggle-group",
  "@radix-ui/react-tooltip",
]);
pnpm([
  "install",
  "sonner",
  "cmdk",
  "vaul",
  "embla-carousel-react",
  "react-day-picker",
  "react-resizable-panels",
  "date-fns",
  "react-hook-form",
  "@hookform/resolvers",
  "zod",
]);

info("Extracting shadcn/ui components...");
// `tar` from BSD/GNU/Win10 all accept -xzf and -C; this stays portable.
run("tar", ["-xzf", COMPONENTS_TARBALL, "-C", "src"]);

info("Creating components.json config...");
writeFile(
  "components.json",
  JSON.stringify(
    {
      $schema: "https://ui.shadcn.com/schema.json",
      style: "default",
      rsc: false,
      tsx: true,
      tailwind: {
        config: "tailwind.config.js",
        css: "src/index.css",
        baseColor: "slate",
        cssVariables: true,
        prefix: "",
      },
      aliases: {
        components: "@/components",
        utils: "@/lib/utils",
        ui: "@/components/ui",
        lib: "@/lib",
        hooks: "@/hooks",
      },
    },
    null,
    2,
  ) + "\n",
);

info("");
info(`Setup complete: ${projectPath}`);
info("Next steps:");
info(`  cd ${projectName}`);
info("  npx pnpm dev      # local preview");
info("");
info("Imports:");
info("  import { Button } from '@/components/ui/button'");
info("  import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'");
