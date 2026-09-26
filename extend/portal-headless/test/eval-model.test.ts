/**
 * 评测装置自检 ④：真实模型驱动器。
 *
 * 这一层最容易「看起来跑了、其实什么都没验」：真实模型的输出不可复现，
 * 拿它做断言等于没断言；但如果完全不测，驱动器坏了只会表现为「模型评测通过 5/5」，
 * 而那是所有坏法里最难发现的一种。
 *
 * 所以这里的模型是一个**确定性桩**：给定请求返回固定剧本，驱动器走完整条
 * agentic 循环。真实模型的运行结果不钉进测试，只落盘。
 *
 * 钉住的四件事：
 *   1. 循环：工具调用 → 真目录 → 结果回喂 → 交卷 → 判分，全链路能跑通。
 *   2. **脱敏**：模型看到的每一个字节都不含内部字段。这条另配一条反空转断言
 *      （不脱敏的原始返回里**确实**有内部字段），否则「没有内部字段」可能是因为
 *      目录里本来就没有，而不是因为剥掉了。
 *   3. 预算护栏：超限不再放行目录工具、标记 budgetExceeded、强制收卷。
 *   4. 评分对接：模型吐的 decision 原样进 scoring，没写 `from` 就如实红。
 *
 * **本文件一律走源码入口**（`makeSourceSdk()` / `entryCandidates: SOURCE_ENTRY_CANDIDATES`），
 * 不读 dist。dist 是 `.githooks/pre-commit` 每次提交前用整个工作区重建的产物，
 * 断言钉在上面就会随「刚才谁提交过」时绿时红。唯一的例外是下面那条「定版入口」，
 * 它测的就是把评测钉在构建产物上这个能力，所以它读 dist 是断言对象本身。
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CATALOG_TOOLS,
  MAX_CATALOG_CALLS,
  SUBMIT_DECISION_TOOL,
  addUsage,
  createModelClient,
  emptyUsage,
  executeCatalogTool,
  formatCall,
  makeSdkAt,
  messagesUrl,
  normalizeDecision,
  protocolFingerprint,
  readModelConfig,
  runFileName,
  runModelEval,
  runTaskWithModel,
  scoreRunFile,
  summarize,
  SYSTEM_PROMPT,
  toolsForRequest,
  writeRunFile,
  type ModelRunPayload,
} from '../tools/eval/model.mjs'
import {
  INTERNAL_KEYS,
  SOURCE_ENTRY_CANDIDATES,
  makeSourceSdk,
  redact,
} from '../tools/eval/consumer-view.mjs'
import { EVAL_TODAY, getTask, TASKS } from '../tools/eval/tasks.mjs'
import { scoreRun, type Decision } from '../tools/eval/scoring.mjs'

// ---------------------------------------------------------------------------
// 桩模型
// ---------------------------------------------------------------------------

interface StubResponse {
  id: string
  type: 'message'
  model: string
  stop_reason: string
  content: unknown[]
  usage: Record<string, number>
}

let stubSeq = 0

function respond(content: unknown[], stopReason = 'tool_use'): StubResponse {
  stubSeq += 1
  return {
    id: `stub-${stubSeq}`,
    type: 'message',
    model: 'stub',
    stop_reason: stopReason,
    content,
    usage: { input_tokens: 100, output_tokens: 20 },
  }
}

function callTool(name: string, input: Record<string, unknown>): StubResponse {
  return respond([{ type: 'tool_use', id: `call-${stubSeq}`, name, input }])
}

function submit(input: Record<string, unknown>): StubResponse {
  return respond([{ type: 'tool_use', id: `call-${stubSeq}`, name: SUBMIT_DECISION_TOOL.name, input }])
}

/**
 * 桩模型的 HTTP 层。
 *
 * 剧本按「这题的第几次目录工具调用」推进：第 N 次请求就还剧本里的第 N 步，
 * 剧本走完就交卷。`tool_choice` 被强制时优先交卷——用来测「预算用尽后强制收卷」。
 */
function makeStubFetch(plan: (body: StubRequest, catalogStep: number) => StubResponse) {
  const requests: StubRequest[] = []
  const fetchImpl = async (_url: string, init: Record<string, unknown>) => {
    const body = JSON.parse(String(init.body)) as StubRequest
    requests.push(body)
    return { ok: true, status: 200, json: async () => plan(body, countCatalogResults(body)) }
  }
  return { fetchImpl, requests }
}

interface StubRequest {
  model: string
  system?: string
  tools: Array<{ name: string }>
  tool_choice?: { type: string; name?: string }
  messages: Array<{ role: string; content: unknown }>
}

/** 数一数这轮请求里已经回喂了几次目录工具结果（= 模型已经用掉几次预算）。 */
function countCatalogResults(body: StubRequest): number {
  let n = 0
  for (const message of body.messages) {
    if (message.role !== 'user' || !Array.isArray(message.content)) continue
    for (const block of message.content as Array<{ type?: string }>) {
      if (block?.type === 'tool_result') n += 1
    }
  }
  return n
}

/** 把请求体里所有 tool_result 的文本摊平——这就是「模型看到的东西」。 */
function modelVisibleText(requests: StubRequest[]): string {
  const parts: string[] = []
  for (const body of requests) {
    parts.push(JSON.stringify(body.tools), String(body.system ?? ''))
    for (const message of body.messages) {
      if (message.role === 'user' && Array.isArray(message.content)) {
        for (const block of message.content as Array<{ type?: string; content?: unknown }>) {
          if (block?.type === 'tool_result') parts.push(String(block.content ?? ''))
        }
      }
    }
  }
  return parts.join('\n')
}

const STUB_CONFIG = { baseUrl: 'https://stub.invalid/anthropic', token: 'stub-token', model: 'stub-model' }

/** 桩模型的 callMessages：走真实的 createModelClient，只有 fetch 被换掉。 */
function stubClient(fetchImpl: (url: string, init: Record<string, unknown>) => Promise<Record<string, unknown>>) {
  return createModelClient({ config: STUB_CONFIG, fetchImpl })
}

/** T1 的金标准作答：桩模型走完就是它，用来验证「循环 → 判分」是通的。 */
const T1_GOAL: Decision = {
  taskId: 'T1-direct-lookup',
  outcome: 'call',
  capabilityId: 'meeting-room-list',
  chain: ['meeting-room-list'],
  args: {
    pageNo: { value: 1, from: 'describe(meeting-room-list) 的默认值' },
    pageSize: { value: 20, from: 'describe(meeting-room-list) 的默认值，取 20 少翻一页' },
  },
}

// ---------------------------------------------------------------------------
// 1. 模型配置
// ---------------------------------------------------------------------------

describe('model · 模型配置', () => {
  it('缺环境变量时抛出可操作的错误，两个变量名都要点到', () => {
    expect(() => readModelConfig({})).toThrowError(/ANTHROPIC_BASE_URL/)
    expect(() => readModelConfig({})).toThrowError(/ANTHROPIC_AUTH_TOKEN/)
    // 只给一半也要报
    expect(() => readModelConfig({ ANTHROPIC_BASE_URL: 'https://x' })).toThrowError(/ANTHROPIC_AUTH_TOKEN/)
  })

  it('读到了就把 [1M] 这类上下文后缀去掉（它不是模型名的一部分）', () => {
    const config = readModelConfig({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic/',
      ANTHROPIC_AUTH_TOKEN: 'tok',
      ANTHROPIC_MODEL: 'deepseek-flash[1M]',
    })
    expect(config).toEqual({
      baseUrl: 'https://api.deepseek.com/anthropic',
      token: 'tok',
      model: 'deepseek-flash',
    })
  })

  it('EVAL_MODEL 优先级高于 ANTHROPIC_MODEL', () => {
    const config = readModelConfig({
      ANTHROPIC_BASE_URL: 'https://x',
      ANTHROPIC_AUTH_TOKEN: 't',
      ANTHROPIC_MODEL: 'a',
      EVAL_MODEL: 'b',
    })
    expect(config.model).toBe('b')
  })

  it('base 已带 /v1 时不重复拼', () => {
    expect(messagesUrl('https://x/anthropic')).toBe('https://x/anthropic/v1/messages')
    expect(messagesUrl('https://x/anthropic/v1')).toBe('https://x/anthropic/v1/messages')
  })
})

// ---------------------------------------------------------------------------
// 2. 工具面
// ---------------------------------------------------------------------------

describe('model · 工具面与预算', () => {
  it('预算内给 6 个目录工具 + 交卷工具，用尽后目录工具下架', () => {
    const full = toolsForRequest(0)
    expect(full.map((t) => t.name)).toEqual([
      'recommend',
      'search',
      'listDomains',
      'listPages',
      'describePage',
      'describe',
      'submit_decision',
    ])
    expect(CATALOG_TOOLS).toHaveLength(6)
    const trimmed = toolsForRequest(MAX_CATALOG_CALLS)
    expect(trimmed.map((t) => t.name)).toEqual(['submit_decision'])
  })

  it('交卷工具把 args 的出处写成必填 —— 这是判分要的东西，得让模型知道', () => {
    const properties = SUBMIT_DECISION_TOOL.input_schema.properties as Record<
      string,
      { required?: string[]; additionalProperties?: { required?: string[] } }
    >
    expect(properties.args?.additionalProperties?.required).toEqual(['from'])
  })

  it('系统提示只讲作答格式与基准日，不含任何判分字段', () => {
    expect(SYSTEM_PROMPT).toContain(EVAL_TODAY)
    // 判分口径一个字都不能进 prompt —— 泄露了这轮评测就废了
    for (const task of TASKS) {
      expect(SYSTEM_PROMPT).not.toContain(task.id)
      expect(SYSTEM_PROMPT).not.toContain(task.goal)
      for (const id of task.expect.acceptableCapabilityIds ?? []) {
        expect(SYSTEM_PROMPT).not.toContain(id)
      }
      for (const id of task.expect.requiredChain ?? []) {
        expect(SYSTEM_PROMPT).not.toContain(id)
      }
      for (const ref of task.expect.acceptablePageRefs ?? []) {
        expect(SYSTEM_PROMPT).not.toContain(ref)
      }
    }
  })

  it('工具调用写法与 answers.mjs 的 trace 风格一致', () => {
    expect(formatCall('recommend', { utterance: '帮我调薪' })).toBe('recommend("帮我调薪")')
    expect(formatCall('listDomains', {})).toBe('listDomains()')
    expect(formatCall('describe', { capabilityId: 'meeting-room-list' })).toBe('describe("meeting-room-list")')
  })

  it('摘要读的是真返回的形状，不是硬编码常量', async () => {
    const sdk = await makeSourceSdk()
    const list = executeCatalogTool(sdk, 'describe', { capabilityId: 'meeting-room-list' })
    expect(list.ok).toBe(true)
    expect(summarize('describe', list.result)).toMatch(/capabilityId=meeting-room-list/)
    expect(summarize('describe', list.result)).toMatch(/params \d+/)

    // 关键词要选**真的搜不到**的那个。这条测试验的是「摘要器读的是真实返回形状」（用零结果证明），
    // 不是「某个词该不该搜得到」——原来这里写的是「报销差旅费」，那是因为当时还没实现差旅费能力；
    // 2026-09-21 实现了差旅费报销之后，它**正确地**能搜到了。
    //
    // ⚠️ 换词时注意：`search` 是**模糊匹配**，含中文的词很容易撞上某个能力的标题
    // （试过「zzz-这个词一定搜不到-zzz」，它命中了「…会不会被连带**禁用**」那条）。
    // 用一串纯拉丁字母最稳。下次再遇到这条红，先想清楚是摘要器坏了，还是这个词又能搜到了。
    const zero = executeCatalogTool(sdk, 'search', { keyword: 'zzzqqqwww' })
    expect(summarize('search', zero.result)).toBe('total=0，hits 0')
  }, 15000)

  it('目录调用抛错时不炸整轮，变成一条带错误的工具结果', async () => {
    const brokenSdk = {
      catalog: {
        describe() {
          throw new Error('模拟的目录故障')
        },
      },
    }
    const outcome = executeCatalogTool(brokenSdk, 'describe', { capabilityId: 'x' })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toMatch(/模拟的目录故障/)
  })
})

// ---------------------------------------------------------------------------
// 3. 脱敏 —— 这台装置的命根子
// ---------------------------------------------------------------------------

describe('model · 模型只看得到调用方视角', () => {
  it('反空转：不脱敏的原始目录返回里确实有内部字段', async () => {
    const sdk = await makeSourceSdk()
    const raw = sdk.catalog.describe('meeting-room-list')
    const rawText = JSON.stringify(raw)
    // 如果这条红了，说明「下面那条不泄露」的断言是空的：目录里本来就没有内部字段，
    // 剥不剥都干净，脱敏坏掉了也测不出来。
    const leaked = INTERNAL_KEYS.filter((key) => rawText.includes(`"${key}"`))
    expect(leaked.length).toBeGreaterThan(0)
    expect(redact(raw)).not.toHaveProperty('routeFile')
  })

  it('六个目录工具全调一遍：模型收到的每一个字节里都不含内部字段', async () => {
    const { fetchImpl, requests } = makeStubFetch((_body, step) => {
      const plan = [
        callTool('recommend', { utterance: '查一下会议室有哪些' }),
        callTool('search', { keyword: '会议室' }),
        callTool('listDomains', {}),
        callTool('listPages', { domain: 'meeting-room' }),
        callTool('describePage', { pageId: '/dashboard/meeting-room/list' }),
        callTool('describe', { capabilityId: 'meeting-room-list' }),
        submit(T1_GOAL as unknown as Record<string, unknown>),
      ]
      return plan[Math.min(step, plan.length - 1)] as StubResponse
    })

    const payload = await runModelEval({
      tasks: [getTask('T1-direct-lookup')],
      config: STUB_CONFIG,
      fetchImpl,
      entryCandidates: SOURCE_ENTRY_CANDIDATES,
    })

    // 六个工具一个都不少：任何一个漏掉 redact() 都会在这里被逮住。
    expect(payload.runs[0]?.steps.map((s) => s.tool)).toEqual([
      'recommend',
      'search',
      'listDomains',
      'listPages',
      'describePage',
      'describe',
    ])

    const visible = modelVisibleText(requests)
    const leaked = INTERNAL_KEYS.filter((key) => visible.includes(`"${key}"`))
    expect(leaked).toEqual([])

    // 反空转：这六个返回里至少有三个（recommend / listPages / describePage / describe）
    // 的**原始**形态是带内部字段的。如果哪天目录变了、原始返回也干净了，
    // 上面那条断言就变成空的——这条会先红，提醒换一个能泄露字段的样本。
    const sdk = await makeSourceSdk()
    const rawLeaking = [
      sdk.catalog.recommend('查一下会议室有哪些'),
      sdk.catalog.listPages('meeting-room'),
      sdk.catalog.describePage('/dashboard/meeting-room/list'),
      sdk.catalog.describe('meeting-room-list'),
    ].filter((raw) => INTERNAL_KEYS.some((key) => JSON.stringify(raw).includes(`"${key}"`)))
    expect(rawLeaking.length).toBeGreaterThanOrEqual(3)
  })

  it('落盘的运行文件里也不含内部字段（审计面同样干净）', async () => {
    const { fetchImpl } = makeStubFetch((_body, step) =>
      step === 0 ? callTool('describePage', { pageId: '/dashboard/salary/adjust/list' }) : submit({ outcome: 'unsupported' }),
    )
    const payload = await runModelEval({
      tasks: [getTask('T4-slang-pay-adjust')],
      config: STUB_CONFIG,
      fetchImpl,
      entryCandidates: SOURCE_ENTRY_CANDIDATES,
    })
    const text = JSON.stringify(payload)
    expect(INTERNAL_KEYS.filter((key) => text.includes(`"${key}"`))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. agentic 循环
// ---------------------------------------------------------------------------

describe('model · agentic 循环', () => {
  it('模型自己决定调什么：调用序列与真实返回都被记进 trace 与 steps', async () => {
    const { fetchImpl } = makeStubFetch((_body, step) =>
      step === 0
        ? callTool('recommend', { utterance: '查一下会议室有哪些' })
        : step === 1
          ? callTool('search', { keyword: '会议室' })
          : step === 2
            ? callTool('describe', { capabilityId: 'meeting-room-list' })
            : submit(T1_GOAL as unknown as Record<string, unknown>),
    )

    const run = await runTaskWithModel({
      task: getTask('T1-direct-lookup'),
      sdk: await makeSourceSdk(),
      callMessages: stubClient(fetchImpl).callMessages,
      model: 'stub-model',
    })

    expect(run.trace.map((t) => t.call)).toEqual([
      'recommend("查一下会议室有哪些")',
      'search("会议室")',
      'describe("meeting-room-list")',
    ])
    // steps 里存的是模型当时看到的那份**已脱敏**返回
    expect(run.steps[0]?.result).toMatchObject({ text: '查一下会议室有哪些' })
    expect(run.steps[0]?.saw).toMatch(/capabilities 5 条/)
    expect(run.decision).toEqual(T1_GOAL)
    expect(run.catalogCalls).toBe(3)
    expect(run.budgetExceeded).toBe(false)
    expect(run.error).toBeNull()
    // 记账：每次请求的用量都在，且和整题合计对得上
    expect(run.perRequest).toHaveLength(4)
    expect(run.usage.requests).toBe(4)
    expect(run.usage.input_tokens).toBe(400)
    expect(run.usage.output_tokens).toBe(80)
  })

  it('模型不交卷、只说话：先提醒，提醒用完就记为错误而不是静默当通过', async () => {
    const { fetchImpl } = makeStubFetch(() => respond([{ type: 'text', text: '我觉得应该查一下会议室' }], 'end_turn'))
    const run = await runTaskWithModel({
      task: getTask('T1-direct-lookup'),
      sdk: await makeSourceSdk(),
      callMessages: stubClient(fetchImpl).callMessages,
      model: 'stub-model',
    })
    expect(run.decision).toBeNull()
    expect(run.error).toMatch(/没有调用任何工具/)
    expect(run.catalogCalls).toBe(0)
  })

  it('预算护栏：第 9 次目录调用被拒，标记 budgetExceeded，并强制收卷', async () => {
    let sawForcedChoice = false
    const { fetchImpl } = makeStubFetch((body) => {
      if (body.tool_choice?.name === SUBMIT_DECISION_TOOL.name) {
        sawForcedChoice = true
        return submit({ outcome: 'call', capabilityId: 'meeting-room-list', chain: [], args: {} })
      }
      // 一直查下去，永不主动交卷
      return callTool('search', { keyword: '会议室' })
    })

    const run = await runTaskWithModel({
      task: getTask('T1-direct-lookup'),
      sdk: await makeSourceSdk(),
      callMessages: stubClient(fetchImpl).callMessages,
      model: 'stub-model',
    })

    expect(run.catalogCalls).toBe(MAX_CATALOG_CALLS)
    expect(run.refusedCalls).toBeGreaterThan(0)
    expect(run.budgetExceeded).toBe(true)
    expect(sawForcedChoice).toBe(true)
    // 收卷收下的是当时已有的决策，不是空
    expect(run.decision?.capabilityId).toBe('meeting-room-list')
  })

  it('恰好用完 8 次预算、然后主动交卷：不算超限', async () => {
    const { fetchImpl } = makeStubFetch((_body, step) =>
      step < MAX_CATALOG_CALLS
        ? callTool('search', { keyword: `会议室${step}` })
        : submit({ outcome: 'call', capabilityId: 'meeting-room-list', chain: [], args: {} }),
    )
    const run = await runTaskWithModel({
      task: getTask('T1-direct-lookup'),
      sdk: await makeSourceSdk(),
      callMessages: stubClient(fetchImpl).callMessages,
      model: 'stub-model',
    })
    expect(run.catalogCalls).toBe(MAX_CATALOG_CALLS)
    expect(run.refusedCalls).toBe(0)
    expect(run.budgetExceeded).toBe(false)
    expect(run.decision).not.toBeNull()
  })

  it('模型层报错时按题记错误，不让一轮评测整体崩掉', async () => {
    const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: '模型名不对' } }) })
    const payload = await runModelEval({
      tasks: [getTask('T1-direct-lookup')],
      config: STUB_CONFIG,
      fetchImpl,
      entryCandidates: SOURCE_ENTRY_CANDIDATES,
    })
    expect(payload.runs[0]?.error).toMatch(/模型名不对/)
    expect(payload.results[0]?.passed).toBe(false)
    expect(payload.results[0]?.checks[0]?.name).toBe('answer-present')
  })
})

// ---------------------------------------------------------------------------
// 5. 与判分对接
// ---------------------------------------------------------------------------

describe('model · 与判分对接', () => {
  it('桩模型跑完 T1，判分全过（循环 → 判分是通的）', async () => {
    const { fetchImpl } = makeStubFetch((_body, step) =>
      step === 0
        ? callTool('recommend', { utterance: '查一下会议室有哪些' })
        : step === 1
          ? callTool('describe', { capabilityId: 'meeting-room-list' })
          : submit(T1_GOAL as unknown as Record<string, unknown>),
    )
    const payload = await runModelEval({
      tasks: [getTask('T1-direct-lookup')],
      config: STUB_CONFIG,
      fetchImpl,
      entryCandidates: SOURCE_ENTRY_CANDIDATES,
    })
    expect(payload.summary).toEqual({ total: 1, passed: 1, failed: 0 })
    expect(payload.results[0]?.checks.every((c) => c.ok)).toBe(true)
  })

  it('noshape 保底：模型把参数写成裸值时，判分不崩而是如实报「没交代出处」', () => {
    const decision = normalizeDecision(
      { outcome: 'call', capabilityId: 'meeting-room-list', args: { pageNo: 1 } },
      'T1-direct-lookup',
    )
    expect(decision.args?.pageNo).toEqual({ value: 1, from: '' })
    const scored = scoreRun([getTask('T1-direct-lookup')], { 'T1-direct-lookup': decision }, {
      registeredCapabilityIds: ['meeting-room-list'],
    })
    const provenance = scored.results[0]?.checks.find((c) => c.name === 'arg-provenance')
    expect(provenance?.ok).toBe(false)
    expect(provenance?.detail).toMatch(/pageNo/)
  })

  it('outcome 缺失/非法时归一到 unsupported，不编造能力', () => {
    const decision = normalizeDecision({ args: { a: { value: 1, from: 'x' } } }, 'T1-direct-lookup')
    expect(decision.outcome).toBe('unsupported')
    expect(decision.capabilityId).toBeUndefined()
    expect(decision.chain).toEqual([])
  })

  it('桩模型跑满 5 题：每题都有作答记录，判分逐题给出（真实模型的结果不钉断言）', async () => {
    const plan: Record<string, StubResponse> = {
      '查一下会议室有哪些': submit(T1_GOAL as unknown as Record<string, unknown>),
      '帮我订明天下午2点到3点的会议室，开周会，2个人': submit({
        outcome: 'call',
        capabilityId: 'meeting-application-submit',
        args: {},
      }),
      '订个会议室': submit({ outcome: 'clarify', missing: ['startTime'] }),
      '帮我调薪': submit({ outcome: 'unsupported', pageRef: '工资找齐' }),
      '报销差旅费': submit({ outcome: 'unsupported' }),
    }
    const { fetchImpl } = makeStubFetch((body) => {
      const first = body.messages[0]?.content
      const utterance = typeof first === 'string' ? first : ''
      return plan[utterance] ?? submit({ outcome: 'unsupported' })
    })
    const payload = await runModelEval({ config: STUB_CONFIG, fetchImpl, entryCandidates: SOURCE_ENTRY_CANDIDATES })
    expect(payload.runs).toHaveLength(TASKS.length)
    expect(payload.runs.every((r) => r.decision !== null)).toBe(true)
    expect(payload.runs.every((r) => r.error === null)).toBe(true)
    expect(payload.summary.total).toBe(5)

    // 判分口径没被这一层改动：逐题看判分器到底红在哪，而不是只看总数。
    const byId = Object.fromEntries(payload.results.map((r) => [r.taskId, r]))
    const failedChecks = (taskId: string) =>
      (byId[taskId]?.checks ?? []).filter((c) => !c.ok).map((c) => c.name)

    expect(byId['T1-direct-lookup']?.passed).toBe(true)
    expect(failedChecks('T2-drilldown-booking')).toContain('required-chain')
    expect(failedChecks('T3-missing-info')).toContain('clarification-covers')
    // T4/T5：一个空的 unsupported 对这两题就是完整答案，所以它们本来就该过——
    // 这两题测的是「模型会不会克制」，不是「模型会不会填参数」。
    expect(byId['T4-slang-pay-adjust']?.passed).toBe(true)
    expect(byId['T5-unsupported']?.passed).toBe(true)
    expect(payload.summary.passed).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// 6. 协议指纹与定版入口
// ---------------------------------------------------------------------------

describe('model · 协议指纹与定版入口', () => {
  it('指纹读的是真目录的形状，不是写死的常量', async () => {
    const sdk = await makeSourceSdk()
    const fingerprint = protocolFingerprint(sdk)
    expect(fingerprint.describeKeys).toContain('capabilityId')
    expect(fingerprint.describeKeys).toContain('params')
    expect(fingerprint.recommendKeys).toContain('capabilities')
    expect(fingerprint.nextStepKeys).toContain('tool')
    expect(fingerprint.registeredCapabilityIds).toContain('meeting-room-list')
    // G1/G2/G3/G4/G5 各自是「有 / 没有」，不是 true 也不是 false——并行的代理随时在改
    expect(typeof fingerprint.hasInvokeBinding).toBe('boolean')
    expect(typeof fingerprint.hasLookup).toBe('boolean')
    expect(typeof fingerprint.hasEdgeRole).toBe('boolean')
    expect(typeof fingerprint.hasIntentSignal).toBe('boolean')
    expect(typeof fingerprint.hasExplicitNegative).toBe('boolean')
  })

  it('指纹进得了落盘产物：事后能回答「这份数字是协议哪一版跑出来的」', async () => {
    const { fetchImpl } = makeStubFetch(() => submit({ outcome: 'unsupported' }))
    const payload = await runModelEval({
      tasks: [getTask('T5-unsupported')],
      config: STUB_CONFIG,
      fetchImpl,
      entryCandidates: SOURCE_ENTRY_CANDIDATES,
    })
    expect(payload.fingerprint?.registeredCapabilityIds).toContain('meeting-room-list')
    expect(JSON.stringify(payload)).toContain('"fingerprint"')
  })

  // 这一条**故意**钉在 dist 上：它测的就是「定版入口」这个能力本身（把一轮评测
  // 钉在某一版构建产物上，好让结果可复现）。所以它读 dist 不是失误，是它的断言对象；
  // 断言也相应地只要求「拿得到、清单非空」，不问具体形状。
  it('定版入口：可以把一轮评测钉在指定的构建产物上', async () => {
    const entryPath = new URL('../dist/index.js', import.meta.url).pathname
    const { fetchImpl } = makeStubFetch(() => submit({ outcome: 'unsupported' }))
    const payload = await runModelEval({
      tasks: [getTask('T5-unsupported')],
      config: STUB_CONFIG,
      fetchImpl,
      entryPath,
    })
    expect(payload.distEntry).toBe(entryPath)
    expect(payload.fingerprint?.registeredCapabilityIds.length).toBeGreaterThan(0)
  }, 15000)

  it('定版入口指错时报的是可操作的错（提示先 pnpm build），不是静默回落', async () => {
    await expect(makeSdkAt('/nonexistent/dist/index.js')).rejects.toThrowError(/pnpm build/)
  })
})

// ---------------------------------------------------------------------------
// 7. 记账与落盘
// ---------------------------------------------------------------------------

describe('model · 记账与落盘', () => {
  it('addUsage 对 requests 也是纯加法，整题并进总计时才不会退化成「几次请求」', () => {
    const taskUsage = { ...emptyUsage(), input_tokens: 10, output_tokens: 2, requests: 3 }
    const total = addUsage(emptyUsage(), taskUsage)
    expect(total.input_tokens).toBe(10)
    expect(total.output_tokens).toBe(2)
    // 3 次请求就是 3，不是 1 —— 「合并整题」和「合并单次响应」不能是两套计数
    expect(total.requests).toBe(3)
  })

  it('单次响应没有 requests 字段时，由调用处自增一次', async () => {
    const { fetchImpl } = makeStubFetch((_body, step) =>
      step === 0 ? callTool('search', { keyword: '会议室' }) : submit({ outcome: 'unsupported' }),
    )
    const run = await runTaskWithModel({
      task: getTask('T1-direct-lookup'),
      sdk: await makeSourceSdk(),
      callMessages: stubClient(fetchImpl).callMessages,
      model: 'stub-model',
    })
    expect(run.usage.requests).toBe(run.rounds)
    expect(run.usage.requests).toBe(2)
  })

  it('落盘的文件里不含 token，且离线复跑判分结果一致', async () => {
    const { fetchImpl } = makeStubFetch((_body, step) =>
      step === 0
        ? callTool('describe', { capabilityId: 'meeting-room-list' })
        : submit(T1_GOAL as unknown as Record<string, unknown>),
    )
    const payload = await runModelEval({
      tasks: [getTask('T1-direct-lookup')],
      config: STUB_CONFIG,
      fetchImpl,
      entryCandidates: SOURCE_ENTRY_CANDIDATES,
    })

    const dir = mkdtempSync(join(tmpdir(), 'eval-model-'))
    try {
      const file = writeRunFile(payload, { dir })
      const text = readFileSync(file, 'utf8')
      expect(text).not.toContain(STUB_CONFIG.token)
      expect(text).toContain('stub-model')

      const { scored } = scoreRunFile(file)
      expect(scored.passed).toBe(1)
      expect(scored.total).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('泄露自检：产物里混进内部字段时拒绝落盘，且不留下半个文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-model-'))
    try {
      const polluted = {
        model: 'm',
        usage: {},
        runs: [{ taskId: 'T1-direct-lookup', steps: [{ result: { routeFile: '/dashboard/x.vue' } }] }],
      } as unknown as ModelRunPayload
      expect(() => writeRunFile(polluted, { dir })).toThrowError(/拒绝落盘/)
      // 抛错发生在写之前：目录里不该有残留
      expect(readdirSync(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('落盘时把 token 字段整条丢掉（即使被塞进了 payload）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-model-'))
    try {
      const polluted = { model: 'm', usage: {}, runs: [], token: '千万别落盘', authToken: '也别' } as unknown as ModelRunPayload
      const file = writeRunFile(polluted, { dir })
      const text = readFileSync(file, 'utf8')
      expect(text).not.toContain('千万别落盘')
      expect(text).not.toContain('也别')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// 8. 轮次标签（多轮稳定性对比要用）
// ---------------------------------------------------------------------------

describe('model · 轮次标签', () => {
  it('带 label 时文件名带轮次，落盘产物里也记着轮次', async () => {
    const { fetchImpl } = makeStubFetch(() => submit({ outcome: 'unsupported' }))
    const payload = await runModelEval({
      tasks: [getTask('T5-unsupported')],
      config: STUB_CONFIG,
      fetchImpl,
      entryCandidates: SOURCE_ENTRY_CANDIDATES,
    })
    const dir = mkdtempSync(join(tmpdir(), 'eval-model-'))
    try {
      const now = new Date('2026-09-20T13:00:00.000Z')
      const file = writeRunFile(payload, { dir, label: 'round2-fixed', now })
      expect(file.endsWith('round2-fixed-2026-09-20T13-00-00-000Z.json')).toBe(true)
      expect(JSON.parse(readFileSync(file, 'utf8')).label).toBe('round2-fixed')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('不带 label 时保持原来的文件名（老产物不用搬家）', () => {
    expect(runFileName(new Date('2026-09-20T13:00:00.000Z'))).toBe('2026-09-20T13-00-00-000Z.json')
  })
})
