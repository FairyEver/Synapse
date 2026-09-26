import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_TENANT_LOG_METHODS,
  PRODUCT_SETTING_TENANT_LOG_PAGE_PATH,
  PRODUCT_SETTING_TENANT_LOG_PERMISSION,
  productSettingTenantLogCapabilities,
} from '../capabilities/product-setting-tenant-log.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingTenantLogCapabilities.map(definition => [definition.id, definition]))

const companyFields: AiField[] = [
  field('[].id', 'string | number', '企业选项ID；提交统计查询时作为companyId。'),
  field('[].name', 'string', '企业名称；Portal下拉框展示文本。'),
  field('[].useSystem', 'string | null', 'Java企业实体的系统使用标记；后端只返回useSystem包含4的企业，SDK保留原字段供审计。', { optional: true, nullable: true, nullMeaning: '后端没有返回该实体字段。' }),
]

const functionFields: AiField[] = [
  field('[].id', 'string | number', '功能树节点ID。'),
  field('[].name', 'string', '当前功能树节点名称。'),
  field('[].fullName', 'string', 'SDK按根到当前节点用连字符拼接的完整路径；叶节点只有恰好三段时才能转换成统计接口的functionList项。'),
  field('[].childList', 'object[]', '子节点数组；没有子节点时为空数组。'),
  field('[].childList[].id', 'string | number', '子节点ID。'),
  field('[].childList[].name', 'string', '子节点名称。'),
  field('[].childList[].fullName', 'string', '子节点从根拼接出的完整路径。'),
  field('[].childList[].childList', 'object[]', '更深层子节点，递归结构与当前节点相同。'),
]

const userFields: AiField[] = [
  field('[].id', 'string | number', '用户ID；用户统计模式和用户明细的userIdList来源。'),
  field('[].name', 'string', '用户姓名；Portal用户下拉框展示文本。'),
]

const rowFields: AiField[] = [
  field('[].module1', 'string | null', 'Java统计结果的一级模块；功能和用户明细可用来定位功能。', { nullable: true, nullMeaning: '该统计模式或后端记录没有一级模块。' }),
  field('[].module2', 'string | null', 'Java统计结果的二级模块。', { nullable: true, nullMeaning: '该统计模式或后端记录没有二级模块。' }),
  field('[].module3', 'string | null', 'Java统计结果的三级功能。', { nullable: true, nullMeaning: '该统计模式或后端记录没有三级功能。' }),
  field('[].moduleName', 'string | null', '模块展示名称；功能明细和用户明细也可能由Java服务拼接。', { nullable: true, nullMeaning: '响应未提供模块名称。' }),
  field('[].functionName', 'string | null', '功能展示名称；Java服务可能用::连接层级名称。', { nullable: true, nullMeaning: '响应未提供功能名称。' }),
  field('[].recordCount', 'integer | null', '记录类使用次数。', { nullable: true, nullMeaning: '响应未提供记录次数。' }),
  field('[].searchCount', 'integer | null', '搜索类使用次数。', { nullable: true, nullMeaning: '响应未提供搜索次数。' }),
  field('[].totalCount', 'integer | null', 'Java服务计算的recordCount + searchCount总次数。', { nullable: true, nullMeaning: '响应未提供总次数。' }),
  field('[].userId', 'string | number | null', '明细所属用户ID；用户汇总行可能没有可回传的userId，不能从姓名猜ID。', { nullable: true, nullMeaning: '该行没有可靠用户ID。' }),
  field('[].officeName', 'string | null', '用户所属组织名称。', { nullable: true, nullMeaning: '后端没有匹配到组织。' }),
  field('[].userName', 'string | null', '用户姓名。', { nullable: true, nullMeaning: '后端没有匹配到用户。' }),
  field('[].phone', 'string | null', '用户手机号。', { nullable: true, nullMeaning: '后端没有返回手机号。' }),
  field('[].date', 'string | null', '用户统计汇总日期。', { nullable: true, nullMeaning: '该行不是按日期汇总或后端没有返回日期。' }),
  field('[].createDate', 'string | null', '明细事件创建时间。', { nullable: true, nullMeaning: '后端没有返回创建时间。' }),
  field('[].requestType', 'integer | null', 'Portal使用记录请求类型。', { nullable: true, nullMeaning: '后端没有返回请求类型。' }),
]

const commonBoundaries = [
  `页面路径是${PRODUCT_SETTING_TENANT_LOG_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_TENANT_LOG_PERMISSION}；Portal没有为本页声明独立query或submit按钮权限。SDK不绕过页面权限。`,
  '所有请求使用Portal product HTTP实例并补devicetype=PC；该页面没有可推导的module-type，因此不发送module-type。',
  '企业候选固定调用GET /sys/office/getTenantCompanyList? id=0；Java服务只返回useSystem包含4的企业。不要把任意企业ID伪造为候选项。',
  '功能候选固定调用GET /config/leaf/getTree?code=functionUrl。Portal把完整路径按连字符拆分，只把恰好三段的叶节点转换为{module1,module2,module3}；不能用节点名称或任意层级替代。',
  '选择企业后Portal才调用GET /sys/user，参数固定为pageSize=99999、pageNo=1、office.id=companyId；公司为空时页面清空用户，不发送用户请求。SDK的userList要求显式有效companyId。',
  '统计表单默认pageType=1，默认日期为当前日期前30天到当前日期，deviceType默认空字符串；日期必须是YYYY-MM-DD且结束日期不能早于开始日期。',
  '模块模式只发送companyId、startDate、endDate、deviceType；功能模式追加functionList；用户模式再追加userIdList。所有模式都使用POST，响应是非分页数组。',
  '模块明细只发送module；功能明细发送module、module1、module2、module3；用户明细发送userIdList和functionList。明细参数必须来自同一页面统计结果和当前筛选条件。',
  'Java对公司、功能数组、用户数组执行必填校验；功能统计还受服务端结果量限制。接口错误、权限错误或响应形状错误都抛出，不能降级为空数组。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、tenant-log.vue、tenant-log/list.vue、module-details.vue、function-details.vue、user-details.vue', kind: 'reference', note: '逐页核对菜单路径、页面权限、三种pageType、表单默认值和校验、九个请求及表格字段。' },
  { source: 'app/portal/utils/http/product.js 与 common/libs/renren/list.js', kind: 'reference', note: '核对product实例、devicetype、响应解包、非分页customLoad和日期/表单请求消费形状。' },
  { source: 'UseStatisticsController、UserReportV1VO、CompanyUseSituationDTO、CompanyUseSituationDetailDTO、UseStatisticsServiceImpl', kind: 'reference', note: '核对统计接口必填字段、功能层级映射、用户/组织补全、六个模块补零和次数合计。' },
  { source: 'OfficeController、LeafController、UserController及对应Service/VO', kind: 'reference', note: '核对企业过滤、functionUrl树、office.id用户筛选和分页返回字段。' },
  { source: 'src/capabilities/product-setting-tenant-log.ts 与 test/product-setting-tenant-log.test.ts', kind: 'implementation', note: '锁定Portal请求、页面参数校验、响应字段和反证；不替代真实环境证据。' },
  { source: 'docs/pages/产品设置企业使用情况.md', kind: 'reference', note: '记录页面四件套、逐字段语义、参数映射、权限和证据边界。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话逐页执行企业选项、功能树、用户候选、三种统计和三个明细请求；当前只有Portal/Java源码与离线请求形状证据。',
  '尚未在真实环境确认当前租户的企业、功能树和用户数据权限；若后端返回业务错误，SDK会保留错误而不会伪造空结果。',
]

function inputFor (id: string): Record<string, AiParameter> {
  if (id === 'product-setting-tenant-log-company-list' || id === 'product-setting-tenant-log-function-tree') return {}
  if (id === 'product-setting-tenant-log-user-list') return {
    companyId: param('企业候选返回的非空企业ID；Portal用它填充GET /sys/user的office.id。', 'productSettingTenantLog.companyList.result[].id', { type: 'string | number', required: true }),
  }
  const common: Record<string, AiParameter> = {
    companyId: param('企业候选返回的非空企业ID。', 'productSettingTenantLog.companyList.result[].id', { type: 'string | number', required: true }),
    deviceType: param('登录平台筛选；空字符串表示不限定平台。', 'Portal页面筛选表单', { type: 'string', required: false, default: '', options: [{ value: '', label: '全部平台' }, { value: 'PC', label: 'PC' }, { value: 'APP', label: 'APP' }] }),
    startDate: param('统计开始日期，YYYY-MM-DD；默认当前日期前30天。', 'Portal页面日期范围', { type: 'string', required: false, default: '当前日期前30天', format: 'YYYY-MM-DD' }),
    endDate: param('统计结束日期，YYYY-MM-DD；默认当前日期。', 'Portal页面日期范围', { type: 'string', required: false, default: '当前日期', format: 'YYYY-MM-DD' }),
  }
  if (id === 'product-setting-tenant-log-list') {
    return {
      pageType: param('统计模式：1模块使用情况、2功能使用情况、3用户使用情况；默认1。', 'Portal页面模式切换', { type: 'string', required: false, default: '1', options: [{ value: '1', label: '模块使用情况' }, { value: '2', label: '功能使用情况' }, { value: '3', label: '用户使用情况' }] }),
      ...common,
      functionList: param('功能树叶节点转换后的功能数组；pageType为2或3时必填，每项必须包含module1、module2、module3。', 'productSettingTenantLog.functionTree.result', { type: 'object[]', required: false }),
      userIdList: param('企业用户候选返回的用户ID数组；pageType为3时必填。', 'productSettingTenantLog.userList.result[].id', { type: 'array', required: false }),
    }
  }
  if (id === 'product-setting-tenant-log-module-detail') return { ...common, module: param('统计列表行的moduleName；必须来自同一筛选条件的模块统计结果。', 'productSettingTenantLog.list.result[].moduleName', { type: 'string', required: true }) }
  if (id === 'product-setting-tenant-log-function-detail') return {
    ...common,
    module: param('统计列表行的moduleName。', 'productSettingTenantLog.list.result[].moduleName', { type: 'string', required: true }),
    module1: param('统计列表行的一级模块。', 'productSettingTenantLog.list.result[].module1', { type: 'string', required: true }),
    module2: param('统计列表行的二级模块。', 'productSettingTenantLog.list.result[].module2', { type: 'string', required: true }),
    module3: param('统计列表行的三级功能。', 'productSettingTenantLog.list.result[].module3', { type: 'string', required: true }),
  }
  return {
    ...common,
    userIdList: param('企业用户候选返回的用户ID数组；必须非空。', 'productSettingTenantLog.userList.result[].id', { type: 'array', required: true }),
    functionList: param('功能树叶节点转换后的功能数组；必须非空。', 'productSettingTenantLog.functionTree.result', { type: 'object[]', required: true }),
  }
}

function outputFor (id: string): AiContract['output'] {
  if (id === 'product-setting-tenant-log-company-list') return {
    shape: 'object[]',
    fields: companyFields,
    empty: '[]表示Java过滤后当前用户可见企业为空；权限、网络或响应错误会抛出。',
  }
  if (id === 'product-setting-tenant-log-function-tree') return {
    shape: 'object[]',
    fields: functionFields,
    empty: '[]表示functionUrl功能树为空；不能把空树解释为所有功能。',
  }
  if (id === 'product-setting-tenant-log-user-list') return {
    shape: 'object[]',
    fields: userFields,
    empty: '[]表示指定企业当前没有可选用户；公司ID无效、权限或网络错误会抛出。',
  }
  return {
    shape: 'object[]',
    fields: rowFields,
    empty: '[]表示当前公司、日期、平台、功能或用户条件下没有统计记录；权限、业务或响应错误会抛出。',
  }
}

function contractFor (id: string): AiContract {
  const isLookup = id.endsWith('-company-list') || id.endsWith('-function-tree') || id.endsWith('-user-list')
  const isList = id === 'product-setting-tenant-log-list'
  const steps: AiContract['steps'] = []
  if (isList) {
    steps.push({ role: 'required', when: '需要打开本页统计或用户明确改变公司、模式、日期、平台、功能或用户筛选', capabilityId: 'product-setting-tenant-log-company-list', mapping: {}, instruction: '先读取企业候选并使用其中的id，不要凭企业名称猜ID。' })
    steps.push({ role: 'required', when: 'pageType为2或3且尚未取得功能候选', capabilityId: 'product-setting-tenant-log-function-tree', mapping: {}, instruction: '读取功能树，只把完整路径恰好三段的叶节点转换为functionList。' })
    steps.push({ role: 'required', when: 'pageType为3且公司已选择', capabilityId: 'product-setting-tenant-log-user-list', mapping: { companyId: 'args.companyId' }, instruction: '使用当前公司ID读取用户候选，再把用户ID组成非空userIdList。' })
  }
  if (id.endsWith('-detail')) {
    steps.push({ role: 'required', when: '统计列表行需要展开明细', capabilityId: 'product-setting-tenant-log-list', mapping: {}, instruction: '明细参数必须来自同一公司、日期、平台和列表行；明细返回仍是数组，不能当分页对象。' })
  }
  const title = id === 'product-setting-tenant-log-company-list'
    ? '企业选项'
    : id === 'product-setting-tenant-log-function-tree'
      ? '功能树'
      : id === 'product-setting-tenant-log-user-list'
        ? '用户选项'
        : id === 'product-setting-tenant-log-list'
          ? '统计列表'
          : id.endsWith('-module-detail')
            ? '模块使用明细'
            : id.endsWith('-function-detail')
              ? '功能使用明细'
              : '用户使用明细'
  return {
    purpose: `读取Portal企业使用情况页面的${title}。`,
    whenToUse: `需要在${PRODUCT_SETTING_TENANT_LOG_PAGE_PATH}页面获取${title}时使用。`,
    effect: 'read',
    inputs: inputFor(id),
    output: outputFor(id),
    consume: isLookup
      ? ['候选项的id用于后续请求，name用于展示；不要只凭展示名称重建ID。']
      : isList
        ? ['pageType=1按模块消费moduleName和次数；pageType=2按module1/2/3、moduleName、functionName和次数消费；pageType=3按userName、officeName、phone、date和次数消费。点击明细时保留原筛选条件。']
        : ['把返回数组逐行展示或继续分析；userId、模块层级和日期可能为空时按字段的nullMeaning处理，不从姓名或展示文本猜测缺失ID。'],
    boundaries: commonBoundaries,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认拥有页面菜单权限；候选和统计数据仍受后端数据权限与业务校验限制。'],
    steps,
    completion: `获得与Portal${title}消费形状一致的结果，并保留后端返回的可解释字段。`,
    failures: ['输入校验失败时不发请求；页面权限、数据权限、网络、Java必填校验、功能数量限制或响应结构错误均抛出，不能假造成功或静默改用其它接口。'],
    idempotency: null,
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingTenantLogCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`企业使用情况契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_TENANT_LOG_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_TENANT_LOG_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_TENANT_LOG_METHODS).map(([id, method]) => [
    `productSettingTenantLog.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingTenantLog.${method}；这是只读查询，不包含写入或提交步骤。`] },
  ]),
)
