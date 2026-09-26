import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_PLAN_PREVIEW_AREA_TREE_CAPABILITY_ID,
  PRODUCT_PLAN_PREVIEW_METHODS,
  productPlanPreviewCapabilities,
} from '../capabilities/product-plan-preview.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  ...extra,
})

const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning,
  source,
  ...extra,
})

const definitions = new Map(productPlanPreviewCapabilities.map(definition => [definition.id, definition]))

const previewInput: Record<string, AiParameter> = {
  generation: param('代次字典值，不是代次显示标签以外的内部页面状态。', 'Portal代次选择器（type=gen）或调用方已选择的字典value', {
    type: 'string',
    required: true,
    constraints: ['去除首尾空白后不能为空，长度不超过64个字符；代次改变后必须重新选择品种，复刻Portal的handleGenerationChange。'],
  }),
  variety: param('品种字典值；本页只查询variety，不公开Java DTO支持但Portal没有输入控件的strain。', 'Portal品种选择器（dict type=variety）或用户已选择的字典value', {
    type: 'string',
    required: true,
    constraints: ['去除首尾空白后不能为空，长度不超过64个字符。'],
  }),
  provinceCode: param('进鸡省级行政区编码；用于形成最终areaCode。', `${PRODUCT_PLAN_PREVIEW_AREA_TREE_CAPABILITY_ID}返回的地区节点[].id`, {
    type: 'string',
    required: true,
    format: '六位数字',
    constraints: ['Portal选择省后清空cityCode和districtCode；必须先有省才能传市。'],
  }),
  cityCode: param('进鸡市级行政区编码；有值时优先于省级编码形成areaCode。', `${PRODUCT_PLAN_PREVIEW_AREA_TREE_CAPABILITY_ID}返回的递归children[].id`, {
    type: 'string | null',
    required: false,
    nullable: true,
    omitted: '省级查询时省略；null或空字符串按未选择市处理。',
    nullMeaning: '未选择市，使用省级编码或更深层已选编码。',
    format: '有值时为六位数字',
  }),
  districtCode: param('进鸡区县级行政区编码；有值时优先形成最终areaCode。', `${PRODUCT_PLAN_PREVIEW_AREA_TREE_CAPABILITY_ID}返回的递归children[].id`, {
    type: 'string | null',
    required: false,
    nullable: true,
    omitted: '未选择区县时省略；市变更后Portal会清空该值。',
    nullMeaning: '未选择区县，使用市级或省级编码。',
    format: '有值时为六位数字',
  }),
  entryDate: param('进鸡日期；用于选择指标版本和计算预案计划日期。', 'Portal日期选择器的value-format=YYYY-MM-DD结果', {
    type: 'string',
    required: true,
    format: 'YYYY-MM-DD且必须是有效日历日期',
  }),
  region: param('地区名称回显文本；不是areaCode，也不参与权限判断。', '公共地区树中已选节点name按“省 / 市 / 区”连接的Portal显示值', {
    type: 'string | null',
    required: false,
    nullable: true,
    omitted: '没有可用名称时不发送region；SDK不会用名称替代areaCode。',
    nullMeaning: '不发送地区回显文本。',
    constraints: ['最多64个字符；Portal会去除空白后仅在非空时发送。'],
  }),
  dayAge: param('要预览的日龄；不传时由后端按当前日期计算初始日龄。', 'PlanPreviewDetail.vue的日龄按钮或输入框', {
    type: 'integer | null',
    required: false,
    nullable: true,
    omitted: '首次查询或不指定切换日龄时省略dayAge；Portal请求不发送该键。',
    nullMeaning: '按省略处理，不发送dayAge。',
    options: [{ value: -1, label: '空舍（汇总负日龄）' }],
    constraints: ['页面可达值为-1或1至700；0禁止，-2至-365虽被Java接口接受但不属于本Portal页面可达行为；SDK在请求前拒绝它们。'],
  }),
}

const indexItemFields = [
  ['txt', 'string | number | null', '指标展示文本；按后端已格式化的原值展示。'],
  ['min', 'number | null', '指标下限；RANGE/GT等值类型有意义。'],
  ['max', 'number | null', '指标上限；RANGE/LT等值类型有意义。'],
  ['value', 'number | null', 'EXACT/LT/GT等值类型的数值。'],
  ['age', 'integer', '指标适用日龄；空舍汇总时保留指标的实际负日龄。'],
  ['classification', 'integer', '页面预案分类编码。'],
  ['indicatorCategory', 'integer', '预案分类语义：1饲养、2营养、3防疫。'],
  ['contentType', 'integer', 'Portal预案卡使用的内容类型，指标为1?'],
  ['scale', 'integer | null', '指标小数位；未配置时为空。'],
  ['name', 'string', '指标名称。'],
  ['unit', 'string | null', '指标单位；页面按原值展示，不猜换算。'],
  ['code', 'string', '指标编码；用于识别指标，不用名称猜测。'],
  ['codeType', 'integer', 'Portal指标条目标记，Java响应固定为1。'],
  ['title', 'string', '指标标题，通常与name相同。'],
  ['tempBandCode', 'string | null', '命中的温度段编码；温度相关指标的关联依据。'],
  ['tempBandName', 'string | null', '命中的温度段名称。'],
  ['temperatureRelated', 'boolean', '是否按温度段匹配指标。'],
  ['valueType', 'string | null', '指标值类型：EXACT、RANGE、LT或GT。'],
  ['videoList', 'array', 'Portal/Java返回的关联视频数组；本页主要从程序条目消费。'],
] as const

const pointItemFields = [
  ['txt', 'string | null', '程序或方法的已拼装展示文本；优先展示此字段。'],
  ['age', 'integer', '当前执行日龄；空舍汇总时保留条目的真实负日龄。'],
  ['classification', 'integer', '页面预案分类编码。'],
  ['contentType', 'integer', 'Portal预案卡内容类型。'],
  ['scale', 'integer', 'Portal预案卡缩放/小数位兼容字段。'],
  ['name', 'string', '程序或方法名称。'],
  ['unit', 'string', '页面兼容单位字段；程序/方法通常为空字符串。'],
  ['code', 'string | null', '程序或方法编码；程序条目对应programCode/程序库编码。'],
  ['codeType', 'integer', 'Portal程序/方法条目标记，Java响应固定为2。'],
  ['title', 'string | null', '预案卡标题。'],
  ['title1', 'string | null', '预案卡第一层标题。'],
  ['title2', 'string | null', '预案卡第二层标题。'],
  ['title3', 'string | null', '预案卡第三层标题。'],
  ['editableType', 'string | null', '可编辑对象类型：METHOD或PROGRAM。'],
  ['methodName', 'string | null', '匹配到的程序方法名称。'],
  ['methodDescription', 'string | null', '匹配到的程序方法描述。'],
  ['programCode', 'string | null', '程序库编码。'],
  ['programName', 'string | null', '程序库名称。'],
  ['frequencyCode', 'string | null', '结构化执行频次编码。'],
  ['frequencyName', 'string | null', '结构化执行频次显示名。'],
  ['dayAgeRange', 'string | null', '程序库原日龄范围；预览时通常还会返回投影后的age。'],
  ['startDayAge', 'integer | null', '光照/温湿度/通风/清粪等程序的开始日龄或投影日龄。'],
  ['endDayAge', 'integer | null', '光照/温湿度/通风/清粪等程序的结束日龄或投影日龄。'],
  ['videoList', 'array', '与程序方法名称匹配的视频列表；播放使用videoList[].fileUrl。'],
] as const

const videoFields = (prefix: string): AiField[] => [
  field(`${prefix}.videoList[]`, 'object', 'SmartLayer关联视频；无匹配或视频查询失败时为空对象数组。', { optional: false, nullable: false }),
  field(`${prefix}.videoList[].id`, 'string | number | null', '视频记录ID。', { optional: true, nullable: true }),
  field(`${prefix}.videoList[].fileUrl`, 'string | null', '视频播放地址；页面播放控件使用该字段。', { optional: true, nullable: true }),
  field(`${prefix}.videoList[].videoId`, 'string | number | null', '视频业务ID。', { optional: true, nullable: true }),
  field(`${prefix}.videoList[].videoName`, 'string | null', '视频名称。', { optional: true, nullable: true }),
  field(`${prefix}.videoList[].videoImg`, 'string | null', '视频封面地址。', { optional: true, nullable: true }),
  field(`${prefix}.videoList[].title`, 'string | null', '视频标题或标签展示值。', { optional: true, nullable: true }),
  field(`${prefix}.videoList[].duration`, 'string | number | null', '视频时长原值；不擅自换算单位。', { optional: true, nullable: true }),
  field(`${prefix}.videoList[].type`, 'string | number | null', '视频类型原值。', { optional: true, nullable: true }),
  field(`${prefix}.videoList[].tag`, 'string | null', '视频标签；用于后端按程序方法名称关联。', { optional: true, nullable: true }),
]

const sectionFields = (section: 'feed' | 'nutrition' | 'prevention', label: string): AiField[] => {
  const indexPrefix = `list[].${section}.programIndexList[]`
  const pointPrefix = `list[].${section}.programPointList[]`
  return [
    field(`list[].${section}`, 'object', `${label}预案分类；与其它两个分类结构相同。`, { optional: false, nullable: false }),
    field(`list[].${section}.programIndexList`, 'array', `${label}分类命中的指标库条目；没有命中时为[]。`, { optional: false, nullable: false }),
    field(indexPrefix, 'object', `${label}分类的一条指标预案条目；SDK保留Portal/Java扩展字段。`, { optional: false, nullable: false, constraints: ['指标条目实际显示使用txt、name、unit、age及min/max/value；不要从缺席的上下限推断数值。'] }),
    ...indexItemFields.map(([path, type, meaning]) => field(`${indexPrefix}.${path}`, type, meaning, { optional: true, nullable: true })),
    field(`list[].${section}.programPointList`, 'array', `${label}分类命中的程序库内容、普通方法和匹配到的程序方法；没有命中时为[]。`, { optional: false, nullable: false }),
    field(pointPrefix, 'object', `${label}分类的一条程序或方法预案条目；SDK保留各程序自己的业务字段。`, { optional: false, nullable: false, constraints: ['程序专属字段包括程序库原编码/显示名、频次、日龄字段和页面需要的*Name文本；不要按不存在的字段补造数据。'] }),
    ...pointItemFields.map(([path, type, meaning]) => field(`${pointPrefix}.${path}`, type, meaning, { optional: true, nullable: true })),
    ...videoFields(pointPrefix),
    field(`list[].${section}.programKeyPointList`, 'array', `${label}分类关键点列表；Java接口文档说明当前固定为空数组。`, { optional: false, nullable: false }),
  ]
}

const previewOutput: AiContract['output'] = {
  shape: '{ list: object[] }',
  fields: [
    field('$', 'object', 'SDK归一化后的预案预览对象；已去掉Portal data包络，保留其它顶层扩展字段。', { optional: false, nullable: false }),
    field('list', 'array', '按日龄返回的预案列表；当前Portal查询一次只返回一个元素。', { optional: false, nullable: false }),
    field('list[]', 'object', '单个日龄的预案；由Portal/Java的PreviewDay归一而来。', { optional: false, nullable: false }),
    field('list[].delFlag', 'integer', '删除标记；Java预览响应固定为0。', { optional: true, nullable: true, values: { '0': '未删除/当前预案项' } }),
    field('list[].age', 'integer', '后端最终组装的日龄；正常查询为1至700，空舍汇总为-1。', { optional: false, nullable: false, constraints: ['调用方以此字段判断本次结果实际日龄，不用请求是否带dayAge猜测。'] }),
    ...sectionFields('feed', '饲养'),
    ...sectionFields('nutrition', '营养'),
    ...sectionFields('prevention', '防疫'),
  ],
  empty: 'list=[]或三类预案下的programIndexList/programPointList为空表示当前条件没有命中的预案内容；请求失败、权限失败或后端业务校验失败会抛错，不伪造成空结果。缺失的三类数组由SDK按Portal规则归一为空数组。',
}

const previewContract: AiContract = {
  purpose: '按Portal预案预览表单的代次、品种、进鸡地区和进鸡日期读取饲养、营养、防疫三类预案，并支持切换页面可达日龄。',
  whenToUse: '用户需要查看某个代次/品种在指定进鸡地区和进鸡日期下的预案内容时使用；它只读预览，不创建或保存预案。',
  boundaries: [
    '页面路径是/dashboard/product/setting/plan-preview/list，菜单权限是/dashboard/frame/breeding-plan-new/preview；SDK不绕过服务端权限。',
    '请求使用Portal platform HTTP实例，module-type按该页面规则为null且不发送；接口路径为/flockSimu/rearingPlan/preview/get。',
    '地区树读取复用已登记的product-setting-season-area-tree / productSettingSeason.areaTree（同一/system/area/tree接口），本页不重复暴露地区树能力；品种和代次沿用Portal字典值，不把字典标签当成查询值。',
    '本能力只覆盖Portal页面可达的variety表单，不扩展Java请求DTO中本页没有控件的strain或previewDate参数。',
    '页面的饲养/营养/防疫页签、日龄滚动和空状态是同一查询结果的本地消费；没有写入、导出、删除或预案快照能力。',
  ],
  effect: 'read',
  prerequisites: [
    '使用绑定当前用户与租户的platform会话，并拥有页面权限。',
    '先复用公共地区树取得合法省/市/区节点ID；页面只要求最终选中的最深层编码为六位数字，省变更清空市/区，市变更清空区。',
    'generation、variety、entryDate和有效地区编码必须已确定；首次查询不指定dayAge时由后端按当前日期计算日龄。',
  ],
  inputs: previewInput,
  output: previewOutput,
  consume: [
    '使用list[0].age作为后端最终组装日龄；-1在Portal显示为空舍，1至700显示为对应日龄，不能把0解释为第一日龄。',
    '按feed、nutrition、prevention三类读取各自的programIndexList指标和programPointList程序/方法；programKeyPointList当前固定为空数组。',
    '指标优先使用txt、name、unit和age以及实际存在的min/max/value；程序优先使用txt、name、age、频次/日龄字段和*Name显示字段。',
    '程序或独立程序方法的videoList为空是合法无视频状态；有视频时使用videoList[].fileUrl播放，不用视频标题猜地址。',
  ],
  steps: [{
    role: 'optional',
    when: '需要展示或选择进鸡省、市、区编码',
    capabilityId: PRODUCT_PLAN_PREVIEW_AREA_TREE_CAPABILITY_ID,
    mapping: {},
    instruction: '复用productSettingSeason.areaTree的递归结果取得节点id/name，再把最深层选中id映射到provinceCode/cityCode/districtCode；不要再次暴露同一地区树请求。',
  }],
  completion: '返回已去除Portal data包络且已补齐三类预案数组的只读结果；list为空或分类数组为空只能说明没有命中内容，不能说明权限或请求成功。',
  failures: [
    '代次、品种、进鸡日期、地区层级或六位areaCode不合法时SDK在发请求前失败；Portal表单也不会提交未通过validateQuery的查询。',
    'dayAge只能是-1或1至700；0直接失败，-2至-365虽在Java DTO范围内但不是本页面日龄控件可达值，SDK不替页面扩展该范围。',
    'Java未匹配指标库/生效版本、地区温度配置或其它业务条件时，后端错误必须向调用方报告；不能把错误吞掉并返回空list。',
    '会话、权限、网络或响应结构错误必须报告；日龄切换请求失败时不要把旧结果当成本次新日龄结果。',
  ],
  idempotency: null,
  evidence: [
    { source: 'app/portal/menus/product/operation.js 与 app/portal/views/dashboard/product/setting/plan-preview/list.vue', kind: 'reference', note: '逐页核对页面路径、权限、platform实例、generation/variety/省市区/entryDate表单、联动清空和查询校验。' },
    { source: 'app/portal/views/dashboard/product/setting/plan-preview/utils.js 与 components/PlanPreviewDetail.vue', kind: 'reference', note: '核对请求参数构造、data/list/三类数组归一、-1空舍、1..700日龄控件和0的页面归一行为。' },
    { source: 'erp-module-fm/docs/新版预案/预案预览-PC端接口对接文档.md、RearingPlanPreviewController.java、RearingPlanPreviewReqVO.java、RearingPlanPreviewRespVO.java', kind: 'reference', note: '核对GET端点、Java校验边界、请求字段、list/feed/nutrition/prevention响应结构和程序视频字段。' },
    { source: 'src/capabilities/product-plan-preview.ts 与 test/product-plan-preview.test.ts', kind: 'implementation', note: '锁定SDK请求投影、响应归一化、页面权限/module-type/实例和离线反证；不替代真实测试环境读请求。' },
    { source: 'docs/pages/预案预览-新.md', kind: 'reference', note: '记录本页四件套、公共地区树复用和未执行真实smoke的边界。' },
  ],
  gaps: ['已逐页核对Portal源码、Java接口文档/请求响应DTO、SDK实现和离线反证测试；当前未在真实测试环境执行地区树、初次查询或日龄切换的浏览器读请求，不能把离线结果表述为真实环境验证。'],
}

if (!definitions.has('product-plan-preview-preview')) throw new Error('预案预览契约没有对应能力定义')

export const PRODUCT_PLAN_PREVIEW_AI_CONTRACTS: Record<string, AiContract> = {
  'product-plan-preview-preview': previewContract,
}

export const PRODUCT_PLAN_PREVIEW_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_PLAN_PREVIEW_METHODS).map(([id, method]) => [
    `productPlanPreview.${method}`,
    {
      ...PRODUCT_PLAN_PREVIEW_AI_CONTRACTS[id]!,
      boundaries: [
        ...PRODUCT_PLAN_PREVIEW_AI_CONTRACTS[id]!.boundaries,
        `直接方法路径为productPlanPreview.${method}；本页是只读查询，没有prepare、submit或cancel写链。`,
      ],
    },
  ]),
)
