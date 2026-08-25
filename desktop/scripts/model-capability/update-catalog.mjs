import { readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const CATALOG_PATH = path.resolve(SCRIPT_DIR, "../../electron/services/model-capability/catalog.json")
const GENERATED_AT = "2026-08-25T00:00:00.000Z"
const MIN_BAILIAN_TEXT_MODELS = 40
const ALIYUN_TEXT_URL = "https://help.aliyun.com/zh/model-studio/text-generation-model"
const ALIYUN_LIST_URL = "https://help.aliyun.com/zh/model-studio/model-list-text-generation/"
const ALIYUN_API_URL = "https://help.aliyun.com/zh/model-studio/list-models"
const BAILIAN_MARKET_URL = "https://bailian.console.aliyun.com/cn-beijing?tab=model#/model-market/all"

const args = process.argv.slice(2)
const checkOnly = args.includes("--check")
const refreshOfficialDocs = args.includes("--official-docs")
const browserResponsePath = optionValue("--bailian-response")

if (!checkOnly && !refreshOfficialDocs && !browserResponsePath) {
  fail("Use --check, --official-docs, or --bailian-response <path>.")
}

const previous = await readCatalogIfPresent()
let catalog

if (refreshOfficialDocs) {
  const html = await fetchText(ALIYUN_TEXT_URL)
  const bailianModels = parseAliyunTextGenerationModels(html)
  catalog = buildCatalog(bailianModels, directModels(), officialSources())
} else if (browserResponsePath) {
  if (!previous) fail("A catalog must exist before importing a Browser Skill response.")
  const raw = JSON.parse(await readFile(path.resolve(browserResponsePath), "utf8"))
  const capturedAt = new Date().toISOString()
  const bailianModels = parseBailianBrowserResponse(raw, capturedAt)
  const sources = previous.sources
    .filter((source) => source.id !== "bailian-browser-capture")
    .concat({
      id: "bailian-browser-capture",
      provider: "Alibaba Cloud Model Studio",
      kind: "bailian-browser-capture",
      url: BAILIAN_MARKET_URL,
      retrievedAt: capturedAt,
    })
    .sort(byId)
  const retained = previous.models.filter((model) => model.providerScopeId !== "bailian-cn")
  const providerScopes = previous.providerScopes.map((providerScope) => providerScope.id === "bailian-cn"
    ? {
        ...providerScope,
        sourceIds: [...new Set([...providerScope.sourceIds, "bailian-browser-capture"])].sort(),
      }
    : providerScope)
  catalog = canonicalCatalog({
    ...previous,
    generatedAt: capturedAt,
    sources,
    providerScopes,
    models: [...retained, ...bailianModels].sort(byModelKey),
  })
} else {
  if (!previous) fail(`Missing catalog: ${CATALOG_PATH}`)
  catalog = canonicalCatalog(previous)
}

validateCatalog(catalog)
validateModelCountChange(previous, catalog)
const output = `${JSON.stringify(catalog, null, 2)}\n`

if (checkOnly) {
  const current = await readFile(CATALOG_PATH, "utf8")
  if (current !== output) fail("Model capability catalog is not canonically formatted or sorted.")
  process.stdout.write(`Model capability catalog OK: ${catalog.models.length} models.\n`)
} else {
  printSummary(previous, catalog)
  const temporaryPath = `${CATALOG_PATH}.${process.pid}.tmp`
  await writeFile(temporaryPath, output, "utf8")
  await rename(temporaryPath, CATALOG_PATH)
  process.stdout.write(`Updated ${CATALOG_PATH}\n`)
}

function officialSources() {
  return [
    source("aliyun-model-api", "Alibaba Cloud Model Studio", ALIYUN_API_URL),
    source("aliyun-model-list", "Alibaba Cloud Model Studio", ALIYUN_LIST_URL),
    source("aliyun-qwen3-7-plus", "Alibaba Cloud Model Studio", "https://help.aliyun.com/zh/model-studio/qwen3-7-plus"),
    source("aliyun-text-generation", "Alibaba Cloud Model Studio", ALIYUN_TEXT_URL),
    source("anthropic-models", "Anthropic", "https://platform.claude.com/docs/en/about-claude/models/overview"),
    source("deepseek-v4", "DeepSeek", "https://api-docs.deepseek.com/news/news260424/"),
    source("gemini-models", "Google", "https://ai.google.dev/gemini-api/docs/gemini-3"),
    source("kimi-code-models", "Moonshot AI", "https://www.kimi.com/code/docs/en/kimi-code/models.html"),
    source("minimax-models", "MiniMax", "https://platform.minimaxi.com/docs/guides/text-generation"),
    source("stepfun-models", "StepFun", "https://platform.stepfun.com/docs/zh/guides/models/overview"),
    source("xiaomi-mimo-models", "Xiaomi", "https://mimo.mi.com/docs/zh-CN/quick-start/summary/model"),
    source("zhipu-glm-5-2", "Zhipu AI", "https://docs.bigmodel.cn/cn/guide/models/text/glm-5.2"),
  ].sort(byId)
}

function providerScopes() {
  return [
    scope("anthropic-official", "Anthropic", ["https://api.anthropic.com"], ["anthropic-models"]),
    scope("bailian-cn", "Alibaba Cloud Model Studio (China)", [
      "https://coding.dashscope.aliyuncs.com/apps/anthropic",
      "https://dashscope.aliyuncs.com/apps/anthropic",
    ], ["aliyun-model-api", "aliyun-model-list", "aliyun-qwen3-7-plus", "aliyun-text-generation"]),
    scope("deepseek-official", "DeepSeek", ["https://api.deepseek.com/anthropic"], ["deepseek-v4"]),
    scope("gemini-official", "Google Gemini Native", ["https://generativelanguage.googleapis.com"], ["gemini-models"]),
    scope("kimi-code-official", "Kimi Code", ["https://api.kimi.com/coding"], ["kimi-code-models"]),
    scope("minimax-official", "MiniMax", [
      "https://api.minimax.io/anthropic",
      "https://api.minimaxi.com/anthropic",
    ], ["minimax-models"]),
    scope("moonshot-official", "Moonshot AI", ["https://api.moonshot.cn/anthropic"], ["kimi-code-models"]),
    scope("stepfun-official", "StepFun", [
      "https://api.stepfun.ai/step_plan",
      "https://api.stepfun.com/step_plan",
    ], ["stepfun-models"]),
    scope("xiaomi-mimo-official", "Xiaomi MiMo", ["https://api.xiaomimimo.com/anthropic"], ["xiaomi-mimo-models"]),
    scope("zhipu-official", "Zhipu GLM", [
      "https://api.z.ai/api/anthropic",
      "https://open.bigmodel.cn/api/anthropic",
    ], ["zhipu-glm-5-2"]),
  ].sort(byId)
}

function directModels() {
  return [
    direct("anthropic-official", "claude-fable-5", 1_000_000, "Anthropic", "anthropic-models", { maxOutputTokens: 128_000 }),
    direct("anthropic-official", "claude-haiku-4-5-20251001", 200_000, "Anthropic", "anthropic-models", { maxOutputTokens: 64_000 }),
    direct("anthropic-official", "claude-opus-4-8", 1_000_000, "Anthropic", "anthropic-models", { maxOutputTokens: 128_000 }),
    direct("anthropic-official", "claude-sonnet-5", 1_000_000, "Anthropic", "anthropic-models", { maxOutputTokens: 128_000 }),
    direct("deepseek-official", "deepseek-v4-flash", 1_000_000, "DeepSeek", "deepseek-v4", { capabilities: ["reasoning", "tool-calling"] }),
    direct("deepseek-official", "deepseek-v4-pro", 1_000_000, "DeepSeek", "deepseek-v4", { capabilities: ["reasoning", "tool-calling"] }),
    direct("gemini-official", "gemini-3-flash-preview", 1_048_576, "Google", "gemini-models", {
      aliases: ["gemini-3-flash"],
      maxInputTokens: 1_048_576,
      maxOutputTokens: 65_536,
      inputModalities: ["audio", "image", "pdf", "text", "video"],
      capabilities: ["code-execution", "function-calling", "reasoning", "structured-output"],
    }),
    direct("gemini-official", "gemini-3.1-pro-preview", 1_048_576, "Google", "gemini-models", {
      aliases: ["gemini-3.1-pro", "gemini-3.1-pro-preview-customtools"],
      maxInputTokens: 1_048_576,
      maxOutputTokens: 65_536,
      inputModalities: ["audio", "image", "pdf", "text", "video"],
      capabilities: ["code-execution", "function-calling", "reasoning", "structured-output"],
    }),
    direct("kimi-code-official", "k3", 1_048_576, "Moonshot AI", "kimi-code-models", {
      aliases: ["k3[1m]"],
      inputModalities: ["image", "text", "video"],
      capabilities: ["reasoning", "tool-calling"],
    }),
    direct("kimi-code-official", "k3-256k", 262_144, "Moonshot AI", "kimi-code-models", {
      inputModalities: ["image", "text"],
      capabilities: ["reasoning", "tool-calling"],
    }),
    direct("kimi-code-official", "kimi-for-coding", 262_144, "Moonshot AI", "kimi-code-models", {
      inputModalities: ["image", "text", "video"],
      capabilities: ["reasoning", "tool-calling"],
    }),
    direct("kimi-code-official", "kimi-for-coding-highspeed", 262_144, "Moonshot AI", "kimi-code-models", {
      inputModalities: ["image", "text", "video"],
      capabilities: ["reasoning", "tool-calling"],
    }),
    direct("minimax-official", "MiniMax-M2.1", 204_800, "MiniMax", "minimax-models", { capabilities: ["reasoning", "tool-calling"] }),
    direct("minimax-official", "MiniMax-M2.5", 204_800, "MiniMax", "minimax-models", { capabilities: ["reasoning", "tool-calling"] }),
    direct("minimax-official", "MiniMax-M2.5-highspeed", 204_800, "MiniMax", "minimax-models", { capabilities: ["reasoning", "tool-calling"] }),
    direct("minimax-official", "MiniMax-M2.7", 204_800, "MiniMax", "minimax-models", { capabilities: ["reasoning", "tool-calling"] }),
    direct("minimax-official", "MiniMax-M2.7-highspeed", 204_800, "MiniMax", "minimax-models", { capabilities: ["reasoning", "tool-calling"] }),
    direct("minimax-official", "MiniMax-M3", 1_000_000, "MiniMax", "minimax-models", {
      inputModalities: ["image", "text", "video"],
      capabilities: ["reasoning", "tool-calling"],
    }),
    direct("moonshot-official", "kimi-k2.6", 262_144, "Moonshot AI", "kimi-code-models", { capabilities: ["reasoning", "tool-calling"] }),
    direct("stepfun-official", "step-3.5-flash", 262_144, "StepFun", "stepfun-models", { capabilities: ["reasoning", "tool-calling"] }),
    direct("stepfun-official", "step-3.5-flash-2603", 262_144, "StepFun", "stepfun-models", { capabilities: ["reasoning", "tool-calling"] }),
    direct("xiaomi-mimo-official", "mimo-v2.5-pro", 1_000_000, "Xiaomi", "xiaomi-mimo-models", {
      maxOutputTokens: 131_072,
      capabilities: ["reasoning", "structured-output", "tool-calling"],
    }),
    direct("zhipu-official", "glm-5.2", 1_000_000, "Zhipu AI", "zhipu-glm-5-2", {
      maxOutputTokens: 128_000,
      capabilities: ["reasoning", "structured-output", "tool-calling"],
    }),
  ].sort(byModelKey)
}

function buildCatalog(bailianModels, directRecords, sources) {
  return canonicalCatalog({
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    sources,
    providerScopes: providerScopes(),
    models: [...bailianModels, ...directRecords],
  })
}

function parseAliyunTextGenerationModels(pageHtml) {
  const marker = "window.__ICE_PAGE_PROPS__="
  const start = pageHtml.indexOf(marker)
  if (start < 0) fail("Alibaba Cloud documentation did not expose structured page props.")
  const jsonStart = start + marker.length
  const jsonEnd = pageHtml.indexOf(";\n", jsonStart)
  if (jsonEnd < 0) fail("Alibaba Cloud documentation page props were truncated.")
  const props = JSON.parse(pageHtml.slice(jsonStart, jsonEnd))
  const content = props?.docDetailData?.storeData?.data?.content
  if (typeof content !== "string") fail("Alibaba Cloud documentation content is missing.")

  const records = new Map()
  for (const row of content.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1])
    if (cells.length < 2) continue
    const modelIds = [...cells[0].matchAll(/<code\b[^>]*>([^<]+)<\/code>/g)]
      .map((match) => decodeHtml(match[1]).trim())
      .filter(Boolean)
    const contextMatch = textContent(cells[1]).match(/(\d+(?:\.\d+)?)\s*([kKmM])/)
    if (modelIds.length === 0 || !contextMatch) continue
    const contextWindowTokens = Math.round(Number(contextMatch[1]) * (contextMatch[2].toLowerCase() === "m" ? 1_000_000 : 1_000))
    const capabilities = [
      supports(cells[2]) && "reasoning",
      supports(cells[3]) && "tool-calling",
      supports(cells[5]) && "structured-output",
    ].filter(Boolean).sort()
    const features = [supports(cells[4]) && "built-in-tools"].filter(Boolean).sort()
    const equivalentSnapshot = modelIds.length > 1 ? modelIds[1] : undefined
    for (const modelId of modelIds) {
      if (records.has(modelId)) continue
      const qwen37Plus = modelId === "qwen3.7-plus" || modelId === "qwen3.7-plus-2026-05-26"
      records.set(modelId, {
        providerScopeId: "bailian-cn",
        modelId,
        aliases: [],
        contextWindowTokens,
        ...(qwen37Plus ? {
          maxInputTokens: 991_808,
          maxOutputTokens: 131_072,
          reasoningMaxInputTokens: 983_616,
          reasoningMaxOutputTokens: 131_072,
          maxReasoningTokens: 262_144,
        } : {}),
        inputModalities: bailianInputModalities(modelId),
        outputModalities: ["text"],
        capabilities,
        features,
        author: authorForModel(modelId),
        inferenceProvider: "Alibaba Cloud Model Studio",
        serviceRegions: ["cn-beijing"],
        status: "online",
        ...(modelId === modelIds[0] && equivalentSnapshot ? { equivalentSnapshot } : {}),
        sourceId: qwen37Plus ? "aliyun-qwen3-7-plus" : "aliyun-text-generation",
        verifiedAt: GENERATED_AT,
      })
    }
  }
  return [...records.values()].sort(byModelKey)
}

function parseBailianBrowserResponse(raw, capturedAt) {
  const candidates = []
  walk(raw, (value) => {
    const modelId = firstString(value.modelId, value.model, value.modelName, value.model_id, value.model_info?.model)
    const contextWindowTokens = firstPositiveInteger(
      value.contextWindowTokens,
      value.contextWindow,
      value.context_window,
      value.contextLength,
      value.context_length,
      value.maxContextLength,
      value.model_info?.context_window,
    )
    if (!modelId || !contextWindowTokens) return
    const serviceSites = arrayStrings(value.serviceSites ?? value.service_sites)
    if (serviceSites.length > 0 && !serviceSites.some((site) => /china|cn-|beijing/i.test(site))) return
    const capabilityText = JSON.stringify(value.capabilities ?? value.capability ?? "")
    if (capabilityText && !/text|generation|chat|reason/i.test(capabilityText)) return
    candidates.push({
      providerScopeId: "bailian-cn",
      modelId,
      aliases: arrayStrings(value.modelAlias ?? value.aliases).sort(),
      contextWindowTokens,
      ...positiveIntegerProperty("maxInputTokens", value.maxInputTokens ?? value.max_input_tokens),
      ...positiveIntegerProperty("maxOutputTokens", value.maxOutputTokens ?? value.max_output_tokens),
      ...positiveIntegerProperty(
        "reasoningMaxInputTokens",
        value.reasoningMaxInputTokens ?? value.reasoning_max_input_tokens,
      ),
      ...positiveIntegerProperty(
        "reasoningMaxOutputTokens",
        value.reasoningMaxOutputTokens ?? value.reasoning_max_output_tokens,
      ),
      ...positiveIntegerProperty(
        "maxReasoningTokens",
        value.maxReasoningTokens ?? value.max_reasoning_tokens ?? value.max_thinking_tokens,
      ),
      inputModalities: arrayStrings(value.inputModalities ?? value.input_modalities ?? ["text"]).sort(),
      outputModalities: arrayStrings(value.outputModalities ?? value.output_modalities ?? ["text"]).sort(),
      capabilities: arrayStrings(value.capabilities).sort(),
      features: arrayStrings(value.features).sort(),
      author: firstString(value.author, value.provider) ?? authorForModel(modelId),
      inferenceProvider: firstString(value.inferenceProvider, value.inference_provider) ?? "Alibaba Cloud Model Studio",
      serviceRegions: serviceSites.length > 0 ? serviceSites.sort() : ["cn-beijing"],
      status: value.offlineAt || value.offline_at ? "offline" : "online",
      ...optionalProperty("equivalentSnapshot", firstString(value.equivalentSnapshot, value.equivalent_snapshot)),
      ...optionalProperty("publishedAt", firstString(value.publishedAt, value.published_at)),
      ...optionalProperty("offlineAt", firstString(value.offlineAt, value.offline_at)),
      sourceId: "bailian-browser-capture",
      verifiedAt: capturedAt,
    })
  })
  const unique = [...new Map(candidates.map((record) => [record.modelId, record])).values()].sort(byModelKey)
  if (unique.length < MIN_BAILIAN_TEXT_MODELS) {
    fail(`Browser response normalized to ${unique.length} text models; refusing drop below ${MIN_BAILIAN_TEXT_MODELS}.`)
  }
  return unique
}

function direct(providerScopeId, modelId, contextWindowTokens, author, sourceId, overrides = {}) {
  return {
    providerScopeId,
    modelId,
    aliases: [],
    contextWindowTokens,
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: [],
    features: [],
    author,
    inferenceProvider: author,
    serviceRegions: ["global"],
    status: "online",
    sourceId,
    verifiedAt: GENERATED_AT,
    ...overrides,
    aliases: [...(overrides.aliases ?? [])].sort(),
    inputModalities: [...(overrides.inputModalities ?? ["text"])].sort(),
    outputModalities: [...(overrides.outputModalities ?? ["text"])].sort(),
    capabilities: [...(overrides.capabilities ?? [])].sort(),
    features: [...(overrides.features ?? [])].sort(),
  }
}

function canonicalCatalog(value) {
  return {
    schemaVersion: 1,
    generatedAt: value.generatedAt,
    sources: [...value.sources].sort(byId).map((item) => ({ ...item })),
    providerScopes: [...value.providerScopes].sort(byId).map((item) => ({
      ...item,
      baseUrls: [...item.baseUrls].sort(),
      sourceIds: [...item.sourceIds].sort(),
    })),
    models: [...value.models].sort(byModelKey).map((item) => ({
      ...item,
      aliases: [...item.aliases].sort(),
      inputModalities: [...item.inputModalities].sort(),
      outputModalities: [...item.outputModalities].sort(),
      capabilities: [...item.capabilities].sort(),
      features: [...item.features].sort(),
      serviceRegions: [...item.serviceRegions].sort(),
    })),
  }
}

function validateCatalog(value) {
  if (value.schemaVersion !== 1 || !Number.isFinite(Date.parse(value.generatedAt))) fail("Invalid catalog header.")
  const sources = new Set(value.sources.map((item) => item.id))
  const scopes = new Set(value.providerScopes.map((item) => item.id))
  if (sources.size !== value.sources.length || scopes.size !== value.providerScopes.length) fail("Duplicate source or scope id.")
  const names = new Set()
  for (const model of value.models) {
    if (!scopes.has(model.providerScopeId) || !sources.has(model.sourceId)) fail(`Broken source/scope for ${model.modelId}.`)
    if (!Number.isSafeInteger(model.contextWindowTokens) || model.contextWindowTokens <= 0) fail(`Invalid context for ${model.modelId}.`)
    for (const field of ["maxInputTokens", "maxOutputTokens", "reasoningMaxInputTokens", "reasoningMaxOutputTokens", "maxReasoningTokens"]) {
      const tokenLimit = model[field]
      if (tokenLimit !== undefined && (!Number.isSafeInteger(tokenLimit) || tokenLimit <= 0 || tokenLimit > model.contextWindowTokens)) {
        fail(`Invalid ${field} for ${model.providerScopeId}/${model.modelId}.`)
      }
    }
    for (const name of [model.modelId, ...model.aliases]) {
      const key = `${model.providerScopeId}\u0000${name}`
      if (names.has(key)) fail(`Duplicate model id or alias: ${key}`)
      names.add(key)
    }
  }
  const bailianCount = value.models.filter((model) => model.providerScopeId === "bailian-cn").length
  if (bailianCount < MIN_BAILIAN_TEXT_MODELS) fail(`Bailian model count ${bailianCount} is below ${MIN_BAILIAN_TEXT_MODELS}.`)
}

function validateModelCountChange(previous, next) {
  if (!previous) return
  const previousCount = previous.models.filter((model) => model.providerScopeId === "bailian-cn").length
  const nextCount = next.models.filter((model) => model.providerScopeId === "bailian-cn").length
  const minimumExpected = Math.max(MIN_BAILIAN_TEXT_MODELS, Math.floor(previousCount * 0.7))
  if (nextCount < minimumExpected) {
    fail(`Bailian model count fell from ${previousCount} to ${nextCount}; refusing anomalous decrease below ${minimumExpected}.`)
  }
}

function printSummary(previous, next) {
  const oldModels = new Map((previous?.models ?? []).map((model) => [`${model.providerScopeId}/${model.modelId}`, model]))
  const newModels = new Map(next.models.map((model) => [`${model.providerScopeId}/${model.modelId}`, model]))
  const added = [...newModels.keys()].filter((key) => !oldModels.has(key))
  const removed = [...oldModels.keys()].filter((key) => !newModels.has(key))
  const changed = [...newModels].filter(([key, model]) => {
    const old = oldModels.get(key)
    return old && JSON.stringify(old) !== JSON.stringify(model)
  }).map(([key]) => key)
  process.stdout.write(`Models: ${next.models.length}; added ${added.length}; changed ${changed.length}; offline/removed ${removed.length}.\n`)
  for (const [label, items] of [["Added", added], ["Changed", changed], ["Removed", removed]]) {
    if (items.length > 0) process.stdout.write(`${label}: ${items.join(", ")}\n`)
  }
}

function source(id, provider, url) {
  return { id, provider, kind: "official-doc", url, retrievedAt: GENERATED_AT }
}

function scope(id, label, baseUrls, sourceIds) {
  return { id, label, baseUrls: [...baseUrls].sort(), sourceIds: [...sourceIds].sort() }
}

function authorForModel(modelId) {
  if (/^(qwen|qwq|qvq)/i.test(modelId)) return "Alibaba Cloud"
  if (/^deepseek/i.test(modelId)) return "DeepSeek"
  if (/^glm/i.test(modelId)) return "Zhipu AI"
  if (/^minimax/i.test(modelId)) return "MiniMax"
  if (/^(kimi|moonshot)/i.test(modelId)) return "Moonshot AI"
  if (/mimo/i.test(modelId)) return "Xiaomi"
  return "Alibaba Cloud Model Studio"
}

function bailianInputModalities(modelId) {
  if (/omni/i.test(modelId)) return ["audio", "image", "text", "video"]
  if (/^qvq/i.test(modelId)) return ["image", "text", "video"]
  if (/^qwen3\.7-plus(?:-|$)/i.test(modelId)) return ["image", "text", "video"]
  if (/^kimi-k2\.5$/i.test(modelId)) return ["image", "text", "video"]
  return ["text"]
}

function supports(cell) {
  return typeof cell === "string" && textContent(cell).includes("支持") && !textContent(cell).includes("不支持")
}

function textContent(html) {
  return decodeHtml(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
}

function decodeHtml(value) {
  return value.replaceAll("&nbsp;", " ").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "Synapse model capability catalog updater" } })
  if (!response.ok) fail(`Official source returned ${response.status}: ${url}`)
  return response.text()
}

async function readCatalogIfPresent() {
  try {
    return JSON.parse(await readFile(CATALOG_PATH, "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") return undefined
    throw error
  }
}

function walk(value, visit) {
  if (!value || typeof value !== "object") return
  if (!Array.isArray(value)) visit(value)
  for (const nested of Array.isArray(value) ? value : Object.values(value)) walk(nested, visit)
}

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim()
}

function firstPositiveInteger(...values) {
  return values.map(Number).find((value) => Number.isSafeInteger(value) && value > 0)
}

function arrayStrings(value) {
  const items = Array.isArray(value) ? value : typeof value === "string" ? [value] : []
  return [...new Set(items.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))]
}

function positiveIntegerProperty(name, value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? { [name]: parsed } : {}
}

function optionalProperty(name, value) {
  return value ? { [name]: value } : {}
}

function optionValue(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function byId(left, right) {
  return left.id.localeCompare(right.id, "en")
}

function byModelKey(left, right) {
  return `${left.providerScopeId}\u0000${left.modelId}`.localeCompare(`${right.providerScopeId}\u0000${right.modelId}`, "en")
}

function fail(message) {
  throw new Error(message)
}
