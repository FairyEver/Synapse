import { describe, expect, it } from 'vitest'

import type { PortalRequestConfig } from '../src/http/client.js'
import {
  PORTAL_BASE_DATA_KEYS,
  SessionStore,
  createPortalBaseDataRegistry,
  type PortalCredential,
  type PortalRequestContext,
  type PortalRequestFactory,
} from '../src/session/index.js'
import {
  ORG_TREE_KEY,
  WRITE_INVALIDATION_RULES,
  applyInvalidation,
  confirmedInvalidationKeysFor,
  inferredInvalidationKeysFor,
  invalidationKeysFor,
  isAuditedWriteTarget,
  matchingRules,
  normalizeEndpointPath,
  resolveInvalidation,
  sameEndpoint,
  type WriteInvalidationRule,
  type WriteTarget,
} from '../src/invalidation/index.js'

const { userBasic, tenantContext, tenantSystem, securityConfig, dictHr, dictPlatform } =
  PORTAL_BASE_DATA_KEYS

/** 会话里那六个 key 全加载一遍，用来验证"失效真的把 key 清掉了" */
const ALL_BASE_DATA_KEYS = [
  userBasic,
  tenantContext,
  tenantSystem,
  securityConfig,
  dictHr,
  dictPlatform,
]

// ---------------------------------------------------------------------------
// 测试替身：一份真的会话（不是 mock），基础数据走假的 request
// ---------------------------------------------------------------------------

/** 按 URL 返回够用的最小数据；六个能力都能加载成功，且不会真的发请求 */
function cannedBaseDataResponse (url: string): unknown {
  if (url === '/admin-api/hr/system-tenant/getUserTenantsByPage') {
    // 会话租户是 1001，第一页就命中 → 不会翻 100 页
    return { list: [{ id: 1001 }], total: 1 }
  }
  if (url === '/admin-api/system/tenant/get') {
    return { useSystem: '1,2' }
  }
  if (url === '/admin-api/system/dict-data/grouped-list') {
    return []
  }
  return {}
}

/** 真实发出去的请求 URL 流水，用来证明"失效之后真的又拉了一次" */
function makeRequestFactory (calls: string[]): PortalRequestFactory {
  return (context: PortalRequestContext) =>
    async <T = unknown>(config: PortalRequestConfig): Promise<T> => {
      void context
      const url = String(config.url ?? '')
      calls.push(url)
      return cannedBaseDataResponse(url) as T
    }
}

/** 真实的六个基础数据能力（不是替身），只是请求函数返回假数据 */
function createStore (calls: string[]) {
  return new SessionStore({
    createRequest: makeRequestFactory(calls),
    registry: createPortalBaseDataRegistry(),
  })
}

async function createLoadedSession () {
  const credential: PortalCredential = { token: 'tk-u-1', tenantId: 1001 }
  const calls: string[] = []
  const store = createStore(calls)
  const session = await store.acquire({
    userId: 'u-1',
    tenantId: 1001,
    credential,
    capabilities: ALL_BASE_DATA_KEYS,
  })

  // 前置条件：六个 key 都真的进了会话，否则后面的"清掉"断言没有意义
  for (const key of ALL_BASE_DATA_KEYS) {
    expect(session.has(key)).toBe(true)
  }

  return { store, session, calls }
}

/** 数一数某个接口被真发了几次 */
function countCalls (calls: readonly string[], url: string): number {
  return calls.filter((item) => item === url).length
}

const GROUPED_LIST = '/admin-api/system/dict-data/grouped-list'

// ---------------------------------------------------------------------------
// 一、确定映射：每条 confirmed 规则都要能查到
// ---------------------------------------------------------------------------

const confirmedRulesWithKeys: WriteInvalidationRule[] = WRITE_INVALIDATION_RULES.filter(
  (rule) => rule.confidence === 'confirmed' && rule.keys.length > 0,
)

const inferredRules: WriteInvalidationRule[] = WRITE_INVALIDATION_RULES.filter(
  (rule) => rule.confidence === 'inferred',
)

describe('确定映射 —— 每条都能查到', () => {
  it('表里确实有确定项（防止过滤条件写错导致这组测试空跑）', () => {
    expect(confirmedRulesWithKeys.length).toBeGreaterThanOrEqual(6)
    expect(inferredRules.length).toBeGreaterThanOrEqual(3)
  })

  it('每条规则的 key 只能是六件套或候选的组织树 key（防拼写错）', () => {
    const allowed = new Set<string>([...ALL_BASE_DATA_KEYS, ORG_TREE_KEY])
    for (const rule of WRITE_INVALIDATION_RULES) {
      for (const key of rule.keys) {
        expect(allowed.has(key), `规则 ${rule.id} 引用了未知 key ${key}`).toBe(true)
      }
    }
  })

  it('「新增字典数据」→ dict-hr + dict-platform', () => {
    const keys = invalidationKeysFor({ path: '/sys/dict/data', method: 'POST' })
    expect(keys).toEqual([dictHr, dictPlatform])
  })

  it('「修改字典数据」→ dict-hr + dict-platform', () => {
    expect(invalidationKeysFor({ path: '/sys/dict/data', method: 'PUT' })).toEqual([
      dictHr,
      dictPlatform,
    ])
  })

  it('「批量改字典数据」→ dict-hr + dict-platform', () => {
    expect(invalidationKeysFor({ path: '/sys/dict/data/updateList', method: 'PUT' })).toEqual([
      dictHr,
      dictPlatform,
    ])
  })

  it('安全配置的四种写 → security-config', () => {
    const paths: Array<[string, string]> = [
      ['PUT', '/adminmanage-api/adminmanage/platform-config/update-values'],
      ['PUT', '/adminmanage-api/adminmanage/platform-config/update'],
      ['POST', '/adminmanage-api/adminmanage/platform-config/create'],
      ['DELETE', '/adminmanage-api/adminmanage/platform-config/delete'],
    ]
    for (const [method, path] of paths) {
      expect(invalidationKeysFor({ path, method })).toEqual([securityConfig])
    }
  })

  it('换租户 → tenant-system', () => {
    expect(invalidationKeysFor({ path: '/admin-api/sys/createNewJwtToken', method: 'GET' })).toEqual(
      [tenantSystem],
    )
  })

  it('带不带 /admin-api 前缀都认得出来（SDK 的 client 会补前缀）', () => {
    const bare = invalidationKeysFor({ path: '/sys/dict/data', method: 'PUT' })
    const prefixed = invalidationKeysFor({ path: '/admin-api/sys/dict/data', method: 'PUT' })
    expect(prefixed).toEqual(bare)
    // 大小写、末尾斜杠、query 都不影响
    expect(invalidationKeysFor({ path: '/admin-api/sys/dict/data/?a=1', method: 'put' })).toEqual(bare)
  })

  it('每条确定规则：用自己的匹配条件查出来，必须包含它声明的 keys', () => {
    for (const rule of confirmedRulesWithKeys) {
      const targets: WriteTarget[] = (rule.capabilityIds ?? []).map((capabilityId) => ({
        capabilityId,
      }))
      for (const endpoint of rule.endpoints ?? []) {
        targets.push({
          path: endpoint.path,
          ...(endpoint.method === undefined ? {} : { method: endpoint.method }),
        })
      }
      expect(targets.length, `规则 ${rule.id} 没有任何匹配条件`).toBeGreaterThan(0)

      for (const target of targets) {
        const resolved = resolveInvalidation(target)
        expect(resolved.audited, `规则 ${rule.id} 没被自己的条件命中`).toBe(true)
        for (const key of rule.keys) {
          expect(resolved.keys, `规则 ${rule.id} 丢了 key ${key}`).toContain(key)
          expect(resolved.confirmedKeys, `规则 ${rule.id} 的 ${key} 没被算成确定项`).toContain(key)
        }
      }
    }
  })

  it('每条规则至少有一条代码证据，且证据带 file:line', () => {
    for (const rule of WRITE_INVALIDATION_RULES) {
      expect(rule.evidence.length, `规则 ${rule.id} 没有证据`).toBeGreaterThan(0)
      for (const item of rule.evidence) {
        expect(item.file, `规则 ${rule.id} 的证据缺文件`).toMatch(/\S/)
        expect(item.lines, `规则 ${rule.id} 的证据缺行号`).toMatch(/^\d+(-\d+)?$/)
      }
    }
  })

  it('规则 id 不重复', () => {
    const ids = WRITE_INVALIDATION_RULES.map((rule) => rule.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ---------------------------------------------------------------------------
// 二、未登记的写目标：返回空，不猜
// ---------------------------------------------------------------------------

describe('未登记的写目标 —— 返回空而不是乱猜', () => {
  it('完全陌生的接口返回空数组', () => {
    const target: WriteTarget = { path: '/admin-api/some/module/unknown-write', method: 'POST' }
    expect(invalidationKeysFor(target)).toEqual([])
    expect(confirmedInvalidationKeysFor(target)).toEqual([])
    expect(inferredInvalidationKeysFor(target)).toEqual([])
    expect(matchingRules(target)).toEqual([])
  })

  it('什么都没给的写目标返回空，而不是把所有 key 都失效一遍', () => {
    expect(invalidationKeysFor({})).toEqual([])
    expect(isAuditedWriteTarget({})).toBe(false)
  })

  it('读能力不是写目标：查出来是空，且不算"已核查"', () => {
    for (const capabilityId of ['meeting-room-list', 'meeting-room-usage', 'meeting-user-search']) {
      expect(invalidationKeysFor({ capabilityId })).toEqual([])
      expect(isAuditedWriteTarget({ capabilityId })).toBe(false)
    }
  })

  it('方法对不上就不算命中（避免把 GET 当成写）', () => {
    expect(matchingRules({ path: '/sys/dict/data', method: 'GET' })).toEqual([])
  })

  it('路径不同不算命中：/sys/dict/data 与 /sys/dict/data/updateList 互不误伤', () => {
    const updateList = matchingRules({ path: '/sys/dict/data/updateList', method: 'PUT' })
    expect(updateList.map((rule) => rule.id)).toEqual(['dict-data-update-list'])
    const plain = matchingRules({ path: '/sys/dict/data', method: 'PUT' })
    expect(plain.map((rule) => rule.id)).toEqual(['dict-data-update'])
  })

  it('SDK 现有两个写能力已核查、确认不影响任何基础数据（空 keys 而不是"没登记"）', () => {
    for (const capabilityId of ['meeting-application-submit', 'meeting-application-cancel']) {
      expect(invalidationKeysFor({ capabilityId })).toEqual([])
      expect(isAuditedWriteTarget({ capabilityId })).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 三、推测项单独标注
// ---------------------------------------------------------------------------

describe('推测项 —— 与确定项分开放', () => {
  it('表里的规则只有两种置信度，没有第三种', () => {
    for (const rule of WRITE_INVALIDATION_RULES) {
      expect(['confirmed', 'inferred']).toContain(rule.confidence)
    }
  })

  it('「平台侧开通/关闭租户系统」只是推测：前端写后没有重取', () => {
    const target: WriteTarget = {
      path: '/adminmanage-api/system/tenant/update-use-system',
      method: 'PUT',
    }
    const resolved = resolveInvalidation(target)

    expect(resolved.audited).toBe(true)
    expect(resolved.confirmedKeys).toEqual([])
    expect(resolved.inferredKeys).toEqual([tenantSystem])
    expect(resolved.rules.every((rule) => rule.confidence === 'inferred')).toBe(true)
  })

  it('「删除字典数据」只是推测：同资源但前端删除后不重取', () => {
    const resolved = resolveInvalidation({ path: '/sys/dict/data', method: 'DELETE' })
    expect(resolved.confirmedKeys).toEqual([])
    expect(resolved.inferredKeys).toEqual([dictHr, dictPlatform])
  })

  it('确定项里不含推测项，`includeInferred: false` 能把推测项摘掉', () => {
    const target: WriteTarget = { path: '/sys/dict/data', method: 'PUT' }
    expect(resolveInvalidation(target).inferredKeys).toEqual([])

    const inferredOnly: WriteTarget = {
      path: '/adminmanage-api/system/tenant/update-use-system',
      method: 'PUT',
    }
    expect(invalidationKeysFor(inferredOnly)).toEqual([tenantSystem])
    expect(invalidationKeysFor(inferredOnly, { includeInferred: false })).toEqual([])
  })

  it('同一个 key 既被确定项、又被推测项覆盖时，只算一次且归在确定项', () => {
    // 构造一个同时命中两类规则的写目标：能力 ID 命中的是确定项，路径命中的是推测项
    const resolved = resolveInvalidation({
      capabilityId: 'meeting-application-submit',
      path: '/adminmanage-api/system/tenant/update-use-system',
      method: 'PUT',
    })
    expect(resolved.confirmedKeys).toEqual([])
    expect(resolved.inferredKeys).toEqual([tenantSystem])
    expect(resolved.keys).toEqual([tenantSystem])
  })
})

// ---------------------------------------------------------------------------
// 三点五、组织架构（/org/*）：全部是推测项
// ---------------------------------------------------------------------------

describe('组织架构的写 —— 全部只是推测', () => {
  const orgWrites: Array<[string, string, string]> = [
    ['org-organization-write', 'POST', '/admin-api/org/organization'],
    ['org-organization-write', 'PUT', '/admin-api/org/organization'],
    ['org-organization-import', 'POST', '/org/organization/import'],
    ['org-organization-status', 'POST', '/org/organization/enable/123'],
    ['org-organization-status', 'POST', '/org/organization/disable/123'],
    ['org-organization-belong-relation', 'PUT', '/org/organization/updateBelongRelation'],
    ['org-type-write', 'POST', '/org/organizationType/save'],
    ['org-corporation-write', 'POST', '/org/corporation/save'],
    ['org-post-write', 'POST', '/org/hrpost/save'],
    ['org-property-write', 'POST', '/admin-api/hr/org/organizationProperty/save'],
    ['org-property-write', 'POST', '/admin-api/hr/org/organizationProperty/updateStatus'],
  ]

  it('每条都命中，且确定项为空、推测项是组织树', () => {
    for (const [ruleId, method, path] of orgWrites) {
      const resolved = resolveInvalidation({ path, method })
      expect(resolved.rules.map((rule) => rule.id), `${method} ${path}`).toEqual([ruleId])
      expect(resolved.confirmedKeys, `${method} ${path} 不该有确定项`).toEqual([])
      expect(resolved.inferredKeys, `${method} ${path}`).toEqual([ORG_TREE_KEY])
      expect(invalidationKeysFor({ path, method })).toEqual([ORG_TREE_KEY])
      expect(invalidationKeysFor({ path, method }, { includeInferred: false })).toEqual([])
    }
  })

  it('表里确实没有一条 org 规则被当成确定项（前端一条重取证据都没有）', () => {
    const orgRules = WRITE_INVALIDATION_RULES.filter((rule) => rule.keys.includes(ORG_TREE_KEY))
    expect(orgRules.length).toBe(8)
    for (const rule of orgRules) {
      expect(rule.confidence, `规则 ${rule.id} 不该是确定项`).toBe('inferred')
      expect(rule.evidence.length, `规则 ${rule.id} 没有证据`).toBeGreaterThan(0)
    }
    // 没有任何确定项规则会去失效组织树
    expect(confirmedRulesWithKeys.filter((rule) => rule.keys.includes(ORG_TREE_KEY))).toEqual([])
  })

  it('带 id 的路径按占位段匹配，且不会串到隔壁动作上', () => {
    expect(matchingRules({ path: '/org/organization/disable/9527', method: 'POST' }).map((r) => r.id))
      .toEqual(['org-organization-status'])
    expect(matchingRules({ path: '/org/organization/enable/1', method: 'POST' }).map((r) => r.id))
      .toEqual(['org-organization-status'])
    // enable 不该被当成 disable，反过来也一样
    expect(resolveInvalidation({ path: '/org/organization/enable/1', method: 'POST' }).rules.map((r) => r.id))
      .toEqual(['org-organization-status'])
  })

  it('导入不会被当成"新建组织"那条，反之亦然', () => {
    expect(matchingRules({ path: '/admin-api/org/organization/import', method: 'POST' }).map((r) => r.id))
      .toEqual(['org-organization-import'])
    expect(matchingRules({ path: '/admin-api/org/organization', method: 'POST' }).map((r) => r.id))
      .toEqual(['org-organization-write'])
  })

  it('checkCanDisable 是读不是写，未登记', () => {
    const target: WriteTarget = {
      path: '/admin-api/org/organization/checkCanDisable/9527',
      method: 'POST',
    }
    expect(invalidationKeysFor(target)).toEqual([])
    expect(isAuditedWriteTarget(target)).toBe(false)
  })

  it('判不准的 org 家族写接口没被照单全收', () => {
    const notRegistered: Array<[string, string]> = [
      ['POST', '/org/hrposttype/save'],
      ['POST', '/org/hrsalarylevel/save'],
      ['POST', '/org/hrWorkSchedule'],
      ['POST', '/org/hrAttendanceSheet/saveSheet'],
      ['POST', '/org/staff'],
      ['PUT', '/org/sensitive'],
      ['POST', '/org/post/role'],
    ]
    for (const [method, path] of notRegistered) {
      expect(matchingRules({ path, method }), `${method} ${path}`).toEqual([])
    }
  })

  it('组织树的 key 还不在六件套里——这是待拍板的设计决定，不是遗漏', () => {
    expect(ALL_BASE_DATA_KEYS).not.toContain(ORG_TREE_KEY)
  })

  it('在决定落地前，失效组织树会如实报成 absent（会话里本来就没这个 key）', async () => {
    const { session } = await createLoadedSession()

    const applied = applyInvalidation(session, {
      path: '/admin-api/org/organization',
      method: 'POST',
    })

    expect(applied.keys).toEqual([ORG_TREE_KEY])
    expect(applied.invalidated).toEqual([])
    expect(applied.absent).toEqual([ORG_TREE_KEY])
    // 六件套一个都不该被这条写操作碰掉
    for (const key of ALL_BASE_DATA_KEYS) {
      expect(session.has(key)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 四、接进会话：真的把 key 从会话里清掉
// ---------------------------------------------------------------------------

describe('applyInvalidation —— 接进会话', () => {
  it('写字典后，dict-hr 与 dict-platform 从会话里消失，别的 key 不受影响', async () => {
    const { session } = await createLoadedSession()

    const applied = applyInvalidation(session, { path: '/sys/dict/data', method: 'POST' })

    expect(applied.invalidated).toEqual([dictHr, dictPlatform])
    expect(applied.absent).toEqual([])
    expect(applied.rules).toEqual(['dict-data-create'])
    expect(session.has(dictHr)).toBe(false)
    expect(session.has(dictPlatform)).toBe(false)
    // 没被污染的照常留着——失效要精确，不能一失效就整份会话拆掉
    expect(session.has(userBasic)).toBe(true)
    expect(session.has(tenantSystem)).toBe(true)
  })

  it('失效的 key 下一次 ensure 会重新拉（真的又发了一次请求）', async () => {
    const { session, calls } = await createLoadedSession()
    // dict-hr 与 dict-platform 同源，加载时共用了同一份响应；无论几次，记下来当基线
    const before = countCalls(calls, GROUPED_LIST)

    applyInvalidation(session, { path: '/sys/dict/data', method: 'PUT' })
    await session.ensure([dictHr])

    expect(session.has(dictHr)).toBe(true)
    expect(countCalls(calls, GROUPED_LIST)).toBeGreaterThan(before)
    // 同一份会话还在（没有被拆掉重建），别的 key 也没有被顺带重拉
    expect(session.has(userBasic)).toBe(true)
    expect(countCalls(calls, '/sys/user/info')).toBe(1)
  })

  it('推测项默认也失效（漏失效的代价比多一次请求大）', async () => {
    const { session } = await createLoadedSession()

    const applied = applyInvalidation(session, {
      path: '/adminmanage-api/system/tenant/update-use-system',
      method: 'PUT',
    })

    expect(applied.inferredKeys).toEqual([tenantSystem])
    expect(session.has(tenantSystem)).toBe(false)
  })

  it('includeInferred: false 时推测项不动会话', async () => {
    const { session } = await createLoadedSession()

    const applied = applyInvalidation(
      session,
      { path: '/adminmanage-api/system/tenant/update-use-system', method: 'PUT' },
      { includeInferred: false },
    )

    expect(applied.keys).toEqual([])
    expect(applied.invalidated).toEqual([])
    expect(session.has(tenantSystem)).toBe(true)
  })

  it('会话里本来就没加载过的 key 记在 absent，不算失败', async () => {
    const credential: PortalCredential = { token: 'tk-u-2', tenantId: 1001 }
    const store = createStore([])
    const session = await store.acquire({
      userId: 'u-2',
      tenantId: 1001,
      credential,
      capabilities: [userBasic],
    })
    expect(session.has(dictHr)).toBe(false)

    const applied = applyInvalidation(session, { path: '/sys/dict/data', method: 'POST' })

    expect(applied.invalidated).toEqual([])
    expect(applied.absent).toEqual([dictHr, dictPlatform])
  })

  it('未登记的写目标对会话毫无影响', async () => {
    const { session } = await createLoadedSession()

    const applied = applyInvalidation(session, { path: '/admin-api/nope/nothing', method: 'POST' })

    expect(applied).toMatchObject({ rules: [], keys: [], invalidated: [], absent: [] })
    for (const key of ALL_BASE_DATA_KEYS) {
      expect(session.has(key)).toBe(true)
    }
  })

  it('SDK 现有写能力走完不失效任何基础数据', async () => {
    const { session } = await createLoadedSession()

    for (const capabilityId of ['meeting-application-submit', 'meeting-application-cancel']) {
      const applied = applyInvalidation(session, { capabilityId })
      expect(applied.keys).toEqual([])
    }

    for (const key of ALL_BASE_DATA_KEYS) {
      expect(session.has(key)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 五、路径比较
// ---------------------------------------------------------------------------

describe('路径归一化与比较', () => {
  it('normalizeEndpointPath：补前导斜杠、去 query/hash、去末尾斜杠', () => {
    expect(normalizeEndpointPath('sys/dict/data')).toBe('/sys/dict/data')
    expect(normalizeEndpointPath('/sys/dict/data/')).toBe('/sys/dict/data')
    expect(normalizeEndpointPath('/sys/dict/data?a=1#b')).toBe('/sys/dict/data')
    expect(normalizeEndpointPath('  /sys//dict/data  ')).toBe('/sys/dict/data')
  })

  it('sameEndpoint：前缀差异认得出，方法无关', () => {
    expect(sameEndpoint('/sys/dict/data', '/admin-api/sys/dict/data')).toBe(true)
    expect(sameEndpoint('/admin-api/sys/dict/data', '/sys/dict/data')).toBe(true)
    expect(sameEndpoint('/sys/dict/data', '/sys/dict/data/updateList')).toBe(false)
    expect(sameEndpoint('/sys/dict/data', '/sys/dict/types')).toBe(false)
  })

  it('sameEndpoint：单段路径不参与后缀匹配（否则 /get 会匹配上一切）', () => {
    expect(sameEndpoint('/get', '/admin-api/system/tenant/get')).toBe(false)
    expect(sameEndpoint('/get', '/get')).toBe(true)
  })

  it('sameEndpoint：{id} 占位段只通配自己那一段', () => {
    expect(sameEndpoint('/org/organization/disable/{id}', '/org/organization/disable/9527')).toBe(true)
    expect(sameEndpoint('/org/organization/disable/{id}', '/admin-api/org/organization/disable/1')).toBe(true)
    // 占位段不能把整段路径吃掉
    expect(sameEndpoint('/org/organization/disable/{id}', '/org/organization/enable/9527')).toBe(false)
    expect(sameEndpoint('/org/organization/{id}', '/org/organization/import')).toBe(true)
    expect(sameEndpoint('/org/organization/{id}', '/org/organization')).toBe(false)
  })

  it('调用方不给方法时，同路径的不同写方法都算命中（宁可多失效）', () => {
    const withoutMethod = matchingRules({ path: '/sys/dict/data' }).map((rule) => rule.id)
    expect(withoutMethod).toEqual(['dict-data-create', 'dict-data-update', 'dict-data-delete'])
  })
})
