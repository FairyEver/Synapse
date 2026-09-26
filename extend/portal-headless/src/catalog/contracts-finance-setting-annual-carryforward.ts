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

const detailRouteFile = 'app/portal/views/dashboard/finance/setting/annual-carryforward/detail/balance/index.vue'

const detailEvidence: AiContract['evidence'] = [
  ...evidence,
  {
    source: `CodeReview_Projects_Js@test/portal/main:acab69acc77b ${detailRouteFile} 与 detail/balance/subject-detail/index.vue`,
    kind: 'reference',
    note: '静态锁定嵌套详情页的两个请求形状（opening-balance/page 的 pageNo=1&pageSize=-1、opening-balance/detail 的四个参数）、试算按钮把 periodYear 拼成 YYYY-12、对账按钮的 POST 载荷、以及“科目”选择器 valueType=id 与后端按 code 匹配之间的字段错配；没有浏览器实测。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:0f1a55718eb AnnualClosingController 与 AnnualClosingServiceImpl#getOpeningBalancePage/getOpeningBalanceDetail/getTrialBalance',
    kind: 'reference',
    note: '静态锁定三条读接口的请求 VO、结转状态前置条件、辅助核算分支、试算平衡的固定五类与两侧合计公式；同时证明该 Controller 没有 reconcile 路由。',
  },
]

const detailGaps = [
  '本轮按任务约束未启动浏览器，也没有对测试环境发过这三个读请求；请求键序、参数名和返回字段全部来自固定检出的源码与离线断言。',
  '未执行真实环境读冒烟，也没有在真实租户上确认“未结转时返回空页”“辅助核算不匹配时返回空数组”这两个静默分支的实际表现。',
  'Portal 与 Java 固定检出未 pull 到远端最新（任务禁止 pull）；以上结论只覆盖当前检出提交。',
  '/finance/annual-closing/reconcile 在 Portal 与 Java 两个检出里都核不到对应路由，页面按钮却仍然绑着它，且失败时只 console.error —— 这个动作可能本身就是坏的；SDK 按前端契约交付并保留该缺口，调用方拿到失败是预期结果。',
  '详情页把列表行 id 当作 accountingSetId 使用（handleReset/openDetail 都如此），而后端 finance_annual_closing 的 id 与 accounting_set_id 是两个独立列；SDK 要求调用方传真正的账套ID，没有复刻页面的行 id，两者是否在部署环境里碰巧相等未验证。',
  '期初余额页“科目”筛选把科目ID塞进 subjectCode，后端按 LedgerAccountsDO.code 等值匹配；SDK 保留该参数名与页面逐字一致，但页面上的按科目筛选很可能什么都筛不出来，未在真实环境复现。',
]

function detailContract (
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
    whenToUse: '在门户“财务设置→年度账结转”列表点某行「详情」后进入的嵌套期初余额页（该页没有独立菜单项）；用于读期初余额、下钻辅助核算明细和试算平衡，以及页面上的「对账」按钮。',
    boundaries: [
      '嵌套页与列表页共用 permission /dashboard/finance/setting/annual-carryforward，能力定义沿用同一个页面上下文与 module-type 规则（无法推导时不发该头）。HTTP 走 platform 实例，路径由实例补 /admin-api。',
      '这三个读接口都以“该账套该年度的结转状态已经是已结转(1)”为前置：不满足时后端返回空页/空数组而**不报错**。所以 list=[] 不能直接解释为“没有科目”，必须先看列表行的 closingStatus。',
      'accountingSetId 必须是账套主键（finance_annual_closing.accounting_set_id），不是结转记录行 id、也不是账套名称。ID 一律来自 finance-setting-annual-carryforward-list 的返回。',
      'subjectId（科目ID）与 subjectCode（科目编码）是两个不同的主键，不能互换；辅助核算下钻用的是 subjectId，ancillaryField 必须来自该行 ancillaryAccounting 里真实出现过的字段名。',
      '试算平衡只按年末期间取数（页面固定把 periodYear 拼成 YYYY-12），SDK 不开放任意月份，也不把 isBalanced 解释为“账已平账”之外的业务结论。',
      '本组能力只覆盖页面实际发出的四个请求；页面的前端展示（两位小数、方向字典文案、虚拟滚动）不改变返回字段本身。',
      '⚠️ 这四个动作里只有期初余额、期初余额明细和试算平衡在后端核到了路由；「对账」那个 POST 在固定 Java 检出里没有对应映射（调用会失败），详见该能力自己的 gaps。',
    ],
    prerequisites: [
      '已建立带有效会话 token、tenant-id 的 SDK；账号拥有该页面菜单权限。',
      '先从 finance-setting-annual-carryforward-list 取得目标行，读到 accountingSetId 与 periodYear；并确认 closingStatus=1，否则空结果是预期的。',
    ],
    effect,
    inputs,
    output,
    consume,
    steps,
    completion,
    failures: [
      'accountingSetId/subjectId 不是正整数、periodYear 不是四位年份、ancillaryField 为空：SDK 不发请求，修正输入后重试。',
      '401/403、网络错误、响应形状错误原样抛出；不能改写成空列表或空对象。',
      '期初余额分页和明细在“未结转/科目未启用该辅助核算”时返回空结果而不报错；这不是权限错误，也不是网络失败的替代品，必须靠列表行的结转状态区分。',
      '明细接口在 subjectId 不存在时抛业务错误（科目不存在）；此时不要换一个科目重试，先核对传入的 subjectId 是否来自同一次期初余额查询。',
      '对账接口在当前后端没有路由（404 一类），失败不代表目标状态已达成；不要重试，把它当作已登记的后端能力缺口上报。',
    ],
    idempotency: effect === 'write'
      ? '对账动作在后端没有可核到的实现，也没有幂等语义；不要重试或把它与任何“已对账”状态绑定。'
      : null,
    evidence: detailEvidence,
    gaps: detailGaps,
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

  'finance-setting-annual-carryforward-opening-balance': detailContract(
    '查询指定账套指定会计年度的期初余额科目表：每行一个科目，带科目编码/名称、余额方向和期初余额，以及后续能否下钻辅助核算明细。',
    'read',
    {
      accountingSetId: input('账套ID；来自已结转的列表行 accountingSetId，不是结转记录行 id。', 'finance-setting-annual-carryforward-list.list[].accountingSetId', {
        type: 'string | number',
        constraints: ['安全正整数或无前导零的正整数字符串；不用科目名、账套名或行号代替。'],
      }),
      periodYear: input('会计期间年份，取该行的 periodYear。', 'finance-setting-annual-carryforward-list.list[].periodYear', {
        type: 'string',
        format: 'YYYY',
        constraints: ['四位年份；不能传 YYYY-MM 或日期时间。'],
      }),
      subjectCode: input('科目筛选值，原样发给后端的 subjectCode 参数。', '用户在详情页「科目」选择器选出的一项；该控件 valueType=id，所以值实际是科目ID', {
        type: 'string | number',
        required: false,
        nullable: true,
        omitted: '该 URL 参数不出现（页面 form.subjectId 为空即 undefined，被 qs 丢弃），表示不按科目筛选。',
        constraints: ['沿用页面的请求形状，SDK 不做“科目ID换成科目编码”的转换。', '后端按 LedgerAccountsDO.code 等值匹配，与页面传入的科目ID不是同一序列（见 gaps）。'],
        nullMeaning: '不清空、不筛选，等价于省略。',
      }),
    },
    {
      shape: '{ list: array, total: integer }',
      fields: [
        field('$', 'object', '期初余额科目表结果。'),
        field('list', 'array', '科目行；页面用虚拟滚动整表渲染，不分页。'),
        field('list[]', 'object', '一个启用中（status=0）的会计科目及其期初余额。'),
        field('list[].subjectId', 'string | number', '科目ID；下钻明细时作为 subjectId，不是科目编码。', { constraints: ['长ID保留字符串。'] }),
        field('list[].subjectCode', 'string | number', '科目编码（后端为 Long，可能序列化为数字或字符串）。', { nullable: true, nullMeaning: '后端未返回科目编码。' }),
        field('list[].subjectName', 'string', '科目名称；有辅助核算时页面把它渲染成可点击链接。', { nullable: true, nullMeaning: '后端未返回科目名称。' }),
        field('list[].balanceDirection', 'integer', '余额方向。', { nullable: true, values: { '1': '借', '2': '贷', '3': '平' }, nullMeaning: '后端未返回方向，页面显示占位符「—」。' }),
        field('list[].openingBalance', 'number | string', '期初余额（元），BigDecimal 原值；页面按两位小数展示，不做单位换算。', { nullable: true, nullMeaning: '后端未返回余额；页面显示 0.00。' }),
        field('list[].ancillaryAccounting', 'string', '辅助核算字段名原文（后端可能是逗号分隔的多个字段）；为空表示该科目没有辅助核算。', { nullable: true, nullMeaning: '该科目没有辅助核算，不能下钻。' }),
        field('list[].detailType', 'string', '明细下钻类型：NONE 不可下钻、SUPPLIER、CUSTOMER、BIO_PRODUCTIVE、BIO_CONSUMABLE。', { nullable: true, values: { NONE: '不可下钻', SUPPLIER: '供应商余额明细', CUSTOMER: '客户余额明细', BIO_PRODUCTIVE: '生产性生物资产', BIO_CONSUMABLE: '消耗性生物资产' }, nullMeaning: '后端未返回。' }),
        field('list[].detailApi', 'string', '明细下钻接口相对路径，如 /finance/annual-closing/supplier-balance/detail。', { nullable: true, nullMeaning: '没有下钻接口。' }),
        field('list[].detailParams', 'object', '后端建议的下钻参数；键随科目类型不同。', { nullable: true, nullMeaning: '没有建议参数。' }),
        field('list[].detailEnabled', 'boolean', '是否允许下钻；false 时页面不显示链接。', { nullable: true, nullMeaning: '后端未返回，页面按“允许”处理。' }),
        field('list[].detailLabel', 'string', '下钻入口文案，如「供应商余额明细」。', { nullable: true, nullMeaning: '后端未返回。' }),
        field('total', 'integer', '返回行数。页面按 pageSize=-1 全量取，因此它等于 list 长度，不是另一层分页总数。'),
      ],
      empty: 'list=[] 且 total=0：该账套该年度**要么没有启用中的科目，要么结转状态还不是已结转**——后端在这两种情况下都返回空页而不报错，必须回列表确认 closingStatus=1 才能区分。',
    },
    [
      '用 list[].subjectId 作为下钻参数；不要用 subjectCode，也不要从科目名推断 ID。',
      '按 balanceDirection 字典解释方向（1 借 / 2 贷 / 3 平），openingBalance 是元为单位的原值，页面只做两位小数展示，SDK 不做换算。',
      'ancillaryAccounting 为空的行不能下钻；不为空的先用该行给的方向决定要不要取明细（页面只在 ancillaryAccounting 非空时把科目名渲染成链接）。',
      'total 与 list 长度相同（全量取数），不要据此再翻页。',
    ],
    [
      {
        role: 'optional',
        when: '用户点击某个带辅助核算的科目名，要看清它按维度拆开后的期初余额',
        capabilityId: 'finance-setting-annual-carryforward-opening-balance-detail',
        mapping: { accountingSetId: 'args.accountingSetId', periodYear: 'args.periodYear', subjectId: 'result.list[].subjectId', ancillaryField: 'result.list[].ancillaryAccounting' },
        instruction: 'ancillaryAccounting 里可能有多个字段（逗号分隔），要按用户选中的那个维度传单个字段名；页面在有多个字段时用 Tab 让用户先选一个。不要传整串字段列表。',
      },
    ],
    '返回该账套该年度的期初余额科目表；读取本身不改变结转状态或科目数据。',
    { idempotency: null },
  ),

  'finance-setting-annual-carryforward-opening-balance-detail': detailContract(
    '按辅助核算维度查询指定科目在指定账套年度的期初余额明细（详情页第二层）。',
    'read',
    {
      accountingSetId: input('账套ID；来自已结转的列表行 accountingSetId。', 'finance-setting-annual-carryforward-list.list[].accountingSetId', { type: 'string | number' }),
      periodYear: input('会计期间年份，与上一层查询同一行同一值。', 'finance-setting-annual-carryforward-list.list[].periodYear', { type: 'string', format: 'YYYY' }),
      subjectId: input('科目ID；来自期初余额行的 subjectId，不是 subjectCode。', 'finance-setting-annual-carryforward-opening-balance.list[].subjectId', { type: 'string | number' }),
      ancillaryField: input('辅助核算字段名，如 supplierCode / customerCode / costCenterCode / bankAccountName；必须是该科目 ancillaryAccounting 里真实出现过的字段。', 'finance-setting-annual-carryforward-opening-balance.list[].ancillaryAccounting 拆分出的单个字段名', { type: 'string', constraints: ['非空字符串', '不能传整串逗号分隔的字段列表', '不能传中文标签'] }),
    },
    {
      shape: 'array',
      fields: [
        field('$', 'array', '该科目在该辅助核算维度下的期初余额明细；页面按 Tab 分组整表渲染。'),
        field('[]', 'object', '一条辅助核算余额记录。'),
        field('[].ancillaryCode', 'string', '辅助核算编码；随 ancillaryField 变（供应商编码/客户编码/成本中心编码/银行账户名等）。', { nullable: true, nullMeaning: '后端未返回编码。' }),
        field('[].ancillaryName', 'string', '辅助核算名称；页面第一列的标题取用户选中的维度标签。', { nullable: true, nullMeaning: '后端未返回名称。' }),
        field('[].balanceDirection', 'integer', '余额方向。', { nullable: true, values: { '1': '借', '2': '贷', '3': '平' }, nullMeaning: '后端未返回。' }),
        field('[].balance', 'number | string', '该维度的期初余额（元），BigDecimal 原值。', { nullable: true, nullMeaning: '后端未返回余额；页面显示 0.00。' }),
      ],
      empty: '[] 有三种来源：该账套该年度未结转、该科目没有该辅助核算字段、或该维度确实没有余额。三者后端都不报错，SDK 原样返回空数组，由调用方结合上一层结果判断。',
    },
    [
      '第一列用 ancillaryName、方向列用 balanceDirection 字典、金额列用 balance 原值展示；页面还允许按行继续下钻（供应商/客户/生产成本），那一步超出本能力，本能力不承诺该行一定能继续下钻。',
      '明细数组顺序即后端返回顺序，SDK 不重排、不去重。',
    ],
    [],
    '返回该科目该辅助核算维度的期初余额明细；读取不改变任何余额数据。',
    { idempotency: null },
  ),

  'finance-setting-annual-carryforward-trial-balance': detailContract(
    '按年末期间查询固定五类科目的净额试算平衡汇总，含两侧合计和是否平衡，用于页面「试算」按钮弹窗。',
    'read',
    {
      accountingSetId: input('账套ID；来自已结转的列表行 accountingSetId。', 'finance-setting-annual-carryforward-list.list[].accountingSetId', { type: 'string | number' }),
      periodYear: input('会计期间年份；页面固定拼成 ${periodYear}-12 作为后端 period，所以这里只接受四位年份。', 'finance-setting-annual-carryforward-list.list[].periodYear', { type: 'string', format: 'YYYY', constraints: ['四位年份；不能传 YYYY-MM（后端 period 由 SDK 生成）'] }),
    },
    {
      shape: '{ asset, liability, equity, cost, profitLoss, assetCostTotal, equityLiabilityProfitLossTotal, isBalanced }',
      fields: [
        field('$', 'object', '试算平衡汇总；固定五类 + 两侧合计 + 是否平衡。'),
        field('asset', 'object', '资产类合计。'),
        field('liability', 'object', '负债类合计。'),
        field('equity', 'object', '权益类合计。'),
        field('cost', 'object', '成本类合计。'),
        field('profitLoss', 'object', '损益类合计。'),
        field('assetCostTotal', 'object', '资产+成本的有符号合计项。'),
        field('equityLiabilityProfitLossTotal', 'object', '权益+负债+损益的有符号合计项。'),
        field('asset.subjectType', 'integer', '科目类型字典 account_type；五个分类项都返回自己的类型值。', { nullable: true, nullMeaning: '合计项固定为 null（后端不设类型）。' }),
        field('asset.subjectTypeName', 'string', '科目类型名称；合计项是「资产+成本合计」/「权益+负债+损益合计」。', { nullable: true, nullMeaning: '字典或后端未返回名称。' }),
        field('asset.balanceAmount', 'number | string', '该类净额的绝对值（元），BigDecimal 原值。', { nullable: true, nullMeaning: '后端未返回金额。' }),
        field('asset.balanceDirection', 'integer', '净额方向：1 借、2 贷、3 平。', { nullable: true, values: { '1': '借', '2': '贷', '3': '平' }, nullMeaning: '后端未返回方向。' }),
        field('isBalanced', 'boolean', '资产+成本 的有符号净额与 权益+负债+损益 的有符号净额互为相反数时为 true；页面据此显示“试算结果平衡/不平衡”。'),
      ],
      empty: '接口本身不会返回空对象；五个分类项在没有任何余额时各项是 0、方向为 3（平）。isBalanced 缺失或不是布尔值属于响应形状错误，SDK 直接抛错。',
    },
    [
      '页面把每项渲染成「名称 = 借/贷 金额」或「名称 = 平」，方向和金额分别取 balanceDirection 与 balanceAmount；金额按两位小数展示。',
      'isBalanced 只表示两侧有符号净额互为相反数，不代表账务“应该平”或“已经对账”；不要把它写成业务结论。',
      '页面只读展示，不提供任何修正入口；不平衡时应回到凭证/期初数据排查，而不是重复调用本能力。',
    ],
    [],
    '返回年末期间的试算平衡汇总；读取不改变账务数据。',
    { idempotency: null },
  ),

  'finance-setting-annual-carryforward-reconcile': detailContract(
    '详情页「对账」按钮：按账套和年度发起一次对账请求。⚠️ 当前后端没有该路由，调用会失败。',
    'write',
    {
      accountingSetId: input('账套ID；来自已结转的列表行 accountingSetId（页面在这里传的是结转记录行 id，SDK 不回退到那个值）。', 'finance-setting-annual-carryforward-list.list[].accountingSetId', { type: 'string | number' }),
      periodYear: input('会计期间年份，YYYY。', 'finance-setting-annual-carryforward-list.list[].periodYear', { type: 'string', format: 'YYYY' }),
    },
    {
      shape: 'undefined',
      fields: [
        field('$', 'undefined', '页面不读响应体，请求成功后直接弹「对账成功，未检查到差异」；SDK 因此不编造业务对象，成功时返回 undefined。', { nullable: true, nullMeaning: 'undefined 表示请求已被受理，不表示对账结果已核对；对账差异也从未在响应里出现。' }),
      ],
      empty: '请求失败（含当前后端缺少路由导致的 404）：抛错。undefined 不能被解释成“没有差异”。',
    },
    [
      '页面提示的「未检查到差异」是固定文案，不是响应字段；SDK 不得据此报告差异结果。',
      '需要核对余额差异时，改用期初余额与试算平衡两个读能力，不要依赖本能力的返回值。',
    ],
    [
      {
        role: 'recovery',
        when: '对账请求失败（当前后端没有 /finance/annual-closing/reconcile 路由，返回 404 一类错误）',
        capabilityId: 'finance-setting-annual-carryforward-trial-balance',
        mapping: { accountingSetId: 'args.accountingSetId', periodYear: 'args.periodYear' },
        instruction: '这是已登记的后端能力缺口，不是重试信号：不要重复调用本能力，改为读取试算平衡并向用户说明“对账接口在当前后端不存在”。',
      },
    ],
    '按页面契约发出对账请求并等待结束；当前固定后端没有该路由，因此正常结果就是失败。不要把它写成“已对账”，也不要用 undefined 代替差异结论。',
    { idempotency: '后端没有可核到的实现，无法说明防重或重试边界；不要重试。' },
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
