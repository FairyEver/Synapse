import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, it, vi } from "vitest"
import { PrivateStorageProtection } from "../../process/private-storage-protection"
import { assertPrivateStorageArguments, createPrivateStorageConstraint } from "../private-storage-policy"
import { createPermissionGuard, userInitiatedAllowPolicy } from "../permission-guard"
import { createSynapseActionRouter } from "../../../capabilities/action-router"

it("blocks private filesystem resources before user allow rules and all public transport dispatchers", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "synapse-private-tool-")), privateRoot = path.join(root, "data-v1")
  mkdirSync(privateRoot); writeFileSync(path.join(privateRoot, "runtime.sqlite"), "private-canary")
  if (process.platform !== "win32") symlinkSync(privateRoot, path.join(root, "alias"), "dir")
  const protection = new PrivateStorageProtection([privateRoot])
  const guard = createPermissionGuard({ constraints: [createPrivateStorageConstraint(protection)] })
  guard.registerPolicy(userInitiatedAllowPolicy)
  const dispatch = vi.fn(async () => ({ ok: true as const }))
  const router = createSynapseActionRouter({ assertFileAccess: params => assertPrivateStorageArguments(protection, params),
    appDispatch: dispatch, automationDispatch: dispatch, contentDispatch: dispatch, databaseDispatch: dispatch,
    driveDispatch: dispatch, mailDispatch: dispatch, mailInternalDispatch: dispatch, modelPriceDispatch: dispatch,
    repositoryDispatch: dispatch, workflowDispatch: dispatch,
  })
  try {
    for (const resource of [privateRoot, root, path.join(privateRoot, "runtime.sqlite"), ...(process.platform === "win32" ? [] : [path.join(root, "alias", "runtime.sqlite")])]) {
      expect(await guard.check({ action: "fs.read.outside-userdata", actor: { kind: "user" }, resource, context: {} })).toMatchObject({ allowed: false, policyId: "private-storage" })
      for (const source of ["mcp-http", "mcp-stdio", "api", "workflow", "app.deep_link"] as const) {
        expect(await router.dispatch("app.document_template.docx.generate", { templatePath: resource }, { source })).toMatchObject({ ok: false, code: "PERMISSION_DENIED" })
      }
    }
    expect(dispatch).not.toHaveBeenCalled()
    expect(await router.dispatch("app.mail.account.list", {}, { source: "mcp-http" })).toMatchObject({ ok: true })
    await expect(assertPrivateStorageArguments(protection, { localPaths: [path.join(privateRoot, "cache.bin")] })).rejects.toThrow("私有存储")
    await expect(assertPrivateStorageArguments(protection, { unusual: [path.join(privateRoot, "runtime.sqlite")] })).rejects.toThrow("私有存储")
    await expect(assertPrivateStorageArguments(protection, { templatePath: path.relative(process.cwd(), path.join(privateRoot, "runtime.sqlite")) })).rejects.toThrow("私有存储")
    await expect(assertPrivateStorageArguments(protection, { source: "const text = 'https://example.test';".repeat(300), template: "<h1><%= data.title %></h1>".repeat(300), text: "普通邮件正文".repeat(300) })).resolves.toBeUndefined()
    expect(await guard.check({ action: "fs.read.outside-userdata", actor: { kind: "user" }, resource: path.join(root, "public.txt"), context: {} })).toEqual({ allowed: true })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
