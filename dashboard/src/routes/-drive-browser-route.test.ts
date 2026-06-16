import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const routeTreePath = fileURLToPath(new URL('../routeTree.gen.ts', import.meta.url))
const driveRoutePaths = [
  fileURLToPath(new URL('./_authenticated/drive/index.tsx', import.meta.url)),
  fileURLToPath(new URL('./_authenticated/drive/folders/$folderId.tsx', import.meta.url)),
  fileURLToPath(new URL('./_authenticated/drive/items/$browserItemId.tsx', import.meta.url)),
] as const

describe('drive browser file routes', () => {
  it('keeps owner file preview route outside the folder route component', () => {
    const routeTree = readFileSync(routeTreePath, 'utf8')

    expect(routeTree).toContain("id: '/drive/items/$browserItemId'")
    expect(routeTree).toContain("fullPath: '/drive/items/$browserItemId'")
    expect(routeTree).toContain("parentRoute: typeof AuthenticatedRouteRoute")
    expect(routeTree).not.toContain("parentRoute: typeof AuthenticatedDriveFoldersFolderIdRoute")
  })

  it('keeps share file preview route outside the share root component', () => {
    const routeTree = readFileSync(routeTreePath, 'utf8')

    expect(routeTree).toContain("id: '/share/$shareId_/items/$browserItemId'")
    expect(routeTree).toContain("fullPath: '/share/$shareId/items/$browserItemId'")
    expect(routeTree).toContain("parentRoute: typeof rootRouteImport")
    expect(routeTree).not.toContain("parentRoute: typeof ShareShareIdRoute")
  })

  it('guards authenticated drive routes as user-only pages', () => {
    for (const routePath of driveRoutePaths) {
      const routeSource = readFileSync(routePath, 'utf8')
      expect(routeSource).toContain("import { requireDashboardUser }")
      expect(routeSource).toContain("beforeLoad: requireDashboardUser")
    }
  })

  it('opens owner item routes in standalone mode by default', () => {
    const routeSource = readFileSync(driveRoutePaths[2], 'utf8')

    expect(routeSource).toContain("search.surface === 'console'")
    expect(routeSource).toContain("'standalone' as const")
  })
})
