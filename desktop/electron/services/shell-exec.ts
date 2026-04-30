type ShellKind = "posix" | "cmd" | "powershell"

type ResolveShellCommandOptions = {
  readonly platform?: NodeJS.Platform
  readonly posixLogin?: boolean
  readonly windowsDefault?: "cmd" | "powershell"
}

type ResolvedShellCommand = {
  readonly shell: ShellKind
  readonly command: string
  readonly args: readonly string[]
}

function isShellKind(value: unknown): value is ShellKind {
  return value === "posix" || value === "cmd" || value === "powershell"
}

function resolveShellCommand(
  shell: ShellKind | undefined,
  content: string,
  options: ResolveShellCommandOptions = {},
): ResolvedShellCommand {
  const platform = options.platform ?? process.platform
  const effectiveShell = shell ?? (platform === "win32" ? options.windowsDefault ?? "cmd" : "posix")

  if (effectiveShell === "powershell") {
    return {
      shell: effectiveShell,
      command: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", content],
    }
  }

  if (effectiveShell === "cmd") {
    return {
      shell: effectiveShell,
      command: "cmd.exe",
      args: ["/d", "/s", "/c", content],
    }
  }

  return {
    shell: effectiveShell,
    command: platform === "win32" ? "sh" : "/bin/sh",
    args: [options.posixLogin === false ? "-c" : "-lc", content],
  }
}

export { isShellKind, resolveShellCommand }
export type { ResolvedShellCommand, ResolveShellCommandOptions, ShellKind }
