import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { HR_ORGANIZATION_TYPE_METHODS } from '../capabilities/hr-organization-type.js'

const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })

const idsInput = param(
  '要批量删除的组织类型主键数组；页面即使只选一条也提交数组',
  'hr-organization-type-list 中由用户选择且 useNumber=0 的 list[].id',
  { type: 'array', required: true, constraints: ['不得为空；SDK 去重；不能传组织 ID 或组织类型名称', '页面禁止选择 useNumber 非 0 的行，调用方必须沿用该保护'] },
)
const idsItem = param('数组中的一个组织类型主键', '所选且 useNumber=0 的 list[].id', {
  type: 'string | number',
  required: true,
  constraints: ['数值必须是安全正整数；长 ID 使用数字字符串'],
})

const draftInputs: Record<string, AiParameter> = {
  name: param('组织类型名称，保留用户输入的首尾空格，不自动修剪', '用户输入', {
    type: 'string',
    required: true,
    constraints: ['必填、不得全为空格、最多 50 个字符；后端拒绝未删除记录中的同名名称'],
  }),
  remark: param('备注', '用户输入', {
    type: 'string',
    required: false,
    omitted: 'SDK 发送空字符串，与创建表单初始值一致',
    constraints: ['最多 200 个字符；允许空字符串，不允许非空且全为空格'],
  }),
}

function rowFields(prefix: string): AiField[] {
  const at = (key: string) => `${prefix}.${key}`
  return [
    field(at('id'), 'string | number', '组织类型主键，用于批量删除；不是组织 ID'),
    field(at('name'), 'string', '组织类型名称，页面原值显示'),
    field(at('remark'), 'string', '备注；空值时页面显示横杠', {
      optional: true,
      nullable: true,
      nullMeaning: '未填写备注，页面显示横杠',
    }),
    field(at('useNumber'), 'integer', '该类型当前关联组织的计数；0 才能在页面勾选删除，非 0 行禁选'),
  ]
}

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', 'SDK 忽略后端无业务数据的成功包络；没有返回新建 ID、删除数量或布尔成功标志')],
  empty: '成功为 undefined；JSON 无法编码根 undefined，调用方以 Promise 正常完成识别请求成功。失败抛错。',
}

const evidence: AiContract['evidence'] = [
  {
    source: 'app/portal/views/dashboard/hr/org/org-type/list.vue 与 [mode]/[id].vue @ d3cf56bdc76c',
    kind: 'reference',
    note: '证明名称查询、跨页勾选、useNumber 禁选、批量删除、创建表单与保存路径；行内编辑/单删模板已注释，没有详情入口。当前检出因网络条件未更新到远端。',
  },
  {
    source: 'HrOrganizationTypeController、HrOrganizationTypeServiceImpl、HrOrganizationTypeDao.xml @ dcb3f360194',
    kind: 'reference',
    note: '证明保存按 id 分支、同名校验、逻辑批删及关联占用保护；分页 SQL 未应用 dto.name。当前检出因网络条件未更新到远端。',
  },
  {
    source: '2026-09-22 main-task browser verification',
    kind: 'browser',
    note: 'PC 实测列表 GET 与 DELETE 带 module-type=11；创建 POST /save 只发 name/remark 且不带 module-type。创建临时记录 id=84 后勾选批删，列表恢复 17 条，测试数据已清理。',
  },
  {
    source: '2026-09-22 main-task real-backend read smoke',
    kind: 'smoke',
    note: '传 name=投资公司仍返回 total=17、count=17、allMatch=false，确认测试环境名称筛选没有生效；不代表 SDK 写能力已在线验证。',
  },
  {
    source: '2026-09-22 smoke/with-portal-token.sh SDK closed loop',
    kind: 'smoke',
    note: '共享接线后先确认verificationRequired=false，再由SDK创建唯一临时记录、完整分页识别唯一新增ID、核对名称/备注、批量删除并分页确认ID消失；测试数据已清理。',
  },
  {
    source: 'src/capabilities/hr-organization-type.ts 与 test/hr-organization-type.test.ts',
    kind: 'test',
    note: '证明 SDK 请求投影、列表/表单两种 module-type 接线边界、敏感验证分支和 AI 动作映射。',
  },
]

const gaps = [
  '测试租户当前 verificationRequired=false；短信发送、真人收件、验证码校验及带验证码删除未真实执行，且短信请求头尚无浏览器基准。',
  '名称筛选在测试环境及固定后端源码中均不生效；SDK仍按页面逐字段发送name，但调用方必须分页读取后本地匹配，不能把total解释成名称命中总数。',
]

function contract(
  purpose: string,
  effect: AiContract['effect'],
  inputs: Record<string, AiParameter>,
  output: AiContract['output'],
  consume: string[],
  extra: Partial<AiContract> = {},
): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    effect,
    inputs,
    output,
    consume,
    boundaries: [
      '仅覆盖人力 / 组织管理 / 组织类型 PC 菜单当前真实可达动作：列表、创建、批量删除及其敏感验证。',
      '行内编辑与单删模板在 list.vue 中整段注释，页面没有详情入口；虽然后端和共用表单仍有详情/修改代码，但不能从当前菜单正常到达，因此不发布 get/update 能力。',
      '列表、敏感配置和批量删除使用列表页上下文并带 module-type=11；创建页直接使用 platform 请求，真实保存 POST 不带 module-type。一个 HTTP 实例仍绑定当前用户和租户。',
      '取消创建页只返回上一页，提交前没有业务副作用；删除验证弹窗可在 DELETE 前取消。创建或删除成功后没有历史恢复接口。',
    ],
    prerequisites: ['已创建带会话 token 和 tenantId 的 SDK；共享接线必须分别注入列表页请求与不带 module-type 的创建页请求。'],
    steps: [],
    completion: '返回当前请求的数据并交付；写操作仍须按契约指定的列表回查核实业务结果。',
    failures: ['权限、登录、网络或后端业务错误原样抛出，不作为空结果。查询恢复后可重试；写入超时须先分页回查，不能自动重发。'],
    idempotency: effect === 'write'
      ? '没有 SDK 或后端幂等键；能力不接收 requestId。失败或超时先分页回查，同名校验不是幂等回执。'
      : null,
    evidence,
    gaps,
    ...extra,
  }
}

export const HR_ORGANIZATION_TYPE_AI_CONTRACTS: Record<string, AiContract> = {
  'hr-organization-type-list': contract(
    '分页读取当前用户可见的未删除组织类型；页面会发送名称查询值，但当前测试后端不应用该筛选。',
    'read',
    {
      name: param('页面的组织类型名称查询值；当前后端实测未应用', '用户输入', {
        type: 'string',
        required: false,
        omitted: 'SDK 发送空字符串',
        constraints: ['不得依赖服务端名称筛选；必须分页读取并在本地按 name 匹配'],
      }),
      pageNo: param('页码，从 1 开始', '用户分页选择或上一页结果后的下一页', {
        type: 'integer', required: false, omitted: 'SDK 默认 1', constraints: ['SDK 要求正整数'],
      }),
      pageSize: param('每页记录数', '用户分页选择', {
        type: 'integer', required: false, omitted: 'SDK 默认 20', constraints: ['SDK 要求正整数'],
      }),
      order: param('renren 列表排序方向占位值', '调用方列表状态', {
        type: 'string', required: false, omitted: 'SDK 发送空字符串', constraints: ['页面没有可操作列排序，不自行填写未知值'],
      }),
      orderField: param('renren 列表排序字段占位值', '调用方列表状态', {
        type: 'string', required: false, omitted: 'SDK 发送空字符串', constraints: ['页面没有可操作列排序，不自行填写未知字段'],
      }),
    },
    {
      shape: '{ list: object[], total: number }',
      fields: [
        field('$', 'object', '组织类型分页'),
        field('list', 'array', '本次当前页记录；不是所有记录'),
        field('list[]', 'object', '一个组织类型；页面无关扩展字段不属于展示或操作契约'),
        ...rowFields('list[]'),
        field('total', 'integer', '后端返回的未删除记录总数；当前部署未应用 name，因此不是名称命中总数'),
      ],
      empty: 'list=[] 表示本页无记录；total=0 表示后端范围内无未删除记录。网络或权限失败会抛错。',
    },
    [
      '展示 name 与 remark；useNumber 只控制能否勾选删除，id 只用于动作。',
      '需要按名称找记录时逐页读取，累计记录数达到 total 后停止，再在本地精确或包含匹配；不能依赖服务端 name。',
    ],
    {
      completion: '交付当前页，或按用户要求完成全部分页与本地名称匹配后结束；不把一页或失效的服务端筛选当作完整结果。',
      steps: [{
        role: 'optional',
        when: '用户要删除一条或多条且所选每行 useNumber=0',
        capabilityId: 'hr-organization-type-prepare-remove',
        mapping: { ids: 'result.list[].id' },
        instruction: '让用户选择一条或多条；只汇集 useNumber 严格为数值 0 的行 ID，非 0 行与页面一致不得选中。',
      }],
    },
  ),

  'hr-organization-type-create': contract(
    '创建组织类型，保存名称与备注。',
    'write',
    draftInputs,
    voidOutput,
    [
      '成功响应不含新 ID；从创建前后分页差异及名称/备注精确匹配中识别新增记录。',
      '创建请求使用不带 module-type 的表单请求；不能复用会自动添加 module-type=11 的列表页请求。',
    ],
    {
      completion: 'Promise 完成只表示保存请求成功；分页回查并唯一识别新增 ID 后，才能报告创建已核实。',
      steps: [{
        role: 'required',
        when: '创建返回或超时，需要确认是否写入',
        capabilityId: 'hr-organization-type-list',
        mapping: { name: 'args.name' },
        instruction: '服务端名称筛选当前无效，必须逐页读取并在本地精确比较 name/remark；最好与创建前 ID 集合做差。多个候选或无候选时结果不确定，不要重复创建。',
      }],
    },
  ),

  'hr-organization-type-prepare-remove': contract(
    '读取当前敏感删除配置，为批量删除组织类型决定是否需要短信验证。',
    'prepare',
    { ids: idsInput, 'ids[]': idsItem },
    {
      shape: '{ ids: string[], verificationRequired: boolean, phone: string | null }',
      fields: [
        field('$', 'object', '本次删除准备结果，不是删除回执或状态锁'),
        field('ids', 'array', '已去重的组织类型 ID 数组'),
        field('ids[]', 'string', '一个归一化后的组织类型 ID'),
        field('verificationRequired', 'boolean', 'true 需要短信验证；false 仅当敏感配置为空或 isDel 严格等于数值 1'),
        field('phone', 'string | null', '敏感配置中的 mobile；不是调用方可替换的手机号', {
          nullable: true,
          nullMeaning: '配置未返回手机号；需要验证时不能发送验证码',
        }),
      ],
      empty: 'ids 为空会在发请求前报错。配置为空时可返回 verificationRequired=false、phone=null。',
    },
    [
      '仅对来自最新列表且 useNumber=0 的 ID 继续；准备阶段不会锁定引用关系，DELETE 仍可能因随后新增关联而失败。',
      '手机号只用于向用户说明验证码去向并按需掩码展示，不复制到日志或允许调用方替换。',
    ],
    {
      completion: '已读取当前敏感配置，没有发送短信或删除记录；此时取消只需停止调用。',
      steps: [
        {
          role: 'required',
          when: 'verificationRequired=true 且用户继续并要求发送验证码',
          capabilityId: 'hr-organization-type-send-delete-code',
          mapping: { ids: 'result.ids' },
          instruction: '向配置手机号发送；不向调用方索要替代手机号。',
        },
        {
          role: 'optional',
          when: 'verificationRequired=false 且用户继续删除',
          capabilityId: 'hr-organization-type-remove',
          mapping: { ids: 'result.ids' },
          instruction: '传准备结果中的完整 ID 数组；remove 会重新读取敏感配置后再决定是否可直接 DELETE。',
        },
      ],
    },
  ),

  'hr-organization-type-send-delete-code': contract(
    '向当前敏感配置手机号发送组织类型批量删除验证码。',
    'write',
    { ids: idsInput, 'ids[]': idsItem },
    {
      shape: '{ smsRequestId: string }',
      fields: [
        field('$', 'object', '短信发送结果；不是删除结果'),
        field('smsRequestId', 'string', '后端短信发送记录 requestId；不是组织类型 ID 或 SDK 幂等键'),
      ],
      empty: '响应缺少 requestId 时抛错；短信可能已经发送，不能据此自动重发。',
    },
    [
      '只在用户继续删除并明确要求发送验证码时调用；验证码必须由真人收件人提供，不猜测。',
      '方法先重新读取敏感配置，只使用配置 mobile；后端按手机号限制一分钟一条。',
    ],
    {
      idempotency: '没有幂等包装；后端按手机号限制一分钟一条。超时可能已发送，先等待真人收件，不立即重发。',
      completion: '已取得短信发送记录标识；不表示真人已收件、验证码已通过或组织类型已删除。',
      steps: [{
        role: 'required',
        when: '真人提供本条短信的验证码并继续删除同一批组织类型',
        capabilityId: 'hr-organization-type-remove',
        mapping: { ids: 'args.ids', smsRequestId: 'result.smsRequestId', code: 'user.code' },
        instruction: 'code 必须来自真人收到的短信；保持同一批 ids 和本次 smsRequestId，不混用旧验证码。',
      }],
    },
  ),

  'hr-organization-type-remove': contract(
    '按当前敏感配置完成必要短信校验，并批量逻辑删除未被组织使用的组织类型。',
    'write',
    {
      ids: idsInput,
      'ids[]': idsItem,
      smsRequestId: param('本次短信发送记录标识，不是幂等键', 'hr-organization-type-send-delete-code.smsRequestId', {
        type: 'string',
        required: false,
        requiredWhen: '当前敏感配置要求短信验证',
        omitted: '仅当前配置不需要短信验证时可省略，否则 SDK 在 DELETE 前拒绝',
      }),
      code: param('真人收件人提供的短信验证码', '用户提供，不可推测', {
        type: 'string',
        required: false,
        requiredWhen: '当前敏感配置要求短信验证',
        omitted: '仅当前配置不需要短信验证时可省略，否则 SDK 在 DELETE 前拒绝',
        constraints: ['不得写入日志或文档'],
      }),
    },
    voidOutput,
    [
      'SDK 重新读取敏感配置；需要验证时 checkSms 成功后才发送 DELETE JSON ID 数组。',
      '后端先检查整批 ID 是否存在组织类型关联；任一被使用都会拒绝整批删除，不产生部分成功。',
      '成功后逐页读取并确认所选 ID 均不再出现在未删除列表；没有恢复已删除记录的页面动作。',
    ],
    {
      completion: 'DELETE 正常完成后仍需分页确认全部所选 ID 消失；回查完成前只能报告请求成功，不能报告删除已核实。',
      steps: [{
        role: 'required',
        when: 'DELETE 返回或超时，需要确认整批结果',
        capabilityId: 'hr-organization-type-list',
        mapping: {},
        instruction: '逐页读取到 total，按删除前保存的 ID 集合核对；全部消失才算删除已核实。名称筛选当前无效，不能只看传了 name 的第一页。',
      }],
      failures: [
        '后端返回“该类型正在被使用，无法删除”：整批未删除；刷新列表的 useNumber 与关联业务后再决定，不能绕过保护。',
        '缺少验证码或验证码错误：DELETE 未发送；取得本次有效验证码后才允许重试，不修改敏感配置绕过验证。',
        'DELETE 超时或网络失败：结果不确定；先完整分页核对所有 ID，未核实前不重发。',
      ],
    },
  ),
}

export const HR_ORGANIZATION_TYPE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(HR_ORGANIZATION_TYPE_METHODS).map(([capabilityId, method]) => [
    `hrOrganizationType.${method}`,
    {
      ...HR_ORGANIZATION_TYPE_AI_CONTRACTS[capabilityId]!,
      boundaries: [
        ...HR_ORGANIZATION_TYPE_AI_CONTRACTS[capabilityId]!.boundaries,
        '直接方法签名为单个参数对象；键名与 inputs 一致，list 可省略对象。',
      ],
    },
  ]),
)
