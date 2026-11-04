import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../../../electron/generated/deployment-config.generated"
import type { PreparedContentInstallSourceProvider } from "../../../electron/services/editor-install-service"
import type { SynapseContentDetail } from "../../../src/types/content"
import type { SynapseSkillInstallerSource } from "../../../src/types/installers"
import { HUB_INSTALL_SOURCE_PREFIX, HUB_SOURCE_IDENTITY_PREFIX } from "../shared/install-source"
import { hubKey, type SkillHubCaller } from "./access"
import type { HubAccountOperation } from "./cloud-client"
import { SkillHubDesktopError } from "./error"
import { runHubPackageWorker } from "./package-worker-launch"
import type { DesktopSkillHubService } from "./service"

type Entry = {
  caller: SkillHubCaller
  op: HubAccountOperation
  skillId: string
  source: SynapseSkillInstallerSource
  detail: SynapseContentDetail<"skill">
  files: Map<string, Uint8Array>
  timer: ReturnType<typeof setTimeout>
  clear: () => void
  busy: boolean
  onRelease?: () => void
}

export const HUB_INSTALL_PROVIDER_ID = "core.skill-hub-install-provider"
const sourceNamespace = hubKey(new URL(SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl).origin)
const text = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)

export class HubPreparedSourceProvider implements PreparedContentInstallSourceProvider {
  private readonly entries = new Map<string, Entry>()
  private preparing = 0

  constructor(private readonly hub: Pick<DesktopSkillHubService, "run" | "readLatest" | "get" | "assertInstallAccount">,
    private readonly inspect = runHubPackageWorker) {}

  async prepare(skillId: string, caller: SkillHubCaller): Promise<SynapseSkillInstallerSource> {
    if (this.entries.size + this.preparing >= 2) throw new SkillHubDesktopError("HUB_PREPARE_BUSY", "请先关闭其他 Skill 安装操作。")
    this.preparing++
    try {
      return await this.hub.run(caller, "install.prepare", async (op) => {
        const { skill, archive } = await this.hub.readLatest(op, skillId)
        const snapshot = await this.inspect({ format: "zip", bytes: archive, exportFiles: true }, op.signal)
        const files = new Map(snapshot.files?.map((file) => [file.path, file.bytes]))
        const main = files.get("SKILL.md")
        if (!main || skill.id !== skillId || snapshot.contentFingerprint !== skill.currentVersion.contentFingerprint
          || snapshot.package.name !== skill.package.name || snapshot.package.description !== skill.package.description) {
          throw new SkillHubDesktopError("HUB_DOWNLOAD_INVALID", "下载包校验失败。")
        }
        this.hub.assertInstallAccount(op)
        files.delete("SKILL.md")
        const id = HUB_INSTALL_SOURCE_PREFIX + randomUUID()
        const source: SynapseSkillInstallerSource = {
          kind: "skill", origin: "skill-hub", preparedSourceId: id, repositoryVersion: skill.currentVersion.id,
          sourceIdentity: HUB_SOURCE_IDENTITY_PREFIX + sourceNamespace + ":" + skill.id,
          title: skill.displayName, name: snapshot.package.name, description: snapshot.package.description,
          sourceFingerprint: snapshot.contentFingerprint, hubVersionNumber: skill.currentVersion.number,
        }
        const attachments = snapshot.manifest.filter((f) => f.path !== "SKILL.md").map((f) => ({
          originalName: f.path, size: f.size, sha256: f.sha256,
        }))
        const detail: Entry["detail"] = {
          id: source.sourceIdentity, type: "skill", name: source.name, title: skill.displayName, description: snapshot.package.description,
          content: text(main), latestHistoryDirname: skill.currentVersion.id, deleted: false, isReadonly: true,
          hubPackage: { versionNumber: skill.currentVersion.number, sourceFingerprint: snapshot.contentFingerprint },
          attachments, attachmentCount: attachments.length, category: "", icon: "", iconBg: "",
          createdBy: skill.createdBy.id ?? "", createdByDisplayName: skill.createdBy.displayName, createdAt: skill.publishedAt,
          modifiedBy: skill.maintainer.id ?? "", modifiedByDisplayName: skill.maintainer.displayName, modifiedAt: skill.publishedAt,
        }
        const clear = () => this.remove(id)
        const timer = setTimeout(clear, 30 * 60_000)
        timer.unref?.()
        this.entries.set(id, { caller, op, skillId, source, detail, files, clear, timer, busy: false })
        op.signal.addEventListener("abort", clear, { once: true })
        return source
      })
    } finally {
      this.preparing--
    }
  }

  release(id: string, clientId: string) {
    if (this.entries.get(id)?.caller.clientId === clientId) this.remove(id)
  }

  onRelease(id: string, detach: () => void) {
    const entry = this.entries.get(id)
    if (entry) entry.onRelease = detach
    else detach()
  }

  private remove(id: string) {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    clearTimeout(entry.timer)
    entry.onRelease?.()
    entry.op.signal.removeEventListener("abort", entry.clear)
  }

  private require(id: string, contentId: string) {
    const entry = this.entries.get(id)
    if (!entry || entry.detail.id !== contentId) {
      throw new SkillHubDesktopError("HUB_PREPARE_UNAVAILABLE", "安装准备已失效，请重新读取最新版。")
    }
    this.hub.assertInstallAccount(entry.op)
    return entry
  }

  hasPreparedSource(sourceId: string) { return sourceId.startsWith(HUB_INSTALL_SOURCE_PREFIX) }
  async readPreparedRule(): Promise<string> { throw new Error("Skill Hub 安装源只能安装 Skill。") }
  async readPreparedSkill(id: string, contentId: string) { return this.require(id, contentId).detail }
  async readPreparedSkillAttachmentText(id: string, contentId: string, path: string) {
    const file = this.require(id, contentId).files.get(path)
    return file ? text(file) : null
  }
  async beginPreparedInstall(id: string, contentId: string) {
    const entry = this.require(id, contentId)
    if (entry.busy) throw new SkillHubDesktopError("HUB_INSTALL_BUSY", "该 Skill 正在安装。")
    entry.busy = true
    try {
      const latest = await this.hub.get(entry.skillId, entry.caller)
      this.require(id, contentId)
      if (latest.currentVersion.id !== entry.source.repositoryVersion) {
        throw new SkillHubDesktopError("HUB_LATEST_CHANGED", "最新版已变化，请重新读取。")
      }
    } catch (error) {
      entry.busy = false
      throw error
    }
  }
  async endPreparedInstall(id: string, contentId: string) {
    const entry = this.entries.get(id)
    if (entry?.detail.id === contentId) entry.busy = false
  }
  async copyPreparedSkillAttachment(id: string, contentId: string, path: string, target: string) {
    const entry = this.require(id, contentId)
    const bytes = entry.files.get(path)
    if (!entry.busy || !bytes) throw new Error("Skill Hub 安装附件不可用。")
    // EditorInstallCore already authorized the target; only its staging paths reach this provider.
    await writeFile(target, bytes, { flag: "wx" })
  }
  async markPreparedInstalled() { /* The same current source may be installed into another selected editor. */ }
}
