import type { AiContract, AiField, AiParameter } from './ai-contract.js'

const field = (path: string, type: string, meaning: string, nullable = false): AiField => ({ path, type, meaning, ...(nullable ? { nullable } : {}) })
const input = (meaning: string, source: string, format?: string, defaultValue?: string): AiParameter => ({ meaning, source, ...(format ? { format } : {}), ...(defaultValue ? { default: defaultValue } : {}) })
const limit = (value: number, max: number) => input('最多返回条数；本地裁剪，不是服务端分页。超过上限截断到上限。', '调用方按展示预算填写', `正整数，上限 ${max}；无效值回退默认值，非正数归为1，小数取整`, String(value))
const keyword = (meaning: string) => input(meaning, '先向用户取得名称片段；不要用空串请求长候选集', '去首尾空白的非空字符串')
const pageNo = input('从 1 开始的页码。非正数或无效值回退 1，小数取整。', '上一页未覆盖 total 时递增', '正整数', '1')
const pageSize = input('每页数量；-1 被 SDK 拒绝，超过 50 截断到 50。', '调用方按上下文预算填写', '1–50 的整数', '20')
const totals = [field('total', 'number', '过滤前完整索引条数，不是本次返回条数'), field('matched', 'number', '过滤命中数，可能大于当前返回数组长度')]
const truncated = field('truncated', 'boolean', 'true 表示返回集合不完整；不能把当前结果当全集')
const deptFields = (root: string) => [field(`${root}.id`, 'number', '部门标识，供部门详情/下级查询及人员 deptId 使用'), field(`${root}.name`, 'string', '部门名称，用于候选展示'), field(`${root}.parentId`, 'number', '上级部门标识，0 表示根')]
const areaFields = (root: string) => [field(`${root}.id`, 'number', '行政区划标识，供 parentId 或 ids 使用'), field(`${root}.parentId`, 'number', '上级区划标识，0 是根'), field(`${root}.value`, 'string', '行政区划名称；名称字段叫 value，不是 name'), field(`${root}.pathIds[]`, 'number', '从根到本节点的标识路径，含本节点'), field(`${root}.pathNames[]`, 'string', '从根到本节点的名称路径，同名不同级仍保留'), field(`${root}.hasChildren`, 'boolean', '是否有直接下级，可决定是否继续下钻')]
const evidence = (module: string): AiContract['evidence'] => [
  { source: `src/capabilities/${module}.ts`, kind: 'implementation', note: '按真实返回归一化与参数校验复核；SDK 已拆除后端包络' },
  { source: `test/${module}.test.ts`, kind: 'test', note: '已有真实响应形状的脱敏夹具与离线行为回归；不是本轮线上重测' },
]
function contract(module: string, value: Omit<AiContract, 'evidence' | 'idempotency' | 'effect' | 'prerequisites'> & Partial<Pick<AiContract, 'evidence' | 'idempotency' | 'effect' | 'prerequisites'>>): AiContract {
  return { effect: 'read', prerequisites: ['使用已绑定当前用户和租户的 SDK 会话。'], idempotency: null, evidence: evidence(module), ...value }
}
const deptFailure = ['参数错误先修正；部门不存在时重新按名称取候选，不猜新 ID。', '基础索引可能来自会话或实例缓存；基础数据变化后由接入方 invalidate 对应切片再查询。', '401 不能单凭错误码区分会话过期、权限或范围问题；恢复会话后再读，不能把失败当空集合。']
const shellFailure = ['请求失败保留原始错误并检查会话/租户；不要将失败展示成 0 条。', 'BaseShellShapeError 表示响应或接线异常，应报告而非假装空数据。']
const saleFailure = ['SaleNotWiredError 表示未注入 saleRequest/baseUrls.sale；由接入方配置销售实例，不能换用默认 platform 地址。', 'BaseSaleShapeError 表示响应形状不匹配；不要把接线错误读成没有店铺或候选。']
const ossFailure = ['OssCredentialError 由接入方补 OSS 配置；不从页面或仓库抓取密钥。', 'OssUploadParamError 先修正本地路径/对象键/目录；OssRequestError 保留 status、code、requestId、ossMessage 供定位。']
const ossPrereq = ['接入方在 SDK 创建期注入 accessKeyId、accessKeySecret、bucket、endpoint；Portal 会话 token 不能替代 OSS 凭据。']
const objectKey = input('桶内对象路径，不能用公开 URL 代替。禁止前导 /、空路径段、.、..、空白及 ? # %。', 'base-upload-file 返回 objectKey；或接入方明确提供待管理对象键', '非空字符串')
const end = (instruction: string): AiContract['steps'] => [{ role: 'optional', when: '查询已满足用户目的', instruction }]

export const BASE_AI_CONTRACTS: Record<string, AiContract> = {
  'base-dept-search': contract('base-dept-dict-permission', {
    purpose: '按部门名称寻找组织候选，为人员筛选和业务表单取得真实部门 ID。', whenToUse: '用户知道部门名称但没有 ID 时；已知父节点则用 base-dept-children。', boundaries: ['在当前基础部门索引中本地匹配 name，区分大小写；不会查询人员或修改组织。'],
    inputs: { keyword: keyword('部门名称片段，按 name.includes 匹配'), limit: limit(20, 50) },
    output: { shape: '{ list: DeptNode[], total, matched }', fields: [field('list', 'array', '最多 limit 个候选'), ...deptFields('list[]'), ...totals], empty: 'list=[] 且 matched=0 是没有匹配；total 仍为部门索引规模。' },
    consume: ['展示 name；重名时取详情的 pathNames 让用户区分；list.length<matched 表示候选被截断。'],
    steps: [{ role: 'optional', when: '需区分同名组织或展示完整路径', capabilityId: 'base-dept-get', mapping: { id: 'list[].id' }, instruction: '选择候选的数字 id 原样传入。' }, { role: 'optional', when: '用户要找该部门人员', capabilityId: 'base-user-search', mapping: { deptId: 'list[].id' }, instruction: '将选定部门 id 作为 deptId。' }], completion: '交付用户确认的部门候选或明确无匹配；不自动选择同名部门。', failures: deptFailure,
  }),
  'base-dept-get': contract('base-dept-dict-permission', {
    purpose: '读取一个部门及从根到它的组织路径。', whenToUse: '核对部门归属或消除同名歧义。', boundaries: ['路径遇到悬挂父节点或环即停止，不能据此虚构缺失层级。'],
    inputs: { id: input('部门数字标识', 'base-dept-search.list[].id 或 base-dept-children.list[].id', '可转换为有限数字') },
    output: { shape: '{ id, name, parentId, path: {id,name}[], pathNames }', fields: [...deptFields('$'), field('path[].id', 'number', '路径各级部门 ID'), field('path[].name', 'string', '路径各级部门名'), field('pathNames', 'string', '根到当前部门名，用 / 拼接')], empty: 'ID 不存在会抛错，不返回 null。' },
    consume: ['用 pathNames 展示完整归属；仍以 id 作为后续输入，不用路径字符串代替 ID。'],
    steps: [{ role: 'optional', when: '需要查看下一层部门', capabilityId: 'base-dept-children', mapping: { parentId: 'id' }, instruction: '仅查询直接下级。' }], completion: '已交付部门名称和可取得的组织路径。', failures: deptFailure,
  }),
  'base-dept-children': contract('base-dept-dict-permission', {
    purpose: '按上级部门逐层列直接下级。', whenToUse: '组织树逐层选择；不知道名字时可以从 parentId=0 的根开始。', boundaries: ['只给直接下级，total 不是全树部门数；父节点不存在与没有下级都可能是空列表。'],
    inputs: { parentId: input('父部门 ID；0 表示根', 'base-dept-search.list[].id、上次本能力 list[].id，或根常量 0', '有限数字'), limit: limit(50, 200) },
    output: { shape: '{ list: DeptNode[], total }', fields: [field('list', 'array', '最多 limit 个直接下级'), ...deptFields('list[]'), field('total', 'number', '该父节点直接下级总数')], empty: 'list=[] 不足以证明父部门不存在；可用 base-dept-get 核对非零 parentId。' },
    consume: ['用 name 展示、id 继续下钻；返回条数少于 total 时增加 limit 或按名称搜索。'],
    steps: [{ role: 'optional', when: '继续下一层', capabilityId: 'base-dept-children', mapping: { parentId: 'list[].id' }, instruction: '由用户选择当前候选后继续。' }], completion: '用户选定部门或到达无下级节点。', failures: deptFailure,
  }),
  'base-dict-search': contract('base-dept-dict-permission', {
    purpose: '搜索字典类型名，取得翻译枚举所需的 dictType。', whenToUse: '已知业务字典名片段但不知道精确 dictType 时。', boundaries: ['按类型名而不是选项 label 搜索，忽略大小写；同名 status 字典不能跨业务套用。'],
    inputs: { keyword: keyword('dictType 名称片段'), limit: limit(20, 50) },
    output: { shape: '{ list: {dictType,entryCount}[], total, matched }', fields: [field('list[].dictType', 'string', '后续字典读取的精确类型键'), field('list[].entryCount', 'number', '该类型选项数'), ...totals], empty: 'list=[] 表示类型名无匹配；不是该业务没有状态。' },
    consume: ['用 dictType 与业务能力说明交叉核对，不因名称相似就套用。'],
    steps: [{ role: 'required', when: '要取得该字典的值和显示名', capabilityId: 'base-dict-get', mapping: { dictType: 'list[].dictType' }, instruction: '读取选定类型的全部选项。' }], completion: '类型查找任务在交付候选时结束；解释业务值则继续 get/translate。', failures: deptFailure,
  }),
  'base-dict-get': contract('base-dept-dict-permission', {
    purpose: '读取一个明确字典类型的所有选项。', whenToUse: '填写小枚举或给一批业务数据的值贴显示标签。', boundaries: ['只解释给定 dictType；不能把全平台 status 的含义套到流程或租户状态。'],
    inputs: { dictType: input('精确字典类型键', 'base-dict-search.list[].dictType 或业务能力明确指定的类型', '非空字符串') },
    output: { shape: '{ dictType, entries: {label,value,id}[] }', fields: [field('dictType', 'string', '所查询字典类型'), field('entries[].label', 'string', '展示文本'), field('entries[].value', 'string | number', '业务存储值，原 JSON 类型保留'), field('entries[].id', 'string | number', '字典条目自身 ID，不是表单枚举值')], empty: '不存在的 dictType 抛错；存在但无选项时 entries 为空。' },
    consume: ['展示 label，填业务枚举使用 value；比对时 String(value) 归一，不能使用 entry.id 代替 value。'],
    steps: [{ role: 'optional', when: '只需翻译一个已有业务值', capabilityId: 'base-dict-translate', mapping: { dictType: 'dictType', value: 'entries[].value' }, instruction: '传精确类型和要翻译的业务值。' }], completion: '交付选项或完成值到标签的映射。', failures: deptFailure,
  }),
  'base-dict-translate': contract('base-dept-dict-permission', {
    purpose: '将一个业务字典值翻译成显示标签。', whenToUse: '展示已有记录中的枚举值；大量值可先 get 一次后本地映射。', boundaries: ['数字 1 与字符串 "1" 按 String() 等价匹配；不改变业务值。'],
    inputs: { dictType: input('精确字典类型键', '业务说明指定的类型或 base-dict-search.list[].dictType', '非空字符串'), value: input('要翻译的原始业务值', '业务响应字段或 base-dict-get.entries[].value', 'string | number') },
    output: { shape: '{ dictType, value, label: string|null, found }', fields: [field('dictType', 'string', '输入字典类型'), field('value', 'string | number', '输入值原样保留'), field('label', 'string', '匹配选项的显示名，未找到为 null', true), field('found', 'boolean', '是否成功匹配选项')], empty: '值不存在返回 found=false、label=null；dictType 不存在则抛错。' },
    consume: ['found=false 时展示原始值并说明无对应标签；null 不能读成空状态。'], steps: end('把 label 或未匹配的原值交付用户。'), completion: '已展示翻译或明确告知值无匹配。', failures: deptFailure,
  }),
  'base-permission-has': contract('base-dept-dict-permission', {
    purpose: '检查当前用户权限清单是否包含一个精确权限码。', whenToUse: '解释菜单或动作声明；批量检查用 base-permission-check。', boundaries: ['清单结果不是后端权限裁决；false 不等于调用必然 403，true 也不保证写入获准。'],
    inputs: { code: input('页面路径或动作权限码，精确匹配', '能力 permission 或 base-permission-search.list[]', '非空字符串，去首尾空白') },
    output: { shape: 'boolean', fields: [field('$', 'boolean', '权限清单是否包含该码，不是请求成功保证')], empty: 'false 表示清单没有该精确值。' },
    consume: ['按清单事实说明；不要据此把已注册可调用能力隐藏成不存在。'], steps: end('报告清单中的存在性，实际调用仍处理服务端授权结果。'), completion: '已报告该码在当前清单的存在性。', failures: deptFailure,
  }),
  'base-permission-check': contract('base-dept-dict-permission', {
    purpose: '批量检查并区分已有和缺失的权限码。', whenToUse: '核对一组页面/动作声明。', boundaries: ['会去重和去空；不做后端权限探测。'],
    inputs: { codes: input('多个精确权限码', '多个能力 permission 或 base-permission-search.list[]', '字符串数组或英文逗号/换行分隔串；至少一项') },
    output: { shape: '{ granted: string[], missing: string[], checked }', fields: [field('granted[]', 'string', '权限清单包含的码'), field('missing[]', 'string', '清单缺少的码，不代表必然 403'), field('checked', 'number', '去重后实际检查数量，等于两数组长度之和')], empty: 'codes 全为空时抛错；granted 或 missing 可为空。' },
    consume: ['分别列出两组，不把 missing 宣称为不能调用的能力。'], steps: end('交付两组权限清单及 checked 去重计数。'), completion: '每个去重后的输入码已归入 granted 或 missing。', failures: deptFailure,
  }),
  'base-permission-search': contract('base-dept-dict-permission', {
    purpose: '按权限码片段寻找当前用户清单中的权限声明。', whenToUse: '不知道完整路径码或动作码时。', boundaries: ['不区分大小写的 includes；传前缀只是片段匹配，不是严格 startsWith。'],
    inputs: { keyword: keyword('权限码片段，如 investment: 或 /dashboard/base/'), limit: limit(50, 200) },
    output: { shape: '{ list: string[], total, matched }', fields: [field('list[]', 'string', '完整精确权限码'), ...totals], empty: '无命中返回 list=[]，不表示后端所有相关功能均无权限。' },
    consume: ['保留原码用于精确检查；不要拆分路径或动作码。'],
    steps: [{ role: 'optional', when: '需要检查另外一组确切权限码', capabilityId: 'base-permission-check', mapping: { codes: 'list[]' }, instruction: '数组直接传入或用英文逗号拼接。' }], completion: '交付候选码并注明 matched 是否超过返回数量。', failures: deptFailure,
  }),
  'base-user-info': contract('base-shell', {
    purpose: '读取当前登录用户身份、组织归属与管理员标志。', whenToUse: '回答我是谁、在哪个组织，或给表单选择当前用户。', boundaries: ['白名单视图不返回 password2/salt；管理员布尔值不能替代实际后端授权。'], inputs: {},
    output: { shape: 'ShellUserInfo 白名单对象', fields: [field('id', 'string', '当前用户 ID；保持字符串避免大整数损失'), ...Object.entries({ username: '登录名', realName: '姓名', headUrl: '头像 URL', email: '邮箱', mobile: '手机号', postName: '岗位名', deptId: '部门 ID', organizationId: '组织 ID', organizationName: '组织名', organizationFullPathName: '完整组织名称路径', organizationCode: '组织编码', createDate: '创建时间，后端原始字符串；未声明时区，不据此跨时区计算' }).map(([name, meaning]) => field(name, 'string', meaning, true)), { ...field('gender', 'number', '性别码', true), values: { '0': '男', '1': '女', '2': '保密' } }, { ...field('status', 'number', '用户状态；与租户状态码方向不同', true), values: { '0': '停用', '1': '正常' } }, field('superAdmin', 'boolean', '是否超级管理员'), field('tenantAdmin', 'boolean', '是否当前租户管理员'), field('roleIds', 'string[]', '角色 ID 列表；原 roleIdList 为 null 时仍为 null', true)], empty: '无有效用户对象为形状错误；可空字段 null 表示未取得。' },
    consume: ['优先展示 realName/username、组织名称；不要默认展示手机号等联系信息。', '业务需数字用户 ID 时先确认目标参数要求再转换；本返回 id 始终字符串。'], steps: end('交付所需身份字段；不需要额外写操作。'), completion: '身份或组织问题已回答。', failures: shellFailure,
    evidence: [...evidence('base-shell'), { source: 'backend@dcb3f360194:erp-module-system-api/.../hrapi/sysuser/dto/SysUserDTO.java', kind: 'reference', note: 'gender 0男1女2保密；status 0停用1正常。' }],
  }),
  'base-user-search': contract('base-shell', {
    purpose: '按姓名或部门找人员候选，为审批人和业务人员字段取得 ID。', whenToUse: '需要选择人员但没有可靠 ID；当前本人资料改用 base-user-info。', boundaries: ['至少 keyword/deptId 之一；查询当前用户/租户可见的人员候选，不等于当前部门名单。'],
    inputs: { keyword: input('姓名关键字，传给后端 nickname；与 deptId 至少提供一个', '用户提供姓名片段', '非空字符串'), deptId: input('限定部门，与 keyword 可组合', 'base-dept-search.list[].id', '数字部门 ID'), pageNo, pageSize },
    output: { shape: '{ list: SimpleUser[], total }', fields: [field('list[].id', 'string', '人员 ID；后续人员参数的值来源'), ...Object.entries({ nickname: '候选昵称/展示姓名', code: '人员编码', deptName: '部门名称；历史实测为 null，应另查部门', staffDuties: '职务', realName: '真实姓名', staffCode: '员工编号' }).map(([k,v]) => field(`list[].${k}`, 'string', v, true)), field('list[].deptId', 'number', '部门 ID，供 base-dept-get 使用', true), field('total', 'number', '服务端过滤后的总条数；list 仅当前页')], empty: 'list=[] 表示当前筛选当前页无候选；不能把高页码的空页当成无人员。' },
    consume: ['用姓名、员工号、部门区分同名人，再取 id；total 大于已读数量时可翻页。'],
    steps: [{ role: 'optional', when: '同名人需要组织信息区分且 deptId 非 null', capabilityId: 'base-dept-get', mapping: { id: 'list[].deptId' }, instruction: '读取组织路径再让用户选择。' }], completion: '取得用户确认的人员 ID 并传给发起能力指定的人员参数；不得替用户猜同名人。', failures: [...shellFailure, '无 keyword/deptId 或 pageSize=-1 在 SDK 侧拒绝，先收窄候选。'],
  }),
  'base-todo-list': contract('base-shell', {
    purpose: '查询当前用户的流程待办、已办或全部任务。', whenToUse: '回答我的待办并取得 taskId；人力专页的扩展筛选应选 backlog-task-examine-list。', boundaries: ['只读查询；scope 是任务完成状态，result 是流程实例结果，二者不能混淆。'],
    inputs: { scope: input('todo=待办(finished=1)，done=已办(finished=2)，all 不发 finished；不是 finished=0', '用户选择待办/已办/全部', 'todo | done | all', 'todo'), name: input('任务名关键字，服务端 taskNameLike 匹配', '用户提供任务名称片段', '字符串'), pageNo, pageSize },
    output: { shape: '{ list: TodoItem[], total, scope }', fields: [field('list[].id', 'string', '任务 ID，办理时传 taskId；不是流程实例 ID'), ...Object.entries({ name: '任务名称', createTime: '任务创建时间，原始时间字符串', claimTime: '领取时间，原始时间字符串', processInstanceId: '流程实例 ID，详情查询使用', title: '流程标题', processDefinitionKey: '流程定义 key', startUserNickname: '发起人昵称' }).map(([k,v]) => field(`list[].${k}`, 'string', `${v}；时间未标时区时勿自行转换`, true)), field('list[].startUserId', 'number', '发起人 ID', true), { ...field('list[].result', 'number', '流程实例结果码；null 表示未返回，不能视为通过', true), values: { '1': '待提交', '2': '待签订/待审核', '3': '不通过', '4': '通过', '8': '已取消' } }, field('total', 'number', '当前筛选全部任务数'), field('scope', 'string', '实际查询范围 todo/done/all')], empty: 'list=[] 是当前页无任务；scope=todo 且第一页 total=0 才能报告没有待办。' },
    consume: ['展示 title/name、发起人和创建时间；result 3/4 含义不能凭英文枚举名猜。', '只对 scope=todo 中仍有效的任务进入办理准备，不把已办任务再次提交。'],
    steps: [{ role: 'optional', when: '用户要办理选中的待办任务', capabilityId: 'task-action-instance', mapping: { processInstanceId: 'list[].processInstanceId' }, instruction: '流程实例ID非null时先读取当前流程与表单；任务办理保留list[].id作为taskId，不要直接同意。' }], completion: '查询任务交付列表及是否还有页；办理任务需继续准备及相应动作。', failures: [...shellFailure, 'scope 只允许 todo/done/all；不允许 pageSize=-1。'],
    evidence: [...evidence('base-shell'), { source: 'backend@dcb3f360194:BpmProcessInstanceResultEnum.java', kind: 'reference', note: '按枚举中文 desc 校正 result 3不通过/4通过；不是按 APPROVE/REJECT 常量名猜。' }],
  }),
  'base-todo-counts': contract('base-shell', {
    purpose: '同时读取待办、未读消息、待审费用三个角标数。', whenToUse: '只需要数量概览；需要具体任务用 base-todo-list。', boundaries: ['三路独立读取，部分失败仍返回；null 不是 0。'], inputs: {},
    output: { shape: '{ todo, unreadMessages, expensePending, failures: {key,message}[] }', fields: [field('todo', 'number', '待办任务总数', true), field('unreadMessages', 'number', '未读消息数', true), field('expensePending', 'number', '待审核费用数', true), field('failures[].key', 'string', '失败项：todo/unreadMessages/expensePending'), field('failures[].message', 'string', '对应请求错误说明')], empty: '0 是已确认没有；null 是未取得数量，failures 记录请求失败；形状不能转数字也可能得到 null。' },
    consume: ['分别显示已取得数量；null 标为未取得，保留失败原因，不做合计。'], steps: [{ role: 'optional', when: 'todo 大于 0，用户要查看具体事项', capabilityId: 'base-todo-list', instruction: '使用 scope=todo、pageNo=1 分页读取。' }], completion: '已交付三项数量或对应缺失原因。', failures: ['逐项失败信息在 failures；不能因其它两项成功而忽略第三项未取得。', ...shellFailure],
  }),
  'base-menu-nav': contract('base-shell', {
    purpose: '读取指定项目下当前用户的可见菜单树，供目录展示收敛。', whenToUse: '需要菜单结构或创建用户可见目录；只看路径时用 base-menu-paths。', boundaries: ['菜单不是权限裁决；不出现不代表后端不可调用。', 'keyword 会保留匹配节点的祖先；这种筛选树不等于完整可见菜单。'],
    inputs: { project: input('项目号；必须显式传，1学习型组织、2人力绩效是历史实测项目', '接入方当前 Portal 项目上下文或用户明确选择', '有限数字，SDK会取整'), keyword: input('按节点名称或 permissions 片段筛选，保留祖先', '用户提供，完整可见性输入时省略', '字符串'), maxNodes: limit(200, 500) },
    output: { shape: '{ project, tree: ShellMenuNode[], totalNodes, returnedNodes, truncated }', fields: [field('project', 'number', '实际项目号'), field('tree', 'array', '菜单树根节点，children 递归同构'), ...Object.entries({ id: '节点标识', pid: '父节点标识' }).map(([k,v]) => field(`tree[].${k}`, 'string | number', v, true)), ...Object.entries({ name: '节点显示名', url: '原始 URL，历史实测为 null，不能当页面路径', permissions: '页面路径或权限码；路径连接键在此，不是 url' }).map(([k,v]) => field(`tree[].${k}`, 'string', v, true)), { ...field('tree[].menuType', 'number', '节点种类', true), values: { '0': '菜单', '1': '按钮' } }, field('tree[].useSystem', 'number', '所属系统码，1人/2财/3物/4产/5供/6销', true), field('tree[].project', 'number', '节点项目号', true), field('tree[].children', 'ShellMenuNode[]', '递归菜单子节点，字段同根节点'), field('totalNodes', 'number', '筛选前全树节点数'), field('returnedNodes', 'number', '本次实际返回节点数，含后代'), truncated], empty: 'tree=[] 表示该项目下无菜单或关键词无命中，不表示无后端权限。' },
    consume: ['只有无 keyword 且 truncated=false 的树可作为完整可见性输入；permissions 与目录 permission 对接。'], steps: [{ role: 'optional', when: '完整树已取得，需要按菜单收敛目录', sdkPath: 'visibleCatalog', mapping: { project: 'project' }, instruction: '门面 visibleCatalog({project}) 会自行读取完整菜单并返回目录；不要把裁剪树当权限拒绝依据。' }], completion: '展示树已交付；可见目录只在完整菜单下建立。', failures: [...shellFailure, 'truncated=true 时扩大 maxNodes 至上限仍不能完整则报告阻塞，不能静默应用可见性。'],
  }),
  'base-menu-paths': contract('base-shell', {
    purpose: '从可见菜单摊平去重页面路径。', whenToUse: '只需查看可见路径列表；建立可见目录用完整菜单树。', boundaries: ['只保留 permissions 以 / 开头的原始值，不返回动作权限码、不做路径归一。'],
    inputs: { project: input('必须显式提供的项目号', 'Portal 项目上下文', '有限数字，SDK会取整'), keyword: input('路径片段，按 includes 区分大小写匹配', '用户筛选条件，可省略'), limit: limit(100, 300) },
    output: { shape: '{ paths: string[], total, matched }', fields: [field('paths[]', 'string', '原始 permissions 页面路径，去重'), ...totals], empty: 'paths=[] 是无路径或筛选无命中；不是权限拒绝。' },
    consume: ['展示原始路径；paths.length<matched 为出口裁剪，不是页面消失。'], steps: [{ role: 'optional', when: '要了解这些页面的已注册能力', sdkPath: 'catalog.describePage', mapping: { pageIdOrPath: 'paths[]' }, instruction: '逐个传页面路径；只返回目录确实存在的页面，别将无能力页面宣称可调用。' }], completion: '路径清单和完整性已说明。', failures: shellFailure,
  }),
  'base-home-widgets': contract('base-shell', {
    purpose: '读取当前用户工作台已配置的卡片及布局。', whenToUse: '解释工作台内容或寻找卡片标识；它不查询卡片中的业务数据。', boundaries: ['widget 是 hr/… 卡片标识，不是 /dashboard/… 页面路径，SDK 未提供二者映射。'],
    inputs: { keyword: input('匹配 widget 或 knownModules，忽略大小写', '用户提供卡片/模块片段，可省略'), limit: limit(60, 100) },
    output: { shape: '{ widgets: HomeWidget[], total, matched, configured }', fields: [field('widgets[].cardId', 'string', '布局实例 ID，不是业务记录 ID', true), field('widgets[].widget', 'string', '模块/域/卡片标识'), field('widgets[].knownModules[]', 'string', '卡片声明依赖模块'), ...['x','y','w','h'].map(k => field(`widgets[].layout.${k}`, 'number', `${k} 布局坐标或尺寸，原始网格单位而非像素`, true)), ...totals, field('configured', 'boolean', '是否存在有效工作台配置')], empty: 'configured=false 表示没有配置；configured=true 且 widgets=[] 可能是有效空布局或关键词无命中。' },
    consume: ['展示 widget 和布局，仅在业务目录中另行搜索相关业务，不能把 widget 当 capabilityId。'], steps: end('交付卡片配置；不推断卡片当前金额、人数或权限。'), completion: '已说明工作台卡片及是否配置。', failures: shellFailure,
  }),
  'base-tenant-list': contract('base-tenant', {
    purpose: '列出当前用户所属企业、企业状态及已开通系统。', whenToUse: '选择企业上下文或核对企业归属；不会切换当前 SDK 的租户。', boundaries: ['内部每页 200、最多 5 页（1000 家），再按 keyword/limit 本地筛选；truncated 时 matched 只覆盖已拉取部分。', '返回白名单已排除身份证、证件图和联系人手机号；系统码不等同权限。'],
    inputs: { keyword: input('按企业名/简称/编码忽略大小写过滤，可省略', '用户给出的企业名称或编码片段'), limit: limit(20, 100) },
    output: { shape: '{ tenants: TenantSummary[], total, matched, pages, truncated }', fields: [field('tenants[].id', 'string', '企业数字 ID 的字符串形式，供详情查询或创建新租户会话'), ...Object.entries({ name: '企业名', shortName: '简称', code: '企业编码', contactName: '联系人显示名，可能实际是企业名称', createDate: '创建时间，原 createTime 的字符串形式，不自行假定时区' }).map(([k,v]) => field(`tenants[].${k}`, 'string', v, true)), { ...field('tenants[].status', 'number', '租户状态；不同于用户 status', true), values: { '0': '开启', '1': '关闭' } }, field('tenants[].systems[]', 'number', '开通系统码；1人/2财/3物/4产/5供/6销；其它码原样显示，不能猜标签'), field('tenants[].tenantAdmin', 'boolean', '当前用户是否该企业管理员'), field('total', 'number', '后端报告的全部企业数'), field('matched', 'number', '已拉取企业中符合 keyword 的数量'), field('pages', 'number', '内部实际读取页数，最多5'), truncated], empty: 'tenants=[] 表示已拉取范围无匹配；truncated=true 时不能断言全账号无匹配。' },
    consume: ['展示企业名、编码和管理员身份供用户选择；改变企业需要接入方创建独立会话，不能只改查询 id。'], steps: [{ role: 'optional', when: '需要企业套餐/到期/账号数信息', capabilityId: 'base-tenant-get', mapping: { id: 'tenants[].id' }, instruction: '选择企业后传原始数字 ID 字符串。' }], completion: '企业候选及截断情况已交付，或取得用户确认的租户 ID。', failures: ['BaseTenantShapeError 表示返回形状/缺 id，不能作空列表。', '会话权限错误先核对账号和当前租户；不要因为列表包含企业就假定可以读写其所有资源。'],
  }),
  'base-tenant-get': contract('base-tenant', {
    purpose: '查询指定企业的开通系统、套餐、到期时间和账号数。', whenToUse: '已取得企业 ID 后核对配置；列表用于取得候选，详情不切换会话。', boundaries: ['详情每次请求不缓存；null 到期时间不能解释成已过期或永久有效。', '除1人/2财/3物/4产/5供/6销外，系统码没有本契约已验证的标签表。'],
    inputs: { id: input('企业主键，不是企业名或企业编码', 'base-tenant-list.tenants[].id', '非空数字或数字字符串') },
    output: { shape: 'TenantDetail 白名单对象', fields: [field('id','string','企业 ID'), field('name','string','企业名称',true), { ...field('status','number','企业启停状态',true), values: { '0':'开启','1':'关闭' } }, field('website','string','企业网站',true), field('packageId','number','套餐 ID；不推断套餐权益',true), field('expireDate','string','到期时间；SDK 原样转字符串，未核实格式与时区，不据此自动判过期',true), field('accountCount','number','账号数量/额度原值；null 表示未提供',true), field('createDate','string','创建时间原字符串',true), field('systems[]','number','开通系统码，1人/2财/3物/4产/5供/6销；其它码原样保留')], empty: '不存在或无 id 的详情会抛 BaseTenantShapeError，不返回 null。' },
    consume: ['按已提供字段展示；到期时间含义需要后端有效期口径，不在客户端猜测权限失效。'], steps: end('交付企业配置；需要切换租户由接入方建立独立用户租户会话。'), completion: '指定企业配置已交付。', failures: ['id 为空被拒绝；企业名不是主键，先重查候选。', '后端拒绝时报告错误，不能据此替换当前租户或扩大范围。'],
  }),
  'base-sale-shop-info': contract('base-sale', {
    purpose: '读取当前销售店铺的经营资料、归属和地区编码。', whenToUse: '核对当前店铺是谁、在哪个地区；不是多店铺搜索。', boundaries: ['销售实例 sale 的当前账号范围；白名单排除了身份证与证件图。'], prerequisites: ['接入方已显式配置 sale 实例请求地址与当前用户租户会话。'], inputs: {},
    output: { shape: 'ShopInfo 白名单对象；各属性均为 string|null', fields: Object.entries({ shopId:'店铺 ID',shopName:'店铺简称',shopAllName:'店铺全名',shopType:'店铺类型，历史观测 store 为自营',shopTypeName:'后端提供的类型显示名',status:'店铺状态；active 为已开通/正常，其它值不套用开店申请状态',sellerId:'商家 ID',shopuserName:'店铺使用人姓名',servicesTel:'店铺服务电话',email:'店铺邮箱',shopLogo:'店铺标志 URL',shopAddr:'详细地址',shopArea:'行政区划 ID 英文逗号串，不是地区名称',bulletin:'公告',openTime:'开通时间原字符串；历史值为秒级 Unix 时间戳的字符串，先验证格式再换算',closeTime:'关闭时间原字符串，null 不等于已关闭',closeReason:'关闭原因',openType:'开通类型，历史观测 supplier 为供应商' }).map(([k,v]) => field(k,'string',v,true)), empty:'形状错误抛 BaseSaleShapeError；可空字段不代表空店铺。' },
    consume:['展示店铺名称及地址；shopArea 非空时先转地区名称；shopTypeName 优先于自行猜类型。'], steps:[{role:'optional',when:'shopArea 非空且要展示地区名称',capabilityId:'base-sale-area-describe',mapping:{ids:'shopArea'},instruction:'逗号串无需拆解即可直接传 ids。'}],completion:'店铺资料及地区名称已交付。',failures:saleFailure,
  }),
  'base-sale-area-search': contract('base-sale', {
    purpose:'按名称搜索行政区划候选，区分同名地区的完整路径。',whenToUse:'用户给出地区名称片段时；逐层选择用 area-children。',boundaries:['后端无过滤接口，SDK 拉完整地区树后缓存并本地过滤，节省上下文而非首轮网络量。'],inputs:{keyword:keyword('区划名称片段，忽略大小写'),limit:limit(50,200)},
    output:{shape:'{ areas: AreaEntry[], total, matched, truncated }',fields:[...areaFields('areas[]'),...totals,truncated],empty:'areas=[] 且 matched=0 是无名称匹配。'},consume:['展示 pathNames.join("/") 区分同名区划；名称字段是 value。'],steps:[{role:'optional',when:'选定地区 hasChildren=true 且需继续下钻',capabilityId:'base-sale-area-children',mapping:{parentId:'areas[].id'},instruction:'用所选数字 id 查询直接下级。'}],completion:'取得用户确认地区及其完整路径。',failures:[...saleFailure,'keyword 空值拒绝；不应以空关键字绕过长候选限制。'],
  }),
  'base-sale-area-children': contract('base-sale', {
    purpose:'从省级根或已知地区逐层查询直接下级。',whenToUse:'用户选择省市区或不知道准确名称时。',boundaries:['parentId=0 为根；未知父 ID 与合法叶子要靠 parentFound 区分。'],inputs:{parentId:input('父区划数字 ID，0 取省级根','base-sale-area-search.areas[].id 或上次 children[].id，根用0','可转有限数字，取整'),limit:limit(50,200)},
    output:{shape:'{ parentId, children: AreaEntry[], matched, truncated, parentFound }',fields:[field('parentId','number','实际查询父 ID'),...areaFields('children[]'),field('matched','number','该父级全部直接子节点数'),truncated,field('parentFound','boolean','父节点存在或为0；false为未知父ID')],empty:'children=[] 且 parentFound=true 是无下级；parentFound=false 是无此父节点。'},consume:['只对 hasChildren=true 的候选继续下钻；truncated 时增加 limit 或按名称搜索。'],steps:[{role:'optional',when:'所选 children[].hasChildren=true',capabilityId:'base-sale-area-children',mapping:{parentId:'children[].id'},instruction:'重复同一只读能力逐层选择。'}],completion:'选定所需粒度区划，或已到叶子节点。',failures:saleFailure,
  }),
  'base-sale-area-describe': contract('base-sale', {
    purpose:'把地区 ID 串翻译为地区节点与最深节点的完整名称路径。',whenToUse:'展示店铺 shopArea 或已有地区选择值。',boundaries:['path 取已知节点中最深一个的完整路径，不是把每个节点路径再拼一次；多个无关联节点不能当作同一地址。'],inputs:{ids:input('一个或多个区划 ID','base-sale-shop-info.shopArea 或区划候选 id','数字、英文逗号串或数字/字符串数组')},
    output:{shape:'{ areas: AreaEntry[], unknown: number[], path }',fields:[...areaFields('areas[]'),field('unknown[]','number','输入中未在索引找到的区划ID；这是实际响应字段名'),field('path','string','最深已知节点的完整路径，使用 / 连接')],empty:'全部未知时 areas=[]、path=""，unknown 保留未识别ID。'},consume:['地址显示用 path；unknown 非空要报告部分未识别，不宣称地区被删除。'],steps:end('将路径与未识别ID一起交付；没有必须下游调用。'),completion:'已解释全部输入ID或明确列出未识别项。',failures:[...saleFailure,'非数字或空ID输入需修正；未识别的合法数字不会抛错。'],
  }),
  'base-sale-manufacturer-search': contract('base-sale', {
    purpose:'按厂商名取得厂商候选 ID。',whenToUse:'业务需厂商或要进一步筛选其品牌。',boundaries:['全表加载后本地忽略大小写过滤；厂商响应不提供可用品牌清单，不能读 brandList 推断品牌。'],inputs:{keyword:keyword('厂商名称片段'),limit:limit(20,100)},
    output:{shape:'{ manufacturers: {manufacturerId,manufacturerName}[], total, matched, truncated }',fields:[field('manufacturers[].manufacturerId','number','厂商 ID，供品牌筛选使用'),field('manufacturers[].manufacturerName','string','厂商显示名'),...totals,truncated],empty:'manufacturers=[] 是无名称匹配。'},consume:['展示名称让用户确认厂商；使用 manufacturerId 而不是数组下标。'],steps:[{role:'optional',when:'用户要查看所选厂商下某类品牌',capabilityId:'base-sale-brand-search',mapping:{manufacturerId:'manufacturers[].manufacturerId'},instruction:'另向用户取得品牌 keyword，厂商ID不能替代必填品牌关键字。'}],completion:'已交付厂商候选或取得用户选择的厂商ID。',failures:[...saleFailure,'空 keyword 被拒绝，先收窄名称。'],
  }),
  'base-sale-brand-search': contract('base-sale', {
    purpose:'按品牌名及可选厂商过滤品牌候选。',whenToUse:'需要品牌 ID 或核对品牌所属厂商。',boundaries:['keyword 必填，即使提供 manufacturerId 也不能省；本地过滤完整品牌索引。'],inputs:{keyword:keyword('品牌名称片段'),manufacturerId:input('可选所属厂商过滤，有限数字才生效','base-sale-manufacturer-search.manufacturers[].manufacturerId','数字'),limit:limit(20,100)},
    output:{shape:'{ brands: {brandId,brandName,manufacturerId}[], total, matched, truncated }',fields:[field('brands[].brandId','number','品牌 ID，业务品牌参数值'),field('brands[].brandName','string','品牌显示名'),field('brands[].manufacturerId','number','所属厂商 ID；null表示未提供',true),...totals,truncated],empty:'brands=[] 是名称与厂商组合没有匹配。'},consume:['展示 brandName，用 brandId 填业务参数；manufacturerId 不可当品牌ID。'],steps:end('交付候选品牌或用户确认的 brandId；未注册商品写能力不能自行编造调用。'),completion:'候选已解释且用户选择已明确。',failures:[...saleFailure,'keyword 缺失被拒绝；非法 manufacturerId 会被当未过滤，调用前确保数字避免范围扩大。'],
  }),
  'base-sale-home-tip': contract('base-sale', {
    purpose:'查询销售首页是否有未付款和待发货订单提示。',whenToUse:'询问当前店铺是否存在待处理订单提醒；不能回答订单总数或明细。',boundaries:['两个字段均为布尔标志，不是数量；两者为true时前端优先提示未付款。'],inputs:{},output:{shape:'{ unpaidTip: boolean, waitShipTip: boolean }',fields:[field('unpaidTip','boolean','有未付款订单提示，对应前端 orderDealModal(10)'),field('waitShipTip','boolean','有待发货订单提示；前端仅在 !unpaidTip 时弹该提示')],empty:'两者false表示无这两类首页提示，不证明不存在任何订单。'},consume:['先报告未付款；再说明待发货标志，不能把true转成1条。'],steps:end('交付提醒；当前基础能力不提供订单明细和订单办理入口，不能伪造下一步能力。'),completion:'已报告两类提醒及不含明细的范围。',failures:saleFailure,
  }),
  'base-upload-file': contract('base-upload', {
    purpose:'将本地文件字节上传 OSS，设为公共读并返回业务表单可引用的 URL。',whenToUse:'流程附件、图片等业务需要文件URL时；上传本身不会提交业务表单。',effect:'write',prerequisites:ossPrereq,boundaries:['会实际 PUT 文件并 PUT public-read ACL，然后 GET ACL 复核；没有流程式 prepare→submit 事务。','公开 direct SDK 也接受 content:Buffer 与 path 二选一；invoke 描述入口使用本地 path。','不会压缩图片、解析PDF或清除旧对象；fixedName 可能覆盖同名对象。'],
    inputs:{path:input('要读取并上传的本地文件路径','调用方本地已准备的文件','可读文件路径，与直接SDK的content互斥'),folder:input('OSS目录白名单；按目标业务选择审批/公共等目录','params.options 中的 OSS_FOLDERS 实际枚举','必须精确匹配白名单'),fileName:input('含扩展名的源文件名，用于推导扩展名与Content-Type','原文件名，path场景默认使用basename','字符串'),fixedName:input('固定对象基名，不含扩展名；可能覆盖当月目录同名对象','仅在调用方明确管理稳定对象名时提供','省略生成16位小写随机名'),contentType:input('可选 MIME 类型覆盖','文件真实媒体类型','MIME字符串','按扩展名推导，无法识别用 application/octet-stream')},
    output:{shape:'{ url, objectKey, contentType, size, acl? }',fields:[field('url','string','业务表单使用的公开访问URL，默认HTTPS'),field('objectKey','string','桶内对象键，ACL查询与清理必须使用它'),field('contentType','string','实际上传MIME类型'),field('size','number','文件字节数，单位byte'),{...field('acl','string','GET ACL实际读回值；缺失表示复核失败，不代表上传失败'),optional:true}],empty:'上传成功返回对象；不返回空列表或null。ACL字段可缺失。'},
    consume:['保存 url 和 objectKey：url 给附件表单，objectKey 用于复核/补ACL/清理；不要把objectKey当URL。','acl=public-read 才证明已读回公共读；缺失时进一步查询，不重新上传字节。'],
    steps:[{role:'recovery',when:'acl缺失或需要再次核实',capabilityId:'base-upload-acl-get',mapping:{objectKey:'objectKey'},instruction:'读取实际ACL；不是重传。'},{role:'cancel',when:'业务未提交且确认对象无引用需要清理',capabilityId:'base-upload-delete',mapping:{objectKey:'objectKey'},instruction:'删除本次对象不可恢复；先确保无业务引用。'}],completion:'文件URL和对象键已交付，ACL已核实或明确报告未核实；表单提交另走业务能力。',failures:[...ossFailure,'PUT文件成功后设ACL失败时对象可能已经存在；已知objectKey可补ACL。若网络失败且没有拿到随机objectKey，不能盲目重试声称无副作用，应交由接入方核实桶。'],idempotency:'无requestId防重；重试默认随机名会生成多个对象；fixedName重试可能覆盖，不等于无风险幂等。',
  }),
  'base-upload-acl-get': contract('base-upload', {
    purpose:'读取指定OSS对象的访问控制ACL。',whenToUse:'核实上传后的可读性或修改ACL后的真实状态。',prerequisites:ossPrereq,boundaries:['只读ACL，不下载文件内容，也不证明业务表单已引用对象。'],inputs:{objectKey},output:{shape:'string | undefined',fields:[{...field('$','string','XML Grant原文，可能为 public-read/private/public-read-write/default；无法解析Grant为undefined'),optional:true}],empty:'undefined表示未读到Grant，不等于private；对象不存在/请求拒绝按错误返回。'},consume:['public-read表示允许公开读取；private需签名；default继承桶权限不能直接判公开；public-read-write允许公开读写。'],steps:[{role:'recovery',when:'已确认本次上传对象ACL设置失败且应为公开读',capabilityId:'base-upload-acl-set',mapping:{objectKey:'args.objectKey'},instruction:'传 acl=public-read，成功后再读回核实。'}],completion:'已报告实际ACL或无法核实原因。',failures:ossFailure,
  }),
  'base-upload-acl-set': contract('base-upload', {
    purpose:'修改一个已知OSS对象的访问权限，修复上传后ACL设置失败。',whenToUse:'对象字节已存在且只需补设ACL；不要重新上传。',effect:'write',prerequisites:ossPrereq,boundaries:['修改公共可读/可写范围；不返回文件URL，也不自动读回验证。'],inputs:{objectKey,acl:input('目标访问权限','当前业务明确要求，Portal上传默认public-read','public-read | private | public-read-write | default')},output:{shape:'undefined (Promise<void>)',fields:[field('$','undefined','请求完成无业务回执；不能从返回值证明ACL已生效')],empty:'undefined是正常成功返回，不是失败。'},consume:['调用后用同一objectKey读ACL并比对目标值；public-read-write意味着任何人可写，不能误当普通公共读。'],steps:[{role:'required',when:'设置请求成功或结果不确定',capabilityId:'base-upload-acl-get',mapping:{objectKey:'args.objectKey'},instruction:'核对返回Grant与输入acl；default仅表示继承桶规则。'}],completion:'读回ACL与目标一致，或明确报告读回失败。',failures:ossFailure,idempotency:'无requestId；同一对象重复设置同一ACL通常收敛到同状态，先读回再决定是否重发。',
  }),
  'base-upload-delete': contract('base-upload', {
    purpose:'永久删除指定OSS对象，清理不再被业务引用的上传文件。',whenToUse:'清理本次未提交业务产生的孤儿文件；删除多个对象用delete-multi。',effect:'write',prerequisites:ossPrereq,boundaries:['不可撤销；不取消流程、不删除数据库附件引用。','不存在对象也返回成功，回执不证明之前存在或实际删除了字节。'],inputs:{objectKey},output:{shape:'{ objectKey }',fields:[field('objectKey','string','规范化后已向OSS发出DELETE的对象键；不是存在性证据')],empty:'对象不存在也正常返回objectKey。'},consume:['保留对象键；删除后读取ACL只有明确不存在的响应才是不存在证据，权限/网络错误不能证明删除。'],steps:[{role:'required',when:'需要核实对象已不存在',capabilityId:'base-upload-acl-get',mapping:{objectKey:'objectKey'},instruction:'检查OSS明确的不存在错误；其它错误只能报告无法核实。'}],completion:'已发删除并取得独立不存在证据，或如实报告删除结果未核实。',failures:ossFailure,idempotency:'OSS DeleteObject对不存在键也成功；可对同一键重发，但不得将权限错误当不存在。',
  }),
  'base-upload-delete-multi': contract('base-upload', {
    purpose:'一次删除最多1000个OSS对象并逐项报告结果。',whenToUse:'已明确要清理一批无业务引用的对象。',effect:'write',prerequisites:ossPrereq,boundaries:['永久删除，不可恢复；不会自动拆成多次请求；Deleted与Error可以同时存在。','Deleted是OSS接受删除的键，不能据此证明对象此前存在。'],inputs:{objectKeys:input('待删除的桶内对象键集合，逐项遵守objectKey安全规则','多个base-upload-file.objectKey或已确认的清理清单','字符串数组或英文逗号/换行串；1–1000项')},output:{shape:'{ deleted: string[], errors: {key?,code?,message?}[] }',fields:[field('deleted[]','string','OSS Deleted中返回的对象键'),{...field('errors[].key','string','删除失败的对象键'),optional:true},{...field('errors[].code','string','OSS逐项错误码原文，不伪造业务错误码'),optional:true},{...field('errors[].message','string','OSS逐项错误说明'),optional:true}],empty:'errors=[]表示未报告逐项错误；deleted=[]时须对照输入，不假定整批已删除。'},consume:['将输入逐项与deleted/errors核对；仅对明确可恢复的失败项重试，不无差别重复整批。'],steps:[{role:'optional',when:'需要核实关键对象已不存在',capabilityId:'base-upload-acl-get',mapping:{objectKey:'deleted[]'},instruction:'逐个检查明确的不存在错误；请求/权限失败不算不存在证据。'}],completion:'每个输入键都有删除结果或被标明未确认；失败项已明确列出。',failures:[...ossFailure,'超1000或空集合在SDK侧拒绝；分批由调用方显式管理，保存每批结果。'],idempotency:'删除缺失对象也可能回Deleted；按同一对象键重试收敛，但仍需处理部分失败。',
  }),
}

const cacheMethod = (module: string, slice: string, meaning: string): AiContract => contract(module, {
  purpose: `清除${meaning}的实例内缓存。`, whenToUse: '外部更新基础数据后需要下一次读取重新获取，或排查陈旧数据。', effect: 'local',
  prerequisites: ['在拥有该缓存的同一个 SDK/会话能力实例上调用。'], boundaries: ['不修改服务器业务数据；不是注销会话或撤销用户权限。'],
  inputs: { slice: input('可选缓存切片；省略清除该模块所有实例内缓存', '接入方按需要刷新的基础数据选择', slice) },
  output: { shape: 'undefined (void)', fields: [field('$', 'undefined', '同步完成缓存清理，无业务数据回执')], empty: '没有缓存时同样成功返回undefined。' },
  consume: ['随后重新调用相应只读能力取得新数据；清除缓存本身不返回最新数据。'], steps: end('按原业务查询参数重新读取该模块数据。'), completion: '本地缓存已清理；需要新值的任务在重新读取成功后完成。', failures: ['只影响本实例缓存，不能据此断言其它实例或会话基础数据缓存都已刷新。'],
})
export const BASE_METHOD_CONTRACTS: Record<string, AiContract> = {
  'baseData.invalidate': cacheMethod('base-dept-dict-permission', 'dept | dict | permission', '部门、字典与权限'),
  'baseShell.invalidate': cacheMethod('base-shell', 'user-info | menu-nav | home-widgets', '用户、菜单与工作台'),
  'baseTenant.invalidate': cacheMethod('base-tenant', 'tenant-list', '企业列表'),
  'baseSale.invalidate': cacheMethod('base-sale', 'sale-shop | sale-area | sale-manufacturer | sale-brand', '店铺、区划、厂商与品牌'),
  'baseUpload.prepare': contract('base-upload', {
    purpose:'本地生成一份上传请求预览，包括目标键、URL和签名，不发送网络请求。',whenToUse:'接入方排查OSS签名或预览对象命名；不是流程提交前的审批人准备。',effect:'local',prerequisites:ossPrereq,boundaries:['会校验凭据并读取本地文件；不上传、不消耗OSS请求配额。','再次upload会重新生成随机名/日期，因此不能将prepare.publicUrl直接用于表单并假定后续upload保持相同。','headers含签名授权信息、body含文件字节，不应完整输出给用户或日志。'],
    inputs:{...BASE_AI_CONTRACTS['base-upload-file']!.inputs,content:input('可直接提供的文件字节，与path二选一；只能直接SDK调用','接入方预处理得到的Buffer','Node Buffer；不能传普通字符串')},
    output:{shape:'OssPreparedRequest',fields:[field('method','string','PUT'),field('url','string','实际待发OSS请求URL'),field('headers','Record<string,string>','请求头，含签名；不要记录或泄露'),field('canonicalString','string','用于签名的规范字符串，不含密钥'),field('objectKey','string','这次预览生成的对象键，不保证后续upload相同'),{...field('subresources','Record<string,string>','子资源查询映射，本次普通上传通常没有'),optional:true},{...field('body','Buffer','待发原始文件字节，不输出到对话'),optional:true},{...field('publicUrl','string','仅在实际上传此请求后才可能访问的URL'),optional:true}],empty:'本地校验失败抛错，不会上传任何字节。'},
    consume:['仅把该结果当诊断预览；业务附件必须使用upload实际返回的url。'],steps:[{role:'optional',when:'要实际上传文件',capabilityId:'base-upload-file',instruction:'按原输入调用upload，使用它实际返回的url/objectKey；不传预览对象。'}],completion:'预览或签名诊断已完成；文件尚未上传。',failures:ossFailure,
  }),
  'baseUpload.describeConfig': contract('base-upload', {
    purpose:'读取脱敏OSS配置画像，检查创建期配置是否提供。',whenToUse:'上传因配置问题失败，或接入方检查目标桶/端点。',effect:'local',prerequisites:['可以未配置凭据；此方法不校验配置且不会发网络请求。'],boundaries:['只回原始配置脱敏视图，不证明凭据有效或有桶权限。'],inputs:{},
    output:{shape:'{ accessKeyId, accessKeySecret, bucket, endpoint, region, cname, secure }',fields:[field('accessKeyId','string | undefined','已提供时仅保留前4位并追加<redacted>，未提供为undefined'),field('accessKeySecret','string | undefined','已提供时为<redacted>，未提供为undefined'),field('bucket','string | undefined','配置的桶名'),field('endpoint','string | undefined','配置的端点'),field('region','string | undefined','配置的区域'),field('cname','string | undefined','可选自定义访问域名'),field('secure','boolean | undefined','配置是否使用HTTPS；未配置时仍可能undefined')],empty:'缺失配置字段仍返回画像，不抛缺凭据错误。'},consume:['仅确认哪些字段已配置；不得要求返回真实密钥，也不把<redacted>当可用凭据。'],steps:end('由接入方修正创建期配置后重建SDK实例；此画像不执行写入。'),completion:'配置缺失和目标信息已定位。',failures:['该方法不做验证；要诊断非法配置需要prepare的校验错误，仍无需发送请求。'],
  }),
}
