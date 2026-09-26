/**
 * 真实模型驱动器：让模型自己跑一遍这套评测装置。
 *
 * 与被替换掉的 `answers.mjs` 的分工：
 *   answers.mjs  是「人/模型手写的作答」，回答的是「协议给的东西够不够用」
 *   本文件       是「真实模型自己调协议」，回答的是「真实模型会不会用」
 *
 * 三条不可动摇的纪律（评测的命根子）：
 *   1. **模型只看得到调用方视角**。每一次工具调用的返回值都过 `consumer-view.mjs`
 *      的 `redact()`，`catalog.index` 之类的内部结构一律不可见。
 *   2. **任务话术是模型能拿到的全部任务信息**。`expect` / `acceptableCapabilityIds` /
 *      `requiredChain` / `argRules` 一个字都不进 prompt——那是判分用的。
 *   3. **判分口径不动**。`tasks.mjs` / `scoring.mjs` / `consumer-view.mjs` 只读不改，
 *      模型吐出的 `decision` 原样交给 `scoring.mjs`。
 *
 * 模型连接不引任何依赖：`fetch` 手写 Anthropic Messages 协议。
 *
 * 跑法：
 *   node tools/eval/model.mjs                    # 5 题全跑，打印逐题过程与记账
 *   node tools/eval/model.mjs T2                 # 只跑 id 前缀匹配的题
 *   node tools/eval/model.mjs --json             # 机器可读（含每一步的完整返回）
 *   node tools/eval/model.mjs --no-trace         # 只打判分，不打工具过程
 *   node tools/eval/model.mjs --score <运行文件> # 只判分，不碰网络、不花额度
 *   node tools/eval/model.mjs --dist <入口.js>   # 把这一轮钉在指定的构建产物上
 *   node tools/eval/model.mjs --out <目录>       # 换一个落盘目录
 *   node tools/eval/model.mjs --dry              # 只打印工具定义与模型配置，不发请求
 *
 * 环境变量：
 *   ANTHROPIC_BASE_URL    模型端点（Anthropic 兼容），如 https://api.deepseek.com/anthropic
 *   ANTHROPIC_AUTH_TOKEN  该端点的 token
 *   ANTHROPIC_MODEL       模型名（可选，默认 deepseek-flash）
 *   EVAL_MODEL            同上，优先级更高（本次评测显式指定用）
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EVAL_TODAY, TASKS } from './tasks.mjs'
import { INTERNAL_KEYS, listRegisteredCapabilityIds, loadEntry, makeSdk, redact } from './consumer-view.mjs'
import { scoreRun } from './scoring.mjs'

// ---------------------------------------------------------------------------
// 预算与上限
// ---------------------------------------------------------------------------

/** 每题允许的目录工具调用次数上限。超出即收下当前决策并标记 budgetExceeded。 */
export const MAX_CATALOG_CALLS = 8

/** 硬上限：一次请求-响应的轮数。防止模型在预算边缘空转把额度烧光。 */
export const MAX_ROUNDS = 14

/** 模型一直不调 submit_decision 时，最多提醒几次。 */
export const MAX_NUDGES = 2

export const DEFAULT_MAX_TOKENS = 4096

export const DEFAULT_MODEL = 'deepseek-flash'

export const ANTHROPIC_VERSION = '2023-06-01'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_RUN_DIR = join(HERE, 'model-runs')

// ---------------------------------------------------------------------------
// 模型配置
// ---------------------------------------------------------------------------

/**
 * 从环境变量读模型配置。缺变量时给出**可操作**的错误，不静默失败。
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
export function readModelConfig(env = process.env) {
  const baseUrl = String(env.ANTHROPIC_BASE_URL ?? '').trim()
  const token = String(env.ANTHROPIC_AUTH_TOKEN ?? '').trim()
  const missing = []
  if (!baseUrl) missing.push('ANTHROPIC_BASE_URL')
  if (!token) missing.push('ANTHROPIC_AUTH_TOKEN')
  if (missing.length) {
    throw new Error(
      `连不上模型：环境变量 ${missing.join(' 和 ')} 没有设置。\n` +
        '  ANTHROPIC_BASE_URL     Anthropic 兼容端点，例如 https://api.deepseek.com/anthropic\n' +
        '  ANTHROPIC_AUTH_TOKEN   该端点的 token（只从环境读，不写进任何产物）\n' +
        '设置后重跑，例如：\n' +
        '  ANTHROPIC_BASE_URL=... ANTHROPIC_AUTH_TOKEN=... node tools/eval/model.mjs',
    )
  }
  const rawModel = String(env.EVAL_MODEL ?? env.ANTHROPIC_MODEL ?? DEFAULT_MODEL).trim()
  // Claude Code 用 `[1M]` 这类后缀表达上下文窗口，不是模型名的一部分，去掉再发。
  const model = rawModel.replace(/\[[^\]]*\]$/, '') || DEFAULT_MODEL
  return { baseUrl: baseUrl.replace(/\/+$/, ''), token, model }
}

/** 端点地址 → Messages API 地址。base 里已经带 /v1 的不重复拼。 */
export function messagesUrl(baseUrl) {
  const base = String(baseUrl).replace(/\/+$/, '')
  return /\/v1$/.test(base) ? `${base}/messages` : `${base}/v1/messages`
}

// ---------------------------------------------------------------------------
// 工具定义
// ---------------------------------------------------------------------------

/**
 * 6 个目录工具 + 1 个交卷工具。
 *
 * 目录工具的参数名刻意用协议自己在 `next[].args` 里用过的词
 * （keyword / domain / capabilityId），不额外发明词汇。
 */

const CATALOG_TOOL_SPECS = [
  {
    name: 'recommend',
    description: '按用户的一句原话，从能力目录里推荐候选（能力 / 页面 / 业务域）。',
    input_schema: {
      type: 'object',
      properties: { utterance: { type: 'string', description: '用户原话' } },
      required: ['utterance'],
    },
  },
  {
    name: 'search',
    description: '在能力目录里做字面检索，返回命中项以及「为什么命中」。',
    input_schema: {
      type: 'object',
      properties: { keyword: { type: 'string', description: '检索关键词' } },
      required: ['keyword'],
    },
  },
  {
    name: 'listDomains',
    description: '列出目录里的全部业务域，以及每个域有多少页面 / 多少能力。',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'listPages',
    description: '列出某个业务域下的页面清单。',
    input_schema: {
      type: 'object',
      properties: { domain: { type: 'string', description: '业务域 id' } },
      required: ['domain'],
    },
  },
  {
    name: 'describePage',
    description: '看一个页面上登记了哪些能力。',
    input_schema: {
      type: 'object',
      properties: { pageId: { type: 'string', description: '页面 id 或菜单路径' } },
      required: ['pageId'],
    },
  },
  {
    name: 'describe',
    description: '看一个能力的完整契约：参数、返回、下一步可以查什么。',
    input_schema: {
      type: 'object',
      properties: { capabilityId: { type: 'string', description: '能力 id' } },
      required: ['capabilityId'],
    },
  },
]

export const SUBMIT_DECISION_TOOL = {
  name: 'submit_decision',
  description:
    '提交你对当前这句用户原话的最终决定。这是唯一的交卷方式；不调用它等于没作答。',
  input_schema: {
    type: 'object',
    properties: {
      outcome: {
        type: 'string',
        enum: ['call', 'clarify', 'unsupported'],
        description:
          "call = 现在就该调某个能力；clarify = 信息不足，要回去问用户；unsupported = 目录里没有能把这件事做成的能力。",
      },
      capabilityId: { type: 'string', description: 'outcome=call 时的落点能力 id。' },
      chain: {
        type: 'array',
        items: { type: 'string' },
        description: '这次决定经过（或打算经过）的能力 id 列表。',
      },
      args: {
        type: 'object',
        description:
          'outcome=call 时要传给这次调用的参数。每个参数都必须写清 value（值）和 from（这个值从哪来）。',
        additionalProperties: {
          type: 'object',
          properties: {
            value: { description: '参数值' },
            from: {
              type: 'string',
              description:
                '这个值的出处：用户原话的哪一段、哪次调用的哪个字段、还是你补的默认值。必填，不能空。',
            },
            deferred: {
              type: 'boolean',
              description: 'true 表示这个值只有真调一次后端才拿得到，现在只能写清「怎么取」。',
            },
          },
          required: ['from'],
        },
      },
      missing: {
        type: 'array',
        items: { type: 'string' },
        description: 'outcome=clarify 时，你要回去问用户的字段名。',
      },
      pageRef: {
        type: 'string',
        description: 'outcome=unsupported 但目录里有相关页面时，给出该页面的标识（id / 菜单路径 / 标题）。',
      },
      notes: { type: 'string', description: '任何你想说明的判断。' },
    },
    required: ['outcome'],
  },
}

export const CATALOG_TOOLS = CATALOG_TOOL_SPECS

/**
 * 本轮请求要带哪些工具。预算用尽后目录工具下架，只剩交卷工具。
 *
 * @param {number} catalogCalls 已用掉的目录工具调用次数
 */
export function toolsForRequest(catalogCalls, maxCatalogCalls = MAX_CATALOG_CALLS) {
  return catalogCalls >= maxCatalogCalls ? [SUBMIT_DECISION_TOOL] : [...CATALOG_TOOLS, SUBMIT_DECISION_TOOL]
}

/**
 * 系统提示：只讲**作答格式**与「你看得到什么」。
 *
 * 刻意不写任何一题的期望落点、不写「信息不足要问用户」这类本该由协议自身
 * 传达的产品策略——那正是本轮要测的东西。写下的是「交卷长什么样」，
 * 因为那是评测装置的答案契约，不是协议的一部分。
 */
export const SYSTEM_PROMPT = [
  // 基准日：任何一个真实助手都有钟。不给它，T2 的「明天下午2点」就只能靠模型
  // 自己猜今天是几号——那是与协议无关的干扰项，不是本轮要测的东西。
  // 注意给的是 tasks.mjs 的 EVAL_TODAY（环境常量），不是任何 expect 字段。
  `今天是 ${EVAL_TODAY}。`,
  '你是 Portal 无头 SDK 的调用方：一个替用户办事的助手。',
  '用户会给你一句中文原话，你要决定下一步做什么。',
  '',
  '你可以调用工具去了解这个 SDK 的能力目录。工具返回的是**调用方能看到的全部信息**：',
  '目录里有哪些能力、每个能力要什么参数、下一步可以查什么。你看不到 SDK 的内部结构。',
  '',
  '查完之后你必须调用 submit_decision 提交最终决定。不要用自然语言回答，不要输出解释性',
  '的开场白。字段含义：',
  '- outcome=call：现在就能调某个能力。给出 capabilityId、chain（经过的能力 id）、',
  '  以及 args（这次调用要传的参数）。',
  '- outcome=clarify：信息不够，得回去问用户。把要问的字段名放进 missing。',
  '- outcome=unsupported：目录里没有能把这件事做成的能力。',
  '',
  'args 里每个参数都必须同时写 value 和 from。from 是必填的：写清这个值是从用户原话的',
  '哪一段来的、还是从哪次调用的哪个字段取的、还是你补的默认值。没有 from 的参数视为没交代。',
].join('\n')

// ---------------------------------------------------------------------------
// 模型调用
// ---------------------------------------------------------------------------

/** 一次 API 调用的薄封装，注入 fetch 便于测试。 */
export function createModelClient({ config, fetchImpl = globalThis.fetch, maxRetries = 2 } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('没有可用的 fetch：Node 需要 >=18，或显式传入 fetchImpl')
  }
  const url = messagesUrl(config.baseUrl)

  async function callMessages(body) {
    let lastError
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let response
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'anthropic-version': ANTHROPIC_VERSION,
            authorization: `Bearer ${config.token}`,
          },
          body: JSON.stringify(body),
        })
      } catch (error) {
        lastError = new Error(`请求模型失败（网络层）：${error?.message ?? error}`)
        await backoff(attempt)
        continue
      }
      if (response.status === 429 || response.status >= 500) {
        const text = await safeText(response)
        lastError = new Error(`模型返回 ${response.status}：${text.slice(0, 400)}`)
        await backoff(attempt)
        continue
      }
      const payload = await response.json().catch(async () => {
        throw new Error(`模型返回的不是 JSON（HTTP ${response.status}）`)
      })
      if (!response.ok) {
        const detail = payload?.error?.message ?? JSON.stringify(payload).slice(0, 400)
        throw new Error(`模型返回 HTTP ${response.status}：${detail}`)
      }
      return payload
    }
    throw lastError ?? new Error('模型调用失败')
  }

  return { callMessages, url }
}

function backoff(attempt) {
  const ms = 500 * Math.pow(2, attempt)
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function safeText(response) {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

/**
 * 累计 token 用量。字段缺失按 0 处理，端点不报缓存字段时也不会炸。
 *
 * 纯加法：`requests` 也从来源里累加（不是每调一次加一），
 * 这样「把整题的 usage 汇总进总计」和「把单次响应汇总进整题」用的是同一个函数。
 */
export function addUsage(total, usage) {
  const next = { ...total }
  for (const key of [
    'input_tokens',
    'output_tokens',
    'cache_creation_input_tokens',
    'cache_read_input_tokens',
    'requests',
  ]) {
    next[key] = (next[key] ?? 0) + Number(usage?.[key] ?? 0)
  }
  return next
}

export function emptyUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    requests: 0,
  }
}

// ---------------------------------------------------------------------------
// 工具执行（返回值一律走 consumer-view 的脱敏）
// ---------------------------------------------------------------------------

/**
 * 执行一次目录工具调用。
 *
 * 返回值 = `redact(sdk.catalog.xxx(...))`。`redact` 从 `consumer-view.mjs` 导入，
 * 与调用方视角用的是同一份剥离名单，不另起一套。
 *
 * @returns {{ ok: boolean, result: unknown, error?: string }}
 */
export function executeCatalogTool(sdk, toolName, input) {
  const args = input ?? {}
  try {
    switch (toolName) {
      case 'recommend':
        return { ok: true, result: redact(sdk.catalog.recommend(String(args.utterance ?? ''))) }
      case 'search':
        return { ok: true, result: redact(sdk.catalog.search(String(args.keyword ?? ''))) }
      case 'listDomains':
        return { ok: true, result: redact(sdk.catalog.listDomains()) }
      case 'listPages':
        return { ok: true, result: redact(sdk.catalog.listPages(String(args.domain ?? ''))) }
      case 'describePage':
        return { ok: true, result: redact(sdk.catalog.describePage(String(args.pageId ?? ''))) }
      case 'describe':
        return { ok: true, result: redact(sdk.catalog.describe(String(args.capabilityId ?? ''))) }
      default:
        return { ok: false, result: null, error: `未知工具「${toolName}」` }
    }
  } catch (error) {
    return { ok: false, result: null, error: `调用 ${toolName} 抛错：${error?.message ?? error}` }
  }
}

/** 一轮工具调用的人类可读摘要，用来写进 trace 的 `saw`。 */
export function summarize(toolName, result) {
  try {
    if (toolName === 'recommend') {
      const caps = result?.capabilities ?? []
      const top = caps[0]
      const pages = result?.pages ?? []
      const domains = result?.domains ?? []
      return [
        `capabilities ${caps.length} 条${top ? `，首位 ${top.capabilityId ?? top.id}(${top.score ?? '?'})` : ''}`,
        `pages ${pages.length}`,
        `domains ${domains.length}`,
        `next ${(result?.next ?? []).length}`,
      ].join('；')
    }
    if (toolName === 'search') {
      const hits = result?.hits ?? []
      const head = hits[0]
      // 命中项用 `type` 区分能力 / 页面，不是 answers.mjs 里写过的 `kind`
      return `total=${result?.total ?? '?'}，hits ${hits.length}${head ? `，首位 ${head.type ?? ''}:${head.title ?? head.id ?? ''}` : ''}`
    }
    if (toolName === 'describe') {
      const params = result?.params ?? []
      const required = params.filter((p) => p?.required).length
      return `ok=${result?.ok}，capabilityId=${result?.capabilityId}，write=${result?.write}，params ${params.length}（required ${required}）`
    }
    if (toolName === 'describePage') {
      return `ok=${result?.ok}，capabilities ${(result?.capabilities ?? []).length} 条，pending=${result?.pending}`
    }
    if (toolName === 'listDomains') {
      return `${result?.totalDomains} 个域 / ${result?.totalPages} 个页面 / ${result?.totalCapabilities} 个能力`
    }
    if (toolName === 'listPages') {
      return `ok=${result?.ok}，domain=${result?.domain}，pages ${(result?.pages ?? []).length}`
    }
    return `${JSON.stringify(result ?? null).length} 字节`
  } catch {
    return '(摘要失败)'
  }
}

/** 工具调用的人类可读写法，与 answers.mjs 的 trace 风格一致。 */
export function formatCall(toolName, input) {
  const args = input ?? {}
  switch (toolName) {
    case 'recommend':
      return `recommend(${JSON.stringify(args.utterance ?? '')})`
    case 'search':
      return `search(${JSON.stringify(args.keyword ?? '')})`
    case 'listDomains':
      return 'listDomains()'
    case 'listPages':
      return `listPages(${JSON.stringify(args.domain ?? '')})`
    case 'describePage':
      return `describePage(${JSON.stringify(args.pageId ?? '')})`
    case 'describe':
      return `describe(${JSON.stringify(args.capabilityId ?? '')})`
    default:
      return `${toolName}(${JSON.stringify(args)})`
  }
}

// ---------------------------------------------------------------------------
// 作答归一化
// ---------------------------------------------------------------------------

/**
 * 把模型交的卷归一成 `scoring.mjs` 认识的 Decision。
 *
 * 刻意**不做宽容修补**：模型没写 `from` 就保持没有 `from`，
 * 让 arg-provenance 那条检查如实红掉。这里只做类型层面的保底
 * （数组必须真是数组、args 必须真是对象），避免把判分器喂崩。
 */
export function normalizeDecision(raw, taskId) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const decision = { taskId }
  decision.outcome = ['call', 'clarify', 'unsupported'].includes(source.outcome) ? source.outcome : 'unsupported'
  if (typeof source.capabilityId === 'string' && source.capabilityId.trim()) {
    decision.capabilityId = source.capabilityId.trim()
  }
  if (Array.isArray(source.chain)) {
    decision.chain = source.chain.filter((x) => typeof x === 'string')
  } else {
    decision.chain = []
  }
  const args = {}
  if (source.args && typeof source.args === 'object' && !Array.isArray(source.args)) {
    for (const [key, spec] of Object.entries(source.args)) {
      if (spec !== null && typeof spec === 'object' && !Array.isArray(spec)) {
        args[key] = {
          value: spec.value,
          from: typeof spec.from === 'string' ? spec.from : '',
        }
        if (spec.deferred === true) args[key].deferred = true
      } else {
        // 模型把参数直接写成了裸值，没包 { value, from }：保底包一层，from 留空 → 判分如实红
        args[key] = { value: spec, from: '' }
      }
    }
  }
  decision.args = args
  if (Array.isArray(source.missing)) decision.missing = source.missing.filter((x) => typeof x === 'string')
  if (typeof source.pageRef === 'string' && source.pageRef.trim()) decision.pageRef = source.pageRef.trim()
  if (typeof source.notes === 'string' && source.notes.trim()) decision.notes = source.notes.trim()
  return decision
}

// ---------------------------------------------------------------------------
// agentic 循环
// ---------------------------------------------------------------------------

/**
 * 跑一题：给模型用户原话，让它自己决定调什么，最后交卷。
 *
 * @param {object} options
 * @param {import('./tasks.mjs').TASKS[number]} options.task
 * @param {object} options.sdk              复用同一个 SDK 实例
 * @param {(body: object) => Promise<object>} options.callMessages
 * @param {string} options.model
 * @param {number} [options.maxCatalogCalls]
 * @param {(line: string) => void} [options.log]
 */
export async function runTaskWithModel({
  task,
  sdk,
  callMessages,
  model,
  maxCatalogCalls = MAX_CATALOG_CALLS,
  maxRounds = MAX_ROUNDS,
  maxTokens = DEFAULT_MAX_TOKENS,
  system = SYSTEM_PROMPT,
  log = () => {},
}) {
  const messages = [{ role: 'user', content: task.utterance }]
  const trace = []
  const steps = []
  const usage = emptyUsage()
  const perRequest = []

  let catalogCalls = 0
  let refusedCalls = 0
  let forcedSubmit = false
  let nudges = 0
  let rounds = 0
  let roundsSinceBudget = 0
  let decision = null
  let rawDecision = null
  let error = null

  const budgetExceeded = () => refusedCalls > 0 || forcedSubmit

  while (rounds < maxRounds) {
    const exhausted = catalogCalls >= maxCatalogCalls
    const body = {
      model,
      max_tokens: maxTokens,
      system,
      tools: toolsForRequest(catalogCalls, maxCatalogCalls),
      messages,
    }
    if (exhausted && roundsSinceBudget >= 2) {
      // 预算用尽后提醒过一次、又过了一整轮还不交卷：强制交卷，别把额度烧在空转上。
      // 阈值是 2 不是 1——恰好用完预算就主动交卷的模型不该被记成「超限」。
      body.tool_choice = { type: 'tool', name: SUBMIT_DECISION_TOOL.name }
      forcedSubmit = true
    }

    let payload
    try {
      payload = await callMessages(body)
    } catch (err) {
      error = `第 ${rounds + 1} 轮调用模型失败：${err?.message ?? err}`
      break
    }
    rounds++
    Object.assign(usage, addUsage(usage, payload?.usage))
    usage.requests += 1
    perRequest.push({
      round: rounds,
      input_tokens: payload?.usage?.input_tokens ?? 0,
      output_tokens: payload?.usage?.output_tokens ?? 0,
      stop_reason: payload?.stop_reason ?? null,
      toolsOffered: body.tools.length,
      forced: Boolean(body.tool_choice),
    })
    log(
      `    · 第 ${rounds} 轮  in=${payload?.usage?.input_tokens ?? 0} out=${payload?.usage?.output_tokens ?? 0}` +
        `  累计 in=${usage.input_tokens} out=${usage.output_tokens}`,
    )

    const content = Array.isArray(payload?.content) ? payload.content : []
    const toolUses = content.filter((c) => c?.type === 'tool_use' && c.name)

    if (toolUses.length === 0) {
      nudges++
      if (nudges > MAX_NUDGES) {
        error = `模型连续 ${MAX_NUDGES} 次没有调用任何工具，也没有交卷`
        break
      }
      messages.push({ role: 'assistant', content })
      messages.push({ role: 'user', content: '请立刻用 submit_decision 工具提交你的最终决定。' })
      continue
    }

    messages.push({ role: 'assistant', content })
    const toolResults = []

    for (const use of toolUses) {
      if (use.name === SUBMIT_DECISION_TOOL.name) {
        rawDecision = use.input ?? {}
        decision = normalizeDecision(rawDecision, task.id)
        toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: '已收到你的决定。' })
        continue
      }

      if (catalogCalls >= maxCatalogCalls) {
        refusedCalls++
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          is_error: true,
          content: `工具调用预算已用尽（本题上限 ${maxCatalogCalls} 次）。请立刻用 submit_decision 提交最终决定。`,
        })
        continue
      }

      catalogCalls++
      const outcome = executeCatalogTool(sdk, use.name, use.input)
      const resultJson = JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error })
      const call = formatCall(use.name, use.input)
      const saw = outcome.ok ? summarize(use.name, outcome.result) : `错误：${outcome.error}`
      trace.push({ call, saw })
      steps.push({
        index: catalogCalls,
        tool: use.name,
        args: use.input ?? {},
        ok: outcome.ok,
        error: outcome.error ?? null,
        resultBytes: resultJson.length,
        saw,
        // 完整快照：这就是模型当时看到的东西（已脱敏）。留着才能审计。
        result: outcome.result,
      })
      log(`    → ${call}`)
      log(`      看到：${saw}`)
      toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: resultJson })
    }

    messages.push({ role: 'user', content: toolResults })
    if (decision) break

    if (catalogCalls >= maxCatalogCalls) {
      roundsSinceBudget++
      if (roundsSinceBudget === 1) {
        messages.push({
          role: 'user',
          content: `工具调用预算（本题上限 ${maxCatalogCalls} 次）已用尽，请立刻用 submit_decision 提交最终决定。`,
        })
      }
    }
  }

  if (!decision && !error) {
    error = `跑完 ${rounds} 轮仍未拿到 submit_decision`
  }

  return {
    taskId: task.id,
    kind: task.kind,
    utterance: task.utterance,
    decision,
    rawDecision,
    trace,
    steps,
    usage,
    perRequest,
    rounds,
    catalogCalls,
    refusedCalls,
    forcedSubmit,
    budgetExceeded: budgetExceeded(),
    error,
  }
}

// ---------------------------------------------------------------------------
// 整轮
// ---------------------------------------------------------------------------

/**
 * 用指定的入口建一个 SDK 实例（`--dist <目录>` 用）。
 *
 * 复用 consumer-view 的假凭据：目录是静态的，这条链路一次网络都不发。
 * 走的是 consumer-view 的 `loadEntry`，因此「公开入口」这件事只有一处定义。
 */
export async function makeSdkAt(entryPath) {
  const mod = await loadEntry([entryPath])
  return mod.createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'eval-consumer-view', tenantId: 1 },
  })
}

/**
 * 协议指纹：这次运行到底量的是哪一版协议。
 *
 * 并行的代理在改 `src/catalog/**`，`dist/` 随时可能换一版。把关键形状记进产物，
 * 事后才能回答「这份结果是协议哪一版跑出来的」——否则数字是漂的。
 */
export function protocolFingerprint(sdk) {
  const recommend = sdk.catalog.recommend('订会议室')
  const describe = sdk.catalog.describe('meeting-application-submit')
  const prepare = sdk.catalog.describe('meeting-application-prepare')
  const firstNext = (recommend?.next ?? [])[0]
  return {
    recommendKeys: Object.keys(recommend ?? {}).sort(),
    describeKeys: Object.keys(describe ?? {}).sort(),
    nextStepKeys: Object.keys(firstNext ?? {}).sort(),
    // G1：describe 给不给执行绑定
    hasInvokeBinding: Boolean(describe?.invoke),
    // G2：长选项参数有没有候选来源
    hasLookup: Array.isArray(prepare?.params)
      ? prepare.params.some((p) => p?.lookup !== undefined && p?.lookup !== null)
      : false,
    // G3：next 的边有没有标性质
    hasEdgeRole: Boolean(firstNext && 'role' in firstNext),
    // G4/G5：recommend 有没有读写意图与显式否定
    hasIntentSignal: Boolean(recommend && ('intent' in recommend || 'capabilityGroups' in recommend)),
    hasExplicitNegative: Boolean(recommend && 'ok' in recommend),
    registeredCapabilityIds: listRegisteredCapabilityIds(sdk),
  }
}

/**
 * 跑完整一轮：建 SDK、逐题跑模型、判分、汇总。
 *
 * `fetchImpl` 可注入——测试用确定性桩模型，真实运行用全局 fetch。
 * `sdk` 也可注入——用来把一轮评测钉在某一版 dist 上（并行改协议时这是必须的）。
 * `entryCandidates` 显式给出用哪份入口：**测试传 `SOURCE_ENTRY_CANDIDATES`**，
 * 否则这一轮会读 dist——而 dist 是 `.githooks/pre-commit` 会重建的产物。
 */
export async function runModelEval({
  tasks = TASKS,
  config,
  fetchImpl = globalThis.fetch,
  maxCatalogCalls = MAX_CATALOG_CALLS,
  system = SYSTEM_PROMPT,
  maxTokens = DEFAULT_MAX_TOKENS,
  client,
  sdk: injectedSdk,
  entryPath,
  entryCandidates,
  log = () => {},
} = {}) {
  const modelClient = client ?? createModelClient({ config, fetchImpl })
  const sdk =
    injectedSdk ??
    (entryCandidates !== undefined
      ? await makeSdk(entryCandidates)
      : entryPath !== undefined
        ? await makeSdkAt(entryPath)
        : await makeSdk())
  const registeredCapabilityIds = listRegisteredCapabilityIds(sdk)
  const fingerprint = protocolFingerprint(sdk)

  const taskRuns = []
  for (const task of tasks) {
    log('')
    log(`── ${task.id} [${task.kind}] ${task.utterance}`)
    const run = await runTaskWithModel({
      task,
      sdk,
      callMessages: modelClient.callMessages,
      model: config?.model ?? DEFAULT_MODEL,
      maxCatalogCalls,
      maxTokens,
      system,
      log,
    })
    taskRuns.push(run)
    log(
      `    本题合计：工具 ${run.catalogCalls} 次，轮 ${run.rounds}，` +
        `in=${run.usage.input_tokens} out=${run.usage.output_tokens}` +
        `${run.budgetExceeded ? '，预算超限' : ''}${run.error ? `，错误：${run.error}` : ''}`,
    )
  }

  const decisions = Object.fromEntries(taskRuns.map((r) => [r.taskId, r.decision ?? undefined]))
  const scored = scoreRun(tasks, decisions, { registeredCapabilityIds })

  const totalUsage = taskRuns.reduce((acc, r) => addUsage(acc, r.usage), emptyUsage())

  return {
    runAt: new Date().toISOString(),
    model: config?.model ?? DEFAULT_MODEL,
    endpointHost: hostOf(config?.baseUrl),
    maxCatalogCalls,
    system,
    registeredCapabilityIds,
    fingerprint,
    distEntry:
      entryPath ??
      (entryCandidates === undefined
        ? '(consumer-view 默认入口，即 ../../dist/index.js)'
        : `(显式入口：${entryCandidates.join('、')})`),
    // 只记数量，不记名单：名单本身就是「内部字段长什么样」，
    // 而这份产物的清洁性由 writeRunFile 的守卫保证（见下）。
    redactedKeyCount: INTERNAL_KEYS.length,
    usage: totalUsage,
    summary: { total: scored.total, passed: scored.passed, failed: scored.failed },
    results: scored.results.map((result) => {
      const run = taskRuns.find((r) => r.taskId === result.taskId)
      return {
        ...result,
        outcome: run?.decision?.outcome ?? null,
        capabilityId: run?.decision?.capabilityId ?? null,
        catalogCalls: run?.catalogCalls ?? 0,
        rounds: run?.rounds ?? 0,
        budgetExceeded: run?.budgetExceeded ?? false,
        error: run?.error ?? null,
      }
    }),
    runs: taskRuns,
  }
}

function hostOf(baseUrl) {
  if (!baseUrl) return null
  try {
    return new URL(baseUrl).host
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 落盘与再判分
// ---------------------------------------------------------------------------

/**
 * 时间戳 → 文件名安全的形式（ISO 里的冒号换成短横）。
 *
 * `label` 用来标轮次（同一协议跑多轮做稳定性对比时必需）：
 * `round2-fixed-2026-09-20T13-10-00-000Z.json`。
 */
export function runFileName(now = new Date(), label = '') {
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  return label ? `${label}-${stamp}.json` : `${stamp}.json`
}

/**
 * 落盘一次真实运行。
 *
 * 只写模型看得见的东西与它吐出来的东西：**不写 token / API key**。
 * 存下来之后 `--score` 就能脱离网络复跑判分，结果也可审计。
 *
 * 落盘前做一次**泄露自检**：产物里出现任何 `INTERNAL_KEYS` 的键就抛错。
 * 这份产物是要给人审计的，如果连它都混进了内部结构，脱敏这道关口就名存实亡了。
 */
export function writeRunFile(payload, { dir = DEFAULT_RUN_DIR, now = new Date(), label = '' } = {}) {
  const file = join(dir, runFileName(now, label))
  mkdirSync(dir, { recursive: true })
  const sanitized = JSON.parse(
    JSON.stringify(payload, (key, value) => (key === 'token' || key === 'authToken' ? undefined : value)),
  )
  if (label) sanitized.label = label
  sanitized.runFile = file
  const text = `${JSON.stringify(sanitized, null, 1)}\n`
  const leaked = INTERNAL_KEYS.filter((key) => text.includes(`"${key}"`))
  if (leaked.length) {
    throw new Error(
      `拒绝落盘：运行产物里出现了内部字段 ${leaked.join('、')}。` +
        '这表示某次工具返回值没有走 consumer-view 的 redact()，先修脱敏再重跑。',
    )
  }
  writeFileSync(file, text, 'utf8')
  return file
}

/** 读一次落盘的运行，重跑判分——不碰网络、不花额度。 */
export function scoreRunFile(file) {
  const payload = JSON.parse(readFileSync(file, 'utf8'))
  const decisions = Object.fromEntries(
    (payload.runs ?? []).map((r) => [r.taskId, r.decision ?? undefined]),
  )
  const tasks = TASKS.filter((t) => decisions[t.id] !== undefined || (payload.runs ?? []).some((r) => r.taskId === t.id))
  return {
    payload,
    scored: scoreRun(tasks, decisions, { registeredCapabilityIds: payload.registeredCapabilityIds ?? [] }),
  }
}

// ---------------------------------------------------------------------------
// 打印
// ---------------------------------------------------------------------------

const line = (s = '') => console.log(s)

function fmtUsage(u) {
  return `in=${u.input_tokens} out=${u.output_tokens} 请求=${u.requests}`
}

export function printReport(payload, { withTrace = true } = {}) {
  line('='.repeat(72))
  line('portal-headless · AI 消费 -llm 协议 · 真实模型评测')
  line(`模型 ${payload.model}  ·  端点 ${payload.endpointHost ?? '(未记录)'}`)
  line(`跑于 ${payload.runAt}  ·  每题工具上限 ${payload.maxCatalogCalls} 次`)
  if (payload.fingerprint) {
    const f = payload.fingerprint
    line(
      `协议指纹：invoke 绑定=${f.hasInvokeBinding} · lookup=${f.hasLookup} · 边的 role=${f.hasEdgeRole}` +
        ` · recommend 意图=${f.hasIntentSignal} · 显式否定=${f.hasExplicitNegative}`,
    )
    line(`被测入口：${payload.distEntry ?? '(未记录)'}`)
  }
  line(`通过 ${payload.summary.passed}/${payload.summary.total}`)
  line(`token 合计：${fmtUsage(payload.usage)}`)
  line('='.repeat(72))

  for (const r of payload.results) {
    const run = payload.runs.find((x) => x.taskId === r.taskId)
    line()
    line(`${r.passed ? 'PASS' : 'FAIL'}  ${r.taskId}  [${r.kind}]`)
    line(`  用户原话：${run?.utterance ?? ''}`)
    line(`  作答：outcome=${r.outcome ?? '(无)'}${r.capabilityId ? ` → ${r.capabilityId}` : ''}`)
    if (run?.decision?.missing?.length) line(`  要问用户：${run.decision.missing.join('、')}`)
    if (run?.decision?.pageRef) line(`  命中页面：${run.decision.pageRef}`)
    if (run?.decision?.args && Object.keys(run.decision.args).length) {
      line('  参数：')
      for (const [k, spec] of Object.entries(run.decision.args)) {
        line(`    ${k} = ${JSON.stringify(spec.value)}${spec.deferred ? ' [需真调]' : ''}   ← ${spec.from || '(没交代出处)'}`)
      }
    }
    line(`  过程：工具 ${r.catalogCalls} 次 / ${r.rounds} 轮，token in=${run?.usage.input_tokens} out=${run?.usage.output_tokens}`)
    if (withTrace) {
      for (const s of run?.trace ?? []) {
        line(`    → ${s.call}`)
        line(`      看到：${s.saw}`)
      }
    }
    if (r.budgetExceeded) line('  ⚠ 预算超限：模型试图超出每题工具上限，或被迫收卷')
    if (r.error) line(`  ⚠ ${r.error}`)
    line('  判分：')
    for (const c of r.checks) line(`    ${c.ok ? '·' : '×'} ${c.name.padEnd(26)} ${c.detail}`)
  }

  line()
  line('-'.repeat(72))
  line(`通过 ${payload.summary.passed}/${payload.summary.total}  ·  token 合计 ${fmtUsage(payload.usage)}`)
  if (payload.summary.failed) {
    line(`未过：${payload.results.filter((r) => !r.passed).map((r) => r.taskId).join('、')}`)
  }
  line(`（每次工具返回值都过了 consumer-view 的脱敏，剥掉 ${INTERNAL_KEYS.length} 个内部字段：${INTERNAL_KEYS.join('、')}）`)
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const dry = args.includes('--dry')
  const scoreIdx = args.indexOf('--score')
  const outIdx = args.indexOf('--out')
  const distIdx = args.indexOf('--dist')
  const labelIdx = args.indexOf('--label')
  const valueIdxs = [scoreIdx, outIdx, distIdx, labelIdx].filter((i) => i >= 0).map((i) => i + 1)
  const filters = args.filter((a, i) => !a.startsWith('--') && !valueIdxs.includes(i))

  if (scoreIdx >= 0) {
    const file = args[scoreIdx + 1]
    if (!file) {
      console.error('--score 需要一个运行文件路径，例如：node tools/eval/model.mjs --score tools/eval/model-runs/xxx.json')
      process.exit(2)
    }
    const { payload, scored } = scoreRunFile(file)
    line(`离线判分：${file}`)
    line(`模型 ${payload.model} · 跑于 ${payload.runAt ?? '(未记录)'} · token ${fmtUsage(payload.usage ?? emptyUsage())}`)
    if (payload.fingerprint) {
      const f = payload.fingerprint
      line(
        `协议指纹：invoke 绑定=${f.hasInvokeBinding} · lookup=${f.hasLookup} · 边的 role=${f.hasEdgeRole}` +
          ` · recommend 意图=${f.hasIntentSignal} · 显式否定=${f.hasExplicitNegative}`,
      )
    }
    line(`通过 ${scored.passed}/${scored.total}`)
    for (const r of scored.results) {
      line()
      line(`${r.passed ? 'PASS' : 'FAIL'}  ${r.taskId}  [${r.kind}]`)
      for (const c of r.checks) line(`    ${c.ok ? '·' : '×'} ${c.name.padEnd(26)} ${c.detail}`)
    }
    process.exit(scored.failed === 0 ? 0 : 1)
  }

  const config = readModelConfig()

  if (dry) {
    line(`模型 ${config.model}  ·  端点 ${messagesUrl(config.baseUrl)}（token 已读到，不回显）`)
    line(`每题目录工具上限 ${MAX_CATALOG_CALLS} 次`)
    line()
    line('工具定义：')
    for (const t of toolsForRequest(0)) line(`  - ${t.name}`)
    line()
    line('系统提示：')
    line(SYSTEM_PROMPT)
    return
  }

  const tasks = filters.length
    ? TASKS.filter((t) => filters.some((f) => t.id.toLowerCase().startsWith(f.toLowerCase())))
    : TASKS
  if (tasks.length === 0) {
    console.error(`没有匹配的任务。已知：${TASKS.map((t) => t.id).join('、')}`)
    process.exit(2)
  }

  const payload = await runModelEval({
    tasks,
    config,
    entryPath: distIdx >= 0 ? args[distIdx + 1] : undefined,
    log: (s) => line(s),
  })
  const label = labelIdx >= 0 ? String(args[labelIdx + 1] ?? '') : ''
  const file = writeRunFile(payload, {
    ...(outIdx >= 0 ? { dir: args[outIdx + 1] } : {}),
    label,
  })

  if (asJson) {
    console.log(JSON.stringify(payload, null, 1))
  } else {
    printReport(payload, { withTrace: !args.includes('--no-trace') })
  }
  line()
  line(`运行已落盘：${file}（不含 token；可用 --score 脱离网络复跑判分）`)

  process.exit(payload.summary.failed === 0 ? 0 : 1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`\n运行失败：${error?.message ?? error}`)
    process.exit(1)
  })
}
