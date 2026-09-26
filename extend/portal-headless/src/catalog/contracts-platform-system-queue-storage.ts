import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { platformSystemQueueStorageCapabilities } from '../capabilities/platform-system-queue-storage.js'

const definitions = new Map(platformSystemQueueStorageCapabilities.map(definition => [definition.id, definition]))

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: true,
  nullable: true,
  ...extra,
})

const object = (fields: AiField[], empty: string): AiContract['output'] => ({ shape: 'object', fields, empty })

const configFields = [
  field('host', 'string | null', 'FTP服务器地址；页面标签为FTP地址，原值展示和提交，不解析为IP或域名。'),
  field('port', 'string | null', 'FTP服务器端口；页面按字符串输入和提交，不转换为number。'),
  field('name', 'string | null', 'FTP登录用户名。'),
  field('pass', 'string | null', 'FTP登录密码；页面以密码控件展示，SDK不脱敏、不改写其原值。'),
  field('dir', 'string | null', 'FTP服务器上的目录路径；页面提示该目录必须已存在且具备读写权限。'),
]

const payloadFields = configFields.map(item => ({ ...item, path: `payload.${item.path}` }))

const configInput: AiParameter = {
  type: 'object',
  required: true,
  meaning: '当前存储方式表单对象；页面直接把整份表单作为请求体发送，不因字段为空而删字段。',
  source: 'platform-system-queue-storage-get返回值与用户明确修改；也可以由用户按页面字段提供。',
  nullable: false,
  constraints: [
    'host、port、name、pass、dir均为页面输入框对应的字符串；Portal没有Form.Item required或长度/格式校验。',
    '字段值允许空字符串；已知后端FTPSettingDTO字段允许为null，SDK保留null；未知扩展字段按Portal的对象展开行为原样保留。',
  ],
}

const nestedInputs: Record<string, AiParameter> = Object.fromEntries(configFields.map(item => [`form.${item.path}`, {
  type: item.type,
  required: false,
  nullable: true,
  meaning: item.meaning,
  source: 'form对象中的同名字段；页面没有该字段的独立必填校验。',
}]))

const contracts: Record<string, AiContract> = {}

const liveGaps = [
  '本轮已静态核对Portal页面、platform-mall-admin实例、Java Controller/DTO/常量和离线请求断言；尚未在真实测试环境执行浏览器读操作。',
  '本轮未在真实环境执行保存的prepare → submit → cancel/回滚记录；Portal没有撤销或恢复接口，保存结果需部署环境重新读取后才能核实。',
]

function add (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): void {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Queue storage contract has no definition: ${id}`)
  contracts[id] = {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只对应Portal路径 /dashboard/platform/system/queue/storage/list 及权限 /dashboard/platform-v2/system/queue/storage；请求使用 platform-mall-admin 实例。',
      '页面实际配置的是FTP存储方式；不扩展为导出队列列表、文件上传、FTP连通性测试或其它云存储配置。',
      '页面请求不声明 module-type；Java Controller使用 importexport / ftp_server_setting 读取和覆盖基础设置，不能据此推断FTP连接已经可用。',
    ],
    effect: definition.write ? 'write' : 'read',
    prerequisites: ['使用会话 token 和租户创建 SDK，并具备Portal页面权限；保存前应读取或持有当前整份表单。'],
    output,
    consume,
    steps: [],
    completion: '返回值符合本能力结构；保存能力只有在重新读取并逐字段核对后，才能报告配置已生效。',
    failures: [
      '表单结构或已知字段类型不符合页面字符串输入规则时，SDK在发请求前失败；空字符串本身不是Portal前端校验错误。',
      '权限、会话、网络或后端保存失败必须按错误处理，不能把空配置或请求成功直接解释为FTP可用。',
      '保存请求超时会使最终状态不确定，先调用读取能力核对，不要盲目重复覆盖保存。',
    ],
    idempotency: null,
    evidence: [
      { source: 'src/capabilities/platform-system-queue-storage.ts', kind: 'implementation', note: '锁定FTP表单字段、完整对象提交、platform-mall-admin实例和本地prepare规则。' },
      { source: 'test/platform-system-queue-storage.test.ts', kind: 'test', note: '离线锁定页面路径/权限、GET/POST路径、完整请求体、空字符串/null和坏输入反证。' },
      { source: 'docs/pages/存储方式.md', kind: 'reference', note: '记录Portal页面、Java Controller/DTO/常量及未执行真实smoke的边界。' },
    ],
    gaps: [...liveGaps],
    ...extra,
    inputs: {
      ...Object.fromEntries(definition.params.map(parameter => [parameter.name, {
        type: parameter.name === 'form' ? 'object' : 'string',
        required: parameter.required,
        meaning: parameter.description ?? parameter.name,
        source: 'Portal存储方式页面的当前配置或用户输入。',
      }])),
      ...extra.inputs,
    },
  }
}

add(
  'platform-system-queue-storage-get',
  '读取当前FTP存储方式配置，供页面展示或保存前形成当前表单。',
  object(configFields, '返回对象可能为空对象或字段为null；空字符串、null和字段缺席按不同状态保留，不能推断FTP未配置或连接失败。'),
  ['按host、port、name、pass、dir逐字段展示或作为后续prepareSave的当前表单；不要把读取成功解释为FTP连接测试成功。'],
)

add(
  'platform-system-queue-storage-prepare-save',
  '校验并复制FTP存储方式表单为待提交请求体，不发网络请求。',
  object([
    field('payload', 'object', 'Portal保存接口最终接收的完整FTP配置请求体', { optional: false, nullable: false }),
    ...payloadFields,
  ], 'payload是本地准备结果；取消时直接丢弃，不会修改服务端配置。'),
  ['把result.payload原样交给platform-system-queue-storage-save；不要自行删除空字段、把port转成number或重命名pass。'],
  {
    effect: 'prepare',
    inputs: { form: configInput, ...nestedInputs },
    steps: [
      { role: 'required', when: '用户确认保存当前准备结果', capabilityId: 'platform-system-queue-storage-save', mapping: { form: 'result.payload' }, instruction: '提交同一份payload；保存响应后再调用get逐字段核对。' },
      { role: 'cancel', when: '用户取消保存或只想放弃本地修改', instruction: '丢弃result.payload，不调用save；Portal没有服务端cancel接口。' },
    ],
    completion: '得到未写入服务端的完整FTP配置请求体。',
    idempotency: null,
  },
)

add(
  'platform-system-queue-storage-save',
  '保存当前FTP存储方式配置，覆盖Java基础设置中的FTP配置对象。',
  { shape: 'undefined', fields: [], empty: '保存成功没有业务返回值；Java响应中的“保存成功”文本不作为SDK业务返回值，需重新get核实。' },
  ['POST成功或超时后调用platform-system-queue-storage-get，逐字段对照host、port、name、pass、dir；这只能核实配置回读，不代表已经完成FTP连通性验证。'],
  {
    inputs: { form: configInput, ...nestedInputs },
    steps: [
      { role: 'required', when: 'POST响应成功或结果不确定', capabilityId: 'platform-system-queue-storage-get', mapping: {}, instruction: '重新读取并逐字段核对同一份form；超时也必须先回读再决定是否重试。' },
      { role: 'cancel', when: '用户要求撤销已保存配置', instruction: 'Portal和Java当前没有撤销/恢复接口；不能伪造cancel，若要恢复只能由调用方保留旧表单后再次执行一次save。' },
    ],
    completion: '只有POST受理且get回读字段一致，才能报告配置已保存；不能报告FTP服务已连通或队列传输已成功。',
    idempotency: '后端没有requestId或撤销接口；保存是整份配置覆盖，超时先get核对，未核实前不要重复提交，避免覆盖并发修改。',
  },
)

export const PLATFORM_SYSTEM_QUEUE_STORAGE_AI_CONTRACTS = contracts
