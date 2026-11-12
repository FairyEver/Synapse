const uploadPath = /^\/api\/skill-hub\/uploads\/?$/i
const hubPath = /^\/api\/(admin\/)?skill-hub(?:\/|$)/i
const skillsPath = /^\/skills(?:\/[^/]+(?:\/(package|main|file|icon|versions|maintainer|restore)(?:\/rendered)?)?)?\/?$/i

export function isHubUploadPath(url: string): boolean {
  return uploadPath.test(url.split("?", 1)[0])
}

export function hubLogPath(url = ""): string | undefined {
  const path = url.split("?", 1)[0]
  const match = hubPath.exec(path)
  if (!match) return undefined
  const base = match[1] ? "/api/admin/skill-hub" : "/api/skill-hub"
  const rest = path.toLowerCase().slice(base.length).replace(/\/$/, "")
  if (rest === "/uploads" || rest === "/teams" || rest === "/skills") return base + rest
  if (skillsPath.test(rest)) {
    const suffix = skillsPath.exec(rest)?.[1]
    return base + "/skills/:id" + (suffix ? `/${suffix}` : "")
  }
  if (/^\/receipts\/[^/]+$/.test(rest)) return base + "/receipts/:requestId"
  return base
}

export function skillHubLogRequest(request: { method?: unknown; url?: unknown; originalUrl?: unknown } & Record<string, unknown>) {
  const raw = typeof request.originalUrl === "string" ? request.originalUrl : request.url
  const url = typeof raw === "string" ? hubLogPath(raw) : undefined
  return url ? { method: request.method, url } : undefined
}
