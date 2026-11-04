import { randomUUID } from "node:crypto"
import { lstat, mkdir, opendir, realpath, rmdir, unlink } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { sha256 } from "@synapse/shared/archive-package-node"
import { hubPathDisposition } from "@synapse/shared/skill-hub-package-node"
import { SKILL_HUB_LIMITS as limits, type SkillHubPreparedSource, type SkillHubTeam, type SkillHubTeamPage } from "@synapse/shared/skill-hub-contracts"
import { externalAssetPath, exportExternalAsset, openExternalAsset, type ManagedAssetStore } from "../../../electron/runtime/data-repo/assets"
import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type { HubPreparedRecord } from "../../../electron/runtime/data-repo/schemas/skill-hub"
import { hubCallerKey, withHubPermission, type HubSecurity, type SkillHubCaller } from "./access"
import type { HubAccountOperation } from "./cloud-client"
import { hubSourceExpired, SkillHubDesktopError } from "./error"
import type { HubWorkerInput, HubWorkerOutput } from "./package-worker"
import { runHubPackageWorker } from "./package-worker-launch"

type PackageContext = { account: HubAccountOperation; caller: SkillHubCaller }
type HubPackageDeps = HubSecurity & {
  records: DataNamespace<HubPreparedRecord>
  assets: ManagedAssetStore
  encode?: typeof runHubPackageWorker
  report: (code: string) => void
}

const deniedTeam = () => new SkillHubDesktopError("HUB_TEAM_UNAVAILABLE", "当前账号不是目标团队的有效成员。")

export async function selectHubUploadTeam(
  load: (cursor?: string) => Promise<SkillHubTeamPage>, requested?: string,
): Promise<SkillHubTeam> {
  let page = await load()
  if (page.selectionState === "none") throw new SkillHubDesktopError("HUB_NO_TEAM", "加入团队后才能上传 Skill。")
  if (!requested && page.selectionState === "multiple") throw new SkillHubDesktopError("HUB_TEAM_REQUIRED", "请选择目标团队。")
  const target = requested ?? page.defaultTeamId
  for (let count = 0; count < 100; count++) {
    const match = page.items.find(({ id }) => id === target)
    if (match) return match
    if (!page.nextCursor) throw deniedTeam()
    page = await load(page.nextCursor)
  }
  throw new SkillHubDesktopError("HUB_TEAM_LOOKUP_BUDGET", "团队分页读取未完成，请重新确认目标团队。")
}

export async function readHubExternalFile(filePath: string, max: number, signal: AbortSignal): Promise<Buffer> {
  const before = await lstat(filePath)
  if (!before.isFile() || before.nlink !== 1 || before.size > max) {
    throw new SkillHubDesktopError("HUB_SOURCE_INVALID", "Skill 来源不是受支持的普通文件，或超过大小限制。")
  }
  const stream = await openExternalAsset(filePath, max, signal)
  const chunks: Buffer[] = []
  let size = 0
  for await (const part of stream) {
    signal.throwIfAborted()
    const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part)
    size += bytes.length
    if (size > max || size > before.size) throw new SkillHubDesktopError("HUB_SOURCE_INVALID", "读取中的 Skill 文件已变化或超过大小限制。")
    chunks.push(bytes)
  }
  const after = await lstat(filePath)
  if (!after.isFile() || size !== before.size || after.size !== before.size || before.ino !== after.ino || before.dev !== after.dev
    || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || await realpath(filePath) !== filePath) {
    throw new SkillHubDesktopError("HUB_SOURCE_CHANGED", "Skill 文件在读取期间变化，请重新准备。")
  }
  return Buffer.concat(chunks, size)
}

async function readDirectory(root: string, signal: AbortSignal): Promise<HubWorkerInput> {
  const files: { path: string; bytes: Buffer }[] = []
  const excludedPaths: string[] = []
  let visited = 0
  let directories = 0
  let total = 0
  async function visit(current: string, relative: string, depth: number): Promise<void> {
    signal.throwIfAborted()
    if (depth > limits.directoryDepth || ++directories > limits.archiveDirectories || await realpath(current) !== current) {
      throw new SkillHubDesktopError("HUB_SOURCE_INVALID", "Skill 来源目录超出限制，或包含不安全的路径。")
    }
    const dir = await opendir(current)
    for await (const entry of dir) {
      signal.throwIfAborted()
      if (++visited > limits.archiveEntries) throw new SkillHubDesktopError("HUB_SOURCE_INVALID", "Skill 来源条目过多。")
      const name = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink() || hubPathDisposition(name) !== "include") {
        excludedPaths.push(name)
        continue
      }
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (name === ".env.example") throw new SkillHubDesktopError("HUB_SOURCE_INVALID", "根目录 .env.example 必须是文件。")
        await visit(full, name, depth + 1)
        continue
      }
      if (!entry.isFile() || files.length >= limits.attachments + 1) {
        throw new SkillHubDesktopError("HUB_SOURCE_INVALID", "Skill 附件类型无效或数量过多。")
      }
      if (await realpath(path.dirname(full)) !== current) throw new SkillHubDesktopError("HUB_SOURCE_CHANGED", "Skill 源目录已变化。")
      const bytes = await readHubExternalFile(full, Math.min(limits.packageBytes - total, name === "SKILL.md" ? limits.mainBytes : limits.attachmentBytes), signal)
      total += bytes.length
      files.push({ path: name, bytes })
    }
  }
  await visit(root, "", 0)
  return { format: "directory", files, excludedPaths: excludedPaths.sort() }
}

export class HubPackageService {
  private readonly bootId = randomUUID()
  private readonly active = new Set<string>()
  private readonly packageInfo = new Map<string, HubWorkerOutput["package"]>()
  private timer?: ReturnType<typeof setInterval>
  private running = false
  private jobs = 0

  constructor(private readonly deps: HubPackageDeps) {}

  async prepare(sourcePath: string, team: SkillHubTeam, context: PackageContext): Promise<SkillHubPreparedSource> {
    return this.bounded(async () => {
      const signal = AbortSignal.any([context.account.signal, AbortSignal.timeout(40_000)])
      const source = await externalAssetPath(sourcePath).catch(() => { throw new SkillHubDesktopError("HUB_SOURCE_INVALID", "需要可读的绝对来源路径。") })
      return withHubPermission(this.deps, context.caller, "fs.read.outside-userdata", source, "package.prepare", async () => {
        let input: HubWorkerInput
        try {
          signal.throwIfAborted()
          const stat = await lstat(source)
          if (stat.isDirectory() && !stat.isSymbolicLink()) {
            input = await readDirectory(source, signal)
          } else {
            const extension = path.extname(source).toLowerCase()
            const format = extension === ".md" ? "markdown" : extension === ".zip" ? "zip" : null
            if (!format || hubPathDisposition(path.basename(source)) !== "include") {
              throw new SkillHubDesktopError("HUB_SOURCE_INVALID", "来源必须是含根 SKILL.md 的目录、Markdown 或 ZIP。")
            }
            input = { format, bytes: await readHubExternalFile(source, format === "zip" ? limits.uploadBytes : limits.mainBytes, signal) }
          }
        } catch (error) {
          if (signal.aborted) signal.throwIfAborted()
          if (error instanceof SkillHubDesktopError) throw error
          throw new SkillHubDesktopError("HUB_SOURCE_INVALID", "无法安全读取该 Skill 来源。")
        }
        const result = await (this.deps.encode ?? runHubPackageWorker)(input, signal)
        const id = randomUUID()
        const expiresAt = Date.now() + limits.preparedTtlMs
        const record: HubPreparedRecord = {
          id, schemaVersion: 1, bootId: this.bootId, state: "staged", assetKey: id, team, expiresAt,
          accountId: context.account.scope.accountId, authRevision: context.account.scope.authRevision, callerKey: hubCallerKey(context.caller),
          archiveSha256: null, manifest: result.manifest, contentFingerprint: result.contentFingerprint,
        }
        signal.throwIfAborted()
        this.active.add(id)
        try {
          await this.deps.records.upsert(record)
          const asset = await this.deps.assets.put(Readable.from([Buffer.from(result.bytes)]), limits.uploadBytes, signal, id)
          signal.throwIfAborted()
          await this.deps.records.upsert({ ...record, state: "ready", archiveSha256: asset.sha256 })
          this.packageInfo.set(id, result.package)
          return {
            preparedSourceId: id, team, expiresAt: new Date(expiresAt).toISOString(), package: result.package,
            manifest: result.manifest, contentFingerprint: result.contentFingerprint,
            summary: { totalBytes: result.totalBytes, excludedPaths: result.excludedPaths, warnings: result.warnings },
          }
        } catch (error) {
          await this.removeRecord(record).catch(() => this.deps.report("HUB_PREPARE_CLEANUP_RETRY"))
          throw error
        } finally {
          this.active.delete(id)
        }
      })
    })
  }

  async readPrepared(id: string, context: PackageContext) {
    const record = await this.validRecord(id, context)
    const info = this.packageInfo.get(id)
    if (!info) throw hubSourceExpired()
    this.active.add(id)
    try {
      const bytes = await this.deps.assets.read(record.assetKey, limits.uploadBytes)
        .catch(() => { throw hubSourceExpired() })
      context.account.signal.throwIfAborted()
      if (record.archiveSha256 !== sha256(bytes)) throw hubSourceExpired()
      return { record, bytes, package: info }
    } finally {
      this.active.delete(id)
    }
  }

  async release(id: string, context: PackageContext) {
    const record = await this.validRecord(id, context)
    if (!this.active.has(id)) await this.removeRecord(record)
  }

  async exportPackage(archive: Buffer, expectedFingerprint: string, destination: string, context: PackageContext) {
    return this.bounded(async () => {
      const signal = AbortSignal.any([context.account.signal, AbortSignal.timeout(40_000)])
      const result = await (this.deps.encode ?? runHubPackageWorker)({ format: "zip", bytes: archive, exportFiles: true }, signal)
      if (result.contentFingerprint !== expectedFingerprint) throw new SkillHubDesktopError("HUB_DOWNLOAD_INVALID", "下载文件的内容指纹与当前版本不符。")
      const target = await externalAssetPath(destination).catch(() => { throw new SkillHubDesktopError("HUB_DESTINATION_INVALID", "需要一个尚不存在的绝对目标目录。") })
      return withHubPermission(this.deps, context.caller, "fs.write.outside-userdata", target, "package.download", async () => {
        const created: { path: string; dir: boolean }[] = []
        const directories = new Set<string>()
        async function addDirectory(dir: string) {
          if (directories.has(dir)) return
          if (dir !== target) await addDirectory(path.dirname(dir))
          await mkdir(dir, { mode: 0o700 })
          created.push({ path: dir, dir: true })
          directories.add(dir)
        }
        try {
          signal.throwIfAborted()
          await addDirectory(target)
          for (const file of result.files!) {
            signal.throwIfAborted()
            const output = path.join(target, ...file.path.split("/"))
            await addDirectory(path.dirname(output))
            if (await realpath(path.dirname(output)) !== path.dirname(output)) throw new Error("Unsafe destination path")
            await exportExternalAsset(Readable.from([Buffer.from(file.bytes)]), output, limits.attachmentBytes, signal)
            created.push({ path: output, dir: false })
          }
          return target
        } catch (error) {
          for (const item of created.reverse()) {
            await (item.dir ? rmdir(item.path) : unlink(item.path)).catch(() => this.deps.report("HUB_EXPORT_CLEANUP_RETRY"))
          }
          if (signal.aborted) signal.throwIfAborted()
          throw new SkillHubDesktopError("HUB_DESTINATION_INVALID", "无法写入目标目录，请选择不存在的目录。")
        }
      })
    })
  }

  startBackground() {
    if (this.timer) return
    const tick = () => { void this.reap().catch(() => this.deps.report("HUB_PREPARE_CLEANUP_RETRY")) }
    this.timer = setInterval(tick, 60_000)
    this.timer.unref?.()
    tick()
  }

  stopBackground() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  private async reap() {
    if (this.running) return
    this.running = true
    try {
      const rows = await this.deps.records.queryRange?.({
        index: "expiry", equal: {}, range: { field: "expiresAt", lte: Date.now() }, direction: "asc", limit: 32,
      }) ?? []
      for (const record of rows) {
        if (!this.active.has(record.id)) await this.removeRecord(record).catch(() => this.deps.report("HUB_PREPARE_CLEANUP_RETRY"))
      }
    } finally {
      this.running = false
    }
  }

  private async validRecord(id: string, context: PackageContext) {
    context.account.signal.throwIfAborted()
    const record = await this.deps.records.get(id)
    const { accountId, authRevision } = context.account.scope
    if (!record || record.state !== "ready" || record.bootId !== this.bootId || record.expiresAt <= Date.now()
      || record.accountId !== accountId || record.authRevision !== authRevision || record.callerKey !== hubCallerKey(context.caller)) {
      throw hubSourceExpired()
    }
    return record
  }

  private async removeRecord(record: HubPreparedRecord) {
    this.packageInfo.delete(record.id)
    await this.deps.assets.remove(record.assetKey)
    await this.deps.assets.remove(record.assetKey, true)
    await this.deps.records.remove(record.id)
  }

  private async bounded<T>(work: () => Promise<T>): Promise<T> {
    if (this.jobs >= 2) throw new SkillHubDesktopError("HUB_PREPARE_BUSY", "当前有其他 Skill 包正在处理，请稍后重试。")
    this.jobs++
    try { return await work() } finally { this.jobs-- }
  }
}
