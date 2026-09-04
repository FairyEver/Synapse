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
    if (event.metaKey && event.altKey && !event.ctrlKey && !event.shiftKey) {
      return arrowFocusShortcut(event.key)
    }
    return null
  }

  if (platform === "win32") {
    if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "w") {
      return "close-pane"
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
