import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_USER_DICT_PAGE_PATH,
  PRODUCT_SETTING_USER_DICT_METHODS,
  productSettingUserDictCapabilities,
} from '../capabilities/product-setting-user-dict.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingUserDictCapabilities.map(definition => [definition.id, definition]))

const pageFields: AiField[] = [
  field('$', 'object', '鸡群范围分页结果；list是当前页，total是筛选后的总条数。'),
  field('list', 'object[]', '当前页的鸡群范围字典行。'),
  field('list[].id', 'string | number | null', '字典数据ID；启用和停用动作的dictId来源。', { nullable: true, nullMeaning: '后端没有返回可用ID，不能执行启用或停用。' }),
  field('list[].value', 'string | null', '字典值；业务数据保存的品种或代次值。', { nullable: true, nullMeaning: '后端没有返回字典值。' }),
  field('list[].label', 'string | null', '字典名称；页面表格展示的名称。', { nullable: true, nullMeaning: '后端没有返回展示名称。' }),
  field('list[].description', 'string | null', '字典类型的展示名称。', { nullable: true, nullMeaning: '后端没有返回类型描述。' }),
  field('list[].type', 'string | null', '字典类型值；与typeList返回的value对应。', { nullable: true, nullMeaning: '后端没有返回类型值。' }),
  field('list[].status', '0 | 1 | null', '租户范围状态；1启用、0停用。', { nullable: true, nullMeaning: '后端没有返回状态，不能据此安全判断目标状态。' }),
  field('list[].statusStr', 'string | null', '后端生成的状态展示文本。', { nullable: true, nullMeaning: '后端没有返回状态文本。' }),
  field('total', 'integer', '符合当前类型筛选条件的总记录数，不是当前页长度。'),
]

const typeOptionFields: AiField[] = [
  field('$', 'object[]', '页面类型下拉的最终候选数组；SDK已把后端type/description映射成value/label。'),
  field('[].value', 'string', '传给list.type的字典类型值。'),
  field('[].label', 'string', '页面类型下拉展示文本，来自后端description。'),
]

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求完成后的本地成功确认；接口没有返回最终字典行。')],
  empty: '请求抛错时没有成功结果；true不等于页面列表已经完成状态回查。',
}

const commonBoundaries = [
  '页面路径是/dashboard/product/setting/base-setting/user-dict/list，菜单权限是/dashboard/frame/base-setting/user-dict；列表查询受management:user-dict:query控制，启用和停用受management:user-dict:submit控制。SDK不绕过页面或服务端权限。',
  '请求使用Portal product实例，补devicetype=PC；该页面没有可推导的module-type，因此不发送module-type。',
  '列表customLoad把useListPageModule产生的order、orderField、type、pageNo和pageSize整体交给GET /sys/dict/userDictPage；Portal styleV2默认pageSize=20，支持10/20/50/100。',
  '页面的handleToggleStatus使用当前行record.status === 1决定调用deactivate还是enable，并从record.id、record.dictId或record.dictID取目标ID；SDK拆成enable和deactivate两个显式动作，不把当前状态反转逻辑藏在调用方之外。',
  '页面的ModalFormContent仍保留userDictSave提交动作；SDK按该Portal表单的五字段请求形状登记它，但固定Java DictController当前没有对应映射，因此提交可能被部署版本拒绝，不能把源码动作当作线上已可用或已授权。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js 与 app/portal/views/dashboard/product/setting/base-setting/user-dict/list.vue', kind: 'reference', note: '逐页核对菜单路径、菜单权限、product实例、筛选默认值、分页、查询、类型候选、启用/停用按钮和页面内权限。' },
  { source: 'app/portal/views/dashboard/product/setting/base-setting/user-dict/modal-form-content.vue', kind: 'reference', note: '核对Modal表单的type/label/value必填、description回填和五字段userDictSave提交形状；该入口需以当前菜单/隐藏路由可达性及部署版本进一步核验。' },
  { source: 'DictController、DictVO、HRDict、HRDictMapper.xml、HRDictServiceImpl', kind: 'reference', note: '核对分页包络、类型候选映射、租户范围、状态更新、停用限制；固定Java检出未发现userDictSave映射，形成Portal动作与后端可用性差异。' },
  { source: 'src/capabilities/product-setting-user-dict.ts 与 test/product-setting-user-dict.test.ts', kind: 'implementation', note: '锁定SDK五字段请求、输入校验、状态动作、product实例、本地取消和Portal/Java冲突证据；不替代真实环境浏览器证据。' },
  { source: 'docs/pages/产品设置鸡群范围.md', kind: 'reference', note: '记录页面四件套、权限、不可达表单边界和真实环境缺口。' },
]

const gaps = [
  '已逐页核对Portal菜单、列表、遗留弹窗、Java Controller/VO/Entity/Mapper/Service、SDK实现和离线反证测试；尚未在真实测试环境使用浏览器会话执行类型读取、列表读取及prepare-like状态写入回查。',
  'Portal源码保留POST /sys/dict/userDictSave表单动作，但固定Java DictController没有该接口映射；SDK已按Portal形状暴露提交能力，必须把后端缺路由作为外部部署阻塞报告，不声称线上写入可用。',
]

const queryInputs: Record<string, AiParameter> = {
  type: param('鸡群范围类型筛选；省略时按Portal默认发送空字符串。', 'typeList返回的value或页面筛选值', { type: 'string', required: false, default: '' }),
  pageNo: param('从1开始的页码。', '调用方分页状态', { type: 'integer', required: false, default: '1' }),
  pageSize: param('页面支持的每页条数。', '调用方分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
}

const actionInputs = (action: string): Record<string, AiParameter> => ({
  dictId: param(`当前列表行的字典ID；${action}只接受这个ID，不接受名称、value或数组下标。`, 'productSettingUserDict.list.result.list[].id', { type: 'string | number', required: true }),
})

const saveInputs: Record<string, AiParameter> = {
  id: param('编辑时的鸡群范围字典ID；新建时传空字符串。', '用户编辑的当前行id；新建表单的默认值', { type: 'string | number | ""', required: false, default: "''" }),
  type: param('鸡群范围类型值；不是类型展示名称。', 'typeList.result[].value 或当前表单回填值', { type: 'string', required: true }),
  description: param('鸡群范围类型展示名称；缺省按Portal发送空字符串。', 'typeList.result[].label 或当前表单回填值', { type: 'string', required: false, default: "''", omitted: "发送 ''" }),
  label: param('鸡群范围展示名称。', '用户填写', { type: 'string', required: true, constraints: ['不能为空或全为空格'] }),
  value: param('鸡群范围业务值。', '用户填写', { type: 'string', required: true, constraints: ['不能为空或全为空格'] }),
}
const saveDraftInputs: Record<string, AiParameter> = {
  draft: param('prepareUserDictSave返回的五字段请求草稿。', 'product-setting-user-dict-prepare-save.result.draft', { type: 'object', required: true }),
  'draft.id': param('编辑目标ID或新建时的空字符串。', 'result.draft.id', { type: 'string | number | ""', required: true }),
  'draft.type': param('类型业务值。', 'result.draft.type', { type: 'string', required: true }),
  'draft.description': param('类型展示名称；可为空字符串。', 'result.draft.description', { type: 'string', required: true }),
  'draft.label': param('鸡群范围展示名称。', 'result.draft.label', { type: 'string', required: true }),
  'draft.value': param('鸡群范围业务值。', 'result.draft.value', { type: 'string', required: true }),
}
const saveDraftOutput: AiContract['output'] = {
  shape: '{ draft: { id: string | number | "", type: string, description: string, label: string, value: string } }',
  fields: [field('$', 'object', '本地保存草稿'), field('draft.id', 'string | number | ""', '编辑目标字典ID；新建为空字符串'), field('draft.type', 'string', '类型业务值'), field('draft.description', 'string', '类型展示名称，可为空字符串'), field('draft.label', 'string', '鸡群范围展示名称'), field('draft.value', 'string', '鸡群范围业务值')],
  empty: '表单字段非法时抛错且不发请求。',
}

function inputFor (id: string): Record<string, AiParameter> {
  if (id === 'product-setting-user-dict-list') return queryInputs
  if (id === 'product-setting-user-dict-type-list') return {}
  if (id === 'product-setting-user-dict-prepare-save') return saveInputs
  if (id === 'product-setting-user-dict-save' || id === 'product-setting-user-dict-cancel-save') return id.endsWith('save') && !id.endsWith('cancel-save') ? saveDraftInputs : {}
  return actionInputs(id.endsWith('enable') ? '启用' : '停用')
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-user-dict-', '')
  const isList = suffix === 'list'
  const isTypeList = suffix === 'type-list'
  const isPrepareSave = suffix === 'prepare-save'
  const isSave = suffix === 'save'
  const isCancelSave = suffix === 'cancel-save'
  const isDeactivate = suffix === 'deactivate'
  const steps: AiContract['steps'] = []
  if (isPrepareSave) {
    return {
      purpose: '按Portal鸡群范围弹窗的五字段规则准备保存草稿；不发送请求。',
      whenToUse: `需要在${PRODUCT_SETTING_USER_DICT_PAGE_PATH}页面准备新建或编辑鸡群范围时使用。`,
      effect: 'prepare',
      inputs: saveInputs,
      output: saveDraftOutput,
      consume: ['确认draft中id/type/description/label/value五个字段；新建保留id=""，编辑保留当前字典ID。'],
      boundaries: commonBoundaries,
      prerequisites: ['type必须来自typeList.value；label和value不能为空；调用上下文必须是当前用户/租户。'],
      steps: [{ role: 'required', when: '用户确认提交弹窗', capabilityId: 'product-setting-user-dict-save', mapping: { draft: 'result.draft' }, instruction: '原样提交五字段draft；不要把description改成type或把空id删掉。' }, { role: 'cancel', when: '用户取消弹窗', capabilityId: 'product-setting-user-dict-cancel-save', mapping: {}, instruction: '调用本地取消，不发请求。' }],
      completion: '得到未发请求的鸡群范围保存草稿。',
      failures: ['字段不合法时本地失败；Java当前固定检出没有userDictSave映射，提交阶段可能以404/业务错误失败。'],
      idempotency: null,
      evidence,
      gaps,
    }
  }
  if (isSave) {
    return {
      purpose: '提交Portal鸡群范围弹窗五字段保存请求；对应POST /sys/dict/userDictSave。',
      whenToUse: `用户确认${PRODUCT_SETTING_USER_DICT_PAGE_PATH}页面的鸡群范围弹窗草稿时使用。`,
      effect: 'write',
      inputs: saveDraftInputs,
      output: trueOutput,
      consume: ['true只表示请求被接受；先按type和label/value重新查询列表核对，且固定Java检出没有该路由时必须报告提交阻塞。'],
      boundaries: commonBoundaries,
      prerequisites: ['必须先完成prepare并原样保留draft；当前用户必须有页面及提交权限。'],
      steps: [{ role: 'required', when: '请求成功或超时后需要核实', capabilityId: 'product-setting-user-dict-list', mapping: { type: 'args.draft.type' }, instruction: '按同一type分页读取并逐项核对id、description、label、value；不能只看true回执。' }],
      completion: '列表回查确认目标字段后才报告保存完成；后端缺路由时按失败处理。',
      failures: ['权限、网络、后端字段校验或固定Java缺路由错误原样抛出；未回查前不得重试，避免重复保存。'],
      idempotency: '无requestId；超时先按type查询核实，再决定是否复用同一draft。',
      evidence,
      gaps,
    }
  }
  if (isCancelSave) {
    return {
      purpose: '取消鸡群范围本地保存草稿，不调用后端。',
      whenToUse: `用户在${PRODUCT_SETTING_USER_DICT_PAGE_PATH}弹窗提交前取消时使用。`,
      effect: 'local',
      inputs: {},
      output: { shape: '{ cancelled: true }', fields: [field('cancelled', 'boolean', '固定为true，表示本地草稿已丢弃')], empty: '不发HTTP请求。' },
      consume: ['只表示本地草稿已放弃，不表示已撤销此前已经提交的远端保存。'],
      boundaries: commonBoundaries,
      prerequisites: ['已有待提交草稿；未调用save。'],
      steps: [],
      completion: '返回cancelled=true且没有网络副作用。',
      failures: ['若save已经调用，不能用本地取消推断服务端回滚。'],
      idempotency: null,
      evidence,
      gaps,
    }
  }
  if (!isList && !isTypeList) {
    steps.push({
      role: 'required',
      when: `用户明确确认${isDeactivate ? '停用' : '启用'}当前列表行`,
      capabilityId: 'product-setting-user-dict-list',
      mapping: { type: 'context.type' },
      instruction: '使用动作前保留的列表行ID和类型筛选重新读取；成功或超时后按ID回查status，不要只把true回执当成状态已落库。',
    })
    steps.push({ role: 'cancel', when: '用户在调用前取消操作', instruction: '不调用启用或停用接口。' })
  }
  const output = isList
    ? { shape: '{ list: object[], total: integer }', fields: pageFields, empty: 'list=[]表示当前页没有记录；total=0才表示筛选条件下没有记录，权限、网络或后端错误会抛出。' }
    : isTypeList
      ? { shape: 'object[]', fields: typeOptionFields, empty: '[]表示后端没有可用的鸡群范围类型。' }
      : trueOutput
  return {
    purpose: isList ? '按类型分页查询当前租户的鸡群范围字典。' : isTypeList ? '读取页面类型筛选下拉的字典类型候选。' : `按当前列表行ID${isDeactivate ? '停用' : '启用'}一个鸡群范围选项。`,
    whenToUse: `需要在${PRODUCT_SETTING_USER_DICT_PAGE_PATH}页面执行${isList ? '查询' : isTypeList ? '准备类型筛选' : isDeactivate ? '停用' : '启用'}时使用。`,
    effect: isList || isTypeList ? 'read' : 'write',
    inputs: inputFor(id),
    output,
    consume: isList
      ? ['先用typeList的value填入type筛选；按list[].id保存后续状态动作目标，按status判断当前状态，total用于判断全量结果。']
      : isTypeList
        ? ['把返回的value作为list.type传入；label只用于展示，不要把label当作后端type值。']
        : [`true只表示${isDeactivate ? '停用' : '启用'}请求完成；必须调用list回查同一dictId的status，确认最终状态后再向用户报告完成。`],
    boundaries: commonBoundaries,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认用户拥有页面及对应查询或提交权限。', ...(!isList && !isTypeList ? ['dictId必须来自最新列表行；停用动作可能因“至少保留一项”或“该数据已经使用”被后端拒绝。'] : [])],
    steps,
    completion: isList ? '获得与Portal customLoad消费形状一致的list和total。' : isTypeList ? '获得页面最终消费的value/label类型候选。' : `请求按Portal GET ${isDeactivate ? '/sys/dict/deactivate' : '/sys/dict/enable'}完成，并在列表回查后确认状态。`,
    failures: ['字段、ID、权限、网络或Java业务错误均抛出，不能降级为空列表或假成功。', ...(isDeactivate ? ['Java会拒绝停用最后一个启用项或已被鸡群/孵化数据使用的字典项。'] : [])],
    idempotency: isList || isTypeList ? null : '接口没有requestId幂等键；启用/停用虽然以目标端点区分，但超时仍需先按dictId回查再决定是否重试。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingUserDictCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`鸡群范围契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_USER_DICT_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_USER_DICT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_USER_DICT_METHODS).map(([id, method]) => [
    `productSettingUserDict.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingUserDict.${method}；状态写操作遵循先读取、调用、再按ID回查。`] },
  ]),
)
