import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { MANAGE_COST_CENTER_METHODS } from '../capabilities/manage-cost-center.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: false, nullable: false, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })
const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用姓名、行号或组织名称代替ID']

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '员工/汇总记录ID；页面列表本身不提交它', { optional: true, nullable: true, nullMeaning: '后端未返回记录ID', constraints: idRules }),
  field('list[].name', 'string', '员工姓名', { nullable: true, nullMeaning: '后端未返回姓名' }),
  field('list[].staffCode', 'string | number', '员工工号', { nullable: true, nullMeaning: '后端未返回工号', constraints: idRules }),
  field('list[].idCard', 'string', '身份证文本，按原值返回', { nullable: true, nullMeaning: '后端未返回身份证' }),
  field('list[].insuranceCost', 'string', '社保成本中心显示文本；可能是组合/路径文本', { nullable: true, nullMeaning: '后端未返回社保成本中心' }),
  field('list[].fundCost', 'string', '公积金成本中心显示文本；可能是组合/路径文本', { nullable: true, nullMeaning: '后端未返回公积金成本中心' }),
  field('list[].salaryCost', 'string', '薪资成本中心显示文本；可能是组合/路径文本', { nullable: true, nullMeaning: '后端未返回薪资成本中心' }),
  field('list[].fullPath', 'string', '所属组织全路径', { nullable: true, nullMeaning: '后端未返回组织路径' }),
  field('total', 'integer', '符合筛选的总记录数，不是当前页长度'),
]
const pageOutput: AiContract['output'] = { shape: '{ list: array, total: integer }', fields: [field('$', 'object', '成本中心汇总分页结果'), field('list', 'array', '当前页记录，不是全部数据'), field('list[]', 'object', '一条成本中心汇总记录'), ...rowFields], empty: 'list=[]且total=0表示筛选无记录；权限或响应形状错误会抛出。' }
const queryInputs: Record<string, AiParameter> = {
  name: optional('员工姓名筛选', '页面姓名输入框', 'SDK发送空字符串，不限制姓名', { type: 'string', nullable: true }),
  insuranceCost: optional('社保成本中心文本筛选', '页面社保成本中心输入框', 'SDK发送空字符串，不限制文本', { type: 'string', nullable: true }),
  fundCost: optional('公积金成本中心文本筛选', '页面公积金成本中心输入框', 'SDK发送空字符串，不限制文本', { type: 'string', nullable: true }),
  salaryCost: optional('薪资成本中心文本筛选', '页面薪资成本中心输入框', 'SDK发送空字符串，不限制文本', { type: 'string', nullable: true }),
  organization: optional('所属组织ID', '页面全组织树的角色筛选', 'SDK发送空字符串，不限制组织', { type: 'string | number', nullable: true, constraints: idRules }),
  pageNo: optional('页码', '页面分页状态', 'SDK默认1', { type: 'integer' }),
  pageSize: optional('页大小', '页面分页状态', 'SDK默认20', { type: 'integer', constraints: ['10、20、50、100、200、500'] }),
}
const fileOutput: AiContract['output'] = { shape: '{ fileName, contentType, base64, byteLength }', fields: [field('$', 'object', '成本中心导出二进制文件内存表示'), field('fileName', 'string', '响应文件名；Java未固定文件名时SDK使用成本中心.xlsx作为回退'), field('contentType', 'string | null', '响应Content-Type', { nullable: true }), field('base64', 'string', '文件内容Base64'), field('byteLength', 'integer', '原始字节数')], empty: '空文件响应失败。' }
const treeOutput: AiContract['output'] = { shape: 'array', fields: [field('$', 'array', '当前会话可见角色组织树根节点'), field('[].id', 'string | number', '组织ID', { constraints: idRules }), field('[].name', 'string', '组织名称'), field('[].children', 'array', '子组织节点')], empty: '[]表示当前会话没有可见组织。' }
const routeOutput: AiContract['output'] = { shape: '{ path: string }', fields: [field('$', 'object', '本地路由动作结果'), field('path', 'string', 'Portal继续进入的相对路径')], empty: '不会返回网络数据。' }
const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/hr/manage/cost-center/list.vue 与 app/portal/components/portal/hxr/tree-select/all-org/index.vue', kind: 'reference', note: '证明页面的五个表单字段、旧版角色组织树、分页、导出和维护成本中心本地路由；固定检出未pull。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 SalaryCostCenterController、CostCenterSelectDTO、CostCenterPageDTO、SalaryCostCenterServiceImpl', kind: 'reference', note: '证明page/export端点、查询字段、数据范围注解和完整列表字段；维护CRUD属于子页，不挂到当前列表页。固定检出未pull。' },
  { source: 'src/capabilities/manage-cost-center.ts', kind: 'implementation', note: '证明SDK的查询转换、组织树、列表字段、文件响应和本地路由动作。' },
  { source: 'test/manage-cost-center.test.ts', kind: 'test', note: '离线锁定列表、导出、组织树、路由动作、权限和坏响应。' },
]
const gaps = ['未启动浏览器、未取得独立网络基准、未在真实测试环境执行读请求；当前列表页没有写接口，维护CRUD属于另一个子页且本节点未扩展。', 'Portal/Java固定检出未按任务约束pull到远端最新，部署版本差异未验证。']
function base (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract {
  return {
    whenToUse: '操作Portal“成本中心”汇总列表页的筛选、组织候选、导出或进入维护子页。',
    boundaries: ['当前页面只查询员工成本中心汇总并导出；维护按钮只是路由到./maintenance/list，不在本能力中伪造维护CRUD。', '组织筛选使用页面实际的getRoleOrganizationTree角色树；organization是Long语义的ID，不是组织名称。', '成本中心字段是显示文本，SDK不把文本拆成或推断为成本中心ID。'],
    prerequisites: ['已建立带有效会话token、tenantId和platform页面上下文的SDK。'],
    failures: ['非法组织ID、分页或响应字段失败；权限错误和网络错误原样抛出，不能返回空列表冒充无数据。'],
    evidence,
    gaps,
    ...value,
  }
}

const RAW: Record<string, AiContract> = {
  'manage-cost-center-list': base({ purpose: '按员工姓名、三个成本中心文本和所属组织筛选成本中心汇总。', effect: 'read', inputs: queryInputs, output: pageOutput, consume: ['按total分页；展示name、staffCode、idCard、三个成本中心文本和fullPath。', '需要继续维护时先确认当前页面结果，再调用本地maintenance动作进入子页。'], steps: [{ role: 'optional', when: '需要组织筛选候选', capabilityId: 'manage-cost-center-organization-tree', mapping: {}, instruction: '读取树后只提交组织ID到args.organization，不用名称。' }, { role: 'optional', when: '用户明确要求维护成本中心', capabilityId: 'manage-cost-center-maintenance', mapping: {}, instruction: '只导航，不把本页汇总行当成维护表单。' }], completion: '返回当前筛选页和total。', idempotency: null }),
  'manage-cost-center-organization-tree': base({ purpose: '读取成本中心汇总页面所属组织筛选使用的角色组织树。', effect: 'read', inputs: {}, output: treeOutput, consume: ['选择节点ID填入manage-cost-center-list.organization。'], steps: [], completion: '获得当前会话可见组织树。', idempotency: null }),
  'manage-cost-center-export': base({ purpose: '按成本中心汇总页面筛选条件导出当前结果。', effect: 'read', inputs: queryInputs, output: fileOutput, consume: ['保存非空文件；Java未固定Content-Disposition时使用SDK回退文件名。'], steps: [], completion: '获得非空导出文件。', idempotency: null }),
  'manage-cost-center-maintenance': base({ purpose: '进入Portal成本中心维护子页。', effect: 'local', inputs: {}, output: routeOutput, consume: ['在支持Portal路由的调用方打开./maintenance/list；该结果不代表维护保存成功。'], steps: [], completion: '获得与Portal一致的相对路由。', idempotency: null }),
}

export const MANAGE_COST_CENTER_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(MANAGE_COST_CENTER_METHODS).map(id => [id, RAW[id]!]))
export const MANAGE_COST_CENTER_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(MANAGE_COST_CENTER_METHODS).map(([id, method]) => [`manageCostCenter.${method}`, MANAGE_COST_CENTER_AI_CONTRACTS[id]!]))
