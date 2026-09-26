/**
 * 浏览器抽样基准的**装置**（`tools/sample/analyze.mjs`）。
 *
 * 这份测试守的不是"装置能跑"，是**装置判得准**：给它一份已知形状的抓取，
 * 它必须把「形状错」和「描述错」分开，并且**两者的判据都当场可反证**——
 * 同一个 fixture 改一个字段（路径 / 参数集合 / 顺序 / 控件 / cookie），
 * 分类必须跟着变。没有这一半，`可以直接接` 这个结论就是恒真的。
 *
 * 用合成 fixture 而不是真实抓取的原因：真实抓取会随 Portal 发版变化，
 * 而这里要固定的是**判据**，不是某一次抓取的结果。夹具用的 pagePath 都真实存在于
 * `tools/sample/endpoints.json`，因此走的是装置的真实代码路径，没有测试专用分支。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(HERE, '..')
const ANALYZE = join(PKG_ROOT, 'tools/sample/analyze.mjs')

const BACKEND = 'https://biz-api-test.wodecorp.cn'

type FormItem = {
  name: string
  control: string
  label?: string
  showSearch?: boolean
}
type Capture = {
  url: string
  headers?: Record<string, string>
  arrayLen?: number
  total?: number
}

type PageFixture = {
  pagePath: string
  列表请求: string
  列表头?: Record<string, string>
  /** 列表请求之外、这一页自己发的请求（候选来源），带候选条数 */
  候选请求?: Capture[]
  控件: FormItem[]
  menuPathCookie?: string | null
}

/** 把 fixture 折成 `run-sample.mjs` 输出的形状（装置消费的就是这个形状）。 */
const captureOf = (fixture: PageFixture) => {
  const cap = [
    { via: 'xhr', method: 'GET', url: fixture.列表请求, headers: fixture.列表头 ?? {}, body: null },
    ...(fixture.候选请求 ?? []).map((c) => ({ via: 'xhr', method: 'GET', url: c.url, headers: {}, body: null })),
  ]
  const res = (fixture.候选请求 ?? []).map((c) => ({ url: c.url, status: 200, len: 1000, arrayLen: c.arrayLen ?? null, total: c.total ?? null }))
  return {
    pagePath: fixture.pagePath,
    plan: { layers: [] },
    mount: { phase: 'mount', cap, res },
    query: { phase: 'query', cap, res },
    dom: {
      // 真实的 DOM 探针记的是**当前文档的 URL**，装置靠它防"reload 失败导致串页"（这里照抄真实形状）
      url: `https://webtest01.wodecorp.cn/portal.html#${fixture.pagePath}`,
      menuPathCookie: fixture.menuPathCookie === undefined ? fixture.pagePath : fixture.menuPathCookie,
      formItems: fixture.控件,
      selects: [],
      buttons: ['查 询'],
    },
  }
}

const runAnalyze = (fixtures: PageFixture[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'ph-sample-device-'))
  const results = join(dir, 'results.json')
  const out = join(dir, 'verdicts.json')
  writeFileSync(results, JSON.stringify({ 结果: fixtures.map(captureOf) }, null, 2))
  execFileSync('node', [ANALYZE, '--results', results, '--out', out], { cwd: PKG_ROOT, encoding: 'utf8' })
  const report = JSON.parse(readFileSync(out, 'utf8')) as { 逐页: AnalyzedPage[] }
  return report.逐页[0]!
}

type AnalyzedPage = {
  分类: string
  形状: Record<string, boolean>
  比对: Record<string, unknown> & { 筛选区与契约完全不重合?: boolean }
  发现: Array<{ 类型: string; 严重度: string; 参数?: string; 说明: string }>
  moduleType: Record<string, unknown>
}

const findingsOf = (page: { 发现: Array<{ 类型: string }> }) => page.发现.map((f) => f.类型)

/**
 * 「没有控件」的三分类是**回源核对代码**得出的，所以这三条用例依赖 Portal 源码可读。
 * 读不到时必须**响**（而不是静默跳过），但消息要说明是环境问题不是装置坏了——
 * 仓库里其它生成器测试（batch-capabilities.test.ts）有同样的依赖。
 */
const PORTAL_VIEWS = join(process.env.PORTAL_REPO || '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js', 'app/portal/views/dashboard')
const expectSourceAvailable = () =>
  expect(existsSync(PORTAL_VIEWS), `读不到 Portal 源码（${PORTAL_VIEWS}）：这一条依赖源码区分"页面定义/条件渲染/探针盲区"，不是装置坏了`).toBe(true)

// ---------------------------------------------------------------------------
// 会议室列表：契约 order/orderField/name/authorizedOrgId/pageNo/pageSize
// 一份"全对"的抓取，用来证明装置**能够**给出 `可以直接接`（否则后面所有红都是假的）
// ---------------------------------------------------------------------------
const meetingRoomClean = (): PageFixture => ({
  pagePath: '/dashboard/meeting-room/list',
  列表请求: `${BACKEND}/admin-api/hr/meeting-room/page?order=&orderField=&name=&pageNo=1&pageSize=20&_t=1789911631325`,
  控件: [
    { name: 'name', control: 'text', label: '会议室名称' },
    // 契约 kind 是 undefined（初值 null）——自由文本是相容的形态
    { name: 'authorizedOrgId', control: 'text', label: '授权组织' },
  ],
})

describe('抽样基准装置：请求形状（错了就是发错请求）', () => {
  it('形状与描述全对时，装置给出 `可以直接接`', () => {
    const page = runAnalyze([meetingRoomClean()])
    expect(page.分类).toBe('可以直接接')
    expect(page.发现).toHaveLength(0)
    expect(page.形状).toEqual({ 路径: true, 参数集合: true, 顺序: true })
  })

  it('浏览器多发一个契约里没有的参数 → `不能接`（契约漏参）', () => {
    // 这一条就是 isArchived 那一类错误的形状版：SDK 按契约拼不出这个参数
    const fixture = meetingRoomClean()
    fixture.列表请求 = fixture.列表请求.replace('&pageNo=1', '&auditFlag=1&pageNo=1')
    const page = runAnalyze([fixture])
    expect(page.分类).toBe('不能接')
    expect(findingsOf(page)).toContain('契约漏参')
  })

  it('列表请求的路径与契约不符 → `不能接`（路径不符）', () => {
    const fixture = meetingRoomClean()
    fixture.列表请求 = fixture.列表请求.replace('/hr/meeting-room/page', '/hr/meeting-room/list')
    const page = runAnalyze([fixture])
    expect(page.分类).toBe('不能接')
    expect(findingsOf(page)).toContain('路径不符')
  })

  it('初值是字面量的参数没发 → `不能接`（应发未发）', () => {
    const fixture = meetingRoomClean()
    fixture.列表请求 = fixture.列表请求.replace('name=&', '')
    const page = runAnalyze([fixture])
    expect(page.分类).toBe('不能接')
    expect(findingsOf(page)).toContain('应发未发')
    expect(page.形状.参数集合).toBe(false)
  })

  it('参数顺序不是契约顺序的子序列 → `不能接`（顺序不符）', () => {
    const fixture = meetingRoomClean()
    fixture.列表请求 = `${BACKEND}/admin-api/hr/meeting-room/page?order=&orderField=&pageNo=1&pageSize=20&name=&_t=1`
    const page = runAnalyze([fixture])
    expect(page.分类).toBe('不能接')
    expect(findingsOf(page)).toContain('参数顺序不符')
    expect(page.形状.顺序).toBe(false)
  })

  it('子序列不算错：null 初值的参数本来就不发（qs skipNulls），缺它不影响顺序判定', () => {
    // authorizedOrgId 初值是 null，浏览器不发它——这是**正确行为**，不能被判成顺序错
    const page = runAnalyze([meetingRoomClean()])
    expect(page.形状.顺序).toBe(true)
  })
})

describe('抽样基准装置：防"静默串页"', () => {
  it('抓取时文档停在别的页 → 判作废，而不是拿着别页的数据下结论', () => {
    // reload 没生效时钩子会返回 already，window.__phCap 里留着**上一页**的请求。
    // 那种抓取看起来"有数据"，实际属于别的页面——必须当场作废。
    const fixture = meetingRoomClean()
    const capture = captureOf(fixture)
    capture.dom.url = 'https://webtest01.wodecorp.cn/portal.html#/dashboard/attendance/attendance-archive-sheet/list'
    const dir = mkdtempSync(join(tmpdir(), 'ph-sample-device-'))
    const results = join(dir, 'results.json')
    const out = join(dir, 'verdicts.json')
    writeFileSync(results, JSON.stringify({ 结果: [capture] }))
    execFileSync('node', [ANALYZE, '--results', results, '--out', out], { cwd: PKG_ROOT, encoding: 'utf8' })
    const page = (JSON.parse(readFileSync(out, 'utf8')) as { 逐页: Array<{ 分类: string; 发现: Array<{ 类型: string }> }> }).逐页[0]!
    expect(page.分类).toBe('不能接')
    expect(page.发现.map((f) => f.类型)).toContain('抓取串页')
  })
})

describe('抽样基准装置：契约描述（错了是 AI 传错值）', () => {
  it('DOM 里没有控件、源码里也没绑控件 → 判成 page-definition（页面定义混进了筛选条件）', () => {
    // 考勤档案：isArchived 在源码里只出现在 form 初值（`isArchived: 1`），没有任何 formState 绑定。
    // 这一条同时是「源码核对」那一步的回归——不核对就会把探针盲区也说成页面定义。
    expectSourceAvailable()
    const page = runAnalyze([{
      pagePath: '/dashboard/attendance/attendance-archive-sheet/list',
      列表请求: `${BACKEND}/admin-api/org/hrAttendanceSheet/page?order=&orderField=&isArchived=1&pageNo=1&pageSize=20&_t=1`,
      控件: [
        { name: 'yearMonth', control: 'picker', label: '月份' },
        { name: 'departmentId', control: 'select', label: '部门', showSearch: true },
        { name: 'organizationId', control: 'select', label: '班组', showSearch: true },
      ],
    }])
    expect(page.分类).toBe('需要人补')
    expect(findingsOf(page)).toContain('契约里有、页面上没有控件（page-definition）')
    const finding = page.发现.find((f) => f.类型.includes('page-definition'))!
    expect(finding.参数).toBe('isArchived')
    expect(finding.说明).toContain('页面自己定义的常量')
  })

  it('只有赋值/条件判断、没有控件绑定 → 也是 page-definition（别把页面状态说成"探针没抓到"）', () => {
    // 图片列表页的 targetType / disabled：切 tab 时程序写进去（`formState.disabled = '0'`），
    // 或只用来做 v-if 判断，**没有任何 v-model/:prop 绑定**——页面上没有这个控件。
    // 数 `formState.<name>` 出现次数会把它误判成"控件在页面上"，那是**漏报**：
    // `disabled=1` 会把列表切到回收站，正是 isArchived 那一类最危险的情况。
    expectSourceAvailable()
    const page = runAnalyze([{
      pagePath: '/dashboard/platform/control-panel/image-list/list',
      列表请求: `${BACKEND}/mall-manage-api/sys/imageImage/page?order=&orderField=&imageName=&url=&targetType=&disabled=0&pageNo=1&pageSize=20&_t=1`,
      控件: [
        { name: 'imageName', control: 'text', label: '图片名称' },
        { name: 'url', control: 'text', label: '图片地址' },
      ],
    }])
    const types = findingsOf(page)
    expect(types.filter((t) => t.includes('page-definition')).length).toBe(2)
    expect(types).not.toContain('契约里有、页面上没有控件（probe-blindspot）')
    expect(page.发现.find((f) => f.参数 === 'disabled')!.说明).toContain('没有一次是控件绑定')
  })

  it('页面筛选区与契约参数**完全不重合** → `不能接`（不是"漏一个参数"）', () => {
    // 鸡只申请页的真实形状：页面渲染 userName/phone/product/startTime/endTime，
    // 而表单初值与列表请求是 username/gender/deptId——两套不相干的字段名。
    // 这时契约既表达不了页面、页面也验证不了契约，接线没有意义。
    expectSourceAvailable()
    const page = runAnalyze([{
      pagePath: '/dashboard/platform/chicken/apply/list',
      列表请求: `${BACKEND}/mall-manage-api/sys/platapplymanage/page?order=&orderField=&username=&gender=&deptId=&pageNo=1&pageSize=20&_t=1`,
      控件: [
        { name: 'userName', control: 'text', label: '申请人姓名' },
        { name: 'phone', control: 'text', label: '申请人电话' },
        { name: 'product', control: 'select', label: '申请产品' },
        { name: 'startTime', control: 'picker', label: '申请开始时间' },
        { name: 'endTime', control: 'picker', label: '申请结束时间' },
      ],
    }])
    expect(page.比对.筛选区与契约完全不重合).toBe(true)
    expect(page.分类).toBe('不能接')
    expect(findingsOf(page)).toContain('页面筛选与契约参数完全不重合')
  })

  it('只是"漏了一两个参数"不算不能接：契约与页面仍有重合时降为需要人补', () => {
    // meeting-room 契约里的 name 有控件；额外加一个契约里没有的控件，应判需要人补而不是不能接
    const fixture = meetingRoomClean()
    fixture.控件 = [...fixture.控件, { name: 'extraFilter', control: 'text', label: '多出来的' }]
    const page = runAnalyze([fixture])
    expect(page.比对.筛选区与契约完全不重合).toBe(false)
    expect(page.分类).toBe('需要人补')
    expect(findingsOf(page)).toContain('契约漏参（页面有控件、契约没有）')
  })

  it('DOM 里没有控件、但源码里绑了控件且没有 v-if → 判成 probe-blindspot，**不**说成页面定义', () => {
    expectSourceAvailable()
    // 成绩页的真实形状：studentNumMin/Max 是包在 a-space 里的 a-input-number，
    // antdv 没给它注入 form_item_* id，所以探针看不见——但它在页面上真实存在。
    // 这一条是"宁可少而真"的那一半：探针的盲区不能被报成页面的缺陷。
    const page = runAnalyze([{
      pagePath: '/dashboard/grade/grade/list',
      列表请求: `${BACKEND}/admin-api/study/grade/studygrade/page?order=&orderField=&name=&type=&studentNumMin=&studentNumMax=&teacherName=&teachingAssistantName=&orgId=&pageNo=1&pageSize=20&_t=1`,
      控件: [
        { name: 'name', control: 'text' },
        { name: 'type', control: 'text' },
        { name: 'teacherName', control: 'text' },
        { name: 'teachingAssistantName', control: 'text' },
        { name: 'orgId', control: 'text' },
      ],
    }])
    expect(findingsOf(page)).toContain('契约里有、页面上没有控件（probe-blindspot）')
    const finding = page.发现.find((f) => f.类型.includes('probe-blindspot'))!
    expect(finding.参数).toMatch(/studentNum(Max|Min)/)
    expect(finding.说明).toContain('探针')
    expect(findingsOf(page)).not.toContain('契约里有、页面上没有控件（page-definition）')
  })

  it('DOM 里没有控件、源码里带 v-if → 判成 conditional（按账号渲染）', () => {
    expectSourceAvailable()
    // 会计期间页：tenantName 的表单项带 v-if="userStore.state.username === 'admin'"
    const page = runAnalyze([{
      pagePath: '/dashboard/finance/setting/accounting-period/list',
      列表请求: `${BACKEND}/admin-api/finance/accounting-period/page?order=&orderField=&year=&pageNo=1&pageSize=20&_t=1`,
      控件: [
        { name: 'year', control: 'picker', label: '年度' },
        { name: 'status', control: 'radio-group', label: '状态' },
      ],
    }])
    expect(findingsOf(page)).toContain('契约里有、页面上没有控件（conditional）')
    expect(page.发现.find((f) => f.类型.includes('conditional'))!.参数).toBe('tenantName')
  })

  it('日期控件的 kind 被判成文本类 → `需要人补`，类型是「kind 判错（日期）」', () => {
    expectSourceAvailable()
    const page = runAnalyze([{
      pagePath: '/dashboard/attendance/attendance-archive-sheet/list',
      列表请求: `${BACKEND}/admin-api/org/hrAttendanceSheet/page?order=&orderField=&isArchived=1&pageNo=1&pageSize=20&_t=1`,
      控件: [
        { name: 'isArchived', control: 'text' },
        { name: 'yearMonth', control: 'picker', label: '月份' },
        { name: 'departmentId', control: 'text' },
        { name: 'organizationId', control: 'text' },
      ],
    }])
    expect(page.分类).toBe('需要人补')
    expect(findingsOf(page)).toContain('kind 判错（日期）')
    expect(page.发现.find((f) => f.类型 === 'kind 判错（日期）')!.参数).toBe('yearMonth')
  })

  it('下拉控件的 kind 没有任何"这是选项/有多少候选"的信息 → `需要人补`', () => {
    const fixture = meetingRoomClean()
    fixture.控件 = [
      { name: 'name', control: 'text', label: '会议室名称' },
      { name: 'authorizedOrgId', control: 'select', label: '授权组织', showSearch: true },
    ]
    const page = runAnalyze([fixture])
    expect(page.分类).toBe('需要人补')
    expect(findingsOf(page)).toContain('kind 判错（选择型）')
  })

  it('长选项报的是**最大**的那条候选来源，不是打分最高的第一条', () => {
    // 同一页两个下拉共用同一个取数接口的两个 type：17 条与 922 条。
    // 这里断言 922 被报出来——按"第一名"取会报成 17，那是本轮真出现过的 bug。
    expectSourceAvailable()
    const page = runAnalyze([{
      pagePath: '/dashboard/attendance/attendance-archive-sheet/list',
      列表请求: `${BACKEND}/admin-api/org/hrAttendanceSheet/page?order=&orderField=&isArchived=1&pageNo=1&pageSize=20&_t=1`,
      控件: [
        { name: 'yearMonth', control: 'picker', label: '月份' },
        { name: 'departmentId', control: 'select', label: '部门', showSearch: true },
        { name: 'organizationId', control: 'select', label: '班组', showSearch: true },
      ],
      候选请求: [
        { url: `${BACKEND}/admin-api/org/organization/getAllOrganizationByType?type=1&_t=1`, arrayLen: 17 },
        { url: `${BACKEND}/admin-api/org/organization/getAllOrganizationByType?type=2&_t=1`, arrayLen: 922 },
      ],
    }])
    const long = page.发现.find((f) => f.类型 === '长选项未标注')
    expect(long, '922 条候选必须被报成"长选项未标注"').toBeDefined()
    expect(long!.说明).toContain('922')
  })
})

describe('抽样基准装置：module-type 一律以规则表为准', () => {
  it('cookie 指向别的路由时，浏览器抓到的 module-type 标记为不可采信', () => {
    const fixture = meetingRoomClean()
    fixture.menuPathCookie = '/dashboard/platform/member/customer/list' // 别的标签页写进去的
    const page = runAnalyze([fixture])
    expect(page.moduleType['浏览器值是否可采信']).toBe(false)
    expect(String(page.moduleType['说明'])).toContain('指向别的路由')
  })

  it('cookie 指向本页、但浏览器没发规则表算得出的 module-type → 报出来', () => {
    // 考勤档案：规则表算得出 11，这里让浏览器一个头都不发
    expectSourceAvailable()
    const page = runAnalyze([{
      pagePath: '/dashboard/attendance/attendance-archive-sheet/list',
      列表请求: `${BACKEND}/admin-api/org/hrAttendanceSheet/page?order=&orderField=&isArchived=1&pageNo=1&pageSize=20&_t=1`,
      控件: [
        { name: 'yearMonth', control: 'text' },
        { name: 'departmentId', control: 'text' },
        { name: 'organizationId', control: 'text' },
      ],
    }])
    expect(page.moduleType['规则表']).toBe(11)
    expect(page.moduleType['浏览器实际发送']).toBeNull()
    expect(page.moduleType['浏览器值是否可采信']).toBe(true)
    expect(findingsOf(page)).toContain('module-type 浏览器值与规则表不符')
  })

  it('规则表算不出的页面，浏览器也不发头，两者一致', () => {
    const page = runAnalyze([meetingRoomClean()])
    expect(page.moduleType['规则表']).toBeNull()
    expect(page.moduleType['浏览器实际发送']).toBeNull()
    expect(findingsOf(page)).not.toContain('module-type 浏览器值与规则表不符')
  })
})
