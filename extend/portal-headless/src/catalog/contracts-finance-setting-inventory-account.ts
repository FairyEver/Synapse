import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_INVENTORY_ACCOUNT_METHODS } from '../capabilities/finance-setting-inventory-account.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: false, nullable: false, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, nullable: true, ...extra })

const pagePath = '/dashboard/finance/setting/inventory-account/list'
const permission = '/dashboard/finance/setting/inventory-account'
const apiRoot = '/admin-api/finance/inventory-config'
const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用编码、名称、调整类型标签或列表下标代替']
const statusOptions = [{ value: 0, label: '停用' }, { value: 1, label: '启用' }]

const nullableTextField = (path: string, type: string, meaning: string, nullMeaning: string): AiField => field(path, type, meaning, { nullable: true, nullMeaning })

const rowFields = (prefix: string): AiField[] => {
  const at = (name: string) => prefix ? `${prefix}.${name}` : name
  return [
    field(at('id'), 'string | number', '存货科目配置主键；编辑、启停和回查使用', { constraints: idRules }),
    field(at('materialCategoryId'), 'string | number | null', '后端主物料分类ID；分类维度记录可能为空', { nullable: true, nullMeaning: '该配置不是单分类或后端未返回主分类' }),
    field(at('materialCategoryIds'), 'array', '物料分类维度ID数组；创建时无materialId则至少一个', { constraints: idRules }),
    nullableTextField(at('materialCategoryName'), 'string | null', '物料分类展示名称组合；只展示不提交', '后端未返回分类名称或配置使用物料维度'),
    field(at('materialId'), 'string | number | null', '精确物料ID；和materialCategoryIds二选一的业务维度', { nullable: true, nullMeaning: '配置按物料分类维度生效' }),
    nullableTextField(at('materialCode'), 'string | null', '物料编码；来自物料候选', '配置按分类维度或后端未返回编码'),
    nullableTextField(at('materialName'), 'string | null', '物料名称；来自物料候选', '配置按分类维度或后端未返回名称'),
    nullableTextField(at('adjustmentTypeId'), 'string | null', '存货调整类型ID；提交值来自调整类型树节点id', '后端未返回调整类型ID'),
    nullableTextField(at('adjustmentTypeLabel'), 'string | null', '存货调整类型展示标签；只展示不提交', '后端未返回标签'),
    nullableTextField(at('adjustmentCategoryName'), 'string | null', '存货调整类型分类展示名称', '后端未返回分类名称'),
    nullableTextField(at('outboundUseType'), 'string | null', '出库用途字典值；提交值不是中文名称', '没有出库用途限制'),
    nullableTextField(at('outboundUseTypeName'), 'string | null', '出库用途展示名称；只展示不提交', '后端未返回字典名称'),
    field(at('inventoryAccountId'), 'string | number | null', '存货科目ID；提交给inventoryAccountId', { nullable: true, nullMeaning: '后端未返回存货科目' }),
    nullableTextField(at('inventoryAccountCode'), 'string | null', '存货科目编码；提交时与ID一起保留', '后端未返回存货科目编码'),
    nullableTextField(at('inventoryAccountName'), 'string | null', '存货科目名称；只展示', '后端未返回存货科目名称'),
    field(at('counterpartAccountId'), 'string | number | null', '对方科目ID；提交给counterpartAccountId', { nullable: true, nullMeaning: '后端未返回对方科目' }),
    nullableTextField(at('counterpartAccountCode'), 'string | null', '对方科目编码；提交时与ID一起保留', '后端未返回对方科目编码'),
    nullableTextField(at('counterpartAccountName'), 'string | null', '对方科目名称；提交时与ID和编码一起保留', '后端未返回对方科目名称'),
    field(at('useOrgAttribute'), 'integer | null', '是否使用组织财务属性：0否、1是', { nullable: true, nullMeaning: '没有组织财务属性限制', values: { '0': '否', '1': '是' } }),
    nullableTextField(at('useOrgAttributeName'), 'string | null', '组织财务属性展示名称；只展示', '后端未返回名称'),
    field(at('status'), 'integer', '绝对状态：0停用、1启用；页面启停使用目标绝对值', { values: { '0': '停用', '1': '启用' } }),
    nullableTextField(at('statusName'), 'string | null', '状态展示名称', '后端未返回状态名称'),
    nullableTextField(at('remark'), 'string | null', '备注；最多500个字符', '没有备注'),
    nullableTextField(at('creator'), 'string | null', '创建人标识或名称；只展示', '后端未返回创建人'),
    field(at('createTime'), 'string | number | null', '创建时间原值；SDK不做时区转换', { nullable: true, nullMeaning: '后端未返回创建时间' }),
    nullableTextField(at('updater'), 'string | null', '最后更新人标识或名称；只展示', '后端未返回更新人'),
    field(at('updateTime'), 'string | number | null', '更新时间原值；SDK不做时区转换', { nullable: true, nullMeaning: '后端未返回更新时间' }),
    field(at('editable'), 'boolean | null', '后端计算的可编辑标记；页面仍以权限和行状态为准', { nullable: true, nullMeaning: '后端未返回该标记' }),
    field(at('deletable'), 'boolean | null', '后端计算的可删除标记；当前Portal列表没有删除按钮', { nullable: true, nullMeaning: '后端未返回该标记' }),
    field(at('statusChangeable'), 'boolean | null', '后端计算的可启停标记', { nullable: true, nullMeaning: '后端未返回该标记' }),
    nullableTextField(at('disableReason'), 'string | null', '不可编辑/启停时的后端原因', '没有禁用原因'),
  ]
}

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [field('$', 'object', '存货科目配置当前分页结果'), field('list', 'array', '当前页列表；不是全部匹配记录'), field('list[]', 'object', '一条存货科目配置行'), ...rowFields('list[]'), field('total', 'integer', '筛选后的总记录数；不是当前页长度', { constraints: ['非负整数'] })],
  empty: 'list=[]且total=0表示当前筛选没有记录；权限、网络或响应结构失败会抛错，不改写为空列表。',
}

const categoryTreeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('$', 'array', '物料分类树'), field('[]', 'object', '一个物料分类节点'), field('[].id', 'string | number', '分类ID；提交时放入materialCategoryIds'), field('[].catName', 'string', '分类展示名称；不能代替id提交'), field('[].children', 'array', '子分类节点数组；空数组表示叶子')],
  empty: '[]表示当前租户/权限下没有可选物料分类；不能据此把分类名称当ID提交。',
}

const adjustmentTreeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('$', 'array', '存货调整类型树'), field('[]', 'object', '一个调整类型节点'), field('[].id', 'string', '调整类型提交ID'), field('[].label', 'string', '调整类型展示标签；不能代替id提交'), field('[].value', 'string', 'Portal树组件的值；页面展示/选择使用'), field('[].children', 'array', '子调整类型节点数组；空数组表示叶子')],
  empty: '[]表示当前租户/权限下没有可选调整类型；创建时仍由后端校验类型合法性。',
}

const materialOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [field('$', 'object', '物料候选分页结果'), field('list', 'array', '当前页物料候选'), field('list[]', 'object', '一条物料候选'), field('list[].id', 'string | number', '物料ID；提交给materialId'), nullableTextField('list[].matCode', 'string | null', '物料编码；只用于展示和回填', '物料无编码'), nullableTextField('list[].matName', 'string | null', '物料名称；只用于展示和回填', '物料无名称'), field('list[].status', 'integer | null', '物料状态；页面候选固定按status=1查询', { nullable: true, nullMeaning: '后端未返回物料状态' }), nullableTextField('list[].catNameCombination', 'string | null', '物料所属分类组合展示', '后端未返回分类组合'), field('total', 'integer', '匹配物料总数；不是当前页长度', { constraints: ['非负整数'] })],
  empty: 'list=[]且total=0表示指定分类和关键字下没有启用物料；不要把物料名称当materialId提交。',
}

const draftFields = (prefix: string, withId: boolean): AiField[] => {
  const at = (name: string) => `${prefix}.${name}`
  return [
    ...(withId ? [field(at('id'), 'string | number', '存货科目配置主键；更新载荷必须保留', { constraints: idRules })] : []),
    field(at('materialCategoryIds'), 'array', '物料分类维度ID数组；无materialId时至少一个', { constraints: idRules }),
    field(at('materialId'), 'string | number | null', '精确物料ID；和分类维度按页面选择二选一', { nullable: true, nullMeaning: '配置按物料分类维度生效' }),
    nullableTextField(at('materialCode'), 'string | null', '物料编码；来自物料候选', '配置按分类维度或没有编码'),
    nullableTextField(at('materialName'), 'string | null', '物料名称；来自物料候选', '配置按分类维度或没有名称'),
    field(at('inventoryUnitOrgId'), 'string | number | null', 'Portal兼容保存字段；当前Java保存VO不落库', { nullable: true, nullMeaning: '未选择所属单元或页面未回填' }),
    field(at('unitType'), 'string | number | null', 'Portal兼容保存字段；当前Java保存VO不落库', { nullable: true, nullMeaning: '未选择单元类型或页面未回填' }),
    field(at('adjustmentTypeId'), 'string', '存货调整类型ID；来自调整类型树', { constraints: ['非空，最多50个字符'] }),
    nullableTextField(at('outboundUseType'), 'string | null', '出库用途字典值', '没有出库用途限制'),
    field(at('inventoryAccountId'), 'string | number', '存货科目ID', { constraints: idRules }),
    field(at('inventoryAccountCode'), 'string', '存货科目编码；非空且最多50个字符'),
    field(at('counterpartAccountId'), 'string | number', '对方科目ID', { constraints: idRules }),
    field(at('counterpartAccountCode'), 'string', '对方科目编码；非空且最多50个字符'),
    field(at('counterpartAccountName'), 'string', '对方科目名称；非空且最多200个字符'),
    field(at('useOrgAttribute'), 'integer | null', '是否使用组织财务属性：0否、1是', { nullable: true, nullMeaning: '没有组织财务属性限制', values: { '0': '否', '1': '是' } }),
    field(at('status'), 'integer', '绝对状态：0停用、1启用', { values: { '0': '停用', '1': '启用' } }),
    nullableTextField(at('remark'), 'string | null', '备注；最多500个字符', '没有备注'),
  ]
}

const createDraftOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [field('$', 'object', '尚未写入的创建草稿'), field('draft', 'object', '交给create的完整Portal载荷'), ...draftFields('draft', false)],
  empty: '缺少物料维度、调整类型、科目或对方科目等必填字段时抛错，不返回半成品草稿。',
}

const updateDraftOutput: AiContract['output'] = {
  shape: '{ draft: object, previous: object }',
  fields: [field('$', 'object', '编辑目标草稿和操作前快照'), field('draft', 'object', '交给update的完整Portal载荷'), ...draftFields('draft', true), field('previous', 'object', '编辑前补偿快照；不是自动事务回滚'), ...draftFields('previous', true)],
  empty: 'current缺少完整字段、id非法或合并后的保存字段不满足Java VO校验时抛错。',
}

const statusOutput: AiContract['output'] = {
  shape: '{ draft: { id, status }, previous: { id, status } }',
  fields: [field('$', 'object', '启停目标草稿和操作前快照'), field('draft', 'object', '交给setStatus的绝对状态载荷'), field('draft.id', 'string | number', '存货科目配置主键', { constraints: idRules }), field('draft.status', 'integer', '目标绝对状态：0停用、1启用', { values: { '0': '停用', '1': '启用' } }), field('previous', 'object', '操作前状态快照；可用于显式恢复'), field('previous.id', 'string | number', '同一存货科目配置主键', { constraints: idRules }), field('previous.status', 'integer', '操作前绝对状态', { values: { '0': '停用', '1': '启用' } })],
  empty: 'targetStatus与current.status相同或字段非法时抛错，不生成草稿。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName: string, contentType: string, byteLength: integer, base64: string }',
  fields: [field('$', 'object', '下载文件的可传输结果'), field('fileName', 'string', 'SDK推断的文件名；导出为存货科目配置.xls，模板为存货科目配置导入模板.xlsx'), field('contentType', 'string', '响应content-type或按扩展名推导的MIME类型'), field('byteLength', 'integer', '文件字节数；必须大于0'), field('base64', 'string', '完整文件二进制的标准Base64编码；不是文本内容')],
  empty: '响应不是非空二进制文件时抛错，不返回空文件或伪造下载成功。',
}

const importOutput: AiContract['output'] = {
  shape: '{ totalCount: integer, successCount: integer, failureCount: integer, errorMessages: string[] }',
  fields: [field('$', 'object', '存货科目配置导入结果'), field('totalCount', 'integer', '本次导入总行数', { constraints: ['非负整数'] }), field('successCount', 'integer', '成功导入行数', { constraints: ['非负整数'] }), field('failureCount', 'integer', '失败行数', { constraints: ['非负整数'] }), field('errorMessages', 'string[]', '导入失败原因列表；空数组表示没有后端返回的错误文本')],
  empty: '响应缺少四个结果字段或字段类型错误时抛错；失败行不会被改写成成功。',
}

const listInputs: Record<string, AiParameter> = {
  materialCategoryIds: optional('物料分类ID数组筛选', '页面物料分类树多选', '不发送分类筛选；页面默认[]会转为空字符串', { type: 'array', constraints: idRules }),
  materialCode: optional('物料编码关键字', '页面物料编码输入框', '不发送该筛选', { type: 'string | null' }),
  materialName: optional('物料名称关键字', '页面物料名称输入框', '不发送该筛选', { type: 'string | null' }),
  inventoryAccountIds: optional('存货科目ID数组筛选', '页面存货科目树多选', '不发送科目筛选', { type: 'array', constraints: idRules }),
  adjustmentTypeIds: optional('存货调整类型ID或ID数组筛选', '页面调整类型树选择', '不发送调整类型筛选', { type: 'string | array | null' }),
  outboundUseType: optional('出库用途字典值筛选', '页面出库用途选择器', '不发送该筛选', { type: 'string | null' }),
  counterpartAccountIds: optional('对方科目ID数组筛选', '页面对方科目树多选', '不发送对方科目筛选', { type: 'array', constraints: idRules }),
  useOrgAttribute: optional('是否使用组织财务属性筛选：0否、1是', '页面组织财务属性选择器', '不发送该筛选', { type: 'integer | null', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] }),
  status: optional('状态筛选：0停用、1启用、null全部', '页面状态选择器', '不发送状态筛选', { type: 'integer | null', options: statusOptions }),
  pageNo: optional('从1开始的页码', '调用方分页状态', '默认1', { type: 'integer', constraints: ['正整数'] }),
  pageSize: optional('当前页条数', '调用方分页状态', '默认20；页面支持10、20、50、100', { type: 'integer', constraints: ['只能取10、20、50、100'] }),
}

const draftInputs: Record<string, AiParameter> = {
  materialCategoryIds: optional('物料分类维度ID数组', '物料分类树[].id；无materialId时至少一个', '使用空数组前先确认materialId存在', { type: 'array', constraints: idRules }),
  materialId: optional('精确物料ID', '物料候选list[].id', '按物料分类维度保存', { type: 'string | number | null', constraints: idRules }),
  materialCode: optional('物料编码', '物料候选list[].matCode', '不提交编码', { type: 'string | null' }),
  materialName: optional('物料名称', '物料候选list[].matName', '不提交名称', { type: 'string | null' }),
  inventoryUnitOrgId: optional('Portal编辑态所属单元ID', '当前页面行或表单上下文', '发送null；Java保存VO不落库', { type: 'string | number | null', constraints: idRules }),
  unitType: optional('Portal编辑态单元类型', '当前页面行或表单上下文', '发送null；Java保存VO不落库', { type: 'string | number | null' }),
  adjustmentTypeId: input('存货调整类型ID', 'adjustment-type-tree[].id；不能使用label', { type: 'string', constraints: ['非空字符串，最多50个字符'] }),
  outboundUseType: optional('出库用途字典值', 'Portal字典候选value', '发送null', { type: 'string | null', constraints: ['最多50个字符'] }),
  inventoryAccountId: input('存货科目ID', '会计科目候选的id', { type: 'string | number', constraints: idRules }),
  inventoryAccountCode: input('存货科目编码', '会计科目候选的code', { type: 'string', constraints: ['非空，最多50个字符'] }),
  counterpartAccountId: input('对方科目ID', '会计科目候选的id', { type: 'string | number', constraints: idRules }),
  counterpartAccountCode: input('对方科目编码', '会计科目候选的code', { type: 'string', constraints: ['非空，最多50个字符'] }),
  counterpartAccountName: input('对方科目名称', '会计科目候选的name', { type: 'string', constraints: ['非空，最多200个字符'] }),
  useOrgAttribute: optional('是否使用组织财务属性：0否、1是', '页面单选值', '发送null', { type: 'integer | null', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] }),
  status: optional('保存状态：0停用、1启用', '当前行或用户确认状态', '创建默认1启用', { type: 'integer | null', options: statusOptions }),
  remark: optional('备注', '页面备注输入框', '发送null', { type: 'string | null', constraints: ['最多500个字符'] }),
}

const fileInputs: Record<string, AiParameter> = {
  fileName: input('上传文件名', '调用方文件元数据；Portal接受.xml、.xlsx、.xls', { type: 'string', constraints: ['扩展名必须是.xml、.xlsx或.xls'] }),
  base64: input('文件二进制标准Base64', '调用方读取的文件内容', { type: 'string', constraints: ['非空、合法标准Base64'] }),
  contentType: optional('文件MIME类型', '调用方文件元数据', '按扩展名推导', { type: 'string | null' }),
}

const boundaries = [
  `只覆盖页面${pagePath}源码实际可达的分页、物料/调整类型候选、行内新建/编辑/启停、导出和导入；不发布当前页面未调用的${apiRoot}/get、${apiRoot}/delete和${apiRoot}/material-category-tree以外的后端端点。`,
  `页面权限是${permission}；导入导出、编辑、新建、启停分别受finance:setting:inventory-account:export、finance:setting:inventory-account:edit、finance:setting:inventory-account:create、finance:setting:inventory-account:status裁决，SDK不替页面预判权限。`,
  '页面使用platform实例，module-type按页面推导为null；一个SDK实例只绑定一个用户和租户的会话token，最终数据范围和权限由Portal后端裁决。',
  '状态是绝对数值：0停用、1启用。启停必须从最新行生成与current.status相反的targetStatus；不能传toggle或按旧状态盲切换。',
  '新建/编辑载荷保留Portal发送的materialCategoryIds、materialId、materialCode、materialName、inventoryUnitOrgId、unitType、adjustmentTypeId、科目、对方科目、outboundUseType、useOrgAttribute、status和remark；Java VO只持久化其中定义的字段，服务端负责组合重复和使用中保护。',
  '当前列表没有删除按钮；后端虽有get/delete/material-category-tree等端点，但当前页面不可达，SDK不把旧[mode]/[id]表单的单数materialCategoryId误报为当前页面能力。',
]

const prerequisites = [
  '已建立带有效会话token与tenantId的platform SDK；调用方应先使用物料分类树、调整类型树、物料候选和会计科目候选取得稳定ID/value。',
  '写操作必须先prepare，再由用户确认后submit；提交成功或超时都要按同一ID刷新列表核对，不能只看HTTP成功或盲目重复提交。',
]

const failures = [
  'ID、状态、分页、分类维度、调整类型、科目字段、文件扩展名或Base64非法时在发请求前抛错；SDK不把名称、label、编码或列表下标当ID。',
  '分页、树、物料候选、下载文件或导入结果缺少必要字段时抛错，不把坏响应改写为空列表、空文件或成功。',
  '后端仍会校验物料/分类维度、调整类型、科目组合、重复启用配置、权限、使用中编辑保护和导入业务错误；本地校验不能替代服务端裁决。',
  '写请求超时结果不确定：create按刷新列表/业务字段核对，update/setStatus按同一ID核对，import按结果或刷新列表核对；页面没有当前可达的删除/恢复闭环。',
]

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main app/portal/menus/finance.js、app/portal/views/dashboard/finance/setting/inventory-account.vue', kind: 'reference', note: '证明菜单路径、路由权限和页面形态。' },
  { source: 'CodeReview_Projects_Js@test/portal/main app/portal/views/dashboard/finance/setting/inventory-account/list.vue、components/material-select.vue、portal/tree-select/material-category/index.vue、finance/adjustment-type-tree/index.vue', kind: 'reference', note: '证明默认分页、完整查询字段、行内保存载荷、四类按钮权限、导出/模板/导入、物料和树候选请求。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test erp-module-finance/.../InventoryAccountConfigController、CreateReqVO、UpdateReqVO、PageReqVO、RespVO、ImportRespVO、InventoryAccountConfigServiceImpl', kind: 'reference', note: '证明后端请求字段、校验、状态保护、重复规则、导入回执和下载模板。' },
  { source: 'src/capabilities/finance-setting-inventory-account.ts', kind: 'implementation', note: '证明SDK页面上下文、查询拼接、Portal保存载荷、文件传输和严格响应校验。' },
  { source: 'test/finance-setting-inventory-account.test.ts', kind: 'test', note: '证明逐页静态核对、默认查询、候选、表单提交、状态、导入导出、坏响应和AI反证；测试不发真实网络。' },
]

function contract (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence'> & Partial<Pick<AiContract, 'boundaries' | 'prerequisites' | 'failures' | 'evidence'>>): AiContract {
  return {
    whenToUse: `操作Portal“财务设置→存货科目配置”页面；不要把后端存在但当前页面不可达的${apiRoot}/get、${apiRoot}/delete或旧表单参数当成本页能力。`,
    boundaries,
    prerequisites,
    failures,
    evidence,
    gaps: [
      '本轮未启动浏览器，未取得该页面独立真实网络基准、实际按钮权限结果或部署响应变体；契约依据是已拉取的Portal/Java源码和离线测试。',
      '尚未在真实测试环境执行创建、编辑、启停、导入的prepare→submit→回查完整写闭环；不能把离线请求替身称为线上写入证据。',
    ],
    ...value,
  }
}

const createSteps = [{ role: 'required' as const, when: '用户确认创建且拥有finance:setting:inventory-account:create权限', capabilityId: 'finance-setting-inventory-account-create', mapping: { draft: 'result.draft' }, instruction: '只提交prepareCreate返回的draft。' }]
const updateSteps = [{ role: 'required' as const, when: '用户确认编辑且拥有finance:setting:inventory-account:edit权限', capabilityId: 'finance-setting-inventory-account-update', mapping: { draft: 'result.draft' }, instruction: '只提交prepareUpdate返回的draft；保留previous用于显式补偿。' }]
const statusSteps = [{ role: 'required' as const, when: '用户确认启停且拥有finance:setting:inventory-account:status权限', capabilityId: 'finance-setting-inventory-account-set-status', mapping: { draft: 'result.draft' }, instruction: '提交绝对目标status，不要在调用方再次toggle。' }]

export const FINANCE_SETTING_INVENTORY_ACCOUNT_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-inventory-account-list': contract({
    purpose: '按存货科目配置页面筛选条件分页读取配置行，返回后续编辑和启停所需的完整行。',
    effect: 'read', inputs: listInputs, output: pageOutput,
    consume: ['展示物料分类、物料、调整类型、存货科目、对方科目、组织属性和状态；提交使用ID/value，不使用展示名称。', '保留同一行id和status；编辑/启停前使用最新列表行，不能按编码或列表位置定位。', 'list=[]且total=0是业务空结果，不等于权限成功。'],
    steps: [], completion: '返回当前筛选条件下的严格分页结果；不代表任何写入已经发生。', idempotency: null,
  }),

  'finance-setting-inventory-account-material-category-tree': contract({
    purpose: '读取页面物料选择器使用的物料分类树，提供创建和筛选所需的分类ID。',
    effect: 'read', inputs: {}, output: categoryTreeOutput,
    consume: ['展示catName供用户选择并保留id；没有materialId时把至少一个id放入prepareCreate.materialCategoryIds。'], steps: [],
    completion: '返回严格的树节点数组；名称不被误当作提交ID。', idempotency: null,
  }),

  'finance-setting-inventory-account-adjustment-type-tree': contract({
    purpose: '读取页面存货调整类型树，提供提交调整类型ID。',
    effect: 'read', inputs: {}, output: adjustmentTreeOutput,
    consume: ['展示label供用户选择并保留id；创建/编辑提交adjustmentTypeId而不是label。'], steps: [],
    completion: '返回严格的调整类型树；最终合法性由后端校验。', idempotency: null,
  }),

  'finance-setting-inventory-account-material-options': contract({
    purpose: '在已选择物料分类后查询页面物料弹窗候选。',
    effect: 'read',
    inputs: { categoryIds: input('物料分类ID数组', 'material-category-tree[].id或用户确认的分类ID', { type: 'array', constraints: idRules }), matCode: optional('物料编码关键字', '页面物料编码搜索框', '不发送关键字', { type: 'string | null' }), matName: optional('物料名称关键字', '页面物料名称搜索框', '不发送关键字', { type: 'string | null' }), pageNo: optional('页码', '物料弹窗分页状态', '默认1', { type: 'integer', constraints: ['正整数'] }), pageSize: optional('物料弹窗每页条数', '物料弹窗分页状态', '默认10；页面支持10、50、100、500', { type: 'integer', constraints: ['只能取10、50、100、500'] }) },
    output: materialOutput, consume: ['展示matCode、matName和分类组合，选择后保留list[].id作为materialId。', '页面固定只查询status=1的启用物料；候选为空时不要把名称直接写入保存载荷。'], steps: [], completion: '返回指定分类和关键字下的启用物料分页候选。', idempotency: null,
  }),

  'finance-setting-inventory-account-prepare-create': contract({
    purpose: '复刻页面行内新建字段规则，生成完整Portal保存载荷草稿。', effect: 'prepare', inputs: draftInputs, output: createDraftOutput,
    consume: ['把draft原样交给create；不要自行删除Portal发送的兼容字段或把label替代ID。', 'materialId与materialCategoryIds按页面维度使用；缺少物料维度、调整类型、存货科目或对方科目时不生成草稿。'], steps: createSteps,
    completion: '生成尚未发网络请求的创建草稿；创建默认status=1启用。', idempotency: null,
  }),

  'finance-setting-inventory-account-create': contract({
    purpose: '创建一条存货科目配置。', effect: 'write', inputs: { draft: input('prepareCreate返回的完整Portal草稿', 'finance-setting-inventory-account-prepare-create.result.draft', { type: 'object' }) },
    output: { shape: 'string | number', fields: [field('$', 'string | number', '新建配置主键；不是物料编码或科目编码', { constraints: idRules })], empty: '后端未返回合法主键时抛错。' },
    consume: ['保存返回ID，刷新列表按ID和业务字段核对；只看HTTP成功不算完成。', '创建状态由Portal/Java服务端默认启用，调用方不要用名称推断结果。'],
    steps: [{ role: 'required', when: 'create返回ID或请求超时需要确认终态', capabilityId: 'finance-setting-inventory-account-list', mapping: {}, instruction: '刷新同一筛选范围，核对物料维度、调整类型、科目和status。' }],
    completion: '返回合法ID且列表回查确认记录按预期创建。', idempotency: '没有requestId或SDK幂等包装；超时先刷新/按业务字段核对，未确认前不要盲目重复create。',
  }),

  'finance-setting-inventory-account-prepare-update': contract({
    purpose: '基于最新列表行合并编辑差异，生成完整Portal编辑载荷和操作前快照。', effect: 'prepare',
    inputs: { current: input('最新完整存货科目配置列表行', 'finance-setting-inventory-account-list.result.list[]', { type: 'object' }), changes: optional('本次明确修改的字段差异', '用户确认的行内编辑值', '沿用current全部字段', { type: 'object | null' }) }, output: updateDraftOutput,
    consume: ['只把draft提交给update；previous不是自动事务回滚，恢复必须由用户明确再次提交previous。', '保留materialCategoryIds/materialId、科目ID和编码、调整类型ID等字段，不能只提交展示列。'], steps: updateSteps,
    completion: '生成draft.id与previous.id一致的未写入编辑草稿。', idempotency: null,
  }),

  'finance-setting-inventory-account-update': contract({
    purpose: '更新一条存货科目配置；请求载荷与Portal行内保存一致。', effect: 'write', inputs: { draft: input('prepareUpdate返回的完整{id,...}草稿', 'finance-setting-inventory-account-prepare-update.result.draft', { type: 'object' }) },
    output: { shape: 'true', fields: [field('$', 'boolean', '后端更新成功回执；固定为true')], empty: '非true回执抛错。' },
    consume: ['返回true后刷新列表按同一ID核对最终字段；后端仍会阻止使用中的配置被编辑。'],
    steps: [{ role: 'required', when: 'update返回true或请求超时需要确认终态', capabilityId: 'finance-setting-inventory-account-list', mapping: {}, instruction: '刷新列表并按draft.id核对保存结果。' }],
    completion: '返回true且列表回查确认配置已更新。', idempotency: '更新接口没有requestId；相同draft重复提交通常是同一最终值，但超时必须先刷新核对，不要盲目重试。',
  }),

  'finance-setting-inventory-account-prepare-set-status': contract({
    purpose: '根据最新列表行生成与当前状态相反的绝对启停草稿。', effect: 'prepare',
    inputs: { current: input('最新完整存货科目配置列表行', 'finance-setting-inventory-account-list.result.list[]', { type: 'object' }), targetStatus: input('绝对目标状态：0停用或1启用，必须与current.status相反', '用户确认的启用/停用意图', { type: 'integer', options: statusOptions, constraints: ['不能传toggle或与current.status相同'] }) }, output: statusOutput,
    consume: ['把draft原样交给setStatus；启用时服务端会重新校验重复配置和业务组合。', 'previous只用于用户明确恢复，不是自动回滚。'], steps: statusSteps, completion: '生成未发网络请求的绝对状态草稿。', idempotency: null,
  }),

  'finance-setting-inventory-account-set-status': contract({
    purpose: '按绝对status启用或停用存货科目配置。', effect: 'write', inputs: { draft: input('prepareSetStatus返回的{id,status}草稿', 'finance-setting-inventory-account-prepare-set-status.result.draft', { type: 'object' }) },
    output: { shape: 'true', fields: [field('$', 'boolean', '后端启停成功回执；固定为true')], empty: '非true回执抛错。' },
    consume: ['返回true后刷新列表按同一ID核对status；启用时还要确认后端重复校验通过。'],
    steps: [{ role: 'required', when: 'setStatus返回true或请求超时需要确认终态', capabilityId: 'finance-setting-inventory-account-list', mapping: {}, instruction: '刷新列表核对draft.id的最终status。' }],
    completion: '返回true且列表回查确认status等于目标值。', idempotency: '启停接口没有requestId；重复提交同一绝对status通常不会再次切换，但超时必须先刷新核对，不能盲目重复toggle。',
  }),

  'finance-setting-inventory-account-export': contract({
    purpose: '按页面筛选条件导出存货科目配置Excel，不携带分页字段。', effect: 'read', inputs: Object.fromEntries(Object.entries(listInputs).filter(([key]) => !['pageNo', 'pageSize'].includes(key))), output: fileOutput,
    consume: ['把base64按fileName/contentType保存为文件；byteLength用于确认不是空文件。', '导出筛选与列表筛选相同，但不会把分页状态当成导出范围。'], steps: [], completion: '返回非空导出文件的元数据和Base64内容。', idempotency: null,
  }),

  'finance-setting-inventory-account-download-template': contract({
    purpose: '下载页面导入使用的存货科目配置Excel模板。', effect: 'read', inputs: {}, output: fileOutput,
    consume: ['按fileName保存模板；模板列和导入业务规则以Portal/Java当前版本为准。'], steps: [], completion: '返回非空导入模板文件。', idempotency: null,
  }),

  'finance-setting-inventory-account-prepare-import': contract({
    purpose: '校验导入文件元数据和内容，生成可提交的文件预览。', effect: 'prepare', inputs: fileInputs,
    output: { shape: '{ fileName: string, contentType: string, byteLength: integer }', fields: [field('$', 'object', '导入文件预览'), field('fileName', 'string', '原始文件名；扩展名必须受Portal文件控件支持'), field('contentType', 'string', '提交时使用的文件MIME类型'), field('byteLength', 'integer', 'Base64解码后的字节数；必须大于0')], empty: '文件名、扩展名、Base64或内容为空时抛错。' },
    consume: ['用户确认后把同一fileName/base64/contentType原样交给import；prepare只校验，不上传。'], steps: [{ role: 'required', when: '用户确认导入且拥有finance:setting:inventory-account:export权限', capabilityId: 'finance-setting-inventory-account-import', mapping: { fileName: 'user.fileName', base64: 'user.base64', contentType: 'user.contentType' }, instruction: '只提交用户确认的同一文件，不把预览结果误当导入结果。' }], completion: '得到尚未上传的文件预览。', idempotency: null,
  }),

  'finance-setting-inventory-account-import': contract({
    purpose: '按Portal multipart规则上传存货科目配置Excel，并返回后端逐批导入结果。', effect: 'write', inputs: fileInputs, output: importOutput,
    consume: ['展示totalCount、successCount、failureCount和errorMessages；失败数不能当作成功。', '导入完成后刷新列表核对新增/更新记录，不能只看HTTP成功。'],
    steps: [{ role: 'required', when: 'import返回结果或请求超时需要确认终态', capabilityId: 'finance-setting-inventory-account-list', mapping: {}, instruction: '刷新列表核对导入业务效果；若结果失败，先处理errorMessages再重试。' }],
    completion: '返回结构化导入结果并完成列表回查；结果中的失败行仍由后端业务规则裁决。', idempotency: '导入接口没有requestId；同一文件重复提交可能重复处理，超时先用结果或列表回查确认，不要盲目重传。',
  }),
}

export const FINANCE_SETTING_INVENTORY_ACCOUNT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_INVENTORY_ACCOUNT_METHODS).map(([id, method]) => [`financeSettingInventoryAccount.${method}`, FINANCE_SETTING_INVENTORY_ACCOUNT_AI_CONTRACTS[id]!]),
)
