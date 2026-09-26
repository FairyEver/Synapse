/**
 * 三个基础只读数据能力（部门 / 字典 / 权限清单）的回归测试。
 *
 * 这里刻意**不走 `createPortalHeadless`**：本文件同批不动 `src/capabilities/index.ts`
 * 与 `src/index.ts`，接线由派单方统一做，所以测试直接注入请求函数。
 * 这样测的正好是能力自己的契约，而不夹带门面的接线。
 *
 * 三条最要紧的断言（也是"改坏了会红"的那几条）：
 * 1. **只有切片入口，没有全量出口**（`Object.keys` 逐个钉死）；
 * 2. **合成页面路径不发 `module-type`**（`resolveModuleType` 返回 null）——
 *    这是 docs/base/*.md 里 module-type 那一节的**代码化依据**；
 * 3. **没有全长量入口仍然能回答"有没有"**：`hasPermission` 只取一份 2159 条的清单，
 *    但一个"全量返回权限码"的方法不存在。
 */

import { describe, expect, it } from 'vitest'

import {
  BASE_DATA_CACHE_TTL_MS,
  BASE_DATA_KEYS,
  BASE_DEPT_LIST_PATH,
  BASE_DICT_LIST_PATH,
  BASE_DICT_SESSION_KEYS,
  BASE_PERMISSION_LIST_PATH,
  baseDeptDictPermissionCapabilities,
  baseDeptPermissionBaseData,
  createBaseDeptDictPermission,
  DEPT_CHILDREN_MAX,
  DEPT_LIST_URL,
  DEPT_ROOT_PARENT_ID,
  DEPT_SEARCH_MAX,
  DICT_GROUPED_URL,
  DICT_TYPE_SEARCH_MAX,
  PERMISSION_LIST_URL,
  PERMISSION_SEARCH_MAX,
  BaseDataShapeError,
  type BaseDataRequest,
} from '../src/capabilities/base-dept-dict-permission.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { resolveHttpInstance } from '../src/context/http-instance.js'
import { DEFAULT_ABSOLUTE_TTL_MS } from '../src/session/store.js'

// ---------------------------------------------------------------------------
// 夹具：形状全部取自真实响应（`smoke/read-base-data.mjs` 实测），规模缩小到可读
// ---------------------------------------------------------------------------

/**
 * 部门。前 4 条是真实形状（`id` / `name` / `parentId`，根是 `parentId: 0`）。
 *
 * 第 5 条是**故意造的脏数据**：`parentId` 指向一个不存在的 id。
 * 实测本租户 1551 条里**没有**这种节点，所以这条测的是"脏数据不会把向上取路径变成死循环"
 * 这个**防御**行为，不是复刻现状 —— 别把它读成"线上就是这样"。
 */
const DEPTS = [
  { id: 1, name: '沃德辰龙', parentId: 0 },
  { id: 2, name: '华都峪口', parentId: 1 },
  { id: 3, name: '财务中心', parentId: 2 },
  { id: 4, name: '思玛特财务中心', parentId: 2 },
  { id: 9, name: '悬挂节点', parentId: 777 },
]

/** 字典：HTTP 原始形态 `[{dictType, dataList}]`。label 带前导空格是**实测如此**，不修 */
const DICTS_RAW = [
  {
    dictType: 'assignment_type',
    dataList: [
      { id: '1', dictType: 'assignment_type', value: '1', label: '文件' },
      { id: '2', dictType: 'assignment_type', value: '2', label: ' 图片+文字' },
      { id: '3', dictType: 'assignment_type', value: '3', label: ' 图片' },
    ],
  },
  {
    dictType: 'status',
    dataList: [{ id: '9', dictType: 'status', value: 'WAIT_SELLER_CHECK', label: '等待卖家确认' }],
  },
]

/** 字典：会话里 `dict-hr` / `dict-platform` 的形态 `{dictType: [entry]}` */
const DICTS_SESSION = {
  assignment_type: [
    { label: '文件', value: '1', id: '1' },
    { label: '在线作业', value: '7', id: '7' },
  ],
}

const PERMISSIONS = [
  '/dashboard/assignment/assignment',
  '/dashboard/base/management-center',
  'investment:daily:account:export',
  'investment:daily:account:import',
]

type Sent = { url: string; method: string; params?: unknown; moduleType?: number }

type MakeOptions = {
  dept?: unknown
  dict?: unknown
  permission?: unknown
  session?: { has: (key: string) => boolean; get: (key: string) => unknown } | null
  moduleType?: number
  cacheTtlMs?: number
  now?: () => number
}

function makeCap (options: MakeOptions = {}) {
  const sent: Sent[] = []
  const payloadFor = (url: string): unknown => {
    if (url === DEPT_LIST_URL) return options.dept ?? DEPTS
    if (url === DICT_GROUPED_URL) return options.dict ?? DICTS_RAW
    if (url === PERMISSION_LIST_URL) return options.permission ?? PERMISSIONS
    throw new Error(`测试没准备这个 URL 的响应：${url}`)
  }

  const request: BaseDataRequest = async <T>(config: {
    url: string
    method: 'get'
    params?: unknown
    moduleType?: number
  }): Promise<T> => {
    sent.push(config as Sent)
    return payloadFor(config.url) as T
  }

  const cap = createBaseDeptDictPermission({
    request,
    ...(options.session === undefined ? {} : { session: options.session }),
    ...(options.moduleType === undefined ? {} : { moduleType: options.moduleType }),
    ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
  })

  return { cap, sent }
}

/** 造一个只读的会话视图（`PortalSession` 结构上就是这个形状） */
function makeSession (values: Record<string, unknown>) {
  return {
    has: (key: string) => key in values,
    get: (key: string) => values[key],
  }
}

// ---------------------------------------------------------------------------
// 能力定义与契约
// ---------------------------------------------------------------------------

describe('能力定义：切片入口齐全、每个都是只读', () => {
  it('9 个能力 id 齐全且唯一（部门 3 + 字典 3 + 权限 3）', () => {
    const ids = baseDeptDictPermissionCapabilities.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual([
      'base-dept-children',
      'base-dept-get',
      'base-dept-search',
      'base-dict-get',
      'base-dict-search',
      'base-dict-translate',
      'base-permission-check',
      'base-permission-has',
      'base-permission-search',
    ].sort())
  })

  it('三个能力全部 write: false（只读承诺写进定义，不只是注释）', () => {
    for (const definition of baseDeptDictPermissionCapabilities) {
      expect(definition.write, definition.id).toBe(false)
    }
  })

  it('长选项参数都指向候选入口，且那个入口真的有一个必填 keyword 参数', () => {
    const byId = new Map(baseDeptDictPermissionCapabilities.map((item) => [item.id, item]))

    const lookups = baseDeptDictPermissionCapabilities.flatMap((definition) =>
      definition.params
        .filter((param) => param.lookup !== undefined)
        .map((param) => ({ from: definition.id, param: param.name, lookup: param.lookup! })),
    )
    // 别退化成"一条 lookup 都没有"的恒真断言
    expect(lookups.length).toBeGreaterThanOrEqual(4)

    for (const { from, param, lookup } of lookups) {
      const target = byId.get(lookup.capabilityId)
      expect(target, `${from}.${param} 指向的 ${lookup.capabilityId} 必须在目录里`).toBeDefined()
      const keyword = target!.params.find((candidate) => candidate.name === lookup.keywordParam)
      expect(keyword, `${from}.${param} 指向的 ${lookup.capabilityId} 必须有 ${lookup.keywordParam} 参数`).toBeDefined()
      expect(keyword!.required, `${lookup.capabilityId}.${lookup.keywordParam} 必须是必填`).toBe(true)
    }
  })
})

describe('合成页面路径：不发 module-type、走默认 platform 实例', () => {
  it.each([
    ['部门', BASE_DEPT_LIST_PATH],
    ['字典', BASE_DICT_LIST_PATH],
    ['权限清单', BASE_PERMISSION_LIST_PATH],
  ])('%s 的合成路径在规则表里匹配不到 → module-type 为 null（与浏览器"无落地页"一致）', (_label, path) => {
    const resolved = resolveModuleType(path)
    expect(resolved.moduleType).toBeNull()
    expect(resolved.matchedBy).toBe('none')
  })

  it.each([
    ['部门', BASE_DEPT_LIST_PATH],
    ['字典', BASE_DICT_LIST_PATH],
    ['权限清单', BASE_PERMISSION_LIST_PATH],
  ])('%s 的合成路径解析到全局默认实例 platform（=Portal 里这三条链路用的实例）', (_label, path) => {
    const resolution = resolveHttpInstance({ pagePath: path, declared: null })
    expect(resolution.kind).toBe('resolved')
    if (resolution.kind !== 'resolved') return
    expect(resolution.instance.id).toBe('platform')
    expect(resolution.matchedBy).toBe('global-default')
  })

  it('合成路径都在同一个 /base-data 根下（不混进仪表盘的真实业务域）', () => {
    for (const path of [BASE_DEPT_LIST_PATH, BASE_DICT_LIST_PATH, BASE_PERMISSION_LIST_PATH]) {
      expect(path.startsWith('/base-data/')).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 体积：只有切片入口
// ---------------------------------------------------------------------------

describe('体积：没有"全量倒出来"的入口', () => {
  it('实现对象上只有那 10 个方法，没有 listAll / all / list 这类全量出口', async () => {
    const { cap } = makeCap()

    expect(Object.keys(cap).sort()).toEqual([
      'checkPermissions',
      'getDepartment',
      'getDict',
      'hasPermission',
      'invalidate',
      'listDepartments',
      'searchDepartments',
      'searchDictTypes',
      'searchPermissions',
      'translateDict',
    ])
  })

  it('每个搜索入口都有硬上限：limit 传超大也被截到 *_MAX', async () => {
    const many = Array.from({ length: 500 }, (_, index) => ({ id: index + 1, name: `测试部门${index + 1}`, parentId: 0 }))
    const { cap } = makeCap({ dept: many })
    const departments = await cap.searchDepartments({ keyword: '测试部门', limit: 9999 })
    expect(departments.matched).toBe(500)
    expect(departments.list).toHaveLength(DEPT_SEARCH_MAX)

    const { cap: cap2 } = makeCap({
      dict: Array.from({ length: 300 }, (_, index) => ({ dictType: `test_dict_${index}`, dataList: [] })),
    })
    const types = await cap2.searchDictTypes({ keyword: 'test_dict_', limit: 9999 })
    expect(types.matched).toBe(300)
    expect(types.list).toHaveLength(DICT_TYPE_SEARCH_MAX)

    const { cap: cap3 } = makeCap({
      permission: Array.from({ length: 500 }, (_, index) => `investment:code:${index}`),
    })
    const permissions = await cap3.searchPermissions({ keyword: 'investment:', limit: 9999 })
    expect(permissions.list).toHaveLength(PERMISSION_SEARCH_MAX)
  })
})

// ---------------------------------------------------------------------------
// 部门
// ---------------------------------------------------------------------------

describe('部门：长选项必须先要关键字', () => {
  it('无关键字 / 全空白直接拒绝，且**不发请求**', async () => {
    const { cap, sent } = makeCap()

    await expect(cap.searchDepartments({ keyword: '' })).rejects.toThrow(/keyword/)
    await expect(cap.searchDepartments({ keyword: '   ' })).rejects.toThrow(/keyword/)
    await expect(cap.searchDepartments({} as never)).rejects.toThrow(/keyword/)
    expect(sent).toHaveLength(0)
  })

  it('有名字就够，不需要完整名字：包含匹配 + 如实回报命中数', async () => {
    const { cap, sent } = makeCap()

    const result = await cap.searchDepartments({ keyword: '财务' })

    expect(result.total).toBe(DEPTS.length)
    expect(result.matched).toBe(2)
    expect(result.list.map((node) => node.name)).toEqual(['财务中心', '思玛特财务中心'])
    expect(sent).toHaveLength(1)
  })

  it('请求就是那一条：GET DEPT_LIST_URL，且**一个参数都不发**', async () => {
    const { cap, sent } = makeCap()

    await cap.searchDepartments({ keyword: '财务' })

    expect(sent[0]!.method).toBe('get')
    expect(sent[0]!.url).toBe('/admin-api/system/dept/list-all-simple')
    // 浏览器唯一调用点发的是 ?pageNo=-1&pageSize=-1&isCorporation=1（那是"公司"下拉框，
    // 拿到的是子集）。基础能力要全量表，所以这三项都不发 —— 这是刻意的差异。
    expect(sent[0]!.params).toBeUndefined()
  })
})

describe('部门：路径与下级', () => {
  it('getDepartment 给出从根到它的完整路径（根在 parentId=0 处停）', async () => {
    const { cap } = makeCap()

    const node = await cap.getDepartment(3)

    expect(node.name).toBe('财务中心')
    expect(node.path.map((item) => item.name)).toEqual(['沃德辰龙', '华都峪口', '财务中心'])
    expect(node.pathNames).toBe('沃德辰龙/华都峪口/财务中心')
  })

  it('脏数据（父节点不存在）不会死循环：路径只到能走到的地方为止（防御，不是现状复刻）', async () => {
    const { cap } = makeCap()

    const node = await cap.getDepartment(9)

    expect(node.path).toEqual([{ id: 9, name: '悬挂节点' }])
    expect(node.pathNames).toBe('悬挂节点')
  })

  it('id 不存在时报错，并提示去用 base-dept-search（不静默返回空）', async () => {
    const { cap, sent } = makeCap()

    await expect(cap.getDepartment(12345)).rejects.toThrow(/base-dept-search/)
    expect(sent).toHaveLength(1)
  })

  it('listDepartments(0) 拿到根节点 —— 实测根就是 parentId=0，不是 null', async () => {
    const { cap } = makeCap()

    const roots = await cap.listDepartments({ parentId: DEPT_ROOT_PARENT_ID })
    expect(roots.list.map((node) => node.name)).toEqual(['沃德辰龙'])

    const children = await cap.listDepartments({ parentId: 2 })
    expect(children.total).toBe(2)
    expect(children.list.map((node) => node.id)).toEqual([3, 4])
  })

  it('下级也有上限（实测单个父节点最多 18 个，但上限仍要挡住脏数据）', async () => {
    const many = Array.from({ length: 400 }, (_, index) => ({ id: index + 10, name: `子${index}`, parentId: 2 }))
    const { cap } = makeCap({ dept: many })

    const children = await cap.listDepartments({ parentId: 2, limit: 9999 })
    expect(children.total).toBe(400)
    expect(children.list).toHaveLength(DEPT_CHILDREN_MAX)
  })
})

// ---------------------------------------------------------------------------
// 字典
// ---------------------------------------------------------------------------

describe('字典：一次只取一个 dictType', () => {
  it('getDict 取回该 dictType 的全部选项，label **原样**（带前导空格也不 trim）', async () => {
    const { cap, sent } = makeCap()

    const result = await cap.getDict('assignment_type')

    expect(result.dictType).toBe('assignment_type')
    expect(result.entries).toHaveLength(3)
    // 实测线上就是「 图片+文字」（带前导空格）；assignment.ts 的硬编码快照是 trim 过的，
    // 于是与线上不一致。基础能力原样返回，不做"看起来更整齐"的加工。
    expect(result.entries.map((entry) => entry.label)).toEqual(['文件', ' 图片+文字', ' 图片'])
    expect(result.entries[0]!.value).toBe('1')
    expect(sent[0]!.url).toBe(DICT_GROUPED_URL)
  })

  it('dictType 写错就报错（885 个名字猜不得），错误信息指路 base-dict-search', async () => {
    const { cap } = makeCap()

    await expect(cap.getDict('assingment_type')).rejects.toThrow(/base-dict-search/)
    await expect(cap.getDict('')).rejects.toThrow(/dictType/)
  })

  it('dictType 存在但没有条目 → 返回空数组（与"名字写错"区分开）', async () => {
    const { cap } = makeCap({ dict: [{ dictType: 'empty_dict', dataList: [] }] })

    const result = await cap.getDict('empty_dict')
    expect(result.entries).toEqual([])
  })

  it('searchDictTypes 必须先给关键字，且匹配不区分大小写', async () => {
    const { cap, sent } = makeCap({
      dict: [
        { dictType: 'assignment_type', dataList: [{ label: 'a', value: '1', id: '1' }] },
        { dictType: 'Yukou_ShopId', dataList: [] },
      ],
    })

    await expect(cap.searchDictTypes({ keyword: '' })).rejects.toThrow(/keyword/)
    expect(sent).toHaveLength(0)

    // 大小写不敏感：大写关键字能搜到小写的 dictType，反之亦然
    const upper = await cap.searchDictTypes({ keyword: 'ASSIGN' })
    expect(upper.list).toEqual([{ dictType: 'assignment_type', entryCount: 1 }])

    const lower = await cap.searchDictTypes({ keyword: 'assign' })
    expect(lower.list).toEqual([{ dictType: 'assignment_type', entryCount: 1 }])

    const mixed = await cap.searchDictTypes({ keyword: 'yukou' })
    expect(mixed.list.map((item) => item.dictType)).toEqual(['Yukou_ShopId'])
    expect(mixed.total).toBe(2)
  })

  it('translateDict：数字 1 与字符串 "1" 都能命中（String() 归一）', async () => {
    const { cap } = makeCap()

    expect((await cap.translateDict({ dictType: 'assignment_type', value: 1 })).label).toBe('文件')
    expect((await cap.translateDict({ dictType: 'assignment_type', value: '1' })).label).toBe('文件')
  })

  it('translateDict 查不到值时返回 found:false + label:null，**不抛错**（查不到一个码是正常情况）', async () => {
    const { cap } = makeCap()

    const result = await cap.translateDict({ dictType: 'assignment_type', value: '999' })
    expect(result).toEqual({ dictType: 'assignment_type', value: '999', label: null, found: false })
  })
})

// ---------------------------------------------------------------------------
// 权限清单
// ---------------------------------------------------------------------------

describe('权限清单：只回答"有没有"', () => {
  it('hasPermission 精确匹配；空码拒绝', async () => {
    const { cap, sent } = makeCap()

    expect(await cap.hasPermission('/dashboard/assignment/assignment')).toBe(true)
    expect(await cap.hasPermission('/definitely/not/real')).toBe(false)
    await expect(cap.hasPermission('  ')).rejects.toThrow(/code/)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.url).toBe(PERMISSION_LIST_URL)
  })

  it('checkPermissions 接受数组与逗号分隔的字符串，并按 granted / missing 分开', async () => {
    const { cap } = makeCap()

    const fromArray = await cap.checkPermissions([
      '/dashboard/assignment/assignment',
      '/definitely/not/real',
    ])
    expect(fromArray).toEqual({
      granted: ['/dashboard/assignment/assignment'],
      missing: ['/definitely/not/real'],
      checked: 2,
    })

    const fromText = await cap.checkPermissions('investment:daily:account:export, investment:daily:account:import')
    expect(fromText.granted).toHaveLength(2)
    expect(fromText.missing).toEqual([])
  })

  it('checkPermissions 去重：同一个码传两遍只算一次', async () => {
    const { cap } = makeCap()

    const result = await cap.checkPermissions(['/x', '/x', '/y'])
    expect(result.checked).toBe(2)
    expect(result.missing).toEqual(['/x', '/y'])
  })

  it('searchPermissions 前缀查询就是传前缀（任务里点名的那个用法）', async () => {
    const { cap } = makeCap()
    const { cap: cap2, sent } = makeCap({ permission: PERMISSIONS.map((code) => `investment:${code}`) })

    await expect(cap2.searchPermissions({ keyword: '  ' })).rejects.toThrow(/keyword/)
    expect(sent).toHaveLength(0)

    const result = await cap.searchPermissions({ keyword: 'investment:daily:account:' })
    expect(result.matched).toBe(2)
    expect(result.total).toBe(PERMISSIONS.length)
    expect(result.list).toEqual([
      'investment:daily:account:export',
      'investment:daily:account:import',
    ])
  })
})

// ---------------------------------------------------------------------------
// 缓存与单飞
// ---------------------------------------------------------------------------

describe('缓存：同一份数据不发第二遍（Portal 一次首屏把字典打了 4 遍，SDK 不照抄）', () => {
  it('连续两次 getDict 只发一次请求', async () => {
    const { cap, sent } = makeCap()

    await cap.getDict('assignment_type')
    await cap.getDict('status')

    expect(sent).toHaveLength(1)
  })

  it('并发调用同一份数据只发一次请求（单飞）', async () => {
    const { cap, sent } = makeCap()

    await Promise.all([
      cap.getDict('assignment_type'),
      cap.getDict('status'),
      cap.searchDictTypes({ keyword: 'assign' }),
    ])

    expect(sent).toHaveLength(1)
  })

  it('三份数据各自只打一次：部门 / 字典 / 权限一共 3 次请求', async () => {
    const { cap, sent } = makeCap()

    await cap.searchDepartments({ keyword: '财务' })
    await cap.getDict('assignment_type')
    await cap.hasPermission('/dashboard/assignment/assignment')
    // 再各来一遍
    await cap.searchDepartments({ keyword: '华都' })
    await cap.getDict('status')
    await cap.hasPermission('investment:daily:account:export')

    expect(sent.map((item) => item.url)).toEqual([DEPT_LIST_URL, DICT_GROUPED_URL, PERMISSION_LIST_URL])
  })

  it('TTL 内不重发、过期后重发（用注入的假时钟，不真实 sleep）', async () => {
    let clock = 1_000
    const { cap, sent } = makeCap({ cacheTtlMs: 5_000, now: () => clock })

    await cap.getDict('assignment_type')
    clock += 4_999
    await cap.getDict('assignment_type')
    expect(sent).toHaveLength(1)

    clock += 2
    await cap.getDict('assignment_type')
    expect(sent).toHaveLength(2)
  })

  it('invalidate 指定片：只丢那一片；不指定则全丢', async () => {
    const { cap, sent } = makeCap({})

    await cap.getDict('assignment_type')
    await cap.hasPermission('/x')
    expect(sent).toHaveLength(2)

    cap.invalidate('dict')
    await cap.getDict('assignment_type')
    await cap.hasPermission('/x')
    expect(sent).toHaveLength(3)

    cap.invalidate()
    await cap.getDict('assignment_type')
    await cap.hasPermission('/x')
    expect(sent).toHaveLength(5)
  })

  it('缓存 TTL 与会话层的绝对 TTL 同值（挂不挂会话行为一致；漂开就红）', () => {
    expect(BASE_DATA_CACHE_TTL_MS).toBe(DEFAULT_ABSOLUTE_TTL_MS)
  })
})

// ---------------------------------------------------------------------------
// 挂上会话基础数据
// ---------------------------------------------------------------------------

describe('会话基础数据：挂上就不发请求', () => {
  it('字典读会话里的 dict-hr，一次请求都不发', async () => {
    const { cap, sent } = makeCap({ session: makeSession({ 'dict-hr': DICTS_SESSION }) })

    const result = await cap.getDict('assignment_type')

    expect(result.entries.map((entry) => entry.label)).toEqual(['文件', '在线作业'])
    expect(sent).toHaveLength(0)
    // 键名与接线约定一致（base-data.ts 里已有两个指向同一个 URL 的 key，本能力不新增第三个）
    expect([...BASE_DICT_SESSION_KEYS]).toEqual(['dict-hr', 'dict-platform'])
  })

  it('dict-hr 缺了还能退到 dict-platform（两个 key 同源，任一个在就行）', async () => {
    const { cap, sent } = makeCap({ session: makeSession({ 'dict-platform': DICTS_SESSION }) })

    await cap.getDict('assignment_type')
    expect(sent).toHaveLength(0)
  })

  it('部门与权限清单读会话里的 dept-list / permission-list', async () => {
    const { cap, sent } = makeCap({
      session: makeSession({
        [BASE_DATA_KEYS.dept]: DEPTS,
        [BASE_DATA_KEYS.permission]: PERMISSIONS,
      }),
    })

    expect((await cap.searchDepartments({ keyword: '财务' })).matched).toBe(2)
    expect(await cap.hasPermission('/dashboard/assignment/assignment')).toBe(true)
    expect(sent).toHaveLength(0)
  })

  it('会话里有别的键、没有这一个 → 回落到自己发请求（不是"会话在就一律不发"）', async () => {
    const { cap, sent } = makeCap({ session: makeSession({ 'user-basic': { id: 1 } }) })

    await cap.getDict('assignment_type')
    expect(sent).toHaveLength(1)
  })

  it('会话里的形状不认识时**报错**，不静默当成空数据', async () => {
    const { cap } = makeCap({ session: makeSession({ 'dict-hr': 42 }) })

    await expect(cap.getDict('assignment_type')).rejects.toThrow(BaseDataShapeError)
  })

  it('会话里字典是空对象是合法的（0 个 dictType），此时报"不存在"而不是形状错误', async () => {
    const { cap } = makeCap({ session: makeSession({ 'dict-hr': {} }) })

    await expect(cap.getDict('assignment_type')).rejects.toThrow(/不存在/)
  })
})

// ---------------------------------------------------------------------------
// module-type
// ---------------------------------------------------------------------------

describe('module-type：默认不发，接线方显式指定才发', () => {
  it('不给 moduleType：三个请求上都没有这个字段（浏览器在未覆盖路径上同样不发）', async () => {
    const { cap, sent } = makeCap()

    await cap.searchDepartments({ keyword: '财务' })
    await cap.getDict('assignment_type')
    await cap.hasPermission('/x')

    expect(sent).toHaveLength(3)
    for (const call of sent) {
      expect(call.moduleType).toBeUndefined()
    }
  })

  it('显式给 moduleType 时每个请求都带上（部门那一条后端真的会读这个头）', async () => {
    const { cap, sent } = makeCap({ moduleType: 11 })

    await cap.searchDepartments({ keyword: '财务' })
    await cap.getDict('assignment_type')
    await cap.hasPermission('/x')

    expect(sent.map((item) => item.moduleType)).toEqual([11, 11, 11])
  })
})

// ---------------------------------------------------------------------------
// 基础数据项（给 src/session 注册用）
// ---------------------------------------------------------------------------

describe('基础数据项：接线方注册进会话注册表', () => {
  it('只有部门与权限两项 —— 字典不新增（dict-hr / dict-platform 已经指向同一个 URL）', () => {
    expect(baseDeptPermissionBaseData.map((item) => item.key)).toEqual(['dept-list', 'permission-list'])
    expect(baseDeptPermissionBaseData.every((item) => item.critical !== true)).toBe(true)
  })

  it('两项的 load 打的是正确 URL，且形状与能力内部约定一致', async () => {
    const calls: string[] = []
    const context = {
      key: 'test',
      credential: { token: 'tk', tenantId: 1 },
      request: async (config: { url: string }) => {
        calls.push(config.url)
        return config.url === DEPT_LIST_URL ? DEPTS : PERMISSIONS
      },
      now: 0,
      get: () => undefined,
      has: () => false,
      session: { key: { userId: '1', tenantId: '1', language: 'zh-CN' }, storeKey: 'k', createdAt: 0, lastUsedAt: 0, expiresAt: 0 },
    }

    const loaded = await Promise.all(
      baseDeptPermissionBaseData.map((item) => item.load(context as never)),
    )

    expect(calls).toEqual([DEPT_LIST_URL, PERMISSION_LIST_URL])
    expect(Array.isArray(loaded[0])).toBe(true)
    expect(Array.isArray(loaded[1])).toBe(true)

    // 直接把这几个值当作"会话里那份"喂给能力：形状必须是同一套（两边共用同一次 load）
    const { cap, sent } = makeCap({
      session: makeSession({ 'dept-list': loaded[0], 'permission-list': loaded[1] }),
    })
    expect((await cap.searchDepartments({ keyword: '财务' })).matched).toBe(2)
    expect(await cap.hasPermission('/dashboard/assignment/assignment')).toBe(true)
    expect(sent).toHaveLength(0)
  })
})
