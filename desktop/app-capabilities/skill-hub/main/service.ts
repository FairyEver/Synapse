import {
  type SkillHubDetail, type SkillHubListInput, type SkillHubMcpCreateInput, type SkillHubMcpDeleteInput,
  type SkillHubMcpDownloadInput, type SkillHubMcpPrepareInput, type SkillHubMcpPublishInput,
  type SkillHubMcpUpdateInput, type SkillHubReceiptInput, type SkillHubTeamQuery, type SkillHubWriteAction,
} from "@synapse/shared/skill-hub-contracts"
import type { DataRepository } from "../../../electron/runtime/data-repo"
import { skillHubWriteIntentsSchema, type HubWriteIntent } from "../../../electron/runtime/data-repo/schemas/skill-hub"
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../../../electron/generated/deployment-config.generated"
import { hubCallerKey, hubKey, withHubPermission, type HubSecurity, type SkillHubCaller } from "./access"
import { type HubAccountOperation, SkillHubCloudClient } from "./cloud-client"
import { hubAccountChanged, SkillHubDesktopError } from "./error"
import { prepareHubIcon } from "./icon-source"
import { HubPackageService, selectHubUploadTeam } from "./package-service"

export const SKILL_HUB_SERVICE_ID = "core.skill-hub"
const networkResource = "snap-skill-hub"
const ambiguous = new Set([
  "HUB_ACCOUNT_CHANGED", "HUB_ACCOUNT_REQUIRED", "HUB_CANCELLED", "HUB_CONNECTION_ERROR", "HUB_RESPONSE_INVALID",
  "HUB_RESPONSE_BUDGET", "HUB_UNSUPPORTED_SERVER",
])

type HubDeps = HubSecurity & {
  cloud: SkillHubCloudClient
  packages: HubPackageService
  repository: DataRepository
}

export class DesktopSkillHubService {
  private iconsInFlight = 0
  constructor(private readonly deps: HubDeps) {}

  teams(input: SkillHubTeamQuery, caller: SkillHubCaller) {
    return this.run(caller, "team.list", (op) => this.deps.cloud.teams(op, input))
  }

  async get(skillId: string, caller: SkillHubCaller) {
    return this.run(caller, "skill.get", async (op) => this.withLink(await this.deps.cloud.get(op, skillId)))
  }

  list(input: SkillHubListInput, caller: SkillHubCaller) {
    return this.run(caller, "skill.list", (op) => this.deps.cloud.list(op, input))
  }

  prepare(input: SkillHubMcpPrepareInput, caller: SkillHubCaller) {
    return this.run(caller, "package.prepare", async (op) => {
      const team = await this.team(op, input.teamId)
      return this.deps.packages.prepare(input.sourcePath, team, { account: op, caller })
    })
  }

  download(input: SkillHubMcpDownloadInput, caller: SkillHubCaller) {
    return this.run(caller, "package.download", async (op) => {
      const { skill, archive } = await this.readLatest(op, input.skillId, input.expectedVersionId)
      const destinationDirectory = await this.deps.packages.exportPackage(archive, skill.currentVersion.contentFingerprint,
        input.destinationDirectory, { account: op, caller })
      return { skillId: skill.id, team: skill.team, currentVersion: skill.currentVersion, destinationDirectory }
    })
  }

  create(input: SkillHubMcpCreateInput, caller: SkillHubCaller) {
    const key = { action: "app.skill_hub.skill.create", requestId: input.requestId } as const
    return this.write(caller, key, input.teamId, [input.teamId, input.preparedSourceId, input.displayName, input.displayDescription, input.iconPath], async (op, submit) => {
      const prepared = await this.deps.packages.readPrepared(input.preparedSourceId, { account: op, caller })
      this.matchTeam(prepared.record.team.id, input.teamId)
      await this.team(op, input.teamId)
      const pkg = await this.uploadPrepared(op, key, input.teamId, prepared.bytes)
      const iconUploadId = input.iconPath ? await this.uploadIcon(op, caller, key, input.teamId, input.iconPath) : undefined
      const displayName = input.displayName ?? prepared.package.name
      const displayDescription = input.displayDescription ?? [...prepared.package.description].slice(0, 2000).join("")
      return submit(() => this.deps.cloud.create(op, { teamId: input.teamId, packageUploadId: pkg.uploadId, iconUploadId, displayName, displayDescription, requestId: key.requestId }))
    })
  }

  publish(input: SkillHubMcpPublishInput, caller: SkillHubCaller) {
    const key = { action: "app.skill_hub.version.create", requestId: input.requestId } as const
    return this.write(caller, key, input.skillId, [input.skillId, input.preparedSourceId, input.expectedVersionId], async (op, submit) => {
      const prepared = await this.deps.packages.readPrepared(input.preparedSourceId, { account: op, caller })
      const skill = await this.deps.cloud.get(op, input.skillId)
      this.matchTeam(prepared.record.team.id, skill.team.id)
      if (!skill.permissions.canPublishVersion) throw this.notAvailable()
      if (skill.currentVersion.id !== input.expectedVersionId) {
        throw new SkillHubDesktopError("HUB_VERSION_CONFLICT", "Skill 版本已变化，请重新读取当前版本。")
      }
      const pkg = await this.uploadPrepared(op, key, skill.team.id, prepared.bytes)
      return submit(() => this.deps.cloud.publish(op, input.skillId, {
        packageUploadId: pkg.uploadId, expectedVersionId: input.expectedVersionId, requestId: key.requestId,
      }))
    })
  }

  update(input: SkillHubMcpUpdateInput, caller: SkillHubCaller) {
    const key = { action: "app.skill_hub.skill.update", requestId: input.requestId } as const
    return this.write(caller, key, input.skillId, [
      input.skillId, input.expectedRevision, input.displayName, input.displayDescription, input.iconPath !== undefined, input.iconPath,
    ], async (op, submit) => {
      let iconUploadId: string | null | undefined = input.iconPath === null ? null : undefined
      if (input.iconPath) {
        const skill = await this.deps.cloud.get(op, input.skillId)
        if (!skill.permissions.canEditMetadata) throw this.notAvailable()
        if (skill.revision !== input.expectedRevision) throw new SkillHubDesktopError("HUB_REVISION_CONFLICT", "Skill 资料已变化，请重新读取。")
        iconUploadId = await this.uploadIcon(op, caller, key, skill.team.id, input.iconPath)
      }
      return submit(() => this.deps.cloud.update(op, input.skillId, {
        expectedRevision: input.expectedRevision, requestId: key.requestId,
        displayName: input.displayName, displayDescription: input.displayDescription, iconUploadId,
      }))
    })
  }

  delete(input: SkillHubMcpDeleteInput, caller: SkillHubCaller) {
    const key = { action: "app.skill_hub.skill.delete", requestId: input.requestId } as const
    return this.write(caller, key, input.skillId, [input.skillId, input.expectedRevision], (op, submit) =>
      submit(() => this.deps.cloud.delete(op, input.skillId, { expectedRevision: input.expectedRevision, requestId: key.requestId })))
  }

  getReceipt(input: SkillHubReceiptInput, caller: SkillHubCaller) {
    return this.run(caller, "receipt.get", async (op) => {
      const intent = await this.intents.get(this.intentId(input))
      if (intent && intent.accountId !== op.scope.accountId) throw hubAccountChanged()
      return this.deps.cloud.receipt(op, input)
    })
  }

  startBackground() { this.deps.packages.startBackground() }
  stopBackground() { this.deps.packages.stopBackground() }
  dispose() {
    this.stopBackground()
    this.deps.cloud.dispose()
  }

  /** Internal latest-only package entry for the existing installer. */
  async readLatest(op: HubAccountOperation, skillId: string, expectedVersionId?: string) {
    const skill = await this.deps.cloud.get(op, skillId)
    if (expectedVersionId && expectedVersionId !== skill.currentVersion.id) {
      throw new SkillHubDesktopError("HUB_LATEST_CHANGED", "最新版已变化，请重新读取。")
    }
    const fetched = await this.deps.cloud.download(op, skillId, skill.currentVersion.id)
    if (fetched.archiveSha256 !== skill.currentVersion.archiveSha256) throw new SkillHubDesktopError("HUB_DOWNLOAD_INVALID", "下载包校验失败。")
    return { skill, archive: fetched.bytes }
  }

  async run<T>(caller: SkillHubCaller, operation: string, work: (op: HubAccountOperation) => Promise<T>): Promise<T> {
    const op = this.deps.cloud.capture(caller.signal)
    return withHubPermission(this.deps, caller, "network.connect", networkResource, operation, async () => {
      try {
        const value = await work(op)
        this.deps.cloud.assertActive(op)
        return value
      } catch (error) {
        if (error instanceof SkillHubDesktopError) throw error
        this.deps.cloud.assertActive(op)
        throw new SkillHubDesktopError("HUB_OPERATION_FAILED", "Skill Hub 操作未完成，请重试或查询回执。")
      }
    })
  }

  private get intents() { return this.deps.repository.namespace<HubWriteIntent>(skillHubWriteIntentsSchema.name) }
  private intentId(input: SkillHubReceiptInput) { return hubKey([input.action, input.requestId]) }
  private notAvailable() { return new SkillHubDesktopError("HUB_NOT_AVAILABLE", "该 Skill 不存在或当前账号无权维护。") }

  private withLink(skill: SkillHubDetail) {
    return { ...skill, detailUrl: new URL(`/console/skill-hub/${encodeURIComponent(skill.id)}`, SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl).toString() }
  }

  private team(op: HubAccountOperation, teamId?: string) {
    return selectHubUploadTeam((cursor) => this.deps.cloud.teams(op, { cursor, limit: 100 }), teamId)
  }

  private matchTeam(expected: string, actual: string) {
    if (expected !== actual) throw new SkillHubDesktopError("HUB_TEAM_MISMATCH", "准备结果属于另一个团队，请按目标团队重新准备。")
  }

  private uploadPrepared(op: HubAccountOperation, key: SkillHubReceiptInput, teamId: string, bytes: Buffer) {
    return this.deps.cloud.upload(op, { teamId, purpose: "package", format: "zip", requestId: hubKey([key.action, key.requestId, "package"]) }, bytes)
  }

  private async uploadIcon(op: HubAccountOperation, caller: SkillHubCaller, key: SkillHubReceiptInput, teamId: string, iconPath: string) {
    if (this.iconsInFlight >= 2) throw new SkillHubDesktopError("HUB_PREPARE_BUSY", "当前正在处理其他 Skill 图标，请稍后重试。")
    this.iconsInFlight++
    try {
      const bytes = await prepareHubIcon(iconPath, this.deps, caller, op.signal)
      return (await this.deps.cloud.upload(op, { teamId, purpose: "icon", requestId: hubKey([key.action, key.requestId, "icon"]) }, bytes)).uploadId
    } finally {
      this.iconsInFlight--
    }
  }

  private write<T extends { skill?: SkillHubDetail } | { id: string } | { replayed: true }>(
    caller: SkillHubCaller, key: SkillHubReceiptInput, targetId: string, fields: unknown[],
    work: (op: HubAccountOperation, submit: (commit: () => Promise<T>) => Promise<T>) => Promise<T>,
  ) {
    let submitted = false
    return this.run(caller, key.action, async (op) => {
      const id = this.intentId(key)
      const inputDigest = hubKey(fields)
      const callerKey = hubCallerKey(caller)
      const prior = await this.intents.get(id)
      if (prior) {
        if (prior.accountId !== op.scope.accountId) throw hubAccountChanged()
        if (prior.inputDigest !== inputDigest || prior.callerKey !== callerKey) {
          throw new SkillHubDesktopError("HUB_REQUEST_CONFLICT", "此请求标识已用于另一项操作。")
        }
        const receipt = await this.deps.cloud.receipt(op, key)
        if (receipt.status === "committed") return { replayed: true as const, receipt }
      }
      const submit = async (commit: () => Promise<T>) => {
        if (!prior) {
          const record: HubWriteIntent = {
            id, schemaVersion: 1, accountId: op.scope.accountId, callerKey, ...key, targetId, inputDigest, createdAt: Date.now(),
          }
          const inserted = await this.deps.repository.commitBatch?.({
            guards: [], operations: [{ kind: "insert", namespace: skillHubWriteIntentsSchema.name, id, value: record }],
          })
          if (!inserted?.committed) throw new SkillHubDesktopError("HUB_REQUEST_IN_PROGRESS", "同一请求正在处理，请使用原请求标识查询回执。", key)
        }
        try {
          this.deps.cloud.assertActive(op)
          submitted = true
          const result = await commit()
          this.deps.cloud.assertActive(op)
          return result
        } catch (error) {
          if (error instanceof SkillHubDesktopError && !ambiguous.has(error.code)) throw error
          throw this.unknownWrite(key)
        }
      }
      const result = await work(op, submit)
      if ("skill" in result && result.skill) return { ...result, skill: this.withLink(result.skill) }
      return result
    }).catch((error: unknown) => {
      if (submitted && error instanceof SkillHubDesktopError && ambiguous.has(error.code)) throw this.unknownWrite(key)
      throw error
    })
  }

  private unknownWrite(key: SkillHubReceiptInput) {
    return new SkillHubDesktopError("HUB_WRITE_UNKNOWN", "暂不能确认写入结果；请在原账号下使用此请求标识查询回执。", key)
  }
}
