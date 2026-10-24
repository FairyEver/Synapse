import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { StructuredLogger } from "../../runtime/service-registry"
import { isFileNotFoundError } from "../fs-utils"
import { parseInstallStagingName } from "../editor-install-staging-name"

export function isStagingSkillName(name: string): boolean {
  return parseInstallStagingName(name) !== null
}

/** Session-local visibility only; never mutate or delete the user's Skill files. */
export async function discoverStagingSkillOverrides(
  cwd: string,
  configRoot = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"),
  logger?: Pick<StructuredLogger, "warn">,
): Promise<Record<string, "off">> {
  const roots = new Set([path.join(configRoot, "skills")])
  let current = path.resolve(cwd)
  for (;;) {
    roots.add(path.join(current, ".claude", "skills"))
    roots.add(path.join(current, ".agents", "skills"))
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  const names = new Set<string>()
  for (const root of roots) {
    try {
      for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if ((entry.isDirectory() || entry.isSymbolicLink()) && isStagingSkillName(entry.name)) names.add(entry.name)
      }
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        if (!logger) throw error
        logger.warn("Staging Skill directory could not be inspected.", {
          boundary: "agent.skill.staging-discovery", errorCode: (error as NodeJS.ErrnoException).code ?? "unknown",
        })
      }
    }
  }
  return Object.fromEntries([...names].sort().map(name => [name, "off" as const]))
}
