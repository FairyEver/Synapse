import type { Options } from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }
import { realpathSync } from "node:fs"
import { realpath } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { isFileNotFoundError, isPathInside } from "../fs-utils"

export const PRIVATE_STORAGE_DENIED_MESSAGE = "Synapse 私有存储不允许直接访问。邮箱只能通过当前登录用户的 app_mail_* 工具查询；工具不可用时停止并报告，不能使用文件、数据库或脚本绕过。"

/** Host-owned roots, never supplied by a model or Renderer. Keep both lexical and real paths. */
export class AgentPrivateStoragePolicy {
  readonly roots: readonly string[]

  constructor(roots: readonly string[]) {
    this.roots = [...new Set(roots.flatMap(root => {
      if (!path.isAbsolute(root)) throw new Error("Private storage root must be absolute")
      const absolute = path.resolve(root)
      return [absolute, canonicalStoragePath(absolute)]
    }))]
  }

  sandbox(): Options["sandbox"] {
    if (!this.roots.length) return undefined
    return {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false,
      excludedCommands: [],
      filesystem: {
        disabled: false,
        allowManagedReadPathsOnly: true,
        denyRead: [...this.roots],
        denyWrite: [...this.roots],
        allowRead: [],
      },
      credentials: { files: this.roots.map(root => ({ path: root, mode: "deny" })) },
    }
  }

  managedSettings(): Options["managedSettings"] {
    if (!this.roots.length) return undefined
    return { sandbox: this.sandbox(), permissions: { deny: this.permissionRules() } }
  }

  permissionRules(): string[] {
    return this.roots.flatMap(root => {
      const normalized = root.replaceAll("\\", "/").replace(/^([a-z]):\//i, (_, drive: string) => `/${drive.toLowerCase()}/`)
      const absolutePattern = `/${normalized}`
      return ["Read", "Edit"].flatMap(tool => [`${tool}(${absolutePattern})`, `${tool}(${absolutePattern}/**)`])
    })
  }

  async denies(toolName: string, input: Record<string, unknown>, cwd: string): Promise<boolean> {
    if (!this.roots.length) return false
    if (toolName === "Bash") return input.dangerouslyDisableSandbox === true
    const recursive = toolName === "Grep" || toolName === "Glob" || toolName === "LS"
    const fileTool = ["Read", "Write", "Edit", "MultiEdit", "NotebookEdit"].includes(toolName)
    if (!recursive && !fileTool) return false
    const requested = recursive ? input.path ?? cwd : input.file_path ?? input.notebook_path
    if (typeof requested !== "string") return true
    const absolute = path.resolve(cwd, expandHome(requested))
    const targets = [absolute]
    if (toolName === "Glob" && typeof input.pattern === "string") {
      const prefix = expandHome(input.pattern).split(/[*?[\]{}]/, 1)[0] ?? ""
      targets.push(path.resolve(absolute, prefix.endsWith(path.sep) ? prefix : path.dirname(prefix)))
    }
    const overlaps = (target: string) => this.roots.some(root =>
      isPathInside(root, target) || (recursive && isPathInside(target, root)))
    if (targets.some(overlaps)) return true
    try {
      for (const target of targets) if (overlaps(await canonicalToolPath(target))) return true
      return false
    } catch {
      return true
    }
  }
}

function expandHome(target: string): string {
  return target === "~" ? homedir()
    : target.startsWith("~/") || target.startsWith("~\\") ? path.join(homedir(), target.slice(2))
    : target
}

async function canonicalToolPath(target: string): Promise<string> {
  try {
    return await realpath(target)
  } catch (error) {
    if (!isFileNotFoundError(error) || path.dirname(target) === target) throw error
    return path.join(await canonicalToolPath(path.dirname(target)), path.basename(target))
  }
}

function canonicalStoragePath(target: string): string {
  try {
    return realpathSync(target)
  } catch (error) {
    if (!isFileNotFoundError(error) || path.dirname(target) === target) throw error
    // The cache may not exist until the first mail account is configured.
    return path.join(canonicalStoragePath(path.dirname(target)), path.basename(target))
  }
}
