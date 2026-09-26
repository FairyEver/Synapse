import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SETTING_CATEGORY_DICT_METHODS } from '../capabilities/setting-category-dict.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const idInput = param('分类字典节点主键；必须来自当前树中可见节点，不要把名称或编码当 ID。', 'setting-category-dict-list 的树节点 id', { type: 'string | number', required: true, constraints: ['正整数；长 ID 使用字符串，保留原始值。'] })
const parentInput = param('父级分类节点主键；租户页面只允许在租户可维护根及其后代下新增或移动子项。', 'setting-category-dict-list 的树节点 id', { type: 'string | number', required: true, constraints: ['正整数；根节点由平台维护，租户新增/修改不能传0。'] })

const draftInputs: Record<string, AiParameter> = {
  pid: parentInput,
  name: param('分类名称。', '用户输入；编辑时保留当前完整名称', { type: 'string', required: true, constraints: ['不能是空字符串；按 Java @NotEmpty 规则，SDK 不擅自 trim。'] }),
  code: param('分类编码；用于业务按编码定位分类时的标识。', '用户输入或当前树节点 code', { type: 'string | null', required: false, omitted: 'Portal 弹窗默认 null；SDK 未填写时提交 null', nullable: true }),
}

const nodeFields = (prefix: string): AiField[] => {
  const at = (key: string) => prefix ? `${prefix}.${key}` : key
  return [
    field(at('id'), 'string | number', '分类字典节点主键；用于修改和删除', { constraints: ['长整数可能以字符串返回'] }),
    field(at('pid'), 'string | number', '父级节点主键；0 表示平台根节点'),
    field(at('name'), 'string', '分类名称'),
    field(at('code'), 'string | null', '分类编码；null 表示未填写', { nullable: true, nullMeaning: '没有编码，不等于没有名称' }),
    field(at('tenantId'), 'string | number | null', '数据归属租户；0 表示平台共享，正数表示租户私有', { nullable: true, nullMeaning: '后端未返回归属；不能据此推断可写' }),
    field(at('platform'), 'boolean | null', '是否平台共享节点；平台节点在本页只允许添加下级', { nullable: true, nullMeaning: '后端未返回来源标记' }),
    field(at('tenantEditable'), '0 | 1 | null', '根节点是否允许租户维护下级；1 才允许租户写入该根下的子树', { nullable: true, nullMeaning: '子节点或后端未返回该标记' }),
    field(at('createTime'), 'string | number | null', '创建时间原值', { nullable: true, nullMeaning: '后端未返回创建时间' }),
    field(at('children'), 'object[]', '直接子节点数组；空数组表示当前节点没有已返回的子节点'),
  ]
}

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/common.js 与 app/portal/views/dashboard/hr/setting/category-dict/list.vue、components/ModalForm.vue @ 2cd9b0f37d', kind: 'reference', note: '证明菜单权限、platform 实例、onlyTenantEditable=true、树查询、行内编辑、弹窗新增/修改和 DELETE 路径。' },
  { source: 'CategoryDictController、CategoryDictSaveReqVO、CategoryDictRespVO、CategoryDictServiceImpl、CategoryDictMapper @ ecae93d9b50', kind: 'reference', note: '证明租户视角查询合并平台与当前租户、写入必须是当前租户非根节点、根 tenant_editable=1、名称/父级/编码/子节点约束和真实返回字段。' },
  { source: 'src/capabilities/setting-category-dict.ts 与 test/setting-category-dict.test.ts', kind: 'implementation', note: '证明 SDK 最终请求形状、表单默认 null、返回校验和离线反证；不替代真实环境写入回查。' },
]

const outputList: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('$', 'object[]', '分类字典树根节点数组'), ...nodeFields('[]'), ...nodeFields('[].children[]')],
  empty: '[] 表示当前租户可维护范围内没有树节点；权限/网络/后端错误会抛出，不能把失败解释为空树。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '后端 CommonResult<Boolean> 的业务成功值；不包含更新后的对象')],
  empty: '没有 true 或请求抛错都不能报告写入成功；成功后必须读取树核实。',
}

const idOutput = (label: string): AiContract['output'] => ({
  shape: 'string | number',
  fields: [field('$', 'string | number', label, { constraints: ['保留后端返回的原始 ID 形态'] })],
  empty: '没有返回有效 ID 时先查询树核实，不能盲目重建。',
})

const base = (effect: AiContract['effect'], purpose: string, inputs: Record<string, AiParameter>, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract => ({
  purpose,
  whenToUse: purpose,
  boundaries: [
    '只覆盖门户“系统设置 → 分类字典”树管理页；不覆盖平台“平台设置 → 分类字典”页面，两个页面的租户归属和 API 前缀不同。',
    '列表固定使用 platform HTTP 实例和 /admin-api/system/category-dict/tree；页面模块类型推导为空，浏览器不发送 module-type。',
    '页面只展示 tenant_editable=1 根及其后代；平台节点/根节点的写权限由页面动作和后端租户归属共同裁决，菜单可见不等于后端写权限。',
    '当前证据来自固定 Portal/Java 源码和离线请求夹具，尚未在真实测试环境执行本页浏览器读请求及可逆写入回查。',
  ],
  effect,
  prerequisites: ['使用带当前用户会话 token、tenantId 的 SDK；写操作的 id/pid 来自当前树读取，且用户确认了完整 name/code。'],
  inputs,
  output,
  consume,
  steps: [],
  completion: '交付本能力真实返回的数据；写操作返回 true/新 ID 仍需按后续步骤读取树核实终态。',
  failures: ['参数、父节点、租户归属、根 tenant_editable、子节点存在、权限、网络或后端业务错误原样抛出；不能把失败降级为空树或 true。'],
  idempotency: effect === 'write' ? '没有后端 requestId 幂等保证；请求超时先查询树核实，不能盲目重复创建、覆盖或删除。' : null,
  evidence,
  gaps: ['未启动真实 Portal 页面完成读操作；未在安全测试数据上记录 create/update/delete 的 prepare → submit → verify → cancel/cleanup 闭环。该页后端没有通用 cancel 接口。'],
  ...extra,
})

export const SETTING_CATEGORY_DICT_AI_CONTRACTS: Record<string, AiContract> = {
  'setting-category-dict-list': base('read', '查询当前租户可维护范围内的分类字典树。', {
    name: param('名称筛选片段；页面按名称模糊匹配。', '用户输入', { type: 'string', required: false, omitted: 'SDK 发空字符串表示不按名称筛选' }),
    code: param('编码筛选值；页面按编码匹配。', '用户输入', { type: 'string', required: false, omitted: 'SDK 发空字符串表示不按编码筛选' }),
    onlyTenantEditable: param('是否只返回租户可维护根及其后代。', 'Portal 页面隐藏配置', { type: 'boolean', required: false, default: 'true', constraints: ['页面默认 true；传 false 会请求后端的全量租户视角树，不等同于页面默认可见范围。'] }),
  }, outputList, ['展示每个节点的 name、code、id 和 children；platform=true 或 pid=0 的节点不能直接作为租户修改/删除目标。', '创建或修改前从树中选择父节点和当前行，保留完整 id、pid、name、code；不要把 tenantId、platform 或 tenantEditable 当作写入字段。'], {
    completion: '交付当前筛选树；空树只代表筛选/可维护范围没有节点，不代表权限失败。',
    steps: [{ role: 'optional', when: '用户要新增下级分类', capabilityId: 'setting-category-dict-create', mapping: { pid: '[].id', name: 'user.name', code: 'user.code' }, instruction: '从选中的树节点取 id 作为 pid；平台或不可维护根由后端拒绝时如实报告。' }],
  }),
  'setting-category-dict-create': base('write', '在当前租户可维护的分类字典父节点下创建一个子分类。', { ...draftInputs }, idOutput('新建分类字典子节点 ID'), ['保留返回 ID，并重新查询树，按 pid、name、code 精确匹配；成功回查后才能报告创建完成。'], {
    completion: 'POST 返回有效 ID 且树回查确认新节点出现后，才算创建已验证。',
    steps: [{ role: 'required', when: '创建成功或超时需要核实', capabilityId: 'setting-category-dict-list', mapping: { name: 'args.name', code: 'args.code' }, instruction: '按父节点、名称和编码核对唯一新节点；没有匹配或出现多个匹配时报告结果不确定。' }],
  }),
  'setting-category-dict-update': base('write', '按 Portal 弹窗或行内编辑规则完整修改一个租户自有的分类字典子节点。', { id: idInput, ...draftInputs }, trueOutput, ['提交完整 id、pid、name、code；不能修改平台节点或根节点，后端会校验租户归属和根可维护性。', '成功后重新查询树并按 id 逐字段核对。'], {
    completion: 'PUT 返回 true 且树回查确认 id、pid、name、code 均为新值后，才算修改已验证。',
    steps: [{ role: 'required', when: '修改成功或超时需要核实', capabilityId: 'setting-category-dict-list', mapping: { name: 'args.name', code: 'args.code' }, instruction: '在递归树中查找同一 id，核对父级、名称和编码；不能只看 true 回执。' }],
  }),
  'setting-category-dict-remove': base('write', '删除一个当前租户自有且没有子节点的分类字典子节点。', { id: idInput }, trueOutput, ['页面删除请求是 DELETE /delete/{id}，不递归删除子节点；后端发现子节点、平台节点或非本租户节点会失败。', '成功后重新查询树，确认目标 id 已消失；不能把删除类型解释成清理了关联业务数据。'], {
    completion: 'DELETE 返回 true 且树回查确认目标 ID 不再出现后，才算删除已验证。',
    steps: [{ role: 'required', when: '删除成功或超时需要核实', capabilityId: 'setting-category-dict-list', instruction: '递归检查整棵返回树，不要只检查根节点或当前展开层。' }],
  }),
}

export const SETTING_CATEGORY_DICT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_CATEGORY_DICT_METHODS).map(([id, method]) => [`settingCategoryDict.${method}`, SETTING_CATEGORY_DICT_AI_CONTRACTS[id]!]),
)
