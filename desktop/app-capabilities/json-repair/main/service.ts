import { repairJson } from "repair-json-stream"
import {
  extractAllJson,
  stripLlmWrapper,
} from "repair-json-stream/extract"
import type {
  ActorIdentity,
  AuditSink,
} from "../../../electron/runtime/security"
import type { StructuredLogger } from "../../../electron/runtime/service-registry"
import {
  JsonRepairError,
  serializeJsonRepairError,
} from "../shared/errors"
import {
  JSON_REPAIR_INPUT_MAX_BYTES,
  type JsonRepairResult,
  type ValidatedJsonRepairInput,
  utf8ByteLength,
} from "../shared/schema"
import {
  assertRepairedTextResources,
  containsNonFiniteNumber,
} from "./limits"

export interface JsonRepairCallContext {
  readonly source: string
  readonly actor: ActorIdentity
  readonly clientId?: string
  readonly controllerInstanceId?: string
  readonly workflowId?: string
  readonly runId?: string
  readonly nodeId?: string
}

export interface JsonRepairServiceOptions {
  readonly auditSink?: Pick<AuditSink, "record">
  readonly logger?: Pick<StructuredLogger, "warn">
  readonly upstream?: Partial<JsonRepairUpstream>
}

export interface JsonRepairUpstream {
  readonly repairJson: typeof repairJson
  readonly stripLlmWrapper: typeof stripLlmWrapper
  readonly extractAllJson: typeof extractAllJson
}

const defaultUpstream: JsonRepairUpstream = {
  repairJson,
  stripLlmWrapper,
  extractAllJson,
}

type AttemptState = {
  readonly attemptedInputs: Set<string>
  sawEmbeddedCandidate: boolean
  sawNonFiniteNumber: boolean
  sawUpstreamFailure: boolean
}

export class JsonRepairService {
  private readonly auditSink?: Pick<AuditSink, "record">
  private readonly logger?: Pick<StructuredLogger, "warn">
  private readonly upstream: JsonRepairUpstream

  constructor(options: JsonRepairServiceOptions = {}) {
    this.auditSink = options.auditSink
    this.logger = options.logger
    this.upstream = { ...defaultUpstream, ...options.upstream }
  }

  repair(
    input: ValidatedJsonRepairInput,
    context: JsonRepairCallContext,
  ): JsonRepairResult {
    const inputBytes = utf8ByteLength(input.text)
    if (inputBytes > JSON_REPAIR_INPUT_MAX_BYTES) {
      throw new JsonRepairError("INPUT_TOO_LARGE")
    }

    try {
      const result = this.runPipeline(input.text)
      this.recordAudit(context, "allowed", {
        inputBytes,
        outputBytes: utf8ByteLength(result.json),
      })
      return result
    } catch (error) {
      const serialized = serializeJsonRepairError(error)
      this.recordAudit(context, "failed", {
        inputBytes,
        errorCode: serialized.code,
      })
      if (error instanceof JsonRepairError) throw error
      throw new JsonRepairError("INTERNAL_ERROR")
    }
  }

  private runPipeline(text: string): JsonRepairResult {
    const source = unwrapSingleJsonFence(text)
    const state: AttemptState = {
      attemptedInputs: new Set(),
      sawEmbeddedCandidate: false,
      sawNonFiniteNumber: false,
      sawUpstreamFailure: false,
    }

    const wholeResult = this.tryRepair(source, state)
    if (wholeResult) return wholeResult

    let stripped: string | null = null
    try {
      stripped = this.upstream.stripLlmWrapper(source)
      if (typeof stripped !== "string") throw new JsonRepairError("INTERNAL_ERROR")
    } catch (error) {
      if (error instanceof JsonRepairError) throw error
      state.sawUpstreamFailure = true
    }
    if (stripped !== null) {
      const strippedResult = this.tryRepair(stripped, state)
      if (strippedResult) return strippedResult
    }

    let candidates: string[] = []
    try {
      candidates = this.upstream.extractAllJson(source)
      if (!Array.isArray(candidates) || candidates.some((candidate) => typeof candidate !== "string")) {
        throw new JsonRepairError("INTERNAL_ERROR")
      }
    } catch (error) {
      if (error instanceof JsonRepairError) throw error
      state.sawUpstreamFailure = true
    }

    state.sawEmbeddedCandidate = candidates.length > 0
    for (const candidate of candidates) {
      const candidateResult = this.tryRepair(candidate, state)
      if (candidateResult) return candidateResult
    }

    if (state.sawNonFiniteNumber) throw new JsonRepairError("NON_FINITE_NUMBER")
    if (state.sawEmbeddedCandidate || state.sawUpstreamFailure) {
      throw new JsonRepairError("JSON_REPAIR_FAILED")
    }
    throw new JsonRepairError("NO_JSON_FOUND")
  }

  private tryRepair(input: string, state: AttemptState): JsonRepairResult | null {
    if (state.attemptedInputs.has(input)) return null
    state.attemptedInputs.add(input)

    let repaired: string
    try {
      repaired = this.upstream.repairJson(input)
      if (typeof repaired !== "string") throw new JsonRepairError("INTERNAL_ERROR")
    } catch (error) {
      if (error instanceof JsonRepairError) throw error
      state.sawUpstreamFailure = true
      return null
    }

    assertRepairedTextResources(repaired)

    let parsed: unknown
    try {
      parsed = JSON.parse(repaired)
    } catch {
      return null
    }
    if (containsNonFiniteNumber(parsed)) {
      state.sawNonFiniteNumber = true
      return null
    }
    return { json: repaired }
  }

  private recordAudit(
    context: JsonRepairCallContext,
    outcome: "allowed" | "failed",
    resultMetadata: Record<string, unknown>,
  ): void {
    if (!this.auditSink) return
    try {
      this.auditSink.record({
        action: "json.repair",
        actor: context.actor,
        resource: "app.json_repair.text.repair",
        outcome,
        metadata: {
          source: context.source,
          ...resultMetadata,
          ...(context.clientId ? { clientId: context.clientId } : {}),
          ...(context.controllerInstanceId
            ? { controllerInstanceId: context.controllerInstanceId }
            : {}),
          ...(context.workflowId ? { workflowId: context.workflowId } : {}),
          ...(context.runId ? { runId: context.runId } : {}),
          ...(context.nodeId ? { nodeId: context.nodeId } : {}),
        },
      })
    } catch {
      this.logger?.warn("JSON repair audit record failed.", {
        stage: "audit_record",
        reason: "sink_failure",
      })
    }
  }
}

export function unwrapSingleJsonFence(input: string): string {
  const trimmed = input.trim()
  const match = /^(?:```|```json)\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed)
  return match?.[1] ?? input
}
