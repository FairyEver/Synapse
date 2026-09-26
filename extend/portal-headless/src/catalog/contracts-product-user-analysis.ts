import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_USER_ANALYSIS_METHODS,
  productUserAnalysisCapabilities,
} from '../capabilities/product-user-analysis.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  ...extra,
})

const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning,
  source,
  ...extra,
})

const definitions = new Map(productUserAnalysisCapabilities.map(definition => [definition.id, definition]))

const queryInputs: Record<string, AiParameter> = {
  userPermissionList: param('用户群体多选代码数组：PS=父母代、CS=商品代、YS=青年鸡、BS=种鸡；空数组或省略表示全部。不要传中文标签。', '用户确认的Portal用户群体筛选', { type: 'array<string>', required: false, default: '[]', options: [{ value: 'PS', label: '父母代' }, { value: 'CS', label: '商品代' }, { value: 'YS', label: '青年鸡' }, { value: 'BS', label: '种鸡' }] }),
  isUsed: param('是否使用筛选：字符串1=是、字符串0=否、空字符串=全部；省略时复刻页面默认字符串1。', '用户确认的Portal单选值', { type: 'string', required: false, default: '1', options: [{ value: '1', label: '是' }, { value: '0', label: '否' }, { value: '', label: '全部' }] }),
  startDate: param('统计开始日期，含当天，格式YYYY-MM-DD；省略时为当前日期前30天。', '用户选择日期或页面默认值', { type: 'string', required: false, default: '当前日期前30天', format: 'YYYY-MM-DD' }),
  endDate: param('统计结束日期，含当天，格式YYYY-MM-DD；省略时为当前日期。', '用户选择日期或页面默认值', { type: 'string', required: false, default: '当前日期', format: 'YYYY-MM-DD' }),
}

const rowOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '一条用户使用分析记录；SDK保留Java UserLogReport2DTO中的页面字段及导出辅助字段。'),
    field('[].userPermission', 'string | null', '用户群体展示名称，例如父母代、商品代、青年鸡或种鸡。', { nullable: true, nullMeaning: '后端未返回群体名称' }),
    field('[].companyName', 'string | null', '公司简称或展示名称。', { nullable: true, nullMeaning: '后端未返回公司名称' }),
    field('[].userPhone', 'string | null', '用户手机号；按敏感字段处理，不写入日志。', { nullable: true, nullMeaning: '后端未返回手机号' }),
    field('[].userName', 'string | null', '用户姓名。', { nullable: true, nullMeaning: '后端未返回姓名' }),
    field('[].isUsed', 'string | null', '后端计算的是否使用展示值，通常为是或否；不要把它当作请求参数isUsed的原值。', { nullable: true, nullMeaning: '后端未返回展示值' }),
    field('[].loginCount', 'integer | null', '统计期间登录功能调用次数。', { nullable: true, nullMeaning: '后端未返回次数' }),
    field('[].appUseCount', 'integer | null', '统计期间非PC设备使用次数；按Java实现原值消费。', { nullable: true, nullMeaning: '后端未返回次数' }),
    field('[].pcUseCount', 'integer | null', '统计期间PC设备使用次数。', { nullable: true, nullMeaning: '后端未返回次数' }),
    field('[].useDateList', 'string[] | null', '实际使用日期字符串数组；Portal表格将数组join为展示文本。', { nullable: true, nullMeaning: '后端未返回日期数组' }),
    field('[].useDateStr', 'string | null', '后端为导出列准备的使用日期拼接字符串；不是表格列表的useDateList替代值。', { nullable: true, nullMeaning: '后端未返回导出字符串' }),
    field('[].useFunctionList', 'string[] | null', '实际使用过的功能名称数组；Portal表格将数组join为展示文本。', { nullable: true, nullMeaning: '后端未返回功能数组' }),
    field('[].useFunctionStr', 'string | null', '后端为导出列准备的使用功能拼接字符串；不是表格列表的useFunctionList替代值。', { nullable: true, nullMeaning: '后端未返回导出字符串' }),
    field('[].useRate', 'string | null', '日使用率原字符串；不要擅自转换为百分比数值。', { nullable: true, nullMeaning: '未计算或后端返回空字符串' }),
    field('[].weekUseRate', 'string | null', '按自然查询区间内七日窗口计算的周使用率原字符串。', { nullable: true, nullMeaning: '未计算或后端返回空字符串' }),
    field('[].sort', 'integer | null', 'Java DTO中的排序辅助字段；Portal当前表格不展示。', { nullable: true, nullMeaning: '后端未返回排序值' }),
  ],
  empty: '[]表示当前日期、用户群体和使用状态筛选没有统计记录；权限、会话、网络、日期边界或响应形状错误会抛出。',
}

const listContract: AiContract = {
  purpose: '按用户群体、是否使用和日期范围查询Portal用户使用分析列表。',
  whenToUse: '需要查看各公司用户在指定期间的登录、App/PC使用次数、使用日期、使用功能和使用率时调用。',
  effect: 'read',
  inputs: queryInputs,
  output: rowOutput,
  consume: [
    '使用userPermission、companyName、userName、userPhone和isUsed做身份及群体展示；使用loginCount、appUseCount、pcUseCount、useDateList、useFunctionList、useRate、weekUseRate填充页面表格。',
    'useDateList和useFunctionList是数组，空数组或null只表示后端没有对应明细；不要把useDateStr/useFunctionStr当列表字段的同名替代。',
  ],
  boundaries: [
    '页面路径是/dashboard/product/operation/business/user-analysis/list，权限码是/dashboard/frame/business/analysis；不要误用同名的高产或稳产用户使用分析权限。',
    '请求使用Portal product axios实例，发送POST /use/statistics/userLogReport2，product实例补devicetype=PC；页面不发送module-type。',
    '请求体严格包含userPermissionList、isUsed、startDate、endDate、scope=1、menuName=用户使用分析；userPermissionList使用PS/CS/YS/BS代码，不使用中文标签。',
    'Portal表单startDate和endDate均为必填规则，但页面已提供当前日期前30天至当前日期的默认值；SDK省略时复刻该默认值，日期范围必须不超过Java PageHelperUtil的1000天上限。',
    'Portal的否选项实际提交字符串0；当前Java服务仅对Integer 2执行“未使用”分支，SDK忠实发送Portal的0，不暗中改成2或承诺后端会按否过滤。',
    '页面列表错误会在浏览器中显示空结果，但SDK只把后端null/undefined响应归一为空数组；权限、网络、业务和响应形状错误继续抛出。',
  ],
  prerequisites: ['用户拥有/dashboard/frame/business/analysis权限；日期和用户群体筛选来自当前页面可选项。'],
  steps: [],
  completion: '返回Java UserLogReport2DTO数组；空数组是合法业务结果，不能据此判断没有权限。',
  failures: ['非法用户群体代码、状态值、日期格式、反向日期或超过1000天的范围在发请求前失败；后端权限、网络、业务异常和坏响应抛出。'],
  idempotency: null,
  evidence: [
    { source: 'app/portal/menus/product/operation.js 与 app/portal/views/dashboard/product/operation/business/user-analysis/list.vue', kind: 'reference', note: '逐页核对菜单路径、权限、默认筛选、表格字段、列表请求和错误处理。' },
    { source: 'UseStatisticsController、UserLogSearchVO、UserLogReport2DTO、ApiStatisticsServiceImpl、PageHelperUtil', kind: 'reference', note: '核对POST路径、DTO字段、日期上限1000天、结果上限及用户群体代码语义。' },
    { source: 'src/capabilities/product-user-analysis.ts 与 test/product-user-analysis.test.ts', kind: 'implementation', note: '锁定product实例、请求体、选项边界、完整行字段和坏响应反证；不替代真实环境浏览器读请求。' },
    { source: 'docs/pages/用户使用分析.md', kind: 'reference', note: '记录页面四件套和真实环境证据边界。' },
  ],
  gaps: ['已逐页核对Portal页面、菜单、Java Controller/VO/DTO/Service、SDK实现和离线反证测试；尚未在真实测试环境执行浏览器列表读请求。'],
}

const exportContract: AiContract = {
  purpose: '按当前用户使用分析筛选条件导出Portal Excel，并取得服务端生成的文件名。',
  whenToUse: '用户明确需要离线Excel时调用；筛选必须与已经核对过的列表条件一致。',
  effect: 'read',
  inputs: queryInputs,
  output: {
    shape: 'string',
    fields: [field('$', 'string', '服务端生成的导出文件名；Portal随后把它拼入同一product host的/download/{fileName}下载地址。')],
    empty: '服务端没有返回非空fileName时抛出；不能把空字符串当作导出成功。',
  },
  consume: [
    '保存返回的fileName并按调用方文件下载策略处理；它是服务端文件名，不是Excel二进制内容，也不是列表记录ID。',
    'SDK发送的columnHeader固定复刻Portal列扫描结果：useDateList/useFunctionList在导出时改为useDateStr/useFunctionStr；不要自行按列表字段名重建表头。',
  ],
  boundaries: [
    '请求使用Portal product axios实例，发送POST /use/statistics/userLogReport2/export；页面不发送module-type。',
    '请求体包含列表筛选的userPermissionList、isUsed、startDate、endDate、scope=1、menuName=用户使用分析，并增加固定columnHeader；不要把pageNo/pageSize或分页排序字段加入导出体。',
    'Portal导出钩子把服务端返回的fileName拼成/download/{fileName}并带token触发浏览器下载；SDK只返回真实fileName，不伪造Base64或把文件名当成业务写入回执。',
    'Java导出控制器收到请求后将menuName覆盖为用户使用情况报表，再生成并登记服务器文件；这是服务端内部文件标题行为，不改变SDK对Portal提交体的复刻。',
  ],
  prerequisites: ['用户拥有/dashboard/frame/business/analysis权限；已确认筛选条件和导出需求。'],
  steps: [],
  completion: '得到非空服务端fileName；只有下载端进一步成功才算用户拿到Excel文件。',
  failures: ['筛选或日期参数非法、服务端生成文件失败、权限/网络错误或响应缺少fileName时抛出；不要仅凭POST未抛错猜测文件已下载。'],
  idempotency: null,
  evidence: [
    { source: 'app/portal/views/dashboard/product/operation/business/user-analysis/list.vue 与 app/portal/hooks/product/use-report-export.js', kind: 'reference', note: '逐页核对导出接口、公共表头扫描、筛选体合并和/download文件名行为。' },
    { source: 'UseStatisticsExcelController.userLogReport2Excel、UserLogReport2DTO', kind: 'reference', note: '核对POST路径、menuName覆盖、columnHeader消费、fileName回执和导出辅助字段。' },
    { source: 'src/capabilities/product-user-analysis.ts 与 test/product-user-analysis.test.ts', kind: 'implementation', note: '锁定导出字段顺序、columnHeader替换和非空文件名校验；不替代真实环境导出/下载验证。' },
    { source: 'docs/pages/用户使用分析.md', kind: 'reference', note: '记录导出请求和外部下载证据边界。' },
  ],
  gaps: ['已逐页核对Portal导出代码、Java导出控制器、SDK请求体和离线反证测试；尚未在真实测试环境执行导出后下载验证。'],
}

const contracts: Record<string, AiContract> = {
  'product-user-analysis-list': listContract,
  'product-user-analysis-export': exportContract,
}

for (const id of Object.keys(contracts)) {
  if (!definitions.has(id)) throw new Error(`用户使用分析契约没有对应能力定义：${id}`)
}

export const PRODUCT_USER_ANALYSIS_AI_CONTRACTS = contracts
export const PRODUCT_USER_ANALYSIS_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_USER_ANALYSIS_METHODS).map(([id, method]) => [
    `productUserAnalysis.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为 productUserAnalysis.${method}；该页面没有prepare、submit、cancel写入链路。`] },
  ]),
)
