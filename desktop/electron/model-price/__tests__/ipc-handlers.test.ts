import { beforeEach, describe, expect, it, vi } from "vitest"
import { MODEL_PRICE_CHANNELS } from "../channels"

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, params?: unknown) => unknown>(),
  handleValidatedIpc: vi.fn((channel: string, handler: (event: unknown, params?: unknown) => unknown) => {
    mocks.handlers.set(channel, handler)
  }),
  getUsageAnalysisDb: vi.fn(() => ({ database: "mock" })),
  logger: {
    info: vi.fn(),
  },
  modelPriceService: {
    clearRules: vi.fn(),
    importPreset: vi.fn(),
    importPresets: vi.fn(),
    listCoverage: vi.fn(),
    listPresets: vi.fn(),
    listRules: vi.fn(),
    saveRules: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/synapse-test-user-data"),
  },
}))

vi.mock("../../ipc/validated-ipc", () => ({
  handleValidatedIpc: mocks.handleValidatedIpc,
}))

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

vi.mock("../../services/usage-analysis", () => ({
  getUsageAnalysisDb: mocks.getUsageAnalysisDb,
}))

vi.mock("../../services/model-price", () => ({
  MODEL_PRICE_COVERAGE_DEFAULT_LIMIT: 200,
  MODEL_PRICE_COVERAGE_MAX_LIMIT: 500,
  isModelPricePresetId: (value: unknown) => value === "deepseek-official" || value === "aliyun-bailian",
  ModelPriceService: vi.fn(function ModelPriceService() {
    return mocks.modelPriceService
  }),
}))

describe("model price IPC handlers", () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.handlers.clear()
    mocks.handleValidatedIpc.mockClear()
    mocks.getUsageAnalysisDb.mockClear()
    mocks.logger.info.mockClear()
    mocks.modelPriceService.clearRules.mockReset()
    mocks.modelPriceService.importPreset.mockReset()
    mocks.modelPriceService.importPresets.mockReset()
    mocks.modelPriceService.listCoverage.mockReset()
    mocks.modelPriceService.listPresets.mockReset()
    mocks.modelPriceService.listRules.mockReset()
    mocks.modelPriceService.saveRules.mockReset()
  })

  it("registers preset list and import handlers with preset id validation", async () => {
    const presetSummaries = [{ id: "deepseek-official", label: "DeepSeek 官方", ruleCount: 2 }]
    const importedRules = [{ id: "mpr_123456789abc", modelPattern: "deepseek-v4-pro" }]
    mocks.modelPriceService.listPresets.mockReturnValueOnce(presetSummaries)
    mocks.modelPriceService.importPresets.mockReturnValueOnce(importedRules)

    const { registerModelPriceHandlers } = await import("../ipc-handlers")
    registerModelPriceHandlers()

    expect(mocks.getUsageAnalysisDb).not.toHaveBeenCalled()
    expect(await mocks.handlers.get(MODEL_PRICE_CHANNELS.presetsList)?.({})).toBe(presetSummaries)
    expect(mocks.getUsageAnalysisDb).toHaveBeenCalledOnce()
    expect(await mocks.handlers.get(MODEL_PRICE_CHANNELS.presetsImport)?.({}, "deepseek-official")).toBe(importedRules)
    expect(mocks.modelPriceService.importPresets).toHaveBeenCalledWith(["deepseek-official"])
    expect(mocks.logger.info).toHaveBeenCalledWith("Model price preset import completed.", {
      presetIds: ["deepseek-official"],
      resultingRuleCount: 1,
    })

    await expect(async () => {
      await mocks.handlers.get(MODEL_PRICE_CHANNELS.presetsImport)?.({}, "missing-preset")
    }).rejects.toThrow("Invalid model price preset id.")
    expect(mocks.modelPriceService.importPresets).toHaveBeenCalledTimes(1)
  })

  it("imports multiple presets from the existing import channel", async () => {
    const importedRules = [{ id: "mpr_123456789abc", modelPattern: "deepseek-v4-pro" }]
    mocks.modelPriceService.importPresets.mockReturnValueOnce(importedRules)

    const { registerModelPriceHandlers } = await import("../ipc-handlers")
    registerModelPriceHandlers()

    await expect(mocks.handlers.get(MODEL_PRICE_CHANNELS.presetsImport)?.({}, ["deepseek-official", "aliyun-bailian"])).resolves.toBe(importedRules)
    expect(mocks.modelPriceService.importPresets).toHaveBeenCalledWith(["deepseek-official", "aliyun-bailian"])

    await expect(async () => {
      await mocks.handlers.get(MODEL_PRICE_CHANNELS.presetsImport)?.({}, [])
    }).rejects.toThrow("Invalid model price preset id.")
    await expect(async () => {
      await mocks.handlers.get(MODEL_PRICE_CHANNELS.presetsImport)?.({}, ["deepseek-official", "missing-preset"])
    }).rejects.toThrow("Invalid model price preset id.")
    expect(mocks.modelPriceService.importPresets).toHaveBeenCalledTimes(1)
  })

  it("maps the canonical clear channel to clear semantics", async () => {
    mocks.modelPriceService.clearRules.mockReturnValue([])
    mocks.modelPriceService.listRules.mockReturnValue([{ id: "mpr_1" }, { id: "mpr_2" }])

    const { registerModelPriceHandlers } = await import("../ipc-handlers")
    registerModelPriceHandlers()

    expect(await mocks.handlers.get(MODEL_PRICE_CHANNELS.rulesClear)?.({})).toEqual([])
    expect(mocks.modelPriceService.listRules).toHaveBeenCalledTimes(1)
    expect(mocks.modelPriceService.clearRules).toHaveBeenCalledTimes(1)
    expect(mocks.logger.info).toHaveBeenCalledWith("Model price rules clear completed.", {
      operation: "rulesClear",
      previousRuleCount: 2,
      resultingRuleCount: 0,
    })
  })

  it("caps oversized coverage limits before calling the service", async () => {
    mocks.modelPriceService.listCoverage.mockReturnValueOnce([])

    const { registerModelPriceHandlers } = await import("../ipc-handlers")
    registerModelPriceHandlers()

    await expect(mocks.handlers.get(MODEL_PRICE_CHANNELS.coverageList)?.({}, {
      source: "cc",
      range: "all",
      limit: 10_000,
    })).resolves.toEqual([])
    expect(mocks.modelPriceService.listCoverage).toHaveBeenCalledWith({
      source: "cc",
      range: "all",
      limit: 500,
    })
    expect(mocks.logger.info).toHaveBeenCalledWith("Model price coverage requested.", {
      source: "cc",
      range: "all",
      limit: 500,
    })
  })

  it("validates rule save payloads before writing", async () => {
    mocks.modelPriceService.saveRules.mockReturnValueOnce([{ id: "mpr_123456789abc", modelPattern: "claude" }])

    const { registerModelPriceHandlers } = await import("../ipc-handlers")
    registerModelPriceHandlers()
    const save = mocks.handlers.get(MODEL_PRICE_CHANNELS.rulesSave)

    await expect(save?.({}, [
      { modelPattern: " claude ", inputPer1M: 0, outputPer1M: 3, enabled: true },
    ])).resolves.toEqual([{ id: "mpr_123456789abc", modelPattern: "claude" }])
    expect(mocks.modelPriceService.saveRules).toHaveBeenCalledWith([
      { modelPattern: "claude", inputPer1M: 0, outputPer1M: 3, enabled: true },
    ])

    await expect(async () => {
      await save?.({}, undefined)
    }).rejects.toThrow("价格规则格式错误：需要数组。")
    await expect(async () => {
      await save?.({}, [{ modelPattern: " " }])
    }).rejects.toThrow("模型匹配不能为空")
    await expect(async () => {
      await save?.({}, [{ modelPattern: "claude", inputPer1M: -1 }])
    }).rejects.toThrow("inputPer1M 必须是大于等于 0 的数字")
    await expect(async () => {
      await save?.({}, [{ modelPattern: "claude", outputPer1M: Number.NaN }])
    }).rejects.toThrow("outputPer1M 必须是大于等于 0 的数字")
    expect(mocks.modelPriceService.saveRules).toHaveBeenCalledTimes(1)
  })
})
