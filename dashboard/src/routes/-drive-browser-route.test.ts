import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const routeTreePath = fileURLToPath(new URL('../routeTree.gen.ts', import.meta.url))

describe('drive browser file routes', () => {
  it('keeps owner file preview route outside the folder route component', () => {
    const routeTree = readFileSync(routeTreePath, 'utf8')

    expect(routeTree).toContain("id: '/drive/items/$rootItemId_/items/$browserItemId'")
    expect(routeTree).toContain("fullPath: '/drive/items/$rootItemId/items/$browserItemId'")
    expect(routeTree).toContain("parentRoute: typeof AuthenticatedRouteRoute")
    expect(routeTree).not.toContain("parentRoute: typeof AuthenticatedDriveItemsRootItemIdRoute")
  })

  it('keeps share file preview route outside the share root component', () => {
    const routeTree = readFileSync(routeTreePath, 'utf8')

    expect(routeTree).toContain("id: '/files/$shareId_/items/$browserItemId'")
    expect(routeTree).toContain("fullPath: '/files/$shareId/items/$browserItemId'")
    expect(routeTree).toContain("parentRoute: typeof rootRouteImport")
    expect(routeTree).not.toContain("parentRoute: typeof FilesShareIdRoute")
  })
})
