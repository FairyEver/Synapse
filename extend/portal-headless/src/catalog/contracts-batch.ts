import {
  BATCH_ENDPOINTS,
  BATCH_SDK_CAPABILITIES,
  batchMethodName,
} from '../capabilities/generated/index.js'
import type { AiContract, AiParameter } from './ai-contract.js'

function inputType (kind: string): string {
  switch (kind) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'date':
      return 'string'
    case 'enum':
    case 'search':
    case 'tree':
      return 'string | number'
    case 'array':
      return 'unknown[]'
    default:
      return 'string'
  }
}

function defaultDescription (value: unknown): string {
  if (value === undefined) return '未提供时按 Portal 列表请求省略或由页面默认值处理。'
  if (value === null) return '默认值为 null；按 Portal 请求序列化规则处理。'
  if (Array.isArray(value) && value.length === 0) return '默认值为空数组；按 Portal 请求序列化规则处理。'
  return 'Portal 页面默认值为 ' + JSON.stringify(value) + '；未传入时 SDK 使用该值。'
}

function contractFor (capability: typeof BATCH_SDK_CAPABILITIES[number]): AiContract {
  const endpoint = BATCH_ENDPOINTS[capability.id]
  if (endpoint === undefined) throw new Error('批量能力缺少 AI 契约来源：' + capability.id)
  const methodPath = 'batch.' + batchMethodName(capability.id) + '.list'
  const inputs: Record<string, AiParameter> = Object.fromEntries(
    capability.params.map((param) => [
      param.name,
      {
        type: inputType(param.kind),
        required: param.required,
        meaning: param.description ?? 'Portal 列表筛选参数「' + param.name + '」。',
        source: 'Portal 页面 ' + endpoint.pagePath + ' 的列表表单与生成器 query 契约',
        default: defaultDescription(endpoint.query.find((item) => item.name === param.name)?.defaultValue),
        constraints: [
          '仅按 Portal 页面 ' + endpoint.pagePath + ' 的字段语义传值；不要把返回字段名当作查询参数。',
          '该方法只读取列表；页面上的新增、编辑、删除和提交动作不在此方法内。',
        ],
      },
    ]),
  )

  return {
    purpose: '查询' + capability.title.replace(/^查询/, '') + '。',
    whenToUse: '用户需要读取 Portal 页面 ' + endpoint.pagePath + ' 的列表数据或按页面筛选条件查询时使用。',
    boundaries: [
      '只覆盖 ' + endpoint.pagePath + ' 的自动抽取 GET 列表请求；不覆盖该页面其他新增、编辑、删除、提交或表单校验动作。',
      '只接入范围内且 verdict=auto 的批量契约；范围外或 partial 契约仍只存在于审计生成物，不可通过 SDK 门面调用。',
      '请求仍通过页面上下文发送，由页面规则决定 module-type、http 实例和数据权限；调用该方法不能绕过 Portal 会话权限。',
    ],
    effect: 'read',
    prerequisites: [
      '使用当前用户会话 token、tenantId 和对应 Portal 权限创建 SDK。',
      '调用前确认用户要查询的是 ' + endpoint.pagePath + ' 页面，不能将其他页面的查询参数或 ID 直接套用。',
    ],
    inputs,
    output: {
      shape: 'object | array',
      fields: [{
        path: '$',
        type: 'object | array',
        meaning: 'PortalRequest 对该列表接口返回的原始结果；批量生成器只固定请求路径、参数顺序和默认值，不猜测业务字段。',
      }],
      empty: '空数组、空对象或 Portal 的空列表包络表示当前筛选下没有数据；不能据此推断无权限或请求失败。',
    },
    consume: [
      '按实际返回值中的字段消费；当前契约不登记未逐页真实回查的业务字段，因此不得猜测 list、total 或行字段一定存在。',
      '需要后续写操作时，重新选择该页面已有且有完整 AI 契约的能力；不要把本只读列表 alias 当作表单提交入口。',
    ],
    steps: [{
      role: 'required',
      when: '需要读取该页面列表',
      capabilityId: capability.id,
      instruction: '按 inputs 中的页面参数调用 ' + methodPath + '。返回成功后按真实响应结构消费；不要把 HTTP 成功回执解释为写入结果。',
    }],
    completion: '请求通过页面上下文成功返回；交付时同时说明实际响应形状，不能补写生成器未证明的字段。',
    failures: [
      '参数类型或页面默认值不符合契约时，按页面字段修正后重试。',
      '会话、权限、module-type、网络或后端业务错误必须原样作为失败处理；不能用空列表替代错误。',
      '返回字段与当前静态契约不一致时，停止猜测并重新做该页面的 Portal 基准核对。',
    ],
    idempotency: null,
    evidence: [
      {
        source: 'tools/generate/batch-capabilities.mjs 与 src/capabilities/generated/batch-capabilities.ts',
        kind: 'implementation',
        note: '静态核对 ' + endpoint.pagePath + ' 的 GET 路径、页面上下文、查询参数顺序和默认值；该页面 verdict=auto 且 scope=in-scope。',
      },
      {
        source: 'test/batch-capabilities.test.ts',
        kind: 'test',
        note: '锁定安全子集、页面上下文转发、调用路径和目录/执行绑定一致性。',
      },
      {
        source: 'Portal 前端页面 ' + endpoint.pagePath + '（固定 test/portal/main 检出）',
        kind: 'reference',
        note: '列表请求来源与表单字段由批量生成器从 Portal 页面源码抽取；真实浏览器响应字段仍需逐页补证。',
      },
    ],
    gaps: [
      '尚未取得当前测试账号的浏览器登录态，未完成该页面的真实浏览器请求、权限矩阵和返回字段逐字段回查。',
    ],
  }
}

const contracts = Object.fromEntries(
  BATCH_SDK_CAPABILITIES.map((capability) => [capability.id, contractFor(capability)]),
) as Record<string, AiContract>

export const BATCH_AI_CONTRACTS = contracts

export const BATCH_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  BATCH_SDK_CAPABILITIES.map((capability) => {
    const id = capability.id
    const contract = contracts[id]!
    const sdkPath = 'batch.' + batchMethodName(id) + '.list'
    return [sdkPath, {
      ...contract,
      steps: contract.steps.map((step) => {
        const { capabilityId: _capabilityId, ...rest } = step
        return { ...rest, sdkPath }
      }),
    }]
  }),
)
