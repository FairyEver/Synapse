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
      async findMany() {
        return sites
      },
      async count() {
        return sites.length
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
      async findMany() {
        return deployments
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
    },
    async $transaction(actions: readonly Promise<unknown>[]) {
      return Promise.all(actions)
    },
  }
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
