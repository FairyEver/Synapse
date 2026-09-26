/**
 * `-llm` 协议（D14 / A6）。
 *
 * **`-llm` 不是文档，是"这批数据该怎么消费 + 下一步去哪"的协议。**
 * 所以这里返回五件事，一件都不能少：
 *   1. 怎么调（入口页面、module-type 行为、幂等要求）
 *   2. 参数契约（含参数类型，长选项怎么取候选 —— D6 / H35）
 *   3. 返回数据长什么样（能推的推、推不出的如实说不知道）
 *   4. 拿到数据后下一步能去哪（下游域，D14 的下钻）
 *   5. 这一条 `capabilityId` 到底怎么发出去（`invoke`：capabilityId + sdkPath，G1）——
 *      前四条是契约，只有第五条能变成一次真实调用；缺了它，评测里 452 KB 的目录输出
 *      没有任何一处告诉调用方方法名。
 *
 * 整个能力体系是逐级下钻的抽象域：能力 → 数据 → 用 `-llm` 知道怎么消费 →
 * 知道哪一项对应哪个下游 ID → 进入下游域 → 再调下游的 `-llm`。
 * 所以 `next` 里的每一个 describe 都是这条链上的下一环，而不是"相关推荐"。
 */

import { resolveModuleType } from '../context/module-type.js'
import { resolveHttpInstance } from '../context/http-instance.js'
import { sdkPathOf } from '../capabilities/invoke.js'
import type { CatalogIndex } from './catalog-index.js'
import { CAPABILITY_DOCS, CAPABILITY_LINKS, PAGE_CONSUME_NOTES } from './links.js'
import { AI_CONTRACTS } from './ai-contracts.js'
import { buildQueryTerms, scoreMatch } from './match.js'
import type { ParamKind } from '../capabilities/types.js'
import type {
  CapabilityDescription,
  CatalogCapability,
  ConsumeKeyField,
  DescribeResult,
  EntryPoint,
  NextStep,
  NextStepRole,
  ParamContract,
} from './types.js'

const MAX_NEXT_STEPS = 6
/** 找不到能力时最多给几个相近的（G6：按相关度排序，不是按注册顺序取前 5） */
const MAX_SUGGESTIONS = 5

/**
 * 按参数类型给出"这个参数该怎么填"（D6 说长选项要单独作为一类处理）。
 *
 * ⚠️ 长选项这两句**不写"用 lookup 指定的能力"**：`lookup` 只有能力定义里登记了才有
 * （G2 之前一个都没有，那句话是空头承诺）。登记了的会在下面拼上候选入口，没登记的
 * 拼的是"入口需要人工确认"。
 */
const KIND_CONSUMPTION: Record<ParamKind, string> = {
  enum: '小枚举，直接在 options 里挑一个；options 为空时按 description 填',
  search: '**搜索型长选项**：必须先向用户要关键字，禁止无条件下全量拉取（D6）',
  tree: '**树型长选项**：先要关键字或父节点，逐级取候选，禁止无条件下全量拉取（D6）',
  date: '日期。格式以 description 为准 —— Portal 里 `yyyy-MM-dd` 与 `YYYY-MM-DD HH:mm:ss` 两种都有，不要猜',
  number: '数字。分页字段不要传 -1（=全量拉取），pageSize 建议 ≤50',
  text: '文本，模糊匹配；把用户给的词原样传进去',
  boolean: '布尔值',
  array: '数组；逐项按参数说明填写，不能把多个值拼成一个字符串',
}

function buildParamContracts (capability: CatalogCapability): ParamContract[] {
  const contracts: ParamContract[] = []
  for (const param of capability.params) {
    let consumption = KIND_CONSUMPTION[param.kind]
    const contract: ParamContract = {
      name: param.name,
      kind: param.kind,
      required: param.required,
      consumption,
      ...(param.description === undefined ? {} : { description: param.description }),
      ...(param.options === undefined ? {} : { options: param.options }),
    }

    if (param.lookup !== undefined) {
      contract.lookup = {
        capabilityId: param.lookup.capabilityId,
        keywordParam: param.lookup.keywordParam,
        hint: `先用 ${param.lookup.keywordParam} 作关键字调 ${param.lookup.capabilityId} 取候选，再回来填 ${param.name}`,
      }
      // 详细的取候选步骤在 lookup.hint 里（结构化字段，就在同一段），这里只点明"有入口"
      consumption += `；候选入口已登记：${param.lookup.capabilityId}`
    } else if (param.kind === 'search' || param.kind === 'tree') {
      contract.note = '这是长选项参数，但能力定义里没有登记 lookup —— 取候选的入口需要人工确认（H35）'
    }
    contract.consumption = consumption
    const input = AI_CONTRACTS[capability.id]?.inputs[param.name]
    if (input !== undefined) {
      contract.contract = input
      if (input.type === 'number' || input.type === 'boolean') contract.kind = input.type
      if (input.options !== undefined) contract.options = input.options
      else if (input.type === 'boolean') delete contract.options // Native booleans must not inherit legacy string radio options.
      contract.required = input.required ?? contract.required
      contract.description = input.meaning
      contract.consumption = [input.source, input.format, ...(input.constraints ?? [])].filter(Boolean).join('；')
      delete contract.note
      delete contract.lookup
      if (input.lookup !== undefined) {
        contract.lookup = {
          capabilityId: input.lookup.capabilityId,
          keywordParam: Object.keys(input.lookup.args)[0] ?? '',
          hint: `${JSON.stringify(input.lookup.args)}；用 ${input.lookup.labelField} 展示候选，将 ${input.lookup.valueField} 填入 ${param.name}`,
        }
      }
    }

    if (capability.conflict) {
      const definitions = capability.definitions
      const requiredIn = definitions.filter((definition) =>
        definition.params.some((candidate) => candidate.name === param.name && candidate.required),
      )
      if (requiredIn.length !== definitions.length) {
        contract.note = [
          contract.note,
          `该能力有两处定义，这个参数只在 ${requiredIn.map((d) => d.pagePath).join('、') || '（无）'} 上必填；目录按更严的一侧算成必填`,
        ]
          .filter((item): item is string => item !== undefined)
          .join('；')
      }
    }

    contracts.push(contract)
  }
  for (const [name, input] of Object.entries(AI_CONTRACTS[capability.id]?.inputs ?? {})) {
    if (name.includes('.') || name.includes('[') || contracts.some(p => p.name === name)) continue
    contracts.push({ name, kind: input.type === 'number' ? 'number' : input.type === 'boolean' ? 'boolean' : 'text', required: input.required ?? false, description: input.meaning, consumption: input.source, contract: input })
  }
  return contracts
}

/** 返回最终 SDK 数据契约；没有权威说明时不从分页参数猜结构。 */
function deriveReturns (capability: CatalogCapability): CapabilityDescription['returns'] {
  const ai = AI_CONTRACTS[capability.id]
  if (ai !== undefined) {
    return {
      shape: ai.output.shape,
      confidence: 'documented',
      fields: ai.output.fields,
      notes: [ai.output.empty, ...ai.evidence.map(e => `${e.kind}: ${e.source} — ${e.note}`), ...(ai.gaps ?? [])],
    }
  }
  return { shape: '此自定义能力未提供返回契约', confidence: 'unknown', notes: ['不得根据参数或名称推测返回结构。'] }
}

function buildEntryPoints (index: CatalogIndex, capability: CatalogCapability): EntryPoint[] {
  return capability.pagePaths.map((pagePath) => {
    const page = index.pageByPath.get(pagePath) ?? null
    const resolved = resolveModuleType(pagePath)
    // 同一个能力 ID 可能在多个页面各有定义，取**这一页**那份的声明（回落到主定义）。
    // 能力定义里显式钉死的实例优先于页面规则表——iframe 子应用只能靠它。
    const declaration =
      capability.definitions.find((candidate) => candidate.pagePath === pagePath) ??
      capability.primary
    const moduleType = declaration.moduleType === undefined
      ? resolved.moduleType
      : declaration.moduleType
    const moduleTypeLabel = declaration.moduleType === undefined
      ? resolved.label
      : declaration.moduleType === null
        ? null
        : resolved.moduleType === declaration.moduleType
          ? resolved.label
          : null
    const http = resolveHttpInstance({ pagePath, declared: declaration.httpInstance ?? null })
    return {
      pagePath,
      page,
      moduleType: {
        value: moduleType,
        label: moduleTypeLabel,
        // D34：算不出或能力明确覆盖为 null 时，与浏览器一致地不发这个头。
        sent: moduleType !== null,
      },
      httpInstance:
        http.kind === 'resolved'
          ? {
              kind: 'resolved' as const,
              id: http.instance.id,
              matchedBy: http.matchedBy,
              baseUrlEnv: http.instance.baseUrl.kind === 'env' ? http.instance.baseUrl.env : null,
            }
          : {
              kind: 'unresolved' as const,
              reason: http.reason,
              detail: http.detail,
            },
    }
  })
}

const ROLE_RANK: Record<NextStepRole, number> = { next: 0, detour: 1 }

function buildNextSteps (
  index: CatalogIndex,
  capability: CatalogCapability,
): NextStep[] {
  const next: NextStep[] = []
  const seen = new Set<string>()

  const pushDescribe = (capabilityId: string, why: string, role: NextStepRole): void => {
    if (capabilityId === capability.id || seen.has(capabilityId)) return
    seen.add(capabilityId)
    next.push({ tool: 'describe', args: { capabilityId }, role, why })
  }

  // ① 长选项参数：先取候选，再回来填。没填上这两个参数，这次调用根本发不出去
  for (const param of capability.params) {
    if (param.lookup === undefined) continue
    // 边性和参数自己的必填性是同一件事：**必填**长选项的候选来源是"下一步"
    // （拿不到它这次调用根本发不出去），**选填**参数的候选来源只是"用得上时再去"
    // （例如 startUserSelectAssignees 只在 prepare 的 tasks 非空时才需要）。
    // 一律算 next 会让调用方在预算里白跑一趟——评测实测过这一次浪费。
    pushDescribe(
      param.lookup.capabilityId,
      `参数 ${param.name} 的候选来源：先用 ${param.lookup.keywordParam} 作关键字调它取候选，再回来填 ${param.name}（D6）`,
      param.required ? 'next' : 'detour',
    )
  }

  // ② D14 的下游域：这批数据里的哪一项对应哪个下游 ID
  for (const link of CAPABILITY_LINKS) {
    if (link.from !== capability.id) continue
    pushDescribe(link.to, `下游域：${link.note}（关键字段 ${link.viaField}）`, link.role ?? 'next')
  }

  // ③ 同一页面的其他能力（写操作要先读后写，读操作常需要写来落地）—— 关联，不是下一步
  const primaryPage = index.pageByPath.get(capability.primary.pagePath)
  if (primaryPage !== undefined) {
    for (const siblingId of primaryPage.capabilityIds) {
      const sibling = index.capabilityById.get(siblingId)
      if (sibling === undefined) continue
      pushDescribe(sibling.id, `同一页面「${primaryPage.title}」上的关联能力`, 'detour')
    }
  }

  if (primaryPage !== undefined) {
    next.push({
      tool: 'describePage',
      args: { pageId: primaryPage.menuPath ?? primaryPage.id },
      role: 'detour',
      why: `回到页面这一层，看「${primaryPage.title}」的完整能力清单`,
    })
    next.push({
      tool: 'listPages',
      args: { domain: primaryPage.domain },
      role: 'detour',
      why: `同属「${index.domains.get(primaryPage.domain)?.label ?? primaryPage.domain}」的其他页面`,
    })
  }

  // 岔路排在后面：下一步就该做的事不该被"顺便看看"挤掉（G3），
  // 尤其末尾还有个 MAX_NEXT_STEPS 截断——先截掉的必须是岔路。
  return [...next]
    .sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role])
    .slice(0, MAX_NEXT_STEPS)
}

/**
 * 横向邻居。
 *
 * `upstream` / `downstream` 是链上的前后（G2）：`meeting-application-prepare` /
 * `-submit` 的 `meetingRoomId` 是唯一一个"用户给不出、必须查"的必填参数，
 * 而在这之前它们的邻接表里**没有任何一条边**指向候选来源。现在两个来源都进来了：
 * `CAPABILITY_LINKS` 里人工登记的边，与能力定义里 `lookup` 声明的候选来源。
 */
function buildRelated (
  index: CatalogIndex,
  capability: CatalogCapability,
): CapabilityDescription['related'] {
  const primaryPage = index.pageByPath.get(capability.primary.pagePath)
  const upstream: string[] = []
  const downstream: string[] = []
  const push = (list: string[], id: string): void => {
    if (id === capability.id || list.includes(id)) return
    list.push(id)
  }

  for (const link of CAPABILITY_LINKS) {
    if (link.to === capability.id) push(upstream, link.from)
    if (link.from === capability.id) push(downstream, link.to)
  }
  for (const param of capability.params) {
    if (param.lookup !== undefined) push(upstream, param.lookup.capabilityId)
  }

  const ai = AI_CONTRACTS[capability.id]
  if (ai !== undefined) {
    upstream.length = 0
    downstream.length = 0
    for (const input of Object.values(ai.inputs)) if (input.lookup) push(upstream, input.lookup.capabilityId)
    for (const step of ai.steps) if (step.capabilityId) push(downstream, step.capabilityId)
  }
  return {
    samePage:
      primaryPage === undefined
        ? []
        : primaryPage.capabilityIds.filter((id) => id !== capability.id),
    sameDomain:
      primaryPage === undefined
        ? []
        : (index.domains.get(primaryPage.domain)?.capabilities ?? [])
            .map((candidate) => candidate.id)
            .filter((id) => id !== capability.id),
    upstream,
    downstream,
  }
}

function buildConsumeKeyFields (capabilityId: string): ConsumeKeyField[] {
  return CAPABILITY_LINKS.filter((link) => link.from === capabilityId)
    // 同一条链上"下一步"的边排在岔路前面（G3），与 next 的排序口径一致
    .sort((a, b) => ROLE_RANK[a.role ?? 'next'] - ROLE_RANK[b.role ?? 'next'])
    .map((link) => ({
      field: link.viaField,
      means: link.note,
      next: {
        tool: 'describe' as const,
        args: { capabilityId: link.to },
        role: link.role ?? 'next',
        why: `进入下游抽象域「${link.to}」，调它的 -llm 拿字段规则与选项`,
      },
    }))
}

/** Preserve the established next/keyFields protocol using the authoritative business mappings. */
function contractNext (index: CatalogIndex, capability: CatalogCapability): NextStep[] {
  const ai = AI_CONTRACTS[capability.id]
  if (ai === undefined) return buildNextSteps(index, capability)
  const result: NextStep[] = []
  for (const param of buildParamContracts(capability)) {
    if (param.lookup === undefined || param.lookup.capabilityId === capability.id) continue
    result.push({ tool: 'describe', args: { capabilityId: param.lookup.capabilityId }, role: param.required ? 'next' : 'detour', why: `填写 ${param.name} 前取候选：${param.lookup.hint}` })
  }
  for (const step of ai.steps) {
    if (step.capabilityId === undefined) continue
    result.push({tool: 'describe', args: { capabilityId: step.capabilityId }, role: step.role === 'required' ? 'next' : 'detour', why: `[${step.role}] ${step.when}：${step.instruction}${step.mapping === undefined ? '' : `；字段映射 ${JSON.stringify(step.mapping)}`}`})
  }
  result.push({tool: 'describePage', args: {pageId: capability.primary.pagePath}, role: 'detour', why: '查看同页功能的用途与边界，按用户目标选择。'})
  const seen = new Set<string>()
  return result.sort((a,b) => ROLE_RANK[a.role]-ROLE_RANK[b.role]).filter(step => {
    const key=JSON.stringify([step.tool,step.args]); if(seen.has(key)) return false; seen.add(key); return true
  })
}

function contractKeyFields (capability: CatalogCapability): ConsumeKeyField[] {
  const ai = AI_CONTRACTS[capability.id]
  if (ai === undefined) return buildConsumeKeyFields(capability.id)
  return ai.output.fields.map(field => {
    const step = ai.steps.find(step => step.capabilityId !== undefined && Object.values(step.mapping ?? {}).some(source => source.replace(/^result\./, '').replace(/^\$\./, '') === field.path))
    return {field:field.path,means:field.meaning,...(step === undefined ? {} : {next: {tool:'describe' as const,args:{capabilityId:step.capabilityId!},role:step.role==='required'?'next' as const:'detour' as const,why:`${step.when}：${step.instruction}`}})}
  })
}

/**
 * 找不到能力时给"相近的"（G6）。
 *
 * 之前这里按注册顺序取前 5 个：`describe('reimburse-submit')` 会推荐
 * `meeting-room-list`——一个名字像"相关推荐"、实际是"注册顺序前 5"的字段，
 * 比没有这个字段更危险。现在复用 `search` 的打分器（`buildQueryTerms` + `scoreMatch`），
 * 0 分的候选**不列**：列不出来就是列不出来，目录里有什么在 `reason` 里已经全说了。
 */
function suggestCapabilities (
  index: CatalogIndex,
  query: string,
  limit = MAX_SUGGESTIONS,
): Array<{ capabilityId: string; title: string; score: number }> {
  const terms = buildQueryTerms(query)
  if (terms.length === 0) return []

  const scored: Array<{ capabilityId: string; title: string; score: number }> = []
  for (const capability of index.capabilities) {
    let score = 0
    for (const term of terms) {
      score += scoreMatch('capabilityId', term, capability.id)
      score += scoreMatch('capabilityTitle', term, capability.title)
      for (const param of capability.params) {
        score += scoreMatch('paramName', term, param.name)
      }
    }
    if (score > 0) scored.push({ capabilityId: capability.id, title: capability.title, score })
  }

  return scored
    .sort((a, b) => (b.score - a.score !== 0 ? b.score - a.score : a.capabilityId < b.capabilityId ? -1 : 1))
    .slice(0, limit)
}

/**
 * 能力的 `-llm`。
 *
 * `capabilityId` 是宽容的：接受 `meeting-room-list`，也接受 AI 按 A6/D14 的习惯
 * 直接把工具名写成 `meeting-room-list-llm`（"在同名接口后加 `-llm`"）。
 */
export function describe (index: CatalogIndex, capabilityId: string): DescribeResult {
  const raw = capabilityId.trim()
  const stripped = raw.endsWith('-llm') ? raw.slice(0, -'-llm'.length) : raw
  const lowered = stripped.toLowerCase()

  const capability =
    index.capabilityById.get(stripped) ??
    [...index.capabilities.values()].find((candidate) => candidate.id.toLowerCase() === lowered)

  if (capability === undefined) {
    return {
      ok: false,
      // ⚠️ 这个字符串的格式是公开协议的一部分：调用方（含 tools/eval/consumer-view.mjs）
      // 靠「：` 与末尾的 `）` 之间的那段拿已注册能力清单，改格式会静默打断它们。
      reason: `目录里没有能力「${raw}」（已注册能力：${[...index.capabilities.values()].map((candidate) => candidate.id).join('、') || '（无）'}）`,
      suggestions: suggestCapabilities(index, stripped),
      // G11：这个键永远存在（describePage 的失败回执同理），调用方不用写 `?? []`
      warnings: [],
    }
  }

  const entryPoints = buildEntryPoints(index, capability)
  const ai = AI_CONTRACTS[capability.id] ?? null

  const warnings: string[] = []
  if (capability.conflict) {
    warnings.push(
      `能力 ID「${capability.id}」在 ${capability.definitions.length} 处有定义（${capability.pagePaths.join('、')}）：` +
        '目录按"更严的一侧"合并了参数与写标记。这是数据问题，应由生成器收敛，调用方需知道它有两个入口。',
    )
  }
  for (const entryPoint of entryPoints) {
    if (entryPoint.page === null) {
      warnings.push(`入口页面 ${entryPoint.pagePath} 不在页面清单里，目录信息不完整`)
    } else if (entryPoint.page.source === 'capability-only') {
      warnings.push(
        `入口页面 ${entryPoint.pagePath} 不在菜单树里（H36）：用户不能从侧边栏直接到达，只能从上游页面跳进来`,
      )
    }
    if (!entryPoint.moduleType.sent) {
      warnings.push(
        `入口 ${entryPoint.pagePath} 在浏览器里本来就算不出 module-type（D34，全量 42% 的页面如此）：` +
          '请求不发这个头，后端会取该用户全部模块数据权限的并集（F19）。这是既有行为，不是 SDK 的偏差。',
      )
    }
  }
  for (const param of capability.params) {
    if ((param.kind === 'search' || param.kind === 'tree') && param.lookup === undefined && ai?.inputs[param.name] === undefined) {
      warnings.push(`参数 ${param.name} 是长选项但没有登记 lookup，取候选的入口需要人工确认（H35）`)
    }
  }

  // G1：拿到 capabilityId 之后要用哪行代码把它发出去。没有绑定就必须说出来——
  // 让调用方以为"describe 成功 = 能调"正是评测卡住的那一处。
  const sdkPath = sdkPathOf(capability.id)
  const invoke = sdkPath === null ? null : { capabilityId: capability.id, sdkPath }
  if (invoke === null) {
    warnings.push(
      `能力「${capability.id}」没有接进 SDK 的执行层（既不在 capabilities.invoke 的绑定表里，也没有门面方法）：` +
        '该条目不能经通用入口调用；不要从目录标题猜请求或把生成物当作已交付功能。',
    )
  }

  const notes: string[] = []
  const doc = CAPABILITY_DOCS[capability.id]
  if (doc !== undefined) notes.push(`包内四件套文档：${doc}（操作步骤与业务语义）`)
  if (invoke !== null) {
    notes.push(
      `调用入口：sdk.capabilities.invoke('${capability.id}', {...})（不需要知道它属于哪个分组）；` +
        `实现路径是 ${sdkPath}。通用入口会适配位置参数；这里的 args 契约用于 invoke，不应直接猜位置参数签名。`,
    )
  }
  if (capability.write) {
    notes.push('写操作。调用方应把要提交的载荷先回执给上层再真正提交（§3.5 第 5 条），因为无头下没有"人点了确认"这一关（H4）。')
  }
  if (capability.definitions.length > 1) {
    notes.push(`该能力在 ${capability.definitions.length} 个页面各有定义，参数已合并；返回结构可能不同，按实际入口判断。`)
  }

  // 作用域标记（G7）：这三类信息原本混在同一个数组里，读者分不清哪句管的是
  // 这一页、这个能力、还是整个协议。tag 让"这句话的作用域"直接写在句首。
  const consumeNotes: string[] = []
  if (capability.params.some((param) => param.kind === 'search' || param.kind === 'tree')) {
    consumeNotes.push('[能力] 结果里若出现长选项字段，不要一次性展开给用户；按关键字取候选（D6 / H35）。')
  }
  if (capability.params.some((param) => param.name === 'pageNo' || param.name === 'pageSize')) {
    consumeNotes.push('[能力] 这是分页数据：先取候选页，再让用户选，不要为了"看全"把 pageSize 调大。')
  }
  consumeNotes.push('[协议] 以准确完成业务为准，不设目录往返次数上限；不要猜参数。')
  for (const entryPoint of entryPoints) {
    const pageNotes = PAGE_CONSUME_NOTES[entryPoint.pagePath]
    if (pageNotes === undefined) continue
    // 页面级注释只对**它描述的那一页**成立，不跟着能力走进别的链路（G7）
    for (const note of pageNotes) {
      const scoped = `[页面 ${entryPoint.pagePath}] ${note}`
      if (!consumeNotes.includes(scoped)) consumeNotes.push(scoped)
    }
  }

  return {
    ok: true,
    capabilityId: capability.id,
    llmToolId: `${capability.id}-llm`,
    title: capability.title,
    write: capability.write,
    ai,
    invoke,
    howToCall: {
      entryPoints,
      idempotency: ai !== null ? ai.idempotency : capability.write
        ? '写能力必须带 requestId，SDK 在 TTL 窗口内去重（D12）；Portal 侧目前没有幂等键（H11），重试前先确认上一次是否已生效。' +
          '经 sdk.capabilities.invoke(...) 调用时 requestId 是必填参数：缺了会当场报错，不会静默地不做防重。'
        : null,
      notes: ai === null ? notes : [...notes, ai.purpose, ...ai.prerequisites, ...ai.boundaries],
    },
    params: buildParamContracts(capability),
    returns: deriveReturns(capability),
    consume: {
      notes: ai === null ? consumeNotes : [...ai.consume.map(note => `[能力] ${note}`), `[能力] 完成判据：${ai.completion}`],
      keyFields: contractKeyFields(capability),
    },
    next: contractNext(index, capability),
    related: buildRelated(index, capability),
    warnings,
  }
}
