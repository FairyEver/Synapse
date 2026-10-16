import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const routeTreePath = fileURLToPath(new URL('../routeTree.gen.ts', import.meta.url))

describe('retired content store routes', () => {
  it.each(['/my-content', '/content-store', '/content-store-admin'])(
    'does not register the retired %s route or its children',
    (routePath) => {
      const routeTree = readFileSync(routeTreePath, 'utf8')

      expect(routeTree).not.toContain(routePath)
    }
  )

  it('keeps Skill Repository management routes under the authenticated layout', () => {
    const routeTree = readFileSync(routeTreePath, 'utf8')

    for (const routePath of ['/skill-repositories/', '/skill-repositories/$repositoryId']) {
      const escapedPath = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expect(routeTree).toMatch(new RegExp(
        `'/_authenticated${escapedPath}': \\{[^}]*parentRoute: typeof AuthenticatedRouteRoute`
      ))
    }
  })
})
