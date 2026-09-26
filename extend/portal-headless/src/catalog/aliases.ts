/**
 * 话术别名 / 同义词 / 业务域标签 —— **人工维护的数据文件**。
 *
 * ⚠️ 这份文件是「人写的」，不是生成物（`generated/**` 才是生成物，勿手改）。
 *
 * 它存在的唯一原因见设计 H22：Portal 菜单里 1,077 个 title 大量是内部黑话
 * （「找齐」「双赢协议」「准入」「稳产」「高产」），AI 对「薪资审核报表」能对上，
 * 对「帮我看看这个月还剩多少工资」对不上任何 title。
 * **目录本身不是能力，能被找到的目录才是能力。**
 *
 * 将来会怎么变（设计 D8 / Q55–Q58）：
 * - D8 定的是「能力目录由服务端下发、实时更新」。这份表就是那批数据里
 *   「话术 → 能力/页面」那一部分的**本机兜底副本**。
 * - 服务端具备下发能力后，本文件整体被替换为服务端响应，
 *   本层接口（recommend / search）**不需要改签名**——见 src/catalog/index.ts 的
 *   `createCatalog({ aliases })` 注入口。
 * - 维护方未定（Q56 答"服务端（配合 D8）"）。在服务端动手之前，改这里。
 *
 * 维护规则：
 * 1. `targets` 里的页面用 **menuPath** 引用，不要用 `page-catalog.json` 的短哈希 id
 *    （那个 id 由生成器产出，会随生成逻辑变化）。能力用 capability id。
 * 2. `test/catalog.test.ts` 会校验**每一个 target 都能在真实目录里解析到**，
 *    写错了会红，不会静默变成死链。
 * 3. 加条目时把「用户会怎么说」写全（口语、缩写、错别字都算），
 *    把「Portal 里它叫什么」写进 `terms`（黑话翻译就靠这个）。
 *
 * **这份表不需要为"目录里多了一个页面"而变长**（这是它原来最大的维护成本）：
 * 页面标题、菜单分组名、能力标题、域中文名能推出的落点，已经在生成物
 * `aliases.derived.ts` 里（`tools/generate/derive-aliases.mjs` 产出，覆盖全部菜单页）。
 * 那份表覆盖「Portal 里它叫什么」，这份表只需要覆盖「用户会怎么说」。
 *
 * 判断一个新页面要不要写进这里，只问一句：
 * **用户会用一个页面上不存在的词来指它吗？**
 * - 不会（他说的就是页面的名字）→ 不用写，推导器已经覆盖
 * - 会（「调薪」→「工资找齐」、「订会议室」→「会议室」、「双赢协议」→「流程模型」）
 *   → 必须写在这里，因为没有任何数据源写得出这个映射
 *
 * 冲突处理：两份表词面完全相同时人工赢，推导器会把被压掉的条目记进
 * `DERIVED_CONFLICTS`——所以在这里重复写一个显然的页面名不是"多余但无害"，
 * 而是会在生成报告里显形。
 */

/* ------------------------------------------------------------------ 类型 */

/**
 * 一个落点。`weight` 表达"同一概念下多个落点的主次"（默认 1）：
 * 用户说「订会议室」时，"查会议室列表"是第一步（weight 1），
 * "会议室审批流程"是后面才用到的下游域（weight 0.6），排序要能体现出来。
 */
export type AliasTarget =
  | { type: 'capability'; id: string; weight?: number }
  | { type: 'page'; menuPath: string; weight?: number }
  | { type: 'domain'; id: string; weight?: number }

/**
 * 一个「概念」条目：把用户话术（`phrases`）映射到 Portal 里的真实对象（`targets`），
 * 同时给检索提供可命中的词（`terms`）。
 *
 * 两件事都做，是因为它们是同一份知识的两个用法：
 * - `recommend('帮我调一下工资')` 用 `phrases` 认出意图，再用 `targets` 给出落点
 * - `search('调薪')` 用 `terms` 把「调薪」翻译成菜单里的「工资找齐」再命中
 */
export type AliasEntry = {
  /** 稳定标识，出现在 recommend 的解释里 */
  id: string
  /** 给 AI 看的一句话说明 */
  note: string
  /** 用户可能说出的词/短语 */
  phrases: string[]
  /** 命中该概念后一并参与**检索**的词（含同义与黑话翻译） */
  terms: string[]
  targets: AliasTarget[]
}

/** 同义词组：任一词出现，整组一起参与检索扩展 */
export type SynonymGroup = {
  id: string
  terms: string[]
}

/* ------------------------------------------------------------------ 同义词 */

/**
 * 同义词只做**检索扩展**（提高召回），不直接决定推荐落点。
 * 组内词不要放互相冲突的粒度（比如"工资"和"工资找齐"不要同组，后者进 ALIAS_ENTRIES）。
 */
export const SYNONYM_GROUPS: SynonymGroup[] = [
  { id: 'employee', terms: ['员工', '人员', '同事', '职工', '用户'] },
  { id: 'meeting', terms: ['会议室', '会议间', '开会', '会议'] },
  { id: 'salary', terms: ['工资', '薪资', '薪酬', '报酬'] },
  { id: 'attendance', terms: ['考勤', '打卡', '出勤'] },
  { id: 'approval', terms: ['审批', '审核', '签批', '待审'] },
  { id: 'flow', terms: ['流程', '工作流', '审批流', '流转'] },
  { id: 'report', terms: ['报表', '统计', '分析', '看板', '汇总'] },
  { id: 'org', terms: ['组织', '部门', '机构', '单位'] },
  { id: 'contract', terms: ['合同', '协议', '契约'] },
  { id: 'course', terms: ['课程', '培训', '学习', '听课'] },
  { id: 'supplier', terms: ['供应商', '供货商', '厂商'] },
  { id: 'stock', terms: ['库存', '存货', '存量'] },
  { id: 'customer', terms: ['客户', '商户', '顾客'] },
  { id: 'purchase', terms: ['采购', '购买', '进货'] },
  { id: 'overtime', terms: ['加班', '值班', '加点'] },
  { id: 'depreciation', terms: ['折旧', '摊销', '分摊'] },
  { id: 'detail', terms: ['明细', '详情', '流水'] },
]

/* ------------------------------------------------------------------ 业务域标签 */

/**
 * 业务域 → 中文名。域名取自菜单路径第二段（`/dashboard/<domain>/...`），
 * 是英文短横线词，直接给 AI 看不如给个人话名。
 * 没登记的域回退成域名本身。
 */
export const DOMAIN_LABELS: Record<string, string> = {
  'meeting-room': '会议室',
  // Portal 的流程表单页前缀 `/simple/<模块>/form/<NNN>`（H36 的 112 个流程表单）。
  // 它们不在菜单树里，"域"是路径第二段切出来的，给个人话名比给 AI 看 `simple` 强。
  simple: '流程表单',
  finance: '财务',
  product: '产品与养殖生产',
  platform: '平台管理',
  sale: '销售',
  material: '物料与库存',
  report: '报表',
  supply: '供应链与采购',
  manage: '管理',
  management: '管理',
  salary: '薪酬',
  course: '课程与培训',
  attendance: '考勤',
  staff: '员工',
  contract: '合同',
  certificate: '证照',
  flow: '流程',
  base: '基础数据',
  org: '组织',
  institution: '机构',
  setting: '设置',
  statistics: '统计',
  analysis: '分析',
  toolbox: '工具箱',
  tool: '工具',
  me: '个人中心',
  home: '首页',
  chat: '沟通',
  study: '学习',
  lesson: '课程',
  grade: '成绩',
  fund: '资金',
  insurance: '保险',
  post: '岗位',
  urge: '催办',
  'history-archive': '历史归档',
  'market-information': '市场行情',
  'model-usage': '模型用量',
  'month-agreement': '月度协议',
  'year-agreement': '年度协议',
  'agreement-change': '协议变更',
  assignment: '分配',
  backlog: '待办积压',
  block: '板块',
  technology: '技术',
}

/* ------------------------------------------------------------------ 话术条目 */

export const ALIAS_ENTRIES: AliasEntry[] = [
  {
    id: 'meeting-room',
    note: '「订会议室 / 开会」这条链路：先查会议室拿 meetingRoomId，再查占用挑空闲时段，最后走会议室审批流程提交',
    phrases: [
      '会议室', '订会议室', '订个会议室', '预定会议室', '预订会议室', '会议室预定', '会议室预订',
      '帮我订个会议室', '帮我订会议室', '约个会议室', '开会', '约会议', '会议预定', '定个会议室',
      '订会议室申请',
    ],
    terms: ['会议室', '预定', '占用', '会议'],
    targets: [
      { type: 'capability', id: 'meeting-room-list' },
      { type: 'capability', id: 'meeting-room-usage' },
      { type: 'capability', id: 'meeting-application-definition', weight: 0.6 },
      // 下游两步：先 prepare（校验草稿 + 问要不要选审批人），再 submit（真正提交）。
      // 权重低于前三个 —— 用户说"订会议室"时，AI 应该先把候选摆出来，而不是直接提交。
      { type: 'capability', id: 'meeting-application-prepare', weight: 0.5 },
      { type: 'capability', id: 'meeting-application-submit', weight: 0.5 },
      { type: 'page', menuPath: '/dashboard/meeting-room/list' },
      { type: 'domain', id: 'meeting-room', weight: 0.7 },
    ],
  },
  {
    id: 'flow-create',
    note: '「我要提个流程」——流程表单不在菜单树里（H36），入口是「发起流程」这个页面，它自己再往下发流程清单（D9）',
    phrases: [
      '发起流程', '提流程', '提交流程', '走流程', '提申请', '发起审批', '提个流程', '我要提流程',
      '发起申请', '流程申请', '填个表单', '提交申请',
    ],
    terms: ['发起流程', '流程定义', '流程模型', '流程'],
    targets: [
      { type: 'page', menuPath: '/dashboard/flow/task/create/list' },
      { type: 'domain', id: 'flow' },
    ],
  },
  {
    id: 'flow-todo',
    note: '「我的待办 / 要我审批的」——流程任务域下的几个列表页',
    phrases: ['待办', '我的待办', '待办任务', '待我审批', '要我审批', '我要审批', '已办', '我办过的'],
    terms: ['待办任务', '已办任务', '流程任务', '抄送我的'],
    targets: [
      { type: 'page', menuPath: '/dashboard/flow/task/todo/list' },
      { type: 'page', menuPath: '/dashboard/flow/task/done/list' },
      { type: 'page', menuPath: '/dashboard/flow/task/copy/list' },
      { type: 'domain', id: 'flow' },
    ],
  },
  {
    id: 'jargon-salary-findqi',
    note: 'H22 黑话：菜单里的「工资找齐」就是工资调整/补差，用户一般说「工资调整」「调薪」「涨工资」',
    phrases: ['工资', '薪资', '薪酬', '调薪', '涨工资', '工资调整', '算工资', '发工资', '工资条', '薪酬调整'],
    terms: ['工资找齐', '工资', '薪酬', '薪资'],
    targets: [
      { type: 'page', menuPath: '/dashboard/salary/adjust/list' },
      { type: 'domain', id: 'salary' },
    ],
  },
  {
    id: 'jargon-dualwin',
    note: 'H22 黑话：「双赢协议」是流程模型页的菜单名，用户会说「流程模型」「流程设计」「流程配置」',
    phrases: ['双赢协议', '流程模型', '流程设计', '流程配置', '流程模板', '建模'],
    terms: ['双赢协议', '流程模型'],
    targets: [
      { type: 'page', menuPath: '/dashboard/flow/old/model/list' },
      { type: 'domain', id: 'flow' },
    ],
  },
  {
    id: 'jargon-admittance',
    note: 'H22 黑话：「准入」= 准入申请与资质审核，用户会说「供应商入驻」「资质审核」',
    phrases: ['准入', '准入申请', '供应商入驻', '资质审核', '物料准入', '供应商准入'],
    terms: ['准入', '物料准入', '供应商准入'],
    targets: [
      { type: 'page', menuPath: '/dashboard/supply/admittance/material/material-admittance/list' },
      { type: 'page', menuPath: '/dashboard/supply/admittance/supplier/supplier-admittance/list' },
      { type: 'domain', id: 'supply' },
    ],
  },
  {
    id: 'jargon-yield',
    note: 'H22 黑话：「稳产 / 高产」是养殖生产管理的用户使用分析页，用户会说「产量」「生产情况」「养殖」',
    phrases: ['稳产', '高产', '产量', '产蛋率', '生产情况', '养殖', '饲养', '鸡群'],
    terms: ['稳产', '高产', '使用分析'],
    targets: [
      { type: 'page', menuPath: '/dashboard/product/operation/business/usage-layer/list' },
      { type: 'page', menuPath: '/dashboard/product/operation/business/usage-chicken/list' },
      { type: 'domain', id: 'product' },
    ],
  },
  {
    id: 'staff',
    note: '员工与花名册',
    phrases: ['员工', '人员', '同事', '职工', '花名册', '员工名单', '人员信息', '内部员工', '外部员工'],
    terms: ['内部员工', '外部员工', '员工'],
    targets: [
      { type: 'page', menuPath: '/dashboard/staff/staff-list/list' },
      { type: 'page', menuPath: '/dashboard/staff/external-staff-list/list' },
      { type: 'domain', id: 'staff' },
    ],
  },
  {
    id: 'org-tree',
    note: '组织架构 / 部门树',
    phrases: ['组织架构', '组织结构', '部门', '部门树', '组织树', '部门列表'],
    terms: ['组织结构', '部门', '组织'],
    targets: [
      { type: 'page', menuPath: '/dashboard/base/management-center/list' },
      { type: 'domain', id: 'org' },
    ],
  },
  {
    id: 'attendance',
    note: '考勤与加班记录',
    phrases: ['考勤', '打卡', '考勤统计', '考勤记录', '加班', '加班记录', '加班申请', '出勤'],
    terms: ['考勤', '加班', '打卡', '档案'],
    targets: [
      { type: 'page', menuPath: '/dashboard/attendance/attendance-sheet/list' },
      { type: 'page', menuPath: '/dashboard/attendance/attendance-overtime/list' },
      // ⚠️ 原来这里还有 `/dashboard/staff/attendance/list`，2026-09-21 去掉：
      // 那一行在 `app/portal/menus/hr.js:63` 是注释掉的，页面清单里根本没有它
      // （conventions 第 28 条）。死链靠 `test/catalog.test.ts` 那条断言抓到的。
      { type: 'page', menuPath: '/dashboard/attendance/attendance-archive-sheet/list' },
      { type: 'domain', id: 'attendance' },
    ],
  },
  {
    id: 'contract',
    note: '合同库 / 合同创建 / 合同模板',
    phrases: ['合同', '协议', '合同库', '签合同', '合同模板', '合同列表', '合同管理'],
    terms: ['合同库', '合同创建', '合同模板', '合同类型', '合同'],
    targets: [
      { type: 'page', menuPath: '/dashboard/contract/library/list' },
      { type: 'page', menuPath: '/dashboard/contract/create/list' },
      { type: 'page', menuPath: '/dashboard/contract/template/list' },
      { type: 'domain', id: 'contract' },
    ],
  },
  {
    id: 'purchase',
    note: '采购订单与采购计划',
    phrases: ['采购', '采购订单', '采购计划', '买东西', '进货'],
    terms: ['采购订单', '采购计划', '采购'],
    targets: [
      { type: 'page', menuPath: '/dashboard/supply/purchase/list' },
      { type: 'page', menuPath: '/dashboard/supply/plans/list' },
      { type: 'domain', id: 'supply' },
    ],
  },
  {
    id: 'stock',
    note: '库存与物料出入库',
    phrases: ['库存', '存货', '物料', '入库', '出库', '盘点', '库存报表', '库存盘点', '物料入库'],
    terms: ['库存报表', '库存盘点', '物料入库', '库存', '物料'],
    targets: [
      { type: 'page', menuPath: '/dashboard/material/store/inventory-report/list' },
      { type: 'page', menuPath: '/dashboard/material/store/inventory-check/list' },
      { type: 'page', menuPath: '/dashboard/material/store/material-inbound/list' },
      { type: 'domain', id: 'material' },
    ],
  },
  {
    id: 'supplier',
    note: '供应商主数据',
    phrases: ['供应商', '供货商', '供应商管理', '供应商列表'],
    terms: ['供应商', '厂商', '供应商管理'],
    targets: [
      { type: 'page', menuPath: '/dashboard/platform/market/supplier/all/list' },
      { type: 'page', menuPath: '/dashboard/platform/category/supplier/manufacturer/list' },
      { type: 'domain', id: 'supply' },
    ],
  },
  {
    id: 'customer',
    note: '客户主数据',
    phrases: ['客户', '商户', '客户管理', '客户列表', '顾客'],
    terms: ['客户管理', '客户'],
    // ⚠️ 原来这里只有一个页面 target `/dashboard/finance/revenue/customer/list`，
    // 2026-09-21 去掉了：那一行在 `app/portal/menus/finance.js:82` 是注释掉的
    // （conventions 第 28 条），页面清单里没有它。**只剩 domain 这一条 target 是如实的结果**——
    // 清单里真正带「客户」的页面都在 `platform` / `sale` 域下（`…/platform/member/customer/list`
    // 等 25 条），要不要把它们补进来是**人工表的内容取舍**，本轮不做，留在这里备查。
    targets: [
      { type: 'domain', id: 'finance' },
    ],
  },
  {
    id: 'course',
    note: '课程与培训',
    // ⚠️ **刻意没有「直播课程 / 直播课」**（2026-09-21 去掉）：那一页的菜单项在 Portal
    // `app/portal/menus/hr.js:299` 是注释掉的，按项目规则（conventions「注释掉的代码不算代码」）
    // 不进 SDK。留着一个指向"什么都没有"的词条，会让「查直播课程」被静默路由到课程域、
    // 再被当成视频课程回答 —— 那正是仓库最不想要的那种"不报错但是错的"。
    phrases: ['培训', '课程', '学习', '在线学习', '听课', '视频课'],
    terms: ['视频课程', '图文课程', '课程'],
    targets: [
      { type: 'page', menuPath: '/dashboard/course/video-course/list' },
      { type: 'domain', id: 'course' },
    ],
  },
  {
    id: 'performance',
    note: '考核与绩效',
    phrases: ['绩效考核', '考核', '绩效', '考评', '考核结果', '考核规则'],
    terms: ['考核', '绩效', '考核规则'],
    targets: [
      { type: 'page', menuPath: '/dashboard/salary/examine-result/list' },
      { type: 'page', menuPath: '/dashboard/manage/protocol-deduct-rule/list' },
    ],
  },
  {
    id: 'depreciation',
    note: '折旧与费用分摊（finance/depreciation 下的矩阵式重复页，§1d）',
    phrases: ['折旧', '摊销', '分摊', '费用分配', '折旧分配', '折旧调整', '资产折旧'],
    terms: ['折旧', '分配', '分摊'],
    targets: [
      { type: 'page', menuPath: '/dashboard/finance/depreciation/fixed/allocation/list' },
      { type: 'domain', id: 'finance' },
    ],
  },
  {
    id: 'reporting',
    note: '报表 / 统计 / 看板类，话术粒度只到"域"这一级',
    phrases: ['报表', '统计', '数据分析', '看板', '汇总表', '月报', '年报'],
    terms: ['报表', '统计', '分析', '汇总'],
    targets: [
      { type: 'domain', id: 'report' },
      { type: 'domain', id: 'statistics' },
      { type: 'domain', id: 'analysis' },
    ],
  },
]
