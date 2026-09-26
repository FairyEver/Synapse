import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPortalHeadless } from '../src/index.js'
import {
  AMOUNT_MAX,
  AREA_TREE_API,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_OSS_FOLDER,
  CREATE_API,
  DETAIL_API,
  FEE_ITEM_API,
  FEE_ITEM_OPTIONS,
  FEE_ITEM_SOURCE_KEY,
  FORM_DICT_TYPES,
  FUND_SOURCE_OPTIONS,
  ORG_TREE_API,
  PAYEE_TYPE_OPTIONS,
  PLATFORM_DICT_API,
  PREVIEW_API,
  PROJECT_EXPENSE_OPTIONS,
  PROJECT_OPTIONS_API,
  REASONS_MAX,
  TRAVELER_SEARCH_API,
  TRAVELER_STATUS_LIST,
  TRAVEL_EXPENSE_FORM_PATH,
  TRAVEL_EXPENSE_MY_LIST_PATH,
  TRAVEL_EXPENSE_PAGE_PATH,
  TRAVEL_EXPENSE_PROCESS_KEY,
  TRIP_MODE_OPTIONS,
  assertAttachments,
  assertTravelDraft,
  buildPayeeSubmitFields,
  buildProcessVariables,
  buildTravelPayload,
  calculateAmount,
  createTravelExpenseCapability,
  entryBudgetAmount,
  entryTravelTotal,
  hasBudgetOverrun,
  projectSummaryFields,
  travelExpenseCapabilities,
  type TravelExpenseDraft,
} from '../src/capabilities/travel-expense-application.js'

/**
 * 差旅费支出申请表（`internal_transportation_expense_request_form` / `/simple/finance/form/003`）
 * —— 流程表单这一类里**形态最复杂**的一条（有明细行数组）。
 *
 * 四条来源，逐条钉住：
 *   1. `baseline/travel-expense-application.browser.json`：测试环境真实抓下来的响应
 *      （流程定义 / 组织树 / 费用项目 / 地区树 / 字典 / 审批链预览）
 *   2. Portal 前端源码 `app/portal/views/simple/finance/form/003/**` 的 `onFinish()` 与 `formRules`
 *   3. 后端源码 `BpmSpendingApplyTravelServiceImpl` 与两个 SaveReqVO
 *   4. 同族两条已完成能力的契约形状（通用审批 / 请假），用于对齐"哪些是共有的"
 *
 * 写链路（submit / cancel）的**真实往返记录**在 `docs/pages/差旅费报销.md` 的
 * 「真实验证记录」一节；这里只管契约、逐字段一致与本地拦截。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const baseline = JSON.parse(
  readFileSync(join(HERE, '..', 'baseline', 'travel-expense-application.browser.json'), 'utf8'),
) as {
  来源: string
  流程定义: Record<string, unknown>
  费用项目候选: Array<{ label: string; value: number }>
  出行方式字典: Array<{ label: string; value: number }>
  资金来源字典: Array<{ label: string; value: number }>
  项目候选: Array<Record<string, unknown>>
  组织树样本: {
    顶层: number
    全树节点数: number
    可选节点数: number
    样本: Array<Record<string, unknown>>
    可选样本: Array<{ id: string; name: string; depth: number; selectable: boolean }>
  }
  博创系组织: {
    路径含博创的节点数: number
    其中可选的: number
    可选样本: Array<{ id: string; name: string; fullPath: string }>
  }
  地区树样本: { 顶层: number; 样本: Array<{ id: string; name: string }> }
  审批链预览: Record<string, Array<{ node: string; id: number; nickname: string }>>
  我: { id: string; realName: string; organizationName: string }
}

// ---------------------------------------------------------------------------
// 假后端
// ---------------------------------------------------------------------------

/** `/sys/user/info` 的响应（带两个**真实存在、不该被投影出去**的敏感字段） */
const USER_INFO = {
  id: '18243',
  username: '2021070101',
  realName: '姚淼鑫',
  organizationName: '设计中心1236',
  organizationFullPathName: '沃德辰龙-沃德博创-沃德博创-系统研发-设计中心1236',
  password2: '$2a$10$X3s2CIV.fqSlm2mQTqxnler4EqFDbsOcOV/0vwmK7RqTAXrLiY0VO',
  salt: '$2a$10$X3s2CIV.fqSlm2mQTqxnle',
  mobile: '15011141909',
}

/** 一条组织树（**形状抄自实测**：id 是字符串、`financeCostCenter` 决定能不能选） */
const ORG_TREE = [
  {
    id: '34',
    name: '沃德辰龙',
    financeCostCenter: 0,
    children: [
      { id: '37', name: '沃德博创', financeCostCenter: 0, children: [] },
      { id: '1558', name: '销售内勤', financeCostCenter: 1, children: [] },
    ],
  },
]

/** 一条地区树（实测前两层：北京市 / 北京市 / …；id 是**字符串**） */
const AREA_TREE = [
  {
    id: '110000',
    name: '北京市',
    children: [
      { id: '110100', name: '北京市', children: [{ id: '110101', name: '东城区', children: [] }] },
    ],
  },
]

/** 审批链预览响应（**形状抄自实测**） */
const PREVIEW_OK = {
  state: 'CONFIRMED',
  nodes: [
    { nodeId: 'Event_1', name: null, type: 'START_EVENT', candidateUsers: [] },
    {
      nodeId: 'Activity_0hpwjd9',
      name: '部门负责人',
      type: 'USER_TASK',
      candidateStrategy: 60,
      candidateStrategyName: '流程表达式',
      candidateUsers: [{ id: 15037, nickname: '胡春然' }],
      approvalMode: 'SINGLE',
    },
    {
      nodeId: 'Activity_14di1n7',
      name: '财务副部长',
      type: 'USER_TASK',
      candidateStrategy: 60,
      candidateUsers: [{ id: 17406, nickname: '于树华' }],
      approvalMode: 'SINGLE',
    },
    { nodeId: 'Event_2', name: null, type: 'END_EVENT', candidateUsers: [] },
  ],
  copyUsers: [],
}

type Responder = (path: string, config: InternalAxiosRequestConfig) => unknown

function captureSdk (responder: Responder, options?: { maxScanPages?: number; scanPageSize?: number }) {
  const calls: InternalAxiosRequestConfig[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config)
    const path = pathOf(config)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: responder(path, config) },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const capability = createTravelExpenseCapability(
    (requestConfig) => sdk.call(TRAVEL_EXPENSE_FORM_PATH, requestConfig),
    options,
  )
  return { sdk, calls, capability }
}

/** 本流程真正的默认假后端。⚠️ 键是**去掉 `/admin-api` 之后**的路径（`pathOf` 会归一） */
function fakeBackend (overrides: Record<string, unknown> = {}): Responder {
  return (path: string): unknown => {
    if (path in overrides) return overrides[path]
    switch (path) {
      case '/sys/user/info':
        return USER_INFO
      case '/finance/payment-slip-person/fee-item-options':
        return baseline.费用项目候选
      case '/org/organization/getTree':
        return ORG_TREE
      case '/finance/area/tree':
        return AREA_TREE
      case '/finance/project/get':
        return { id: 1, principalStaffId: 890, principalName: '负责人', status: 1 }
      case '/finance/project/options':
        return baseline.项目候选
      case '/system/dict-data/grouped-list':
        return [
          { dictType: 'trip_mode', dataList: baseline.出行方式字典.map((o) => ({ label: o.label, value: String(o.value) })) },
          { dictType: 'finance_project_fund_source', dataList: baseline.资金来源字典.map((o) => ({ label: o.label, value: String(o.value) })) },
        ]
      case '/bpm/process-instance/preview':
        return PREVIEW_OK
      case '/finance/bpm-spending-apply-travel/create':
        return 21666
      case '/finance/bpm-spending-apply-travel/get':
        return { id: 21666, processInstanceId: 'pi-abc-123', reasons: 'SDK-TEST-差旅' }
      case '/sys/user/getUserBasicInfoPage':
        return { list: [{ id: '14626', realName: '胡明伟', username: '2023040108' }], total: 1 }
      case '/bpm/process-instance/my-page':
        return { list: [], total: 0 }
      default:
        return {}
    }
  }
}

/**
 * 请求路径归一：`portal-http` 会给所有路径补 `/admin-api`（只有 `platform.js` 这个实例这么做），
 * 而常量是按**页面源码里写的完整路径**定义的（有的带前缀、有的不带）。
 * `pathOf` 一律**去掉** `/admin-api`，断言时用 `route()` 把常量也去掉，两边就对齐了。
 */
function pathOf (config: InternalAxiosRequestConfig | undefined): string {
  const url = String(config?.url ?? '').split('?')[0]!
  return url.replace(/^.*\/admin-api/, '')
}

/** 把常量也归一成 `pathOf` 那种形式，用来比对 */
function route (constant: string): string {
  return constant.replace(/^\/admin-api/, '')
}

function rawBodyOf (config: InternalAxiosRequestConfig | undefined): string {
  const raw = config?.data
  return typeof raw === 'string' ? raw : JSON.stringify(raw)
}

function bodyOf (config: InternalAxiosRequestConfig | undefined): Record<string, unknown> {
  return JSON.parse(rawBodyOf(config)) as Record<string, unknown>
}

function queryOf (config: InternalAxiosRequestConfig | undefined): Record<string, string> {
  const query = String(config?.url ?? '').split('?')[1] ?? ''
  if (query === '') return {}
  return Object.fromEntries(
    query.split('&').map((part) => {
      const index = part.indexOf('=')
      const key = index === -1 ? part : part.slice(0, index)
      const value = index === -1 ? '' : decodeURIComponent(part.slice(index + 1))
      return [key, value]
    }),
  )
}

function pathsOf (calls: InternalAxiosRequestConfig[]): string[] {
  return calls.map((c) => pathOf(c))
}

// ---------------------------------------------------------------------------
// 一份"页面填得出来"的草稿
// ---------------------------------------------------------------------------

/**
 * 明细行的键**按页面 `handleThingAdd()` 的声明顺序**写（不是随便排的）：
 * `buildTravelPayload()` 是 `{...entry, …}`，所以**行的键顺序跟着调用方走** ——
 * 与页面一致（页面的行对象也带着它自己的构造顺序）。
 * 下面那条「键顺序」测试就是拿这份顺序去比的。
 */
const draft: TravelExpenseDraft = {
  orgId: '1558',
  projectExpense: false,
  travelerIds: [14626],
  reasons: 'SDK-TEST-差旅费支出申请（契约测试用，不会提交）',
  feePurpose: 'SDK-TEST-费用用途',
  paymentDate: '2026-10-15',
  feeItem: 1,
  travelEntryList: [
    {
      startEndDate: ['2026-10-01', '2026-10-03'],
      trafficAmount: 100.5,
      foodAmount: 20,
      housingAmount: 30,
      otherAmount: 0,
      inputTaxAmount: 5,
      travelTotalAmount: 0,
      budgetDetailId: '',
      budgetDetailNo: '',
      budgetAvailableAmount: null,
      startRegion: ['110000', '110100', '110101'],
      startAddress: '北京市东城区某路 1 号',
      endRegion: ['110000', '110100', '110101'],
      endAddress: '北京市东城区某路 2 号',
      tripMode: 2,
      fundSource: null,
    },
  ],
  remark: 'SDK-TEST-其他说明',
  attachments: [],
  payeeInfo: {},
}

// ---------------------------------------------------------------------------
// 一、前置核对：key / 名称 / 页面路径（**实测**，不是从调查文档抄的）
// ---------------------------------------------------------------------------

describe('差旅费支出申请表 —— 前置核对（key 与名称以实测为准）', () => {
  it('★ 流程 key 在测试环境里确实叫「差旅费支出申请表」——不是硬凑的相近流程', () => {
    expect(baseline.流程定义.key).toBe(TRAVEL_EXPENSE_PROCESS_KEY)
    expect(baseline.流程定义.name).toBe('差旅费支出申请表')
    expect(baseline.流程定义.category).toBe('finance_process')
  })

  it('★ `formFields` 恒为 null，`startUserSelectTasks` 恒为 [] —— 字段只能读源码、审批人不能选', () => {
    expect(baseline.流程定义.formFields).toBeNull()
    expect(baseline.流程定义.formConf).toBeNull()
    expect(baseline.流程定义.startUserSelectTasks).toEqual([])
  })

  it('capability id 前缀与常量', () => {
    expect(TRAVEL_EXPENSE_PAGE_PATH).toBe('/dashboard/flow/form/edit')
    expect(TRAVEL_EXPENSE_FORM_PATH).toBe('/simple/finance/form/003')
    expect(TRAVEL_EXPENSE_MY_LIST_PATH).toBe('/dashboard/flow/task/my/list')
    expect(TRAVEL_EXPENSE_PROCESS_KEY).toBe('internal_transportation_expense_request_form')
  })
})

// ---------------------------------------------------------------------------
// 二、能力清单与参数契约
// ---------------------------------------------------------------------------

describe('差旅费支出申请表 —— 能力与参数契约', () => {
  const byId = new Map(travelExpenseCapabilities.map((c) => [c.id, c]))

  it('十四个能力都在，pagePath / write 都对', () => {
    expect([...byId.keys()].sort()).toEqual([
      'travel-expense-area-options',
      'travel-expense-cancel',
      'travel-expense-definition',
      'travel-expense-detail',
      'travel-expense-dict-options',
      'travel-expense-fee-items',
      'travel-expense-my-instances',
      'travel-expense-org-options',
      'travel-expense-payee-options',
      'travel-expense-prepare',
      'travel-expense-project-principal',
      'travel-expense-projects',
      'travel-expense-submit',
      'travel-expense-travelers',
    ])
    // 只有两条是写
    const writes = travelExpenseCapabilities.filter((c) => c.write).map((c) => c.id).sort()
    expect(writes).toEqual(['travel-expense-cancel', 'travel-expense-submit'])
    // 表单页上下文 vs 「我的流程」页上下文
    expect(byId.get('travel-expense-submit')!.pagePath).toBe(TRAVEL_EXPENSE_FORM_PATH)
    expect(byId.get('travel-expense-cancel')!.pagePath).toBe(TRAVEL_EXPENSE_MY_LIST_PATH)
    expect(byId.get('travel-expense-definition')!.pagePath).toBe(TRAVEL_EXPENSE_PAGE_PATH)
  })

  it('★ prepare 与 submit 的参数**完全一样**（页面就是同一个 buildSubmitPayload）', () => {
    const prep = byId.get('travel-expense-prepare')!.params.map((p) => p.name)
    const sub = byId.get('travel-expense-submit')!.params.map((p) => p.name)
    expect(sub).toEqual(prep)
  })

  it('★ submit 的参数里**没有** startUserSelectAssignees —— 本流程没有自选审批人节点', () => {
    const names = byId.get('travel-expense-submit')!.params.map((p) => p.name)
    expect(names).not.toContain('startUserSelectAssignees')
  })

  it('14 类页面控件都在参数里（缺一个就是"没做完"）', () => {
    const names = byId.get('travel-expense-submit')!.params.map((p) => p.name)
    for (const required of [
      'orgId', // 组织选择
      'relatedRevenueSubjectId', // 费用关联的商品类型
      'projectExpense', // 是否为项目费用
      'financeProjectId', // 项目名称
      'travelerIds', // 出差人
      'reasons', // 出差事由
      'paymentDate', // 预计付款日期
      'feeItem', // 费用选择
      'feePurpose', // 费用用途
      'travelEntryList', // 明细行数组
      'remark', // 其他说明
      'attachments', // 附件
      'payeeInfo', // 收款方信息
    ]) {
      expect(names).toContain(required)
    }
    // 「金额总计」是只读的、前端算的 ⇒ **不接受调用方传**（与页面一致）
    expect(names).not.toContain('amount')
    // 「出差人」的 traveler 是 travelerIds[0] 的镜像 ⇒ 没有独立参数
    expect(names).not.toContain('traveler')
  })

  it('必填的那几个与页面 formRules 一一对应', () => {
    const required = byId.get('travel-expense-submit')!.params.filter((p) => p.required).map((p) => p.name).sort()
    // 页面 formRules：orgId / travelerIds / feePurpose / reasons / amount / paymentDate / projectExpense
    // （amount 是算的、不是参数）⇒ 参数里必填的是这六个
    expect(required).toEqual(['feePurpose', 'orgId', 'paymentDate', 'projectExpense', 'reasons', 'travelEntryList', 'travelerIds'])
  })

  it('「出差人」是 search 类型且必填 —— 长选项参数必须先要关键字（D6 / H35）', () => {
    const p = byId.get('travel-expense-travelers')!.params.find((x) => x.name === 'keyword')!
    expect(p.kind).toBe('search')
    expect(p.required).toBe(true)
  })

  it('「收款方候选」也是 search 且必填 —— 页面是全量 500 条前端过滤，SDK 刻意加关键字', () => {
    const p = byId.get('travel-expense-payee-options')!.params.find((x) => x.name === 'keyword')!
    expect(p.kind).toBe('search')
    expect(p.required).toBe(true)
  })

  it('项目候选**不**强制关键字（页面发的就是空串，实测只有 7 条）', () => {
    const p = byId.get('travel-expense-projects')!.params.find((x) => x.name === 'keyword')!
    expect(p.required).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 二·补：契约缺陷的**正面锁** —— 参数名必须唯一
//
// 根因：`travel-expense-dict-options` 第一版用 5 次 `dictParam(...)` 拼参数，
// 而那个 helper 把每个 `ParamSpec.name` 都写成 `'dictType'` ⇒ OpenAPI 里这条操作有
// **5 个同名参数**，redocly 的 `operation-parameters-unique` 规则报 4 个错。
//
// 那不只是规格洁癖：调用方/AI 看到 5 个都叫 `dictType` 的参数，**不知道该传哪一个**；
// 而实现那边的签名一直是 `dictOptions(dictType: string)` —— 一个字符串就够。
//
// 下面两条是**正面锁**（锁住"改对了"），不是"锁住错误状态"：
// 第一条是**全能力**的通扫（这一类缺陷不该只在这一条上被防住），
// 第二条钉住收敛后的形状与"信息没丢"。反证见 docs/pages/差旅费报销.md §九。
// ---------------------------------------------------------------------------

describe('差旅费支出申请表 —— 参数契约：每条能力的参数名必须唯一', () => {
  it('★ 全能力通扫：没有任何一条操作有**同名参数**（redocly operation-parameters-unique）', () => {
    const offenders = travelExpenseCapabilities
      .map((c) => {
        const names = c.params.map((p) => p.name)
        const dup = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))]
        return dup.length ? `${c.id}: ${dup.join(', ')}` : null
      })
      .filter((x): x is string => x !== null)
    expect(offenders).toEqual([])
  })

  it('★ `travel-expense-dict-options` 收敛成**恰好 1 个**参数，名字是 `dictType`', () => {
    const params = travelExpenseCapabilities.find((c) => c.id === 'travel-expense-dict-options')!.params
    expect(params).toHaveLength(1)
    expect(params[0]!.name).toBe('dictType')
    expect(params[0]!.kind).toBe('enum')
    // 不给时要有默认（实现那边 `dictOptions(dictType = 'trip_mode')`）
    expect(params[0]!.required).toBe(false)
  })

  it('★ 收敛**没有丢信息**：5 个字典名都还在，且每个都写清了用途', () => {
    const param = travelExpenseCapabilities.find((c) => c.id === 'travel-expense-dict-options')!.params[0]!
    expect(param.options!.map((o) => o.value)).toEqual([
      'trip_mode',
      'finance_project_fund_source',
      'finance_project_type',
      'finance_project_attribute',
      'payee_type',
    ])
    // 每个字典名都在 description 里出现过（"传哪个名字就返回哪个字典"这句话得落地）
    for (const dictType of ['trip_mode', 'finance_project_fund_source', 'finance_project_type', 'finance_project_attribute', 'payee_type']) {
      expect(param.description, `${dictType} 在参数描述里不见了 —— 收敛时丢信息了`).toContain(dictType)
    }
    // 原来分散在 5 个参数描述里的"它是哪一格 / 谁在用"也还在
    for (const keyword of ['出行方式', '资金来源', '项目类型', '项目属性', '收款方类型']) {
      expect(param.description).toContain(keyword)
    }
    // 反面：不能是 5 个同名参数（那正是被拦下的那个形状）
    expect(travelExpenseCapabilities.find((c) => c.id === 'travel-expense-dict-options')!.params.map((p) => p.name)).not.toEqual([
      'dictType', 'dictType', 'dictType', 'dictType', 'dictType',
    ])
  })

  it('`FORM_DICT_TYPES` 与能力参数里的枚举值同源（不会各写一份然后漂移）', () => {
    const param = travelExpenseCapabilities.find((c) => c.id === 'travel-expense-dict-options')!.params[0]!
    expect(param.options!.map((o) => o.value)).toEqual(FORM_DICT_TYPES.map((d) => d.value))
    // 每一格都记了"页面上的哪一格"和"离线兜底表"，两个都没丢
    for (const d of FORM_DICT_TYPES) {
      expect(String(d.control).length).toBeGreaterThan(0)
      expect(Array.isArray(d.fallback)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 三、载荷逐字段一致（D20）
// ---------------------------------------------------------------------------

describe('差旅费支出申请表 —— 提交载荷逐字段复刻 onFinish()', () => {
  const payload = buildTravelPayload(draft)

  it('★ 顶层键的**顺序**与页面 onFinish() 拼出来的一致（D20：顺序也算）', () => {
    expect(Object.keys(payload)).toEqual([
      'orgId',
      'projectExpense',
      'financeProjectId',
      'financeProjectName',
      'financeProjectCode',
      'financeProjectType',
      'financeProjectAttribute',
      'financeProjectCompanyName',
      'traveler',
      'travelerIds',
      'feeItem',
      'feePurpose',
      'reasons',
      'amount',
      'paymentDate',
      'remark',
      'travelEntryList',
      'attachmentList',
      'relatedRevenueSubjectId',
      'relatedRevenueSubjectName',
      // ↓ `...buildPayeeSubmitFields(payeeInfo)` 追加在**最后**
      'payeeType',
      'companySubType',
      'isInternalStaff',
      'receivingCompanyId',
      'receivingCompanyName',
      'receivingCorporationId',
      'receivingCorporationName',
      'payeeId',
      'payeeCode',
      'payeeStaffId',
      'payeeStaffNo',
      'payeeName',
      'receivingBankName',
      'receivingBankDictValue',
      'receivingAccount',
    ])
  })

  it('★ `payeeInfo` 与 `budgetAllocations` 两个键**被 delete 掉了**（源码里那两行）', () => {
    expect(payload).not.toHaveProperty('payeeInfo')
    expect(payload).not.toHaveProperty('budgetAllocations')
  })

  it('★ `traveler` 是 `travelerIds[0]` 的镜像，且 `travelerIds` 原样是数组', () => {
    expect(payload.traveler).toBe(14626)
    expect(payload.travelerIds).toEqual([14626])
    expect(payload.orgId).toBe('1558')
  })

  it('★ 多人时 `traveler` 取的是**第一个**，不是最后一个（页面 `travelerIds[0]`）（反证补的）', () => {
    // ⚠️ 这条是反证脚本逼出来的：原来的草稿只有一个人，`[0]` 与 `[length-1]` 是同一个数，
    //    于是「把 traveler 改成取最后一个」这个变异**不会红** —— 一条恒真的测试。
    const many = buildTravelPayload({ ...draft, travelerIds: [14626, 20001, 30002] })
    expect(many.traveler).toBe(14626)
    expect(many.traveler).not.toBe(30002)
    expect(many.travelerIds).toEqual([14626, 20001, 30002])
  })

  it('出差的 `travelerIds` 会**去重**（后端把它们 join 成一列存）', () => {
    const dup = buildTravelPayload({ ...draft, travelerIds: [14626, 14626, 20001] })
    expect(dup.travelerIds).toEqual([14626, 20001])
  })

  it('★ 金额总计 = Σ(行内的 交通+餐食+住宿+其他+进项税)，**不接受调用方给**', () => {
    // 100.5 + 20 + 30 + 0 + 5 = 155.5
    expect(payload.amount).toBe(155.5)
    expect(entryTravelTotal(draft.travelEntryList[0]!)).toBe(150.5) // 不含进项税
    expect(entryBudgetAmount(draft.travelEntryList[0]!)).toBe(155.5) // 含进项税
  })

  it('`feeItem` 不给时自动填 1（页面的 ensureFeeItemValid：只有一个候选就自动选中）', () => {
    expect(buildTravelPayload({ ...draft, feeItem: undefined }).feeItem).toBe(1)
    expect(FEE_ITEM_OPTIONS[0]!.value).toBe(1)
  })

  it('★ 非项目费用时载荷里**没有** `fundSource` 这个键（三元给的是 undefined）', () => {
    const entry = (payload.travelEntryList as Array<Record<string, unknown>>)[0]!
    expect(Object.keys(entry)).toContain('fundSource') // 对象上还在（值是 undefined）
    expect(JSON.parse(rawOf(payload)).travelEntryList[0]).not.toHaveProperty('fundSource') // 序列化后没了
  })

  it('★ 项目费用时 `fundSource` 在，且行内必填（页面 fundSourceRules）', () => {
    const withFund = {
      ...draft,
      projectExpense: true,
      financeProjectId: 1,
      travelEntryList: [{ ...draft.travelEntryList[0]!, fundSource: 1 }],
    }
    const p = buildTravelPayload(withFund, baseline.项目候选[0] as never)
    const entry = (p.travelEntryList as Array<Record<string, unknown>>)[0]!
    expect(entry.fundSource).toBe(1)
    expect(() =>
      buildTravelPayload(
        { ...withFund, travelEntryList: [{ ...draft.travelEntryList[0]!, fundSource: null }] },
        baseline.项目候选[0] as never,
      ),
    ).toThrow(/资金来源/)
  })

  it('★ 不传项目时**没有** `financeProjectCompanyId` 这个键（页面从没选过项目就是这样）', () => {
    expect(Object.keys(payload)).not.toContain('financeProjectCompanyId')
  })

  it('★ 传了项目时 6 个快照字段都在（`Object.assign(formState, getProjectSummaryFields())` 会新增 CompanyId）', () => {
    const project = baseline.项目候选.find((p) => String(p.id) === '1')!
    const p = buildTravelPayload({ ...draft, projectExpense: false, financeProjectId: 1 }, project as never)
    expect(Object.keys(p)).toContain('financeProjectCompanyId')
    expect(p.financeProjectName).toBe(project.projectName)
    expect(p.financeProjectCode).toBe(project.projectCode)
    expect(p.financeProjectType).toBe(project.projectType)
    expect(p.financeProjectAttribute).toBe(project.projectAttribute)
    expect(p.financeProjectCompanyName).toBe(project.companyName)
  })

  it('projectSummaryFields 的六个键与页面 getProjectSummaryFields() 一致', () => {
    expect(Object.keys(projectSummaryFields({ id: 1 }))).toEqual([
      'financeProjectName',
      'financeProjectCode',
      'financeProjectType',
      'financeProjectAttribute',
      'financeProjectCompanyId',
      'financeProjectCompanyName',
    ])
  })
})

/** 序列化成 JSON —— 用来验证 `undefined` 键真的消失（`rawBodyOf` 的字符串版本） */
function rawOf (value: unknown): string {
  return JSON.stringify(value)
}

// ---------------------------------------------------------------------------
// 四、明细行数组：本流程与另外两条线最大的形态差别
// ---------------------------------------------------------------------------

describe('差旅费支出申请表 —— 明细行数组（第三档复杂度）', () => {
  const payload = buildTravelPayload(draft)
  const entry = (payload.travelEntryList as Array<Record<string, unknown>>)[0]!

  it('★ 一个区间控件拆成 `startDate` / `endDate` 两个标量', () => {
    expect(entry.startDate).toBe('2026-10-01')
    expect(entry.endDate).toBe('2026-10-03')
  })

  it('★ 三级地区数组按**位置**展开成 省 / 市 / 区 三个标量', () => {
    expect(entry.startProvince).toBe('110000')
    expect(entry.startCity).toBe('110100')
    expect(entry.startDistrict).toBe('110101')
    expect(entry.endProvince).toBe('110000')
    expect(entry.endCity).toBe('110100')
    expect(entry.endDistrict).toBe('110101')
  })

  it('★ 三个数组**原样留在载荷里**（`...item` 带过来的，后端会忽略但页面确实发了）', () => {
    expect(entry.startEndDate).toEqual(['2026-10-01', '2026-10-03'])
    expect(entry.startRegion).toEqual(['110000', '110100', '110101'])
    expect(entry.endRegion).toEqual(['110000', '110100', '110101'])
  })

  it('★ `travelTotalAmount` = 交通+餐食+住宿+其他（**不含**进项税），后端的同一算法', () => {
    expect(entry.travelTotalAmount).toBe(150.5)
  })

  it('`inputTaxAmount` 走 `Number(x) || 0` 归一（空串 / null ⇒ 0）', () => {
    const p = buildTravelPayload({
      ...draft,
      travelEntryList: [{ ...draft.travelEntryList[0]!, inputTaxAmount: '' }],
    })
    expect((p.travelEntryList as Array<Record<string, unknown>>)[0]!.inputTaxAmount).toBe(0)
  })

  it('多行：金额总计把每一行都算进去', () => {
    const second = { ...draft.travelEntryList[0]!, trafficAmount: 10, foodAmount: 0, housingAmount: 0, otherAmount: 0, inputTaxAmount: 0 }
    const amount = calculateAmount([draft.travelEntryList[0]!, second])
    expect(amount).toBe(165.5) // 第一行 155.5 + 第二行 10
  })

  it('★ 浮点尾数被 toFixed(2) 收掉 —— **本 SDK 唯一一处刻意偏离页面**的地方', () => {
    const a = { ...draft.travelEntryList[0]!, trafficAmount: 0.1, foodAmount: 0.2, housingAmount: 0, otherAmount: 0, inputTaxAmount: 0 }
    // 页面会发出 0.30000000000000004；SDK 发 0.3
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(calculateAmount([a])).toBe(0.3)
  })

  it('行的键顺序：`...entry` 在前，改写出来的标量追加在后', () => {
    const keys = Object.keys(entry)
    expect(keys.indexOf('startEndDate')).toBeLessThan(keys.indexOf('startDate'))
    expect(keys[keys.length - 1]).toBe('endDistrict') // 只有改写出来的标量是**追加**的
    expect(keys).toContain('fundSource') // fundSource 在 entry 里本来就有 ⇒ 位置不动
  })
})

// ---------------------------------------------------------------------------
// 五、本地拦截（写操作会惊动真人 ⇒ 能让它红在发请求之前就红在前面）
// ---------------------------------------------------------------------------

describe('差旅费支出申请表 —— 本地校验（全部在发请求之前）', () => {
  const ok = (patch: Partial<TravelExpenseDraft> = {}): TravelExpenseDraft => ({ ...draft, ...patch })
  const okEntry = (patch: Record<string, unknown>) =>
    ok({ travelEntryList: [{ ...draft.travelEntryList[0]!, ...patch } as never] })

  it('orgId 必填（页面 formRules.orgId）', () => {
    expect(() => assertTravelDraft(ok({ orgId: '' }))).toThrow(/orgId/)
  })

  it('travelerIds 必填且不能是空数组（页面 formRules.travelerIds）', () => {
    expect(() => assertTravelDraft(ok({ travelerIds: [] }))).toThrow(/travelerIds/)
    expect(() => assertTravelDraft(ok({ travelerIds: null as never }))).toThrow(/travelerIds/)
  })

  it(`reasons 必填、≤${REASONS_MAX}（页面 formRules.reasons 的 required + max）`, () => {
    expect(() => assertTravelDraft(ok({ reasons: '   ' }))).toThrow(/reasons/)
    expect(() => assertTravelDraft(ok({ reasons: 'x'.repeat(REASONS_MAX + 1) }))).toThrow(/最多 500/)
    expect(() => assertTravelDraft(ok({ reasons: 'x'.repeat(REASONS_MAX) }))).not.toThrow()
  })

  it('feePurpose 必填、≤500', () => {
    expect(() => assertTravelDraft(ok({ feePurpose: '' }))).toThrow(/feePurpose/)
    expect(() => assertTravelDraft(ok({ feePurpose: 'x'.repeat(501) }))).toThrow(/最多 500/)
  })

  it('paymentDate 必须是真实的 YYYY-MM-DD（2026-02-31 过不了）', () => {
    expect(() => assertTravelDraft(ok({ paymentDate: '2026/10/15' }))).toThrow(/YYYY-MM-DD/)
    expect(() => assertTravelDraft(ok({ paymentDate: '2026-02-31' }))).toThrow(/真实存在/)
  })

  it('明细行至少一行（删到 0 行时页面「金额总计」为 0，validateAmount 会报「请输入金额」）', () => {
    expect(() => assertTravelDraft(ok({ travelEntryList: [] }))).toThrow(/至少要有一行/)
  })

  it('金额总计必须 > 0（页面 validateAmount 的 `if (value <= 0)`）', () => {
    expect(() => assertTravelDraft(okEntry({ trafficAmount: 0, foodAmount: 0, housingAmount: 0, otherAmount: 0, inputTaxAmount: 0 }))).toThrow(
      /金额总计必须大于 0/,
    )
  })

  it('★ 地区必须**恰好 3 段**（页面只查非空，少于 3 段时后端会收到 undefined 的区）', () => {
    expect(() => assertTravelDraft(okEntry({ startRegion: ['110000'] }))).toThrow(/恰好 3 段/)
    expect(() => assertTravelDraft(okEntry({ endRegion: ['110000', '110100'] }))).toThrow(/恰好 3 段/)
    expect(() => assertTravelDraft(okEntry({ startRegion: ['110000', '110100', '110101', 'x'] }))).toThrow(/恰好 3 段/)
  })

  it('出发/到达的详细地址都必填（页面 validateRequiredAddress 里那两条）', () => {
    expect(() => assertTravelDraft(okEntry({ startAddress: '' }))).toThrow(/startAddress/)
    expect(() => assertTravelDraft(okEntry({ endAddress: '  ' }))).toThrow(/endAddress/)
  })

  it('区间两个端点都要合法，且开始不能晚于结束（a-range-picker 本身不允许）', () => {
    expect(() => assertTravelDraft(okEntry({ startEndDate: ['2026-10-03'] }))).toThrow(/startEndDate/)
    expect(() => assertTravelDraft(okEntry({ startEndDate: ['2026-10-05', '2026-10-01'] }))).toThrow(/晚于结束日期/)
  })

  it(`单格金额的边界是 0 ~ ${AMOUNT_MAX}（页面 :min=0 :max=1000000000）`, () => {
    expect(() => assertTravelDraft(okEntry({ trafficAmount: -1 }))).toThrow(/0 ~ 1000000000/)
    expect(() => assertTravelDraft(okEntry({ trafficAmount: AMOUNT_MAX + 1 }))).toThrow(/0 ~ 1000000000/)
  })

  it('tripMode 必须是数字（字典 trip_mode），但它**不是必填**', () => {
    expect(() => assertTravelDraft(okEntry({ tripMode: 'abc' }))).toThrow(/tripMode/)
    expect(() => assertTravelDraft(okEntry({ tripMode: null }))).not.toThrow()
  })

  it(`projectExpense = true 时 financeProjectId 必填（页面 validator + 后端 FINANCE_PROJECT_REQUIRED）`, () => {
    expect(() => assertTravelDraft(ok({ projectExpense: true, financeProjectId: null }))).toThrow(/financeProjectId/)
  })

  it('projectExpense 必须是布尔（页面是两个选项 false / true）', () => {
    expect(() => assertTravelDraft(ok({ projectExpense: 1 as never }))).toThrow(/布尔/)
  })

  it('★ 预算超额时拒（页面的提交按钮直接 :disabled）', () => {
    const bad = okEntry({ budgetDetailId: 9, budgetAvailableAmount: 100 })
    expect(hasBudgetOverrun(bad.travelEntryList)).toBe(true)
    expect(() => assertTravelDraft(bad)).toThrow(/预算可用金额/)
    // 没选预算的行不参与这条判据
    const good = okEntry({ budgetDetailId: '', budgetAvailableAmount: 0 })
    expect(hasBudgetOverrun(good.travelEntryList)).toBe(false)
    expect(() => assertTravelDraft(good)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 六、附件（与请假 / 通用审批**不一样**：本表单没有 accept 白名单）
// ---------------------------------------------------------------------------

describe('差旅费支出申请表 —— 附件', () => {
  it('最多 10 件（页面 :max="10"）', () => {
    const many = Array.from({ length: ATTACHMENT_MAX_COUNT + 1 }, (_, i) => ({ url: `https://oss/${i}.pdf`, name: `${i}.pdf` }))
    expect(() => assertAttachments(many)).toThrow(/最多 10 件/)
  })

  it('★ **没有扩展名白名单** —— 请假拒收的 .docx 在这里是收的（两个表单的 accept 不同）', () => {
    expect(() => assertAttachments([{ url: 'https://oss/a.docx', name: 'a.docx' }])).not.toThrow()
    expect(() => assertAttachments([{ url: 'https://oss/a.zip', name: 'a.zip' }])).not.toThrow()
  })

  it('缺 url 就拒（url 要先用 base-upload-file 传到 OSS）', () => {
    expect(() => assertAttachments([{ name: 'a.pdf' }])).toThrow(/缺 url/)
  })

  it('`{url, name}` 之外的键（size / pages / type）原样透传 —— 后端 OssResourceDTO 收它们', () => {
    const out = assertAttachments([{ url: 'https://oss/a.pdf', name: 'a.pdf', size: 12, pages: 3, type: 'application/pdf' }])
    expect(out[0]).toEqual({ url: 'https://oss/a.pdf', name: 'a.pdf', size: 12, pages: 3, type: 'application/pdf' })
  })

  it('不给附件时是空数组（页面 attachmentList 没有必填规则）', () => {
    expect(assertAttachments(undefined)).toEqual([])
  })

  it('OSS 目录常量与 common/utils/oss.js 的 finance.expense 一致', () => {
    expect(ATTACHMENT_OSS_FOLDER).toBe('Finance/expense')
  })
})

// ---------------------------------------------------------------------------
// 七、收款方子表单（页面**从不校验**它 —— 所以它是可选的）
// ---------------------------------------------------------------------------

describe('差旅费支出申请表 —— 收款方字段', () => {
  it('★ 不传 payeeInfo 时 15 个键**全在**，值分别是 null / 空串（与页面空着提交一致）', () => {
    const fields = buildPayeeSubmitFields(undefined)
    expect(Object.keys(fields)).toEqual([
      'payeeType',
      'companySubType',
      'isInternalStaff',
      'receivingCompanyId',
      'receivingCompanyName',
      'receivingCorporationId',
      'receivingCorporationName',
      'payeeId',
      'payeeCode',
      'payeeStaffId',
      'payeeStaffNo',
      'payeeName',
      'receivingBankName',
      'receivingBankDictValue',
      'receivingAccount',
    ])
    expect(fields.payeeId).toBe('') // ⚠️ 唯一一个空串（源码 `?? ''`）
    expect(fields.payeeCode).toBe('')
    expect(fields.payeeType).toBeNull()
    expect(fields.companySubType).toBeNull()
    expect(fields.isInternalStaff).toBeNull()
    expect(fields.receivingAccount).toBeNull()
  })

  it('★ 不传 payeeInfo 时 **没有** `payeeSourceType` 这个键（只有外部收款方且非空才加）', () => {
    expect(buildPayeeSubmitFields({})).not.toHaveProperty('payeeSourceType')
    expect(buildPayeeSubmitFields(undefined)).not.toHaveProperty('payeeSourceType')
  })

  it('内部员工分支：payeeType=1 + isInternalStaff=true（**布尔**，不是 1）', () => {
    const f = buildPayeeSubmitFields({ payeeType: 1, isInternalStaff: true, payeeStaffId: 14626 })
    expect(f.isInternalStaff).toBe(true)
    expect(f.payeeStaffId).toBe(14626)
    expect(f).not.toHaveProperty('payeeSourceType')
  })

  it('★ `isInternalStaff` 用 `=== false` 判定外部人员 —— 传 0 不算', () => {
    // 传入 0（假值但不是 false）时，`isExternalPersonPayee` 不成立 ⇒ 不加 payeeSourceType
    const zero = buildPayeeSubmitFields({ payeeType: 1, isInternalStaff: 0 as never, payeeSourceType: 'FINANCE_PARTY' })
    expect(zero).not.toHaveProperty('payeeSourceType')
    const real = buildPayeeSubmitFields({ payeeType: 1, isInternalStaff: false, payeeSourceType: 'FINANCE_PARTY', payeeName: '张三' })
    expect(real).toHaveProperty('payeeSourceType', 'FINANCE_PARTY')
  })

  it('★ 内部分公司（新单）时 `receivingCompanyId` 与 `receivingCompanyName` **强制 null**', () => {
    const f = buildPayeeSubmitFields({
      payeeType: 2,
      companySubType: 1,
      receivingCorporationId: 218,
      receivingCorporationName: '石家庄公司',
      // 故意同时给上组织 id 与名字，验证互斥
      receivingCompanyId: 999,
      receivingCompanyName: '不该出现',
    })
    expect(f.receivingCorporationId).toBe(218)
    expect(f.receivingCorporationName).toBe('石家庄公司')
    expect(f.receivingCompanyId).toBeNull()
    expect(f.receivingCompanyName).toBeNull()
  })

  it('内部分公司（历史单，只有组织 id）时才传 receivingCompanyId', () => {
    const f = buildPayeeSubmitFields({ payeeType: 2, companySubType: 1, receivingCompanyId: 34, receivingCompanyName: '沃德辰龙' })
    expect(f.receivingCompanyId).toBe(34)
    expect(f.receivingCorporationId).toBeNull()
    expect(f.receivingCompanyName).toBe('沃德辰龙')
  })

  it('外部公司分支：receivingCompanyName 有值，且带主数据标识时加 payeeSourceType', () => {
    const f = buildPayeeSubmitFields({
      payeeType: 2,
      companySubType: 2,
      receivingCompanyName: '京粮（天津）粮油工业有限公司',
      payeeId: 22,
      payeeSourceType: 'SUPPLIER',
    })
    expect(f.receivingCompanyName).toBe('京粮（天津）粮油工业有限公司')
    expect(f.receivingCorporationId).toBeNull()
    expect(f.payeeSourceType).toBe('SUPPLIER')
  })

  it('★ 整份载荷里的收款字段与单独调 buildPayeeSubmitFields 完全一致（没有被覆盖）', () => {
    const p = buildTravelPayload({ ...draft, payeeInfo: { payeeType: 1, isInternalStaff: true, payeeStaffId: 14626 } })
    expect(p.payeeType).toBe(1)
    expect(p.isInternalStaff).toBe(true)
    expect(p.payeeStaffId).toBe(14626)
  })
})

// ---------------------------------------------------------------------------
// 八、读能力（组织树 / 地区 / 费用项目 / 字典 / 项目 / 出差人 / 收款方）
// ---------------------------------------------------------------------------

describe('差旅费支出申请表 —— 读能力', () => {
  it('组织树：默认只留**可选**的节点（页面 cost-center-only），并摊平带 depth', async () => {
    const { capability } = captureSdk(fakeBackend())
    const all = await capability.orgOptions({ costCenterOnly: false })
    expect(all.map((o) => o.id)).toEqual(['34', '37', '1558'])
    expect(all.map((o) => o.depth)).toEqual([0, 1, 1])
    const selectable = await capability.orgOptions()
    expect(selectable.map((o) => o.id)).toEqual(['1558'])
    expect(selectable[0]!.selectable).toBe(true)
  })

  it('组织树打的是 /admin-api/org/organization/getTree，且带 includeFinanceAttr=1 & includeVirtual=true', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.orgOptions()
    const call = calls.find((c) => pathOf(c) === route(ORG_TREE_API))!
    expect(call.method).toBe('get')
    expect(queryOf(call)).toMatchObject({ includeFinanceAttr: '1', includeVirtual: 'true' })
  })

  it('地区树打的是 /admin-api/finance/area/tree；parentId 给定时只取子树', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    const top = await capability.areaOptions()
    expect(top.map((n) => n.id)).toEqual(['110000'])
    const sub = await capability.areaOptions('110100')
    expect(sub.map((n) => n.id)).toEqual(['110101'])
    expect(pathsOf(calls)).toEqual([route(AREA_TREE_API), route(AREA_TREE_API)])
  })

  it('费用选择候选打的是 fee-item-options，sourceKey 固定 finance_travel', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    const items = await capability.feeItems()
    expect(items).toEqual(baseline.费用项目候选)
    expect(items).toHaveLength(1) // ★ 实测只有一条 ⇒ 页面自动选中它
    expect(queryOf(calls[0]!)).toMatchObject({ sourceKey: FEE_ITEM_SOURCE_KEY })
  })

  it('字典读的是平台字典 grouped-list，能按 dictType 取到 trip_mode / fund_source', async () => {
    const { capability } = captureSdk(fakeBackend())
    expect(await capability.dictOptions('trip_mode')).toEqual(TRIP_MODE_OPTIONS.map((o) => ({ label: o.label, value: o.value })))
    expect(await capability.dictOptions('finance_project_fund_source')).toEqual(
      FUND_SOURCE_OPTIONS.map((o) => ({ label: o.label, value: o.value })),
    )
    expect(baseline.出行方式字典.map((o) => o.label)).toEqual(TRIP_MODE_OPTIONS.map((o) => o.label))
  })

  it('项目候选打的是 /admin-api/finance/project/options，keyword 默认空串（页面就是空串）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    const list = await capability.projects()
    expect(list.length).toBe(baseline.项目候选.length)
    expect(queryOf(calls[0]!)).toMatchObject({ keyword: '' })
  })

  it('★ 出差人搜索**不给关键字直接拒**（页面上不带关键字就能拉 4225 人，无头不能照抄）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await expect(capability.travelers({ keyword: '   ' })).rejects.toThrow(/必须先给关键字/)
    expect(calls).toHaveLength(0) // ★ 一个请求都没发
  })

  it('出差人搜索带 statusList=1,4 且分页名是 pageSize（renren 的全局默认）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.travelers({ keyword: '胡明伟', pageNo: 1, pageSize: 20 })
    expect(pathOf(calls[0]!)).toBe(route(TRAVELER_SEARCH_API))
    expect(queryOf(calls[0]!)).toMatchObject({ pageNo: '1', pageSize: '20', name: '胡明伟', statusList: TRAVELER_STATUS_LIST })
  })

  it('★ 收款方候选：不给关键字 / 不给组织都直接拒（SDK 刻意偏离页面的全量拉取）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await expect(capability.payeeOptions({ keyword: '' })).rejects.toThrow(/必须先给关键字/)
    await expect(capability.payeeOptions({ keyword: '京粮' })).rejects.toThrow(/orgId 或 companyId/)
    expect(calls).toHaveLength(0)
  })

  it('profile() 只投影三项：password2 / salt / mobile 一个都不出现', async () => {
    const { capability } = captureSdk(fakeBackend())
    const me = await capability.profile()
    expect(Object.keys(me).sort()).toEqual(['id', 'organizationId', 'realName'])
    const raw = JSON.stringify(me)
    expect(raw).not.toMatch(/password2|salt|mobile|\$2a\$/)
    expect(me.id).toBe(baseline.我.id)
  })
})

// ---------------------------------------------------------------------------
// 九、prepare（只读）：拼载荷 + 问审批链 + **自审拦截**
// ---------------------------------------------------------------------------

describe('差旅费支出申请表 —— prepare', () => {
  it('prepare 打两次：preview（问审批链）与 /sys/user/info（拿自己是谁）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.prepare(draft)
    expect(pathsOf(calls).sort()).toEqual([route(PREVIEW_API), '/sys/user/info'].sort())
    // ★ 一个写请求都没发
    expect(pathsOf(calls)).not.toContain(route(CREATE_API))
  })

  it('preview 的 body：key + 变量 + 空的自选审批人 + 空抄送', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.prepare(draft)
    const body = bodyOf(calls.find((c) => pathOf(c) === PREVIEW_API))
    expect(body).toEqual({
      processDefinitionKey: TRAVEL_EXPENSE_PROCESS_KEY,
      variables: { 费用申请类型: '非项目费用', targetOrgId: 1558 },
      startUserSelectAssignees: {},
      copyUserIds: [],
    })
  })

  it('★ 返回的 payload 就是 submit 会发的那一份', async () => {
    const { capability } = captureSdk(fakeBackend())
    const prep = await capability.prepare(draft)
    expect(prep.payload).toEqual(buildTravelPayload(draft))
  })

  it('★ `approvers` 把审批链里会收到待办的人列出来（只取 USER_TASK 节点）', async () => {
    const { capability } = captureSdk(fakeBackend())
    const prep = await capability.prepare(draft)
    expect(prep.approvers).toEqual([
      { node: '部门负责人', id: 15037, nickname: '胡春然' },
      { node: '财务副部长', id: 17406, nickname: '于树华' },
    ])
    expect(prep.previewComplete).toBe(true)
  })

  it('★★ 发起人出现在审批链里时**拒**（后端「发起人与审批人相同自动审核通过」⇒ 撤不掉）', async () => {
    const { calls, capability } = captureSdk(
      fakeBackend({
        '/bpm/process-instance/preview': {
          nodes: [
            {
              nodeId: 'A',
              name: '部门负责人',
              type: 'USER_TASK',
              candidateUsers: [{ id: 18243, nickname: '姚淼鑫' }],
            },
          ],
        },
      }),
    )
    await expect(capability.prepare(draft)).rejects.toThrow(/自动审核通过/)
    await expect(capability.prepare(draft)).rejects.toThrow(/部门负责人/)
    // ★ 拦在 prepare 里 ⇒ 一个写请求都没发
    expect(pathsOf(calls)).not.toContain(route(CREATE_API))
  })

  it('项目费用从详情取得员工 ID，按 Java 相同类型补齐审批变量', async () => {
    const { capability } = captureSdk(fakeBackend())
    const prep = await capability.prepare({
      ...draft,
      projectExpense: true,
      financeProjectId: 1,
      travelEntryList: [{ ...draft.travelEntryList[0]!, fundSource: 1 }],
    })
    expect(prep.previewComplete).toBe(true)
    expect(prep.variables['课题负责人']).toBe('890')
  })

  it('缺负责人或项目停用时不调用审批预览，不会写入', async () => {
    for (const project of [{ id: 1, principalStaffId: null, status: 1 }, { id: 1, principalStaffId: 890, status: 0 }]) {
      const { calls, capability } = captureSdk(fakeBackend({ '/finance/project/get': project }))
      await expect(capability.prepare({ ...draft, projectExpense: true, financeProjectId: 1, travelEntryList: [{ ...draft.travelEntryList[0]!, fundSource: 1 }] })).rejects.toThrow(/负责人|未启用/)
      expect(calls.some(c => pathOf(c) === PREVIEW_API || pathOf(c) === CREATE_API)).toBe(false)
    }
  })

  it('项目负责人出现在审批链时仍触发自审拦截', async () => {
    const { capability } = captureSdk(fakeBackend({ '/bpm/process-instance/preview': { nodes: [{ nodeId: 'principal', type: 'USER_TASK', name: '课题负责人', candidateUsers: [{ id: 18243, nickname: '姚淼鑫' }] }] } }))
    await expect(capability.prepare({ ...draft, projectExpense: true, financeProjectId: 1, travelEntryList: [{ ...draft.travelEntryList[0]!, fundSource: 1 }] })).rejects.toThrow(/自动审核通过/)
  })

  it('公开负责人查询只交付投影字段；拒绝不匹配的项目详情', async () => {
    const { sdk } = captureSdk(fakeBackend({ '/finance/project/get': { id: 1, principalStaffId: 890, principalName: '负责人', status: 1, privateExtra: 'omit' } }))
    expect(await sdk.capabilities.invoke('travel-expense-project-principal', { id: 1 })).toEqual({ id: 1, principalStaffId: 890, principalName: '负责人', status: 1 })
    await expect(sdk.travelExpense.projectPrincipal(2)).rejects.toThrow(/id 不匹配/)
  })

  it('本地校验失败时 prepare **一个请求都不发**', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await expect(capability.prepare({ ...draft, reasons: '' })).rejects.toThrow(/reasons/)
    expect(calls).toHaveLength(0)
  })

  it('流程变量：项目费用 ⇒ 「项目费用」，非项目 ⇒ 「非项目费用」；targetOrgId 转成数字', () => {
    expect(buildProcessVariables(draft)).toEqual({ 费用申请类型: '非项目费用', targetOrgId: 1558 })
    expect(buildProcessVariables({ ...draft, projectExpense: true })).toEqual({ 费用申请类型: '项目费用', targetOrgId: 1558 })
  })
})

// ---------------------------------------------------------------------------
// 十、submit / detail / cancel
// ---------------------------------------------------------------------------

describe('差旅费支出申请表 —— 写链路', () => {
  it('★ submit 只打一个请求：POST /admin-api/finance/bpm-spending-apply-travel/create', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    const id = await capability.submit(draft)
    expect(id).toBe(21666)
    expect(pathsOf(calls)).toEqual([route(CREATE_API)])
    const call = calls[0]!
    expect(call.method).toBe('post')
  })

  it('★ create 的 body **就是** buildTravelPayload 的产物（没有额外包一层、也没有 startUserSelectAssignees）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.submit(draft)
    const body = bodyOf(calls[0])
    expect(body).toEqual(JSON.parse(JSON.stringify(buildTravelPayload(draft))))
    expect(body).not.toHaveProperty('startUserSelectAssignees')
  })

  it('本地校验失败时 submit **不发 create**（rejected promise，不是同步抛出）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    const promise = capability.submit({ ...draft, orgId: '' })
    await expect(promise).rejects.toThrow(/orgId/)
    expect(calls).toHaveLength(0)
  })

  it('detail 打的是 /finance/bpm-spending-apply-travel/get?id=', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    const record = await capability.detail(21666)
    expect(pathOf(calls[0]!)).toBe(route(DETAIL_API))
    expect(queryOf(calls[0]!)).toMatchObject({ id: '21666' })
    // ★ 本流程的 detail 响应里**有** processInstanceId（请假那条线没有）
    expect(record.processInstanceId).toBe('pi-abc-123')
  })

  it('★ cancel 优先从 detail 里取 processInstanceId（省一次翻列表）', async () => {
    const { calls, capability } = captureSdk(
      fakeBackend({ '/bpm/process-instance/cancel-by-start-user': true }),
    )
    await capability.cancel({ reason: 'SDK-TEST-撤销', businessKey: 21666 })
    expect(pathsOf(calls)).toEqual([route(DETAIL_API), '/bpm/process-instance/cancel-by-start-user'])
    const call = calls[1]!
    expect(call.method).toBe('delete')
    expect(bodyOf(call)).toEqual({ id: 'pi-abc-123', reason: 'SDK-TEST-撤销' })
  })

  it('detail 取不到 processInstanceId 时回落到翻「我的流程」', async () => {
    const { calls, capability } = captureSdk(
      fakeBackend({
        [route(DETAIL_API)]: { id: 21666, processInstanceId: null },
        '/bpm/process-instance/my-page': {
          list: [
            { id: 'pi-1', businessKey: '21665', processDefinitionKey: 'qingjia', status: 1 },
            { id: 'pi-2', businessKey: '21666', processDefinitionKey: TRAVEL_EXPENSE_PROCESS_KEY, status: 1 },
          ],
          total: 2,
        },
        '/bpm/process-instance/cancel-by-start-user': true,
      }),
    )
    await capability.cancel({ reason: 'SDK-TEST-撤销', businessKey: 21666 })
    expect(pathsOf(calls)).toEqual([route(DETAIL_API), '/bpm/process-instance/my-page', '/bpm/process-instance/cancel-by-start-user'])
    expect(bodyOf(calls[2])).toEqual({ id: 'pi-2', reason: 'SDK-TEST-撤销' })
  })

  it('★ 翻「我的流程」时按 businessKey **与** processDefinitionKey 双条件匹配（业务主键会撞）', async () => {
    const { capability } = captureSdk(
      fakeBackend({
        '/bpm/process-instance/my-page': {
          list: [{ id: 'pi-x', businessKey: '21666', processDefinitionKey: 'qingjia', status: 1 }],
          total: 1,
        },
      }),
    )
    await expect(capability.findInstanceByBusinessKey('21666')).rejects.toThrow(/也没找到/)
  })

  it('cancel 的 reason 必填且不能是空串（后端 @NotEmpty）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await expect(capability.cancel({ reason: '   ', processInstanceId: 'pi-1' })).rejects.toThrow(/reason 必填/)
    expect(calls).toHaveLength(0)
  })

  it('cancel 两个 id 都不给时拒（不发请求）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await expect(capability.cancel({ reason: 'x' })).rejects.toThrow(/processInstanceId 或 businessKey/)
    expect(calls).toHaveLength(0)
  })

  it('直接给 processInstanceId 时一个前置请求都不打', async () => {
    const { calls, capability } = captureSdk(fakeBackend({ '/bpm/process-instance/cancel-by-start-user': true }))
    await capability.cancel({ reason: 'SDK-TEST-撤销', processInstanceId: 'pi-9' })
    expect(pathsOf(calls)).toEqual(['/bpm/process-instance/cancel-by-start-user'])
  })

  it('myInstances 带 renren 的默认空值参数（order / orderField / name / title / category）', async () => {
    const { calls, capability } = captureSdk(fakeBackend())
    await capability.myInstances({ status: 1 })
    expect(queryOf(calls[0]!)).toMatchObject({
      order: '',
      orderField: '',
      name: '',
      title: '',
      category: '',
      status: '1',
      pageNo: '1',
      pageSize: '20',
    })
  })
})

// ---------------------------------------------------------------------------
// 十一、与浏览器基准 / 后端源码对得上
// ---------------------------------------------------------------------------

describe('差旅费支出申请表 —— 与实测基准对得上', () => {
  it('★ 组织树的两个数：全树 1565 个节点，其中 **1109** 个可作成本中心（页面 cost-center-only）', () => {
    const s = baseline.组织树样本
    expect(s.全树节点数).toBe(1565)
    expect(s.可选节点数).toBe(1109)
    expect(s.可选节点数).toBeLessThan(s.全树节点数)
    // 平铺出来的可选样本也带 depth，说明 DFS 摊平把层级带上了
    expect(s.可选样本.length).toBeGreaterThan(0)
    for (const node of s.可选样本) {
      expect(node.selectable).toBe(true)
      expect(typeof node.depth).toBe('number')
    }
  })

  it('★ 项目费用那条分支**走得通**：博创系里确实有可选的成本中心（如 101 设计中心1236）', () => {
    const boc = baseline.博创系组织
    expect(boc.其中可选的).toBeGreaterThan(0)
    expect(boc.可选样本.some((n: { fullPath: string }) => n.fullPath.startsWith('沃德辰龙-沃德博创'))).toBe(true)
    // ⚠️ 但「沃德博创」这个节点**自己**不是成本中心 ⇒ 不能因为它 cc=0 就断言整条路走不通
    //    （这条测试是纠错留下的：第一版就是那么写的，实测证伪）
    expect(boc.其中可选的).toBeLessThan(boc.路径含博创的节点数 + 1)
  })

  it('基准的地区树 id 是**字符串**（这与 a-cascader 的原样透传一致）', () => {
    for (const node of baseline.地区树样本.样本) {
      expect(typeof node.id).toBe('string')
    }
    expect(baseline.地区树样本.顶层).toBe(34)
  })

  it('★ 基准里每个组织的审批链都**不含**当前登录用户（18243）—— 自审那条红线在实测里没踩到', () => {
    const me = baseline.我.id
    for (const [org, approvers] of Object.entries(baseline.审批链预览)) {
      for (const a of approvers) {
        expect(String(a.id), `组织 ${org} 的「${a.node}」节点里出现了发起人`).not.toBe(me)
      }
    }
  })
})
