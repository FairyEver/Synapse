import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_BATCH_STATUS_METHODS,
  PRODUCT_SETTING_BATCH_STATUS_PAGE_PATH,
  productSettingBatchStatusCapabilities,
} from '../capabilities/product-setting-batch-status.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingBatchStatusCapabilities.map(definition => [definition.id, definition]))

const pageFields: AiField[] = [
  field('$', 'object', '批次状态分页结果；list是当前页，total是当前筛选条件下的总条数。'),
  field('list', 'object[]', '当前页的鸡群批次状态记录。'),
  field('list[].id', 'string | number | null', '底层鸡群记录ID；页面动作实际使用同一行的groupId。', { nullable: true, nullMeaning: '后端没有返回底层记录ID。' }),
  field('list[].groupId', 'string | number | null', '批次组ID；终止、恢复和推荐终止日期的目标参数。', { nullable: true, nullMeaning: '缺少批次组ID，不能执行该行状态动作。' }),
  field('list[].batch', 'string | null', '批次号。', { nullable: true, nullMeaning: '后端没有返回批次号。' }),
  field('list[].farmName', 'string | null', '场区展示名称。', { nullable: true, nullMeaning: '后端没有返回场区名称。' }),
  field('list[].buildingName', 'string | null', '场栋展示名称。', { nullable: true, nullMeaning: '后端没有返回场栋名称。' }),
  field('list[].stageStartDate', 'string | null', '进鸡日期；终止弹窗日期选择器不允许早于该日期。', { nullable: true, nullMeaning: '后端没有返回日期边界，不能据此判断早于进鸡日期。' }),
  field('list[].stageEndDate', 'string | null', '终止日期；为空时页面展示未终止。', { nullable: true, nullMeaning: '批次当前未终止或后端没有返回终止日期。' }),
  field('list[].maleQty', 'integer | null', '当前计算后的公鸡数量。', { nullable: true, nullMeaning: '后端没有返回公鸡数量。' }),
  field('list[].femaleQty', 'integer | null', '当前计算后的母鸡数量。', { nullable: true, nullMeaning: '后端没有返回母鸡数量。' }),
  field('list[].varietyName', 'string | null', '品种展示名称。', { nullable: true, nullMeaning: '后端没有返回品种名称。' }),
  field('list[].lineName', 'string | null', '品系展示名称。', { nullable: true, nullMeaning: '后端没有返回品系名称。' }),
  field('list[].lineVer', 'string | null', '品系版本。', { nullable: true, nullMeaning: '后端没有返回品系版本。' }),
  field('list[].genName', 'string | null', '代次展示名称。', { nullable: true, nullMeaning: '后端没有返回代次名称。' }),
  field('list[].genNucleusName', 'string | null', '世代展示名称。', { nullable: true, nullMeaning: '后端没有返回世代名称。' }),
  field('total', 'integer', '当前场区和筛选条件下的总记录数，不是当前页长度。'),
]

const buildingFields: AiField[] = [
  field('$', 'object[]', '页面栋号下拉最终消费的候选数组。'),
  field('[].value', 'string | number', '栋号组织ID；传给list.building。'),
  field('[].label', 'string', '栋号简称；页面下拉展示文本。'),
]

const terminationDraftFields: AiField[] = [
  field('$', 'object', '终止批次的未写入草稿。'),
  field('draft', 'object', '通过Portal日期规则校验的终止请求草稿。'),
  field('draft.groupId', 'string | number', '批次组ID。'),
  field('draft.stageEndDate', 'string', '终止日期，YYYY-MM-DD；不能早于进鸡日期。'),
]

const terminationOutputFields: AiField[] = [
  field('$', 'object', '终止请求的规范化结果。'),
  field('completed', 'boolean', '服务端已执行终止，或请求已返回没有二次确认的成功结果。'),
  field('confirmationRequired', 'boolean', '服务端要求用户确认后再次发送isConfirm=1。产品实例可能把单独的data.isConfirm=1解包为数字1，SDK同时识别这两种形状。'),
  field('message', 'string | null', '服务端提示文本；普通成功可能为空。', { nullable: true, nullMeaning: '响应没有可用提示文本。' }),
]

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '恢复请求完成后的本地成功确认；接口没有返回最终批次行。')],
  empty: '请求抛错时没有成功结果；true不等于列表状态已经回查确认。',
}

const commonBoundaries = [
  `页面路径是${PRODUCT_SETTING_BATCH_STATUS_PAGE_PATH}，菜单权限是/dashboard/frame/business/batch-status；列表查询受management:batch-status:query控制，编辑状态受management:batch-status:submit控制。SDK不绕过页面或服务端权限。`,
  '所有请求使用Portal product实例并补devicetype=PC；该页面module-type推导结果为null，因此不发送module-type。',
  '列表customLoad把order、orderField、farm、building、stageEndingFlag、variety、line、lineVer、gen、scope=1、pageNo和pageSize交给GET /flockStatus/list；farm是页面唯一必填查询字段，styleV2默认pageSize=20。',
  '场区改变时页面先清空栋号，再GET /config/building/getByFarmId?farmId=场区ID；SDK只返回{value:id,label:shortName}，不把栋号名称误当ID。',
  '终止弹窗只有status为终止时才校验stageEndDate；日期选择器禁止早于列表行stageStartDate。第一次终止请求固定isConfirm=0，若服务端要求继续，用户确认后原样重发groupId、stageEndDate并改为isConfirm=1。',
  '恢复状态只发送POST /flockStatus/activate，body为null，groupId放query；页面没有删除、创建或编辑批次基础资料接口，SDK不扩展不可达端点。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js 与 app/portal/views/dashboard/product/setting/business-manage/batch-status/list.vue', kind: 'reference', note: '逐页核对菜单路径、权限、product实例、查询表单、scope=1、分页、列表字段和编辑状态入口。' },
  { source: 'app/portal/views/dashboard/product/setting/business-manage/batch-status/modal-form-content.vue', kind: 'reference', note: '核对终止/恢复分支、日期必填、进鸡日期禁选边界、推荐日期读取和终止提交字段。' },
  { source: 'FlockStageStatusController、FlockTransferListVO、TerminationBatchVO、FlockDTO、FlockTransferServiceImpl、FlockMapperExt.xml、BuildingController、FlockServiceImpl、FlockBizService', kind: 'reference', note: '核对分页包络、scope与筛选字段、返回行字段、栋号响应、终止二次检查、软状态更新和推荐终止日期语义。' },
  { source: 'src/capabilities/product-setting-batch-status.ts 与 test/product-setting-batch-status.test.ts', kind: 'implementation', note: '锁定请求方法、query/body、日期和确认分支、0值/空值、product实例与离线反证；不替代真实环境浏览器证据。' },
  { source: 'docs/pages/产品设置鸡群批次状态.md', kind: 'reference', note: '记录页面四件套、权限、终止确认规则和真实环境缺口。' },
]

const gaps = [
  '已逐页核对Portal菜单、列表、弹窗、Java Controller/VO/DTO/Mapper/Service、SDK实现和离线反证测试；尚未在真实测试环境使用浏览器会话执行场区/栋号联动、列表读取及终止 prepare → submit(0) → confirm(1) → 回查或恢复闭环。',
]

const listInputs: Record<string, AiParameter> = {
  farm: param('必填场区ID；Portal表单规则要求非空。', '用户在场区选择器确认的ID', { type: 'string | number', required: true }),
  building: param('栋号ID；省略时按页面默认发送空字符串。', 'productSettingBatchStatus.buildingList.result[].value', { type: 'string | number', required: false, default: '' }),
  stageEndingFlag: param('批次状态筛选：0未终止、1已终止；省略时发送空字符串。', '用户筛选或页面默认值', { type: '0 | 1 | string', required: false, default: '', options: [{ label: '未终止', value: 0 }, { label: '已终止', value: 1 }] }),
  variety: param('品种字典值；省略时发送空字符串。', '用户筛选或页面默认值', { type: 'string', required: false, default: '' }),
  line: param('品系字典值；省略时发送空字符串。', '用户筛选或页面默认值', { type: 'string', required: false, default: '' }),
  lineVer: param('品系版本；省略时发送空字符串。', '用户筛选或页面默认值', { type: 'string', required: false, default: '' }),
  gen: param('代次字典值；省略时发送空字符串。', '用户筛选或页面默认值', { type: 'string', required: false, default: '' }),
  pageNo: param('从1开始的页码。', '调用方分页状态', { type: 'integer', required: false, default: '1' }),
  pageSize: param('页面支持的每页条数。', '调用方分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
}

const formInputs: Record<string, AiParameter> = {
  groupId: param('当前列表行groupId；不是底层行id、批次号或栋号ID。', 'productSettingBatchStatus.list.result.list[].groupId', { type: 'string | number', required: true }),
  stageEndDate: param('终止日期；Portal日期选择器输出YYYY-MM-DD，不能早于同一行stageStartDate。', '用户在终止弹窗选择的日期', { type: 'string', required: true, format: 'YYYY-MM-DD' }),
  stageStartDate: param('当前列表行进鸡日期；只用于复刻日期选择器的最小日期边界。', 'productSettingBatchStatus.list.result.list[].stageStartDate', { type: 'string', required: false, nullable: true, format: 'YYYY-MM-DD' }),
}
const groupIdInput = formInputs.groupId!

const terminationInputs: Record<string, AiParameter> = {
  draft: param('prepareTermination返回的draft；不要自行删掉groupId或改写日期。', 'productSettingBatchStatus.prepareTermination.result.draft', { type: 'object', required: true }),
  isConfirm: param('第一次请求用0；只有服务端明确要求继续且用户确认后才用1。', '用户对服务端二次确认提示的明确同意', { type: '0 | 1', required: false, default: '0', options: [{ label: '先检查', value: 0 }, { label: '确认继续', value: 1 }] }),
}

function inputFor (id: string): Record<string, AiParameter> {
  if (id === 'product-setting-batch-status-list') return listInputs
  if (id === 'product-setting-batch-status-building-list') return { farmId: param('场区ID；由当前页面场区选择器得到。', '用户在场区选择器确认的ID', { type: 'string | number', required: true }) }
  if (id === 'product-setting-batch-status-recommend-end-day') return { groupId: groupIdInput }
  if (id === 'product-setting-batch-status-prepare-termination') return formInputs
  if (id === 'product-setting-batch-status-termination') return terminationInputs
  return { groupId: groupIdInput }
}

function contractFor (id: string): AiContract {
  const isList = id.endsWith('-list') && !id.endsWith('-building-list')
  const isBuildingList = id.endsWith('-building-list')
  const isRecommend = id.endsWith('-recommend-end-day')
  const isPrepare = id.endsWith('-prepare-termination')
  const isTermination = id.endsWith('-termination') && !isPrepare
  const steps: AiContract['steps'] = []
  if (isPrepare) {
    steps.push({ role: 'required', when: '用户确认终止当前列表行', capabilityId: 'product-setting-batch-status-termination', mapping: { draft: 'result.draft' }, instruction: '先用isConfirm默认0执行终止检查；若返回confirmationRequired=true，必须把同一draft交给termination并等待用户明确确认。' })
    steps.push({ role: 'cancel', when: '用户在终止提交前取消', instruction: '丢弃draft，不调用终止接口。' })
  }
  if (isTermination) {
    steps.push({ role: 'required', when: '第一次终止返回confirmationRequired=true且用户明确同意继续', capabilityId: 'product-setting-batch-status-termination', mapping: { draft: 'args.draft', isConfirm: 'literal:1' }, instruction: '原样重发同一draft并将isConfirm设为1；用户拒绝时不再发请求。' })
    steps.push({ role: 'required', when: '终止完成或响应超时需要确认最终状态', capabilityId: 'product-setting-batch-status-list', instruction: '按原farm和筛选条件重新读取列表，再按groupId核对stageEndDate；不要只把completed=true当作服务端已回查。' })
  }
  if (id.endsWith('-activate')) {
    steps.push({ role: 'required', when: '恢复请求完成或响应超时需要确认最终状态', capabilityId: 'product-setting-batch-status-list', instruction: '重新读取列表并按groupId核对stageEndDate已经为空或页面显示未终止；不要只把true回执当作已恢复。' })
  }
  const output = isList
    ? { shape: '{ list: object[], total: integer }', fields: pageFields, empty: 'list=[]表示当前页没有记录；total=0才表示当前筛选没有记录，权限、网络或后端错误会抛出。' }
    : isBuildingList
      ? { shape: 'object[]', fields: buildingFields, empty: '[]表示该场区没有可选栋号。' }
      : isRecommend
        ? { shape: 'string | null', fields: [field('$', 'string | null', '推荐终止日期，来自后端连续业务日记录和存栏计算。', { nullable: true, nullMeaning: '没有满足推荐条件的日期。' })], empty: 'null表示暂无推荐终止日期；不是请求失败。' }
        : isPrepare
          ? { shape: '{ draft: object }', fields: terminationDraftFields, empty: 'groupId、终止日期缺失或终止日期早于进鸡日期时直接抛错，不发送网络请求。' }
          : isTermination
            ? { shape: '{ completed: boolean, confirmationRequired: boolean, message: string | null }', fields: terminationOutputFields, empty: '请求抛错时没有结果；confirmationRequired=true表示尚未完成终止，不能向用户报告已完成。' }
            : trueOutput
  const effect: AiContract['effect'] = isPrepare ? 'prepare' : (isList || isBuildingList || isRecommend ? 'read' : 'write')
  return {
    purpose: isList ? '按场区和批次筛选条件分页查询鸡群批次状态。' : isBuildingList ? '读取所选场区的栋号下拉候选。' : isRecommend ? '读取当前批次是否存在服务端推荐终止日期。' : isPrepare ? '按Portal终止弹窗规则准备尚未写入的批次终止草稿。' : isTermination ? '按Portal的先检查/用户确认流程终止一个鸡群批次。' : '恢复当前批次为未终止状态。',
    whenToUse: `需要在${PRODUCT_SETTING_BATCH_STATUS_PAGE_PATH}页面执行${isList ? '查询' : isBuildingList ? '选择栋号' : isRecommend ? '查看推荐终止日期' : isPrepare ? '准备终止' : isTermination ? '提交终止' : '恢复批次'}时使用。`,
    effect,
    inputs: inputFor(id),
    output,
    consume: isList
      ? ['展示batch、场栋、进鸡日期、终止日期、数量和字典名称；保留groupId用于编辑状态。', 'total是筛选后的总数；按pageNo/pageSize分页，不要用当前页长度代替总数。']
      : isBuildingList
        ? ['把value传回list.building；label只用于展示。场区变化后应丢弃旧栋号并重新读取。']
        : isRecommend
          ? ['推荐日期只作为用户可选建议；页面仍允许用户手工选择满足最小日期的终止日期。']
          : isPrepare
            ? ['用户取消时只丢弃draft；确认时先用isConfirm=0执行服务端检查。']
            : isTermination
              ? ['completed=false且confirmationRequired=true时等待用户确认；用户确认后才用isConfirm=1重发。完成后必须回查列表。']
              : ['请求返回true只表示恢复接口完成；必须回查同一groupId的stageEndDate。'],
    boundaries: commonBoundaries,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认用户拥有页面及对应查询或提交权限。', ...(isPrepare || isTermination ? ['groupId来自最新列表行，stageEndDate已经过Portal日期选择器规则校验。'] : []), ...(id.endsWith('-activate') ? ['用户已明确确认恢复当前批次。'] : [])],
    steps,
    completion: isList ? '获得与Portal customLoad消费形状一致的list和total。' : isBuildingList ? '获得当前场区的栋号value/label候选。' : isRecommend ? '获得推荐日期或明确暂无推荐日期。' : isPrepare ? '得到未写入的终止草稿。' : '完成请求并在列表回查后确认业务终态。',
    failures: ['字段、日期边界、ID、权限、网络或Java业务错误均抛出，不能降级为空列表或假成功。', ...(isTermination ? ['第一次检查可能因鸡群转移、鸡只转移或日记录返回二次确认；未得到用户确认不能自动继续。'] : [])],
    idempotency: isList || isBuildingList || isRecommend || isPrepare ? null : '接口没有requestId幂等键；终止或恢复超时先按groupId回查，再决定是否重试，避免重复写入或误判。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingBatchStatusCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`鸡群批次状态契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_BATCH_STATUS_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_BATCH_STATUS_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_BATCH_STATUS_METHODS).map(([id, method]) => [
    `productSettingBatchStatus.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingBatchStatus.${method}；终止和恢复写操作遵循准备、确认（如需要）、回查步骤。`] },
  ]),
)
