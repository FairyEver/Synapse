import { beforeEach, describe, expect, it, vi } from "vitest"
import { verifyPassword } from "../auth/password"
import { DriveSiteService } from "./drive-site.service"

describe("DriveSiteService", () => {
  beforeEach(() => {
    vi.stubEnv("USER_ACCESS_JWT_SECRET", "site-password-secret-with-enough-length")
  })

  it("creates a site by copying active folder files into deployment assets", async () => {
    const storage = createMemoryStorage()
    const prisma = createMemoryPrisma()
    const service = new DriveSiteService(prisma as never, storage as never)

    const result = await service.createSite("user-1", "https://synapse.test", {
      sourceFolderItemId: "folder-1",
      name: "原型",
      entryPath: null,
      accessMode: "password",
      password: "secret-123",
      expiresIn: "30d",
    })

    expect(result.siteId).toMatch(/^site_/u)
    expect(result.url).toContain("/sites/")
    expect(result.entryPath).toBe("index.html")
    expect(result.fileCount).toBe(3)
    expect(storage.copiedKeys()).toEqual([
      ["drive/index", expect.stringMatching(/^drive-sites\/site_/u)],
      ["drive/app", expect.stringMatching(/assets\/app\.js$/u)],
      ["drive/logo", expect.stringMatching(/assets\/logo\.png$/u)],
    ])
  })

  it("generates a share-style password when publishing a protected site without manual password input", async () => {
    const storage = createMemoryStorage()
    const prisma = createMemoryPrisma()
    const service = new DriveSiteService(prisma as never, storage as never)

    const result = await service.createSite("user-1", "https://synapse.test", {
      sourceFolderItemId: "folder-1",
      name: "原型",
      entryPath: null,
      accessMode: "password",
      expiresIn: "3d",
    })

    expect(result.accessMode).toBe("password")
    expect(result.passwordEnabled).toBe(true)
    expect(result.password).toMatch(/^[0-9A-Za-z]{8}$/u)
    expect(result.urlWithPassword).toBe(`${result.url}?password=${result.password}`)
    expect(result.expiresIn).toBe("3d")
    expect(result.expiresAt).not.toBeNull()

    const stored = await prisma.driveSite.findFirst({ where: { userId: "user-1", siteId: result.siteId, deletedAt: null } })
    expect(stored?.passwordEncrypted).toEqual(expect.any(String))
    if (!stored?.passwordHash || !result.password) {
      throw new Error("expected generated site password material")
    }
    await expect(verifyPassword(result.password, stored.passwordHash)).resolves.toBe(true)
  })

  it("rejects forgeable legacy cookies for protected sites", async () => {
    const storage = createMemoryStorage()
    const prisma = createMemoryPrisma()
    const service = new DriveSiteService(prisma as never, storage as never)

    const result = await service.createSite("user-1", "https://synapse.test", {
      sourceFolderItemId: "folder-1",
      name: "原型",
      entryPath: null,
      accessMode: "password",
      password: "secret-123",
      expiresIn: "30d",
    })

    await expect(service.resolvePublicSite(result.siteId, { cookie: `site:${result.siteId}` }))
      .resolves.toMatchObject({ status: "password_required" })
  })

  it("accepts signed cookies created from the current protected site password", async () => {
    const storage = createMemoryStorage()
    const prisma = createMemoryPrisma()
    const service = new DriveSiteService(prisma as never, storage as never)

    const result = await service.createSite("user-1", "https://synapse.test", {
      sourceFolderItemId: "folder-1",
      name: "原型",
      entryPath: null,
      accessMode: "password",
      password: "secret-123",
      expiresIn: "30d",
    })

    await expect(service.createSiteAccessCookie(result.siteId, "wrong-password")).resolves.toBeNull()
    const cookie = await service.createSiteAccessCookie(result.siteId, "secret-123")

    expect(cookie).toEqual(expect.any(String))
    expect(cookie).not.toBe(`site:${result.siteId}`)
    await expect(service.resolvePublicSite(result.siteId, { cookie }))
      .resolves.toMatchObject({
        status: "ok",
        asset: { relativePath: "index.html" },
      })
  })

  it("does not return password material for public sites", async () => {
    const storage = createMemoryStorage()
    const prisma = createMemoryPrisma()
    const service = new DriveSiteService(prisma as never, storage as never)

    const result = await service.createSite("user-1", "https://synapse.test", {
      sourceFolderItemId: "folder-1",
      name: "原型",
      entryPath: null,
      accessMode: "public",
      expiresIn: "forever",
    })

    expect(result.passwordEnabled).toBe(false)
    expect(result.password).toBeNull()
    expect(result.urlWithPassword).toBe(result.url)
  })

  it("filters expired site status before pagination", async () => {
    const storage = createMemoryStorage()
    const prisma = createMemoryPrisma({
      sites: [
        createSiteRecord({
          id: "site-row-active",
          siteId: "site_active",
          name: "Active",
          status: "active",
          expiresAt: new Date("2999-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-06-25T00:00:00.000Z"),
        }),
        createSiteRecord({
          id: "site-row-expired-new",
          siteId: "site_expired_new",
          name: "Expired New",
          status: "active",
          expiresAt: new Date("2000-01-02T00:00:00.000Z"),
          updatedAt: new Date("2026-06-24T00:00:00.000Z"),
        }),
        createSiteRecord({
          id: "site-row-forever",
          siteId: "site_forever",
          name: "Forever",
          status: "active",
          expiresAt: null,
          updatedAt: new Date("2026-06-23T00:00:00.000Z"),
        }),
        createSiteRecord({
          id: "site-row-expired-old",
          siteId: "site_expired_old",
          name: "Expired Old",
          status: "active",
          expiresAt: new Date("2000-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-06-22T00:00:00.000Z"),
        }),
      ],
    })
    const service = new DriveSiteService(prisma as never, storage as never)

    const expired = await service.listSites("user-1", "https://synapse.test", {
      status: "expired",
      offset: 0,
      limit: 1,
    })

    expect(expired.items).toEqual([
      expect.objectContaining({ siteId: "site_expired_new", status: "expired" }),
    ])
    expect(expired.total).toBe(2)
    expect(expired.page).toMatchObject({ hasMore: true, nextOffset: 1 })

    const active = await service.listSites("user-1", "https://synapse.test", {
      status: "active",
      offset: 0,
      limit: 10,
    })

    expect(active.items.map((site) => site.siteId)).toEqual(["site_active", "site_forever"])
    expect(active.items.every((site) => site.status === "active")).toBe(true)
    expect(active.total).toBe(2)
    expect(active.page).toMatchObject({ hasMore: false, nextOffset: null })
  })

  it("searches sites by source folder name and current entry path before pagination", async () => {
    const storage = createMemoryStorage()
    const prisma = createMemoryPrisma({
      sites: [
        createSiteRecord({
          id: "site-row-entry",
          siteId: "site_entry",
          name: "Homepage",
          sourceFolderName: "Marketing",
          currentDeploymentId: "dep-entry",
          updatedAt: new Date("2026-06-26T00:00:00.000Z"),
        }),
        createSiteRecord({
          id: "site-row-folder",
          siteId: "site_folder",
          name: "Portal",
          sourceFolderName: "Docs Portal",
          currentDeploymentId: "dep-folder",
          updatedAt: new Date("2026-06-25T00:00:00.000Z"),
        }),
        createSiteRecord({
          id: "site-row-old-entry",
          siteId: "site_old",
          name: "Archive",
          sourceFolderName: "Archive",
          currentDeploymentId: "dep-current",
          updatedAt: new Date("2026-06-24T00:00:00.000Z"),
        }),
      ],
      deployments: [
        createDeploymentRecord({ id: "dep-entry", driveSiteId: "site-row-entry", entryPath: "docs/start.html" }),
        createDeploymentRecord({ id: "dep-folder", driveSiteId: "site-row-folder", entryPath: "index.html" }),
        createDeploymentRecord({ id: "dep-current", driveSiteId: "site-row-old-entry", entryPath: "index.html" }),
        createDeploymentRecord({ id: "dep-old", driveSiteId: "site-row-old-entry", entryPath: "docs/old.html" }),
      ],
    })
    const service = new DriveSiteService(prisma as never, storage as never)

    const result = await service.listSites("user-1", "https://synapse.test", {
      search: "docs",
      offset: 0,
      limit: 1,
    })
    const oldDeploymentResult = await service.listSites("user-1", "https://synapse.test", {
      search: "old.html",
      offset: 0,
      limit: 10,
    })

    expect(result.items.map((site) => site.siteId)).toEqual(["site_entry"])
    expect(result.items[0]?.entryPath).toBe("docs/start.html")
    expect(result.total).toBe(2)
    expect(result.page).toMatchObject({ hasMore: true, nextOffset: 1 })
    expect(oldDeploymentResult.items).toEqual([])
  })

  it("renews an expired site when enabling it", async () => {
    const storage = createMemoryStorage()
    const prisma = createMemoryPrisma({
      sites: [createSiteRecord({
        siteId: "site_expired",
        expiresIn: "7d",
        expiresAt: new Date("2000-01-01T00:00:00.000Z"),
        currentDeploymentId: "dep-1",
      })],
      deployments: [createDeploymentRecord({ id: "dep-1", driveSiteId: "site-row-1" })],
      assets: [createAssetRecord({
        deploymentId: "dep-1",
        storageKey: "drive-sites/site_expired/dep-1/index.html",
      })],
    })
    const service = new DriveSiteService(prisma as never, storage as never)

    const result = await service.enableSite("user-1", "site_expired", "https://synapse.test")

    expect(result.status).toBe("active")
    expect(result.expiresIn).toBe("7d")
    expect(result.expiresAt).not.toBeNull()
    expect(Date.parse(result.expiresAt!)).toBeGreaterThan(Date.now())
    await expect(service.resolvePublicSite("site_expired", { cookie: null })).resolves.toMatchObject({
      status: "ok",
      asset: { relativePath: "index.html" },
    })
  })

  it("rejects enabling failed sites without an active deployment", async () => {
    const storage = createMemoryStorage()
    const prisma = createMemoryPrisma({
      sites: [createSiteRecord({
        siteId: "site_failed",
        status: "failed",
        currentDeploymentId: null,
      })],
    })
    const service = new DriveSiteService(prisma as never, storage as never)

    await expect(service.enableSite("user-1", "site_failed", "https://synapse.test"))
      .rejects.toThrow("站点需要重新发布。")
    await expect(service.resolvePublicSite("site_failed", { cookie: null }))
      .resolves.toMatchObject({ status: "disabled" })
  })

  it("generates a readable password when legacy protected site access is saved without one", async () => {
    const storage = createMemoryStorage()
    const prisma = createMemoryPrisma({
      sites: [createSiteRecord({
        accessMode: "password",
        passwordHash: "$2a$12$MM8qv7ZWmVn2sA6eNltSZOVcUx3Z4i9mU.DnUjmg0ivhQzPY57M1K",
        passwordEncrypted: null,
        siteId: "site_legacy",
      })],
    })
    const service = new DriveSiteService(prisma as never, storage as never)

    const result = await service.updateSiteAccess("user-1", "site_legacy", "https://synapse.test", {
      accessMode: "password",
      expiresIn: "7d",
    })

    expect(result.passwordEnabled).toBe(true)
    expect(result.password).toMatch(/^[0-9A-Za-z]{8}$/u)
    expect(result.expiresIn).toBe("7d")
    expect(result.urlWithPassword).toBe(`${result.url}?password=${result.password}`)
  })

  it("keeps an existing deployment active when republish copy fails", async () => {
    const storage = createMemoryStorage()
    const prisma = createMemoryPrisma({
      sites: [createSiteRecord({ currentDeploymentId: "dep-old", siteId: "site_existing" })],
      deployments: [createDeploymentRecord({ id: "dep-old", driveSiteId: "site-row-1" })],
      assets: [createAssetRecord({ deploymentId: "dep-old", storageKey: "drive-sites/site_existing/dep-old/index.html" })],
    })
    const service = new DriveSiteService(prisma as never, storage as never)
    storage.failNextCopy("copy failed")

    await expect(service.republishSite("user-1", "site_existing", "https://synapse.test", { entryPath: "index.html" }))
      .rejects.toThrow("copy failed")

    await expect(service.resolvePublicSite("site_existing", { cookie: null })).resolves.toMatchObject({
      status: "ok",
      asset: { relativePath: "index.html", storageKey: "drive-sites/site_existing/dep-old/index.html" },
    })
  })

  it("includes the exact asset when listing a concrete site file path", async () => {
    const storage = createMemoryStorage()
    const prisma = createMemoryPrisma({
      sites: [createSiteRecord({ currentDeploymentId: "dep-1", siteId: "site_existing" })],
      deployments: [createDeploymentRecord({ id: "dep-1", driveSiteId: "site-row-1" })],
      assets: [
        createAssetRecord({
          deploymentId: "dep-1",
          relativePath: "index.html",
          storageKey: "drive-sites/site_existing/dep-1/index.html",
        }),
        createAssetRecord({
          deploymentId: "dep-1",
          relativePath: "pages/create-task.html",
          storageKey: "drive-sites/site_existing/dep-1/pages/create-task.html",
          size: 20n,
        }),
        createAssetRecord({
          deploymentId: "dep-1",
          relativePath: "pages/other.html",
          storageKey: "drive-sites/site_existing/dep-1/pages/other.html",
        }),
      ],
    })
    const service = new DriveSiteService(prisma as never, storage as never)

    await expect(service.listPublicSiteAssets("site_existing", { cookie: null, path: "pages/create-task.html" }))
      .resolves.toMatchObject({
        status: "ok",
        assets: [
          { relativePath: "pages/create-task.html", storageKey: "drive-sites/site_existing/dep-1/pages/create-task.html" },
        ],
        page: { hasMore: false, nextOffset: null },
      })
  })
})

function createMemoryStorage() {
  const copies: Array<[string, string]> = []
  let nextFailure: string | null = null
  return {
    failNextCopy(message: string) {
      nextFailure = message
    },
    copiedKeys() {
      return copies
    },
    async copyObject(input: { readonly fromKey: string; readonly toKey: string }) {
      if (nextFailure) {
        const message = nextFailure
        nextFailure = null
        throw new Error(message)
      }
      copies.push([input.fromKey, input.toKey])
    },
  }
}

type MemorySite = ReturnType<typeof createSiteRecord>
type MemoryDeployment = ReturnType<typeof createDeploymentRecord>
type MemoryAsset = ReturnType<typeof createAssetRecord>

function createMemoryPrisma(seed: {
  readonly sites?: MemorySite[]
  readonly deployments?: MemoryDeployment[]
  readonly assets?: MemoryAsset[]
} = {}) {
  const now = new Date("2026-06-23T00:00:00.000Z")
  const items = [
    createItem({ id: "folder-1", type: "folder", name: "原型", parentId: null }),
    createItem({ id: "index", name: "index.html", parentId: "folder-1", storageKey: "drive/index", mimeType: "text/html", size: 20n }),
    createItem({ id: "assets", type: "folder", name: "assets", parentId: "folder-1" }),
    createItem({ id: "app", name: "app.js", parentId: "assets", storageKey: "drive/app", mimeType: "text/javascript", size: 10n }),
    createItem({ id: "logo", name: "logo.png", parentId: "assets", storageKey: "drive/logo", mimeType: "image/png", size: 30n }),
  ]
  const sites: MemorySite[] = [...(seed.sites ?? [])]
  const deployments: MemoryDeployment[] = [...(seed.deployments ?? [])]
  const assets: MemoryAsset[] = [...(seed.assets ?? [])]
  let deploymentCounter = 0
  return {
    driveItem: {
      async findFirst(args: { readonly where: Record<string, unknown> }) {
        return items.find((item) => (
          (!args.where.id || item.id === args.where.id)
          && (!args.where.parentId || item.parentId === args.where.parentId)
          && (!args.where.type || item.type === args.where.type)
          && item.userId === args.where.userId
        )) ?? null
      },
      async findMany(args: { readonly where: { readonly parentId?: string; readonly userId?: string } }) {
        return items.filter((item) => item.parentId === args.where.parentId && item.userId === args.where.userId)
      },
    },
    driveSite: {
      async create(args: { readonly data: Partial<MemorySite> }) {
        const site = createSiteRecord({
          ...args.data,
          id: "site-row-1",
          siteId: args.data.siteId ?? "site_test",
          createdAt: now,
          updatedAt: now,
        })
        sites.push(site)
        return site
      },
      async findFirst(args: { readonly where: { readonly userId?: string; readonly siteId?: string; readonly deletedAt?: null } }) {
        return sites.find((site) => (
          (!args.where.userId || site.userId === args.where.userId)
          && (!args.where.siteId || site.siteId === args.where.siteId)
          && (!("deletedAt" in args.where) || site.deletedAt === args.where.deletedAt)
        )) ?? null
      },
      async findUnique(args: { readonly where: { readonly siteId: string } }) {
        return sites.find((site) => site.siteId === args.where.siteId) ?? null
      },
      async update(args: { readonly where: { readonly id?: string; readonly siteId?: string }; readonly data: Partial<MemorySite> }) {
        const site = sites.find((entry) => entry.id === args.where.id || entry.siteId === args.where.siteId)
        if (!site) throw new Error("site missing")
        Object.assign(site, args.data, { updatedAt: now })
        return site
      },
      async findMany(args: {
        readonly where?: SiteWhere
        readonly skip?: number
        readonly take?: number
      } = {}) {
        const filtered = sites
          .filter((site) => matchesSiteWhere(site, args.where))
          .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || right.id.localeCompare(left.id))
        const start = args.skip ?? 0
        return filtered.slice(start, typeof args.take === "number" ? start + args.take : undefined)
      },
      async count(args: { readonly where?: SiteWhere } = {}) {
        return sites.filter((site) => matchesSiteWhere(site, args.where)).length
      },
    },
    driveSiteDeployment: {
      async create(args: { readonly data: Partial<MemoryDeployment> }) {
        deploymentCounter += 1
        const deployment = createDeploymentRecord({
          ...args.data,
          id: `dep-${deploymentCounter}`,
          createdAt: now,
        })
        deployments.push(deployment)
        return deployment
      },
      async update(args: { readonly where: { readonly id: string }; readonly data: Partial<MemoryDeployment> }) {
        const deployment = deployments.find((entry) => entry.id === args.where.id)
        if (!deployment) throw new Error("deployment missing")
        Object.assign(deployment, args.data)
        return deployment
      },
      async findUnique(args: { readonly where: { readonly id: string } }) {
        return deployments.find((deployment) => deployment.id === args.where.id) ?? null
      },
      async findMany(args: {
        readonly where?: DeploymentWhere
        readonly select?: unknown
      } = {}) {
        return deployments.filter((deployment) => matchesDeploymentWhere(deployment, args.where, sites))
      },
    },
    driveSiteAsset: {
      async createMany(args: { readonly data: MemoryAsset[] }) {
        assets.push(...args.data.map((asset) => createAssetRecord(asset)))
        return { count: args.data.length }
      },
      async findUnique(args: { readonly where: { readonly deploymentId_relativePath: { readonly deploymentId: string; readonly relativePath: string } } }) {
        return assets.find((asset) => (
          asset.deploymentId === args.where.deploymentId_relativePath.deploymentId
          && asset.relativePath === args.where.deploymentId_relativePath.relativePath
        )) ?? null
      },
      async findMany(args: {
        readonly where: {
          readonly deploymentId: string
          readonly OR?: ReadonlyArray<
            | { readonly relativePath: string }
            | { readonly relativePath: { readonly startsWith: string } }
          >
          readonly relativePath?: { readonly startsWith: string }
        }
        readonly skip?: number
        readonly take?: number
      }) {
        const filtered = assets
          .filter((asset) => asset.deploymentId === args.where.deploymentId)
          .filter((asset) => {
            if (args.where.OR) {
              return args.where.OR.some((condition) => matchesAssetRelativePath(asset.relativePath, condition.relativePath))
            }
            if (args.where.relativePath) return matchesAssetRelativePath(asset.relativePath, args.where.relativePath)
            return true
          })
          .sort((first, second) => first.relativePath.localeCompare(second.relativePath) || first.id.localeCompare(second.id))
        const start = args.skip ?? 0
        return filtered.slice(start, typeof args.take === "number" ? start + args.take : undefined)
      },
    },
    async $transaction(actions: readonly Promise<unknown>[]) {
      return Promise.all(actions)
    },
  }
}

function matchesAssetRelativePath(relativePath: string, condition: string | { readonly startsWith: string }): boolean {
  return typeof condition === "string" ? relativePath === condition : relativePath.startsWith(condition.startsWith)
}

type SiteWhere = {
  readonly AND?: readonly SiteWhere[]
  readonly OR?: readonly SiteWhere[]
  readonly userId?: string
  readonly currentDeploymentId?: null | string | { readonly in: readonly string[] }
  readonly siteId?: string | { readonly contains: string; readonly mode?: string }
  readonly name?: { readonly contains: string; readonly mode?: string }
  readonly sourceFolderName?: { readonly contains: string; readonly mode?: string }
  readonly status?: string
  readonly expiresAt?: null | { readonly gt?: Date; readonly gte?: Date; readonly lt?: Date; readonly lte?: Date }
  readonly deletedAt?: null | Date
}

type DeploymentWhere = {
  readonly id?: string | { readonly in: readonly string[] }
  readonly entryPath?: { readonly contains: string; readonly mode?: string }
  readonly driveSite?: {
    readonly userId?: string
    readonly deletedAt?: null | Date
  }
}

function matchesSiteWhere(site: MemorySite, where: SiteWhere = {}): boolean {
  if (where.AND?.some((condition) => !matchesSiteWhere(site, condition))) return false
  if (where.OR && !where.OR.some((condition) => matchesSiteWhere(site, condition))) return false
  if (where.userId !== undefined && site.userId !== where.userId) return false
  if (where.status !== undefined && site.status !== where.status) return false
  if ("deletedAt" in where && site.deletedAt !== where.deletedAt) return false
  if ("currentDeploymentId" in where && !matchesNullableStringCondition(site.currentDeploymentId, where.currentDeploymentId)) return false
  if (where.siteId !== undefined && !matchesStringCondition(site.siteId, where.siteId)) return false
  if (where.name !== undefined && !matchesStringCondition(site.name, where.name)) return false
  if (where.sourceFolderName !== undefined && !matchesNullableStringCondition(site.sourceFolderName, where.sourceFolderName)) return false
  if ("expiresAt" in where && !matchesDateCondition(site.expiresAt, where.expiresAt)) return false
  return true
}

function matchesDeploymentWhere(deployment: MemoryDeployment, where: DeploymentWhere = {}, sites: readonly MemorySite[]): boolean {
  if (where.id !== undefined && !matchesStringCondition(deployment.id, where.id)) return false
  if (where.entryPath !== undefined && !matchesStringCondition(deployment.entryPath, where.entryPath)) return false
  if (where.driveSite) {
    const site = sites.find((entry) => entry.id === deployment.driveSiteId)
    if (!site) return false
    if (where.driveSite.userId !== undefined && site.userId !== where.driveSite.userId) return false
    if ("deletedAt" in where.driveSite && site.deletedAt !== where.driveSite.deletedAt) return false
  }
  return true
}

function matchesStringCondition(
  value: string,
  condition: string | { readonly contains: string; readonly mode?: string } | { readonly in: readonly string[] },
): boolean {
  if (typeof condition === "string") return value === condition
  if ("in" in condition) return condition.in.includes(value)
  const haystack = condition.mode === "insensitive" ? value.toLowerCase() : value
  const needle = condition.mode === "insensitive" ? condition.contains.toLowerCase() : condition.contains
  return haystack.includes(needle)
}

function matchesNullableStringCondition(
  value: string | null,
  condition: null | string | { readonly contains: string; readonly mode?: string } | { readonly in: readonly string[] } | undefined,
): boolean {
  if (condition === undefined) return true
  if (condition === null) return value === null
  if (value === null) return false
  return matchesStringCondition(value, condition)
}

function matchesDateCondition(
  value: Date | null,
  condition: null | { readonly gt?: Date; readonly gte?: Date; readonly lt?: Date; readonly lte?: Date } | undefined,
): boolean {
  if (condition === undefined) return true
  if (condition === null) return value === null
  if (value === null) return false
  if (condition.gt && value.getTime() <= condition.gt.getTime()) return false
  if (condition.gte && value.getTime() < condition.gte.getTime()) return false
  if (condition.lt && value.getTime() >= condition.lt.getTime()) return false
  if (condition.lte && value.getTime() > condition.lte.getTime()) return false
  return true
}

function createItem(overrides: Record<string, unknown>) {
  return {
    id: "item",
    userId: "user-1",
    parentId: null,
    type: "file",
    name: "file.txt",
    size: 1n,
    mimeType: "text/plain",
    storageKey: "drive/file",
    storageStatus: "active",
    uploadStatus: "completed",
    lifecycleStatus: "active",
    deletedAt: null,
    ...overrides,
  }
}

function createSiteRecord(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-06-23T00:00:00.000Z")
  return {
    id: "site-row-1",
    siteId: "site_test",
    userId: "user-1",
    name: "原型",
    status: "active",
    accessMode: "public",
    passwordHash: null,
    passwordEncrypted: null,
    expiresIn: "forever",
    expiresAt: null,
    currentDeploymentId: null,
    sourceFolderItemId: "folder-1",
    sourceFolderName: "原型",
    createdAt: now,
    updatedAt: now,
    disabledAt: null,
    deletedAt: null,
    ...overrides,
  }
}

function createDeploymentRecord(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-06-23T00:00:00.000Z")
  return {
    id: "dep-1",
    driveSiteId: "site-row-1",
    status: "active",
    entryPath: "index.html",
    fileCount: 1,
    totalBytes: 20n,
    createdAt: now,
    activatedAt: now,
    error: null,
    ...overrides,
  }
}

function createAssetRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset-row-1",
    driveSiteId: "site-row-1",
    deploymentId: "dep-1",
    sourceItemId: "index",
    relativePath: "index.html",
    storageKey: "drive-sites/site_test/dep-1/index.html",
    contentType: "text/html",
    size: 20n,
    sha256: null,
    ...overrides,
  }
}
