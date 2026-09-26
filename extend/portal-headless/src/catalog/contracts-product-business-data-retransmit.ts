import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_BUSINESS_DATA_RETRANSMIT_FINANCE_TYPES,
  PRODUCT_BUSINESS_DATA_RETRANSMIT_METHODS,
  PRODUCT_BUSINESS_DATA_RETRANSMIT_PAGE_PATH,
  PRODUCT_BUSINESS_DATA_RETRANSMIT_PERMISSION,
  PRODUCT_BUSINESS_DATA_RETRANSMIT_SAP_UPLOAD_TYPES,
  productBusinessDataRetransmitCapabilities,
} from '../capabilities/product-business-data-retransmit.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productBusinessDataRetransmitCapabilities.map(definition => [definition.id, definition]))

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不代表SAP或财务系统已独立核验业务数据。')],
  empty: 'Portal/Java业务错误、权限错误、网络错误或响应结构错误会抛出；true不等于目标系统已完成入账。',
}

const typeOptions = [
  { value: '1', label: '育成鸡订单数据' }, { value: '2', label: '蛋鸡订单数据' }, { value: '3', label: '蛋鸡订单死亡及淘汰数据' },
  { value: '4', label: '蛋鸡转群及并栋数据' }, { value: '5', label: '畜禽周转表数据' }, { value: '6', label: '公母鸡饲养日及存栏数' },
  { value: '7', label: '青年鸡订单' }, { value: '8', label: '雏鸡育成鸡' }, { value: '9', label: '蛋鸡育成鸡' },
  { value: '101', label: '蛋鸡场蛋鸡' }, { value: '102', label: '蛋鸡场蛋鸡死亡淘汰' }, { value: '11', label: '换羽育成鸡' },
  { value: '121', label: '换羽蛋鸡' }, { value: '122', label: '换羽蛋鸡死亡淘汰' },
]
const financeOptions = [
  { value: 1, label: '蛋鸡批次报表' }, { value: 2, label: '育成鸡批次报表' }, { value: 3, label: '雏鸡批次报表' },
  { value: 4, label: '死亡冲摊销' }, { value: 5, label: '换羽蛋鸡批次报表' }, { value: 6, label: '换羽育成批次报表' },
  { value: 7, label: '蛋鸡转群' }, { value: 8, label: '育成鸡转群' }, { value: 9, label: '种畜分摊' },
  { value: 10, label: '销售冲摊销' }, { value: 11, label: '蛋鸡（换羽蛋鸡）日龄分割转群数据' },
]

const visibleColumns: Array<[string, string, string]> = [
  ['sapGrowingOrder', 'string | number | null', '育成鸡订单号'], ['deaths', 'number | string | null', '死亡数量'], ['eliminateCount', 'number | string | null', '淘汰数量'], ['closingQty', 'number | string | null', '存栏数量'],
  ['sapLayingOrder', 'string | number | null', '蛋鸡订单号'], ['date', 'string | null', '达到154日龄的日期'], ['total', 'number | string | null', '来源育成订单投入数量'],
  ['period', 'string | number | null', '期间'], ['moultCount', 'number | string | null', '换羽数量'], ['turnGroupCount', 'number | string | null', '转群数量'], ['transferCount', 'number | string | null', '当日转出数量'], ['beginOfMonthAge', 'number | string | null', '月初1号日龄'],
  ['entrySourceSapOrder', 'string | number | null', '并栋来源订单'], ['entryDate', 'string | null', '并栋日期'], ['entryTotal', 'number | string | null', '并栋并入数量'], ['turnGroupTotal', 'number | string | null', '转群转入数量'],
  ['batch', 'string | null', '批次号'], ['chickSapOrder', 'string | number | null', '雏鸡订单号'], ['year', 'number | string | null', '年度'], ['month', 'number | string | null', '期间'], ['growingSapOrder', 'string | number | null', '育成订单号'], ['layerSapOrder', 'string | number | null', '蛋鸡订单号'], ['openingBalanceQty', 'number | string | null', '期初结余数量'], ['openingBalanceRearingDay', 'number | string | null', '期初结余饲养日'], ['gainWeightRearingDay', 'number | string | null', '增重及饲养成本'], ['eliminateQty', 'number | string | null', '淘汰数量'], ['eliminateRearingDay', 'number | string | null', '淘汰饲养日'], ['deathRearingDay', 'number | string | null', '死亡饲养日'], ['destSapOrder', 'string | number | null', '转至订单号'], ['turnOutQty', 'number | string | null', '当日转出数量'], ['turnOutRearingDay', 'number | string | null', '转出饲养日'],
  ['sapOrder', 'string | number | null', 'SAP订单号'], ['statsTraitType', 'string | number | null', '统计指标类型'], ['rearingDayQty', 'number | string | null', '饲养日存栏数量'], ['factoryCode', 'string | number | null', '工厂编码'], ['workingCenterCode', 'string | number | null', '工作中心编码'], ['costCenterCode', 'string | number | null', '成本中心编码'],
  ['age', 'number | string | null', '日龄'], ['weekAge', 'number | string | null', '周龄'], ['startQty', 'number | string | null', '当日期初存栏'], ['intoQty', 'number | string | null', '转入数量'], ['outQty', 'number | string | null', '当日转出数量'], ['youngChickQty', 'number | string | null', '青年鸡数量'], ['recordDate', 'string | null', '订单号BUDAT/记录日期'], ['businessId', 'string | null', '业务UUID'],
  ['curPeriodEliminateQty', 'number | string | null', '本期间淘汰数量'], ['openingQty', 'number | string | null', '期初存栏'], ['startAge', 'number | string | null', '期初日龄'], ['stageStartDate', 'string | null', '饲养开始日期'], ['curPeriodDeaths', 'number | string | null', '本期间死亡数量'], ['ageOfPurchase', 'number | string | null', '购入日龄'],
]

const rowFields: AiField[] = [
  field('$', 'object', 'SAP种摊数据分页结果；list是当前页，total是查询条件下总记录数。'),
  field('list', 'array', '当前页数据。'),
  field('list[]', 'object', '页面经过Portal映射后的行；每行把Java DTO的amortizationData字段展开。'),
  field('list[].id', 'string | number | null', '种摊数据记录ID；仅用于行标识。', { nullable: true, nullMeaning: '响应没有ID。' }),
  field('list[].farmName', 'string | null', '养殖场名称。', { nullable: true, nullMeaning: '响应没有场区名称。' }),
  field('list[].yearAndMonth', 'string | null', '页面展示的年月，来源Java DTO.month；原值显示，不做日期换算。', { nullable: true, format: '后端返回的年月字符串' }),
  ...visibleColumns.map(([path, type, meaning]) => field(`list[].${path}`, type, meaning, { optional: true, nullable: true, nullMeaning: '当前类型的响应没有该列，或该业务值为空。' })),
  field('list[].layerDeathsAndEliminateItemList', 'array', '死亡/淘汰明细；存在时页面展示查看死亡淘汰入口。', { optional: true, nullable: true, nullMeaning: '该行没有死亡/淘汰明细。' }),
  field('list[].layerDeathsAndEliminateItemList[]', 'object', '死亡/淘汰明细行。', { optional: true }),
  field('list[].layerDeathsAndEliminateItemList[].type', 'string | number | null', '死亡/淘汰类型；页面标题说明01群淘、02零淘、03死亡。', { optional: true, nullable: true }),
  field('list[].layerDeathsAndEliminateItemList[].deathDate', 'string | null', '死亡/淘汰日期；原值显示。', { optional: true, nullable: true }),
  field('list[].layerDeathsAndEliminateItemList[].total', 'number | string | null', '死亡/淘汰数量。', { optional: true, nullable: true }),
  field('list[].layerTransferList', 'array', '转入转出明细；存在时页面展示查看转入转出入口。', { optional: true, nullable: true, nullMeaning: '该行没有layerTransferList。' }),
  field('list[].layerTransferList[]', 'object', 'layerTransferList明细行。', { optional: true }),
  field('list[].layerTransferList[].type', 'string | number | null', '转入转出类型。', { optional: true, nullable: true }),
  field('list[].layerTransferList[].total', 'number | string | null', '转入转出数量。', { optional: true, nullable: true }),
  field('list[].layerTransferList[].batch', 'string | null', '转入转出批次号。', { optional: true, nullable: true }),
  field('list[].layerTransferList[].order', 'string | null', '转入转出订单。', { optional: true, nullable: true }),
  field('list[].layerTransferList[].transferDate', 'string | null', '转入转出日期。', { optional: true, nullable: true }),
  field('list[].transferList', 'array', '兼容另一种转入转出明细键；页面与layerTransferList二选一展示。', { optional: true, nullable: true, nullMeaning: '该行没有transferList。' }),
  field('list[].transferList[]', 'object', 'transferList明细行。', { optional: true }),
  field('list[].transferList[].type', 'string | number | null', '转入转出类型。', { optional: true, nullable: true }),
  field('list[].transferList[].total', 'number | string | null', '转入转出数量。', { optional: true, nullable: true }),
  field('list[].transferList[].batch', 'string | null', '转入转出批次号。', { optional: true, nullable: true }),
  field('list[].transferList[].order', 'string | null', '转入转出订单。', { optional: true, nullable: true }),
  field('list[].transferList[].transferDate', 'string | null', '转入转出日期。', { optional: true, nullable: true }),
  field('total', 'integer', '查询条件下的总记录数，不是当前页长度。'),
]

const boundaries = [
  `只覆盖页面${PRODUCT_BUSINESS_DATA_RETRANSMIT_PAGE_PATH}及三个可见tab：SAP重传、SAP查询、财务重传；菜单权限是${PRODUCT_BUSINESS_DATA_RETRANSMIT_PERMISSION}。`,
  '页面没有permissionCheck形式的tab内操作权限；SDK保留页面级权限上下文，最终是否允许仍由当前会话和后端校验决定。',
  '所有请求使用Portal product HTTP实例；本页没有可推导的module-type，因此不发送module-type。',
  'SAP重传必须选择月份和场区，类型是页面固定的1至12；SAP查询类型来自页面下拉项，类型值包含1至9、101、102、11、121、122，farm和yearMonth可为空。',
  '财务单个同步和全部同步都调用同一个GET端点；全部同步按页面固定的1至11顺序逐个调用，任一调用失败就停止，返回已完成的类型集合。场区为空时不发送farm参数。',
  '查询结果按Portal实现把每行的amortizationData展开为表格字段；死亡/淘汰与转入转出明细仍保留嵌套数组，空数组、null和字段缺席不能当作同一业务事实。',
  '页面没有写入撤销端点；prepare阶段可以取消，submit后只能重新查询或通过目标系统核实，不能伪造cancel。',
]

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main：app/portal/menus/product/operation.js、data-retransmit/list.vue、components/data-retransmit-upload/list.vue、data-retransmit-query/list.vue、data-retransmit-finance/list.vue及modal-detail.vue', kind: 'reference', note: '逐tab核对表单必填、默认值、类型选项、字段映射、三个端点、单个/全部同步和明细展示。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test：DataRetransmitController.java、FinanceRetransmitController.java、DataRetransmitVO.java、AmortizationDataDTO.java', kind: 'reference', note: '核对SAP/财务列表与上传端点、参数方式、类型和后端响应包装；未把后端存在但页面未调用的接口加入能力。' },
  { source: 'src/capabilities/product-business-data-retransmit.ts、test/product-business-data-retransmit.test.ts', kind: 'implementation', note: '锁定请求序列、表单校验、查询展开和明细字段反证；未替代真实测试环境SAP/财务写入闭环。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话执行SAP重传、财务单个/全部同步及目标系统独立核验；当前证据是源码和离线请求测试。',
  'Java DataRetransmitVO没有字段级校验注解，SAP月份/场区必填主要来自Portal表单；SDK因此按页面而非放宽为后端可选。',
  '各类型展开字段的实际数值/字符串序列化未在真实租户逐类型抓取；契约按Portal列定义保留number|string|null，未知扩展字段不作为页面契约。',
]

function inputFor (id: string): Record<string, AiParameter> {
  const suffix = id.replace('product-business-data-retransmit-', '')
  if (suffix === 'prepare-sap-upload') return {
    form: param('SAP重传表单；月份、场区和页面固定类型必填。', '用户填写的SAP重传页面表单', { type: 'object', required: true }),
    'form.type': param('SAP重传业务类型。', 'SAP重传页面固定按钮类型', { type: 'integer', required: true, options: PRODUCT_BUSINESS_DATA_RETRANSMIT_SAP_UPLOAD_TYPES.map(value => ({ value, label: `页面SAP类型${value}` })) }),
    'form.yearMonth': param('重传月份。', 'SAP重传页面月份选择器', { type: 'string', required: true, format: 'YYYY-MM' }),
    'form.farm': param('场区编码或值。', 'SAP重传页面场区选择器', { type: 'string', required: true, constraints: ['非空'] }),
  }
  if (suffix === 'submit-sap-upload') return {
    draft: param('prepareSapUpload返回的SAP重传草稿；确认后原样提交。', 'productBusinessDataRetransmit.prepareSapUpload.result.draft', { type: 'object', required: true }),
    'draft.type': param('草稿中的SAP重传类型。', 'prepareSapUpload.result.draft.type', { type: 'integer', required: true }),
    'draft.yearMonth': param('草稿中的重传月份。', 'prepareSapUpload.result.draft.yearMonth', { type: 'string', required: true, format: 'YYYY-MM' }),
    'draft.farm': param('草稿中的场区。', 'prepareSapUpload.result.draft.farm', { type: 'string', required: true }),
  }
  if (suffix === 'list-sap') return {
    type: param('SAP查询类型；省略时发送页面初始值1。', 'SAP查询页面类型下拉框', { type: 'string', required: false, default: '1', options: typeOptions }),
    farm: param('场栋筛选；省略时发送空字符串。', 'SAP查询页面场栋选择器', { type: 'string', required: false, nullable: true, nullMeaning: '不按场栋筛选。' }),
    yearMonth: param('年月筛选；省略时发送空字符串。', 'SAP查询页面年月选择器', { type: 'string', required: false, nullable: true, format: 'YYYY-MM', nullMeaning: '不按年月筛选。' }),
    pageNo: param('从1开始的页码；默认1。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数；只支持10、20、50、100，默认20。', 'Portal分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  if (suffix === 'prepare-finance-sync' || suffix === 'prepare-finance-sync-all') return {
    form: param('财务重传表单；摊销月份必填，场区可选。', '用户填写的财务重传页面表单', { type: 'object', required: true }),
    'form.yearMonth': param('财务同步月份。', '财务重传页面摊销月份选择器', { type: 'string', required: true, format: 'YYYY-MM' }),
    'form.farm': param('可选场区。', '财务重传页面场区选择器', { type: 'string', required: false, nullable: true, nullMeaning: '同步全部场区，不发送farm参数。' }),
  }
  if (suffix === 'submit-finance-sync') return {
    draft: param('prepareFinanceSync返回的财务同步草稿。', 'productBusinessDataRetransmit.prepareFinanceSync.result.draft', { type: 'object', required: true }),
    'draft.yearMonth': param('草稿中的财务同步月份。', 'prepareFinanceSync.result.draft.yearMonth', { type: 'string', required: true, format: 'YYYY-MM' }),
    'draft.farm': param('草稿中的可选场区。', 'prepareFinanceSync.result.draft.farm', { type: 'string', required: false, nullable: true }),
    type: param('本次单个同步类型，1至11。', '用户选中的财务卡片类型', { type: 'integer', required: true, options: financeOptions }),
  }
  if (suffix === 'submit-finance-sync-all') return {
    draft: param('prepareFinanceSyncAll返回的财务同步草稿；全部同步按页面固定顺序执行。', 'productBusinessDataRetransmit.prepareFinanceSyncAll.result.draft', { type: 'object', required: true }),
    'draft.yearMonth': param('草稿中的财务同步月份。', 'prepareFinanceSyncAll.result.draft.yearMonth', { type: 'string', required: true, format: 'YYYY-MM' }),
    'draft.farm': param('草稿中的可选场区。', 'prepareFinanceSyncAll.result.draft.farm', { type: 'string', required: false, nullable: true }),
  }
  return {}
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-business-data-retransmit-', '')
  const read = suffix === 'list-sap'
  const prepare = suffix.startsWith('prepare-')
  const all = suffix.includes('-all')
  const steps: AiContract['steps'] = []
  if (prepare) {
    const kind = suffix.replace('prepare-', '')
    steps.push({ role: 'required', when: '用户确认草稿', capabilityId: `product-business-data-retransmit-submit-${kind}`, mapping: { draft: 'result.draft', ...(kind === 'finance-sync' ? { type: 'user.选中的财务同步类型' } : {}) }, instruction: all ? '把draft交给全部同步能力；它会按1至11顺序逐个调用。' : '把draft原样交给对应submit能力；SAP或财务单个同步的类型按页面固定选项传入。' })
    steps.push({ role: 'cancel', when: '用户取消准备中的重传/同步', instruction: '丢弃本地draft，不发送写请求。' })
  } else if (!read) {
    steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: 'product-business-data-retransmit-list-sap', mapping: {}, instruction: all ? 'SDK没有财务列表端点；用SAP查询不能证明财务系统已同步，不能把true解释成目标系统已入账，需按目标财务系统的独立查询或运维证据核实。' : '页面没有写后回查接口；SAP重传只能通过目标SAP/后端业务查询独立核实，财务同步同样不能把true解释成目标系统已入账。' })
  }
  let output: AiContract['output'] = trueOutput
  if (read) output = { shape: '{ list: object[], total: integer }', fields: rowFields, empty: 'list=[]表示当前筛选当前页没有记录；total=0表示查询范围没有记录；detail数组可为空、null或缺席，权限/网络/响应结构错误会抛出，不降级为空列表。' }
  else if (prepare) output = { shape: '{ draft: object }', fields: [field('$', 'object', '未发请求的本地重传草稿。'), field('draft', 'object', '待用户确认后提交的重传参数。'), ...(suffix.includes('sap') ? [field('draft.type', 'integer', 'SAP重传类型1至12。'), field('draft.yearMonth', 'string', 'SAP重传月份。', { format: 'YYYY-MM' }), field('draft.farm', 'string', 'SAP重传场区。')] : [field('draft.yearMonth', 'string', '财务同步月份。', { format: 'YYYY-MM' }), field('draft.farm', 'string', '可选场区；空时提交参数中不含farm。', { optional: true })])], empty: '月份、SAP场区、类型或参数格式不合法时抛错且不发请求。' }
  else if (all) output = { shape: 'integer[]', fields: [field('$', 'array', '已按页面顺序成功完成的财务同步类型列表。'), field('$[]', 'integer', '一个已成功完成的财务同步类型；失败时不包含失败类型及其后续类型。')], empty: '若第一个类型失败返回前即抛错；后续类型不会执行。' }
  return {
    purpose: read ? '按页面类型、场栋和年月分页查询SAP种摊数据，并展开Portal表格与可查看明细。' : prepare ? `按Portal${all ? '财务全部同步' : suffix.includes('sap') ? 'SAP重传' : '财务单个同步'}表单规则准备重传请求。` : all ? '按Portal固定顺序逐个执行11种财务种摊数据同步。' : suffix.includes('sap') ? '向SAP提交一类种摊数据重传。' : '向财务系统提交一类种摊数据同步。',
    whenToUse: `需要在${PRODUCT_BUSINESS_DATA_RETRANSMIT_PAGE_PATH}的${read ? '种摊数据查询（SAP）' : suffix.includes('sap') ? '种摊数据重传（SAP）' : '种摊数据重传（财务）'}tab执行对应动作时使用。`,
    boundaries,
    effect: read ? 'read' : prepare ? 'prepare' : 'write',
    prerequisites: ['使用当前用户/租户绑定的product会话并满足页面菜单权限。', ...(prepare || !read ? ['写请求可能产生外部系统副作用；用户取消只能发生在prepare之后、submit之前。'] : [])],
    inputs: inputFor(id),
    output,
    consume: read ? ['按type选择对应列解释list[]；若存在明细数组，按数组元素逐条展示，不把空数组当作有明细。', 'total只用于分页总数，不能替代当前页list。'] : prepare ? ['展示draft供用户确认；取消时丢弃，不调用submit。'] : ['把true理解为请求未抛错；按目标SAP/财务系统的独立证据核验实际同步结果。', ...(all ? ['按返回的已完成类型数组判断批量同步停止在哪一类。'] : [])],
    steps,
    completion: read ? '获得当前SAP查询筛选和分页下的Portal映射数据。' : prepare ? '获得尚未产生外部副作用的本地重传草稿。' : all ? '返回已按页面顺序请求成功的财务类型；这不代表目标财务系统已完成入账。' : '请求按Portal端点和参数完成；目标系统业务结果仍需独立核实。',
    failures: ['月份、类型、SAP场区、分页或响应结构不合法时在发请求前失败；401/403、网络错误、财务开关关闭和Java业务错误原样失败。', '写请求超时或响应不确定时不要盲目重试；SAP/财务页面没有撤销接口，先用目标系统或后端查询核实。', ...(all ? ['全部同步按1至11串行执行，任一类型失败立即停止；已完成类型可能已有外部副作用。'] : [])],
    idempotency: read || prepare ? null : '页面没有requestId防重参数；Java部分端点使用服务端重复提交限制或业务侧处理，SDK不宣称跨请求幂等；超时先核实再重试。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productBusinessDataRetransmitCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`种摊数据重传契约没有对应能力定义：${id}`)

export const PRODUCT_BUSINESS_DATA_RETRANSMIT_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_BUSINESS_DATA_RETRANSMIT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_BUSINESS_DATA_RETRANSMIT_METHODS).map(([id, method]) => [
    `productBusinessDataRetransmit.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productBusinessDataRetransmit.${method}；写操作遵循prepare→submit→核实步骤。`] },
  ]),
)
