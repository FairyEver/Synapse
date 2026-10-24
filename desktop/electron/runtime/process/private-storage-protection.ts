import { constants, accessSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

export type ProtectedProcessLaunch = { readonly command: string; readonly args: readonly string[]; readonly cwd?: string }
export type ProtectProcess = (launch: ProtectedProcessLaunch) => ProtectedProcessLaunch
const UNAVAILABLE = "私有存储进程保护不可用，已阻止执行；不能降级为未隔离进程。"

/** A host-owned deny boundary shared by tool adapters, PTYs, CLI and their descendants. */
export class PrivateStorageProtection {
  readonly roots: readonly string[]
  constructor(roots: readonly string[], private readonly platform: NodeJS.Platform = process.platform) {
    this.roots = [...new Set(roots.flatMap(root => {
      if (!path.isAbsolute(root)) throw new Error(UNAVAILABLE)
      return [path.resolve(root), canonicalPath(root)]
    }))]
  }

  readonly protectProcess: ProtectProcess = launch => {
    if (!this.roots.length) throw new Error(UNAVAILABLE)
    if (launch.cwd && this.roots.some(root => inside(root, canonicalPath(path.resolve(launch.cwd!))))) throw new Error(UNAVAILABLE)
    if (this.platform === "darwin") {
      accessSync("/usr/bin/sandbox-exec", constants.X_OK)
      const filters = this.roots.map(root => `(subpath ${JSON.stringify(root)})`).join(" ")
      // Renaming a parent must not move protected files out from under the deny paths.
      const ancestors = new Set<string>()
      for (const root of this.roots) {
        for (let parent = path.dirname(root); ; parent = path.dirname(parent)) {
          ancestors.add(parent)
          if (path.dirname(parent) === parent) break
        }
      }
      const profile = `(version 1)(allow default)(deny file-read* file-write* ${filters})`
        + `(deny file-write-unlink ${[...ancestors].map(parent => `(literal ${JSON.stringify(parent)})`).join(" ")})`
        + '(deny mach-lookup (require-not (require-any (global-name "com.apple.system.opendirectoryd.libinfo") (global-name "com.apple.trustd.agent"))))'
        + "(deny appleevent-send)(deny lsopen)(deny mach-priv-task-port)"
        // getaddrinfo uses this root-owned socket; localhost only exercises /etc/hosts.
        + '(deny network-outbound (require-all (remote unix-socket) (require-not (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))))'
        + "(deny process-info* (require-not (target same-sandbox)))"
      return { command: "/usr/bin/sandbox-exec", args: ["-p", profile, launch.command, ...launch.args] }
    }
    // A plain Linux mount mask leaves host IPC brokers reachable. Until that boundary
    // (and Windows) has an equivalent verified adapter, fail closed.
    throw new Error(UNAVAILABLE)
  }

  async deniesPath(value: string, recursive = false, relative = false): Promise<boolean> {
    if (/^file:/i.test(value)) {
      try { value = fileURLToPath(value) } catch { return true }
    }
    const requested = value === "~" ? homedir() : value.startsWith("~/") || value.startsWith("~\\")
      ? path.join(homedir(), value.slice(2)) : value
    if (!requested || (!relative && !path.isAbsolute(requested))) return false
    const absolute = path.resolve(requested)
    const overlaps = (target: string) => this.roots.some(root => inside(root, target) || (recursive && inside(target, root)))
    if (overlaps(absolute)) return true
    try {
      return overlaps(canonicalPath(absolute))
    } catch (error) {
      // Arbitrary tool strings can resemble paths; an overlong name cannot be opened.
      if ((error as NodeJS.ErrnoException).code === "ENAMETOOLONG") return false
      return true
    }
  }
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function canonicalPath(target: string): string {
  try { return realpathSync(target) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || path.dirname(target) === target) throw error
    return path.join(canonicalPath(path.dirname(target)), path.basename(target))
  }
}
