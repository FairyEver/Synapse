import { app } from "electron"
import { MODEL_PRICE_CHANNELS } from "./channels"
import { handleValidatedIpc } from "../ipc/validated-ipc"
import { createMainLogger } from "../services/log-store"
import { getUsageAnalysisDb } from "../services/usage-analysis"
import {
  isModelPricePresetId,
  MODEL_PRICE_COVERAGE_DEFAULT_LIMIT,
  MODEL_PRICE_COVERAGE_MAX_LIMIT,
  ModelPriceService,
  type ModelPriceCoverageInput,
  type ModelPricePresetId,
  type ModelPriceRuleInput,
} from "../services/model-price"

let registered = false
const PRICE_FIELDS = [
  "inputPer1M",
  "outputPer1M",
  "cacheReadPer1M",
  "cacheWritePer1M",
  "reasoningPer1M",
] as const

type MutableModelPriceRuleInput = {
  -readonly [Key in keyof ModelPriceRuleInput]: ModelPriceRuleInput[Key]
}

export function normalizeModelPriceCoverageInput(input: ModelPriceCoverageInput | undefined): ModelPriceCoverageInput {
  const source = input?.source
  const range = input?.range
  const limit = Number(input?.limit)
  return {
    source: source === "cc" || source === "codex" || source === "all" ? source : "all",
    range: range === "today" || range === "7d" || range === "30d" || range === "90d" || range === "all" ? range : "30d",
    limit: Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), MODEL_PRICE_COVERAGE_MAX_LIMIT)
      : MODEL_PRICE_COVERAGE_DEFAULT_LIMIT,
  }
}

export function registerModelPriceHandlers(): void {
  if (registered) return
  const logger = createMainLogger("model-price.ipc")
  const db = getUsageAnalysisDb(app.getPath("userData"))
  const modelPrice = new ModelPriceService(db)

  handleValidatedIpc(MODEL_PRICE_CHANNELS.coverageList, async (_event, input?: ModelPriceCoverageInput) => {
    const normalized = normalizeModelPriceCoverageInput(input)
    logger.info("Model price coverage requested.", normalized)
    return modelPrice.listCoverage(normalized)
  })
  handleValidatedIpc(MODEL_PRICE_CHANNELS.presetsList, async () => modelPrice.listPresets())
  handleValidatedIpc(MODEL_PRICE_CHANNELS.presetsImport, async (_event, input?: unknown) => {
    const presetIds = validateModelPricePresetImportInput(input)
    const importedRules = modelPrice.importPresets(presetIds)
    logger.info("Model price preset import completed.", {
      presetIds,
      resultingRuleCount: importedRules.length,
    })
    return importedRules
  })
  handleValidatedIpc(MODEL_PRICE_CHANNELS.rulesGet, async () => modelPrice.listRules())
  handleValidatedIpc(MODEL_PRICE_CHANNELS.rulesSave, async (_event, rules?: unknown) => {
    const validatedRules = validateModelPriceRuleInputs(rules)
    const savedRules = modelPrice.saveRules(validatedRules)
    logger.info("Model price rules save completed.", {
      requestedRuleCount: validatedRules.length,
      savedRuleCount: savedRules.length,
    })
    return savedRules
  })
  handleValidatedIpc(MODEL_PRICE_CHANNELS.rulesClear, async () => {
    const previousRuleCount = modelPrice.listRules().length
    const clearedRules = modelPrice.clearRules()
    logger.info("Model price rules clear completed.", {
      operation: "rulesClear",
      previousRuleCount,
      resultingRuleCount: clearedRules.length,
    })
    return clearedRules
  })
  handleValidatedIpc(MODEL_PRICE_CHANNELS.rulesReset, async () => {
    const previousRuleCount = modelPrice.listRules().length
    const clearedRules = modelPrice.clearRules()
    logger.info("Model price rules clear completed.", {
      operation: "rulesReset",
      previousRuleCount,
      resultingRuleCount: clearedRules.length,
    })
    return clearedRules
  })

  registered = true
}

function validateModelPricePresetImportInput(input: unknown): ModelPricePresetId[] {
  if (isModelPricePresetId(input)) return [input]
  if (!Array.isArray(input) || input.length === 0 || !input.every(isModelPricePresetId)) {
    throw new Error("Invalid model price preset id.")
  }
  return input
}

export function validateModelPriceRuleInputs(value: unknown): ModelPriceRuleInput[] {
  if (!Array.isArray(value)) {
    throw new Error("价格规则格式错误：需要数组。")
  }
  return value.map((rule, index) => validateModelPriceRuleInput(rule, index))
}

function validateModelPriceRuleInput(value: unknown, index: number): ModelPriceRuleInput {
  if (!isRecord(value)) {
    throw new Error(`第 ${index + 1} 行：价格规则格式错误。`)
  }
  const modelPattern = value.modelPattern
  if (typeof modelPattern !== "string" || modelPattern.trim() === "") {
    throw new Error(`第 ${index + 1} 行：模型匹配不能为空。`)
  }
  const rule: MutableModelPriceRuleInput = {
    modelPattern: modelPattern.trim(),
  }
  if (typeof value.id === "string") rule.id = value.id
  for (const field of PRICE_FIELDS) {
    if (field in value) rule[field] = validatePriceField(value[field], field, index)
  }
  if (value.currency === "CNY") rule.currency = value.currency
  if (typeof value.enabled === "boolean") rule.enabled = value.enabled
  if (value.source === "builtin" || value.source === "user") rule.source = value.source
  if (typeof value.sortIndex === "number" && Number.isFinite(value.sortIndex)) rule.sortIndex = value.sortIndex
  if (typeof value.updatedAt === "string") rule.updatedAt = value.updatedAt
  return rule
}

function validatePriceField(value: unknown, field: typeof PRICE_FIELDS[number], index: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`第 ${index + 1} 行：${field} 必须是大于等于 0 的数字。`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
