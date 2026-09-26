import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_MATERIAL_MASTER_METHODS,
  PRODUCT_SETTING_MATERIAL_MASTER_PAGE_PATH,
  PRODUCT_SETTING_MATERIAL_MASTER_PERMISSION,
  PRODUCT_SETTING_MATERIAL_MASTER_SUBMIT_PERMISSION,
  productSettingMaterialMasterCapabilities,
} from '../capabilities/product-setting-material-master.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingMaterialMasterCapabilities.map(definition => [definition.id, definition]))

const rowFields: AiField[] = [
  field('id', 'string | number | null', '物料主数据记录ID；编辑和删除目标。', { nullable: true, nullMeaning: '后端没有返回可操作ID，不能把该行交给保存编辑或删除。' }),
  field('materialDescription', 'string | null', '物料描述；列表前缀筛选和编辑表单名称。', { nullable: true, nullMeaning: '后端没有返回物料描述。' }),
  field('materialCode', 'string | null', '物料编码；列表展示和编辑表单编码。', { nullable: true, nullMeaning: '后端没有返回物料编码。' }),
  field('materialGroup', 'string | null', '物料组；列表筛选和编辑表单分组。', { nullable: true, nullMeaning: '后端没有返回物料组。' }),
  field('specification', 'string | null', '规格；编辑表单可选，最多10个字符。', { nullable: true, nullMeaning: '没有规格。' }),
  field('measureUnit', 'string | null', '基本计量单位；编辑表单可选，最多10个字符。', { nullable: true, nullMeaning: '没有基本计量单位。' }),
  field('type', 'integer | null', 'Java物料实体类型字段；本页列表SQL可能不返回。', { nullable: true, nullMeaning: 'MaterialMapper的分页查询没有选择该字段时为空。' }),
  field('isSystem', 'integer | null', 'Java物料实体系统物料标记；本页只读列表可能返回。', { nullable: true, nullMeaning: '后端没有返回系统标记。' }),
  field('supplier', 'string | null', 'Java物料实体供应商字段；本页表单不编辑。', { nullable: true, nullMeaning: '没有供应商。' }),
  field('image', 'string | null', 'Java物料实体图片字段；本页表单不编辑。', { nullable: true, nullMeaning: '没有图片。' }),
  field('remark', 'string | null', 'Java备注字段；保存Controller会把它覆盖为yukou，Portal表单不发送。', { nullable: true, nullMeaning: '后端没有返回备注。' }),
  field('createDate', 'string | null', '创建时间；列表不展示但可能由Java实体返回。', { nullable: true, nullMeaning: '后端没有返回创建时间。' }),
  field('updateDate', 'string | null', '最近修改时间；页面列表展示字段。', { nullable: true, nullMeaning: '后端没有返回最近修改时间。' }),
  field('delFlag', 'integer | null', '软删除标记；正常列表应为0。', { nullable: true, nullMeaning: '后端没有返回删除标记。' }),
]

const draftFields: AiField[] = [
  field('$', 'object', '尚未写入的物料主数据保存草稿。'),
  field('draft', 'object', '确认后原样交给save的请求body。'),
  field('draft.id', 'string | number | null | undefined', '编辑时透传当前行ID；新建时来自Portal的undefined，运行时也接受显式null或空字符串并让Java走新建分支。', { optional: true, nullable: true, nullMeaning: '没有现有记录ID，Java按新建处理。' }),
  field('draft.materialDescription', 'string', '物料描述；必填，最多100个字符。'),
  field('draft.materialCode', 'string', '物料编码；必填，只允许数字，最多9个字符。'),
  field('draft.materialGroup', 'string', '物料组；必填，不能包含空白字符，最多50个字符。'),
  field('draft.specification', 'string', '规格；没有填写时为空字符串，最多10个字符。'),
  field('draft.measureUnit', 'string', '基本计量单位；没有填写时为空字符串，最多10个字符。'),
]

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求完成后的本地成功确认；接口不返回保存后的物料对象或删除后的记录。')],
  empty: '请求、权限、HTTP方法不被后端接受或业务错误时抛错；true不等于列表回查已确认。',
}

const commonBoundaries = [
  `页面路径是${PRODUCT_SETTING_MATERIAL_MASTER_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_MATERIAL_MASTER_PERMISSION}；新建、编辑、删除按钮受${PRODUCT_SETTING_MATERIAL_MASTER_SUBMIT_PERMISSION}控制。SDK不绕过页面或服务端权限。`,
  '所有请求使用Portal product HTTP实例并补devicetype=PC；该页面module-type推导结果为null，因此不发送module-type。',
  '列表筛选只有materialDescription、materialCode、materialGroup三个输入；useListPageModule还固定加入order=""、orderField=""、pageNo默认1、pageSize默认20，页面支持10、20、50、100。',
  'Portal保存body只来自modal-form-content的id、materialDescription、materialCode、materialGroup、specification、measureUnit六个字段；不把remark、type、isSystem或其它Java实体字段加入请求。',
  'Portal删除动作实际调用DELETE /base/material/delete? id=当前行id；当前Java MaterialController只声明了@GetMapping("delete")。SDK保持Portal实际HTTP方法，并把该前后端方法不一致作为证据缺口，不擅自改成GET。',
  'Java保存Controller先把remark固定写成yukou，再按id非空更新、否则新建；SDK不把这个服务端覆盖字段伪装成用户可填写参数。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/business-manage/material/list.vue 与 material.vue', kind: 'reference', note: '逐页核对菜单路径、页面权限、product实例、三项筛选、分页、base:material:submit按钮条件、保存和删除动作。' },
  { source: 'app/portal/views/dashboard/product/setting/business-manage/material/modal-form-content.vue 与 common/libs/renren/list.js', kind: 'reference', note: '逐字段核对表单默认值、必填规则、数字/空白/长度校验、六字段提交、order/page分页参数和确认删除。' },
  { source: 'MaterialController、Material、MaterialVO、MaterialMapper.xml、MaterialServiceImpl', kind: 'reference', note: '核对/base/material/page、/save、/delete映射、PageParam分页、实体字段、remark覆盖、按ID更新/新建和软删除。' },
  { source: 'src/capabilities/product-setting-material-master.ts 与 test/product-setting-material-master.test.ts', kind: 'implementation', note: '锁定Portal请求、表单提交、删除HTTP方法、权限边界和离线反证；不替代真实环境证据。' },
  { source: 'docs/pages/产品设置物料主数据.md', kind: 'reference', note: '记录页面四件套、表单规则、权限、前后端DELETE差异和证据边界。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话执行本页列表、保存、回查和删除闭环；离线请求与源码证据不替代真实环境证据。',
  'Portal删除使用DELETE，但当前Java MaterialController只声明GET /delete；SDK保持Portal方法，真实删除能否被当前后端接受待环境验证。',
]

const listInputs: Record<string, AiParameter> = {
  materialDescription: param('物料描述前缀；省略时发送空字符串。', '用户列表筛选', { type: 'string', required: false, default: '' }),
  materialCode: param('物料编码筛选；省略时发送空字符串。', '用户列表筛选', { type: 'string', required: false, default: '' }),
  materialGroup: param('物料组筛选；省略时发送空字符串。', '用户列表筛选', { type: 'string', required: false, default: '' }),
  pageNo: param('从1开始的页码；默认1。', '调用方分页状态', { type: 'integer', required: false, default: '1' }),
  pageSize: param('每页条数；只支持10、20、50、100；默认20。', '调用方分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
}

function inputFor (id: string): Record<string, AiParameter> {
  if (id === 'product-setting-material-master-list') return listInputs
  if (id === 'product-setting-material-master-prepare-save') return { form: param('Portal物料主数据弹窗表单；描述、编码、物料组必填，编码只允许数字，规格和基本计量单位最多10个字符。', '用户确认的表单', { type: 'object', required: true }) }
  if (id === 'product-setting-material-master-save') return { draft: param('prepareSave返回的六字段草稿；不要追加Java实体字段。', 'productSettingMaterialMaster.prepareSave.result.draft', { type: 'object', required: true }) }
  return { id: param('当前列表行物料ID；必须是同一页面返回的非空ID。', id.endsWith('prepare-remove') ? 'productSettingMaterialMaster.list.result.list[].id' : 'productSettingMaterialMaster.prepareRemove.result.id', { type: 'string | number', required: true }) }
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-material-master-', '')
  const isList = suffix === 'list'
  const isPrepareSave = suffix === 'prepare-save'
  const isPrepareRemove = suffix === 'prepare-remove'
  const steps: AiContract['steps'] = []
  if (suffix === 'save') {
    steps.push({ role: 'required', when: '用户确认保存新建或编辑表单', capabilityId: 'product-setting-material-master-prepare-save', mapping: { form: 'args.draft' }, instruction: '先用同一表单执行prepareSave；通过后才提交save。' })
    steps.push({ role: 'cancel', when: '用户在提交前取消编辑', instruction: '丢弃draft，不调用save。' })
    steps.push({ role: 'required', when: '保存成功或响应超时需要确认最终记录', capabilityId: 'product-setting-material-master-list', mapping: {}, instruction: '重新读取列表，按同一ID或materialCode逐字段核对；不要只把true当作已落库。' })
  }
  if (isPrepareSave) {
    steps.push({ role: 'required', when: '用户确认提交准备好的草稿', capabilityId: 'product-setting-material-master-save', mapping: { draft: 'result.draft' }, instruction: '只把result.draft原样交给save；用户取消时不发送POST。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '丢弃draft，不调用写接口。' })
  }
  if (isPrepareRemove) {
    steps.push({ role: 'required', when: '用户确认删除当前列表行', capabilityId: 'product-setting-material-master-remove', mapping: { id: 'result.id' }, instruction: '只把prepareRemove返回的id交给remove；确认前不要发送DELETE。' })
    steps.push({ role: 'cancel', when: '用户取消删除确认', instruction: '丢弃id，不调用remove。' })
  }
  if (suffix === 'remove') {
    steps.push({ role: 'required', when: '删除成功或响应超时需要确认记录是否仍存在', capabilityId: 'product-setting-material-master-list', mapping: {}, instruction: '重新读取列表并按同一ID核对记录已不再出现；由于当前Java映射是GET而Portal发送DELETE，若收到405必须报告协议差异，不自动换方法。' })
  }
  return {
    purpose: isList ? '按Portal筛选条件分页读取物料主数据。' : isPrepareSave ? '按Portal物料主数据弹窗校验准备保存草稿。' : isPrepareRemove ? '准备一个经过用户选择的物料删除ID。' : `执行物料主数据${suffix === 'save' ? '保存' : '删除'}请求。`,
    whenToUse: `需要在${PRODUCT_SETTING_MATERIAL_MASTER_PAGE_PATH}页面执行${isList ? '查询' : isPrepareSave ? '准备保存' : isPrepareRemove ? '准备删除' : suffix === 'save' ? '保存' : '删除'}时使用。`,
    effect: isList ? 'read' : isPrepareSave || isPrepareRemove ? 'prepare' : 'write',
    inputs: inputFor(id),
    output: isList
      ? { shape: '{ list: object[], total: integer }', fields: [field('$', 'object', '物料主数据分页结果。'), ...rowFields], empty: 'list=[]表示当前页没有记录；total=0表示筛选条件下没有记录。权限、网络或响应结构错误会抛出。' }
      : isPrepareSave
        ? { shape: '{ draft: object }', fields: draftFields, empty: '表单不满足Portal规则时抛错，不发POST。' }
        : isPrepareRemove
          ? { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待删除的当前列表行物料ID。')], empty: 'ID无效时抛错，不发DELETE。' }
          : trueOutput,
    consume: isList
      ? ['用list[].id进入编辑或删除流程；total用于分页，不要用当前页长度代替总数。']
      : isPrepareSave
        ? ['把draft展示为待提交表单结果；用户确认后原样交给save。']
        : isPrepareRemove
          ? ['用户取消时丢弃id；确认后原样交给remove。']
          : ['true只表示请求未抛错；必须按步骤回查列表确认保存或删除结果。'],
    boundaries: commonBoundaries,
    prerequisites: ['使用当前用户、当前租户的会话token，并确认拥有页面菜单权限；保存和删除还需要base:material:submit。', ...(isPrepareSave || isPrepareRemove || suffix === 'save' || suffix === 'remove' ? ['写操作目标必须来自当前页面的最新列表或同一份prepare结果。'] : [])],
    steps,
    completion: isList ? '获得与Portal列表消费形状一致的list和total。' : isPrepareSave ? '获得尚未写入服务端的六字段保存草稿。' : isPrepareRemove ? '获得尚未发送删除请求的物料ID。' : '请求按Portal方法完成，并通过列表回查确认业务终态。',
    failures: ['表单、分页、ID、权限、网络或Java业务错误均抛出，不能降级为空列表或假成功。', ...(suffix === 'remove' ? ['如果服务端对Portal的DELETE映射返回405，记录为前后端协议差异，不自动改用GET。'] : [])],
    idempotency: isList || isPrepareSave || isPrepareRemove ? null : '页面没有requestId幂等协议；保存或删除响应不确定时先回查列表，再决定是否重试，避免重复新建或误删。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingMaterialMasterCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`物料主数据契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_MATERIAL_MASTER_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_MATERIAL_MASTER_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_MATERIAL_MASTER_METHODS).map(([id, method]) => [
    `productSettingMaterialMaster.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingMaterialMaster.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
