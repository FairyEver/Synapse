import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALARY_PERSON_TAX_METHODS, salaryPersonTaxCapabilities } from '../capabilities/salary-person-tax.js'

const definitions = new Map(salaryPersonTaxCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: true, nullable: true, ...extra })

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
  'salary-person-tax-staff-page': {
    ...base('salary-person-tax-staff-page', '分页读取员工候选（含离职/退休），给出扣款费用表单「员工」选择器需要的工号、姓名和身份证号。', {
      shape: '{ list: array, total: integer }',
      fields: [
        field('$', 'object', '员工候选分页结果。'),
        field('list', 'array', '当前页员工，不是全部员工。'),
        field('list[]', 'object', '一名员工（SQL 只 select 了这六列）。'),
        field('list[].id', 'string | number', '员工主键（hr_staff.id）；不是工号、不是系统用户ID。'),
        field('list[].name', 'string', '姓名。', { nullable: true, nullMeaning: '后端未返回姓名。' }),
        field('list[].staffCode', 'string | number', '工号；资格检查与表单回填用的就是它。', { nullable: true, nullMeaning: '后端未返回工号。' }),
        field('list[].idCard', 'string', '身份证号；页面选择器用它回填 idCard 字段。', { nullable: true, nullMeaning: '后端未返回身份证号。' }),
        field('list[].organization', 'string | number', '所属组织ID；不是组织名称。', { nullable: true, nullMeaning: '后端未返回组织。' }),
        field('list[].status', 'integer', '在职状态。', { nullable: true, values: { '1': '在职', '2': '离职', '3': '退休', '4': '返聘', '5': '在编不在岗' }, nullMeaning: '后端未返回状态。' }),
        field('total', 'integer', '符合筛选条件的员工总数，不是当前页长度。'),
      ],
      empty: 'list=[]且total=0表示当前筛选没有员工；权限、网络或响应形状错误会抛错，不降级为空页。total>0 而 list=[] 只说明当前 pageNo 越界。',
    }, [
      '按 total 递增 pageNo 取完所需范围；页面选择器展示的是 `${name}(${staffCode})`，但回填给表单/资格检查的是 staffCode。',
      '拿到 staffCode 后必须再调 salary-person-tax-eligibility-check（同一天的 businessDate）才能判断谁可办理；本能力只给"有哪些员工"，不给"谁能办"。',
      'idCard 可以直接回填表单的身份证字段，但不要用它当员工标识去调用其它接口。',
      '员工规模是几千人，不要为了"看全"把 pageSize 顶到上限反复翻页——先按 organizationId 收窄再分页。',
    ]),
    whenToUse: '需要在扣款费用页面给用户列员工候选（选择器或工号核对）时使用；它不含"能否办理个税专项扣款"的判断，那一步是 eligibilityCheck。',
    inputs: {
      organizationId: {
        meaning: '按所属组织收敛候选（后端会展开该组织的全部后代）。',
        source: '用户指定的组织；不在本页表单里，页面自己不发这个字段',
        type: 'string | number',
        required: false,
        nullable: true,
        omitted: '不带组织条件，按数据范围返回全部可见员工。',
        nullMeaning: '同省略，不按组织筛选。',
        constraints: ['安全正整数或无前导零的正整数字符串；不是组织名称'],
      },
      isFilterLeaveStaff: {
        meaning: '是否只留在职序列的员工：等于 1 时后端加 status in (1,4,5)（在职/返聘/在编不在岗）。',
        source: '调用方筛选意图；页面自己不发这个字段（它的语义是"包括退休离职"）',
        type: 'integer',
        required: false,
        nullable: true,
        omitted: '不加该条件，返回含离职/退休在内的员工。',
        nullMeaning: '同省略。',
        constraints: ['数值 1 是唯一被后端识别的取值；其它值等于不加条件。'],
      },
      pageNo: {
        meaning: '从1开始的页码。',
        source: '调用方分页状态',
        type: 'integer',
        required: false,
        omitted: 'SDK使用1。',
        constraints: ['正整数'],
      },
      pageSize: {
        meaning: '每页条数。',
        source: '调用方分页状态',
        type: 'integer',
        required: false,
        omitted: 'SDK使用20（页面自己的分片是200，但页面是循环全量拉，SDK 不照抄）。',
        constraints: ['1 到 200 的整数；SDK 在发请求前拒绝更大值和 -1，避免把几千人拉进调用方上下文'],
      },
    },
    boundaries: [
      '只覆盖 /dashboard/salary/person-tax 页面「员工」选择器的候选来源；使用 platform 实例并发送 module-type=14。',
      '这条接口没有可用的关键字筛选：DTO 上虽然声明了 name，但 DAO 的 allStaffByPage SQL 的 where 里只有 is_del、organizationIdList、isFilterLeaveStaff 和数据范围，压根不拼 name，因此 SDK 不暴露 name —— 暴露一个被静默忽略的筛选会把调用方引向错误结论。',
      'SDK 只做有界分页，拒绝 -1 与超大 pageSize：页面用 pageSize=200×最多100页 全量拉（conventions 第 11 条明确禁止照抄）。',
      '返回的行只含 SQL 选出的六列（id/name/staffCode/idCard/organization/status）；DTO 上其它字段（薪资等级、成本中心、联系方式等）不是这条 SQL 的产出，SDK 不补齐也不解释。',
      '本能力不判断员工能否办理个税专项扣款，也不写任何数据。',
    ],
    gaps: [
      '未启动浏览器、未取得独立网络基准、未在真实测试环境执行该读请求；字段与语义来自固定检出的 Portal 组件、Java Controller/DTO/DAO XML 与离线断言。',
      '组织收窄（organizationId → 全部后代）与 isFilterLeaveStaff 的实际过滤效果未在真实租户验证；页面自己不发这两个参数，SDK 提供它们是为了在禁止全量拉取的前提下仍可收窄。',
      'name 被后端 SQL 忽略这件事读自 HrStaffDao.xml 的 allStaffByPage 原文（where 里没有 name 条件），没有真实环境抓包复核。',
      'Portal/Java 固定检出未按任务约束 pull 到远端最新。',
    ],
    steps: [
      {
        role: 'required',
        when: '用户要从候选里挑人办理扣款',
        capabilityId: 'salary-person-tax-eligibility-check',
        mapping: { staffCodes: 'result.list[].staffCode', businessDate: 'context.businessDate' },
        instruction: '把本页员工的 staffCode 批量交给资格检查（同一天的业务日期，页面用 formatDay() 当天）；只有 eligibleStaffCodes 里的工号才能进入表单，excludedStaffList 要如实展示原因。',
      },
    ],
    completion: '返回当前筛选下的员工页；这只是候选来源，是否可办理仍以 eligibilityCheck 的回执为准。',
  },
}

export const SALARY_PERSON_TAX_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALARY_PERSON_TAX_METHODS).map(id => [id, contracts[id]!]))
export const SALARY_PERSON_TAX_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALARY_PERSON_TAX_METHODS).map(([id, method]) => [`salaryPersonTax.${method}`, SALARY_PERSON_TAX_AI_CONTRACTS[id]!]))
