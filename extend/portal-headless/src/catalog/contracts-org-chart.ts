import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  HR_ORGANIZATION_CHART_METHODS,
  hrOrganizationChartCapabilities,
} from '../capabilities/org-chart.js'

const definitions = new Map(hrOrganizationChartCapabilities.map(definition => [definition.id, definition]))

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: true,
  nullable: true,
  ...extra,
})

const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning,
  source,
  required: true,
  ...extra,
})

const treeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('$', 'object[]', '当前会话在该 Portal 页面可见的启用组织树根节点数组'),
    field('[].id', 'string | number', '组织节点 ID；保留后端 Long 的原始字符串，不能用名称替代', { nullable: false, constraints: ['正整数或正整数字符串'] }),
    field('[].pid', 'string | number | null', '上级组织 ID；根节点通常为空或0，不能当作当前选中节点 ID'),
    field('[].name', 'string | null', '组织名称；页面下拉和树节点展示文本'),
    field('[].code', 'string | null', '组织编码；仅在后端返回时展示'),
    field('[].director', 'string | null', '组织负责人展示名称；服务端已将负责人 ID 格式化为姓名'),
    field('[].status', 'number | null', '组织状态；该接口只返回启用组织，若返回则1表示启用'),
    field('[].children', 'object[]', '直接下级组织节点；递归结构，继续按同一字段解释'),
    field('[].children[].id', 'string | number', '下级组织 ID；保留原始类型'),
    field('[].children[].name', 'string | null', '下级组织名称'),
    field('[].children[].children', 'object[]', '更深层直接下级；可能为空数组'),
  ],
  empty: '[] 表示当前会话没有可见的启用组织，不等于系统没有组织；权限、租户和数据范围仍由 Portal/Java 会话上下文决定。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [
    field('$', 'object', '组织架构导出的文件内存表示', { nullable: false }),
    field('fileName', 'string', '与Portal下载菜单同语义的文件名；含方向、规模、节点数和组织名'),
    field('contentType', 'string', '文件内容类型；纯文字为text/plain;charset=utf-8，Draw.io为application/xml;charset=utf-8'),
    field('base64', 'string', '文件内容的标准Base64；调用方负责落盘或传输'),
    field('byteLength', 'number', 'UTF-8文件原始字节数；大于0才算导出成功'),
  ],
  empty: '空根节点或空文件会在SDK本地校验阶段抛错；不要把没有下载内容解释成导出成功。',
}

const routeOutput: AiContract['output'] = {
  shape: '{ path: string }',
  fields: [
    field('$', 'object', 'Portal组织编辑页的本地路由准备结果', { nullable: false }),
    field('path', 'string', '固定为/dashboard/org/org-setting/edit/{id}的路由路径'),
  ],
  empty: '非法ID会在返回路由前抛错；该动作不发请求，也不表示组织已经被编辑或保存。',
}

const rootInput: Record<string, AiParameter> = {
  root: input('当前要导出的组织根节点对象。', 'hr-organization-chart-tree 返回的某个数组元素；先按用户选择确定具体节点，不要只传名称。', { type: 'object' }),
  'root.id': input('当前导出根组织的 ID。', 'root.id；保留字符串形式的长ID。', { type: 'string | number', constraints: ['正整数或正整数字符串'] }),
  'root.name': { meaning: '当前导出根组织名称。', source: 'root.name；只用于文件名和节点标签，不能代替root.id。', required: false, type: 'string | null', nullable: true },
  'root.children': { meaning: '当前根组织的下级树。', source: 'root.children；由tree接口返回，导出会递归消费，不重新请求或猜测下级。', required: false, type: 'object[]', nullable: true },
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main app/portal/menus/hr.js:80 与 app/portal/views/dashboard/hr/org/org-setting/chart.vue', kind: 'reference', note: '逐页核对菜单权限、组织树请求、首个根节点选择、导出菜单和双击编辑路由。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test HrOrganizationController#getRoleEnableOrganizationTree、HrOrganizationServiceImpl#getRoleEnableOrganizationTree、HrOrganizationDTO', kind: 'reference', note: '核对GET路径、启用状态、角色/负责人数据范围、TreeUtils层级构造及返回字段。' },
  { source: 'src/capabilities/org-chart.ts', kind: 'implementation', note: '锁定页面上下文、树响应、纯文字/Draw.io文件描述、本地编辑路由和错误边界。' },
  { source: 'test/org-chart.test.ts', kind: 'test', note: '离线核对Portal/Java源码、请求路径、树字段、两类导出、路由动作和AI契约反证。' },
]

const gaps = [
  '本轮已核对固定 Portal/Java 检出和离线请求夹具，并尝试打开真实测试环境；当前会话停留在登录页，未取得或读取凭据，尚未执行组织树读取或导出下载。',
  '导出是Portal前端本地生成文件，不涉及服务端写入；本轮未做真实浏览器文件落盘验证，调用方需自行保存SDK返回的base64。',
]

function base (id: string, purpose: string, effect: AiContract['effect'], output: AiContract['output'], inputs: Record<string, AiParameter>, consume: string[], steps: AiContract['steps'] = []): AiContract {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`组织架构契约缺少能力定义：${id}`)
  return {
    purpose,
    whenToUse: purpose,
    effect,
    boundaries: [
      '只覆盖Portal保留范围内的 hr/人力 → 组织管理 → 组织架构页面；不扩展到独立顶级生产、财务、采购、销售或科技页面。',
      '树接口只读；页面的导出由前端本地生成文件，双击只准备进入组织设置编辑路由，本节点不伪造组织新建、编辑、启停、删除或关系变更能力。',
      '组织可见性由当前用户、租户、角色组织数据范围和负责人关系共同决定；SDK不把空树解释成全量组织或无权限结论。',
    ],
    prerequisites: ['使用带有效会话token、租户和当前页面上下文的SDK；导出根节点必须来自同一次tree返回。'],
    inputs,
    output,
    consume,
    steps,
    completion: effect === 'local' ? '本地动作返回与Portal菜单/双击动作一致的文件或路由结果，不改变服务器业务数据。' : '返回当前会话可见的启用组织树；需要导出或打开编辑时只使用返回树中的节点。',
    failures: ['响应形状或节点ID非法时抛错，不返回空数组冒充失败；权限、租户、会话和网络错误原样交由调用方处理。', '导出前缺少根节点或方向非法时在本地失败，不发送额外请求。'],
    idempotency: null,
    evidence,
    gaps,
  }
}

export const HR_ORGANIZATION_CHART_AI_CONTRACTS: Record<string, AiContract> = {
  'hr-organization-chart-tree': base(
    'hr-organization-chart-tree',
    '读取组织架构页面实际使用的、有权限且处于启用状态的组织树。',
    'read',
    treeOutput,
    {},
    ['将根节点按name展示给用户；用户选定根节点后，把完整节点对象交给exportText或exportDrawIo。', '节点双击时使用节点id调用prepareEdit；不要把组织名称或code当作id。'],
    [
      { role: 'optional', when: '用户要求导出当前选中的组织树', capabilityId: 'hr-organization-chart-export-text', mapping: { root: 'user.selectedRoot' }, instruction: '纯文字导出时把tree返回的选中根节点原样传入。' },
      { role: 'optional', when: '用户要求导出当前选中的Draw.io组织架构图', capabilityId: 'hr-organization-chart-export-drawio', mapping: { root: 'user.selectedRoot', direction: 'user.direction' }, instruction: '方向只从vertical/horizontal中选择；把选中根节点原样传入。' },
      { role: 'optional', when: '用户双击组织节点进入编辑页', capabilityId: 'hr-organization-chart-prepare-edit', mapping: { id: 'user.selectedRoot.id' }, instruction: '只准备路由，不把路由结果解释为已读取或已保存详情。' },
    ],
  ),
  'hr-organization-chart-export-text': base(
    'hr-organization-chart-export-text',
    '复现组织架构页面“导出 → 纯文字树形”的本地文件生成动作。',
    'local',
    fileOutput,
    rootInput,
    ['将base64按fileName保存为UTF-8文本；文本包含组织名称、负责人/编码、总节点数、最大层级和导出时间。', '文件生成不代表组织数据被写入，也不代表当前用户获得了树外组织权限。'],
  ),
  'hr-organization-chart-export-drawio': base(
    'hr-organization-chart-export-drawio',
    '复现组织架构页面“导出 → Draw.io纵向/横向”的本地文件生成动作。',
    'local',
    fileOutput,
    { ...rootInput, direction: { meaning: 'Draw.io布局方向。', source: 'Portal导出菜单；省略时对应“Draw.io纵向”。', required: false, type: 'string', default: 'vertical', options: [{ value: 'vertical', label: 'Draw.io纵向' }, { value: 'horizontal', label: 'Draw.io横向' }] } },
    ['将base64按fileName保存为.drawio XML；vertical和horizontal只改变布局方向，不改变节点和连线语义。', '导出文件是当前选中根节点的本地树快照；不会重新请求或补全当前会话不可见节点。'],
  ),
  'hr-organization-chart-prepare-edit': base(
    'hr-organization-chart-prepare-edit',
    '复现组织架构节点双击后的组织编辑页路由准备动作。',
    'local',
    routeOutput,
    { id: input('组织节点ID。', 'hr-organization-chart-tree返回的节点id；不能用组织名称、编码或数组下标替代。', { type: 'string | number', constraints: ['正整数或正整数字符串'] }) },
    ['在支持Portal路由的宿主中打开path；如需详情字段，再使用组织设置页的detail能力。', '该结果只代表路由拼接成功，不代表编辑页已打开、详情读取成功或表单已提交。'],
  ),
}

export const HR_ORGANIZATION_CHART_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(HR_ORGANIZATION_CHART_METHODS).map(([capabilityId, method]) => [
    `hrOrganizationChart.${method}`,
    {
      ...HR_ORGANIZATION_CHART_AI_CONTRACTS[capabilityId]!,
      boundaries: [...HR_ORGANIZATION_CHART_AI_CONTRACTS[capabilityId]!.boundaries, `这是公开门面 sdk.hrOrganizationChart.${method}；需要交给能力调度时使用对应 capabilityId。`],
    },
  ]),
)
