/** Canonical public href for console links, including links opened outside its router. */
export function consoleHref(path: string, options: { params?: Record<string, string>; search?: Record<string, string | number | boolean | null | undefined> } = {}) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('控制台链接必须是站内路径')
  const resolved = path.replace(/\$([\w]+)/gu, (_, key: string) => {
    const value = options.params?.[key]
    if (value === undefined) throw new Error(`缺少路由参数 ${key}`)
    return encodeURIComponent(value)
  })
  const query = new URLSearchParams()
  Object.entries(options.search ?? {}).forEach(([key, value]) => { if (value !== null && value !== undefined) query.set(key, String(value)) })
  const search = query.toString()
  return `/console${resolved}${search ? `?${search}` : ''}`
}
