import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { TECHNOLOGY_TYPE_TEMPLATE_MAPPING_METHODS } from '../capabilities/technology-type-template-mapping.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: false,
  nullable: false,
  ...extra,
})
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const statusOptions = [{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]
const projectTypeId = input('项目类型记录主键；不是项目类型编码', 'technology-type-template-mapping-references.projectTypes[].id，由用户选定候选', {
  type: 'string | number',
  required: true,
  lookup: { capabilityId: 'technology-type-template-mapping-references', args: {}, valueField: 'projectTypes[].id', labelField: 'projectTypes[].typeName' },
})
const versionId = input('已发布模板版本主键；必须来自与项目类型projectDomain相同的候选版本', 'technology-type-template-mapping-references.publishedVersions[].id，由用户选定候选', {
  type: 'string | number',
  required: true,
  lookup: { capabilityId: 'technology-type-template-mapping-references', args: {}, valueField: 'publishedVersions[].id', labelField: 'publishedVersions[].versionName' },
})
const startTime = input('生效开始时间；页面含该时刻', '用户在日期时间控件选择；提交为字符串', {
  type: 'string',
  required: true,
  format: 'YYYY-MM-DD HH:mm:ss',
  constraints: ['只做页面格式校验，不做时区转换；不能省略时分秒'],
})
const endTime = input('生效结束时间；页面按不含该时刻展示', '用户在可清空的日期时间控件选择；清空传null', {
  type: 'string',
  required: false,
  nullable: true,
  format: 'YYYY-MM-DD HH:mm:ss',
  omitted: '新增默认null；编辑省略则保留current值',
  nullMeaning: '没有结束时间',
})
const status = input('数据库状态；不是根据当前时间计算的displayStatus', '用户在新增/编辑表单单选；启停动作单独使用enabled目标状态', {
  type: 'string',
  required: false,
  options: statusOptions,
  omitted: '新增默认enabled；编辑省略则保留current.status',
})
const remark = input('变更原因原文', '用户在表单填写；页面默认空字符串', {
  type: 'string',
  required: false,
  omitted: '新增默认空字符串；编辑省略则保留current.remark',
  nullMeaning: '读取到null时SDK按页面编辑回填逻辑归一为空字符串',
})

function rowFields(prefix: string): AiField[] {
  const at = (name: string) => `${prefix}.${name}`
  return [
    field(at('id'), 'string | number', '映射记录主键；编辑和启停使用，不是项目类型ID'),
    field(at('projectTypeId'), 'string | number', '项目类型记录主键'),
    field(at('projectTypeName'), 'string', '页面显示的项目类型名称', { nullable: true, nullMeaning: '后端未返回名称，不能用同名候选猜测' }),
    field(at('templateVersionId'), 'string | number', '模板版本记录主键'),
    field(at('templateName'), 'string', '模板族名称', { nullable: true, nullMeaning: '后端未返回模板名称' }),
    field(at('versionNo'), 'string', '模板版本号', { nullable: true, nullMeaning: '后端未返回版本号' }),
    field(at('effectiveStartTime'), 'string', '生效开始时间，含该时刻；不转换时区', { nullable: true, nullMeaning: '后端未返回开始时间' }),
    field(at('effectiveEndTime'), 'string', '生效结束时间，不含该时刻；不转换时区', { nullable: true, nullMeaning: '没有结束时间或后端未返回' }),
    field(at('status'), 'string', '数据库状态；enabled表示启用，disabled表示停用', { values: { enabled: '启用', disabled: '停用' } }),
    field(at('displayStatus'), 'string', '按当前时间和状态展示的业务状态，如pending/effective/expired/disabled；不是写入字段', { nullable: true, nullMeaning: '后端未返回展示状态' }),
    field(at('remark'), 'string', '变更原因；页面表单回填为空时为""'),
  ]
}

const current = input('编辑前的完整列表行或prepare-update返回的draft；项目类型ID用于锁定编辑目标', 'technology-type-template-mapping-list.list[]、prepare-update.previous或调用方保存的最新行', {
  type: 'object',
  required: true,
  constraints: ['必须包含id/projectTypeId/templateVersionId/effectiveStartTime/status；不能只传显示名称或行号'],
})
const changes = input('本次编辑明确修改的字段', '用户确认的字段变更', {
  type: 'object',
  required: false,
  omitted: '空对象；保留current中的可编辑字段',
  constraints: ['只允许templateVersionId/effectiveStartTime/effectiveEndTime/status/remark；projectTypeId在页面编辑态禁用'],
})
const draftParam = input('prepare能力返回的完整草稿', '对应prepare-create、prepare-update或prepare-change-status的返回值', {
  type: 'object',
  required: true,
  constraints: ['不要删除SDK补齐的默认值或id'],
})

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', '请求正常完成；SDK不伪造后端业务值、记录ID或写入终态')],
  empty: '成功为根undefined；失败抛错。写入是否真正生效必须通过list独立回查。',
}

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/technology.js@d3cf56bdc7:31-38', kind: 'reference', note: '证明类型模板映射是科技设置菜单下的保留页面，权限码为/dashboard/technology/setting/type-template-mapping。' },
  { source: 'app/portal/views/dashboard/technology/setting/type-template-mapping/list.vue@d3cf56bdc7:1-279', kind: 'reference', note: '证明筛选、候选加载、版本按项目大类过滤、表单必填项、日期value-format、保存及启停动作。' },
  { source: 'app/portal/views/dashboard/technology/setting/shared.js@d3cf56bdc7:49-92', kind: 'reference', note: '证明项目类型、模板、已发布版本和映射的真实请求路径、HTTP方法与参数位置。' },
  { source: 'src/capabilities/technology-type-template-mapping.ts', kind: 'implementation', note: '锁定SDK请求投影、页面默认值、日期归一化、编辑锁定字段和返回字段校验。' },
  { source: 'test/technology-type-template-mapping.test.ts', kind: 'test', note: '离线锁定页面请求、表单规则、候选版本筛选所需字段、启停URL和AI契约；不等于真实浏览器或后端写入验证。' },
]
const gaps = [
  '未执行浏览器基准和测试环境真实读写；请求和字段来自固定Portal源码，真实后端权限、唯一性、时间重叠约束和写后业务终态仍需环境可用时验证。',
  'Portal一次拉取模板第一页最多500条，并为每个模板拉取第一页最多500个已发布版本；SDK复刻该行为，不擅自分页扩展或把候选接口改成关键字搜索。',
  '页面没有删除动作，也没有prepare→submit→cancel撤销接口；保存后的恢复只能再次编辑提交，不能当作服务端回滚。',
]

function contract(purpose: string, effect: AiContract['effect'], inputs: Record<string, AiParameter>, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract {
  return {
    purpose,
    whenToUse: '操作门户科技设置下的“类型模板映射”页面；不要把它当作范围外独立生产、财务或销售系统入口。',
    effect,
    boundaries: [
      '请求使用platform HTTP实例，页面没有可推导的module-type，因此不发送module-type头。',
      '项目类型在编辑表单中禁用；prepare-update和update都不接受projectTypeId变更。新增或编辑的templateVersionId只应从同项目大类的已发布版本候选中选择，但SDK不会凭空替调用方回查候选来改变输入。',
      'effectiveStartTime必填，effectiveEndTime可空；只按Portal的YYYY-MM-DD HH:mm:ss字符串传输，不做时区换算或自动调整时间先后。',
      'displayStatus是列表展示字段，不能作为保存status的替代；changeStatus根据目标enabled布尔值选择enable或disable URL。',
    ],
    prerequisites: ['SDK会话已绑定当前用户、租户和会话token；账号具备该页面权限；写操作前已得到用户明确确认。'],
    inputs,
    output,
    consume,
    steps: [],
    completion: '返回结果符合本契约；任何写操作只有独立list回查后才能报告业务终态已验证。',
    failures: [
      '本地ID、必填字段、日期格式、状态或不允许的编辑字段校验失败：不发业务请求，修正参数后重试。',
      '401/403、网络错误或后端业务错误原样抛出；不能把空列表当作无权限，也不能把HTTP成功当作保存成功。',
      '写请求超时后先按项目类型和模板版本回查；不要盲目重复创建或切换状态。',
    ],
    idempotency: effect === 'write' ? '页面没有SDK幂等键；新增重复提交可能产生重复映射或业务错误，更新/启停超时必须先回查。' : null,
    evidence,
    gaps,
    ...extra,
  }
}

export const TECHNOLOGY_TYPE_TEMPLATE_MAPPING_CONTRACTS: Record<string, AiContract> = {}
const C = TECHNOLOGY_TYPE_TEMPLATE_MAPPING_CONTRACTS

C['technology-type-template-mapping-list'] = contract('按项目类型分页查询类型模板映射，返回页面展示、编辑和启停所需的完整行字段。', 'read', {
  pageNo: input('从1开始的页码', '调用方分页状态', { type: 'integer', required: false, omitted: 'SDK默认1', constraints: ['正整数'] }),
  pageSize: input('每页条数', '调用方分页需要', { type: 'integer', required: false, omitted: 'SDK默认20；最大500，匹配页面查询约束', constraints: ['1至500整数'] }),
  projectTypeId: { ...projectTypeId, required: false, nullable: true, omitted: 'SDK发送null，不按项目类型筛选', nullMeaning: '不限制项目类型' },
}, {
  shape: '{ list: array, total: integer }',
  fields: [field('$', 'object', '当前筛选页'), field('list', 'array', '当前页映射记录'), field('list[]', 'object', '一条映射记录'), ...rowFields('list[]'), field('total', 'integer', '符合筛选条件的总记录数')],
  empty: 'list=[]表示当前页没有记录；只有total=0才表示筛选条件下没有记录。',
}, ['展示项目类型、模板版本、生效时间、displayStatus和remark；保留id及两个关联ID供后续编辑或启停。'], {
  completion: '已取得请求页；没有改变映射。',
  steps: [
    { role: 'optional', when: '用户要求新增映射', capabilityId: 'technology-type-template-mapping-prepare-create', mapping: {}, instruction: '先读取references并按项目大类筛选已发布版本，再准备表单草稿。' },
    { role: 'optional', when: '用户选定一行并编辑', capabilityId: 'technology-type-template-mapping-prepare-update', mapping: { current: 'result.list[]' }, instruction: '只传选中行，不按行号或同名记录猜ID。' },
    { role: 'optional', when: '用户确认启停', capabilityId: 'technology-type-template-mapping-prepare-change-status', mapping: { id: 'result.list[].id', enabled: 'context.confirmedEnabled' }, instruction: 'enabled必须是用户确认的目标状态，不是把当前displayStatus直接传给接口。' },
  ],
})

C['technology-type-template-mapping-references'] = contract('加载类型模板映射表单使用的项目类型、模板和已发布版本候选。', 'read', {}, {
  shape: '{ projectTypes: array, templates: array, publishedVersions: array }',
  fields: [
    field('$', 'object', '页面候选集合'),
    field('projectTypes', 'array', '项目类型候选；页面使用id/typeName/projectDomain'),
    field('projectTypes[].id', 'string | number', '项目类型ID'),
    field('projectTypes[].typeName', 'string', '项目类型名称'),
    field('projectTypes[].projectDomain', 'string', '项目大类编码，用于过滤模板'),
    field('templates', 'array', '模板族候选；页面使用id/templateName/projectDomain'),
    field('templates[].id', 'string | number', '模板族ID'),
    field('templates[].templateName', 'string', '模板族名称'),
    field('templates[].projectDomain', 'string', '模板所属项目大类'),
    field('publishedVersions', 'array', '所有模板第一页内的已发布版本候选'),
    field('publishedVersions[].id', 'string | number', '模板版本ID'),
    field('publishedVersions[].templateId', 'string | number', '所属模板族ID，用于与templates关联'),
    field('publishedVersions[].versionNo', 'string', '版本号'),
    field('publishedVersions[].versionName', 'string', '版本名称'),
  ],
  empty: '三个数组都可能为空；空候选不能被解释为无权限或后端无数据，先区分请求失败与合法空数组。',
}, ['选择项目类型后，先找到同projectDomain的templates，再保留其publishedVersions；不要把其他大类版本提交到表单。'], {
  completion: '已加载页面原本需要的候选请求；没有改变映射。',
})

C['technology-type-template-mapping-prepare-create'] = contract('按新增表单规则校验并补齐启用状态、结束时间和变更原因，生成新增草稿。', 'prepare', {
  projectTypeId,
  templateVersionId: versionId,
  effectiveStartTime: startTime,
  effectiveEndTime: endTime,
  status,
  remark,
}, { shape: '{ draft: object }', fields: [field('$', 'object', '新增准备结果'), field('draft', 'object', '可传给create的完整草稿'), field('draft.projectTypeId', 'string | number', '项目类型ID'), field('draft.templateVersionId', 'string | number', '模板版本ID'), field('draft.effectiveStartTime', 'string', '含生效开始时间'), field('draft.effectiveEndTime', 'string', '不含生效结束时间', { nullable: true, nullMeaning: '无结束时间' }), field('draft.status', 'string', 'enabled或disabled', { values: { enabled: '启用', disabled: '停用' } }), field('draft.remark', 'string', '变更原因')], empty: '日期/ID/必填字段不合法时抛错，不返回部分草稿。' }, ['仅完成本地校验，没有创建映射。'], {
  completion: '已生成未提交草稿。',
  steps: [{ role: 'required', when: '用户确认保存新增', capabilityId: 'technology-type-template-mapping-create', mapping: { draft: 'result.draft' }, instruction: '只传prepare返回的完整draft。' }],
})

C['technology-type-template-mapping-prepare-update'] = contract('基于最新列表行准备编辑草稿；保留项目类型ID，合并允许修改的版本、时间、状态和原因。', 'prepare', {
  current,
  changes,
  'current.id': input('映射记录ID', 'current.id', { type: 'string | number', required: true }),
  'current.projectTypeId': projectTypeId,
  'changes.templateVersionId': { ...versionId, required: false, source: '用户本次修改；省略则保留current.templateVersionId' },
  'changes.effectiveStartTime': { ...startTime, required: false, source: '用户本次修改；省略则保留current.effectiveStartTime' },
  'changes.effectiveEndTime': { ...endTime, source: '用户本次修改；省略则保留current.effectiveEndTime' },
  'changes.status': { ...status, source: '用户本次修改；省略则保留current.status' },
  'changes.remark': { ...remark, source: '用户本次修改；省略则保留current.remark' },
}, { shape: '{ draft: object, previous: object }', fields: [field('$', 'object', '编辑准备结果'), field('draft', 'object', '合并并校验后的更新草稿'), field('previous', 'object', '准备时的页面字段快照')], empty: 'current缺少ID、必填字段或changes包含projectTypeId等不允许字段时抛错。' }, ['确认draft.id与previous.id相同；projectTypeId不会被修改。'], {
  completion: '已生成更新草稿，未写入。',
  steps: [
    { role: 'required', when: '用户确认保存编辑', capabilityId: 'technology-type-template-mapping-update', mapping: { draft: 'result.draft' }, instruction: '传完整draft进行PUT。' },
    { role: 'cancel', when: '用户要求恢复且确认覆盖期间变更', capabilityId: 'technology-type-template-mapping-update', mapping: { draft: 'result.previous' }, instruction: '恢复也是再次PUT，不是服务端回滚；恢复后必须list回查。' },
  ],
})

C['technology-type-template-mapping-create'] = contract('提交新增类型模板映射草稿。', 'write', { draft: draftParam }, voidOutput, ['成功后以draft中的projectTypeId和templateVersionId分页回查，核对时间、status和remark；不能只依据Promise完成。'], {
  completion: '请求正常返回且独立列表回查确认唯一目标记录字段一致后，才可报告新增已验证。',
  steps: [{ role: 'required', when: '保存完成或超时需要核实', capabilityId: 'technology-type-template-mapping-list', mapping: {}, instruction: '用args.draft中的projectTypeId和templateVersionId分页查找，核对有效时间、状态和备注；0条或多条都不能猜。' }],
})

 C['technology-type-template-mapping-update'] = contract('提交编辑后的完整类型模板映射草稿；项目类型ID保持不变。', 'write', { draft: draftParam }, voidOutput, ['成功后按draft.id回查同一记录，核对模板版本、时间、status和remark。'], {
  completion: 'PUT正常返回且list回查同一id字段一致后，才可报告编辑已验证。',
  steps: [{ role: 'required', when: '保存完成或超时需要核实', capabilityId: 'technology-type-template-mapping-list', mapping: {}, instruction: '用args.draft中的projectTypeId筛选并按id定位同一记录，逐字段核对；不要用同名记录替代。' }],
})

C['technology-type-template-mapping-prepare-change-status'] = contract('准备把指定映射切换到用户确认的目标启用状态。', 'prepare', {
  id: input('映射记录主键', '用户选定的list行.id', { type: 'string | number', required: true }),
  enabled: input('目标数据库状态；true启用，false停用', '用户在确认框中确认的目标状态', { type: 'boolean', required: true }),
}, { shape: '{ draft: { id, enabled } }', fields: [field('$', 'object', '启停准备结果'), field('draft.id', 'string | number', '映射记录ID'), field('draft.enabled', 'boolean', '目标状态')], empty: 'ID非法或enabled不是boolean时抛错。' }, ['仅准备，不发送启停请求。'], {
  completion: '已形成目标状态草稿。',
  steps: [{ role: 'required', when: '用户确认执行启停', capabilityId: 'technology-type-template-mapping-change-status', mapping: { draft: 'result.draft' }, instruction: '把目标enabled原样提交；不要把displayStatus或当前status文本作为enabled。' }],
})

C['technology-type-template-mapping-change-status'] = contract('按目标状态调用类型模板映射的enable或disable接口。', 'write', { draft: draftParam }, voidOutput, ['成功后按draft.id回查list，核对status和displayStatus；显示状态可能还受当前时间影响。'], {
  completion: '启停请求正常返回且独立list回查确认同一ID状态符合目标后，才可报告已验证。',
  steps: [{ role: 'required', when: '启停完成或超时需要核实', capabilityId: 'technology-type-template-mapping-list', mapping: {}, instruction: '重新加载列表并按draft.id定位；若同一时间窗口状态仍不一致，不自动重复切换。' }],
})

export const TECHNOLOGY_TYPE_TEMPLATE_MAPPING_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(TECHNOLOGY_TYPE_TEMPLATE_MAPPING_METHODS).map(([capabilityId, method]) => {
    const source = C[capabilityId]!
    return [`technologyTypeTemplateMapping.${method}`, {
      ...source,
      boundaries: [...source.boundaries, `公开方法technologyTypeTemplateMapping.${method}的参数和返回值以本契约为准；invoke能力使用对象参数。`],
    }]
  }),
)
