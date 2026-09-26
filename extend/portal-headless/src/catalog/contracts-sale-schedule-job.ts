import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALE_SCHEDULE_JOB_METHODS } from '../capabilities/sale-schedule-job.js'

const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })

const pagePath = '/dashboard/sale/job/schedule-job/list'
const pagePermission = '/dashboard/sale/frame/job/scheduleJob'
const actionPermission = 'job:scheduleJob:edit'

const rowFields: AiField[] = [
  field('list[].id', 'string | number | null', '任务管理记录主键；删除时使用，保留字符串避免长整数精度损失', { nullable: true, nullMeaning: '没有ID不能执行按ID删除' }),
  field('list[].jobId', 'string | null', '定时任务ID；立即执行、暂停和恢复请求使用', { nullable: true, nullMeaning: '没有jobId不能执行定时任务动作' }),
  field('list[].jobName', 'string | null', '任务名称；列表模糊筛选和表单必填字段', { nullable: true }),
  field('list[].beanName', 'string | null', 'Spring Bean名称；列表模糊筛选和表单必填字段', { nullable: true }),
  field('list[].methodName', 'string | null', 'Bean方法名；列表模糊筛选和表单必填字段', { nullable: true }),
  field('list[].params', 'string | null', '任务执行参数原文', { nullable: true }),
  field('list[].cronExpression', 'string | null', 'Cron执行规则；表单必填', { nullable: true }),
  field('list[].status', 'number | null', '任务状态；0=正常，1=暂停；页面按0决定显示暂停还是恢复', { nullable: true }),
  field('list[].createDate', 'string | number | null', '创建时间原值', { nullable: true }),
  field('list[].updateDate', 'string | number | null', '更新时间原值；编辑弹窗不会把它提交回save', { nullable: true }),
  field('list[].remarks', 'string | null', '备注信息；页面表单字段名是remarks', { nullable: true }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', '任务管理分页结果；Portal响应的count已映射为total'),
    field('list', 'object[]', '当前页定时任务记录；不是全量结果'),
    field('total', 'number', '符合筛选条件的记录总数，用于分页，不是当前页长度；排序参数只影响顺序'),
    ...rowFields,
  ],
  empty: 'list=[]表示当前页没有记录；total=0才表示当前筛选无记录，权限或网络失败会抛错。',
}

const formFields: AiField[] = [
  field('form', 'object', 'Portal ModalFormContent生成的完整提交对象；SDK只保留页面实际提交的字段，不把status或日期字段带入save'),
  field('form.jobId', 'string', '定时任务ID；新建和编辑页面均要求填写，最多64个字符'),
  field('form.jobName', 'string', '任务名称；必填，最多64个字符'),
  field('form.beanName', 'string', 'Spring Bean名称；必填，最多200个字符'),
  field('form.methodName', 'string', '方法名；必填，最多100个字符'),
  field('form.params', 'string', '任务参数原文；可空，最多2000个字符'),
  field('form.cronExpression', 'string', 'Cron表达式；必填，最多100个字符'),
  field('form.remarks', 'string', '备注；可空，最多2000个字符'),
  field('form.id', 'string | number', '编辑时的当前列表记录ID；新建时省略', { optional: true, nullable: true, nullMeaning: '新建不带id；编辑缺少id会在本地拒绝' }),
]

const preparedFormOutput: AiContract['output'] = {
  shape: '{ form: object }',
  fields: formFields,
  empty: '表单规则不通过时准备阶段抛错，不发送save；成功只代表本地表单已整理。',
}

const actionOutput: AiContract['output'] = {
  shape: '{ jobId: string | number }',
  fields: [field('jobId', 'string | number', '准备执行、暂停或恢复的当前列表定时任务ID')],
  empty: 'jobId为空或非法时准备阶段抛错；准备阶段不发送POST。',
}

const statusActionOutput: AiContract['output'] = {
  shape: '{ jobId: string | number, currentStatus: 0 | 1 }',
  fields: [field('jobId', 'string | number', '准备执行状态变更的当前列表定时任务ID'), field('currentStatus', '0 | 1', '准备时核对的当前状态；0=正常，1=暂停')],
  empty: '缺少ID或状态与页面按钮不匹配时准备阶段抛错；不发送POST。',
}

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', 'Portal保存、删除和任务动作成功回执没有业务数据；SDK不把成功文案冒充为ID或状态')],
  empty: 'Promise完成只表示请求成功；保存/删除/状态动作的业务结果必须通过列表回查或任务日志核实。',
}

const formInputs: Record<string, AiParameter> = {
  form: param('Portal任务管理弹窗的完整表单对象。', '用户输入与当前列表行；编辑必须保留当前行id', {
    type: 'object',
    required: true,
    constraints: [
      'jobId、jobName、beanName、methodName、cronExpression均必填；长度上限分别为64、64、200、100、100个字符。',
      'params和remarks可空，长度上限均为2000个字符；页面按空字符串提交空字段。',
      '新建省略id；编辑必须传当前列表行id；表单没有status字段，后端新建时把任务置为暂停，编辑不通过此页面修改status。',
    ],
  }),
}

const idInput = param('任务管理记录ID。', 'sale-schedule-job-list.list[].id，由用户选择一条当前可见记录', {
  type: 'string | number',
  required: true,
  constraints: ['必须是非空字符串或正整数；不能用jobId、任务名称或Bean名称猜测。'],
})

const jobIdInput = param('定时任务ID。', 'sale-schedule-job-list.list[].jobId，由用户选择一条当前可见记录', {
  type: 'string | number',
  required: true,
  constraints: ['必须来自当前列表行；不能把任务管理记录id和jobId混用。'],
})

const statusInput = param('当前列表行的任务状态。', 'sale-schedule-job-list.list[].status', {
  type: 'integer',
  required: true,
  options: [{ label: '正常', value: 0 }, { label: '暂停', value: 1 }],
})

const gaps = [
  '尚未在真实测试环境执行本页列表、新建、编辑、删除、立即执行、暂停、恢复及写入后的列表/任务日志回查；当前证据来自Portal页面、CRM Java Controller/Entity/Service/Mapper与离线请求断言。',
]

function base (purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      `只覆盖门户系统设置/销售设置/任务管理下的“任务管理”页面${pagePath}；不是平台设置下的“定时任务”页面。`,
      `列表权限是${pagePermission}；新建、编辑、删除、立即开始、暂停、恢复和保存按钮另受${actionPermission}控制。SDK不会根据本地权限清单猜测授权，后端拒绝原样抛出。`,
      '页面请求使用Portal crm.js实例（baseURL取VITE_CRM_API），module-type=60；接入方必须配置httpBaseUrls.crm，不能用默认platform baseUrl代替。',
      '页面没有详情GET入口；编辑直接把当前列表行交给ModalFormContent，页面没有同步任务按钮，因此SDK不暴露后端虽存在的详情和syncJob接口。',
      '页面表单没有status字段；新建由CRM服务端强制初始化为暂停，状态变更只能通过页面的暂停/恢复按钮完成。',
    ],
    effect,
    prerequisites: ['使用带会话token、tenantId和crm base URL的SDK；写操作的表单、ID或当前状态必须来自用户明确选择/确认。'],
    inputs: {},
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? 'Promise完成只表示Portal请求成功；保存、删除或状态动作后必须重新查询核实，不把空回执当业务结果。' : '返回通过结构校验的页面数据或无副作用的准备结果。',
    failures: ['非法表单、ID、状态或分页参数在请求前失败；权限、租户、网络和后端业务错误原样抛出。', '响应缺少页面实际消费字段时抛错，不把空值伪造成成功。'],
    idempotency: effect === 'write' ? '页面接口没有requestId幂等契约；新建/执行超时可能已经产生副作用，保存/删除/状态动作超时先查询核实，不能盲目重发。' : null,
    evidence: [
      { source: 'CodeReview_Projects_Js@test/portal/main: app/portal/menus/sale.js:208-209、app/portal/views/dashboard/sale/job/schedule-job/list.vue、ModalFormContent.vue、common/libs/renren/list.js', kind: 'reference', note: '证明页面归属、四个筛选字段、公共order/orderField参数、CRM实例、完整表单字段、动作权限、确认按钮和请求形状。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-crm/.../ScheduleJobVueController.java、ScheduleJob.java、ScheduleJobService.java、CrmScheduleJobDao.xml', kind: 'reference', note: '证明list/save/delete/run/pause/resume路由、count/list响应、字段长度校验、状态初始化、逻辑删除和jobId动作参数。' },
      { source: 'src/capabilities/sale-schedule-job.ts 与 test/sale-schedule-job.test.ts', kind: 'test', note: '锁定SDK请求、参数、CRM实例、module-type、表单规则、状态门禁和负例；不替代真实环境验证。' },
      { source: 'docs/pages/任务管理.md', kind: 'reference', note: '记录逐字段基准、页面动作、权限边界、写操作确认步骤和实测缺口。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'sale-schedule-job-list': {
    ...base('分页查询定时任务，按任务名称、Bean名称、方法名和状态筛选。', listOutput, ['展示jobName、beanName、methodName、params、cronExpression、status和updateDate；按status=0显示正常、status=1显示暂停。', 'total只用于翻页；需要完整结果时继续按pageNo查询，不能把当前页当全量。']),
    inputs: {
      order: param('Portal公共列表排序值。', 'Portal useListPageModule公共列表状态；页面默认空字符串且没有排序控件', { type: 'string', required: false, omitted: 'SDK发送空字符串；不要据此推断页面提供了排序交互' }),
      orderField: param('Portal公共列表排序字段。', 'Portal useListPageModule公共列表状态；页面默认空字符串且没有排序控件', { type: 'string', required: false, omitted: 'SDK发送空字符串；不要据此推断页面提供了排序交互' }),
      jobName: param('任务名称筛选片段。', '用户输入；页面默认空字符串', { type: 'string', required: false, omitted: 'SDK发送空字符串表示不筛选；后端按LIKE查询' }),
      beanName: param('Spring Bean名称筛选片段。', '用户输入；页面默认空字符串', { type: 'string', required: false, omitted: 'SDK发送空字符串表示不筛选；后端按LIKE查询' }),
      methodName: param('方法名筛选片段。', '用户输入；页面默认空字符串', { type: 'string', required: false, omitted: 'SDK发送空字符串表示不筛选；后端按LIKE查询' }),
      status: param('任务状态筛选值。', 'schedule_status字典选择；页面默认空字符串', { type: 'string | number', required: false, omitted: 'SDK发送空字符串表示不筛选；0=正常、1=暂停；可以传Portal字典的字符串值或对应数字' }),
      pageNo: param('页码，从1开始。', '调用方分页状态', { type: 'integer', required: false, default: 'SDK默认1' }),
      pageSize: param('每页记录数。', '调用方分页状态', { type: 'integer', required: false, default: 'SDK默认20', constraints: ['接受Portal常用分页值10/20/50/100/200/500。'] }),
    },
  },
  'sale-schedule-job-prepare-create': {
    ...base('按Portal新建弹窗规则整理定时任务完整表单，不发送保存请求。', preparedFormOutput, ['把result.form交给sale-schedule-job-create；用户取消时只丢弃本地准备结果，不发送POST。'], 'prepare'),
    inputs: formInputs,
    steps: [
      { role: 'required', when: '用户明确确认新建', capabilityId: 'sale-schedule-job-create', mapping: { form: 'result.form' }, instruction: '提交prepare通过的同一份完整表单；新建不带id，服务端会把新任务置为暂停。' },
      { role: 'cancel', when: '用户取消新建', instruction: '只丢弃本地表单，不发送save请求。' },
    ],
  },
  'sale-schedule-job-create': {
    ...base('把用户确认的完整任务管理表单新建为一条定时任务。', voidOutput, ['提交前先prepareCreate并取得用户确认；服务端成功回执没有新ID，保存或超时后按jobName、beanName、methodName、cronExpression筛选并逐字段核对，匹配不唯一时不能猜测哪条是本次创建。'], 'write'),
    inputs: formInputs,
    steps: [{ role: 'recovery', when: '保存成功、超时或响应丢失后核实结果', capabilityId: 'sale-schedule-job-list', mapping: {}, instruction: '用保存前保留的jobName、beanName、methodName和cronExpression筛选并分页核对；同时确认新记录status=1暂停，不能只看HTTP成功或保存文案。' }],
  },
  'sale-schedule-job-prepare-update': {
    ...base('按Portal编辑弹窗规则整理当前定时任务的完整更新表单，不发送保存请求。', preparedFormOutput, ['把result.form交给sale-schedule-job-update；保留当前行id和页面表单字段，用户取消时丢弃本地结果。'], 'prepare'),
    inputs: formInputs,
    steps: [
      { role: 'required', when: '用户明确确认编辑', capabilityId: 'sale-schedule-job-update', mapping: { form: 'result.form' }, instruction: '提交prepare通过的同一份完整表单；编辑必须保留当前列表行id，页面不通过save修改status。' },
      { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃本地表单，不发送save请求。' },
    ],
  },
  'sale-schedule-job-update': {
    ...base('按用户确认的完整表单编辑一条已有定时任务。', voidOutput, ['页面使用同一个save接口；不是PATCH，调用方必须提交jobId、jobName、beanName、methodName、cronExpression等完整表单字段。成功或超时后按同一id回查。'], 'write'),
    inputs: formInputs,
    steps: [{ role: 'recovery', when: '保存成功、超时或响应丢失后核实结果', capabilityId: 'sale-schedule-job-list', mapping: {}, instruction: '按原筛选条件分页找到args.form.id对应记录，核对完整表单；找不到或字段冲突不能报告已核实。' }],
  },
  'sale-schedule-job-prepare-remove': {
    ...base('准备删除当前列表中选定的一条定时任务。', { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待删除的当前列表记录ID')], empty: 'ID非法时准备阶段抛错；不发送DELETE。' }, ['展示用户选中的记录并等待确认；确认后把result.id交给sale-schedule-job-remove，取消时丢弃草稿。'], 'prepare'),
    inputs: { id: idInput },
    steps: [
      { role: 'required', when: '用户明确确认删除', capabilityId: 'sale-schedule-job-remove', mapping: { id: 'result.id' }, instruction: '提交同一个当前列表记录ID；成功或超时后重新查询核实。' },
      { role: 'cancel', when: '用户取消删除', instruction: '丢弃删除草稿，不发送DELETE。' },
    ],
  },
  'sale-schedule-job-remove': {
    ...base('删除一条当前列表中选定的定时任务。', voidOutput, ['只能传当前列表得到的id；页面没有批量删除。成功或超时后重新list核对目标ID已不再出现；后端删除是逻辑删除并会同步删除调度器任务。'], 'write'),
    inputs: { id: idInput },
    steps: [{ role: 'recovery', when: '删除成功、超时或响应丢失后核实结果', capabilityId: 'sale-schedule-job-list', instruction: '按原筛选条件分页查询并核对目标ID是否消失；不能只看空回执。' }],
  },
  'sale-schedule-job-prepare-run': {
    ...base('准备立即执行当前列表选定的定时任务。', actionOutput, ['展示当前任务并等待确认；确认后把result.jobId交给sale-schedule-job-run，取消时不发送POST。'], 'prepare'),
    inputs: { jobId: jobIdInput },
    steps: [
      { role: 'required', when: '用户明确确认立即执行', capabilityId: 'sale-schedule-job-run', mapping: { jobId: 'result.jobId' }, instruction: '提交同一当前列表jobId；响应成功只代表服务端接受执行请求。' },
      { role: 'cancel', when: '用户取消立即执行', instruction: '丢弃执行草稿，不发送POST。' },
    ],
  },
  'sale-schedule-job-run': {
    ...base('立即执行一条当前列表中的定时任务。', voidOutput, ['页面请求成功只提示任务已开始；执行没有独立业务结果，必要时用任务日志页面按jobId回查执行记录。'], 'write'),
    inputs: { jobId: jobIdInput },
    steps: [{ role: 'recovery', when: '执行成功、超时或响应丢失后核实结果', capabilityId: 'sale-schedule-job-list', mapping: {}, instruction: '先按jobId重新读取任务确认目标仍存在；业务执行结果需由任务日志或任务自身业务查询核实，不能只看空回执。' }],
  },
  'sale-schedule-job-prepare-pause': {
    ...base('按Portal暂停按钮的状态门禁准备一条定时任务暂停请求。', statusActionOutput, ['只有当前列表行status=0正常时页面才显示暂停按钮；把result交给sale-schedule-job-pause，用户取消时不发送POST。'], 'prepare'),
    inputs: { jobId: jobIdInput, currentStatus: statusInput },
    steps: [
      { role: 'required', when: '用户明确确认暂停', capabilityId: 'sale-schedule-job-pause', mapping: { jobId: 'result.jobId', currentStatus: 'result.currentStatus' }, instruction: '提交同一jobId和prepare核对的currentStatus=0；不要把暂停写成toggle。' },
      { role: 'cancel', when: '用户取消暂停', instruction: '丢弃状态草稿，不发送POST。' },
    ],
  },
  'sale-schedule-job-pause': {
    ...base('把一条当前正常运行的定时任务暂停。', voidOutput, ['请求只发送jobId，后端把任务状态写为1暂停；成功或超时后重新list按jobId核对status=1。'], 'write'),
    inputs: { jobId: jobIdInput, currentStatus: statusInput },
    steps: [{ role: 'recovery', when: '暂停成功、超时或响应丢失后核实结果', capabilityId: 'sale-schedule-job-list', mapping: {}, instruction: '按jobId回查并确认status=1；没有回查证据不能报告已暂停。' }],
  },
  'sale-schedule-job-prepare-resume': {
    ...base('按Portal恢复按钮的状态门禁准备一条定时任务恢复请求。', statusActionOutput, ['只有当前列表行status=1暂停时页面才按else显示恢复按钮；把result交给sale-schedule-job-resume，用户取消时不发送POST。'], 'prepare'),
    inputs: { jobId: jobIdInput, currentStatus: statusInput },
    steps: [
      { role: 'required', when: '用户明确确认恢复', capabilityId: 'sale-schedule-job-resume', mapping: { jobId: 'result.jobId', currentStatus: 'result.currentStatus' }, instruction: '提交同一jobId和prepare核对的currentStatus=1；不要把恢复写成toggle。' },
      { role: 'cancel', when: '用户取消恢复', instruction: '丢弃状态草稿，不发送POST。' },
    ],
  },
  'sale-schedule-job-resume': {
    ...base('把一条当前暂停的定时任务恢复为正常运行。', voidOutput, ['请求只发送jobId，后端把任务状态写为0正常；成功或超时后重新list按jobId核对status=0。'], 'write'),
    inputs: { jobId: jobIdInput, currentStatus: statusInput },
    steps: [{ role: 'recovery', when: '恢复成功、超时或响应丢失后核实结果', capabilityId: 'sale-schedule-job-list', mapping: {}, instruction: '按jobId回查并确认status=0；没有回查证据不能报告已恢复。' }],
  },
}

export const SALE_SCHEDULE_JOB_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALE_SCHEDULE_JOB_METHODS).map(id => [id, contracts[id]!]))
export const SALE_SCHEDULE_JOB_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALE_SCHEDULE_JOB_METHODS).map(([id, method]) => [`saleScheduleJob.${method}`, SALE_SCHEDULE_JOB_AI_CONTRACTS[id]!]))
