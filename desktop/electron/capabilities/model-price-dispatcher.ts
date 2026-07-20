import type { DatabaseSync } from "node:sqlite"
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"
import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../runtime/security"
import { createMainLogger } from "../services/log-store"
import { sanitizeError } from "../services/error-sanitize"
import {
  ModelPriceService,
  MODEL_PRICE_COVERAGE_DEFAULT_LIMIT,
  MODEL_PRICE_COVERAGE_MAX_LIMIT,
  isModelPricePresetId,
  type ModelPriceCoverageInput,
  type ModelPriceCoverageRange,
  type ModelPriceCoverageSource,
  type ModelPricePresetId,
  type ModelPriceRuleInput,
  type ModelPriceRulePatch,
} from "../services/model-price"
import { checkCapabilityPermission } from "./permission-audit"

type ModelPriceDispatcherDeps = {
  readonly db: DatabaseSync
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly actor?: ActorIdentity
  readonly logger?: ModelPriceDispatcherLogger
}

type ModelPriceDispatcherLogger = Pick<ReturnType<typeof createMainLogger>, "info" | "warn">

type MutableModelPriceRulePatch = {
  -readonly [Key in keyof ModelPriceRulePatch]: ModelPriceRulePatch[Key]
}

const RANGE_PRESETS: readonly ModelPriceCoverageRange[] = ["today", "7d", "30d", "90d", "all"]
const PRICE_FIELDS = ["inputPer1M", "outputPer1M", "cacheReadPer1M", "cacheWritePer1M", "reasoningPer1M"] as const
const MODEL_PRICE_MUTATION_ACTIONS = new Set([
  "app.model_price.preset.import",
  "app.model_price.rule.create",
  "app.model_price.rule.update",
  "app.model_price.rule.clear",
  "app.model_price.rule.delete",
  "app.model_price.rule.enable",
  "app.model_price.rule.disable",
])
const MODEL_PRICE_READ_ACTIONS = new Set([
  "app.model_price.used_model.list",
  "app.model_price.preset.list",
  "app.model_price.rule.list",
  "app.model_price.rule.get",
])
const DEFAULT_ACTOR: ActorIdentity = { kind: "user", id: "synapse-mcp", display: "Synapse MCP" }
const defaultLogger = createMainLogger("capability.model-price-dispatcher")

export function createModelPriceCapabilityDispatcher(deps: ModelPriceDispatcherDeps) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      const logger = deps.logger ?? defaultLogger
      const correlation = dispatchCorrelation(action, params, context)
      logger.info("model price mcp dispatch", correlation)
      const security = modelPriceDispatchSecurity(deps, action, params, context)
      if (security) await authorizeModelPriceDispatch(deps, security)
      try {
        const result = dispatchModelPriceAction(deps.db, action, params)
        if (security) {
          deps.auditSink?.record({
            action: security.action,
            actor: security.actor,
            resource: security.resource,
            outcome: "allowed",
            metadata: security.metadata,
          })
        }
        logger.info("model price mcp dispatch succeeded", correlation)
        return result
      } catch (error) {
        if (security) {
          deps.auditSink?.record({
            action: security.action,
            actor: security.actor,
            resource: security.resource,
            outcome: "failed",
            metadata: {
              ...security.metadata,
              errorName: error instanceof Error ? error.name : typeof error,
              errorLength: String(error).length,
            },
          })
        }
        logger.warn("model price mcp dispatch failed", {
          ...correlation,
          ...dispatchErrorDiagnostic(error),
        })
        throw error
      }
    },
  }
}

function dispatchCorrelation(
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): Record<string, unknown> {
  const correlation: Record<string, unknown> = {
    action,
    source: context.source ?? "api",
  }
  if (typeof params.ruleId === "string" && params.ruleId.trim()) {
    correlation.ruleId = sanitizeError(params.ruleId.trim())
  }
  if (typeof params.presetId === "string" && params.presetId.trim()) {
    correlation.presetId = sanitizeError(params.presetId.trim())
  }
  if (typeof params.modelPattern === "string" && params.modelPattern.trim()) {
    correlation.hasModelPattern = true
  }
  if (PRICE_FIELDS.some((field) => field in params)) {
    correlation.hasPricePatch = true
  }
  if ("enabled" in params) {
    correlation.hasEnabled = true
  }
  return correlation
}

function dispatchErrorDiagnostic(error: unknown): {
  readonly errorName: string
  readonly errorMessage: string
} {
  const message = error instanceof Error ? error.message : String(error)
  const sanitized = sanitizeError(message)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: sanitized.length <= 200 ? sanitized : sanitized.slice(0, 200) + "...",
  }
}

function dispatchModelPriceAction(
  db: DatabaseSync,
  action: string,
  params: Record<string, unknown>,
): DispatchResult {
  const service = new ModelPriceService(db)
  switch (action) {
    case "app.model_price.used_model.list":
      return { ok: true, data: service.listCoverage(readCoverageParams(params)) }
    case "app.model_price.preset.list":
      return { ok: true, data: service.listPresets() }
    case "app.model_price.preset.import":
      return { ok: true, data: service.importPreset(requirePresetId(params)) }
    case "app.model_price.rule.list":
      return { ok: true, data: service.listRules() }
    case "app.model_price.rule.get":
      return { ok: true, data: requireRule(service, requireString(params, "ruleId")) }
    case "app.model_price.rule.create":
      return { ok: true, data: service.createRule(readCreateParams(params)) }
    case "app.model_price.rule.update":
      return { ok: true, data: service.updateRule(requireString(params, "ruleId"), readPatchParams(params)) }
    case "app.model_price.rule.clear":
      return { ok: true, data: service.clearRules() }
    case "app.model_price.rule.delete":
      return { ok: true, data: service.deleteRule(requireString(params, "ruleId")) }
    case "app.model_price.rule.enable":
      return { ok: true, data: service.setRuleEnabled(requireString(params, "ruleId"), true) }
    case "app.model_price.rule.disable":
      return { ok: true, data: service.setRuleEnabled(requireString(params, "ruleId"), false) }
    default:
      throw new Error(`Unknown action: ${action}`)
  }
}

type ModelPriceDispatchSecurity = {
  readonly action: Extract<PermissionAction, "database.read" | "database.mutate">
  readonly actor: ActorIdentity
  readonly resource: string
  readonly metadata: Record<string, unknown>
}

function modelPriceDispatchSecurity(
  deps: ModelPriceDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): ModelPriceDispatchSecurity | null {
  if (MODEL_PRICE_READ_ACTIONS.has(action)) {
    return modelPriceReadSecurity(deps, action, params, context)
  }
  if (!MODEL_PRICE_MUTATION_ACTIONS.has(action)) return null
  const resource = modelPriceMutationResource(action, params)
  const ruleId = typeof params.ruleId === "string" && params.ruleId.trim() ? sanitizeError(params.ruleId.trim()) : undefined
  const presetId = typeof params.presetId === "string" && params.presetId.trim() ? sanitizeError(params.presetId.trim()) : undefined
  return {
    action: "database.mutate",
    actor: context.actor ?? deps.actor ?? DEFAULT_ACTOR,
    resource,
    metadata: {
      source: context.source ?? "api",
      modelPriceAction: action,
      ...(ruleId ? { ruleId } : undefined),
      ...(presetId ? { presetId } : undefined),
    },
  }
}

function modelPriceReadSecurity(
  deps: ModelPriceDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): ModelPriceDispatchSecurity {
  const ruleId = typeof params.ruleId === "string" && params.ruleId.trim() ? params.ruleId.trim() : undefined
  const auditRuleId = ruleId ? sanitizeError(ruleId) : undefined
  const resource = action === "app.model_price.used_model.list"
    ? "model-price:used-models"
    : action === "app.model_price.preset.list"
      ? "model-price-presets"
      : action === "app.model_price.rule.list"
        ? "model-price-rules"
        : `model-price-rule:${auditRuleId ?? action}`
  return {
    action: "database.read",
    actor: context.actor ?? deps.actor ?? DEFAULT_ACTOR,
    resource,
    metadata: {
      source: context.source ?? "api",
      modelPriceAction: action,
      ...(auditRuleId ? { ruleId: auditRuleId } : undefined),
    },
  }
}

function modelPriceMutationResource(action: string, params: Record<string, unknown>): string {
  if (action === "app.model_price.preset.import") {
    const presetId = typeof params.presetId === "string" && params.presetId.trim()
      ? sanitizeError(params.presetId.trim())
      : action
    return `model-price-preset:${presetId}`
  }
  if (action === "app.model_price.rule.clear") return "model-price-rules"
  const ruleId = typeof params.ruleId === "string" && params.ruleId.trim()
    ? sanitizeError(params.ruleId.trim())
    : action
  return `model-price-rule:${ruleId}`
}

async function authorizeModelPriceDispatch(
  deps: ModelPriceDispatcherDeps,
  security: ModelPriceDispatchSecurity,
): Promise<void> {
  const permission = await checkCapabilityPermission({
    permissionGuard: deps.permissionGuard,
    auditSink: deps.auditSink,
    action: security.action,
    actor: security.actor,
    resource: security.resource,
    context: security.metadata,
  })
  if (permission && !permission.allowed) {
    deps.auditSink?.record({
      action: security.action,
      actor: security.actor,
      resource: security.resource,
      outcome: "denied",
      metadata: {
        ...security.metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or invalid '${key}': expected non-empty string`)
  }
  return value.trim()
}

function requirePresetId(params: Record<string, unknown>): ModelPricePresetId {
  const presetId = requireString(params, "presetId")
  if (!isModelPricePresetId(presetId)) {
    throw new Error("Invalid 'presetId': expected a built-in model price preset ID")
  }
  return presetId
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`Invalid '${key}': expected boolean`)
  return value
}

function optionalPrice(params: Record<string, unknown>, key: typeof PRICE_FIELDS[number]): number | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid '${key}': expected number >= 0`)
  }
  return value
}

function readCreateParams(params: Record<string, unknown>): ModelPriceRuleInput {
  return {
    modelPattern: requireString(params, "modelPattern"),
    inputPer1M: optionalPrice(params, "inputPer1M"),
    outputPer1M: optionalPrice(params, "outputPer1M"),
    cacheReadPer1M: optionalPrice(params, "cacheReadPer1M"),
    cacheWritePer1M: optionalPrice(params, "cacheWritePer1M"),
    reasoningPer1M: optionalPrice(params, "reasoningPer1M"),
    enabled: optionalBoolean(params, "enabled") ?? true,
  }
}

function readPatchParams(params: Record<string, unknown>): ModelPriceRulePatch {
  const patch: MutableModelPriceRulePatch = {}
  if ("modelPattern" in params) patch.modelPattern = requireString(params, "modelPattern")
  for (const field of PRICE_FIELDS) {
    if (field in params) {
      const value = optionalPrice(params, field)
      if (value !== undefined) patch[field] = value
    }
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("No model price fields provided for update")
  }
  return patch
}

function requireRule(service: ModelPriceService, ruleId: string) {
  const rule = service.getRule(ruleId)
  if (!rule) throw new Error(`Model price rule not found: ${ruleId}`)
  return rule
}

function readCoverageParams(params: Record<string, unknown>): ModelPriceCoverageInput {
  return {
    source: normalizeSource(params.source),
    range: normalizeRange(params.range),
    limit: normalizeLimit(params.limit),
  }
}

function normalizeSource(value: unknown): ModelPriceCoverageSource {
  if (value === undefined) return "all"
  if (value === "all" || value === "cc" || value === "codex") return value
  throw new Error("Invalid 'source': expected all, cc, or codex")
}

function normalizeRange(value: unknown): ModelPriceCoverageRange {
  if (value === undefined) return "all"
  if (typeof value === "string" && RANGE_PRESETS.includes(value as ModelPriceCoverageRange)) return value as ModelPriceCoverageRange
  throw new Error("Invalid 'range': expected today, 7d, 30d, 90d, or all")
}

function normalizeLimit(value: unknown): number {
  if (value === undefined) return MODEL_PRICE_COVERAGE_DEFAULT_LIMIT
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new Error("Invalid 'limit': expected positive number")
  }
  return Math.min(Math.floor(value), MODEL_PRICE_COVERAGE_MAX_LIMIT)
}
