import { app } from "electron"
import { MODEL_PRICE_CHANNELS } from "./channels"
import { handleValidatedIpc } from "../ipc/validated-ipc"
import { createMainLogger } from "../services/log-store"
import { getUsageAnalysisDb } from "../services/usage-analysis"
import {
  isModelPricePresetId,
  ModelPriceService,
  type ModelPriceCoverageInput,
  type ModelPricePresetId,
  type ModelPriceRuleInput,
} from "../services/model-price"

let registered = false

export function normalizeModelPriceCoverageInput(input: ModelPriceCoverageInput | undefined): ModelPriceCoverageInput {
  const source = input?.source
  const range = input?.range
  const limit = Number(input?.limit)
  return {
    source: source === "cc" || source === "codex" || source === "all" ? source : "all",
    range: range === "today" || range === "7d" || range === "30d" || range === "90d" || range === "all" ? range : "30d",
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 200,
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
    if (!isModelPricePresetId(input)) {
      throw new Error("Invalid model price preset id.")
    }
    const presetId: ModelPricePresetId = input
    const importedRules = modelPrice.importPreset(presetId)
    logger.info("Model price preset import completed.", {
      presetId,
      resultingRuleCount: importedRules.length,
    })
    return importedRules
  })
  handleValidatedIpc(MODEL_PRICE_CHANNELS.rulesGet, async () => modelPrice.listRules())
  handleValidatedIpc(MODEL_PRICE_CHANNELS.rulesSave, async (_event, rules?: readonly ModelPriceRuleInput[]) => {
    const normalizedRules = Array.isArray(rules) ? rules : []
    const savedRules = modelPrice.saveRules(normalizedRules)
    logger.info("Model price rules save completed.", {
      requestedRuleCount: normalizedRules.length,
      savedRuleCount: savedRules.length,
    })
    return savedRules
  })
  handleValidatedIpc(MODEL_PRICE_CHANNELS.rulesClear, async () => modelPrice.clearRules())
  handleValidatedIpc(MODEL_PRICE_CHANNELS.rulesReset, async () => modelPrice.clearRules())

  registered = true
}
