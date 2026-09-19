export type TerminalKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "isComposing" | "key" | "metaKey" | "shiftKey"
>

export type TerminalPaneShortcut =
  | "close-pane"
  | "focus-down"
  | "focus-left"
  | "focus-right"
  | "focus-up"
  | "rename-session"
  | "split-down"
  | "split-right"

export type TerminalClipboardShortcut = "copy" | "paste"

export function getTerminalClipboardShortcut(
  event: TerminalKeyboardEvent,
  platform: string | undefined,
): TerminalClipboardShortcut | null {
  if (
    platform !== "darwin"
    || event.isComposing
    || !event.metaKey
    || event.altKey
    || event.ctrlKey
    || event.shiftKey
  ) {
    return null
  }

  const key = event.key.toLowerCase()
  if (key === "c") return "copy"
  if (key === "v") return "paste"
  return null
}

/**
 * 打开面板内查找。
 *
 * 用各平台自己的主修饰键，和别处一致：macOS 上 `⌘F`，其它平台 `Ctrl+F`。不带 Shift、
 * 不带 Alt——那些组合留给编辑器自己的按键，终端不替它们做主。
 */
export function getTerminalSearchShortcut(
  event: TerminalKeyboardEvent,
  platform: string | undefined,
): "find" | null {
  if (event.isComposing || event.altKey || event.shiftKey) return null
  if (event.key.toLowerCase() !== "f") return null
  return platform === "darwin"
    ? event.metaKey && !event.ctrlKey ? "find" : null
    : event.ctrlKey && !event.metaKey ? "find" : null
}

export function isTerminalShiftEnterEvent(event: TerminalKeyboardEvent): boolean {
  return event.key === "Enter"
    && event.shiftKey
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.isComposing
}

export function getTerminalPaneShortcut(
  event: TerminalKeyboardEvent,
  platform: string | undefined,
): TerminalPaneShortcut | null {
  if (event.isComposing) return null

  if (platform === "darwin") {
    if (event.metaKey && !event.altKey && !event.ctrlKey && event.key.toLowerCase() === "w") {
      return event.shiftKey ? null : "close-pane"
    }
    if (event.metaKey && !event.altKey && !event.ctrlKey && event.key.toLowerCase() === "d") {
      return event.shiftKey ? "split-down" : "split-right"
    }
    /*
     * `⌘R` is not the shell's key, so the terminal can take it. It used to belong to Electron's
     * default View → Reload; the application menu no longer carries a reload item, which is what
     * frees this combination (see the main-process menu template).
     */
    if (event.metaKey && !event.altKey && !event.ctrlKey && event.key.toLowerCase() === "r") {
      return event.shiftKey ? null : "rename-session"
    }
    if (event.metaKey && event.altKey && !event.ctrlKey && !event.shiftKey) {
      return arrowFocusShortcut(event.key)
    }
    return null
  }

  if (platform === "win32") {
    if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "w") {
      return "close-pane"
    }
    // Shift is required here because plain `Ctrl+R` is the shell's own reverse history search.
    if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "r") {
      return "rename-session"
    }
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey) {
      if (event.key === "+" || event.key === "=") return "split-right"
      if (event.key === "-") return "split-down"
    }
    if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      return arrowFocusShortcut(event.key)
    }
  }

  return null
}

function arrowFocusShortcut(key: string): TerminalPaneShortcut | null {
  if (key === "ArrowLeft") return "focus-left"
  if (key === "ArrowRight") return "focus-right"
  if (key === "ArrowUp") return "focus-up"
  if (key === "ArrowDown") return "focus-down"
  return null
}
