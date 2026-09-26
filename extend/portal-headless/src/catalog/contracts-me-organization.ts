import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { ME_ORGANIZATION_METHODS, meOrganizationCapabilities } from '../capabilities/me-organization.js'

const definitions = new Map(meOrganizationCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const idType = 'string | number'

const commonBoundaries = [
  '页面路径是/dashboard/me/organization/list，权限码是/dashboard/me/organization/list；所有请求使用platform实例并按Portal页面规则带module-type=11。',
  '这是保留范围中的portal/人力个人组织信息页面，只读取当前会话用户可见的组织与统计；不扩展到独立生产、财务、采购或销售顶层系统。',
  '页面没有表单保存、导入、删除或提交动作；本组能力全部是read，不能把统计查询包装成写入或权限变更。',
  '组织ID必须来自当前会话的员工基本信息organization或当前页面返回的角色组织树；传入ID不能绕过后端数据权限，后端仍按会话用户、角色和组织负责人关系收敛结果。',
]

const commonFailures = [
  '会话、租户、页面权限、module-type、后端业务错误、网络错误和响应结构错误原样抛出；空数组或空图表只能表示服务端在当前权限和筛选下没有数据，不能解释成无权限。',
  '统计接口成功回执不代表任何写入；本页没有prepare→submit→cancel链。请求超时先重新读取同一查询确认结果，不要把未知状态当成写入成功。',
]

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@app/portal/views/dashboard/hr/me/organization/list.vue、director.vue、directorNot.vue（test/portal/main）',
    kind: 'reference',
    note: '逐页核对根页面先请求getAllDirectOrgList决定负责人分支；两个分支都请求getStaffBaseInfo；负责人分支继续读取角色组织树、编制、员工统计小结和getDirectOrgInfoV2四类统计。页面没有提交按钮。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java HrOrganizationController、HrOrganizationServiceImpl、HrStaffController、HrStaffServiceImpl（test/test）',
    kind: 'reference',
    note: '核对接口路径、HrStaffBaseDTO/HrOrganizationDTO/ChartData/LineData/Point字段、当前用户负责人筛选、角色组织树数据范围和orgId/date/standardUnit/dutyId绑定。',
  },
  {
    source: 'src/capabilities/me-organization.ts 与 test/me-organization.test.ts',
    kind: 'implementation',
    note: '锁定请求参数顺序、module-type/page/permission绑定、日期与ID输入边界、图表返回投影和接口排除项；离线测试不替代真实环境权限矩阵。',
  },
]

const staffFields: AiField[] = [
  field('name', 'string | null', '当前会话员工姓名；页头展示', { nullable: true, nullMeaning: '后端未补充员工姓名' }),
  field('staffCode', idType + ' | null', '当前会话员工工号；页头ID展示', { nullable: true, nullMeaning: '后端未补充工号' }),
  field('post', idType + ' | null', '当前员工岗位ID；不是组织ID', { nullable: true, nullMeaning: '员工未关联岗位或后端未返回' }),
  field('postName', 'string | null', '当前员工岗位名称；页头展示', { nullable: true, nullMeaning: '岗位不存在或后端未补充' }),
  field('headImg', 'string | null', '当前员工头像URL；页头图片来源', { nullable: true, nullMeaning: '没有头像' }),
  field('organization', idType + ' | null', '当前员工所属组织ID；负责人分支的默认组织和统计接口orgId来源', { nullable: true, nullMeaning: '员工未关联组织；不能据此调用组织统计' }),
  field('organizationName', 'string | null', '当前员工所属组织名称路径，最多拼接后端返回的三级组织名称', { nullable: true, nullMeaning: '组织不存在或后端未补充' }),
  field('leader', idType + ' | null', '直属上级员工ID；不是岗位ID', { nullable: true, nullMeaning: '没有直属上级' }),
  field('leaderName', 'string | null', '直属上级姓名', { nullable: true, nullMeaning: '上级不存在或未补充' }),
  field('salaryLevel', idType + ' | null', '薪资等级ID；页面基本信息可能不直接展示', { nullable: true, nullMeaning: '未设置或未返回' }),
  field('salaryStructure', idType + ' | null', '薪资结构ID；页面基本信息可能不直接展示', { nullable: true, nullMeaning: '未设置或未返回' }),
  field('salaryLevelName', 'string | null', '薪资等级名称', { nullable: true, nullMeaning: '未设置或未补充' }),
  field('salaryStructureName', 'string | null', '薪资结构名称', { nullable: true, nullMeaning: '未设置或未补充' }),
  field('employmentType', 'string | null', '用工类型名称', { nullable: true, nullMeaning: '未设置或未补充' }),
  field('entrySeniority', 'integer | null', '入职司龄原始月数；页面基本信息会按后端生成的“我的司龄”文本展示', { nullable: true, nullMeaning: '未返回' }),
  field('baseInfo', 'array', '后端按有值字段生成的基本信息键值列表；页面按原顺序展示', { nullable: true, nullMeaning: '后端未返回基本信息列表' }),
  field('baseInfo[]', 'object', '一项基本信息', { optional: true }),
  field('baseInfo[].key', 'string', '基本信息名称，例如岗位类别、薪资等级、直属上级', { optional: true }),
  field('baseInfo[].value', 'string', '基本信息展示值；司龄等值可能已含单位文本', { optional: true }),
  field('totalScore', 'number | null', '员工总评分；本页面未消费', { optional: true, nullable: true, nullMeaning: '未返回' }),
  field('userId', idType + ' | null', '关联系统用户ID；不是员工ID或组织ID', { optional: true, nullable: true, nullMeaning: '未返回' }),
]

const organizationFields = (prefix: string): AiField[] => [
  field(`${prefix}.id`, idType, '组织主键；组织统计接口的orgId来源', { source: 'HrOrganizationDTO.id' }),
  field(`${prefix}.pid`, idType + ' | null', '上级组织ID；根节点可能为空', { optional: true, nullable: true, nullMeaning: '根节点或后端未返回' }),
  field(`${prefix}.name`, 'string | null', '组织名称；树节点标签和图表横轴可能使用', { optional: true, nullable: true, nullMeaning: '后端未返回名称' }),
  field(`${prefix}.code`, 'string | null', '组织编码；不是组织ID', { optional: true, nullable: true, nullMeaning: '后端未返回编码' }),
  field(`${prefix}.fullPath`, 'string | null', '组织架构全路径', { optional: true, nullable: true, nullMeaning: '后端未返回路径' }),
  field(`${prefix}.level`, 'integer | null', '组织层级', { optional: true, nullable: true, nullMeaning: '后端未返回层级' }),
  field(`${prefix}.status`, 'integer | null', '组织状态；具体取值沿用后端组织状态字典', { optional: true, nullable: true, nullMeaning: '后端未返回状态' }),
  field(`${prefix}.children`, 'array | null', '下级组织树节点；叶子节点可能没有该字段', { optional: true, nullable: true, nullMeaning: '叶子节点或后端未返回子节点' }),
  field(`${prefix}.children[]`, 'object', '一个下级组织节点', { optional: true }),
]

const chartFields = (prefix = '[]'): AiField[] => [
  field('$', 'array', 'Java ChartData 数组；页面按返回顺序消费不同统计块'),
  field(prefix, 'object', '一项统计图表'),
  field(`${prefix}.title`, 'string | null', '图表标题；用于区分编制、员工人数、年龄/学历/司龄等统计', { nullable: true, nullMeaning: '后端未返回标题' }),
  field(`${prefix}.unit`, 'string | null', '纵轴单位；例如人数', { nullable: true, nullMeaning: '该图表未设置单位' }),
  field(`${prefix}.lineData`, 'array', '图表数据线数组；不要按数组下标猜测业务含义，应结合title和mark', { nullable: true, nullMeaning: '后端未返回数据线' }),
  field(`${prefix}.lineData[]`, 'object', '一条数据线'),
  field(`${prefix}.lineData[].mark`, 'string | null', '数据线标签，例如实际人数、目标编制、入职人数、离职人数、总人数', { nullable: true, nullMeaning: '后端未返回标签' }),
  field(`${prefix}.lineData[].points`, 'array', '该数据线的横纵坐标点'),
  field(`${prefix}.lineData[].points[]`, 'object', '一个图表坐标点'),
  field(`${prefix}.lineData[].points[].x`, 'string | null', '横轴标签，可能是组织名、月份或“持平/较上月增加…”等后端生成文本', { nullable: true, nullMeaning: '后端未返回横轴文本' }),
  field(`${prefix}.lineData[].points[].y`, 'number | null', '纵轴数值；人数/编制/分布统计的原始数值', { nullable: true, nullMeaning: '后端未返回数值' }),
  field(`${prefix}.lineData[].points[].z`, 'string | null', '后端Point扩展字段；本页面未消费', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
]

const contracts: Record<string, AiContract> = {}
function add (id: string, contract: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Me organization contract has no registered definition: ${id}`)
  contracts[id] = contract
}

function readContract (purpose: string, inputs: Record<string, AiParameter>, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    effect: 'read',
    boundaries: commonBoundaries,
    prerequisites: ['使用当前用户会话、当前租户，并拥有Portal“组织信息”页面权限。'],
    inputs,
    output,
    consume,
    steps: [],
    completion: '返回当前会话在该筛选条件下的后端结果；不产生写入。',
    failures: commonFailures,
    idempotency: null,
    evidence,
    gaps: ['已完成Portal/Java静态逐字段核对和离线请求测试；尚未在真实测试环境执行本页面读请求、负责人/非负责人权限矩阵和module-type数据范围对照。'],
    ...extra,
  }
}

add('me-organization-direct-org-list', readContract(
  '读取当前登录用户作为负责人所辖的组织列表，用于Portal判断是否展示负责人统计页面。',
  {},
  {
    shape: 'object[]',
    fields: [field('$', 'array', '当前用户所辖组织列表；超级管理员或非负责人可能为空'), ...organizationFields('[]')],
    empty: '[]表示后端按当前会话没有返回所辖组织；页面会进入非负责人分支，但仍会读取员工基本信息。不要把[]解释成请求失败。',
  },
  ['只用数组是否为空判断当前页面分支；需要组织ID时优先使用员工基本信息organization或角色组织树，而不是猜测第一条所辖组织。'],
))

add('me-organization-staff-base-info', readContract(
  '读取当前登录用户的员工基本信息，用于页面头部、基础信息卡片和负责人统计的默认组织。',
  {},
  {
    shape: 'object',
    fields: [field('$', 'object', '当前会话员工基本信息'), ...staffFields],
    empty: '响应不是对象或当前会话员工不存在时抛错；不要用空对象继续调用统计接口。organization为空时不能发起需要组织ID的统计查询。',
  },
  ['展示name、staffCode、postName、organizationName、headImg和baseInfo；baseInfo按原顺序展示，不自行补写后端没有返回的字段。', '将result.organization作为统计查询orgId前先确认它是正整数ID；organizationName只是展示文本，不能替代organization。'],
  {
    steps: [{
      role: 'optional',
      when: '当前用户是组织负责人并要查看组织统计',
      capabilityId: 'me-organization-establishment-chart',
      mapping: { orgId: 'result.organization' },
      instruction: '只把员工基本信息中的organization作为组织ID；为空或非法时先读取角色组织树并让用户选择，不把organizationName当ID。',
    }],
  },
))

add('me-organization-organization-tree', readContract(
  '读取当前登录用户在组织信息页面组织筛选器中可见的角色组织树。',
  {},
  {
    shape: 'object[]',
    fields: [field('$', 'array', '按当前会话角色/负责人范围返回的组织树根节点'), ...organizationFields('[]')],
    empty: '[]表示当前会话没有可见组织树节点；不要把它替换成全量组织树，也不要把组织名称当作提交值。',
  },
  ['把节点id作为getEstablishmentChart、getEmployeeStatistics和getOrganizationStatistics的orgId；保留children层级，不修改后端返回的可见范围。'],
))

add('me-organization-duty-options', readContract(
  '读取负责人统计页面“职务”下拉框的全部职务候选。',
  {},
  {
    shape: 'object[]',
    fields: [
      field('$', 'array', '当前租户的职务候选数组'),
      field('[]', 'object', '一个职务候选'),
      field('[].id', idType, '职务主键；getOrganizationStatistics.dutyId使用它', { source: 'HrDutyDTO.id' }),
      field('[].dutyName', 'string | null', '职务名称；Portal下拉框label和值展示', { nullable: true, nullMeaning: '后端未返回名称' }),
      field('[].dutyLevelId', 'string | null', '职务层级ID逗号串；本页面只保留后端扩展字段，不把它当作dutyId', { optional: true, nullable: true, nullMeaning: '后端未返回层级' }),
      field('[].isDel', 'integer | null', '逻辑删除标记；候选接口通常已过滤，调用方不要把它当筛选参数', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
    ],
    empty: '[]表示当前租户没有可返回的职务候选；不要用职务名称或岗位ID替代dutyId。',
  },
  ['展示[].dutyName并把用户选择的[].id映射为getOrganizationStatistics.dutyId；候选接口是全量加载，不提供空关键字搜索或分页参数。'],
))

add('me-organization-establishment-chart', readContract(
  '查询所选组织及其下级组织/岗位的编制实际人数、目标编制和近12月编制统计。',
  {
    orgId: param('组织ID；不能填写组织名称、工号或岗位ID。', 'me-organization-staff-base-info.organization 或 me-organization-organization-tree[].id/children[].id', { type: idType, required: true, constraints: ['必须为正整数；保留Java Long序列化出的数字字符串'] }),
  },
  { shape: 'object[]', fields: chartFields(), empty: '[]表示当前组织没有可返回的编制图表；图表为空不等同于无权限。' },
  ['先展示title、lineData[].mark、points[].x和points[].y；不要把返回数组固定解释成某个顺序之外的业务类型。', 'Portal选择组织后才请求；清空组织时页面不会请求，调用方应在发请求前保留同样的正整数ID门槛。'],
))

add('me-organization-employee-statistics', readContract(
  '按组织和Portal月份选择器实际提交的日期读取员工统计小结。',
  {
    orgId: param('组织ID。', 'me-organization-staff-base-info.organization 或 me-organization-organization-tree的节点id', { type: idType, required: true }),
    date: param('统计日期，格式YYYY-MM-DD；页面picker=month但value-format仍是该格式。', 'Portal员工统计小结月份选择器提交值', { type: 'string', required: true, format: 'YYYY-MM-DD', constraints: ['必须是真实日历日期；不要改成YYYY-MM或自行改成月末'] }),
  },
  { shape: 'object[]', fields: chartFields(), empty: '[]表示当前组织和日期没有员工统计结果；返回中的x文本可能已经包含较上月增减说明。' },
  ['按图表title和lineData[].mark消费入职人数、离职人数、总人数、编制、退休、干部和组织类型统计；保留原始x/y，不把后端生成的比较文本解析成新的枚举。'],
))

add('me-organization-organization-statistics', readContract(
  '按组织、标准单元和职务筛选读取员工职务、人数、年龄、学历和司龄分布。',
  {
    orgId: param('组织ID。', '组织筛选器当前值；来自me-organization-organization-tree节点id或员工基本信息organization', { type: idType, required: true }),
    standardUnit: param('标准单元字典值；对应Portal standard_cell下拉选择。', 'Portal“单元”下拉选择；清空时传空字符串。', { type: 'string', required: false, omitted: 'SDK发送空字符串', nullable: true, nullMeaning: '不按标准单元筛选' }),
    dutyId: param('职务ID；对应Portal职务下拉选择。', 'Portal“职务”下拉选择；清空时传空字符串。', { type: idType + ' | ""', required: false, omitted: 'SDK发送空字符串', nullable: true, nullMeaning: '不按职务筛选' }),
  },
  { shape: 'object[]', fields: chartFields(), empty: '[]表示当前筛选下没有员工统计图表；Portal会过滤掉title为“单元分布”的图表后再展示。' },
  ['保持返回数组及每个图表lineData原顺序；Portal按title过滤“单元分布”，并使用职务、员工人数、年龄、学历、司龄图表，不要把SDK结果排序或合并。', 'standardUnit和dutyId都清空时仍发送空字符串，和Portal初始请求一致；不把空字符串改成缺省或任意默认选项。'],
))

export const ME_ORGANIZATION_AI_CONTRACTS: Record<string, AiContract> = contracts
export const ME_ORGANIZATION_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(ME_ORGANIZATION_METHODS).map(([capabilityId, method]) => [
    `meOrganization.${method}`,
    {
      ...ME_ORGANIZATION_AI_CONTRACTS[capabilityId]!,
      boundaries: [...ME_ORGANIZATION_AI_CONTRACTS[capabilityId]!.boundaries, `直接方法使用sdk.meOrganization.${method}；本组方法只读，不存在表单提交或回查写入步骤。`],
    },
  ]),
)
