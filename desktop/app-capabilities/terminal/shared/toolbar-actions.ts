import type { TerminalSession } from "./schema"

/**
 * The built-in buttons every terminal window shows, and the rules for resolving one.
 *
 * They live in `shared/` rather than beside the renderer that draws them because the
 * main process has to read the same list: a phone is shown these buttons too, and the
 * projection that produces them runs where the socket does. Keeping one definition is
 * the point — two lists would let the phone run something the computer's own toolbar
 * does not offer, which is exactly the drift this feature exists to avoid.
 */

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
  /**
   * First, and the only built-in a desktop user does not need — they have a keyboard.
   *
   * It is here for the phone. A phone's accessory bar is now this same list, and the
   * only other way to send a bare carriage return is an empty-text `command` intent,
   * which the protocol refuses (`boundedString` requires a non-empty body). Without
   * this button a phone could read a TUI but never answer it, including the approval
   * prompts Claude Code waits on.
   */
  {
    id: "enter",
    label: "回车",
    ariaLabel: "发送回车",
    platforms: ALL_PLATFORMS,
    availability: "running-session",
    kind: "terminal-sequence",
    sequence: "\r",
  },
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
  status: TerminalSession["status"] | null | undefined,
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
