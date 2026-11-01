import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { routeTree } from '@/routeTree.gen'
import { adminNavigation, userNavigation } from '@/components/layout/navigation'

function userRouter() {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/console/'] }),
    basepath: '/console',
    context: { queryClient: new QueryClient() },
  })
}

describe('Dashboard content routes and navigation', () => {
  it.each(['/my-content', '/content-store', '/content-store-admin', '/drive/folders/$folderId'])(
    'does not register the retired user route %s',
    (retiredPath) => {
      const router = userRouter()
      expect(Object.keys(router.routesByPath).some((path) => path === retiredPath || path.startsWith(`${retiredPath}/`))).toBe(false)
    }
  )

  it('does not register a Drive root listing while preserving independent item routes', () => {
    const router = userRouter()
    expect(Object.keys(router.routesByPath)).not.toContain('/drive')
    expect(Object.keys(router.routesByPath)).toContain('/drive/items/$browserItemId')
  })

  it('retains authenticated Skill Repository management and the standalone file route', () => {
    const router = userRouter()
    for (const routePath of ['/skill-repositories', '/skill-repositories/$repositoryId', '/drive/items/$browserItemId']) {
      const route = router.routesByPath[routePath as keyof typeof router.routesByPath]
      expect(route).toBeDefined()
      expect(route?.parentRoute.id).toBe('/_authenticated')
    }
  })

  it('removes Drive and retired content entries from both navigation inventories', () => {
    const paths = [...userNavigation, ...adminNavigation].map((item) => item.path)
    for (const retired of ['/drive', '/my-content', '/content-store', '/content-store-admin']) {
      expect(paths.some((path) => path === retired || path.startsWith(`${retired}/`))).toBe(false)
    }
    expect(userNavigation.some((item) => item.path === '/skill-repositories')).toBe(true)
    expect(adminNavigation.some((item) => item.path === '/skill-repositories')).toBe(true)
  })
})
