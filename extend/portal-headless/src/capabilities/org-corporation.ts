import type { AiContract, AiField, AiParameter } from '../catalog/ai-contract.js'
import type { PageResult, PortalRequest } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 法人管理」列表页。详情/编辑路由会归一到这个菜单路径。 */
export const ORG_CORPORATION_PAGE_PATH = '/dashboard/org/corporation/list'
export const ORG_CORPORATION_PERMISSION = '/dashboard/org/corporation'

const ROOT = '/org/corporation'
const OPTIONS_URL = `${ROOT}/getAllLegalPerson`

export type OrgCorporationId = string | number

export type OrgCorporationRecord = {
  id: OrgCorporationId
  name: string
  superOrganizationId?: OrgCorporationId | null
  superOrganizationName?: string | null
  /** 后端为兼容旧表单保留的单个投资主体字段；页面不再用它提交。 */
  mainInvest?: OrgCorporationId | null
  mainInvestName?: string | null
  mainInvestIds?: OrgCorporationId[] | null
  mainInvestNames?: string[] | null
  remark?: string | null
  status?: number | null
  /** 列表页按该字段禁用选择/删除；详情接口不返回该字段。 */
  useNumber?: number
  isDel?: number | null
  creator?: OrgCorporationId | null
  createTime?: string | number | null
  updater?: OrgCorporationId | null
  updateTime?: string | number | null
  tenantId?: OrgCorporationId | null
  [key: string]: unknown
}

export type OrgCorporationRow = OrgCorporationRecord & { useNumber: number }
export type OrgCorporationDetail = OrgCorporationRecord
export type OrgCorporationOption = { id: OrgCorporationId; name: string }

export type OrgCorporationQuery = {
  name?: string
  mainInvest?: string
  pageNo?: number
  pageSize?: number
  order?: string
  orderField?: string
}

/** 页面创建表单只有这三个字段；额外字段不会被带入新建请求。 */
export type OrgCorporationDraft = {
  name: string
  mainInvestIds?: OrgCorporationId[] | null
  remark?: string | null
}

/**
 * 编辑页 customLoad 会把详情 DTO 整体放入表单，customSubmit 只删除三个旧投资主体字段。
 * 因而这里允许携带详情中的服务端字段，并在 update 时保留它们，以复刻页面请求体。
 */
export type OrgCorporationUpdateDraft = OrgCorporationDraft & {
  id: OrgCorporationId
  [key: string]: unknown
}

export type OrgCorporationIds = { ids: OrgCorporationId[] }
export type OrgCorporationDelete = OrgCorporationIds & { smsRequestId?: string; code?: string }
export type OrgCorporationDeletePreparation = {
  ids: OrgCorporationId[]
  verificationRequired: boolean
  phone: string | null
}

export type OrgCorporationOptionQuery = { keyword: string }

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`)
  }
  return value as JsonObject
}

function idOf (value: unknown, label: string): OrgCorporationId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为安全正整数或其十进制字符串`)
}

function uniqueIds (input: OrgCorporationIds): OrgCorporationId[] {
  if (input === null || typeof input !== 'object' || !Array.isArray(input.ids) || input.ids.length === 0) {
    throw new Error('ids 至少包含一个法人 ID')
  }
  const seen = new Set<string>()
  const result: OrgCorporationId[] = []
  input.ids.forEach((value, index) => {
    const normalized = idOf(value, `ids[${index}]`)
    const key = String(normalized)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(normalized)
    }
  })
  return result
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value === undefined ? fallback : value
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  return result as number
}

function textFilterOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function queryOf (input: OrgCorporationQuery = {}): Required<OrgCorporationQuery> {
  const value = input ?? {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('法人列表查询条件必须是对象')
  return {
    order: textFilterOf(value.order, 'order'),
    orderField: textFilterOf(value.orderField, 'orderField'),
    name: textFilterOf(value.name, 'name'),
    mainInvest: textFilterOf(value.mainInvest, 'mainInvest'),
    pageNo: pageNumberOf(value.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(value.pageSize, 20, 'pageSize'),
  }
}

function requiredName (value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 50) {
    throw new Error('法人名称必填、不得全为空格且最多 50 个字符')
  }
  return value
}

function remarkOf (value: unknown): string {
  const remark = value === undefined || value === null ? '' : value
  if (typeof remark !== 'string' || remark.length > 200 || (remark !== '' && !remark.trim())) {
    throw new Error('备注最多 200 个字符且不得全为空格')
  }
  return remark
}

/** 复刻编辑页：非数组值变成 []；数组中的选择值仍必须是合法法人 ID。 */
function mainInvestIdsOf (value: unknown): OrgCorporationId[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => idOf(item, `mainInvestIds[${index}]`))
}

function createPayloadOf (input: OrgCorporationDraft): { name: string; mainInvestIds: OrgCorporationId[]; remark: string } {
  const value = objectOf(input, '创建法人输入')
  return {
    name: requiredName(value.name),
    mainInvestIds: mainInvestIdsOf(value.mainInvestIds),
    remark: remarkOf(value.remark),
  }
}

function updatePayloadOf (input: OrgCorporationUpdateDraft): JsonObject {
  const value = objectOf(input, '编辑法人输入')
  idOf(value.id, 'id')
  const payload: JsonObject = { ...value }

  // This is the exact customSubmit projection in [mode]/[id].vue.
  delete payload.mainInvest
  delete payload.mainInvestName
  delete payload.mainInvestNames

  payload.id = value.id
  payload.name = requiredName(value.name)
  payload.mainInvestIds = mainInvestIdsOf(value.mainInvestIds)
  payload.remark = remarkOf(value.remark)
  return payload
}

function pageOf (value: unknown): PageResult<OrgCorporationRow> {
  const page = objectOf(value, '法人列表响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) {
    throw new Error('法人列表响应缺少有效list或total')
  }
  return page as unknown as PageResult<OrgCorporationRow>
}

function detailOf (value: unknown): OrgCorporationDetail {
  const detail = objectOf(value, '法人详情响应')
  // customLoad always gives the form a multiple-select-compatible array.
  return {
    ...detail,
    mainInvestIds: Array.isArray(detail.mainInvestIds) ? detail.mainInvestIds as OrgCorporationId[] : [],
  } as OrgCorporationDetail
}

function optionsOf (value: unknown): OrgCorporationOption[] {
  if (!Array.isArray(value)) throw new Error('法人候选响应必须是数组')
  return value.map((item, index) => {
    const option = objectOf(item, `法人候选[${index}]`)
    return {
      id: idOf(option.id, `法人候选[${index}].id`),
      name: typeof option.name === 'string' ? option.name : (() => { throw new Error(`法人候选[${index}].name必须是字符串`) })(),
    }
  })
}

type SensitiveConfig = { mobile?: string | null; isDel?: number | null }

function sensitiveState (value: unknown): { verificationRequired: boolean; phone: string | null } {
  if (value === null || value === undefined) return { verificationRequired: false, phone: null }
  const sensitive = objectOf(value, '敏感操作配置') as SensitiveConfig
  const emptyState = sensitive.mobile === undefined && sensitive.isDel === undefined
  return {
    // Exact useSensitiveAction branch: only empty state or numeric isDel === 1 skips SMS.
    verificationRequired: !(emptyState || sensitive.isDel === 1),
    phone: sensitive.mobile || null,
  }
}

function keywordOf (input: OrgCorporationOptionQuery): string {
  if (input === null || typeof input !== 'object' || typeof input.keyword !== 'string' || !input.keyword.trim()) {
    throw new Error('法人候选查询必须提供非空 keyword')
  }
  return input.keyword
}

/**
 * The page's selector currently fetches all available legal persons and filters locally.
 * The headless SDK deliberately requires a keyword for this long option list (conventions §11)
 * while using the same endpoint and its supported `name` filter.
 */
export function createOrgCorporationCapability (request: PortalRequest) {
  async function prepareRemove (input: OrgCorporationIds): Promise<OrgCorporationDeletePreparation> {
    const ids = uniqueIds(input)
    const sensitive = await request<SensitiveConfig | null | undefined>({ url: '/org/sensitive/info', method: 'get' })
    return { ids, ...sensitiveState(sensitive) }
  }

  return {
    async list (input: OrgCorporationQuery = {}): Promise<PageResult<OrgCorporationRow>> {
      return pageOf(await request<unknown>({ url: `${ROOT}/page`, method: 'get', params: queryOf(input) }))
    },

    async get (input: { id: OrgCorporationId }): Promise<OrgCorporationDetail> {
      const id = idOf(input?.id, 'id')
      return detailOf(await request<unknown>({ url: `${ROOT}/${id}`, method: 'get' }))
    },

    async mainInvestOptions (input: OrgCorporationOptionQuery): Promise<OrgCorporationOption[]> {
      const keyword = keywordOf(input)
      return optionsOf(await request<unknown>({ url: OPTIONS_URL, method: 'get', params: { name: keyword } }))
    },

    async create (input: OrgCorporationDraft): Promise<void> {
      await request({ url: `${ROOT}/save`, method: 'post', data: createPayloadOf(input) })
    },

    async update (input: OrgCorporationUpdateDraft): Promise<void> {
      await request({ url: `${ROOT}/save`, method: 'post', data: updatePayloadOf(input) })
    },

    prepareRemove,

    async sendDeleteCode (input: OrgCorporationIds): Promise<{ smsRequestId: string }> {
      const prepared = await prepareRemove(input)
      if (!prepared.verificationRequired) throw new Error('当前删除不需要短信验证，请直接 remove')
      if (!prepared.phone) throw new Error('敏感操作未配置接收手机号，无法发送验证码')
      const sent = await request<{ requestId?: string | number }>({
        url: '/sys/sms/send',
        method: 'get',
        params: { phone: prepared.phone, templateId: '17709' },
      })
      if (sent?.requestId === undefined || sent.requestId === null || !String(sent.requestId).trim()) {
        throw new Error('短信响应缺少 requestId；发送结果不确定，不自动重发')
      }
      return { smsRequestId: String(sent.requestId) }
    },

    async remove (input: OrgCorporationDelete): Promise<void> {
      const prepared = await prepareRemove(input)
      if (prepared.verificationRequired) {
        if (typeof input.smsRequestId !== 'string' || !input.smsRequestId.trim() || typeof input.code !== 'string' || !input.code.trim()) {
          throw new Error('删除需要短信验证：先 sendDeleteCode，再提供 smsRequestId 和用户收到的 code')
        }
        await request({ url: '/sys/sms/checkSms', method: 'get', params: { requestId: input.smsRequestId, code: input.code } })
      }
      await request({ url: ROOT, method: 'delete', data: prepared.ids })
    },
  }
}

export type OrgCorporationCapability = ReturnType<typeof createOrgCorporationCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const idsParam = p('ids', 'text', true, '法人库主键数组；单删也传一个元素')
const draftParams: ParamSpec[] = [
  p('name', 'text', true, '法人名称；不得全为空格，最多50个字符'),
  p('mainInvestIds', 'text', false, '法人库中的可用投资主体 ID 数组；页面未选择时发送[]'),
  p('remark', 'text', false, '备注；最多200个字符，未填时发送空字符串'),
]

export const HR_ORG_CORPORATION_METHODS = {
  'hr-org-corporation-list': 'list',
  'hr-org-corporation-get': 'get',
  'hr-org-corporation-main-invest-options': 'mainInvestOptions',
  'hr-org-corporation-create': 'create',
  'hr-org-corporation-update': 'update',
  'hr-org-corporation-prepare-remove': 'prepareRemove',
  'hr-org-corporation-send-delete-code': 'sendDeleteCode',
  'hr-org-corporation-remove': 'remove',
} as const

export const hrOrgCorporationCapabilities: CapabilityDefinition[] = [
  {
    id: 'hr-org-corporation-list',
    title: '查询法人列表',
    write: false,
    params: [
      p('name', 'text', false, '法人名称包含筛选'),
      p('mainInvest', 'text', false, '投资主体法人名称包含筛选'),
      p('pageNo', 'number', false, '从1开始，默认1'),
      p('pageSize', 'number', false, '正整数，默认20'),
      p('order', 'text', false, 'renren 排序方向占位值，页面默认空字符串'),
      p('orderField', 'text', false, 'renren 排序字段占位值，页面默认空字符串'),
    ],
  },
  { id: 'hr-org-corporation-get', title: '读取法人编辑详情', write: false, params: [p('id', 'text', true, '法人库主键')] },
  { id: 'hr-org-corporation-main-invest-options', title: '按关键字查询法人投资主体候选', write: false, params: [p('keyword', 'search', true, '非空关键字；避免无头调用全量候选')] },
  { id: 'hr-org-corporation-create', title: '创建法人', write: true, params: draftParams },
  { id: 'hr-org-corporation-update', title: '编辑法人', write: true, params: [p('id', 'text', true, '法人库主键'), ...draftParams] },
  { id: 'hr-org-corporation-prepare-remove', title: '准备删除法人', write: false, params: [idsParam] },
  { id: 'hr-org-corporation-send-delete-code', title: '发送法人删除验证码', write: true, params: [idsParam] },
  { id: 'hr-org-corporation-remove', title: '删除法人', write: true, params: [idsParam, p('smsRequestId', 'text', false, '敏感配置要求短信时使用本次发送结果'), p('code', 'text', false, '敏感配置要求短信时使用收件人提供的验证码')] },
].map(definition => ({
  ...definition,
  pagePath: ORG_CORPORATION_PAGE_PATH,
  permission: ORG_CORPORATION_PERMISSION,
  httpInstance: 'platform',
}))

const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })

const evidence: AiContract['evidence'] = [
  {
    source: 'app/portal/views/dashboard/hr/org/corporation/list.vue 与 [mode]/[id].vue @ Portal test/portal/main 3622e02147',
    kind: 'reference',
    note: '证明列表默认筛选、分页、useNumber 禁选、单删/批删、编辑入口、表单校验和 save 请求体投影。',
  },
  {
    source: 'app/portal/components/portal/finance/select/corporation/index.vue @ Portal test/portal/main 3622e02147',
    kind: 'reference',
    note: '证明编辑器使用法人库 id 多选、available-only 与 getAllLegalPerson 候选请求；SDK 对长候选增加关键字门槛。',
  },
  {
    source: 'HrLegalPersonController、HrLegalPersonServiceImpl、HrLegalPersonDao.xml @ Java test/test 当前检出',
    kind: 'reference',
    note: '证明 page/getAllLegalPerson/get/save/delete、租户范围、投资主体关系校验、同名校验和删除占用保护。',
  },
  {
    source: 'src/capabilities/org-corporation.ts 与 test/org-corporation.test.ts',
    kind: 'test',
    note: '离线锁定请求顺序、请求体投影、前端静态规则、负例和 AI 契约结构；不等同于真实测试环境冒烟。',
  },
]

const gaps = [
  '尚未在本节点执行真实测试环境列表、创建、编辑、删除闭环；需要主代理接线后以当前会话在测试租户执行并记录 prepare→submit→verify→cancel/cleanup 证据。',
  '短信配置为启用时的真实发送、真人收件、验证码校验和带验证码删除未实测；离线测试只覆盖请求顺序和失败阻断。',
]

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', 'Portal 成功包络没有业务返回值；SDK 以 Promise 正常完成表示请求完成')],
  empty: '成功结果为 undefined；不包含新建 ID、修改后详情或删除数量。失败抛错。',
}

const recordFields = (prefix: string, includeUseNumber: boolean): AiField[] => {
  const at = (name: string) => prefix ? `${prefix}.${name}` : name
  const fields: AiField[] = [
    field(at('id'), 'string | number', '法人库主键；用于详情、编辑和删除，不能替换成组织 ID'),
    field(at('name'), 'string', '法人名称'),
    field(at('mainInvestIds'), 'array', '投资主体法人库 ID 数组；编辑表单的多选值', { optional: true, nullable: true, nullMeaning: '历史响应没有关联投资主体；编辑前 SDK 归一为[]' }),
    field(at('mainInvestNames'), 'string[]', '投资主体法人名称数组；列表按“、”连接展示', { optional: true, nullable: true, nullMeaning: '没有可展示的投资主体名称时回退 legacy mainInvestName 或横杠' }),
    field(at('mainInvestName'), 'string', '兼容旧字段；列表仅在 mainInvestNames 为空时回退展示，不能作为编辑提交字段', { optional: true, nullable: true, nullMeaning: '没有旧的单值名称' }),
    field(at('mainInvest'), 'string | number', '兼容旧字段；不能作为编辑提交字段', { optional: true, nullable: true, nullMeaning: '多选或未选择投资主体时为空' }),
    field(at('remark'), 'string', '备注；列表为空值显示横杠', { optional: true, nullable: true, nullMeaning: '未填写备注' }),
    field(at('superOrganizationId'), 'string | number', '后端详情中的上级组织 ID，不是法人库主键', { optional: true, nullable: true, nullMeaning: '没有关联上级组织' }),
    field(at('superOrganizationName'), 'string', '上级组织名称', { optional: true, nullable: true, nullMeaning: '没有关联上级组织' }),
    field(at('status'), 'integer', '后端状态值；候选接口只返回 status=0 的可用法人', { optional: true, nullable: true, nullMeaning: '历史响应缺少状态' }),
    field(at('isDel'), 'integer', '逻辑删除标记；列表/候选只返回未删除记录', { optional: true, nullable: true, nullMeaning: '响应未带该审计字段' }),
    field(at('creator'), 'string | number', '创建人 ID', { optional: true, nullable: true, nullMeaning: '响应未带该审计字段' }),
    field(at('createTime'), 'string | number', '创建时间', { optional: true, nullable: true, nullMeaning: '响应未带该审计字段' }),
    field(at('updater'), 'string | number', '最后修改人 ID', { optional: true, nullable: true, nullMeaning: '响应未带该审计字段' }),
    field(at('updateTime'), 'string | number', '最后修改时间', { optional: true, nullable: true, nullMeaning: '响应未带该审计字段' }),
    field(at('tenantId'), 'string | number', '所属租户 ID；由当前会话租户决定，不作为用户可替换范围', { optional: true, nullable: true, nullMeaning: '响应未带该审计字段' }),
  ]
  if (includeUseNumber) fields.splice(7, 0, field(at('useNumber'), 'integer', '当前被组织关联的计数；页面只有数值0的行可勾选/点击删除'))
  return fields
}

function contract (
  purpose: string,
  effect: AiContract['effect'],
  inputs: Record<string, AiParameter>,
  output: AiContract['output'],
  consume: string[],
  extra: Partial<AiContract> = {},
): AiContract {
  const base: AiContract = {
    purpose,
    whenToUse: purpose,
    effect,
    inputs,
    output,
    consume,
    boundaries: [
      '仅覆盖 Portal 人力 / 组织管理 / 法人管理 PC 页当前可达的列表、候选、读取、创建、编辑、敏感验证删除动作。',
      '使用当前会话用户与租户的 platform 请求；permission 只是页面入口权限，不能替换后端租户与关联占用校验。',
      '列表页和编辑页都归一到 /dashboard/org/corporation/list，module-type 由 SDK 按 pagePath 推导为组织管理模块11；不要手工改成其他模块。',
      '页面没有 buttonPermissionFlag 独立按钮码；“编辑/创建/删除”是否可见由菜单权限控制，删除行还受 useNumber===0 控制。',
    ],
    prerequisites: ['已创建绑定当前用户会话 token、tenantId 和权限上下文的 SDK。', '法人 ID 必须来自当前租户的法人库数据；投资主体 ID 必须来自可用法人候选。'],
    steps: [],
    completion: '交付 SDK 本次请求的返回值；写操作必须按契约中的列表或详情回查确认业务结果。',
    failures: ['权限、登录、网络或后端业务错误原样抛出，不伪造成空列表或成功。保存/删除超时先回查，未确认前不自动重发。'],
    idempotency: effect === 'write' ? 'Portal save/delete 没有 SDK 或后端幂等键；失败或超时先用最新详情/分页回查，不把短信 requestId 当幂等键。' : null,
    evidence,
    gaps,
  }
  return Object.assign(base, extra)
}

const listInputs: Record<string, AiParameter> = {
  name: param('法人名称包含筛选；SDK 按页面原样发送空字符串或用户输入', '用户输入', { type: 'string', required: false, omitted: '发送空字符串表示不筛选' }),
  mainInvest: param('投资主体法人名称包含筛选；不是投资主体 ID', '用户输入', { type: 'string', required: false, omitted: '发送空字符串表示不筛选' }),
  pageNo: param('从1开始的页码', '用户分页状态', { type: 'integer', required: false, default: '1', constraints: ['必须为正整数'] }),
  pageSize: param('每页条数', '用户分页状态', { type: 'integer', required: false, default: '20', constraints: ['必须为正整数'] }),
  order: param('renren 排序方向占位值', '页面列表状态', { type: 'string', required: false, omitted: '页面默认空字符串，不猜未知排序' }),
  orderField: param('renren 排序字段占位值', '页面列表状态', { type: 'string', required: false, omitted: '页面默认空字符串，不猜未知字段' }),
}

const idsInput = param('要删除的一条或多条法人库主键；单删也必须是数组', '最新法人列表中用户选定的 list[].id', { type: 'array', required: true, constraints: ['不得为空；SDK 按字符串形式去重但保留首个 ID 的原始 string/number 类型', '应只选择 useNumber===0 的行；非0行页面禁用选择/删除'] })
const idsItemInput = param('一个法人库主键', '最新列表 list[].id', { type: 'string | number', required: true, constraints: ['正整数；长 ID 使用数字字符串'] })
const draftInputs: Record<string, AiParameter> = {
  name: param('法人名称；保留首尾空格，不自动 trim', '用户输入；编辑时先读取 hr-org-corporation-get.name', { type: 'string', required: true, constraints: ['必填、不得全为空格、最多50个字符；后端拒绝当前租户未删除记录中的同名名称'] }),
  mainInvestIds: param('投资主体法人库 ID 多选数组；不是名称数组，也不是组织 ID', '法人候选结果的 id；用户在页面多选', { type: 'array', required: false, omitted: '页面未选择时发送[]', constraints: ['数组元素必须为正整数 ID；后端只接受当前租户、未删除、可用的法人，明确传[]会清空既有关联'] }),
  remark: param('备注；保留原始字符串', '用户输入；编辑时先读取详情 remark', { type: 'string', required: false, omitted: 'SDK 发送空字符串', constraints: ['最多200个字符；允许空字符串，不允许非空且全为空格'] }),
}

export const ORG_CORPORATION_AI_CONTRACTS: Record<string, AiContract> = {
  'hr-org-corporation-list': contract(
    '分页查询当前租户可见且未逻辑删除的法人，按法人名称或投资主体名称筛选。',
    'read',
    listInputs,
    {
      shape: '{ list: OrgCorporationRecord[], total: number }',
      fields: [field('$', 'object', '法人分页响应'), field('list', 'array', '当前页记录，不是全部记录'), field('list[]', 'object', '一条法人记录'), ...recordFields('list[]', true), field('total', 'integer', '当前租户未删除法人总数；使用筛选时是筛选后的总数')],
      empty: 'list=[] 表示当前页没有记录；total=0 才表示当前查询范围没有记录。请求失败抛错，不解释为空。',
    },
    ['展示 name、mainInvestNames/mainInvestName、remark；保留 list[].id 和 list[].useNumber。', '删除前只选择 useNumber 严格为0的最新列表行；不能把 useNumber 当作后端全部关联类型的最终保证。'],
    {
      steps: [{ role: 'optional', when: '用户要删除法人且已选列表行的 useNumber===0', capabilityId: 'hr-org-corporation-prepare-remove', mapping: { ids: 'result.list[].id' }, instruction: '汇集用户选中的法人库 ID；不要传法人名称或组织 ID。' }],
    },
  ),

  'hr-org-corporation-get': contract(
    '读取一条法人编辑详情，并把 mainInvestIds 归一为编辑器可用的数组。',
    'read',
    { id: param('法人库主键', 'hr-org-corporation-list 的 list[].id 或用户明确提供的 ID', { type: 'string | number', required: true, constraints: ['必须是正整数'] }) },
    { shape: 'OrgCorporationDetail', fields: [field('$', 'object', '法人详情'), ...recordFields('', false)], empty: '详情不存在或后端错误会抛错；不会返回空对象冒充不存在。' },
    ['编辑前保留详情中的 id、name、mainInvestIds、remark；更新时 SDK 按页面规则删除 mainInvest、mainInvestName、mainInvestNames 三个旧字段。'],
    { steps: [{ role: 'required', when: '用户要编辑法人', capabilityId: 'hr-org-corporation-update', mapping: { id: 'result.id', name: 'result.name', mainInvestIds: 'result.mainInvestIds', remark: 'result.remark' }, instruction: '先让用户修改页面字段，再调用 update；不把 superOrganizationId 或 tenantId 当法人 ID。' }] },
  ),

  'hr-org-corporation-main-invest-options': contract(
    '按关键字取得当前租户可用的法人库候选，用于编辑表单的 mainInvestIds 多选。',
    'read',
    { keyword: param('投资主体法人名称关键字', '用户提供的候选名称片段', { type: 'string', required: true, constraints: ['不得为空或全为空格；SDK 通过 name 参数限制服务端候选范围'] }) },
    { shape: 'OrgCorporationOption[]', fields: [field('[]', 'object', '一个可用法人候选'), field('[].id', 'string | number', '法人库主键，填入 mainInvestIds'), field('[].name', 'string', '候选显示名称')], empty: '无匹配候选返回[]；请求失败抛错。候选只投影 id/name。' },
    ['展示 name 让用户选择并保留对应 id；不能用名称或 superOrganizationId 填 mainInvestIds。', '页面组件本身当前无 keyword 全量拉取后本地搜索；SDK 遵循无头长候选约束，调用同一接口的 name 筛选，不宣称已返回全部候选。'],
  ),

  'hr-org-corporation-create': contract(
    '创建法人，保存法人名称、投资主体法人 ID 数组和备注。',
    'write',
    draftInputs,
    voidOutput,
    ['创建请求严格只投影 { name, mainInvestIds, remark }；未选择投资主体发送[]，不会把名称或旧 DTO 审计字段放进新建体。', '成功响应没有新建 ID；必须分页回查并精确核对名称、备注和投资主体关系。'],
    { steps: [{ role: 'required', when: '创建成功或超时后确认是否落库', capabilityId: 'hr-org-corporation-list', mapping: {}, instruction: '记录创建前 ID 集合，分页读取最新列表，在本地精确核对 name/remark；候选不唯一或无法确认时不自动重发。' }] },
  ),

  'hr-org-corporation-update': contract(
    '编辑法人名称、投资主体多选关系和备注。',
    'write',
    { id: param('待编辑法人库主键', 'hr-org-corporation-get.id', { type: 'string | number', required: true }), ...draftInputs },
    voidOutput,
    ['编辑页先 GET 详情；保存 POST /org/corporation/save 会保留详情 DTO 里的其他字段，但明确删除 mainInvest、mainInvestName、mainInvestNames，再把 mainInvestIds 规范为数组。', '后端按当前租户验证目标法人存在、名称不重复及每个投资主体属于当前租户且可用。'],
    { steps: [{ role: 'required', when: '修改成功或超时后确认当前值', capabilityId: 'hr-org-corporation-get', mapping: { id: 'args.id' }, instruction: '读取同一 id，核对 name、mainInvestIds 和 remark；不能把未抛错当作已核实。' }] },
  ),

  'hr-org-corporation-prepare-remove': contract(
    '准备删除一条或多条法人：去重 ID 并读取当前敏感操作配置；不执行删除。',
    'prepare',
    { ids: idsInput, 'ids[]': idsItemInput },
    { shape: '{ ids: (string | number)[], verificationRequired: boolean, phone: string | null }', fields: [field('$', 'object', '当前删除准备结果，不是锁或删除回执'), field('ids', 'array', '去重后的法人库 ID 数组'), field('ids[]', 'string | number', '一个保留原始类型的法人库 ID'), field('verificationRequired', 'boolean', '仅当敏感配置不是空且 isDel 不严格等于数值1时为true'), field('phone', 'string | null', '敏感配置 mobile；需要验证时用于发送短信', { nullable: true, nullMeaning: '未配置手机号或无需验证' })], empty: 'ids 为空在发请求前失败；配置为空可以返回 verificationRequired=false。' },
    ['仅对来自最新列表且 useNumber=0 的 ID 继续；prepare 不锁定组织/投资主体引用，DELETE 时后端仍会再次拒绝被使用的法人。'],
    { steps: [{ role: 'required', when: 'verificationRequired=true 且用户确认发送短信', capabilityId: 'hr-org-corporation-send-delete-code', mapping: { ids: 'result.ids' }, instruction: '发送至当前配置手机号，不允许调用方替换收件人。' }, { role: 'optional', when: 'verificationRequired=false 且用户确认删除', capabilityId: 'hr-org-corporation-remove', mapping: { ids: 'result.ids' }, instruction: '将完整准备结果传入 remove；remove 会重新读取敏感配置。' }] },
  ),

  'hr-org-corporation-send-delete-code': contract(
    '向法人删除敏感配置中的手机号发送一次删除验证码。',
    'write',
    { ids: idsInput, 'ids[]': idsItemInput },
    { shape: '{ smsRequestId: string }', fields: [field('$', 'object', '短信发送结果，不是删除结果'), field('smsRequestId', 'string', '服务端 requestId；不是法人 ID，也不是 SDK 幂等键')], empty: '响应缺少 requestId 会失败；短信可能已发送，不自动重发。' },
    ['只在 prepareRemove 返回 verificationRequired=true 且用户明确要求发送时调用；验证码必须由真人收件人提供。', '固定使用 `/sys/sms/send`、配置手机号和 templateId=17709。'],
    { idempotency: '没有幂等包装；短信服务可能按手机号限频。超时先等待用户收件并核实，不立即重发。', steps: [{ role: 'required', when: '用户提供本次短信验证码并继续删除同一批法人', capabilityId: 'hr-org-corporation-remove', mapping: { ids: 'args.ids', smsRequestId: 'result.smsRequestId', code: 'user.code' }, instruction: 'code 只能来自真人本次收到的短信，不能猜测或记录；保持同批 ids。' }] },
  ),

  'hr-org-corporation-remove': contract(
    '按当前敏感配置完成必要短信校验后，批量逻辑删除法人。',
    'write',
    { ids: idsInput, 'ids[]': idsItemInput, smsRequestId: param('本次发送验证码的 requestId，不是幂等键', 'hr-org-corporation-send-delete-code.smsRequestId', { type: 'string', required: false, requiredWhen: 'verificationRequired=true' }), code: param('真人收到的短信验证码', '用户提供，不可推测', { type: 'string', required: false, requiredWhen: 'verificationRequired=true', constraints: ['不要写入日志'] }) },
    voidOutput,
    ['remove 重新读取敏感配置；需要验证时先 GET `/sys/sms/checkSms` 成功，再 DELETE `/org/corporation`，body 永远是去重后的 ID 数组。', '后端会阻止已被组织、标准化单元或其他投资主体引用的法人；整批中任一占用可能导致整批失败。'],
    { steps: [{ role: 'required', when: '删除成功或超时后确认业务结果', capabilityId: 'hr-org-corporation-list', mapping: {}, instruction: '按删除前筛选条件分页读取全部结果，核对每个目标 ID 已不存在；未核实前不重发。' }], failures: ['缺验证码、验证码错误或敏感配置无手机号：DELETE 不应发出，先取得本次有效验证码或停止。', '后端报告被组织/标准化单元/投资主体使用：整批删除失败，不绕过保护；先解除引用再重新读取列表。'] },
  ),
}

export const ORG_CORPORATION_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(HR_ORG_CORPORATION_METHODS).map(([capabilityId, method]) => [
    `orgCorporation.${method}`,
    {
      ...ORG_CORPORATION_AI_CONTRACTS[capabilityId]!,
      boundaries: [...ORG_CORPORATION_AI_CONTRACTS[capabilityId]!.boundaries, '直接方法签名为一个参数对象；字段名与 inputs 一致，list 可省略参数对象。'],
    },
  ]),
)

// Names used by the eventual shared catalog wiring; aliases keep this page unit self-contained.
export const HR_ORG_CORPORATION_AI_CONTRACTS = ORG_CORPORATION_AI_CONTRACTS
export const HR_ORG_CORPORATION_METHOD_CONTRACTS = ORG_CORPORATION_METHOD_CONTRACTS
