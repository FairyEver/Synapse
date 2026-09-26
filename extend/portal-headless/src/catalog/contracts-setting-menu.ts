import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SETTING_MENU_METHODS, settingMenuCapabilities } from '../capabilities/setting-menu.js'

const definitions = new Map(settingMenuCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const menuFields: AiField[] = [
  field('id', 'string | number', '菜单主键；Portal 对 Long 使用字符串序列化，后续详情、修改和删除保留原值'),
  field('pid', 'string | number', '父菜单主键；0 表示一级菜单'),
  field('name', 'string | null', '菜单名称', { nullable: true, nullMeaning: '后端未返回名称' }),
  field('url', 'string | null', '菜单 URL', { nullable: true, nullMeaning: '未配置 URL' }),
  field('menuType', 'integer | null', '菜单类型；Java 约定0=菜单、1=按钮', { nullable: true, nullMeaning: '后端未返回类型' }),
  field('permissions', 'string | null', '授权标识；多个值以逗号分隔', { nullable: true, nullMeaning: '未配置授权标识' }),
  field('useSystem', 'integer | null', '使用系统编号；Portal 显示时按系统字典映射', { nullable: true, nullMeaning: '后端未返回系统编号' }),
  field('project', 'integer | null', '人力项目编号；非人力系统可能为空', { nullable: true, nullMeaning: '没有项目归属' }),
  field('icon', 'string | null', '菜单图标', { nullable: true, nullMeaning: '未配置图标' }),
  field('sort', 'integer | null', '菜单排序值', { nullable: true, nullMeaning: '后端未返回排序' }),
  field('createDate', 'string | number | null', '创建时间原值', { nullable: true, nullMeaning: '后端未返回创建时间' }),
  field('parentName', 'string | null', '父菜单名称', { nullable: true, nullMeaning: '后端未返回父菜单名称' }),
  field('children', 'object[]', '递归子菜单；空数组表示当前节点没有已返回子节点'),
]

const arrayOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('$', 'object[]', '不区分系统的菜单树根节点数组'), ...menuFields.map(item => ({ ...item, path: `[].${item.path}` })), ...menuFields.filter(item => item.path === 'id' || item.path === 'pid' || item.path === 'name' || item.path === 'children').map(item => ({ ...item, path: `[].children[].${item.path}` }))],
  empty: '[] 表示后端返回空菜单树；权限、登录、网络或坏响应会抛出，不能把失败解释成没有菜单。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '后端成功回执；不包含修改后的菜单对象')],
  empty: '没有 true 或请求抛错都不能报告写操作成功；必须调用菜单列表回查。',
}

const idOutput: AiContract['output'] = {
  shape: 'string | number',
  fields: [field('$', 'string | number', '后端新建菜单 ID；保留原始类型')],
  empty: '没有有效 ID 时先查询菜单树核实，不能盲目重复创建。',
}

const gaps = ['已核对 Portal 页面、Java Controller/DTO/Service、SDK 请求形状和离线负例；尚未在真实测试环境执行本页浏览器读请求及写入回查。']

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Setting menu contract has no definition: ${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: parameter.kind === 'number' ? 'number' : parameter.kind === 'boolean' ? 'boolean' : 'string',
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: 'Portal 菜单管理树、创建表单或当前用户提供的完整菜单数据；按能力参数契约填写。',
  }]))
}

const contracts: Record<string, AiContract> = {}
function add (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): void {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Setting menu contract has no capability: ${id}`)
  contracts[id] = {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只覆盖 Portal“系统设置 → 菜单管理”及其可达的菜单创建、编辑、批量修改、树导入和删除动作；页面导出 JSON/文本是浏览器本地下载，不伪造为服务端 SDK 能力。',
      '列表、详情和写请求都使用 platform HTTP 实例，页面路径不命中 module-type 规则；调用方不能另拼 module-type 或切换租户。',
      'Portal 菜单管理页的新增、修改、删除按钮只在 VITE_API_ENV_NAME=dev 时显示；Java Controller 上的旧权限注解是注释状态，SDK 仍必须依赖当前会话后端权限，不能把环境按钮状态当作授权绕过。',
      '删除父菜单时 Portal 按后序遍历逐个调用 DELETE /admin-api/sys/menu/{id}，中途失败会留下已删除部分；该动作不是事务性级联删除。',
      '菜单树导入和批量创建是逐条请求；树导入某个节点失败时 Portal 记录失败并跳过该节点的子树，后续同级节点继续执行。',
    ],
    effect: definition.write ? 'write' : 'read',
    prerequisites: ['使用当前用户会话 token；ID、父级、useSystem 和 project 来自当前菜单树或用户确认的完整表单，不凭名称猜 ID。'],
    inputs: { ...inputsOf(id), ...extra.inputs },
    output,
    consume,
    steps: [],
    completion: '返回值符合本能力结构；写操作还必须按步骤回查最终菜单树。',
    failures: ['名称/父级校验、父菜单不存在、存在子菜单、权限、登录、网络或后端业务错误原样报告；不能降级为空树、空 ID 或假成功。'],
    idempotency: definition.write ? '页面请求没有 requestId 幂等协议；响应超时先读取菜单树核实，不能盲目重复创建、逐条删除或覆盖修改。' : null,
    evidence: [
      { source: 'app/portal/menus/common.js、app/portal/views/dashboard/hr/setting/menu/list.vue、[mode]/[id].vue、components/edit-multiple-value.vue、composables/useTreeDelete.js、composables/useJsonMenuImport.js @ bbcfc35154', kind: 'reference', note: '证明菜单权限、非生产写按钮、请求方法/路径、表单默认值、批量和树动作顺序。' },
      { source: 'HrSysMenuController、HrSysMenuServiceImpl、SysMenuDTO、SysMenuDao.xml @ b7a359adc9e', kind: 'reference', note: '证明菜单树查询、Long ID、Java 表单校验、父菜单递归树和删除子节点限制。' },
      { source: 'src/capabilities/setting-menu.ts 与 test/setting-menu.test.ts', kind: 'implementation', note: '证明 SDK 最终请求形状、输入校验、逐条顺序和离线反证；不替代真实环境写入验证。' },
    ],
    gaps: [...gaps],
    ...extra,
  }
}

add('setting-menu-list', '读取 Portal 菜单管理页展示的不区分系统菜单树。', arrayOutput, ['递归消费 `children`；用节点的 id、pid、name、permissions、useSystem 和 project 做定位与展示，不把树误当分页列表。'])
add('setting-menu-get', '读取一个菜单的完整详情，用于编辑前取得完整字段。', { shape: 'object', fields: menuFields, empty: '后端不会把详情错误降级为空对象；缺失字段按字段 null 语义解释。' }, ['保留完整返回对象用于 update；编辑只改变用户确认的字段，不能用列表展示值覆盖未读取字段。'], { inputs: { id: param('菜单 ID。', 'setting-menu-list 返回的节点 id', { type: 'string | number', required: true }) }, steps: [{ capabilityId: 'setting-menu-list', role: 'required', when: '详情 ID 来自当前树', instruction: '确认该 ID 属于当前会话返回的菜单树；不要使用同名菜单的猜测 ID。' }] })
add('setting-menu-create', '按菜单新增表单创建一个菜单或一个子菜单。', idOutput, ['保存返回的 ID，并调用 list 递归回查新节点的 name、pid、permissions、useSystem 和 project。'], { inputs: { name: param('菜单名称；Java @NotBlank，不能为空或全空格。', '用户填写或批量节点 title', { type: 'string', required: true }), pid: param('父菜单 ID；0 表示一级菜单。', '当前菜单树节点 id 或表单“设置为一级菜单”', { type: 'string | number', required: true }), permissions: param('授权标识；Portal 未填写时提交空字符串。', '用户填写', { type: 'string', required: false, default: "''" }), useSystem: param('使用系统编号。', 'Portal 系统下拉或父菜单 useSystem', { type: 'number | null', required: false }), project: param('人力/学习项目编号；非人力系统可能为空。', 'Portal 项目下拉或父菜单 project', { type: 'number | null', required: false }) }, steps: [{ capabilityId: 'setting-menu-list', role: 'required', when: '创建成功或响应超时', mapping: {}, instruction: '查找唯一匹配的新 ID；核对父级和权限标识，不能只看返回 ID。' }] })
add('setting-menu-create-many', '复刻 Portal“新建多条”或批量添加子菜单的逐条创建动作。', { shape: 'string[]', fields: [field('[]', 'string | number', '按请求顺序返回的菜单 ID')], empty: '空 items 才是无操作；请求中途失败不会伪造剩余 ID，错误会在失败处抛出。' }, ['按返回 ID 顺序回查每一条；批量请求不是事务，前面已成功的菜单不会因后续失败自动回滚。'], { inputs: { items: param('完整菜单创建行数组；每行对应一次 POST /admin-api/sys/menu。', 'Portal 新建多条表单或选中的父菜单与子菜单定义', { type: 'object[]', required: true, constraints: ['非空；每行 name、pid 必填。'] }) }, steps: [{ capabilityId: 'setting-menu-list', role: 'required', when: '批量创建结束或中途失败', instruction: '按每行 name、pid 和 permissions 回查已成功与未成功的行，分别报告。' }] })
add('setting-menu-import-tree', '按 Portal JSON 导入功能递归创建菜单树。', { shape: '{ created: object[], failed: object[] }', fields: [field('created', 'object[]', '已创建节点；每项含 path 和 id'), field('created[].path', 'string', '从导入根到该节点的标题路径'), field('created[].id', 'string | number', '该节点新 ID'), field('failed', 'object[]', '创建失败节点；每项含 path 和 error'), field('failed[].path', 'string', '失败节点路径'), field('failed[].error', 'string', '原始错误文本')], empty: 'created=[] 且 failed=[] 只可能在输入校验前被拒绝，不表示导入成功。' }, ['created 逐项回查；failed 节点的 children 不会被创建，后续同级节点仍可能成功，不能报告整棵树原子成功。'], { inputs: { nodes: param('title/permission/children 组成的非空菜单树。', 'Portal JSON 导入文本解析后的数组', { type: 'object[]', required: true }), pid: param('导入根节点的父菜单 ID；0 表示一级。', '创建表单当前 pid', { type: 'string | number', required: true }), useSystem: param('全部导入节点使用的系统编号。', '创建表单当前 useSystem', { type: 'number', required: true }), project: param('全部导入节点使用的项目编号。', '创建表单当前 project', { type: 'number | null', required: false }) }, steps: [{ capabilityId: 'setting-menu-list', role: 'required', when: '导入结束', instruction: '按 created path 和每个新 ID 核对层级；把 failed 逐项交付给用户。' }] })
add('setting-menu-update', '修改菜单名称、授权标识或父级，复刻 Portal 单条编辑与搜索移动请求。', trueOutput, ['成功后用 list 按 id 递归回查完整字段；只更新用户确认的绝对值，不把它解释为增量 patch。'], { inputs: { id: param('菜单 ID。', 'setting-menu-list 或 setting-menu-get 返回的 id', { type: 'string | number', required: true }), name: param('完整菜单名称。', 'setting-menu-get 返回值或用户确认', { type: 'string', required: true }), pid: param('新的父菜单 ID；0 表示一级。', '当前菜单树或用户确认的父节点', { type: 'string | number', required: true }), permissions: param('完整授权标识。', '当前详情或用户输入', { type: 'string', required: false, default: "''" }), useSystem: param('使用系统编号。', '当前详情', { type: 'number | null', required: false }), project: param('项目编号。', '当前详情', { type: 'number | null', required: false }) }, steps: [{ capabilityId: 'setting-menu-list', role: 'required', when: '修改成功或响应超时', mapping: {}, instruction: '在递归树中查找同一 id，逐字段核对 name、pid、permissions、useSystem 和 project。' }] })
add('setting-menu-update-many', '复刻 Portal 批量修改名称或授权标识的逐条 PUT 动作。', { shape: 'string[]', fields: [field('[]', 'string | number', '已完成 PUT 的菜单 ID，按请求顺序返回')], empty: 'items=[] 表示没有字段发生变化，Portal 不发送请求。' }, ['逐条核对返回 ID；中途失败时，之前成功的行已经生效，不是事务回滚。'], { inputs: { items: param('需要提交的完整菜单修改行数组；只放发生字段变化的行。', 'Portal 批量修改预览结果', { type: 'object[]', required: true }) }, steps: [{ capabilityId: 'setting-menu-list', role: 'required', when: '批量修改结束或中途失败', instruction: '按每个 ID 读回，区分已修改、未修改和响应不确定的行。' }] })
add('setting-menu-remove', '删除菜单节点；若传入当前节点的 children，按 Portal 后序遍历逐个删除整棵子树。', trueOutput, ['成功后 list 递归确认所有目标 ID 已消失；中途失败必须报告已处理的部分，不把部分删除说成整棵完成。'], { inputs: { id: param('待删除菜单 ID。', 'setting-menu-list 返回节点 id', { type: 'string | number', required: true }), children: param('当前节点的递归子节点；删除父节点时必须传入完整树，页面会先删叶子。', 'setting-menu-list 返回的 children', { type: 'object[]', required: false }) }, steps: [{ capabilityId: 'setting-menu-list', role: 'required', when: '删除成功或结果不确定', instruction: '递归查找所有原目标 ID；确认全部消失，未消失的逐个报告。' }] })

export const SETTING_MENU_AI_CONTRACTS = contracts
export const SETTING_MENU_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_MENU_METHODS).map(([id, method]) => [`settingMenu.${method}`, { ...SETTING_MENU_AI_CONTRACTS[id]!, boundaries: [...SETTING_MENU_AI_CONTRACTS[id]!.boundaries, '直接方法签名使用单个对象参数；批量和树导入字段按 inputs 中的嵌套结构填写。'] }]),
)
