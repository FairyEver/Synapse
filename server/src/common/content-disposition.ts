export type ContentDispositionKind = "attachment" | "inline"

export function contentDispositionHeader(kind: ContentDispositionKind, filename: string): string {
  const asciiFilename = filename.replace(/[^\x20-\x7E]|["\\;,\r\n]/g, "_")
  return `${kind}; filename="${asciiFilename}"; filename*=UTF-8''${encodeRFC5987ValueChars(filename)}`
}

export function attachmentContentDisposition(filename: string): string {
  return contentDispositionHeader("attachment", filename)
}

export function inlineContentDisposition(filename: string): string {
  return contentDispositionHeader("inline", filename)
}

function encodeRFC5987ValueChars(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}
