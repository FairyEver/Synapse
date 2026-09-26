import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  SALARY_ADJUST_IMPORT_AMOUNT_FIELDS,
  SALARY_ADJUST_IMPORT_METHODS,
  SALARY_ADJUST_IMPORT_MODULE_TYPE,
  SALARY_ADJUST_IMPORT_PAGE_PATH,
  SALARY_ADJUST_IMPORT_PERMISSION,
  salaryAdjustImportCapabilities,
} from '../capabilities/salary-adjust-import.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: true, nullable: true, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(salaryAdjustImportCapabilities.map(definition => [definition.id, definition]))

const amountFields: AiField[] = SALARY_ADJUST_IMPORT_AMOUNT_FIELDS.map(name => field(`list[].${name}`, 'number | string | null', `${name}金额；Java BigDecimal原值，Portal列表直接展示，不做元/分换算。`, { unit: '后端原始金额单位' }))
const rowFields: AiField[] = [
  field('list', 'object[]', '当前用户角色组织权限、工资月份、组织筛选和分页范围内的工资记录。', { optional: false, nullable: false }),
  field('list[].id', 'string | number', '工资记录主键；删除时使用，不能替换为员工号。'),
  field('list[].name', 'string | null', '员工姓名；来自员工用户表。'),
  field('list[].salaryDate', 'string | null', '工资月份；Java DTO按YYYY-MM序列化。', { format: 'YYYY-MM' }),
  field('list[].staffCode', 'string | number | null', '员工号/工资表staff_code；Portal列名为员工号，不是系统用户ID。'),
  field('list[].fullPath', 'string | null', '员工所属组织完整路径；Portal以省略号显示，SDK保留原值。'),
  ...amountFields,
  field('list[].updaterName', 'string | null', '最后修改人姓名。'),
  field('list[].updateTime', 'string | number | null', '最后修改时间原值；Portal直接展示。'),
  field('list[].isDel', 'integer | null', '逻辑删除标记；当前列表只查询0未删除记录。', { values: { '0': '未删除', '1': '已删除' } }),
  field('list[].creator', 'string | number | null', '创建人用户ID；当前列表不展示。'),
  field('list[].createTime', 'string | number | null', '创建时间原值；当前列表不展示。'),
  field('list[].updater', 'string | number | null', '修改人用户ID；当前列表不展示。'),
  field('list[].tenantId', 'string | number | null', '后端租户ID；当前列表不展示，不能据此跨租户查询。'),
  field('total', 'integer', '符合筛选条件的总工资记录数，用于分页，不是当前页长度。', { optional: false, nullable: false }),
]

const treeFields: AiField[] = [
  field('[]', 'object[]', '当前用户角色组织权限范围内的组织树。', { optional: false, nullable: false }),
  field('[].id', 'string | number', '组织节点ID；用于list.orgId。'),
  field('[].name', 'string | null', '组织节点名称或页面展示路径。'),
  field('[].children', 'object[]', '子组织节点；沿相同字段递归。'),
  field('[].children[].id', 'string | number', '子组织节点ID。'),
  field('[].children[].name', 'string | null', '子组织节点名称。'),
  field('[].children[].children', 'object[]', '更深层子组织节点。'),
]

const fileFields: AiField[] = [
  field('fileName', 'string', '文件名；必须以.xlsx结尾。', { optional: false, nullable: false }),
  field('contentType', 'string', '文件MIME；固定为application/vnd.openxmlformats-officedocument.spreadsheetml.sheet。', { optional: false, nullable: false }),
  field('base64', 'string', 'Excel二进制内容的标准Base64；下载模板返回，导入输入不在返回中回显。', { optional: false, nullable: false }),
  field('byteLength', 'integer', '文件字节数；必须大于0。', { optional: false, nullable: false }),
]

const boundaries = [
  `页面范围是${SALARY_ADJUST_IMPORT_PAGE_PATH}，菜单权限是${SALARY_ADJUST_IMPORT_PERMISSION}；请求使用platform实例并发送module-type=${SALARY_ADJUST_IMPORT_MODULE_TYPE}。`,
  '列表只复刻Portal实际筛选salaryDate、orgId和分页字段；月份选择器最终将所选月转换为该月第一天YYYY-MM-01，组织ID来自角色组织树，SDK不扩展SalarySheetController的个人月薪、年度统计或可选年月接口。',
  '工资列表服务端固定a.is_del=0，并由@DataScope按当前用户角色组织权限收窄；指定orgId时Java服务再取该组织的后代组织，调用方不能用任意组织ID扩大范围。',
  'Portal导入控件只接受.xlsx且运行时要求精确的xlsx MIME；SDK以FormData的file字段提交，不提交JSON工资行，也不伪造导入行数。',
  'Java importExcel接口返回CommonResult.data=null；导入成功只代表后端接受并处理文件，必须按文件中的工资月份/员工号回查list确认落库。服务端按staffCode+salaryDate更新已有记录或插入新记录。',
  'Portal批量删除使用DELETE /salary/salarysheet并把选中行id数组放在请求体；SDK不把员工号、staffCode或当前筛选条件替代id数组。',
  '模板下载页面虽然传入fileName=考核结果导入模板，但Java后端固定返回工资导入模板.xlsx；SDK保留真实响应文件名和二进制内容。',
  '当前页面没有可达的单条get、create、update、导出或其它工资控制器动作；这些后端端点不注册为本页能力。',
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话执行本页列表、模板下载、导入后回查和批量删除的完整闭环；当前证据为Portal/Java源码与离线请求形状测试。',
  '尚未取得当前测试租户的实际角色组织树和工资记录样本；SDK保留组织树节点和列表行的额外字段，不凭空补充业务枚举。',
]

function inputsOf (id: string): Record<string, AiParameter> {
  const suffix = id.replace('salary-adjust-import-', '')
  if (suffix === 'list') return {
    salaryDate: param('工资月份筛选；传YYYY-MM，SDK按Portal规则发送该月第一天YYYY-MM-01；空值表示不限月份。', 'Portal年月月份选择器', { type: 'string', required: false, nullable: true, format: 'YYYY-MM', nullMeaning: '不按月份筛选。', omitted: 'SDK发送空字符串。' }),
    orgId: param('组织筛选ID；必须来自organizationTree返回的节点。', 'salaryAdjustImport.organizationTree[].id', { type: 'string | number', required: false, nullable: true, nullMeaning: '不按指定组织筛选，但仍受服务端角色组织权限限制。', omitted: 'SDK发送空字符串。', lookup: { capabilityId: 'salary-adjust-import-organization-tree', args: {}, valueField: '[].id', labelField: '[].name' } }),
    pageNo: param('从1开始的页码。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
    pageSize: param('每页条数，仅支持10、20、50、100。', 'Portal分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
  }
  if (suffix === 'prepare-import' || suffix === 'import') return {
    fileName: param('工资Excel文件名；Portal上传控件只接受.xlsx。', '用户提供的本地Excel文件', { type: 'string', required: true, constraints: ['必须以.xlsx结尾。'] }),
    base64: param('工资Excel文件内容的标准Base64。', '用户提供的本地Excel文件', { type: 'string', required: true, constraints: ['不能为空且必须是标准Base64。'] }),
    contentType: param('Excel MIME；省略时SDK按Portal唯一接受类型补为application/vnd.openxmlformats-officedocument.spreadsheetml.sheet。', '用户文件MIME或文件扩展名', { type: 'string', required: false, default: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', constraints: ['不能传其他MIME。'] }),
  }
  if (suffix === 'prepare-remove' || suffix === 'remove') return {
    ids: param('当前列表选中的工资记录主键数组；来自list[].id，不是staffCode。', 'salaryAdjustImport.list.result.list[].id', { type: '(string | number)[]', required: true, constraints: ['至少一项，且不能重复。'] }),
  }
  return {}
}

function base (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`工资导入契约缺少能力定义：${id}`)
  return {
    purpose,
    whenToUse: purpose,
    boundaries,
    effect: definition.write ? 'write' : 'read',
    prerequisites: ['使用当前用户、当前租户的会话token，并确认用户拥有工资导入菜单权限；组织ID、工资记录ID和staffCode必须来自当前会话可见数据。'],
    inputs: inputsOf(id),
    output,
    consume,
    steps: [],
    completion: definition.write ? '请求回执后必须按页面条件重新list核对业务终态；空回执不能单独证明导入或删除完成。' : '响应结构校验通过；空列表只表示当前筛选无记录，权限、网络或响应结构错误会抛出。',
    failures: ['非法月份、组织ID、分页、文件扩展名/MIME/Base64、空ID数组、重复ID、权限、网络或Java业务错误会抛出；SDK不把失败转换为空结果。', '导入或删除响应不确定时先回查列表，不要盲目重试以免重复覆盖或重复删除。'],
    idempotency: definition.write ? '后端没有requestId协议；导入按staffCode+salaryDate更新/插入，删除按ID批量处理。响应不确定时先list回查再决定是否重试。' : null,
    evidence: [
      { source: 'app/portal/menus/hr.js、app/portal/views/dashboard/hr/salary/adjust-import/list.vue、app/portal/views/dashboard/hr/salary/adjust-import/components/create-multiple.vue', kind: 'reference', note: '逐页核对菜单权限、年月/组织筛选、列字段、导入MIME、FormData、模板下载和deleteIsBatch请求体。' },
      { source: 'SalarySheetController.java、SalarySheetServiceImpl.java、SalarySheetDao.xml、SalarySheetDTO.java、SalarySheetExcel.java、SalarySheetSelectDTO.java', kind: 'reference', note: '核对分页参数、角色组织数据范围、DTO字段、Excel列、按staffCode+salaryDate更新/插入、删除体和模板实际文件名。' },
      { source: 'src/capabilities/salary-adjust-import.ts、test/salary-adjust-import.test.ts', kind: 'implementation', note: '锁定页面请求顺序、月份归一、FormData file字段、模板二进制、批量删除体和坏输入反证；未替代真实环境闭环。' },
      { source: 'docs/pages/工资导入.md', kind: 'reference', note: '记录页面能力、参数、逐字段基准、表单提交规则和验证边界。' },
    ],
    gaps,
    ...extra,
  }
}

const listOutput: AiContract['output'] = { shape: '{ list: object[], total: integer }', fields: rowFields, empty: 'list=[]且total=0表示当前筛选没有工资记录；不把空结果解释为无权限。' }
const treeOutput: AiContract['output'] = { shape: 'object[]', fields: treeFields, empty: '[]表示当前会话没有可见角色组织节点；请求失败或响应不是数组会抛出。' }
const fileOutput: AiContract['output'] = { shape: '{ fileName: string, contentType: string, base64: string, byteLength: integer }', fields: fileFields, empty: '响应为空文件会抛出；保存base64并按fileName写出，不把模板下载当作导入成功。' }
const previewOutput: AiContract['output'] = { shape: '{ fileName: string, contentType: string, byteLength: integer }', fields: fileFields.filter(field => field.path !== 'base64'), empty: '文件扩展名、MIME、Base64或字节数不符合Portal规则时抛出，且不发请求。' }
const emptyOutput: AiContract['output'] = { shape: 'null | undefined', fields: [{ path: '$', type: 'null | undefined', meaning: 'Java CommonResult空业务回执；不含导入数量或删除数量。', optional: false, nullable: true }], empty: '正常空回执；必须通过后续list回查业务结果。' }
const removePreparationOutput: AiContract['output'] = { shape: '{ ids: (string | number)[] }', fields: [{ path: 'ids', type: '(string | number)[]', meaning: '已通过非空、ID格式和去重校验的工资记录主键数组。', optional: false, nullable: false }], empty: 'ids为空或重复时抛出且不发DELETE。' }

const contracts: Record<string, AiContract> = {
  'salary-adjust-import-list': base('salary-adjust-import-list', '按Portal工资导入页的工资月份、角色组织和分页条件查询工资记录。', listOutput, ['用list[].name、salaryDate、staffCode、fullPath和金额字段展示列表；用total翻页；删除时只取list[].id。']),
  'salary-adjust-import-organization-tree': base('salary-adjust-import-organization-tree', '读取工资导入页组织筛选使用的角色组织树。', treeOutput, ['让用户从返回树中选定节点后，把同一节点id交给list.orgId；不能把其他页面部门树或名称直接代替ID。']),
  'salary-adjust-import-prepare-import': { ...base('salary-adjust-import-prepare-import', '按Portal上传控件规则检查工资Excel并生成无副作用的导入文件预览。', previewOutput, ['向用户展示文件名、固定xlsx MIME和字节数；用户取消时只丢弃预览，不发导入请求。'], { effect: 'prepare', steps: [{ role: 'required', when: '用户明确确认导入', capabilityId: 'salary-adjust-import-import', mapping: { fileName: 'args.fileName', base64: 'args.base64', contentType: 'args.contentType' }, instruction: '将同一份文件参数交给import；不要把预览当成已入库。' }, { role: 'cancel', when: '用户取消导入', instruction: '只丢弃预览，不发送POST。' }] }) },
  'salary-adjust-import-import': { ...base('salary-adjust-import-import', '把Portal工资导入Excel作为multipart/form-data提交并更新或新增工资记录。', emptyOutput, ['导入返回空回执；按Excel中的工资月份和员工号回调list，核对每条记录及金额字段，不能报告“导入了N条”除非回查得到N条。'], { effect: 'write', steps: [{ role: 'required', when: '请求成功或响应不确定', capabilityId: 'salary-adjust-import-list', mapping: {}, instruction: '按文件中的工资月份、员工号和组织范围重新查询，核对记录已新增或按staffCode+salaryDate更新；不要只凭空回执宣布成功。' }] }) },
  'salary-adjust-import-download-template': base('salary-adjust-import-download-template', '下载Portal工资导入页的Excel模板。', fileOutput, ['保存base64文件；后端忽略Portal传入的考核结果导入模板参数并返回工资导入模板.xlsx。']),
  'salary-adjust-import-prepare-remove': { ...base('salary-adjust-import-prepare-remove', '校验当前列表选中的工资记录主键并生成无副作用的批量删除草稿。', removePreparationOutput, ['向用户展示ids对应的当前列表行并等待明确确认；取消时不发DELETE。'], { effect: 'prepare', steps: [{ role: 'required', when: '用户明确确认删除', capabilityId: 'salary-adjust-import-remove', mapping: { ids: 'result.ids' }, instruction: '将同一份ids交给remove；不要替换为staffCode或重新猜ID。' }, { role: 'cancel', when: '用户取消删除', instruction: '只丢弃草稿，不发送DELETE。' }] }) },
  'salary-adjust-import-remove': { ...base('salary-adjust-import-remove', '按Portal批量删除动作提交当前选中的工资记录主键数组。', emptyOutput, ['删除返回空回执；用同一批ids调用list回查，确认记录不再出现或按服务端逻辑已标记删除。'], { effect: 'write', steps: [{ role: 'required', when: '请求成功或响应不确定', capabilityId: 'salary-adjust-import-list', mapping: {}, instruction: '回查原筛选条件并按删除ids核对终态；不要以消息成功或空回执替代回查。' }] }) },
}

export const SALARY_ADJUST_IMPORT_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.keys(SALARY_ADJUST_IMPORT_METHODS).map(id => [id, contracts[id]!]),
)
export const SALARY_ADJUST_IMPORT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SALARY_ADJUST_IMPORT_METHODS).map(([id, method]) => [
    `salaryAdjustImport.${method}`,
    { ...SALARY_ADJUST_IMPORT_AI_CONTRACTS[id]!, boundaries: [...SALARY_ADJUST_IMPORT_AI_CONTRACTS[id]!.boundaries, `直接方法路径为salaryAdjustImport.${method}；写操作遵循prepare→submit→list回查。`] },
  ]),
)
