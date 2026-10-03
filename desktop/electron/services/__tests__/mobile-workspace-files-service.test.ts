import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { constants } from "node:fs"
import { access, chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, symlink, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MobileIntentResult, MobileWorkspaceFilesIntent, MobileWorkspaceFilesScope } from "@synapse/shared" with { "resolution-mode": "import" }
import { isMobileWorkspaceFilesResult, isMobileWorkspaceFilesEnvelopeWithinBudget } from "../../../../shared/src/mobile-workspace-files"
import { createControlledProcessRunner } from "../../runtime/process"
import { createPermissionGuard, InMemoryAuditSink } from "../../runtime/security"
import { configureGitCommandSecurity, resetGitCommandSecurityForTests } from "../git-command"
import { createMobileWorkspaceFilesService, type MobileWorkspaceFilesService } from "../mobile-workspace-files-service"
import * as filePaths from "../mobile-workspace-files-paths"
import { MOBILE_WORKSPACE_FILES_LIMITS as L } from "@synapse/shared/mobile-live-constants"

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return { ...actual, open: vi.fn(actual.open) }
})
const originalOpen = vi.mocked(open).getMockImplementation()!
const execute = promisify(execFile)
const temporary: string[] = []
const services: MobileWorkspaceFilesService[] = []
const owner = { accountUserId: "account-1", desktopClientInstanceId: "desktop-1", mobileClientInstanceId: "phone-1" }
let sequence = 0
const base = () => ({ v: 1 as const, intentId: `file-request-${++sequence}`, kind: "workspaceFiles" as const, filesVersion: 1 as const, sessionId: "session-1" })
afterEach(async () => { services.splice(0).forEach(service => service.dispose()); resetGitCommandSecurityForTests(); vi.restoreAllMocks(); vi.mocked(open).mockImplementation(originalOpen); vi.mocked(open).mockClear(); vi.useRealTimers(); await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(git = false) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "synapse-mobile-files-")))
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), "synapse-mobile-files-home-"))), xdg = path.join(home, ".config")
  temporary.push(root, home)
  const command = async (...args: string[]) => (await execute("git", args, { cwd: root, env: { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: xdg, GIT_CONFIG_COUNT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: undefined, GIT_CONFIG_SYSTEM: process.platform === "win32" ? "NUL" : "/dev/null" } })).stdout
  if (git) { await command("init", "-q"); await command("config", "user.name", "Files Test"); await command("config", "user.email", "files@example.invalid"); await command("config", "core.autocrlf", "false") }
  let cwd = root, alive = true, time = 0, contextGate: (() => Promise<void>) | undefined
  const guard = createPermissionGuard(), audit = new InMemoryAuditSink()
  const service = createMobileWorkspaceFilesService({ permissionGuard: guard, auditSink: audit, resolveSessionContext: async () => { await contextGate?.(); return alive ? { cwd, shell: process.platform === "win32" ? "powershell.exe" : "/bin/zsh" } : null }, now: () => time, gitConfigurationLocations: { homeDirectory: home, xdgConfigHome: xdg } })
  services.push(service)
  configureGitCommandSecurity({ processRunner: createControlledProcessRunner({ permissionGuard: guard, auditSink: audit }) })
  const call = (input: Omit<MobileWorkspaceFilesIntent, "v" | "intentId" | "kind" | "filesVersion" | "sessionId"> | Record<string, unknown>, target = owner) => service.runIntent(target, { ...base(), ...input } as MobileWorkspaceFilesIntent)
  const open = async (scopeMode: "currentDirectory" | "repository" = "currentDirectory") => {
    const result = await call({ operation: "open", scopeMode })
    expect(result.outcome, JSON.stringify(result)).toBe("accepted")
    expect(isMobileWorkspaceFilesResult(result.workspaceFiles)).toBe(true)
    return result.workspaceFiles?.data as MobileWorkspaceFilesScope
  }
  const scoped = (scope: MobileWorkspaceFilesScope) => ({ scopeId: scope.scopeId, expectedContextVersion: scope.contextVersion })
  return { root, home, xdg, command, service, audit, guard, call, open, scoped, setContextGate(value: () => Promise<void>) { contextGate = value }, setCwd(value: string) { cwd = value }, end() { alive = false }, advance(value: number) { time += value } }
}
type OperationData<R, O> = R extends { operation: infer Operation; data: infer Data } ? O extends Operation ? Data : never : never
type FilesData<O> = OperationData<NonNullable<MobileIntentResult["workspaceFiles"]>, O>
function dataFor<O extends NonNullable<MobileIntentResult["workspaceFiles"]>["operation"]>(result: MobileIntentResult, operation: O): FilesData<O> {
  expect(["accepted", "no_op"], JSON.stringify(result)).toContain(result.outcome)
  expect(result.workspaceFiles?.operation).toBe(operation)
  expect(isMobileWorkspaceFilesResult(result.workspaceFiles), JSON.stringify(result)).toBe(true)
  expect(isMobileWorkspaceFilesEnvelopeWithinBudget({ type: "mobile.intentResult", payload: { desktopClientInstanceId: owner.desktopClientInstanceId, mobileClientInstanceId: owner.mobileClientInstanceId, result } })).toBe(true)
  return result.workspaceFiles?.data as FilesData<O>
}

describe("mobile workspace files safety and real reads", () => {
  it.skipIf(process.platform === "win32").each(["pointer", "config", "commondir", "commonConfig"] as const)("cancels a discovery %s file-to-FIFO race without a writer or retained read slot", async kind => {
    const f = await fixture(kind !== "pointer"), gitDir = path.join(f.root, ".git"), commonDir = path.join(f.root, "common")
    if (kind === "pointer") await writeFile(gitDir, "gitdir: missing\n")
    if (kind === "commondir" || kind === "commonConfig") {
      await mkdir(commonDir); await writeFile(path.join(commonDir, "config"), "[core]\nautocrlf = false\n")
      await writeFile(path.join(gitDir, "commondir"), "../common\n")
    }
    const target = kind === "pointer" ? gitDir : kind === "config" ? path.join(gitDir, "config") : kind === "commondir" ? path.join(gitDir, "commondir") : path.join(commonDir, "config")
    const check = vi.spyOn(f.guard, "check")
    let entered!: () => void, resume!: () => void, swapped = false
    const reached = new Promise<void>(resolve => { entered = resolve }), ready = new Promise<void>(resolve => { resume = resolve })
    vi.mocked(open).mockImplementation(async (file, flags, mode) => {
      if (String(file) === target && !swapped) {
        swapped = true
        expect(Number(flags) & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK)
        expect(check.mock.calls.at(-1)?.[0]).toMatchObject({ action: "fs.read.outside-userdata", resource: target })
        const audits = f.audit.list()
        expect(audits.at(-1)).toMatchObject({ action: "fs.read.outside-userdata", outcome: "allowed" })
        await rm(target); await execute("mkfifo", [target]); entered(); await ready
      }
      return originalOpen(file, flags, mode)
    })
    const request = { ...base(), operation: "open", scopeMode: "currentDirectory" } as const
    const pending = f.service.runIntent(owner, request)
    await reached
    const started = performance.now(), cancelling = f.call({ operation: "cancel", targetIntentId: request.intentId })
    resume()
    const [cancelled, result] = await Promise.all([cancelling, pending])
    expect(cancelled.outcome).toBe("accepted"); expect(cancelled.workspaceFiles?.data).toMatchObject({ status: "cancelled" })
    expect(result).toMatchObject({ outcome: "rejected", code: "cancelled" })
    expect(performance.now() - started).toBeLessThan(1000)
    expect(f.service.facts()).toMatchObject({ activeReads: 0, scopes: 0 })
  })

  it("reads only one layer, preserves platform names, and prepares references without a terminal write", async () => {
    const f = await fixture()
    await mkdir(path.join(f.root, "src")); await writeFile(path.join(f.root, "src", "deep.md"), "# 深层\n")
    const names = ["hello 中文😀.md", ...(process.platform === "win32" ? [] : ["flat\\name.txt", "合法:名称."])]
    await Promise.all(names.map(name => writeFile(path.join(f.root, name), "first\r\n第二行😀\r\n")))
    const scope = await f.open()
    const page = dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId }), "directory")
    expect(page.entries.map(entry => entry.name)).toContain("src")
    expect(page.entries.map(entry => entry.relativePath)).not.toContain("src/deep.md")
    for (const name of names) {
      const entry = page.entries.find(entry => entry.name === name)!
      const preview = dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target: { source: "disk", entryId: entry.entryId } }), "preview")
      expect(preview.lines.map(line => line.text)).toEqual(["first", "第二行😀"])
      const reference = dataFor(await f.call({ operation: "reference", ...f.scoped(scope), entryId: entry.entryId }), "reference")
      expect(reference.referenceText).toContain(process.platform === "win32" ? "" : f.root)
      expect(preview.name).toBe(name)
    }
    expect(f.service.facts().watchers).toBe(0)
    expect(JSON.stringify(f.audit.list())).not.toContain(f.root)
  })

  it("binds account/desktop/mobile/session, and refuses cwd drift and root replacement", async () => {
    const f = await fixture(), scope = await f.open()
    const request = { operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId }
    for (const identity of ["accountUserId", "desktopClientInstanceId", "mobileClientInstanceId"] as const) {
      expect((await f.call(request, { ...owner, [identity]: "other" })).code).toBe("invalid_scope")
    }
    expect((await f.service.runIntent(owner, { ...base(), ...request, sessionId: "other-session" } as MobileWorkspaceFilesIntent)).code).toBe("invalid_scope")
    await mkdir(path.join(f.root, "next")); f.setCwd(path.join(f.root, "next"))
    expect((await f.call(request)).code).toBe("scope_stale")
    expect((await f.call({ operation: "refresh", ...f.scoped(scope) })).code).toBe("scope_stale")
    dataFor(await f.call({ operation: "close", scopeId: scope.scopeId }), "close")
    const closed = dataFor(await f.call({ operation: "close", scopeId: scope.scopeId }), "close")
    expect(closed.status).toBe("alreadyClosed")
  })

  it("keeps ordinary browsing available and distinguishes blocked Git metadata from a non-repository", async () => {
    const plain = await fixture(), ordinary = await plain.open()
    expect(ordinary).toMatchObject({ gitAvailable: false, gitUnavailableReason: "not_git_repository" })
    const blocked = await fixture(true)
    await writeFile(path.join(blocked.root, "note.txt"), "readable\n")
    await writeFile(path.join(blocked.root, ".git", "config"), "[core]\nrepositoryformatversion = 0\n[include]\npath = ../private-config\n")
    const scope = await blocked.open()
    expect(scope).toMatchObject({ gitAvailable: false, gitUnavailableReason: "git_unavailable" })
    const files = dataFor(await blocked.call({ operation: "directory", ...blocked.scoped(scope), directoryEntryId: scope.rootEntryId }), "directory")
    expect(files.entries.map(entry => entry.name)).toContain("note.txt")
    expect((await blocked.call({ operation: "open", scopeMode: "repository" })).code).toBe("git_unavailable")
  })

  it("keeps ordinary browsing available after an isolated Git deadline, while propagating cancellation", async () => {
    const f = await fixture()
    await writeFile(path.join(f.root, "note.txt"), "readable\n")
    configureGitCommandSecurity({ processRunner: { run: async () => ({ stdout: "", stderr: "", exitCode: null, signal: "SIGTERM", timedOut: true, durationMs: 5000 }) } })
    const scope = await f.open()
    expect(scope).toMatchObject({ gitAvailable: false, gitUnavailableReason: "git_unavailable" })
    expect(dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId }), "directory").entries[0]!.name).toBe("note.txt")
    expect((await f.call({ operation: "open", scopeMode: "repository" })).code).toBe("deadline_exceeded")

    let started!: () => void
    const running = new Promise<void>(resolve => { started = resolve })
    configureGitCommandSecurity({ processRunner: { run: request => new Promise(resolve => {
      request.abortSignal?.addEventListener("abort", () => resolve({ stdout: "", stderr: "", exitCode: null, signal: "SIGTERM", timedOut: false, durationMs: 1 }), { once: true })
      started()
    }) } })
    const opening = { ...base(), operation: "open", scopeMode: "currentDirectory" } as const
    const pending = f.service.runIntent(owner, opening)
    await running
    dataFor(await f.call({ operation: "cancel", targetIntentId: opening.intentId }), "cancel")
    expect((await pending).code).toBe("cancelled")
  })

  it("cannot publish a scope when permission is revoked before its token or during final cwd validation", async () => {
    for (const stage of ["before-token", "after-grant", "final-cwd"] as const) {
      const f = await fixture()
      let entered!: () => void, resume!: () => void
      const waiting = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { resume = resolve })
      if (stage === "after-grant") {
        const check = f.guard.check.bind(f.guard)
        let first = true
        vi.spyOn(f.guard, "check").mockImplementation(async request => {
          const decision = await check(request)
          if (first) { first = false; entered(); await gate }
          return decision
        })
      } else {
        let calls = 0
        f.setContextGate(async () => { if (++calls === (stage === "before-token" ? 1 : 2)) { entered(); await gate } })
      }
      const pending = f.service.runIntent(owner, { ...base(), operation: "open", scopeMode: "currentDirectory" })
      await waiting; f.guard.notifyRevocation({ actorId: "mobile-gateway" }); resume()
      expect((await pending).outcome).toBe("rejected")
      expect(f.service.facts().scopes).toBe(0)
      expect(f.service.facts().resultBytes).toBe(0)
    }
  })

  it("revokes an opening request's temporary grant before a late Git response can create a scope", async () => {
    const f = await fixture()
    let started!: () => void, complete!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    configureGitCommandSecurity({ processRunner: { run: () => new Promise(resolve => {
      complete = () => resolve({ stdout: "", stderr: "", exitCode: 128, signal: null, timedOut: false, durationMs: 1 })
      started()
    }) } })
    const pending = f.service.runIntent(owner, { ...base(), operation: "open", scopeMode: "currentDirectory" })
    await entered
    f.guard.notifyRevocation({ actorId: "mobile-gateway" })
    complete()
    expect((await pending).outcome).toBe("rejected")
    expect(f.service.facts().scopes).toBe(0)
  })

  it.skipIf(process.platform === "win32")("shows symlinks as unavailable and rejects replaced ancestors and FIFO targets", async () => {
    const f = await fixture(), outside = await fixture()
    await mkdir(path.join(f.root, "inside")); await writeFile(path.join(f.root, "inside", "note.txt"), "canary")
    await symlink(outside.root, path.join(f.root, "link"))
    await execute("mkfifo", [path.join(f.root, "pipe")])
    const scope = await f.open()
    const page = dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId }), "directory")
    for (const name of ["link", "pipe"]) {
      const entry = page.entries.find(entry => entry.name === name)!
      expect(entry.canPreview).toBe(false); expect(entry.canReference).toBe(false)
      expect((await f.call({ operation: "reference", ...f.scoped(scope), entryId: entry.entryId })).outcome).toBe("rejected")
    }
    const directory = page.entries.find(entry => entry.name === "inside")!
    const files = dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: directory.entryId }), "directory")
    await rename(path.join(f.root, "inside"), path.join(f.root, "old-inside")); await symlink(outside.root, path.join(f.root, "inside"))
    expect((await f.call({ operation: "preview", ...f.scoped(scope), target: { source: "disk", entryId: files.entries[0]!.entryId } })).code).toBe("unsafe_path")
  })

  it("accepts reordered JSON keys through all three real directory pages while rejecting a different directory", async () => {
    const f = await fixture()
    await mkdir(path.join(f.root, "paging"))
    await Promise.all(Array.from({ length: 205 }, (_, index) => writeFile(path.join(f.root, "paging", `page-${String(index).padStart(4, "0")}.txt`), "text\n")))
    const scope = await f.open()
    const root = dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId }), "directory")
    const directoryEntryId = root.entries[0]!.entryId
    const first = dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId }), "directory")
    expect(first).toMatchObject({ pageIndex: 0, completion: "partial" }); expect(first.entries).toHaveLength(100)
    const second = dataFor(await f.service.runIntent(owner, {
      cursor: first.nextCursor!, directoryEntryId, expectedContextVersion: scope.contextVersion, scopeId: scope.scopeId,
      operation: "directory", sessionId: "session-1", filesVersion: 1, kind: "workspaceFiles", intentId: base().intentId, v: 1,
    }), "directory")
    expect(second).toMatchObject({ pageIndex: 1, completion: "partial", directoryVersion: first.directoryVersion }); expect(second.entries).toHaveLength(100)
    const third = dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId, cursor: second.nextCursor }), "directory")
    expect(third).toMatchObject({ pageIndex: 2, completion: "complete", nextCursor: null, directoryVersion: first.directoryVersion }); expect(third.entries).toHaveLength(5)
    const all = [...first.entries, ...second.entries, ...third.entries]
    expect(new Set(all.map(entry => entry.entryId)).size).toBe(205)
    expect(all.map(entry => entry.name)).toEqual(Array.from({ length: 205 }, (_, index) => `page-${String(index).padStart(4, "0")}.txt`))
    expect((await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId, cursor: first.nextCursor })).code).toBe("invalid_cursor")
  })

  it("accepts reordered nested preview targets but keeps cursor target and request-id semantics bound", async () => {
    const f = await fixture()
    await writeFile(path.join(f.root, "many.txt"), Array.from({ length: 2000 }, (_, index) => `${index} 中文😀 ${"x".repeat(70)}`).join("\n"))
    await writeFile(path.join(f.root, "other.txt"), "other\n")
    const scope = await f.open(), rows = dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId }), "directory").entries
    const entryId = rows.find(entry => entry.name === "many.txt")!.entryId, otherEntryId = rows.find(entry => entry.name === "other.txt")!.entryId
    const first = dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target: { source: "disk", entryId } }), "preview")
    expect(first.completion).toBe("partial"); expect(first.nextCursor).not.toBeNull()
    const request = {
      target: { entryId, source: "disk" as const }, cursor: first.nextCursor!, expectedContentVersion: first.contentVersion,
      expectedContextVersion: scope.contextVersion, scopeId: scope.scopeId, operation: "preview" as const,
      sessionId: "session-1", filesVersion: 1 as const, kind: "workspaceFiles" as const, intentId: base().intentId, v: 1 as const,
    }
    const result = await f.service.runIntent(owner, request), second = dataFor(result, "preview")
    expect(second).toMatchObject({ pageIndex: 1, contentVersion: first.contentVersion }); expect(second.lines[0]!.lineNumber).toBe(first.lines.length + 1)
    const reorderedRetry = {
      v: request.v, intentId: request.intentId, kind: request.kind, filesVersion: request.filesVersion, sessionId: request.sessionId,
      operation: request.operation, scopeId: request.scopeId, expectedContextVersion: request.expectedContextVersion,
      expectedContentVersion: request.expectedContentVersion, cursor: request.cursor, target: { source: "disk" as const, entryId },
    }
    expect(await f.service.runIntent(owner, reorderedRetry)).toEqual(result)
    expect((await f.service.runIntent(owner, { ...reorderedRetry, target: { source: "disk", entryId: otherEntryId } })).code).toBe("request_conflict")
    expect((await f.service.runIntent(owner, { ...reorderedRetry, expectedContextVersion: "changed-context" })).code).toBe("request_conflict")
    expect((await f.service.runIntent(owner, { ...reorderedRetry, expectedContentVersion: "changed-content" })).code).toBe("request_conflict")
    const other = dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target: { source: "disk", entryId: otherEntryId } }), "preview")
    expect((await f.call({ operation: "preview", ...f.scoped(scope), target: { source: "disk", entryId: otherEntryId }, cursor: first.nextCursor, expectedContentVersion: other.contentVersion })).code).toBe("invalid_cursor")
  })

  it("replays the same real preview request across outer and nested JSON key orders without relaxing target identity", async () => {
    const f = await fixture()
    await Promise.all([writeFile(path.join(f.root, "first.txt"), "first\n"), writeFile(path.join(f.root, "second.txt"), "second\n")])
    const scope = await f.open(), entries = dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId }), "directory").entries
    const request = { ...base(), operation: "preview" as const, ...f.scoped(scope), target: { source: "disk" as const, entryId: entries[0]!.entryId } }
    const result = await f.service.runIntent(owner, request)
    expect(dataFor(result, "preview").lines.map(line => line.text)).toEqual(["first"])
    const outerRetry = {
      target: request.target, expectedContextVersion: request.expectedContextVersion, scopeId: request.scopeId, operation: request.operation,
      sessionId: request.sessionId, filesVersion: request.filesVersion, kind: request.kind, intentId: request.intentId, v: request.v,
    }
    expect(await f.service.runIntent(owner, outerRetry)).toEqual(result)
    expect(await f.service.runIntent(owner, { ...request, target: { entryId: request.target.entryId, source: "disk" } })).toEqual(result)
    expect((await f.service.runIntent(owner, { ...outerRetry, target: { source: "disk", entryId: entries[1]!.entryId } })).code).toBe("request_conflict")
  })

  it("paginates complete Unicode lines and rejects page drift/cross-query cursors", async () => {
    const f = await fixture()
    await writeFile(path.join(f.root, "many.txt"), Array.from({ length: 2000 }, (_, index) => `${index} 中文😀 ${"x".repeat(70)}`).join("\n"))
    const scope = await f.open(), files = dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId }), "directory")
    const target = { source: "disk", entryId: files.entries[0]!.entryId }
    const first = dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target }), "preview")
    expect(first.completion).toBe("partial"); expect(first.contentComplete).toBe(false)
    const second = dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target, cursor: first.nextCursor, expectedContentVersion: first.contentVersion }), "preview")
    expect(second.pageIndex).toBe(1); expect(second.lines[0]!.lineNumber).toBe(first.lines.length + 1)
    await writeFile(path.join(f.root, "many.txt"), "changed")
    expect((await f.call({ operation: "preview", ...f.scoped(scope), target, cursor: first.nextCursor, expectedContentVersion: first.contentVersion })).code).toBe("content_stale")
  })

  it("pages newline-heavy previews by text offset without building a full line model", async () => {
    const f = await fixture()
    await writeFile(path.join(f.root, "newlines.txt"), "\n".repeat(256 * 1024))
    const scope = await f.open(), files = dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId }), "directory")
    const target = { source: "disk", entryId: files.entries[0]!.entryId }
    const first = dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target }), "preview")
    expect(first.lines.length).toBeLessThan(2000); expect(first.contentComplete).toBe(false)
    const second = dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target, cursor: first.nextCursor, expectedContentVersion: first.contentVersion }), "preview")
    expect(second.lines[0]!.lineNumber).toBe(first.lines.length + 1); expect(second.completion).toBe("partial")
    expect(f.service.facts().resultBytes).toBeLessThanOrEqual(2 * 1024 * 1024)
  })

  it("searches unopened deeper directories and maintains completion independently from matching", async () => {
    const f = await fixture()
    await mkdir(path.join(f.root, "node_modules")); await mkdir(path.join(f.root, "node_modules", "deep")); await writeFile(path.join(f.root, "node_modules", "deep", "needle.ts"), "secret source never needed")
    const scope = await f.open()
    const found = dataFor(await f.call({ operation: "search", ...f.scoped(scope), query: "needle" }), "search")
    expect(found.entries.map(entry => entry.relativePath)).toEqual(["node_modules/deep/needle.ts"])
    expect(found.scanComplete).toBe(true)
    const missing = dataFor(await f.call({ operation: "search", ...f.scoped(scope), query: "no-match" }), "search")
    expect(missing.entries).toEqual([]); expect(missing.scanComplete).toBe(true)
  })

  it("returns a resumable empty page at the two-second budget and completes its remaining real directory", async () => {
    const f = await fixture()
    await Promise.all(["one.txt", "two.txt", "three.txt"].map(name => writeFile(path.join(f.root, name), "body not searched")))
    const scope = await f.open(), enumerate = filePaths.enumerateDirectory
    let time = 0, delayed = false
    vi.spyOn(performance, "now").mockImplementation(() => time)
    vi.spyOn(filePaths, "enumerateDirectory").mockImplementation(async (...args) => {
      const page = await enumerate(...args)
      if (!delayed) { delayed = true; time = L.searchRequestMs + 1 }
      return page
    })
    const first = dataFor(await f.call({ operation: "search", ...f.scoped(scope), query: "absent-match" }), "search")
    expect(first).toMatchObject({ entries: [], scanComplete: false, collectionComplete: false, completion: "partial" })
    expect(first.nextCursor).not.toBeNull()
    time = 0
    const next = dataFor(await f.call({ operation: "search", ...f.scoped(scope), query: "absent-match", cursor: first.nextCursor }), "search")
    expect(next).toMatchObject({ entries: [], scannedEntries: 3, scanComplete: true, collectionComplete: true, completion: "complete", nextCursor: null })
  })

  it("stops at twenty thousand request nodes and truncates at the one-hundred-thousand chain budget", async () => {
    const f = await fixture()
    await Promise.all(Array.from({ length: 6 }, (_, index) => mkdir(path.join(f.root, `section${index}`))))
    const scope = await f.open(), enumerate = filePaths.enumerateDirectory
    vi.spyOn(performance, "now").mockReturnValue(0)
    vi.spyOn(filePaths, "enumerateDirectory").mockImplementation(async (root, relative, signal) => {
      if (!relative) return enumerate(root, relative, signal)
      // A controlled filesystem boundary supplies bounded directory metadata;
      // traversal, matching, cursors and all budgets remain the production service.
      return { entries: Array.from({ length: L.maxDirectoryEntries }, (_, index) => ({ name: `f${index}.txt`, relativePath: `${relative}/f${index}.txt`, kind: "file" as const })), version: filePaths.fileIdentity(await lstat(path.join(root, relative))) }
    })
    let cursor: string | null = null
    for (let pageIndex = 0; pageIndex < L.maxSearchEntries / L.maxSearchRequestEntries; pageIndex++) {
      const page: FilesData<"search"> = dataFor(await f.call({ operation: "search", ...f.scoped(scope), query: "no-match", ...(cursor ? { cursor } : {}) }), "search")
      expect(page.entries).toEqual([]); expect(page.scannedEntries).toBe((pageIndex + 1) * L.maxSearchRequestEntries)
      expect(page.scanComplete).toBe(false); expect(page.collectionComplete).toBe(false)
      expect(page.completion).toBe(pageIndex === 4 ? "truncated" : "partial")
      expect(page.nextCursor === null).toBe(pageIndex === 4)
      if (pageIndex === 4) expect(page.truncatedReason).toBe("limit_exceeded")
      cursor = page.nextCursor
    }
  }, 30_000)

  it("bounds giant/invalid/binary/long-line files before display and cache replay still validates", async () => {
    const f = await fixture()
    await Promise.all([writeFile(path.join(f.root, "large"), Buffer.alloc(2 * 1024 * 1024 + 1)), writeFile(path.join(f.root, "binary"), Buffer.from([1, 0, 2])), writeFile(path.join(f.root, "invalid"), Buffer.from([0xff, 0xfe])), writeFile(path.join(f.root, "long"), "😀".repeat(4000))])
    const scope = await f.open(), rows = dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId }), "directory").entries
    for (const [name, state] of [["large", "limit_exceeded"], ["binary", "binary"], ["invalid", "unsupported_encoding"]]) {
      const result = dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target: { source: "disk", entryId: rows.find(entry => entry.name === name)!.entryId } }), "preview")
      expect(result.contentState).toBe(state); expect(result.lines).toEqual([])
    }
    const request = { ...base(), operation: "preview", ...f.scoped(scope), target: { source: "disk", entryId: rows.find(entry => entry.name === "long")!.entryId } } as MobileWorkspaceFilesIntent
    const first = dataFor(await f.service.runIntent(owner, request), "preview")
    expect(first.lines[0]!.truncated).toBe(true); expect(Buffer.byteLength(first.lines[0]!.text)).toBeLessThanOrEqual(8192)
    await writeFile(path.join(f.root, "long"), "new")
    expect((await f.service.runIntent(owner, request)).code).toBe("content_stale")
    expect(f.service.facts().resultBytes).toBeLessThanOrEqual(2 * 1024 * 1024)
  })

  it("cancels late open without a scope and expires resources during idle time", async () => {
    const f = await fixture()
    const pending = { ...base(), operation: "open", scopeMode: "currentDirectory" } as const
    const cancel = dataFor(await f.call({ operation: "cancel", targetIntentId: pending.intentId }), "cancel")
    expect(cancel.status).toBe("notFound")
    expect((await f.service.runIntent(owner, pending)).code).toBe("cancelled")
    expect(f.service.facts().scopes).toBe(0)
    const scope = await f.open()
    f.advance(600_001)
    expect((await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId })).code).toBe("invalid_scope")
    expect(f.service.facts().scopes).toBe(0)
  })

  it("expires the permission grant without a follow-up request and disposes its sweep timer", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const f = await fixture(), checks = vi.spyOn(f.guard, "check"), scope = await f.open()
    const authorization = checks.mock.calls.find(([request]) => request.resource === f.root)![0]
    f.advance(600_001)
    await vi.advanceTimersByTimeAsync(30_000)
    // Query the guard directly, without facts/runIntent causing any lazy expiration.
    expect((await f.guard.check(authorization)).allowed).toBe(false)
    expect((await f.call({ operation: "close", scopeId: scope.scopeId })).workspaceFiles?.data).toMatchObject({ status: "alreadyClosed" })
    f.service.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("keeps 10,001 directory candidates paged and memory bounded without full-tree handles", async () => {
    const f = await fixture()
    for (let offset = 0; offset < 10_001; offset += 128) await Promise.all(Array.from({ length: Math.min(128, 10_001 - offset) }, (_, index) => writeFile(path.join(f.root, `file-${String(offset + index).padStart(5, "0")}.txt`), "")))
    const scope = await f.open()
    const page = dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId }), "directory")
    expect(page.entries).toHaveLength(100); expect(page.completion).toBe("partial"); expect(page.collectionComplete).toBe(true)
    expect(f.service.facts().handles).toBeLessThanOrEqual(101)
    expect(f.service.facts().metadataBytes).toBeLessThanOrEqual(4 * 1024 * 1024)
  }, 20_000)
})

describe("mobile workspace Git uses real bounded readonly repositories", () => {
  it("reports a binary index changing to text without contradictory preview metadata", async () => {
    const f = await fixture(true), target = path.join(f.root, "binary.dat")
    await writeFile(target, Buffer.from([65, 0, 66])); await f.command("add", "."); await f.command("commit", "-qm", "binary baseline")
    await writeFile(target, "new\n")
    expect((await f.command("--no-optional-locks", "diff", "--no-ext-diff", "--no-textconv", "--numstat")).trim()).toBe("-\t-\tbinary.dat")
    const scope = await f.open("repository"), changes = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
    const change = changes.entries[0]!
    expect(change).toMatchObject({ contentState: "binary", canPreviewBefore: false, canPreviewAfter: false, additions: null, deletions: null, statsComplete: false })
    const diff = dataFor(await f.call({ operation: "diff", ...f.scoped(scope), changeId: change.changeId, changeSetVersion: changes.changeSetVersion }), "diff")
    expect(diff).toMatchObject({ contentState: "binary", hunks: [], additions: null, deletions: null, statsComplete: false })
    for (const side of ["before", "after"] as const) {
      const preview = dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target: { source: "change", changeId: change.changeId, changeSetVersion: changes.changeSetVersion, side } }), "preview")
      expect(preview).toMatchObject({ contentState: "binary", lines: [] })
    }
  }, 20_000)

  it("preserves the bounded text after side when the index baseline exceeds the file limit", async () => {
    const f = await fixture(true), target = path.join(f.root, "file.txt")
    await writeFile(target, Buffer.alloc(L.maxFileSideBytes + 1, 97)); await f.command("add", "."); await f.command("commit", "-qm", "giant baseline")
    await writeFile(target, "after\n")
    const scope = await f.open("repository"), changes = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
    const change = changes.entries[0]!
    expect(change).toMatchObject({ contentState: "limit_exceeded", canPreviewBefore: false, canPreviewAfter: true, additions: null, deletions: null, statsComplete: false })
    const before = dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target: { source: "change", changeId: change.changeId, changeSetVersion: changes.changeSetVersion, side: "before" } }), "preview")
    expect(before).toMatchObject({ contentState: "limit_exceeded", lines: [] })
    const after = dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target: { source: "change", changeId: change.changeId, changeSetVersion: changes.changeSetVersion, side: "after" } }), "preview")
    expect(after.contentState).toBe("available"); expect(after.lines[0]!.text).toBe("after")
    const diff = dataFor(await f.call({ operation: "diff", ...f.scoped(scope), changeId: change.changeId, changeSetVersion: changes.changeSetVersion }), "diff")
    expect(diff).toMatchObject({ contentState: "limit_exceeded", hunks: [], additions: null, deletions: null, statsComplete: false })
  }, 20_000)

  it("reports a real index type change and staged/unstaged tracked binary content with honest statistics", async () => {
    const f = await fixture(true)
    await writeFile(path.join(f.root, "type.txt"), "base\n"); await writeFile(path.join(f.root, "binary.dat"), Buffer.from([65, 0, 66]))
    await f.command("add", "."); await f.command("commit", "-qm", "type and binary baseline")
    await writeFile(path.join(f.root, "link-target"), "target.txt")
    const oid = (await f.command("hash-object", "-w", "link-target")).trim()
    await f.command("update-index", "--cacheinfo", "120000", oid, "type.txt")
    await writeFile(path.join(f.root, "binary.dat"), Buffer.from([65, 0, 67])); await f.command("add", "binary.dat")
    let scope = await f.open("repository")
    const staged = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "staged" }), "changes")
    const type = staged.entries.find(entry => entry.relativePath === "type.txt")!
    expect(type).toMatchObject({ status: "type_changed", contentState: "type_change", canPreviewBefore: false, canPreviewAfter: false })
    const restricted = dataFor(await f.call({ operation: "diff", ...f.scoped(scope), changeId: type.changeId, changeSetVersion: staged.changeSetVersion }), "diff")
    expect(restricted.contentState).toBe("type_change"); expect(restricted.hunks).toEqual([])
    const binary = staged.entries.find(entry => entry.relativePath === "binary.dat")!
    expect(binary).toMatchObject({ contentState: "binary", additions: null, deletions: null, statsComplete: false })
    const stagedDiff = dataFor(await f.call({ operation: "diff", ...f.scoped(scope), changeId: binary.changeId, changeSetVersion: staged.changeSetVersion }), "diff")
    expect(stagedDiff).toMatchObject({ contentState: "binary", hunks: [], additions: null, deletions: null, statsComplete: false })
    await writeFile(path.join(f.root, "binary.dat"), Buffer.from([65, 0, 68]))
    scope = await f.open("repository")
    const unstaged = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
    const current = unstaged.entries.find(entry => entry.relativePath === "binary.dat")!
    expect(current).toMatchObject({ contentState: "binary", additions: null, deletions: null, statsComplete: false })
    expect(dataFor(await f.call({ operation: "diff", ...f.scoped(scope), changeId: current.changeId, changeSetVersion: unstaged.changeSetVersion }), "diff")).toMatchObject({ contentState: "binary", hunks: [], additions: null, deletions: null, statsComplete: false })
  }, 20_000)

  it("opens both tabs at the same current-directory or actual submodule repository root", async () => {
    const child = await fixture(true)
    await mkdir(path.join(child.root, "deep")); await writeFile(path.join(child.root, "deep", "child.txt"), "child base\n"); await writeFile(path.join(child.root, "root.txt"), "child root\n")
    await child.command("add", "."); await child.command("commit", "-qm", "child")
    const f = await fixture(true)
    await writeFile(path.join(f.root, "parent.txt"), "parent canary\n")
    await f.command("-c", "protocol.file.allow=always", "submodule", "add", "-q", child.root, "module"); await f.command("add", "."); await f.command("commit", "-qm", "parent")
    const moduleRoot = path.join(f.root, "module")
    await writeFile(path.join(moduleRoot, "deep", "child.txt"), "child changed\n")
    f.setCwd(path.join(moduleRoot, "deep"))
    for (const mode of ["currentDirectory", "repository"] as const) {
      const scope = await f.open(mode)
      expect(scope.rootDisplayName).toBe(mode === "currentDirectory" ? "deep" : "module")
      const directory = dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId }), "directory")
      expect(directory.entries.map(entry => entry.relativePath)).toEqual(mode === "currentDirectory" ? ["child.txt"] : ["deep", "root.txt"])
      const changes = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
      expect(changes.entries.map(entry => entry.relativePath)).toEqual(mode === "currentDirectory" ? ["child.txt"] : ["deep/child.txt"])
      const diff = dataFor(await f.call({ operation: "diff", ...f.scoped(scope), changeId: changes.entries[0]!.changeId, changeSetVersion: changes.changeSetVersion }), "diff")
      expect(diff.hunks.flatMap(hunk => hunk.lines).map(line => line.text)).toContain("child base")
      expect(JSON.stringify(diff)).not.toContain("parent canary")
    }
  }, 20_000)
  it("normalizes a text working tree when the CRLF baseline is Git-conversion binary", async () => {
    const f = await fixture(true), target = path.join(f.root, "file.txt")
    await writeFile(target, "unchanged\r\nold\rX\n"); await f.command("add", "."); await f.command("commit", "-qm", "binary-conversion baseline")
    await f.command("config", "--unset", "core.autocrlf"); await writeFile(path.join(f.home, ".gitconfig"), "[core]\nautocrlf = true\n")
    await writeFile(target, "unchanged\r\nnew\r\n")
    expect((await f.command("--no-optional-locks", "diff", "--numstat")).trim()).toBe("2\t2\tfile.txt")
    const scope = await f.open("repository"), changes = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
    const diff = dataFor(await f.call({ operation: "diff", ...f.scoped(scope), changeId: changes.entries[0]!.changeId, changeSetVersion: changes.changeSetVersion }), "diff")
    expect(diff).toMatchObject({ additions: 2, deletions: 2 })
    await rm(path.join(f.home, ".gitconfig"))
    expect((await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" })).code).toBe("git_unavailable")
  }, 20_000)

  it("matches a native clean checkout and one-line edit when autocrlf is only global", async () => {
    const f = await fixture(true), target = path.join(f.root, "file.txt")
    await writeFile(target, "unchanged\nold\n"); await f.command("add", "."); await f.command("commit", "-qm", "base")
    await f.command("config", "--unset", "core.autocrlf")
    await writeFile(path.join(f.home, ".gitconfig"), "[core]\nautocrlf = true\n")
    await rm(target); await f.command("checkout", "--", "file.txt")
    expect(await readFile(target, "utf8")).toBe("unchanged\r\nold\r\n")
    await writeFile(target, "unchanged\r\nold\r\n") // Force a stat miss with equal native content.
    expect((await f.command("--no-optional-locks", "status", "--porcelain=v1")).trim()).toBe("")
    const index = await readFile(path.join(f.root, ".git", "index")), objects = await readdir(path.join(f.root, ".git", "objects"), { recursive: true })
    let scope = await f.open("repository")
    expect(dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes").entries).toEqual([])
    await writeFile(target, "unchanged\r\nnew\r\n")
    expect((await f.command("diff", "--numstat")).trim()).toBe("1\t1\tfile.txt")
    scope = await f.open("repository")
    const changed = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
    expect(changed.entries[0]).toMatchObject({ status: "modified", relativePath: "file.txt" })
    const diff = dataFor(await f.call({ operation: "diff", ...f.scoped(scope), changeId: changed.entries[0]!.changeId, changeSetVersion: changed.changeSetVersion }), "diff")
    expect(diff.additions).toBe(1); expect(diff.deletions).toBe(1)
    expect(diff.hunks.flatMap(hunk => hunk.lines).find(line => line.text === "unchanged")?.kind).toBe("context")
    expect(await readFile(path.join(f.root, ".git", "index"))).toEqual(index)
    expect(await readdir(path.join(f.root, ".git", "objects"), { recursive: true })).toEqual(objects)
    expect(JSON.stringify(f.audit.list())).not.toContain(f.home)
  }, 20_000)

  it("respects XDG then home then local precedence without conflating bare and empty booleans", async () => {
    const f = await fixture(true), target = path.join(f.root, "file.txt")
    await writeFile(target, "old\n"); await f.command("add", "."); await f.command("commit", "-qm", "base"); await f.command("config", "--unset", "core.autocrlf")
    await mkdir(path.join(f.xdg, "git"), { recursive: true }); await writeFile(path.join(f.xdg, "git", "config"), "[core]\nautocrlf = true\n")
    await writeFile(path.join(f.home, ".gitconfig"), "[core]\nautocrlf =\n")
    await writeFile(target, "old\r\n")
    let scope = await f.open("repository")
    expect(dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes").entries).toHaveLength(1)
    expect((await f.command("config", "--type=bool", "--get", "core.autocrlf")).trim()).toBe("false")
    await writeFile(path.join(f.home, ".gitconfig"), "[core]\nautocrlf\n")
    scope = await f.open("repository")
    expect(dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes").entries).toEqual([])
    await f.command("config", "core.autocrlf", "false")
    scope = await f.open("repository")
    expect(dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes").entries).toHaveLength(1)
  }, 20_000)

  it("invalidates prior content after standard global configuration creation, deletion, and replacement", async () => {
    const f = await fixture(true), config = path.join(f.home, ".gitconfig")
    await writeFile(path.join(f.root, "file.txt"), "old\n"); await f.command("add", "."); await f.command("commit", "-qm", "base"); await writeFile(path.join(f.root, "file.txt"), "new\n")
    const scope = await f.open("repository")
    for (const mutation of [async () => writeFile(config, "[core]\nautocrlf = true\n"), async () => rm(config), async () => { await writeFile(config + ".next", "[core]\nautocrlf = false\n"); await rename(config + ".next", config) }]) {
      const changes = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
      const request = { ...base(), operation: "diff" as const, ...f.scoped(scope), changeId: changes.entries[0]!.changeId, changeSetVersion: changes.changeSetVersion }
      dataFor(await f.service.runIntent(owner, request), "diff") // Also exercise a cached replay.
      await mutation()
      expect((await f.service.runIntent(owner, request)).code).toBe("content_stale")
    }
  }, 30_000)

  it("binds conversion settings to the initial fingerprint if configuration changes during collection", async () => {
    const f = await fixture(true)
    await writeFile(path.join(f.root, "file.txt"), "old\n"); await f.command("add", "."); await f.command("commit", "-qm", "base"); await writeFile(path.join(f.root, "file.txt"), "new\n")
    const scope = await f.open("repository"), runner = createControlledProcessRunner({ permissionGuard: f.guard, auditSink: f.audit })
    let changed = false
    configureGitCommandSecurity({ processRunner: { run: async request => {
      const result = await runner.run(request)
      if (!changed && request.args?.includes("--file") && request.args[request.args.length - 1] === "core.filemode") {
        changed = true
        await writeFile(path.join(f.home, ".gitconfig"), "[core]\nautocrlf = true\n")
      }
      return result
    } } })
    expect((await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" })).code).toBe("content_stale")
    expect(changed).toBe(true)
  }, 20_000)

  it.each(["alternates", "http-alternates"] as const)("rejects %s created or filled after opening before the next native Git operation", async name => {
    const canary = await fixture(true), canaryText = "outside object canary\n"
    await writeFile(path.join(canary.root, "canary.txt"), canaryText)
    await canary.command("add", "."); await canary.command("commit", "-qm", "canary")
    const canaryOid = (await canary.command("rev-parse", "HEAD:canary.txt")).trim()
    const f = await fixture(true)
    const permissionChecks = vi.spyOn(f.guard, "check")
    await writeFile(path.join(f.root, "file.txt"), "authorized base\n")
    await f.command("add", "."); await f.command("commit", "-qm", "base")
    const target = path.join(f.root, ".git", "objects", "info", name)
    const outsideObjects = path.join(canary.root, ".git", "objects").split(path.sep).join("/")
    for (const initiallyEmpty of [false, true]) {
      await rm(target, { force: true })
      if (initiallyEmpty) await writeFile(target, "")
      const scope = await f.open("repository")
      await writeFile(target, `${outsideObjects}\n`)
      if (name === "alternates") {
        // Native Git really can reach the independent object database. Bind the
        // outside-only blob to an otherwise authorized staged path for the reader.
        expect(await f.command("cat-file", "blob", canaryOid)).toBe(canaryText)
        await f.command("update-index", "--cacheinfo", `100644,${canaryOid},file.txt`)
      }
      const result = await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "staged" })
      expect(result, JSON.stringify(result)).toMatchObject({ outcome: "rejected", code: "git_unavailable" })
      expect(JSON.stringify(result)).not.toContain(canaryText.trim())
      expect(permissionChecks.mock.calls.some(([request]) => request.action === "fs.read.outside-userdata" && filePaths.isWithinRoot(canary.root, request.resource))).toBe(false)
    }
  }, 20_000)

  it("rejects an alternate inserted between native blob commands instead of starting the next reader", async () => {
    const canary = await fixture(true)
    await writeFile(path.join(canary.root, "canary.txt"), "outside object canary\n")
    await canary.command("add", "."); await canary.command("commit", "-qm", "canary")
    const f = await fixture(true)
    await writeFile(path.join(f.root, "file.txt"), "authorized base\n")
    await f.command("add", "."); await f.command("commit", "-qm", "base")
    await writeFile(path.join(f.root, "file.txt"), "authorized new\n")
    const scope = await f.open("repository")
    const changes = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
    const runner = createControlledProcessRunner({ permissionGuard: f.guard, auditSink: f.audit })
    const launched: string[][] = [], alternate = path.join(f.root, ".git", "objects", "info", "alternates")
    let inserted = false
    configureGitCommandSecurity({ processRunner: { run: async request => {
      launched.push([...(request.args ?? [])])
      const result = await runner.run(request)
      if (!inserted && request.args?.includes("cat-file") && request.args.includes("-t")) {
        inserted = true
        await writeFile(alternate, `${path.join(canary.root, ".git", "objects").split(path.sep).join("/")}\n`)
      }
      return result
    } } })
    const result = await f.call({ operation: "preview", ...f.scoped(scope), target: { source: "change", changeId: changes.entries[0]!.changeId, changeSetVersion: changes.changeSetVersion, side: "before" } })
    expect(inserted).toBe(true)
    expect(result).toMatchObject({ outcome: "rejected", code: "git_unavailable" })
    expect(launched.some(args => args.includes("cat-file") && (args.includes("-s") || args.includes("blob")))).toBe(false)
    expect(f.service.facts().activeReads).toBe(0)
  }, 20_000)

  it.each(["alternates", "http-alternates"] as const)("accepts an absent or zero-byte %s but rejects a BOM-only file after open", async name => {
    const f = await fixture(true)
    await writeFile(path.join(f.root, "file.txt"), "base\n")
    await f.command("add", "."); await f.command("commit", "-qm", "base")
    const scope = await f.open("repository"), target = path.join(f.root, ".git", "objects", "info", name)
    expect(dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "staged" }), "changes").entries).toEqual([])
    await writeFile(target, "")
    expect(dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "staged" }), "changes").entries).toEqual([])
    await writeFile(target, Buffer.from([0xef, 0xbb, 0xbf]))
    expect(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "staged" })).toMatchObject({ outcome: "rejected", code: "git_unavailable" })
  }, 20_000)

  it("checks exact alternate permission before native Git and revokes the owned scope on denial", async () => {
    const f = await fixture(true)
    await writeFile(path.join(f.root, "file.txt"), "base\n")
    await f.command("add", "."); await f.command("commit", "-qm", "base")
    const scope = await f.open("repository"), alternate = path.join(f.root, ".git", "objects", "info", "alternates")
    const originalCheck = f.guard.check.bind(f.guard)
    vi.spyOn(f.guard, "check").mockImplementation(request => request.resource === alternate ? Promise.resolve({ allowed: false, reason: "fixture denied alternate metadata" }) : originalCheck(request))
    const result = await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" })
    expect(result).toMatchObject({ outcome: "rejected", code: "permission_denied" })
    expect(f.audit.list().some(record => record.outcome === "denied")).toBe(true)
    expect(f.service.facts()).toMatchObject({ scopes: 0, activeReads: 0 })
  })

  it("closes the bounded alternate descriptor when its active native Git gate is cancelled", async () => {
    const f = await fixture(true)
    await writeFile(path.join(f.root, "file.txt"), "base\n")
    await f.command("add", "."); await f.command("commit", "-qm", "base")
    const alternate = path.join(f.root, ".git", "objects", "info", "alternates")
    await writeFile(alternate, "")
    const scope = await f.open("repository"), checks = vi.spyOn(f.guard, "check")
    let entered!: () => void, resume!: () => void, retained: Awaited<ReturnType<typeof open>> | undefined
    const reached = new Promise<void>(resolve => { entered = resolve }), ready = new Promise<void>(resolve => { resume = resolve })
    vi.mocked(open).mockImplementation(async (file, flags, mode) => {
      const descriptor = await originalOpen(file, flags, mode)
      if (String(file) === alternate && !retained) {
        retained = descriptor
        expect(Number(flags) & (constants.O_NONBLOCK ?? 0)).toBe(constants.O_NONBLOCK ?? 0)
        expect(Number(flags) & (constants.O_NOFOLLOW ?? 0)).toBe(constants.O_NOFOLLOW ?? 0)
        expect(checks.mock.calls.at(-1)?.[0]).toMatchObject({ action: "fs.read.outside-userdata", resource: alternate })
        entered(); await ready
      }
      return descriptor
    })
    const request = { ...base(), operation: "changes", ...f.scoped(scope), changeRange: "unstaged" } as const
    const pending = f.service.runIntent(owner, request)
    await reached
    const started = performance.now(), cancelling = f.call({ operation: "cancel", scopeId: scope.scopeId, targetIntentId: request.intentId })
    resume()
    const [cancelled, result] = await Promise.all([cancelling, pending])
    expect(cancelled.workspaceFiles?.data).toMatchObject({ status: "cancelled" })
    expect(result).toMatchObject({ outcome: "rejected", code: "cancelled" })
    expect(performance.now() - started).toBeLessThan(1000)
    await expect(retained!.stat()).rejects.toMatchObject({ code: "EBADF" })
    expect(f.service.facts().activeReads).toBe(0)
  })

  it("checks a submodule's alternate files before its native HEAD lookup", async () => {
    const child = await fixture(true)
    await writeFile(path.join(child.root, "child.txt"), "child base\n")
    await child.command("add", "."); await child.command("commit", "-qm", "child")
    const f = await fixture(true)
    await f.command("-c", "protocol.file.allow=always", "submodule", "add", "-q", child.root, "module")
    await f.command("add", "."); await f.command("commit", "-qm", "parent")
    const scope = await f.open("repository"), moduleRoot = path.join(f.root, "module")
    const marker = await readFile(path.join(moduleRoot, ".git"), "utf8")
    const moduleGitDir = await realpath(path.resolve(moduleRoot, marker.trim().slice(8)))
    await mkdir(path.join(moduleGitDir, "objects", "info"), { recursive: true })
    await writeFile(path.join(moduleGitDir, "objects", "info", "alternates"), `${path.join(child.root, ".git", "objects").split(path.sep).join("/")}\n`)
    const runner = createControlledProcessRunner({ permissionGuard: f.guard, auditSink: f.audit })
    let nativeChildHead = false
    configureGitCommandSecurity({ processRunner: { run: async request => {
      if (request.cwd === moduleRoot && request.args?.includes("rev-parse") && request.args.includes("HEAD")) nativeChildHead = true
      return runner.run(request)
    } } })
    expect(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" })).toMatchObject({ outcome: "rejected", code: "git_unavailable" })
    expect(nativeChildHead).toBe(false)
  }, 20_000)

  it("rejects global includes and external converters without following or executing them", async () => {
    const f = await fixture(true), config = path.join(f.home, ".gitconfig"), canary = path.join(f.home, "filter-executed")
    await writeFile(path.join(f.root, "readable.txt"), "ordinary\n")
    const included = path.join(f.home, "unapproved-included-config")
    await writeFile(included, `[filter "included"]\nclean = touch '${canary}'\n`)
    const condition = `gitdir:${f.root.split(path.sep).join("/")}/.git/`
    for (const section of ["include", ...["includeIf", "includeif", "INCLUDEIF"].map(name => `${name} "${condition}"`)]) {
      await writeFile(config, `[${section}]\npath = ${included.split(path.sep).join("/")}\n`)
      const scope = await f.open()
      expect(scope).toMatchObject({ gitAvailable: false, gitUnavailableReason: "git_unavailable" })
      expect(dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId }), "directory").entries[0]?.name).toBe("readable.txt")
    }
    await writeFile(config, `[filter "review"]\nclean = touch '${canary}'\nprocess = touch '${canary}'\n`)
    expect(await f.open()).toMatchObject({ gitAvailable: false, gitUnavailableReason: "external_filter_required" })
    await expect(access(canary)).rejects.toThrow()
    await writeFile(config, "[core]\nautocrlf = true\n")
    const scope = await f.open()
    const check = f.guard.check.bind(f.guard)
    vi.spyOn(f.guard, "check").mockImplementation(request => request.resource === config ? Promise.resolve({ allowed: false, reason: "fixture revoked exact config" }) : check(request))
    expect((await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" })).code).toBe("permission_denied")
    expect(f.service.facts().scopes).toBe(0)
    expect(f.audit.list().some(record => record.outcome === "denied")).toBe(true)
  }, 20_000)

  it("uses explicit attributes and raw equality while limiting only ambiguous system conversion or mode", async () => {
    const f = await fixture(true), target = path.join(f.root, "file.txt")
    await writeFile(target, "old\n"); await f.command("add", "."); await f.command("commit", "-qm", "base"); await f.command("config", "--unset", "core.autocrlf")
    await writeFile(target, "new\n")
    const scope = await f.open("repository")
    expect(dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes").entries).toHaveLength(1)
    await writeFile(target, "old\r\n")
    expect((await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" })).code).toBe("git_unavailable")
    for (const attribute of ["text", "text=auto", "eol=lf", "eol=crlf", "-text"]) {
      await writeFile(path.join(f.root, ".gitattributes"), `file.txt ${attribute}\n`)
      const changes = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
      expect(changes.entries.filter(entry => entry.relativePath === "file.txt")).toHaveLength(attribute === "-text" ? 1 : 0)
    }
    await rm(path.join(f.root, ".gitattributes")); await writeFile(target, "old\n"); await f.command("config", "--unset", "core.filemode")
    expect(dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes").entries).toEqual([])
    const executable = !!((await lstat(target)).mode & 0o100)
    await f.command("update-index", executable ? "--chmod=-x" : "--chmod=+x", "file.txt")
    expect((await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" })).code).toBe("git_unavailable")
  }, 30_000)

  it.each(["ident", "working-tree-encoding=UTF-16"])("limits unsupported built-in %s conversion after a clean same-content stat-miss rewrite", async attribute => {
    const f = await fixture(true), target = path.join(f.root, "file.txt")
    await writeFile(path.join(f.root, ".gitattributes"), `file.txt ${attribute}\n`)
    await writeFile(target, attribute === "ident" ? "$Id$\nbody\n" : Buffer.from("\ufeffbody\n", "utf16le"))
    await f.command("add", "."); await f.command("commit", "-qm", "base"); await rm(target); await f.command("checkout", "--", "file.txt")
    const original = await readFile(target), before = await lstat(target)
    if (attribute === "ident") {
      expect(original.toString("utf8")).toMatch(/\$Id: [a-f0-9]{40} \$/)
      expect(await f.command("show", "HEAD:file.txt")).toBe("$Id$\nbody\n")
    } else {
      expect(["fffe", "feff"]).toContain(original.subarray(0, 2).toString("hex"))
      expect(await f.command("show", "HEAD:file.txt")).toBe("body\n")
    }
    await writeFile(target, original); await utimes(target, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"))
    expect((await lstat(target)).mtimeMs).not.toBe(before.mtimeMs)
    expect(await readFile(target)).toEqual(original)
    expect((await f.command("--no-optional-locks", "status", "--porcelain")).trim()).toBe("")
    const scope = await f.open("repository"), result = await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" })
    expect(result, JSON.stringify(result)).toMatchObject({ outcome: "rejected", code: "git_unavailable" })
    expect(dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId }), "directory").entries.some(entry => entry.name === "file.txt")).toBe(true)
  }, 20_000)

  it.each(["ident", "working-tree-encoding=UTF-16"])("rechecks built-in %s conversion added after opening and before replaying a cached diff", async attribute => {
    const f = await fixture(true), target = path.join(f.root, "file.txt")
    await writeFile(target, "old\n"); await f.command("add", "."); await f.command("commit", "-qm", "base"); await writeFile(target, "new\n")
    const scope = await f.open("repository"), changes = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
    const change = changes.entries.find(entry => entry.relativePath === "file.txt")!
    const request = { ...base(), operation: "diff", ...f.scoped(scope), changeId: change.changeId, changeSetVersion: changes.changeSetVersion } as const
    expect(dataFor(await f.service.runIntent(owner, request), "diff").contentState).toBe("available")
    await writeFile(path.join(f.root, ".gitattributes"), `file.txt ${attribute}\n`)
    expect(await f.service.runIntent(owner, request)).toMatchObject({ outcome: "rejected", code: "git_unavailable" })
    expect(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" })).toMatchObject({ outcome: "rejected", code: "git_unavailable" })
    const directory = dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId }), "directory")
    const entry = directory.entries.find(value => value.name === "file.txt")!
    expect(dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target: { source: "disk", entryId: entry.entryId } }), "preview").lines.map(line => line.text)).toEqual(["new"])
  }, 20_000)

  it.each(["ident", "working-tree-encoding=UTF-16"])("rejects cached-only built-in %s conversion for both change ranges", async attribute => {
    const f = await fixture(true), name = attribute.split("=")[0]!
    await writeFile(path.join(f.root, "file.txt"), "body\n"); await f.command("add", "."); await f.command("commit", "-qm", "base")
    await writeFile(path.join(f.root, ".gitattributes"), `file.txt ${attribute}\n`); await f.command("add", ".gitattributes")
    await writeFile(path.join(f.root, ".gitattributes"), `file.txt -${name}\n`)
    expect((await f.command("check-attr", name, "--", "file.txt")).trim()).toBe(`file.txt: ${name}: unset`)
    expect((await f.command("check-attr", "--cached", name, "--", "file.txt")).trim()).toBe(`file.txt: ${name}: ${attribute === "ident" ? "set" : "UTF-16"}`)
    const scope = await f.open("repository")
    for (const changeRange of ["unstaged", "staged"] as const) expect(await f.call({ operation: "changes", ...f.scoped(scope), changeRange })).toMatchObject({ outcome: "rejected", code: "git_unavailable" })
    expect(dataFor(await f.call({ operation: "directory", ...f.scoped(scope), directoryEntryId: scope.rootEntryId }), "directory").entries.some(entry => entry.name === "file.txt")).toBe(true)
  }, 20_000)

  it("keeps inactive ident and working-tree-encoding attributes usable", async () => {
    const f = await fixture(true)
    await writeFile(path.join(f.root, "file.txt"), "old\n"); await f.command("add", "."); await f.command("commit", "-qm", "base"); await writeFile(path.join(f.root, "file.txt"), "new\n")
    const scope = await f.open("repository")
    for (const attribute of ["-ident", "!ident", "ident=ignored", "-working-tree-encoding", "!working-tree-encoding"]) {
      await writeFile(path.join(f.root, ".gitattributes"), `file.txt ${attribute}\n`)
      const changes = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
      expect(changes.entries.find(entry => entry.relativePath === "file.txt")).toMatchObject({ status: "modified", contentState: "available" })
    }
  }, 20_000)

  it.skipIf(process.platform === "win32")("matches native Git when only group or other execute permission changes", async () => {
    const f = await fixture(true), target = path.join(f.root, "file.txt")
    await f.command("config", "core.filemode", "true")
    await writeFile(target, "same\n"); await chmod(target, 0o644); await f.command("add", "."); await f.command("commit", "-qm", "base")
    const scope = await f.open("repository")
    for (const mode of [0o654, 0o645]) {
      await chmod(target, mode)
      expect((await f.command("--no-optional-locks", "diff", "--name-only")).trim()).toBe("")
      expect(dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes").entries).toEqual([])
    }
  }, 20_000)

  it("uses Git typed booleans for aliases, implicit values, and explicit empty strings", async () => {
    const cases = [["yes", "no"], ["on", "off"], ["1", "0"], [null, ""]] as const
    for (const [autoCrlf, fileMode] of cases) {
      const f = await fixture(true)
      if (autoCrlf === null) await writeFile(path.join(f.root, ".git", "config"), `${await readFile(path.join(f.root, ".git", "config"), "utf8")}\n[core]\n\tautocrlf\n\tfilemode = \n`)
      else { await f.command("config", "core.autocrlf", autoCrlf); await f.command("config", "core.filemode", fileMode) }
      expect((await f.command("config", "--type=bool", "--get", "core.autocrlf")).trim()).toBe("true")
      expect((await f.command("config", "--type=bool", "--get", "core.filemode")).trim()).toBe("false")
      await writeFile(path.join(f.root, "file.txt"), "unchanged\n"); await f.command("add", "."); await f.command("commit", "-qm", "base")
      await writeFile(path.join(f.root, "file.txt"), "unchanged\r\n"); await chmod(path.join(f.root, "file.txt"), 0o755)
      const scope = await f.open("repository"), changes = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
      expect(changes.entries).toEqual([]); expect((await f.command("diff", "--name-only")).trim()).toBe("")
    }
    const empty = await fixture(true)
    await empty.command("config", "core.autocrlf", "")
    expect((await empty.command("config", "--type=bool", "--get", "core.autocrlf")).trim()).toBe("false")
    await writeFile(path.join(empty.root, "file.txt"), "unchanged\n"); await empty.command("add", "."); await empty.command("commit", "-qm", "base"); await writeFile(path.join(empty.root, "file.txt"), "unchanged\r\n")
    const scope = await empty.open("repository"), changes = dataFor(await empty.call({ operation: "changes", ...empty.scoped(scope), changeRange: "unstaged" }), "changes")
    expect(changes.entries).toHaveLength(1); expect((await empty.command("diff", "--name-only")).trim()).toBe("file.txt")
  }, 30_000)

  it("matches local built-in CRLF rules without treating line endings as whole-file edits", async () => {
    for (const setting of ["autocrlf", "attributes"]) {
      const f = await fixture(true)
      if (setting === "autocrlf") await f.command("config", "core.autocrlf", "true")
      else await writeFile(path.join(f.root, ".gitattributes"), "file.txt text eol=crlf\n")
      await writeFile(path.join(f.root, "file.txt"), "unchanged\nold\n"); await f.command("add", "."); await f.command("commit", "-qm", "base")
      await writeFile(path.join(f.root, "file.txt"), "unchanged\r\nold\r\n")
      let scope = await f.open("repository")
      const clean = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
      expect(clean.entries).toEqual([]); expect((await f.command("diff", "--name-only")).trim()).toBe("")
      await writeFile(path.join(f.root, "file.txt"), "unchanged\r\nnew\r\n")
      scope = await f.open("repository")
      const changed = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
      const diff = dataFor(await f.call({ operation: "diff", ...f.scoped(scope), changeId: changed.entries[0]!.changeId, changeSetVersion: changed.changeSetVersion }), "diff")
      expect(diff.additions).toBe(1); expect(diff.deletions).toBe(1)
      expect(diff.hunks.flatMap(hunk => hunk.lines).find(line => line.text === "unchanged")?.kind).toBe("context")
    }
  }, 20_000)

  it("keeps staged and unstaged baselines distinct and leaves index/objects unchanged", async () => {
    const f = await fixture(true)
    await writeFile(path.join(f.root, "file.md"), "base\n"); await f.command("add", "."); await f.command("commit", "-qm", "base")
    await writeFile(path.join(f.root, "file.md"), "staged\n"); await f.command("add", "."); await writeFile(path.join(f.root, "file.md"), "working\n")
    const indexBefore = await readFile(path.join(f.root, ".git", "index")), objectsBefore = (await readdir(path.join(f.root, ".git", "objects"))).sort()
    const scope = await f.open("repository")
    const unstaged = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
    const staged = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "staged" }), "changes")
    expect(unstaged.entries).toHaveLength(1); expect(staged.entries).toHaveLength(1)
    expect(unstaged.entries[0]!.changeId).not.toBe(staged.entries[0]!.changeId)
    for (const [page, texts] of [[unstaged, ["staged", "working"]], [staged, ["base", "staged"]]] as const) {
      for (const [side, text] of [["before", texts[0]], ["after", texts[1]]] as const) {
        const preview = dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target: { source: "change", changeId: page.entries[0]!.changeId, changeSetVersion: page.changeSetVersion, side } }), "preview")
        expect(preview.lines.map(line => line.text)).toEqual([text])
      }
      const diff = dataFor(await f.call({ operation: "diff", ...f.scoped(scope), changeId: page.entries[0]!.changeId, changeSetVersion: page.changeSetVersion }), "diff")
      expect(diff.hunks.flatMap(hunk => hunk.lines).filter(line => line.kind === "addition").map(line => line.text)).toEqual([texts[1]])
    }
    expect(await readFile(path.join(f.root, ".git", "index"))).toEqual(indexBefore)
    expect((await readdir(path.join(f.root, ".git", "objects"))).sort()).toEqual(objectsBefore)
    expect(await access(path.join(f.root, ".git", "index.lock")).then(() => true, () => false)).toBe(false)
  }, 20_000)

  it("handles unborn HEAD, untracked, deletion, and staged-only content", async () => {
    const f = await fixture(true)
    await writeFile(path.join(f.root, "new.txt"), "new\n"); await f.command("add", ".")
    await writeFile(path.join(f.root, "untracked.txt"), "not counted until read\n")
    let scope = await f.open("repository")
    const staged = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "staged" }), "changes")
    expect(staged.entries[0]!.status).toBe("added")
    const empty = dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target: { source: "change", changeId: staged.entries[0]!.changeId, changeSetVersion: staged.changeSetVersion, side: "before" } }), "preview")
    expect(empty.contentState).toBe("absent")
    const unstaged = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
    expect(unstaged.entries[0]!.status).toBe("untracked"); expect(unstaged.ranges.unstaged.additions).toBeNull()
    await f.command("commit", "-qm", "first"); await rm(path.join(f.root, "new.txt")); await f.command("add", "new.txt")
    scope = await f.open("repository")
    const deleted = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "staged" }), "changes")
    expect(deleted.entries[0]!.status).toBe("deleted")
    const before = dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target: { source: "change", changeId: deleted.entries[0]!.changeId, changeSetVersion: deleted.changeSetVersion, side: "before" } }), "preview")
    expect(before.lines[0]!.text).toBe("new")
  }, 20_000)

  it("binds current-directory subtrees and cross-boundary renames never expose the other side", async () => {
    const f = await fixture(true)
    await mkdir(path.join(f.root, "inside")); await mkdir(path.join(f.root, "outside")); await writeFile(path.join(f.root, "outside", "private.txt"), "scope canary\n")
    await f.command("add", "."); await f.command("commit", "-qm", "base"); await f.command("mv", "outside/private.txt", "inside/new.txt")
    f.setCwd(path.join(f.root, "inside"))
    const scope = await f.open()
    const changes = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "staged" }), "changes")
    expect(changes.entries[0]!.relativePath).toBe("new.txt"); expect(changes.entries[0]!.oldRelativePath).toBeUndefined()
    expect(changes.entries[0]!.status).toBe("added")
    const diff = dataFor(await f.call({ operation: "diff", ...f.scoped(scope), changeId: changes.entries[0]!.changeId, changeSetVersion: changes.changeSetVersion }), "diff")
    expect(diff.hunks.flatMap(hunk => hunk.lines).every(line => line.kind === "addition")).toBe(true)
    const before = dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target: { source: "change", changeId: changes.entries[0]!.changeId, changeSetVersion: changes.changeSetVersion, side: "before" } }), "preview")
    expect(before.contentState).toBe("absent")
  })

  it("never executes a clean/process filter added after the change list", async () => {
    const f = await fixture(true)
    await writeFile(path.join(f.root, "file.txt"), "base\n"); await f.command("add", "."); await f.command("commit", "-qm", "base"); await writeFile(path.join(f.root, "file.txt"), "changed\n")
    const scope = await f.open("repository"), changes = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
    const canary = path.join(f.root, "filter-executed")
    await writeFile(path.join(f.root, ".gitattributes"), "file.txt filter=review\n")
    await f.command("config", "filter.review.clean", `touch '${canary}'; cat`)
    const result = await f.call({ operation: "diff", ...f.scoped(scope), changeId: changes.entries[0]!.changeId, changeSetVersion: changes.changeSetVersion })
    expect(result.outcome).toBe("rejected"); expect(["external_filter_required", "content_stale"]).toContain(result.code)
    expect(await access(canary).then(() => true, () => false)).toBe(false)
    expect((await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" })).code).toBe("external_filter_required")
  })

  it("allows a small before blob when the working-tree side exceeds the file limit", async () => {
    const f = await fixture(true)
    await writeFile(path.join(f.root, "file.txt"), "before\n"); await f.command("add", "."); await f.command("commit", "-qm", "base")
    await writeFile(path.join(f.root, "file.txt"), Buffer.alloc(2 * 1024 * 1024 + 1, 97))
    const scope = await f.open("repository"), changes = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
    const change = changes.entries[0]!
    expect(change).toMatchObject({ contentState: "limit_exceeded", canPreviewBefore: true, canPreviewAfter: false })
    const before = dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target: { source: "change", changeId: change.changeId, changeSetVersion: changes.changeSetVersion, side: "before" } }), "preview")
    expect(before.contentState).toBe("available"); expect(before.lines[0]!.text).toBe("before")
    const after = dataFor(await f.call({ operation: "preview", ...f.scoped(scope), target: { source: "change", changeId: change.changeId, changeSetVersion: changes.changeSetVersion, side: "after" } }), "preview")
    expect(after.contentState).toBe("limit_exceeded"); expect(after.lines).toEqual([])
  })

  it("rejects newline-heavy and JSON-expanding diff models before retaining them", async () => {
    const f = await fixture(true)
    await writeFile(path.join(f.root, "base.txt"), "base\n"); await f.command("add", "."); await f.command("commit", "-qm", "base")
    await writeFile(path.join(f.root, "newlines.txt"), "\n".repeat(256 * 1024))
    await writeFile(path.join(f.root, "escaped.txt"), Array.from({ length: 20_000 }, () => "\\".repeat(100)).join("\n"))
    const scope = await f.open("repository"), changes = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
    for (const change of changes.entries) {
      const result = dataFor(await f.call({ operation: "diff", ...f.scoped(scope), changeId: change.changeId, changeSetVersion: changes.changeSetVersion }), "diff")
      expect(result.contentState).toBe("limit_exceeded"); expect(result.hunks).toEqual([]); expect(result.statsComplete).toBe(false)
    }
    expect(f.service.facts().resultBytes).toBeLessThanOrEqual(2 * 1024 * 1024)
  })

  it("uses the actual linked worktree and reports conflicts without choosing a side", async () => {
    const f = await fixture(true)
    await writeFile(path.join(f.root, "file.txt"), "base\n"); await f.command("add", "."); await f.command("commit", "-qm", "base")
    const worktree = path.join(f.root, "linked")
    await f.command("worktree", "add", "-q", "-b", "linked-review", worktree)
    await writeFile(path.join(worktree, "file.txt"), "linked change\n")
    f.setCwd(worktree)
    const linkedScope = await f.open("repository")
    expect(linkedScope.rootDisplayName).toBe("linked")
    const linkedChanges = dataFor(await f.call({ operation: "changes", ...f.scoped(linkedScope), changeRange: "unstaged" }), "changes")
    expect(linkedChanges.entries[0]!.relativePath).toBe("file.txt")
    f.setCwd(f.root)
    await f.command("switch", "-qc", "conflict-side"); await writeFile(path.join(f.root, "file.txt"), "side\n"); await f.command("commit", "-qam", "side")
    await f.command("switch", "-q", "-"); await writeFile(path.join(f.root, "file.txt"), "main\n"); await f.command("commit", "-qam", "main")
    await expect(f.command("merge", "conflict-side")).rejects.toThrow()
    const scope = await f.open("repository"), changes = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
    const conflict = changes.entries.find(change => change.relativePath === "file.txt")!
    expect(conflict.contentState).toBe("conflict"); expect(conflict.canPreviewAfter).toBe(false)
    const diff = dataFor(await f.call({ operation: "diff", ...f.scoped(scope), changeId: conflict.changeId, changeSetVersion: changes.changeSetVersion }), "diff")
    expect(diff.contentState).toBe("conflict"); expect(diff.hunks).toEqual([])
  }, 20_000)

  it("reports a submodule pointer change without reading its workspace diff", async () => {
    const child = await fixture(true)
    await writeFile(path.join(child.root, "child.txt"), "base\n"); await child.command("add", "."); await child.command("commit", "-qm", "child-base")
    const original = (await child.command("rev-parse", "HEAD")).trim()
    const f = await fixture(true)
    await f.command("-c", "protocol.file.allow=always", "submodule", "add", "-q", child.root, "module"); await f.command("commit", "-qam", "submodule")
    await writeFile(path.join(child.root, "child.txt"), "new child\n"); await child.command("commit", "-qam", "child-new")
    const next = (await child.command("rev-parse", "HEAD")).trim()
    await execute("git", ["fetch", "-q", child.root], { cwd: path.join(f.root, "module") }); await execute("git", ["checkout", "-q", next], { cwd: path.join(f.root, "module") })
    const scope = await f.open("repository"), changes = dataFor(await f.call({ operation: "changes", ...f.scoped(scope), changeRange: "unstaged" }), "changes")
    const gitlink = changes.entries.find(change => change.relativePath === "module")!
    expect(gitlink).toMatchObject({ contentState: "gitlink", oldGitlink: original, newGitlink: next, canPreviewBefore: false, canPreviewAfter: false })
    expect(changes.entries.every(change => !change.relativePath.startsWith("module/"))).toBe(true)
  }, 20_000)
})
