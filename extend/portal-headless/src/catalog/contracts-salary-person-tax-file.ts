import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALARY_PERSON_TAX_FILE_METHODS, salaryPersonTaxFileCapabilities } from '../capabilities/salary-person-tax-file.js'

const definitions = new Map(salaryPersonTaxFileCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string): AiField => ({ path, type, meaning, optional: true, nullable: true })

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '个税主记录ID；取消归档和导出都使用此ID'),
  field('list[].staffCode', 'string | number | null', '员工工号'),
  field('list[].staffName', 'string | null', '员工姓名'),
  field('list[].idCard', 'string | null', '员工身份证号；敏感字段，按原值消费且不写日志'),
  field('list[].organizationName', 'string | null', '员工所在组织全路径；服务端已按数据权限和所选组织展开'),
  field('list[].postName', 'string | null', '员工岗位'),
  field('list[].costDate', 'string | null', '专项扣款归属月份，格式YYYY-MM'),
  field('list[].archiveStatus', '1 | 2 | null', '专项扣款归档状态；1未归档、2已归档，当前页面默认筛选2'),
  field('list[].isUsed', 'string | null', '是否已被工资单使用；后端返回展示文本未使用/已使用'),
  field('list[].documentName', 'string | null', '关联工资单据名称；未关联时为空'),
  field('list[].updaterName', 'string | null', '操作人姓名'),
  field('list[].createTime', 'string | number | null', '主记录创建时间'),
  field('list[].specialList', 'object[]', '该个税主记录的专项扣款明细；Portal按specialType取各列金额'),
  field('list[].specialList[].id', 'string | number | null', '专项扣款明细ID'),
  field('list[].specialList[].taxId', 'string | number | null', '所属个税主记录ID'),
  field('list[].specialList[].specialType', 'string | null', '专项类型编码；1子女教育、2住房租金、3住房贷款利息、4赡养老人、5继续教育、6婴幼儿照护、7大病医疗'),
  field('list[].specialList[].amount', 'number | string | null', '专项扣款金额；服务端BigDecimal按原值返回'),
  field('list[].specialList[].costStart', 'string | null', '费用开始日期，格式YYYY-MM-DD'),
  field('list[].specialList[].costEnd', 'string | null', '费用结束日期，格式YYYY-MM-DD'),
  field('list[].specialList[].archiveStatus', '1 | 2 | null', '专项明细归档状态'),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', '扣款归档分页结果'),
    field('list', 'object[]', '当前页归档记录；不是筛选结果全量'),
    field('total', 'number', '符合条件的记录总数；只用于分页'),
    ...rowFields,
  ],
  empty: 'list=[]且total=0表示当前筛选无归档记录；不能据此判断没有权限。',
}

const treeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '角色组织树节点'),
    field('[].id', 'string | number', '组织ID；可作为list的orgId输入'),
    field('[].name', 'string', '组织名称'),
    field('[].children', 'object[]', '下级组织节点；结构递归同本对象'),
  ],
  empty: '空数组表示当前用户没有可见组织节点。',
}

const eligibilityOutput: AiContract['output'] = {
  shape: '{ processedIds, processedStaffCodes, processedCount, eligibleStaffIds, eligibleStaffCodes, excludedStaffList }',
  fields: [
    field('processedIds', 'string[] | number[]', '本次实际修改成功的专项扣款明细ID；不是请求ID数量'),
    field('processedStaffCodes', 'string[] | number[]', '本次实际修改成功的员工工号'),
    field('processedCount', 'number', '本次实际处理数量'),
    field('eligibleStaffIds', 'string[] | number[]', '资格检查中符合条件的员工ID'),
    field('eligibleStaffCodes', 'string[] | number[]', '资格检查中符合条件的员工工号'),
    field('excludedStaffList', 'object[]', '因停薪日期等业务资格被排除的员工及原因'),
    field('excludedStaffList[].staffId', 'string | number | null', '被排除员工ID'),
    field('excludedStaffList[].staffCode', 'string | number | null', '被排除员工工号'),
    field('excludedStaffList[].staffName', 'string | null', '被排除员工姓名'),
    field('excludedStaffList[].status', 'number | null', '员工状态'),
    field('excludedStaffList[].downtimePay', 'string | null', '停薪日期'),
    field('excludedStaffList[].businessDate', 'string | null', '业务日期'),
    field('excludedStaffList[].reasonCode', 'string | null', '排除原因编码'),
    field('excludedStaffList[].reason', 'string | null', '排除原因文本'),
  ],
  empty: '后端可返回各数组为空、processedCount为0的成功回执；这表示没有实际修改记录，不等于请求失败。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [
    field('fileName', 'string', '服务端Content-Disposition文件名；缺失时回退为个税专项扣款.xls'),
    field('contentType', 'string | null', '响应Content-Type'),
    field('base64', 'string', 'Excel二进制内容的Base64'),
    field('byteLength', 'number', '原始文件字节数'),
  ],
  empty: '空文件响应会抛错。页面将当前选中ID用逗号连接后作为idList发送；未选中时仍照Portal发送空字符串，后端可能拒绝。',
}

const gaps = [
  '尚未在真实测试环境执行本页浏览器读请求、取消归档闭环和选中导出；当前证据来自Portal页面、菜单、Java Controller/DTO/Service/Mapper与离线请求断言。',
  '取消归档由后端按个税资格检查实际处理专项明细；必须依据回执并重新查询确认状态，不能把HTTP成功当作全部请求ID已取消归档。',
]

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`扣款归档契约缺少能力：${id}`)
  return Object.fromEntries(definition.params.map(parameter => {
    const omitted = parameter.name === 'archiveStatus' ? '省略时使用页面默认值2（已归档）' : undefined
    return [parameter.name, {
      type: parameter.name === 'ids' ? '(string | number)[]' : parameter.kind === 'number' ? 'number' : parameter.kind === 'enum' ? '0 | 1 | 2 | ""' : parameter.kind === 'date' ? '[string, string]' : parameter.kind === 'tree' ? 'string | number' : 'string',
      required: parameter.required,
      nullable: !parameter.required,
      meaning: parameter.description ?? parameter.name,
      source: 'Portal扣款归档查询页面的筛选、组织树、勾选和分页状态。',
      ...(omitted ? { omitted } : {}),
    }]
  }))
}

function base (id: string, purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只操作当前用户在 /dashboard/salary/person-tax-file 权限范围内的Portal薪酬个税归档页；使用platform实例并发送module-type=14。',
      '列表查询只返回当前页；组织筛选由服务端展开所选组织的下级组织并叠加当前用户数据权限，SDK不扩大权限范围。',
      '页面可达动作只有查询、组织树、选中记录导出和取消归档；不把同一Controller下未被本页调用的新增、编辑、删除、导入接口注册为本页能力。',
    ],
    effect,
    prerequisites: ['使用会话token和租户创建SDK；组织ID和记录ID必须来自当前用户可见的Portal结果。'],
    inputs: inputsOf(id),
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? '读取资格回执中的processedIds/processedCount/excludedStaffList，并用原筛选重新查询确认归档状态。' : '分页结果通过list/total校验，组织树节点可作为筛选ID，或导出得到非空文件。',
    failures: ['非法月份、ID、状态、页码或页大小在请求前失败；权限、网络和后端业务错误原样抛出。', '分页、组织树或导出响应结构不完整会抛错；取消归档回执中的排除项不会被静默忽略。'],
    idempotency: effect === 'write' ? '相同记录重复取消归档可能返回processedCount=0；以回执和回查为准。' : null,
    evidence: [
      { source: 'src/capabilities/salary-person-tax-file.ts', kind: 'implementation', note: '锁定页面请求键、月份转换、组织树、归档资格回执和选中导出。' },
      { source: 'test/salary-person-tax-file.test.ts', kind: 'test', note: '离线锁定菜单、Portal表单投影、Java接口、字段、坏响应和写入回执。' },
      { source: 'docs/pages/扣款归档查询.md', kind: 'reference', note: '记录页面逐字段基准、权限范围、动作步骤与真实环境验证边界。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'salary-person-tax-file-list': base('salary-person-tax-file-list', '查询扣款归档列表。', pageOutput, [
    '按list逐行展示员工、组织、岗位、归属月份、使用状态、工资单据、归档状态和specialList专项金额；total只用于分页。',
  ]),
  'salary-person-tax-file-organization-tree': base('salary-person-tax-file-organization-tree', '查询扣款归档页面可用的角色组织树。', treeOutput, [
    '把节点id作为list的orgId传入；不要把组织名称当作ID，也不要把树节点ID改写为全量组织范围。',
  ]),
  'salary-person-tax-file-prepare-unarchive': base('salary-person-tax-file-prepare-unarchive', '准备取消选中个税归档记录。', { shape: '{ draft: { ids, status: 1 } }', fields: [field('draft.ids', 'string[] | number[]', '待取消归档的个税主记录ID'), field('draft.status', '1', 'Portal取消归档固定状态值')], empty: 'ids为空时准备阶段失败。' }, ['用户确认草稿后把同一批ids交给salaryPersonTaxFile.unarchive；取消确认只丢弃草稿。']),
  'salary-person-tax-file-unarchive': base('salary-person-tax-file-unarchive', '取消选中个税归档记录。', eligibilityOutput, ['优先展示processedIds、processedCount和excludedStaffList；操作后用list回查，不要仅依据HTTP成功提示。'], 'write'),
  'salary-person-tax-file-export': base('salary-person-tax-file-export', '导出当前选中的扣款归档记录。', fileOutput, ['把返回的fileName、base64和contentType交给文件保存步骤；导出范围只由ids决定，不是当前筛选结果全量。']),
}

export const SALARY_PERSON_TAX_FILE_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALARY_PERSON_TAX_FILE_METHODS).map(id => [id, contracts[id]!]))
export const SALARY_PERSON_TAX_FILE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALARY_PERSON_TAX_FILE_METHODS).map(([id, method]) => [`salaryPersonTaxFile.${method}`, SALARY_PERSON_TAX_FILE_AI_CONTRACTS[id]!]))
