export function normalizeDriveSiteRelativePath(input: string): string {
  if (input.includes("\\")) throw new Error("站点路径无效。")
  const segments = input.split("/").filter(Boolean)
  if (segments.length === 0 || input.startsWith("/")) throw new Error("站点路径无效。")
  if (segments.some((segment) => segment === "." || segment === "..")) throw new Error("站点路径无效。")
  const normalized = segments.join("/")
  if (normalized.length > 1024) throw new Error("站点路径无效。")
  return normalized
}

export function resolveDriveSiteRequestPath(pathname: string):
  | { readonly kind: "entry" }
  | { readonly kind: "asset"; readonly relativePath: string; readonly directory: boolean } {
  const trimmed = pathname.replace(/^\/+/u, "")
  if (!trimmed) return { kind: "entry" }
  if (trimmed.endsWith("/")) {
    return { kind: "asset", relativePath: normalizeDriveSiteRelativePath(`${trimmed}index.html`), directory: true }
  }
  return { kind: "asset", relativePath: normalizeDriveSiteRelativePath(trimmed), directory: false }
}

export function isDriveSiteHtmlPath(pathname: string): boolean {
  return /\.html?$/iu.test(pathname)
}
