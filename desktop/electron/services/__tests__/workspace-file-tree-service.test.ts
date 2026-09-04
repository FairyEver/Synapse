import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { InMemoryAuditSink } from "../../runtime/security"
import {
  createWorkspaceFileTreeService,
  WorkspaceFileTreeError,
} from "../workspace-file-tree-service"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })))
})

describe("workspace file tree service", () => {
  it("lists one directory level with stable filtering and ordering", async () => {
    const root = await createTemporaryDirectory()
    await Promise.all([
      mkdir(path.join(root, "src")),
      mkdir(path.join(root, ".git")),
      writeFile(path.join(root, "z10.ts"), ""),
      writeFile(path.join(root, "z2.ts"), ""),
      writeFile(path.join(root, ".DS_Store"), ""),
      ...(process.platform === "win32"
        ? []
        : [symlink(path.join(root, "src"), path.join(root, "src-link"))]),
    ])
    await writeFile(path.join(root, "src", "index.ts"), "")
    const { service } = createService()

    const scope = await service.openScope({ ownerId: 1, rootPath: root, surface: "agent" })
    const listed = await service.listDirectory({ ownerId: 1, scopeId: scope.scopeId, relativePath: "" })

    expect(listed.entries).toEqual([
      { relativePath: "src", name: "src", kind: "directory" },
      ...(process.platform === "win32" ? [] : [
        { relativePath: "src-link", name: "src-link", kind: "symbolic-link" as const },
      ]),
      { relativePath: "z2.ts", name: "z2.ts", kind: "file" },
      { relativePath: "z10.ts", name: "z10.ts", kind: "file" },
    ])
    expect(await service.listDirectory({ ownerId: 1, scopeId: scope.scopeId, relativePath: "src" }))
      .toMatchObject({ entries: [{ relativePath: "src/index.ts", name: "index.ts", kind: "file" }] })
    service.stop()
  })

  it.skipIf(process.platform === "win32")(
    "binds scopes to their owner and rejects traversal and symbolic-link expansion",
    async () => {
      const root = await createTemporaryDirectory()
      const outside = await createTemporaryDirectory()
      await symlink(outside, path.join(root, "outside"))
      const { service } = createService()
      const scope = await service.openScope({ ownerId: 1, rootPath: root, surface: "terminal" })

      await expect(service.listDirectory({ ownerId: 2, scopeId: scope.scopeId, relativePath: "" }))
        .rejects.toMatchObject({ code: "invalid_scope" })
      await expect(service.listDirectory({ ownerId: 1, scopeId: scope.scopeId, relativePath: "../outside" }))
        .rejects.toMatchObject({ code: "invalid_path" })
      await expect(service.listDirectory({ ownerId: 1, scopeId: scope.scopeId, relativePath: "outside" }))
        .rejects.toMatchObject({ code: "invalid_path" })
      service.stop()
    },
  )

  it("checks permission and records the root access outcome", async () => {
    const root = await createTemporaryDirectory()
    const auditSink = new InMemoryAuditSink()
    const service = createWorkspaceFileTreeService({
      permissionGuard: {
        registerPolicy: () => () => undefined,
        check: vi.fn().mockResolvedValue({ allowed: false, reason: "denied" }),
      },
      auditSink,
    })

    await expect(service.openScope({ ownerId: 1, rootPath: root, surface: "agent", projectId: "p1" }))
      .rejects.toEqual(new WorkspaceFileTreeError("permission_denied"))
    expect(auditSink.list()).toMatchObject([{
      action: "fs.read.outside-userdata",
      outcome: "denied",
      metadata: { source: "workspace-file-tree", surface: "agent", projectId: "p1" },
    }])
  })

  it("resolves selected descendants without allowing traversal", async () => {
    const root = await createTemporaryDirectory()
    await mkdir(path.join(root, "src"))
    await writeFile(path.join(root, "src", "index.ts"), "")
    const { service } = createService()
    const scope = await service.openScope({ ownerId: 1, rootPath: root, surface: "agent" })

    await expect(service.resolvePaths({
      ownerId: 1,
      scopeId: scope.scopeId,
      relativePaths: ["src", "src/index.ts"],
    })).resolves.toEqual({
      scopeId: scope.scopeId,
      paths: [path.join(root, "src"), path.join(root, "src", "index.ts")],
    })
    await expect(service.resolvePaths({
      ownerId: 1,
      scopeId: scope.scopeId,
      relativePaths: ["../outside"],
    })).rejects.toMatchObject({ code: "invalid_path" })
    service.stop()
  })

  it("coalesces filesystem changes and releases the scope", async () => {
    const root = await createTemporaryDirectory()
    const { service } = createService()
    const scope = await service.openScope({ ownerId: 7, rootPath: root, surface: "terminal" })
    const changed = new Promise<{ relativePath: string; revision: number }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("watch timeout")), 3_000)
      service.onChanged((event) => {
        if (event.scopeId !== scope.scopeId) return
        clearTimeout(timeout)
        resolve(event)
      })
    })

    await Promise.all([
      writeFile(path.join(root, "first.ts"), ""),
      writeFile(path.join(root, "second.ts"), ""),
    ])

    await expect(changed).resolves.toMatchObject({ relativePath: "", revision: 1 })
    service.closeOwner(7)
    await expect(service.listDirectory({ ownerId: 7, scopeId: scope.scopeId, relativePath: "" }))
      .rejects.toMatchObject({ code: "invalid_scope" })
    service.stop()
  })
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "synapse-workspace-tree-"))
  temporaryDirectories.push(directory)
  return directory
}

function createService() {
  const auditSink = new InMemoryAuditSink()
  const service = createWorkspaceFileTreeService({
    permissionGuard: {
      registerPolicy: () => () => undefined,
      check: vi.fn().mockResolvedValue({ allowed: true }),
    },
    auditSink,
  })
  return { auditSink, service }
}
