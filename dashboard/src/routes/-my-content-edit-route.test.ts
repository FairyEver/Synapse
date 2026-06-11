import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const routeTreePath = fileURLToPath(new URL('../routeTree.gen.ts', import.meta.url))

describe('my content edit route', () => {
  it('is not nested below the detail route', () => {
    const routeTree = readFileSync(routeTreePath, 'utf8')

    expect(routeTree).toContain("path: '/my-content/$contentId/edit'")
    expect(routeTree).toContain("parentRoute: typeof AuthenticatedRouteRoute")
    expect(routeTree).not.toContain("parentRoute: typeof AuthenticatedMyContentContentIdRoute")
  })
})
