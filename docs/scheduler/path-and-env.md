# Scheduler PATH & Environment Variable Handling

Technical reference for how Synapse scheduled tasks resolve environment variables, with a focus on `PATH`.

## Overview

Electron `.app` bundles launch with a minimal `PATH` (typically `/usr/bin:/bin:/usr/sbin:/sbin`). Tools installed via nvm, asdf, Homebrew, or similar managers live in directories like `~/.nvm/versions/node/…/bin` or `/opt/homebrew/bin`, which are added to `PATH` by login shell profile scripts (`~/.profile`, `~/.bash_profile`, `~/.zshrc`).

Synapse's `ControlledProcessRunner` resolves a rich `PATH` by default so that scheduled tasks can find these tools without extra configuration.

## PATH Resolution Flow

```
┌─────────────────────┐
│  User-provided env   │  (config.env.PATH, if set)
└──────────┬──────────┘
           │
     ┌─────▼─────┐
     │ pathStrategy│
     └─────┬─────┘
           │
    ┌──────┴──────┐
    │             │
  merge        replace
    │             │
    ▼             ▼
 splitPath    user PATH
 + dedupe     verbatim
 + join
    │
    ▼
┌─────────────────────┐
│  Shell PATH          │  (/bin/sh -lc 'echo $PATH')
│  or process.env.PATH │  (fallback)
└─────────────────────┘
```

### `pathStrategy`

| Value     | Behaviour |
|-----------|-----------|
| `merge`   | **(default)** User PATH entries + login shell PATH entries, deduplicated. User entries come first. |
| `replace` | User PATH used verbatim. If no user PATH, falls back to shell PATH. |

### `posixLogin`

| Value  | Shell flag | Effect |
|--------|-----------|--------|
| `true` (default) | `-lc` | `/bin/sh` loads `~/.profile` etc., providing the full PATH from the user's login environment. |
| `false` | `-c` | `/bin/sh` runs without loading profile scripts. Faster, but PATH may be minimal. |

Only applies when `shell === "posix"`. Ignored for `cmd` and `powershell`.

## Environment Variable Allowlist

The runner applies an allowlist to prevent leaking the full `process.env` to child processes:

| Category | Variables |
|----------|-----------|
| PATH     | `PATH`, `PATHEXT` |
| User     | `HOME`, `USER`, `SHELL`, `TMPDIR`, `TEMP`, `TMP` |
| Windows  | `SystemRoot`, `WINDIR`, `ComSpec`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `HOMEDRIVE`, `HOMEPATH` |
| Locale (run_as_user) | `LANG`, `LC_ALL`, `LC_CTYPE`, `LC_MESSAGES`, `TERM` |

User-specified `config.env` keys are always added to the allowlist.

## Helper Functions

### `splitPath(pathValue, delimiter)`

Splits a PATH string into an array of non-empty entries.

### `dedupePath(parts, caseInsensitive)`

Removes duplicate entries. Case-insensitive on Windows.

### `computePath(strategy, userPath, shellPath, fallbackPath, delimiter, caseInsensitive)`

Computes the final PATH string based on the strategy.

## Run Diagnostics

Every `ControlledProcessResult` includes a `diagnostics` field:

```ts
interface ControlledProcessDiagnostics {
  envKeys: readonly string[]      // Sorted list of env keys passed to the child
  pathSummary: string             // Human-readable summary (first entry + count)
  pathEntries: readonly string[]  // Full list of PATH entries
  shell: string                   // Resolved command (e.g. "/bin/sh")
  args: readonly string[]         // Resolved args (e.g. ["-lc", "echo ok"])
}
```

Diagnostics are always populated regardless of exit code. The UI displays them when `status !== "success"` to aid debugging.

## Source Files

| File | Role |
|------|------|
| `desktop/electron/runtime/process/controlled-runner.ts` | PATH merge logic, diagnostics |
| `desktop/electron/services/shell-exec.ts` | `resolveShellCommand` with `posixLogin` |
| `desktop/action-packages/builtin/shell-process.main.ts` | Passthrough to runner |
| `desktop/action-packages/builtin/command/schema.ts` | Zod schema |
| `desktop/action-packages/builtin/script/schema.ts` | Zod schema |
| `desktop/src/action-runtime/action-result-view.tsx` | Diagnostics UI |
