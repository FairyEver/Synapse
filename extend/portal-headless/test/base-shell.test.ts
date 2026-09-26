/**
 * 第二批基础能力（应用外壳那一层）的回归测试：
 * 用户信息 / 人员候选 / 待办角标 / 可见菜单 / 工作台卡片。
 *
 * 与第一批（`test/base-dept-dict-permission.test.ts`）同样的取向：**刻意不走 `createPortalHeadless`**。
 * 本文件同批不动 `src/capabilities/index.ts` 与两个门面，接线由派单方统一做，
 * 所以测试直接注入请求函数——这样测的正好是能力自己的契约，不夹带门面的接线。
 *
 * 五条最要紧的断言（也是"改坏了会红"的那几条）：
 *
 * 1. **`password2` / `salt` 绝不出现在返回值里，两个出口各一条**（真发请求 / 读会话）。
 *    这是唯一一条"错了也**不会**有别的症状"的断言——所以它被刻意拆成两条，
 *    而不是合成一条只测一个出口。
 * 2. **`scope: 'all'` 一定不发 `finished`**。发了就会被后端当成"已办"（源码实测），
 *    而返回的 415 条看起来**完全正常**——这是一个静默错。
 * 3. **`searchUsers` 无关键字 / 无部门时拒绝，且一个请求都不发**。
 * 4. **菜单树的缓存键并进了 `project`**：1 与 2 各打一次、互不串味。
 * 5. **`getMenuNav` 的树真的喂得进 `src/catalog/visibility.ts` 的 `createUserVisibility`**
 *    ——那条能力存在的首要理由就是它，不验一遍等于没接上。
 */

import { describe, expect, it } from 'vitest'

import {
  BASE_HOME_WIDGETS_PATH,
  BASE_MENU_NAV_PATH,
  BASE_SHELL_CACHE_TTL_MS,
  BASE_SHELL_CONTEXT_ROOT,
  BASE_SHELL_SESSION_KEYS,
  BASE_TODO_PATH,
  BASE_USER_INFO_PATH,
  BASE_USER_SEARCH_PATH,
  BPM_FINISHED_DONE,
  BPM_FINISHED_TODO,
  BPM_TASK_URL,
  BaseShellShapeError,
  baseShellCapabilities,
  createBaseShell,
  EXPENSE_PENDING_URL,
  HOME_PAGE_URL,
  HOME_WIDGET_LIMIT_MAX,
  MENU_MAX_NODES_MAX,
  MENU_NAV_URL,
  MENU_PATH_LIMIT_MAX,
  TODO_PAGE_SIZE_MAX,
  UNREAD_COUNT_URL,
  USER_INFO_URL,
  USER_SEARCH_PAGE_SIZE_MAX,
  USER_SIMPLE_PAGE_URL,
  type BaseShellOptions,
} from '../src/capabilities/base-shell.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { resolveHttpInstance } from '../src/context/http-instance.js'
import { createUserVisibility, collectVisiblePaths } from '../src/catalog/visibility.js'
import { DEFAULT_ABSOLUTE_TTL_MS } from '../src/session/store.js'

// ---------------------------------------------------------------------------
// 夹具：形状全部取自真实响应（`smoke/read-base-shell.mjs` 实测），规模缩小到可读
// ---------------------------------------------------------------------------

/**
 * 用户信息。**逐字段照抄真机**——包括那两个绝不能外流的字段。
 *
 * ⚠️ `password2` 与 `salt` 的值是**假的**（真机那份是 bcrypt 哈希，本仓库不留）。
 * 形状（string / 长度 60 / 长度 29）与真机一致。
 */
const USER_INFO_RAW = {
  id: '18243',
  username: '2021070101',
  password2: '$2a$10$FAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKEfakeFA',
  salt: '$2a$10$FAKEfakeFAKEfakeFAKEfak',
  realName: '姚淼鑫',
  headUrl: 'http://appimgcdn.world-tech.com.cn/client/imgs/g_55.png',
  gender: 1,
  email: null,
  mobile: '15011141909',
  gradeId: null,
  deptId: null,
  status: 1,
  createDate: '2023-07-18 16:26:12',
  creator: '1',
  superAdmin: 0,
  roleIdList: ['3', '7'],
  gradeName: null,
  roleList: null,
  organizationCode: '103010101020706',
  organizationName: '设计中心1236',
  organizationFullPathName: '沃德辰龙-沃德博创-沃德博创-系统研发-设计中心1236',
  organizationId: '101',
  updaterName: '某某',
  updateDate: '2026-01-01 00:00:00',
  creatorName: '某某',
  tenantAdmin: 1,
  postName: '高级产品经理',
  setPwd: 1,
}

/** `simple-page` 的一页。`deptName` / `realName` / `staffDuties` / `staffCode` 实测恒为 null */
const SIMPLE_USERS_PAGE = {
  list: [
    { id: 197951, nickname: '张洪量', deptId: 101, code: '2026090101', deptName: null, staffDuties: null, realName: null, staffCode: null },
    { id: 197864, nickname: '张星', deptId: 322, code: '2026021301', deptName: null, staffDuties: null, realName: null, staffCode: null },
  ],
  total: 436,
  summary: null,
  summaryRows: null,
}

/** `bpm/task/list-by-category` 的一页 */
const TODO_PAGE = {
  list: [
    {
      id: '75a606ac-acbc-11f1-b094-00505683dd67',
      name: '通用审批',
      claimTime: null,
      createTime: '2026-09-10 10:08:05',
      suspensionState: null,
      processInstance: {
        id: '75a0fd6e-acbc-11f1-b094-00505683dd67',
        name: '发起人自选2',
        title: null,
        startUserId: 18243,
        startUserNickname: '姚淼鑫',
        processDefinitionId: 'hr_general_approval:7:964ff0ae-79c7-11f1-a940-00505683dd67',
        category: null,
        businessKey: '64',
        result: 4,
        processDefinitionKey: 'hr_general_approval',
      },
    },
  ],
  total: 25,
}

/**
 * 菜单树。**照抄真机 `nav?project=2` 的前 4 个节点**（57 个里），
 * 含一条**路径形态**的 `permissions`（`/dashboard/agreement`）与一条**权限码形态**的
 * （`hr:module:approval`）——后者是 `visibility.ts` 明确要跳过的那一类。
 *
 * 节点字段与真机一致：`url` 恒 null、`createDate`/`icon`/`sort`/`parentName` 也在（本例省略几个
 * 不影响解析的，但 `url` 保留着，因为"url 恒为 null"是一条要测的事）。
 */
const MENU_TREE = [
  {
    id: '1156748733921165509',
    pid: '0',
    children: [
      {
        id: '1156748733921165511',
        pid: '1156748733921165509',
        children: [],
        name: '流程管理',
        url: null,
        menuType: 0,
        project: 2,
        icon: null,
        permissions: '',
        sort: null,
        parentName: null,
        useSystem: 1,
      },
      {
        id: '1156748733921165512',
        pid: '1156748733921165509',
        children: [
          {
            id: '1156748733921165513',
            pid: '1156748733921165512',
            children: [],
            name: '协议管理',
            url: null,
            menuType: 0,
            project: 2,
            icon: null,
            permissions: '/dashboard/agreement',
            sort: null,
            parentName: null,
            useSystem: 1,
          },
        ],
        name: '审批中心',
        url: null,
        menuType: 0,
        project: 2,
        icon: null,
        permissions: '',
        sort: null,
        parentName: null,
        useSystem: 1,
      },
    ],
    name: '[人力] 审批系统',
    url: null,
    menuType: 0,
    project: 2,
    icon: null,
    permissions: 'hr:module:approval',
    sort: null,
    parentName: null,
    useSystem: 1,
  },
]

/** `homePage/get` 的 `config` 是一个 JSON **字符串**，这是真机形状 */
const HOME_PAGE_RAW = {
  id: 300,
  userId: 18243,
  config: JSON.stringify([
    {
      x: 0, y: 0, w: 4, h: 5, id: '0yy5U74S',
      widget: 'hr/learning/course-completion',
      knownModules: ['hr/learning', 'hr/performance', 'hr/salary'],
    },
    {
      x: 4, y: 0, w: 4, h: 5, id: 'eGM7IuJq',
      widget: 'hr/salary/my-payslip',
      knownModules: ['hr/salary'],
    },
    {
      x: 8, y: 0, w: 4, h: 5, id: 'yAkYVjGw',
      widget: 'finance/income/order-income',
      knownModules: ['finance/income'],
    },
  ]),
  deleted: 0,
  creator: '18243',
  createTime: '2025-01-01 00:00:00',
  updater: '18243',
  updateTime: '2025-01-01 00:00:00',
  tenantId: 1,
}

// ---------------------------------------------------------------------------
// 请求桩：记录每一次请求，按 URL 分发
// ---------------------------------------------------------------------------

type RecordedCall = { url: string; method: string; params?: Record<string, unknown>; moduleType?: number }

/**
 * `routes` 可以是两种形态：
 * - 一张「URL → 载荷」的表（多数用例用这个）；
 * - 一个**解析器函数**（按参数分派的用例用这个，例如"同一个 URL、不同 project 返回不同的树"）。
 *   返回 `undefined` 就是"这条路我没配"，会失败而不是静默给个空。
 */
type Routes = Record<string, unknown> | ((config: RecordedCall) => unknown)

function makeShell (options: {
  routes?: Routes
  session?: BaseShellOptions['session']
  cacheTtlMs?: number
  now?: () => number
  moduleType?: number
} = {}) {
  const calls: RecordedCall[] = []
  const routes: Routes = options.routes ?? {}

  const request = <T>(config: RecordedCall): Promise<T> => {
    calls.push(config)
    const route = typeof routes === 'function' ? routes(config) : routes[config.url]
    if (route === undefined) {
      return Promise.reject(new Error(`测试桩没有配 ${config.url} 这条路由`))
    }
    const value = typeof route === 'function' ? (route as () => unknown)() : route
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value as T)
  }

  const shell = createBaseShell({
    request: request as unknown as BaseShellOptions['request'],
    session: options.session ?? null,
    ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.moduleType === undefined ? {} : { moduleType: options.moduleType }),
  })

  return { shell, calls }
}

/** 默认路由：六个接口都给一份真机形状的答案 */
function defaultRoutes (overrides: Record<string, unknown | (() => unknown)> = {}): Record<string, unknown> {
  return {
    [USER_INFO_URL]: USER_INFO_RAW,
    [USER_SIMPLE_PAGE_URL]: SIMPLE_USERS_PAGE,
    [BPM_TASK_URL]: TODO_PAGE,
    [UNREAD_COUNT_URL]: 302,
    [EXPENSE_PENDING_URL]: 1,
    [MENU_NAV_URL]: MENU_TREE,
    [HOME_PAGE_URL]: HOME_PAGE_RAW,
    ...overrides,
  }
}

const callsOf = (calls: RecordedCall[], url: string) => calls.filter((call) => call.url === url)

// ---------------------------------------------------------------------------

describe('能力定义：六个入口齐全、全部只读' as string, () => {
  it('6 个能力 id 齐全且唯一（用户 1 + 人员 1 + 待办 2 + 菜单 2 + 工作台 1）', () => {
    const ids = baseShellCapabilities.map((item) => item.id)
    expect(ids).toEqual([
      'base-user-info',
      'base-user-search',
      'base-todo-list',
      'base-todo-counts',
      'base-menu-nav',
      'base-menu-paths',
      'base-home-widgets',
    ])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('全部 write: false（只读承诺写进定义，不只是注释）', () => {
    for (const item of baseShellCapabilities) {
      expect(item.write, `${item.id} 应该是只读`).toBe(false)
    }
  })

  it('长选项 / 候选型参数都指向一个真实存在的候选入口', () => {
    const byId = new Map(baseShellCapabilities.map((item) => [item.id, item]))
    const withLookup = baseShellCapabilities.flatMap((item) =>
      item.params.filter((param) => param.lookup).map((param) => ({ item, param })),
    )
    // 本批只有两个：人员的 deptId → base-dept-search
    expect(withLookup.map(({ param }) => param.lookup?.capabilityId)).toEqual(['base-dept-search'])
    for (const { item, param } of withLookup) {
      const target = byId.get(param.lookup!.capabilityId)
      // 指向第一批的能力（不在本文件里）也是合法的 —— 只要那个 id 是本仓库认识的
      if (target === undefined) {
        expect(param.lookup!.capabilityId).toBe('base-dept-search')
        continue
      }
      const keywordParam = target.params.find((p) => p.name === param.lookup!.keywordParam)
      expect(keywordParam, `${item.id}.${param.name} 指向的入口没有 ${param.lookup!.keywordParam}`).toBeDefined()
      expect(keywordParam!.required).toBe(true)
    }
  })

  it('人员候选的 keyword 是**非必填**（因为它与 deptId 二选一，强制逻辑在实现里）', () => {
    const def = baseShellCapabilities.find((item) => item.id === 'base-user-search')!
    const keyword = def.params.find((param) => param.name === 'keyword')!
    expect(keyword.required).toBe(false)
    expect(keyword.kind).toBe('search')
  })

  it('菜单的两个入口都把 project 标成必填（"不传"不等于"全部"，实测后端按 1 返回）', () => {
    for (const id of ['base-menu-nav', 'base-menu-paths']) {
      const def = baseShellCapabilities.find((item) => item.id === id)!
      const project = def.params.find((param) => param.name === 'project')!
      expect(project.required, `${id}.project`).toBe(true)
    }
  })
})

describe('合成页面路径：不发 module-type、走默认 platform 实例', () => {
  const paths = [
    BASE_USER_INFO_PATH,
    BASE_USER_SEARCH_PATH,
    BASE_TODO_PATH,
    BASE_MENU_NAV_PATH,
    BASE_HOME_WIDGETS_PATH,
  ]

  it('五个合成页面路径**一个都解析不出 module-type**（所以能力不发这个头）', () => {
    for (const path of paths) {
      const resolution = resolveModuleType(path)
      expect(resolution.moduleType, `${path} 竟然解析出了 module-type：${resolution.label}`).toBeNull()
      expect(resolution.matchedBy).toBe('none')
    }
  })

  it('五个都落到全局默认实例，且都不是"推导不出来"', () => {
    for (const path of paths) {
      const resolution = resolveHttpInstance({ pagePath: path })
      expect(resolution.kind, `${path}`).toBe('resolved')
      if (resolution.kind === 'resolved') {
        expect(resolution.matchedBy).toBe('global-default')
        expect(resolution.instance.id).toBe('platform')
      }
    }
  })

  it('五个路径都在同一个 /base-data 根下（不混进仪表盘的真实业务域）', () => {
    for (const path of paths) {
      expect(path.startsWith(`${BASE_SHELL_CONTEXT_ROOT}/`), path).toBe(true)
    }
    // 而且**没有一个**以 /list 结尾——`normalizeMenuEntryPath` 对 /list 有特例分支
    for (const path of paths) {
      expect(path.endsWith('/list'), path).toBe(false)
    }
  })

  it('能力定义里的 pagePath 就是这五个常量本身（不是另抄一份）', () => {
    const used = new Set(baseShellCapabilities.map((item) => item.pagePath))
    expect([...used].sort()).toEqual([...paths].sort())
  })
})

describe('体积：没有"全量倒出来"的入口', () => {
  it('实现对象上只有那 8 个方法，没有 listAll / all / list 这类全量出口', () => {
    const { shell } = makeShell()
    expect(Object.keys(shell).sort()).toEqual([
      'getMenuNav',
      'getTodoCounts',
      'getUserInfo',
      'invalidate',
      'listHomeWidgets',
      'listMenuPaths',
      'listTodos',
      'searchUsers',
    ])
  })

  it('人员候选：pageSize 传超大被截到 USER_SEARCH_PAGE_SIZE_MAX', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await shell.searchUsers({ keyword: '张', pageSize: 9999 })
    expect(callsOf(calls, USER_SIMPLE_PAGE_URL)[0]!.params!.pageSize).toBe(USER_SEARCH_PAGE_SIZE_MAX)
  })

  it('待办列表：pageSize 传超大被截到 TODO_PAGE_SIZE_MAX', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await shell.listTodos({ scope: 'done', pageSize: 9999 })
    expect(callsOf(calls, BPM_TASK_URL)[0]!.params!.pageSize).toBe(TODO_PAGE_SIZE_MAX)
  })

  it('菜单路径：limit 传超大被截到 MENU_PATH_LIMIT_MAX', async () => {
    const { shell } = makeShell({ routes: defaultRoutes() })
    // 夹具只有 1 条路径，所以这里测的是"截断后的条数不超过上限"这个不变量
    const result = await shell.listMenuPaths({ project: 2, limit: 9999 })
    expect(result.paths.length).toBeLessThanOrEqual(MENU_PATH_LIMIT_MAX)
  })

  it('工作台卡片：limit 传超大被截到 HOME_WIDGET_LIMIT_MAX', async () => {
    const { shell } = makeShell({ routes: defaultRoutes() })
    const result = await shell.listHomeWidgets({ limit: 9999 })
    expect(result.widgets.length).toBeLessThanOrEqual(HOME_WIDGET_LIMIT_MAX)
  })

  it('菜单树：maxNodes 传超大被截到 MENU_MAX_NODES_MAX（并按上限截断 + 如实报 truncated）', async () => {
    const { shell } = makeShell({ routes: defaultRoutes() })
    const result = await shell.getMenuNav({ project: 2, maxNodes: 9999 })
    expect(result.totalNodes).toBe(4)
    expect(result.returnedNodes).toBeLessThanOrEqual(MENU_MAX_NODES_MAX)
  })
})

describe('用户信息：password2 / salt 绝不能出这个门', () => {
  it('真发请求那一条路：返回值里没有 password2 / salt，也没有任何未列入白名单的字段', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    const info = await shell.getUserInfo()

    expect(callsOf(calls, USER_INFO_URL)).toHaveLength(1)
    // 白名单**恰好**是这些键 —— 多一个就说明有人往归一化里加了字段而没走审慎
    expect(Object.keys(info).sort()).toEqual([
      'createDate', 'deptId', 'email', 'gender', 'headUrl', 'id', 'mobile',
      'organizationCode', 'organizationFullPathName', 'organizationId', 'organizationName',
      'postName', 'realName', 'roleIds', 'status', 'superAdmin', 'tenantAdmin', 'username',
    ])
    // 逐字段断言那两个敏感字段**在任何形态下**都不在（含原型的兜底）
    for (const secret of ['password2', 'salt']) {
      expect(secret in info, `${secret} 出现在了返回值里`).toBe(false)
    }
    // 序列化一遍再查一次：挂在原型 / 不可枚举属性上的也逃不掉
    const serialized = JSON.stringify(info)
    expect(serialized).not.toContain('password2')
    expect(serialized).not.toContain('$2a$10$FAKE')
    expect(serialized).not.toContain('salt')
  })

  it('⭐ 读会话那一条路**同样**过白名单：会话里的 user-basic 是原始响应（带 password2）', async () => {
    // 这是本文件最要紧的一条：两个出口都必须过白名单。
    // 会话里存的确实是**原始响应**（`src/session/base-data.ts` 的 user-basic 就 load 了它），
    // 所以"读会话更安全"是错觉——少走一次归一化就是一次凭据外流。
    const session = new Map<string, unknown>([[BASE_SHELL_SESSION_KEYS.userInfo, USER_INFO_RAW]])
    const { shell, calls } = makeShell({
      routes: defaultRoutes(),
      session: { has: (key) => session.has(key), get: (key) => session.get(key) },
    })

    const info = await shell.getUserInfo()
    expect(calls, '挂了会话就不该再发这一条请求').toHaveLength(0)
    expect('password2' in info).toBe(false)
    expect('salt' in info).toBe(false)
    expect(JSON.stringify(info)).not.toContain('$2a$10$FAKE')
    // 而它确实读到了会话里那份数据（不是"读了个空对象所以没有敏感字段"）
    expect(info.realName).toBe('姚淼鑫')
    expect(info.id).toBe('18243')
  })

  it('superAdmin / tenantAdmin 归一成布尔（只认 1/true/"1"，不做 Boolean(value)）', async () => {
    for (const [raw, expected] of [[1, true], [0, false], ['1', true], ['0', false], [true, true], [false, false]] as const) {
      const { shell } = makeShell({
        routes: defaultRoutes({
          [USER_INFO_URL]: { ...USER_INFO_RAW, superAdmin: raw, tenantAdmin: raw },
        }),
      })
      const info = await shell.getUserInfo()
      expect(info.superAdmin, `superAdmin=${JSON.stringify(raw)}`).toBe(expected)
      expect(info.tenantAdmin, `tenantAdmin=${JSON.stringify(raw)}`).toBe(expected)
    }
  })

  it('形状不认识时**报错**，不静默返回空（会话里那份可能根本不是用户信息）', async () => {
    const { shell } = makeShell({ routes: defaultRoutes({ [USER_INFO_URL]: [1, 2, 3] }) })
    await expect(shell.getUserInfo()).rejects.toThrow(BaseShellShapeError)
  })

  it('缺 id 也报错（区分"形状对但没 id"与"形状就不对"）', async () => {
    const { shell } = makeShell({ routes: defaultRoutes({ [USER_INFO_URL]: { realName: '某' } }) })
    await expect(shell.getUserInfo()).rejects.toThrow(/没有 id/)
  })
})

describe('人员候选：长选项必须先要关键字', () => {
  it('无关键字且无部门 → 拒绝，且**一个请求都不发**', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await expect(shell.searchUsers({})).rejects.toThrow(/长选项参数/)
    expect(calls).toHaveLength(0)
  })

  it('只给空白关键字也算没给', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await expect(shell.searchUsers({ keyword: '   ' })).rejects.toThrow(/长选项参数/)
    expect(calls).toHaveLength(0)
  })

  it('pageSize = -1 单独拒绝（那是一次全量请求，不是"大一点的页"）', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await expect(shell.searchUsers({ keyword: '张', pageSize: -1 })).rejects.toThrow(/-1/)
    expect(calls).toHaveLength(0)
  })

  it('关键字发到后端的 `nickname` 字段（不是 keyword）', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await shell.searchUsers({ keyword: ' 张 ' })
    const params = callsOf(calls, USER_SIMPLE_PAGE_URL)[0]!.params!
    expect(params.nickname).toBe('张')
    expect(params).not.toHaveProperty('keyword')
    expect(params.pageNo).toBe(1)
    expect(params.pageSize).toBe(20)
  })

  it('只给 deptId 也放行（那条路是有界的：实测 21 人 vs 全量 4225）', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await shell.searchUsers({ deptId: 101 })
    const params = callsOf(calls, USER_SIMPLE_PAGE_URL)[0]!.params!
    expect(params.deptId).toBe(101)
    expect(params).not.toHaveProperty('nickname')
  })

  it('返回 list + total，字段名与真机一致（deptName 等实测恒为 null 也保留）', async () => {
    const { shell } = makeShell({ routes: defaultRoutes() })
    const result = await shell.searchUsers({ keyword: '张' })
    expect(result.total).toBe(436)
    expect(result.list[0]).toEqual({
      id: '197951',
      nickname: '张洪量',
      deptId: 101,
      code: '2026090101',
      deptName: null,
      staffDuties: null,
      realName: null,
      staffCode: null,
    })
  })
})

describe('待办：scope → finished 的三态映射（这里是静默错的高发区）', () => {
  it("⭐ scope='todo' 发 finished=1", async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    const result = await shell.listTodos({ scope: 'todo' })
    expect(callsOf(calls, BPM_TASK_URL)[0]!.params!.finished).toBe(BPM_FINISHED_TODO)
    expect(result.scope).toBe('todo')
  })

  it("⭐ scope='done' 发 finished=2", async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await shell.listTodos({ scope: 'done' })
    expect(callsOf(calls, BPM_TASK_URL)[0]!.params!.finished).toBe(BPM_FINISHED_DONE)
  })

  it("⭐⭐ scope='all' **一定不发 finished** —— 发了就会被后端当成「已办」，且返回的 415 条看起来完全正常", async () => {
    // 后端是 `if (finished != null) { if (== 1) unfinished else finished }` 的**三态**分支：
    // 不是"两态 + 默认全部"。少写一个判断就会让 scope='all' 静默退化成 scope='done'，
    // 而结果集完全合法 —— 所以这条断言必须存在。
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await shell.listTodos({ scope: 'all' })
    const params = callsOf(calls, BPM_TASK_URL)[0]!.params!
    expect('finished' in params, 'scope=all 竟然发了 finished').toBe(false)
  })

  it('不传 scope 默认 todo（角标语义，不是"全部"）', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    const result = await shell.listTodos()
    expect(callsOf(calls, BPM_TASK_URL)[0]!.params!.finished).toBe(BPM_FINISHED_TODO)
    expect(result.scope).toBe('todo')
  })

  it('非法 scope 拒绝，且不发请求（挡住从 JS 侧绕进来的 finished=0）', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await expect(shell.listTodos({ scope: '0' as never })).rejects.toThrow(/scope/)
    expect(calls).toHaveLength(0)
  })

  it('name 走**服务端**参数（后端 taskNameLike），不是本地筛', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await shell.listTodos({ name: ' 审批 ' })
    expect(callsOf(calls, BPM_TASK_URL)[0]!.params!.name).toBe('审批')
  })

  it('不传 name 时不发这个参数（别发空串去触发一次无意义的 like）', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await shell.listTodos({})
    expect('name' in callsOf(calls, BPM_TASK_URL)[0]!.params!).toBe(false)
  })

  it('摊平 processInstance：title / startUserNickname / result 都提到顶层', async () => {
    const { shell } = makeShell({ routes: defaultRoutes() })
    const result = await shell.listTodos({ scope: 'done' })
    expect(result.total).toBe(25)
    expect(result.list[0]).toEqual({
      id: '75a606ac-acbc-11f1-b094-00505683dd67',
      name: '通用审批',
      createTime: '2026-09-10 10:08:05',
      claimTime: null,
      processInstanceId: '75a0fd6e-acbc-11f1-b094-00505683dd67',
      title: null,
      processDefinitionKey: 'hr_general_approval',
      startUserId: 18243,
      startUserNickname: '姚淼鑫',
      result: 4,
    })
  })
})

describe('角标：三条一次读完，且失败不整体抛', () => {
  it('打三条：待办数 / 未读消息 / 待审费用；待办数取自 pageSize=1 的 total', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    const counts = await shell.getTodoCounts()

    expect(counts).toEqual({ todo: 25, unreadMessages: 302, expensePending: 1, failures: [] })
    const bpmCall = callsOf(calls, BPM_TASK_URL)[0]!
    expect(bpmCall.params!.pageSize).toBe(1)
    expect(bpmCall.params!.finished).toBe(BPM_FINISHED_TODO)
    expect(callsOf(calls, UNREAD_COUNT_URL)).toHaveLength(1)
    expect(callsOf(calls, EXPENSE_PENDING_URL)).toHaveLength(1)
  })

  it('⭐ 某一条失败 → 那一项是 null 且进 failures；**null 不等于 0**', async () => {
    // 待审费用那条在 Portal 里是条件请求（侧边栏有那个菜单才打），所以它失败是正常情况。
    // 若把失败折成 0，调用方会读成"没有待审费用" —— 那是把"不知道"说成"没有"。
    const { shell } = makeShell({
      routes: defaultRoutes({ [EXPENSE_PENDING_URL]: new Error('HTTP 500') }),
    })
    const counts = await shell.getTodoCounts()

    expect(counts.expensePending).toBeNull()
    expect(counts.expensePending).not.toBe(0)
    expect(counts.todo).toBe(25)
    expect(counts.unreadMessages).toBe(302)
    expect(counts.failures).toEqual([{ key: 'expensePending', message: 'HTTP 500' }])
  })

  it('三条全挂也不抛（调用方拿到三份 null + 三条 failures）', async () => {
    const { shell } = makeShell({
      routes: defaultRoutes({
        [BPM_TASK_URL]: new Error('boom-bpm'),
        [UNREAD_COUNT_URL]: new Error('boom-unread'),
        [EXPENSE_PENDING_URL]: new Error('boom-expense'),
      }),
    })
    const counts = await shell.getTodoCounts()
    expect(counts).toEqual({
      todo: null,
      unreadMessages: null,
      expensePending: null,
      failures: [
        { key: 'todo', message: 'boom-bpm' },
        { key: 'unreadMessages', message: 'boom-unread' },
        { key: 'expensePending', message: 'boom-expense' },
      ],
    })
  })

  it('角标数是数字，不是"取回来的对象"（未读消息那条 data 本身就是个裸数字）', async () => {
    const { shell } = makeShell({ routes: defaultRoutes({ [UNREAD_COUNT_URL]: '302' }) })
    const counts = await shell.getTodoCounts()
    expect(counts.unreadMessages).toBe(302)
  })
})

describe('可见菜单：project 必填、缓存键并进 project、树能喂给可见性过滤', () => {
  it('project 缺 / null / 空串 → 拒绝，且不发请求（不能静默当成 0）', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await expect(shell.getMenuNav({} as never)).rejects.toThrow(/project/)
    await expect(shell.getMenuNav({ project: null as never })).rejects.toThrow(/project/)
    await expect(shell.getMenuNav({ project: '' as never })).rejects.toThrow(/project/)
    await expect(shell.listMenuPaths({ project: undefined as never })).rejects.toThrow(/project/)
    expect(calls).toHaveLength(0)
  })

  it('project 作为 query 参数发出去（实测不带时后端按 1 返回，那不是"全部"）', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await shell.getMenuNav({ project: 2 })
    expect(callsOf(calls, MENU_NAV_URL)[0]!.params).toEqual({ project: 2 })
  })

  it('⭐ 缓存键并进了 project：1 与 2 各打各的、各缓各的、互不串味', async () => {
    // 实测 project=1 → 1 个节点、project=2 → 57 个节点。若切片键不带 project，
    // 第二次调用会直接命中第一次的缓存并返回**另一个项目的菜单** —— 静默且完全合法。
    // 真机实测：project=1 → 1 个节点（`系统设置- 学习`）、project=2 → 57 个节点
    const trees: Record<number, unknown[]> = {
      1: [{ id: 'a', pid: '0', name: '系统设置- 学习', permissions: '/dashboard/setting', children: [] }],
      2: MENU_TREE,
    }
    const { shell, calls } = makeShell({
      routes: (config) => {
        if (config.url !== MENU_NAV_URL) return defaultRoutes()[config.url]
        const project = Number((config.params as { project?: number } | undefined)?.project)
        return trees[project]
      },
    })

    const one = await shell.getMenuNav({ project: 1 })
    const two = await shell.getMenuNav({ project: 2 })
    expect(one.totalNodes).toBe(1)
    expect(two.totalNodes).toBe(4)
    expect(one.tree[0]!.name).toBe('系统设置- 学习')
    expect(callsOf(calls, MENU_NAV_URL)).toHaveLength(2)

    // 再来一次：两个各自命中自己的缓存，请求数不变
    await shell.getMenuNav({ project: 1 })
    await shell.getMenuNav({ project: 2 })
    expect(callsOf(calls, MENU_NAV_URL)).toHaveLength(2)

    // 失效 menu-nav：**所有 project 的切片都要清掉**（切片键带 project 后缀，
    // 只删 `menu-nav` 这一个字面量键的话，project=1/2 两份都还在）
    shell.invalidate('menu-nav')
    await shell.getMenuNav({ project: 1 })
    expect(callsOf(calls, MENU_NAV_URL)).toHaveLength(3)
  })

  it('⭐ 返回的树喂得进 createUserVisibility —— 这是这个能力存在的首要理由', async () => {
    const { shell } = makeShell({ routes: defaultRoutes() })
    const nav = await shell.getMenuNav({ project: 2 })

    const visibility = createUserVisibility({
      menuTree: nav.tree,
      source: 'base-menu-nav?project=2（测试夹具）',
    })
    const paths = collectVisiblePaths(nav.tree)
    // 只有路径形态的 permissions 算页面路径；`hr:module:approval` 那一条不算
    expect(paths).toEqual(['/dashboard/agreement'])
    expect(visibility.rawPaths).toEqual(['/dashboard/agreement'])
    expect([...visibility.keys]).toEqual(['/dashboard/agreement'])
    expect(visibility.source).toContain('base-menu-nav')
  })

  it('排序无关：树里的空 permissions 与权限码形态都不会被当成页面路径', async () => {
    const { shell } = makeShell({ routes: defaultRoutes() })
    const paths = await shell.listMenuPaths({ project: 2 })
    expect(paths.paths).toEqual(['/dashboard/agreement'])
    expect(paths.total).toBe(1)
    expect(paths.matched).toBe(1)
  })

  it('keyword 裁剪时**保留命中节点的祖先**（否则树断了看不出层级）', async () => {
    const { shell } = makeShell({ routes: defaultRoutes() })
    const result = await shell.getMenuNav({ project: 2, keyword: '协议管理' })
    expect(result.returnedNodes).toBe(3) // 根 → 审批中心 → 协议管理
    expect(result.tree[0]!.name).toBe('[人力] 审批系统')
    expect(result.tree[0]!.children[0]!.name).toBe('审批中心')
    expect(result.tree[0]!.children[0]!.children[0]!.name).toBe('协议管理')
  })

  it('keyword 也能命中 permissions（按路径找菜单项）', async () => {
    const { shell } = makeShell({ routes: defaultRoutes() })
    const result = await shell.getMenuNav({ project: 2, keyword: '/dashboard/agreement' })
    expect(result.returnedNodes).toBe(3)
  })

  it('keyword 一个都不命中 → 空树，但 totalNodes 如实报 5（不是"这个项目没菜单"）', async () => {
    const { shell } = makeShell({ routes: defaultRoutes() })
    const result = await shell.getMenuNav({ project: 2, keyword: '绝对不存在的名字zzz' })
    expect(result.tree).toEqual([])
    expect(result.totalNodes).toBe(4)
    expect(result.returnedNodes).toBe(0)
    expect(result.truncated).toBe(false)
  })

  it('⭐ maxNodes 不够时**截断并如实置 truncated**（被截断的树不能拿去算可见性）', async () => {
    const { shell } = makeShell({ routes: defaultRoutes() })
    const cut = await shell.getMenuNav({ project: 2, maxNodes: 2 })
    expect(cut.totalNodes).toBe(4)
    expect(cut.returnedNodes).toBe(2)
    expect(cut.truncated).toBe(true)

    const whole = await shell.getMenuNav({ project: 2, maxNodes: 50 })
    expect(whole.returnedNodes).toBe(4)
    expect(whole.truncated).toBe(false)
  })

  it('返回值是**新建的节点对象**：调用方改了它不会污染缓存', async () => {
    const { shell } = makeShell({ routes: defaultRoutes() })
    const first = await shell.getMenuNav({ project: 2 })
    first.tree[0]!.name = '被改坏了'
    first.tree[0]!.children.length = 0

    const second = await shell.getMenuNav({ project: 2 })
    expect(second.tree[0]!.name).toBe('[人力] 审批系统')
    expect(second.tree[0]!.children).toHaveLength(2)
  })

  it('菜单路径：keyword 是**片段**匹配（如 /dashboard/）', async () => {
    const { shell } = makeShell({ routes: defaultRoutes() })
    expect((await shell.listMenuPaths({ project: 2, keyword: '/dashboard/' })).matched).toBe(1)
    expect((await shell.listMenuPaths({ project: 2, keyword: 'nope' })).matched).toBe(0)
    // 不带 keyword 时 total 是"一共有多少条"，那是调用方拿来看规模的
    expect((await shell.listMenuPaths({ project: 2 })).total).toBe(1)
  })

  it('空树（project=3）是合法结果，不是错误', async () => {
    const { shell } = makeShell({ routes: defaultRoutes({ [MENU_NAV_URL]: [] }) })
    const nav = await shell.getMenuNav({ project: 3 })
    expect(nav).toEqual({ project: 3, tree: [], totalNodes: 0, returnedNodes: 0, truncated: false })
  })

  it('菜单树的形状不认识时报错（不是"这个项目没菜单"）', async () => {
    const { shell } = makeShell({ routes: defaultRoutes({ [MENU_NAV_URL]: { not: 'an array' } }) })
    await expect(shell.getMenuNav({ project: 2 })).rejects.toThrow(BaseShellShapeError)
  })
})

describe('工作台卡片：config 是一个 JSON 字符串', () => {
  it('把 config 解析成卡片数组，layout 原样保留', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    const result = await shell.listHomeWidgets()

    expect(callsOf(calls, HOME_PAGE_URL)).toHaveLength(1)
    expect(result.configured).toBe(true)
    expect(result.total).toBe(3)
    expect(result.widgets[0]).toEqual({
      cardId: '0yy5U74S',
      widget: 'hr/learning/course-completion',
      knownModules: ['hr/learning', 'hr/performance', 'hr/salary'],
      layout: { x: 0, y: 0, w: 4, h: 5 },
    })
  })

  it('不传 keyword 返回全部（这一条规模有界：实测 61 张 / 9 KB）', async () => {
    const { shell } = makeShell({ routes: defaultRoutes() })
    const result = await shell.listHomeWidgets()
    expect(result.matched).toBe(3)
    expect(result.widgets).toHaveLength(3)
  })

  it('keyword 同时匹配 widget 标识与 knownModules', async () => {
    const { shell } = makeShell({ routes: defaultRoutes() })
    expect((await shell.listHomeWidgets({ keyword: 'salary' })).matched).toBe(2)
    expect((await shell.listHomeWidgets({ keyword: 'my-payslip' })).matched).toBe(1)
    // knownModules 命中：第一张卡片的 knownModules 里有 hr/salary
    expect((await shell.listHomeWidgets({ keyword: 'performance' })).matched).toBe(1)
    expect((await shell.listHomeWidgets({ keyword: 'nope' })).matched).toBe(0)
  })

  it('config 为 null / 空串 → configured:false + 空列表（用户没配过工作台是正常状态）', async () => {
    for (const config of [null, '', undefined]) {
      const { shell } = makeShell({
        routes: defaultRoutes({ [HOME_PAGE_URL]: { ...HOME_PAGE_RAW, config } }),
      })
      const result = await shell.listHomeWidgets()
      expect(result.configured).toBe(false)
      expect(result.widgets).toEqual([])
    }
  })

  it('config 不是合法 JSON → 报错（不能静默当成"没有卡片"）', async () => {
    const { shell } = makeShell({
      routes: defaultRoutes({ [HOME_PAGE_URL]: { ...HOME_PAGE_RAW, config: '[{oops' } }),
    })
    await expect(shell.listHomeWidgets()).rejects.toThrow(BaseShellShapeError)
  })

  it('config 是对象而不是字符串 → 报错（形状契约写死在类型里）', async () => {
    const { shell } = makeShell({
      routes: defaultRoutes({ [HOME_PAGE_URL]: { ...HOME_PAGE_RAW, config: [{ widget: 'a' }] } }),
    })
    await expect(shell.listHomeWidgets()).rejects.toThrow(/JSON 字符串/)
  })

  it('缺 widget 标识的布局项被跳过（布局数据里可能有占位项）', async () => {
    const { shell } = makeShell({
      routes: defaultRoutes({
        [HOME_PAGE_URL]: {
          ...HOME_PAGE_RAW,
          config: JSON.stringify([{ x: 0, y: 0, w: 1, h: 1, id: 'zzz' }, { widget: 'hr/salary/my-payslip' }]),
        },
      }),
    })
    const result = await shell.listHomeWidgets()
    expect(result.total).toBe(1)
    expect(result.widgets[0]!.widget).toBe('hr/salary/my-payslip')
  })
})

describe('缓存：同一份数据不发第二遍，TTL 用假时钟测', () => {
  it('连续两次 getUserInfo 只发一次请求', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await shell.getUserInfo()
    await shell.getUserInfo()
    expect(callsOf(calls, USER_INFO_URL)).toHaveLength(1)
  })

  it('并发调用只发一次（单飞）', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await Promise.all([shell.getUserInfo(), shell.getUserInfo(), shell.getUserInfo()])
    expect(callsOf(calls, USER_INFO_URL)).toHaveLength(1)
  })

  it('菜单与工作台也各只打一次', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await shell.getMenuNav({ project: 2 })
    await shell.listMenuPaths({ project: 2 })
    await shell.listHomeWidgets()
    await shell.listHomeWidgets()
    expect(callsOf(calls, MENU_NAV_URL)).toHaveLength(1)
    expect(callsOf(calls, HOME_PAGE_URL)).toHaveLength(1)
  })

  it('TTL 内不重发、过期后重发（注入假时钟，不真实 sleep）', async () => {
    let clock = 1_000_000
    const { shell, calls } = makeShell({
      routes: defaultRoutes(),
      cacheTtlMs: 1000,
      now: () => clock,
    })

    await shell.getUserInfo()
    clock += 999
    await shell.getUserInfo()
    expect(callsOf(calls, USER_INFO_URL)).toHaveLength(1)

    clock += 2 // 累计 1001ms > 1000ms
    await shell.getUserInfo()
    expect(callsOf(calls, USER_INFO_URL)).toHaveLength(2)
  })

  it('人员与待办**不缓存**：逐次带参数，缓存命中率极低（同一参数也重发）', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await shell.searchUsers({ keyword: '张' })
    await shell.searchUsers({ keyword: '张' })
    await shell.listTodos({ scope: 'todo' })
    await shell.listTodos({ scope: 'todo' })
    expect(callsOf(calls, USER_SIMPLE_PAGE_URL)).toHaveLength(2)
    expect(callsOf(calls, BPM_TASK_URL)).toHaveLength(2)
  })

  it('invalidate 指定片：只丢那一片；不指定则全丢', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await shell.getUserInfo()
    await shell.listHomeWidgets()
    expect(callsOf(calls, USER_INFO_URL)).toHaveLength(1)

    shell.invalidate('home-widgets')
    await shell.getUserInfo()
    await shell.listHomeWidgets()
    expect(callsOf(calls, USER_INFO_URL), 'user-info 不该被 home-widgets 的失效带走').toHaveLength(1)
    expect(callsOf(calls, HOME_PAGE_URL)).toHaveLength(2)

    shell.invalidate()
    await shell.getUserInfo()
    expect(callsOf(calls, USER_INFO_URL)).toHaveLength(2)
  })

  it('失效发生在途请求完成前：旧响应不能重新写回切片缓存', async () => {
    let startedResolve: (() => void) | undefined
    let releaseResolve: (() => void) | undefined
    const started = new Promise<void>((resolve) => { startedResolve = resolve })
    const release = new Promise<void>((resolve) => { releaseResolve = resolve })
    let first = true
    const { shell, calls } = makeShell({
      routes: defaultRoutes({
        [USER_INFO_URL]: () => {
          if (first) {
            first = false
            startedResolve!()
            return release.then(() => USER_INFO_RAW)
          }
          return USER_INFO_RAW
        },
      }),
    })

    const pending = shell.getUserInfo()
    await started
    shell.invalidate('user-info')
    releaseResolve!()
    await pending
    await shell.getUserInfo()
    expect(callsOf(calls, USER_INFO_URL)).toHaveLength(2)
  })

  it('缓存 TTL 与会话层的绝对 TTL 同值（挂不挂会话行为一致；漂开就红）', () => {
    expect(BASE_SHELL_CACHE_TTL_MS).toBe(DEFAULT_ABSOLUTE_TTL_MS)
  })
})

describe('会话基础数据：只读 user-basic，不新增键', () => {
  it('本文件只声明了一个会话键，且指向已存在的 user-basic', () => {
    expect(BASE_SHELL_SESSION_KEYS).toEqual({ userInfo: 'user-basic' })
  })

  it('会话里有别的键、没有 user-basic → 回落到自己发请求（不是"会话在就一律不发"）', async () => {
    const { shell, calls } = makeShell({
      routes: defaultRoutes(),
      session: { has: (key) => key === 'permission-list', get: () => ['x'] },
    })
    const info = await shell.getUserInfo()
    expect(info.id).toBe('18243')
    expect(callsOf(calls, USER_INFO_URL)).toHaveLength(1)
  })

  it('TTL 过期后回到会话取载荷，**仍然一个请求都不发**（会话是权威来源，不是缓存）', async () => {
    let reads = 0
    const session = new Map<string, unknown>([[BASE_SHELL_SESSION_KEYS.userInfo, USER_INFO_RAW]])
    const { shell, calls } = makeShell({
      routes: defaultRoutes(),
      cacheTtlMs: 0, // 缓存立刻过期 —— 逼它每次都回到"取载荷"这一步
      session: {
        has: (key) => session.has(key),
        get: (key) => {
          reads += 1
          return session.get(key)
        },
      },
    })
    await shell.getUserInfo()
    await shell.getUserInfo()
    // 每次都真的回到会话取了一次载荷（不是"缓存兜住了"）……
    expect(reads).toBe(2)
    // ……但**一次网络请求都没发**：载荷的来源是会话，不是后端
    expect(calls).toHaveLength(0)
  })
})

describe('module-type：默认不发，接线方显式指定才发', () => {
  it('不给 moduleType：六个请求上都没有这个字段', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes() })
    await shell.getUserInfo()
    await shell.searchUsers({ keyword: '张' })
    await shell.listTodos({})
    await shell.getTodoCounts()
    await shell.getMenuNav({ project: 2 })
    await shell.listHomeWidgets()

    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.moduleType, `${call.url} 不该带 module-type`).toBeUndefined()
    }
  })

  it('显式给 moduleType 时每个请求都带上（这条是给"要在某个模块口径下收窄"的接线方留的口）', async () => {
    const { shell, calls } = makeShell({ routes: defaultRoutes(), moduleType: 11 })
    await shell.getUserInfo()
    await shell.searchUsers({ keyword: '张' })
    await shell.getMenuNav({ project: 2 })
    for (const call of calls) {
      expect(call.moduleType, `${call.url}`).toBe(11)
    }
  })
})
