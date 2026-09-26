import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_ACCOUNTING_PERIOD_METHODS } from '../capabilities/finance-accounting-period.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path, type, meaning, optional: false, nullable: false, ...extra,
})
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning, source, required: true, ...extra,
})

const statusOptions = [{ value: 0, label: '启用' }, { value: 1, label: '停用' }]
const id = input('会计期间主记录ID；不是年度、月度期间ID或租户ID', 'finance-accounting-period-list.list[].id 或 create 根返回值', {
  type: 'string | number',
  constraints: ['安全正整数或无前导零的正整数字符串；长ID保留字符串'],
})
const status = input('目标状态；传绝对值，不是“切换”命令', '用户意图与最新列表行status共同决定：当前0时停用传1，当前1时启用传0', {
  type: 'integer', options: statusOptions,
  constraints: ['只能传数值0或1；不得传布尔值、标签文字或直接复用过期列表状态'],
})
const startDate = input('会计期间启用日期，也是月度明细首个有效区间的开始日期', '用户在创建页选择；详情时来自list[].startDate', {
  type: 'string', format: 'YYYY-MM-DD（日期，无时刻）',
  constraints: ['创建时年份不得早于Asia/Shanghai门户当前年度；必须是有效日历日期'],
})
const endDate = input('会计期间结束日期，也是月度明细最后一个有效区间的结束日期', '用户在创建页选择；详情时来自list[].endDate', {
  type: 'string', format: 'YYYY-MM-DD（日期，无时刻）',
  constraints: ['必须与startDate同年且不早于startDate；必须是有效日历日期'],
})
const requestId = input('SDK短窗口写入防重键；不发送给Portal后端', '调用方用createRequestId()为本次创建意图生成，同一意图超时重试复用', {
  type: 'string', constraints: ['新创建意图必须换新值；同键不同载荷会被SDK拒绝；跨进程不共享'],
})
const pageNo = input('从1开始的页码', '调用方分页状态', {
  type: 'integer', required: false, omitted: 'SDK默认1', constraints: ['正整数'],
})
const pageSize = input('当前页请求条数', '调用方分页需要', {
  type: 'integer', required: false, omitted: 'SDK默认20，与PC styleV2列表一致',
  constraints: ['只能取页面支持的10、20、50、100；不接受-1全量'],
})

const monthFields = (prefix: string, requestNames: boolean): AiField[] => [
  field(`${prefix}month`, 'integer', '月序号，1表示一月、12表示十二月', { constraints: ['固定为1至12且每月一行'] }),
  field(`${prefix}${requestNames ? 'startDate' : 'start'}`, 'string', '该月有效区间开始日期；区间外月份为空字符串', {
    format: 'YYYY-MM-DD或空字符串', constraints: ['空字符串与null不同，表示该月不在本会计期间内'],
  }),
  field(`${prefix}${requestNames ? 'endDate' : 'end'}`, 'string', '该月有效区间结束日期；区间外月份为空字符串', {
    format: 'YYYY-MM-DD或空字符串', constraints: ['完整月份取自然月末；首尾月保留用户选择日期'],
  }),
]

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/accounting-period/list.vue',
    kind: 'reference',
    note: '证明年度/企业/状态筛选、默认启用、分页、创建、绝对目标启停和基于列表行进入详情；当前检出因网络不可达未能pull到远端最新。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/accounting-period/[mode]/[id].vue 与 detail/[id].vue',
    kind: 'reference',
    note: '证明创建日期约束、12个月度行算法、POST载荷与详情页只读本地展开；页面明确不能编辑。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 AccountingPeriodController/ServiceImpl/Mapper及VO',
    kind: 'reference',
    note: '证明分页过滤与倒序、create根Long ID、enableOrStop绝对状态、同租户同年仅一个启用期间；同时暴露前端month数字与Java Boolean声明冲突。当前检出因网络不可达未能pull到远端最新。',
  },
  {
    source: 'src/capabilities/finance-accounting-period.ts',
    kind: 'implementation',
    note: '证明页面字段投影、Asia/Shanghai年份边界、12行生成、请求路径与输入保护；不替代浏览器或真实环境验证。',
  },
  {
    source: 'test/finance-accounting-period.test.ts',
    kind: 'test',
    note: '离线锁定查询、创建、启停请求，月份边界、页面字段及AI映射；不等于真实Portal基准或写入闭环。',
  },
  {
    source: 'baseline/finance-accounting-period.browser.json',
    kind: 'browser',
    note: '独立会话实测列表GET逐字段为order/orderField/year/status/pageNo/pageSize且无module-type；确认非admin界面、六列、启停/详情、详情无GET、创建两日期与POST路径。未提交创建或启停。',
  },
  {
    source: 'smoke/with-portal-token.sh + createPortalHeadless 公开门面（2026-09-22）',
    kind: 'smoke',
    note: '真实测试环境通过capabilities.invoke读取启用列表并成功投影1条部署记录；用该记录日期经invoke得到12行本地详情，同时核对prepareCreate、catalog.describe/describeMethod。未创建记录、未切换状态，凭据未打印或落盘。',
  },
]

const gaps = [
  '已取得独立浏览器列表基准并完成公开SDK真实启用列表读取、单行字段投影与12行本地详情；尚未观测停用列表、空值变体和多页数据。',
  '创建页发送accountingPeriodMonthList[].month为1至12，但固定Java AccountingPeriodMonthSaveReqVO.month声明为Boolean；真实部署的反序列化与月度落库结果未验证，创建不能宣称可用。',
  'PC没有删除或编辑动作，创建后不能清理自建记录；因此未执行真实创建、启停、恢复闭环，不能以修改既有业务记录代替验证。',
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
    whenToUse: '操作门户系统“财务设置→会计期间”PC页面；不用于账套管理、当前会计月查询、年度结转或其他页面的会计期间候选。',
    boundaries: [
      '该菜单虽位于finance目录，但实时PC系统选择器将顶层无system的菜单归入目标门户系统；能力仍使用页面路径和platform HTTP实例，不改系统归属。',
      '页面无法推导module-type，SDK与浏览器一致不发送该头；仍显式携带当前会话tenant-id，一个HTTP实例只服务一个用户和租户。',
      '只覆盖当前PC可达动作：列表、详情月度展开、创建预览/保存、启用或停用。页面没有编辑、删除、导入导出、打印、上传下载或审批动作；后端存在但页面未调用的update/export/get不发布为能力。',
      '列表“企业名称”筛选只对username严格等于admin的页面用户显示；SDK保留真实查询参数，但不能据此扩大调用者后端权限。',
      '详情页使用打开时的列表行快照在本地生成12行，不读取后端月度表；查看前需要最新值时先刷新列表。',
    ],
    effect,
    prerequisites: ['已建立带有效会话token与tenantId的SDK；账号须有页面及对应按钮权限。', '写入ID和日期必须来自当前用户意图或本页最新列表，不使用样例值。'],
    inputs,
    output,
    consume,
    steps,
    completion,
    failures: [
      '日期、分页、ID或状态在SDK校验中不合法：不会发请求；修正后再调用。',
      '401/403、网络或后端业务错误原样抛出，不当成空列表、空详情或写入成功；恢复会话/权限后读请求可重试。',
      '启用某年度时已有其他启用会计期间，后端拒绝“同一年内禁止创建多个有效的会计期间数据”；刷新同年度启用列表后处理，不能通过改租户名或重复请求绕过。',
      '写请求超时或断网时结果不确定：先按年度、状态分页并以返回ID核实；未核实前不盲目创建或反复改状态。',
    ],
    idempotency: effect === 'write' ? '具体写动作的防重语义见该动作说明；后端没有请求幂等键。' : null,
    evidence,
    gaps,
    ...extra,
  }
}

export const FINANCE_ACCOUNTING_PERIOD_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-accounting-period-list': contract(
    '按年度、企业名称与启停状态分页查询会计期间，返回PC表格显示字段及动作ID。',
    'read',
    {
      year: input('年度筛选；后端按startDate年份包含匹配', '用户在年度选择器选择', {
        type: 'string', required: false, format: 'YYYY', omitted: 'SDK发送空字符串，不限制年度', constraints: ['必须为四位年份或省略'],
      }),
      tenantName: input('所属企业名称包含筛选；PC只向admin显示该输入', 'admin用户输入企业名称', {
        type: 'string', required: false, nullable: true, omitted: 'SDK发送null，HTTP序列化时不出现在URL', nullMeaning: '不按企业名称筛选',
      }),
      status: { ...status, required: false, source: '用户选择页面状态单选项', omitted: 'SDK默认数值0（启用）' },
      pageNo,
      pageSize,
    },
    {
      shape: '{ list: array, total: integer }',
      fields: [
        field('$', 'object', '当前筛选的会计期间分页'),
        field('list', 'array', '当前页记录，不是全部记录'),
        field('list[]', 'object', '一条会计期间；只含PC显示及动作需要字段'),
        field('list[].id', 'string | number', '会计期间主记录ID，用于启停；不是年度或月度期间ID'),
        field('list[].tenantName', 'string', '所属企业名称，页面原值显示', { nullable: true, nullMeaning: '接口未提供企业名称，页面为空；不能用当前租户名代填' }),
        field('list[].year', 'integer', '会计年度，由后端从startDate年份产生'),
        field('list[].startDate', 'string', '启用日期', { format: 'YYYY-MM-DD' }),
        field('list[].endDate', 'string', '结束日期', { format: 'YYYY-MM-DD' }),
        field('list[].status', 'integer', '状态绝对值', { values: { '0': '启用', '1': '停用' } }),
        field('list[].updateTime', 'string | number', '更新时间原值；PC格式化显示为YYYY-MM-DD HH:mm:ss', {
          nullable: true, nullMeaning: '接口未提供更新时间，页面显示为空', constraints: ['静态源码不能确认部署返回字符串还是时间戳；不做时区换算'],
        }),
        field('total', 'integer', '相同年度、企业名称与状态条件下的总记录数'),
      ],
      empty: 'list=[]表示当前页无记录；total=0表示当前筛选无记录。超过最后一页的空页不代表其他筛选无数据。',
    },
    ['展示所属企业、年度、启用/结束日期、状态与格式化后的更新时间；id只用于动作。', '需要完整结果时保持筛选不变递增pageNo，累计达到total或返回空页后结束。'],
    [
      {
        role: 'optional', when: '用户选择一条记录查看PC详情', capabilityId: 'finance-accounting-period-detail',
        mapping: { startDate: 'result.list[].startDate', endDate: 'result.list[].endDate' },
        instruction: '只取用户选定一行的两个日期；详情是列表快照的本地月度展开，不是后端GET。',
      },
      {
        role: 'optional', when: '用户确认改变选定记录状态', capabilityId: 'finance-accounting-period-set-status',
        mapping: { id: 'result.list[].id' },
        instruction: '只传选定一行ID；当前status=0且要停用时补目标status=1，当前status=1且要启用时补0。保存原状态供必要恢复，不把标签或布尔值传入。',
      },
    ],
    '已获得并交付所请求页及筛选范围；没有创建或改变状态。',
  ),

  'finance-accounting-period-detail': contract(
    '按PC详情页算法把会计期间日期范围展开为固定12个月度行，不发网络请求。',
    'local',
    { startDate, endDate },
    {
      shape: '{ list: array }',
      fields: [
        field('$', 'object', '本地详情结果'),
        field('list', 'array', '固定12行，顺序为1月至12月', { constraints: ['始终12行；区间外月份仍保留空日期行'] }),
        field('list[]', 'object', '一个月度期间展示行'),
        ...monthFields('list[].', false),
      ],
      empty: '合法日期范围始终返回12行，不返回空数组；非法日期抛错。区间外月份的start/end是空字符串。',
    },
    ['按month顺序展示；空start/end表示该月不在区间内，不删行、不当成null或月初月末。', '结果来自列表快照；若需要确认当前状态或日期，先重新list。'],
    [],
    '已得到与PC详情相同的12行本地展示数据；未读取月度表，也未写入。',
    { idempotency: null },
  ),

  'finance-accounting-period-prepare-create': contract(
    '校验创建日期并生成PC实际提交的12个月度期间草稿，不发写请求。',
    'prepare',
    { startDate, endDate },
    {
      shape: '{ draft: object }',
      fields: [
        field('$', 'object', '创建准备结果，尚未保存'),
        field('draft', 'object', '可传入create的页面业务草稿；create会按相同规则重新生成载荷'),
        field('draft.startDate', 'string', '启用日期', { format: 'YYYY-MM-DD' }),
        field('draft.endDate', 'string', '结束日期', { format: 'YYYY-MM-DD' }),
        field('draft.accountingPeriodMonthList', 'array', '固定12个月度提交项；保留区间外空字符串'),
        field('draft.accountingPeriodMonthList[]', 'object', '一个月度提交项'),
        ...monthFields('draft.accountingPeriodMonthList[].', true),
      ],
      empty: '合法输入返回含12项的draft；日期校验失败抛错，不返回空草稿。',
    },
    ['向用户展示12个月份及首尾日期，确认区间外月份为空；此步骤不能证明同年记录可创建。', '不要把month改成布尔值或删掉空月份；那会偏离当前PC请求。'],
    [{
      role: 'required', when: '用户核对草稿后明确要求保存', capabilityId: 'finance-accounting-period-create',
      mapping: { startDate: 'result.draft.startDate', endDate: 'result.draft.endDate', requestId: 'context.requestId' },
      instruction: '调用createRequestId()取得context.requestId；只传两个日期和requestId，create会重新生成12项，避免调用方篡改month。',
    }],
    '只完成本地校验与预览；未创建记录。',
    { idempotency: null },
  ),

  'finance-accounting-period-create': contract(
    '创建一个会计期间及PC生成的12个月度期间，返回后端分配的主记录ID。',
    'write',
    { startDate, endDate, requestId },
    {
      shape: 'string | number',
      fields: [field('$', 'string | number', '新建会计期间主记录ID，用于列表核对和启停；不是年度或月度期间ID')],
      empty: '应返回正ID；缺失或非法ID会抛错，不能当作已创建。',
    },
    ['保存根返回ID；按startDate年度及启用状态0分页查找同一ID，核对开始/结束日期。', 'PC没有删除或编辑，创建成功后不能承诺撤销或清理；未验证前不得在真实业务年份试建。'],
    [{
      role: 'required', when: '创建返回ID或写请求结果不确定，需要独立核实', capabilityId: 'finance-accounting-period-list',
      mapping: { status: 'literal:0' },
      instruction: '从args.startDate前四位得到year筛选并逐页查找result.$对应ID；核对startDate/endDate。找不到时结果仍不确定，不自动换年度重建。',
    }],
    '仅当列表独立回查同一ID且日期一致时可报告创建已核实；没有审批，但PC也没有删除/恢复动作。',
    {
      idempotency: '公开createIdempotent使用SDK进程内短窗口防重：requestId按用户/租户/能力隔离，同键同载荷复用进行中或已成功结果，同键不同载荷拒绝；不跨进程，后端无幂等键。超时先回查。',
    },
  ),

  'finance-accounting-period-set-status': contract(
    '把指定会计期间设置为启用或停用的绝对目标状态。',
    'write',
    { id, status },
    {
      shape: 'null',
      fields: [field('$', 'null', '后端成功包络data为null；只表示启停请求完成，不含更新记录或布尔结果', {
        nullable: true, nullMeaning: '成功响应没有业务数据；必须列表回查终态',
      })],
      empty: '成功返回null；失败抛错。null不是未执行，也不能替代列表回查。',
    },
    ['调用前从最新列表保存原status；传目标绝对值。', '请求完成后按目标status分页定位同一ID；只有读回目标状态才确认生效。'],
    [
      {
        role: 'required', when: '启停请求返回null或超时，需要确认终态', capabilityId: 'finance-accounting-period-list',
        mapping: { status: 'args.status' },
        instruction: '保持目标status并逐页查找args.id；如已知列表行year可同时筛选。找到同一ID且status一致才确认，未找到不等于记录不存在。',
      },
      {
        role: 'cancel', when: '本次启停已核实且用户明确要求恢复，且已保存操作前状态', capabilityId: 'finance-accounting-period-set-status',
        mapping: { id: 'args.id', status: 'context.previousStatus' },
        instruction: 'context.previousStatus必须来自操作前最新列表行且为0或1；恢复是第二次写请求，之后仍需列表回查。启用恢复可能因同年已有启用期间失败。',
      },
    ],
    '列表回查同一ID为目标status后才报告启停已核实；仅收到null只能报告请求完成。',
    {
      idempotency: '不使用requestId包装；能力写绝对目标状态，同一ID重复发送同一status的目标终态相同，但超时仍须先列表回查，不能并发反复发送。',
    },
  ),
}

export const FINANCE_ACCOUNTING_PERIOD_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_ACCOUNTING_PERIOD_METHODS).map(([capabilityId, method]) => {
    const source = FINANCE_ACCOUNTING_PERIOD_AI_CONTRACTS[capabilityId]!
    return [`financeAccountingPeriod.${method}`, {
      ...source,
      boundaries: [
        ...source.boundaries,
        `公开方法签名financeAccountingPeriod.${method}(args)，单个对象参数；list可省略args。能力invoke同样使用对象，字段与inputs一致。`,
      ],
    }]
  }),
)
