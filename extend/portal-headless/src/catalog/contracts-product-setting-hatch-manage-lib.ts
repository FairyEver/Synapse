import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_SETTING_HATCH_MANAGE_LIB_DELETE_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_METHODS,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_PAGE_PATH,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_QUERY_PERMISSION,
  PRODUCT_SETTING_HATCH_MANAGE_LIB_SUBMIT_PERMISSION,
  productSettingHatchManageLibCapabilities,
} from '../capabilities/product-setting-hatch-manage-lib.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productSettingHatchManageLibCapabilities.map(definition => [definition.id, definition]))

const temperatureOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', 'Portal舍内温度下拉选项；保留后端原始字段并补齐页面使用的label/value。'),
    field('[].id', 'string | number', '温度选项ID；列表筛选tempId和新建/编辑表单tempId都使用它。'),
    field('[].inTitle', 'string | null', '舍内温度展示文本；Portal映射为下拉label。', { nullable: true, nullMeaning: '后端没有返回温度展示文本。' }),
    field('[].label', 'string | null', 'SDK按Portal页面映射得到的下拉展示值，等于inTitle。', { nullable: true, nullMeaning: 'inTitle为空。' }),
    field('[].value', 'string | number', 'SDK按Portal页面映射得到的下拉提交值，等于id。'),
  ],
  empty: '[]表示后端没有可选舍内温度；请求或响应错误会抛出，不伪造选项。',
}

const rowFields: AiField[] = [
  field('list[].id', 'string | number | null', 'Portal行对象尝试读取的记录ID；当前Java ProgramNewStandardLibDTO没有id字段，通常为null。查看标准动作不能从名称猜ID。', { nullable: true, nullMeaning: "当前Java标准库列表DTO未返回id；页面会把它降为''传给子页。" }),
  field('list[].variety', 'string | null', '品种编码；来自Java标准库列表查询。', { nullable: true, nullMeaning: '后端没有返回品种编码。' }),
  field('list[].varietyName', 'string | null', '品种展示名称；列表显示字段。', { nullable: true, nullMeaning: '后端没有补出品种名称。' }),
  field('list[].gen', 'string | null', '代次编码；编辑表单回填值。', { nullable: true, nullMeaning: '后端没有返回代次编码。' }),
  field('list[].genName', 'string | null', '代次展示名称；列表显示字段。', { nullable: true, nullMeaning: '后端没有补出代次名称。' }),
  field('list[].ageStage', 'string | null', 'Java DTO保留的龄段字段；当前标准库SQL不选择它。', { nullable: true, nullMeaning: '本页标准库查询不返回龄段。' }),
  field('list[].ageStageName', 'string | null', 'Java DTO保留的龄段展示字段；当前页面不显示。', { nullable: true, nullMeaning: '本页标准库查询不返回龄段。' }),
  field('list[].tempId', 'string | null', '舍内温度ID；编辑和列表筛选使用。', { nullable: true, nullMeaning: '后端没有返回温度ID。' }),
  field('list[].tempName', 'string | null', '舍内温度展示名称；列表显示字段。', { nullable: true, nullMeaning: '后端没有补出温度名称。' }),
  field('list[].suiteCode', 'string | null', '标准库预案业务编码；删除请求唯一使用它，编辑请求也原样透传。', { nullable: true, nullMeaning: '后端没有返回可操作业务编码，不能执行编辑或删除。' }),
  field('list[].flag', 'integer | null', 'Java DTO的编辑覆盖标记；当前列表SQL通常不返回。', { nullable: true, nullMeaning: '列表查询没有返回编辑标记。' }),
  field('total', 'integer', '符合品种、代次、温度和固定scope=1条件的总条数。'),
]

const createDraftFields: AiField[] = [
  field('draft', 'object', '通过Portal新建弹窗校验、尚未发送请求的标准库导入草稿。'),
  field('draft.variety', 'string', '品种编码；Portal新建表单必填。'),
  field('draft.gen', 'string', '代次编码；Portal新建表单必填，也是Java导入接口必填。'),
  field('draft.tempId', 'string', '舍内温度ID；Portal新建表单和Java导入接口必填。'),
  field('draft.suiteCode', 'string', 'Portal构造FormData时始终发送的suiteCode；新建页面没有可见输入项，默认空字符串，Java新建分支按品种/代次/温度自行生成业务编码。'),
  field('draft.file', 'object', '无头上传文件；Portal页面实际传File，SDK用Base64文件描述代替。'),
  field('draft.file.fileName', 'string', '原始文件名；只接受.xls或.xlsx扩展名。'),
  field('draft.file.base64', 'string', '文件二进制的标准Base64；prepare会去除空白并规范化。'),
  field('draft.file.contentType', 'string', '上传MIME类型；未提供时按.xls/.xlsx扩展名补默认值。'),
]

const updateDraftFields: AiField[] = [
  field('draft', 'object', '通过Portal编辑弹窗校验、尚未发送请求的标准库编辑草稿。'),
  field('draft.id', 'string | number', "Portal从当前行回填的id；当前Java DTO不声明id，SDK保留页面请求中的键；当前列表通常为''。", { optional: true, nullable: true, nullMeaning: '当前列表DTO没有id；不影响Java按suiteCode编辑。' }),
  field('draft.variety', 'string', '编辑后的品种编码；必填。'),
  field('draft.gen', 'string', '编辑后的代次编码；必填。'),
  field('draft.tempId', 'string', '编辑后的舍内温度ID；必填。'),
  field('draft.suiteCode', 'string', '当前标准库业务编码；必填，Java按它定位要更新的suite。'),
  field('draft.file', 'null', 'Portal编辑模式仍把file:null放进JSON body；不上传文件。', { nullable: true, nullMeaning: '编辑接口不使用文件。' }),
]

const fileOutput: AiContract['output'] = {
  shape: 'object',
  fields: [
    field('fileName', 'string', '响应Content-Disposition中的文件名；缺失时使用标准库模板.xlsx。'),
    field('contentType', 'string | null', '响应Content-Type；缺失时为null。', { nullable: true, nullMeaning: '服务端没有返回Content-Type。' }),
    field('base64', 'string', '下载文件二进制的标准Base64内容。'),
    field('byteLength', 'integer', '下载文件的字节数。'),
  ],
  empty: '文件为空或响应不是二进制时抛错。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的标准库记录。')],
  empty: '请求、权限或Java业务错误时抛错；true不等于列表已经回查确认。',
}

const createOutput: AiContract['output'] = {
  shape: '{ status: "submitted" | "conflict", flag?: 1 }',
  fields: [
    field('status', '"submitted" | "conflict"', 'submitted表示本次导入请求已完成；conflict表示Portal首次请求发现同一预案已存在，必须让用户选择flag后再次调用create。'),
    field('flag', '1', '冲突提示标记；固定为1，表示需要选择替换/增加/覆盖方式，不是最终提交方式。', { optional: true, values: { '1': '存在重复预案，需要二次确认' } }),
  ],
  empty: '响应不是Portal成功包络或请求失败时抛错；不自动猜测重复数据处理方式。',
}

const commonBoundaries = [
  `页面路径是${PRODUCT_SETTING_HATCH_MANAGE_LIB_PAGE_PATH}，菜单权限是${PRODUCT_SETTING_HATCH_MANAGE_LIB_PERMISSION}；页面声明query权限${PRODUCT_SETTING_HATCH_MANAGE_LIB_QUERY_PERMISSION}，新建、编辑和查看标准按钮要求${PRODUCT_SETTING_HATCH_MANAGE_LIB_SUBMIT_PERMISSION}，删除按钮要求${PRODUCT_SETTING_HATCH_MANAGE_LIB_DELETE_PERMISSION}。SDK不绕过页面或服务端权限。`,
  '所有请求使用Portal product HTTP实例并补devicetype=PC；本页路径没有Portal module-type匹配规则，因此不发送module-type。',
  '列表customLoad接收useListPageModule加入的order/orderField/pageNo/pageSize，并把品种、代次、tempId、scope=1原样发给GET /programNew/standardLib/getPage；SDK固定发送order=""、orderField=""、scope=1，默认pageNo=1、pageSize=20，支持10/20/50/100。',
  '舍内温度选项由页面mounted时GET /programNew/baseSetting/temp/getTempInList取得；Portal把每条记录的inTitle映射为label、id映射为value，SDK同时保留原始字段和这两个映射字段。',
  '新建第一次POST /programNew/standardLib/importStandardLib只发送FormData的variety、gen、tempId、suiteCode、file；suiteCode按页面默认为空字符串，页面没有发送id、line、moulting、isBs、year。文件扩展名只接受.xls/.xlsx。',
  '如果首次导入返回Portal页面识别的重复标记1，SDK返回status=conflict，不替用户猜选项；用户必须在替换、增加或覆盖三项中明确选择1、2或3后，把同一draft和flag再次交给create。flag只在第二次FormData中发送。',
  '编辑POST /programNew/standardLib/edit发送id、variety、gen、tempId、suiteCode、file:null六个键；Portal页面没有处理Java返回的覆盖flag，SDK保持页面行为，写入后必须list回查。',
  '删除是GET /programNew/standardLib/delete?suiteCode=...，不是DELETE；SDK按Portal实际方法发送。下载模板是浏览器直接打开VITE_FM_API/programManage/exportFile并带fileName=标准库模板，SDK用product实例的会话请求下载二进制，不把token暴露到返回值中。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/hatch-manage/lib.vue 与 list.vue', kind: 'reference', note: '逐页核对菜单路径、路由权限、product实例、三项筛选、固定scope、分页、按钮权限、温度选项、列表、导入重复处理、编辑、删除和查看标准跳转。' },
  { source: 'app/portal/views/dashboard/product/setting/hatch-manage/lib/modal-form-content.vue、common/libs/renren/list.js、app/portal/utils/http/product.js', kind: 'reference', note: '逐字段核对新建/编辑默认值、文件扩展名、FormData键顺序、file:null、page参数、product响应解包和模板下载参数。' },
  { source: 'StandardLibController、ProgramNewServiceImpl、ProgramNewStandardLibDTO、ProgramNewTempInOutDTO、ProgramSuiteMapper.xml、BaseSettingTempController、ProgramManageController', kind: 'reference', note: '核对标准库列表、导入flag语义、编辑/删除业务键、Java DTO实际字段、温度选项和模板导出接口。' },
  { source: 'src/capabilities/product-setting-hatch-manage-lib.ts 与 test/product-setting-hatch-manage-lib.test.ts', kind: 'implementation', note: '锁定Portal请求、FormData提交、重复预案二阶段、GET删除、权限上下文、二进制模板和离线反证；不替代真实环境证据。' },
  { source: 'docs/pages/产品设置标准库.md', kind: 'reference', note: '记录页面四件套、表单/权限规则、字段基准、提交顺序和证据边界。' },
]

const gaps = [
  '尚未在真实测试环境使用浏览器会话执行温度选项、列表、新建首次冲突→用户选择flag→再次提交、编辑、回查和删除闭环；当前只有Portal/Java源码与离线请求形状证据。',
  '查看标准按钮导航到未在菜单中独立登记的子路径/dashboard/product/setting/hatch-manage/lib/indicator/list；本页能力保留id/suiteCode/query字段，但该子页的指标列表/编辑能力需按队列单独核对，不能把它伪装成本页已覆盖。',
]

function inputFor (id: string): Record<string, AiParameter> {
  if (id.endsWith('-temperature-options') || id.endsWith('-list') || id.endsWith('-download-template')) {
    if (id.endsWith('-list')) return {
      variety: param('品种筛选；省略时按Portal发送空字符串。', '标准库列表筛选表单', { type: 'string', required: false, default: '' }),
      gen: param('代次筛选；省略时按Portal发送空字符串。', '标准库列表筛选表单', { type: 'string', required: false, default: '' }),
      tempId: param('舍内温度ID筛选；值来自temperatureOptions[].value，省略时发送空字符串。', 'productSettingHatchManageLib.temperatureOptions.result[].value', { type: 'string', required: false, default: '' }),
      pageNo: param('从1开始的页码；默认1。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
      pageSize: param('每页条数；只支持10、20、50、100，默认20。', 'Portal分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
    }
    return {}
  }
  if (id.endsWith('-prepare-create')) return { form: param('Portal新建弹窗表单；variety、gen、tempId和file必填，file使用{fileName,base64,contentType?}。', '用户确认的标准库新建表单', { type: 'object', required: true }) }
  if (id.endsWith('-create')) return {
    draft: param('prepareCreate返回的完整draft；确认前不要改写文件或业务字段。', 'productSettingHatchManageLib.prepareCreate.result.draft', { type: 'object', required: true }),
    flag: param('重复预案的处理方式；首次create省略，收到status=conflict后由用户选择1替换、2增加或3覆盖。', '用户在Portal重复预案弹窗中的明确选择', { type: '1 | 2 | 3', required: false, options: [{ value: 1, label: '替换' }, { value: 2, label: '增加' }, { value: 3, label: '覆盖' }] }),
  }
  if (id.endsWith('-prepare-update')) return { form: param('当前列表行编辑后的表单；必须保留suiteCode，file不由用户提供。', '当前标准库列表行和用户确认的编辑字段', { type: 'object', required: true }) }
  if (id.endsWith('-update')) return { draft: param('prepareUpdate返回的六键草稿；file固定为null，确认后原样提交。', 'productSettingHatchManageLib.prepareUpdate.result.draft', { type: 'object', required: true }) }
  return { suiteCode: param('当前列表行的非空suiteCode；必须来自最近一次list结果。', 'productSettingHatchManageLib.list.result.list[].suiteCode', { type: 'string', required: true }) }
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-setting-hatch-manage-lib-', '')
  const isList = suffix === 'list'
  const isTemperatureOptions = suffix === 'temperature-options'
  const isPrepareCreate = suffix === 'prepare-create'
  const isCreate = suffix === 'create'
  const isPrepareUpdate = suffix === 'prepare-update'
  const isUpdate = suffix === 'update'
  const isPrepareRemove = suffix === 'prepare-remove'
  const isRemove = suffix === 'remove'
  const steps: AiContract['steps'] = []

  if (isPrepareCreate) {
    steps.push({ role: 'required', when: '用户确认提交准备好的新建表单', capabilityId: 'product-setting-hatch-manage-lib-create', mapping: { draft: 'result.draft' }, instruction: '先把result.draft交给create且不带flag；如果返回conflict，向用户展示替换/增加/覆盖三项选择。' })
    steps.push({ role: 'cancel', when: '用户在首次导入或重复预案选择前取消', instruction: '只丢弃draft，不调用create；Portal取消重复预案弹窗也不会发送第二次请求。' })
  }
  if (isCreate) {
    steps.push({ role: 'required', when: '首次create返回status=conflict', capabilityId: 'product-setting-hatch-manage-lib-create', mapping: { draft: 'args.draft', flag: '用户明确选择的1/2/3' }, instruction: '只允许用户明确选择1替换、2增加或3覆盖后再次提交同一draft；不要自动选择或重复无flag请求。' })
    steps.push({ role: 'required', when: '请求成功或响应不确定', capabilityId: 'product-setting-hatch-manage-lib-list', mapping: {}, instruction: '重新读取列表，按品种、代次、tempId/suiteCode核对预案是否出现或更新；status= submitted只表示请求完成。' })
    steps.push({ role: 'cancel', when: '用户收到conflict后取消选择', instruction: '丢弃draft，不发送带flag的第二次请求。' })
  }
  if (isPrepareUpdate) {
    steps.push({ role: 'required', when: '用户确认提交编辑草稿', capabilityId: 'product-setting-hatch-manage-lib-update', mapping: { draft: 'result.draft' }, instruction: '把result.draft原样交给update；file必须保持null。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不调用update。' })
  }
  if (isUpdate) {
    steps.push({ role: 'required', when: '编辑请求成功或响应不确定', capabilityId: 'product-setting-hatch-manage-lib-list', mapping: {}, instruction: '重新读取列表并按suiteCode核对variety、gen、tempId；不要只把true当作已落库。' })
  }
  if (isPrepareRemove) {
    steps.push({ role: 'required', when: '用户确认删除当前标准库行', capabilityId: 'product-setting-hatch-manage-lib-remove', mapping: { suiteCode: 'result.suiteCode' }, instruction: '只把prepareRemove返回的suiteCode交给remove；确认前不要发GET删除请求。' })
    steps.push({ role: 'cancel', when: '用户取消删除确认', instruction: '丢弃suiteCode，不调用remove。' })
  }
  if (isRemove) {
    steps.push({ role: 'required', when: '删除请求成功或响应不确定', capabilityId: 'product-setting-hatch-manage-lib-list', mapping: {}, instruction: '重新读取列表确认同一suiteCode不再出现；不要把GET改成DELETE。' })
  }

  const output = isTemperatureOptions ? temperatureOutput : isList ? { shape: '{ list: object[], total: integer }', fields: [field('$', 'object', '标准库分页结果。'), ...rowFields], empty: 'list=[]表示当前页没有记录；total=0表示筛选条件下没有记录。权限、网络或响应结构错误会抛出。' } : isPrepareCreate ? { shape: '{ draft: object }', fields: createDraftFields, empty: '表单、文件扩展名或Base64不满足Portal规则时抛错，且不发请求。' } : isCreate ? createOutput : isPrepareUpdate ? { shape: '{ draft: object }', fields: updateDraftFields, empty: '编辑表单缺少必填字段时抛错，且不发POST。' } : isPrepareRemove ? { shape: '{ suiteCode: string }', fields: [field('suiteCode', 'string', '尚未发送删除请求的当前列表行业务编码。')], empty: 'suiteCode为空时抛错，且不发请求。' } : suffix === 'download-template' ? fileOutput : trueOutput
  const effect: AiContract['effect'] = isList || isTemperatureOptions || suffix === 'download-template' ? 'read' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? 'prepare' : 'write'

  return {
    purpose: isTemperatureOptions ? '读取标准库表单需要的舍内温度选项。' : isList ? '按Portal筛选条件分页读取养殖预案标准库。' : isPrepareCreate ? '按Portal新建弹窗规则准备标准库Excel导入草稿。' : isCreate ? '按Portal重复预案交互执行标准库新建/导入。' : isPrepareUpdate ? '按Portal编辑弹窗规则准备标准库编辑草稿。' : isUpdate ? '按Portal实际JSON提交编辑标准库。' : isPrepareRemove ? '准备一个经过用户确认的标准库suiteCode删除草稿。' : isRemove ? '按Portal实际GET接口删除标准库预案。' : '下载Portal标准库导入模板。',
    whenToUse: `需要在${PRODUCT_SETTING_HATCH_MANAGE_LIB_PAGE_PATH}页面执行对应${isList || isTemperatureOptions ? '查询' : '操作'}时使用。`,
    effect,
    inputs: inputFor(id),
    output,
    consume: isTemperatureOptions
      ? ['把value作为list的tempId或新建/编辑表单的tempId，把label用于向用户展示；不要用inTitle反查不存在的ID。']
      : isList
        ? ['用list[].suiteCode进入编辑/删除流程；当前Java列表DTO通常没有id，不能从品种、代次或温度名称猜业务编码。', 'total是筛选后的总数，不是当前页长度。']
        : isPrepareCreate
          ? ['把draft展示给用户；确认后首次create省略flag，conflict时必须再次询问1/2/3。']
          : isCreate
            ? ['submitted后按品种、代次、温度和suiteCode调用list回查；conflict只表示需要二次选择，不是写入成功。']
            : isPrepareUpdate
              ? ['把draft展示给用户；确认后原样交给update，file保持null。']
              : isPrepareRemove
                ? ['用户确认前只保存suiteCode；取消只丢弃本地草稿。']
                : suffix === 'download-template'
                  ? ['把返回的base64保存为fileName对应的文件；不要把base64当成Portal业务记录。']
                  : ['true只表示请求未抛错；必须按步骤list回查标准库最终状态。'],
    boundaries: commonBoundaries,
    prerequisites: ['使用当前用户、当前租户会话token，并确认用户拥有页面权限；新建/编辑还需要program:suite:submit，删除还需要program:suite:delete。', ...(isCreate || isPrepareCreate || isUpdate || isPrepareUpdate || isRemove || isPrepareRemove ? ['写操作目标必须来自当前页面最新列表、当前温度选项或同一次prepare结果。'] : [])],
    steps,
    completion: isTemperatureOptions ? '获得与Portal下拉消费形状一致的温度选项。' : isList ? '获得与Portal列表customLoad消费形状一致的list和total。' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? '获得尚未改变服务端的本地草稿。' : suffix === 'download-template' ? '获得可保存的标准库模板二进制。' : '请求按Portal页面的URL、HTTP方法、参数和二阶段规则完成，并通过list回查业务终态。',
    failures: ['表单、文件、Base64、分页、suiteCode、权限、网络或Java业务错误均抛出，不能降级为空列表、假成功或自动选择flag。', ...(isCreate ? ['首次冲突后如果用户未选择flag，不得继续发送导入请求。'] : [])],
    idempotency: isList || isTemperatureOptions || isPrepareCreate || isPrepareUpdate || isPrepareRemove || suffix === 'download-template' ? null : '页面没有requestId幂等协议；新建首次请求或带flag导入响应不确定时先list回查，再决定是否重试，避免重复导入。编辑和删除同样先回查，不把旧草稿盲目重放。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productSettingHatchManageLibCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`产品设置标准库契约没有对应能力定义：${id}`)

export const PRODUCT_SETTING_HATCH_MANAGE_LIB_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_SETTING_HATCH_MANAGE_LIB_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_SETTING_HATCH_MANAGE_LIB_METHODS).map(([id, method]) => [
    `productSettingHatchManageLib.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productSettingHatchManageLib.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
