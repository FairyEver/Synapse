import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'
import type { PortalRequest } from '../session/types.js'

/**
 * Portal 财务设置 / 年度账结转；静态锚点 frontend acab69acc7、Java 0f1a55718e。
 *
 * ## 嵌套详情页（`detail/balance` 与 `detail/balance/subject-detail`）的四个动作
 *
 * 列表行「详情」push 到 `./detail/balance`，那一页是**没有独立菜单项**的隐藏子路由，
 * 浏览器里发四类请求（`detail/balance/index.vue`、`.../subject-detail/index.vue`）：
 *
 * | 页面动作 | 请求 | 后端 |
 * | --- | --- | --- |
 * | 期初余额表格（虚拟滚动、不分页） | `GET …/opening-balance/page` | `AnnualClosingController:54` 有 |
 * | 科目名称下钻（含辅助核算的行） | `GET …/opening-balance/detail` | `:60` 有 |
 * | 「试算」按钮弹窗 | `GET …/trial-balance` | `:87` 有 |
 * | 「对账」按钮 | `POST …/reconcile` | **两个检出都没有这个路由** |
 *
 * ⚠️ **对账那条是本模块里唯一无法在后端核到的动作**，而且不是"名字对不上"：固定检出
 * `AnnualClosingController` 只有 `/page`、`/opening-balance/page`、`/opening-balance/detail`、
 * `/close`、`/cancel-close` 等，**没有任何 `@PostMapping("/reconcile")`**；
 * `reconciliation` 包下的 `auto-reconcile`（`ReconciliationManageController:51`）与
 * `OpeningSettingController` 的 `/reconcile`（期初设置那条线，已属另一个能力）都不是它。
 * 页面 `actionReconcile()` 拿到 404 时只 `console.error`，用户看到的是"点了没反应"。
 * 按 conventions 第 33 条「不能把页面可见动作排除成不需要的功能」，SDK 仍然照前端契约交付
 * 该能力，并把「后端未核到」如实登记在 `gaps` 里；调用方拿到失败是**预期结果**，不是重试信号。
 *
 * ⚠️ **`subjectCode` 是页面与后端的一处字段错配**：期初余额页的「科目」筛选用的
 * `portal-finance-ledger-select`（`valueType` 默认 `id`，页面没有覆盖）产出的是**科目ID**，
 * 而页面对它的 `formState.subjectId` 原样塞进请求的 `subjectCode` 参数；
 * 后端 `OpeningBalancePageReqVO.subjectCode` 是 `Long`，Service 用它等值匹配
 * `LedgerAccountsDO.code`（科目编码，如 1001）。两者不是同一序列，所以页面上按科目筛选
 * 很可能一条都筛不出来（除非某个科目的 id 恰好等于另一个科目的 code）。
 * SDK 保持与页面逐字一致的请求形状（参数名仍是 `subjectCode`），**不擅自把 id 换成 code**，
 * 差异登记在 `gaps`。
 *
 * ⚠️ **详情页桥接的是列表行 `id`，后端要的是账套ID**：`openDetail(record)` 把整行塞进 bridge，
 * 详情页随后用 `bridgeData.id` 当 `accountingSetId` 发请求（`handleReset` 里更直白：
 * `rrList.formState.accountingSetId = bridgeData.value.id`）。但后端 `finance_annual_closing`
 * 的 `id` 与 `accounting_set_id` 是两个独立列（`AnnualClosingDO` 明确声明了这两个字段，
 * `initYearDataIfAbsent` 也是各自赋值后 `insertBatch`）。SDK 因此**要求调用方传真正的账套ID**
 * （列表能力的 `list[].accountingSetId`），而不是照抄页面的行 id —— 照抄会让
 * `getOpeningBalancePage` 里 `selectByAccountingSetIdsAndYear` 查不到记录、静默返回空页
 * （该方法在"未结转或查不到"时返回 `PageResult.empty()`，**不报错**）。这条差异同样在 `gaps` 里。
 *
 * 这些子页的权限与列表页相同（`<route>` 块写的都是
 * `/dashboard/finance/setting/annual-carryforward`），所以能力定义沿用同一个 `permission`。
 */
export const FINANCE_SETTING_ANNUAL_CARRYFORWARD_PAGE_PATH = '/dashboard/finance/setting/annual-carryforward/list'
const ROOT = '/admin-api/finance/annual-closing'

/** 嵌套详情页（期初余额）的路由文件，写进文档与排障时用得上 */
export const FINANCE_SETTING_ANNUAL_CARRYFORWARD_DETAIL_ROUTE_FILES = {
  balance: 'app/portal/views/dashboard/finance/setting/annual-carryforward/detail/balance/index.vue',
  subjectDetail: 'app/portal/views/dashboard/finance/setting/annual-carryforward/detail/balance/subject-detail/index.vue',
} as const

/**
 * 期初余额页固定用 `pageNo=1&pageSize=-1` 全量拉（页面不分页）。
 *
 * `-1` 是 renren 的 `PageParam.PAGE_SIZE_NONE`（`framework/common/pojo/PageParam`），
 * `BaseMapperX.selectPage` 见到它就走 `selectList` 全量查，并把 `total` 记为 `list.size()`。
 * ⚠️ 这里**不套用 conventions 第 11 条**：那一条针对的是几千人的员工/用户候选，
 * 而这里的行数是"账套下的科目表"（科目数量由账套的会计科目决定，量级是几百），
 * 且后端这条查询本身就是**按账套收敛**的（`accountingSetId` 必填）。
 */
const OPENING_BALANCE_PAGE_SIZE_ALL = -1

export type FinanceAnnualCarryforwardId = string | number
export type FinanceAnnualCarryforwardStatus = 0 | 1

export type FinanceAnnualCarryforwardQuery = {
  accountingSetIds?: FinanceAnnualCarryforwardId[]
  periodYear?: string
  closingStatus?: FinanceAnnualCarryforwardStatus
  pageNo?: number
  pageSize?: number
}

export type FinanceAnnualCarryforwardRow = {
  /** 年度账结转记录主键；页面详情桥接使用，不能代替accountingSetId。 */
  id: FinanceAnnualCarryforwardId
  /** 后端 close/cancel-close 要求的账套主键。 */
  accountingSetId: FinanceAnnualCarryforwardId
  tenantName: string | null
  accountingName: string | null
  accountCode: string | null
  periodYear: string
  closingStatus: FinanceAnnualCarryforwardStatus
  closingTime: string | null
  closingByName: string | null
}

export type FinanceAnnualCarryforwardActionInput = {
  accountingSetIds: FinanceAnnualCarryforwardId[]
  /** 结转时省略即按Portal当前年度；取消结转必须提供。 */
  periodYear?: string | number
}

export type FinanceAnnualCarryforwardCancelInput = {
  accountingSetIds: FinanceAnnualCarryforwardId[]
  periodYear: string | number
}

export type FinanceAnnualCarryforwardPayload = {
  periodYear: number
  accountingSetIds: FinanceAnnualCarryforwardId[]
}

export type FinanceAnnualCarryforwardTransferPreparation = {
  draft: FinanceAnnualCarryforwardPayload
  fromYear: number
  toYear: number
}

/** 余额方向字典 `balance_direction`：1 借、2 贷、3 平（左右两页用同一个字典）。 */
export type FinanceAnnualCarryforwardBalanceDirection = 1 | 2 | 3

export type FinanceAnnualCarryforwardOpeningBalanceQuery = {
  /** 账套ID（`finance_annual_closing.accounting_set_id`）；必填，不是结转记录行 id。 */
  accountingSetId: FinanceAnnualCarryforwardId
  /** 会计期间年份 YYYY；来自列表行的 periodYear。 */
  periodYear: string
  /**
   * 科目编码筛选（后端 `LedgerAccountsDO.code` 等值匹配）。
   *
   * ⚠️ 页面把它填成科目**ID**（见文件头的字段错配说明）；SDK 不替调用方做 id→code 换算。
   * 省略时该 URL 参数不出现（页面上 form.subjectId 为空即 `undefined`，被 qs 丢掉）。
   */
  subjectCode?: FinanceAnnualCarryforwardId | null
}

export type FinanceAnnualCarryforwardOpeningBalanceRow = {
  /** 科目ID；下钻期初余额明细时用它作为 subjectId。 */
  subjectId: FinanceAnnualCarryforwardId
  /** 科目编码（后端为 Long，序列化后可能是数字或字符串）。 */
  subjectCode: FinanceAnnualCarryforwardId | null
  subjectName: string | null
  /** 余额方向；后端可能是 null（此时页面显示「—」）。 */
  balanceDirection: FinanceAnnualCarryforwardBalanceDirection | null
  /** 期初余额（元）；BigDecimal 原值，页面按两位小数展示。 */
  openingBalance: number | string | null
  /** 辅助核算字段名原文，可能是逗号分隔的多个字段或数组。 */
  ancillaryAccounting: string | null
  /** 明细下钻类型：NONE/SUPPLIER/CUSTOMER/BIO_PRODUCTIVE/BIO_CONSUMABLE。 */
  detailType: string | null
  /** 明细下钻接口相对路径（如 `/finance/annual-closing/supplier-balance/detail`）。 */
  detailApi: string | null
  /** 后端建议的下钻参数。 */
  detailParams: Record<string, unknown> | null
  /** 是否允许下钻；false 时页面不显示链接。 */
  detailEnabled: boolean | null
  /** 下钻入口文案，如「供应商余额明细」。 */
  detailLabel: string | null
}

export type FinanceAnnualCarryforwardOpeningBalanceDetailQuery = {
  accountingSetId: FinanceAnnualCarryforwardId
  periodYear: string
  /** 科目ID；来自期初余额行的 subjectId，不是 subjectCode。 */
  subjectId: FinanceAnnualCarryforwardId
  /** 辅助核算字段名；来自该行 ancillaryAccounting 拆分出的一个字段（如 supplierCode）。 */
  ancillaryField: string
}

export type FinanceAnnualCarryforwardOpeningBalanceDetailRow = {
  /** 辅助核算编码（供应商编码/客户编码/成本中心编码/银行账户名等，随 ancillaryField 变）。 */
  ancillaryCode: string | null
  /** 辅助核算名称。 */
  ancillaryName: string | null
  balanceDirection: FinanceAnnualCarryforwardBalanceDirection | null
  /** 该辅助核算维度的期初余额（元），BigDecimal 原值。 */
  balance: number | string | null
}

export type FinanceAnnualCarryforwardTrialBalanceItem = {
  /** 科目类型字典 `account_type`；两侧合计项为 null。 */
  subjectType: number | null
  /** 科目类型名称；合计项是「资产+成本合计」/「权益+负债+损益合计」。 */
  subjectTypeName: string | null
  /** 净额绝对值。 */
  balanceAmount: number | string | null
  /** 1 借、2 贷、3 平（净额为 0 时是 3）。 */
  balanceDirection: FinanceAnnualCarryforwardBalanceDirection | null
}

export type FinanceAnnualCarryforwardTrialBalance = {
  asset: FinanceAnnualCarryforwardTrialBalanceItem
  liability: FinanceAnnualCarryforwardTrialBalanceItem
  equity: FinanceAnnualCarryforwardTrialBalanceItem
  cost: FinanceAnnualCarryforwardTrialBalanceItem
  profitLoss: FinanceAnnualCarryforwardTrialBalanceItem
  assetCostTotal: FinanceAnnualCarryforwardTrialBalanceItem
  equityLiabilityProfitLossTotal: FinanceAnnualCarryforwardTrialBalanceItem
  /** 资产+成本 与 权益+负债+损益 的有符号净额互为相反数时为 true。 */
  isBalanced: boolean
}

export type FinanceAnnualCarryforwardTrialBalanceQuery = {
  accountingSetId: FinanceAnnualCarryforwardId
  /** 会计期间年份 YYYY；页面拼成 `${periodYear}-12` 发给后端。 */
  periodYear: string
}

export type FinanceAnnualCarryforwardReconcileInput = {
  accountingSetId: FinanceAnnualCarryforwardId
  periodYear: string
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): FinanceAnnualCarryforwardId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
  }
  return value
}

function idListOf (value: unknown, label: string, allowEmpty: boolean): FinanceAnnualCarryforwardId[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  if (!allowEmpty && value.length === 0) throw new Error(`${label}不能为空`)
  const result = value.map((item, index) => idOf(item, `${label}[${index}]`))
  const keys = result.map(item => String(item))
  if (new Set(keys).size !== keys.length) throw new Error(`${label}不能包含重复账套ID`)
  return result
}

function statusOf (value: unknown, label = 'closingStatus'): FinanceAnnualCarryforwardStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（未结转）或1（已结转）`)
  return value
}

function yearTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) throw new Error(`${label}必须为YYYY`)
  const year = Number(value)
  if (year < 1000 || year > 9999) throw new Error(`${label}必须为四位年份`)
  return value
}

function yearNumberOf (value: unknown, label: string): number {
  if (typeof value === 'string') return Number(yearTextOf(value, label))
  if (!Number.isSafeInteger(value) || Number(value) < 1000 || Number(value) > 9999) {
    throw new Error(`${label}必须为四位年份或YYYY字符串`)
  }
  return Number(value)
}

function portalYear (now: Date): number {
  const value = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).format(now)
  const year = Number(value)
  if (!Number.isInteger(year)) throw new Error('无法计算门户当前年度')
  return year
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved)) {
    throw new Error('pageSize必须是页面支持的10、20、50或100')
  }
  return resolved
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function queryParamsOf (query: FinanceAnnualCarryforwardQuery, now: () => Date): Record<string, unknown> {
  const source = query ?? {}
  const accountingSetIds = source.accountingSetIds === undefined
    ? []
    : idListOf(source.accountingSetIds, 'accountingSetIds', true)
  const periodYear = source.periodYear === undefined
    ? String(portalYear(now()))
    : yearTextOf(source.periodYear, 'periodYear')
  const closingStatus = source.closingStatus === undefined ? undefined : statusOf(source.closingStatus)
  return {
    order: '',
    orderField: '',
    accountingSetIds,
    periodYear,
    closingStatus,
    pageNo: pageNumberOf(source.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(source.pageSize, 20, 'pageSize'),
  }
}

function payloadOf (
  input: FinanceAnnualCarryforwardActionInput,
  now: () => Date,
  requireYear: boolean,
): FinanceAnnualCarryforwardPayload {
  const accountingSetIds = idListOf(input?.accountingSetIds, 'accountingSetIds', false)
  const rawYear = input?.periodYear
  if (requireYear && rawYear === undefined) throw new Error('取消结转必须提供periodYear')
  const periodYear = rawYear === undefined ? portalYear(now()) : yearNumberOf(rawYear, 'periodYear')
  return { periodYear, accountingSetIds }
}

function rowOf (value: unknown): FinanceAnnualCarryforwardRow {
  const row = objectOf(value, '年度账结转列表行')
  return {
    id: idOf(row.id, '年度账结转记录id'),
    accountingSetId: idOf(row.accountingSetId, '账套id'),
    tenantName: nullableTextOf(row.tenantName, 'tenantName'),
    accountingName: nullableTextOf(row.accountingName, 'accountingName'),
    accountCode: nullableTextOf(row.accountCode, 'accountCode'),
    periodYear: yearTextOf(row.periodYear, 'periodYear'),
    closingStatus: statusOf(row.closingStatus),
    closingTime: nullableTextOf(row.closingTime, 'closingTime'),
    closingByName: nullableTextOf(row.closingByName, 'closingByName'),
  }
}

function balanceDirectionOf (value: unknown, label: string): FinanceAnnualCarryforwardBalanceDirection | null {
  if (value === null || value === undefined) return null
  if (value !== 1 && value !== 2 && value !== 3) throw new Error(`${label}只能是数值1（借）、2（贷）或3（平）`)
  return value
}

function amountOf (value: unknown, label: string): number | string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label}必须为有限数字或字符串`)
    return value
  }
  if (typeof value === 'string') return value
  throw new Error(`${label}必须为有限数字或字符串`)
}

function boolOf (value: unknown, label: string): boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'boolean') throw new Error(`${label}必须为布尔值或null`)
  return value
}

function ancillaryFieldOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label}不能为空或全为空格`)
  return value
}

function openingBalanceParamsOf (query: FinanceAnnualCarryforwardOpeningBalanceQuery): Record<string, unknown> {
  const source = query ?? {} as FinanceAnnualCarryforwardOpeningBalanceQuery
  const subjectCode = source.subjectCode === undefined || source.subjectCode === null || source.subjectCode === ''
    ? undefined
    : idOf(source.subjectCode, 'subjectCode')
  return {
    accountingSetId: idOf(source.accountingSetId, 'accountingSetId'),
    periodYear: yearTextOf(source.periodYear, 'periodYear'),
    subjectCode,
    pageNo: 1,
    pageSize: OPENING_BALANCE_PAGE_SIZE_ALL,
  }
}

function openingBalanceRowOf (value: unknown): FinanceAnnualCarryforwardOpeningBalanceRow {
  const row = objectOf(value, '期初余额列表行')
  const detailParams = row.detailParams
  if (detailParams !== undefined && detailParams !== null && (typeof detailParams !== 'object' || Array.isArray(detailParams))) {
    throw new Error('detailParams必须为对象或null')
  }
  return {
    subjectId: idOf(row.subjectId, '科目id'),
    subjectCode: row.subjectCode === undefined || row.subjectCode === null ? null : idOf(row.subjectCode, '科目编码'),
    subjectName: nullableTextOf(row.subjectName, 'subjectName'),
    balanceDirection: balanceDirectionOf(row.balanceDirection, 'balanceDirection'),
    openingBalance: amountOf(row.openingBalance, 'openingBalance'),
    ancillaryAccounting: nullableTextOf(row.ancillaryAccounting, 'ancillaryAccounting'),
    detailType: nullableTextOf(row.detailType, 'detailType'),
    detailApi: nullableTextOf(row.detailApi, 'detailApi'),
    detailParams: detailParams === undefined || detailParams === null ? null : { ...(detailParams as Record<string, unknown>) },
    detailEnabled: boolOf(row.detailEnabled, 'detailEnabled'),
    detailLabel: nullableTextOf(row.detailLabel, 'detailLabel'),
  }
}

function openingBalanceDetailRowOf (value: unknown): FinanceAnnualCarryforwardOpeningBalanceDetailRow {
  const row = objectOf(value, '期初余额明细行')
  return {
    ancillaryCode: nullableTextOf(row.ancillaryCode, 'ancillaryCode'),
    ancillaryName: nullableTextOf(row.ancillaryName, 'ancillaryName'),
    balanceDirection: balanceDirectionOf(row.balanceDirection, 'balanceDirection'),
    balance: amountOf(row.balance, 'balance'),
  }
}

function trialBalanceItemOf (value: unknown, label: string): FinanceAnnualCarryforwardTrialBalanceItem {
  const item = objectOf(value, label)
  const subjectType = item.subjectType === undefined || item.subjectType === null
    ? null
    : (() => {
        if (!Number.isSafeInteger(item.subjectType)) throw new Error(`${label}.subjectType必须为安全整数或null`)
        return Number(item.subjectType)
      })()
  return {
    subjectType,
    subjectTypeName: nullableTextOf(item.subjectTypeName, `${label}.subjectTypeName`),
    balanceAmount: amountOf(item.balanceAmount, `${label}.balanceAmount`),
    balanceDirection: balanceDirectionOf(item.balanceDirection, `${label}.balanceDirection`),
  }
}

function trialBalanceOf (value: unknown): FinanceAnnualCarryforwardTrialBalance {
  const summary = objectOf(value, '试算平衡响应')
  if (typeof summary.isBalanced !== 'boolean') throw new Error('试算平衡响应的isBalanced必须为布尔值')
  return {
    asset: trialBalanceItemOf(summary.asset, 'asset'),
    liability: trialBalanceItemOf(summary.liability, 'liability'),
    equity: trialBalanceItemOf(summary.equity, 'equity'),
    cost: trialBalanceItemOf(summary.cost, 'cost'),
    profitLoss: trialBalanceItemOf(summary.profitLoss, 'profitLoss'),
    assetCostTotal: trialBalanceItemOf(summary.assetCostTotal, 'assetCostTotal'),
    equityLiabilityProfitLossTotal: trialBalanceItemOf(summary.equityLiabilityProfitLossTotal, 'equityLiabilityProfitLossTotal'),
    isBalanced: summary.isBalanced,
  }
}

/**
 * 创建年度账结转页面能力。
 *
 * `now` 只用于复刻Portal在列表/批量结转弹窗里生成的当前年度，生产调用不需要传入。
 */
export function createFinanceSettingAnnualCarryforwardCapability (
  request: PortalRequest,
  options: { now?: () => Date } = {},
) {
  const now = options.now ?? (() => new Date())
  return {
    async list (query: FinanceAnnualCarryforwardQuery = {}): Promise<PageResult<FinanceAnnualCarryforwardRow>> {
      const result = await request<PageResult<unknown>>({
        url: `${ROOT}/page`,
        method: 'get',
        params: queryParamsOf(query, now),
      })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) {
        throw new Error('年度账结转分页响应缺少有效list或total')
      }
      return { list: result.list.map(rowOf), total: result.total }
    },

    prepareTransfer (input: FinanceAnnualCarryforwardActionInput): FinanceAnnualCarryforwardTransferPreparation {
      const draft = payloadOf(input, now, false)
      return { draft, fromYear: draft.periodYear - 1, toYear: draft.periodYear }
    },

    async transfer (input: FinanceAnnualCarryforwardActionInput): Promise<true> {
      const payload = payloadOf(input, now, false)
      const result = await request<unknown>({
        url: `${ROOT}/close`,
        method: 'post',
        data: payload,
      })
      if (result !== true) throw new Error('年度账结转响应不是true')
      return true
    },

    async cancelTransfer (input: FinanceAnnualCarryforwardCancelInput): Promise<true> {
      const payload = payloadOf(input, now, true)
      const result = await request<unknown>({
        url: `${ROOT}/cancel-close`,
        method: 'post',
        data: payload,
      })
      if (result !== true) throw new Error('取消年度账结转响应不是true')
      return true
    },

    /**
     * 期初余额表格（详情页第一张表）。
     *
     * 后端在「该账套该年度没有结转记录」或「结转状态不是已结转」时返回**空页**而不是报错
     * （`getOpeningBalancePage` 的 `PageResult.empty()`），所以 `list=[]` 有两种含义：
     * 真的没有科目，或者这一页现在还不该有数据。调用方必须先确认 `closingStatus=1`。
     */
    async listOpeningBalance (query: FinanceAnnualCarryforwardOpeningBalanceQuery): Promise<PageResult<FinanceAnnualCarryforwardOpeningBalanceRow>> {
      const result = await request<PageResult<unknown>>({
        url: `${ROOT}/opening-balance/page`,
        method: 'get',
        params: openingBalanceParamsOf(query),
      })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) {
        throw new Error('期初余额分页响应缺少有效list或total')
      }
      return { list: result.list.map(openingBalanceRowOf), total: result.total }
    },

    /**
     * 科目名称下钻：按辅助核算维度查该科目的期初余额明细（详情页第二层）。
     *
     * 后端同样先查结转状态，未结转直接返回空数组；`ancillaryField` 不在该科目的
     * `ancillaryAccounting` 里也返回空数组；只有**科目ID不存在**时才抛业务错误
     * （`OPENING_BALANCE_DETAIL_SUBJECT_NOT_EXISTS`）。
     */
    async getOpeningBalanceDetail (query: FinanceAnnualCarryforwardOpeningBalanceDetailQuery): Promise<FinanceAnnualCarryforwardOpeningBalanceDetailRow[]> {
      const source = query ?? {} as FinanceAnnualCarryforwardOpeningBalanceDetailQuery
      const result = await request<unknown>({
        url: `${ROOT}/opening-balance/detail`,
        method: 'get',
        params: {
          accountingSetId: idOf(source.accountingSetId, 'accountingSetId'),
          periodYear: yearTextOf(source.periodYear, 'periodYear'),
          subjectId: idOf(source.subjectId, 'subjectId'),
          ancillaryField: ancillaryFieldOf(source.ancillaryField, 'ancillaryField'),
        },
      })
      if (!Array.isArray(result)) throw new Error('期初余额明细响应必须是数组')
      return result.map(openingBalanceDetailRowOf)
    },

    /**
     * 试算平衡弹窗：把 `${periodYear}-12` 作为会计期间查询固定五类科目净额与两侧合计。
     *
     * 页面只按年末期间取数（`const period = `${data.periodYear}-12``），SDK 沿用同一规则，
     * 不开放任意月份。
     */
    async getTrialBalance (query: FinanceAnnualCarryforwardTrialBalanceQuery): Promise<FinanceAnnualCarryforwardTrialBalance> {
      const source = query ?? {} as FinanceAnnualCarryforwardTrialBalanceQuery
      const periodYear = yearTextOf(source.periodYear, 'periodYear')
      const result = await request<unknown>({
        url: `${ROOT}/trial-balance`,
        method: 'get',
        params: {
          accountingSetId: idOf(source.accountingSetId, 'accountingSetId'),
          period: `${periodYear}-12`,
        },
      })
      return trialBalanceOf(result)
    },

    /**
     * 「对账」按钮。
     *
     * ⚠️ 固定 Java 检出**没有** `POST /finance/annual-closing/reconcile` 这个路由
     * （见文件头）—— 调用它会拿到 404 一类的错误。SDK 保留页面的请求形状，
     * 是因为按 conventions 第 33 条不能把页面可见动作排除成不需要的功能；
     * 这里的失败是**当前后端能力缺口**，不是重试能解决的。
     *
     * 页面不读响应体（`await http.post(...)` 之后直接弹「对账成功，未检查到差异」），
     * 所以 SDK 在请求成功时返回 `undefined`，不编造业务对象。
     */
    async reconcile (input: FinanceAnnualCarryforwardReconcileInput): Promise<undefined> {
      const source = input ?? {} as FinanceAnnualCarryforwardReconcileInput
      await request<unknown>({
        url: `${ROOT}/reconcile`,
        method: 'post',
        data: {
          accountingSetId: idOf(source.accountingSetId, 'accountingSetId'),
          periodYear: yearTextOf(source.periodYear, 'periodYear'),
        },
      })
      return undefined
    },

  }
}

export type FinanceSettingAnnualCarryforwardCapability = ReturnType<typeof createFinanceSettingAnnualCarryforwardCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const idListParam = (required = false): ParamSpec => p('accountingSetIds', 'text', required, '账套ID数组；不是年度账结转记录id数组')
const yearParam = (required = false, description = '会计期间年份，YYYY'): ParamSpec => p('periodYear', 'date', required, description)
const pageParams: ParamSpec[] = [
  idListParam(), yearParam(),
  { name: 'closingStatus', kind: 'enum', required: false, description: '结转状态：0未结转，1已结转', options: [{ label: '未结转', value: 0 }, { label: '已结转', value: 1 }] },
  p('pageNo', 'number'), p('pageSize', 'number'),
]

export const FINANCE_SETTING_ANNUAL_CARRYFORWARD_METHODS = {
  'finance-setting-annual-carryforward-list': 'list',
  'finance-setting-annual-carryforward-prepare-transfer': 'prepareTransfer',
  'finance-setting-annual-carryforward-transfer': 'transfer',
  'finance-setting-annual-carryforward-cancel-transfer': 'cancelTransfer',
  'finance-setting-annual-carryforward-opening-balance': 'listOpeningBalance',
  'finance-setting-annual-carryforward-opening-balance-detail': 'getOpeningBalanceDetail',
  'finance-setting-annual-carryforward-trial-balance': 'getTrialBalance',
  'finance-setting-annual-carryforward-reconcile': 'reconcile',
} as const

const accountingSetIdParam = (required: boolean, description: string): ParamSpec => p('accountingSetId', 'text', required, description)
const openingBalanceParams: ParamSpec[] = [
  accountingSetIdParam(true, '账套ID（列表行的accountingSetId）；不是年度账结转记录id'),
  yearParam(true, '会计期间年份，YYYY'),
  p('subjectCode', 'text', false, '科目编码筛选；页面实际传入选中的科目ID，后端按科目编码等值匹配'),
]
const openingBalanceDetailParams: ParamSpec[] = [
  accountingSetIdParam(true, '账套ID（列表行的accountingSetId）；不是年度账结转记录id'),
  yearParam(true, '会计期间年份，YYYY'),
  p('subjectId', 'text', true, '科目ID（期初余额行的subjectId）；不是subjectCode'),
  p('ancillaryField', 'text', true, '辅助核算字段名，来自该行ancillaryAccounting，如supplierCode'),
]
const trialBalanceParams: ParamSpec[] = [
  accountingSetIdParam(true, '账套ID（列表行的accountingSetId）；不是年度账结转记录id'),
  yearParam(true, '会计期间年份，YYYY；SDK按页面规则拼成YYYY-12作为period'),
]
const reconcileParams: ParamSpec[] = [
  accountingSetIdParam(true, '账套ID（列表行的accountingSetId）；不是年度账结转记录id'),
  yearParam(true, '会计期间年份，YYYY'),
]

export const financeSettingAnnualCarryforwardCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-annual-carryforward-list', title: '查询年度账结转', write: false, params: pageParams },
  { id: 'finance-setting-annual-carryforward-prepare-transfer', title: '准备年度账结转', write: false, params: [idListParam(true), yearParam()] },
  { id: 'finance-setting-annual-carryforward-transfer', title: '执行年度账结转', write: true, params: [idListParam(true), yearParam()] },
  { id: 'finance-setting-annual-carryforward-cancel-transfer', title: '取消年度账结转', write: true, params: [idListParam(true), yearParam(true)] },
  { id: 'finance-setting-annual-carryforward-opening-balance', title: '查询期初余额', write: false, params: openingBalanceParams },
  { id: 'finance-setting-annual-carryforward-opening-balance-detail', title: '查询期初余额明细', write: false, params: openingBalanceDetailParams },
  { id: 'finance-setting-annual-carryforward-trial-balance', title: '查询试算平衡', write: false, params: trialBalanceParams },
  { id: 'finance-setting-annual-carryforward-reconcile', title: '执行对账', write: true, params: reconcileParams },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_SETTING_ANNUAL_CARRYFORWARD_PAGE_PATH,
  permission: '/dashboard/finance/setting/annual-carryforward',
  httpInstance: 'platform',
  moduleType: null,
}))
