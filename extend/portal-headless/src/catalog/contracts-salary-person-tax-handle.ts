import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALARY_PERSON_TAX_HANDLE_METHODS, salaryPersonTaxHandleCapabilities } from '../capabilities/salary-person-tax-handle.js'

const definitions = new Map(salaryPersonTaxHandleCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string): AiField => ({ path, type, meaning, optional: true, nullable: true })

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '扣款办理主记录ID；编辑、删除和选中导出使用此ID'),
  field('list[].staffCode', 'string | number | null', '员工工号'),
  field('list[].staffName', 'string | null', '员工姓名'),
  field('list[].idCard', 'string | null', '员工身份证号；敏感字段，按原值消费且不写日志'),
  field('list[].organizationName', 'string | null', '员工所在组织全路径'),
  field('list[].postName', 'string | null', '员工岗位'),
  field('list[].status', '0 | 1 | null', '扣款办理状态；0已失效、1生效中'),
  field('list[].isDel', 'number | null', '软删除标记；页面列表通常只返回0'),
  field('list[].creator', 'string | number | null', '创建人ID'),
  field('list[].createTime', 'string | number | null', '创建时间'),
  field('list[].updater', 'string | number | null', '修改人ID'),
  field('list[].updaterName', 'string | null', '操作人姓名'),
  field('list[].updateTime', 'string | number | null', '修改时间'),
  field('list[].specialList', 'object[]', '7类个税专项扣款明细；Portal按specialType展示各金额列'),
  field('list[].specialList[].specialType', 'string | null', '专项类型编码；1子女教育、2住房租金、3住房贷款利息、4赡养老人、5继续教育、6婴幼儿照护、7大病医疗'),
  field('list[].specialList[].amount', 'number | string | null', '专项金额；服务端BigDecimal按原值返回'),
  field('list[].specialList[].costStart', 'string | null', '费用开始日期，格式YYYY-MM-DD'),
  field('list[].specialList[].costEnd', 'string | null', '费用结束日期，格式YYYY-MM-DD'),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('$', 'object', '扣款办理分页结果'), field('list', 'object[]', '当前页记录；不是筛选结果全量'), field('total', 'number', '符合筛选条件的总记录数；只用于分页'), ...rowFields],
  empty: 'list=[]且total=0表示当前筛选无记录；不能据此判断没有权限。',
}

const formOutput: AiContract['output'] = {
  shape: '{ id, staffCode, staffName, idCard, status, specialList, ...auditFields }',
  fields: [
    field('id', 'string | number | null', '编辑时的扣款办理主记录ID；新建表单可能没有'),
    field('staffCode', 'string', '员工工号；Portal详情加载后转为字符串'),
    field('staffName', 'string', '员工姓名快照'),
    field('idCard', 'string', '员工身份证号快照；敏感字段'),
    field('status', '0 | 1', '状态；0已失效、1生效中'),
    field('specialList', 'object[]', 'Portal详情表单的7个专项行'),
    field('specialList[].specialType', 'string', '专项类型编码1至7'),
    field('specialList[].amount', 'number | string | null', '金额；最多两位小数，未填写时可能为空'),
    field('specialList[].costTime', '[string, string] | []', 'Portal详情表单使用的日期区间；已按后端costStart/costEnd回填'),
    field('createTime', 'string | number | null', '创建时间快照'),
    field('updateTime', 'string | number | null', '修改时间快照'),
    field('updaterName', 'string | null', '操作人快照'),
  ],
  empty: '详情不存在或后端返回空对象会抛错；Portal详情页要求specialList可遍历。',
}

const eligibilityOutput: AiContract['output'] = {
  shape: '{ processedIds, processedStaffCodes, processedCount, eligibleStaffIds, eligibleStaffCodes, excludedStaffList }',
  fields: [
    field('processedIds', 'string[] | number[]', '本次实际处理的业务ID'),
    field('processedStaffCodes', 'string[] | number[]', '本次实际处理的员工工号'),
    field('processedCount', 'number', '实际处理数量；不是请求数量'),
    field('eligibleStaffIds', 'string[] | number[]', '符合资格的员工ID'),
    field('eligibleStaffCodes', 'string[] | number[]', '符合资格的员工工号'),
    field('excludedStaffList', 'object[]', '被排除员工及原因'),
    field('excludedStaffList[].staffId', 'string | number | null', '员工ID'),
    field('excludedStaffList[].staffCode', 'string | number | null', '员工工号'),
    field('excludedStaffList[].staffName', 'string | null', '员工姓名'),
    field('excludedStaffList[].businessDate', 'string | null', '业务日期'),
    field('excludedStaffList[].reasonCode', 'string | null', '排除原因编码'),
    field('excludedStaffList[].reason', 'string | null', '排除原因文本'),
  ],
  empty: '数组为空且processedCount为0表示没有符合条件的员工，不等于请求失败。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [field('fileName', 'string', '响应文件名；模板缺失Content-Disposition时使用模板默认名'), field('contentType', 'string | null', '响应Content-Type'), field('base64', 'string', 'Excel二进制内容Base64'), field('byteLength', 'number', '原始文件字节数')],
  empty: '空文件响应会抛错。导出ids为空时保持Portal的空idList语义，后端会导出当前用户授权范围。',
}

const importOutput: AiContract['output'] = {
  shape: 'string | null',
  fields: [field('$', 'string | null', '导入后端数据：null表示无附加提示，字符串表示后端返回的导入提示文本')],
  empty: '后端成功导入时通常返回null；字符串不能当作全部数据都已成功，需按提示处理。',
}

const filePreviewOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, byteLength }',
  fields: [field('fileName', 'string', '待上传xlsx文件名'), field('contentType', 'string', '固定标准xlsx MIME'), field('byteLength', 'number', 'Base64解码后的文件字节数')],
  empty: '文件扩展名、MIME、Base64不合法或内容为空时准备阶段失败。',
}

const gaps = [
  '尚未在真实测试环境执行本页浏览器列表、详情保存、删除、导入、模板下载和导出闭环；当前证据来自Portal页面/表单、菜单、Java Controller/DTO/Service/Excel类与离线请求断言。',
  'Portal人员选择器会无关键字分页拉取人员，再按当天业务日期调用资格检查；SDK不复制无界全量候选，staffCode必须来自已核实的员工搜索结果，资格检查单独提供显式staffCodes入口。',
]

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`扣款办理契约缺少能力：${id}`)
  return Object.fromEntries(definition.params.map(parameter => {
    const type = parameter.name === 'specialList' ? 'object[]' : parameter.name === 'ids' ? '(string | number)[]' : parameter.name === 'staffCodes' ? '(string | number)[]' : parameter.name === 'businessDate' ? 'YYYY-MM-DD' : parameter.name === 'status' ? '0 | 1' : parameter.name === 'fileName' || parameter.name === 'base64' || parameter.name === 'contentType' ? 'string' : parameter.kind === 'number' ? 'number' : parameter.kind === 'date' ? 'string' : 'string'
    return [parameter.name, {
      type,
      required: parameter.required,
      nullable: !parameter.required,
      meaning: parameter.description ?? parameter.name,
      source: 'Portal扣款办理列表/详情表单/导入弹窗/勾选状态。',
    }]
  }))
}

function base (id: string, purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只操作当前用户在 /dashboard/salary/person-tax-handle 权限范围内的Portal薪酬个税预测扣款页；使用platform实例并发送module-type=14。',
      '扣款办理和扣款归档是两张页面：本页使用salarypersontaxForecast，不能把person-tax-file的归档记录或updateArchive动作混用进来。',
      'Portal表单固定7个专项类型；提交时costTime的两端分别转为起始月第一天和结束月最后一天，未完整选择区间发送null。',
      'Portal人员控件的无关键字全量加载不作为SDK无头候选入口；先使用已有员工关键字搜索能力取得staffCode，再调用本页表单或eligibilityCheck。',
    ],
    effect,
    prerequisites: ['使用会话token和租户创建SDK；staffCode、id和导出ID必须来自当前用户可见且已核实的记录。'],
    inputs: inputsOf(id),
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? '提交成功只代表后端请求完成；导入/保存/删除后按页面需要重新查询，资格检查要读取eligible/excluded结果。' : '分页、详情、文件或资格回执通过结构校验；空列表只代表筛选无数据。',
    failures: ['非法ID、状态、金额、日期区间、文件或分页参数在请求前失败；权限、网络和后端业务错误原样抛出。', '详情、分页、资格回执和文件响应缺字段或为空时抛错，不伪造成功。'],
    idempotency: effect === 'write' ? '保存和导入由后端按员工/记录处理；重复提交可能覆盖或产生提示，必须重新查询确认。' : null,
    evidence: [
      { source: 'src/capabilities/salary-person-tax-handle.ts', kind: 'implementation', note: '锁定列表、详情表单、月份首末日转换、批量删除、xlsx上传、模板/导出和资格检查。' },
      { source: 'test/salary-person-tax-handle.test.ts', kind: 'test', note: '离线锁定Portal页面、Java Controller/DTO/Service/Excel、请求体和坏参数。' },
      { source: 'docs/pages/扣款办理.md', kind: 'reference', note: '记录逐字段基准、表单提交规则、权限边界与真实环境验证边界。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'salary-person-tax-handle-list': base('salary-person-tax-handle-list', '查询扣款办理列表。', pageOutput, ['按list逐行展示员工、组织、岗位、状态和7类专项金额；total只用于分页。']),
  'salary-person-tax-handle-get': base('salary-person-tax-handle-get', '读取扣款办理详情表单。', formOutput, ['把返回的staffCode、status和specialList.costTime填入编辑表单；修改后交给prepareUpdate。']),
  'salary-person-tax-handle-prepare-create': base('salary-person-tax-handle-prepare-create', '准备新建扣款办理表单提交。', { shape: '{ draft: object }', fields: [field('draft.staffCode', 'string | number', '员工工号'), field('draft.status', '0 | 1', '状态'), field('draft.specialList', 'object[]', '7个专项；已转换costStart/costEnd')], empty: '不发送网络请求；表单校验失败时没有draft。' }, ['展示draft供用户确认；用户取消只丢弃draft，不调用create。']),
  'salary-person-tax-handle-create': base('salary-person-tax-handle-create', '新建扣款办理记录。', { shape: 'null | undefined', fields: [field('$', 'null | undefined', 'Portal POST成功回执无业务数据')], empty: '成功无业务数据；保存后应重新读取列表。' }, ['先prepareCreate校验并确认，再POST；不要把空回执当成创建ID。'], 'write'),
  'salary-person-tax-handle-prepare-update': base('salary-person-tax-handle-prepare-update', '准备修改扣款办理表单提交。', { shape: '{ draft: object }', fields: [field('draft.id', 'string | number', '待修改主记录ID'), field('draft.staffCode', 'string | number', '员工工号'), field('draft.status', '0 | 1', '状态'), field('draft.specialList', 'object[]', '7个专项；已转换costStart/costEnd')], empty: '详情ID或表单字段不合法时没有draft。' }, ['基于get返回的同一条记录修改明确字段；用户取消只丢弃draft，不调用update。']),
  'salary-person-tax-handle-update': base('salary-person-tax-handle-update', '修改扣款办理记录。', { shape: 'null | undefined', fields: [field('$', 'null | undefined', 'Portal PUT成功回执无业务数据')], empty: '成功无业务数据；保存后应重新读取列表或详情。' }, ['执行prepareUpdate→用户确认→update；不要把空回执当成字段已按预期保存，需回查。'], 'write'),
  'salary-person-tax-handle-prepare-remove': base('salary-person-tax-handle-prepare-remove', '准备批量删除扣款办理记录。', { shape: '{ draft: string[] | number[] }', fields: [field('draft', 'string[] | number[]', '不重复的扣款办理主记录ID')], empty: 'ids为空或重复时准备失败。' }, ['展示删除数量和ID后等待确认；取消确认只丢弃draft。']),
  'salary-person-tax-handle-remove': base('salary-person-tax-handle-remove', '批量删除扣款办理记录。', { shape: 'null | undefined', fields: [field('$', 'null | undefined', 'Portal DELETE成功回执无业务数据')], empty: '成功无业务数据；后端是软删除，必须重新查询确认列表变化。' }, ['执行prepareRemove→用户确认→DELETE；不能把删除请求成功当作数据库硬删除。'], 'write'),
  'salary-person-tax-handle-prepare-import': base('salary-person-tax-handle-prepare-import', '准备导入扣款办理xlsx文件。', filePreviewOutput, ['展示文件名、类型和字节数；用户取消只丢弃预览，不调用importExcel。']),
  'salary-person-tax-handle-import': base('salary-person-tax-handle-import', '导入扣款办理xlsx文件。', importOutput, ['执行prepareImport→用户确认→multipart字段file提交；返回字符串时展示为后端提示，null只表示没有附加提示，导入后重新查询。'], 'write'),
  'salary-person-tax-handle-download-template': base('salary-person-tax-handle-download-template', '下载扣款办理导入模板。', fileOutput, ['保存返回的xlsx文件；请求固定发送fileName=个税专项扣款导入模板。']),
  'salary-person-tax-handle-export': base('salary-person-tax-handle-export', '导出扣款办理记录。', fileOutput, ['把返回文件交给保存步骤；ids按选中顺序连接为idList，空ids保持Portal语义并由后端导出当前授权范围。']),
  'salary-person-tax-handle-eligibility-check': base('salary-person-tax-handle-eligibility-check', '按业务日期检查员工是否可办理个税专项扣款。', eligibilityOutput, ['先展示eligibleStaffCodes和excludedStaffList，再允许用户把符合资格的staffCode交给表单；不能把未检查的员工工号直接当成可办理。']),
}

export const SALARY_PERSON_TAX_HANDLE_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALARY_PERSON_TAX_HANDLE_METHODS).map(id => [id, contracts[id]!]))
export const SALARY_PERSON_TAX_HANDLE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALARY_PERSON_TAX_HANDLE_METHODS).map(([id, method]) => [`salaryPersonTaxHandle.${method}`, SALARY_PERSON_TAX_HANDLE_AI_CONTRACTS[id]!]))
