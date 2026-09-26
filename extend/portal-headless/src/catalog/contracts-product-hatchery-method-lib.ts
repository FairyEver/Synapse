import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_HATCHERY_METHOD_LIB_DELETE_PERMISSION,
  PRODUCT_HATCHERY_METHOD_LIB_METHODS,
  PRODUCT_HATCHERY_METHOD_LIB_PAGE_PATH,
  PRODUCT_HATCHERY_METHOD_LIB_PERMISSION,
  PRODUCT_HATCHERY_METHOD_LIB_QUERY_PERMISSION,
  PRODUCT_HATCHERY_METHOD_LIB_SUBMIT_PERMISSION,
  productHatcheryMethodLibCapabilities,
} from '../capabilities/product-hatchery-method-lib.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productHatcheryMethodLibCapabilities.map(definition => [definition.id, definition]))

const temperatureOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', 'Portal舍内温度下拉选项；保留后端原始字段并补齐页面使用的label/value。'),
    field('[].id', 'string | number', '温度选项ID；Portal筛选表单和新建/编辑表单的tempId使用它。'),
    field('[].inTitle', 'string | null', '舍内温度展示文本；Portal映射为下拉label。', { nullable: true, nullMeaning: '后端没有返回温度展示文本。' }),
    field('[].label', 'string | null', 'SDK按Portal页面映射得到的下拉展示值，等于inTitle。', { nullable: true, nullMeaning: 'inTitle为空。' }),
    field('[].value', 'string | number', 'SDK按Portal页面映射得到的下拉提交值，等于id。'),
  ],
  empty: '[]表示后端没有可选舍内温度；请求或响应错误会抛出，不伪造选项。',
}

const rowFields: AiField[] = [
  field('list[].id', 'string | number | null', 'Portal表格的idKey字段；当前Java ProgramNewStandardLibDTO没有id，通常为null。编辑判定会回退到suiteCode。', { nullable: true, nullMeaning: 'Java孵化方法库列表DTO没有id字段。' }),
  field('list[].variety', 'string | null', '品种编码；来自Java孵化方法库列表SQL。', { nullable: true, nullMeaning: '后端没有返回品种编码。' }),
  field('list[].varietyName', 'string | null', '品种展示名称；Java服务按字典补出，Portal列表未直接展示编码。', { nullable: true, nullMeaning: '后端或字典没有补出名称。' }),
  field('list[].gen', 'string | null', '代次编码；编辑表单回填值。', { nullable: true, nullMeaning: '后端没有返回代次编码。' }),
  field('list[].genName', 'string | null', '代次展示名称；Java服务按字典补出。', { nullable: true, nullMeaning: '后端或字典没有补出名称。' }),
  field('list[].ageStage', 'string | null', 'Java孵化方法库SQL返回的日龄段编码；Java服务用它补ageStageName。Portal当前列表模板没有展示或提交这个字段。', { nullable: true, nullMeaning: '后端没有返回日龄段编码。' }),
  field('list[].ageStageName', 'string | null', 'Java按日龄段字典补出的展示名称；当前Portal方法库组件没有使用。', { nullable: true, nullMeaning: '后端或字典没有补出日龄段名称。' }),
  field('list[].tempId', 'string | null', 'Portal组件预期的舍内温度ID字段；孵化Java列表SQL不返回该字段，通常为null。', { nullable: true, nullMeaning: '孵化列表SQL返回ageStage而非tempId。' }),
  field('list[].tempName', 'string | null', 'Portal组件预期的舍内温度展示字段；孵化Java列表SQL不返回该字段，通常为null。', { nullable: true, nullMeaning: '孵化列表SQL没有温度名称字段。' }),
  field('list[].suiteCode', 'string | null', '孵化方法库预案业务编码；编辑和删除请求的目标键。', { nullable: true, nullMeaning: '没有可安全操作的业务编码。' }),
  field('list[].flag', 'integer | null', 'Java DTO保留的编辑覆盖标记；列表SQL不选择，通常为null。', { nullable: true, nullMeaning: '列表查询没有返回编辑标记。' }),
  field('total', 'integer', '符合当前筛选条件的总条数，不是当前页长度。'),
]

const createDraftFields: AiField[] = [
  field('draft', 'object', '通过Portal新建弹窗校验、尚未发送请求的孵化方法库草稿。'),
  field('draft.variety', 'string', '品种编码；Portal新建表单必填。'),
  field('draft.gen', 'string', '代次编码；Portal新建表单必填。'),
  field('draft.tempId', 'string', 'Portal表单名为tempId的舍内温度ID；新建表单必填，提交时仍按浏览器发送tempId。'),
  field('draft.suiteCode', 'string', 'Portal构造FormData时始终发送的suiteCode；新建弹窗没有可见输入项，默认空字符串。'),
  field('draft.file', 'object | null', '无头上传文件；Portal控件允许不选文件，SDK用Base64文件描述代替File。', { nullable: true, nullMeaning: '用户未选择文件；不会在FormData中追加file。' }),
  field('draft.file.fileName', 'string', '原始文件名；提供文件时只接受.xls或.xlsx扩展名。', { optional: true }),
  field('draft.file.base64', 'string', '文件二进制的标准Base64；prepare会去除空白并规范化。', { optional: true }),
  field('draft.file.contentType', 'string', '上传MIME类型；未提供时按扩展名补默认值。', { optional: true }),
]

const updateDraftFields: AiField[] = [
  field('draft', 'object', '通过Portal编辑弹窗校验、尚未发送请求的孵化方法库编辑草稿。'),
  field('draft.id', 'string | number | null | ""', 'Portal从当前行回填的id；当前Java列表通常没有该字段，编辑仍保留页面提交键。', { optional: true, nullable: true, nullMeaning: '列表没有id时按页面默认空字符串发送。' }),
  field('draft.variety', 'string', '编辑后的品种编码；Portal必填。'),
  field('draft.gen', 'string', '编辑后的代次编码；Portal必填。'),
  field('draft.tempId', 'string', 'Portal编辑表单的舍内温度ID；Portal必填并按tempId发送。', { constraints: ['当前Java孵化编辑服务按ageStage读取；Portal没有把tempId改名为ageStage。'] }),
  field('draft.suiteCode', 'string', '当前孵化方法库业务编码；Portal必填，Java按它定位更新记录。'),
  field('draft.file', 'null', 'Portal编辑模式固定发送file:null；不上传文件。', { nullable: true, nullMeaning: '编辑接口不使用文件。' }),
]

const fileOutput: AiContract['output'] = {
  shape: 'object',
  fields: [
    field('fileName', 'string', '响应Content-Disposition中的文件名；缺失时使用方法库模板.xlsx。'),
    field('contentType', 'string | null', '响应Content-Type；缺失时为null。', { nullable: true, nullMeaning: '服务端没有返回Content-Type。' }),
    field('base64', 'string', '下载文件二进制的标准Base64内容。'),
    field('byteLength', 'integer', '文件字节数。'),
  ],
  empty: '文件为空或响应不是二进制时抛错。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；不包含写入后的孵化方法库记录。')],
  empty: '请求、权限或Java业务错误时抛错；true不等于列表已经回查确认。',
}

const createOutput: AiContract['output'] = {
  shape: '{ status: "submitted" | "conflict", flag?: 1 }',
  fields: [
    field('status', '"submitted" | "conflict"', 'submitted表示本次导入请求未抛错；conflict表示Portal/Java返回flag=1，必须让用户选择处理方式后再次调用create。'),
    field('flag', '1', '冲突提示标记；固定为1，表示需要选择替换/增加/覆盖方式，不是最终提交方式。', { optional: true, values: { '1': '存在重复预案，需要选择处理方式' } }),
  ],
  empty: '响应不是Portal成功包络或请求失败时抛错；不自动猜测重复数据处理方式。',
}

const commonBoundaries = [
  `页面路径是${PRODUCT_HATCHERY_METHOD_LIB_PAGE_PATH}，菜单/路由权限是${PRODUCT_HATCHERY_METHOD_LIB_PERMISSION}；页面声明查询${PRODUCT_HATCHERY_METHOD_LIB_QUERY_PERMISSION}、新建/编辑/查看方法${PRODUCT_HATCHERY_METHOD_LIB_SUBMIT_PERMISSION}、删除${PRODUCT_HATCHERY_METHOD_LIB_DELETE_PERMISSION}。源码没有用query权限包住列表请求，SDK不绕过页面或服务端权限。`,
  '页面组件声明product HTTP实例。该路径在Portal module-type规则中没有可推导命中，SDK不发送module-type；Java控制器的@RequestHeader(defaultValue="43")只是服务端缺省值，不能反推浏览器实际请求带了43。',
  '孵化路由包装器复用养殖方法库列表组件；组件按当前路由把列表、导入、编辑、删除切换到/hatchProgram/methodLib，但舍内温度候选仍调用/programNew/baseSetting/temp/getTempInList，模板下载仍调用/programManage/exportFile。',
  '列表customLoad接收Portal公共列表模块加入的order/orderField/pageNo/pageSize，并发送品种、代次、tempId、scope=1；SDK固定order=""、orderField=""、scope=1，默认pageNo=1、pageSize=20，支持10/20/50/100。',
  'Portal新建弹窗的品种、代次、tempId必填；文件控件只接受.xls/.xlsx但文件不是必填。FormData顺序是variety、gen、tempId、suiteCode、可选file、可选flag；SDK保留tempId这个浏览器实际键，不把它静默改成ageStage。',
  'Java孵化控制器的importMethodLib和Mapper使用ageStage筛选/建码，而当前Portal组件提交tempId；因此该字段错位是当前源码证据中的已知边界，若服务端按ageStage严格校验，Portal与SDK都会得到参数错误，SDK不能宣称已成功落库。',
  '首次导入返回flag=1时，SDK返回status=conflict，不替用户选择。用户必须明确选择1替换、2增加或3覆盖，再把同一draft和flag交给create；hatchery Java控制器的file为空分支随后仍会进入flag判断，不能把无文件冲突假定为自动成功。',
  '编辑POST /hatchProgram/methodLib/edit发送id、variety、gen、tempId、suiteCode、file:null，Portal忽略返回的覆盖flag；SDK只把未抛错表示为true，编辑后必须list回查。由于Java编辑服务按ageStage读取，当前Portal的tempId同样存在字段错位。',
  '删除是GET /hatchProgram/methodLib/delete?suiteCode=...，不是DELETE；模板下载是页面弹窗直接打开的GET /programManage/exportFile?fileName=方法库模板，不把孵化控制器的/exportMethodLib误算成本页端点。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/hatchery-manage/method-lib.vue、app/portal/views/dashboard/product/setting/hatchery-manage/method-lib/list.vue', kind: 'reference', note: '核对孵化菜单、路由权限、包装器和当前路由分支、product实例、查询字段、按钮权限、所有页面请求及查看方法跳转。' },
  { source: 'app/portal/views/dashboard/product/setting/hatch-manage/method-lib/list.vue、modal-form-content.vue、common/libs/renren/list.js、app/portal/utils/http/product.js', kind: 'reference', note: '核对复用组件实际的API分支、FormData字段顺序、表单必填、文件扩展名、取消行为、分页和响应解包。' },
  { source: 'erp-module-fm/.../hatchProgram/HatchMethodLibController.java、ProgramNewStandardLibDTO.java、ProgramNewStandardLibVO.java、ProgramSuiteHatchMapperExt.xml、HatchProgramServiceImpl.java', kind: 'reference', note: '核对孵化端点、默认moduleType、ageStage返回/写入字段、flag分支、suiteCode定位和删除业务。' },
  { source: 'src/capabilities/product-hatchery-method-lib.ts、test/product-hatchery-method-lib.test.ts', kind: 'implementation', note: '锁定浏览器请求形状、文件规则、冲突二阶段、权限上下文、返回字段和已知字段错位；不替代真实环境证据。' },
  { source: 'docs/pages/方法库-孵化预案.md', kind: 'reference', note: '记录本页面的四件套、端点、表单、返回字段、写后回查和证据边界。' },
]

const gaps = [
  '尚未在真实测试环境执行温度选项、列表、无文件新建、带文件冲突→flag二次提交、编辑、删除和每次写后回查闭环；当前证据来自固定分支源码、Java源码和离线请求测试。',
  '当前Portal表单发送tempId，而Java孵化控制器/Mapper/Service使用ageStage；本能力按浏览器保留tempId，故在该源码状态下不能宣称新建或编辑已能被Java正确落库。',
  '“查看方法”跳转到/dashboard/product/setting/hatchery-manage/method-lib/indicator/list；指标子页端点和能力不在本页面节点内。',
]

function inputFor (id: string): Record<string, AiParameter> {
  if (id.endsWith('-temperature-options') || id.endsWith('-list') || id.endsWith('-download-template')) {
    if (id.endsWith('-list')) return {
      variety: param('品种筛选；省略时按Portal发送空字符串。', '孵化方法库列表筛选表单', { type: 'string', required: false, default: '' }),
      gen: param('代次筛选；省略时按Portal发送空字符串。', '孵化方法库列表筛选表单', { type: 'string', required: false, default: '' }),
      tempId: param('Portal表单发送的舍内温度ID；省略时发送空字符串。注意Java孵化Mapper使用ageStage，不能把两个键混同。', 'productHatcheryMethodLib.temperatureOptions.result[].value 或Portal列表筛选表单', { type: 'string', required: false, default: '' }),
      pageNo: param('从1开始的页码；默认1。', 'Portal分页状态', { type: 'integer', required: false, default: '1' }),
      pageSize: param('每页条数；只支持10、20、50、100，默认20。', 'Portal分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
    }
    return {}
  }
  if (id.endsWith('-prepare-create')) return { form: param('Portal孵化方法库新建表单；variety、gen和tempId必填，file可省略或使用{fileName,base64,contentType?}。', '用户确认的孵化方法库新建表单', { type: 'object', required: true }) }
  if (id.endsWith('-create')) return {
    draft: param('prepareCreate返回的完整draft；首次确认前不要改写业务字段或文件。', 'productHatcheryMethodLib.prepareCreate.result.draft', { type: 'object', required: true }),
    flag: param('重复预案处理方式；首次create省略，收到status=conflict后由用户明确选择1替换、2增加或3覆盖。', '用户在Portal重复预案弹窗中的明确选择', { type: '1 | 2 | 3', required: false, options: [{ value: 1, label: '替换' }, { value: 2, label: '增加' }, { value: 3, label: '覆盖' }] }),
  }
  if (id.endsWith('-prepare-update')) return { form: param('当前Portal列表行的编辑表单；variety、gen、tempId和suiteCode必须存在，文件不由用户提供。', '当前孵化方法库列表行和用户确认的编辑字段', { type: 'object', required: true }) }
  if (id.endsWith('-update')) return { draft: param('prepareUpdate返回的五字段草稿；file固定为null，确认后原样提交。', 'productHatcheryMethodLib.prepareUpdate.result.draft', { type: 'object', required: true }) }
  return { suiteCode: param('当前列表行的非空suiteCode；必须来自最近一次list结果。', 'productHatcheryMethodLib.list.result.list[].suiteCode', { type: 'string', required: true }) }
}

function contractFor (id: string): AiContract {
  const suffix = id.replace('product-hatchery-method-lib-', '')
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
    steps.push({ role: 'required', when: '用户确认提交准备好的新建表单', capabilityId: 'product-hatchery-method-lib-create', mapping: { draft: 'result.draft' }, instruction: '先把result.draft交给create且不带flag；如果返回conflict，向用户展示替换/增加/覆盖三项选择。' })
    steps.push({ role: 'cancel', when: '用户取消新建或取消重复预案选择', instruction: '只丢弃draft，不调用create；Portal取消弹窗也不会发送第二次请求。' })
  }
  if (isCreate) {
    steps.push({ role: 'required', when: '首次create返回status=conflict', capabilityId: 'product-hatchery-method-lib-create', mapping: { draft: 'args.draft', flag: 'user.flag' }, instruction: '只有用户明确选择1替换、2增加或3覆盖后，才允许把同一draft和flag再次提交；不要自动选择或重发无flag请求。' })
    steps.push({ role: 'required', when: '请求成功、返回冲突或响应不确定', capabilityId: 'product-hatchery-method-lib-list', mapping: {}, instruction: '先按最近的variety、gen、tempId和suiteCode回查；同时注意Java孵化列表返回ageStage而非Portal预期tempId。' })
    steps.push({ role: 'cancel', when: '用户收到conflict后取消选择', instruction: '丢弃draft，不发送带flag的第二次请求。' })
  }
  if (isPrepareUpdate) {
    steps.push({ role: 'required', when: '用户确认提交编辑草稿', capabilityId: 'product-hatchery-method-lib-update', mapping: { draft: 'result.draft' }, instruction: '把result.draft原样交给update；file必须保持null。' })
    steps.push({ role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不调用update。' })
  }
  if (isUpdate) {
    steps.push({ role: 'required', when: '编辑请求成功或响应不确定', capabilityId: 'product-hatchery-method-lib-list', mapping: {}, instruction: '重新读取列表并按suiteCode核对品种、代次和Java实际ageStage；不要只把true当作已落库。' })
  }
  if (isPrepareRemove) {
    steps.push({ role: 'required', when: '用户确认删除当前方法库行', capabilityId: 'product-hatchery-method-lib-remove', mapping: { suiteCode: 'result.suiteCode' }, instruction: '只把prepareRemove返回的suiteCode交给remove；确认前不要发送GET删除请求。' })
    steps.push({ role: 'cancel', when: '用户取消删除确认', instruction: '丢弃suiteCode，不调用remove。' })
  }
  if (isRemove) {
    steps.push({ role: 'required', when: '删除请求成功或响应不确定', capabilityId: 'product-hatchery-method-lib-list', mapping: {}, instruction: '重新读取列表确认同一suiteCode不再出现；不要把GET改成DELETE。' })
  }

  const output = isTemperatureOptions
    ? temperatureOutput
    : isList
      ? { shape: '{ list: object[], total: integer }', fields: [field('$', 'object', '孵化方法库分页结果。'), ...rowFields], empty: 'list=[]表示当前页没有记录；total=0表示筛选条件下没有记录。权限、网络或响应结构错误会抛出。' }
      : isPrepareCreate
        ? { shape: '{ draft: object }', fields: createDraftFields, empty: '表单、文件扩展名或Base64不满足Portal规则时抛错，且不发请求。' }
        : isCreate
          ? createOutput
          : isPrepareUpdate
            ? { shape: '{ draft: object }', fields: updateDraftFields, empty: '编辑表单缺少Portal必填字段时抛错，且不发POST。' }
            : isPrepareRemove
              ? { shape: '{ suiteCode: string }', fields: [field('suiteCode', 'string', '尚未发送删除请求的当前列表行业务编码。')], empty: 'suiteCode为空时抛错，且不发请求。' }
              : suffix === 'download-template' ? fileOutput : trueOutput
  const effect: AiContract['effect'] = isList || isTemperatureOptions || suffix === 'download-template' ? 'read' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? 'prepare' : 'write'

  return {
    purpose: isTemperatureOptions ? '读取孵化方法库表单需要的舍内温度候选。' : isList ? '按Portal筛选条件分页读取孵化预案方法库。' : isPrepareCreate ? '按Portal新建弹窗规则准备孵化方法库导入草稿。' : isCreate ? '按Portal重复预案交互执行孵化方法库新建/导入。' : isPrepareUpdate ? '按Portal编辑弹窗规则准备孵化方法库编辑草稿。' : isUpdate ? '按Portal实际JSON提交孵化方法库编辑。' : isPrepareRemove ? '准备一个经过用户确认的孵化方法库suiteCode删除草稿。' : isRemove ? '按Portal实际GET接口删除孵化方法库预案。' : '下载Portal新建弹窗使用的方法库模板。',
    whenToUse: `需要在${PRODUCT_HATCHERY_METHOD_LIB_PAGE_PATH}页面执行对应${isList || isTemperatureOptions ? '查询' : '操作'}时使用。`,
    effect,
    inputs: inputFor(id),
    output,
    consume: isTemperatureOptions
      ? ['把value作为Portal列表/表单的tempId，把label用于展示；不要用inTitle反查不存在的ID。']
      : isList
        ? ['用list[].suiteCode进入编辑/删除流程；当前Java列表DTO通常没有id，不能从名称猜业务编码。', '同时检查ageStage/ageStageName；tempId/tempName在孵化Java返回中通常为空。', 'total是筛选后的总数，不是当前页长度。']
        : isPrepareCreate
          ? ['把draft展示给用户；确认后首次create省略flag；file为空时仍按Portal提交，但不能据此宣称Java孵化接口一定接受。']
          : isCreate
            ? ['submitted只表示请求未抛错；conflict只表示需要二次选择，不是写入成功；写入后必须list回查。']
            : isPrepareUpdate
              ? ['把draft展示给用户；确认后原样交给update，file保持null。']
              : isPrepareRemove
                ? ['用户确认前只保存suiteCode；取消只丢弃本地草稿。']
                : suffix === 'download-template'
                  ? ['把返回的base64保存为fileName对应的文件；不要把base64当作方法库业务记录。']
                  : ['true只表示请求未抛错；必须按步骤list回查最终状态，并关注Java ageStage字段。'],
    boundaries: commonBoundaries,
    prerequisites: ['使用当前用户、当前租户会话token，并确认用户拥有页面权限；新建/编辑还需要program:method-lib:submit，删除还需要program:method-lib:delete。', ...(isCreate || isPrepareCreate || isUpdate || isPrepareUpdate || isRemove || isPrepareRemove ? ['写操作目标必须来自当前页面最新列表、当前温度选项或同一次prepare结果。'] : [])],
    steps,
    completion: isTemperatureOptions ? '获得与Portal下拉消费形状一致的温度选项。' : isList ? '获得与Portal列表customLoad消费形状一致的list和total，同时保留Java返回的ageStage字段。' : isPrepareCreate || isPrepareUpdate || isPrepareRemove ? '获得尚未改变服务端的本地草稿。' : suffix === 'download-template' ? '获得可保存的方法库模板二进制。' : '请求按Portal页面的URL、HTTP方法、参数和二阶段规则完成，并通过list回查业务终态。',
    failures: ['表单、文件、Base64、分页、suiteCode、权限、网络、Java业务错误或Portal/Java的tempId-ageStage字段错位均抛出，不能降级为空列表、假成功或自动选择flag。', ...(isCreate ? ['首次冲突后如果用户未选择flag，不得继续发送导入请求。'] : [])],
    idempotency: isList || isTemperatureOptions || isPrepareCreate || isPrepareUpdate || isPrepareRemove || suffix === 'download-template' ? null : '页面没有requestId幂等协议；新建导入、编辑和删除响应不确定时先list回查，再决定是否重试，避免重复导入或重复修改。',
    evidence,
    gaps,
  }
}

const contracts = Object.fromEntries(productHatcheryMethodLibCapabilities.map(definition => [definition.id, contractFor(definition.id)]))
for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`孵化预案方法库契约没有对应能力定义：${id}`)

export const PRODUCT_HATCHERY_METHOD_LIB_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_HATCHERY_METHOD_LIB_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_HATCHERY_METHOD_LIB_METHODS).map(([id, method]) => [
    `productHatcheryMethodLib.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productHatcheryMethodLib.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
