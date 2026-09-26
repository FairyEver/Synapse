import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALARY_PERSON_TAX_METHODS, salaryPersonTaxCapabilities } from '../capabilities/salary-person-tax.js'

const definitions = new Map(salaryPersonTaxCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string): AiField => ({ path, type, meaning, optional: true, nullable: true })

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '扣款主记录ID；编辑、删除和选中导出使用此ID'),
  field('list[].staffCode', 'string | number | null', '员工工号'),
  field('list[].staffName', 'string | null', '员工姓名'),
  field('list[].idCard', 'string | null', '员工身份证号；敏感字段，按原值消费且不写日志'),
  field('list[].organizationName', 'string | null', '员工所在组织全路径'),
  field('list[].postName', 'string | null', '员工岗位'),
  field('list[].costDate', 'string | null', '专项扣款归属月份，格式YYYY-MM'),
  field('list[].archiveStatus', '1 | 2 | null', '专项归档状态；1未归档、2已归档'),
  field('list[].createTime', 'string | number | null', '创建时间'),
  field('list[].updaterName', 'string | null', '操作人姓名'),
  field('list[].specialList', 'object[]', '7类个税专项扣款明细；Portal按specialType展示金额列'),
  field('list[].specialList[].specialType', 'string | null', '专项类型编码；1子女教育、2住房租金、3住房贷款利息、4赡养老人、5继续教育、6婴幼儿照护、7大病医疗'),
  field('list[].specialList[].amount', 'number | string | null', '专项金额；服务端BigDecimal按原值返回'),
  field('list[].specialList[].costStart', 'string | null', '费用开始日期，格式YYYY-MM-DD'),
  field('list[].specialList[].costEnd', 'string | null', '费用结束日期，格式YYYY-MM-DD'),
  field('list[].specialList[].archiveStatus', '1 | 2 | null', '专项归档状态'),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number, summary: object }',
  fields: [
    field('$', 'object', '扣款费用分页响应；Portal pageNew把合计和分页嵌套返回，SDK展开为summary/list/total'),
    field('list', 'object[]', '当前筛选当前页记录；不是全量结果'),
    field('total', 'number', '当前筛选的记录总数；只用于分页'),
    field('summary', 'object', '当前响应页对应的7类金额合计'),
    field('summary.childEducation', 'number | string | null', '子女教育合计'),
    field('summary.housingRent', 'number | string | null', '住房租金合计'),
    field('summary.housingLoanInterest', 'number | string | null', '住房贷款利息合计'),
    field('summary.elderlyCare', 'number | string | null', '赡养老人合计'),
    field('summary.continuingEducation', 'number | string | null', '继续教育合计'),
    field('summary.infantCare', 'number | string | null', '婴幼儿照护合计'),
    field('summary.sickChildEducation', 'number | string | null', '大病医疗合计'),
    ...rowFields,
  ],
  empty: 'list=[]且total=0表示当前筛选无记录；summary仍是后端合计对象，不能据此判断没有权限。',
}

const formOutput: AiContract['output'] = {
  shape: '{ id, staffCode, staffName, idCard, archiveStatus, costDate, specialList, ...auditFields }',
  fields: [
    field('id', 'string | number', '扣款主记录ID'),
    field('staffCode', 'string', '员工工号；Portal详情加载后转为字符串'),
    field('staffName', 'string', '员工姓名快照'),
    field('idCard', 'string', '员工身份证号快照；敏感字段'),
    field('archiveStatus', '1 | 2', '状态；1未归档、2已归档'),
    field('costDate', 'string | null', '归属月份，格式YYYY-MM'),
    field('specialList', 'object[]', 'Portal详情表单的7个专项行'),
    field('specialList[].specialType', 'string', '专项类型编码1至7'),
    field('specialList[].amount', 'number | string | null', '金额；最多两位小数，未填写时可能为空'),
    field('specialList[].costTime', '[string, string] | []', 'Portal表单投影的费用日期区间；提交时转回costStart/costEnd'),
    field('specialList[].archiveStatus', '1 | 2 | null', '专项归档状态'),
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
  empty: '数组为空且processedCount为0表示没有实际处理记录，不等于请求失败。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [field('fileName', 'string', '响应文件名；缺少Content-Disposition时使用默认名'), field('contentType', 'string | null', '响应Content-Type'), field('base64', 'string', 'Excel二进制内容Base64'), field('byteLength', 'number', '原始文件字节数')],
  empty: '空文件响应会抛错。导出ids为空时保持Portal的空idList语义，后端按未归档授权范围导出。',
}

const importOutput: AiContract['output'] = {
  ...eligibilityOutput,
  shape: eligibilityOutput.shape,
  empty: '后端按每个专项的费用开始日期检查资格；processedCount为0时不能把导入描述成已成功保存。',
}

const filePreviewOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, byteLength }',
  fields: [field('fileName', 'string', '待上传xlsx文件名'), field('contentType', 'string', '固定标准xlsx MIME'), field('byteLength', 'number', 'Base64解码后的文件字节数')],
  empty: '文件扩展名、MIME、Base64不合法或内容为空时准备阶段失败。',
}

const gaps = [
  '尚未在真实测试环境执行本页浏览器列表、详情保存、删除、导入、模板下载、导出和归档闭环；当前证据来自Portal页面/表单、菜单、Java Controller/DTO/Service/Mapper/Excel类与离线请求断言。',
  'Portal人员选择器会无关键字分页拉取人员，再按当天业务日期调用资格检查；SDK不复制无界全量候选，staffCode必须来自已核实的员工搜索结果，资格检查单独提供显式staffCodes入口。',
]

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`扣款费用契约缺少能力：${id}`)
  return Object.fromEntries(definition.params.map(parameter => {
    const type = parameter.name === 'specialList' ? 'object[]' : parameter.name === 'ids' ? '(string | number)[]' : parameter.name === 'staffCodes' ? '(string | number)[]' : parameter.name === 'businessDate' ? 'YYYY-MM-DD' : parameter.name === 'fileName' || parameter.name === 'base64' || parameter.name === 'contentType' ? 'string' : parameter.name === 'archiveStatus' ? '1 | 2' : parameter.name === 'costDate' ? 'YYYY-MM[]' : parameter.kind === 'number' ? 'number' : parameter.kind === 'date' ? 'string' : 'string'
    return [parameter.name, { type, required: parameter.required, nullable: !parameter.required, meaning: parameter.description ?? parameter.name, source: 'Portal扣款费用列表/详情表单/导入弹窗/勾选状态。' }]
  }))
}

function base (id: string, purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只操作当前用户在 /dashboard/salary/person-tax 权限范围内的Portal个税专项扣款费用页；使用platform实例并发送module-type=14。',
      '本页的pageNew响应包含分页list和合计total；SDK返回summary保存合计，不能把summary误当成分页总数。',
      'Portal筛选默认archiveStatus=1（未归档），归档动作固定提交status=2；已归档行不可在列表勾选归档或删除。',
      'Portal表单固定7个专项类型；提交时costTime的两端分别转为起始月第一天和结束月最后一天，未完整选择区间发送null。',
      'Portal人员控件的无关键字全量加载不作为SDK无头候选入口；先使用已有员工关键字搜索能力取得staffCode，再调用本页表单或eligibilityCheck。',
    ],
    effect,
    prerequisites: ['使用会话token和租户创建SDK；staffCode、id和导出ID必须来自当前用户可见且已核实的记录。'],
    inputs: inputsOf(id),
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? '提交成功只代表后端请求完成；导入/保存/删除/归档后按页面需要重新查询，资格结果要读取eligible/excluded字段。' : '分页、详情、文件或资格回执通过结构校验；空列表只代表筛选无数据。',
    failures: ['非法ID、状态、金额、日期区间、文件或分页参数在请求前失败；权限、网络和后端业务错误原样抛出。', '详情、分页、资格回执和文件响应缺字段或为空时抛错，不伪造成功。'],
    idempotency: effect === 'write' ? '保存、导入、删除和归档由后端处理；重复提交可能覆盖、跳过或返回排除项，必须重新查询确认。' : null,
    evidence: [
      { source: 'src/capabilities/salary-person-tax.ts', kind: 'implementation', note: '锁定pageNew嵌套分页/合计、详情表单月份转换、批量删除、xlsx上传、模板/导出、归档和资格检查。' },
      { source: 'test/salary-person-tax.test.ts', kind: 'test', note: '离线锁定Portal页面、Java Controller/DTO/Service/Mapper/Excel、请求体和坏参数。' },
      { source: 'docs/pages/扣款费用.md', kind: 'reference', note: '记录逐字段基准、表单提交规则、权限边界与真实环境验证边界。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'salary-person-tax-list': base('salary-person-tax-list', '查询扣款费用列表。', pageOutput, ['按list逐行展示员工、归属月份、归档状态和7类专项金额；summary展示后端合计，total只用于分页。']),
  'salary-person-tax-get': base('salary-person-tax-get', '读取扣款费用详情表单。', formOutput, ['把返回的staffCode、archiveStatus、costDate和specialList.costTime填入编辑表单；修改后交给prepareUpdate。']),
  'salary-person-tax-prepare-update': base('salary-person-tax-prepare-update', '准备修改扣款费用表单提交。', { shape: '{ draft: object }', fields: [field('draft.id', 'string | number', '待修改主记录ID'), field('draft.staffCode', 'string | number', '员工工号'), field('draft.archiveStatus', '1 | 2', '归档状态'), field('draft.specialList', 'object[]', '7个专项；已转换costStart/costEnd')], empty: '详情ID或表单字段不合法时没有draft。' }, ['基于get返回的同一条记录修改明确字段；用户取消只丢弃draft，不调用update。']),
  'salary-person-tax-update': base('salary-person-tax-update', '修改扣款费用记录。', { shape: 'null | undefined', fields: [field('$', 'null | undefined', 'Portal PUT成功回执无业务数据')], empty: '成功无业务数据；保存后应重新读取列表或详情。' }, ['执行prepareUpdate→用户确认→update；不要把空回执当成字段已按预期保存，需回查。'], 'write'),
  'salary-person-tax-prepare-remove': base('salary-person-tax-prepare-remove', '准备删除扣款费用记录。', { shape: '{ draft: string[] | number[] }', fields: [field('draft', 'string[] | number[]', '不重复的扣款主记录ID')], empty: 'ids为空或重复时准备失败。' }, ['展示删除数量和ID后等待确认；取消确认只丢弃draft。']),
  'salary-person-tax-remove': base('salary-person-tax-remove', '删除扣款费用记录。', { shape: 'null | undefined', fields: [field('$', 'null | undefined', 'Portal DELETE成功回执无业务数据')], empty: '成功无业务数据；后端是软删除，必须重新查询确认列表变化。' }, ['执行prepareRemove→用户确认→DELETE；不能把删除请求成功当作数据库硬删除。'], 'write'),
  'salary-person-tax-prepare-import': base('salary-person-tax-prepare-import', '准备导入扣款费用xlsx文件。', filePreviewOutput, ['展示文件名、类型和字节数；用户取消只丢弃预览，不调用importExcel。']),
  'salary-person-tax-import': base('salary-person-tax-import', '导入扣款费用xlsx文件。', importOutput, ['执行prepareImport→用户确认→multipart字段file提交；读取processed/excluded资格回执并重新查询。'], 'write'),
  'salary-person-tax-download-template': base('salary-person-tax-download-template', '下载扣款费用导入模板。', fileOutput, ['保存返回的xlsx文件；请求固定发送fileName=个税专项扣款归档导入模板。']),
  'salary-person-tax-export': base('salary-person-tax-export', '导出扣款费用记录。', fileOutput, ['把返回文件交给保存步骤；ids按选中顺序连接为idList，空ids保持Portal语义并由后端导出未归档授权范围。']),
  'salary-person-tax-prepare-archive': base('salary-person-tax-prepare-archive', '准备归档扣款费用记录。', { shape: '{ draft: { ids: string[] | number[], status: 2 } }', fields: [field('draft.ids', 'string[] | number[]', '不重复的未归档扣款主记录ID'), field('draft.status', '2', '固定归档状态')], empty: 'ids为空或重复时准备失败。' }, ['展示归档数量并等待用户确认；取消确认不发送请求。']),
  'salary-person-tax-archive': base('salary-person-tax-archive', '归档扣款费用记录。', eligibilityOutput, ['执行prepareArchive→用户确认→提交status=2；读取eligible/excluded回执后重新查询。'], 'write'),
  'salary-person-tax-eligibility-check': base('salary-person-tax-eligibility-check', '按业务日期检查员工是否可办理个税专项扣款。', eligibilityOutput, ['先展示eligibleStaffCodes和excludedStaffList，再允许用户把符合资格的staffCode交给表单；不能把未检查的员工工号直接当成可办理。']),
}

export const SALARY_PERSON_TAX_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALARY_PERSON_TAX_METHODS).map(id => [id, contracts[id]!]))
export const SALARY_PERSON_TAX_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALARY_PERSON_TAX_METHODS).map(([id, method]) => [`salaryPersonTax.${method}`, SALARY_PERSON_TAX_AI_CONTRACTS[id]!]))
