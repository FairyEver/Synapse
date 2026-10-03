import { MOBILE_WORKSPACE_FILES_LIMITS as L } from "@synapse/shared/mobile-live-constants"
import { createHash } from "node:crypto"
import { lstat, opendir, realpath } from "node:fs/promises"
import path from "node:path"
import { structuredPatch } from "diff"
import type { MobileWorkspaceFilesChange, MobileWorkspaceFilesChangeRange, MobileWorkspaceFilesContentState, MobileWorkspaceFilesDiffHunk, MobileWorkspaceFilesStatistics } from "@synapse/shared" with { "resolution-mode": "import" }
import { createGitClientCommandRunner } from "./git-client/git-command-runner"
import { MOBILE_READ_ONLY_CONFIG_QUERY } from "./git-command"
import { readGitConfigurationSnapshot, readGitMetadataSnapshot, standardGitConfigurationLocations, standardGitConfigurationPaths, type MobileFilesGitConfigurationLocations } from "./mobile-workspace-files-git-config"
import { checkedNode, decodeText, fileIdentity, isWithinRoot, MobileWorkspaceFilesError, readDiskFile, safeRelativePath, textLines, throwIfAborted, utf8Bytes } from "./mobile-workspace-files-paths"

export const versionHash = (value: string): string => createHash("sha256").update(value).digest("hex")
export interface MobileFilesGitContext { root: string; gitDir: string; commonDir: string }
export interface MobileFilesGitChange {
  entry: MobileWorkspaceFilesChange; oldOid: string | null; newOid: string | null; oldMode: string; newMode: string
  relativePath: string; oldRelativePath?: string; diskVersion: string | null
}
type Command = ReturnType<typeof createGitClientCommandRunner>
export function createMobileWorkspaceFilesGitAdapter(deps: {
  authorizeMetadata(target: string): Promise<void>
  authorizeConfiguration(target: string): Promise<void>
  gitConfigurationLocations?: MobileFilesGitConfigurationLocations
  commandRunner?: Command
}) {
  const runner = deps.commandRunner ?? createGitClientCommandRunner()
  const configurationLocations = deps.gitConfigurationLocations ?? standardGitConfigurationLocations()
  async function ensureAlternatesSafe(context: MobileFilesGitContext, signal: AbortSignal): Promise<void> {
    for (const base of [...new Set([context.gitDir, context.commonDir])]) {
      for (const name of ["objects/info/alternates", "objects/info/http-alternates"]) {
        const snapshot = await readGitMetadataSnapshot(path.join(base, name), deps.authorizeConfiguration, signal, L.maxPathBytes)
        if (snapshot && snapshot.sizeBytes !== 0) throw new MobileWorkspaceFilesError("git_unavailable")
      }
    }
  }
  async function run(location: string | MobileFilesGitContext, args: string[], token: string, signal: AbortSignal, extra: { acceptedExitCodes?: number[]; readOnlyAttributePaths?: string[]; readOnlyConfigSnapshot?: string; captureStdout?: boolean; onStdoutChunk?: (chunk: Uint8Array) => void; maxBufferBytes?: number } = {}) {
    throwIfAborted(signal)
    const context = typeof location === "string" ? undefined : location
    const cwd = typeof location === "string" ? location : location.root
    // Only version/root discovery lacks a metadata context. Recheck on each
    // subsequent native command, including the gaps between cat-file readers.
    if (context) await ensureAlternatesSafe(context, signal)
    let result
    try {
      result = await runner.run({ cwd, args, readOnlyIsolation: { authorizationToken: token }, abortSignal: signal, logFailure: false, timeoutMs: L.gitTimeoutMs, maxBufferBytes: L.maxGitStdoutBytes, ...extra })
    } catch (error) {
      if (signal.aborted) throw new MobileWorkspaceFilesError("cancelled")
      if (error instanceof Error && /timed? out|超时/.test(error.message)) throw new MobileWorkspaceFilesError("deadline_exceeded")
      if (error instanceof Error && /output exceeded/.test(error.message)) throw new MobileWorkspaceFilesError("limit_exceeded")
      throw new MobileWorkspaceFilesError("git_unavailable")
    }
    // Fail before returning source derived while metadata changed. These checks
    // do not make Git's own filesystem reads atomic against system-level races.
    if (context) await ensureAlternatesSafe(context, signal)
    return result
  }

  async function configuration(context: MobileFilesGitContext, token: string, signal: AbortSignal) {
    const snapshots = []
    for (const target of [...standardGitConfigurationPaths(configurationLocations), path.join(context.commonDir, "config")]) {
      try { snapshots.push(await readGitConfigurationSnapshot(target, deps.authorizeConfiguration, signal)) }
      catch (error) { if (error instanceof MobileWorkspaceFilesError) throw error; throw new MobileWorkspaceFilesError("git_unavailable") }
    }
    const command = ["config", "--file", "-", "--no-includes"]
    const values = new Map<string, string | null>()
    let settingsVersion = ""
    for (const snapshot of snapshots) {
      if (!snapshot.text) continue
      const settings = await run(context, [...command, "--null", "--get-regexp", MOBILE_READ_ONLY_CONFIG_QUERY], token, signal, { readOnlyConfigSnapshot: snapshot.text, acceptedExitCodes: [0, 1], maxBufferBytes: L.maxGitStderrBytes })
      settingsVersion += settings.stdout
      for (const item of settings.stdout.split("\0").filter(Boolean)) {
        const separator = item.indexOf("\n"), key = (separator < 0 ? item : item.slice(0, separator)).toLowerCase()
        if (/^include(?:if)?\./.test(key) || key === "core.attributesfile") throw new MobileWorkspaceFilesError("git_unavailable")
        if (/^filter\..*\.(clean|process)$/.test(key)) throw new MobileWorkspaceFilesError("external_filter_required")
        if (key === "core.autocrlf" || key === "core.filemode") values.set(key, separator < 0 ? null : item.slice(separator + 1))
      }
    }
    // Each source is parsed independently. Only these inert values reach the typed parser;
    // concatenating original files could turn an EOF continuation into a different value.
    const quote = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\x08/g, "\\b")
    const text = "[core]\n" + [...values].map(([key, value]) => `${key.slice(5)}${value === null ? "" : ` = "${quote(value)}"`}\n`).join("")
    if (utf8Bytes(text) > L.maxGitStderrBytes) throw new MobileWorkspaceFilesError("limit_exceeded")
    const extra = { readOnlyConfigSnapshot: text, acceptedExitCodes: [0, 1], maxBufferBytes: L.maxGitStderrBytes }
    const auto = await run(context, [...command, "--get", "core.autocrlf"], token, signal, extra)
    const autoInput = auto.stdout.replace(/\r?\n$/, "").toLowerCase() === "input"
    const autoBoolean = autoInput ? undefined : await run(context, [...command, "--type=bool", "--get", "core.autocrlf"], token, signal, extra)
    const fileMode = await run(context, [...command, "--type=bool", "--get", "core.filemode"], token, signal, extra)
    const autoCrlf = autoInput ? "input" : autoBoolean?.stdout.trim() === "true" ? "true" : autoBoolean?.stdout.trim() === "false" ? "false" : undefined
    const fileModeValue = fileMode.stdout.trim() === "true" ? true : fileMode.stdout.trim() === "false" ? false : undefined
    return { autoCrlf, fileMode: fileModeValue, version: versionHash(`${snapshots.map(snapshot => snapshot.version).join("|")}|${settingsVersion}|${auto.stdout}|${autoBoolean?.stdout}|${fileMode.stdout}`) }
  }

  async function discover(cwd: string, token: string, signal: AbortSignal): Promise<MobileFilesGitContext | null> {
    const version = await run(cwd, ["--version"], token, signal, { maxBufferBytes: L.maxGitStderrBytes })
    const parts = version.stdout.match(/git version (\d+)\.(\d+)/)
    // GIT_NO_LAZY_FETCH is required; an older Git cannot safely read missing promisor objects.
    if (!parts || Number(parts[1]) < 2 || (Number(parts[1]) === 2 && Number(parts[2]) < 45)) throw new MobileWorkspaceFilesError("git_unavailable")
    const detected = await run(cwd, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"], token, signal, { acceptedExitCodes: [0, 128], maxBufferBytes: L.maxGitStderrBytes })
    if (!detected.stdout.trim()) return null
    const paths = detected.stdout.trim().split("\n")
    if (paths.length !== 3 || paths.some(value => !path.isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value))) throw new MobileWorkspaceFilesError("unsafe_path")
    const [root, gitDir, commonDir] = await Promise.all(paths.map(value => realpath(value)))
    if (!root || !gitDir || !commonDir || !isWithinRoot(root, cwd)) throw new MobileWorkspaceFilesError("unsafe_path")
    await deps.authorizeMetadata(gitDir)
    if (commonDir !== gitDir) await deps.authorizeMetadata(commonDir)
    const context = { root, gitDir, commonDir }
    // Local includes/alternates can read beyond the authorized Git metadata. Fail closed.
    const config = await run(context, ["config", "--local", "--no-includes", "--get-regexp", "^(include\\.|includeif\\.|extensions\\.partialclone|extensions\\.worktreeconfig)"], token, signal, { acceptedExitCodes: [0, 1], maxBufferBytes: L.maxGitStderrBytes })
    if (config.stdout.trim()) throw new MobileWorkspaceFilesError("git_unavailable")
    await configuration(context, token, signal)
    return context
  }

  async function preflight(context: MobileFilesGitContext, scopeRoot: string, token: string, signal: AbortSignal) {
    await ensureMetadataSafe(context, signal)
    const includes = await run(context, ["config", "--local", "--no-includes", "--get-regexp", "^(include\\.|includeif\\.|extensions\\.partialclone|extensions\\.worktreeconfig)"], token, signal, { acceptedExitCodes: [0, 1], maxBufferBytes: L.maxGitStderrBytes })
    if (includes.stdout.trim()) throw new MobileWorkspaceFilesError("git_unavailable")
    const filters = await run(context, ["config", "--local", "--no-includes", "--get-regexp", "^filter\\..*\\.(clean|process)$"], token, signal, { acceptedExitCodes: [0, 1], maxBufferBytes: L.maxGitStderrBytes })
    if (filters.stdout.trim()) throw new MobileWorkspaceFilesError("external_filter_required")
    const relative = path.relative(context.root, scopeRoot).split(path.sep).join("/") || "."
    const listed = await run(context, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", relative], token, signal)
    const paths = [...new Set(listed.stdout.split("\0").filter(Boolean))]
    if (paths.length > L.maxHandlesPerScope || utf8Bytes(paths) > L.maxFileSideBytes) throw new MobileWorkspaceFilesError("limit_exceeded")
    for (const item of paths) {
      const resolved = path.resolve(context.root, safeRelativePath(item.endsWith("/") ? item.slice(0, -1) : item))
      if (!isWithinRoot(scopeRoot, resolved)) throw new MobileWorkspaceFilesError("unsafe_path")
    }
    const attributeVersions: string[] = []
    const attributes = new Map<string, Map<string, string>>()
    if (paths.length) {
      for (const cached of [false, true]) {
        const attrs = await run(context, ["check-attr", ...(cached ? ["--cached"] : []), "-z", "--stdin", "filter", "text", "eol", "ident", "working-tree-encoding", "diff"], token, signal, { readOnlyAttributePaths: paths })
        const values = attrs.stdout.split("\0")
        attributeVersions.push(attrs.stdout)
        for (let i = 2; i < values.length; i += 3) {
          if (values[i - 1] === "filter" && values[i] !== "unspecified" && values[i] !== "unset") throw new MobileWorkspaceFilesError("external_filter_required")
          if ((values[i - 1] === "ident" && values[i] === "set") || (values[i - 1] === "working-tree-encoding" && values[i] !== "unspecified" && values[i] !== "unset")) throw new MobileWorkspaceFilesError("git_unavailable")
          if (!cached) {
            const relativePath = projectPath(context.root, scopeRoot, values[i - 2] ?? "")
            if (relativePath) {
              const facts = attributes.get(relativePath) ?? new Map<string, string>()
              facts.set(values[i - 1] ?? "", values[i] ?? "unspecified"); attributes.set(relativePath, facts)
            }
          }
        }
      }
    }
    const builtins = await configuration(context, token, signal)
    return { relative, attributes, ...builtins, version: versionHash(`${listed.stdout}|${includes.stdout}|${filters.stdout}|${attributeVersions.join("|")}|${builtins.version}`) }
  }

  async function readIndex(context: MobileFilesGitContext, scopeRoot: string, token: string, signal: AbortSignal) {
    const relative = path.relative(context.root, scopeRoot).split(path.sep).join("/") || "."
    const index = await run(context, ["ls-files", "--stage", "--debug", "-z", "--", relative], token, signal)
    const untracked = await run(context, ["ls-files", "--others", "--exclude-standard", "-z", "--", relative], token, signal)
    const entries = parseIndexDebug(index.stdout, context.root, scopeRoot)
    const others = untracked.stdout.split("\0").filter(Boolean).map(value => projectPath(context.root, scopeRoot, value)).filter((value): value is string => value !== null)
    if (entries.length + others.length > L.maxHandlesPerScope) throw new MobileWorkspaceFilesError("limit_exceeded")
    return { entries, others, wireVersion: versionHash(index.stdout + "|" + untracked.stdout) }
  }

  async function gitlinkHead(scopeRoot: string, relative: string, token: string, signal: AbortSignal): Promise<string | null> {
    const node = await checkedNode(scopeRoot, relative)
    if (node.kind !== "directory") return null
    let marker
    try { marker = await checkedNode(scopeRoot, path.join(relative, ".git")) }
    catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null; throw error }
    let gitDir = marker.path
    if (marker.kind === "file") {
      if (marker.stats.size > L.maxPathBytes) throw new MobileWorkspaceFilesError("unsafe_path")
      const snapshot = await readGitMetadataSnapshot(marker.path, deps.authorizeConfiguration, signal, L.maxPathBytes)
      if (!snapshot) throw new MobileWorkspaceFilesError("content_stale")
      const text = snapshot.text.trim()
      if (!text.startsWith("gitdir: ") || /[\r\n\0]/.test(text)) throw new MobileWorkspaceFilesError("unsafe_path")
      gitDir = await realpath(path.resolve(node.path, text.slice(8)))
    } else if (marker.kind !== "directory") throw new MobileWorkspaceFilesError("unsafe_path")
    await deps.authorizeMetadata(gitDir)
    let commonDir = gitDir
    try {
      const common = await readGitMetadataSnapshot(path.join(gitDir, "commondir"), deps.authorizeConfiguration, signal, L.maxPathBytes)
      if (common) {
        commonDir = await realpath(path.resolve(gitDir, common.text.trim()))
        await deps.authorizeMetadata(commonDir)
      }
    } catch (error) { if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error }
    const child = { root: node.path, gitDir, commonDir }
    await ensureMetadataSafe(child, signal)
    for (const base of [...new Set([gitDir, commonDir])]) {
      try {
        const config = await readGitMetadataSnapshot(path.join(base, "config"), deps.authorizeConfiguration, signal, L.maxGitStderrBytes)
        if (config && /^\s*\[\s*include(?:If)?(?:\s|\])/im.test(config.text)) throw new MobileWorkspaceFilesError("git_unavailable")
      } catch (error) { if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error }
    }
    const head = (await run(child, ["rev-parse", "--verify", "HEAD"], token, signal, { acceptedExitCodes: [0, 128], maxBufferBytes: L.maxGitStderrBytes })).stdout.trim()
    return /^[a-f0-9]{40,64}$/.test(head) ? head : null
  }

  async function fingerprint(context: MobileFilesGitContext, _changes: readonly MobileFilesGitChange[], scopeRoot: string, token: string, signal: AbortSignal, expectedPreflightVersion?: string): Promise<string> {
    const attributes = await preflight(context, scopeRoot, token, signal)
    if (expectedPreflightVersion !== undefined && attributes.version !== expectedPreflightVersion) throw new MobileWorkspaceFilesError("content_stale")
    const head = await run(context, ["rev-parse", "--verify", "HEAD"], token, signal, { acceptedExitCodes: [0, 128], maxBufferBytes: L.maxGitStderrBytes })
    const index = await readIndex(context, scopeRoot, token, signal)
    const hash = createHash("sha256").update(head.stdout).update(index.wireVersion).update(attributes.version)
    const gitlinks = new Set(index.entries.filter(entry => entry.mode === "160000").map(entry => entry.relativePath))
    const started = performance.now()
    for (const relative of [...new Set([...index.entries.map(entry => entry.relativePath), ...index.others])]) {
      throwIfAborted(signal)
      if (performance.now() - started > L.searchRequestMs) throw new MobileWorkspaceFilesError("limit_exceeded")
      try { hash.update(`${relative}:${(await checkedNode(scopeRoot, relative, true)).identity}`) }
      catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") hash.update(`${relative}:absent`)
        else throw error
      }
      if (gitlinks.has(relative)) hash.update(await gitlinkHead(scopeRoot, relative, token, signal) ?? "absent")
    }
    // Configuration/attribute changes invalidate old content even when HEAD/index are unchanged.
    for (const base of [...new Set([context.gitDir, context.commonDir])]) {
      try { hash.update((await checkedNode(base, "config")).identity) }
      catch (error) { if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error }
    }
    return hash.digest("hex")
  }

  async function collect(context: MobileFilesGitContext, scopeRoot: string, token: string, signal: AbortSignal) {
    const conversion = await preflight(context, scopeRoot, token, signal)
    const { relative } = conversion
    const initialVersion = await fingerprint(context, [], scopeRoot, token, signal, conversion.version)
    const byRange: Record<MobileWorkspaceFilesChangeRange, MobileFilesGitChange[]> = { unstaged: [], staged: [] }
    // HEAD -> index never performs a working-tree clean conversion. Both Git commands stay cached.
    const common = ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--ignore-submodules=dirty", "--no-abbrev", "-M", "--", relative]
    const raw = await run(context, [...common.slice(0, -2), "--raw", "-z", ...common.slice(-2)], token, signal)
    const stats = await run(context, [...common.slice(0, -2), "--numstat", "-z", ...common.slice(-2)], token, signal)
    byRange.staged = parseRaw(raw.stdout, context.root, scopeRoot, "staged", parseNumstat(stats.stdout))
    const index = await readIndex(context, scopeRoot, token, signal)
    const conflicted = new Set<string>()
    const started = performance.now()
    for (const cached of index.entries) {
      throwIfAborted(signal)
      if (performance.now() - started > L.searchRequestMs) throw new MobileWorkspaceFilesError("limit_exceeded")
      if (cached.stage !== 0) { conflicted.add(cached.relativePath); continue }
      if (cached.skipWorktree) continue
      let node
      try { node = await checkedNode(scopeRoot, cached.relativePath, true) }
      catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
          byRange.unstaged.push(makeChange("unstaged", cached.relativePath, "deleted", cached.oid, null, cached.mode, "000000", null)); continue
        }
        throw error
      }
      if (cached.mode === "160000") {
        const currentHead = await gitlinkHead(scopeRoot, cached.relativePath, token, signal)
        if (currentHead && currentHead !== cached.oid) byRange.unstaged.push(makeChange("unstaged", cached.relativePath, "gitlink", cached.oid, currentHead, "160000", "160000", null))
        continue // Only the pointer is read; never a child's workspace or diff.
      }
      const diskStats = await lstat(node.path, { bigint: true })
      const statMatches = diskStats.mtimeNs === cached.mtimeNs && diskStats.ctimeNs === cached.ctimeNs && diskStats.size === BigInt(cached.size) && Number(diskStats.ino & 0xffffffffn) === cached.ino
      const diskMode = gitFileMode(Number(diskStats.mode))
      if (node.kind === "file" && /^100/.test(cached.mode) && conversion.fileMode === undefined && diskMode !== cached.mode) throw new MobileWorkspaceFilesError("git_unavailable")
      const newMode = node.kind === "symlink" ? "120000" : node.kind === "file" ? (conversion.fileMode === false && /^100/.test(cached.mode) ? cached.mode : diskMode) : "000000"
      if (statMatches && newMode === cached.mode) continue
      const status = newMode !== cached.mode && (node.kind !== "file" || cached.mode === "120000") ? "type_changed" as const : "modified" as const
      const change = makeChange("unstaged", cached.relativePath, status, cached.oid, null, cached.mode, newMode, null)
      if (node.kind === "file" && /^100/.test(cached.mode)) {
        try {
          const disk = await readDiskFile(scopeRoot, cached.relativePath, signal)
          const policy = worktreeTextPolicy(conversion.attributes.get(cached.relativePath), conversion.autoCrlf)
          let baseline: Buffer | undefined, baselineLimited = false
          const readBaseline = async () => {
            try { baseline = await readBlob(context, cached.oid, token, signal) }
            catch (error) {
              if (error instanceof MobileWorkspaceFilesError && error.code === "limit_exceeded") baselineLimited = true
              else throw error
            }
          }
          if ((policy === "auto" || policy === "unknown") && disk.bytes.includes(Buffer.from("\r\n"))) await readBaseline()
          // A giant baseline cannot equal this bounded disk side. Preserve raw
          // bytes and report the limit rather than guessing its conversion/type.
          const normalized = baselineLimited ? disk.bytes : normalizeWorktreeText(disk.bytes, policy, baseline)
          const oid = createHash(cached.oid.length === 64 ? "sha256" : "sha1").update(`blob ${normalized.length}\0`).update(normalized).digest("hex")
          if (oid === cached.oid && newMode === cached.mode) continue
          if (disk.bytes.includes(0)) change.entry = { ...change.entry, contentState: "binary", canPreviewBefore: false, canPreviewAfter: false }
          else {
            if (!baseline && !baselineLimited) await readBaseline()
            if (baseline?.includes(0)) change.entry = { ...change.entry, contentState: "binary", canPreviewBefore: false, canPreviewAfter: false }
            else if (baselineLimited) change.entry = { ...change.entry, contentState: "limit_exceeded", canPreviewBefore: false, canPreviewAfter: true }
          }
        } catch (error) {
          if (error instanceof MobileWorkspaceFilesError && error.code === "limit_exceeded") change.entry = { ...change.entry, contentState: "limit_exceeded", canPreviewBefore: true, canPreviewAfter: false }
          else throw error
        }
      }
      byRange.unstaged.push(change)
    }
    for (const relativePath of index.others) {
      const node = await checkedNode(scopeRoot, relativePath, true)
      const mode = node.kind === "file" ? gitFileMode(node.stats.mode) : node.kind === "symlink" ? "120000" : "000000"
      const change = makeChange("unstaged", relativePath, "untracked", null, null, "000000", mode, null)
      if (node.kind !== "file") change.entry = { ...change.entry, contentState: "special_file", canPreviewBefore: false, canPreviewAfter: false }
      byRange.unstaged.push(change)
    }
    for (const relativePath of conflicted) for (const range of ["unstaged", "staged"] as const) {
      byRange[range] = byRange[range].filter(change => change.relativePath !== relativePath)
      byRange[range].push(makeChange(range, relativePath, "conflict", null, null, "000000", "000000", null))
    }
    const all = [...byRange.unstaged, ...byRange.staged]
    if (all.length > L.maxHandlesPerScope || utf8Bytes(all) > L.maxScopeMetadataBytes) throw new MobileWorkspaceFilesError("limit_exceeded")
    const changeSetVersion = await fingerprint(context, all, scopeRoot, token, signal, conversion.version)
    if (initialVersion !== changeSetVersion) throw new MobileWorkspaceFilesError("content_stale")
    for (const range of ["unstaged", "staged"] as const) byRange[range].sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en"))
    return { byRange, changeSetVersion, ranges: { unstaged: summarize(byRange.unstaged), staged: summarize(byRange.staged) } }
  }

  async function readBlob(context: MobileFilesGitContext, oid: string, token: string, signal: AbortSignal): Promise<Buffer> {
    await ensureMetadataSafe(context, signal)
    if (!/^[a-f0-9]{40,64}$/.test(oid)) throw new MobileWorkspaceFilesError("content_stale")
    const type = await run(context, ["cat-file", "-t", oid], token, signal, { maxBufferBytes: L.maxGitStderrBytes })
    if (type.stdout.trim() !== "blob") throw new MobileWorkspaceFilesError("special_file")
    const size = Number((await run(context, ["cat-file", "-s", oid], token, signal, { maxBufferBytes: L.maxGitStderrBytes })).stdout.trim())
    if (!Number.isSafeInteger(size) || size > L.maxFileSideBytes) throw new MobileWorkspaceFilesError("limit_exceeded")
    const chunks: Buffer[] = []
    let total = 0
    await run(context, ["cat-file", "blob", oid], token, signal, { captureStdout: false, onStdoutChunk(chunk) {
      total += chunk.byteLength
      if (total > size || total > L.maxFileSideBytes) throw new MobileWorkspaceFilesError("limit_exceeded")
      chunks.push(Buffer.from(chunk))
    } })
    if (total !== size) throw new MobileWorkspaceFilesError("content_stale")
    return Buffer.concat(chunks)
  }

  async function side(context: MobileFilesGitContext, scopeRoot: string, change: MobileFilesGitChange, which: "before" | "after", token: string, signal: AbortSignal) {
    const safeSide = change.entry.contentState === "limit_exceeded" && change.entry.changeRange === "unstaged" && (which === "before" ? change.entry.canPreviewBefore : change.entry.canPreviewAfter)
    if (change.entry.contentState !== "available" && !safeSide) throw new MobileWorkspaceFilesError(change.entry.contentState)
    const mode = which === "before" ? change.oldMode : change.newMode
    if (mode === "000000") return { bytes: Buffer.alloc(0), absent: true, version: "absent" }
    if (!/^100[0-7]{3}$/.test(mode)) throw new MobileWorkspaceFilesError(mode === "160000" ? "gitlink" : "special_file")
    if (which === "after" && change.entry.changeRange === "unstaged") return { ...await readDiskFile(scopeRoot, change.relativePath, signal), absent: false }
    const oid = which === "before" ? change.oldOid : change.newOid
    if (!oid) return { bytes: Buffer.alloc(0), absent: true, version: "absent" }
    return { bytes: await readBlob(context, oid, token, signal), absent: false, version: oid }
  }

  async function diff(context: MobileFilesGitContext, scopeRoot: string, change: MobileFilesGitChange, token: string, signal: AbortSignal) {
    // Never run Git against the working tree here: clean/process filters can be added
    // after a list response. Bounded raw blob + disk bytes make that race harmless.
    const conversion = await preflight(context, scopeRoot, token, signal)
    const before = await side(context, scopeRoot, change, "before", token, signal)
    const after = await side(context, scopeRoot, change, "after", token, signal)
    const policy = worktreeTextPolicy(conversion.attributes.get(change.relativePath), conversion.autoCrlf)
    const oldText = decodeText(before.bytes), newText = decodeText(change.entry.changeRange === "unstaged" ? normalizeWorktreeText(after.bytes, policy, before.bytes) : after.bytes)
    // Bound line cardinality before the diff library allocates its token arrays.
    countDiffLines(oldText); countDiffLines(newText)
    if (change.entry.status === "untracked" || change.entry.status === "added") return untrackedHunks(newText, signal)
    if (change.entry.status === "deleted") {
      const additions = await untrackedHunks(oldText, signal)
      return additions.map(hunk => ({ ...hunk, oldStart: hunk.newStart, oldCount: hunk.newCount, newStart: 0, newCount: 0, lines: hunk.lines.map(line => ({ ...line, kind: "deletion" as const, oldLineNumber: line.newLineNumber, newLineNumber: null })) }))
    }
    const patch = await new Promise<ReturnType<typeof structuredPatch>>((resolve, reject) => {
      structuredPatch("before", "after", oldText, newText, undefined, undefined, { context: 3, timeout: L.searchRequestMs, maxEditLength: 10000, callback(value) {
        if (signal.aborted) reject(new MobileWorkspaceFilesError("cancelled"))
        else if (!value) reject(new MobileWorkspaceFilesError("limit_exceeded"))
        else resolve(value)
      } })
    })
    if (!patch || utf8Bytes(patch) > L.maxGitStdoutBytes) throw new MobileWorkspaceFilesError("limit_exceeded")
    const raw = patch.hunks.map(hunk => `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join("\n")}`).join("\n")
    return parseHunks(raw, signal)
  }
  return { discover, collect, fingerprint, side, diff, ensureMetadataSafe }
}

async function ensureMetadataSafe(context: MobileFilesGitContext, signal: AbortSignal): Promise<void> {
  const started = performance.now()
  let visited = 0
  for (const base of [...new Set([context.gitDir, context.commonDir])]) {
    const roots = ["config", "HEAD", "index", "packed-refs", "commondir", "refs", "objects", "info"]
    const pending = [...roots]
    while (pending.length) {
      throwIfAborted(signal)
      if (++visited > L.maxDirectoryEntries || performance.now() - started > L.searchRequestMs) throw new MobileWorkspaceFilesError("limit_exceeded")
      const relative = pending.pop() as string
      let node
      try { node = await checkedNode(base, relative) }
      catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") continue; throw error }
      if (node.kind === "directory") {
        const directory = await opendir(node.path)
        for await (const value of directory) {
          if (pending.length + visited > L.maxDirectoryEntries) throw new MobileWorkspaceFilesError("limit_exceeded")
          pending.push(path.join(relative, value.name))
        }
      }
    }
  }
}

function projectPath(repoRoot: string, scopeRoot: string, value: string): string | null {
  const target = path.join(repoRoot, safeRelativePath(value.endsWith("/") ? value.slice(0, -1) : value))
  if (!isWithinRoot(scopeRoot, target)) return null
  return path.relative(scopeRoot, target).split(path.sep).join("/")
}
function makeChange(range: MobileWorkspaceFilesChangeRange, relativePath: string, status: MobileWorkspaceFilesChange["status"], oldOid: string | null, newOid: string | null, oldMode: string, newMode: string, stats: { additions: number | null; deletions: number | null } | null): MobileFilesGitChange {
  const contentState: MobileWorkspaceFilesContentState = status === "conflict" ? "conflict" : oldMode === "160000" || newMode === "160000" ? "gitlink" : status === "type_changed" ? "type_change" : oldMode === "120000" || newMode === "120000" ? "special_file" : stats && stats.additions === null ? "binary" : "available"
  return { oldOid, newOid, oldMode, newMode, relativePath, diskVersion: null, entry: {
    changeId: versionHash(`${range}:${relativePath}:${oldOid}:${newOid}`), changeRange: range, relativePath, status: contentState === "gitlink" ? "gitlink" : status,
    additions: stats?.additions ?? null, deletions: stats?.deletions ?? null, statsComplete: stats !== null && stats.additions !== null, contentState,
    canPreviewBefore: contentState === "available" && oldMode !== "000000", canPreviewAfter: contentState === "available" && newMode !== "000000",
    ...(contentState === "gitlink" ? { oldGitlink: oldOid ?? undefined, newGitlink: newOid ?? undefined } : {}),
  } }
}
function parseNumstat(stdout: string) {
  const stats = new Map<string, { additions: number | null; deletions: number | null }>()
  const values = stdout.split("\0")
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (!value) continue
    const [additions, deletions, ...name] = value.split("\t")
    let target = name.join("\t")
    if (!target) { index++; target = values[++index] ?? "" }
    stats.set(target, { additions: additions === "-" ? null : Number(additions), deletions: deletions === "-" ? null : Number(deletions) })
  }
  return stats
}
function parseRaw(stdout: string, repoRoot: string, scopeRoot: string, range: MobileWorkspaceFilesChangeRange, counts: ReturnType<typeof parseNumstat>): MobileFilesGitChange[] {
  const result: MobileFilesGitChange[] = []
  const values = stdout.split("\0")
  for (let i = 0; i < values.length; i++) {
    const header = values[i]
    if (!header?.startsWith(":")) continue
    const [oldMode, newMode, oldRaw, newRaw, code] = header.slice(1).split(" ")
    if (!oldMode || !newMode || !oldRaw || !newRaw || !code) throw new MobileWorkspaceFilesError("git_unavailable")
    let oldPath = values[++i] ?? ""
    const newPath = code.startsWith("R") || code.startsWith("C") ? values[++i] ?? "" : oldPath
    const oldRelative = projectPath(repoRoot, scopeRoot, oldPath)
    const newRelative = projectPath(repoRoot, scopeRoot, newPath)
    if (!oldRelative && !newRelative) continue
    let status: MobileWorkspaceFilesChange["status"] = code.startsWith("R") ? "renamed" : code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : code.startsWith("U") ? "conflict" : code.startsWith("T") ? "type_changed" : "modified"
    const projected = oldRelative === null || newRelative === null
    if (oldRelative === null) status = "added"
    else if (newRelative === null) status = "deleted"
    const relativePath = newRelative ?? oldRelative
    if (!relativePath) continue
    const oldOid = status === "added" || /^0+$/.test(oldRaw) ? null : oldRaw
    const newOid = status === "deleted" || /^0+$/.test(newRaw) ? null : newRaw
    const change = makeChange(range, relativePath, status, oldOid, newOid, status === "added" ? "000000" : oldMode, status === "deleted" ? "000000" : newMode, projected ? null : counts.get(newPath) ?? null)
    if (status === "renamed" && oldRelative && newRelative) { oldPath = oldRelative; change.oldRelativePath = oldPath; change.entry = { ...change.entry, oldRelativePath: oldPath } }
    result.push(change)
  }
  return result
}
function summarize(changes: readonly MobileFilesGitChange[]): MobileWorkspaceFilesStatistics {
  const complete = changes.every(change => change.entry.statsComplete)
  return { fileCount: changes.length, additions: complete ? changes.reduce((sum, change) => sum + (change.entry.additions ?? 0), 0) : null, deletions: complete ? changes.reduce((sum, change) => sum + (change.entry.deletions ?? 0), 0) : null, collectionComplete: true, statsComplete: complete }
}
function boundedLine(text: string): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text)
  if (bytes.length <= L.maxLineBytes) return { text, truncated: false }
  const decoder = new TextDecoder("utf-8", { fatal: true })
  for (let end = L.maxLineBytes; end > L.maxLineBytes - 4; end--) {
    try { return { text: decoder.decode(bytes.subarray(0, end)), truncated: true } } catch { /* try the preceding UTF-8 boundary */ }
  }
  throw new MobileWorkspaceFilesError("unsupported_encoding")
}
export { boundedLine }
type IndexEntry = { relativePath: string; mode: string; oid: string; stage: number; mtimeNs: bigint; ctimeNs: bigint; size: number; ino: number; skipWorktree: boolean }
function parseIndexDebug(stdout: string, repoRoot: string, scopeRoot: string): IndexEntry[] {
  const result: IndexEntry[] = []
  let position = 0
  while (position < stdout.length) {
    const end = stdout.indexOf("\0", position)
    if (end < 0) throw new MobileWorkspaceFilesError("git_unavailable")
    const header = stdout.slice(position, end).match(/^(\d{6}) ([a-f0-9]{40,64}) ([0-3])\t([\s\S]+)$/)
    const debug = stdout.slice(end + 1).match(/^  ctime: (\d+):(\d+)\n  mtime: (\d+):(\d+)\n  dev: (\d+)\tino: (\d+)\n  uid: (\d+)\tgid: (\d+)\n  size: (\d+)\tflags: ([a-f0-9]+)\n/i)
    if (!header || !debug) throw new MobileWorkspaceFilesError("git_unavailable")
    const relativePath = projectPath(repoRoot, scopeRoot, header[4] ?? "")
    if (relativePath) result.push({ relativePath, mode: header[1] as string, oid: header[2] as string, stage: Number(header[3]), ctimeNs: BigInt(debug[1] as string) * 1_000_000_000n + BigInt(debug[2] as string), mtimeNs: BigInt(debug[3] as string) * 1_000_000_000n + BigInt(debug[4] as string), ino: Number(debug[6]), size: Number(debug[9]), skipWorktree: (parseInt(debug[10] as string, 16) & 0x40000000) !== 0 })
    position = end + 1 + debug[0].length
  }
  return result
}
async function parseHunks(patch: string, signal: AbortSignal): Promise<MobileWorkspaceFilesDiffHunk[]> {
  const result: MobileWorkspaceFilesDiffHunk[] = []
  let hunk: MobileWorkspaceFilesDiffHunk | undefined
  let oldLine = 0, newLine = 0, visited = 0, modelBytes = 2, modelLines = 0
  for (const scanned of textLines(patch)) {
    const line = scanned.text
    if (++visited % 512 === 0) { await new Promise<void>(resolve => setImmediate(resolve)); throwIfAborted(signal) }
    const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (header) {
      oldLine = Number(header[1]); newLine = Number(header[3])
      hunk = { hunkId: versionHash(`${result.length}:${line}`), oldStart: oldLine, oldCount: Number(header[2] ?? 1), newStart: newLine, newCount: Number(header[4] ?? 1), lineOffset: 0, continued: false, lines: [] }
      modelBytes += utf8Bytes(hunk) + 1
      if (modelBytes > L.maxDiffModelBytes) throw new MobileWorkspaceFilesError("limit_exceeded")
      result.push(hunk); continue
    }
    if (!hunk || !/^[ +\\-]/.test(line)) continue
    const kind = line[0] === "+" ? "addition" : line[0] === "-" ? "deletion" : line[0] === "\\" ? "meta" : "context"
    const oldLineNumber = kind === "addition" || kind === "meta" ? null : oldLine++
    const newLineNumber = kind === "deletion" || kind === "meta" ? null : newLine++
    const rendered: MobileWorkspaceFilesDiffHunk["lines"][number] = { kind, oldLineNumber, newLineNumber, ...boundedLine(line.slice(1)) }
    modelBytes += utf8Bytes(rendered) + 1
    if (++modelLines > L.maxDiffModelLines || modelBytes > L.maxDiffModelBytes) throw new MobileWorkspaceFilesError("limit_exceeded")
    ;(hunk.lines as Array<MobileWorkspaceFilesDiffHunk["lines"][number]>).push(rendered)
  }
  return result
}
async function untrackedHunks(text: string, signal: AbortSignal): Promise<MobileWorkspaceFilesDiffHunk[]> {
  const count = countDiffLines(text)
  const rendered: Array<MobileWorkspaceFilesDiffHunk["lines"][number]> = []
  let index = 0, modelBytes = 512
  for (const scanned of textLines(text)) {
    if (index % 512 === 0) { await new Promise<void>(resolve => setImmediate(resolve)); throwIfAborted(signal) }
    const line = { kind: "addition" as const, oldLineNumber: null, newLineNumber: ++index, ...boundedLine(scanned.text) }
    modelBytes += utf8Bytes(line) + 1
    if (modelBytes > L.maxDiffModelBytes) throw new MobileWorkspaceFilesError("limit_exceeded")
    rendered.push(line)
  }
  return [{ hunkId: versionHash(text), oldStart: 0, oldCount: 0, newStart: count ? 1 : 0, newCount: count, lineOffset: 0, continued: false, lines: rendered }]
}
function countDiffLines(text: string): number {
  let count = 0, offset = 0
  while (offset < text.length) {
    if (++count > L.maxDiffModelLines) throw new MobileWorkspaceFilesError("limit_exceeded")
    const next = text.indexOf("\n", offset)
    if (next < 0) break
    offset = next + 1
  }
  return count
}
/** Git records the owner execute bit; group/other-only execute flags do not change mode. */
function gitFileMode(mode: number): "100755" | "100644" { return mode & 0o100 ? "100755" : "100644" }

/** Built-in convert.c text heuristic, including controls and the DOS EOF exception. */
export function gitConversionTextStats(bytes: Buffer): { binary: boolean; crlf: number } {
  let printable = 0, nonprintable = 0, crlf = 0
  for (let index = 0; index < bytes.length; index++) {
    const value = bytes[index] as number
    if (value === 13) {
      if (bytes[index + 1] !== 10) return { binary: true, crlf }
      crlf++; index++; continue
    }
    if (value === 10) continue
    if (value === 0) return { binary: true, crlf }
    if (value === 127 || value < 32 && value !== 8 && value !== 9 && value !== 27 && value !== 12) nonprintable++
    else printable++
  }
  if (bytes[bytes.length - 1] === 26) nonprintable--
  return { binary: (printable >> 7) < nonprintable, crlf }
}

function worktreeTextPolicy(attributes: Map<string, string> | undefined, autoCrlf: string | undefined): "raw" | "text" | "auto" | "unknown" {
  const text = attributes?.get("text"), eol = attributes?.get("eol")
  if (text === "unset") return "raw"
  if (text === "set") return "text"
  if (text === "auto") return "auto"
  if (eol === "lf" || eol === "crlf") return "text"
  return autoCrlf === "true" || autoCrlf === "input" ? "auto" : autoCrlf === "false" ? "raw" : "unknown"
}
/** Git's built-in CRLF normalization is performed locally; never a user converter. */
function normalizeWorktreeText(bytes: Buffer, policy: "raw" | "text" | "auto" | "unknown", baseline?: Buffer): Buffer {
  if (policy === "raw" || !bytes.includes(Buffer.from("\r\n"))) return bytes
  if (policy === "auto" || policy === "unknown") {
    if (gitConversionTextStats(bytes).binary) return bytes
    const indexed = baseline ? gitConversionTextStats(baseline) : undefined
    if (indexed && !indexed.binary && indexed.crlf) return bytes
  }
  if (policy === "unknown") throw new MobileWorkspaceFilesError("git_unavailable")
  const normalized = Buffer.allocUnsafe(bytes.length)
  let length = 0
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) continue
    normalized[length++] = bytes[index] as number
  }
  return normalized.subarray(0, length)
}
