import type { Stats } from "node:fs"
import { lstat as fsLstat, realpath as fsRealpath } from "node:fs/promises"

import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../runtime/security"
import type { AgentReferenceActionResult } from "../../src/types/agent-reference-action"
import { AgentReferenceActionFailure } from "./agent-reference-actions/failure"
import { isExpectedFilesystemUnavailableError } from "./agent-reference-actions/filesystem-error"
import {
  resolveAgentReference,
  type ResolvedAgentReference,
} from "./agent-reference-actions/path-validation"
import {
  awaitAgentReferencePreflight,
  createAgentReferencePreflight,
  ensureAgentReferencePreflightActive,
  type AgentReferencePreflight,
} from "./agent-reference-actions/preflight"
import {
  isOpenableReference,
  isRedirectingLeaf,
  isRevealableReference,
  revalidateOpenReferenceTarget,
  revalidateRevealReferenceTarget,
  type AgentReferenceParentSnapshot,
  type AgentReferenceSnapshot,
} from "./agent-reference-actions/target-snapshot"

export const AGENT_REFERENCE_ACTION_SERVICE_ID = "core.agent-reference-actions"
export const AGENT_REFERENCE_UNC_TIMEOUT_MS = 10_000

export {
  AGENT_REFERENCE_ACTION_ERROR_CODES,
  AGENT_REFERENCE_MAX_CODE_POINTS,
} from "../../src/types/agent-reference-action"
export type {
  AgentReferenceActionErrorCode,
  AgentReferenceActionResult,
} from "../../src/types/agent-reference-action"

export type AgentReferenceActionKind = "open_default" | "show_in_folder"

export interface AgentReferenceActionRequest {
  readonly projectId: string
  readonly projectRoot: string
  readonly reference: string
  readonly actor: ActorIdentity
  readonly abortSignal?: AbortSignal
}

type AgentReferenceActionLogger = {
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
}

export class AgentReferenceActionService {
  constructor(private readonly deps: {
    readonly permissionGuard: PermissionGuard
    readonly auditSink: AuditSink
    readonly openPath: (targetPath: string) => Promise<string>
    readonly showItemInFolder: (targetPath: string) => void
    readonly platform?: NodeJS.Platform
    readonly lstat?: (targetPath: string) => Promise<Stats>
    readonly realpath?: (targetPath: string) => Promise<string>
    readonly now?: () => number
    readonly logger?: AgentReferenceActionLogger
  }) {}

  async openDefault(request: AgentReferenceActionRequest): Promise<AgentReferenceActionResult> {
    return this.execute("open_default", request)
  }

  async showInFolder(request: AgentReferenceActionRequest): Promise<AgentReferenceActionResult> {
    return this.execute("show_in_folder", request)
  }

  validateInput(reference: string): AgentReferenceActionResult {
    try {
      const platform = this.deps.platform ?? process.platform
      resolveAgentReference(reference, platform === "win32" ? "C:\\" : "/", platform)
      return { ok: true }
    } catch (error) {
      if (error instanceof AgentReferenceActionFailure) {
        return { ok: false, code: error.code }
      }
      throw error
    }
  }

  private async execute(
    action: AgentReferenceActionKind,
    request: AgentReferenceActionRequest,
  ): Promise<AgentReferenceActionResult> {
    try {
      const platform = this.deps.platform ?? process.platform
      const resolved = resolveAgentReference(request.reference, request.projectRoot, platform)
      const preflight = createAgentReferencePreflight({
        hasNetworkBoundary: Boolean(resolved.uncBoundary),
        timeoutMs: AGENT_REFERENCE_UNC_TIMEOUT_MS,
        abortSignal: request.abortSignal,
        now: this.now,
      })
      if (resolved.uncBoundary) {
        await this.authorize(
          "network.connect",
          request,
          resolved.uncBoundary,
          action,
          "network",
          preflight,
        )
      }
      return action === "open_default"
        ? await this.openResolved(request, resolved, preflight)
        : await this.showResolved(request, resolved, preflight)
    } catch (error) {
      if (error instanceof AgentReferenceActionFailure) {
        this.deps.logger?.warn("agent reference action failed", {
          action,
          code: error.code,
          stage: error.stage,
        })
        return { ok: false, code: error.code }
      }
      throw error
    }
  }

  private async openResolved(
    request: AgentReferenceActionRequest,
    resolved: ResolvedAgentReference,
    preflight: AgentReferencePreflight,
  ): Promise<AgentReferenceActionResult> {
    const action = "open_default"
    await this.authorize(
      "fs.read.outside-userdata",
      request,
      resolved.surfacePath,
      action,
      "surface",
      preflight,
    )
    const surface = await this.readInitialSnapshot(resolved.surfacePath, request, action, "surface", preflight)
    if (surface.stats.isSymbolicLink()) {
      this.recordFailure("fs.read.outside-userdata", request, resolved.surfacePath, action, "surface", "symbolic_link")
      throw new AgentReferenceActionFailure("symbolic_link_not_supported", "surface_type")
    }
    if (!isOpenableReference(surface.stats)) {
      this.recordFailure("fs.read.outside-userdata", request, resolved.surfacePath, action, "surface", "unsupported_type")
      throw new AgentReferenceActionFailure("unsupported_object_type", "surface_type")
    }

    let realPath: string | undefined
    let realStats: Stats
    let parentSnapshot: AgentReferenceParentSnapshot | undefined
    try {
      realPath = await this.realpath(resolved.surfacePath, preflight, "realpath")
      const surfaceParent = resolved.pathApi.dirname(resolved.surfacePath)
      let expectedRealPath: string | undefined
      if (surfaceParent !== resolved.surfacePath) {
        const realParent = await this.realpath(surfaceParent, preflight, "surface_parent_realpath")
        expectedRealPath = resolved.pathApi.join(
          realParent,
          resolved.pathApi.basename(resolved.surfacePath),
        )
        parentSnapshot = {
          surfacePath: surfaceParent,
          realPath: realParent,
        }
      }
      await this.authorize(
        "fs.read.outside-userdata",
        request,
        realPath,
        action,
        "real",
        preflight,
      )
      realStats = await this.lstat(realPath, preflight, "real_lstat")
      if (expectedRealPath && isRedirectingLeaf({
        surfaceStats: surface.stats,
        realStats,
        realPath,
        expectedRealPath,
        platform: this.deps.platform ?? process.platform,
      })) {
        this.recordFailure(
          "fs.read.outside-userdata",
          request,
          resolved.surfacePath,
          action,
          "surface",
          "redirecting_leaf",
        )
        throw new AgentReferenceActionFailure("symbolic_link_not_supported", "surface_redirect")
      }
    } catch (error) {
      if (error instanceof AgentReferenceActionFailure) throw error
      if (!isExpectedFilesystemUnavailableError(error)) throw error
      this.recordFailure(
        "fs.read.outside-userdata",
        request,
        realPath ?? resolved.surfacePath,
        action,
        "real",
        "not_found_or_inaccessible",
      )
      throw new AgentReferenceActionFailure("not_found_or_inaccessible", "realpath")
    }
    if (!realPath) throw new Error("Agent reference real path invariant failed.")
    if (!isOpenableReference(realStats)) {
      this.recordFailure("fs.read.outside-userdata", request, realPath, action, "real", "unsupported_type")
      throw new AgentReferenceActionFailure("unsupported_object_type", "real_type")
    }

    try {
      await revalidateOpenReferenceTarget({
        surfacePath: resolved.surfacePath,
        surface,
        realPath,
        realStats,
        parentSnapshot,
        platform: this.deps.platform ?? process.platform,
        io: this.snapshotIo(preflight),
      })
    } catch (error) {
      if (error instanceof AgentReferenceActionFailure && error.code === "target_changed") {
        this.recordFailure("fs.read.outside-userdata", request, realPath, action, "recheck", "target_changed")
      }
      throw error
    }

    await this.authorize("shell.exec", request, realPath, action, "system", preflight)
    this.ensureActive(preflight)
    try {
      const rejection = await this.deps.openPath(realPath)
      if (rejection !== "") {
        this.recordFailure("shell.exec", request, realPath, action, "system", "system_rejected")
        throw new AgentReferenceActionFailure("system_rejected", "system_call")
      }
    } catch (error) {
      if (error instanceof AgentReferenceActionFailure) throw error
      this.recordFailure("shell.exec", request, realPath, action, "system", "system_failed")
      throw new AgentReferenceActionFailure("system_failed", "system_call")
    }
    this.record("shell.exec", request, realPath, action, "system", "allowed")
    this.deps.logger?.info("agent reference action submitted", { action })
    return { ok: true }
  }

  private async showResolved(
    request: AgentReferenceActionRequest,
    resolved: ResolvedAgentReference,
    preflight: AgentReferencePreflight,
  ): Promise<AgentReferenceActionResult> {
    const action = "show_in_folder"
    await this.authorize(
      "fs.read.outside-userdata",
      request,
      resolved.surfacePath,
      action,
      "surface",
      preflight,
    )
    const surface = await this.readInitialSnapshot(resolved.surfacePath, request, action, "surface", preflight)
    if (!isRevealableReference(surface.stats)) {
      this.recordFailure("fs.read.outside-userdata", request, resolved.surfacePath, action, "surface", "unsupported_type")
      throw new AgentReferenceActionFailure("unsupported_object_type", "surface_type")
    }

    const parentPath = resolved.pathApi.dirname(resolved.surfacePath)
    if (parentPath === resolved.surfacePath) {
      this.recordFailure("fs.read.outside-userdata", request, resolved.surfacePath, action, "surface", "no_parent")
      throw new AgentReferenceActionFailure("no_parent_directory", "parent")
    }
    let actualParentPath: string | undefined
    let parentStats: Stats
    try {
      actualParentPath = await this.realpath(parentPath, preflight, "parent_realpath")
      await this.authorize(
        "fs.read.outside-userdata",
        request,
        actualParentPath,
        action,
        "parent",
        preflight,
      )
      parentStats = await this.lstat(actualParentPath, preflight, "parent_lstat")
    } catch (error) {
      if (error instanceof AgentReferenceActionFailure) throw error
      if (!isExpectedFilesystemUnavailableError(error)) throw error
      this.recordFailure(
        "fs.read.outside-userdata",
        request,
        actualParentPath ?? parentPath,
        action,
        "parent",
        "not_found_or_inaccessible",
      )
      throw new AgentReferenceActionFailure("not_found_or_inaccessible", "parent")
    }
    if (!actualParentPath) throw new Error("Agent reference parent path invariant failed.")
    if (!parentStats.isDirectory()) {
      this.recordFailure("fs.read.outside-userdata", request, actualParentPath, action, "parent", "unsupported_type")
      throw new AgentReferenceActionFailure("unsupported_object_type", "parent_type")
    }

    const locatedPath = resolved.pathApi.join(
      actualParentPath,
      resolved.pathApi.basename(resolved.surfacePath),
    )
    try {
      await revalidateRevealReferenceTarget({
        surfacePath: resolved.surfacePath,
        surface,
        parentPath,
        actualParentPath,
        parentStats,
        platform: this.deps.platform ?? process.platform,
        io: this.snapshotIo(preflight),
      })
    } catch (error) {
      if (error instanceof AgentReferenceActionFailure && error.code === "target_changed") {
        this.recordFailure(
          "fs.read.outside-userdata",
          request,
          resolved.surfacePath,
          action,
          "recheck",
          "target_changed",
        )
      }
      throw error
    }

    await this.authorize("shell.exec", request, locatedPath, action, "system", preflight)
    this.ensureActive(preflight)
    try {
      this.deps.showItemInFolder(locatedPath)
    } catch {
      this.recordFailure("shell.exec", request, locatedPath, action, "system", "system_failed")
      throw new AgentReferenceActionFailure("system_failed", "system_call")
    }
    this.record("shell.exec", request, locatedPath, action, "system", "allowed")
    this.deps.logger?.info("agent reference action submitted", { action })
    return { ok: true }
  }

  private async readInitialSnapshot(
    targetPath: string,
    request: AgentReferenceActionRequest,
    action: AgentReferenceActionKind,
    stage: string,
    preflight: AgentReferencePreflight,
  ): Promise<AgentReferenceSnapshot> {
    try {
      return { stats: await this.lstat(targetPath, preflight, `${stage}_lstat`) }
    } catch (error) {
      if (error instanceof AgentReferenceActionFailure) throw error
      if (!isExpectedFilesystemUnavailableError(error)) throw error
      this.recordFailure("fs.read.outside-userdata", request, targetPath, action, stage, "not_found_or_inaccessible")
      throw new AgentReferenceActionFailure("not_found_or_inaccessible", `${stage}_lstat`)
    }
  }

  private async authorize(
    permission: PermissionAction,
    request: AgentReferenceActionRequest,
    resource: string,
    action: AgentReferenceActionKind,
    stage: string,
    preflight: AgentReferencePreflight,
  ): Promise<void> {
    const result = await this.awaitPreflight(
      () => this.deps.permissionGuard.check({
        action: permission,
        actor: request.actor,
        resource,
        context: {
          projectId: request.projectId,
          source: "agent.reference.context-menu",
          operation: action,
          stage,
        },
      }),
      preflight,
      `${stage}_permission`,
    )
    if (result.allowed) {
      if (permission !== "shell.exec") {
        this.record(permission, request, resource, action, stage, "allowed")
      }
      return
    }
    this.deps.auditSink.record({
      action: permission,
      actor: request.actor,
      resource,
      outcome: "denied",
      metadata: {
        projectId: request.projectId,
        source: "agent.reference.context-menu",
        operation: action,
        stage,
        policyId: result.policyId,
      },
    })
    throw new AgentReferenceActionFailure("permission_denied", `${stage}_permission`)
  }

  private record(
    permission: PermissionAction,
    request: AgentReferenceActionRequest,
    resource: string,
    action: AgentReferenceActionKind,
    stage: string,
    outcome: "allowed" | "failed",
    failureKind?: string,
  ): void {
    this.deps.auditSink.record({
      action: permission,
      actor: request.actor,
      resource,
      outcome,
      metadata: {
        projectId: request.projectId,
        source: "agent.reference.context-menu",
        operation: action,
        stage,
        ...(failureKind ? { failureKind } : {}),
      },
    })
  }

  private recordFailure(
    permission: PermissionAction,
    request: AgentReferenceActionRequest,
    resource: string,
    action: AgentReferenceActionKind,
    stage: string,
    failureKind: string,
  ): void {
    this.record(permission, request, resource, action, stage, "failed", failureKind)
  }

  private async lstat(
    targetPath: string,
    preflight: AgentReferencePreflight,
    stage: string,
  ): Promise<Stats> {
    return this.awaitPreflight(() => (this.deps.lstat ?? fsLstat)(targetPath), preflight, stage)
  }

  private async realpath(
    targetPath: string,
    preflight: AgentReferencePreflight,
    stage: string,
  ): Promise<string> {
    return this.awaitPreflight(() => (this.deps.realpath ?? fsRealpath)(targetPath), preflight, stage)
  }

  private snapshotIo(preflight: AgentReferencePreflight) {
    return {
      lstat: (targetPath: string, stage: string) => this.lstat(targetPath, preflight, stage),
      realpath: (targetPath: string, stage: string) => this.realpath(targetPath, preflight, stage),
    }
  }

  private awaitPreflight<T>(
    operation: () => Promise<T>,
    preflight: AgentReferencePreflight,
    stage: string,
  ): Promise<T> {
    return awaitAgentReferencePreflight(operation, preflight, stage, this.now)
  }

  private ensureActive(preflight: AgentReferencePreflight): void {
    ensureAgentReferencePreflightActive(preflight, this.now)
  }

  private readonly now = (): number => this.deps.now?.() ?? Date.now()
}
