import { MOBILE_WORKSPACE_FILES_LIMITS as L } from "@synapse/shared/mobile-live-constants"
import { randomUUID } from "node:crypto"
import { lstat, realpath } from "node:fs/promises"
import path from "node:path"
import type { MobileIntentResult, MobileWorkspaceFilesChangeRange, MobileWorkspaceFilesContentState, MobileWorkspaceFilesDiffHunk, MobileWorkspaceFilesEntry, MobileWorkspaceFilesIntent, MobileWorkspaceFilesPreviewLine, MobileWorkspaceFilesResult, MobileWorkspaceFilesScope } from "@synapse/shared" with { "resolution-mode": "import" }
import type { AuditSink, PermissionGuard, PermissionPolicy } from "../runtime/security"
import { formatTerminalPathReference } from "../../app-capabilities/terminal/shared/path-reference"
import { MOBILE_GATEWAY_ACTOR } from "./mobile-gateway/controller"
import { boundedLine, createMobileWorkspaceFilesGitAdapter, type MobileFilesGitChange, type MobileFilesGitContext, versionHash } from "./mobile-workspace-files-git"
import { canonicalRoot, checkedNode, decodeText, enumerateDirectory, fileIdentity, isWithinRoot, MobileWorkspaceFilesError, readDiskFile, safeRelativePath, textLines, throwIfAborted, utf8Bytes } from "./mobile-workspace-files-paths"
import { ensureGitWorktreeConfigurationEmpty, readGitMetadataSnapshot, type MobileFilesGitConfigurationLocations } from "./mobile-workspace-files-git-config"

export const MOBILE_WORKSPACE_FILES_SERVICE_ID = "core.mobile-workspace-files"
export interface MobileWorkspaceFilesOwner { accountUserId: string; desktopClientInstanceId: string; mobileClientInstanceId: string }
export interface MobileWorkspaceFilesSessionContext { cwd: string; shell: string }
type StoredEntry = { relative: string; kind: MobileWorkspaceFilesEntry["kind"]; touched: number }
type GitUnavailableReason = "not_git_repository" | "git_unavailable" | "external_filter_required" | "permission_denied" | "unsafe_path" | "limit_exceeded"
type SearchState = { queue: string[]; pending: Array<{ name: string; relativePath: string; kind: StoredEntry["kind"] }>; versions: Map<string, string>; scanned: number; matches: number; version: string; limited: boolean }
type CursorState = { id: string; operation: string; fingerprint: string; pageIndex: number; offset: number; version: string; touched: number; search?: SearchState; previewLineNumber?: number }
type Scope = {
  id: string; owner: MobileWorkspaceFilesOwner; ownerKey: string; sessionId: string; mode: "currentDirectory" | "repository"; cwd: string; root: string; rootIdentity: string; shell: string; token: string; rootEntryId: string; version: string; touched: number; creatorIntentId: string
  resources: Set<string>; entries: Map<string, StoredEntry>; entryIds: Map<string, string>; cursors: Map<string, CursorState>; git: MobileFilesGitContext | null
  gitBinding?: string
  gitUnavailableReason?: GitUnavailableReason
  changes?: Awaited<ReturnType<ReturnType<typeof createMobileWorkspaceFilesGitAdapter>["collect"]>>
}
type Task = { key: string; ownerKey: string; owner: MobileWorkspaceFilesOwner; sessionId: string; intentId: string; fingerprint: string; operation: string; scopeId?: string; controller: AbortController; promise: Promise<MobileIntentResult>; completed: boolean; touched: number; cancelled: boolean; creatorScopeId?: string; resultContextVersion?: string; queued?: boolean }
type Cache = { result: MobileIntentResult; bytes: number; ownerKey: string; scopeId?: string; touched: number; fingerprint: string }
const errorMessages: Record<string, string> = {
  invalid_request: "请求无效", invalid_scope: "文件范围已关闭", invalid_cursor: "分页请求无效", request_conflict: "请求内容已改变", permission_denied: "电脑未允许读取此范围", unsafe_path: "此路径无法安全读取", special_file: "不支持此文件类型", not_git_repository: "此范围不是 Git 仓库", git_unavailable: "此仓库无法安全读取", scope_stale: "终端目录已改变，请重新打开", content_stale: "内容已改变，请刷新", cursor_expired: "分页已过期，请刷新", session_ended: "终端会话已结束", binary: "二进制文件", unsupported_encoding: "不支持此文本编码", external_filter_required: "此仓库使用外部文件转换器", unsupported_platform: "此路径无法安全插入", absent: "此侧没有文件", gitlink: "子模块指针", limit_exceeded: "内容超出读取上限", busy: "电脑繁忙，请重试", deadline_exceeded: "读取超时，请重试", cancelled: "读取已取消",
}
const phoneKey = (owner: MobileWorkspaceFilesOwner) => JSON.stringify([owner.accountUserId, owner.desktopClientInstanceId, owner.mobileClientInstanceId])
const taskKey = (owner: MobileWorkspaceFilesOwner, sessionId: string, id: string) => JSON.stringify([phoneKey(owner), sessionId, id])
function stableIntentJSON(value: unknown): string {
  // JSON object key order is a transport detail, including nested preview targets.
  // Preserve array order and normal JSON omission/null semantics.
  return JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : item)
}
const cursorFingerprint = (intent: MobileWorkspaceFilesIntent): string => {
  const { intentId: _id, ...rest } = intent
  const shape = { ...rest } as Record<string, unknown>
  delete shape.cursor; delete shape.expectedContentVersion
  return versionHash(stableIntentJSON(shape))
}

export function createMobileWorkspaceFilesService(deps: {
  permissionGuard: PermissionGuard; auditSink: AuditSink
  resolveSessionContext(sessionId: string): Promise<MobileWorkspaceFilesSessionContext | null>
  platform?: NodeJS.Platform; now?: () => number
  gitConfigurationLocations?: MobileFilesGitConfigurationLocations
}) {
  const now = deps.now ?? (() => performance.now())
  const scopes = new Map<string, Scope>()
  const grants = new Map<string, { ownerKey: string; resources: Set<string> }>()
  const tasks = new Map<string, Task>()
  const cancelledOpens = new Map<string, { ownerKey: string; touched: number }>()
  const closed = new Map<string, { ownerKey: string; sessionId: string; touched: number }>()
  const cache = new Map<string, Cache>()
  const queue: Array<{ task: Task; execute(): Promise<void>; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; priority: number }> = []
  const activeOwners = new Map<string, number>()
  let active = 0
  let disposed = false
  const permissionPolicy: PermissionPolicy = {
    id: "mobile-workspace-files-scoped-read",
    decide(request) {
      if (request.actor.kind !== "agent" || request.actor.id !== MOBILE_GATEWAY_ACTOR.id || request.context.source !== "mobile-workspace-files") return "defer-to-next"
      const token = request.context.authorizationToken
      const grant = typeof token === "string" ? grants.get(token) : undefined
      if (!grant) return "deny"
      if (request.action === "shell.exec") return request.resource === "git" ? "allow" : "deny"
      if (request.action === "fs.read.outside-userdata") return grant.resources.has(request.resource) ? "allow" : "deny"
      return "defer-to-next"
    },
  }

  const unregisterPolicy = deps.permissionGuard.registerPolicy(permissionPolicy)

  function accepted(intent: MobileWorkspaceFilesIntent, scope: Scope | undefined, data: MobileWorkspaceFilesResult["data"], outcome: "accepted" | "no_op" = "accepted"): MobileIntentResult {
    return { intentId: intent.intentId, outcome, sessionId: intent.sessionId, workspaceFiles: {
      filesVersion: 1, operation: intent.operation, sessionId: intent.sessionId, ...(scope ? { scopeId: scope.id, contextVersion: scope.version } : "scopeId" in intent ? { scopeId: intent.scopeId } : {}), readAt: new Date().toISOString(), data,
    } as MobileWorkspaceFilesResult }
  }
  function failed(intent: MobileWorkspaceFilesIntent, error: unknown): MobileIntentResult {
    const code = error instanceof MobileWorkspaceFilesError ? error.code : "relay_failed"
    return { intentId: intent.intentId, sessionId: intent.sessionId, outcome: "rejected", code, message: errorMessages[code] ?? "读取失败，请重试" }
  }
  async function authorize(token: string, resource: string, sessionId: string): Promise<void> {
    const decision = await deps.permissionGuard.check({ action: "fs.read.outside-userdata", actor: MOBILE_GATEWAY_ACTOR, resource, context: { source: "mobile-workspace-files", authorizationToken: token, sessionId } })
    deps.auditSink.record({ action: "fs.read.outside-userdata", actor: MOBILE_GATEWAY_ACTOR, resource: `mobile-files:${versionHash(resource).slice(0, 24)}`, outcome: decision.allowed ? "allowed" : "denied", metadata: { source: "mobile-workspace-files", sessionId } })
    if (!decision.allowed) throw new MobileWorkspaceFilesError("permission_denied")
  }
  function adapter(scope: Pick<Scope, "token" | "resources" | "sessionId">) {
    return createMobileWorkspaceFilesGitAdapter({ async authorizeMetadata(target) {
      const canonical = await realpath(target)
      scope.resources.add(canonical)
      await authorize(scope.token, canonical, scope.sessionId)
    }, gitConfigurationLocations: deps.gitConfigurationLocations, async authorizeConfiguration(target) {
      scope.resources.add(target)
      try { await authorize(scope.token, target, scope.sessionId) }
      catch (error) {
        const owned = [...scopes.values()].find(value => value.token === scope.token)
        if (owned) dropScope(owned)
        throw error
      }
    } })
  }
  function description(scope: Scope): MobileWorkspaceFilesScope {
    return { scopeId: scope.id, rootEntryId: scope.rootEntryId, scopeMode: scope.mode, rootDisplayName: path.basename(scope.root) || scope.root, contextVersion: scope.version, expiresAt: new Date(Date.now() + L.scopeIdleMs).toISOString(), gitAvailable: scope.git !== null, ...(!scope.git ? { gitUnavailableReason: scope.gitUnavailableReason ?? "not_git_repository" } : {}) }
  }
  function dropScope(scope: Scope): number {
    scopes.delete(scope.id); grants.delete(scope.token)
    scope.entries.clear(); scope.entryIds.clear(); scope.cursors.clear(); scope.changes = undefined
    for (const [key, result] of cache) if (result.scopeId === scope.id) cache.delete(key)
    let pending = 0
    for (const task of tasks.values()) if (!task.completed && (task.scopeId === scope.id || task.creatorScopeId === scope.id)) { task.cancelled = true; task.controller.abort(); pending++ }
    closed.set(scope.id, { ownerKey: scope.ownerKey, sessionId: scope.sessionId, touched: now() })
    trimControlRecords(scope.ownerKey)
    return pending
  }
  function sweep(): void {
    const time = now()
    for (const scope of scopes.values()) if (time - scope.touched > L.scopeIdleMs) dropScope(scope)
    for (const [key, task] of tasks) if (task.completed && time - task.touched > L.controlTtlMs) tasks.delete(key)
    for (const [key, value] of cancelledOpens) if (time - value.touched > L.controlTtlMs) cancelledOpens.delete(key)
    for (const [key, value] of closed) if (time - value.touched > L.controlTtlMs) closed.delete(key)
    for (const [key, value] of cache) if (time - value.touched > L.resultTtlMs) cache.delete(key)
    for (const scope of scopes.values()) for (const [key, value] of scope.cursors) if (time - value.touched > L.cursorIdleMs) scope.cursors.delete(key)
  }
  function reserveControl(ownerKey: string): void {
    sweep()
    const records = [...tasks.values()].map(task => ({ ownerKey: task.ownerKey, touched: task.touched, active: !task.completed, key: task.key, map: tasks })), total = records.length + closed.size + cancelledOpens.size
    const ownCount = records.filter(item => item.ownerKey === ownerKey).length + [...closed.values(), ...cancelledOpens.values()].filter(item => item.ownerKey === ownerKey).length
    if (total >= L.maxControls - 2 || ownCount >= L.maxControlsPerMobile - 2 || controlBytes() > L.maxControlBytes - 4096) throw new MobileWorkspaceFilesError("busy")
  }
  function controlBytes(): number {
    return utf8Bytes({ tasks: [...tasks.values()].map(({ controller: _controller, promise: _promise, ...record }) => record), closed: [...closed], cancelled: [...cancelledOpens] })
  }
  function trimControlRecords(ownerKey: string): void {
    const ownCount = () => [...tasks.values(), ...closed.values(), ...cancelledOpens.values()].filter(value => value.ownerKey === ownerKey).length
    while (tasks.size + closed.size + cancelledOpens.size > L.maxControls || ownCount() > L.maxControlsPerMobile || controlBytes() > L.maxControlBytes) {
      const candidate = [...tasks.values()].filter(task => task.completed && (ownCount() <= L.maxControlsPerMobile || task.ownerKey === ownerKey)).sort((a, b) => a.touched - b.touched)[0]
      if (candidate) { tasks.delete(candidate.key); continue }
      const prior = [...closed].filter(([, value]) => ownCount() <= L.maxControlsPerMobile || value.ownerKey === ownerKey).sort((a, b) => a[1].touched - b[1].touched)[0]
      if (prior) { closed.delete(prior[0]); continue }
      break // Never evict an executing/open cancellation protector.
    }
  }
  function scopeMetadataBytes(scope: Scope): number {
    return utf8Bytes({ id: scope.id, owner: scope.owner, root: scope.root, cwd: scope.cwd, resources: [...scope.resources], entryIds: [...scope.entryIds], entries: [...scope.entries.entries()] }) + utf8Bytes([...scope.cursors.values()].map(cursor => ({ ...cursor, search: cursor.search ? { ...cursor.search, versions: [...cursor.search.versions] } : undefined }))) + (scope.changes ? utf8Bytes(scope.changes) : 0)
  }
  function trimMetadata(scope: Scope): void {
    while (scope.entries.size + (scope.changes ? scope.changes.byRange.staged.length + scope.changes.byRange.unstaged.length : 0) > L.maxHandlesPerScope || scope.cursors.size > L.maxCursorsPerScope || scopeMetadataBytes(scope) > L.maxScopeMetadataBytes) {
      const cursor = [...scope.cursors.values()].sort((a, b) => a.touched - b.touched)[0]
      if (cursor) { scope.cursors.delete(cursor.id); continue }
      const entry = [...scope.entries.entries()].filter(([id]) => id !== scope.rootEntryId).sort((a, b) => a[1].touched - b[1].touched)[0]
      if (entry) { scope.entries.delete(entry[0]); scope.entryIds.delete(entry[1].relative); continue }
      scope.changes = undefined
      break
    }
    while ([...scopes.values()].reduce((sum, value) => sum + value.entries.size + (value.changes ? value.changes.byRange.unstaged.length + value.changes.byRange.staged.length : 0), 0) > L.maxHandles || [...scopes.values()].reduce((sum, value) => sum + value.cursors.size, 0) > L.maxCursors || [...scopes.values()].reduce((sum, value) => sum + scopeMetadataBytes(value), 0) > L.maxMetadataBytes) {
      const oldest = [...scopes.values()].filter(value => value.id !== scope.id).sort((a, b) => a.touched - b.touched)[0]
      if (!oldest) throw new MobileWorkspaceFilesError("limit_exceeded")
      dropScope(oldest)
    }
  }
  function entry(scope: Scope, relative: string, kind: StoredEntry["kind"]): MobileWorkspaceFilesEntry {
    if (kind !== "special") safeRelativePath(relative)
    const id = scope.entryIds.get(relative) ?? randomUUID()
    scope.entryIds.set(relative, id)
    scope.entries.set(id, { relative, kind, touched: now() })
    return { entryId: id, name: path.basename(relative), relativePath: relative.split(path.sep).join("/"), kind, metadata: { sizeBytes: null, modifiedAt: null }, canPreview: kind === "file", canReference: kind === "file" || kind === "directory", ...(kind === "symlink" || kind === "special" ? { unavailableReason: "special_file" as const } : {}) }
  }
  function requireEntry(scope: Scope, id: string): StoredEntry {
    const value = scope.entries.get(id)
    if (!value) throw new MobileWorkspaceFilesError("content_stale")
    value.touched = now(); return value
  }
  function getScope(owner: MobileWorkspaceFilesOwner, intent: MobileWorkspaceFilesIntent & { scopeId: string }): Scope {
    const scope = scopes.get(intent.scopeId)
    if (!scope || scope.ownerKey !== phoneKey(owner) || scope.sessionId !== intent.sessionId) throw new MobileWorkspaceFilesError("invalid_scope")
    scope.touched = now(); return scope
  }
  async function validate(scope: Scope, intent: MobileWorkspaceFilesIntent, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    if (!scopes.has(scope.id) || !grants.has(scope.token)) throw new MobileWorkspaceFilesError("invalid_scope")
    if ("expectedContextVersion" in intent && intent.expectedContextVersion !== scope.version) throw new MobileWorkspaceFilesError("scope_stale")
    const context = await deps.resolveSessionContext(scope.sessionId)
    if (!context) { dropScope(scope); throw new MobileWorkspaceFilesError("session_ended") }
    const current = await canonicalRoot(context.cwd)
    const root = await canonicalRoot(scope.root)
    if (current.path !== scope.cwd || root.identity !== scope.rootIdentity || context.shell !== scope.shell) throw new MobileWorkspaceFilesError("scope_stale")
    await authorize(scope.token, scope.root, scope.sessionId)
    if (scope.git) {
      await authorize(scope.token, scope.git.gitDir, scope.sessionId)
      if (scope.git.commonDir !== scope.git.gitDir) await authorize(scope.token, scope.git.commonDir, scope.sessionId)
      if (scope.gitBinding !== await gitBinding(scope.git)) throw new MobileWorkspaceFilesError("scope_stale")
    }
    if (scope.git && scope.changes && (intent.operation === "diff" || (intent.operation === "preview" && intent.target.source === "change") || intent.operation === "changes" && intent.cursor)) {
      const expected = intent.operation === "diff" ? intent.changeSetVersion : intent.operation === "preview" && intent.target.source === "change" ? intent.target.changeSetVersion : scope.changes.changeSetVersion
      const actual = await adapter(scope).fingerprint(scope.git, [...scope.changes.byRange.unstaged, ...scope.changes.byRange.staged], scope.root, scope.token, signal)
      if (expected !== scope.changes.changeSetVersion || actual !== scope.changes.changeSetVersion) throw new MobileWorkspaceFilesError("content_stale")
    }
  }
  async function gitBinding(context: MobileFilesGitContext): Promise<string> {
    const values: string[] = []
    for (const target of [...new Set([context.gitDir, context.commonDir])]) {
      const node = await canonicalRoot(target)
      if (node.path !== target) throw new MobileWorkspaceFilesError("scope_stale")
      values.push(node.identity)
    }
    const pointer = await checkedNode(context.root, ".git")
    values.push(pointer.kind === "directory" ? `${pointer.stats.dev}:${pointer.stats.ino}` : pointer.identity)
    return versionHash(values.join("|"))
  }
  async function discoverAuthorization(cwd: string, token: string, resources: Set<string>, sessionId: string, signal: AbortSignal) {
    const authorizeMetadata = async (resource: string) => {
      resources.add(resource); await authorize(token, resource, sessionId)
    }
    const readMetadata = (target: string, maxBytes: number) => readGitMetadataSnapshot(target, authorizeMetadata, signal, maxBytes)
    let ancestor = cwd
    while (true) {
      throwIfAborted(signal)
      const candidate = path.join(ancestor, ".git")
      resources.add(candidate)
      await authorize(token, candidate, sessionId)
      try {
        const stats = await lstat(candidate)
        if (stats.isSymbolicLink()) throw new MobileWorkspaceFilesError("unsafe_path")
        let gitDir = candidate
        if (stats.isFile()) {
          if (stats.size > L.maxPathBytes) throw new MobileWorkspaceFilesError("unsafe_path")
          const snapshot = await readMetadata(candidate, L.maxPathBytes)
          if (!snapshot) throw new MobileWorkspaceFilesError("content_stale")
          const value = snapshot.text.trim()
          if (!value.startsWith("gitdir: ") || /[\r\n\0]/.test(value)) throw new MobileWorkspaceFilesError("unsafe_path")
          gitDir = await realpath(path.resolve(ancestor, value.slice(8)))
          resources.add(gitDir); await authorize(token, gitDir, sessionId)
        } else if (!stats.isDirectory()) throw new MobileWorkspaceFilesError("unsafe_path")
        await ensureGitWorktreeConfigurationEmpty(gitDir, authorizeMetadata, signal)
        try {
          const config = await readMetadata(path.join(gitDir, "config"), L.maxGitStderrBytes)
          if (config && /^\s*\[\s*include(?:If)?(?:\s|\])/im.test(config.text)) throw new MobileWorkspaceFilesError("git_unavailable")
        } catch (error) { if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error }
        const commonPath = path.join(gitDir, "commondir")
        try {
          const common = await readMetadata(commonPath, L.maxPathBytes)
          if (common) {
            const commonDir = await realpath(path.resolve(gitDir, common.text.trim()))
            resources.add(commonDir); await authorize(token, commonDir, sessionId)
            const commonConfig = await readMetadata(path.join(commonDir, "config"), L.maxGitStderrBytes)
            if (commonConfig && /^\s*\[\s*include(?:If)?(?:\s|\])/im.test(commonConfig.text)) throw new MobileWorkspaceFilesError("git_unavailable")
          }
        } catch (error) { if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error }
        break
      } catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error
      }
      const parent = path.dirname(ancestor)
      if (parent === ancestor) break
      ancestor = parent
    }
  }
  async function openScope(owner: MobileWorkspaceFilesOwner, intent: Extract<MobileWorkspaceFilesIntent, { operation: "open" }>, task: Task): Promise<MobileIntentResult> {
    const context = await deps.resolveSessionContext(intent.sessionId)
    if (!context) throw new MobileWorkspaceFilesError("session_ended")
    if (cancelledOpens.has(task.key) || task.cancelled) throw new MobileWorkspaceFilesError("cancelled")
    const token = randomUUID(), resources = new Set([context.cwd])
    grants.set(token, { ownerKey: phoneKey(owner), resources })
    try {
      await authorize(token, context.cwd, intent.sessionId)
      const cwd = await canonicalRoot(context.cwd)
      resources.add(cwd.path)
      await authorize(token, cwd.path, intent.sessionId)
      let git: MobileFilesGitContext | null = null
      let gitUnavailableReason: GitUnavailableReason | undefined
      try {
        await discoverAuthorization(cwd.path, token, resources, intent.sessionId, task.controller.signal)
        git = await adapter({ token, resources, sessionId: intent.sessionId }).discover(cwd.path, token, task.controller.signal)
      } catch (error) {
        if (intent.scopeMode === "repository" || task.controller.signal.aborted || !(error instanceof MobileWorkspaceFilesError) || !["git_unavailable", "external_filter_required", "permission_denied", "unsafe_path", "limit_exceeded", "deadline_exceeded"].includes(error.code)) throw error
        gitUnavailableReason = error.code === "deadline_exceeded" ? "git_unavailable" : error.code as GitUnavailableReason
      }
      if (intent.scopeMode === "repository" && !git) throw new MobileWorkspaceFilesError("not_git_repository")
      const root = await canonicalRoot(intent.scopeMode === "repository" && git ? git.root : cwd.path)
      resources.add(root.path); await authorize(token, root.path, intent.sessionId)
      const after = await deps.resolveSessionContext(intent.sessionId)
      if (!after || (await canonicalRoot(after.cwd)).path !== cwd.path) throw new MobileWorkspaceFilesError("scope_stale")
      throwIfAborted(task.controller.signal)
      if (cancelledOpens.has(task.key) || task.cancelled) throw new MobileWorkspaceFilesError("cancelled")
      const ownerKey = phoneKey(owner)
      for (const old of scopes.values()) if (old.ownerKey === ownerKey) dropScope(old)
      if (scopes.size >= L.maxScopes) throw new MobileWorkspaceFilesError("busy")
      const scope: Scope = { id: randomUUID(), owner, ownerKey, sessionId: intent.sessionId, mode: intent.scopeMode, cwd: cwd.path, root: root.path, rootIdentity: root.identity, shell: context.shell, token, resources, rootEntryId: randomUUID(), version: randomUUID(), touched: now(), creatorIntentId: intent.intentId, entries: new Map(), entryIds: new Map(), cursors: new Map(), git, ...(!git ? { gitUnavailableReason: gitUnavailableReason ?? "not_git_repository" } : {}) }
      if (git) scope.gitBinding = await gitBinding(git)
      throwIfAborted(task.controller.signal)
      if (!grants.has(token)) throw new MobileWorkspaceFilesError("permission_denied")
      scope.entries.set(scope.rootEntryId, { relative: "", kind: "directory", touched: now() }); scope.entryIds.set("", scope.rootEntryId)
      scopes.set(scope.id, scope); task.creatorScopeId = scope.id
      return accepted(intent, scope, description(scope))
    } catch (error) { grants.delete(token); throw error }
  }
  function cursor(scope: Scope, intent: MobileWorkspaceFilesIntent & { cursor?: string }, version: string): CursorState | undefined {
    if (!intent.cursor) return undefined
    const value = scope.cursors.get(intent.cursor)
    if (!value) throw new MobileWorkspaceFilesError("cursor_expired")
    if (value.operation !== intent.operation || value.fingerprint !== cursorFingerprint(intent)) throw new MobileWorkspaceFilesError("invalid_cursor")
    if (value.version !== version) throw new MobileWorkspaceFilesError("content_stale")
    value.touched = now(); return value
  }
  function nextCursor(scope: Scope, intent: MobileWorkspaceFilesIntent, offset: number, pageIndex: number, version: string, search?: SearchState, previewLineNumber?: number): string {
    const value: CursorState = { id: randomUUID(), operation: intent.operation, fingerprint: cursorFingerprint(intent), offset, pageIndex: pageIndex + 1, version, touched: now(), ...(search ? { search } : {}), ...(previewLineNumber !== undefined ? { previewLineNumber } : {}) }
    scope.cursors.set(value.id, value); trimMetadata(scope)
    if (!scope.cursors.has(value.id)) throw new MobileWorkspaceFilesError("limit_exceeded")
    return value.id
  }
  function takePage<T>(items: readonly T[], offset: number, overhead: unknown): { entries: T[]; end: number } {
    const entries: T[] = []
    let bytes = utf8Bytes(overhead) + 2048
    for (let index = offset; index < items.length && entries.length < L.maxPageEntries; index++) {
      const item = items[index]
      const size = utf8Bytes(item)
      if (bytes + size > L.maxPageDisplayBytes) break
      entries.push(item as T); bytes += size
    }
    if (!entries.length && offset < items.length) throw new MobileWorkspaceFilesError("limit_exceeded")
    return { entries, end: offset + entries.length }
  }
  async function directory(scope: Scope, intent: Extract<MobileWorkspaceFilesIntent, { operation: "directory" }>, signal: AbortSignal) {
    const target = requireEntry(scope, intent.directoryEntryId)
    if (target.kind !== "directory") throw new MobileWorkspaceFilesError("unsafe_path")
    const listed = await enumerateDirectory(scope.root, target.relative, signal)
    const version = versionHash(listed.version)
    const prior = cursor(scope, intent, version)
    const start = prior?.offset ?? 0
    const candidates = listed.entries.slice(start, start + L.maxPageEntries).map(value => entry(scope, value.relativePath, value.kind))
    const page = takePage(candidates, 0, {})
    const end = start + page.entries.length
    const next = end < listed.entries.length ? nextCursor(scope, intent, end, prior?.pageIndex ?? 0, version) : null
    trimMetadata(scope)
    return accepted(intent, scope, { directoryVersion: version, entries: page.entries, collectionComplete: true, pageIndex: prior?.pageIndex ?? 0, nextCursor: next, completion: next ? "partial" : "complete" })
  }
  async function search(scope: Scope, intent: Extract<MobileWorkspaceFilesIntent, { operation: "search" }>, signal: AbortSignal) {
    const prior = intent.cursor ? scope.cursors.get(intent.cursor) : undefined
    if (intent.cursor && !prior) throw new MobileWorkspaceFilesError("cursor_expired")
    if (prior && (prior.operation !== "search" || prior.fingerprint !== cursorFingerprint(intent))) throw new MobileWorkspaceFilesError("invalid_cursor")
    const state: SearchState = prior?.search ? { ...prior.search, queue: [...prior.search.queue], pending: [...prior.search.pending], versions: new Map(prior.search.versions) } : { queue: [""], pending: [], versions: new Map(), scanned: 0, matches: 0, version: randomUUID(), limited: false }
    const started = performance.now()
    for (const [relative, expected] of state.versions) {
      if (fileIdentity((await checkedNode(scope.root, relative)).stats) !== expected) throw new MobileWorkspaceFilesError("content_stale")
      if (performance.now() - started > L.searchRequestMs) throw new MobileWorkspaceFilesError("limit_exceeded")
    }
    const entries: MobileWorkspaceFilesEntry[] = []
    let visited = 0
    while (entries.length < L.maxPageEntries && visited < L.maxSearchRequestEntries && performance.now() - started <= L.searchRequestMs && (state.pending.length || state.queue.length)) {
      throwIfAborted(signal)
      if (!state.pending.length) {
        const relative = state.queue.shift() as string
        const listed = await enumerateDirectory(scope.root, relative, signal)
        state.versions.set(relative, listed.version); state.pending.push(...listed.entries)
        if (utf8Bytes({ ...state, versions: [...state.versions] }) >= L.maxSearchStateBytes) { state.limited = true; break }
      }
      const candidate = state.pending.shift()
      if (!candidate) continue
      visited++; state.scanned++
      if (candidate.kind === "directory") state.queue.push(candidate.relativePath)
      if (candidate.relativePath.toLocaleLowerCase().includes(intent.query.toLocaleLowerCase())) {
        const value = entry(scope, candidate.relativePath, candidate.kind)
        if (utf8Bytes([...entries, value]) > L.maxPageDisplayBytes - 4096) { state.pending.unshift(candidate); state.scanned--; visited--; break }
        entries.push(value); state.matches++
      }
      if (state.scanned >= L.maxSearchEntries || state.matches >= L.maxSearchMatches || (visited % 256 === 0 && utf8Bytes({ ...state, versions: [...state.versions] }) >= L.maxSearchStateBytes)) { state.limited = true; break }
      if (visited % 256 === 0) await new Promise<void>(resolve => setImmediate(resolve))
    }
    const scanComplete = !state.pending.length && !state.queue.length && !state.limited
    const next = !scanComplete && !state.limited ? nextCursor(scope, intent, 0, prior?.pageIndex ?? 0, state.version, state) : null
    return accepted(intent, scope, { searchVersion: state.version, entries, scanComplete, scannedEntries: state.scanned, collectionComplete: scanComplete, pageIndex: prior?.pageIndex ?? 0, nextCursor: next, completion: state.limited ? "truncated" : next ? "partial" : "complete", ...(state.limited ? { truncatedReason: "limit_exceeded" } : {}) })
  }
  async function changes(scope: Scope, intent: Extract<MobileWorkspaceFilesIntent, { operation: "changes" }>, signal: AbortSignal) {
    if (!scope.git) throw new MobileWorkspaceFilesError("not_git_repository")
    if (!intent.cursor) {
      scope.changes = await adapter(scope).collect(scope.git, scope.root, scope.token, signal)
      for (const [key, value] of cache) if (value.scopeId === scope.id) cache.delete(key)
    }
    const snapshot = scope.changes
    if (!snapshot) throw new MobileWorkspaceFilesError("content_stale")
    const prior = cursor(scope, intent, snapshot.changeSetVersion)
    const rows = snapshot.byRange[intent.changeRange].map(value => value.entry)
    const page = takePage(rows, prior?.offset ?? 0, snapshot.ranges)
    const next = page.end < rows.length ? nextCursor(scope, intent, page.end, prior?.pageIndex ?? 0, snapshot.changeSetVersion) : null
    trimMetadata(scope)
    return accepted(intent, scope, { changeSetVersion: snapshot.changeSetVersion, changeRange: intent.changeRange, ranges: snapshot.ranges, entries: page.entries, collectionComplete: true, statsComplete: snapshot.ranges[intent.changeRange].statsComplete, pageIndex: prior?.pageIndex ?? 0, nextCursor: next, completion: next ? "partial" : "complete" })
  }
  function requireChange(scope: Scope, changeId: string, expected: string): MobileFilesGitChange {
    if (!scope.changes || scope.changes.changeSetVersion !== expected) throw new MobileWorkspaceFilesError("content_stale")
    const change = [...scope.changes.byRange.unstaged, ...scope.changes.byRange.staged].find(value => value.entry.changeId === changeId)
    if (!change) throw new MobileWorkspaceFilesError("content_stale")
    return change
  }
  async function preview(scope: Scope, intent: Extract<MobileWorkspaceFilesIntent, { operation: "preview" }>, signal: AbortSignal) {
    const target = intent.target
    let relative: string, bytes: Buffer = Buffer.alloc(0), version: string, state: MobileWorkspaceFilesContentState = "available", size: number | null = null, modified: string | null = null
    if (target.source === "disk") {
      const node = requireEntry(scope, target.entryId); relative = node.relative
      const current = await checkedNode(scope.root, relative)
      version = versionHash(current.identity); size = current.stats.size; modified = current.stats.mtime.toISOString()
      try { bytes = (await readDiskFile(scope.root, relative, signal)).bytes }
      catch (error) { if (error instanceof MobileWorkspaceFilesError && isContentState(error.code)) state = error.code; else throw error }
    } else {
      const change = requireChange(scope, target.changeId, target.changeSetVersion); relative = change.relativePath
      version = versionHash(`${target.changeSetVersion}:${target.changeId}:${target.side}`)
      try {
        if (!scope.git) throw new MobileWorkspaceFilesError("not_git_repository")
        const side = await adapter(scope).side(scope.git, scope.root, change, target.side, scope.token, signal)
        bytes = side.bytes; size = bytes.length
        if (side.absent) state = "absent"
      } catch (error) { if (error instanceof MobileWorkspaceFilesError && isContentState(error.code)) state = error.code; else throw error }
    }
    if (intent.expectedContentVersion && intent.expectedContentVersion !== version) throw new MobileWorkspaceFilesError("content_stale")
    const prior = cursor(scope, intent, version)
    let lines: MobileWorkspaceFilesPreviewLine[] = []
    if (state === "available") {
      try {
        const text = decodeText(bytes)
        let displayBytes = 2048, end = prior?.offset ?? 0, lineNumber = prior?.previewLineNumber ?? 1
        for (const scanned of textLines(text, end)) {
          throwIfAborted(signal)
          const line = { lineNumber, ...boundedLine(scanned.text) }
          const lineBytes = utf8Bytes(line)
          if (displayBytes + lineBytes > L.maxPageDisplayBytes - 2048) break
          lines.push(line); displayBytes += lineBytes; end = scanned.next; lineNumber++
          if (lines.length % 256 === 0) await new Promise<void>(resolve => setImmediate(resolve))
        }
        const next = end < text.length ? nextCursor(scope, intent, end, prior?.pageIndex ?? 0, version, undefined, lineNumber) : null
        return accepted(intent, scope, { contentVersion: version, source: target.source, ...(target.source === "change" ? { side: target.side } : {}), name: path.basename(relative), relativePath: relative.split(path.sep).join("/"), metadata: { sizeBytes: size, modifiedAt: modified }, contentState: state, lines, contentComplete: next === null, format: /\.(md|markdown)$/i.test(relative) ? "markdown" : "text", pageIndex: prior?.pageIndex ?? 0, nextCursor: next, completion: next ? "partial" : "complete" })
      } catch (error) { if (error instanceof MobileWorkspaceFilesError && isContentState(error.code)) state = error.code; else throw error }
    }
    lines = []
    return accepted(intent, scope, { contentVersion: version, source: target.source, ...(target.source === "change" ? { side: target.side } : {}), name: path.basename(relative), relativePath: relative.split(path.sep).join("/"), metadata: { sizeBytes: size, modifiedAt: modified }, contentState: state, lines, contentComplete: true, format: "text", pageIndex: 0, nextCursor: null, completion: "complete" })
  }
  async function diff(scope: Scope, intent: Extract<MobileWorkspaceFilesIntent, { operation: "diff" }>, signal: AbortSignal) {
    const change = requireChange(scope, intent.changeId, intent.changeSetVersion)
    const version = versionHash(`${intent.changeSetVersion}:${intent.changeId}:diff`)
    if (intent.expectedContentVersion && intent.expectedContentVersion !== version) throw new MobileWorkspaceFilesError("content_stale")
    const prior = cursor(scope, intent, version)
    let all: MobileWorkspaceFilesDiffHunk[] = [], state: MobileWorkspaceFilesContentState = change.entry.contentState
    try { if (state === "available" && scope.git) all = await adapter(scope).diff(scope.git, scope.root, change, scope.token, signal) }
    catch (error) { if (error instanceof MobileWorkspaceFilesError && isContentState(error.code)) state = error.code; else throw error }
    const totalLines = all.reduce((sum, hunk) => sum + hunk.lines.length, 0)
    const hunks: MobileWorkspaceFilesDiffHunk[] = []
    let skipped = 0, consumed = 0, displayBytes = 2048
    for (const hunk of all) {
      if (skipped + hunk.lines.length <= (prior?.offset ?? 0)) { skipped += hunk.lines.length; continue }
      const start = Math.max(0, (prior?.offset ?? 0) - skipped)
      const lines: Array<MobileWorkspaceFilesDiffHunk["lines"][number]> = []
      for (let index = start; index < hunk.lines.length; index++) {
        const line = hunk.lines[index]
        if (displayBytes + utf8Bytes(line) > L.maxPageDisplayBytes - 4096) break
        lines.push(line as MobileWorkspaceFilesDiffHunk["lines"][number]); displayBytes += utf8Bytes(line); consumed++
      }
      if (lines.length) { const projected = { ...hunk, lines, lineOffset: start, continued: start > 0 }; hunks.push(projected); displayBytes += utf8Bytes({ ...projected, lines: [] }) }
      if (lines.length < hunk.lines.length - start) break
      skipped += hunk.lines.length
    }
    const end = (prior?.offset ?? 0) + consumed
    const next = end < totalLines ? nextCursor(scope, intent, end, prior?.pageIndex ?? 0, version) : null
    const additions = all.reduce((sum, hunk) => sum + hunk.lines.filter(line => line.kind === "addition").length, 0)
    const deletions = all.reduce((sum, hunk) => sum + hunk.lines.filter(line => line.kind === "deletion").length, 0)
    return accepted(intent, scope, { contentVersion: version, changeId: intent.changeId, contentState: state, hunks, additions: state === "available" ? additions : null, deletions: state === "available" ? deletions : null, statsComplete: state === "available", contentComplete: next === null, pageIndex: prior?.pageIndex ?? 0, nextCursor: next, completion: next ? "partial" : "complete" })
  }
  function isContentState(code: string): code is MobileWorkspaceFilesContentState {
    return ["binary", "unsupported_encoding", "external_filter_required", "unsupported_platform", "absent", "gitlink", "conflict", "type_change", "limit_exceeded", "special_file"].includes(code)
  }
  async function read(owner: MobileWorkspaceFilesOwner, intent: MobileWorkspaceFilesIntent, task: Task): Promise<MobileIntentResult> {
    if (intent.operation === "open") return openScope(owner, intent, task)
    if (intent.operation === "cancel" || intent.operation === "close") throw new MobileWorkspaceFilesError("invalid_request")
    const scope = getScope(owner, intent)
    await validate(scope, intent, task.controller.signal)
    const remembered = cache.get(task.key)
    if (remembered) {
      if (remembered.fingerprint !== task.fingerprint) throw new MobileWorkspaceFilesError("request_conflict")
      // A cache entry is merely a response. Revalidate disk/directory/search facts before replay.
      const data = remembered.result.workspaceFiles
      if (intent.operation === "directory" && data?.operation === "directory") {
        const target = requireEntry(scope, intent.directoryEntryId)
        if (versionHash((await checkedNode(scope.root, target.relative)).identity) !== data.data.directoryVersion) throw new MobileWorkspaceFilesError("content_stale")
      }
      if (intent.operation === "preview" && intent.target.source === "disk" && data?.operation === "preview") {
        const target = requireEntry(scope, intent.target.entryId)
        if (versionHash((await checkedNode(scope.root, target.relative)).identity) !== data.data.contentVersion) throw new MobileWorkspaceFilesError("content_stale")
      }
      if (intent.operation !== "search" && intent.operation !== "changes" && intent.operation !== "reference") { remembered.touched = now(); return remembered.result }
    }
    let result: MobileIntentResult
    switch (intent.operation) {
      case "refresh":
        scope.version = randomUUID(); scope.entries.clear(); scope.entryIds.clear(); scope.entries.set(scope.rootEntryId, { relative: "", kind: "directory", touched: now() }); scope.entryIds.set("", scope.rootEntryId); scope.cursors.clear(); scope.changes = undefined
        for (const [key, value] of cache) if (value.scopeId === scope.id) cache.delete(key)
        result = accepted(intent, scope, description(scope)); break
      case "directory": result = await directory(scope, intent, task.controller.signal); break
      case "search": result = await search(scope, intent, task.controller.signal); break
      case "changes": result = await changes(scope, intent, task.controller.signal); break
      case "preview": result = await preview(scope, intent, task.controller.signal); break
      case "diff": result = await diff(scope, intent, task.controller.signal); break
      case "reference": {
        const target = requireEntry(scope, intent.entryId)
        const node = await checkedNode(scope.root, target.relative)
        if (node.kind !== "file" && node.kind !== "directory") throw new MobileWorkspaceFilesError("special_file")
        let referenceText: string
        try { referenceText = formatTerminalPathReference(node.path, deps.platform ?? process.platform, scope.shell) }
        catch (error) { throw new MobileWorkspaceFilesError(error instanceof Error ? error.message : "unsupported_platform") }
        if (utf8Bytes(referenceText) > L.maxReferenceBytes) throw new MobileWorkspaceFilesError("limit_exceeded")
        const after = await checkedNode(scope.root, target.relative)
        if (after.identity !== node.identity || after.ancestors.join("|") !== node.ancestors.join("|")) throw new MobileWorkspaceFilesError("content_stale")
        result = accepted(intent, scope, { referenceText, contextVersion: scope.version }); break
      }
    }
    await validate(scope, intent.operation === "refresh" ? { ...intent, expectedContextVersion: scope.version } : intent, task.controller.signal)
    return result
  }
  async function control(owner: MobileWorkspaceFilesOwner, intent: Extract<MobileWorkspaceFilesIntent, { operation: "cancel" | "close" }>): Promise<MobileIntentResult> {
    const ownerKey = phoneKey(owner)
    if (intent.operation === "close") {
      const scope = scopes.get(intent.scopeId)
      if (!scope) {
        const prior = closed.get(intent.scopeId)
        if (!prior || prior.ownerKey !== ownerKey || prior.sessionId !== intent.sessionId) throw new MobileWorkspaceFilesError("invalid_scope")
        return accepted(intent, undefined, { status: "alreadyClosed", pendingCancellationCount: 0 }, "no_op")
      }
      if (scope.ownerKey !== ownerKey || scope.sessionId !== intent.sessionId) throw new MobileWorkspaceFilesError("invalid_scope")
      const count = dropScope(scope)
      return accepted(intent, undefined, { status: "closed", pendingCancellationCount: count })
    }
    const target = tasks.get(taskKey(owner, intent.sessionId, intent.targetIntentId))
    if (!target) {
      const created = [...scopes.values()].find(scope => scope.ownerKey === ownerKey && scope.sessionId === intent.sessionId && scope.creatorIntentId === intent.targetIntentId)
      if (created) { dropScope(created); return accepted(intent, undefined, { status: "alreadyCompleted", closedScopeId: created.id }, "no_op") }
      reserveControl(ownerKey)
      cancelledOpens.set(taskKey(owner, intent.sessionId, intent.targetIntentId), { ownerKey, touched: now() })
      return accepted(intent, undefined, { status: "notFound" }, "no_op")
    }
    if (target.operation !== "open" && (!intent.scopeId || target.scopeId !== intent.scopeId)) throw new MobileWorkspaceFilesError("invalid_scope")
    target.cancelled = true
    target.controller.abort()
    drain()
    let closedScopeId: string | undefined
    if (target.creatorScopeId) {
      const scope = scopes.get(target.creatorScopeId)
      if (scope) { dropScope(scope); closedScopeId = scope.id }
    }
    if (target.completed) return accepted(intent, undefined, { status: "alreadyCompleted", ...(closedScopeId ? { closedScopeId } : {}) }, "no_op")
    const finished = await Promise.race([target.promise.then(() => true), new Promise<boolean>(resolve => { const timer = setTimeout(() => resolve(false), L.queueTimeoutMs); timer.unref?.() })])
    if (!finished) throw new MobileWorkspaceFilesError("deadline_exceeded")
    return accepted(intent, undefined, { status: "cancelled" })
  }
  function drain(): void {
    queue.sort((a, b) => a.priority - b.priority)
    for (let index = 0; index < queue.length && active < L.maxReads;) {
      const value = queue[index]
      if (!value) break
      if (value.task.controller.signal.aborted) { queue.splice(index, 1); clearTimeout(value.timer); value.reject(new MobileWorkspaceFilesError("cancelled")); continue }
      const own = activeOwners.get(value.task.ownerKey) ?? 0
      if (own >= L.maxReadsPerMobile) { index++; continue }
      queue.splice(index, 1); clearTimeout(value.timer); value.task.queued = false
      active++; activeOwners.set(value.task.ownerKey, own + 1)
      void value.execute().finally(() => { active--; activeOwners.set(value.task.ownerKey, (activeOwners.get(value.task.ownerKey) ?? 1) - 1); drain() })
    }
  }
  function scheduled<T>(task: Task, work: () => Promise<T>): Promise<T> {
    if (queue.length >= L.maxQueuedReads || queue.filter(value => value.task.ownerKey === task.ownerKey).length >= L.maxQueuedReadsPerMobile) return Promise.reject(new MobileWorkspaceFilesError("busy"))
    return new Promise<T>((resolve, reject) => {
      const value = { task, execute: async () => { try { resolve(await work()) } catch (error) { reject(error) } }, reject, priority: task.operation === "preview" || task.operation === "diff" ? 0 : task.operation === "search" ? 2 : 1, timer: setTimeout(() => { const index = queue.indexOf(value); if (index >= 0) queue.splice(index, 1); reject(new MobileWorkspaceFilesError("busy")); drain() }, L.queueTimeoutMs) }
      task.queued = true; queue.push(value); drain()
    })
  }
  function remember(task: Task, result: MobileIntentResult): void {
    if (result.outcome === "rejected" || task.operation === "open" || task.operation === "refresh" || task.operation === "cancel" || task.operation === "close") return
    const bytes = utf8Bytes(result)
    if (bytes > L.maxEnvelopeBytes - 2048) throw new MobileWorkspaceFilesError("limit_exceeded")
    cache.set(task.key, { result, bytes, ownerKey: task.ownerKey, scopeId: task.scopeId, touched: now(), fingerprint: task.fingerprint })
    function tooLarge(): boolean { const all = [...cache.values()], own = all.filter(value => value.ownerKey === task.ownerKey); return all.length > L.maxResults || own.length > L.maxResultsPerMobile || all.reduce((sum, value) => sum + value.bytes, 0) > L.maxResultBytes || own.reduce((sum, value) => sum + value.bytes, 0) > L.maxResultBytesPerMobile }
    while (tooLarge()) { const oldest = [...cache.entries()].sort((a, b) => a[1].touched - b[1].touched)[0]; if (!oldest) break; cache.delete(oldest[0]) }
  }
  async function runIntent(owner: MobileWorkspaceFilesOwner, intent: MobileWorkspaceFilesIntent): Promise<MobileIntentResult> {
    owner = { ...owner }
    if (disposed || !owner.accountUserId || !owner.desktopClientInstanceId || !owner.mobileClientInstanceId) return failed(intent, new MobileWorkspaceFilesError("permission_denied"))
    sweep()
    const key = taskKey(owner, intent.sessionId, intent.intentId), fingerprint = versionHash(stableIntentJSON(intent)), existing = tasks.get(key)
    if (existing && existing.fingerprint !== fingerprint) return failed(intent, new MobileWorkspaceFilesError("request_conflict"))
    if (existing && !existing.completed) return existing.promise
    if (existing && (intent.operation === "cancel" || intent.operation === "close")) return existing.promise
    if (existing && intent.operation === "open") {
      const scope = existing.creatorScopeId ? scopes.get(existing.creatorScopeId) : undefined
      if (!scope) return failed(intent, new MobileWorkspaceFilesError("invalid_scope"))
      try { await validate(scope, intent, new AbortController().signal); return accepted(intent, scope, description(scope)) }
      catch (error) { return failed(intent, error) }
    }
    if (existing && intent.operation === "refresh") {
      try {
        const scope = getScope(owner, intent)
        if (!existing.resultContextVersion || existing.resultContextVersion !== scope.version) throw new MobileWorkspaceFilesError("scope_stale")
        await validate(scope, { ...intent, expectedContextVersion: existing.resultContextVersion }, new AbortController().signal)
        return accepted(intent, scope, description(scope))
      } catch (error) { return failed(intent, error) }
    }
    try { if (!existing) reserveControl(phoneKey(owner)) }
    catch (error) { return failed(intent, error) }
    let resolveTask!: (value: MobileIntentResult) => void
    const task: Task = { key, ownerKey: phoneKey(owner), owner, sessionId: intent.sessionId, intentId: intent.intentId, fingerprint, operation: intent.operation, ...("scopeId" in intent ? { scopeId: intent.scopeId } : {}), controller: new AbortController(), promise: new Promise(resolve => { resolveTask = resolve }), completed: false, touched: now(), cancelled: false }
    tasks.set(key, task)
    const timer = setTimeout(() => task.controller.abort(), L.requestTimeoutMs)
    void (async () => {
      let result: MobileIntentResult
      try {
        result = intent.operation === "cancel" || intent.operation === "close" ? await control(owner, intent) : await scheduled(task, () => read(owner, intent, task))
        if (task.controller.signal.aborted && intent.operation !== "cancel" && intent.operation !== "close") throw new MobileWorkspaceFilesError(task.cancelled ? "cancelled" : "deadline_exceeded")
        remember(task, result)
      } catch (error) { result = failed(intent, error) }
      clearTimeout(timer); task.completed = true; task.touched = now(); task.resultContextVersion = result.workspaceFiles?.contextVersion
      deps.auditSink.record({ action: "fs.read.outside-userdata", actor: MOBILE_GATEWAY_ACTOR, resource: `mobile-files:${task.scopeId ?? task.creatorScopeId ?? versionHash(task.sessionId).slice(0, 24)}`, outcome: result.outcome === "rejected" ? "failed" : "allowed", metadata: { source: "mobile-workspace-files", operation: task.operation, sessionId: task.sessionId, code: result.code } })
      resolveTask(result)
      // Tombstones retain association only; resolved source pages live solely in the bounded cache.
      if (task.operation !== "cancel" && task.operation !== "close") task.promise = Promise.resolve(failed(intent, new MobileWorkspaceFilesError("content_stale")))
    })()
    return task.promise
  }
  function cleanupOwner(match: Partial<MobileWorkspaceFilesOwner>): void {
    const matches = (owner: MobileWorkspaceFilesOwner) => Object.entries(match).every(([key, value]) => owner[key as keyof MobileWorkspaceFilesOwner] === value)
    for (const scope of scopes.values()) if (matches(scope.owner)) dropScope(scope)
    for (const task of tasks.values()) if (matches(task.owner)) { task.cancelled = true; task.controller.abort(); if (task.completed) tasks.delete(task.key) }
    for (const [key, value] of cache) { const task = tasks.get(key); if (!task || matches(task.owner)) cache.delete(key) }
    drain()
  }
  function cleanupSession(sessionId: string): void {
    for (const scope of scopes.values()) if (scope.sessionId === sessionId) dropScope(scope)
    for (const task of tasks.values()) if (task.sessionId === sessionId) { task.cancelled = true; task.controller.abort() }
    drain()
  }
  const releaseRevocation = deps.permissionGuard.onRevoked?.(() => {
    for (const scope of scopes.values()) dropScope(scope)
    // Open has a temporary grant before its Scope exists. Revoke it and its
    // in-flight task too, so a late cwd/Git response cannot recreate access.
    grants.clear(); cache.clear()
    for (const task of tasks.values()) if (!task.completed) { task.cancelled = true; task.controller.abort() }
    drain()
  })
  const sweepTimer = setInterval(sweep, Math.min(L.controlTtlMs, L.cursorIdleMs))
  sweepTimer.unref()
  return { permissionPolicy, runIntent, cleanupOwner, cleanupSession, dispose() { disposed = true; clearInterval(sweepTimer); cleanupOwner({}); releaseRevocation?.(); unregisterPolicy(); grants.clear(); cache.clear(); closed.clear(); cancelledOpens.clear() }, facts() { sweep(); return { scopes: scopes.size, handles: [...scopes.values()].reduce((sum, scope) => sum + scope.entries.size + (scope.changes ? scope.changes.byRange.staged.length + scope.changes.byRange.unstaged.length : 0), 0), cursors: [...scopes.values()].reduce((sum, scope) => sum + scope.cursors.size, 0), metadataBytes: [...scopes.values()].reduce((sum, scope) => sum + scopeMetadataBytes(scope), 0), resultBytes: [...cache.values()].reduce((sum, value) => sum + value.bytes, 0), resultCount: cache.size, controlCount: tasks.size + closed.size + cancelledOpens.size, activeReads: active, queuedReads: queue.length, watchers: 0 } } }
}
export type MobileWorkspaceFilesService = ReturnType<typeof createMobileWorkspaceFilesService>
