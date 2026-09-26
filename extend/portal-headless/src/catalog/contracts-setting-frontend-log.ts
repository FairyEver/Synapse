import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SETTING_FRONTEND_LOG_METHODS } from '../capabilities/setting-frontend-log.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const nodeFields = (prefix: string): AiField[] => {
  const at = (key: string) => prefix ? `${prefix}.${key}` : key
  return [
    field(at('id'), 'string | number', '菜单节点主键；服务端通过 ToStringSerializer 可能返回字符串', { constraints: ['长 ID 保留原始字符串'] }),
    field(at('pid'), 'string | number', '父菜单节点主键；0 表示根节点'),
    field(at('name'), 'string | null', '菜单名称；当前页面表格未展示，但属于接口返回节点', { nullable: true, nullMeaning: '后端未返回名称' }),
    field(at('url'), 'string | null', '菜单 URL', { nullable: true, nullMeaning: '该菜单没有 URL 或后端未返回' }),
    field(at('menuType'), 'integer | null', '菜单类型；后端约定0=菜单、1=按钮', { nullable: true, nullMeaning: '后端未返回类型' }),
    field(at('project'), 'integer | null', '所属项目编号', { nullable: true, nullMeaning: '后端未返回项目' }),
    field(at('icon'), 'string | null', '菜单图标', { nullable: true, nullMeaning: '未配置图标' }),
    field(at('permissions'), 'string | null', '菜单授权标识；多个权限以逗号分隔', { nullable: true, nullMeaning: '未配置授权标识' }),
    field(at('sort'), 'integer | null', '菜单排序值', { nullable: true, nullMeaning: '后端未返回排序' }),
    field(at('createDate'), 'string | number | null', '菜单创建时间原值', { nullable: true, nullMeaning: '后端未返回创建时间' }),
    field(at('parentName'), 'string | null', '父菜单名称', { nullable: true, nullMeaning: '后端未返回父名称' }),
    field(at('useSystem'), 'integer | null', '使用系统编号；后端查询不按系统筛选', { nullable: true, nullMeaning: '后端未返回系统编号' }),
    field(at('children'), 'object[]', '递归子菜单节点；空数组表示本次结果没有子节点'),
  ]
}

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/common.js 与 app/portal/views/dashboard/hr/setting/log/list.vue @ bbcfc35154', kind: 'reference', note: '证明菜单只在非生产环境挂出、权限路径、platform 实例、text/finger 表单、非分页请求和页面展示字段。' },
  { source: 'HrSysMenuController、HrSysMenuServiceImpl、SysMenuDao.xml、SysMenuDTO @ b7a359adc9e', kind: 'reference', note: '证明 /sys/menu/menuListNotBySystem 无查询参数、返回不区分系统的全量树、节点字段和 children 结构；该 Controller 没有页面动作写接口。' },
  { source: 'src/capabilities/setting-frontend-log.ts 与 test/setting-frontend-log.test.ts', kind: 'implementation', note: '证明 SDK 最终请求形状、树字段校验、错误传播和离线反证；不替代真实环境浏览器基准。' },
]

export const SETTING_FRONTEND_LOG_AI_CONTRACTS: Record<string, AiContract> = {
  'setting-frontend-log-list': {
    purpose: '读取 Portal 系统设置中“前端日志”页面展示的菜单树数据。',
    whenToUse: '用户需要查看该页面当前返回的菜单节点、菜单 URL、权限标识或系统归属信息时使用。',
    boundaries: [
      '页面菜单只在 Portal 非生产环境通过 isProd 条件挂出；生产环境不应把该入口当成可见功能。',
      '页面名为“前端日志”，但源码实际调用 /admin-api/sys/menu/menuListNotBySystem 返回 HR 菜单树；SDK 保留这个真实接口语义，不把节点误称为浏览器 console 日志。',
      '页面筛选框 text/finger 会按 Portal 形状放进请求参数，但 Java Controller 无参数且 SQL 不消费它们，因此它们不会改变返回结果。',
      '这是只读能力；当前页面没有创建、修改、删除、导出或详情动作，SDK 不发布菜单写接口。',
      '当前证据来自固定 Portal/Java 源码和离线夹具，尚未在真实测试环境执行浏览器读请求。',
    ],
    effect: 'read',
    prerequisites: ['使用带当前用户会话 token 的 SDK，并确认用户确实处于 Portal 非生产环境和该菜单权限范围。'],
    inputs: {
      text: param('日志内容筛选片段；Portal 会提交，但当前后端接口忽略。', '用户输入', { type: 'string', required: false, omitted: 'SDK 发空字符串；不会声称服务端已过滤' }),
      finger: param('日志指纹筛选片段；Portal 会提交，但当前后端接口忽略。', '用户输入', { type: 'string', required: false, omitted: 'SDK 发空字符串；不会声称服务端已过滤' }),
    },
    output: {
      shape: 'object[]',
      fields: [field('$', 'object[]', '不区分系统的菜单树根节点数组'), ...nodeFields('[]'), ...nodeFields('[].children[]')],
      empty: '[] 表示后端返回空菜单树；请求失败/权限失败会抛出，不能解释为没有日志。',
    },
    consume: [
      '按 children 递归遍历节点；展示页面实际消费的 project、url、name、time 等字段前先确认后端返回对象是否包含对应扩展字段。',
      'permissions 是逗号分隔授权标识，不能当作单一权限码；useSystem 只是归属编号，不改变本接口“不区分系统”的查询语义。',
    ],
    steps: [],
    completion: '交付接口返回的完整菜单树；空数组是数据结果，不是权限降级。',
    failures: ['响应不是数组、节点 ID/PID/children 类型错误、登录/权限/网络/后端错误都应原样报告；不能返回空数组掩盖错误。'],
    idempotency: null,
    evidence,
  },
}

export const SETTING_FRONTEND_LOG_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_FRONTEND_LOG_METHODS).map(([id, method]) => [`settingFrontendLog.${method}`, { ...SETTING_FRONTEND_LOG_AI_CONTRACTS[id]!, boundaries: [...SETTING_FRONTEND_LOG_AI_CONTRACTS[id]!.boundaries, '直接方法签名为单个参数对象；list 可省略参数对象。'] }]),
)
