/** Public share content and optional identity can initialize independently. */
export async function bootstrapDashboard(href: string, initializeSession: () => Promise<void>, render: () => void): Promise<void> {
  const pathname = new URL(href, 'http://synapse.local').pathname
  const publicShare = /^\/share\/[^/]+(?:\/items\/[^/]+)?\/?$/u.test(pathname)
  const session = initializeSession()
  if (publicShare) render()
  await session
  if (!publicShare) render()
}
