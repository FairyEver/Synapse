import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_SEASON_METHODS,
  PRODUCT_SETTING_SEASON_PAGE_PATH,
  PRODUCT_SETTING_SEASON_PERMISSION,
  productSettingSeasonCapabilities,
} from '../capabilities/product-setting-season.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingSeasonCapabilities.map(definition => [definition.id, definition]))

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的服务端记录。')],
  empty: 'Portal/Java业务错误、权限错误、网络错误或响应结构错误会抛出；true不等于已经回查确认。',
}

const dateRangeFields: AiField[] = [
  field('startMonth', 'integer', '日期段开始月份，1-12。'),
  field('startDay', 'integer', '日期段开始日；按月份校验，2月最多28日。'),
  field('endMonth', 'integer', '日期段结束月份，1-12。'),
  field('endDay', 'integer', '日期段结束日；按月份校验，2月最多28日。'),
]

const tempBandFields: AiField[] = [
  field('tempBandId', 'string', '温度段ID；保存时作为Java关联ID。'),
  field('bandCode', 'string', '温度段编码；来自启用温度段依赖数据。'),
  field('bandName', 'string', '温度段名称；页面标签和回查展示使用。'),
  field('lowerTemp', 'number | undefined', '温度段下限；后端没有返回时为undefined。', { nullable: true, nullMeaning: '后端没有提供下限。' }),
  field('upperTemp', 'number | undefined', '温度段上限；后端没有返回时为undefined。', { nullable: true, nullMeaning: '后端没有提供上限。' }),
  field('sortNo', 'integer', '温度段排序号；Java保存时用于校验已配置温度段连续。'),
  field('status', 'number | undefined', '温度段状态；依赖接口固定按status=1查询。', { nullable: true, nullMeaning: '后端没有返回状态。' }),
  field('dateRanges', 'array', '该温度段覆盖的月日范围；未使用的温度段可为空数组。'),
  field('dateRanges[]', 'object', '一个闭区间月日范围；跨年范围由开始月日大于结束月日表示。'),
  ...dateRangeFields.map(item => ({ ...item, path: `dateRanges[].${item.path}` })),
]

const areaFields: AiField[] = [
  field('areaCode', 'string', '六位行政区编码；编辑、删除和保存都使用该编码。'),
  field('provinceCode', 'string', '省级行政区编码；省级配置的最终areaCode。'),
  field('provinceName', 'string', '省份名称。'),
  field('cityCode', 'string', '市级行政区编码；省级配置为空字符串。'),
  field('cityName', 'string', '城市名称；省级配置为空字符串。'),
  field('districtCode', 'string', '区县行政区编码；省级或市级配置为空字符串。'),
  field('districtName', 'string', '区县名称；省级或市级配置为空字符串。'),
  field('tempBandCount', 'number', '已配置日期范围的温度段数量。'),
  field('operatorId', 'string', '最近操作人ID；没有返回时为空字符串。'),
  field('operatorName', 'string', '最近操作人姓名；没有返回时为空字符串。'),
  field('operationTime', 'string | null', '最近操作时间。', { nullable: true, nullMeaning: '没有操作时间或后端未返回。' }),
  field('status', 'number | undefined', '配置状态：0停用，1启用；新建默认启用。', { nullable: true, nullMeaning: '后端没有返回状态。' }),
  field('remarks', 'string | null', '服务端备注；Portal保存页不会从表单提交该字段。', { nullable: true, nullMeaning: '没有备注。' }),
  field('tempBands', 'array', '服务端返回的温度段配置；详情包含全部启用温度段，列表由服务端返回实际配置段。'),
  field('tempBands[]', 'object', '温度段配置。'),
  ...tempBandFields.map(item => ({ ...item, path: `tempBands[].${item.path}` })),
]

const areaTreeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('$', 'array', 'Portal地区树；SDK递归规范id、name和children。'),
    field('[]', 'object', '地区节点。'),
    field('[].id', 'string', '六位地区节点ID；作为省/市/区选择值。'),
    field('[].name', 'string', '地区展示名称。'),
    field('[].children', 'array', '下级地区节点；无下级时为空数组。'),
    field('[].children[]', 'object', '递归地区节点，字段与[]相同。'),
  ],
  empty: '[]表示地区树没有可用节点；权限、网络或响应结构错误会抛出，不伪造地区选项。',
}

const tempBandOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('$', 'array', 'Portal初始加载的启用温度段列表；SDK已解包分页外壳并按sortNo排序。'), field('[]', 'object', '启用温度段。'), ...tempBandFields.map(item => ({ ...item, path: `[].${item.path}` }))],
  empty: '[]表示当前没有启用温度段，Portal不会打开新建温度配置弹窗；请求或响应错误会抛出。',
}

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('$', 'object', 'Portal温度配置分页结果；SDK已规范地区、操作人、状态和温度段字段。'),
    field('list', 'array', '当前地区筛选和分页下的温度配置。'),
    field('list[]', 'object', '地区温度配置记录。'),
    ...areaFields.map(item => ({ ...item, path: `list[].${item.path}` })),
    field('total', 'integer', '筛选条件下的记录总数，不是当前页长度。'),
  ],
  empty: 'list=[]表示当前页没有配置；total=0表示筛选条件下没有配置。权限、网络或响应结构错误会抛出，不降级为空列表。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: [field('$', 'object', '地区温度配置详情；字段语义与list[]一致。'), ...areaFields],
  empty: '地区配置不存在、响应缺少详情结构或请求失败时抛出。',
}

const saveDraftFields: AiField[] = [
  field('draft', 'object', '通过Portal表单和Java业务边界校验、尚未发送请求的温度配置草稿。'),
  field('draft.areaCode', 'string', '最终生效的六位行政区编码：区优先，其次市，最后省。'),
  field('draft.tempBands', 'array', 'Portal提交的全部温度段；未使用的温度段保留为空dateRanges。'),
  field('draft.tempBands[]', 'object', '温度段提交项。'),
  field('draft.tempBands[].tempBandId', 'string', '温度段ID；必须唯一。'),
  field('draft.tempBands[].dateRanges', 'array', '月日闭区间列表；所有配置段合计必须覆盖2001年的365天且不能重叠。'),
  field('draft.tempBands[].dateRanges[]', 'object', '经过月份/日期校验的提交范围。'),
  ...dateRangeFields.map(item => ({ ...item, path: `draft.tempBands[].dateRanges[].${item.path}` })),
]

const commonBoundaries = [
  `页面范围是${PRODUCT_SETTING_SEASON_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_SEASON_PERMISSION}；它属于系统设置→生产设置，不是独立生产模块。SDK不绕过页面或服务端权限。`,
  '所有请求使用Portal platform HTTP实例并执行admin-api前缀和会话头规则；本页没有module-type推导，不发送module-type或devicetype。',
  '页面初始并行读取/system/area/tree、/flockSimu/rearingPlan/tempBand/page?pageNo=1&pageSize=5&status=1，并读取地区温度配置分页；SDK分别暴露areaTree、tempBandList和list。',
  '列表筛选是provinceCode、cityCode、districtCode，省变更清空市和区，市变更清空区；pageNo默认1，pageSize默认10，只支持10、20、50。',
  '保存严格复刻Portal提交体，只发送areaCode和tempBands，不发送status、remarks、地区名称或温度显示字段；省必选，市依赖省，区依赖市，最终areaCode按区→市→省取值。',
  '每个温度段的tempBandId必须唯一，最多5项；至少一项有日期范围。日期按2001年校验，2月29日无效；Java还要求已配置温度段排序连续、日期不重叠并完整覆盖全年。',
  '单个删除使用DELETE /delete?areaCode参数；批量删除使用DELETE /delete-list?areaCodes=...&areaCodes=...，最多50个六位行政区编码。',
  '写请求成功或响应不确定后必须list/get回查；true只代表请求未抛错，不代表保存或删除已达到业务终态。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/season/list.vue', kind: 'reference', note: '逐页核对菜单路径、页面权限、platform实例、依赖加载、筛选、分页、编辑、单删和批量删除。' },
  { source: 'app/portal/views/dashboard/product/setting/season/components/TemperatureModalContent.vue、utils.js、温度配置-PC端接口对接文档.md', kind: 'reference', note: '逐字段核对地区层级、温度段日期表单、areaCode优先级、校验提示、提交体和初始请求顺序。' },
  { source: 'RearingPlanAreaTempConfigController.java、RearingPlanAreaTempConfigSaveReqVO.java、RearingPlanAreaTempConfigPageReqVO.java、RearingPlanAreaTempConfigRespVO.java、RearingPlanAreaTempConfigServiceImpl.java', kind: 'reference', note: '核对Java端点、六位行政区校验、最多5项、温度段唯一/连续、全年覆盖、不重叠和批量删除上限。' },
  { source: 'RearingPlanTempBandController.java、AreaController.java', kind: 'reference', note: '核对启用温度段分页和地区树依赖接口。' },
  { source: 'src/capabilities/product-setting-season.ts 与 test/product-setting-season.test.ts', kind: 'implementation', note: '锁定逐页请求形状、表单提交体、前后端边界、platform上下文、AI说明注册和反证；未替代真实环境闭环冒烟。' },
  { source: 'docs/pages/产品设置温度配置-新.md', kind: 'reference', note: '记录页面四件套、逐字段基准、权限、提交顺序和证据边界。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话执行地区树/温度段依赖、列表、新建、编辑、单删和批量删除闭环；当前证据为Portal/Java源码与离线请求形状测试。',
  '当前没有真实租户的地区树、启用温度段和配置数据快照，因此温度段ID存在性、地区父子关系和写入后的业务终态仍需真实环境按页面逐项复核。',
]

function inputFor (id: string): Record<string, AiParameter> {
  const suffix = id.replace('product-setting-season-', '')
  if (suffix === 'list') return {
    provinceCode: param('省级行政区编码；省变更时应清空cityCode和districtCode，省略时不发送。', '温度配置列表筛选表单', { type: 'string', required: false }),
    cityCode: param('市级行政区编码；必须属于provinceCode，省略时不发送。', '温度配置列表筛选表单', { type: 'string', required: false }),
    districtCode: param('区县行政区编码；必须属于cityCode，省略时不发送。', '温度配置列表筛选表单', { type: 'string', required: false }),
    pageNo: param('从1开始的页码；默认1。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数；只支持10、20、50，默认10。', 'Portal分页状态', { type: '10 | 20 | 50', required: false, default: '10' }),
  }
  if (suffix === 'get' || suffix === 'prepare-remove') return { areaCode: param('六位行政区编码；来自最近一次list结果。', 'productSettingSeason.list.result.list[].areaCode', { type: 'string', required: true }) }
  if (suffix === 'prepare-save') return { form: param('温度配置表单；省必选，温度段和日期范围按Portal/Java规则填写。', '用户填写的温度配置表单', { type: 'object', required: true }) }
  if (suffix === 'save') return { draft: param('prepareSave返回的完整温度配置草稿；确认后原样提交。', 'productSettingSeason.prepareSave.result.draft', { type: 'object', required: true }) }
  if (suffix === 'remove') return { areaCode: param('prepareRemove返回的六位行政区编码；用户确认后提交。', 'productSettingSeason.prepareRemove.result.areaCode', { type: 'string', required: true }) }
  if (suffix === 'prepare-remove-batch') return { areaCodes: param('待删除的六位行政区编码数组；最多50项。', '用户选择的当前页地区配置', { type: 'string[]', required: true }) }
  if (suffix === 'remove-batch') return { areaCodes: param('prepareRemoveBatch返回的地区编码数组；用户确认后提交。', 'productSettingSeason.prepareRemoveBatch.result.areaCodes', { type: 'string[]', required: true }) }
  return {}
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-season-', '')
  const isAreaTree = suffix === 'area-tree'
  const isTempBandList = suffix === 'temp-band-list'
  const isList = suffix === 'list'
  const isGet = suffix === 'get'
  const isPrepare = suffix.startsWith('prepare-')
  const isWrite = ['save', 'remove', 'remove-batch'].includes(suffix)
  const steps: AiContract['steps'] = []
  const prepareTarget = suffix === 'prepare-save' ? 'product-setting-season-save'
    : suffix === 'prepare-remove' ? 'product-setting-season-remove'
      : suffix === 'prepare-remove-batch' ? 'product-setting-season-remove-batch' : undefined
  if (isPrepare && prepareTarget) {
    const mapping: Record<string, string> = suffix === 'prepare-save' ? { draft: 'result.draft' } : suffix === 'prepare-remove' ? { areaCode: 'result.areaCode' } : { areaCodes: 'result.areaCodes' }
    steps.push({ role: 'required', when: '用户确认提交prepare返回的结果', capabilityId: prepareTarget, mapping, instruction: '把prepare结果原样交给对应写能力；用户取消时只丢弃本地草稿，不发送写请求。' })
    steps.push({ role: 'cancel', when: '用户取消当前表单或删除确认', instruction: '只丢弃draft或areaCode(s)，不调用写能力。' })
  }
  if (isWrite) steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: 'product-setting-season-list', instruction: suffix === 'save' ? '重新调用list并按areaCode回查温度段、日期范围和操作时间。' : '重新调用list确认目标地区配置不再出现；批量删除要逐个核对areaCode。' })

  let output: AiContract['output'] = trueOutput
  if (isAreaTree) output = areaTreeOutput
  else if (isTempBandList) output = tempBandOutput
  else if (isList) output = listOutput
  else if (isGet) output = detailOutput
  else if (suffix === 'prepare-save') output = { shape: '{ draft: object }', fields: saveDraftFields, empty: '省、行政区层级、温度段ID、日期范围、全年覆盖、重叠或连续性不满足时抛错，且不发送请求。' }
  else if (suffix === 'prepare-remove') output = { shape: '{ areaCode: string }', fields: [field('areaCode', 'string', '尚未发送删除请求的六位行政区编码。')], empty: 'areaCode为空或不是六位数字时抛错，且不发送删除请求。' }
  else if (suffix === 'prepare-remove-batch') output = { shape: '{ areaCodes: string[] }', fields: [field('areaCodes', 'array', '经过去重和六位编码校验、等待用户确认的地区编码。'), field('areaCodes[]', 'string', '待删除地区配置的areaCode。')], empty: '没有有效areaCode或超过50项时抛错，且不发送删除请求。' }

  const effect: AiContract['effect'] = isPrepare ? 'prepare' : isWrite ? 'write' : 'read'
  return {
    purpose: isAreaTree ? '读取Portal地区选择树。' : isTempBandList ? '读取Portal新建温度配置依赖的启用温度段。' : isList ? '按地区层级筛选分页读取温度配置。' : isGet ? '读取指定地区温度配置详情。' : suffix === 'prepare-save' ? '按Portal表单和Java业务规则准备温度配置草稿。' : suffix === 'save' ? '按Portal提交体保存地区年度温度配置。' : suffix === 'prepare-remove' ? '准备一个经过用户确认的单地区删除草稿。' : suffix === 'remove' ? '删除一个地区温度配置。' : suffix === 'prepare-remove-batch' ? '准备一个经过用户确认的批量删除草稿。' : '批量删除地区温度配置。',
    whenToUse: `需要在${PRODUCT_SETTING_SEASON_PAGE_PATH}页面执行对应${isWrite || isPrepare ? '写入' : '查询'}时使用。`,
    boundaries: commonBoundaries,
    effect,
    prerequisites: ['使用当前用户、当前租户会话token，并确认用户拥有温度配置页面权限；温度段ID和地区编码必须来自当前Portal数据。', ...(isWrite || isPrepare ? ['写操作目标必须来自当前页面最新list/get结果或同一次prepare结果。'] : [])],
    inputs: inputFor(id),
    output,
    consume: isAreaTree ? ['用[].id作为省/市/区选择值，children用于下级选项。'] : isTempBandList ? ['创建前确认返回数组非空；使用tempBandId、bandName、sortNo和dateRanges初始化表单。'] : isList || isGet ? ['用areaCode进入编辑、单删或批量删除；用tempBands[].dateRanges展示覆盖范围。'] : isPrepare ? ['把draft或areaCode(s)展示给用户确认；取消只丢弃本地结果。'] : ['写请求成功或不确定后按steps回查list/get；true不是业务终态。'],
    steps,
    completion: isPrepare ? '获得尚未改变服务端的本地草稿。' : isWrite ? '请求按Portal URL、HTTP方法、参数、权限上下文和表单规则完成，并按步骤回查业务终态。' : '获得与Portal页面消费形状一致的结果。',
    failures: ['表单层级、六位行政区编码、温度段数量/唯一性、日期有效性、全年覆盖、重叠、连续性、权限、网络或Java业务错误均抛出；不降级为空列表、不假成功。'],
    idempotency: isWrite ? '页面没有统一requestId幂等协议；写请求响应不确定时先list/get回查，再决定是否重试，避免重复保存或删除。' : null,
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingSeasonCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`产品设置温度配置-新契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_SEASON_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_SEASON_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_SEASON_METHODS).map(([id, method]) => [
    `productSettingSeason.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingSeason.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
