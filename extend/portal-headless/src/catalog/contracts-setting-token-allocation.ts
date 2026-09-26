import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SETTING_TOKEN_ALLOCATION_METHODS, settingTokenAllocationCapabilities } from '../capabilities/setting-token-allocation.js'

const definitions = new Map(settingTokenAllocationCapabilities.map(definition => [definition.id, definition]))

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const pageFields = (rowFields: AiField[], empty: string): AiContract['output'] => ({
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页记录数组；数组元素的字段见list[].*说明'), field('total', 'number', '符合当前筛选条件的总条数，不是当前页长度'), ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty,
})

const overviewFields: AiField[] = [
  field('tenantTotalQuota', 'number | string | null', '当前租户该模型可分配的总额度；原值返回，不做单位换算', { nullable: true, nullMeaning: '后端未返回租户总额度' }),
  field('tenantUserCount', 'number | string | null', '当前租户用户数', { nullable: true, nullMeaning: '后端未返回用户数' }),
  field('averageQuota', 'number | string | null', '平均分配额度；非平均分配时可能为空', { nullable: true, nullMeaning: '当前分配方式没有平均基础额度' }),
  field('adjustedUserCount', 'number | string | null', '存在指定用户调整的用户数', { nullable: true, nullMeaning: '后端未返回调整人数' }),
  field('unadjustedUserCount', 'number | string | null', '未被指定调整、会继承平均额度的用户数', { nullable: true, nullMeaning: '后端未返回未调整人数' }),
  field('allocatedQuota', 'number | string | null', '当前已分配额度总量', { nullable: true, nullMeaning: '后端未返回已分配总量' }),
  field('remainingQuota', 'number | string | null', '租户总额度扣除当前已分配额度后的剩余量', { nullable: true, nullMeaning: '后端未返回剩余量' }),
  field('exceeded', 'boolean | null', '预览或概览是否超过租户总额度', { nullable: true, nullMeaning: '后端未返回超额标记' }),
  field('allocationMethod', 'integer | null', '分配方式；0未分配、1平均分配、2指定用户分配', { nullable: true, values: { '0': '未分配', '1': '平均分配', '2': '指定用户分配' } }),
  field('allocationMethodName', 'string | null', '分配方式显示名', { nullable: true, nullMeaning: '后端未返回显示名' }),
  field('overLimitStrategy', 'integer | null', '超额策略；0继承全局、1禁止使用、2仅提醒。保存平均/用户分配时Java服务只接受1/2；预览和导入按Portal请求保留0', { nullable: true, values: { '0': '继承全局', '1': '禁止使用', '2': '仅提醒' } }),
  field('overLimitStrategyName', 'string | null', '超额策略显示名', { nullable: true, nullMeaning: '后端未返回显示名' }),
  field('startTime', 'string | null', '分配生效时间；原始LocalDateTime字符串', { nullable: true, nullMeaning: '未设置生效时间' }),
  field('endTime', 'string | null', '分配结束时间；原始LocalDateTime字符串', { nullable: true, nullMeaning: '无结束时间或后端未返回' }),
  field('reason', 'string | null', '分配原因', { nullable: true, nullMeaning: '未填写原因' }),
]

const effectiveRowFields: AiField[] = [
  field('id', 'string | number | null', '指定用户分配记录ID；平均继承行可能为空', { optional: true, nullable: true, nullMeaning: '该行没有可直接清空的指定分配记录' }),
  field('modelId', 'string | number | null', '模型ID', { nullable: true, nullMeaning: '后端未返回模型ID' }),
  field('userId', 'string | number | null', '租户用户ID；编辑用户分配和申请去分配时使用', { nullable: true, nullMeaning: '后端未返回用户ID' }),
  field('userPhone', 'string | null', '用户手机号；导入/保存用户分配的后端关联键', { nullable: true, nullMeaning: '用户没有手机号或后端未返回' }),
  field('userName', 'string | null', '用户名称', { nullable: true, nullMeaning: '后端未返回用户名称' }),
  field('allocationMethod', 'integer | null', '该用户实际有效的分配方式；0未分配、1平均继承、2指定用户', { nullable: true, values: { '0': '未分配', '1': '平均分配', '2': '指定用户分配' } }),
  field('allocationMethodName', 'string | null', '该用户分配方式显示名', { nullable: true, nullMeaning: '后端未返回显示名' }),
  field('allocatedQuota', 'number | string | null', '该用户有效分配额度', { nullable: true, nullMeaning: '未分配或后端未计算' }),
  field('usedQuota', 'number | string | null', '该用户已使用额度', { nullable: true, nullMeaning: '后端未计算用量' }),
  field('remainingQuota', 'number | string | null', '该用户剩余额度', { nullable: true, nullMeaning: '后端未计算剩余量' }),
  field('usageStatus', 'integer | null', '额度使用状态；按Java usage status原值消费', { nullable: true, nullMeaning: '后端未返回状态' }),
  field('usageStatusName', 'string | null', '额度使用状态显示名', { nullable: true, nullMeaning: '后端未返回显示名' }),
  field('overLimitStrategy', 'integer | null', '该用户有效超额策略；0继承全局、1禁止、2提醒；0可能来自Portal导入或历史数据', { nullable: true, values: { '0': '继承全局', '1': '禁止使用', '2': '仅提醒' }, nullMeaning: '后端未返回策略' }),
  field('overLimitStrategyName', 'string | null', '超额策略显示名', { nullable: true, nullMeaning: '后端未返回显示名' }),
  field('startTime', 'string | null', '该用户分配生效时间', { nullable: true, nullMeaning: '未设置或后端未返回' }),
  field('endTime', 'string | null', '该用户分配结束时间', { nullable: true, nullMeaning: '无结束时间或后端未返回' }),
  field('reason', 'string | null', '该用户分配原因', { nullable: true, nullMeaning: '未填写原因' }),
]

const applyRowFields: AiField[] = [
  field('id', 'string | number | null', '申请记录ID；处理申请时使用', { nullable: true, nullMeaning: '后端未返回主键' }),
  field('modelId', 'string | number | null', '申请模型ID', { nullable: true, nullMeaning: '后端未返回模型ID' }),
  field('modelName', 'string | null', '申请模型名称', { nullable: true, nullMeaning: '后端未返回模型名称' }),
  field('userId', 'string | number | null', '申请用户ID；去分配时写入用户分配草稿', { nullable: true, nullMeaning: '后端未返回用户ID' }),
  field('userPhone', 'string | null', '申请用户手机号；去分配时必须作为save-user的userPhone', { nullable: true, nullMeaning: '后端未返回手机号' }),
  field('userName', 'string | null', '申请用户名称', { nullable: true, nullMeaning: '后端未返回用户名称' }),
  field('currentMonthlyQuota', 'number | string | null', '申请时当前月度额度快照', { nullable: true, nullMeaning: '没有当前额度快照' }),
  field('expectedMonthlyQuota', 'number | string | null', '申请的期望月度额度；去分配时映射为allocatedQuota', { nullable: true, nullMeaning: '申请未填写期望额度' }),
  field('currentMaxToken', 'number | string | null', '申请时当前单次最大Token快照', { nullable: true, nullMeaning: '没有当前最大Token快照' }),
  field('expectedMaxToken', 'number | string | null', '申请的期望单次最大Token', { nullable: true, nullMeaning: '申请未填写' }),
  field('reason', 'string | null', '申请原因', { nullable: true, nullMeaning: '未填写原因' }),
  field('rejectReason', 'string | null', '驳回原因', { nullable: true, nullMeaning: '申请未被驳回或后端未返回' }),
  field('status', 'integer | null', '申请状态；页面筛选保留0待处理、1已忽略、2已填写、3已驳回、4已处理', { nullable: true, values: { '0': '待处理', '1': '已忽略', '2': '已填写', '3': '已驳回', '4': '已处理' } }),
  field('statusName', 'string | null', '申请状态显示名', { nullable: true, nullMeaning: '后端未返回显示名' }),
  field('handlerName', 'string | null', '处理人名称', { nullable: true, nullMeaning: '尚未处理或后端未返回' }),
  field('handledTime', 'string | null', '处理时间', { nullable: true, nullMeaning: '尚未处理或后端未返回' }),
]

const userOptionFields: AiField[] = [
  field('id', 'string | number | null', '用户ID；保存用户分配时映射为userId', { nullable: true, nullMeaning: '候选缺少ID时不能提交该用户' }),
  field('mobile', 'string | null', '用户手机号；保存用户分配时映射为userPhone', { nullable: true, nullMeaning: '候选没有手机号，后端save-user会拒绝' }),
  field('realName', 'string | null', '用户真实姓名；保存用户分配时映射为userName', { nullable: true, nullMeaning: '候选没有姓名' }),
]

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@app/portal/menus/common.js、app/portal/views/dashboard/common/setting/token-allocation/list.vue、api.js、utils.js、components/AllocationSettings.vue、UserAllocationTable.vue、UserAllocationModal.vue、ApplyRecordModal.vue、composables/useAllocationOverview.js、useUserAllocationList.js、useTokenAllocationModals.js @ acab69acc7 (test/portal/main)',
    kind: 'reference',
    note: '逐页核对菜单权限、platform实例、模型候选、概览、分配设置、批量导入、用户分配、清空、申请记录和按钮权限；请求体以utils.js实际构造为准。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@AiTokenAllocationController、AiTokenQuotaUsageController、AiTokenQuotaApplyController、HrSysUserController及AiTokenAllocation*ReqVO/RespVO、AiTokenQuotaApply*VO、AiTokenManagementServiceImpl @ 0f1a55718eb (test/test)',
    kind: 'reference',
    note: '核对参数校验、额度总量/时间/策略规则、导入全量校验与替换语义、返回字段、处理状态和显式权限注解。',
  },
  {
    source: 'src/capabilities/setting-token-allocation.ts 与 test/setting-token-allocation.test.ts',
    kind: 'implementation',
    note: '证明SDK请求形状、表单校验、multipart文件封装、错误传播、Portal/Java反证和AI契约结构检查；不替代真实环境调用。',
  },
]

const boundaries = [
  '只覆盖 Portal 菜单可达的 /dashboard/setting/token-allocation/list 页面及其实际打开的分配设置、用户分配、导入结果和申请记录弹窗；不发布后端存在但页面没有入口的allocation/page或其他生产模块能力。',
  '页面所有请求使用platform实例；该页面路径没有module-type推导结果，SDK不发送module-type。租户、会话token和权限由绑定会话决定，modelId/userId不能切换租户。',
  '页面的overLimitStrategy下拉展示0继承全局、1禁止使用、2仅提醒；Java save-average/save-user服务明确校验只接受1/2，SDK对这两个真实保存能力拒绝0；preview VO未校验策略枚举，import接口只校验非空且服务不再校验，SDK按Portal允许preview/import提交0，并如实保留后端可能返回的未知策略名。',
  'Portal申请筛选展示0/1/2/3/4并原样查询；当前Java处理VO/枚举实际只接受0/3/4，SDK的listApply保留页面筛选值，handleApply只允许3驳回或4已处理，并记录该前后端差异。',
  '页面批量平均分配和预览始终传adjustments:[]；SDK拒绝非空调整数组，逐用户调整应通过用户分配表单逐条完成。',
]

const gaps = [
  '尚未在真实测试环境打开该页面执行读取、无权限和跨租户矩阵；当前证据是固定检出源码、Java源码和离线request stub。',
  '尚未对真实Excel模板执行浏览器下载、上传并回查有效分配列表；导入的全量校验、失败不写入和成功替换语义来自Java服务源码。',
]

function inputsOf (id: string, overrides: Record<string, AiParameter> = {}): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`用量分配AI契约缺少能力定义: ${id}`)
  const inputs: Record<string, AiParameter> = {}
  for (const item of definition.params) {
    const type = item.kind === 'number' ? 'number' : item.kind === 'date' ? 'string[] | null' : item.kind === 'enum' ? 'number | string | null' : item.kind === 'search' ? 'string' : 'string'
    inputs[item.name] = param(item.description ?? `${item.name}按Portal页面规则填写`, 'Portal用量分配页面表单或前一能力返回值', { type, required: item.required })
  }
  return { ...inputs, ...overrides }
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '后端成功回执；SDK只有收到布尔true才返回成功')],
  empty: '没有true或请求抛错都不能报告操作成功；写操作成功或超时后应重新查询页面结果确认。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName: string, contentType: string, base64: string, byteLength: number }',
  fields: [
    field('fileName', 'string', '响应或上传文件名；可用于保存模板/导入文件'),
    field('contentType', 'string', '文件MIME类型；模板默认为application/vnd.ms-excel'),
    field('base64', 'string', '文件二进制内容的标准Base64；只用于文件保存或再次提交'),
    field('byteLength', 'number', '原始文件字节数；0字节会被视为失败'),
  ],
  empty: '空文件会抛错；不能把空Base64当作模板下载成功。',
}

const contracts: Record<string, AiContract> = {}

function add (id: string, value: Omit<AiContract, 'inputs'> & { inputs?: Record<string, AiParameter> }): void {
  if (!definitions.has(id)) throw new Error(`用量分配AI契约没有对应能力: ${id}`)
  contracts[id] = { ...value, inputs: { ...inputsOf(id), ...(value.inputs ?? {}) } }
}

function common (id: string, purpose: string, effect: AiContract['effect'], output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): void {
  add(id, {
    purpose,
    whenToUse: purpose,
    boundaries,
    effect,
    prerequisites: ['使用当前用户、当前租户的有效Portal会话；页面按钮权限仍由调用方按说明判断，空列表不能解释为无权限。'],
    output,
    consume,
    steps: [],
    completion: '返回值符合本能力契约；读取能力交付查询结果，写入能力还需按后续步骤回查。',
    failures: ['参数校验、权限不足、租户范围、网络错误、Java业务校验或响应结构错误原样抛出；SDK不把错误降级为空结果或假成功。'],
    idempotency: effect === 'write' ? '后端没有本页专用requestId幂等协议；响应超时先回查对应列表/概览，未确认前不要盲目重试。' : null,
    evidence,
    gaps,
    ...extra,
  })
}

common('setting-token-allocation-model-list', '读取页面初始化使用的模型候选分页。', 'read', pageFields([
  field('modelId', 'string | number | null', '模型ID；后续所有分配查询和写入的modelId来源', { nullable: true, nullMeaning: '该候选不能被选中' }),
  field('modelName', 'string | null', '模型名称；Portal以此显示候选标签', { nullable: true, nullMeaning: '页面回退显示模型ID' }),
], 'list=[]且total=0表示当前会话没有可见模型；响应错误不能伪装为空候选。'), [
  '从list[].modelId和list[].modelName建立候选；Portal初次请求固定pageNo=1、pageSize=100并选中第一项。',
])

common('setting-token-allocation-overview', '读取选定模型的租户用量分配概览。', 'read', { shape: 'object', fields: overviewFields, empty: '必须返回对象；缺少对象或请求失败会抛错，不返回默认空概览。' }, [
  '使用tenantTotalQuota、allocatedQuota、remainingQuota和exceeded判断额度是否足够；使用allocationMethod/name和overLimitStrategy/name展示当前规则。',
  '将返回的overLimitStrategy作为用户保存表单默认策略时，提交前仍需确认它是1或2；预览和Portal导入请求可以保留0继承全局。',
])

common('setting-token-allocation-prepare-preview', '在不写入后端的前提下校验并构造Portal分配预览草稿。', 'prepare', { shape: '{ draft: object, payload: object }', fields: [field('draft', 'object', '可提交给preview的规范化草稿'), field('draft.modelId', 'string | number', '模型ID'), field('draft.allocationMethod', 'integer', '0未分配、1平均、2指定用户'), field('draft.averageQuota', 'number | string', '平均分配额度；方式1必填', { optional: true }), field('draft.overLimitStrategy', 'integer', '0继承全局、1禁止或2提醒', { optional: true, values: { '0': '继承全局', '1': '禁止使用', '2': '仅提醒' } }), field('draft.startTime', 'string', '生效时间', { optional: true }), field('draft.endTime', 'string', '结束时间', { optional: true }), field('draft.reason', 'string', '原因，最多500字符'), field('draft.adjustments', 'object[]', '页面固定为空数组'), field('payload', 'object', '与Portal preview请求体一致的对象')], empty: '校验失败没有草稿。' }, [
  '平均分配方式必须补averageQuota；方式0/2可不填averageQuota。预览策略可以是0继承全局、1禁止或2提醒，也可以留空；时间可留空，传入时必须是YYYY-MM-DD HH:mm:ss且结束时间晚于开始时间。',
], { inputs: { formState: param('分配设置表单对象；页面实际把它与modelId、allocationMethod组合，并固定adjustments为空数组。', 'Portal AllocationSettings 表单', { type: 'object', required: true }) } })

common('setting-token-allocation-preview', '提交分配预览请求，计算不会写入后端的额度分配结果。', 'read', { shape: 'object', fields: overviewFields, empty: '必须返回概览对象；exceeded=true是业务预警，不是请求失败。' }, [
  '先调用preparePreview，再把draft交给preview；读取exceeded决定是否提示“分配额度已超过租户总额度”。',
  '预览返回的allocatedQuota、remainingQuota和allocationMethod只代表预览，不代表save-average或save-user已经成功。',
], { inputs: { draft: param('preparePreview返回的draft；不要自行删除adjustments或把payload当作draft。', 'setting-token-allocation-prepare-preview.draft', { type: 'object', required: true }) }, steps: [{ role: 'required', when: '需要从表单判断租户额度是否超限时', capabilityId: 'setting-token-allocation-prepare-preview', instruction: '先构造并校验页面草稿，再把返回的draft交给本能力；不得把预览成功报告为保存成功。' }] })

common('setting-token-allocation-prepare-save-average', '校验并构造平均分配保存草稿。', 'prepare', { shape: '{ draft: object, payload: object }', fields: [field('draft', 'object', '可提交给saveAverage的草稿'), field('draft.modelId', 'string | number', '模型ID'), field('draft.averageQuota', 'number | string', '大于0的整数平均额度'), field('draft.overLimitStrategy', 'integer', '1禁止或2提醒'), field('draft.startTime', 'string', '必填生效时间'), field('draft.endTime', 'string', '可选结束时间', { optional: true }), field('draft.reason', 'string', '原因，最多500字符'), field('draft.adjustments', 'object[]', '页面固定为空数组'), field('payload', 'object', '与Portal save-average请求体一致的对象')], empty: '校验失败没有保存草稿。' }, [
  '平均额度必须是大于0的整数；startTime必填，endTime有值时必须晚于startTime；Java save-average拒绝策略0继承全局，保存草稿只能使用1或2。',
], { inputs: { formState: param('平均分配表单对象；页面保存时固定adjustments为空数组。', 'Portal AllocationSettings 表单', { type: 'object', required: true }) } })

common('setting-token-allocation-save-average', '保存选定模型的平均分配规则。', 'write', trueOutput, [
  '成功只表示后端接受保存；重新调用overview和listEffective核对分配方式、额度、策略和用户有效行。',
], { inputs: { draft: param('prepareSaveAverage返回的draft；同一模型的平均基础规则和页面可见的指定调整由后端重建。', 'setting-token-allocation-prepare-save-average.draft', { type: 'object', required: true }) }, steps: [{ role: 'required', when: 'saveAverage返回true后或响应超时', capabilityId: 'setting-token-allocation-overview', instruction: '回查同一modelId的概览；再按需要回查effective-list，确认实际分配结果。' }, { role: 'cancel', when: '用户在提交前取消', instruction: '丢弃prepareSaveAverage返回的本地draft，不调用保存接口；后端没有该操作的撤销接口。' }] })

common('setting-token-allocation-download-template', '下载Portal用于用户额度分配导入的Excel模板。', 'read', fileOutput, [
  '将base64解码后按fileName保存；模板列是手机号、用户名称、分配额度、调整原因。',
])

common('setting-token-allocation-prepare-import', '校验导入表单和文件并生成待提交草稿。', 'prepare', { shape: '{ draft: object, file: object }', fields: [field('draft', 'object', '导入的multipart文本字段'), field('draft.modelId', 'string | number', '模型ID'), field('draft.overLimitStrategy', 'integer', '0继承全局、1禁止或2提醒；Portal和Java导入接口允许非空0，但0的策略名可能为空'), field('draft.startTime', 'string', '必填生效时间'), field('draft.endTime', 'string', '可选结束时间', { optional: true }), field('draft.reason', 'string', '批量原因，最多500字符'), field('file', 'object', '文件预览'), field('file.fileName', 'string', '上传文件名'), field('file.contentType', 'string', '文件MIME类型'), field('file.byteLength', 'number', '文件字节数')], empty: '文件为空、扩展名不支持、Base64非法或表单校验失败时没有提交草稿。' }, [
  '文件只支持.xls/.xlsx；后端按手机号匹配当前租户用户，导入行的分配额度必须是正数且手机号不能重复；策略按Portal允许0/1/2，Java导入服务未做1/2枚举校验。',
], { inputs: { file: param('Excel文件输入；SDK只在prepare阶段读取Base64，不向外泄露会话凭据。', '调用方文件内容', { type: 'object', required: true }) } })

common('setting-token-allocation-import', '按Portal multipart规则导入用户额度分配。', 'write', { shape: '{ totalCount: number, successCount: number, failureCount: number, failureMessages: string[] }', fields: [field('totalCount', 'number', '导入数据行总数'), field('successCount', 'number', '成功处理行数；后端任一失败时可能为0'), field('failureCount', 'number', '失败行数'), field('failureMessages', 'string[]', '逐行失败原因；行号由后端按Excel数据行报告')], empty: '失败列表不是空数组时不能报告导入成功；SDK会返回后端结果，失败业务不会被改写为异常成功。' }, [
  '先调用prepareImport，再以同一draft和原始file提交；成功后重新查询overview/effective-list。',
  '后端导入是全量校验：任一行失败则不写入；全部成功时会替换该模型的用户分配，行级reason非空时覆盖批量reason。',
], { inputs: { draft: param('prepareImport返回的导入表单草稿。', 'setting-token-allocation-prepare-import.draft', { type: 'object', required: true }), file: param('prepareImport使用的原始Excel文件输入。', '调用方保存的原始文件输入', { type: 'object', required: true }) }, steps: [{ role: 'required', when: '导入返回结果或响应超时', capabilityId: 'setting-token-allocation-effective-list', instruction: '按同一modelId回查有效分配；failureCount>0时不要把任何成功行当作已经写入，需根据failureMessages处理文件。' }] })

common('setting-token-allocation-effective-list', '查询选定模型当前租户每个用户的有效分配结果。', 'read', pageFields(effectiveRowFields, 'list=[]表示当前筛选没有有效用户行；权限、网络或响应错误会抛出。'), [
  '用userId、userPhone和userName识别用户；用allocatedQuota、usedQuota、remainingQuota和usageStatus展示用量；只有有id的指定分配行才可执行clearUser。',
  '平均规则下未被调整的用户仍会出现在有效结果中，allocationMethod=1；未分配用户可能是0额度行，不能把空页与0额度混淆。',
])

common('setting-token-allocation-prepare-save-user', '校验并构造单个用户分配保存草稿。', 'prepare', { shape: '{ draft: object, payload: object }', fields: [field('draft', 'object', '可提交给saveUser的草稿'), field('draft.id', 'string | number', '编辑时的分配记录ID', { optional: true }), field('draft.modelId', 'string | number', '模型ID'), field('draft.userId', 'string | number', '用户ID'), field('draft.userPhone', 'string', '手机号；后端必填'), field('draft.userName', 'string', '用户名称'), field('draft.allocatedQuota', 'number | string', '大于0的整数额度'), field('draft.overLimitStrategy', 'integer', '1禁止或2提醒'), field('draft.startTime', 'string', '必填生效时间'), field('draft.endTime', 'string', '可选结束时间', { optional: true }), field('draft.reason', 'string', '原因，最多500字符'), field('payload', 'object', '与Portal save-user请求体一致的对象')], empty: '校验失败没有用户保存草稿。' }, [
  'userId、userPhone、allocatedQuota、策略和startTime都是Java保存接口的必填项；Portal表单未对userPhone写显式规则，但候选mobile为空时后端会拒绝。',
], { inputs: { formState: param('用户分配表单；userId来自keyword用户搜索，userPhone来自候选mobile，userName来自候选realName。', 'Portal UserAllocationModal 表单和候选用户', { type: 'object', required: true }) } })

common('setting-token-allocation-save-user', '保存或更新单个用户的指定用量分配。', 'write', { shape: 'string | number', fields: [field('$', 'string | number', '后端返回的分配记录ID；Long可能序列化为字符串')], empty: '没有合法ID不能报告保存成功。' }, [
  '成功后按modelId回查effective-list；如果是从申请记录“去分配”进入，保存成功后再用申请id/status=4调用handleApply。',
], { inputs: { draft: param('prepareSaveUser返回的草稿；有id为编辑，无id由后端按模型和手机号创建/更新。', 'setting-token-allocation-prepare-save-user.draft', { type: 'object', required: true }) }, steps: [{ role: 'required', when: '该保存来自待处理申请的“去分配”操作', capabilityId: 'setting-token-allocation-handle-apply', instruction: 'saveUser成功后用原申请id提交status=4；只有两个请求都成功才能报告申请已处理。' }, { role: 'required', when: 'saveUser返回true或响应超时', capabilityId: 'setting-token-allocation-effective-list', instruction: '回查同一modelId和用户，确认allocatedQuota、策略和时间。' }] })

common('setting-token-allocation-prepare-clear-user', '准备清空一条指定用户分配记录，只做ID校验，不访问后端。', 'prepare', { shape: '{ draft: { id: string | number } }', fields: [field('draft', 'object', '待确认的清空草稿'), field('draft.id', 'string | number', '有效分配行的allocation id')], empty: 'ID非法时没有清空草稿。' }, ['用户确认后才把draft交给clearUser；取消时丢弃本地draft。'])
common('setting-token-allocation-clear-user', '清空一条指定用户分配记录。', 'write', trueOutput, ['成功或超时后按同一modelId回查effective-list，确认目标用户已回到平均继承或未分配状态。'], { inputs: { draft: param('prepareClearUser返回的清空草稿；必须先由用户确认。', 'setting-token-allocation-prepare-clear-user.draft', { type: 'object', required: true }) }, steps: [{ role: 'cancel', when: '用户在确认前取消', instruction: '丢弃本地清空草稿；后端没有清空操作的撤销接口。' }] })

common('setting-token-allocation-prepare-clear-all', '准备清空一个模型的所有用户指定分配，只做modelId校验。', 'prepare', { shape: '{ draft: { modelId: string | number } }', fields: [field('draft', 'object', '待确认的清空草稿'), field('draft.modelId', 'string | number', '模型ID')], empty: '模型ID非法时没有清空草稿。' }, ['该动作范围是一个模型下所有用户指定分配；用户确认前只保存本地草稿。'])
common('setting-token-allocation-clear-all', '清空一个模型的所有用户指定分配。', 'write', trueOutput, ['成功或超时后重新查询overview/effective-list；Java clear-by-model保留平均基础规则，只删除用户指定分配。'], { inputs: { draft: param('prepareClearAll返回的清空草稿；必须先由用户确认。', 'setting-token-allocation-prepare-clear-all.draft', { type: 'object', required: true }) }, steps: [{ role: 'cancel', when: '用户在确认前取消', instruction: '丢弃本地清空草稿；后端没有清空操作的撤销接口。' }] })

common('setting-token-allocation-apply-list', '查询当前模型的用量分配申请记录。', 'read', pageFields(applyRowFields, 'list=[]表示当前筛选没有申请；权限、网络或响应错误会抛出。'), [
  '按statusName展示状态，按expectedMonthlyQuota等字段理解申请内容；去分配动作需要把id、userId、userPhone、userName、expectedMonthlyQuota映射到saveUser。',
  'Portal筛选允许status=1/2，但当前Java查询枚举与处理枚举存在差异；SDK只保证按页面原样查询，不保证旧后端能接受这些筛选值。',
])

common('setting-token-allocation-prepare-handle-apply', '校验并构造申请驳回或已处理草稿。', 'prepare', { shape: '{ draft: object }', fields: [field('draft', 'object', '可提交给handleApply的草稿'), field('draft.id', 'string | number', '申请ID'), field('draft.status', 'integer', '3驳回或4已处理'), field('draft.rejectReason', 'string', '驳回原因，最多500字符', { optional: true })], empty: '状态或ID非法时没有处理草稿。' }, ['Portal去分配链路先saveUser，再以原申请ID和status=4处理；驳回时status=3并可带rejectReason。'])

common('setting-token-allocation-handle-apply', '处理一条用量分配申请为驳回或已处理。', 'write', trueOutput, ['成功后重新查询apply-list和pending-count；status=3时核对rejectReason，status=4时核对handlerName/handledTime。'], { inputs: { draft: param('prepareHandleApply返回的申请处理草稿；status只能为3或4。', 'setting-token-allocation-prepare-handle-apply.draft', { type: 'object', required: true }) }, steps: [{ role: 'required', when: 'handleApply返回true或响应超时', capabilityId: 'setting-token-allocation-apply-list', instruction: '以同一modelId和申请ID回查状态，只有回查确认后才报告申请完成。' }] })

common('setting-token-allocation-pending-count', '查询当前模型待处理申请数量，用于页面申请记录角标。', 'read', { shape: 'number', fields: [field('$', 'number', '待处理申请数；非负整数')], empty: '返回0表示没有待处理申请；请求错误不会降级为0。' }, ['只把结果用于角标或待处理分支判断；0不是权限成功的证明。'])

common('setting-token-allocation-user-search', '按关键词分页查询可用于用户分配的用户候选。', 'read', pageFields(userOptionFields, 'list=[]表示该关键词没有匹配用户；keyword为空会在SDK本地拒绝。'), [
  'keyword必须非空；Portal候选映射是id→userId、mobile→userPhone、realName→userName。不要照抄Portal可能触发的全量人员请求。',
], { inputs: { keyword: param('用户名称关键词；必须非空，建议逐步缩小后再交给用户选择。', '调用方提供的搜索词', { type: 'string', required: true }) } })

export const SETTING_TOKEN_ALLOCATION_AI_CONTRACTS = contracts
export const SETTING_TOKEN_ALLOCATION_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_TOKEN_ALLOCATION_METHODS).map(([id, method]) => [`settingTokenAllocation.${method}`, { ...SETTING_TOKEN_ALLOCATION_AI_CONTRACTS[id]!, boundaries: [...SETTING_TOKEN_ALLOCATION_AI_CONTRACTS[id]!.boundaries, '直接方法签名使用一个对象参数；prepare返回的draft必须按对应submit能力的输入说明继续消费。'] }]),
)
