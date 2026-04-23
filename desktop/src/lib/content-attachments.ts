function normalizeContentAttachmentPath(originalName: string): string {
  return originalName
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .join("/")
}

export { normalizeContentAttachmentPath }
