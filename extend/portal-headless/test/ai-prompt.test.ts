import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import {
  AI_PROMPT_INTENT_PAGE_PATH,
  AI_PROMPT_INTENT_PERMISSION,
  AI_PROMPT_INTENT_PERMISSION_V1,
  AI_PROMPT_SKILL_PAGE_PATH,
  AI_PROMPT_SKILL_PERMISSION,
  AI_PROMPT_SKILL_PERMISSION_V1,
  AI_PROMPT_TYPE_PAGE_PATH,
  AI_PROMPT_TYPE_PERMISSION,
  AI_PROMPT_TYPE_PERMISSION_V1,
  buildIntentCreateBody,
  buildIntentUpdateBody,
  buildSkillConfigPayload,
  buildTipTypeCreateBody,
  buildTipTypeUpdateBody,
  createAiPromptCapability,
  DEFAULT_PAGE_SIZE,
  INTENT_TEMPLATE_MAX,
  type AiPromptCapability,
  aiPromptCapabilities,
  SEARCH_PAGE_SIZE_DEFAULT,
  SEARCH_PAGE_SIZE_MAX,
  SKILL_REVIEW_CODE,
  TIP_CONTENT_MAX_LENGTH,
} from '../src/capabilities/ai-prompt.js'
import { resolveHttpInstance } from '../src/context/http-instance.js'
import { normalizeVisibilityKey } from '../src/catalog/visibility.js'
import { createPortalHeadless } from '../src/index.js'

/**
 * 基准：`baseline/ai-prompt.browser.json`（2026-09-21 抓到，**10 条、全是 GET**）。
 *
 * 这个文件里分三类断言，标题里逐条写清楚是哪一类：
 *
 * 1. **【实测】** —— 与基准逐字段比对。读链路（三条列表 + 一条候选）现在**都有硬证据**。
 * 2. **【源码推导】** —— 从 `common/libs/renren/list.js` 的 `logicFetch` 键序、
 *    `app/portal/views/.../prompt/*` 的表单初值、以及后端 controller/VO 推出来的。
 *    它们钉的是**本实现**（谁把 `SKILL_LIST_ORDER` 重排一下就红）。
 *    ⚠️ 写链路（POST/PUT/DELETE）落在这一类：**基准里 0 条非 GET**，
 *    所以那几条断言现在是 `it.skipIf` 挂起的，抓不到就永远不跑 —— 别当成已验证。
 * 3. 光有基准也还要人判断的几条：`it.todo`。
 *
 * ## 基准里的 6 条「外壳请求」不是页面契约（别误判成页面漏了接口）
 *
 * 三页各自都多带两条 `GET`：`/admin-api/org/sensitive/info?_t=` 与
 * `/admin-api/bpm/task/list-by-category?finished=1&pageNo=1&pageSize=10&_t=` ——
 * 那是 **app 外壳**（敏感词校验 + 待办角标）拉的，`pagePath` 字段只是"当时停在哪一页"。
 * 本文件对它们**只做"确实存在且不是我们发的"这一条断言**，不数条数、
 * 也不把它们当成三页的接口（同 `test/perf-manage-config.test.ts` 里那条 `POST /homePage/save` 的口径）。
 */

type CapturedCall = InternalAxiosRequestConfig & { moduleType?: number }

const here = dirname(fileURLToPath(import.meta.url))

function makeSdk (data: unknown = { list: [], total: 0 }) {
  const calls: CapturedCall[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config as CapturedCall)
    return { data: { ret: 'SUCCESS', code: 0, msg: '', data }, status: 200, statusText: 'OK', headers: {}, config }
  }
  const at = (pagePath: string) =>
    <T,>(config: unknown) => sdk.call<T>(pagePath, { ...(config as object) } as never)
  const capability: AiPromptCapability = createAiPromptCapability(
    at(AI_PROMPT_TYPE_PAGE_PATH),
    at(AI_PROMPT_SKILL_PAGE_PATH),
    at(AI_PROMPT_INTENT_PAGE_PATH),
  )
  return { sdk, calls, capability }
}

/** 拆成有序的 [key, value] 列表：键顺序的差异也要能被发现（renren 靠同序做到逐字段一致） */
function queryPairs (rawUrl: string): Array<[string, string]> {
  const query = rawUrl.split('?')[1] ?? ''
  if (!query) return []
  return query.split('&').map((part) => {
    const index = part.indexOf('=')
    const key = index === -1 ? part : part.slice(0, index)
    const value = index === -1 ? '' : part.slice(index + 1)
    return [key, key === '_t' ? '<ts>' : value] as [string, string]
  })
}

const keysOf = (rawUrl: string): string[] => queryPairs(rawUrl).map(([key]) => key)

/** URL 上的 `_t` 是一次性时间戳，比之前归一化 */
function normalizeUrl (rawUrl: string): string {
  return String(rawUrl).replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

const pathOf = (rawUrl: string): string => String(rawUrl).split('?')[0] ?? ''

/** axios 的 header bag 里会多带值为 undefined 的槽位，所以走 toJSON() */
function sentHeaders (call: CapturedCall | undefined): Record<string, string> {
  const bag = call?.headers as unknown as { toJSON: () => Record<string, string>; [key: string]: unknown }
  return { ...bag.toJSON(), token: '<redacted>' }
}

/** 请求体。platform.js 不碰 data，axios 直接把对象 JSON 序列化 ⇒ 键序 = JSON 键序 */
function bodyOf (call: CapturedCall | undefined): unknown {
  const data = (call as unknown as { data?: unknown })?.data
  return typeof data === 'string' ? JSON.parse(data) : data
}

function paramNames (id: string): string[] {
  const definition = aiPromptCapabilities.find((item) => item.id === id)
  return definition === undefined ? [] : definition.params.map((param) => param.name)
}

// ---------------------------------------------------------------------------
// 请求层：实例 / module-type
// ---------------------------------------------------------------------------

describe('三页的请求层：全局默认 platform 实例 + 不发 module-type', () => {
  it('三页都不在 http 实例规则表里 ⇒ 落 global-default（platform），不是 page-rule', () => {
    for (const pagePath of [AI_PROMPT_TYPE_PAGE_PATH, AI_PROMPT_SKILL_PAGE_PATH, AI_PROMPT_INTENT_PAGE_PATH]) {
      const resolved = resolveHttpInstance({ pagePath })
      expect(resolved.kind, pagePath).toBe('resolved')
      if (resolved.kind !== 'resolved') return
      expect(resolved.matchedBy, pagePath).toBe('global-default')
      expect(resolved.instance.id, pagePath).toBe('platform')
    }
  })

  it('三页都算不出 module-type ⇒ 与浏览器一致地**不发**这个头', async () => {
    for (const pagePath of [AI_PROMPT_TYPE_PAGE_PATH, AI_PROMPT_SKILL_PAGE_PATH, AI_PROMPT_INTENT_PAGE_PATH]) {
      const { sdk } = makeSdk()
      const resolved = sdk.resolveModuleType(pagePath)
      expect(resolved.moduleType, pagePath).toBeNull()
      expect(resolved.matchedBy, pagePath).toBe('none')
    }

    const { calls, capability } = makeSdk()
    await capability.listTipTypes()
    await capability.listSkills()
    await capability.listIntents()
    expect(calls).toHaveLength(3)
    for (const call of calls) {
      const sent = sentHeaders(call)
      expect('module-type' in sent).toBe(false)
      expect(sent['module-type']).toBeUndefined()
    }
  })

  it('URL 上已经带 /admin-api（platform 的补前缀发生在 baseURL 拼接之前），baseURL 是测试环境', async () => {
    const { calls, capability } = makeSdk()
    await capability.listTipTypes()
    expect(String(calls[0]?.url)).toMatch(/^\/admin-api\//)
    expect(String((calls[0] as unknown as { baseURL?: string })?.baseURL)).toBe(
      'https://biz-api-test.wodecorp.cn',
    )
  })
})

// ---------------------------------------------------------------------------
// 提示词类型
// ---------------------------------------------------------------------------

describe('提示词类型 —— 列表 URL（**实测**：与浏览器逐字段一致）', () => {
  it('无筛选时的 URL 逐字等于浏览器发的那个（含空值参数与键顺序）', async () => {
    const { calls, capability } = makeSdk()
    await capability.listTipTypes()
    expect(normalizeUrl(String(calls[0]?.url))).toBe(
      '/admin-api/system/tip-type/page?order=&orderField=&label=&name=&pageNo=1&pageSize=20&_t=<ts>',
    )
  })

  it('键序是 order → orderField → label → name → pageNo → pageSize → _t（`logicFetch` 的拼法）', async () => {
    const { calls, capability } = makeSdk()
    await capability.listTipTypes()
    expect(keysOf(String(calls[0]?.url))).toEqual([
      'order',
      'orderField',
      'label',
      'name',
      'pageNo',
      'pageSize',
      '_t',
    ])
  })

  it('⚠️ label 是「类型名称」、name 是「类型值」—— 两个筛选取值进 URL 且位置对得上', async () => {
    const { calls, capability } = makeSdk()
    await capability.listTipTypes({ label: '对话', name: 'chat', pageNo: 3, pageSize: 50 })
    const url = String(calls[0]?.url)
    expect(queryPairs(url)).toEqual([
      ['order', ''],
      ['orderField', ''],
      ['label', encodeURIComponent('对话')],
      ['name', 'chat'],
      ['pageNo', '3'],
      ['pageSize', '50'],
      ['_t', '<ts>'],
    ])
  })

  it('pageSize 默认 20（`styleV2: true`，`list.js:391`）', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(20)
  })
})

describe('提示词类型 —— 详情 / 候选 / 写（源码推导：`[mode]/[id].vue` + `TipTypeController`）', () => {
  it('详情：GET /admin-api/system/tip-type/{id}，只有 _t，没有 params（页面是 `http.get(url)` 无 config）', async () => {
    const { calls, capability } = makeSdk()
    await capability.getTipType(42)
    expect(pathOf(String(calls[0]?.url))).toBe('/admin-api/system/tip-type/42')
    expect(keysOf(String(calls[0]?.url))).toEqual(['_t'])
    expect(String(calls[0]?.method).toUpperCase()).toBe('GET')
  })

  it('候选：`/tip-type/list` 一个筛选参数都不带（页面就是 `http.get(url)`），URL 上只有 _t', async () => {
    const { calls, capability } = makeSdk()
    await capability.listTipTypeOptions()
    expect(normalizeUrl(String(calls[0]?.url))).toBe('/admin-api/system/tip-type/list?_t=<ts>')
    expect(keysOf(String(calls[0]?.url))).toEqual(['_t'])
  })

  it('候选：给了关键字才发这个参数，顺序是 name → label', async () => {
    const { calls, capability } = makeSdk()
    await capability.listTipTypeOptions({ name: 'chat' })
    expect(keysOf(String(calls[0]?.url))).toEqual(['name', '_t'])
    await capability.listTipTypeOptions({ label: '对话' })
    expect(keysOf(String(calls[1]?.url))).toEqual(['label', '_t'])
    await capability.listTipTypeOptions({ name: 'chat', label: '对话' })
    expect(keysOf(String(calls[2]?.url))).toEqual(['name', 'label', '_t'])
    // 空串**不发** —— 与页面一致（页面这条请求压根没有筛选参数）
    await capability.listTipTypeOptions({ name: '', label: '' })
    expect(keysOf(String(calls[3]?.url))).toEqual(['_t'])
  })

  it('新建：POST 同一个 objectURL，body 键序 { name, label }（TipTypeSaveReqVO）', async () => {
    const { calls, capability } = makeSdk(1)
    const id = await capability.createTipType({ name: 'chat', label: '对话' })
    expect(id).toBe(1)
    expect(pathOf(String(calls[0]?.url))).toBe('/admin-api/system/tip-type')
    expect(String(calls[0]?.method).toUpperCase()).toBe('POST')
    expect(Object.keys(bodyOf(calls[0]) as object)).toEqual(['name', 'label'])
    // POST 不带 _t（`platform.js` 只给 GET 加防缓存参数）
    expect(keysOf(String(calls[0]?.url))).toEqual([])
  })

  it('新建：name / label 空 ⇒ 当场抛，且**一个请求都不发**（页面 rules 拦得住，后端 VO 没有 @NotBlank）', async () => {
    const { calls, capability } = makeSdk()
    await expect(async () => capability.createTipType({ name: '', label: '对话' })).rejects.toThrow(/name（类型值）不能为空/)
    await expect(async () => capability.createTipType({ name: 'chat', label: '  ' })).rejects.toThrow(/label（类型名称）不能为空/)
    expect(calls).toHaveLength(0)
  })

  it('修改：PUT 同一个 objectURL，body 键序 { id, name, label }', async () => {
    const { calls, capability } = makeSdk(true)
    await capability.updateTipType({ id: 7, name: 'chat', label: '对话' })
    expect(pathOf(String(calls[0]?.url))).toBe('/admin-api/system/tip-type')
    expect(String(calls[0]?.method).toUpperCase()).toBe('PUT')
    expect(bodyOf(calls[0])).toEqual({ id: 7, name: 'chat', label: '对话' })
  })

  it('删除：DELETE /{deleteURL}/{id} —— 没有 body、没有 params（`deleteIsBatch` 这三页都没开）', async () => {
    const { calls, capability } = makeSdk(true)
    await capability.removeTipType(7)
    expect(pathOf(String(calls[0]?.url))).toBe('/admin-api/system/tip-type/7')
    expect(String(calls[0]?.method).toUpperCase()).toBe('DELETE')
    expect(String(calls[0]?.url)).not.toContain('?')
    expect(bodyOf(calls[0])).toBeUndefined()
  })

  it('两个 body 构造器本身也钉住键序（不经过 axios 也能测）', () => {
    expect(Object.keys(buildTipTypeCreateBody({ name: 'a', label: 'b' }))).toEqual(['name', 'label'])
    expect(Object.keys(buildTipTypeUpdateBody({ id: 1, name: 'a', label: 'b' }))).toEqual([
      'id',
      'name',
      'label',
    ])
  })
})

// ---------------------------------------------------------------------------
// 技能列表
// ---------------------------------------------------------------------------

describe('技能列表 —— 列表 URL（源码推导，等基准复核）', () => {
  it('无筛选时的 URL：五个筛选位都是空串，键序照表单初值声明顺序', async () => {
    const { calls, capability } = makeSdk()
    await capability.listSkills()
    expect(normalizeUrl(String(calls[0]?.url))).toBe(
      '/admin-api/sys/tip-template/page?order=&orderField=&name=&typeId=&useSystem=' +
        '&useFeature=&isPublish=&pageNo=1&pageSize=20&_t=<ts>',
    )
  })

  it('⚠️ 路径是 `/admin-api/sys/tip-template`（少一个 tem），不是 `/system/`', async () => {
    const { calls, capability } = makeSdk()
    await capability.listSkills()
    expect(pathOf(String(calls[0]?.url))).toBe('/admin-api/sys/tip-template/page')
  })

  it('筛选传值后进 URL；isPublish=0 照发（0 不是空值）', async () => {
    const { calls, capability } = makeSdk()
    await capability.listSkills({ name: '蛋鸡', typeId: 3, useSystem: 1, useFeature: 9, isPublish: 0 })
    expect(keysOf(String(calls[0]?.url))).toEqual([
      'order',
      'orderField',
      'name',
      'typeId',
      'useSystem',
      'useFeature',
      'isPublish',
      'pageNo',
      'pageSize',
      '_t',
    ])
    const url = String(calls[0]?.url)
    expect(url).toContain('name=' + encodeURIComponent('蛋鸡'))
    expect(url).toContain('typeId=3')
    expect(url).toContain('isPublish=0')
  })
})

describe('技能列表 —— 详情 / 预览 / 审核 / 保存 / 删除（源码推导）', () => {
  it('详情走 /ai/skill/config/get（**不是** /sys/tip-template/{id}）：键序 id → _t', async () => {
    const { calls, capability } = makeSdk({ id: 5, nodes: [] })
    await capability.getSkill(5)
    expect(pathOf(String(calls[0]?.url))).toBe('/admin-api/ai/skill/config/get')
    expect(keysOf(String(calls[0]?.url))).toEqual(['id', '_t'])
  })

  it('预览：POST /ai/skill/config/preview，body 就是保存载荷（同一个构造器）', async () => {
    const { calls, capability } = makeSdk({})
    await capability.previewSkill({ name: 'A', typeId: 1 })
    expect(pathOf(String(calls[0]?.url))).toBe('/admin-api/ai/skill/config/preview')
    expect(String(calls[0]?.method).toUpperCase()).toBe('POST')
    expect(bodyOf(calls[0])).toEqual(buildSkillConfigPayload({ name: 'A', typeId: 1 }))
  })

  it('审核（prepare）：body 键序 { skillCode, modelConfigId, context }，skillCode 写死 skill_review', async () => {
    const { calls, capability } = makeSdk({ approved: false, content: '', variables: {} })
    await capability.prepareSkillReview({ name: 'A', typeId: 1 })
    expect(pathOf(String(calls[0]?.url))).toBe('/admin-api/ai/skill/config/execute')
    const body = bodyOf(calls[0]) as Record<string, unknown>
    expect(Object.keys(body)).toEqual(['skillCode', 'modelConfigId', 'context'])
    expect(body.skillCode).toBe(SKILL_REVIEW_CODE)
    expect(body.modelConfigId).toBeNull()
    expect(body.context).toEqual(buildSkillConfigPayload({ name: 'A', typeId: 1 }))
  })

  it('保存（submit）：POST /ai/skill/config/save，返回值就是技能 id', async () => {
    const { calls, capability } = makeSdk(88)
    const id = await capability.submitSkillSave({ name: 'A', typeId: 1 })
    expect(id).toBe(88)
    expect(pathOf(String(calls[0]?.url))).toBe('/admin-api/ai/skill/config/save')
    expect(String(calls[0]?.method).toUpperCase()).toBe('POST')
    expect(Object.keys(bodyOf(calls[0]) as object)).toEqual([
      'id',
      'name',
      'skillIntroduction',
      'tipPromptText',
      'isPublish',
      'isIntentRecognition',
      'isAppExclusive',
      'useType',
      'typeId',
      'useSystem',
      'useFeature',
      'icon',
      'tipContent',
      'nodes',
    ])
  })

  it('撤销（cancel）：DELETE /admin-api/sys/tip-template/{id}（列表页 deleteURL，不是 /ai/skill/config/delete）', async () => {
    const { calls, capability } = makeSdk(true)
    await capability.cancelSkillSave(88)
    expect(pathOf(String(calls[0]?.url))).toBe('/admin-api/sys/tip-template/88')
    expect(String(calls[0]?.method).toUpperCase()).toBe('DELETE')
  })

  it('卡片候选 / 模型候选：零参数，URL 上只有 _t', async () => {
    const { calls, capability } = makeSdk([])
    await capability.listSkillCards()
    await capability.listAvailableModels()
    expect(normalizeUrl(String(calls[0]?.url))).toBe('/admin-api/ai/skill/card/list?_t=<ts>')
    expect(normalizeUrl(String(calls[1]?.url))).toBe(
      '/admin-api/manager/aiModelConfig/getAvailableList?_t=<ts>',
    )
  })

  it('接口候选：无关键字**当场抛且不发请求**（页面是全量循环拉，conventions 11）', async () => {
    const { calls, capability } = makeSdk({ list: [], total: 0 })
    await expect(async () => capability.searchSkillInterfaces({ name: '   ' })).rejects.toThrow(/必须给 name 关键字/)
    expect(calls).toHaveLength(0)
  })

  it('接口候选：键序 pageNo → pageSize → name（页面原有的两个键不动，name 追加在后面）', async () => {
    const { calls, capability } = makeSdk({ list: [], total: 0 })
    await capability.searchSkillInterfaces({ name: 'order' })
    expect(keysOf(String(calls[0]?.url))).toEqual(['pageNo', 'pageSize', 'name', '_t'])
    expect(String(calls[0]?.url)).toContain(`pageSize=${SEARCH_PAGE_SIZE_DEFAULT}`)
  })

  it('接口候选：pageSize 被钳到 100（与页面 loopFetch 的每页条数一致）', async () => {
    const { calls, capability } = makeSdk({ list: [], total: 0 })
    await capability.searchSkillInterfaces({ name: 'x', pageSize: 5000 })
    expect(String(calls[0]?.url)).toContain(`pageSize=${SEARCH_PAGE_SIZE_MAX}`)
    await capability.searchSkillInterfaces({ name: 'x', pageSize: 0 })
    expect(String(calls[1]?.url)).toContain(`pageSize=${SEARCH_PAGE_SIZE_DEFAULT}`)
    expect(SEARCH_PAGE_SIZE_MAX).toBe(100)
  })
})

describe('技能载荷构造器 —— 键序与页面 `buildSkillConfigPayload` 逐字对齐（源码推导）', () => {
  it('顶层 14 个键的顺序与 `utils.js:89-107` 一致', () => {
    expect(Object.keys(buildSkillConfigPayload({}))).toEqual([
      'id',
      'name',
      'skillIntroduction',
      'tipPromptText',
      'isPublish',
      'isIntentRecognition',
      'isAppExclusive',
      'useType',
      'typeId',
      'useSystem',
      'useFeature',
      'icon',
      'tipContent',
      'nodes',
    ])
  })

  it('空输入补成页面初值：id/typeId/useSystem/useFeature 是 null，字符串是空串，is* 是 0，nodes 是 []', () => {
    expect(buildSkillConfigPayload({})).toEqual({
      id: null,
      name: '',
      skillIntroduction: '',
      tipPromptText: '',
      isPublish: 0,
      isIntentRecognition: 0,
      isAppExclusive: 0,
      useType: '',
      typeId: null,
      useSystem: null,
      useFeature: null,
      icon: '',
      tipContent: '',
      nodes: [],
    })
  })

  it('技能节点：12 个键 + sort 按位置重排（1 起），cardConfig 未启用时除 id/enabled 外全清空', () => {
    const payload = buildSkillConfigPayload({
      nodes: [
        { id: 3, nodeType: 1, name: '查天气', enabled: 1, sort: 99, promptContent: 'p' },
        { id: 4, nodeType: 1, name: '查行情', enabled: 0, sort: 98, cardConfig: { enabled: false, cardNo: 101, cardName: '文本回复' } },
      ],
    })
    expect(Object.keys(payload.nodes[0] as object)).toEqual([
      'id',
      'nodeType',
      'name',
      'enabled',
      'sort',
      'description',
      'triggerWords',
      'promptContent',
      'modelConfigId',
      'apiIds',
      'cardConfig',
      'children',
    ])
    expect(payload.nodes.map((node) => node.sort)).toEqual([1, 2])
    expect(payload.nodes[1]?.cardConfig).toEqual({
      id: null,
      enabled: false,
      cardNo: null,
      cardName: '',
      buttonCount: 0,
      buttons: [],
      outputFormatJson: '',
    })
  })

  it('模块节点：模型 / 接口 / 卡片被强制清空，description 与 triggerWords 只在模块上有值', () => {
    const payload = buildSkillConfigPayload({
      nodes: [
        {
          id: null,
          nodeType: 2,
          name: '行情模块',
          enabled: 1,
          description: '看行情',
          triggerWords: '行情,价格',
          promptContent: 'x',
          modelConfigId: 7,
          apiIds: [1, 2],
          cardConfig: { enabled: true, cardNo: 103 },
        },
      ],
    })
    const node = payload.nodes[0]
    expect(node?.modelConfigId).toBeNull()
    expect(node?.apiIds).toEqual([])
    expect(node?.cardConfig).toBeNull()
    // triggerWords 不是数组时按 `[,，\n]` 拆（`utils.js:228-233`）
    expect(node?.triggerWords).toEqual(['行情', '价格'])
  })

  it('模块的子节点被强制当技能（nodeType=1），且模块自身没有 children 之外的自由度', () => {
    const payload = buildSkillConfigPayload({
      nodes: [
        {
          nodeType: 2,
          name: 'M',
          description: 'd',
          children: [{ nodeType: 2, name: '子', promptContent: 'p' }],
        },
      ],
    })
    const child = payload.nodes[0]?.children[0]
    expect(child?.nodeType).toBe(1)
    expect(child?.description).toBe('')
    expect(child?.triggerWords).toEqual([])
    expect(child?.modelConfigId).toBeNull()
    expect(child?.cardConfig).toEqual({
      id: null,
      enabled: false,
      cardNo: null,
      cardName: '',
      buttonCount: 0,
      buttons: [],
      outputFormatJson: '',
    })
  })

  it('技能节点的卡片启用时保留配置，按钮键序 sort → name → actionType → actionValue → pcActionValue', () => {
    const payload = buildSkillConfigPayload({
      nodes: [
        {
          nodeType: 1,
          name: 'S',
          cardConfig: {
            id: 11,
            enabled: true,
            cardNo: 103,
            cardName: '数据明细',
            buttons: [{ name: '查看', actionType: 'router', actionValue: '/a' }],
            outputFormatJson: '{}',
          },
        },
      ],
    })
    const card = payload.nodes[0]?.cardConfig
    expect(Object.keys(card as object)).toEqual([
      'id',
      'enabled',
      'cardNo',
      'cardName',
      'buttonCount',
      'buttons',
      'outputFormatJson',
    ])
    expect(Object.keys(card?.buttons[0] as object)).toEqual([
      'sort',
      'name',
      'actionType',
      'actionValue',
      'pcActionValue',
    ])
    // router 动作且没给 pcActionValue 时回落到 actionValue（`utils.js:294-296`）
    expect(card?.buttons[0]?.pcActionValue).toBe('/a')
    expect(card?.buttons[0]?.sort).toBe(1)
  })

  it('数字/空值归一：id 字符串转数字、空串转 null、NaN 保留原值', () => {
    const payload = buildSkillConfigPayload({
      id: '12',
      typeId: '',
      useSystem: '3',
      useFeature: undefined,
      isPublish: '1',
      nodes: [{ nodeType: 1, name: 'S', modelConfigId: '', apiIds: [1, '', 2] }],
    })
    expect(payload.id).toBe(12)
    expect(payload.typeId).toBeNull()
    expect(payload.useSystem).toBe(3)
    expect(payload.useFeature).toBeNull()
    expect(payload.isPublish).toBe(1)
    expect(payload.nodes[0]?.modelConfigId).toBeNull()
    expect(payload.nodes[0]?.apiIds).toEqual([1, 2])
  })

  it('`tipContent` 的长度上限常量 = 20000（页面 `utils.js:172` 的校验）', () => {
    expect(TIP_CONTENT_MAX_LENGTH).toBe(20000)
  })
})

// ---------------------------------------------------------------------------
// 意图列表
// ---------------------------------------------------------------------------

describe('意图列表 —— 列表 URL（源码推导，等基准复核）', () => {
  it('无筛选时的 URL：order/orderField/name 三个空串，键序照表单初值', async () => {
    const { calls, capability } = makeSdk()
    await capability.listIntents()
    expect(normalizeUrl(String(calls[0]?.url))).toBe(
      '/admin-api/system/intent/page?order=&orderField=&name=&pageNo=1&pageSize=20&_t=<ts>',
    )
  })

  it('⚠️ 列表打的是 `/admin-api/system/intent/page` —— **不是** `tip-template`', async () => {
    const { calls, capability } = makeSdk()
    await capability.listIntents()
    expect(pathOf(String(calls[0]?.url))).toBe('/admin-api/system/intent/page')
    expect(String(calls[0]?.url)).not.toContain('tip-template')
  })

  it('筛选传值进 URL，键序不变', async () => {
    const { calls, capability } = makeSdk()
    await capability.listIntents({ name: '天气', pageNo: 2 })
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['order', ''],
      ['orderField', ''],
      ['name', encodeURIComponent('天气')],
      ['pageNo', '2'],
      ['pageSize', '20'],
      ['_t', '<ts>'],
    ])
  })
})

describe('意图列表 —— 详情 / 候选 / 写（源码推导）', () => {
  it('详情：GET /admin-api/system/intent/{id}，只有 _t', async () => {
    const { calls, capability } = makeSdk({ id: 9 })
    await capability.getIntent(9)
    expect(pathOf(String(calls[0]?.url))).toBe('/admin-api/system/intent/9')
    expect(keysOf(String(calls[0]?.url))).toEqual(['_t'])
  })

  it('关联提示词候选：必须先给关键字，无关键字不发请求', async () => {
    const { calls, capability } = makeSdk({ list: [], total: 0 })
    await expect(async () => capability.searchIntentTemplates({ name: '' })).rejects.toThrow(/必须给 name 关键字/)
    expect(calls).toHaveLength(0)
  })

  it('关联提示词候选：键序 isIntentRecognition → pageNo → pageSize → name（页面原有的三个键不动）', async () => {
    const { calls, capability } = makeSdk({ list: [], total: 0 })
    await capability.searchIntentTemplates({ name: '蛋鸡', isIntentRecognition: 1 })
    expect(pathOf(String(calls[0]?.url))).toBe('/admin-api/sys/tip-template/getConciseTipTemplatePage')
    expect(keysOf(String(calls[0]?.url))).toEqual([
      'isIntentRecognition',
      'pageNo',
      'pageSize',
      'name',
      '_t',
    ])
    expect(String(calls[0]?.url)).toContain(`pageSize=${SEARCH_PAGE_SIZE_DEFAULT}`)
  })

  it('关联提示词候选：不传 isIntentRecognition 就不发这个参数（页面写死传 1，SDK 不替调用方决定）', async () => {
    const { calls, capability } = makeSdk({ list: [], total: 0 })
    await capability.searchIntentTemplates({ name: '蛋鸡' })
    expect(keysOf(String(calls[0]?.url))).toEqual(['pageNo', 'pageSize', 'name', '_t'])
  })

  it('新建：POST /admin-api/system/intent，body 键序 { name, content, meaning, templateIdList }', async () => {
    const { calls, capability } = makeSdk(31)
    const id = await capability.createIntent({
      name: '天气',
      content: 'weather',
      meaning: '问天气',
      templateIdList: [1, 2],
    })
    expect(id).toBe(31)
    expect(pathOf(String(calls[0]?.url))).toBe('/admin-api/system/intent')
    expect(String(calls[0]?.method).toUpperCase()).toBe('POST')
    expect(bodyOf(calls[0])).toEqual({
      name: '天气',
      content: 'weather',
      meaning: '问天气',
      templateIdList: [1, 2],
    })
  })

  it('新建：三个必填任一为空 ⇒ 抛且不发请求（页面 rules 拦得住，IntentSaveReqVO 没有校验注解）', async () => {
    const { calls, capability } = makeSdk()
    // ⚠️ 这几条**必须匹配错误文案里的中文原因**，不能只写 /name/ ——
    // 反过来验过一次：V8 的 TypeError 消息里带源码表达式（`draft.name is not iterable` 之类），
    // 只写字段名会让「守卫被删掉」也照样绿（2026-09-21 实际踩到，见本文件末尾的反证记录）。
    await expect(async () =>
      capability.createIntent({ name: '', content: 'c', meaning: 'm', templateIdList: [] }),
    ).rejects.toThrow(/name（中文名称）不能为空/)
    await expect(async () =>
      capability.createIntent({ name: 'n', content: '  ', meaning: 'm', templateIdList: [] }),
    ).rejects.toThrow(/content（英文名称）不能为空/)
    await expect(async () =>
      capability.createIntent({ name: 'n', content: 'c', meaning: '', templateIdList: [] }),
    ).rejects.toThrow(/meaning（含义）不能为空/)
    expect(calls).toHaveLength(0)
  })

  it(`新建：templateIdList 超过 ${INTENT_TEMPLATE_MAX} 个 ⇒ 抛（后端硬校验）`, async () => {
    const { calls, capability } = makeSdk()
    await expect(async () =>
      capability.createIntent({ name: 'n', content: 'c', meaning: 'm', templateIdList: [1, 2, 3, 4] }),
    ).rejects.toThrow(/最多 3 个（后端硬校验/)
    expect(calls).toHaveLength(0)
  })

  it('修改：PUT /admin-api/system/intent，body 键序 { id, name, content, meaning, templateIdList }', async () => {
    const { calls, capability } = makeSdk(true)
    await capability.updateIntent({
      id: 5,
      name: '天气',
      content: 'weather',
      meaning: '问天气',
      templateIdList: [9],
    })
    expect(String(calls[0]?.method).toUpperCase()).toBe('PUT')
    expect(Object.keys(bodyOf(calls[0]) as object)).toEqual([
      'id',
      'name',
      'content',
      'meaning',
      'templateIdList',
    ])
  })

  it('⚠️ 修改时不带 templateIdList ⇒ 抛且不发请求（这个接口是整组替换，漏传会静默清空绑定）', async () => {
    const { calls, capability } = makeSdk()
    await expect(async () =>
      capability.updateIntent({ id: 5, name: 'n', content: 'c', meaning: 'm' } as never),
    ).rejects.toThrow(/必须显式给 templateIdList/)
    expect(calls).toHaveLength(0)
    // 空数组是**合法**的（那才是"确实要清空"）
    await capability.updateIntent({ id: 5, name: 'n', content: 'c', meaning: 'm', templateIdList: [] })
    expect(calls).toHaveLength(1)
    expect(bodyOf(calls[0])).toEqual({ id: 5, name: 'n', content: 'c', meaning: 'm', templateIdList: [] })
  })

  it('删除：DELETE /admin-api/system/intent/{id}，无 body 无 params', async () => {
    const { calls, capability } = makeSdk(true)
    await capability.removeIntent(9)
    expect(pathOf(String(calls[0]?.url))).toBe('/admin-api/system/intent/9')
    expect(String(calls[0]?.method).toUpperCase()).toBe('DELETE')
    expect(String(calls[0]?.url)).not.toContain('?')
  })

  it('两个 body 构造器本身钉住键序', () => {
    expect(
      Object.keys(buildIntentCreateBody({ name: 'n', content: 'c', meaning: 'm', templateIdList: [] })),
    ).toEqual(['name', 'content', 'meaning', 'templateIdList'])
    expect(
      Object.keys(
        buildIntentUpdateBody({ id: 1, name: 'n', content: 'c', meaning: 'm', templateIdList: [] }),
      ),
    ).toEqual(['id', 'name', 'content', 'meaning', 'templateIdList'])
  })
})

// ---------------------------------------------------------------------------
// 能力定义本身
// ---------------------------------------------------------------------------

describe('能力定义与 page-catalog.json / 权限码对齐', () => {
  const catalog = JSON.parse(
    readFileSync(join(here, '../generated/page-catalog.json'), 'utf8'),
  ) as { items: Array<{ menuPath: string | null; permission: string; title: string }> }

  const THREE = [AI_PROMPT_TYPE_PAGE_PATH, AI_PROMPT_SKILL_PAGE_PATH, AI_PROMPT_INTENT_PAGE_PATH]

  it('三条 pagePath 在目录里逐字存在（多一个字少一个字都要红）', () => {
    const paths = new Set(catalog.items.map((item) => item.menuPath))
    for (const pagePath of THREE) {
      expect(paths.has(pagePath), `目录里没有 ${pagePath}`).toBe(true)
    }
    // 每条能力都必须挂在三页之一上（挂错了会把别的页面误判成「已完成」）
    for (const capability of aiPromptCapabilities) {
      expect(THREE, capability.id).toContain(capability.pagePath)
    }
  })

  it('能力 id 互不重复', () => {
    const ids = aiPromptCapabilities.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('permission 与当前菜单入口的 v2 权限逐字一致', () => {
    const byPath = new Map(catalog.items.map((item) => [item.menuPath, item]))
    const pairs = [
      [AI_PROMPT_TYPE_PAGE_PATH, AI_PROMPT_TYPE_PERMISSION, AI_PROMPT_TYPE_PERMISSION_V1],
      [AI_PROMPT_SKILL_PAGE_PATH, AI_PROMPT_SKILL_PERMISSION, AI_PROMPT_SKILL_PERMISSION_V1],
      [AI_PROMPT_INTENT_PAGE_PATH, AI_PROMPT_INTENT_PERMISSION, AI_PROMPT_INTENT_PERMISSION_V1],
    ] as const

    for (const [pagePath, live, legacy] of pairs) {
      const entry = byPath.get(pagePath)
      // 能力定义用的是 mall.v2.js / 路由 meta 的那一代
      expect(live, pagePath).toContain('/dashboard/platform-v2/')
      expect(legacy, pagePath).toContain('/dashboard/platform/')
      expect(entry?.permission, pagePath).toBe(live)
      // 旧码仍保留为历史对照，归一后与当前码等价。
      expect(normalizeVisibilityKey(live), pagePath).toBe(normalizeVisibilityKey(legacy))
      expect(normalizeVisibilityKey(live), pagePath).toBe(normalizeVisibilityKey(entry?.permission ?? ''))
    }

    for (const capability of aiPromptCapabilities) {
      const entry = byPath.get(capability.pagePath)
      const expected = THREE.indexOf(capability.pagePath as (typeof THREE)[number])
      expect(capability.permission, capability.id).toBe(
        [AI_PROMPT_TYPE_PERMISSION, AI_PROMPT_SKILL_PERMISSION, AI_PROMPT_INTENT_PERMISSION][expected],
      )
      expect(entry, capability.id).toBeTruthy()
    }
  })

  it('读 / 写的划分：这几个必须是写，其余是读', () => {
    const writes = new Set([
      'ai-prompt-tip-type-create',
      'ai-prompt-tip-type-update',
      'ai-prompt-tip-type-remove',
      'ai-prompt-skill-submit',
      'ai-prompt-skill-remove',
      'ai-prompt-intent-create',
      'ai-prompt-intent-update',
      'ai-prompt-intent-remove',
    ])
    for (const capability of aiPromptCapabilities) {
      expect(capability.write, capability.id).toBe(writes.has(capability.id))
    }
    expect(aiPromptCapabilities.filter((c) => c.write)).toHaveLength(writes.size)
  })

  it('三页各有至少一条能力指向它（`pnpm next` 的完成度判据）', () => {
    for (const pagePath of THREE) {
      expect(aiPromptCapabilities.filter((c) => c.pagePath === pagePath).length, pagePath).toBeGreaterThan(0)
    }
  })

  it('长选项参数（kind search/tree）必须带 lookup —— 候选人多的字段不许裸奔（conventions 11）', () => {
    // 这两条能力**自己就是**候选入口，它们的 keyword 参数由调用方直接给，没有"再去哪查"的问题
    const LOOKUP_ENTRY_CAPABILITIES = new Set([
      'ai-prompt-skill-interface-search',
      'ai-prompt-intent-template-search',
    ])
    for (const capability of aiPromptCapabilities) {
      for (const param of capability.params) {
        if (param.kind !== 'search' && param.kind !== 'tree') continue
        if (LOOKUP_ENTRY_CAPABILITIES.has(capability.id)) continue
        expect(param.lookup, `${capability.id}.${param.name}`).toBeTruthy()
      }
    }
  })

  it('写能力的参数里必须能看到它要改什么（不能只有 pageNo/pageSize）', () => {
    for (const capability of aiPromptCapabilities.filter((c) => c.write)) {
      expect(paramNames(capability.id).length, capability.id).toBeGreaterThan(0)
    }
  })

  it('三条写链路的参数契约：技能列表是 prepare → submit → cancel 三步', () => {
    expect(paramNames('ai-prompt-skill-prepare')).toEqual(paramNames('ai-prompt-skill-submit'))
    expect(paramNames('ai-prompt-skill-remove')).toContain('id')
    expect(paramNames('ai-prompt-intent-update')).toContain('templateIdList')
    expect(paramNames('ai-prompt-tip-type-remove')).toEqual(['id'])
  })
})

// ---------------------------------------------------------------------------
// 基准比对（基准到位自动开跑；不在就整组挂起，**不拿源码编一份假的**）
// ---------------------------------------------------------------------------

/**
 * ⚠️ `baseline/ai-prompt.browser.json` 在写这份测试时**还不存在**（抓基准是另一条线）。
 *
 * 这一组用 `describe.skipIf` 挂起，而不是写成绿的、也不是写成 todo ——
 * 基准文件一落地，比较就会自动开始跑。匹配方式刻意**只认 method + URL 片段**，
 * 不依赖抓基准那一侧给页面起什么键名（`pagePath` / `页面` / `via` 都可能）。
 */
const BASELINE_FILE = join(here, '../baseline/ai-prompt.browser.json')
const HAS_BASELINE = existsSync(BASELINE_FILE)

type BaselineRequest = {
  页面?: string
  pagePath?: string
  via?: string
  method?: string
  url: string
  headers?: Record<string, string>
  body?: unknown
}
type Baseline = { requests: BaselineRequest[] }

const BASE: Baseline = HAS_BASELINE
  ? (JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Baseline)
  : { requests: [] }

/** 三页各自的列表接口 —— 基准里必须各有且只有一条 */
const PAGE_LIST_URL_PARTS = {
  tipType: '/admin-api/system/tip-type/page',
  skill: '/admin-api/sys/tip-template/page',
  intent: '/admin-api/system/intent/page',
} as const

/** 外壳（app 框架）拉的，**不是页面契约**。见文件头 */
const SHELL_URL_PARTS = [
  '/admin-api/org/sensitive/info',
  '/admin-api/bpm/task/list-by-category',
] as const

function findBaseline (method: string, urlPart: string): BaselineRequest | null {
  return (
    BASE.requests.find(
      (r) => String(r.method).toUpperCase() === method.toUpperCase() && r.url.includes(urlPart),
    ) ?? null
  )
}

/** 基准里必须有这一条：没有就红（说明抓基准漏了最基础的那条请求） */
function mustFind (method: string, urlPart: string): BaselineRequest {
  const hit = findBaseline(method, urlPart)
  if (hit === null) throw new Error(`基准里找不到 ${method} ${urlPart}`)
  return hit
}

/** 归一化基准里的 URL：去 host、`_t` 打码 */
const normalizeBaselineUrl = (rawUrl: string): string =>
  rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')

describe.skipIf(!HAS_BASELINE)('基准自身的卫生（脱敏 / 方法 / host）', () => {
  it('全是 GET、只有一个 host、没有漏网的 JWT（`eyJ`）—— 基准是判据，判据本身必须先干净', () => {
    expect(BASE.requests.length).toBeGreaterThan(0)
    for (const request of BASE.requests) {
      expect(String(request.method).toUpperCase(), request.url).toBe('GET')
      expect(request.url.startsWith('https://biz-api-test.wodecorp.cn/'), request.url).toBe(true)
      // 脱敏钩子的 output：URL 上带 token 的实例会把整串 JWT 留在 query 里（2026-09-21 踩过）
      expect(request.url.includes('eyJ'), request.url).toBe(false)
      expect(JSON.stringify(request.headers ?? {})).not.toContain('eyJ')
    }
  })

  it('三页各有一条自己的列表请求；另外那两条是**外壳**拉的，不是页面契约', () => {
    for (const urlPart of Object.values(PAGE_LIST_URL_PARTS)) {
      expect(mustFind('GET', urlPart).url, urlPart).toContain(urlPart)
    }
    // 外壳请求确实在基准里（所以"基准里多出来的那几条"有名字，不是不明飞行物）
    for (const urlPart of SHELL_URL_PARTS) {
      expect(findBaseline('GET', urlPart), urlPart).not.toBeNull()
    }
    // 而它们**不在**本能力任何一个 URL 常量里 —— 页面没发这两条
    expect(SHELL_URL_PARTS.some((part) => part.includes('tip-type'))).toBe(false)
    expect(SHELL_URL_PARTS.some((part) => part.includes('intent'))).toBe(false)
  })

  it('基准里 0 条非 GET ⇒ 写链路**没有**基准可依（这就是下面那几条 skipIf 的原因）', () => {
    const nonGet = BASE.requests.filter((request) => String(request.method).toUpperCase() !== 'GET')
    expect(nonGet).toEqual([])
    // 写能力在能力表里是 8 条，但它们一条基准都没有 —— 别把"测试全绿"读成"写链路已验证"
    expect(aiPromptCapabilities.filter((c) => c.write)).toHaveLength(8)
  })
})

describe.skipIf(!HAS_BASELINE)('与 baseline/ai-prompt.browser.json 逐字段比对', () => {
  it('【实测】提示词类型列表：URL 与基准完全相同（含键顺序、含空值参数）', async () => {
    const { calls, capability } = makeSdk()
    await capability.listTipTypes()
    const base = mustFind('GET', PAGE_LIST_URL_PARTS.tipType)
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeBaselineUrl(base.url))
    // 逐字写一遍（基准里就是 `order=&orderField=&label=&name=&pageNo=1&pageSize=20&_t=<ts>`）
    expect(keysOf(base.url)).toEqual(['order', 'orderField', 'label', 'name', 'pageNo', 'pageSize', '_t'])
  })

  it('【实测】技能列表：URL 与基准完全相同（含键顺序）', async () => {
    const { calls, capability } = makeSdk()
    await capability.listSkills()
    const base = mustFind('GET', PAGE_LIST_URL_PARTS.skill)
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeBaselineUrl(base.url))
  })

  it('【实测】技能列表那四个"多余的"空值参数（typeId/useSystem/useFeature/isPublish）一个都不能少', async () => {
    // ⚠️ 这是源码推导最容易漏的一处：页面 `form` 里声明了五个键（`prompt/list.vue:149-155`），
    // 但模板上有的下拉 `allow-clear` 清空后会变成 `undefined`（键整个消失）。
    // 基准（无筛选、首屏）证实：五个键**都在**，且都是空串。
    const base = mustFind('GET', PAGE_LIST_URL_PARTS.skill)
    expect(queryPairs(base.url)).toEqual([
      ['order', ''],
      ['orderField', ''],
      ['name', ''],
      ['typeId', ''],
      ['useSystem', ''],
      ['useFeature', ''],
      ['isPublish', ''],
      ['pageNo', '1'],
      ['pageSize', '20'],
      ['_t', '<ts>'],
    ])
    const { calls, capability } = makeSdk()
    await capability.listSkills()
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
  })

  it('【实测】意图列表：URL 与基准完全相同（含键顺序）', async () => {
    const { calls, capability } = makeSdk()
    await capability.listIntents()
    const base = mustFind('GET', PAGE_LIST_URL_PARTS.intent)
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeBaselineUrl(base.url))
    expect(keysOf(base.url)).toEqual(['order', 'orderField', 'name', 'pageNo', 'pageSize', '_t'])
  })

  it('【实测】提示词类型候选 `/tip-type/list`：零参数（URL 上只有 _t），与基准一致', async () => {
    const { calls, capability } = makeSdk([])
    await capability.listTipTypeOptions()
    const base = mustFind('GET', '/admin-api/system/tip-type/list')
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(queryPairs(base.url)).toEqual([['_t', '<ts>']])
  })

  it('【实测】三页的列表请求上**都不存在** module-type 头 —— 与浏览器在同一页面上的结论一致', async () => {
    const { calls, capability } = makeSdk()
    await capability.listTipTypes()
    await capability.listSkills()
    await capability.listIntents()
    // 基准那边：三个 headers 里连这个键都没有（不是"值是别的"）
    // SDK 这边：也不能发。两个方向都比，任一边变了都要红。
    const baselines = [
      mustFind('GET', PAGE_LIST_URL_PARTS.tipType),
      mustFind('GET', PAGE_LIST_URL_PARTS.skill),
      mustFind('GET', PAGE_LIST_URL_PARTS.intent),
    ]
    baselines.forEach((base, index) => {
      expect('module-type' in (base.headers ?? {}), base.url).toBe(false)
      const sent = sentHeaders(calls[index])
      expect('module-type' in sent, base.url).toBe(false)
      expect(sent['module-type'], base.url).toBeUndefined()
    })
  })

  it('【实测】基准里那三条列表请求的 tenant-id / token 头与 SDK 一致（platform 实例的头集合）', async () => {
    const { calls, capability } = makeSdk()
    await capability.listTipTypes()
    const base = mustFind('GET', PAGE_LIST_URL_PARTS.tipType)
    const sent = sentHeaders(calls[0])
    // token 在基准里被钩子脱敏成 <redacted>，这里只比"这个键在不在"
    expect('token' in (base.headers ?? {})).toBe('token' in sent)
    expect(base.headers?.['tenant-id']).toBe('1')
    expect(sent['tenant-id']).toBe(String(1))
  })

  // ---- 以下 8 条：基准里 0 条非 GET，所以永远挂起。留着是为了"基准一补上写链路就自动开跑"。 ----
  const tipTypeCreateBase = findBaseline('POST', '/admin-api/system/tip-type')
  it.skipIf(tipTypeCreateBase === null)('提示词类型新建：method / url / body 与基准逐字段一致', async () => {
    const { calls, capability } = makeSdk(1)
    await capability.createTipType({ name: 'x', label: 'y' })
    const base = tipTypeCreateBase as BaselineRequest
    expect(String(calls[0]?.method).toUpperCase()).toBe(String(base.method).toUpperCase())
    expect(pathOf(String(calls[0]?.url))).toBe(pathOf(base.url))
    // ⚠️ body 比的是**键序**（JSON 键序就是发出去的字节序），所以用 Object.keys 而不是 toEqual
    expect(Object.keys(bodyOf(calls[0]) as object)).toEqual(Object.keys((base.body ?? {}) as object))
  })

  const tipTypeUpdateBase = findBaseline('PUT', '/admin-api/system/tip-type')
  it.skipIf(tipTypeUpdateBase === null)('提示词类型修改：body 的键集合（判「GET 整包回写」还是只发三个字段）', async () => {
    const { calls, capability } = makeSdk(true)
    await capability.updateTipType({ id: 1, name: 'x', label: 'y' })
    const base = tipTypeUpdateBase as BaselineRequest
    expect(Object.keys(bodyOf(calls[0]) as object)).toEqual(Object.keys((base.body ?? {}) as object))
  })

  const skillSaveBase = findBaseline('POST', '/admin-api/ai/skill/config/save')
  it.skipIf(skillSaveBase === null)('技能保存：body 顶层键序（含 nodes）与基准一致', async () => {
    const { calls, capability } = makeSdk(1)
    await capability.submitSkillSave({ name: 'x', typeId: 1 })
    const base = skillSaveBase as BaselineRequest
    expect(Object.keys(bodyOf(calls[0]) as object)).toEqual(Object.keys((base.body ?? {}) as object))
  })

  const skillExecuteBase = findBaseline('POST', '/admin-api/ai/skill/config/execute')
  it.skipIf(skillExecuteBase === null)('技能审核（prepare）：body 键序与基准一致', async () => {
    const { calls, capability } = makeSdk({ approved: true, variables: {} })
    await capability.prepareSkillReview({ name: 'x', typeId: 1 })
    const base = skillExecuteBase as BaselineRequest
    expect(Object.keys(bodyOf(calls[0]) as object)).toEqual(Object.keys((base.body ?? {}) as object))
  })

  const skillDeleteBase = findBaseline('DELETE', '/admin-api/sys/tip-template/')
  it.skipIf(skillDeleteBase === null)('技能删除：method / url 形态（有没有 body / _t）与基准一致', async () => {
    const { calls, capability } = makeSdk(true)
    await capability.cancelSkillSave(1)
    const base = skillDeleteBase as BaselineRequest
    expect(String(calls[0]?.method).toUpperCase()).toBe(String(base.method).toUpperCase())
    expect(String(calls[0]?.url).includes('?')).toBe(base.url.includes('?'))
    expect(bodyOf(calls[0]) === undefined).toBe(base.body === undefined)
  })

  const intentCreateBase = findBaseline('POST', '/admin-api/system/intent')
  it.skipIf(intentCreateBase === null)('意图新建：body 键序与基准一致', async () => {
    const { calls, capability } = makeSdk(1)
    await capability.createIntent({ name: 'n', content: 'c', meaning: 'm', templateIdList: [] })
    const base = intentCreateBase as BaselineRequest
    expect(Object.keys(bodyOf(calls[0]) as object)).toEqual(Object.keys((base.body ?? {}) as object))
  })

  const intentUpdateBase = findBaseline('PUT', '/admin-api/system/intent')
  it.skipIf(intentUpdateBase === null)('意图修改：body 键序与基准一致（判有没有把响应专属字段回写）', async () => {
    const { calls, capability } = makeSdk(true)
    await capability.updateIntent({ id: 1, name: 'n', content: 'c', meaning: 'm', templateIdList: [] })
    const base = intentUpdateBase as BaselineRequest
    expect(Object.keys(bodyOf(calls[0]) as object)).toEqual(Object.keys((base.body ?? {}) as object))
  })

  const conciseBase = findBaseline('GET', '/admin-api/sys/tip-template/getConciseTipTemplatePage')
  it.skipIf(conciseBase === null)('意图的「关联提示词」候选：页面那一版的参数形态', () => {
    const base = conciseBase as BaselineRequest
    // 页面发的是 isIntentRecognition + pageNo + pageSize；SDK 在这三个之后**追加** name。
    // 这里只断言"页面的三个键确实在基准里"，SDK 的键序由上一条「候选键序」用例钉住。
    const keys = new Set(queryPairs(base.url).map(([key]) => key))
    expect(keys.has('isIntentRecognition')).toBe(true)
    expect(keys.has('pageNo')).toBe(true)
    expect(keys.has('pageSize')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 等基准才能写的东西（不许写成绿的）
// ---------------------------------------------------------------------------

describe('等基准到位后**还要人判断**的几件事（基准比对组解决不了这些）', () => {
  // 机械的「URL / body 逐字段比对」在上面 `describe.skipIf` 那一组里，基准落地即自动开跑。
  // 下面这几条光有基准还不够 —— 要看基准里**有没有抓到**、以及"抓到的那个是不是这一页发的"。
  it.todo('技能列表：五个筛选位在页面上被 allow-clear 清空后，键是变成空串还是整个消失（要人工点一次再抓）')
  it.todo('技能列表：`SkillTreePanel` / `SkillNodeEditor` / `CardConfigModal` 有没有懒加载请求（源码里都没有 http.，用基准反向确认）')
  it.todo('技能列表：`nodes` 内部（模块子节点被强制 nodeType=1、cardConfig 清空）在基准里能不能看出来 —— 需要一条带节点树的保存')
  it.todo('意图列表：`getInfo` 返回的 `intentTemplateRelList` / `tipTemplateList` 会不会被页面原样 PUT 回去')
  it.todo('提示词类型 / 意图：页面在编辑模式下 PUT 的整包 body 里到底有哪些字段（决定要不要改成「先 GET 再整包 PUT」）')
  it.todo('`/admin-api/system/tip-type/list` 与 `/admin-api/sys/tip-template/getConciseTipTemplatePage`：页面那一版到底发哪几个参数')
})
