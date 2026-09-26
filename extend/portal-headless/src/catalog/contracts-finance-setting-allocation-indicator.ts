import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_ALLOCATION_INDICATOR_METHODS } from '../capabilities/finance-setting-allocation-indicator.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: false,
  nullable: false,
  ...extra,
})

const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning,
  source,
  required: true,
  ...extra,
})

const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(
  meaning,
  source,
  { required: false, omitted, ...extra },
)

const statusOptions = [{ value: 0, label: '启用' }, { value: 1, label: '停用' }]

const id = input('费用分配指标库主记录ID；不是指标名称、单位字典值或数据来源字典值', 'finance-allocation-indicator-list.list[].id', {
  type: 'string | number',
  constraints: ['安全正整数或无前导零的正整数字符串；长ID保留字符串；仅用于状态更新。'],
})

const currentStatus = input('用户所选列表行的当前绝对状态；只用于复现页面按钮条件，不是写入目标', '与id来自同一次最新finance-allocation-indicator-list的list[].status', {
  type: 'integer',
  options: statusOptions,
  constraints: ['只能传数值0或1；不能用后端原始Boolean、标签文字或旧缓存代替。'],
})

const targetStatus = input('要写入的绝对目标状态；0为启用，1为停用，不是“切换”命令', '用户明确的启用/停用意图，并与currentStatus共同决定', {
  type: 'integer',
  options: statusOptions,
  constraints: ['只能传数值0或1；必须与currentStatus相反，否则SDK不发请求。'],
})

const queryInputs: Record<string, AiParameter> = {
  quickNumber: optional('指标名称包含筛选；名称原文显示，不是指标库ID', '用户输入的指标名称片段', 'SDK发送null；platform序列化时省略该查询键，不限制指标名称', {
    type: 'string',
    nullable: true,
    nullMeaning: '不按指标名称筛选；与空字符串不同，空字符串由调用方显式传入。',
  }),
  status: optional('指标状态精确筛选；0启用、1停用', '用户筛选意图', 'SDK默认数值0，只查询启用指标；页面没有“全部”状态', {
    type: 'integer',
    options: statusOptions,
  }),
  pageNo: optional('从1开始的页码', '调用方分页状态', 'SDK默认1', { type: 'integer', constraints: ['正整数'] }),
  pageSize: optional('当前页请求条数', '调用方分页状态', 'SDK默认20，与PC styleV2列表一致', {
    type: 'integer',
    constraints: ['只能取页面支持的10、20、50或100；不接受-1全量。'],
  }),
}

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '费用分配指标库主键；状态更新时作为id使用，不是指标名称。'),
  field('list[].quickNumber', 'string', '指标名称；页面按原文显示', {
    nullable: true,
    nullMeaning: '后端没有名称值，页面文本为空；不能用ID替代名称。',
  }),
  field('list[].abstracts', 'integer', '单位字典值；页面通过voucher_indicator_unit字典翻译后显示', {
    nullable: true,
    nullMeaning: '未配置单位字典值；不要把null当成某个单位。',
    source: '后端IndicatorLibraryRespVO.abstracts；页面portal-finance-dict-label type=voucher_indicator_unit。',
  }),
  field('list[].dataSource', 'integer', '数据来源字典值；页面通过system_tenant_apply_use_system字典翻译后显示', {
    nullable: true,
    nullMeaning: '未配置数据来源字典值；不要把null推断成某个来源。',
    source: '后端IndicatorLibraryRespVO.dataSource；页面portal-finance-dict-label type=system_tenant_apply_use_system。',
  }),
  field('list[].instruction', 'string', '指标说明；页面按原文显示', {
    nullable: true,
    nullMeaning: '后端没有说明，页面显示为空。',
  }),
  field('list[].update', 'string', '更新日期；页面显示日期，不是时间戳', {
    nullable: true,
    nullMeaning: '后端未提供更新日期，页面日期为空。',
    format: 'YYYY-MM-DD（日期，无时刻；SDK不做时区换算）。',
  }),
  field('list[].status', 'integer', '指标状态；SDK把后端Boolean false/true归一为页面使用的0/1，并据此决定显示启用或停用按钮', {
    values: { '0': '启用；页面行操作显示“停用”', '1': '停用；页面行操作显示“启用”' },
    constraints: ['未知状态不映射为成功或可操作状态。'],
    source: '后端IndicatorLibraryRespVO.status为Boolean；页面以record.status真假判断并发送相反数值。',
  }),
]

const evidence: AiContract['evidence'] = [
  {
    source: 'generated/page-catalog.json:item id=2c9cf5',
    kind: 'reference',
    note: '证明页面路径、标题“费用分配指标库”、permission=/dashboard/finance/setting/allocation-indicator、kind=列表页(声明式 getDataListURL)、write=true、menuSource=app/portal/menus/finance.js、moduleType=null；生成物本身不替代运行时验证。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/allocation-indicator/list.vue',
    kind: 'reference',
    note: '证明页面表单默认quickNumber=null/status=0、styleV2分页、列字段、platform http实例、状态按钮权限finance:setting:allocation-indicator:status，以及PUT /admin-api/finance/indicator-library/update只提交id/status；本轮按任务约束未启动浏览器。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 common/libs/renren/list.js 与 app/portal/main.js',
    kind: 'reference',
    note: '证明列表请求键序为order、orderField、表单字段、pageNo、pageSize，Portal门户全局分页参数名为pageSize；不证明该页部署环境的真实抓包。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 IndicatorLibraryController/ServiceImpl/Mapper及VO',
    kind: 'reference',
    note: '证明page过滤字段与按id倒序、响应字段id/quickNumber/abstracts/dataSource/instruction/status/update、update返回Boolean true、后端没有当前页面可达的create/delete/get；Java源码版本是当前只读检出。',
  },
  {
    source: 'src/capabilities/finance-setting-allocation-indicator.ts',
    kind: 'implementation',
    note: '证明SDK的请求载荷、ID/状态/日期校验、Boolean状态归一化、页面字段投影与platform绑定；实现证据不替代浏览器或真实环境证据。',
  },
  {
    source: 'test/finance-setting-allocation-indicator.test.ts',
    kind: 'test',
    note: '离线锁定默认与筛选请求、返回字段/空值、状态绝对目标、错误拒绝、module-type缺失和AI说明结构；测试不发真实网络。',
  },
]

const gaps = [
  '本轮未启动浏览器，尚无该页独立网络基准；quickNumber=null在部署环境的最终URL序列化、真实响应字段类型和空值变体未实测。',
  '本轮未在测试环境执行PUT状态写入、列表回查或恢复；写入成功、超时不确定和逆向恢复流程仅由Portal/Java源码与离线夹具锁定，不能宣称真实写闭环完成。',
]

const boundaries = [
  '只覆盖PC页面可达的分页查询和行内启用/停用；页面没有创建、编辑、删除、导出或详情按钮，后端保留端点与其它页面调用不构成本页能力。',
  '页面目录moduleType为null，SDK不发送module-type；请求使用platform HTTP实例并由会话携带tenant-id、token和语言头，一个实例只服务一个用户/租户。',
  '列表返回只投影页面展示与状态动作需要的字段；后端响应中的updateTime等页面未消费扩展字段不作为本页契约，update是页面显示的日期字段。',
  '状态写入是PUT部分更新，只改变指定指标库记录的status；没有独立cancel URL，恢复通过同一PUT写回操作前保存的相反状态完成，不是事务回滚。',
]

function contract (
  value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'> &
    Partial<Pick<AiContract, 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>>,
): AiContract {
  return {
    whenToUse: '操作门户系统“财务设置→费用分配指标库”PC页面；不用于费用分配指标数据录入页、按名称批量取指标的list-utility入口或其它页面的指标配置。',
    boundaries,
    prerequisites: [
      '已建立带有效会话token与tenantId的SDK；账号须有该页面权限，状态写入还须有finance:setting:allocation-indicator:status按钮权限。',
    ],
    failures: [
      'SDK参数或分页响应形状校验失败时不会发请求或伪造空列表；修正quickNumber/status/分页或核对部署响应后再调用。',
      '401/403、网络或后端业务错误原样抛出，不当成空列表或状态更新成功；恢复会话/权限后读请求可重试。',
      '状态PUT返回非true时视为失败；不要把HTTP受理或其它真值当成页面成功，先按指标ID和目标status回查。',
      '状态PUT超时或断网时结果不确定；先用列表分页定位同一ID，确认已是目标status后不要重试，仍是旧status时才按当前最新行重新决定写入。',
    ],
    evidence,
    gaps,
    ...value,
  }
}

const pageOutput: AiContract['output'] = {
  shape: '{ list: array, total: integer }',
  fields: [
    field('$', 'object', '费用分配指标库分页结果'),
    field('list', 'array', '当前页指标行；不是全部匹配记录'),
    field('list[]', 'object', '一条指标库记录，只含页面展示与状态动作需要字段'),
    ...rowFields,
    field('total', 'integer', '当前quickNumber/status筛选条件下的匹配总数，不是当前页条数', { constraints: ['非负整数；用于计算是否继续翻页。'] }),
  ],
  empty: 'list=[]且total=0表示筛选范围没有指标；list=[]且total>0表示当前页没有行；权限、网络或响应校验失败抛错。',
}

export const FINANCE_ALLOCATION_INDICATOR_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-allocation-indicator-list': contract({
    purpose: '按指标名称片段和启用/停用状态分页查询费用分配指标库，并返回页面展示字段及后续状态操作所需的ID与当前状态。',
    effect: 'read',
    inputs: queryInputs,
    output: pageOutput,
    consume: [
      '按list当前页展示quickNumber、instruction和update；用voucher_indicator_unit字典解释abstracts，用system_tenant_apply_use_system字典解释dataSource，不能把字典值直接当标签。',
      '保留list[].id和list[].status；用户要启用或停用某行时，必须把同一行的id/currentStatus与用户目标status一起传给状态能力。',
      '按pageNo/pageSize翻页，直到已读取所需范围或累计行数达到total；不要把一页当成全部指标。',
    ],
    steps: [{
      role: 'optional',
      when: '用户明确要改变当前列表行的启用/停用状态',
      capabilityId: 'finance-allocation-indicator-set-status',
      mapping: { id: 'result.list[].id', currentStatus: 'result.list[].status', status: 'user.targetStatus' },
      instruction: '只选一条当前列表行；targetStatus必须是用户明确的绝对值且与该行currentStatus相反，不要把status理解成无条件切换。',
    }],
    completion: '已交付请求筛选条件下的当前页与total；本能力不改变指标库记录。',
    idempotency: null,
  }),

  'finance-allocation-indicator-set-status': contract({
    purpose: '把一条费用分配指标库记录设置为明确的启用或停用状态，并让调用方随后回查页面列表确认终态。',
    effect: 'write',
    inputs: { id, currentStatus, status: targetStatus },
    output: {
      shape: 'boolean',
      fields: [field('$', 'boolean', '后端更新接口返回的成功标志；SDK只接受true', { values: { true: 'PUT请求业务结果为成功' } })],
      empty: '后端返回true才正常完成；false、缺失或其它值都会抛错，不返回伪造成功。',
    },
    consume: [
      '提交前保存currentStatus作为恢复依据；SDK只发送{id,status}，不把currentStatus发送给后端。',
      '成功或超时后按页面筛选分页查找同一id，只有读回status等于目标status才确认状态已改变；true本身不包含更新后记录。',
    ],
    steps: [
      {
        role: 'required',
        when: 'PUT返回true或超时后需要确认状态终态',
        capabilityId: 'finance-allocation-indicator-list',
        mapping: { status: 'args.status' },
        instruction: '使用status=目标值分页读取并定位args.id；必要时沿用原quickNumber筛选但不能只凭名称第一条认领，必须核对同一ID。',
      },
      {
        role: 'cancel',
        when: '目标状态已核实且用户明确要求恢复，同时仍保存了操作前currentStatus',
        capabilityId: 'finance-allocation-indicator-set-status',
        mapping: { id: 'args.id', currentStatus: 'args.status', status: 'context.previousStatus' },
        instruction: '先列表回查同一ID当前确为args.status，再把context.previousStatus作为新的绝对目标调用；这是同一PUT端点的反向写入，不是事务回滚。',
      },
    ],
    completion: 'PUT返回true只表示后端更新调用成功；完成条件是列表回查同一指标ID的status等于目标值。恢复操作同样必须回查。',
    idempotency: '不使用requestId，后端也没有幂等键；写入是绝对status，重复同一ID/目标状态通常保持同一终态，但超时必须先回查，不能盲目重试或并发覆盖。',
  }),
}

export const FINANCE_ALLOCATION_INDICATOR_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_ALLOCATION_INDICATOR_METHODS).map(([capabilityId, method]) => {
    const source = FINANCE_ALLOCATION_INDICATOR_AI_CONTRACTS[capabilityId]!
    return [`financeAllocationIndicator.${method}`, {
      ...source,
      boundaries: [...source.boundaries, `公开方法 financeAllocationIndicator.${method} 接受单个对象参数；list可省略对象，字段与inputs一致。invoke始终使用inputs对象。`],
    }]
  }),
)
