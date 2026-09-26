import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_DAY_LIQUIDATION_METHODS,
  PRODUCT_SETTING_DAY_LIQUIDATION_PAGE_PATH,
  productSettingDayLiquidationCapabilities,
} from '../capabilities/product-setting-day-liquidation.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingDayLiquidationCapabilities.map(definition => [definition.id, definition]))

const pageFields: AiField[] = [
  field('$', 'object', '日清日结分页结果；list是当前页，total是当前筛选条件下的总条数。'),
  field('list', 'object[]', '当前页的日清日结记录。'),
  field('list[].farm', 'string | null', '后端记录中的场区ID；当前Java列表SQL可能不返回该字段。', { nullable: true, nullMeaning: 'Java DTO没有填充场区ID。' }),
  field('list[].farmName', 'string | null', '场区展示名称；由服务端按查询farm回填。', { nullable: true, nullMeaning: '服务端没有找到场区名称。' }),
  field('list[].typeName', 'string | null', '类型展示名称：入孵、验蛋、出雏、雏鸡日记录或蛋鸡日记录。', { nullable: true, nullMeaning: '服务端没有按type生成名称。' }),
  field('list[].recordDate', 'string | null', '业务记录日期，YYYY-MM-DD。', { nullable: true, format: 'YYYY-MM-DD', nullMeaning: '底层记录没有业务日期。' }),
  field('list[].opDate', 'string | null', '操作日期，YYYY-MM-DD。', { nullable: true, format: 'YYYY-MM-DD', nullMeaning: '底层记录没有操作日期。' }),
  field('list[].name', 'string | null', '操作人真实姓名。', { nullable: true, nullMeaning: '关联用户没有姓名。' }),
  field('list[].disparityDay', 'integer', 'recordDate到opDate的自然日差值；Java使用DAYS.between(recordDate, opDate)，不是绝对值且不含首日加一。'),
  field('total', 'integer', '当前筛选条件下的总记录数，不是当前页长度。'),
]

const buildingFields: AiField[] = [
  field('$', 'object[]', '页面栋号下拉最终消费的候选数组。'),
  field('[].value', 'string | number', '栋号ID；传给list.building。'),
  field('[].label', 'string', '栋号shortName；只用于下拉展示。'),
]

const batchFields: AiField[] = [
  field('$', 'object[]', '页面批次号下拉最终消费的候选数组。'),
  field('[].value', 'string', '批次选择值，格式为`${batch}__${groupId}`；传给list.businessId，list请求只取分隔符后的groupId。'),
  field('[].label', 'string', '批次号batch；页面下拉展示文本。'),
]

const commonBoundaries = [
  `页面路径是${PRODUCT_SETTING_DAY_LIQUIDATION_PAGE_PATH}，菜单权限是/dashboard/frame/business/day-liquidation；页面筛选表单要求type、farm、businessId。SDK不绕过页面或服务端权限。`,
  '所有请求使用Portal product HTTP实例并补devicetype=PC；该页面module-type推导结果为null，因此不发送module-type。',
  'type=1/2/3时Portal场区选择器发送typeList=3，type=4发送typeList=1，type=5发送typeList=2；场区组件默认authList=1，只显示当前用户有权限的场区。SDK要求调用方传入该选择器产生的farm ID。',
  '页面固定发送scope=1（模拟模式），列表还带order=""、orderField=""、pageNo默认1、pageSize默认20；页面支持10、20、50、100。',
  'Portal批次下拉把后端batch和groupId拼成`${batch}__${groupId}`；提交列表时无条件执行businessId.split("__")[1]，因此SDK也只发送分隔符后的批次组ID。',
  'Java的日清日结列表SQL对type=4/5按flock_group_id筛选；type=1/2/3的SQL按sh.batch筛选，而Portal仍发送拼接值的第二段groupId。这是当前Portal与Java实现的事实差异，SDK保持Portal请求形状，不按类型擅自改写。列表SQL当前也没有使用farm/building过滤条件，不能把请求中带有这些字段解释为后端已按场区/栋号过滤。',
  '页面没有写操作、详情、导出或删除入口；SDK只提供读取列表、栋号候选和批次候选。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js 与 app/portal/views/dashboard/product/setting/business-manage/day-liquidation/list.vue', kind: 'reference', note: '逐页核对菜单路径、权限、product实例、五种类型、必填规则、联动清空、分页、请求和表格字段。' },
  { source: 'app/portal/components/portal/product/select/farm/index.vue 与 common/libs/renren/list.js、app/portal/main.js', kind: 'reference', note: '核对场区候选的typeList/authList映射、farm/栋号/批次下拉映射、order/pageNo/pageSize默认值以及product响应解包。' },
  { source: 'DayLiquidationController、DayLiquidationListVO、FlockMeasureListVO、DayLiquidationListDTO、DayLiquidationServiceImpl、FlockMeasureServiceImpl', kind: 'reference', note: '核对scope/farm/type校验、批次候选分流、分页分流、类型名称和差距天数计算。' },
  { source: 'FlockDiaryMapperExt.xml 与 HatchMapperExt.xml', kind: 'reference', note: '核对四类日清日结SQL的businessId、日期、scope/用户关联条件，以及type=1/2/3使用batch而不是groupId的后端差异。' },
  { source: 'src/capabilities/product-setting-day-liquidation.ts 与 test/product-setting-day-liquidation.test.ts', kind: 'implementation', note: '锁定Portal请求参数、下拉映射、返回字段、product实例、权限边界和离线反证；不替代真实环境证据。' },
  { source: 'docs/pages/产品设置日清日结.md', kind: 'reference', note: '记录页面四件套、参数转换、后端差异和证据边界。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话执行五种type的场区/栋号/批次联动和列表读取；离线请求与源码证据不替代真实页面闭环。',
  'Portal type=1/2/3把batch下拉的groupId发送给Java按sh.batch过滤的列表接口，且Java列表SQL没有使用farm/building条件；这是待Portal/后端共同确认的业务缺口，SDK没有静默修正。',
]

const listInputs: Record<string, AiParameter> = {
  type: param('页面类型枚举：1入孵、2验蛋、3出雏、4雏鸡日记录、5蛋鸡日记录。', '用户选择的类型', { type: '1 | 2 | 3 | 4 | 5', required: true }),
  farm: param('场区ID；必须来自当前用户有权限的Portal场区选择器。', 'Portal场区选择器结果', { type: 'string | number', required: true }),
  building: param('栋号ID；省略表示不按栋号选择。', 'Portal栋号下拉value', { type: 'string | number', required: false, nullable: true }),
  businessId: param('批次下拉value，必须原样使用batchList返回的`${batch}__${groupId}`，SDK会按Portal规则只取分隔符后的groupId。', 'productSettingDayLiquidation.batchList.result[].value', { type: 'string', required: true, constraints: ['必须包含非空的__第二段'] }),
  startDate: param('开始日期；YYYY-MM-DD；省略表示不设下限。', '用户日期筛选', { type: 'string', required: false, nullable: true, format: 'YYYY-MM-DD' }),
  endDate: param('结束日期；YYYY-MM-DD；省略表示不设上限。', '用户日期筛选', { type: 'string', required: false, nullable: true, format: 'YYYY-MM-DD' }),
  pageNo: param('从1开始的页码；默认1。', '调用方分页状态', { type: 'integer', required: false, default: '1' }),
  pageSize: param('每页条数；只支持10、20、50、100；默认20。', '调用方分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
}

const buildingInputs: Record<string, AiParameter> = {
  farmId: param('当前用户有权限的场区ID。', 'Portal场区选择器结果', { type: 'string | number', required: true }),
}

const batchInputs: Record<string, AiParameter> = {
  type: param('页面类型枚举；决定Portal场区选择器使用的场区类型：1/2/3→3，4→1，5→2。', '用户选择的类型', { type: '1 | 2 | 3 | 4 | 5', required: true }),
  farm: param('场区ID；必须来自当前用户有权限的Portal场区选择器。', 'Portal场区选择器结果', { type: 'string | number', required: true }),
  building: param('栋号ID；省略表示不限制栋号。', 'Portal栋号下拉value', { type: 'string | number', required: false, nullable: true }),
}

function contractFor (id: string): AiContract {
  const isList = id === 'product-setting-day-liquidation-list'
  const isBuildingList = id === 'product-setting-day-liquidation-building-list'
  const output = isList
    ? { shape: '{ list: object[], total: integer }', fields: pageFields, empty: 'list=[]表示当前页没有记录；total=0才表示当前筛选条件没有记录，权限、网络或后端错误会抛出。' }
    : isBuildingList
      ? { shape: 'object[]', fields: buildingFields, empty: '[]表示当前场区没有可选栋号。' }
      : { shape: 'object[]', fields: batchFields, empty: '[]表示当前type、场区和栋号下没有可选批次。' }
  return {
    purpose: isList ? '按类型、场区、批次和可选日期筛选日清日结记录。' : isBuildingList ? '读取所选场区的栋号下拉候选。' : '按页面类型、场区和可选栋号读取批次号下拉候选。',
    whenToUse: `需要在${PRODUCT_SETTING_DAY_LIQUIDATION_PAGE_PATH}页面${isList ? '查询记录' : isBuildingList ? '选择栋号' : '查询批次号'}时使用。`,
    effect: 'read',
    inputs: isList ? listInputs : isBuildingList ? buildingInputs : batchInputs,
    output,
    consume: isList
      ? ['展示list中的场区、类型、记录日期、操作日期、操作人和差距天数；total用于分页，不能用当前页长度代替。', 'type=1/2/3返回为空时，先核对batchList的value转换和当前Java按batch过滤的事实差异，不要自动换成batch号重试。']
      : isBuildingList
        ? ['把value传回list.building；label只用于展示。场区变化后丢弃旧栋号。']
        : ['把value原样传给list.businessId；不要只传label，也不要把groupId单独改成批次号。', '场区类型应与type联动：1/2/3使用孵化场类型3，4使用雏鸡场类型1，5使用蛋鸡场类型2。'],
    boundaries: commonBoundaries,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认拥有页面菜单权限及后端数据权限。', ...(isList ? ['businessId来自同一次batchList调用，避免使用过期批次候选。'] : [])],
    steps: [],
    completion: isList ? '获得与Portal分页表格消费形状一致的list和total。' : isBuildingList ? '获得当前场区的栋号value/label候选。' : '获得当前筛选条件的批次value/label候选。',
    failures: ['类型、ID、复合批次value、日期或分页参数校验失败时不发请求；权限、网络、响应结构或Java业务错误均抛出，不能降级为空数组或假成功。'],
    idempotency: null,
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingDayLiquidationCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`日清日结契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_DAY_LIQUIDATION_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_DAY_LIQUIDATION_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_DAY_LIQUIDATION_METHODS).map(([id, method]) => [
    `productSettingDayLiquidation.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingDayLiquidation.${method}；这是只读能力，不存在prepare或submit步骤。`] },
  ]),
)
