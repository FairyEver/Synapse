import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { perfSalaryCapabilities } from '../capabilities/perf-salary.js'

/**
 * 管理分析**隐藏下钻页**（`/dashboard/analysis/department/detail/item`）三条能力的 AI 契约。
 *
 * 这一页没有菜单项，由自查分析表格点「姓名」进入（`analysis/department/list.vue:625-641`
 * 的 `actionItem(record)`），三个端点都**只收 `protocolId`**、都返回**数组**。
 * 本文件是自包含的，由主线统一接线进 `src/catalog/ai-contracts.ts` ——
 * 与 `contracts-study-course.ts` 同一形态。
 *
 * ⚠️ 三条与同页已注册的 `perf-analysis-department-self-check`（`POST …/selfCheck`）
 * **不是同一个端点**，别合并：那个是按工号批量查人，这三个是按一份协议查这个人的明细。
 *
 * 三条都**没有**浏览器基准：基准抓的是页面挂载时的请求，隐藏下钻页要真的点进去才有流量。
 * 所以参数顺序与返回字段全部来自源码（前端 + 后端），逐条标在 `evidence` 与 `gaps` 里，
 * **不把它说成线上已验证**。
 */

const definitions = new Map(perfSalaryCapabilities.map(definition => [definition.id, definition]))

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: false,
  nullable: false,
  ...extra,
})

const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning,
  source,
  required: true,
  ...extra,
})

const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter =>
  param(meaning, source, { required: false, omitted, ...extra })

/**
 * 分数/金额/比重这一类 `BigDecimal` 原值的公共说明。
 *
 * 页面把分子/分母拼成 `getFraction(n, d)` 的「n/d」文本；SDK **不做这个拼接**，
 * 也不换算单位、不补齐小数位、不把 null 当 0。
 */
const decimal = (extra: Partial<AiField> = {}): Partial<AiField> => ({
  type: 'number | string',
  nullable: true,
  nullMeaning: '该维度没有数据（后端未写入），不是 0',
  constraints: ['后端 BigDecimal 原值（JSON 里可能是数字或十进制字符串）；SDK 不换算单位、不补齐小数位、不按 0 处理。'],
  ...extra,
})

const protocolIdInput = (): AiParameter => param(
  '月度双赢协议 id；下钻页三个端点都只按它查。',
  'perf-analysis-department-self-check 返回行（自查分析表格）的 protocolId —— 页面点该行姓名进入下钻页时，传的就是这一个值',
  {
    type: 'string | number',
    constraints: [
      '安全正整数或无前导零的正整数字符串；SDK 在发请求前校验，非法值直接抛错。',
      '是**月度协议** id，不是 taskId、不是指标/利润 id、不是用户 id 或工号 —— 这几类 id 在本页同时出现，不能互换。',
    ],
  },
)

const commonBoundaries = [
  '页面路径是隐藏路由 /dashboard/analysis/department/detail/item：菜单里没有它，由自查分析表格的行跳转进入；权限码与菜单页同为 /dashboard/analysis/department，不另判权限。',
  '页面上下文推导 module-type=13（绩效管理）；SDK 统一客户端负责会话 token、tenant-id、module-type 与用户隔离，调用方不要手工拼接或跨租户复用 id。',
  '这一页是**只读下钻**：三个端点都是 GET，页面上只有路由跳转，没有任何写入口。',
  '本能力返回**端点的原数组与元素原顺序**，不做页面级的重排、过滤或字段改写；页面的显示顺序规则写在 consume 里，只用于解释表格。',
  '返回的是后端字段原值；页面上的「分子/分母」拼写、`isSpecial` 的行样式、列的有无这些渲染规则都要调用方自己按 consume 复现。',
]

const commonPrerequisites = [
  '使用当前用户会话与租户创建 SDK；该用户对 /dashboard/analysis/department 有权限。',
  'protocolId 必须来自同一会话下 perf-analysis-department-self-check 的真实返回行，不能按名称或索引猜。',
]

const commonFailures = [
  'protocolId 缺失、非正整数或带前导零会在发请求前抛错，不会发出一次「空查询」。',
  '401/403、租户或数据范围、网络、后端业务错误与响应形状错误原样抛出；不能用空数组代替失败，也不能把权限错误读成「这个人没有考核内容」。',
  '只读查询在会话/网络恢复后可按同一 protocolId 重试；重试不改变服务端数据。',
]

const commonEvidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main:6ac274fc9e app/portal/views/dashboard/hr/analysis/department/detail/item.vue:110-125、127-149、153-163、220-241、244-260；list.vue:625-641',
    kind: 'reference',
    note: '核对三个下钻端点的调用形状（考核任务走 useListPageModule 且未开分页、另两个是直接 http.get）、页面显示重排规则、附件渲染字段、第二跳 targetInfo 的参数，以及隐藏路由由 actionItem 实际 push。未覆盖：本页没有任何浏览器基准。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:77fbc2a206c KpiHomepageController:256/263/290、KpiHomepageServiceImpl:1115/1127/1838、KpiMonthProtocolDao.xml:295、ProtocolDetailDTO、TargetSubassemblyDTO、TargetDataDTO、ProtocolSubassemblyDTO、ProfitSubassemblyDTO',
    kind: 'reference',
    note: '核对三个端点的 HTTP 方法、参数绑定、返回类型与 SQL 取字段；确认 selfCheckProfit 的 Controller 泛型是 Object 而实现层返回 List<ProtocolSubassemblyDTO> 且只收 type=15。固定检出静态证据，不代表该提交已部署到测试环境。',
  },
  {
    source: 'src/capabilities/perf-salary.ts',
    kind: 'implementation',
    note: '锁定能力 id、方法名、protocolId 校验，以及三处不同的 qs 参数形状（考核任务带 order/orderField，另两个只带 protocolId）与原样透传的返回。',
  },
]

const commonGaps = [
  '三条都没有浏览器基准，也没有在真实测试环境执行过；参数形状与返回字段来自前后端源码的静态推导。',
  '后端返回的真实字段集合、可空性分布与数组长度未实测（页面只消费其中一部分，其余按 Java DTO 推导）。',
]

type ContractBody = Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>

const base = (
  whenToUse: string,
  boundaries: string[],
  value: ContractBody,
  /** 该能力**独有**的缺口；公共缺口在 commonGaps 里，不重复。 */
  ownGaps: string[] = [],
): AiContract => ({
  ...value,
  whenToUse,
  boundaries: [...commonBoundaries, ...boundaries],
  prerequisites: commonPrerequisites,
  failures: commonFailures,
  evidence: commonEvidence,
  gaps: [...commonGaps, ...ownGaps],
})

const contracts: Record<string, AiContract> = {}

function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`管理分析下钻契约没有对应的能力定义：${id}`)
  contracts[id] = value
}

// ---------------------------------------------------------------------------
// 考核任务
// ---------------------------------------------------------------------------

add('perf-analysis-department-self-assessment-task-check-detail', base(
  '在管理分析的自查分析表格里选定某个人、点他的姓名进入下钻页，看这个人这份月度协议下的**考核任务**逐条明细（重点工作内容、完成说明、自评分与领导评分、附件）时使用。' +
  '与 perf-analysis-department-self-check 的区别：那个按工号查多人的分数汇总，这个必须给定**一份协议**才查得出明细。',
  [
    '每行是一条**月度任务**（hr_kpi_month_protocol_task），不是一条评分项：同一份协议里任务可以有多条，也可以一条都没有。',
    '判定「某一侧是否已评」靠**分量与基本分的比较**，不是靠分数大小：页面按 baseCoreByLeader/baseCoreOneself 是否等于 baseCore、是否为 null 把行分成三档。本能力不做这个判定，只把三个分量原样给出。',
    'isSpecial=1 的行在页面上只显示「特殊：」一列（special* 三个分量），基本/超额两段被 v-show 隐藏；这不代表基本/超额字段不存在。',
    'attachment 只给文件原值（fileName/fileUrl 等），SDK 不下载、不预览、不校验附件可达性；fileUrl 是外链，可能过期或需要登录。',
  ],
  {
    purpose: '按月度双赢协议 id 读取该协议下考核任务的逐条自查明细，含自评/领导评分的各分量与附件清单。',
    effect: 'read',
    inputs: {
      order: optional(
        '排序方向；页面上没有这个控件，是列表模块加的默认键。',
        'SDK 按页面固定值补齐',
        'SDK 发送空字符串，与浏览器一致',
        { type: 'string', default: '空字符串' },
      ),
      orderField: optional(
        '排序字段；同上，页面没有这个控件。',
        'SDK 按页面固定值补齐',
        'SDK 发送空字符串，与浏览器一致',
        { type: 'string', default: '空字符串' },
      ),
      protocolId: protocolIdInput(),
    },
    output: {
      shape: 'object[]（后端直接返回数组，不是 { list, total } 分页包络）',
      fields: [
        field('$', 'object[]', '本协议下的考核任务明细数组；元素顺序 = 后端 SQL 的返回顺序（页面渲染前还会重排，见 consume）。'),
        field('taskId', 'string | number', '月度任务 id（hr_kpi_month_protocol_task.id）；附件按它关联，不是协议 id。', { optional: true, nullable: true, nullMeaning: '后端未返回任务 id' }),
        field('title', 'string | null', '月度重点工作内容（页面「月度重点工作内容」一列）。', { nullable: true, nullMeaning: '未填写重点工作内容' }),
        field('content', 'string | null', '完成说明（SQL 取的是任务的 self_evaluation；页面「完成说明」一列）。', { nullable: true, nullMeaning: '未填写完成说明' }),
        field('baseCore', 'number | string | null', '基本分的应得分（页面「n/d」里的分母）；也是判断某一侧是否已评的基准值。', decimal()),
        field('baseCoreOneself', 'number | string | null', '自评基本分。', decimal()),
        field('baseCoreByLeader', 'number | string | null', '领导评分基本分。', decimal()),
        field('overageScore', 'number | string | null', '超额分的应得分（分母）。', decimal()),
        field('overageScoreOnSelf', 'number | string | null', '自评超额分；为 null 时页面不显示「超额：」那一行。', decimal()),
        field('overageScoreByLeader', 'number | string | null', '领导评分超额分；为 null 时同上。', decimal()),
        field('isSpecial', 'number | null', '是否特殊考核工作；1 表示特殊，特殊行页面只展示 special* 三项。', {
          nullable: true,
          nullMeaning: '后端未返回该标记（页面按普通行处理）',
          values: { '0': '普通考核工作', '1': '特殊考核工作' },
          constraints: ['页面判据是 isSpecial === 1（严格等于），不是「非空即真」'],
        }),
        field('specialScore', 'number | string | null', '特殊考核工作的应得分。', decimal()),
        field('specialSelfScore', 'number | string | null', '特殊考核工作的自评分。', decimal()),
        field('specialLeaderScore', 'number | string | null', '特殊考核工作的审核得分。', decimal()),
        field('totalSelfScore', 'number | string | null', '自评总分 = baseCoreOneself + overageScoreOnSelf + specialSelfScore（缺项按 0）。', decimal({ source: '后端把三个自评分量相加得到，不是页面自己算的' })),
        field('totalLeaderScore', 'number | string | null', '领导评分总分 = baseCoreByLeader + overageScoreByLeader + specialLeaderScore（缺项按 0）。', decimal({ source: '后端把三个领导分量相加得到' })),
        field('attachment', 'object[]', '该任务的附件列表；没有附件时是空数组（后端对每条任务都查一次附件表，查不到给空列表而不是 null）。', { optional: true, nullable: true, nullMeaning: '后端未返回该字段' }),
        field('attachment[]', 'object', '一个附件。', { optional: true }),
        field('attachment[].id', 'string | number', '附件 id。', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
        field('attachment[].taskId', 'string | number', '附件所属任务 id；与行的 taskId 相同。', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
        field('attachment[].fileName', 'string | null', '文件名；页面附件标签上显示的就是它。', { optional: true, nullable: true, nullMeaning: '后端未返回文件名' }),
        field('attachment[].fileUrl', 'string | null', '文件地址；页面用 window.open 在新窗口打开。', { optional: true, nullable: true, nullMeaning: '后端未返回地址', constraints: ['是外链，可能过期或需要登录；不要把它当成本能力已完成下载或附件一定可访问'] }),
        field('attachment[].fileType', 'number | null', '文件类型。', { optional: true, nullable: true, nullMeaning: '后端未返回类型', values: { '1': '图片', '2': '视频', '3': 'pdf', '4': '其他' } }),
        field('attachment[].fileSuffix', 'string | null', '文件后缀。', { optional: true, nullable: true, nullMeaning: '后端未返回后缀' }),
      ],
      empty: '[] 表示这份协议下没有考核任务（也可能是协议不属于当前用户的数据范围）；请求失败会抛错，不会降级成空数组。',
    },
    consume: [
      '逐条读 title/content 了解「做了什么」，再用 baseCoreOneself/baseCore 与 baseCoreByLeader/baseCore 两组分数说明自评与领导评的差异；不要只取总分。',
      '页面表格的显示顺序是**重排过**的（detail/item.vue:131-149 的 initSortData）：先放 baseCoreByLeader 不等于 baseCore 且非 null 的行，再放 baseCoreOneself 不等于 baseCore 且非 null 的行，其余在后。要按页面顺序呈现时由调用方按这条规则重排，本能力返回后端原序。',
      'isSpecial === 1 的行按 special* 三项呈现，普通行按「基本/超额」两段呈现；isSpecial 为 null 时按普通行处理。',
      '附件用 fileName 展示、fileUrl 供用户自行打开；本能力是只读的，附件不是「待提交内容」。',
      '要与「这个人这份协议的整体得分」对照时，用自查分析表格那一行（perf-analysis-department-self-check）的 assignFullExamineScoreBySelf / assignFullExamineScore / examineKeyIndicatorsScore —— 页面的头部分数不是这些任务分之和，别自己求和充当。',
    ],
    steps: [],
    completion: '交付这份协议下全部考核任务的明细（含空数组这一情形）；读取本身不修改任何状态，也不会补齐页面没拿到的东西。',
    idempotency: null,
  },
))

// ---------------------------------------------------------------------------
// 考核指标
// ---------------------------------------------------------------------------

add('perf-analysis-department-index-check-detail', base(
  '在同一张自查分析表格里点姓名进入下钻页、看这个人这份月度协议下的**考核指标**（指标名、单位、各条标准线、预测指标、考核分数）时使用。' +
  '它给的是指标的骨架；页面最终显示的那一版还要经过第二次请求，见下面的边界与 gaps。',
  [
    '每行是协议里的一个**指标组件**（TargetSubassemblyDTO），它的 targetList 是该指标下的若干条标准线；行数由协议内容决定，可能为 0。',
    '⚠️ **这一端点的数据是半成品**：页面拿到之后还会对每一行再打一次 /performance/basedata/kpitarget/targetInfo（参数 targetId = 行的 id、year = 下钻时的年）去覆盖 name/unit/actual 与整份 targetList（detail/item.vue:220-241）。本能力**只返回第一跳**的结果，SDK 目前也没有第二个端点的能力，见 gaps。',
    '行里的 `actual` 字段**后端不给**：它是页面第二跳之后自己写上去的；不要从本能力的返回里找它，也不要把 actualIndicator 当成它。',
    'isUserImport === 1 的行由后端从「考核导入」结果表拼出（KpiHomepageServiceImpl:1149-1165）：只有一条 lineName="完成线" 的标准线，且只设 forecastIndicator、**不设 expected**。把它与协议里的指标混算会得出错误的指标条数。',
    'targetList[].formula 是公式**文本**；页面本身也不在表格里渲染它，SDK 不解析、不求值。',
    '页面上每行还有一个跳转动作（点指标名跳到双赢协议详情并定位到该指标）；那是路由行为、不是接口，本能力不提供。',
  ],
  {
    purpose: '按月度双赢协议 id 读取该协议的考核指标骨架：指标名/单位/分数、各标准线名称与预测指标，以及由「考核导入」补进来的指标行。',
    effect: 'read',
    inputs: { protocolId: protocolIdInput() },
    output: {
      shape: 'object[]（后端直接返回数组；页面把它赋给 selfState，不是分页包络）',
      fields: [
        field('$', 'object[]', '本协议的考核指标数组；顺序由后端按协议小节 → 组件顺序拼出。'),
        field('id', 'string | number', '指标 id；页面用它调 targetInfo 取明细，不是协议 id、不是标准线 id。', { optional: true, nullable: true, nullMeaning: '后端未返回指标 id', constraints: ['页面在 id 为空时直接跳过该行的第二跳查询'] }),
        field('name', 'string | null', '指标名称；isUserImport=1 的行被后端改写成导入结果的名称。', { nullable: true, nullMeaning: '后端未返回名称（页面此时标题为空）' }),
        field('unit', 'string | null', '指标单位。页面在第二跳失败时回退显示「万元」，本能力**不做这个回退**。', { nullable: true, nullMeaning: '协议里没有写单位' }),
        field('score', 'number | string | null', '考核分数（页面「考核分数」一列，充当分母）。', decimal()),
        field('actualScore', 'number | string | null', '实际分数（分子）。', decimal()),
        field('actualIndicator', 'number | string | null', '实际指标；页面只要有**任意一行**有值就显示「实际指标/实际分数」两列。', decimal()),
        field('resourceType', 'number | null', '来源类型。', { nullable: true, nullMeaning: '后端未返回来源', values: { '0': '年度带的', '1': '月度新增的' } }),
        field('isUserImport', 'number | null', '1 表示这条来自「考核导入」的结果表，不是协议里的指标组件。', { nullable: true, nullMeaning: '后端未返回该标记（按协议内指标处理）', values: { '1': '导入结果拼接行' } }),
        field('targetList', 'object[]', '该指标下的标准线；isUserImport=1 的行只有一条。可能为空数组。', { optional: true, nullable: true, nullMeaning: '后端未返回（页面第二跳会整份替换它）' }),
        field('targetList[]', 'object', '一条标准线（TargetDataDTO）。', { optional: true }),
        field('targetList[].lineName', 'string | null', '标准线名称；页面「标准」一列显示的就是它。', { optional: true, nullable: true, nullMeaning: '协议里该线没有名称' }),
        field('targetList[].lineType', 'string | null', '线类型码；页面不渲染它。', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
        field('targetList[].formula', 'string | null', '公式文本。', { optional: true, nullable: true, nullMeaning: '该线没有公式' }),
        field('targetList[].dataList', 'array', '1~12 月逐月数据，下标 = 月份 - 1；页面不直接渲染它（第二跳才把某个月的值写进 expected）。', { optional: true, nullable: true, nullMeaning: '后端未返回逐月数据' }),
        field('targetList[].dataList[]', 'number | string | null', '某个月的值（BigDecimal 原值）。', { optional: true, nullable: true, nullMeaning: '该月没有数据' }),
        field('targetList[].expected', 'number | string | null', '**预测指标**；页面「预测指标」一列显示的就是它。', decimal({ optional: true })),
        field('targetList[].forecastIndicator', 'number | string | null', '预报指标。页面「预测指标」列**不**取它；只有 isUserImport=1 的行例外地只设这一项。', decimal({ optional: true })),
        field('targetList[].floatRatio', 'number | string | null', '浮动比例。', decimal({ optional: true })),
        field('targetList[].assessmentStandards', 'number | string | null', '考核标准。', decimal({ optional: true })),
      ],
      empty: '[] 表示这份协议里没有月度指标组件、也没有命中该用户的导入结果；请求失败会抛错，不降级成空数组。',
    },
    consume: [
      '先用 name/unit/score 列出指标，再按 targetList[].lineName 展开各条标准线的 expected 作为「预测指标」；只有当**至少一行** actualIndicator 有值时才呈现「实际指标 / 实际分数」两列。',
      '把 isUserImport === 1 的行单独标注：它们不来自协议指标组件、只有一条「完成线」、没有 expected —— 与协议指标混算会得出错误的指标条数。',
      '不要用 targetList[].formula 求值，也不要把它当「已校验的公式」；它是展示用的原始文本。',
      '要还原页面上那一版指标视图（单位回退、实际值、逐月预测被覆盖后的样子）还需要第二跳 /performance/basedata/kpitarget/targetInfo（targetId = 行的 id、year = 下钻时的年），SDK 尚未提供该能力，见 gaps；只凭本能力的返回不能宣称已还原页面显示。',
    ],
    steps: [],
    completion: '交付这份协议的指标骨架（含空数组这一情形）；读取不修改任何状态，也不代表页面显示已完整还原。',
    idempotency: null,
  },
  [
    '页面的第二跳 /performance/basedata/kpitarget/targetInfo（targetId = 指标 id、year = 下钻时的年）在 SDK 里**还没有对应能力**：只凭本能力拿不到页面最终显示的 name/unit/actual 与被覆盖后的整份 targetList。这是范围外的既有缺口，本轮不改。',
  ],
))

// ---------------------------------------------------------------------------
// 利润工资
// ---------------------------------------------------------------------------

add('perf-analysis-department-self-check-profit', base(
  '在同一张自查分析表格里点姓名进入下钻页、看这个人这份月度协议下的**利润工资**卡片（各条利润线、利润比重、预测/实际利润与浮动比例）时使用。',
  [
    '⚠️ Controller 的签名是 `CommonResult<Object>`；返回类型只能从实现层看：`KpiHomepageServiceImpl:1838` 返回 `List<ProtocolSubassemblyDTO>`，并**只把 `type == 15`（月度利润组件）的行收进来** ⇒ 响应里 `type` 恒为 15。别按 Controller 的 `Object` 猜结构。',
    '返回的是**组件包装行**数组（{id, type, canDel, value}），业务数据在 `value` 里；页面只取**第一条**的 value（detail/item.vue:256-260），本能力把整个数组交出去，选哪条由调用方定。',
    '`value` 的逐条利润由**共享的「月度利润」只读组件**渲染（utils/hr/agreement-blocks/contents/month/profit/read.vue），它自己还会再打两个接口（getProfitDataByYear、getVariableList）去补利润名/单位/公式变量；本能力不覆盖那两个端点。',
    '协议里没有月度利润组件时后端返回 `[]`，页面据此不渲染这张卡片 —— 空数组是正常结果，不是错误。',
    '本能力不做任何写入，也不表达「利润已核定」或「工资已发」之类的业务结论。',
  ],
  {
    purpose: '按月度双赢协议 id 读取该协议挂的月度利润组件（type=15），取得各条利润线的名称、比重、预测与实际利润。',
    effect: 'read',
    inputs: { protocolId: protocolIdInput() },
    output: {
      shape: 'object[]（协议里 type=15 的组件行，通常只有一条；不是分页包络）',
      fields: [
        field('$', 'object[]', '月度利润组件数组；只包含 type=15 的行，业务数据在每行的 value 里。'),
        field('id', 'string | number', '协议组件行 id（hr_kpi_month_protocol_subassembly.id）；不是利润 id、不是协议 id。', { optional: true, nullable: true, nullMeaning: '后端未返回组件行 id' }),
        field('type', 'number', '组件类型；本端点恒为 15（月度利润）—— 实现层只收 15，其余类型不会出现在返回里。', { values: { '15': '月度利润组件' }, constraints: ['实现层按 type == 15 过滤；type 为 null 的行在 Java 侧解箱时会抛错，不会作为结果返回'] }),
        field('canDel', 'number | null', '组件能否删除。只描述协议的可编辑性，本能力是只读的。', { optional: true, nullable: true, nullMeaning: '后端未返回', values: { '0': '不能删除', '1': '可以删除' } }),
        field('value', 'object[]', '该组件的值：type=15 时是利润列表（页面的「利润工资」卡片就是渲染它）。', { optional: true, nullable: true, nullMeaning: '后端未填充组件值（页面此时没有可渲染的利润行）' }),
        field('value[]', 'object', '一条利润（ProfitSubassemblyDTO）。', { optional: true }),
        field('value[].id', 'string | number', '利润 id；页面的利润明细跳转用它，不是协议或组件 id。', { optional: true, nullable: true, nullMeaning: '后端未返回利润 id' }),
        field('value[].name', 'string | null', '利润名称（页面「名称」一列）。', { optional: true, nullable: true, nullMeaning: '后端未返回名称' }),
        field('value[].unit', 'string | null', '利润单位；本端点不一定填（页面还会用第二跳的返回覆盖它）。', { optional: true, nullable: true, nullMeaning: '本端点未返回单位' }),
        field('value[].proportion', 'number | string | null', '利润比重（页面列标题「利润比重(%)」）。', decimal({ optional: true, unit: '%' })),
        field('value[].lineType', 'number | null', '线类型码（1 表示四线利润）；页面不渲染它。', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
        field('value[].profitList', 'object[]', '该利润下的各条线数据；页面按它展开成多行。', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
        field('value[].profitList[]', 'object', '一条利润线。', { optional: true }),
        field('value[].profitList[].lineName', 'string | null', '线名称（页面「标准」一列）。', { optional: true, nullable: true, nullMeaning: '该线没有名称' }),
        field('value[].profitList[].floatRatio', 'number | string | null', '浮动比例（页面「浮动比例(%)」一列）。', decimal({ optional: true, unit: '%' })),
        field('value[].profitList[].assessmentStandards', 'number | string | null', '奖励标准（页面「奖励标准」一列）。', decimal({ optional: true })),
        field('value[].profitList[].forecastIndicator', 'number | string | null', '利润预测（页面「利润预测」一列）；实现层在 year 非空时把它当成 dataList[month-1]。', decimal({ optional: true })),
        field('value[].profitList[].formula', 'string | null', '核算办法的公式文本；页面表格里只显示一个「公式」tooltip。', { optional: true, nullable: true, nullMeaning: '该线没有公式' }),
        field('value[].profitList[].lineType', 'string | null', '线类型码（利润线）。', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
        field('value[].profitList[].dataList', 'array', '1~12 月逐月数据，下标 = 月份 - 1；页面不直接渲染它。', { optional: true, nullable: true, nullMeaning: '后端未返回逐月数据' }),
        field('value[].profitList[].dataList[]', 'number | string | null', '某个月的值（BigDecimal 原值）。', { optional: true, nullable: true, nullMeaning: '该月没有数据' }),
        field('value[].actualIndicator', 'number | string | null', '实际利润（页面「实际利润」一列）；有值时页面才显示该列。', decimal({ optional: true })),
        field('value[].actualMoney', 'number | string | null', '实际应得工资（页面「实际奖励」一列）；有值时页面才显示该列。', decimal({ optional: true })),
        field('value[].restricted', 'number | null', '是否有限制（页面不渲染）。', { optional: true, nullable: true, nullMeaning: '后端未返回', values: { '0': '否', '1': '是' } }),
        field('value[].resourceType', 'number | null', '来源类型。', { optional: true, nullable: true, nullMeaning: '后端未返回', values: { '0': '年度带的', '1': '月度新增的' } }),
      ],
      empty: '[] 表示这份协议没有挂 type=15 的月度利润组件（页面不渲染该卡片）；有组件但 value 为空时是 value=[] 或 value=null —— 两者都不代表「利润为 0」。请求失败会抛错。',
    },
    consume: [
      '取第一条组件行的 value 作为利润列表（页面也只取 newValue[0].value；返回多于一条时先与用户确认看哪一条，不要默认合并）。',
      '按 name/proportion 列出各条利润，再按 profitList[].lineName 展开「标准」行；profitList[].forecastIndicator 是「利润预测」列。',
      '只有当至少一行的 actualIndicator 有值时页面才显示「实际利润」列，actualMoney 同理 —— 这两列的有无取决于数据，不是固定列。',
      'proportion 的列标题是「利润比重(%)」、floatRatio 是「浮动比例(%)」：都是百分比**数值**，页面不做 ×100/÷100 换算，本能力同样不换算。',
      '要还原页面上那份完整表格（利润名/单位/公式变量被第二跳覆盖后的样子）还需要 /performance/basedata/kpiprofit/getProfitDataByYear 与 /performance/basedata/kpiprofit/getVariableList，SDK 尚未提供；只凭本能力不能宣称已还原页面显示。',
    ],
    steps: [],
    completion: '交付这份协议的月度利润组件（含空数组这一情形）；读取不修改数据，也不代表利润或工资已被确认。',
    idempotency: null,
  },
))

export const PERF_ANALYSIS_DEPARTMENT_DETAIL_CONTRACTS: Record<string, AiContract> = contracts
