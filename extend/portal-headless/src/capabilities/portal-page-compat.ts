/** Preserve the Portal list's delete-button condition without inventing a global binding check. */
type RegistryClient = {
  list: (...args: unknown[]) => Promise<unknown>
  prepareRemove: (...args: unknown[]) => Promise<unknown>
  submit: (...args: unknown[]) => Promise<unknown>
}

const installed = new WeakSet<object>()
function record (value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/** Optional module integration: the independently committed SDK may not contain aiPromptTool yet. */
export function installPortalPageCompatibility (host: object): void {
  const module = record(Object.getOwnPropertyDescriptor(host, 'aiPromptTool')?.value)
  const registry = record(module?.openApiRegistry)
  if (!registry || installed.has(registry)) return
  if (!['list', 'prepareRemove', 'submit'].every(key => typeof registry[key] === 'function')) return
  const client = registry as RegistryClient
  const list = client.list.bind(client)
  const prepareRemove = client.prepareRemove.bind(client)
  const submit = client.submit.bind(client)
  const boundById = new Map<string, boolean>()
  const assertDeletable = (id: unknown): void => {
    if (boundById.get(String(id))) throw new Error('该接口已被提示词绑定，无法删除')
  }
  client.list = async (...args) => {
    const result = await list(...args)
    const rows = record(result)?.list
    if (Array.isArray(rows)) {
      for (const value of rows) {
        const row = record(value)
        if (row && (typeof row.id === 'string' || typeof row.id === 'number')) {
          // Exactly the page's truthiness check, including false/absent allowing the action.
          boundById.set(String(row.id), Boolean(row.isBound))
        }
      }
    }
    return result
  }
  client.prepareRemove = async (...args) => {
    assertDeletable(args[0])
    return prepareRemove(...args)
  }
  client.submit = async (...args) => {
    const request = record(record(args[0])?.request)
    const match = typeof request?.url === 'string'
      ? /^\/admin-api\/system\/openApiRegistry\/delete\/([^/?]+)$/.exec(request.url) : null
    if (request?.method === 'delete' && match) assertDeletable(match[1])
    return submit(...args)
  }
  installed.add(registry)
}
