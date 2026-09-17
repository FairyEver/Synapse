import { readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * The temporary directories a Claude Code launch writes its flag settings into.
 *
 * They hold the Provider's credentials in plaintext — the `settings.json` is `0600`
 * and nothing else is written there — so they must not outlive the session. The
 * normal end is the PTY's exit callback, which `claude-code-terminal.ts` registers
 * at launch; this module exists for the launches that never get one, where a crash,
 * a quit or an update kills the process without running any callback at all.
 *
 * Kept apart from the launch itself because the two have different lifetimes: the
 * sweep runs once per app process, before the first launch, and must be usable
 * without a project, a Provider or a terminal service in hand.
 */

const LAUNCH_DIRECTORY_PATTERN = /^synapse-claude-code-[A-Za-z0-9]{6}$/

/**
 * Removes launch directories left behind by a previous app process.
 *
 * Only names matching the `mkdtemp` template are touched. The base directory is the
 * system temp directory, which holds other applications' files, so a broader sweep
 * would be deleting things this app does not own.
 */
export async function removeStaleClaudeCodeLaunchDirectories(baseDir: string): Promise<readonly string[]> {
  const entries = await readdir(baseDir, { withFileTypes: true }).catch(() => [])
  const removed: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !LAUNCH_DIRECTORY_PATTERN.test(entry.name)) continue
    try {
      await rm(path.join(baseDir, entry.name), { recursive: true, force: true })
      removed.push(entry.name)
    } catch {
      continue
    }
  }
  return removed
}

let staleSweep: Promise<readonly string[]> | undefined

/**
 * Once per app process, and shared by every launch: the second launch has nothing
 * left to find, and re-scanning would only add a directory read to the critical path
 * of starting a terminal.
 */
export function sweepStaleClaudeCodeLaunchDirectories(): Promise<readonly string[]> {
  staleSweep ??= removeStaleClaudeCodeLaunchDirectories(os.tmpdir())
  return staleSweep
}

// Only the Electron main process owns these directories; tests and renderer bundles must never
// delete another process's live launch assets.
if (process.type === "browser") void sweepStaleClaudeCodeLaunchDirectories()
