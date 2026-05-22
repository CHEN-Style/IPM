# `desktop/vendor/`

Third-party binaries that need to ship inside the packaged IPM app but
are too large / non-textual to commit to git. The actual files are
`.gitignore`d (see `desktop/.gitignore`); developers (or CI) populate
them via `npm run setup:mingit` before `npm run make`.

## `vendor/MinGit/`

**What it is**: PortableGit-MinGit-busybox, the official "embeddable
Git" distribution from the
[Git for Windows](https://github.com/git-for-windows/git/releases)
project. We ship it as a fallback `bash.exe` so users on a clean
Windows machine never see the "未检测到 bash 解释器" banner — KnowClaw's
Skills (pdf-builder / docx-builder / pptx-builder /
web-artifacts-builder, etc.) keep working out of the box.

**Why MinGit-busybox specifically**: at ~38 MB unpacked it is the
smallest variant that still ships `bash.exe` + busybox-provided
core utils (sh / awk / sed / grep / find / wget). The "full" PortableGit
release is ~280 MB and includes a whole Git client we don't need.

**How resolution works**:
The main process's `resolveBashShell()` (in
`src/main/ipc/knowclaw.js`) probes — in order:

1. `KNOWCLAW_BASH_PATH` env override
2. `%ProgramFiles%\Git\bin\bash.exe`
3. `%ProgramFiles(x86)%\Git\bin\bash.exe`
4. `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`
5. `where bash` (PATH lookup)
6. **`<resources>/MinGit/usr/bin/bash.exe`** ← us, last resort

So if the user already has Git for Windows installed (case 2-4) we
defer to that; the bundled MinGit only kicks in when nothing else
exists.

## Populating MinGit

Easiest:

```bash
cd desktop
npm run setup:mingit
```

This downloads the latest MinGit-busybox release from the GitHub
releases page, verifies the SHA-256, and extracts it into
`desktop/vendor/MinGit/`. Re-running is idempotent — it skips the
download if `usr/bin/bash.exe` already exists.

Manual fallback (if you can't run the script — corp proxy, etc.):

1. Grab the latest `MinGit-*-busybox-64-bit.zip` from
   <https://github.com/git-for-windows/git/releases/latest>
2. Extract its contents directly into `desktop/vendor/MinGit/`.
3. Verify `desktop/vendor/MinGit/usr/bin/bash.exe` exists.

## Packaging behaviour

`forge.config.js` looks at `vendor/MinGit/` during `packageAfterCopy`:

- **Folder populated** → it's copied into the packaged app at
  `<resources>/MinGit/`, so `process.resourcesPath`-relative lookup
  works in the installed product.
- **Folder empty / absent** → the build still succeeds, packaged app
  simply has no bundled fallback. Users without Git for Windows will
  see the "未检测到 bash 解释器" banner in KnowClaw.

This makes MinGit an opt-in build artifact: contributors who only
work on UI/IPC code can skip it; whoever cuts the release build
should run `npm run setup:mingit` first.
