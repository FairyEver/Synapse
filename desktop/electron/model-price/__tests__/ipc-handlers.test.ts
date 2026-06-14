import { beforeEach, describe, expect, it, vi } from "vitest"
import { MODEL_PRICE_CHANNELS } from "../channels"

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, params?: unknown) => unknown>(),
  handleValidatedIpc: vi.fn((channel: string, handler: (event: unknown, params?: unknown) => unknown) => {
    mocks.handlers.set(channel, handler)
  }),
  logger: {
    info: vi.fn(),
  },
  modelPriceService: {
    clearRules: vi.fn(),
    importPreset: vi.fn(),
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
  getUsageAnalysisDb: vi.fn(() => ({ database: "mock" })),
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
    mocks.logger.info.mockClear()
    mocks.modelPriceService.clearRules.mockReset()
    mocks.modelPriceService.importPreset.mockReset()
    mocks.modelPriceService.listCoverage.mockReset()
    mocks.modelPriceService.listPresets.mockReset()
    mocks.modelPriceService.listRules.mockReset()
    mocks.modelPriceService.saveRules.mockReset()
  })

  it("registers preset list and import handlers with preset id validation", async () => {
    const presetSummaries = [{ id: "deepseek-official", label: "DeepSeek 官方", ruleCount: 2 }]
    const importedRules = [{ id: "mpr_123456789abc", modelPattern: "deepseek-v4-pro" }]
    mocks.modelPriceService.listPresets.mockReturnValueOnce(presetSummaries)
    mocks.modelPriceService.importPreset.mockReturnValueOnce(importedRules)

    const { registerModelPriceHandlers } = await import("../ipc-handlers")
    registerModelPriceHandlers()

    expect(await mocks.handlers.get(MODEL_PRICE_CHANNELS.presetsList)?.({})).toBe(presetSummaries)
    expect(await mocks.handlers.get(MODEL_PRICE_CHANNELS.presetsImport)?.({}, "deepseek-official")).toBe(importedRules)
    expect(mocks.modelPriceService.importPreset).toHaveBeenCalledWith("deepseek-official")
    expect(mocks.logger.info).toHaveBeenCalledWith("Model price preset import completed.", {
      presetId: "deepseek-official",
      resultingRuleCount: 1,
    })

    await expect(async () => {
      await mocks.handlers.get(MODEL_PRICE_CHANNELS.presetsImport)?.({}, "missing-preset")
    }).rejects.toThrow("Invalid model price preset id.")
    expect(mocks.modelPriceService.importPreset).toHaveBeenCalledTimes(1)
  })

  it("keeps clear and reset channels mapped to clear semantics", async () => {
    mocks.modelPriceService.clearRules.mockReturnValue([])

    const { registerModelPriceHandlers } = await import("../ipc-handlers")
    registerModelPriceHandlers()

    expect(await mocks.handlers.get(MODEL_PRICE_CHANNELS.rulesClear)?.({})).toEqual([])
    expect(await mocks.handlers.get(MODEL_PRICE_CHANNELS.rulesReset)?.({})).toEqual([])
    expect(mocks.modelPriceService.clearRules).toHaveBeenCalledTimes(2)
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
