export function driveSiteContentType(relativePath: string, storedContentType?: string | null): string {
  const inferredContentType = inferDriveSiteContentType(relativePath)
  if (inferredContentType) return inferredContentType
  if (storedContentType) return storedContentType
  return "application/octet-stream"
}

function inferDriveSiteContentType(relativePath: string): string | null {
  const lower = relativePath.toLowerCase()
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8"
  if (lower.endsWith(".css")) return "text/css; charset=utf-8"
  if (lower.endsWith(".js")) return "text/javascript; charset=utf-8"
  if (lower.endsWith(".json")) return "application/json; charset=utf-8"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".svg")) return "image/svg+xml"
  if (lower.endsWith(".ico")) return "image/x-icon"
  if (lower.endsWith(".woff")) return "font/woff"
  if (lower.endsWith(".woff2")) return "font/woff2"
  return null
}

export function driveSiteCacheControl(relativePath: string, input: { readonly accessMode?: string | null } = {}): string {
  if (input.accessMode === "password") return "private, no-store"
  return /\.html?$/iu.test(relativePath) ? "no-cache" : "public, max-age=300"
}

export function renderDriveSiteNotFoundPage(): string {
  return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>站点不可访问</title></head><body>站点不可访问</body></html>"
}
