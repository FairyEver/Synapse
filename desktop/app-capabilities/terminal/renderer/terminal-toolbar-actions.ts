import type { SynapseTerminalSession } from "../../../src/types/terminal"

export type TerminalToolbarPlatform = "darwin" | "win32" | "linux"
export type TerminalToolbarAvailability = "running-session" | "any-session"

type PlatformPayload = string | Partial<Record<TerminalToolbarPlatform, string>>

type TerminalToolbarActionBase = {
  readonly id: string
  readonly label: string
  readonly ariaLabel: string
  readonly platforms: readonly TerminalToolbarPlatform[]
  readonly availability: TerminalToolbarAvailability
}

export type TerminalToolbarAction =
  | (TerminalToolbarActionBase & {
      readonly kind: "terminal-sequence"
      readonly sequence: PlatformPayload
    })
  | (TerminalToolbarActionBase & {
      readonly kind: "xterm-local"
      readonly operation: "clear"
    })
  | (TerminalToolbarActionBase & {
      readonly kind: "shell-command"
      readonly command: PlatformPayload
    })

const ALL_PLATFORMS = ["darwin", "win32", "linux"] as const

export const TERMINAL_TOOLBAR_ACTIONS: readonly TerminalToolbarAction[] = [
  {
    id: "interrupt",
    label: "Ctrl+C",
    ariaLabel: "中断当前进程",
    platforms: ALL_PLATFORMS,
    availability: "running-session",
    kind: "terminal-sequence",
    sequence: "\x03",
  },
  {
    id: "clear",
    label: "Clear",
    ariaLabel: "清空终端显示",
    platforms: ALL_PLATFORMS,
    availability: "any-session",
    kind: "xterm-local",
    operation: "clear",
  },
  {
    id: "claude",
    label: "Claude",
    ariaLabel: "运行 claude",
    platforms: ALL_PLATFORMS,
    availability: "running-session",
    kind: "shell-command",
    command: "claude",
  },
  {
    id: "codex",
    label: "Codex",
    ariaLabel: "运行 codex",
    platforms: ALL_PLATFORMS,
    availability: "running-session",
    kind: "shell-command",
    command: "codex",
  },
  {
    id: "vscode",
    label: "code .",
    ariaLabel: "用 VS Code 打开当前目录",
    platforms: ALL_PLATFORMS,
    availability: "running-session",
    kind: "shell-command",
    command: "code .",
  },
  {
    id: "slash-exit",
    label: "/exit",
    ariaLabel: "运行 /exit",
    platforms: ALL_PLATFORMS,
    availability: "running-session",
    kind: "shell-command",
    command: "/exit",
  },
  {
    id: "slash-clear",
    label: "/clear",
    ariaLabel: "运行 /clear",
    platforms: ALL_PLATFORMS,
    availability: "running-session",
    kind: "shell-command",
    command: "/clear",
  },
] as const

export function getTerminalToolbarActions(platform: string | undefined): readonly TerminalToolbarAction[] {
  const normalized = normalizeTerminalToolbarPlatform(platform)
  if (!normalized) return TERMINAL_TOOLBAR_ACTIONS.filter(supportsAllPlatforms)
  return TERMINAL_TOOLBAR_ACTIONS.filter((action) => action.platforms.includes(normalized))
}

export function resolveTerminalToolbarPayload(
  action: Extract<TerminalToolbarAction, { kind: "terminal-sequence" | "shell-command" }>,
  platform: string | undefined,
): string | undefined {
  const normalized = normalizeTerminalToolbarPlatform(platform)
  const payload = action.kind === "terminal-sequence" ? action.sequence : action.command
  if (typeof payload === "string") return payload
  return normalized ? payload[normalized] : undefined
}

export function isTerminalToolbarActionEnabled(
  action: TerminalToolbarAction,
  status: SynapseTerminalSession["status"] | null | undefined,
): boolean {
  if (action.availability === "any-session") return Boolean(status)
  return status === "running"
}

function normalizeTerminalToolbarPlatform(platform: string | undefined): TerminalToolbarPlatform | undefined {
  if (platform === "darwin" || platform === "win32" || platform === "linux") return platform
  return undefined
}

function supportsAllPlatforms(action: TerminalToolbarAction): boolean {
  return ALL_PLATFORMS.every((platform) => action.platforms.includes(platform))
}
