/** Pure shell formatting shared by terminal drops and mobile file references. */
const WINDOWS_POSIX_SHELL_NAMES = new Set(["bash", "bash.exe", "sh", "sh.exe", "zsh", "zsh.exe"])
function assertSafeTarget(target: string): void {
  if (!target || /[\x00-\x1f\x7f]/.test(target)) throw new Error("unsafe_path")
}
function escapePosixPath(target: string): string {
  return target.replace(/([\\\s"'`$&;()<>|*?[\]{}!#~])/g, "\\$1")
}

export function formatTerminalPathReference(target: string, platform: string | undefined, shell: string): string {
  assertSafeTarget(target)
  const shellName = shell.split(/[\\/]/).pop()?.toLowerCase()
  if (shellName === "powershell" || shellName === "powershell.exe" || shellName === "pwsh" || shellName === "pwsh.exe") {
    return `'${target.replaceAll("'", "''")}'`
  }
  if (shellName === "cmd" || shellName === "cmd.exe") {
    // CMD expands %variables% and, depending on the session, !variables! even in quotes.
    if (/["%!]/.test(target)) throw new Error("unsupported_platform")
    return `"${target}"`
  }
  if (platform === "win32" && (!WINDOWS_POSIX_SHELL_NAMES.has(shellName ?? "") || !target.startsWith("/"))) throw new Error("unsupported_platform")
  return escapePosixPath(target)
}

export function formatDroppedTerminalPaths(paths: readonly string[], platform: string | undefined, shell: string): string {
  const shellName = shell.split(/[\\/]/).pop()?.toLowerCase()
  return `${paths.map((target) => {
    // Native desktop drag producers return Windows paths. Retain their existing
    // literal escaping without guessing this shell's /c or /mnt/c mount policy.
    if (platform === "win32" && WINDOWS_POSIX_SHELL_NAMES.has(shellName ?? "") && (/^[a-z]:[\\/]/i.test(target) || /^\\\\/.test(target))) {
      assertSafeTarget(target)
      return escapePosixPath(target)
    }
    return formatTerminalPathReference(target, platform, shell)
  }).join(" ")} `
}
