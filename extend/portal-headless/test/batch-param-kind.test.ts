/**
 * 批量生成器：参数的 `kind` 必须与**页面上真实的控件**对得上。
 *
 * 为什么单独一份：`test/batch-capabilities.test.ts` 守住的是"路径与参数形状抽不抽得出来"，
 * 它**管不到 kind**。而 2026-09-20 的抽样装置（`tools/sample/**`）量到了另一件事——
 * **形状 24/24 全对，但 68 个参数里 28 个的 kind 与页面控件不符、12 个页面上根本没有控件**。
 * 那些错法（下拉写成 `text`、日期写成 `text`、页面定义混进筛选条件）不会让请求发不出去，
 * 只会让调用方**传错值、静默拿到另一批数据**。
 *
 * 所以这份测试的期望值**不来自生成器**，来自抽样装置的实测记录
 * （`tools/sample/verdicts.json`，浏览器里逐页读出来的控件类型）。生成器改了判据、
 * 装置那次实测的结论就作废——两边必须继续对得上。
 *
 * ⚠️ `tools/sample/**` 是**只读**的：它是独立的验证器，被验证的东西去改验证器，
 * 那套结论立刻作废。这份测试只读它，一个字节都不写。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { BatchEndpoint } from '../src/capabilities/generated/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(HERE, '..')
const GENERATOR = join(PKG_ROOT, 'tools/generate/batch-capabilities.mjs')
/** 抽样装置的实测记录——**期望值的唯一来源**，只读 */
const VERDICTS = join(PKG_ROOT, 'tools/sample/verdicts.json')

/** SDK 侧 `ParamKind` 的全部取值（`src/capabilities/types.ts:12`，这一份是抄的，不是改它） */
const PARAM_KINDS = ['enum', 'search', 'tree', 'date', 'number', 'text', 'boolean', 'array'] as const

/**
 * 实测控件 → 生成器**允许**给的 kind。
 *
 * 只有一处是"多个都行"：**选择型控件**（`select` / `cascader` / `tree-select`）。
 * 理由是实测摆着的——同类下拉的候选规模从 6 条（物料分类树）到 922 条（班组）都有，
 * 而候选规模**在源码里根本不存在**，它决定该是 `enum` 还是 `search`/`tree`。
 * 所以这一格不锁死具体值，但**锁死"不许是 text"**：`text` 的消费方式（模糊匹配）
 * 正是让调用方把用户说的名字当 ID 发出去的那条路。
 */
const KIND_BY_MEASURED_CONTROL: Record<string, readonly string[]> = {
  text: ['text'],
  'input-number': ['number'],
  picker: ['date'],
  'range-picker': ['date'],
  'radio-group': ['enum'],
  switch: ['boolean'],
  select: ['enum', 'search', 'tree'],
  cascader: ['tree'],
  'tree-select': ['tree'],
}

/** 抽样装置「参数级统计·按控件类型」的数（写在这里是为了让下面的断言没法在空集上恒真） */
const MEASURED_CONTROL_COUNTS: Record<string, number> = {
  text: 28,
  select: 22,
  '(无控件)': 12,
  picker: 3,
  'radio-group': 2,
  'input-number': 1,
}
const MEASURED_PARAM_TOTAL = 68

type MeasuredControl = {
  name: string
  control: string | null
  kind: string
  mismatch?: boolean
}
type NoControlCause = { name: string; kind: string }

type MeasuredPage = {
  pagePath: string
  比对: { 控件?: MeasuredControl[]; 无控件参数成因?: NoControlCause[] }
}
type Verdicts = { 逐页: MeasuredPage[]; 参数级统计: { 按控件类型: Record<string, number>; 检查的参数数: number } }

const measured = JSON.parse(readFileSync(VERDICTS, 'utf8')) as Verdicts

// ---------------------------------------------------------------------------
// 跑一次全量生成（写到临时目录，不碰 src/）：回归要覆盖装置抽到的那 24 页，
// 其中只有 4 页在生成器的 20 页抽样里，所以必须用 --all。
//
// 这里是**顶层 await**而不是 `beforeAll`：下面的 `it.each` 要在收集用例时就把
// 参数表建好（`beforeAll` 跑得比收集晚，那时建表会得到空数组——一个恒真的假测试）。
// ---------------------------------------------------------------------------
const generatedDir = mkdtempSync(join(tmpdir(), 'ph-kind-'))
execFileSync(process.execPath, [GENERATOR, '--all'], {
  cwd: PKG_ROOT,
  env: { ...process.env, BATCH_OUT_DIR: generatedDir },
  stdio: 'pipe',
})
// 生成的 .ts 只有一个 `import type`（类型擦除后不产生运行时依赖），可以直接 import
const generated = (await import(pathToFileURL(join(generatedDir, 'batch-capabilities.ts')).href)) as {
  BATCH_ENDPOINTS: Record<string, BatchEndpoint>
  BATCH_CAPABILITIES: Array<{ id: string; pagePath: string; params: Array<{ name: string; kind: string }> }>
}
const endpoints: Record<string, BatchEndpoint> = generated.BATCH_ENDPOINTS
/** AI 真正读到的那份（`describe.ts` 的 ParamContract 就是从它拼的） */
const paramsOf = (pagePath: string): Array<{ name: string; kind: string }> => {
  const found = generated.BATCH_CAPABILITIES.find((c) => c.pagePath === pagePath)
  if (!found) throw new Error(`生成物里没有 ${pagePath} 的能力定义`)
  return found.params
}

const endpointOf = (pagePath: string): BatchEndpoint => {
  const found = Object.values(endpoints).find((e) => e.pagePath === pagePath)
  if (!found) throw new Error(`生成物里没有 ${pagePath} 的契约`)
  return found
}

/**
 * 抽样装置的 24 页里，**现在已经不在清单里的**。
 *
 * 2026-09-21：清单不再收「被注释掉的菜单项」（conventions 第 28 条），而
 * `/dashboard/setting/area/list`（`menus/common.js:49` 整行注释）正好在那 24 页里，
 * 生成物里因此没有它的契约。
 *
 * **测量记录 `verdicts.json` 一个字都不改** —— 它是那一次浏览器实测的事实。
 * 这里只是把这一页从"要拿生成物去对照"的集合里剔掉，并把剔除本身钉住
 * （下面那条用例），免得以后悄悄多出别的页。
 */
const OUT_OF_SCOPE_SAMPLED_PAGES = ['/dashboard/setting/area/list']

/** 还在清单里的那些抽样页 —— 下面所有"拿生成物对照实测"的断言都只走这些 */
const inScopeSampledPages = (): MeasuredPage[] =>
  measured.逐页.filter((page) => !OUT_OF_SCOPE_SAMPLED_PAGES.includes(page.pagePath))

describe('抽样页与当前清单的关系', () => {
  it('出范围的就那一页，且生成物里确实没有它；其余的每一页都还在', () => {
    for (const pagePath of OUT_OF_SCOPE_SAMPLED_PAGES) {
      expect(
        Object.values(endpoints).some((e) => e.pagePath === pagePath),
        `${pagePath} 已经不在清单里，不该还有契约`,
      ).toBe(false)
    }
    const stillHere = inScopeSampledPages()
    for (const page of stillHere) {
      expect(() => endpointOf(page.pagePath), `${page.pagePath} 应当还在清单里`).not.toThrow()
    }
    // 24 页里出范围 1 页 → 23 页要对照；少了就是装置数据被动过
    expect(measured.逐页.length).toBe(24)
    expect(stillHere.length).toBe(23)
  })
})

// ---------------------------------------------------------------------------
// 0. 先证明期望值本身不是空的
// ---------------------------------------------------------------------------

describe('期望值来自抽样装置的实测记录（不是生成器自说自话）', () => {
  it('装置的量在这里读得到，且数字与它自己的统计一致', () => {
    expect(measured.逐页.length).toBe(24)
    const counts: Record<string, number> = {}
    let total = 0
    for (const page of measured.逐页) {
      for (const check of page.比对.控件 ?? []) {
        total += 1
        const key = check.control ?? '(无控件)'
        counts[key] = (counts[key] ?? 0) + 1
      }
    }
    // 这两个数锁的是**装置那一次实测**：变了说明装置重跑过，下面的结论要一起复核
    expect(total).toBe(MEASURED_PARAM_TOTAL)
    expect(counts).toEqual(MEASURED_CONTROL_COUNTS)
    expect(measured.参数级统计.检查的参数数).toBe(MEASURED_PARAM_TOTAL)
    expect(measured.参数级统计.按控件类型).toEqual(MEASURED_CONTROL_COUNTS)
  })

  it('每个实测控件类型都在映射表里有归属（装置量到新控件时这里会红）', () => {
    for (const page of measured.逐页) {
      for (const check of page.比对.控件 ?? []) {
        if (!check.control) continue
        expect(
          KIND_BY_MEASURED_CONTROL[check.control],
          `实测控件 ${check.control}（${page.pagePath} 的 ${check.name}）在映射表里没有归属`,
        ).toBeDefined()
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 1. 核心：逐参数比对 kind 与实测控件
// ---------------------------------------------------------------------------

type Case = [pagePath: string, param: string, control: string, allowed: readonly string[], actual: string | undefined]

const kindCases: Case[] = measured.逐页.flatMap((page) => {
  const endpoint = Object.values(endpoints).find((e) => e.pagePath === page.pagePath)
  return (page.比对.控件 ?? []).flatMap((check): Case[] => {
    if (!check.control) return []
    const actual = endpoint?.paramKindEvidence.find((p) => p.name === check.name)?.kind
    return [[page.pagePath, check.name, check.control, KIND_BY_MEASURED_CONTROL[check.control] ?? [], actual]]
  })
})

describe('实测控件 → 生成的 kind', () => {
  it('有控件的参数一条都不少（少了说明被误判成页面定义剔掉了）', () => {
    const missing = kindCases.filter(([, , , , actual]) => actual === undefined)
    expect(missing.map(([p, n, c]) => `${p} 的 ${n}（实测 ${c}）`)).toEqual([])
    expect(kindCases.length).toBeGreaterThanOrEqual(56)
  })

  it.each(kindCases)('%s 的 %s（实测控件 %s）→ kind 落在 %j 里', (_page, _param, _control, allowed, actual) => {
    expect(allowed).toContain(actual)
  })

  it('抽样判过的每个参数都能在生成物里找到归属：要么是能力参数，要么是被剔掉的页面定义', () => {
    const orphans: string[] = []
    for (const page of inScopeSampledPages()) {
      const endpoint = endpointOf(page.pagePath)
      const inParams = new Set(endpoint.paramKindEvidence.map((p) => p.name))
      const dropped = new Set(endpoint.paramsDropped.map((p) => p.name))
      for (const check of page.比对.控件 ?? []) {
        if (!inParams.has(check.name) && !dropped.has(check.name)) orphans.push(`${page.pagePath} 的 ${check.name}`)
      }
    }
    expect(orphans).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2. 锚点：抽样里后果最重的三条，各锁一个具体值
// ---------------------------------------------------------------------------

describe('锚点：抽样里后果最重的三条', () => {
  it('下拉不再被判成自由文本（authorizedOrgId：实测是带 show-search 的下拉）', () => {
    const evidence = endpointOf('/dashboard/meeting-room/list').paramKindEvidence
    const param = evidence.find((p) => p.name === 'authorizedOrgId')
    expect(param?.basis).toBe('control')
    expect(param?.controlTag).toBe('portal-hxr-tree-select-role-organization-tree')
    expect(['enum', 'search', 'tree']).toContain(param?.kind)
    // 传给 AI 的那份也得跟着变，不能只有证据表变了
    const capability = endpointOf('/dashboard/meeting-room/list')
    expect(capability.capabilityId).toBe('batch:meeting-room-list')
  })

  it('日期控件判成 date（yearMonth：实测是 picker，此前是 null）', () => {
    const param = endpointOf('/dashboard/attendance/attendance-archive-sheet/list')
      .paramKindEvidence.find((p) => p.name === 'yearMonth')
    expect(param?.kind).toBe('date')
    expect(param?.controlFamily).toBe('date')
  })

  it('页面定义从能力参数里剔掉，但 **wire 契约里照旧发**（isArchived：拨一下静默换一批数据）', () => {
    const endpoint = endpointOf('/dashboard/attendance/attendance-archive-sheet/list')
    const dropped = endpoint.paramsDropped.find((p) => p.name === 'isArchived')
    expect(dropped, 'isArchived 必须被判成页面定义').toBeDefined()
    expect(dropped?.reason).toContain('页面定义')
    // 剔的是给 AI 看的那份……
    expect(endpoint.paramKindEvidence.some((p) => p.name === 'isArchived')).toBe(false)
    // ……**不是**请求的形状：浏览器会发它的初值，query 里必须还在（否则就是发错请求）
    const inQuery = endpoint.query.find((q) => q.name === 'isArchived')
    expect(inQuery, 'isArchived 被从 query 里也删掉了——那是改请求形状，不是改描述').toBeDefined()
    expect(inQuery?.defaultValue).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 3. 无控件参数的处置：三种成因各有各的动作
// ---------------------------------------------------------------------------

describe('「页面上没有控件」的三种成因，处置各不同', () => {
  const pagesWithNoControl = measured.逐页.filter((p) => (p.比对.无控件参数成因 ?? []).length > 0)

  it('装置记的成因总数与实测的「无控件」一致（12）', () => {
    const total = pagesWithNoControl.flatMap((p) => p.比对.无控件参数成因 ?? []).length
    expect(total).toBe(12)
    const byKind: Record<string, number> = {}
    for (const cause of pagesWithNoControl.flatMap((p) => p.比对.无控件参数成因 ?? [])) {
      byKind[cause.kind] = (byKind[cause.kind] ?? 0) + 1
    }
    expect(byKind).toEqual({ 'page-definition': 7, conditional: 1, 'probe-blindspot': 4 })
  })

  it.each(pagesWithNoControl.flatMap((page) => (page.比对.无控件参数成因 ?? []).map((c) => [page.pagePath, c.name, c.kind] as const)))(
    '%s 的 %s（成因 %s）处置正确',
    (pagePath, name, cause) => {
      const endpoint = endpointOf(pagePath)
      const evidence = endpoint.paramKindEvidence.find((p) => p.name === name)
      const dropped = endpoint.paramsDropped.find((p) => p.name === name)
      if (cause === 'page-definition') {
        // 页面上没有入口能设置它 → 必须从能力参数里剔掉
        expect(evidence, `${name} 是页面定义，却被留在了能力参数里`).toBeUndefined()
        expect(dropped).toBeDefined()
        return
      }
      // conditional / probe-blindspot：控件是**在**的，剔掉等于把能力砍没了
      expect(dropped, `${name} 的控件在页面上，却被剔掉了`).toBeUndefined()
      expect(evidence, `${name} 没有对应的 kind 判据`).toBeDefined()
      if (cause === 'conditional') {
        expect(evidence?.conditional, `${name} 按条件渲染，没标出来`).toBe(true)
      } else {
        expect(evidence?.controlTag, `${name} 的控件在源码里找得到，不该标成"没有控件"`).not.toBeNull()
      }
    },
  )
})

// ---------------------------------------------------------------------------
// 4. 全量生成物的自洽（这四条与装置无关，锁的是产物本身）
// ---------------------------------------------------------------------------

describe('产物自洽：判据表与能力参数必须一一对得上', () => {
  const all = () => Object.values(endpoints)

  it('kind 只用 SDK 现有的 8 个值（没有偷偷加新词）', () => {
    const bad = all().flatMap((e) => e.paramKindEvidence.filter((p) => !PARAM_KINDS.includes(p.kind)))
    expect(bad.map((p) => `${p.name}=${p.kind}`)).toEqual([])
  })

  it('每个能力参数都有判据，且判据表与 AI 读到的那份 kind 逐字一致', () => {
    const problems: string[] = []
    for (const e of all()) {
      const byName = new Map(e.paramKindEvidence.map((p) => [p.name, p]))
      for (const param of e.paramKindEvidence) {
        if (byName.get(param.name) !== param) problems.push(`${e.pagePath} 的 ${param.name} 判据重复`)
        // 判出来的必须是"从控件推的"或者"明说推不出"，没有第三种
        if (param.basis === 'control' && !param.controlTag) problems.push(`${e.pagePath} 的 ${param.name} 说判据是控件却没有控件标签`)
        if (param.basis === 'default-value' && !param.unresolved) problems.push(`${e.pagePath} 的 ${param.name} 判不出值形状却没标出来`)
        if (param.basis === 'control' && param.controlFamily === null) problems.push(`${e.pagePath} 的 ${param.name} 有控件标签却没有控件家族`)
      }
      // AI 读的是 `params`，判据表只是给人看的——两处对不上等于判据白判
      const exposed = new Map(paramsOf(e.pagePath).map((p) => [p.name, p.kind]))
      for (const evidence of e.paramKindEvidence) {
        if (exposed.get(evidence.name) !== evidence.kind) {
          problems.push(`${e.pagePath} 的 ${evidence.name}：判据表说 ${evidence.kind}，能力参数里是 ${exposed.get(evidence.name)}`)
        }
      }
      // 反过来也要对齐：不能有判据表里没有的能力参数（分页那两个例外）
      for (const [name] of exposed) {
        if (['pageNo', 'pageSize', 'limit'].includes(name)) continue
        if (!byName.has(name)) problems.push(`${e.pagePath} 的 ${name} 是能力参数，却没有判据`)
      }
    }
    expect(problems).toEqual([])
  })

  it('同一个参数不会既在能力参数里、又被当成页面定义剔掉', () => {
    const problems: string[] = []
    for (const e of all()) {
      const params = new Set(e.paramKindEvidence.map((p) => p.name))
      const droppedNames = e.paramsDropped.map((p) => p.name)
      if (new Set(droppedNames).size !== droppedNames.length) problems.push(`${e.pagePath} 的剔除清单里有重名`)
      for (const dropped of droppedNames) {
        if (params.has(dropped)) problems.push(`${e.pagePath} 的 ${dropped} 既剔又留`)
      }
    }
    expect(problems).toEqual([])
  })

  it('剔掉页面定义**没有动请求形状**：它们的名字仍然全在 query 里，值也没变', () => {
    const problems: string[] = []
    for (const e of all()) {
      const query = new Map(e.query.map((q) => [q.name, q.defaultValue]))
      for (const dropped of e.paramsDropped) {
        if (!query.has(dropped.name)) problems.push(`${e.pagePath} 的 ${dropped.name} 从 query 里也没了——这是改请求形状`)
        else if (JSON.stringify(query.get(dropped.name)) !== JSON.stringify(dropped.defaultValue)) {
          problems.push(`${e.pagePath} 的 ${dropped.name} 初值被改过：query=${JSON.stringify(query.get(dropped.name))} vs 剔除记录=${JSON.stringify(dropped.defaultValue)}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  /**
   * 剔掉一个参数是**不可逆的**：调用方从此表达不了这个筛选。所以剔的判据要能被外部证伪——
   * 这一条去 Portal 模板里重数一遍：**被剔掉的参数，模板里不该有任何控件提到它**。
   *
   * 这一条不是把生成器的判据抄一遍（那是自证）：它是从"模板里到底写了什么"独立重数的。
   * 实测确实抓到过生成器的一次假剔——`<a-checkbox @change="e => formState.isContent = …">`
   * 这种只走事件处理器、不写 `v-model` 的控件，按"没有绑定就剔"会连能力一起剔掉。
   */
  it('被剔掉的参数在 Portal 模板里确实找不到入口（去源码里重数一遍，不是抄生成器的判据）', () => {
    const portalRepo = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const views = join(portalRepo, 'app/portal/views/dashboard')
    expect(existsSync(views), `读不到 Portal 源码（${views}）：这一条依赖源码复核"剔掉的参数在页面上真的没有入口"`).toBe(true)
    const catalog = JSON.parse(readFileSync(join(PKG_ROOT, 'generated/page-catalog.json'), 'utf8')) as {
      items: Array<{ menuPath: string | null; routeFile: string | null }>
    }
    const routeFileByPath = new Map(catalog.items.filter((i) => i.menuPath).map((i) => [i.menuPath as string, i.routeFile]))

    const suspicious: string[] = []
    let checked = 0
    for (const e of all()) {
      if (e.paramsDropped.length === 0) continue
      const routeFile = routeFileByPath.get(e.pagePath)
      if (!routeFile) continue
      const source = readFileSync(join(portalRepo, routeFile), 'utf8')
      // 模板标签上的绑定 / 事件：值里出现这个标识符就算"页面上有入口"
      const tags = [...source.matchAll(/<([a-zA-Z][\w.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)]
      for (const dropped of e.paramsDropped) {
        checked += 1
        const found = tags.find((m) =>
          new RegExp(`(?:v-model(?::[\\w-]+)?|:[\\w-]+|@[\\w:.-]+|v-on:[\\w:.-]+)\\s*=\\s*"[^"]*(?<![\\w.$])${dropped.name}(?![\\w$])"`)
            .test(m[2] ?? ''),
        )
        if (found) suspicious.push(`${e.pagePath} 的 ${dropped.name} 被剔了，但 <${found[1]}> 上有绑定/事件提到它`)
      }
    }
    expect(checked, '一条都没检查到——断言在空集上恒真').toBeGreaterThan(50)
    expect(suspicious).toEqual([])
  })

  /**
   * 「判不出来的要标注，不许蒙一个」这条要求本身也要能被测到。
   *
   * 这几个家族的共同点是：**控件类型判出来了，值域没判出来**——
   * 下拉的候选规模（实测 6 条到 922 条都有）、枚举的值、页签的键、日期区间的两个值。
   * 只要选了保守值就**必须**把"没判出来的是什么"写进 `unresolved`，
   * 否则读的人会以为那是个实测结论。
   */
  it('「值域判不出」的那几类必须带 unresolved 标注（否则读的人会当成实测结论）', () => {
    const NEEDS_NOTE = new Set(['lazy-options', 'inline-options', 'view-switcher', 'date-range'])
    const problems: string[] = []
    for (const e of all()) {
      for (const p of e.paramKindEvidence) {
        if (p.controlFamily && NEEDS_NOTE.has(p.controlFamily) && !p.unresolved) {
          problems.push(`${e.pagePath} 的 ${p.name}（${p.controlFamily} → ${p.kind}）没有任何 unresolved 标注`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('下拉一律按失败关闭取 search，且都标了"候选规模未测"', () => {
    const lazy = all().flatMap((e) => e.paramKindEvidence.filter((p) => p.controlFamily === 'lazy-options'))
    expect(lazy.length, '一个下拉都没有？断言在空集上恒真').toBeGreaterThan(100)
    expect(lazy.every((p) => p.kind === 'search')).toBe(true)
    // 短标签可能还带别的缺口（多选、日期格式），所以是"包含"不是"等于"
    expect(lazy.every((p) => (p.unresolvedShort ?? '').includes('下拉的候选规模未测'))).toBe(true)
  })

  /**
   * 日期只判到 `kind=date` 还不够：Portal 里 `YYYY-MM`（月份）/ `YYYY`（年度）/
   * `YYYY-MM-DD` 三种都在用，传错格式**不报错、只是查不到东西**。格式就在控件标签上
   * （`value-format`），读得到就必须交出来。
   */
  it('实测的三个日期控件都连值格式一起交出来（装置量到的是 picker）', () => {
    const pickers = measured.逐页.flatMap((page) =>
      (page.比对.控件 ?? [])
        .filter((c) => c.control === 'picker' || c.control === 'range-picker')
        .map((c) => [page.pagePath, c.name, endpointOf(page.pagePath).paramKindEvidence.find((p) => p.name === c.name)] as const),
    )
    expect(pickers.length, '抽样里应当有 3 个日期控件').toBe(3)
    expect(pickers.map(([p, n, ev]) => (ev?.valueFormat ? null : `${p} 的 ${n} 没交出值格式`)).filter(Boolean)).toEqual([])
  })

  it('日期参数要么带 value-format、要么明说格式没判出来（不留给调用方猜）', () => {
    const problems: string[] = []
    for (const e of all()) {
      for (const p of e.paramKindEvidence) {
        if (p.controlFamily !== 'date' && p.controlFamily !== 'date-range') continue
        if (p.valueFormat) continue
        if (!p.unresolved || !p.unresolved.includes('value-format')) {
          problems.push(`${e.pagePath} 的 ${p.name} 是日期控件、没有 value-format、也没标出来`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  /**
   * 多选：`multiple` / `mode="multiple"` / `:max-tag-count` 的控件一次能传**多个值**，
   * 而 `ParamKind` 必须显式表达数组形态，否则调用方会把多个 ID 拼成字符串。
   * 页面抽样里仍有未覆盖的多选参数，所以它们继续保留缺口标记；已经接线的数组参数
   * 使用 `array`，不能给个 `tree` 就让调用方以为传一个 ID 就完了。
   */
  it('尚未接线的多选控件必须标出数组缺口', () => {
    const multi = all().flatMap((e) =>
      e.paramKindEvidence.filter((p) => (p.unresolved ?? '').includes('多选')).map((p) => [`${e.pagePath} 的 ${p.name}`, p] as const),
    )
    expect(multi.length, '一个多选都没标出来？断言在空集上恒真').toBeGreaterThanOrEqual(50)
    const bad = multi.filter(([, p]) => p.basis !== 'control').map(([label]) => label)
    expect(bad, '多选参数必须是从控件判出来的（否则 kind 本身就是猜的）').toEqual([])
  })

  /**
   * 判据表漏掉一整类控件时，参数会静默落回"按初值判"——那正是这次要修的病。
   * 所以反过来钉一条：**名字里明显是选择/输入类的控件，不该出现在"判不出家族"里**。
   * （实测抓到过一例：`PortalFinanceSelectAccounting` 因为首字母大写没被小写正则匹配到。）
   */
  it('判不出家族的控件里没有"名字就写着 select/picker/input"的', () => {
    const problems: string[] = []
    for (const e of all()) {
      for (const p of e.paramKindEvidence) {
        if (p.controlFamily !== null || !p.controlTag) continue
        if (/select|dropdown|picker|input/i.test(p.controlTag)) {
          problems.push(`${e.pagePath} 的 ${p.name}：控件 <${p.controlTag}> 没判出家族`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('树形控件的 kind 由控件本身决定（tree），不跟着"候选规模未测"一起降级', () => {
    const trees = all().flatMap((e) => e.paramKindEvidence.filter((p) => p.controlFamily === 'tree'))
    expect(trees.length, '一个树形控件都没有？断言在空集上恒真').toBeGreaterThan(50)
    expect(trees.every((p) => p.kind === 'tree')).toBe(true)
  })

  it('抽样里 22 个下拉、2 个单选组、3 个日期控件没有一个是 text/string 蒙过去的', () => {
    // 这条是整件事的标题数字，单独钉一次：生成物里凡是实测为选择型/日期的参数，
    // 其 kind 必须落在对应家族里（重复上面的逐参数断言，但用的是汇总形状，防表格漂移）
    const wrong: string[] = []
    for (const page of inScopeSampledPages()) {
      const endpoint = endpointOf(page.pagePath)
      for (const check of page.比对.控件 ?? []) {
        if (!check.control || check.control === 'text' || check.control === 'input-number') continue
        const kind = endpoint.paramKindEvidence.find((p) => p.name === check.name)?.kind
        if (kind === 'text' || kind === undefined) wrong.push(`${page.pagePath} 的 ${check.name}（实测 ${check.control}）kind=${kind}`)
      }
    }
    expect(wrong).toEqual([])
  })
})
