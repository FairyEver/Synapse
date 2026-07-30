export type TerminalKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "isComposing" | "key" | "metaKey" | "shiftKey"
>

export function isTerminalShiftEnterEvent(event: TerminalKeyboardEvent): boolean {
  return event.key === "Enter"
    && event.shiftKey
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.isComposing
}
