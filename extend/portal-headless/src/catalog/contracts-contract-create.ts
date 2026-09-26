import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { CONTRACT_CREATE_METHODS, contractCreateCapabilities } from '../capabilities/contract-create.js'

const definitions = new Map(contractCreateCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main@acab69acc77b6d6c0da21310cdfd26b91a01641e：app/portal/views/dashboard/hr/contract/create/list.vue、contract/[mode]/form/[id].vue、contract/[mode]/preview/share.js、form/components/template-select/index.vue、contract/utils/validation.js',
    kind: 'reference',
    note: '逐页核对合同创建入口、表单必填、模板候选、变量回调、预览内容校验、仅保存/创建并下载分支和创建后回调。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test@0f1a55718ebc1987affb8bf245106e809dd51da4：ContractController、ContractSaveReqVO、ContractRespVO、ContractContentValidator、WorkflowContractTemplateController、ContractTemplateServiceImpl',
    kind: 'reference',
    note: '核对模板读取、创建请求字段、content/dataList服务端校验、onlySave状态分支、创建回执和当前用户/租户权限边界。',
  },
  {
    source: 'src/capabilities/contract-create.ts、test/contract-create.test.ts',
    kind: 'test',
    note: '锁定 SDK 最终请求、显式回调配置、变量接口参数、创建草稿校验、回执归一化和坏输入零请求反证；真实测试环境写入回查仍需单独执行。',
  },
]

function definitionOf (id: string) {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`缺少合同创建能力定义：${id}`)
  return definition
}

function inputsOf (id: string, overrides: Record<string, AiParameter> = {}): Record<string, AiParameter> {
  const definition = definitionOf(id)
  const inputs: Record<string, AiParameter> = {}
  for (const item of definition.params) {
    const type = item.kind === 'number' ? 'number' : item.kind === 'date' ? 'string' : item.kind === 'search' ? 'string | number' : item.kind === 'enum' ? '0 | 1' : 'string'
    inputs[item.name] = param(item.description ?? item.name, `Portal合同创建${item.name}参数；按页面源码原值填写。`, {
      type,
      required: item.required,
      ...(item.options ? { options: item.options } : {}),
    })
  }
  return { ...inputs, ...overrides }
}

function base (id: string, purpose: string, output: AiContract['output'], extra: Partial<AiContract> = {}): AiContract {
  const definition = definitionOf(id)
  return {
    purpose,
    whenToUse: purpose,
    effect: definition.write ? 'write' : 'read',
    boundaries: [
      '能力归属 Portal“人力 → 风控管理 → 合同管理 → 合同创建”页面，页面权限码为/dashboard/contract/create；使用platform实例并由SDK按页面推导module-type=15。',
      '这是直接菜单创建流程；业务系统通过 bridge 传入的 variableApi、businessId、featureId、useSystem 和回调配置必须由调用方明确提供，SDK不猜测业务来源。',
      '创建回执只包含后端回执字段，不等于完整合同详情；写入完成必须用合同库详情或列表回查。',
    ],
    prerequisites: ['使用同一Portal用户/租户会话；先取得合同类型叶子ID、当前可见组织ID和启用模板ID，并让用户明确选择“仅保存”或“创建并下载”。'],
    inputs: inputsOf(id),
    output,
    consume: ['保留Java Long ID的原始字符串或安全整数形式；名称只用于展示，不能替代typeId、organizationId或templateId。'],
    steps: [],
    completion: definition.write ? '按页面写入分支完成请求，并按说明完成回调和独立回查；不能只凭HTTP成功报告合同已生效。' : '得到当前页面步骤所需数据或未写入草稿；本调用本身不产生合同记录。',
    failures: [
      '会话失效、页面权限、租户/组织数据范围、网络或标准响应失败都抛异常；不要通过切换页面上下文绕过权限。',
      '表单必填、ID、日期、变量键、content根结构或onlySave不符合页面/Java规则时，在请求前失败；不要把显示名称、父分类或空字符串当作有效ID。',
    ],
    idempotency: definition.write ? '后端没有requestId；创建或回调响应不确定时先按回执ID/业务字段回查，不盲目重复创建。' : null,
    evidence,
    ...extra,
  }
}

const templateFields: AiField[] = [
  field('id', 'string | number', '合同模板ID；后续读取详情和提交创建时使用，不能用name替代'),
  field('typeId', 'string | number | null', 'contract_type分类叶子ID', { nullable: true, nullMeaning: '响应未关联合同类型' }),
  field('typeName', 'string | null', '合同类型名称，只读展示', { nullable: true, nullMeaning: '响应未补充' }),
  field('name', 'string | null', '合同模板名称', { nullable: true, nullMeaning: '响应未返回名称' }),
  field('fileUrl', 'string | null', '模板文件地址', { nullable: true, nullMeaning: '响应未返回文件地址' }),
  field('fileName', 'string | null', '模板文件名', { nullable: true, nullMeaning: '响应未返回文件名' }),
  field('processInstanceId', 'string | null', '模板审批流程实例ID；创建页只读取已启用模板，不自动发起审批', { nullable: true, nullMeaning: '没有关联流程实例' }),
  field('status', 'number | null', '模板状态；候选接口只返回Portal认定的启用/已完成模板', { nullable: true, nullMeaning: '响应未返回状态' }),
  field('content', 'string | null', '模板内容JSON字符串；预览编辑后作为合同content提交', { nullable: true, nullMeaning: '模板未返回内容' }),
  field('versionId', 'string | number | null', '模板版本ID', { nullable: true, nullMeaning: '响应未生成版本' }),
  field('version', 'number | null', '模板版本号', { nullable: true, nullMeaning: '响应未返回版本号' }),
  field('useSystem', 'number | null', '所属系统代码；沿用Portal bridge/模板原值', { nullable: true, nullMeaning: '不按系统区分' }),
]

const draftFields: AiField[] = [
  field('draft', 'object', '按合同创建页面规则准备、尚未写入的完整草稿'),
  field('draft.name', 'string', '合同名称；页面必填'),
  field('draft.templateId', 'string | number', '选定合同模板ID'),
  field('draft.typeId', 'string | number', '选定合同类型叶子ID'),
  field('draft.code', 'null', '创建页面固定发送null，由后端生成合同编码'),
  field('draft.startDate', 'string | null', '合同生效日期；直接菜单默认未设置时省略', { optional: true, nullable: true, format: 'YYYY-MM-DD', nullMeaning: '明确传null表示未设置' }),
  field('draft.endDate', 'string | null', '合同结束日期；直接菜单默认未设置时省略', { optional: true, nullable: true, format: 'YYYY-MM-DD', nullMeaning: '明确传null表示未设置' }),
  field('draft.organizationId', 'string | number', '当前module-type=15可见组织ID'),
  field('draft.dataList', 'object[]', '变量数据；每项使用Portal/Java字段contractKey和contractValue'),
  field('draft.dataList[].contractKey', 'string', '变量名；去空格后必须唯一'),
  field('draft.dataList[].contractValue', 'string | null', '变量值；null表示未填写', { nullable: true, nullMeaning: '预览未填写或明确为空' }),
  field('draft.content', 'string', '预览编辑后的合同内容JSON字符串；至少含version和blocks根结构'),
  field('draft.businessId', 'string | number | null', '业务来源ID；直接菜单创建为null', { nullable: true, nullMeaning: '没有业务来源' }),
  field('draft.featureId', 'string | number | null', '业务功能ID；直接菜单创建为null', { nullable: true, nullMeaning: '没有业务功能来源' }),
  field('draft.useSystem', 'number | null', '所属系统代码；直接菜单创建为null', { nullable: true, nullMeaning: '不按系统区分' }),
  field('draft.onlySave', '0 | 1', '保存模式：1=仅保存草稿，0=创建并下载'),
  field('draft.variableApi', 'string', '变量接口配置原值；空字符串表示页面不请求变量接口'),
  field('draft.variableApiData', 'string', '变量接口JSON参数配置原值'),
  field('draft.callbackApi', 'string', '创建后回调接口；省略或空字符串时按Portal通用helper跳过，直接菜单入口需显式传入配置'),
  field('draft.callbackApiData', 'string', '创建后回调JSON参数配置原值'),
  field('draft.callbackApiForSignAfterApi', 'string', '签署后回调接口配置原值，创建页只透传'),
  field('draft.callbackApiForSignAfterApiData', 'string', '签署后回调JSON参数配置原值，创建页只透传'),
]

const receiptFields: AiField[] = [
  field('id', 'string | number', '新建合同ID；用于合同库回查'),
  field('code', 'string | null', '后端生成的合同编码', { nullable: true, nullMeaning: '回执未返回编码' }),
  field('contractVersionId', 'string | number | null', '新建合同版本ID', { nullable: true, nullMeaning: '回执未返回版本ID' }),
  field('onlySave', 'number | null', '后端返回的保存模式；请求值以prepare草稿onlySave为准', { nullable: true, nullMeaning: '回执未返回保存模式' }),
]

const contracts: Record<string, AiContract> = {}

contracts['contract-create-template-options'] = base('contract-create-template-options', '按合同类型读取合同创建页可用的启用模板候选。', {
  shape: 'object[]',
  fields: templateFields.map(item => ({ ...item, path: `[].${item.path}` })),
  empty: '[]表示该合同类型和useSystem筛选下没有可用模板，不等同于用户没有页面权限；需要换已确认的类型或向管理员确认模板状态。',
}, {
  inputs: inputsOf('contract-create-template-options', {
    typeId: param('合同类型分类树叶子ID；只传用户从contract_type候选中确认的叶子。', '合同类型候选入口的id', { type: 'string | number', required: true }),
    useSystem: param('系统代码；直接菜单创建传null或省略，不要猜测其它系统编码。', 'Portal bridge.useSystem', { type: 'number | null', required: false, nullable: true, nullMeaning: '不按系统过滤' }),
  }),
  consume: ['展示[].id和[].name供用户选择；选择后调用contract-create-template读取content，不用候选行的name拼接templateId。'],
  steps: [{ role: 'optional', when: '用户选定一个模板ID后需要预览', capabilityId: 'contract-create-template', mapping: { id: 'result.[].id' }, instruction: '使用用户明确选定的单个模板ID读取完整模板内容。' }],
  completion: '得到当前类型和系统筛选下的模板候选数组；读取不修改模板或合同。',
})

contracts['contract-create-template'] = base('contract-create-template', '读取合同创建预览所需的单个模板内容。', {
  shape: 'object',
  fields: templateFields,
  empty: '模板不存在、不可见或响应不符合详情结构时抛错；不返回空对象冒充模板。',
}, {
  inputs: inputsOf('contract-create-template', { id: param('已从模板候选中确认的模板ID。', 'contract-create-template-options[].id', { type: 'string | number', required: true }) }),
  consume: ['解析content作为预览初始配置；用户编辑后的配置必须重新序列化成合同创建草稿content，不能直接把模板名称当合同内容。'],
  completion: '得到单个模板详情和原始content；本调用不创建合同。',
})

contracts['contract-create-variables'] = base('contract-create-variables', '按Portal bridge配置读取合同创建预览的变量初始值。', {
  shape: 'object[]',
  fields: [field('[].name', 'string', '变量名称；提交时映射到dataList[].contractKey'), field('[].value', 'string | null', '变量初始值；用户可在预览中修改', { nullable: true, nullMeaning: '接口未设置值' })],
  empty: 'variableApi为空时页面不发请求并返回[]；接口返回空数组表示没有初始变量。非法variableApiData按Portal降级为空对象，不把它解释成权限成功。',
}, {
  consume: ['把name/value交给预览表单；提交前保留用户修改并由contract-create-prepare生成dataList。'],
  completion: '得到变量初始数组或明确的无变量状态；读取不写入合同。',
})

contracts['contract-create-prepare'] = base('contract-create-prepare', '在合同创建预览提交前按Portal表单、变量和合同内容规则生成无副作用草稿。', {
  shape: '{ draft: object }',
  fields: draftFields,
  empty: 'name/typeId/organizationId/contractTemplateId/content/onlySave缺失或无效、变量名去空格后重复、日期不是有效YYYY-MM-DD或content根结构无效时抛错，不发请求。',
}, {
  effect: 'prepare',
  idempotency: null,
  consume: ['把draft展示给用户确认；取消只丢弃draft，不调用create或callback。content深层组件配置仍由Portal预览校验和Java ContractContentValidator共同兜底。'],
  steps: [
    { role: 'required', when: '用户确认创建或仅保存', capabilityId: 'contract-create', mapping: { draft: 'result.$' }, instruction: '只提交prepare返回的完整draft；不要删掉code=null、onlySave、变量或回调配置。' },
    { role: 'cancel', when: '用户取消预览或返回表单', instruction: '丢弃draft，不调用任何写接口。' },
  ],
  completion: '得到完整、尚未写入的合同创建草稿；用户确认前没有服务端副作用。',
})

contracts['contract-create'] = base('contract-create', '提交合同创建页确认的合同草稿。', {
  shape: 'object',
  fields: receiptFields,
  empty: '没有有效id或请求抛错不能报告创建成功；回执不包含完整合同字段。',
}, {
  inputs: {
    draft: param('contract-create-prepare返回的完整草稿；必须原样保留code=null、onlySave、content、dataList和所有bridge回调字段。', 'contract-create-prepare.result.draft', { type: 'object', required: true }),
    requestId: param('SDK本地短窗口防重键；不发送给Portal。合同创建同一意图超时重试必须复用原值，新意图换新值。', '调用方用createRequestId()生成并保存', { type: 'string', required: true, constraints: ['同键不同草稿会被SDK拒绝', '进程重启或窗口过期不保证防重'] }),
  },
  consume: ['onlySave=1对应Portal“仅保存”，onlySave=0对应“创建并下载”；Java会据此设置合同状态。回执中的id用于后续详情回查。'],
  steps: [
    { role: 'required', when: '收到创建回执或响应超时', capabilityId: 'contract-library-get', mapping: { id: 'result.id' }, instruction: '用回执id读取合同库详情，逐字段核对名称、模板、类型、组织、日期、变量、content和状态；超时不要盲目重复创建。' },
    { role: 'required', when: '创建回执返回后且draft.callbackApi非空', capabilityId: 'contract-create-callback', mapping: { receipt: 'result.$' }, instruction: '按Portal顺序发送创建后回调；onlySave和callbackApiData使用同一份已确认draft配置。' },
  ],
  idempotency: 'invoke绑定contractCreate.createIdempotent，在当前SDK进程、用户、租户和能力范围内按requestId及草稿指纹短窗口防重；requestId不进入Portal body。直接create不防重。',
  completion: '创建回执有效，创建后回调已按页面规则处理，并且合同库详情回查确认最终字段与草稿一致。',
})

contracts['contract-create-callback'] = base('contract-create-callback', '按合同创建页面顺序发送创建后的业务回调。', {
  shape: 'true',
  fields: [field('$', 'true', 'SDK已完成回调HTTP请求；Portal同样不把回调业务体当作合同详情')],
  empty: 'callbackApi为空时按Portal跳过并返回true；接口异常会抛错。true不替代合同库详情回查。',
}, {
  inputs: {
    receipt: param('contract-create返回的创建回执。', 'contract-create.result', { type: 'object', required: true }),
    onlySave: param('与创建请求相同的0/1保存模式。', 'contract-create-prepare.result.draft.onlySave', { type: '0 | 1', required: true }),
    callbackApi: param('回调接口；省略或空值表示按Portal通用helper跳过；直接菜单调用方如需回调必须显式传入路径。', 'contract-create-prepare.result.draft.callbackApi', { type: 'string | null', required: false, nullable: true }),
    callbackApiData: param('回调JSON对象字符串；非法JSON按Portal降级为空对象。', 'contract-create-prepare.result.draft.callbackApiData', { type: 'string | null', required: false, nullable: true }),
  },
  consume: ['回调请求体是callbackApiData对象与创建回执、onlySave的浅合并；回调成功只代表回调请求完成，合同终态仍以合同库回查为准。'],
  completion: '回调接口已按确认配置调用，或明确因空路径按页面规则跳过；不把回调true解释成合同详情。',
})

export const CONTRACT_CREATE_AI_CONTRACTS = contracts
export const CONTRACT_CREATE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(CONTRACT_CREATE_METHODS).map(([id, method]) => [
    `contractCreate.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法入口为sdk.contractCreate.${method}；仍需遵守合同创建页面的表单、权限、回查和回调顺序。`] },
  ]),
)
CONTRACT_CREATE_METHOD_CONTRACTS['contractCreate.create'] = {
  ...CONTRACT_CREATE_METHOD_CONTRACTS['contractCreate.create']!,
  inputs: Object.fromEntries(Object.entries(CONTRACT_CREATE_METHOD_CONTRACTS['contractCreate.create']!.inputs).filter(([name]) => name !== 'requestId')),
  idempotency: '直接sdk.contractCreate.create不做短窗口防重；AI优先通过invoke("contract-create", { draft, requestId })使用createIdempotent。响应不确定时先按回执ID回查，不盲目重复创建。',
}
