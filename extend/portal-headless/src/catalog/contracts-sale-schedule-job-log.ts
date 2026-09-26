import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALE_SCHEDULE_JOB_LOG_METHODS } from '../capabilities/sale-schedule-job-log.js'

const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })

const pagePath = '/dashboard/sale/job/schedule-job-log/list'
const pagePermission = '/dashboard/sale/frame/job/scheduleJobLog'
const actionPermission = 'job:scheduleJobLog:edit'

const rowFields: AiField[] = [
  field('list[].id', 'string | number | null', '任务日志记录ID；编辑和删除时使用，保留字符串避免长整数精度损失', { nullable: true, nullMeaning: '没有ID，不能继续执行按ID的编辑或删除' }),
  field('list[].jobId', 'string | null', '定时任务ID；页面第一列可点击查看当前行详情', { nullable: true }),
  field('list[].beanName', 'string | null', '执行任务的Spring Bean名称；列表筛选按后端精确匹配', { nullable: true }),
  field('list[].methodName', 'string | null', '执行方法名；列表筛选按后端精确匹配', { nullable: true }),
  field('list[].params', 'string | null', '任务执行参数原文；详情/编辑表单使用', { nullable: true }),
  field('list[].status', 'string | null', '执行结果字典值；页面用execute_status字典标签展示', { nullable: true }),
  field('list[].times', 'number | null', '任务耗时整数；页面直接展示并在编辑表单要求至少1', { nullable: true, unit: '页面原始耗时单位' }),
  field('list[].createDate', 'string | number | null', '触发时间原值', { nullable: true }),
  field('list[].updateDate', 'string | number | null', '更新时间原值；编辑请求不会把它带回表单', { nullable: true }),
  field('list[].error', 'string | null', '执行失败信息；详情/编辑表单使用', { nullable: true }),
  field('list[].remarks', 'string | null', '备注信息；详情/编辑表单使用', { nullable: true }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', '任务日志分页结果'),
    field('list', 'object[]', '当前页任务日志；不是全量结果'),
  field('total', 'number', '符合三个筛选条件的记录总数，用于分页，不是当前页长度；排序参数只影响顺序'),
    ...rowFields,
  ],
  empty: 'list=[]表示当前页没有记录；total=0才表示当前筛选无记录，权限或网络失败会抛错。',
}

const formFields: AiField[] = [
  field('form', 'object', 'Portal ModalFormContent 生成的完整提交对象；SDK会丢弃未被页面表单消费的扩展字段'),
  field('form.jobId', 'string', '定时任务ID；新建和编辑都必填，最多64个字符'),
  field('form.beanName', 'string', 'Bean名称；页面可空，最多200个字符'),
  field('form.methodName', 'string', '方法名；页面可空，最多100个字符'),
  field('form.params', 'string', '任务参数原文；页面可空，最多2000个字符'),
  field('form.status', 'string', '执行结果字典值；页面新建默认字符串10，必填且最多4个字符'),
  field('form.times', 'number', '耗时；页面输入框要求至少1，SDK按Java int要求安全正整数'),
  field('form.error', 'string', '失败信息；页面可空，最多2000个字符'),
  field('form.remarks', 'string', '备注信息；页面可空，按原字符串提交'),
  field('form.id', 'string | number', '编辑时的当前列表记录ID；新建时省略', { optional: true, nullable: true, nullMeaning: '新建请求不带id；编辑缺少id会在本地拒绝' }),
]

const preparedFormOutput: AiContract['output'] = {
  shape: '{ form: object }',
  fields: formFields,
  empty: '表单规则不通过时准备阶段抛错，不发送保存请求；成功只代表本地表单已整理。',
}

const removeOutput: AiContract['output'] = {
  shape: '{ id: string | number }',
  fields: [field('id', 'string | number', '待删除的当前列表记录ID')],
  empty: 'ID为空或非法时准备阶段抛错；准备阶段不发送DELETE。',
}

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', 'Portal保存或删除成功回执没有业务数据；SDK不把成功文案冒充为ID或计数')],
  empty: 'Promise完成只表示请求成功；写入结果必须通过列表回查核实。',
}

const formInputs: Record<string, AiParameter> = {
  form: param('Portal任务日志弹窗的完整表单对象。', '用户输入与当前列表行；编辑必须保留当前行id', {
    type: 'object',
    required: true,
    constraints: [
      'jobId必填且最多64个字符；status必填且最多4个字符；times必须为至少1的安全整数。',
      'beanName最多200个字符，methodName最多100个字符，params/error最多2000个字符；页面把空字段按空字符串提交。',
      '新建省略id；编辑必须传当前列表行的id，不能用jobId代替。',
    ],
  }),
}

const idInput = param('任务日志记录ID。', 'sale-schedule-job-log-list.list[].id，由用户选择一条当前可见记录', {
  type: 'string | number',
  required: true,
  constraints: ['必须是非空字符串或正整数；不能用jobId、beanName或方法名猜测。'],
})

const gaps = [
  '尚未在真实测试环境执行本页列表、查看弹窗、新建、编辑、删除及写入后的列表回查；当前证据来自Portal页面、CRM Java Controller/Entity/Service/Mapper与离线请求断言。',
]

function base (purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      `只覆盖门户系统设置/销售设置/任务管理下的“任务日志”页面${pagePath}；不是独立基础设施任务日志页面。`,
      `列表权限是${pagePermission}；新建、编辑、删除和保存按钮另受${actionPermission}控制。SDK不会根据本地权限清单猜测授权，后端拒绝原样抛出。`,
      '页面请求使用Portal crm.js实例（baseURL取VITE_CRM_API），module-type=60；接入方必须配置httpBaseUrls.crm，不能用默认platform baseUrl代替。',
      '页面点击jobId时直接把当前列表行传入只读弹窗，不调用后端详情GET；因此SDK不暴露虽存在但页面不可达的scheduleJobLog详情接口。',
      '新建和编辑都提交页面表单的完整字段到同一个save接口；删除是单条无请求体DELETE，没有批量删除入口。',
    ],
    effect,
    prerequisites: ['使用带会话token、tenantId和crm base URL的SDK；写操作的表单或ID必须来自用户明确选择/确认。'],
    inputs: {},
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? 'Promise完成只表示Portal请求成功；保存或删除后必须重新查询核实，不把空回执当业务结果。' : '返回通过结构校验的页面数据或无副作用的准备结果。',
    failures: ['非法表单、ID或分页参数在请求前失败；权限、租户、网络和后端业务错误原样抛出。', '响应缺少页面实际消费字段时抛错，不把空值伪造成成功。'],
    idempotency: effect === 'write' ? '页面接口没有requestId幂等契约；新建超时可能产生重复记录，编辑/删除超时先列表核实，不能盲目重发。' : null,
    evidence: [
      { source: 'CodeReview_Projects_Js@test/portal/main: app/portal/menus/sale.js:208-209、app/portal/views/dashboard/sale/job/schedule-job-log/list.vue、ModalFormContent.vue、common/libs/renren/list.js', kind: 'reference', note: '证明页面归属、三个筛选字段、公共order/orderField参数、CRM实例、完整表单字段、动作权限、只读查看方式、save/delete请求。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-crm/.../ScheduleJobLogVueController.java、ScheduleJobLog.java、ScheduleJobLogService.java、CrmScheduleJobLogDao.xml', kind: 'reference', note: '证明list/save/delete路由、count/list响应、Bean Validation长度规则、逻辑删除和租户/实体字段。' },
      { source: 'src/capabilities/sale-schedule-job-log.ts 与 test/sale-schedule-job-log.test.ts', kind: 'test', note: '锁定SDK请求、参数、CRM实例、module-type、表单规则和负例；不替代真实环境验证。' },
      { source: 'docs/pages/任务日志.md', kind: 'reference', note: '记录逐字段基准、页面动作、权限边界、写操作确认步骤和实测缺口。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'sale-schedule-job-log-list': {
    ...base('分页查询任务日志，按Portal公共排序参数以及Bean名称、方法名和执行结果筛选。', listOutput, ['展示jobId、beanName、methodName、status、times和createDate；打开详情时直接消费当前list[]记录。', 'total只用于翻页；需要完整结果时继续按pageNo查询，不能把当前页当全量。']),
    inputs: {
      order: param('Portal公共列表排序值。', 'Portal useListPageModule公共列表状态；页面默认空字符串且没有排序控件', { type: 'string', required: false, omitted: 'SDK发送空字符串；不要据此推断页面提供了排序交互' }),
      orderField: param('Portal公共列表排序字段。', 'Portal useListPageModule公共列表状态；页面默认空字符串且没有排序控件', { type: 'string', required: false, omitted: 'SDK发送空字符串；不要据此推断页面提供了排序交互' }),
      beanName: param('Bean名称筛选值。', '用户输入；页面默认空字符串', { type: 'string', required: false, omitted: 'SDK发送空字符串表示不筛选；后端按等值条件查询' }),
      methodName: param('方法名筛选值。', '用户输入；页面默认空字符串', { type: 'string', required: false, omitted: 'SDK发送空字符串表示不筛选；后端按等值条件查询' }),
      status: param('执行结果字典值。', 'execute_status字典选择；页面默认空字符串', { type: 'string', required: false, omitted: 'SDK发送空字符串表示不筛选；不要把字典标签代替value' }),
      pageNo: param('页码，从1开始。', '调用方分页状态', { type: 'integer', required: false, default: 'SDK默认1' }),
      pageSize: param('每页记录数。', '调用方分页状态', { type: 'integer', required: false, default: 'SDK默认20', constraints: ['接受Portal常用分页值10/20/50/100/200/500。'] }),
    },
  },
  'sale-schedule-job-log-prepare-create': {
    ...base('按Portal新建弹窗规则整理任务日志完整表单，不发送保存请求。', preparedFormOutput, ['把result.form交给sale-schedule-job-log-create；用户取消时只丢弃本地准备结果，不发送POST。'], 'prepare'),
    inputs: formInputs,
    steps: [
      { role: 'required', when: '用户明确确认新建', capabilityId: 'sale-schedule-job-log-create', mapping: { form: 'result.form' }, instruction: '提交prepare通过的同一份完整表单；新建不带id。' },
      { role: 'cancel', when: '用户取消新建', instruction: '只丢弃本地表单，不发送save请求。' },
    ],
  },
  'sale-schedule-job-log-create': {
    ...base('把用户确认的完整任务日志表单新建为一条记录。', voidOutput, ['提交前先prepareCreate并取得用户确认；成功或超时后用列表按jobId、beanName、methodName、status和times精确核对，匹配不唯一时不能猜测哪条是本次创建。'], 'write'),
    inputs: formInputs,
    steps: [{ role: 'recovery', when: '保存成功、超时或响应丢失后核实结果', capabilityId: 'sale-schedule-job-log-list', mapping: {}, instruction: '用保存前保留的jobId、beanName、methodName、status和times筛选条件分页查询并逐字段核对；不能只看HTTP成功或保存文案。' }],
  },
  'sale-schedule-job-log-prepare-update': {
    ...base('按Portal编辑弹窗规则整理当前任务日志的完整更新表单，不发送保存请求。', preparedFormOutput, ['把result.form交给sale-schedule-job-log-update；保留当前行id和所有页面表单字段，用户取消时丢弃本地结果。'], 'prepare'),
    inputs: formInputs,
    steps: [
      { role: 'required', when: '用户明确确认编辑', capabilityId: 'sale-schedule-job-log-update', mapping: { form: 'result.form' }, instruction: '提交prepare通过的同一份完整表单；编辑必须保留当前列表行id。' },
      { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃本地表单，不发送save请求。' },
    ],
  },
  'sale-schedule-job-log-update': {
    ...base('按用户确认的完整表单编辑一条已有任务日志记录。', voidOutput, ['页面使用同一个save接口；不是PATCH，调用方必须提交jobId、status、times等完整表单字段。成功或超时后按同一id回查并逐字段核对。'], 'write'),
    inputs: formInputs,
    steps: [{ role: 'recovery', when: '保存成功、超时或响应丢失后核实结果', capabilityId: 'sale-schedule-job-log-list', mapping: {}, instruction: '用保存前保留的筛选值分页找到args.form.id对应的记录，核对完整表单；找不到或字段冲突不能报告已核实。' }],
  },
  'sale-schedule-job-log-prepare-remove': {
    ...base('准备删除当前列表中选定的一条任务日志记录。', removeOutput, ['展示用户选中的记录并等待确认；确认后把result.id交给sale-schedule-job-log-remove，取消时丢弃草稿。'], 'prepare'),
    inputs: { id: idInput },
    steps: [
      { role: 'required', when: '用户明确确认删除', capabilityId: 'sale-schedule-job-log-remove', mapping: { id: 'result.id' }, instruction: '提交同一个当前列表记录ID；成功或超时后重新查询核实。' },
      { role: 'cancel', when: '用户取消删除', instruction: '丢弃删除草稿，不发送DELETE。' },
    ],
  },
  'sale-schedule-job-log-remove': {
    ...base('删除一条当前列表中选定的任务日志记录。', voidOutput, ['只能传当前列表得到的id；页面没有批量删除。成功或超时后重新list核对目标ID已不再出现；这是逻辑删除，不能解释为物理清理。'], 'write'),
    inputs: { id: idInput },
    steps: [{ role: 'recovery', when: '删除成功、超时或响应丢失后核实结果', capabilityId: 'sale-schedule-job-log-list', instruction: '按原筛选条件分页查询并核对目标ID是否消失；不能只看空回执。' }],
  },
}

export const SALE_SCHEDULE_JOB_LOG_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALE_SCHEDULE_JOB_LOG_METHODS).map(id => [id, contracts[id]!]))
export const SALE_SCHEDULE_JOB_LOG_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALE_SCHEDULE_JOB_LOG_METHODS).map(([id, method]) => [`saleScheduleJobLog.${method}`, SALE_SCHEDULE_JOB_LOG_AI_CONTRACTS[id]!]))
