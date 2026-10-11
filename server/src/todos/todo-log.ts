/** Todo queries contain private text; explicit error logs must also omit request content. */
export function todoLogRequest(request: Record<string, unknown>): Record<string, unknown> | null {
  const candidate = request.originalUrl ?? request.url
  const url = typeof candidate === "string" ? candidate.split(/[?#]/u)[0] : ""
  if (url !== "/api/todos" && !url?.startsWith("/api/todos/")) return null
  return { id: request.id, method: request.method, url }
}
