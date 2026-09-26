import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  HISTORY_ARCHIVE_METHODS,
  HISTORY_ARCHIVE_PAGE_PATH,
  HISTORY_ARCHIVE_PERMISSION,
  historyArchiveCapabilities,
} from '../capabilities/history-archive.js'

const PAGE_PATH = HISTORY_ARCHIVE_PAGE_PATH
const PAGE_PERMISSION = HISTORY_ARCHIVE_PERMISSION
const definitions = new Map(historyArchiveCapabilities.map(definition => [definition.id, definition]))

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const idConstraints = ['Java Long可能序列化为字符串，必须原样保留', '不能用名称、行号或当前用户ID代替']
const idField = (path: string, meaning: string): AiField => field(path, 'string | number', meaning, { constraints: idConstraints })
const nullableTextField = (path: string, meaning: string): AiField => field(path, 'string', meaning, { nullable: true, nullMeaning: '后端未填写或该字段不适用' })
const nullableNumberField = (path: string, meaning: string): AiField => field(path, 'number', meaning, { nullable: true, nullMeaning: '后端未填写或该字段不适用' })

const pageFields = (itemMeaning: string, itemFields: AiField[]): AiField[] => [
  field('$', 'object', itemMeaning + '分页结果'),
  field('list', 'array', '当前筛选页的记录数组；不是全部记录'),
  field('list[]', 'object', itemMeaning + '中的一条记录'),
  ...itemFields.map(item => ({ ...item, path: `list[].${item.path}` })),
  field('total', 'integer', '符合筛选条件的总记录数；不是当前页长度', { constraints: ['非负整数'] }),
]

const archiveFields: AiField[] = [
  idField('id', '组织归档主记录ID；进入历史组织架构图时作为archiveId'),
  nullableTextField('archiveDate', '归档日期；Portal按YYYY-MM-DD展示'),
  nullableTextField('archiveTime', '归档创建时间；SDK保留Portal/服务端原值，不擅自转换时区'),
  field('archiveType', 'integer', '归档类型；当前页面组织页接口固定筛选组织归档，值1表示组织', { nullable: true, values: { '1': '组织' }, nullMeaning: '后端未返回归档类型' }),
  nullableNumberField('orgCount', '归档时组织总数；页面当前列表未展示'),
  nullableTextField('operator', '归档操作人展示名'),
]

const snapshotFields: AiField[] = [
  idField('id', '人员快照主记录ID；进入历史员工列表时作为snapshotId'),
  nullableTextField('snapshotMonth', '快照月份；Portal按YYYY-MM展示'),
  nullableTextField('snapshotTime', '快照创建时间；SDK保留原值，不擅自转换时区'),
  nullableNumberField('staffCount', '快照时员工总数；页面当前列表未展示'),
  nullableTextField('operator', '快照操作人展示名'),
]

const staffFields = (prefix = ''): AiField[] => {
  const path = (name: string) => prefix ? `${prefix}.${name}` : name
  return [
    idField(path('id'), '历史员工快照明细ID；进入历史员工详情时，Portal将其作为staffId使用'),
    nullableTextField(path('name'), '员工姓名'),
    field(path('staffCode'), 'string | number', '员工号；Java Long可能序列化为字符串', { nullable: true, nullMeaning: '未填写员工号' }),
    field(path('status'), 'integer', '在职类型字典值：1在职、2离职、3退休、4返聘、5在编不在岗', { nullable: true, values: { '1': '在职', '2': '离职', '3': '退休', '4': '返聘', '5': '在编不在岗' }, nullMeaning: '未填写' }),
    nullableTextField(path('mobile'), '联系方式；员工列表SQL按字符串返回，详情接口可能按Long返回'),
    nullableTextField(path('idCard'), '证件号码；页面详情展示敏感原值'),
    nullableNumberField(path('sex'), '性别字典值'),
    nullableTextField(path('birthday'), '出生日期原值'),
    nullableNumberField(path('age'), '年龄原值'),
    nullableTextField(path('nation'), '民族字典值'),
    nullableTextField(path('fullPath'), '历史所属组织完整路径'),
    field(path('organization'), 'string | number', '历史主组织ID；组织筛选使用的实体ID', { nullable: true, nullMeaning: '快照没有主组织或组织已无法映射' }),
    field(path('post'), 'string | number', '历史主岗位ID', { nullable: true, nullMeaning: '快照没有主岗位或岗位已无法映射' }),
    nullableTextField(path('postName'), '历史岗位名称；由快照SQL返回的展示值'),
    nullableNumberField(path('householdType'), '户口性质字典值'),
    nullableTextField(path('nativePlace'), '籍贯'),
    nullableTextField(path('communistTime'), '入党团时间原值'),
    nullableNumberField(path('politicalOutlook'), '政治面貌字典值'),
    nullableTextField(path('residenceAddress'), '户籍地址'),
    nullableTextField(path('salaryCost'), '薪资成本中心原始值'),
    nullableNumberField(path('employmentType'), '用工类型字典值'),
    nullableNumberField(path('salaryLevel'), '薪资等级ID；员工列表SQL返回的底层值'),
    nullableNumberField(path('salaryStructure'), '薪资结构字典值'),
    nullableNumberField(path('leader'), '直属上级ID'),
    nullableNumberField(path('staffStatus'), '员工状态字典值：1在岗、2待岗、3离岗'),
    nullableTextField(path('insuranceCost'), '社保成本中心底层值'),
    nullableTextField(path('fundCost'), '公积金成本中心底层值'),
    nullableTextField(path('insureArea'), '投保地区底层值'),
    nullableNumberField(path('idType'), '证件类型字典值'),
    nullableNumberField(path('maritalStatus'), '婚姻状况字典值'),
    nullableNumberField(path('healthCondition'), '健康状况字典值'),
    nullableTextField(path('healthConditionProve'), '健康状况说明'),
    nullableTextField(path('entryTime'), '入职时间原值'),
    nullableNumberField(path('seniorityBeforeEntry'), '入职前累计工龄'),
    nullableNumberField(path('entrySeniority'), '司龄'),
    nullableNumberField(path('totalSeniority'), '累计工龄'),
    nullableNumberField(path('isReEmploy'), '是否再次入司：0否、1是'),
    nullableNumberField(path('insurancePaymentAddress'), '五险一金缴存单位ID'),
    nullableTextField(path('cardIssuingBank'), '开卡银行'),
    nullableTextField(path('bankAccount'), '银行账号'),
    nullableTextField(path('email'), '电子邮箱'),
    nullableNumberField(path('childNumber'), '子女个数'),
    nullableTextField(path('address'), '现住址'),
    nullableTextField(path('emergencyContact'), '紧急联系人'),
    nullableNumberField(path('relationship'), '紧急联系人关系字典值'),
    nullableNumberField(path('emergencyMobile'), '紧急联系人电话'),
    nullableNumberField(path('education'), '最高学历字典值'),
    nullableNumberField(path('academicDegree'), '学位字典值'),
    nullableNumberField(path('isFullTime'), '是否全日制：0否、1是'),
    nullableNumberField(path('isUnifiedRecruitment'), '是否统招：0否、1是'),
    nullableTextField(path('enrollmentDate'), '入学日期原值'),
    nullableTextField(path('graduationTime'), '毕业时间原值'),
    nullableTextField(path('university'), '毕业院校'),
    nullableTextField(path('speciality'), '所学专业'),
    nullableNumberField(path('havingRentalSubsidies'), '是否享受租房补贴：0否、1是'),
    nullableTextField(path('rentalFile'), '租房类型附件地址'),
    nullableTextField(path('otherPosts'), '兼职岗位原始值'),
    nullableTextField(path('leaveTime'), '离职时间原值'),
    nullableTextField(path('retireTime'), '退休时间原值'),
    nullableNumberField(path('havingOnlyChildMoney'), '是否有独生子女补贴：0否、1是'),
    nullableNumberField(path('isFile'), '本公司是否存档：0否、1是'),
    nullableTextField(path('staffDuties'), '员工职务原始值'),
  ]
}

const archiveOutput: AiContract['output'] = { shape: '{ list: object[], total: integer }', fields: pageFields('组织历史归档', archiveFields), empty: 'list=[]且total=0表示当前日期筛选没有组织归档记录；权限、网络或响应结构错误会抛出，不改写为空列表。' }
const snapshotOutput: AiContract['output'] = { shape: '{ list: object[], total: integer }', fields: pageFields('人员历史快照', snapshotFields), empty: 'list=[]且total=0表示当前月份筛选没有人员快照；权限、网络或响应结构错误会抛出。' }
const staffOutput: AiContract['output'] = { shape: '{ list: object[], total: integer }', fields: pageFields('历史员工', staffFields()), empty: 'list=[]且total=0表示该快照和筛选条件没有员工；DTO声明但当前快照SQL未填充的名称字段不能被推断为存在。' }
const detailOutput: AiContract['output'] = { shape: 'object | null', fields: [field('$', 'object | null', '历史员工详情；不存在时Portal收到null并展示“未找到”'), ...staffFields(), field('contractList', 'array', '快照生成时保存的合同列表；空数组表示没有合同或detailJson未保存'), field('contractList[]', 'object', '一条历史合同记录'), field('workList', 'array', '快照生成时保存的工作经历列表；空数组表示没有经历或detailJson未保存'), field('workList[]', 'object', '一条历史工作经历记录')], empty: '根值null表示snapshotId与staffId没有匹配的历史员工；非对象或缺少id会抛错。' }
const customInfoOutput: AiContract['output'] = { shape: 'object', fields: [field('$', 'object', '历史员工页面自定义列配置'), field('tableName', 'string', '固定为hr_staff，用于确认配置来源'), field('customColumnsInfo', 'array', '列控制器使用的分组和列定义；页面只消费该字段'), field('customColumnsInfo[]', 'object', '一条自定义列定义，具体嵌套形态由当前租户配置决定'), field('customExportColumns', 'array', '后端返回的可导出列配置；当前页面不调用导出动作', { optional: true }), field('customQueryColumns', 'array', '后端返回的可查询列配置；当前页面不把它作为历史员工查询参数', { optional: true })], empty: 'customColumnsInfo=[]表示当前配置没有自定义列；请求失败或缺少数组会抛出。' }
const treeNodeFields = (prefix: string): AiField[] => [
  idField(`${prefix}.id`, '历史组织节点ID；作为parentId/rootId使用'),
  field(`${prefix}.parentId`, 'string | number', '历史父组织ID；根节点为null', { nullable: true, nullMeaning: '该节点是历史根组织' }),
  nullableTextField(`${prefix}.name`, '历史组织名称'),
  nullableTextField(`${prefix}.code`, '历史组织编码'),
  nullableTextField(`${prefix}.managerId`, '负责人ID原值；可能是逗号分隔的多个ID'),
  nullableTextField(`${prefix}.managerName`, '负责人名称展示值'),
  field(`${prefix}.hasChildren`, 'boolean', '是否存在下级历史组织'),
  field(`${prefix}.sort`, 'string | number', '历史组织稳定排序值；后端以组织ID作为sort', { nullable: true, nullMeaning: '后端未返回排序值' }),
]
const treeOutput: AiContract['output'] = { shape: '{ list: object[], total: integer, projectionToken: string, archiveDate: string | null }', fields: [field('$', 'object', '历史组织投影分页结果'), field('list', 'array', '当前根/子组织页'), field('list[]', 'object', '一条历史组织节点'), ...treeNodeFields('list[]'), field('list[].ancestorPath', 'array', '搜索命中的节点从根到父级的历史路径；普通分页通常缺席'), field('list[].ancestorPath[]', 'object', '祖先路径中的历史组织节点'), ...treeNodeFields('list[].ancestorPath[]'), field('total', 'integer', '当前根或当前parentId下的节点总数'), field('projectionToken', 'string', '本次历史组织投影令牌；后续分页、搜索和导出必须原样复用'), field('archiveDate', 'string', '该投影对应的归档日期', { nullable: true, nullMeaning: '后端未返回日期' })], empty: 'list=[]表示当前根/父组织下没有节点；缺少或变化的projectionToken不表示空树，而表示需要重新从根请求。' }
const fileOutput: AiContract['output'] = { shape: '{ fileName: string, contentType: string | null, byteLength: integer, base64: string }', fields: [field('fileName', 'string', '服务端Content-Disposition文件名；缺少时使用SDK回退名'), field('contentType', 'string', '导出响应Content-Type', { nullable: true, nullMeaning: '响应未提供Content-Type' }), field('byteLength', 'integer', '文件字节数'), field('base64', 'string', '文件二进制的标准Base64；调用方负责保存')], empty: '空文件或非二进制响应会抛出；JSON错误Blob不会被当成成功文件。' }

const evidence: AiContract['evidence'] = [
  { source: 'Portal app/portal/menus/hr.js:55；views/dashboard/hr/history-archive/list.vue、components/ListViewOrg.vue、components/ListViewPeople.vue、people/record-list.vue、people/detail.vue、org/chart.vue @ acab69acc7', kind: 'reference', note: '证明保留页面入口、两个顶部列表、历史员工详情、自定义列、组织树分页/搜索/导出以及真实表单筛选和分页字段。' },
  { source: 'Java HrOrganizationArchiveController、HrStaffSnapshotController、HrStaffController、HrArchiveProjectionService、HrStaffSnapshotServiceImpl及DTO/DAO @ 0f1a55718eb', kind: 'reference', note: '证明请求路径、page/pageNo差异、字段、投影令牌、导出格式、null详情和后端筛选/租户边界。' },
  { source: 'src/capabilities/history-archive.ts 与 test/history-archive.test.ts', kind: 'implementation', note: '证明SDK实际请求投影、响应校验、二进制文件包装和离线反证；不替代真实测试环境权限和网络验证。' },
]

const commonBoundaries = [
  `页面路径是${PAGE_PATH}，权限码是${PAGE_PERMISSION}，走platform实例；这是保留范围中的portal/人力页面，不扩展到独立生产、财务、采购或销售顶层系统。`,
  '页面本身是只读历史查询；SDK不发布快照生成、归档执行、历史删除、组织变更diff或普通员工导出等页面未调用的接口。',
  '列表页的order/orderField是Portal公共模块固定发送的空参数，后端分别按归档日期、快照月份或组织全路径固定排序；不能把它们解释成可用排序开关。',
  'Java源码没有方法级PreAuthorize；实际可见性仍受Portal菜单权限、会话租户、网关/全局安全和后端数据隔离影响，SDK不把静态源码缺失注解解释为无权限限制。',
]
const commonPrerequisites = ['使用当前用户会话token、当前租户和Portal页面权限；archiveId、snapshotId、staffId、parentId和rootId必须来自当前页面链路或用户明确确认。']
const commonFailures = ['请求被拒绝、租户/权限不足、网络失败、后端参数转换失败或响应结构不符合契约时抛错；空分页是业务无记录，不改写成权限成功。']
const gaps = ['已完成Portal/Java逐页静态核对、请求投影和离线反证；尚未在真实测试门户执行本页读请求、真实权限矩阵和导出文件回执验证。']
const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '需要读取Portal「历史归档记录」页面中的组织归档、人员快照、历史员工或历史组织架构时使用；不要用它查询当前组织/当前员工。',
  boundaries: commonBoundaries,
  prerequisites: commonPrerequisites,
  failures: commonFailures,
  evidence,
  gaps,
})

const listInputs: Record<string, AiParameter> = {
  archiveDate: input('组织归档日期筛选。', 'Portal日期选择器', { required: false, type: 'string | null', nullable: true, omitted: '省略时按Portal默认null发送，platform会从最终URL中剔除null', format: 'YYYY-MM-DD', nullMeaning: '不按日期筛选' }),
  pageNo: input('页码。', '调用方分页意图', { required: false, type: 'integer', default: 'SDK默认1；请求字段名映射为page', constraints: ['正整数'] }),
  pageSize: input('每页条数。', '调用方分页意图', { required: false, type: 'integer', default: 'SDK默认20；页面支持10、20、50、100', constraints: ['正整数，建议使用页面选项'] }),
}
const snapshotInputs: Record<string, AiParameter> = {
  snapshotMonth: input('人员快照月份筛选。', 'Portal月份选择器', { required: false, type: 'string | null', nullable: true, omitted: '省略时按Portal默认null发送', format: 'YYYY-MM', nullMeaning: '不按月份筛选' }),
  pageNo: listInputs.pageNo!,
  pageSize: listInputs.pageSize!,
}
const staffInputs: Record<string, AiParameter> = {
  snapshotId: input('人员快照主记录ID。', 'history-archive-people-list.list[].id', { type: 'string | number', constraints: idConstraints }),
  staffName: input('历史员工姓名模糊筛选。', 'Portal姓名输入框', { required: false, type: 'string', omitted: '省略时发送空字符串' }),
  staffCode: input('历史员工号精确筛选。', 'Portal员工号输入框', { required: false, type: 'string | number', omitted: '省略时发送空字符串', constraints: ['仅数字或数字字符串；Java按Long解析'] }),
  status: input('在职类型字典值。', 'Portal job_status选择器', { required: false, type: 'string | number', omitted: '省略时发送空字符串' }),
  mobile: input('手机号精确筛选。', 'Portal手机号输入框', { required: false, type: 'string | number', omitted: '省略时发送空字符串' }),
  postName: input('岗位名称模糊筛选。', 'Portal岗位输入框', { required: false, type: 'string', omitted: '省略时发送空字符串' }),
  orgId: input('历史组织筛选ID。', 'Portal历史组织树选择器', { required: false, type: 'string | number', nullable: true, omitted: '省略时发送空字符串；传入后端会展开该快照月份的所有历史下级组织', nullMeaning: '不按组织筛选' }),
  pageNo: input('页码。', '调用方分页意图', { required: false, type: 'integer', default: 'SDK默认1；请求字段名保持pageNo' }),
  pageSize: input('每页条数。', '调用方分页意图', { required: false, type: 'integer', default: 'SDK默认20；页面支持10、20、50、100' }),
}

export const HISTORY_ARCHIVE_AI_CONTRACTS: Record<string, AiContract> = {
  'history-archive-organization-list': base({ purpose: '按Portal组织归档列表的归档日期和分页规则读取组织历史归档主记录。', effect: 'read', inputs: listInputs, output: archiveOutput, consume: ['用list[].id进入organizationTreePage；用total继续分页；archiveType=1只表示组织归档，不把orgCount当作当前可见组织总数。'], steps: [{ role: 'optional', when: '用户点击某条组织归档记录的“组织架构图”', capabilityId: 'history-archive-organization-tree-page', mapping: { archiveId: 'result.list[].id' }, instruction: '只对用户选中的记录传id作为archiveId，并从根分页返回的projectionToken继续后续动作。' }], completion: '返回当前日期筛选页和total；查询本身不产生归档或修改。', idempotency: null }),
  'history-archive-people-list': base({ purpose: '按Portal人员快照列表的归档月份和分页规则读取人员历史快照主记录。', effect: 'read', inputs: snapshotInputs, output: snapshotOutput, consume: ['用list[].id作为staff list的snapshotId；用snapshotMonth解释详情页面标题；用total继续分页。'], steps: [{ role: 'optional', when: '用户点击某条人员快照的“查看人员列表”', capabilityId: 'history-archive-staff-list', mapping: { snapshotId: 'result.list[].id' }, instruction: '只对用户选中的快照传id；不要把snapshotMonth当作snapshotId。' }], completion: '返回当前月份筛选页和total；查询本身不修改快照。', idempotency: null }),
  'history-archive-staff-list': base({ purpose: '读取指定人员历史快照中的分页员工列表，并复现Portal姓名、员工号、在职类型、岗位、手机号和历史组织筛选。', effect: 'read', inputs: staffInputs, output: staffOutput, consume: ['用list[].id作为历史员工详情staffId；status按后端字典解释；orgId筛选的是快照月份历史组织及其下级，不等同于当前组织树。', '不要依赖HrNewStaffPageDTO中但当前快照SQL未填充的名称扩展字段。'], steps: [{ role: 'optional', when: '用户点击某员工“详情”', capabilityId: 'history-archive-staff-detail', mapping: { snapshotId: 'args.snapshotId', staffId: 'result.list[].id' }, instruction: '对用户选中的单行使用同一快照ID和该行id；不要用员工号或姓名替代staffId。' }, { role: 'optional', when: '页面需要恢复列控制器配置', capabilityId: 'history-archive-staff-custom-info', mapping: {}, instruction: '读取固定hr_staff的自定义列定义；当前页面只用customColumnsInfo调整展示列。' }], completion: '返回指定快照和筛选条件的一页历史员工及total；不表示当前员工状态。', idempotency: null }),
  'history-archive-staff-detail': base({ purpose: '读取指定人员快照中一名员工的只读历史详情及快照生成时保存的合同、工作经历。', effect: 'read', inputs: { snapshotId: staffInputs.snapshotId!, staffId: input('历史员工原始ID。', 'history-archive-staff-list.list[].id', { type: 'string | number', constraints: idConstraints }) }, output: detailOutput, consume: ['根值null时展示Portal的未找到状态；非空时按页面分段消费基本、组织、薪酬、兼职、联系方式、学历和其它信息。contractList/workList只作为历史快照内容，不得据此修改当前员工。'], steps: [], completion: '获得目标快照员工的历史只读详情，或明确得到不存在的null。', idempotency: null }),
  'history-archive-staff-custom-info': base({ purpose: '读取历史员工列表页面列控制器使用的hr_staff自定义列元数据。', effect: 'read', inputs: {}, output: customInfoOutput, consume: ['只把customColumnsInfo传给页面列控制器；customExportColumns和customQueryColumns是后端配置回传，当前历史页面不据此发导出或查询。'], steps: [], completion: '获得固定tableName=hr_staff的列配置；不产生员工数据导出。', idempotency: null }),
  'history-archive-organization-tree-page': base({ purpose: '分页读取指定组织归档的历史根组织或某个历史组织的直接下级，并建立后续搜索/导出的稳定投影上下文。', effect: 'read', inputs: { archiveId: input('组织归档主记录ID。', 'history-archive-organization-list.list[].id', { type: 'string | number', constraints: idConstraints }), parentId: input('要展开的历史父组织ID。', 'Portal树节点id；根请求省略', { required: false, type: 'string | number', omitted: '省略表示查询历史根组织', constraints: idConstraints }), pageNo: input('节点页码。', 'Portal根/下级分页状态', { required: false, type: 'integer', default: 'SDK默认1' }), projectionToken: input('历史组织投影令牌。', '上一次同一archiveId根分页返回的projectionToken', { required: false, type: 'string | null', nullable: true, omitted: '首次省略；根的后续页、下级请求必须传同一令牌', nullMeaning: '仅表示首次初始化投影' }) }, output: treeOutput, consume: ['Portal固定每页20个节点；首次根页保存projectionToken、archiveDate和list；下级或下一页必须原样复用同一token。用total和固定pageSize=20判断是否还有节点。', '不要把projectionToken持久化为永久凭据；服务端投影变化或token不一致时重新从根请求。'], steps: [{ role: 'optional', when: '用户输入非空跨层组织关键字', capabilityId: 'history-archive-organization-tree-search', mapping: { archiveId: 'args.archiveId', keyword: 'user.keyword', projectionToken: 'result.projectionToken' }, instruction: '用当前根投影令牌搜索；keyword必须由用户提供且最多100字。' }, { role: 'optional', when: '用户在树中选择已加载的根组织并点击导出', capabilityId: 'history-archive-organization-tree-export', mapping: { archiveId: 'args.archiveId', rootId: 'result.list[].id', projectionToken: 'result.projectionToken', format: 'user.format' }, instruction: '只传当前选择的rootId；format必须从三种Portal菜单项中选择。' }], completion: '返回当前历史组织投影的一页节点和可继续使用的token；不表示整棵树已加载。', idempotency: null }),
  'history-archive-organization-tree-search': base({ purpose: '在同一次历史组织投影中按关键字跨层搜索组织，并返回用于定位树节点的祖先链。', effect: 'read', inputs: { archiveId: input('组织归档主记录ID。', 'history-archive-organization-list.list[].id', { type: 'string | number', constraints: idConstraints }), keyword: input('跨层搜索关键字。', '用户在Portal搜索框输入的组织名称', { type: 'string', constraints: ['trim后不能为空', '最多100个字符'] }), pageNo: input('搜索结果页码。', 'Portal搜索结果分页', { required: false, type: 'integer', default: '1' }), projectionToken: input('历史组织投影令牌。', 'history-archive-organization-tree-page.projectionToken', { type: 'string', constraints: ['必须来自同一archiveId的根分页'] }) }, output: treeOutput, consume: ['Portal固定每页20个搜索结果；用list[].ancestorPath恢复从根到命中组织的路径；搜索返回仍是分页结果，total用于翻页。token缺失或过期时回到根分页重新建立投影。'], steps: [{ role: 'optional', when: '用户点击某个搜索命中组织定位树', capabilityId: 'history-archive-organization-tree-page', mapping: { archiveId: 'args.archiveId', parentId: 'result.list[].ancestorPath[].id', projectionToken: 'args.projectionToken' }, instruction: '按页面从ancestorPath逐级合并定位；不要把搜索结果当作完整树。' }], completion: '返回当前投影中匹配关键字的节点、total和祖先路径；不修改组织数据。', idempotency: null }),
  'history-archive-organization-tree-export': base({ purpose: '按Portal导出菜单将当前历史组织投影中选定根组织的完整子树导出为Draw.io或纯文字文件。', effect: 'read', inputs: { archiveId: input('组织归档主记录ID。', 'history-archive-organization-list.list[].id', { type: 'string | number', constraints: idConstraints }), rootId: input('当前选中的历史根组织ID。', 'history-archive-organization-tree-page.list[].id或搜索祖先链', { type: 'string | number', constraints: idConstraints }), format: input('导出格式。', 'Portal导出菜单', { type: 'string', options: [{ value: 'drawio-vertical', label: 'Draw.io纵向' }, { value: 'drawio-horizontal', label: 'Draw.io横向' }, { value: 'text', label: '纯文字树形' }] }), projectionToken: input('历史组织投影令牌。', '最近一次同一archiveId树分页/搜索返回的projectionToken', { type: 'string', constraints: ['必须非空且未过期'] }) }, output: fileOutput, consume: ['保存或传输base64文件；Draw.io文件应保留XML，纯文字文件应保留UTF-8。文件回执不代表任何组织写入。'], steps: [], completion: '获得非空导出文件；服务端会按完整历史子树生成，无法把当前已加载节点数当作导出总节点数。', idempotency: null }),
}

export const HISTORY_ARCHIVE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(HISTORY_ARCHIVE_METHODS).map(([capabilityId, method]) => {
    const definition = definitions.get(capabilityId)
    if (!definition || definition.pagePath !== PAGE_PATH || definition.permission !== PAGE_PERMISSION) {
      throw new Error(`历史归档能力 ${capabilityId} 的页面或权限锚点不一致`)
    }
    return [`historyArchive.${method}`, HISTORY_ARCHIVE_AI_CONTRACTS[capabilityId]!]
  }),
)
