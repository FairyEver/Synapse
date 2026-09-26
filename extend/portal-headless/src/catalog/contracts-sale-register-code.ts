import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALE_REGISTER_CODE_METHODS } from '../capabilities/sale-register-code.js'

const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })

const pagePath = '/dashboard/sale/customer/register-code/list'
const pagePermission = '/dashboard/sale/frame/customer/registerCode'
const actionPermission = 'customer:registerCode:edit'

const rowFields: AiField[] = [
  field('list[].id', 'string | number | null', '国家代码记录ID；删除时使用，保留字符串避免长整数精度损失', { nullable: true, nullMeaning: '没有ID，不能执行删除' }),
  field('list[].number', 'string | null', 'Excel序号列；按后端原值展示', { nullable: true }),
  field('list[].provinceCode', 'string | null', '省份代码；导入时后端要求为数字字符串', { nullable: true }),
  field('list[].city', 'string | null', '市名称', { nullable: true }),
  field('list[].area', 'string | null', '区县名称', { nullable: true }),
  field('list[].breedingCode', 'string | null', '畜禽养殖代码；可用于列表模糊筛选', { nullable: true }),
  field('list[].farmerName', 'string | null', '养殖场户名称；可用于列表模糊筛选', { nullable: true }),
  field('list[].formerBreedingCode', 'string | null', '原有畜禽养殖代码', { nullable: true }),
  field('list[].farmAddress', 'string | null', '养殖场地址', { nullable: true }),
  field('list[].name', 'string | null', '姓名；可用于列表模糊筛选', { nullable: true }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', '国家代码分页结果'),
    field('list', 'object[]', '当前页记录；不是全量结果'),
    field('total', 'number', '符合筛选条件的记录总数，用于分页，不是当前页长度'),
    ...rowFields,
  ],
  empty: 'list=[]表示当前页没有记录；total=0才表示当前筛选无记录，权限或网络失败会抛错。',
}

const filePreviewOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, byteLength }',
  fields: [
    field('fileName', 'string', '准备上传的原始文件名；必须以.xls或.xlsx结尾'),
    field('contentType', 'string', 'multipart文件MIME；省略时SDK按扩展名补标准xls/xlsx MIME'),
    field('byteLength', 'number', 'Base64解码后的文件字节数；必须大于0'),
  ],
  empty: '扩展名、Base64或文件内容不合法时准备阶段抛错，不发送上传请求。',
}

const fileParams: Record<string, AiParameter> = {
  fileName: param('Portal文件选择器接受的Excel文件名。', '用户选择的本地文件名', { type: 'string', required: true, constraints: ['必须以.xls或.xlsx结尾；大小写不敏感。'] }),
  base64: param('同一份原始Excel文件内容的标准Base64。', '用户选择的本地文件', { type: 'string', required: true, constraints: ['必须为非空标准Base64；prepare和import必须使用同一份内容。'] }),
  contentType: param('上传文件MIME类型。', '用户文件元数据', { type: 'string | null', required: false, nullable: true, omitted: '省略时按.xls或.xlsx扩展名补标准MIME；Portal源码只校验扩展名，不把MIME作为业务拒绝条件。' }),
}

const idParam = param('国家代码记录ID。', 'sale-register-code-list.list[].id', { type: 'string | number', required: true, constraints: ['必须来自当前用户可见列表；不能用number、breedingCode或姓名代替。'] })

const gaps = [
  '尚未在真实测试环境执行本页列表、导入和删除闭环；当前证据来自Portal页面、CRM Java Controller/Entity/Service/Mapper与离线请求断言。',
]

function base (id: string, purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      `只覆盖门户系统设置/销售设置下的“国家代码管理”页面${pagePath}；不是销售独立业务菜单。`,
      `列表权限是${pagePermission}；导入和删除按钮另受${actionPermission}控制。SDK不会根据本地权限清单猜测授权，后端拒绝原样抛出。`,
      '页面请求使用Portal crm.js实例（baseURL取VITE_CRM_API），module-type=60；接入方必须配置httpBaseUrls.crm，不能拿默认platform baseUrl代替。',
      '页面只有分页、导入和单条删除入口；后端存在的save/getRegisterCode接口没有页面入口，不作为本能力暴露。',
      '页面删除前由确认弹窗把记录ID交给DELETE；页面导入只按文件名扩展名接受.xls/.xlsx，并以multipart字段file提交。',
    ],
    effect,
    prerequisites: ['使用带会话token、tenantId和crm base URL的SDK；写操作的ID或文件必须来自用户明确选择。'],
    inputs: {},
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? 'Promise完成只表示Portal请求成功；导入或删除后必须重新查询核实，不把空回执当业务数据。' : '返回通过结构校验的页面数据或无副作用的准备结果。',
    failures: ['非法ID、文件扩展名、Base64或空文件在请求前失败；权限、租户、网络和后端业务错误原样抛出。', '响应缺少页面实际需要的字段时抛错，不把空值伪造成成功。'],
    idempotency: effect === 'write' ? '页面接口没有requestId幂等契约；超时或响应丢失时先列表核实，不能盲目重发导入或删除。' : null,
    evidence: [
      { source: 'CodeReview_Projects_Js@test/portal/main: app/portal/menus/sale.js:214 与 app/portal/views/dashboard/sale/customer/register-code/list.vue', kind: 'reference', note: '证明页面归属、过滤字段、分页参数、crm实例、导入文件扩展名、multipart字段、动作权限和单条删除请求。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-crm/.../RegisterCodeVueController.java、RegisterCode.java、CRegisterCodeService.java、RegisterCodeDao.xml', kind: 'reference', note: '证明list/import/delete路由、分页count/list响应、导入省份代码校验、租户注入和删除前客户占用校验。' },
      { source: 'src/capabilities/sale-register-code.ts 与 test/sale-register-code.test.ts', kind: 'test', note: '锁定SDK请求、参数、CRM实例、module-type、文件和响应结构；不替代真实环境验证。' },
      { source: 'docs/pages/国家代码管理.md', kind: 'reference', note: '记录逐字段基准、权限边界、写操作确认步骤和实测缺口。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'sale-register-code-list': {
    ...base('sale-register-code-list', '查询国家代码分页列表，支持Portal公共排序参数以及按畜禽代码、养殖名称和姓名模糊筛选。', listOutput, ['展示number、provinceCode、city、area、breedingCode、farmerName、formerBreedingCode、farmAddress和name；保留list[].id供删除。', 'total只用于翻页；用户要求完整结果时继续按pageNo翻页，不能把当前页当成全量。']),
    inputs: {
      order: param('Portal公共列表排序值。', 'Portal useListPageModule公共列表状态；页面默认空字符串且没有排序控件', { type: 'string', required: false, omitted: 'SDK发送空字符串；不要据此推断页面提供了排序交互' }),
      orderField: param('Portal公共列表排序字段。', 'Portal useListPageModule公共列表状态；页面默认空字符串且没有排序控件', { type: 'string', required: false, omitted: 'SDK发送空字符串；不要据此推断页面提供了排序交互' }),
      breedingCode: param('畜禽养殖代码模糊筛选片段。', '用户输入；页面默认空字符串', { type: 'string', required: false, omitted: 'SDK发送空字符串表示不筛选' }),
      farmerName: param('养殖场户名称模糊筛选片段。', '用户输入；页面默认空字符串', { type: 'string', required: false, omitted: 'SDK发送空字符串表示不筛选' }),
      name: param('姓名模糊筛选片段。', '用户输入；页面默认空字符串', { type: 'string', required: false, omitted: 'SDK发送空字符串表示不筛选' }),
      pageNo: param('页码，从1开始。', '调用方分页状态', { type: 'integer', required: false, default: 'SDK默认1' }),
      pageSize: param('每页记录数。', '调用方分页状态', { type: 'integer', required: false, default: 'SDK默认20', constraints: ['接受Portal常用分页值10/20/50/100/200/500。'] }),
    },
  },
  'sale-register-code-prepare-import': {
    ...base('sale-register-code-prepare-import', '按Portal国家代码导入控件规则检查Excel文件并生成尚未上传的预览。', filePreviewOutput, ['向用户展示文件名、MIME和字节数；确认后把同一fileName/base64/contentType交给sale-register-code-import。', '用户取消时只丢弃预览，不发送POST。'], 'prepare'),
    inputs: fileParams,
    steps: [{ role: 'required', when: '用户明确确认导入', capabilityId: 'sale-register-code-import', mapping: { fileName: 'args.fileName', base64: 'args.base64', contentType: 'args.contentType' }, instruction: '使用prepare通过的同一份原始文件，提交multipart字段file。' }, { role: 'cancel', when: '用户取消导入', instruction: '只丢弃本地预览，不发送POST。' }],
  },
  'sale-register-code-import': {
    ...base('sale-register-code-import', '把用户确认的国家代码Excel导入当前租户。', { shape: 'string | number', fields: [field('$', 'string | number', '后端导入成功回执；当前Java源码为成功提示字符串，Portal页面按插值展示；不把它解释为可靠导入条数')], empty: '成功回执可能是字符串或数字；失败抛异常。' }, ['先执行prepareImport并取得用户确认，再提交同一文件；成功后重新list逐页核对新增记录。', '后端会逐行检查provinceCode为数字并把文件记录绑定当前用户租户；错误行号或格式错误需修正文件后重试。'], 'write'),
    inputs: fileParams,
  },
  'sale-register-code-prepare-remove': {
    ...base('sale-register-code-prepare-remove', '准备删除当前列表中选定的一条国家代码记录。', { shape: '{ id }', fields: [field('id', 'string | number', '待删除国家代码记录ID')], empty: 'ID非法时抛错；准备阶段不发送DELETE。' }, ['展示用户选中的记录并等待确认；确认后把result.id交给sale-register-code-remove，取消时丢弃草稿。'], 'prepare'),
    inputs: { id: idParam },
    steps: [{ role: 'required', when: '用户明确确认删除', capabilityId: 'sale-register-code-remove', mapping: { id: 'result.id' }, instruction: '提交同一个列表记录ID；成功或超时后重新list核对该ID。' }, { role: 'cancel', when: '用户取消删除', instruction: '丢弃删除草稿，不发送DELETE。' }],
  },
  'sale-register-code-remove': {
    ...base('sale-register-code-remove', '删除一条国家代码记录。', { shape: 'undefined', fields: [field('$', 'undefined', 'Portal DELETE成功回执无业务数据；后端实际是逻辑删除或成功空回执')], empty: 'Promise完成表示请求成功；必须列表回查确认记录不再出现。' }, ['只能传当前列表得到的id；页面没有批量删除。成功后重新list逐页查找目标ID，若仍出现则报告未核实，不自动重试。'], 'write'),
    inputs: { id: idParam },
    steps: [{ role: 'recovery', when: '删除成功、超时或响应丢失后核实结果', capabilityId: 'sale-register-code-list', instruction: '用原筛选条件分页查询并核对目标ID是否消失；后端可能拒绝删除被客户使用的代码，不能只看HTTP成功。' }],
  },
}

export const SALE_REGISTER_CODE_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALE_REGISTER_CODE_METHODS).map(id => [id, contracts[id]!]))
export const SALE_REGISTER_CODE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALE_REGISTER_CODE_METHODS).map(([id, method]) => [`saleRegisterCode.${method}`, SALE_REGISTER_CODE_AI_CONTRACTS[id]!]))
