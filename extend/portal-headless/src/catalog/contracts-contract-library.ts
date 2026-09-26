import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { CONTRACT_LIBRARY_METHODS, contractLibraryCapabilities } from '../capabilities/contract-library.js'

const definitions = new Map(contractLibraryCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const statusValues = {
  '1': '草稿',
  '2': '待审核',
  '3': '审核驳回',
  '4': '待签署',
  '5': '合同签署完成',
  '6': '合同成立（未生效）',
  '7': '合同成立（生效）',
  '8': '正常履行',
  '9': '部分履行',
  '10': '履行抗辩',
  '11': '变更履行',
  '12': '正常终止',
  '13': '协议终止',
  '14': '单方解除',
  '15': '其他终止',
  '16': '作废',
}

const rowFields: AiField[] = [
  field('id', 'string | number', '合同 ID；Java Long 可能序列化为字符串，后续详情、编辑、补充协议、签订证明、记录和作废必须原样保留'),
  field('name', 'string | null', '合同名称；编辑表单必填', { nullable: true, nullMeaning: '后端未返回' }),
  field('templateId', 'string | number | null', '合同模板 ID；编辑表单必填，不能用模板名称替代', { nullable: true, nullMeaning: '未关联模板或后端未返回' }),
  field('typeId', 'string | number | null', 'contract_type 分类字典叶子节点 ID；编辑表单必填', { nullable: true, nullMeaning: '未选择类型' }),
  field('typeName', 'string | null', '合同类型名称；后端按 typeId 补充，只读', { nullable: true, nullMeaning: '未补充' }),
  field('code', 'string | null', '合同编码；后端生成，编辑提交不从调用方传入', { nullable: true, nullMeaning: '未生成' }),
  field('startDate', 'string | null', '合同生效日期，YYYY-MM-DD', { nullable: true, nullMeaning: '未设置' }),
  field('endDate', 'string | null', '合同终止日期，YYYY-MM-DD', { nullable: true, nullMeaning: '未设置' }),
  field('signDate', 'string | null', '合同签订日期，YYYY-MM-DD', { nullable: true, nullMeaning: '未设置' }),
  field('organizationId', 'string | number | null', '所属组织 ID；编辑表单必填', { nullable: true, nullMeaning: '未关联组织' }),
  field('organizationName', 'string | null', '所属组织名称；后端补充，只读', { nullable: true, nullMeaning: '未补充' }),
  field('updateName', 'string | null', '最近修改人名称', { nullable: true, nullMeaning: '未补充' }),
  field('creatorName', 'string | null', '创建人名称', { nullable: true, nullMeaning: '未补充' }),
  field('createTime', 'string | null', '创建时间原值', { nullable: true, nullMeaning: '未返回' }),
  field('updateTime', 'string | null', '修改时间原值', { nullable: true, nullMeaning: '未返回' }),
  field('status', 'number | null', '合同状态；1至16的值见状态表', { nullable: true, values: statusValues, nullMeaning: '未返回' }),
  field('isReplenishment', 'number | null', '是否已有补充协议；1=有、0=无', { nullable: true, values: { '0': '无', '1': '有' }, nullMeaning: '未返回' }),
  field('isSignCertificate', 'number | null', '是否已有签订证明；1=有、0=无', { nullable: true, values: { '0': '无', '1': '有' }, nullMeaning: '未返回' }),
  field('isVoid', 'number | null', '是否作废；1=是、0=否', { nullable: true, values: { '0': '否', '1': '是' }, nullMeaning: '未返回' }),
  field('useSystem', 'number | null', '所属系统代码；沿用合同表单 bridge 的原值', { nullable: true, nullMeaning: '未返回' }),
  field('content', 'string | null', '合同模板配置 JSON 字符串；解析后是 {version,blocks}，回写仍须字符串', { nullable: true, nullMeaning: '历史空合同或后端未返回' }),
  field('dataList', 'object[]', '合同变量数据列表；每项是 contractKey 与 contractValue', { optional: true }),
  field('dataList[].contractKey', 'string', '合同变量名；去空格后必须唯一'),
  field('dataList[].contractValue', 'string | null', '变量值；null 代表后端未设置或空值', { nullable: true, nullMeaning: '未设置' }),
  field('contractVersionId', 'string | number | null', '当前合同版本 ID', { nullable: true, nullMeaning: '未生成版本' }),
  field('variableApi', 'string | null', '变量回调 API 配置原值', { nullable: true, nullMeaning: '未配置' }),
  field('variableApiData', 'string | null', '变量回调 API 数据原值', { nullable: true, nullMeaning: '未配置' }),
  field('callbackApi', 'string | null', '合同回调 API 配置原值', { nullable: true, nullMeaning: '未配置' }),
  field('callbackApiData', 'string | null', '合同回调 API 数据原值', { nullable: true, nullMeaning: '未配置' }),
  field('callbackApiForSignAfterApi', 'string | null', '签署后回调 API 配置原值', { nullable: true, nullMeaning: '未配置' }),
  field('callbackApiForSignAfterApiData', 'string | null', '签署后回调 API 数据原值', { nullable: true, nullMeaning: '未配置' }),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页合同记录'), field('total', 'number', '符合筛选条件的总记录数，不是当前页条数'), ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[] 表示当前页没有合同；total=0 表示当前筛选没有合同，不等同于没有权限。',
}
const detailOutput: AiContract['output'] = { shape: 'object', fields: rowFields, empty: '不存在、无权限或响应字段形状不符合 Portal 详情会抛错；SDK 不降级为空对象。' }
const trueOutput: AiContract['output'] = { shape: 'true', fields: [field('$', 'true', '后端 CommonResult<Boolean> 解包后的成功值 true')], empty: '没有 true 或请求抛错不能报告保存或作废成功；写操作必须回查。' }
const preparationOutput = (label: string): AiContract['output'] => ({ shape: '{ draft: object, previous?: object }', fields: [field('draft', 'object', `${label}已按 Portal 表单和权限规则校验、尚未写入的草稿`), field('previous', 'object', '提交前快照；取消时只丢弃 draft，不调用写接口', { optional: true })], empty: '字段、ID、日期、文件或内容结构不符合 Portal 时在发请求前抛错。' })
const recordOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页合同操作记录'), field('total', 'number', '操作记录总数'), field('list[].id', 'string | number', '操作记录 ID'), field('list[].contractId', 'string | number', '合同 ID'), field('list[].operateType', 'number | null', '操作类型；1创建、2修改、3保存补充协议、4保存签订证明、5作废（当前后端作废记录实际写3）', { nullable: true }), field('list[].operateTime', 'string | null', '操作时间原值', { nullable: true }), field('list[].operator', 'string | number | null', '操作人 ID', { nullable: true }), field('list[].operatorName', 'string | null', '操作人名称', { nullable: true }), field('list[].preUrl', 'string | null', '补充协议变更前 URL 逗号串', { nullable: true }), field('list[].nextUrl', 'string | null', '补充协议变更后 URL 逗号串', { nullable: true }), field('list[].preUrlName', 'string | null', '补充协议变更前文件名逗号串', { nullable: true }), field('list[].nextUrlName', 'string | null', '补充协议变更后文件名逗号串', { nullable: true }), field('list[].preImg', 'string | null', '签订证明变更前图片/文件 URL 逗号串', { nullable: true }), field('list[].nextImg', 'string | null', '签订证明变更后图片/文件 URL 逗号串', { nullable: true }), field('list[].preImgName', 'string | null', '签订证明变更前文件名逗号串', { nullable: true }), field('list[].nextImgName', 'string | null', '签订证明变更后文件名逗号串', { nullable: true })],
  empty: 'list=[] 且 total=0 表示该合同没有操作记录，不等同于查询失败。',
}
const replenishmentOutput: AiContract['output'] = { shape: '{ url: string | null, name: string | null }', fields: [field('url', 'string | null', '补充协议 URL 逗号串；按逗号与 name 对齐', { nullable: true, nullMeaning: '没有补充协议' }), field('name', 'string | null', '补充协议文件名逗号串；与 url 同下标对应', { nullable: true, nullMeaning: '没有补充协议' })], empty: 'url/name 为空表示没有补充协议，不能把它解释成请求失败。' }
const signCertificateOutput: AiContract['output'] = { shape: '{ signDate: string | null, startDate: string | null, endDate: string | null, imgUrl: string | null, imgName: string | null }', fields: [field('signDate', 'string | null', '签订日期，YYYY-MM-DD', { nullable: true, nullMeaning: '未填写' }), field('startDate', 'string | null', '生效日期，YYYY-MM-DD', { nullable: true, nullMeaning: '未填写' }), field('endDate', 'string | null', '终止日期，YYYY-MM-DD', { nullable: true, nullMeaning: '未填写' }), field('imgUrl', 'string | null', '签订证明文件 URL 逗号串', { nullable: true, nullMeaning: '没有文件' }), field('imgName', 'string | null', '签订证明文件名逗号串；与 imgUrl 同下标对应', { nullable: true, nullMeaning: '没有文件' })], empty: '日期和文件字段都为空表示尚未保存签订证明。' }
const updateReceiptOutput: AiContract['output'] = { shape: '{ id: string | number, code: string | null, contractVersionId: string | number | null, onlySave: number | null }', fields: [field('id', 'string | number', '已修改合同 ID'), field('code', 'string | null', '合同编码；后端回执中的编码', { nullable: true, nullMeaning: '回执未返回' }), field('contractVersionId', 'string | number | null', '新建合同版本 ID', { nullable: true, nullMeaning: '回执未返回' }), field('onlySave', 'number | null', '后端保存模式；合同库模拟修改固定发送0，回执原样返回', { nullable: true, nullMeaning: '回执未返回' })], empty: '只有回执并不证明页面最终字段已生效；必须用 contract-library-get 回查。' }

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ 8b9a5554d4: app/portal/menus/hr.js、views/dashboard/hr/contract/library/list.vue、detail/[id].vue、library/contract/utils/share.js、ModalContractSupplyAgree、ModalContractSign、[mode]/form/[id].vue、[mode]/preview/share.js、library/contract/utils/validation.js', kind: 'reference', note: '逐页核对合同库菜单路径/权限、列表筛选和分页、详情、操作记录、下载/打印、补充协议、签订证明、模拟修改和作废；锁定字段、可见状态和提交前校验。' },
  { source: 'CodeReview_Mall_Platform_Java @ d83e4086fd5: ContractController、ContractServiceImpl、ContractOperateServiceImpl、ContractPageReqVO、ContractRespVO、ContractSaveReqVO、ContractOperateRespVO、ReplenishmentInfoVO、SignCertificateVO、ContractContentValidator、ContractDO、ContractOperateDO', kind: 'reference', note: '核对合同分页/详情/操作记录/补充协议/签订证明/共同修改/作废端点、租户数据、状态转换、回执字段和作废操作类型记录现状。' },
  { source: 'src/capabilities/contract-library.ts 与 test/contract-library.test.ts', kind: 'implementation', note: '锁定请求方法、URL、参数/请求体、状态权限门槛、表单规则、返回形状和坏输入反证；尚未替代真实测试环境写入回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作 Portal「风控管理 → 合同库」列表、详情或合同编辑/附件弹窗。',
  boundaries: [
    '页面路径是/dashboard/contract/library/list，权限是/dashboard/contract/library；请求使用 platform HTTP 实例和 module-type=15（风险防控），调用方不要另拼页面上下文。',
    '列表可见筛选只有 name、typeId、signDate、startDate、endDate、status；日期按YYYY-MM-DD发送，status是1至16的页面状态，默认值均为null，分页默认pageNo=1、pageSize=20并发送空order/orderField。',
    '合同编辑第一步要求 name、typeId、organizationId、contractTemplateId；预览提交还要求 content 是含 version/blocks 的JSON字符串、block id/name/data有效且变量contractKey去空格后唯一。更深组件规则仍由 Portal 和 Java 校验器共同执行。',
    '补充协议和签订证明的文件字段都是按下标对应的逗号字符串；签订证明未保存时日期和至少一个文件均必填，已有签订证明时 Portal 弹窗只读；已有签订证明的合同不能删除已有补充协议。',
    '列表只在 status 不是1草稿且不是3审核驳回时显示作废；作废接口的请求体按 Portal 原样是 { params: { id } }。后端当前把作废操作记录为 operateType=3，读取记录时按后端实际值解释。',
    '写操作没有 requestId 幂等协议；超时必须先用详情、列表或操作记录回查，不要盲目重发。true、回执或 HTTP 成功都不是最终业务证据。',
  ],
  prerequisites: ['使用当前用户会话、租户和页面权限创建 SDK；合同类型、模板、所属组织和上传后的文件 URL 必须来自已核实的 Portal 候选/上传结果。'],
  failures: ['字段必填、日期、ID、内容结构、文件删除限制、合同状态、权限、租户、网络或响应形状错误原样抛出；不把空列表、true 或修改回执单独当作最终业务完成。'],
  evidence,
  gaps: ['已完成 Portal/Java 逐页源码核对与离线请求断言；尚未在真实测试环境执行本页每条写链的 prepare→submit→回查→cancel/清理。'],
})

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Contract library contract has no definition: ${id}`)
  contracts[id] = value
}

const idInput = (meaning: string, source: string): Record<string, AiParameter> => ({ id: param(meaning, source, { type: 'string | number', required: true }) })
const draftInput = (meaning: string): AiParameter => param(meaning, '同一页面的 prepare 能力返回的 draft；不要手工删字段', { type: 'object', required: true })
const queryInputs: Record<string, AiParameter> = {
  name: param('合同名称筛选；省略时按 Portal 初始 null 发送。', '用户明确输入', { type: 'string', required: false, nullable: true, default: 'null' }),
  typeId: param('contract_type 分类字典叶子节点 ID；省略时为 null。', '用户从合同类型树确认的叶子节点', { type: 'string | number', required: false, nullable: true, default: 'null' }),
  signDate: param('签订日期筛选，YYYY-MM-DD；省略时为 null。', '用户明确日期', { type: 'string', required: false, nullable: true, format: 'YYYY-MM-DD', default: 'null' }),
  startDate: param('生效日期筛选，YYYY-MM-DD；省略时为 null。', '用户明确日期', { type: 'string', required: false, nullable: true, format: 'YYYY-MM-DD', default: 'null' }),
  endDate: param('终止日期筛选，YYYY-MM-DD；省略时为 null。', '用户明确日期', { type: 'string', required: false, nullable: true, format: 'YYYY-MM-DD', default: 'null' }),
  status: param('合同状态筛选；只能是1至16，省略时为 null。', '用户明确状态', { type: 'number', required: false, nullable: true, options: Object.entries(statusValues).map(([value, label]) => ({ value: Number(value), label })), default: 'null' }),
  pageNo: param('从1开始的页码；Portal 默认1。', '调用方分页位置', { type: 'number', required: false, default: '1' }),
  pageSize: param('每页条数；Portal 默认20。', '调用方分页设置', { type: 'number', required: false, default: '20' }),
}

add('contract-library-list', base({ purpose: '按 Portal 合同库筛选条件读取当前用户可见的合同分页列表。', effect: 'read', inputs: queryInputs, output: pageOutput, consume: ['用 list[].id 作为详情、下载数据、操作记录、补充协议、签订证明、模拟修改和作废的唯一定位；需要全集时继续翻页覆盖 total。'], steps: [{ role: 'optional', when: '需要查看或写入某份合同', capabilityId: 'contract-library-get', mapping: { id: 'list[].id' }, instruction: '先读取同一合同的最新详情，不使用可能过期的列表行直接提交。' }], completion: '返回当前筛选的一页合同和 total；查询不修改数据。', idempotency: null }))
add('contract-library-get', base({ purpose: '读取一份合同的最新详情，用于下载数据、附件操作、模拟修改和写入回查。', effect: 'read', inputs: idInput('合同 ID；来自当前合同列表或已有详情。', 'contract-library-list.list[].id'), output: detailOutput, consume: ['保存 content、dataList、模板/类型/组织字段时保留原始值；Java Long ID 原样传回，不把名称当 ID。'], steps: [], completion: '得到目标合同的最新详情快照。', idempotency: null }))
add('contract-library-download', base({ purpose: '读取 Portal 合同详情并准备渲染/打印所需的数据。', effect: 'read', inputs: idInput('合同 ID。', 'contract-library-list.list[].id'), output: { shape: '{ id: string | number, name: string | null, status: number | null, isSignCertificate: number | null, content: string | null, dataList: object[] }', fields: [field('id', 'string | number', '合同 ID'), field('name', 'string | null', '合同名称', { nullable: true }), field('status', 'number | null', '合同状态', { nullable: true, values: statusValues }), field('isSignCertificate', 'number | null', '是否已有签订证明', { nullable: true }), field('content', 'string | null', '合同内容 JSON 字符串；调用方负责解析/渲染', { nullable: true }), field('dataList', 'object[]', '合同变量数据')], empty: '不存在、无权限或内容为空会按详情读取规则抛错；该能力不直接返回二进制文件。' }, consume: ['Portal 的“下载”动作实际先读详情再打开打印页面；调用方应自行渲染/保存，不把该能力描述成后端文件导出。'], steps: [], completion: '得到可供合同渲染/打印的详情数据。', idempotency: null }))
add('contract-library-records', base({ purpose: '读取一份合同的操作记录分页。', effect: 'read', inputs: { contractId: param('合同 ID。', 'contract-library-list.list[].id', { type: 'string | number', required: true }), pageNo: param('从1开始的页码；默认1。', '调用方分页位置', { type: 'number', required: false, default: '1' }), pageSize: param('每页条数；默认20。', '调用方分页设置', { type: 'number', required: false, default: '20' }) }, output: recordOutput, consume: ['按 operateType 解释动作；作废的 Java 当前实现写入 operateType=3，不能仅依赖页面文案推断为5。'], steps: [], completion: '返回该合同当前页操作记录和总数。', idempotency: null }))
add('contract-library-get-replenishment', base({ purpose: '读取合同当前补充协议文件。', effect: 'read', inputs: idInput('合同 ID。', 'contract-library-list.list[].id'), output: replenishmentOutput, consume: ['把 url/name 逗号串按下标还原为文件数组，再让用户确认最终保留文件。'], steps: [{ role: 'optional', when: '需要保存补充协议', capabilityId: 'contract-library-prepare-replenishment', mapping: { contractId: 'args.id' }, instruction: '把读取结果和合同详情的 isSignCertificate 一并传入 prepare。' }], completion: '得到补充协议当前快照。', idempotency: null }))
add('contract-library-prepare-replenishment', base({ purpose: '按补充协议弹窗规则准备最终文件集合，不写入服务端。', effect: 'prepare', inputs: { contractId: param('合同 ID。', 'contract-library-list.list[].id', { type: 'string | number', required: true }), current: param('contract-library-get-replenishment 返回的当前 url/name 对象；首次无文件可省略。', 'contract-library-get-replenishment', { type: 'object', required: false, nullable: true }), files: param('用户确认最终保留的文件数组，每项含非空 url/name；Portal 上传组件只接受 PDF。空数组表示清空未签订合同的补充协议。', '用户确认的已上传文件', { type: 'object[]', required: true, constraints: ['每项必须含url和name', '已签订合同不能删除current中的既有url'] }), isSignCertificate: param('是否已有签订证明；从合同详情 isSignCertificate===1 得到。', 'contract-library-get.isSignCertificate', { type: 'boolean', required: false, default: 'false' }) }, output: preparationOutput('补充协议'), consume: ['取消时只丢弃 draft；确认保存时把 result.draft 原样传给 saveReplenishment。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'contract-library-save-replenishment', mapping: { draft: 'result.draft' }, instruction: '提交草稿后用 getReplenishment 和 get 回查文件及状态。' }, { role: 'cancel', when: '用户取消弹窗', instruction: '丢弃 draft，不调用保存接口。' }], completion: '得到按 Portal 删除权限校验的补充协议草稿。', idempotency: null }))
add('contract-library-save-replenishment', base({ purpose: '保存已准备的补充协议文件集合。', effect: 'write', inputs: { draft: draftInput('contract-library-prepare-replenishment 返回的 draft，含 contractId、nextUrl、nextUrlName。'), 'draft.contractId': param('保存目标合同 ID；从 draft.contractId 取值。', 'contract-library-prepare-replenishment.draft.contractId', { type: 'string | number', required: true }) }, output: trueOutput, consume: ['请求体是 contractId、nextUrl、nextUrlName 三个字段；成功或超时后必须用 getReplenishment 回查，并用 contract-library-get 检查 isReplenishment/status。'], steps: [{ role: 'required', when: '请求成功或超时', capabilityId: 'contract-library-get-replenishment', mapping: { id: 'args.draft.contractId' }, instruction: '按同一合同回查文件 URL/名称。' }, { role: 'required', when: '请求成功或超时', capabilityId: 'contract-library-get', mapping: { id: 'args.draft.contractId' }, instruction: '回查 isReplenishment 和合同状态；不能只看 true。' }], completion: '补充协议回查与草稿一致，并据当前状态解释后报告保存完成。', idempotency: '后端没有 requestId；超时先回查补充协议和合同详情，避免重复覆盖。' }))
add('contract-library-get-sign-certificate', base({ purpose: '读取合同签订证明日期和文件。', effect: 'read', inputs: idInput('合同 ID。', 'contract-library-list.list[].id'), output: signCertificateOutput, consume: ['把 imgUrl/imgName 逗号串按下标还原为文件数组；日期原值按 YYYY-MM-DD 使用。'], steps: [], completion: '得到签订证明当前快照。', idempotency: null }))
add('contract-library-prepare-sign-certificate', base({ purpose: '按签订证明弹窗的必填和只读规则准备提交草稿。', effect: 'prepare', inputs: { contractId: param('合同 ID。', 'contract-library-list.list[].id', { type: 'string | number', required: true }), current: param('contract-library-get-sign-certificate 返回的当前签订证明；用于取消和回显，不覆盖最终 files。', 'contract-library-get-sign-certificate', { type: 'object', required: false, nullable: true }), files: param('至少一个已上传文件；Portal 弹窗要求文件列表非空。', '用户上传并确认的文件', { type: 'object[]', required: true, constraints: ['至少1项', '每项含非空url/name'] }), signDate: param('签订日期，YYYY-MM-DD，必填。', '用户表单', { type: 'string', required: true, format: 'YYYY-MM-DD' }), startDate: param('生效日期，YYYY-MM-DD，必填。', '用户表单', { type: 'string', required: true, format: 'YYYY-MM-DD' }), endDate: param('终止日期，YYYY-MM-DD，必填。', '用户表单', { type: 'string', required: true, format: 'YYYY-MM-DD' }), isSignCertificate: param('合同是否已有签订证明；为true时 Portal 表单只读，SDK 拒绝提交。', 'contract-library-get.isSignCertificate===1', { type: 'boolean', required: false, default: 'false' }) }, output: preparationOutput('签订证明'), consume: ['取消时只丢弃 draft；确认保存时把 result.draft 原样传给 saveSignCertificate。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'contract-library-save-sign-certificate', mapping: { draft: 'result.draft' }, instruction: '提交后用 getSignCertificate 和 get 回查日期、文件与状态。' }, { role: 'cancel', when: '用户取消或已有证明只读', instruction: '丢弃 draft，不调用保存接口。' }], completion: '得到满足日期和文件必填的签订证明草稿。', idempotency: null }))
add('contract-library-save-sign-certificate', base({ purpose: '保存已准备的合同签订证明。', effect: 'write', inputs: { draft: draftInput('contract-library-prepare-sign-certificate 返回的 draft，含合同 ID、文件逗号串和三个日期。'), 'draft.contractId': param('保存目标合同 ID；从 draft.contractId 取值。', 'contract-library-prepare-sign-certificate.draft.contractId', { type: 'string | number', required: true }) }, output: trueOutput, consume: ['请求体是 contractId、nextImg、nextImgName、signDate、startDate、endDate；成功或超时后必须回查签订证明和合同详情。'], steps: [{ role: 'required', when: '请求成功或超时', capabilityId: 'contract-library-get-sign-certificate', mapping: { id: 'args.draft.contractId' }, instruction: '回查日期、文件 URL 和文件名。' }, { role: 'required', when: '请求成功或超时', capabilityId: 'contract-library-get', mapping: { id: 'args.draft.contractId' }, instruction: '回查 isSignCertificate 和状态；状态4应转为5。' }], completion: '签订证明及合同状态回查均符合草稿后报告保存完成。', idempotency: '后端没有 requestId；超时先回查，不重复覆盖证明。' }))
add('contract-library-prepare-update', base({ purpose: '基于合同最新详情和用户明确修改准备合同库模拟修改草稿。', effect: 'prepare', inputs: { current: param('contract-library-get 返回的最新详情；必须带可编辑的合同名称、模板、类型、组织和内容。', 'contract-library-get', { type: 'object', required: true }), changes: param('用户明确修改的第一步表单字段、日期、变量、内容和回调配置；未提供字段保留 current。contractTemplateId 是 Portal 表单命名，SDK 会映射到 templateId。', '用户编辑意图', { type: 'object', required: false, nullable: true, constraints: ['name/typeId/organizationId/templateId必须有效', 'content必须是含version/blocks的JSON字符串', 'dataList.contractKey去空格后唯一'] }) }, output: preparationOutput('合同修改'), consume: ['Portal 预览会先校验模板结构和解析后的变量文本；SDK 锁定共享根结构和变量键规则，更深组件错误交给后端。取消只丢弃 draft。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'contract-library-update', mapping: { draft: 'result.draft' }, instruction: '只提交 result.draft；返回回执后必须用 contract-library-get 回查完整字段。' }, { role: 'cancel', when: '用户取消编辑', instruction: '丢弃 draft，不调用更新接口。' }], completion: '得到含全部可编辑字段、onlySave将在提交时固定为0且尚未写入的草稿。', idempotency: null }))
add('contract-library-update', base({ purpose: '提交一份已准备的合同库模拟修改草稿。', effect: 'write', inputs: { draft: draftInput('contract-library-prepare-update 返回的完整合同修改草稿。') }, output: updateReceiptOutput, consume: ['请求是 POST /admin-api/hr/contract/updateContractByCommon；SDK 固定 onlySave=0、code=null，并按 Portal 字段发送 content/dataList/回调配置。回执不是详情，必须按 id 回查。'], steps: [{ role: 'required', when: '收到回执或请求超时', capabilityId: 'contract-library-get', mapping: { id: 'result.id' }, instruction: '读取同一合同；正常响应使用回执 id，超时则使用 args.draft.id 回查，逐字段核对名称、类型、组织、模板、日期、变量、内容和状态；未确认前不重复提交。' }], completion: 'contract-library-get 回查确认修改终态与草稿一致后报告更新完成。', idempotency: '后端没有 requestId；当前状态为2待审核时 Java 服务拒绝更新，超时先按合同 ID 回查。' }))
add('contract-library-prepare-void', base({ purpose: '在作废前按 Portal 当前列表按钮可见条件准备确认草稿。', effect: 'prepare', inputs: { id: param('合同 ID。', 'contract-library-list.list[].id', { type: 'string | number', required: true }), status: param('当前合同列表状态；必须来自最新列表/详情。状态1草稿和3审核驳回时 Portal 不显示作废动作。', 'contract-library-list.list[].status 或 contract-library-get.status', { type: 'number', required: true, options: Object.entries(statusValues).map(([value, label]) => ({ value: Number(value), label })) }) }, output: preparationOutput('合同作废'), consume: ['作废是不可逆业务动作；用户取消时丢弃 draft，不调用接口。'], steps: [{ role: 'required', when: '用户确认作废', capabilityId: 'contract-library-void', mapping: { draft: 'result.draft' }, instruction: '提交确认草稿；完成后用 contract-library-get 和 contract-library-records 回查状态与记录。' }, { role: 'cancel', when: '用户取消作废确认', instruction: '不调用作废接口。' }], completion: '得到状态门槛通过、尚未写入的作废确认草稿。', idempotency: null }))
add('contract-library-void', base({ purpose: '作废一份合同。', effect: 'write', inputs: { draft: draftInput('contract-library-prepare-void 返回的合同 ID 与当前状态。'), 'draft.id': param('作废目标合同 ID；从 draft.id 取值。', 'contract-library-prepare-void.draft.id', { type: 'string | number', required: true }) }, output: trueOutput, consume: ['Portal 原样发送 POST /admin-api/hr/contract/voidContract/{id}，body 为 { params: { id } }；成功或超时后必须回查 status=16/isVoid=1，并读取操作记录。'], steps: [{ role: 'required', when: '请求成功或超时', capabilityId: 'contract-library-get', mapping: { id: 'args.draft.id' }, instruction: '回查同一合同的 status 和 isVoid。' }, { role: 'required', when: '请求成功或超时', capabilityId: 'contract-library-records', mapping: { contractId: 'args.draft.id' }, instruction: '回查作废操作记录；当前后端可能返回 operateType=3，这是已知实现事实，不要把它误判为补充协议。' }, { role: 'cancel', when: '用户取消确认', instruction: '不调用 void。' }], completion: '详情回查确认status=16且isVoid=1，并按后端实际记录解释操作记录后报告作废完成。', idempotency: '后端没有 requestId；作废超时先按合同 ID 回查，不重复发起不可逆动作。' }))

export const CONTRACT_LIBRARY_AI_CONTRACTS = contracts
export const CONTRACT_LIBRARY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(CONTRACT_LIBRARY_METHODS).map(([id, method]) => [`contractLibrary.${method}`, { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `这是公开门面 sdk.contractLibrary.${method}；prepare 只产生草稿，不能被误报为已写入。`] }]))
