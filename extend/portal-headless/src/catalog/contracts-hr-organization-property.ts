import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { HR_ORGANIZATION_PROPERTY_METHODS } from '../capabilities/hr-organization-property.js'

const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })

const idInput = param('组织属性记录主键；不是组织 ID，也不是属性编码 code', 'hr-organization-property-list 的用户所选 list[].id', {
  type: 'string | number',
  required: true,
  constraints: ['正安全整数或无前导零的正整数字符串；长 ID 保留字符串'],
})
const currentStatusInput = param('用户所选列表行的当前状态原值；用于复现 PC 按钮显示条件，不是期望写入的新状态', '与 id 来自同一次最新 hr-organization-property-list 的 list[].status', {
  type: 'integer',
  required: true,
  options: [{ value: 0, label: '已作废' }, { value: 1, label: '启用' }],
})
const useNumberInput = param('所选组织属性当前关联组织数量；只有严格为数值 0 时 PC 才显示“作废”', '与 id 来自同一次最新 hr-organization-property-list 的 list[].useNumber', {
  type: 'integer',
  required: true,
  constraints: ['非负整数；不能把缺失、字符串“0”或旧缓存当成数值 0'],
})
const draftInputs: Record<string, AiParameter> = {
  name: param('组织属性名称；SDK 保留首尾空格，不自动修剪', '用户填写创建表单', {
    type: 'string',
    required: true,
    constraints: ['必填、不得全为空格、最多 20 个字符；后端拒绝当前未删除记录中的同名名称'],
  }),
  code: param('组织编码；是业务编码，不是记录主键 id', '用户填写创建表单', {
    type: 'string',
    required: true,
    constraints: ['必填、不得全为空格、最多 10 个字符；后端拒绝当前未删除记录中的重复编码'],
  }),
  remark: param('备注', '用户填写创建表单', {
    type: 'string',
    required: false,
    omitted: 'SDK 发送空字符串，与 PC 新建表单默认值一致',
    constraints: ['最多 50 个字符；空字符串表示未填写，非空值不得全为空格'],
  }),
}

function rowFields (prefix: string): AiField[] {
  const at = (name: string) => prefix ? `${prefix}.${name}` : name
  return [
    field(at('id'), 'string | number', '组织属性记录主键，用于作废或启用；不是组织 ID，也不是 code'),
    field(at('name'), 'string', '组织属性名称，页面原文显示'),
    field(at('code'), 'string', '组织编码，页面原文显示；保留可能存在的前导零'),
    field(at('remark'), 'string', '备注；null 或空字符串都表示未填写，页面显示横杠', { nullable: true, nullMeaning: '未填写备注，页面显示横杠' }),
    field(at('status'), 'integer', '组织属性状态，也是行按钮显示条件', { values: { '0': '已作废，PC 显示“启用”', '1': '启用；且 useNumber=0 时 PC 显示“作废”' }, constraints: ['未知值不得猜成启用或已作废，也不得显示状态写按钮'] }),
    field(at('useNumber'), 'integer', '当前关联该属性的组织数量；0 才允许从启用状态作废', { constraints: ['非负整数；这是关系计数，不是属性使用次数累计值'] }),
  ]
}

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', 'SDK 忽略后端无页面业务数据的成功结果；没有返回新建 ID、旧状态或布尔成功标志')],
  empty: '成功时根值为 undefined，JSON 无法编码根 undefined；调用方以 Promise 正常完成识别请求成功，失败抛错。',
}

const evidence: AiContract['evidence'] = [
  {
    source: 'app/portal/views/dashboard/hr/org/org-propType/list.vue 与 [mode]/[id].vue @ d3cf56bdc76c',
    kind: 'reference',
    note: '证明名称筛选/分页、新建字段、作废与启用按钮条件、请求路径；批量删除代码已注释且列表无编辑入口。该固定检出本轮因网络不可达未能拉取远端。',
  },
  {
    source: 'HrOrganizationPropertyController、ServiceImpl、Dao.xml @ test/test dcb3f360194',
    kind: 'reference',
    note: '证明名称包含查询、名称/编码重复校验、分页字段与固定排序、updateStatus 绝对赋值；后端保留的删除接口不等于 PC 当前可达能力。',
  },
  {
    source: 'baseline/hr-organization-property.browser.json',
    kind: 'browser',
    note: '2026-09-22 测试环境 PC：列表、新建、精确回查、作废、启用、恢复后回查；所有业务请求带 module-type 11。临时记录 179 最终仅通过受控清理调用已注释的删除接口移除，精确名称回查 0；删除未发布为能力。',
  },
  {
    source: 'src/capabilities/hr-organization-property.ts',
    kind: 'implementation',
    note: 'SDK 请求投影、PC 状态按钮前置校验与最终返回形状；实现本身不是线上验证。',
  },
  {
    source: 'test/hr-organization-property.test.ts',
    kind: 'test',
    note: '离线锁定逐字段请求、页面字段投影、状态保护和 AI 步骤映射；不发真实网络请求。',
  },
  {
    source: 'smoke/with-portal-token.sh + createPortalHeadless 公开门面（2026-09-22）',
    kind: 'smoke',
    note: '真实测试环境以唯一临时名称完成 list 起手为空 → create → 精确回查 → invoke(deactivate) → 回查 status=0 → 公开方法 enable → 回查 status=1，并核对 catalog.describe/describeMethod；最后仅删除自建记录且回查 0。凭据只在受控子进程环境中使用。',
  },
]

function contract (
  purpose: string,
  effect: AiContract['effect'],
  inputs: Record<string, AiParameter>,
  output: AiContract['output'],
  consume: string[],
  extra: Partial<AiContract> = {},
): AiContract {
  return {
    purpose,
    whenToUse: '操作人力系统“组织管理 → 组织属性”页面；不用于财务设置中的同名组织属性页面，也不管理具体组织与属性的关联关系。',
    boundaries: [
      '仅覆盖当前 PC 正常可达的名称查询/分页、新建、作废与启用。列表批量删除和选择代码已注释，列表也没有编辑/详情入口，因此不发布删除、读取详情或修改能力。',
      '使用 platform HTTP 实例、当前会话用户/租户及组织管理 module-type 11；2026-09-22 浏览器已确认列表、新建和两次状态请求均带该头。',
      '作废/启用前置条件来自调用方传入的同一条最新列表行；SDK 不锁记录，条件校验后到后端写入前仍可能发生并发变化。后端 updateStatus 只按 id 绝对赋值，不独立复核 useNumber。',
    ],
    effect,
    prerequisites: ['已创建带会话 token 与 tenantId 的 SDK；账号须有页面对应服务权限，菜单可见不替代后端鉴权。'],
    inputs,
    output,
    consume,
    steps: [],
    completion: '返回当前请求结果并按契约指定的列表回查交付；写请求成功本身不替代业务状态核实。',
    failures: [
      '本地 ID、分页、表单或状态前置条件不合法：SDK 在发请求前拒绝；重新读取列表并按当前行值修正后再决定。',
      '401/403、登录、权限、网络或后端业务失败：错误抛出，不当作空列表或写入成功；读请求恢复后可重试。',
      '后端可能用同类失败包络报告不同业务错误；按消息与独立回查处理，不能只凭 HTTP/业务 code 猜唯一原因。',
      '写请求超时或断网：结果不确定，先按名称或 ID 完整分页回查；未核实前不要重复创建或反向切换状态。',
    ],
    idempotency: effect === 'write' ? '没有 SDK requestId 或后端幂等键；具体重试边界见本动作说明，超时先列表回查。' : null,
    evidence,
    gaps: [],
    ...extra,
  }
}

export const HR_ORGANIZATION_PROPERTY_AI_CONTRACTS: Record<string, AiContract> = {
  'hr-organization-property-list': contract(
    '分页查询当前租户未删除的组织属性，并按名称包含匹配。',
    'read',
    {
      name: param('组织属性名称包含匹配关键字', '用户输入', { type: 'string', required: false, omitted: 'SDK 发送空字符串，不限制名称' }),
      pageNo: param('页码，从 1 开始', '调用方分页状态', { type: 'integer', required: false, omitted: 'SDK 默认 1', constraints: ['正整数'] }),
      pageSize: param('当前页记录数', '调用方分页状态', { type: 'integer', required: false, omitted: 'SDK 默认 20，与 PC styleV2 一致', constraints: ['1 至 500 的整数；不接受 -1 全量'] }),
      order: param('renren 排序方向兼容字段', '调用方排序状态', { type: 'string', required: false, omitted: 'SDK 发送空字符串', constraints: ['页面没有列排序控件；后端固定按 create_time、id 升序，不承诺此字段改变顺序'] }),
      orderField: param('renren 排序字段兼容字段', '调用方排序状态', { type: 'string', required: false, omitted: 'SDK 发送空字符串', constraints: ['页面没有列排序控件，不自行猜测后端列名'] }),
    },
    {
      shape: '{ list: object[], total: integer }',
      fields: [field('$', 'object', '组织属性分页结果'), field('list', 'array', '本次当前页记录，不是全部记录'), field('list[]', 'object', '一条组织属性，只保留页面展示与动作需要字段'), ...rowFields('list[]'), field('total', 'integer', '相同名称条件下未删除记录的总数，不是当前页条数')],
      empty: 'list=[] 表示当前页无记录；total=0 才表示当前名称筛选无记录。权限或网络失败抛错。',
    },
    [
      '展示 name、code、remark；remark 为 null 或空串时显示横杠。id 不作为业务编码展示。',
      'status=1 且 useNumber=0 才提供作废；status=0 才提供启用。其它组合不调用状态写能力。',
      '按 pageNo/pageSize 翻页，累计读取达到 total 后停止；不要把一页当成全部。',
    ],
    {
      completion: '交付用户要求的当前页或完成明确筛选范围的分页；没有创建或改变状态。',
      steps: [
        { role: 'optional', when: '用户选中的行 status=1 且 useNumber=0，并明确要作废', capabilityId: 'hr-organization-property-deactivate', mapping: { id: 'result.list[].id', currentStatus: 'result.list[].status', useNumber: 'result.list[].useNumber' }, instruction: '只传用户选定的一行；三个值必须来自同一条最新列表记录，不能混用其它行或旧缓存。' },
        { role: 'optional', when: '用户选中的行 status=0，并明确要重新启用', capabilityId: 'hr-organization-property-enable', mapping: { id: 'result.list[].id', currentStatus: 'result.list[].status' }, instruction: '只传用户选定的一行；id 与状态来自同一条最新列表记录。' },
      ],
    },
  ),

  'hr-organization-property-create': contract(
    '创建组织属性，保存名称、组织编码和备注。',
    'write',
    draftInputs,
    voidOutput,
    ['成功没有返回新 ID；按 name 查询并完成分页，再以精确 name 与 code 识别新记录，不能按模糊结果第一条认领。'],
    {
      completion: 'Promise 完成只表示保存请求成功；精确名称与编码唯一匹配、表单值一致后才能报告创建已核实。',
      idempotency: '没有 SDK 或后端幂等键。后端名称/编码重复校验不是幂等回执；超时先按 name 查询并精确核对 code/remark，不能盲目重建。',
      steps: [{ role: 'required', when: '保存完成或超时后核实是否创建', capabilityId: 'hr-organization-property-list', mapping: { name: 'args.name' }, instruction: '完成该名称筛选的分页，以精确 name 和 code 匹配；多个候选、字段不符或没有记录时都不能猜创建成功。' }],
    },
  ),

  'hr-organization-property-deactivate': contract(
    '把当前启用且未关联任何组织的组织属性作废，将状态设置为 0。',
    'write',
    { id: idInput, currentStatus: { ...currentStatusInput, constraints: ['必须严格为数值 1；SDK 不接受 0、字符串或未知值'] }, useNumber: useNumberInput },
    voidOutput,
    ['作废不会删除记录；后续列表应保留同一 id、status=0，并显示“启用”。'],
    {
      completion: '完整分页回查同一 id 的 status=0 后才报告作废已核实；记录仍存在。',
      idempotency: '后端是把 status 绝对设置为 0，重复请求的目标状态相同，但没有 requestId；超时先列表核实，已为 0 时不再重发。SDK 只接受调用前 currentStatus=1、useNumber=0。',
      steps: [{ role: 'required', when: '作废请求完成或超时后核实状态', capabilityId: 'hr-organization-property-list', mapping: {}, instruction: '沿用调用前保存的 id，必要时完整分页定位同一记录；必须看到 status=0。' }, { role: 'cancel', when: '作废已核实且用户明确要求恢复', capabilityId: 'hr-organization-property-enable', mapping: { id: 'args.id', currentStatus: 'literal:0' }, instruction: '先用列表确认同一 id 当前确为 0，再执行启用；这是一次新的写入，不是事务回滚。' }],
    },
  ),

  'hr-organization-property-enable': contract(
    '把当前已作废的组织属性重新启用，将状态设置为 1。',
    'write',
    { id: idInput, currentStatus: { ...currentStatusInput, constraints: ['必须严格为数值 0；SDK 不接受 1、字符串或未知值'] } },
    voidOutput,
    ['启用不会新增记录或改变 name/code/remark；回查同一 id 的 status 应为 1。是否显示“作废”还取决于最新 useNumber 是否为 0。'],
    {
      completion: '完整分页回查同一 id 的 status=1 后才报告启用已核实。',
      idempotency: '后端是把 status 绝对设置为 1，重复请求的目标状态相同，但没有 requestId；超时先列表核实，已为 1 时不再重发。SDK 只接受调用前 currentStatus=0。',
      steps: [{ role: 'required', when: '启用请求完成或超时后核实状态', capabilityId: 'hr-organization-property-list', mapping: {}, instruction: '沿用调用前保存的 id，必要时完整分页定位同一记录；必须看到 status=1。用户随后又要作废时，必须从这次最新列表行重新取得 status 与 useNumber，不能复用启用前的旧值。' }],
    },
  ),
}

export const HR_ORGANIZATION_PROPERTY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(HR_ORGANIZATION_PROPERTY_METHODS).map(([capabilityId, method]) => {
    const source = HR_ORGANIZATION_PROPERTY_AI_CONTRACTS[capabilityId]!
    return [`hrOrganizationProperty.${method}`, {
      ...source,
      boundaries: [...source.boundaries, `公开方法 hrOrganizationProperty.${method} 接受单个对象参数；list 可省略对象，字段与 inputs 一致。invoke 始终使用 inputs 对象。`],
    }]
  }),
)
