import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_METHODS } from '../capabilities/finance-setting-employee-loan-amount.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: false,
  nullable: false,
  ...extra,
})

const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })

const pagePath = '/dashboard/finance/setting/employee-loan-amount/list'
const permission = '/dashboard/finance/setting/employee-loan-amount'
const idRules = ['安全正整数或无前导零的正整数字符串', '长ID保留字符串，不能用员工姓名、工号或列表下标代替']
const fileInput = {
  fileName: input('上传文件名；必须保留扩展名，Portal文件控件接受.xml、.xlsx、.xls。', '调用方提供的文件名', { type: 'string', constraints: ['非空', '扩展名为.xml、.xlsx或.xls'] }),
  base64: input('文件二进制内容的标准Base64；SDK只在非空且可解码后才发multipart请求。', '调用方读取的文件内容', { type: 'string', constraints: ['非空标准Base64'] }),
  contentType: optional('文件MIME类型。', '文件类型或调用方提供的MIME', '按fileName扩展名推导', { type: 'string', nullable: true, nullMeaning: 'SDK按扩展名使用application/xml、application/vnd.ms-excel或XLSX MIME' }),
}

const rowFields = (prefix: string): AiField[] => [
  field(`${prefix}.id`, 'string | number', '员工借款额度记录主键；不是员工号、身份证号或列表下标', { constraints: idRules }),
  field(`${prefix}.employeeName`, 'string', '员工姓名；页面姓名列展示值'),
  field(`${prefix}.employeeNo`, 'string', '员工号；页面员工号列展示值', { nullable: true, nullMeaning: '后端没有员工号' }),
  field(`${prefix}.idCardNo`, 'string', '身份证号；页面证件号列展示值，也是导入去重和欠款计算关联键'),
  field(`${prefix}.phone`, 'string', '联系电话；页面不展示但后端响应可能返回', { nullable: true, nullMeaning: '后端没有联系电话' }),
  field(`${prefix}.gender`, 'integer', '性别数值：1男、2女；页面展示genderName', { nullable: true, nullMeaning: '无法按性别名称解析' }),
  field(`${prefix}.genderName`, 'string', '性别名称；页面性别列展示值', { nullable: true, nullMeaning: '后端未解析性别名称' }),
  field(`${prefix}.age`, 'integer', '年龄；页面年龄列展示值', { nullable: true, nullMeaning: '后端没有年龄' }),
  field(`${prefix}.organizationId`, 'string | number', '所属组织ID；当前列表页面不展示ID，不能用organizationName代替', { nullable: true, nullMeaning: '后端没有所属组织ID', constraints: idRules }),
  field(`${prefix}.organizationName`, 'string', '所属组织名称；页面所属组织列展示值', { nullable: true, nullMeaning: '后端没有所属组织名称' }),
  field(`${prefix}.position`, 'string', '岗位；页面岗位列展示值', { nullable: true, nullMeaning: '后端没有岗位' }),
  field(`${prefix}.employeeType`, 'integer', '员工属性数值：1内部、2外部；筛选使用该数值', { nullable: true, nullMeaning: '无法按员工属性名称解析', values: { '1': '内部', '2': '外部' } }),
  field(`${prefix}.employeeTypeName`, 'string', '员工属性名称；页面员工属性列展示值', { nullable: true, nullMeaning: '后端未解析员工属性名称' }),
  field(`${prefix}.loanQuota`, 'number | string', '借款额度；Decimal保留为数字或十进制字符串，单位由Portal业务约定为金额', { constraints: ['后端必填', '导入时必须大于0'] }),
  field(`${prefix}.debtAmount`, 'number | string', '欠款金额；服务端根据凭证分录借方减贷方计算且不小于0', { nullable: true, nullMeaning: '后端没有计算结果' }),
  field(`${prefix}.availableQuota`, 'number | string', '可用额度；服务端按借款额度减欠款金额计算，负数按0返回', { nullable: true, nullMeaning: '后端没有计算结果' }),
  field(`${prefix}.quotaStartDate`, 'string', '额度有效期起始日期', { format: 'YYYY-MM-DD' }),
  field(`${prefix}.quotaEndDate`, 'string', '额度有效期结束日期', { format: 'YYYY-MM-DD' }),
  field(`${prefix}.quotaPeriod`, 'string', '额度有效期展示拼接值，格式通常为起始日期至结束日期', { nullable: true, nullMeaning: '后端未生成展示字符串' }),
  field(`${prefix}.createTime`, 'string', '记录创建时间原值；SDK不做时区转换', { nullable: true, nullMeaning: '后端没有创建时间' }),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('$', 'object', '员工借款额度当前分页结果'),
    field('list', 'array', '当前页列表；不是全部匹配记录'),
    field('list[]', 'object', '一条员工借款额度列表行'),
    ...rowFields('list[]'),
    field('total', 'integer', '筛选结果总数；不是当前页长度', { constraints: ['非负整数'] }),
  ],
  empty: 'list=[]且total=0表示当前筛选没有记录；权限、网络或响应结构失败会抛错，不改写为空列表。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName: string, contentType: string, byteLength: integer, base64: string }',
  fields: [
    field('$', 'object', '已下载的员工借款额度模板文件'),
    field('fileName', 'string', '下载文件名；默认员工借款额度导入模板.xlsx'),
    field('contentType', 'string', '响应Content-Type；没有响应头时按XLSX MIME补齐'),
    field('byteLength', 'integer', '文件字节数；必须大于0'),
    field('base64', 'string', '文件二进制内容的标准Base64；可写入本地后交给Excel工具'),
  ],
  empty: '响应不是非空二进制文件时抛错，不返回空模板。',
}

const previewOutput: AiContract['output'] = {
  shape: '{ fileName: string, contentType: string, byteLength: integer }',
  fields: [
    field('$', 'object', '本地导入文件准备结果；尚未发网络请求'),
    field('fileName', 'string', '上传时使用的原始文件名'),
    field('contentType', 'string', '上传Blob使用的MIME类型'),
    field('byteLength', 'integer', '待上传文件字节数；必须大于0'),
  ],
  empty: '扩展名、Base64或文件内容非法时抛错且不返回半成品。',
}

const importOutput: AiContract['output'] = {
  shape: '{ successCount: integer, failCount: integer, failList: object[] }',
  fields: [
    field('$', 'object', '员工借款额度导入处理结果'),
    field('successCount', 'integer', '服务端校验并写入的成功行数；非空有效行时会参与全量替换'),
    field('failCount', 'integer', '服务端校验失败行数'),
    field('failList', 'array', '失败行明细；成功时通常为空数组'),
    field('failList[]', 'object', '一条导入失败行'),
    field('failList[].rowNum', 'integer', 'Excel行号；表头为第1行，数据从第2行开始'),
    field('failList[].employeeName', 'string', '失败行员工姓名；读取不到时为空', { nullable: true, nullMeaning: 'Excel对应单元格为空或解析不到' }),
    field('failList[].idCardNo', 'string', '失败行身份证号；读取不到时为空', { nullable: true, nullMeaning: 'Excel对应单元格为空或解析不到' }),
    field('failList[].reason', 'string', '服务端拒绝该行的原因；例如必填、身份证格式、金额、日期或文件内身份证重复'),
  ],
  empty: '响应缺少successCount、failCount或failList时抛错；不能把Portal弹出的“导入成功”当成完整处理结果。',
}

const boundaries = [
  `只覆盖Portal页面${pagePath}实际可达的分页查询、下载模板和导入动作；页面权限为${permission}，下载/导入按钮权限为finance:setting:employee-loan-amount:download-template。`,
  '列表只发送Portal表单可见的employeeName、phone、organizationIds、employeeTypes和分页字段；Java请求VO中的positionList及其它后端端点不因存在而扩展进SDK。',
  '下载模板使用二进制响应；导入使用multipart字段file。SDK输入用Base64表达文件，实际请求仍构造与浏览器等价的FormData，不把文件内容当JSON发送。',
  '导入是全量替换语义：服务端只要解析出一条有效行，就会删除旧的全部额度记录后批量写入有效行；无有效行时返回失败明细且不执行替换。页面没有删除、撤销或回滚按钮。',
  '长ID保留字符串；金额Decimal保留数字或十进制字符串；SDK不把欠款计算、员工关联或服务端权限判断伪装成本地成功。',
]

const prerequisites = [
  'SDK必须使用与当前用户和租户绑定的platform HTTP实例；页面权限和按钮权限由会话与后端裁决，SDK不从浏览器提取凭据。',
  '查询时organizationIds来自Portal组织树的ID，employeeTypes只传Portal employee_origin 字典的1内部或2外部。',
  '导入前必须让用户确认文件内容和“全量替换旧额度”后果；prepareImport只校验文件元数据，不解析Excel业务行。',
]

const failures = [
  '查询参数、ID、员工属性或分页值非法时在发请求前失败；响应缺少list/total或行字段不符合Portal/Java响应约定时抛错。',
  '模板响应为空或不是二进制文件时抛错；不要生成空文件或把HTTP成功当作下载成功。',
  '导入的身份证号、借款额度、有效期、文件内重复身份证号等业务校验由Java服务返回failList；SDK返回明细，不把部分失败改写成全成功。',
  '导入请求超时后结果不确定：先list按员工身份证号/业务字段核对是否已发生全量替换，不得在未核对前盲目重传；页面没有安全cancel接口。',
  '401/403、网络错误和后端全量替换失败原样失败；SDK不通过清空结果或放宽字段校验掩盖权限问题。',
]

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main:f61fdca151 app/portal/menus/finance.js 与 app/portal/views/dashboard/finance/setting/employee-loan-amount.vue', kind: 'reference', note: '证明菜单路径和页面路由权限。' },
  { source: 'CodeReview_Projects_Js@test/portal/main:f61fdca151 app/portal/views/dashboard/finance/setting/employee-loan-amount/list.vue', kind: 'reference', note: '证明列表字段、默认表单、POST page、下载模板、上传accept、multipart import和按钮权限；页面没有详情、编辑、删除或导出动作。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test:7aeaca409d EmployeeLoanQuotaController、PageReqVO、RespVO、ExcelVO、ImportRespVO、ServiceImpl', kind: 'reference', note: '证明分页/模板/导入请求字段、返回结构、Excel列顺序、逐行校验及有效行触发全量替换。' },
  { source: 'src/capabilities/finance-setting-employee-loan-amount.ts', kind: 'implementation', note: '证明SDK只注册当前Portal页面可达能力、平台实例、moduleType=null、Base64到FormData转换及严格响应投影。' },
  { source: 'test/finance-setting-employee-loan-amount.test.ts', kind: 'test', note: '证明逐页源码核对、默认请求体、文件请求、导入响应和反证测试；不宣称真实测试环境写入。' },
]

function contract (
  value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence'> &
    Partial<Pick<AiContract, 'boundaries' | 'prerequisites' | 'failures' | 'evidence'>>,
): AiContract {
  return {
    whenToUse: `操作Portal“财务设置→员工借款额度”页面的查询、模板下载或导入；不要把本页后端存在但页面不可达的详情、欠款汇总、导出或员工下拉接口当作本页能力。`,
    boundaries,
    prerequisites,
    failures,
    evidence,
    gaps: [
      '本轮未启动浏览器，未取得真实测试环境该页面的独立网络基准和按钮权限结果；本契约依据已拉取的Portal/Java源码与离线测试。',
      '尚未在真实测试环境执行文件导入；导入会全量替换数据，页面没有可安全清理的cancel/delete接口，不能把离线结果称为真实写入证据。',
    ],
    ...value,
  }
}

export const FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-employee-loan-amount-list': contract({
    purpose: '按Portal页面筛选条件分页读取员工借款额度，返回页面姓名、员工号、证件号、组织、借款额度、欠款、可用额度和有效期等列。',
    effect: 'read',
    inputs: {
      employeeName: optional('员工姓名筛选文本。', '页面“员工姓名”输入框', '发送null，不按姓名筛选', { type: 'string', nullable: true, nullMeaning: '不按姓名筛选' }),
      phone: optional('联系电话筛选文本。', '页面“联系电话”输入框', '发送null，不按联系电话筛选', { type: 'string', nullable: true, nullMeaning: '不按联系电话筛选' }),
      organizationIds: optional('所属组织ID数组；可多选。', '页面“所属组织”组织树选择结果', '发送空数组，不按组织筛选', { type: 'array', constraints: idRules }),
      employeeTypes: optional('员工属性多选数值数组。', '页面employee_origin字典选择结果', '发送空数组，不按员工属性筛选', { type: 'array', constraints: ['只能传1内部或2外部；数组每项是1或2'] }),
      pageNo: optional('从1开始的页码。', '调用方分页状态', 'SDK使用1', { type: 'integer', constraints: ['正整数'] }),
      pageSize: optional('当前页条数。', '调用方分页状态', 'SDK使用20', { type: 'integer', constraints: ['只能是10、20、50或100'] }),
    },
    output: pageOutput,
    consume: [
      '展示list[].employeeName、employeeNo、idCardNo、genderName、age、organizationName、position、employeeTypeName、loanQuota、debtAmount、availableQuota和quotaPeriod。',
      '保留同一行的id和idCardNo；导入后刷新列表并按这些业务字段核对数据是否已发生全量替换。',
      '按total继续翻页；list=[]且total=0是业务空结果，不是权限或网络成功。',
    ],
    steps: [
      { role: 'optional', when: '用户需要下载导入模板且确认账号有按钮权限', capabilityId: 'finance-setting-employee-loan-amount-download-template', mapping: {}, instruction: '下载非空XLSX文件并交给用户保存。' },
      { role: 'optional', when: '用户准备导入文件', capabilityId: 'finance-setting-employee-loan-amount-prepare-import', mapping: { fileName: 'user.fileName', base64: 'user.base64', contentType: 'user.contentType' }, instruction: '先准备并展示文件名、类型和字节数，明确告知导入是全量替换。' },
    ],
    completion: '返回当前筛选条件下严格校验的一页列表和总数；不代表导入或其它写入已经发生。',
    idempotency: null,
  }),

  'finance-setting-employee-loan-amount-download-template': contract({
    purpose: '下载Portal页面“下载模板”按钮对应的员工借款额度Excel导入模板。',
    effect: 'read',
    inputs: {},
    output: fileOutput,
    consume: ['将base64解码为本地XLSX后交给用户填写；不要把下载文件当成已导入数据。'],
    steps: [],
    completion: '获得非空的员工借款额度导入模板文件。',
    idempotency: null,
  }),

  'finance-setting-employee-loan-amount-prepare-import': contract({
    purpose: '在上传员工借款额度文件前复刻Portal文件控件的扩展名和非空文件边界，生成可确认的文件摘要。',
    effect: 'prepare',
    inputs: fileInput,
    output: previewOutput,
    consume: ['向用户展示fileName、contentType和byteLength，并明确有效行导入会删除旧的全部额度记录后写入新数据。'],
    steps: [{ role: 'required', when: '用户明确确认文件内容和全量替换影响后', capabilityId: 'finance-setting-employee-loan-amount-import', mapping: { fileName: 'args.fileName', base64: 'args.base64', contentType: 'args.contentType' }, instruction: '按同一文件输入提交导入；不要绕过准备步骤直接重传。' }],
    completion: '生成文件摘要且尚未发网络请求；不代表Excel业务行已通过服务端校验。',
    idempotency: null,
  }),

  'finance-setting-employee-loan-amount-import': contract({
    purpose: '将Portal页面选择的员工借款额度Excel上传到服务端，并返回逐行成功/失败结果。',
    effect: 'write',
    inputs: fileInput,
    output: importOutput,
    consume: [
      'successCount和failCount必须同时展示或记录；逐项展示failList的Excel行号、员工姓名、身份证号和reason。',
      '当successCount>0时，服务端已经把旧额度记录全量删除并写入有效行；导入后必须调用list按业务字段独立核对，不要只看successCount或页面成功提示。',
      '当successCount=0时，不把导入报告为已替换；保留failList供用户修正文件。',
    ],
    steps: [
      { role: 'required', when: '导入返回successCount或请求超时需要确认终态', capabilityId: 'finance-setting-employee-loan-amount-list', mapping: {}, instruction: '重新分页查询并按员工身份证号、额度和有效期核对全量替换是否发生；超时先核对再决定是否重试。' },
      { role: 'cancel', when: '用户想撤销导入或导入结果不符合预期', instruction: '本Portal页面没有cancel/delete/恢复旧数据接口；不能伪造撤销。只有用户准备好一份正确的完整额度文件后，才能再次走prepare→import进行另一次全量替换。' },
    ],
    completion: '获得服务端结构化导入结果并完成list独立核对；只有核对后的字段才能报告为已落库。',
    idempotency: '没有requestId或SDK幂等包装；同一文件重复提交可能再次全量替换，超时必须先list核对，禁止盲目重传。',
  }),
}

export const FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_METHODS).map(([id, method]) => [`financeSettingEmployeeLoanAmount.${method}`, FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_AI_CONTRACTS[id]!]),
)
