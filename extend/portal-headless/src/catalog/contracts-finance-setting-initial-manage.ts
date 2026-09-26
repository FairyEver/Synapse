import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  FINANCE_SETTING_INITIAL_MANAGE_METHODS,
  financeSettingInitialManageCapabilities,
} from '../capabilities/finance-setting-initial-manage.js'

const PAGE_PATH = '/dashboard/finance/setting/initial-manage/list'
const PAGE_PERMISSION = '/dashboard/finance/setting/initial-manage'
const TABS = [
  { label: '科目期初数据', value: 'SUBJECT' },
  { label: '供应商期初明细账', value: 'SUPPLIER' },
  { label: '客户期初明细账', value: 'CUSTOMER' },
  { label: '生产性生物资产-种蛋鸡', value: 'BIO_LAYING_HEN' },
  { label: '生产性生物资产-育成鸡', value: 'BIO_GROWING_CHICKEN' },
  { label: '银行明细账', value: 'BANK_STATEMENT' },
]

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main@acab69acc77b6d6c0da21310cdfd26b91a01641e：app/portal/menus/finance.js、app/portal/views/dashboard/finance/setting/initial-manage/list.vue、setting/components/opening-setting-list.vue、opening-setting-config.js、opening-setting-export.js',
    kind: 'reference',
    note: '逐页核对入口权限、6个页签、表单筛选、按钮状态条件、请求体、导入限制、对账结果本地导出和操作日志。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test@0f1a55718ebc1987affb8bf245106e809dd51da4：erp-module-finance/.../OpeningSettingController.java、controller/admin/openingsetting/vo/*、service/openingsetting/OpeningSettingServiceImpl.java',
    kind: 'reference',
    note: '核对分页请求/响应、LocalDate月份、导入multipart参数、试算、对账、人工匹配、删除、入账、结果和日志返回字段。',
  },
  { source: 'src/capabilities/finance-setting-initial-manage.ts', kind: 'implementation', note: '证明SDK绑定platform实例、moduleType=null、按当前页签过滤请求字段、Base64文件转multipart、分页投影和本地对账结果导出。' },
  { source: 'test/finance-setting-initial-manage.test.ts', kind: 'test', note: '证明逐页源码/Java锚点、表单默认与条件筛选、写请求映射、导入大小边界、响应投影和反证测试。' },
]

const boundaries = [
  `只覆盖Portal页面${PAGE_PATH}及其实际可达的6个期初页签、导入/试算/对账/人工匹配/删除/入账/结果/日志；不扩展到独立财务菜单或旧版期初接口。`,
  `页面权限是${PAGE_PERMISSION}；按钮权限按Portal源码分别是finance:setting:opening-setting:import、:trial、:reconcile，删除/人工匹配/入账/结果/日志没有额外的permissionCheck。SDK不把前端隐藏当成后端授权结论。`,
  '列表请求只发送当前页签可见筛选字段：Portal表单没有subjectName输入框，因此SDK不会把Java VO中存在但页面未发送的subjectName扩进请求。',
  '两个生物资产分页响应的summary/summaryRows是页面底部汇总的一部分；它们不是明细list，必须按汇总行语义消费。',
  '页面没有撤销导入、试算、对账、人工匹配、删除或入账的后端接口；prepare阶段可放弃，submit后只能按页面提供的查询/日志/结果入口核实，不能伪造cancel。',
]

const prerequisites = [
  '请求必须走当前用户/租户绑定的platform实例；module-type按页面明确不发送，不能手工补一个生产或财务模块类型。',
  '写动作前先调用status，确认locked=false且disabledReason为空；Portal会在账套或月份改变后刷新状态，旧状态不能作为新月份的授权依据。',
  '账套ID、明细ID和批次ID来自当前Portal页面或status/list结果；不要用名称、列表下标或猜测的ID替代。',
]

const failures = [
  '日期、页签、ID、分页、行ID数组或文件格式不合法时，SDK在发请求前失败；不把校验失败改写为空列表。',
  '401/403、网络错误和后端业务错误原样失败；Portal权限按钮隐藏与接口真正拒绝是两类结果，不能互相推断。',
  '导入success=false时保留errors和periodResults供修正；成功或请求超时后必须用status/list独立核对批次和行数，不能只看HTTP成功或successCount。',
  '试算、对账、人工匹配、删除和入账没有requestId或cancel接口；超时后先查status、list、结果或日志，未确认前不要盲目重试。',
  '对账结果导出是Portal在前端分页读取后生成SpreadsheetML文件，不是后端export接口；导出失败不代表对账状态发生变化。',
]

const contextInputs: Record<string, AiParameter> = {
  accountingSetId: input('账套ID；必须来自Portal账套选择器或当前状态。', 'Portal账套选择器的value', { type: 'string | number', constraints: ['正整数ID', '长ID保留字符串'] }),
  periodMonth: input('期初所属月份。', 'Portal月份选择器', { type: 'string', format: 'YYYY-MM-DD', constraints: ['有效日期；SDK与Portal一样归一化为该月第一天'] }),
}
const tabInput: AiParameter = input('当前页签编码。', 'Portal当前激活页签的code', { type: 'enum', options: TABS, constraints: ['只传6个固定编码'] })
const fileInputs: Record<string, AiParameter> = {
  fileName: input('上传文件名。', '用户选择的文件名', { type: 'string', constraints: ['扩展名必须是.xlsx或.xls'] }),
  base64: input('文件二进制内容的标准Base64。', '调用方读取的文件内容', { type: 'string', constraints: ['非空', '解码后不超过20MB'] }),
  contentType: optional('文件MIME类型。', '用户文件类型或调用方提供的MIME', '按fileName扩展名推导', { type: 'string', nullable: true }),
}

const draftInputs = (meaning: string, source: string, includeTabType = false): Record<string, AiParameter> => ({
  draft: input(meaning, source, { type: 'object' }),
  'draft.accountingSetId': input('草稿中的账套ID；用于写入后的同账套状态或明细回查。', `${source}.accountingSetId`, { type: 'string | number' }),
  'draft.periodMonth': input('草稿中的归一化月份；用于写入后的同月份状态或明细回查。', `${source}.periodMonth`, { type: 'string', format: 'YYYY-MM-DD' }),
  ...(includeTabType ? {
    'draft.tabType': input('草稿中的当前页签编码；用于写入后的同页签明细回查。', `${source}.tabType`, { type: 'enum', options: TABS }),
  } : {}),
})

const commonRowFields: AiField[] = [
  field('list[].id', 'string | number', '期初明细行主键；人工匹配或删除时使用，不是行号', { constraints: ['正整数', '长ID保留字符串'] }),
  field('list[].rowNo', 'integer', '导入文件行号；页面展示时按Portal规则将大于1的值减1', { nullable: true, nullMeaning: '响应没有行号' }),
  field('list[].accountingSetCode', 'string', '账套编码列', { nullable: true, nullMeaning: '响应没有账套编码' }),
  field('list[].accountingSetName', 'string', '账套名称列', { nullable: true, nullMeaning: '响应没有账套名称' }),
  field('list[].matchStatus', 'integer', '匹配状态：0未对账、1匹配、2不匹配、3忽略；Portal不匹配行用红色展示', { nullable: true, values: { '0': '未对账', '1': '匹配', '2': '不匹配', '3': '忽略' } }),
  field('list[].errorMessage', 'string', '该行导入或匹配错误信息', { nullable: true, nullMeaning: '没有错误信息' }),
]

const rowFields: AiField[] = [
  ...commonRowFields,
  field('list[].subjectType', 'string', '科目类型；SUBJECT页签', { optional: true, nullable: true }),
  field('list[].subjectCode', 'string', '科目编码；页面列和筛选字段', { optional: true, nullable: true }),
  field('list[].subjectName', 'string', '科目名称；页面展示值', { optional: true, nullable: true }),
  field('list[].endingDebitAmount', 'number | string', '期末借方金额；SUBJECT页签原值', { optional: true, nullable: true }),
  field('list[].endingCreditAmount', 'number | string', '期末贷方金额；SUBJECT页签原值', { optional: true, nullable: true }),
  field('list[].endingQuantity', 'number | string', '期末数量；SUBJECT页签原值', { optional: true, nullable: true }),
  field('list[].supplierCode', 'string', '供应商编码；SUPPLIER页签', { optional: true, nullable: true }),
  field('list[].supplierName', 'string', '供应商名称；SUPPLIER页签', { optional: true, nullable: true }),
  field('list[].supplierCategoryCode', 'string', '供应商分类编码', { optional: true, nullable: true }),
  field('list[].supplierCategoryName', 'string', '供应商分类名称', { optional: true, nullable: true }),
  field('list[].beginningBalance', 'number | string', '期初余额；SUPPLIER页签原值', { optional: true, nullable: true }),
  field('list[].endingBalance', 'number | string', '期末余额；供应商/客户页签原值', { optional: true, nullable: true }),
  field('list[].estimatedEndingBalance', 'number | string', '暂估期末余额；SUPPLIER页签', { optional: true, nullable: true }),
  field('list[].endingBalanceTotal', 'number | string', '期末余额合计；SUPPLIER页签', { optional: true, nullable: true }),
  field('list[].customerCode', 'string', '客户编码；CUSTOMER页签', { optional: true, nullable: true }),
  field('list[].customerName', 'string', '客户名称；CUSTOMER页签', { optional: true, nullable: true }),
  field('list[].salesAreaCode', 'string', '销售区域编码；CUSTOMER页签', { optional: true, nullable: true }),
  field('list[].salesAreaName', 'string', '销售区域名称；CUSTOMER页签', { optional: true, nullable: true }),
  field('list[].salesAreaDescription', 'string', '销售区域描述；Portal将Java salesAreaDesc映射为此字段', { optional: true, nullable: true }),
  field('list[].salesDeptName', 'string', '销售部门名称；CUSTOMER页签', { optional: true, nullable: true }),
  field('list[].salespersonCode', 'string', '业务员编码；CUSTOMER页签', { optional: true, nullable: true }),
  field('list[].salespersonName', 'string', '业务员名称；CUSTOMER页签', { optional: true, nullable: true }),
  field('list[].orderNo', 'string', '订单号；两个生物资产页签', { optional: true, nullable: true }),
  field('list[].batchNo', 'string', '批次号；两个生物资产页签', { optional: true, nullable: true }),
  field('list[].materialCode', 'string', '物料编码；两个生物资产页签', { optional: true, nullable: true }),
  field('list[].materialName', 'string', '物料名称；两个生物资产页签', { optional: true, nullable: true }),
  field('list[].factoryName', 'string', '场区名称；页面展示值', { optional: true, nullable: true }),
  field('list[].day154Value', 'number | string', '154日龄价值；种蛋鸡页签', { optional: true, nullable: true }),
  field('list[].monthEndQuantity', 'number | string', '月末数量；种蛋鸡页签', { optional: true, nullable: true }),
  field('list[].openingOriginalValue', 'number | string', '期初原值；种蛋鸡页签', { optional: true, nullable: true }),
  field('list[].endingNetValue', 'number | string', '期末净值；种蛋鸡页签', { optional: true, nullable: true }),
  field('list[].accumulatedDepreciation', 'number | string', '累计折旧；种蛋鸡页签', { optional: true, nullable: true }),
  field('list[].endingStockQuantity', 'number | string', '期末库存数量；育成鸡页签', { optional: true, nullable: true }),
  field('list[].endingCostAmount', 'number | string', '期末成本金额；育成鸡页签', { optional: true, nullable: true }),
  field('list[].endingUnitPrice', 'number | string', '期末单价；育成鸡页签', { optional: true, nullable: true }),
  field('list[].externalSubjectCode', 'string', '外部系统科目编码；生物资产页签', { optional: true, nullable: true }),
  field('list[].externalSubjectName', 'string', '外部系统科目名称；生物资产页签', { optional: true, nullable: true }),
  field('list[].externalBalanceDirection', 'string', '外部系统余额借贷方向；生物资产页签', { optional: true, nullable: true }),
  field('list[].financeSubjectCode', 'string', '财务系统科目编码；生物资产页签', { optional: true, nullable: true }),
  field('list[].financeSubjectName', 'string', '财务系统科目名称；生物资产页签', { optional: true, nullable: true }),
  field('list[].bankAccountCode', 'string', '银行账户编码；BANK_STATEMENT页签', { optional: true, nullable: true }),
  field('list[].bankAccountName', 'string', '银行账户名称；BANK_STATEMENT页签', { optional: true, nullable: true }),
  field('list[].statementDate', 'string', '银行流水日期；BANK_STATEMENT页签', { optional: true, nullable: true, format: 'YYYY-MM-DD' }),
  field('list[].summary', 'string', '银行流水摘要；BANK_STATEMENT页签', { optional: true, nullable: true }),
  field('list[].debitAmount', 'number | string', '银行流水借方金额；原值', { optional: true, nullable: true }),
  field('list[].creditAmount', 'number | string', '银行流水贷方金额；原值', { optional: true, nullable: true }),
  field('list[].balanceAmount', 'number | string', '银行流水余额；原值', { optional: true, nullable: true }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer, summary?: object, summaryRows?: object[] }',
  fields: [field('$', 'object', '当前页签分页结果'), field('list', 'array', '当前页明细；不是全部匹配记录'), ...rowFields, field('total', 'integer', '筛选结果总数；不是当前页长度', { constraints: ['非负整数'] }), field('summary', 'object', '生物资产页签底部汇总首行；仅BIO_LAYING_HEN/BIO_GROWING_CHICKEN可能返回', { optional: true, nullable: true }), field('summaryRows', 'array', '生物资产页签底部汇总行；按rowType和summaryField渲染，不能当作明细', { optional: true })],
  empty: 'list=[]且total=0表示当前筛选没有明细；summaryRows可能为空。权限、网络或响应结构失败会抛错。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName: string, contentType: string, byteLength: integer, base64: string }',
  fields: [field('$', 'object', '非空Excel或SpreadsheetML文件'), field('fileName', 'string', '文件名'), field('contentType', 'string', '文件MIME类型'), field('byteLength', 'integer', '文件字节数；必须大于0'), field('base64', 'string', '文件二进制的标准Base64；可解码保存到本地')],
  empty: '文件响应为空或不是二进制时抛错，不返回空文件。',
}

const contract = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence'> & Partial<Pick<AiContract, 'boundaries' | 'prerequisites' | 'failures' | 'evidence'>>): AiContract => ({
  whenToUse: `操作Portal“系统设置→财务设置→期初设置”页面${PAGE_PATH}；先根据页签和账套月份选择正确的能力，不要猜测未出现在页面上的字段或接口。`,
  boundaries,
  prerequisites,
  failures,
  evidence,
  gaps: [
    '本轮已完成Portal与Java源码及离线请求/反证核对，尚未在真实测试门户执行期初导入、删除、对账或入账写入，因此不把离线结果称为真实持久化证据。',
    'Portal页面权限按钮和Java Controller权限注解的最终运行时裁决仍需真实租户验证；SDK保留后端错误，不以源码中的按钮显示替代授权结果。',
  ],
  ...value,
})

const contextOutput: AiContract['output'] = {
  shape: '{ accountingSetId: string | number, periodMonth: string }',
  fields: [field('draft.accountingSetId', 'string | number', '账套ID；来自当前页面上下文'), field('draft.periodMonth', 'string', '归一化月份第一天', { format: 'YYYY-MM-DD' })],
  empty: '输入非法时抛错且不发请求。',
}

const actionOutput = (shape: string, fields: AiField[], empty: string): AiContract['output'] => ({ shape, fields, empty })

export const FINANCE_SETTING_INITIAL_MANAGE_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-initial-manage-list-tabs': contract({
    purpose: '读取Portal期初设置固定6个页签及其排序。', effect: 'read', inputs: {},
    output: { shape: 'object[]', fields: [field('$', 'array', '期初设置页签数组'), field('[].code', 'enum', '页签编码', { values: Object.fromEntries(TABS.map(item => [String(item.value), item.label])) }), field('[].name', 'string', '页签名称'), field('[].sort', 'integer', '页面排序')], empty: '空数组只表示接口返回无页签；响应结构错误会抛错。' },
    consume: ['用code选择list的当前页签；不要把页签名称反向猜成接口路径。'], steps: [], completion: '获得可供页面渲染的固定页签列表。', idempotency: null,
  }),

  'finance-setting-initial-manage-status': contract({
    purpose: '读取当前账套和月份的导入、锁定、试算与对账状态，为Portal按钮保护和后续写入提供最新上下文。', effect: 'read', inputs: contextInputs,
    output: { shape: '{ accountingSetId, periodMonth, sourcePeriodMonth, locked, disabledReason, tabs[] }', fields: [field('accountingSetId', 'string | number', '当前账套ID'), field('periodMonth', 'string', '期初月份', { format: 'YYYY-MM-DD' }), field('sourcePeriodMonth', 'string', '导入来源月份；通常是所选月份的上一月第一天', { nullable: true }), field('locked', 'boolean', '是否锁定；true时页面禁用导入、删除、试算、对账'), field('disabledReason', 'string', '页面禁用原因', { nullable: true, nullMeaning: '没有额外禁用原因' }), field('tabs', 'array', '各页签状态'), field('tabs[].tabType', 'enum', '页签编码'), field('tabs[].imported', 'boolean', '是否已导入'), field('tabs[].batchId', 'string | number', '当前导入批次ID；删除时使用', { nullable: true }), field('tabs[].versionNo', 'integer', '导入版本号', { nullable: true }), field('tabs[].rowCount', 'integer', '当前批次行数', { nullable: true }), field('tabs[].trialStatus', 'integer', '试算状态：0未试算、1平衡、2不平衡', { nullable: true }), field('tabs[].reconcileStatus', 'integer', '对账状态：0未对账、1对账中、2匹配、3不匹配、4取消', { nullable: true }), field('tabs[].importTime', 'string', '最近导入时间原值', { nullable: true })], empty: 'tabs为空表示当前响应没有页签状态，不等同于所有页签未导入。' },
    consume: ['写操作前重新读取；locked=true或disabledReason非空时遵守页面置灰规则。', '从tabs[tabType].batchId取得删除所需批次ID；从rowCount核对导入/删除是否生效。'],
    steps: [], completion: '获得当前账套月份的最新状态；不代表任何写操作已发生。', idempotency: null,
  }),

  'finance-setting-initial-manage-list': contract({
    purpose: '按当前Portal页签和可见筛选条件分页读取期初明细。', effect: 'read', inputs: { tabType: tabInput, ...contextInputs, subjectCode: optional('科目编码筛选；仅SUBJECT/SUPPLIER/CUSTOMER/BANK_STATEMENT发送。', '当前页科目选择器', '省略'), supplierCode: optional('供应商编码筛选；仅SUPPLIER发送。', '供应商编码输入框', '省略'), supplierName: optional('供应商名称筛选；仅SUPPLIER发送。', '供应商名称输入框', '省略'), customerCode: optional('客户编码筛选；仅CUSTOMER发送。', '客户编码输入框', '省略'), customerName: optional('客户名称筛选；仅CUSTOMER发送。', '客户名称输入框', '省略'), orderNo: optional('订单号筛选；仅两个生物资产页签发送。', '订单号输入框', '省略'), batchNo: optional('批次号筛选；仅两个生物资产页签发送。', '批次号输入框', '省略'), materialCode: optional('物料编码筛选；仅两个生物资产页签发送。', '物料编码输入框', '省略'), materialName: optional('物料名称筛选；仅两个生物资产页签发送。', '物料名称输入框', '省略'), bankAccountCode: optional('银行账户编码筛选；仅BANK_STATEMENT发送。', '银行账户编码输入框', '省略'), bankAccountName: optional('银行账户名称筛选；仅BANK_STATEMENT发送。', '银行账户名称输入框', '省略'), pageNo: optional('从1开始的页码。', '分页状态', '使用1', { type: 'integer' }), pageSize: optional('每页条数。', '分页状态', '使用50', { type: 'integer' }) },
    output: listOutput,
    consume: ['先按tabType只读取对应字段；list中的id用于人工匹配或删除，rowNo用于定位导入行。', '生物资产页签同时消费summaryRows作为底部汇总，不能把summaryRows计入total。', '按total继续翻页；空list不是权限成功的证明。'],
    steps: [{ role: 'required', when: '需要执行导入、试算、对账、删除或入账', capabilityId: 'finance-setting-initial-manage-status', mapping: { accountingSetId: 'args.accountingSetId', periodMonth: 'args.periodMonth' }, instruction: '用同一账套和月份读取最新状态并根据locked、disabledReason及页签状态决定是否继续。' }],
    completion: '返回当前页签当前筛选的一页结构化明细和总数；不代表任何写操作已发生。', idempotency: null,
  }),

  'finance-setting-initial-manage-download-template': contract({
    purpose: '下载当前期初页签对应的Excel导入模板。', effect: 'read', inputs: { tabType: tabInput, ...contextInputs, accountingSetCode: optional('Portal上下文中的账套编码。', '账套选择器原始对象', '省略', { nullable: true }), accountingSetName: optional('Portal上下文中的账套名称。', '账套选择器原始对象', '省略', { nullable: true }), accountCode: optional('Portal兼容账套编码。', '账套选择器原始对象', '省略', { nullable: true }), accountingName: optional('Portal兼容账套名称。', '账套选择器原始对象', '省略', { nullable: true }) },
    output: fileOutput, consume: ['把base64解码为xlsx交给用户填写；模板下载不等于数据已导入。'], steps: [], completion: '获得非空的当前页签导入模板文件。', idempotency: null,
  }),

  'finance-setting-initial-manage-prepare-import': contract({
    purpose: '在上传前复刻Portal文件控件的扩展名、Base64非空和20MB限制；该步骤不发网络请求。', effect: 'prepare', inputs: fileInputs,
    output: { shape: '{ fileName, contentType, byteLength }', fields: [field('fileName', 'string', '上传文件名'), field('contentType', 'string', '实际multipart MIME'), field('byteLength', 'integer', '待上传字节数；不超过20MB')], empty: '文件名、Base64、扩展名或大小非法时抛错且不返回半成品。' },
    consume: ['向用户展示文件摘要并确认导入影响；再用同一文件输入调用import。'], steps: [{ role: 'required', when: '用户确认文件且status允许导入', capabilityId: 'finance-setting-initial-manage-import', mapping: { tabType: 'user.tabType', accountingSetId: 'user.accountingSetId', periodMonth: 'user.periodMonth', fileName: 'args.fileName', base64: 'args.base64', contentType: 'args.contentType' }, instruction: '提交同一文件；Portal/Java按当前账套、月份、页签全量覆盖有效导入版本。' }], completion: '得到可确认的文件摘要，尚未写入期初数据。', idempotency: null,
  }),

  'finance-setting-initial-manage-import': contract({
    purpose: '上传当前页签的期初Excel并返回逐行失败与分期间处理结果。', effect: 'write', inputs: { tabType: tabInput, ...contextInputs, ...fileInputs },
    output: { shape: '{ batchId, success, successCount, failCount, errors[], periodResults[] }', fields: [field('batchId', 'string | number', '新导入批次ID；后续status和删除使用', { nullable: true }), field('success', 'boolean', '整次导入是否成功'), field('successCount', 'integer', '成功行数'), field('failCount', 'integer', '失败行数'), field('errors', 'array', '失败明细'), field('errors[].rowNo', 'integer', 'Excel行号'), field('errors[].fieldName', 'string', '失败字段', { nullable: true }), field('errors[].errorReason', 'string', '失败原因', { nullable: true }), field('periodResults', 'array', '分期间导入结果；可能为空')], empty: '响应缺少关键字段时抛错；success=false不能当成部分成功写入。' },
    consume: ['success=false时展示errors并修正文件；success=true后调用status和list独立核对批次、行数和字段。', '文件导入没有Portal cancel/delete恢复旧版本接口；需要撤销时只能放弃提交或准备正确完整文件再次导入。'], steps: [{ role: 'required', when: '导入返回或请求超时后', capabilityId: 'finance-setting-initial-manage-status', mapping: { accountingSetId: 'args.accountingSetId', periodMonth: 'args.periodMonth' }, instruction: '读取最新批次和行数；再按tabType调用list核对明细，不要只依据HTTP成功。' }], completion: '获得服务端导入结果并完成status/list核对；未核对前只报告请求结果，不报告已生效。', idempotency: '后端没有requestId；重复提交可能生成新版本或覆盖数据，超时必须先核对再重试。',
  }),

  'finance-setting-initial-manage-prepare-trial-balance': contract({ purpose: '准备Portal科目期初试算请求，校验账套和月份但不执行试算。', effect: 'prepare', inputs: contextInputs, output: contextOutput, consume: ['确认status中当前账套月份可操作且科目数据已导入后提交。'], steps: [{ role: 'required', when: 'status允许试算且需要查看结果', capabilityId: 'finance-setting-initial-manage-trial-balance', mapping: { draft: 'result.$' }, instruction: '原样提交prepare返回的draft。' }], completion: '得到未写入的试算草稿。', idempotency: null }),
  'finance-setting-initial-manage-trial-balance': contract({ purpose: '执行Portal科目期初试算并返回借贷合计、分类金额和差额。', effect: 'write', inputs: draftInputs('prepare-trial-balance返回的账套/月度草稿。', 'finance-setting-initial-manage-prepare-trial-balance.result.draft'), output: actionOutput('{ balanced, totalDebitAmount, totalCreditAmount, differenceAmount, ... }', [field('balanced', 'boolean', '是否平衡'), field('totalDebitAmount', 'number | string', '借方合计', { nullable: true }), field('totalCreditAmount', 'number | string', '贷方合计', { nullable: true }), field('asset', 'number | string', '资产类金额', { nullable: true }), field('cost', 'number | string', '成本类金额', { nullable: true }), field('equity', 'number | string', '权益类金额', { nullable: true }), field('liability', 'number | string', '负债类金额', { nullable: true }), field('profitLoss', 'number | string', '损益类金额', { nullable: true }), field('differenceAmount', 'number | string', '借贷差额', { nullable: true }), field('message', 'string', 'Portal试算提示', { nullable: true })], '响应缺少balanced时抛错。'), consume: ['展示balanced、合计和差额；试算结果不是入账完成证明。'], steps: [{ role: 'required', when: '需要确认状态更新', capabilityId: 'finance-setting-initial-manage-status', mapping: { accountingSetId: 'args.draft.accountingSetId', periodMonth: 'args.draft.periodMonth' }, instruction: '刷新当前状态查看trialStatus。' }], completion: '获得一次试算结果并刷新状态；页面没有撤销试算接口。', idempotency: null }),

  'finance-setting-initial-manage-prepare-reconcile': contract({ purpose: '准备Portal期初对账请求，校验账套和月份但不启动对账。', effect: 'prepare', inputs: contextInputs, output: contextOutput, consume: ['status中至少有科目及一个业务明细页签已导入且页面允许对账时使用。'], steps: [{ role: 'required', when: 'status允许对账', capabilityId: 'finance-setting-initial-manage-reconcile', mapping: { draft: 'result.$' }, instruction: '原样提交草稿。' }], completion: '得到未执行的对账草稿。', idempotency: null }),
  'finance-setting-initial-manage-reconcile': contract({ purpose: '执行Portal期初对账并返回对账批次号、全局匹配结果和结果条数。', effect: 'write', inputs: draftInputs('prepare-reconcile返回的账套/月度草稿。', 'finance-setting-initial-manage-prepare-reconcile.result.draft'), output: actionOutput('{ reconcileNo: string|null, matched: boolean, resultCount: integer }', [field('reconcileNo', 'string', '对账批次号；结果分页可按当前账套/月份读取', { nullable: true }), field('matched', 'boolean', '是否全部匹配'), field('resultCount', 'integer', '对账结果条数')], '响应结构错误时抛错。'), consume: ['matched=false时调用对账结果分页定位不匹配项；页面支持重新对账。'], steps: [{ role: 'required', when: '需要查看对账明细或独立核对', capabilityId: 'finance-setting-initial-manage-reconcile-results', mapping: { accountingSetId: 'args.draft.accountingSetId', periodMonth: 'args.draft.periodMonth' }, instruction: '读取结果并按matchStatus消费。' }, { role: 'required', when: '需要刷新页签状态', capabilityId: 'finance-setting-initial-manage-status', mapping: { accountingSetId: 'args.draft.accountingSetId', periodMonth: 'args.draft.periodMonth' }, instruction: '刷新reconcileStatus。' }], completion: '对账请求完成且结果入口可继续核对；matched不等同于已入账。', idempotency: '后端没有requestId；重复执行可能生成新的对账批次，先查结果和日志再重试。' }),

  'finance-setting-initial-manage-prepare-manual-match': contract({ purpose: '准备单条或批量人工确认期初匹配请求。', effect: 'prepare', inputs: { ...contextInputs, tabType: tabInput, lineIds: input('当前页选中的有效明细ID数组。', 'list返回的list[].id', { type: 'array', constraints: ['1至1000项', '不能重复'] }) }, output: { shape: '{ draft: { accountingSetId, periodMonth, tabType, lineIds[] } }', fields: [field('draft.accountingSetId', 'string | number', '账套ID'), field('draft.periodMonth', 'string', '归一化月份', { format: 'YYYY-MM-DD' }), field('draft.tabType', 'enum', '当前页签编码'), field('draft.lineIds', 'array', '待确认明细ID数组')], empty: 'ID数组非法时抛错且不发请求。' }, consume: ['提交前刷新status并确认未锁定；不要把matchStatus=1或3的行当成必须人工确认。'], steps: [{ role: 'required', when: '用户确认人工匹配', capabilityId: 'finance-setting-initial-manage-manual-match', mapping: { draft: 'result.$' }, instruction: '原样提交草稿。' }], completion: '得到未执行的人工匹配草稿。', idempotency: null }),
  'finance-setting-initial-manage-manual-match': contract({ purpose: '按Portal当前页签和选中明细ID批量人工确认为匹配。', effect: 'write', inputs: draftInputs('prepare-manual-match返回的完整草稿。', 'finance-setting-initial-manage-prepare-manual-match.result.draft', true), output: actionOutput('{ updatedCount: integer, allMatchedOrIgnored: boolean, remainingCount: integer }', [field('updatedCount', 'integer', '本次更新条数'), field('allMatchedOrIgnored', 'boolean', '全部明细是否均已匹配或忽略'), field('remainingCount', 'integer', '仍未匹配或忽略的条数')], '响应结构错误时抛错。'), consume: ['展示更新条数和remainingCount；完成后刷新当前页和status。'], steps: [{ role: 'required', when: '提交后需要独立核对', capabilityId: 'finance-setting-initial-manage-list', mapping: { tabType: 'args.draft.tabType', accountingSetId: 'args.draft.accountingSetId', periodMonth: 'args.draft.periodMonth' }, instruction: '按原页签重新分页查询选中行和匹配状态。' }], completion: '获得人工匹配结果并完成列表核对；页面没有撤销人工确认接口。', idempotency: '后端没有requestId；重复提交可能更新0行或重复记录日志，超时先查列表和日志。' }),

  'finance-setting-initial-manage-prepare-delete-lines': contract({ purpose: '准备删除当前期初导入批次中选中的明细行。', effect: 'prepare', inputs: { ...contextInputs, tabType: tabInput, batchId: input('当前页签status中的导入批次ID。', 'finance-setting-initial-manage-status.result.tabs[].batchId', { type: 'string | number' }), lineIds: input('当前列表选中的明细ID数组。', 'finance-setting-initial-manage-list.result.list[].id', { type: 'array', constraints: ['1至1000项', '不能重复'] }) }, output: { shape: '{ draft: { accountingSetId, periodMonth, tabType, batchId, lineIds[] } }', fields: [field('draft.accountingSetId', 'string | number', '账套ID'), field('draft.periodMonth', 'string', '归一化月份', { format: 'YYYY-MM-DD' }), field('draft.tabType', 'enum', '页签编码'), field('draft.batchId', 'string | number', '导入批次ID'), field('draft.lineIds', 'array', '删除明细ID')], empty: 'ID、批次或数组非法时抛错且不发请求。' }, consume: ['提交前必须确认status未锁定、当前页签已导入且reconcileStatus不是对账中/匹配；Portal还会拒绝已匹配行。'], steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'finance-setting-initial-manage-delete-lines', mapping: { draft: 'result.$' }, instruction: '原样提交草稿。' }], completion: '得到未执行的删除草稿。', idempotency: null }),
  'finance-setting-initial-manage-delete-lines': contract({ purpose: '删除Portal当前导入批次中选中的期初明细。', effect: 'write', inputs: draftInputs('prepare-delete-lines返回的完整草稿。', 'finance-setting-initial-manage-prepare-delete-lines.result.draft', true), output: actionOutput('{ batchId, deletedCount, rowCount }', [field('batchId', 'string | number', '处理的导入批次ID', { nullable: true }), field('deletedCount', 'integer', '本次删除行数'), field('rowCount', 'integer', '删除后当前批次剩余行数')], '响应结构错误时抛错。'), consume: ['用rowCount调整分页并重新调用status/list；删除后需重新试算和对账。'], steps: [{ role: 'required', when: '删除后核对结果', capabilityId: 'finance-setting-initial-manage-list', mapping: { tabType: 'args.draft.tabType', accountingSetId: 'args.draft.accountingSetId', periodMonth: 'args.draft.periodMonth' }, instruction: '查询同一页签，确认被删ID不再返回。' }], completion: '获得删除回执并通过list/status核对；页面没有恢复已删行的cancel接口。', idempotency: '后端没有requestId；同一请求重试可能删除0行，先list核对再重试。' }),

  'finance-setting-initial-manage-prepare-post-to-ledger': contract({ purpose: '准备把当前账套月份所有已对账期初数据写入正式明细账的请求。', effect: 'prepare', inputs: contextInputs, output: contextOutput, consume: ['只在status中所有已导入页签均完成匹配且页面按钮可用时提交；Portal提示仍有未匹配数据时禁止入账。'], steps: [{ role: 'required', when: '用户确认入账', capabilityId: 'finance-setting-initial-manage-post-to-ledger', mapping: { draft: 'result.$' }, instruction: '原样提交草稿。' }], completion: '得到未执行的入账草稿。', idempotency: null }),
  'finance-setting-initial-manage-post-to-ledger': contract({ purpose: '执行Portal“期初入账”，将已匹配期初数据写入正式明细账。', effect: 'write', inputs: draftInputs('prepare-post-to-ledger返回的完整草稿。', 'finance-setting-initial-manage-prepare-post-to-ledger.result.draft'), output: actionOutput('{ posted: boolean, subjectCount: integer, customerCount: integer, supplierCount: integer, bankAccountCount: integer }', [field('posted', 'boolean', '是否完成明细账写入'), field('subjectCount', 'integer', '写入科目期初条数'), field('customerCount', 'integer', '写入客户期初条数'), field('supplierCount', 'integer', '写入供应商期初条数'), field('bankAccountCount', 'integer', '写入银行明细条数')], '响应结构错误时抛错。'), consume: ['posted=true只说明接口回执完成；按对应明细账查询能力或页面状态独立核对业务生效。'], steps: [{ role: 'required', when: '需要查看入账后的操作记录', capabilityId: 'finance-setting-initial-manage-operation-logs', mapping: { accountingSetId: 'args.draft.accountingSetId', periodMonth: 'args.draft.periodMonth' }, instruction: '读取操作日志核对入账记录。' }], completion: '获得入账回执并完成日志/下游明细账核对；页面没有撤销入账接口。', idempotency: '后端没有requestId；超时或重复调用可能重复处理，必须先查日志和明细账。' }),

  'finance-setting-initial-manage-reconcile-results': contract({ purpose: '分页读取当前账套月份的期初对账结果，定位匹配或不匹配的模块、科目和金额。', effect: 'read', inputs: { ...contextInputs, moduleCode: optional('模块/页签编码；Portal在SUBJECT页签省略，否则使用当前页签编码。', '当前激活页签', '省略', { type: 'enum', options: TABS }), subjectCode: optional('科目编码筛选。', '当前页面科目筛选', '省略'), matchStatus: optional('匹配状态数值筛选。', '调用方筛选', '省略', { type: 'integer' }), pageNo: optional('页码。', '结果弹窗分页', '使用1', { type: 'integer' }), pageSize: optional('每页条数。', '结果弹窗分页', '使用50', { type: 'integer' }) }, output: { shape: '{ list: object[], total: integer }', fields: [field('list', 'array', '当前页对账结果'), field('list[].id', 'string | number', '对账结果行主键'), field('list[].moduleCode', 'string', '模块编码', { nullable: true }), field('list[].moduleName', 'string', '模块名称；页面模块列', { nullable: true }), field('list[].subjectCode', 'string', '科目编码', { nullable: true }), field('list[].subjectName', 'string', '科目名称', { nullable: true }), field('list[].sourceSystem', 'string', '来源系统', { nullable: true }), field('list[].matchStatus', 'integer', '匹配状态；2在Portal中标红', { nullable: true }), field('list[].sourceAmount', 'number | string', '来源金额', { nullable: true }), field('list[].financeAmount', 'number | string', '财务金额', { nullable: true }), field('list[].differenceAmount', 'number | string', '差异金额', { nullable: true }), field('list[].sourceQuantity', 'number | string', '来源数量；接口可能返回但页面表格不展示', { nullable: true }), field('list[].financeQuantity', 'number | string', '财务数量；接口可能返回但页面表格不展示', { nullable: true }), field('list[].differenceQuantity', 'number | string', '数量差异；接口可能返回但页面表格不展示', { nullable: true }), field('list[].detailJson', 'string', '后端详情原文；页面不直接展示', { nullable: true }), field('total', 'integer', '结果总数')], empty: 'list=[]且total=0表示当前条件没有对账结果；不能视为对账成功。' }, consume: ['matched=false时按matchStatus和differenceAmount定位问题；需要导出时调用export能力而不是自行猜测分页上限。'], steps: [], completion: '返回当前条件的一页对账结果和总数。', idempotency: null }),

  'finance-setting-initial-manage-export-reconcile-results': contract({ purpose: '复刻Portal“导出结果”：读取全部对账结果并生成包含8列的SpreadsheetML Excel文件。', effect: 'local', inputs: contextInputs, output: fileOutput, consume: ['将base64解码并保存为对账结果.xls；文件内容来自对账结果分页，不代表对账状态改变。'], steps: [{ role: 'required', when: '导出前尚未完成对账结果核对', capabilityId: 'finance-setting-initial-manage-reconcile-results', mapping: { accountingSetId: 'args.accountingSetId', periodMonth: 'args.periodMonth' }, instruction: '可先读取一页确认筛选上下文。' }], completion: '得到非空的对账结果文件；导出本身不写业务数据。', idempotency: null }),

  'finance-setting-initial-manage-operation-logs': contract({ purpose: '分页读取当前账套月份的期初设置操作日志。', effect: 'read', inputs: { ...contextInputs, tabType: optional('页签编码筛选。', '当前激活页签或用户选择', '省略表示全部', { type: 'enum', options: TABS, nullable: true }), operationType: optional('操作类型筛选。', '调用方筛选', '省略'), pageNo: optional('页码。', '调用方分页状态', '使用1', { type: 'integer' }), pageSize: optional('每页条数。', '调用方分页状态', '使用50', { type: 'integer' }) }, output: { shape: '{ list: object[], total: integer }', fields: [field('list', 'array', '当前页操作日志'), field('list[].id', 'string | number', '日志主键'), field('list[].tabType', 'enum', '页签编码', { nullable: true }), field('list[].operationType', 'string', '操作类型；Portal将DELETE_LINES展示为删除导入数据', { nullable: true }), field('list[].operationStatus', 'integer', '操作状态数值', { nullable: true }), field('list[].operatorId', 'string | number', '操作人ID', { nullable: true }), field('list[].operatorName', 'string', '操作人名称', { nullable: true }), field('list[].startTime', 'string', '开始时间原值', { nullable: true }), field('list[].endTime', 'string', '结束时间原值', { nullable: true }), field('list[].failureDetailJson', 'string', '失败明细JSON原文', { nullable: true }), field('list[].remark', 'string', '备注', { nullable: true }), field('total', 'integer', '日志总数')], empty: 'list=[]且total=0表示没有日志；不能据此断言没有发生过被过滤的操作。' }, consume: ['导入、删除、试算、对账、入账后按账套和月份刷新日志，作为写入结果的辅助证据；不把日志本身当作明细账回查。'], steps: [], completion: '返回当前条件的一页操作日志。', idempotency: null }),
}

Object.assign(FINANCE_SETTING_INITIAL_MANAGE_AI_CONTRACTS, {
  'finance-setting-initial-manage-prepare-update': contract({
    purpose: '按期初设置隐藏编辑表单准备完整更新草稿，不发送PUT。',
    effect: 'prepare',
    inputs: {
      form: input('隐藏编辑表单完整值；必须保留ID和四个金额字段。', 'Portal期初设置隐藏编辑表单', { type: 'object', constraints: ['id来自当前页记录；openingBalance、accumulatedDebit、accumulatedCredit、beginningBalance为金额字符串或null；未知字段按Portal表单一并保留。'] }),
      'form.id': input('期初明细ID。', 'Portal隐藏编辑表单.id', { type: 'string | number' }),
      'form.openingBalance': input('期初余额。', 'Portal隐藏编辑表单.openingBalance', { type: 'string | null', nullable: true }),
      'form.accumulatedDebit': input('累计借方。', 'Portal隐藏编辑表单.accumulatedDebit', { type: 'string | null', nullable: true }),
      'form.accumulatedCredit': input('累计贷方。', 'Portal隐藏编辑表单.accumulatedCredit', { type: 'string | null', nullable: true }),
      'form.beginningBalance': input('期初余额字段。', 'Portal隐藏编辑表单.beginningBalance', { type: 'string | null', nullable: true }),
    },
    output: { shape: '{ draft: object }', fields: [field('draft', 'object', '按Portal表单原字段保留的PUT草稿'), field('draft.id', 'string | number', '期初明细ID'), field('draft.openingBalance', 'string | null', '期初余额', { nullable: true }), field('draft.accumulatedDebit', 'string | null', '累计借方', { nullable: true }), field('draft.accumulatedCredit', 'string | null', '累计贷方', { nullable: true }), field('draft.beginningBalance', 'string | null', '期初余额字段', { nullable: true })], empty: '金额字符串格式、ID或必需字段非法时抛错；不发送请求。' },
    consume: ['向用户展示完整draft并取得明确确认；确认后原样交给update，取消调用cancel-update。'],
    steps: [{ role: 'required', when: '用户明确确认隐藏编辑保存', capabilityId: 'finance-setting-initial-manage-update', mapping: { draft: 'result.draft' }, instruction: '提交同一份完整draft，不自行删字段或改金额格式。' }, { role: 'cancel', when: '用户取消隐藏编辑保存', capabilityId: 'finance-setting-initial-manage-cancel-update', mapping: {}, instruction: '只丢弃本地draft，不发送PUT。' }],
    completion: '得到尚未写入服务端的完整期初编辑草稿。',
    idempotency: null,
  }),
  'finance-setting-initial-manage-update': contract({
    purpose: '保存期初设置隐藏编辑表单的完整金额字段。',
    effect: 'write',
    inputs: draftInputs('prepare-update返回的完整隐藏编辑草稿。', 'finance-setting-initial-manage-prepare-update.result.draft'),
    output: { shape: 'undefined', fields: [field('$', 'undefined', 'PUT成功无业务返回值；失败抛错')], empty: 'Promise正常完成只表示服务端接受请求，不等于列表已刷新。' },
    consume: ['PUT /admin-api/finance/initial-manage/update完成后，按保存前的页签、账套、月份和明细ID重新list核对四个金额字段；超时先回查，不盲目重试。'],
    steps: [{ role: 'recovery', when: '保存成功、超时或响应丢失后核实', capabilityId: 'finance-setting-initial-manage-list', mapping: { tabType: 'context.tabType', accountingSetId: 'context.accountingSetId', periodMonth: 'context.periodMonth' }, instruction: '在同一账套月份和页签分页查找draft.id，逐字段核对金额；无法定位时只报告请求结果。' }],
    completion: '请求完成且list回查确认同一明细四个金额字段已更新；没有回查时不得报告已落库。',
    idempotency: '后端没有requestId；超时必须先按同一明细ID回查，再决定是否重试。',
  }),
  'finance-setting-initial-manage-cancel-update': contract({
    purpose: '取消期初设置隐藏编辑的本地草稿，不发送PUT。',
    effect: 'local',
    inputs: {},
    output: { shape: '{ cancelled: true }', fields: [field('cancelled', 'boolean', '固定为true，表示本地编辑草稿已放弃')], empty: '不发HTTP请求，不改变服务端期初数据。' },
    consume: ['只表示提交前草稿已丢弃；不能撤销已经发送的更新。'],
    steps: [],
    completion: '返回cancelled=true且没有网络副作用。',
    idempotency: null,
  }),
})

for (const definition of financeSettingInitialManageCapabilities) {
  if (!FINANCE_SETTING_INITIAL_MANAGE_AI_CONTRACTS[definition.id]) throw new Error(`期初设置缺少AI契约：${definition.id}`)
}

export const FINANCE_SETTING_INITIAL_MANAGE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_INITIAL_MANAGE_METHODS).map(([id, method]) => [`financeSettingInitialManage.${method}`, FINANCE_SETTING_INITIAL_MANAGE_AI_CONTRACTS[id]!]),
)
