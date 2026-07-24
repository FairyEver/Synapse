import {
  createClipboardErrorPayload,
  type ClipboardErrorPayload,
} from "./errors"

export const CLIPBOARD_TEXT_MAX_BYTES = 1024 * 1024

export type ClipboardTextValidation =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: ClipboardErrorPayload }

export function validateClipboardWriteText(value: unknown): ClipboardTextValidation {
  return validateClipboardText(value, false)
}

export function validateClipboardReadText(value: unknown): ClipboardTextValidation {
  return validateClipboardText(value, true)
}

export function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return true
      const nextCodeUnit = value.charCodeAt(index + 1)
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return true
      index++
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true
    }
  }
  return false
}

function validateClipboardText(
  value: unknown,
  allowEmpty: boolean,
): ClipboardTextValidation {
  if (typeof value !== "string") {
    return invalid("type")
  }
  if (!allowEmpty && value.length === 0) {
    return invalid("empty")
  }
  if (hasUnpairedSurrogate(value)) {
    return invalid("invalid_unicode")
  }
  if (value.includes("\u0000")) {
    return invalid("forbidden_character")
  }
  if (new TextEncoder().encode(value).byteLength > CLIPBOARD_TEXT_MAX_BYTES) {
    return {
      ok: false,
      error: createClipboardErrorPayload("TEXT_TOO_LARGE"),
    }
  }
  return { ok: true, text: value }
}

function invalid(
  reason: "type" | "empty" | "invalid_unicode" | "forbidden_character",
): ClipboardTextValidation {
  return {
    ok: false,
    error: createClipboardErrorPayload("INVALID_INPUT", {
      field: "text",
      reason,
    }),
  }
}
