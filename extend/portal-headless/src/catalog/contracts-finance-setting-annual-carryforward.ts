import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_ANNUAL_CARRYFORWARD_METHODS } from '../capabilities/finance-setting-annual-carryforward.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path, type, meaning, optional: false, nullable: false, ...extra,
})

const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning, source, required: true, ...extra,
})

const statusOptions = [
  { value: 0, label: '未结转' },
  { value: 1, label: '已结转' },
]

const accountingSetIds = input(
  'Portal写入载荷中的accountingSetIds数组；批量操作来自页面账套选择器，单条按钮按Portal源码使用列表行id。',
  '批量：用户在本页“账套”选择器中选择；单条：finance-setting-annual-carryforward-list.list[].id',
  {
    type: 'array<string | number>',
    constraints: ['至少一个元素；每个元素是安全正整数或无前导零的正整数字符串；同一次调用不得重复；长ID保留字符串。'],
  },
)

const actionPeriodYear = input(
  '要结转或取消结转的会计年度。',
  '批量结转弹窗的toYear、取消结转弹窗的cancelYear，或从最新列表行periodYear取得',
  {
    type: 'string | integer',
    format: 'YYYY或对应四位整数',
    constraints: ['必须是1000至9999的四位年份；transfer省略时按Asia/Shanghai门户当前年；cancel-transfer必须提供。'],
  },
)

const listPeriodYear = input(
  '列表按会计年度筛选。',
  '用户在本页“会计期间”年份选择器选择',
  {
    type: 'string',
    required: false,
    format: 'YYYY',
    omitted: 'SDK按Portal表单默认发送Asia/Shanghai门户当前年；不建议用空字符串代替当前年。',
    constraints: ['必须是四位年份；不能传四位以外的日期或时间。'],
  },
)

const closingStatus = input(
  '列表按结转状态筛选；0为未结转，1为已结转。',
  '用户在本页“结转状态”选择器选择，未选择时省略',
  {
    type: 'integer',
    required: false,
    options: statusOptions,
    omitted: '不按状态筛选；SDK保留请求对象中的undefined，HTTP序列化时省略该URL参数。',
    constraints: ['只能传数值0或1，不能传标签文字、布尔值或null。'],
  },
)

const pageNo = input('从1开始的页码。', '调用方分页状态', {
  type: 'integer',
  required: false,
  omitted: 'SDK默认1。',
  constraints: ['必须为正整数。'],
})

const pageSize = input('当前页请求条数。', '调用方分页需要', {
  type: 'integer',
  required: false,
  omitted: 'SDK默认20，与Portal styleV2列表默认值一致。',
  constraints: ['只能取页面支持的10、20、50或100；不接受-1全量。'],
})

const evidence: AiContract['evidence'] = [
  {
    source: 'generated/page-catalog.json item 6430a9',
    kind: 'reference',
    note: '锁定页面路径、菜单权限、声明式getDataListURL列表形态、write=true、menuSource及moduleType=null；生成物未在本任务中修改。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc76c73c5eb9252be84b9b39b3900b48e app/portal/views/dashboard/finance/setting/annual-carryforward/list.vue 与 components/modal-{batch-transfer,batch-cancel}.vue',
    kind: 'reference',
    note: '静态锁定筛选表单、列表列、三个HTTP路径、批量表单必填规则、页面按钮权限、单条按钮载荷及当前单条动作将record.id作为账套ID的源码风险；没有浏览器实测。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194e63c33cfd7ef9df4360355ff13533 AnnualClosingController/Service/Mapper/VO',
    kind: 'reference',
    note: '静态锁定page/close/cancel-close的请求字段、状态值、分页结果字段、组织范围过滤及结转/取消结转业务错误；没有真实后端写验证。',
  },
  {
    source: 'src/capabilities/finance-setting-annual-carryforward.ts',
    kind: 'implementation',
    note: '锁定SDK字段投影、参数校验、Asia/Shanghai当前年、请求键序、platform实例与moduleType=null；不替代真实Portal基准。',
  },
  {
    source: 'test/finance-setting-annual-carryforward.test.ts',
    kind: 'test',
    note: '离线锁定页面目录元数据、请求契约、响应投影、HTTP头、动作载荷和契约映射；测试不会证明真实环境权限或写入效果。',
  },
]

const gaps = [
  '本轮按用户要求未启动浏览器，未生成该页脱敏baseline；请求键序和module-type结论来自Portal源码、HTTP实现与离线断言，不称为浏览器实测。',
  '未执行真实环境读冒烟，也未执行prepare→transfer→cancel的真实写闭环；写接口虽然有反向业务动作，但cancel受“下一年度已有凭证”条件约束，且没有独立cleanup证据。',
  'Portal检出固定分支当前提交落后origin/test/portal/main两个提交，Java检出落后origin/test/test十二个提交；因本任务禁止pull，以上静态结论以当前检出为准，未声称覆盖远端新增代码。',
  'Portal单条结转/取消源码把record.id放入accountingSetIds，而后端响应同时提供accountingSetId；SDK按调用方传入值原样发送，以保持与Portal的请求载荷一致。record.id与accountingSetId是否相等、以及后端最终按哪个值生效，未做真实环境验证。',
]

function contract (
  purpose: string,
  effect: AiContract['effect'],
  inputs: Record<string, AiParameter>,
  output: AiContract['output'],
  consume: string[],
  steps: AiContract['steps'],
  completion: string,
  extra: Partial<AiContract> = {},
): AiContract {
  return {
    purpose,
    whenToUse: '操作门户“财务设置→年度账结转”PC页面；只覆盖该列表页的查询、批量/单条结转和批量/单条取消结转，不覆盖其嵌套期初余额详情页。',
    boundaries: [
      '页面目录permission为/dashboard/finance/setting/annual-carryforward；按钮权限分别是finance:setting:annual-carryforward:detail、:transfer、:cancel。权限不足时不应把空列表当作无数据。',
      '页面无法从源码推导module-type；SDK与Portal一致不发送module-type。HTTP请求使用platform实例，并由统一客户端注入当前会话token、tenant-id和语言头；一个实例只服务一个用户和一个租户。',
      '列表记录同时有id和accountingSetId；批量选择器的值按页面实际返回传入，单条按钮必须复刻Portal把list[].id放进accountingSetIds的行为，不要由SDK静默替换成accountingSetId。',
      '本页没有单独创建账套、搜索账套详情或导入导出能力；长候选账套应先从本页列表或已有账套能力取得ID，不能把Portal选择器的全量拉取复制成无关键字SDK能力。',
      'close成功只返回true，不能从响应推断每个账套已落库；写后必须list回查目标年度与目标状态。cancel-close会检查下一年度凭证，不能把失败当作“取消成功”。',
    ],
    effect,
    prerequisites: [
      '已建立带有效会话token、tenant-id的SDK；账号须拥有页面菜单及当前动作对应按钮权限。',
      '写入账套ID必须来自当前租户可见的最新列表或已授权账套能力；不要跨租户复用ID。',
    ],
    inputs,
    output,
    consume,
    steps,
    completion,
    failures: [
      '账套ID为空、重复、不是正整数，年份不是四位年份，状态不是数值0/1或分页非法：SDK不发请求，修正输入后重试。',
      '401/403、网络错误或后端错误原样抛出，不改写为空列表或true；先恢复会话/权限，再按动作语义重试或回查。',
      '结转时后端可能拒绝“请先执行开账操作”或“已经结转”；应先读取目标年度及目标账套状态，不通过重复提交绕过业务校验。',
      '取消结转时后端可能拒绝“未结转/无需取消”或“已发生业务，不允许取消结转”；保留错误并停止，不把部分目标臆报为全部成功。',
      '写请求超时或断网时结果不确定：先list回查每个实际发送的accountingSetIds值对应的目标年度状态，未核实前不要盲目重发；回查仍缺失时报告未确认。',
    ],
    idempotency: effect === 'write' ? '后端没有请求幂等键；同一写意图超时后必须先回查，SDK不自动重试。' : null,
    evidence,
    gaps,
    ...extra,
  }
}

export const FINANCE_SETTING_ANNUAL_CARRYFORWARD_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-annual-carryforward-list': contract(
    '按账套、会计年度和结转状态分页查询年度账结转记录，返回页面表格字段及后续动作所需的两个ID。',
    'read',
    {
      accountingSetIds: { ...accountingSetIds, required: false, omitted: 'SDK默认发送空数组，表示不限制账套。' },
      periodYear: listPeriodYear,
      closingStatus,
      pageNo,
      pageSize,
    },
    {
      shape: '{ list: array, total: integer }',
      fields: [
        field('$', 'object', '当前筛选条件的年度账结转分页结果。'),
        field('list', 'array', '当前页记录，不是全部记录。'),
        field('list[]', 'object', '一条年度账结转记录；只保留页面列和写动作需要字段。'),
        field('list[].id', 'string | number', '年度账结转记录主键；Portal单条按钮会把它放进close/cancel-close的accountingSetIds。', {
          constraints: ['长ID保留字符串；单条操作按Portal映射，批量操作不要把列表行id当作选择器值。'],
        }),
        field('list[].accountingSetId', 'string | number', '后端响应中的账套主键；与Portal单条载荷使用的list[].id分开记录。', {
          constraints: ['长ID保留字符串；不要用它静默替换Portal单条按钮的list[].id。'],
        }),
        field('list[].tenantName', 'string', '所属企业名称。', { nullable: true, nullMeaning: '后端未关联企业名称时为null；不要用当前租户名代填。' }),
        field('list[].accountingName', 'string', '账套名称。', { nullable: true, nullMeaning: '后端未关联账套名称时为null；页面操作名称可能为空。' }),
        field('list[].accountCode', 'string', '账套编码。', { nullable: true, nullMeaning: '后端未关联账套编码时为null。' }),
        field('list[].periodYear', 'string', '年度账结转所属会计年度。', { format: 'YYYY' }),
        field('list[].closingStatus', 'integer', '结转状态绝对值。', { values: { '0': '未结转', '1': '已结转' } }),
        field('list[].closingTime', 'string', '结转发生时间，后端序列化为yyyy-MM-dd HH:mm:ss。', {
          nullable: true, nullMeaning: '未结转或后端清空结转信息时为null；不自行补当前时间。',
          format: 'YYYY-MM-DD HH:mm:ss（时区由Portal会话/后端序列化约定决定）',
        }),
        field('list[].closingByName', 'string', '执行结转的操作人显示名。', {
          nullable: true, nullMeaning: '未结转或后端清空操作人信息时为null；不把当前调用者姓名代填。',
        }),
        field('total', 'integer', '当前筛选条件下的总记录数；不是当前页长度。'),
      ],
      empty: 'list=[]且total=0表示当前筛选无记录；list=[]但total>0表示当前pageNo超出或该页为空，不代表其他筛选无数据。',
    },
    [
      '展示tenantName、accountingName、accountCode、periodYear、closingStatus、closingTime、closingByName；closingTime/closingByName为null时按空值展示。',
      '批量操作保留页面选择器返回的ID；单条操作将list[].id原样放入accountingSetIds，以复刻Portal请求。list[].accountingSetId仍作为后端响应字段独立保存，不要混淆两者。',
      '需要完整结果时保持筛选不变递增pageNo，累计达到total或返回空页后结束。',
    ],
    [
      {
        role: 'optional',
        when: '用户选择未结转记录并确认结转',
        capabilityId: 'finance-setting-annual-carryforward-prepare-transfer',
        mapping: { accountingSetIds: 'result.list[].id', periodYear: 'result.list[].periodYear' },
        instruction: '单条操作复刻Portal：把用户选定行的id放入accountingSetIds，并使用该行periodYear；批量操作则传页面选择器实际选中的账套ID。保留accountingSetId用于解释后端字段，不要静默改写单条载荷。',
      },
      {
        role: 'optional',
        when: '用户选择已结转记录并确认取消',
        capabilityId: 'finance-setting-annual-carryforward-cancel-transfer',
        mapping: { accountingSetIds: 'result.list[].id', periodYear: 'result.list[].periodYear' },
        instruction: '单条操作按Portal把用户选定行的id放入accountingSetIds，批量操作使用选择器ID；写入前刷新或确认最新closingStatus=1，取消成功仍需重新查询确认状态0及清空字段。',
      },
    ],
    '只报告已取得的分页结果；查询本身不代表任何结转写入已经发生。',
  ),

  'finance-setting-annual-carryforward-prepare-transfer': contract(
    '校验账套和年度，并生成Portal批量年度账结转弹窗对应的写入草稿；不发网络请求。',
    'prepare',
    { accountingSetIds, periodYear: { ...actionPeriodYear, required: false, omitted: 'SDK默认Asia/Shanghai门户当前年。' } },
    {
      shape: '{ draft: object, fromYear: integer, toYear: integer }',
      fields: [
        field('$', 'object', '本地结转准备结果；尚未写入。'),
        field('draft', 'object', '供transfer使用的业务草稿。'),
        field('draft.periodYear', 'integer', '结转目标年度；后端请求中的periodYear。', { format: 'YYYY' }),
        field('draft.accountingSetIds', 'array<string | number>', '结转目标账套ID数组；保留调用方ID类型和顺序。'),
        field('draft.accountingSetIds[]', 'string | number', '一个Portal写入目标ID；批量来自选择器，单条复刻页面使用年度账结转记录id。'),
        field('fromYear', 'integer', '页面只读显示的上年度，即toYear-1。', { format: 'YYYY' }),
        field('toYear', 'integer', '页面只读显示的结转目标年度。', { format: 'YYYY' }),
      ],
      empty: '合法输入始终返回包含至少一个账套ID的draft；非法输入抛错，不返回空草稿。',
    },
    [
      '先向用户展示fromYear→toYear和账套名称/ID，确认目标年度与账套；prepare没有副作用。',
      '确认后把draft.accountingSetIds和draft.periodYear原样传给transfer；不要擅自替换单条记录id或把年份改为日期时间。',
    ],
    [
      {
        role: 'required',
        when: '用户确认执行结转且草稿仍对应最新列表状态',
        capabilityId: 'finance-setting-annual-carryforward-transfer',
        mapping: { accountingSetIds: 'result.draft.accountingSetIds', periodYear: 'result.draft.periodYear' },
        instruction: '写入前建议重新list确认目标账套在该年度仍为closingStatus=0；prepare结果只证明输入已校验。',
      },
    ],
    '得到可供transfer使用的本地草稿；不因prepare返回成功而声称已经结转。',
    { idempotency: null },
  ),

  'finance-setting-annual-carryforward-transfer': contract(
    '执行指定账套指定年度的年度账结转，对应Portal批量或单条结转确认按钮。',
    'write',
    { accountingSetIds, periodYear: { ...actionPeriodYear, required: false, omitted: 'SDK默认Asia/Shanghai门户当前年；Portal批量弹窗通常显式传当前年。' } },
    {
      shape: 'true',
      fields: [
        field('$', 'boolean', '后端close成功返回true；只表示服务端接受并完成该请求，不含逐账套明细。', { values: { 'true': '请求成功' } }),
      ],
      empty: '不会返回逐账套结果；异常时抛错而不是返回false或空数组。',
    },
    [
      '请求成功后立即list查询同一periodYear和账套，逐个确认closingStatus=1；只有回查结果才可报告结转生效。',
      '记录closingTime和closingByName的变化；若只收到true但回查失败，状态应报告为未确认。',
    ],
    [
      {
        role: 'required',
        when: 'transfer返回true或请求结果不确定，需要验证终态',
        capabilityId: 'finance-setting-annual-carryforward-list',
        mapping: { accountingSetIds: 'args.accountingSetIds', periodYear: 'args.periodYear', closingStatus: 'literal:1' },
        instruction: '按每个实际发送的accountingSetIds值回查目标periodYear；参数里的数字年份转换为YYYY字符串。找到全部目标行且closingStatus=1才报告全部完成，缺失或状态不符逐项报告。',
      },
      {
        role: 'cancel',
        when: '用户明确要求撤销已核实的本次结转，且下一年度没有业务限制',
        capabilityId: 'finance-setting-annual-carryforward-cancel-transfer',
        mapping: { accountingSetIds: 'args.accountingSetIds', periodYear: 'args.periodYear' },
        instruction: '这是独立写请求，不是自动回滚；先按最新列表确认目标行closingStatus=1，再由用户明确确认取消。',
      },
    ],
    'close返回true且列表回查全部目标账套为该年度closingStatus=1；只收到true不算完成证据。',
    { idempotency: '后端没有请求幂等键；超时必须先list回查，不能盲目重复close。' },
  ),

  'finance-setting-annual-carryforward-cancel-transfer': contract(
    '取消指定账套指定年度的年度账结转，对应Portal批量或单条取消结转确认按钮。',
    'write',
    { accountingSetIds, periodYear: actionPeriodYear },
    {
      shape: 'true',
      fields: [
        field('$', 'boolean', '后端cancel-close成功返回true；只表示服务端接受并完成该请求，不含逐账套明细。', { values: { 'true': '请求成功' } }),
      ],
      empty: '不会返回逐账套结果；异常时抛错而不是返回false或空数组。',
    },
    [
      '请求前按同一periodYear和账套回查closingStatus=1，并记录原closingTime/closingByName。',
      '请求成功后重新list回查每个账套；确认closingStatus=0且closingTime、closingByName被清空或为null后才报告取消生效。',
    ],
    [
      {
        role: 'required',
        when: 'cancel-transfer返回true或请求结果不确定，需要验证终态',
        capabilityId: 'finance-setting-annual-carryforward-list',
        mapping: { accountingSetIds: 'args.accountingSetIds', periodYear: 'args.periodYear', closingStatus: 'literal:0' },
        instruction: '按每个实际发送的accountingSetIds值回查目标periodYear；只有全部目标行closingStatus=0且结转字段为空/为null才报告取消完成。',
      },
      {
        role: 'recovery',
        when: '取消请求被后端以“已发生业务，不允许取消结转”拒绝',
        capabilityId: 'finance-setting-annual-carryforward-list',
        mapping: { accountingSetIds: 'args.accountingSetIds', periodYear: 'args.periodYear' },
        instruction: '保留后端错误，不重试取消；回查并报告仍为已结转的账套。只有业务方清理/确认下一年度凭证后，才可重新评估。',
      },
    ],
    'cancel-close返回true且列表回查全部目标账套为该年度closingStatus=0并清空结转信息；只收到true不算完成证据。',
    { idempotency: '后端没有请求幂等键；超时必须先list回查，不能盲目重复cancel-close。' },
  ),

}

export const FINANCE_SETTING_ANNUAL_CARRYFORWARD_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_ANNUAL_CARRYFORWARD_METHODS).map(([capabilityId, method]) => {
    const source = FINANCE_SETTING_ANNUAL_CARRYFORWARD_AI_CONTRACTS[capabilityId]!
    return [`financeSettingAnnualCarryforward.${method}`, {
      ...source,
      boundaries: [
        ...source.boundaries,
        `公开方法签名financeSettingAnnualCarryforward.${method}(args)，单个对象参数；list可省略args。能力invoke同样使用对象，字段与inputs一致。`,
      ],
    }]
  }),
)
