import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { STUDY_GRADE_LIST_PATH, STUDY_GRADE_METHODS, STUDY_GRADE_STUDENT_LIST_PATH, studyGradeCapabilities } from '../capabilities/study-grade.js'

/**
 * 班级管理（`/dashboard/grade/grade/list`）**隐藏表面**的 AI 契约。
 *
 * ⚠️ 本文件覆盖班级页面上的隐藏弹窗、状态切换和独立回查能力：三个弹窗（关联组织 / 关联业务 / 添加学员）、班级表单的
 * 人员候选，以及它们的 prepare / cancel 搭档。同一页面的另外 9 个能力
 * （`study-grade-list`、`study-grade-search`、两组 remove 与它们的 prepare/cancel）
 * 的契约在 `contracts-study-grade-teacher.ts` 里，两者**互不重叠**。
 *
 * 之所以分成两个文件：这一批是班级隐藏表面与状态回查，
 * 按文件所有权切分才不互相覆盖；接线（并入 `AI_CONTRACTS` / `METHOD_CONTRACTS`）
 * 由主线统一做。
 *
 * 逐页四件套：`docs/pages/班级管理.md`。能力实现与全部代码级注释：
 * `src/capabilities/study-grade.ts`（文件头有这一批的全部证据与坑）。
 */

const definitions = new Map(studyGradeCapabilities.map(definition => [definition.id, definition]))

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  ...extra,
})

const parameter = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning,
  source,
  required: true,
  ...extra,
})

const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter =>
  parameter(meaning, source, { required: false, omitted, ...extra })

const idParameter = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter =>
  parameter(meaning, source, { type: 'string | number', ...extra })

const idRules = [
  '安全正整数或无前导零的正整数字符串；长ID保留字符串，不用名称、行号或另一类ID代替。',
]

const idListParameter = (meaning: string, source: string): AiParameter =>
  parameter(meaning, source, {
    type: '(string | number)[]',
    constraints: [...idRules, '非空数组；SDK 在本地去重，重复项不改变服务端语义。'],
  })

const draftParameter = (label: string): AiParameter =>
  parameter(`对应 prepare 能力返回的${label}草稿；只提交 SDK 生成的字段。`, `班级管理${label}prepare.draft`, { type: 'object' })

const pageInputs = (fallback: number, why = '页面本身'): Record<string, AiParameter> => ({
  pageNo: optional('从 1 开始的页码。', '调用方分页位置', 'SDK 使用 1', { type: 'integer', default: '1', constraints: ['正整数'] }),
  pageSize: optional(`每页条数；${why}用 ${fallback}。`, '调用方分页设置', `SDK 使用 ${fallback}`, {
    type: 'integer',
    default: String(fallback),
    constraints: ['1 ≤ pageSize ≤ 500', '不接受 -1 或 0：那是"全量拉取"，SDK 直接抛错而不是截断'],
  }),
})

const keywordParameter = (meaning: string, source: string): AiParameter =>
  parameter(`${meaning}**必填**。这是 SDK 侧的强制规则，不是后端要求：无关键字时后端照样返回 200，但那是一次全量人员拉取（设计 D6 / H35）。`, source, {
    type: 'string',
    constraints: ['非空白；调用前先向用户要名字或工号的一两个字', '被 SDK 拒绝的调用不会发出任何请求'],
  })

const pageOutput = (rowFields: AiField[], label: string): AiContract['output'] => ({
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', `${label}分页结果。`),
    field('list', 'object[]', '当前页记录，不是全部记录。'),
    field('list[]', 'object', '一条页面或后端返回记录。'),
    ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` })),
    field('total', 'number', '符合筛选条件的总记录数，不是当前页长度。'),
  ],
  empty: 'list=[] 且 total=0 表示当前筛选下没有记录；权限、会话、网络或响应形状错误会抛出，不降级为空页。',
})

const arrayOutput = (rowFields: AiField[], label: string): AiContract['output'] => ({
  shape: 'object[]',
  fields: [
    field('$', 'object[]', `${label}列表；这条接口回的是完整数组，不是分页。`),
    field('[]', 'object', `一条${label}记录。`),
    ...rowFields.map(item => ({ ...item, path: `[].${item.path}` })),
  ],
  empty: '[] 表示当前没有关联记录；请求失败或响应不是数组时抛出，不用空数组代替错误。',
})

const draftOutput = (label: string, fields: AiField[]): AiContract['output'] => ({
  shape: '{ draft: object }',
  fields: [
    field('$', 'object', `${label}准备结果；只做本地校验，没有写入服务端。`),
    field('draft', 'object', `供对应提交能力使用的${label}草稿。`),
    ...fields,
  ],
  empty: 'ID、数组或字段不符合规则时在发请求前抛错，不返回空草稿。',
})

const undefinedOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', 'Portal 成功响应没有供调用方消费的业务 data；SDK 等请求完成后返回 undefined。')],
  empty: '请求失败时抛出异常；undefined 不能单独证明业务对象已经落库，写操作必须回查。',
}

const cancelOutput: AiContract['output'] = {
  shape: '{ cancelled: true }',
  fields: [field('cancelled', 'true', '本地草稿已丢弃；没有发起网络请求。')],
  empty: '固定返回 cancelled=true。它不撤销已经提交的 Portal 或外部平台副作用。',
}

const commonEvidence: AiContract['evidence'] = [
  {
    source:
      'CodeReview_Projects_Js@test/portal/main:6ac274fc9e app/portal/views/dashboard/education/grade/grade/components/organization.vue、components/post.vue、student/[id]/components/add-student.vue、student/[id]/item-list.vue、[mode]/[id].vue、list.vue、app/portal/components/portal/education/dropdown/student/index.vue、app/portal/utils/user/use-paged-user-options.js',
    kind: 'reference',
    note: '逐文件核对三个弹窗与班级表单的请求方法、参数名与顺序、默认每页条数、可选节点的判定（postId 有无）、空选阻断、以及按工号定向回显的请求形状；确认 organization.vue 当前调用的是 addGradeOrganizationRelV2（addGradeOrganizationRel 那行是注释）。',
  },
  {
    source:
      'CodeReview_Mall_Platform_Java@test/test:77fbc2a206c StudyGradeController、StudyGradeOrganizationRelServiceImpl、StudyGradeStudentRelServiceImpl、HrSysUserController、HrSysUserServiceImpl、HrOrganizationController、HrOrganizationServiceImpl、HrStaffController、HrStaffServiceImpl、StudyStudentServiceImpl、StudyGradeOrganizationRelDao.xml、StudyGradeStudentRelDao.xml、SysUserDao.xml、StudyStudentDao.xml、HrStaffDao.xml、StudyGradeOrganizationRelDTO、StudyPostDTO、OrganizationPostDTO、StudyStudentPageDTO、AddStudentDTO、GradeUserPageDTO、SysUserDTO',
    kind: 'reference',
    note: '核对端点 HTTP 方法、请求体、集合替换语义、软删与学员连带删除、ZHDJ 云信成员调整与推送的触发条件、事务注解的有无、默认每页条数与排序、name 的三种匹配方式，以及 userNotInGrade 的 LEFT JOIN 未被使用、（getUserListPage 的）页码硬校验。',
  },
  {
    source: 'src/capabilities/study-grade.ts',
    kind: 'implementation',
    note: '锁定 SDK 的能力 ID、方法映射、参数顺序、关键字强制、pageSize 上限、ID 去重、凭据字段裁剪和本地 cancel 语义。',
  },
]

const commonGaps = [
  '尚未在真实测试环境执行关联组织 / 关联业务 / 添加学员的 prepare→提交→独立回查→清理闭环；云信群成员调整与推送是否真的发出，本轮没有观测证据。',
  '本轮无浏览器基准：请求形状来自固定检出的 Portal 源码与 Java 源码静态核对，不是抓包实测；qs 键序按源码的字面顺序锁定，未与线上字节逐字比对。',
  '`userNotInGrade` 不过滤已在班级的人，这一结论来自读 SQL（LEFT JOIN 的子查询别名在 WHERE/SELECT 里都没被使用），未做运行时反证。',
]

type ContractBody = Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>

const base = (value: ContractBody): AiContract => ({
  ...value,
  whenToUse:
    '操作 Portal「学习管理 → 班级管理」列表行进入的隐藏弹窗（关联组织、关联业务、管理学员）与班级表单里的人员候选选择器。',
  boundaries: [
    '每个能力都绑定到自己的 Portal 页面上下文：班级列表页及其弹窗使用 /dashboard/grade/grade，组织结构下的班级回查/删除使用 /dashboard/base/management-center；均发送 module-type=12 并使用 platform HTTP 实例。不要把组织结构页面的权限或筛选上下文误换成班级列表页。',
    '班级 ID（hr_study_grade.id）、组织 ID（hr_organization.id）、岗位 ID（hr_post.id）、用户工号（hr_sys_user.username）、班级学员关联 ID 是**五类不同主键**，只能按各自字段传递，不能用名称、树节点 id 或另一类 ID 替换。',
    '「关联组织」只在班级类型 type=0 的行上显示，「关联业务（岗位）」只在 type≠0 的行上显示（list.vue:79-80），两者互斥；它们收的是**同一个 DTO 类**但字段不同，不能互相代填。',
    '两个「关联」写入都是**集合替换**而非增量追加：不在目标列表里的旧组织/岗位会被软删，名下班级学员关联同时被软删，并按被移除学员推送移出消息。目标列表不含旧项就等于一次批量移除。',
    '两个「关联」写入都**没有事务**（服务端该方法上没有 @Transactional），"移除已完成、新增失败"的半成品可能落库；提交失败或超时一律先回查，不要凭 HTTP 结果判定成功。',
    '「添加学员」会调用外部云信群接口调成员并推送消息；完成判据不能写成"班级已更新"，必须回查班级学员列表。',
    '人员候选一律先要关键字：SDK 会拒绝没有 keyword 的调用（除非该能力另有精确标识参数），这是 SDK 侧策略而不是后端要求。',
    '`GET /sys/user/userNotInGrade` 当前的 SQL 并不过滤已在班级的人，SDK 原样透传该语义，不替后端补本地过滤。',
    'SDK 会裁掉人员响应里的 password / password2 / salt 三个键；不要据此认为这些字段在服务端不存在。',
  ],
  prerequisites: [
    '使用当前用户会话与租户创建 SDK；三个弹窗的 gradeId 必须来自当前租户班级列表行，不能用名称或编号代替。',
    '写入前先把"目标全集"和用户确认清楚，尤其是会被移除的组织/岗位与它们带走的学员。',
  ],
  failures: [
    '非法 ID、空数组、空关键字、pageSize ≤ 0 或超过 500 会在发请求前抛错，且不发送任何请求。',
    '401/403、租户与数据范围、网络、服务端业务错误或响应形状错误原样抛出；空数组、undefined 与 HTTP 成功都不能替代业务成功。',
    '服务端业务拒绝会以 500 形式返回（后端失败信号区分度差）：例如"添加学员"里只要有一个工号已在班级，整单报错「X已在班级中请移除后再添加学员」。',
    '跨系统依赖失败可能已经产生部分副作用：云信群成员可能已被调整、推送可能已发出，而本地事务可能已回滚；失败后先回查，不要盲目重试。',
  ],
  evidence: commonEvidence,
  gaps: commonGaps,
})

const contracts: Record<string, AiContract> = {}

function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Study grade contract has no capability definition: ${id}`)
  contracts[id] = value
}

const candidateRowFields: AiField[] = [
  field('id', 'string | number', '用户 ID（hr_sys_user.id）；不是工号。'),
  field('username', 'string | null', '工号。班级表单里班主任/班长/助教存的就是它，班级学员提交也用它。', { nullable: true, nullMeaning: '后端未返回工号' }),
  field('realName', 'string | null', '姓名。页面把它当作显示名。', { nullable: true, nullMeaning: '后端未返回姓名' }),
  field('mobile', 'string | null', '手机号。', { nullable: true, nullMeaning: '后端未返回手机号' }),
  field('organizationId', 'string | number | null', '所属组织 ID；不是组织路径。', { nullable: true, nullMeaning: '后端未返回组织' }),
  field('organizationName', 'string | null', '组织全路径。⚠️ 只有 userNotInGrade 会填；getUserListPage 恒为 null（SysUserEntity 上没有这一列）。', { nullable: true, nullMeaning: '该端点在服务端没有这个字段' }),
  field('status', 'number | null', '账号状态原码；候选列表本身已按在职过滤，不要用这个字段再判在职。', { nullable: true, nullMeaning: '后端未返回状态' }),
  field('postId', 'string | number | null', '岗位 ID；不是岗位名。', { nullable: true, nullMeaning: '后端未返回岗位' }),
]

// ---------------------------------------------------------------------------
// 班级表单的人员候选
// ---------------------------------------------------------------------------

add('study-grade-staff-search', base({
  purpose: '按姓名关键字分页查询在职人员，作为班级表单里班主任 / 班长 / 助教 / 讲师的人员候选。',
  effect: 'read',
  inputs: {
    keyword: keywordParameter('人员姓名关键字，服务端按 real_name 包含匹配。', '用户给出的姓名片段'),
    // 两个下拉走 usePagedUserOptions，它的 DEFAULT_PAGE_SIZE 是 20（不是名单表的 5）
    ...pageInputs(20, '班级表单的两个下拉组件'),
  },
  output: pageOutput(candidateRowFields, '人员候选'),
  consume: [
    '用 list[].username（工号）填入班级表单的班主任/班长/助教字段；list[].realName 只用于显示，不要提交姓名。',
    '未登记的其它后端字段原样透传，不属于本页消费契约；password / password2 / salt 已被 SDK 裁掉。',
    '需要把人名换回工号或反过来时用 study-grade-staff-resolve，不要用 keyword 去猜工号。',
  ],
  steps: [
    {
      role: 'optional',
      when: '用户要从候选里选人填进班级表单',
      capabilityId: 'study-grade-staff-resolve',
      mapping: { usernames: 'result.list[].username' },
      instruction: '把已选工号交给回显能力复核姓名；unknown 工号会在 missing 里返回，不要当作失败。',
    },
  ],
  completion: '返回当前关键字的候选页；读取本身不修改数据。需要覆盖全部命中时继续翻页到 total，不要拿当前页当全集。',
  idempotency: null,
}))

add('study-grade-staff-resolve', base({
  purpose: '按工号（username）精确回显人员姓名，用于把班级表单里已保存的班主任 / 班长 / 助教工号换回可读姓名。',
  effect: 'read',
  inputs: {
    usernames: parameter('工号数组，精确匹配 hr_sys_user.username；不是用户 ID、不是姓名。', '班级列表行或班级详情里保存的 teacherCode / squadLeaderCode / teachingAssistantCode', {
      type: '(string | number)[]',
      constraints: ['非空数组', '每个工号非空白；SDK 会逐个 trim'],
    }),
  },
  output: {
    shape: '{ list: object[], missing: (string | number)[] }',
    fields: [
      field('$', 'object', '按工号回显的结果；一次调用可能发出多条请求（页面就是每个工号一条）。'),
      field('list', 'object[]', '命中的用户行，字段语义与 study-grade-staff-search 的 list[] 相同。'),
      ...candidateRowFields.map(item => ({ ...item, path: `list[].${item.path}` })),
      field('missing', 'string[]', '没有匹配到用户的工号（SDK 统一成字符串，与传入的数字工号在类型上不同）。页面在这种情况下退回"工号：xxx"的兜底显示，不是错误。'),
    ],
    empty: 'list=[] 表示这些工号一个都没匹配上，全部列在 missing 里；请求本身失败仍然抛出。',
  },
  consume: [
    '用 list[].username 与 list[].realName 还原表单里已选人员的显示名；只有 missing 里的工号才需要退回显示工号本身。',
    '本能力每次只取 1 条（工号在服务端是精确匹配且唯一），不要用它做模糊搜索；模糊搜索用 study-grade-staff-search。',
  ],
  steps: [],
  completion: '得到每个工号对应的姓名或明确列在 missing 里；读取到此结束。',
  idempotency: null,
}))

// ---------------------------------------------------------------------------
// 关联组织
// ---------------------------------------------------------------------------

add('study-grade-organization-list', base({
  purpose: '读取一个班级当前已关联的组织（扁平去重集合），用于打开「关联组织」弹窗时回显已勾选的组织。',
  effect: 'read',
  inputs: {
    gradeId: idParameter('班级 ID（hr_study_grade.id），来自班级列表行。', '班级列表行 record.id'),
  },
  output: arrayOutput([
    field('id', 'string | number | null', '组织 ID（hr_organization.id）；它与 addGradeOrganizationRelV2 收的 organizationIdList 是同一个 ID 空间。', { nullable: true, nullMeaning: '服务端未返回 id' }),
    field('code', 'string | null', '组织编码；弹窗不用它，只用于排障对账。', { nullable: true, nullMeaning: '服务端未返回编码' }),
    field('name', 'string | null', '组织名称。', { nullable: true, nullMeaning: '服务端未返回名称' }),
  ], '班级已关联组织'),
  consume: [
    '把这个数组的 id 作为"当前已选集合"，与用户新选的目标集合比较：差集就是这次会被移除的组织，并集才是要提交的 organizationIdList。',
    '组织树本身不在这里：候选节点用 hr-organization-setting-post-tree，按名字在本地筛。',
  ],
  steps: [
    {
      role: 'optional',
      when: '用户要调整关联组织',
      capabilityId: 'study-grade-add-organization-prepare',
      mapping: { gradeId: 'args.gradeId', organizationIdList: 'user.targetOrganizationIdList' },
      instruction: '把"当前集合 ∪ 用户新增 − 用户移除"的完整目标集合交给 prepare，不要只提交增量的那一部分。',
    },
  ],
  completion: '返回该班级当前关联的组织集合；读取不改变任何关联。',
  idempotency: null,
}))

add('study-grade-add-organization-prepare', base({
  purpose: '校验并去重「目标组织全集」，生成关联组织的提交草稿；只做本地校验，不发请求。',
  effect: 'prepare',
  inputs: {
    gradeId: idParameter('班级 ID。', '班级列表行 record.id'),
    organizationIdList: idListParameter('目标组织 ID 全集（hr_organization.id），不是增量、不是组织名。', 'hr-organization-setting-post-tree 的组织节点 id，或用户直接给出的已知 id'),
  },
  output: draftOutput('关联组织', [
    field('draft.gradeId', 'string | number', '班级 ID。'),
    field('draft.organizationIdList', '(string | number)[]', '本地校验并去重后的目标组织全集；提交能力原样发出。'),
    field('draft.organizationIdList[]', 'string | number', '一个目标组织 ID。'),
  ]),
  consume: [
    '先把当前集合读出来（study-grade-organization-list），算出「会被移除的组织」并向用户确认——它们名下的班级学员也会被移出，而且这条没有事务保护。',
    '草稿里的 organizationIdList 是**全集**：漏掉一个原来关联的组织，就等于把它移除。',
  ],
  steps: [
    { role: 'required', when: '用户确认组织调整', capabilityId: 'study-grade-add-organization-rel', mapping: { draft: 'result.draft' }, instruction: '原样提交 draft；不要追加或删减任何一个 id。' },
    { role: 'cancel', when: '用户取消调整', capabilityId: 'study-grade-add-organization-cancel', instruction: '丢弃本地草稿，不发送请求。' },
  ],
  completion: '得到通过本地校验的目标组织全集草稿；服务端关联尚未改变。',
  idempotency: null,
}))

add('study-grade-add-organization-rel', base({
  purpose: '提交班级关联组织：把班级的关联组织替换成草稿里的目标全集，并连带调整这些组织下的班级学员。',
  effect: 'write',
  inputs: {
    draft: draftParameter('关联组织'),
    'draft.gradeId': idParameter('班级 ID。', 'study-grade-add-organization-prepare.draft.gradeId'),
    'draft.organizationIdList': idListParameter('目标组织全集。', 'study-grade-add-organization-prepare.draft.organizationIdList'),
  },
  output: undefinedOutput,
  consume: [
    '请求体是 { gradeId, organizationIdList }，POST /study/grade/studygrade/addGradeOrganizationRelV2；服务端没有回执 data，不要把 undefined 当作成功证据。',
    '服务端会移除不在列表里的旧组织、软删它们名下的班级学员关联，并对被移除的学员调外部云信群接口调成员、再推送移出消息；这条链路上没有事务。',
    '⚠️ 新增分支**不调云信**（只有移除分支调），所以"新加的组织下的人有没有进群"不能从这次调用推断；要确认请查群或查学员列表。',
  ],
  steps: [
    { role: 'required', when: '请求成功或超时', capabilityId: 'study-grade-organization-list', mapping: { gradeId: 'args.draft.gradeId' }, instruction: '回查关联组织集合，确认与草稿逐项一致；超时更要先回查再决定是否重发。' },
    { role: 'cancel', when: '提交前用户取消', capabilityId: 'study-grade-add-organization-cancel', instruction: '仅在未提交时有效；提交后没有通用回滚，要恢复必须重新读当前集合并另行确认提交。' },
  ],
  completion: '关联组织回查与草稿一致，且被移除学员的外部群状态已确认（或明确记录未确认）后，才能报告完成。',
  idempotency: '服务端零幂等标识；重复提交同一集合对组织关联本身是收敛的，但对"本次被移除的学员"会再推一次移出消息与外部群调整，所以超时先回查、不要自动重发。',
}))

add('study-grade-add-organization-cancel', base({
  purpose: '取消尚未提交的关联组织草稿。',
  effect: 'local',
  inputs: {},
  output: cancelOutput,
  consume: ['只丢弃 study-grade-add-organization-prepare 的本地结果，不调用 Portal，也不会撤销任何已提交的关联或外部群调整。'],
  steps: [],
  completion: '返回 cancelled=true 且没有网络副作用。',
  idempotency: null,
}))

// ---------------------------------------------------------------------------
// 关联业务（岗位）
// ---------------------------------------------------------------------------

add('hr-organization-setting-post-tree', base({
  purpose: '读取「组织 + 岗位」结构树，作为关联业务弹窗里可勾选的岗位来源。',
  effect: 'read',
  inputs: {},
  output: {
    shape: 'object[]',
    fields: [
      field('$', 'object[]', '组织与岗位混在同一棵树里：组织节点是父，岗位节点是它的孩子。'),
      field('[]', 'object', '一个节点（组织或岗位）。'),
      ...treeNodeFields(),
    ],
    empty: '[] 表示当前租户没有可用的组织或岗位；请求失败时抛出，不用空数组代替错误。',
  },
  consume: [
    '只有带 postId 的节点是岗位、可以被选中；页面正是按 item.postId 的有无把组织节点置成 disabled。',
    '提交给 study-grade-post-add 的是节点的 **postId**，不是节点的 id —— 岗位节点的 id 是 organizationId 与 postId 拼接出来的合成值。',
    '这条接口**不接受任何参数**，服务端每次都回整棵树；关键字过滤只能在本地按 name 做，并把命中节点的祖先链展开给用户，不要假装服务端筛过。',
  ],
  steps: [
    {
      role: 'optional',
      when: '用户选中了若干岗位、要看这些岗位下都有谁',
      capabilityId: 'study-grade-post-staff-list',
      mapping: { postIdList: 'user.selectedPostIds' },
      instruction: '传用户选定岗位的 postId 数组；页面就是这么显示"包含人员"的。',
    },
  ],
  completion: '返回当前租户完整的组织岗位树；读取到此结束。',
  idempotency: null,
}))

function treeNodeFields (): AiField[] {
  return [
    field('[].id', 'string | number | null', '节点 ID。组织节点是 hr_organization.id；岗位节点是 organizationId 与 postId 拼接出来的合成值，不是岗位 ID。', { nullable: true, nullMeaning: '服务端未返回 id' }),
    field('[].name', 'string | null', '组织名或岗位名。', { nullable: true, nullMeaning: '服务端未返回名称' }),
    field('[].postId', 'string | number | null', '岗位 ID（hr_post.id）。组织节点恒为 null，只有岗位节点有值；提交关联业务用它。', { nullable: true, nullMeaning: '这是组织节点，不可选' }),
    field('[].organizationId', 'string | number | null', '所属组织 ID（hr_organization.id）。', { nullable: true, nullMeaning: '服务端未返回' }),
    field('[].orgPostId', 'string | number | null', '组织-岗位关联记录 ID（hr_organization_post.id）；关联业务不需要它。', { nullable: true, nullMeaning: '这是组织节点或未返回' }),
    field('[].pid', 'string | number | null', '父节点 ID；岗位节点的父是它所属的组织。', { nullable: true, nullMeaning: '根节点或未返回' }),
    field('[].children', 'object[]', '子节点数组；岗位节点没有 children。', { nullable: true, nullMeaning: '叶子节点' }),
    field('[].children[]', 'object', '一个子节点，语义与本层相同（递归）。'),
    field('[].children[].id', 'string | number | null', '子节点 ID。', { nullable: true, nullMeaning: '服务端未返回' }),
    field('[].children[].postId', 'string | number | null', '子节点的岗位 ID。', { nullable: true, nullMeaning: '这是组织节点' }),
    field('[].children[].name', 'string | null', '子节点名称。', { nullable: true, nullMeaning: '服务端未返回' }),
    field('[].children[].children', 'object[]', '更深一层的子节点；树可能不止两层，按递归处理。', { nullable: true, nullMeaning: '叶子节点' }),
  ]
}

add('study-grade-post-list', base({
  purpose: '读取一个班级当前已关联的岗位（扁平去重集合），用于打开「关联业务」弹窗时回显已勾选的岗位。',
  effect: 'read',
  inputs: {
    gradeId: idParameter('班级 ID。', '班级列表行 record.id'),
  },
  output: arrayOutput([
    field('id', 'string | number | null', '**岗位 ID（hr_post.id）**，与 addGradePostRel 收的 postIdList 同一空间。它不是组织岗位树里节点的 id。', { nullable: true, nullMeaning: '服务端未返回 id' }),
    field('name', 'string | null', '岗位名称。', { nullable: true, nullMeaning: '服务端未返回名称' }),
  ], '班级已关联岗位'),
  consume: [
    '用返回的 id 与组织岗位树里岗位节点的 postId 求交，才能还原"弹窗里该勾哪些节点"；不要拿它去比节点的 id。',
    '这个集合是提交时的"当前已关联"：差集就是会被移除的岗位，它们名下的班级学员也会被移出。',
  ],
  steps: [
    {
      role: 'optional',
      when: '用户要调整关联岗位',
      capabilityId: 'study-grade-post-add-prepare',
      mapping: { gradeId: 'args.gradeId', postIdList: 'user.targetPostIds' },
      instruction: '先把当前集合与组织岗位树合起来算目标全集，再交给 prepare。',
    },
  ],
  completion: '返回该班级当前关联的岗位集合；读取不改变任何关联。',
  idempotency: null,
}))

add('study-grade-post-staff-list', base({
  purpose: '按岗位 ID 批量查询在职员工，用于「关联业务」弹窗右侧的"包含人员"预览。',
  effect: 'read',
  inputs: {
    postIdList: idListParameter('岗位 ID 非空数组（hr_post.id），不是组织岗位树节点的合成 id、也不是岗位名。', 'study-grade-post-list 的 id 或组织岗位树岗位节点的 postId'),
  },
  output: arrayOutput([
    field('id', 'string | number | null', '员工 ID（hr_staff.id），不是工号。', { nullable: true, nullMeaning: '服务端未返回' }),
    field('name', 'string | null', '员工姓名。弹窗的"包含人员"只显示它。', { nullable: true, nullMeaning: '服务端未返回姓名' }),
    field('staffCode', 'string | number | null', '工号；把岗位关联带进班级学员时用的就是它。', { nullable: true, nullMeaning: '服务端未返回工号' }),
    field('post', 'string | number | null', '所属岗位 ID。', { nullable: true, nullMeaning: '服务端未返回岗位' }),
    field('status', 'number | null', '员工状态原码；服务端已按在职状态过滤（1/4/5），不要再用它二次判定。', { nullable: true, nullMeaning: '服务端未返回状态' }),
    field('mobile', 'string | number | null', '手机号原值。', { nullable: true, nullMeaning: '服务端未返回手机号' }),
  ], '岗位在职员工'),
  consume: [
    '请求体是**裸的岗位 ID 数组**（POST /org/staff/getStaffListByPostId），不是 { postIdList } 包装；响应是数组，不是分页。',
    '它是**只读**的：虽然是 POST，服务端只查库不写；不要把它当成提交动作。',
    '把返回的 staffCode 与班级学员列表对比，就能知道"关联这个岗位会新带进哪些人"。',
  ],
  steps: [],
  completion: '得到这些岗位下的在职员工清单；读取到此结束。',
  idempotency: null,
}))

add('study-grade-post-add-prepare', base({
  purpose: '校验并去重「目标岗位全集」，生成关联业务的提交草稿；只做本地校验，不发请求。',
  effect: 'prepare',
  inputs: {
    gradeId: idParameter('班级 ID。', '班级列表行 record.id'),
    postIdList: idListParameter('目标岗位 ID 全集（hr_post.id），不是增量、不是岗位名、不是树节点 id。', '组织岗位树里岗位节点的 postId，或 study-grade-post-list 的 id'),
  },
  output: draftOutput('关联业务（岗位）', [
    field('draft.gradeId', 'string | number', '班级 ID。'),
    field('draft.postIdList', '(string | number)[]', '本地校验并去重后的目标岗位全集；提交能力原样发出。'),
    field('draft.postIdList[]', 'string | number', '一个目标岗位 ID。'),
  ]),
  consume: [
    '先读当前已关联岗位，算出会被移除的岗位并确认：它们名下的班级学员也会被移出并收到移出推送。',
    '页面在没有任何岗位被选中时直接提示"请选择岗位"且不发请求，所以目标列表不能为空。',
  ],
  steps: [
    { role: 'required', when: '用户确认岗位调整', capabilityId: 'study-grade-post-add', mapping: { draft: 'result.draft' }, instruction: '原样提交 draft；postIdList 是全量目标集合。' },
    { role: 'cancel', when: '用户取消调整', capabilityId: 'study-grade-post-add-cancel', instruction: '丢弃本地草稿，不发送请求。' },
  ],
  completion: '得到通过本地校验的目标岗位全集草稿；服务端关联尚未改变。',
  idempotency: null,
}))

add('study-grade-post-add', base({
  purpose: '提交班级关联业务（岗位）：把班级的关联岗位替换成草稿里的目标全集，把新岗位下的在职员工写进班级学员。',
  effect: 'write',
  inputs: {
    draft: draftParameter('关联业务（岗位）'),
    'draft.gradeId': idParameter('班级 ID。', 'study-grade-post-add-prepare.draft.gradeId'),
    'draft.postIdList': idListParameter('目标岗位全集。', 'study-grade-post-add-prepare.draft.postIdList'),
  },
  output: undefinedOutput,
  consume: [
    '请求体是 { gradeId, postIdList }，POST /study/grade/studygrade/addGradePostRel；与"关联组织"是**不同的动作**，尽管两者收的是同一个 DTO 类。',
    '服务端会软删不在列表里的旧岗位、连带软删它们名下的班级学员关联并推送移出消息；新岗位下的**在职**员工（状态 1/4/5）会被写成班级学员（入班方式为按组织/岗位带入）。',
    '这条链路在服务端没有事务，且新增分支不调云信：不要用"接口返回成功"推断群成员已同步。',
  ],
  steps: [
    { role: 'required', when: '请求成功或超时', capabilityId: 'study-grade-post-list', mapping: { gradeId: 'args.draft.gradeId' }, instruction: '回查关联岗位，确认与草稿一致；超时先回查再决定是否重发。' },
    { role: 'optional', when: '用户要看这次带进来了哪些人', capabilityId: 'study-grade-post-staff-list', mapping: { postIdList: 'args.draft.postIdList' }, instruction: '按新关联的岗位查在职员工，与班级学员候选或学员列表交叉核对。' },
    { role: 'cancel', when: '提交前用户取消', capabilityId: 'study-grade-post-add-cancel', instruction: '仅在未提交时有效；提交后没有通用回滚。' },
  ],
  completion: '关联岗位回查与草稿一致，并且新增学员已被确认进入班级列表后，才能报告完成。',
  idempotency: '服务端零幂等标识；重复提交同一集合对岗位关联自身收敛，但会重复推送"被移除学员"的移出消息并重复调整外部群，超时先回查、不要自动重发。',
}))

add('study-grade-post-add-cancel', base({
  purpose: '取消尚未提交的关联业务（岗位）草稿。',
  effect: 'local',
  inputs: {},
  output: cancelOutput,
  consume: ['只丢弃 study-grade-post-add-prepare 的本地结果，不调用 Portal，也不撤销已提交的岗位关联或学员变更。'],
  steps: [],
  completion: '返回 cancelled=true 且没有网络副作用。',
  idempotency: null,
}))

// ---------------------------------------------------------------------------
// 添加学员
// ---------------------------------------------------------------------------

add('study-grade-student-candidate', base({
  purpose: '分页查询可加入班级的**内部**人员候选，用于「添加学员」弹窗的"内部学员"页签。',
  effect: 'read',
  inputs: {
    gradeId: idParameter('班级 ID。本页必传（弹窗总是在某个班级里打开的）；服务端目前只把它用在一条子查询里。', '班级学员页路由参数 id'),
    keyword: keywordParameter('人员姓名关键字。', '用户给出的姓名片段'),
    ...pageInputs(5),
  },
  output: pageOutput(candidateRowFields, '内部学员候选'),
  consume: [
    '⚠️ 这个接口名叫"不在该班级的用户列表"，但**当前的 SQL 并不过滤已在班级的人**（LEFT JOIN 的学员子查询在 WHERE 与 SELECT 里都没被用到）。因此返回的行里**可能包含已经在班里的人**，而那正是服务端在"添加学员"时会整单拒绝的情况。要判断"是否已在班级"必须用班级学员列表另行核对，不要相信这个接口的名字。',
    'keyword 在服务端是 **real_name LIKE \'kw%\'（仅前缀匹配）**，与 study-grade-staff-search 的包含匹配不同：只记得名字中间几个字时，这里查不到。',
    '用 list[].username（工号）作为提交时的 staffCodeList，list[].realName 只用于显示，organizationName 是组织全路径。',
  ],
  steps: [
    {
      role: 'optional',
      when: '用户勾选完内部学员',
      capabilityId: 'study-grade-student-create-prepare',
      mapping: { gradeId: 'args.gradeId', staffCodeList: 'user.selectedStaffCodes' },
      instruction: '内部与外部两个页签勾选的工号要合并成一个数组再提交，页面就是这么做的。',
    },
  ],
  completion: '返回当前关键字的内部人员候选页；读取本身不修改班级成员。',
  idempotency: null,
}))

add('study-grade-external-student-list', base({
  purpose: '分页查询**外部**学员候选，用于「添加学员」弹窗的"外部学员"页签。',
  effect: 'read',
  inputs: {
    keyword: keywordParameter('姓名或手机号关键字；服务端同时按 name 与 mobile 做包含匹配。', '用户给出的姓名或手机号片段'),
    ...pageInputs(5),
  },
  output: pageOutput([
    field('id', 'string | number | null', '外部学员记录 ID（hr_study_student.id）；不是工号。', { nullable: true, nullMeaning: '服务端未返回' }),
    field('staffCode', 'string | number | null', '外部学员工号。提交加入班级时用它。', { nullable: true, nullMeaning: '服务端未返回工号' }),
    field('name', 'string | null', '姓名。', { nullable: true, nullMeaning: '服务端未返回姓名' }),
    field('mobile', 'string | number | null', '手机号（服务端 DTO 里是 Long，JSON 里是数字）。', { nullable: true, nullMeaning: '服务端未返回手机号' }),
    field('isRelatedClass', 'number | null', '是否已关联班级：0 否、1 是。它是"这个外部学员已经属于某个班"的线索，不表示属于当前班。', { nullable: true, values: { '0': '否', '1': '是' }, nullMeaning: '服务端未返回' }),
    field('isRelatedLayer', 'number | null', '是否已关联智慧蛋鸡账号：0 否、1 是。', { nullable: true, values: { '0': '否', '1': '是' }, nullMeaning: '服务端未返回' }),
    field('isCreateManually', 'number | null', '是否手动创建的外部学员：0 否、1 是。', { nullable: true, nullMeaning: '服务端未返回' }),
    field('organizationCode', 'string | number | null', '组织编码。', { nullable: true, nullMeaning: '服务端未返回' }),
    field('isDel', 'number | null', '逻辑删除标记；列表已过滤 is_del=0。', { nullable: true, values: { '0': '未删除', '1': '已删除' }, nullMeaning: '服务端未返回' }),
    field('createTime', 'string | null', '录入时间。页面按它倒序展示（服务端 order by create_time desc）。', { nullable: true, nullMeaning: '服务端未返回' }),
  ], '外部学员候选'),
  consume: [
    '服务端**固定**按"外部学员"过滤（内部把 isStaff 置 0），调用方无法从这个能力拿到内部人员；内部人员走 study-grade-student-candidate。',
    'organizationId / organizationName 在这条响应里恒为空（SQL 的 select 列表里没有这两列），页面也不显示它们。',
    '用 list[].staffCode 作为提交时的学员工号；isRelatedClass=1 只说明这个外部学员已经关联了某个班级，不代表已经在本班，最终仍以服务端"已在班级中"的校验为准。',
  ],
  steps: [
    {
      role: 'optional',
      when: '用户勾选完外部学员',
      capabilityId: 'study-grade-student-create-prepare',
      mapping: { gradeId: 'user.gradeId', staffCodeList: 'user.selectedStaffCodes' },
      instruction: '外部学员的勾选结果与内部学员合并成一个工号数组再提交；页面的"确定"就是这么合并的。',
    },
  ],
  completion: '返回当前关键字的外部学员候选页；读取本身不修改任何数据。',
  idempotency: null,
}))

add('study-grade-student-create-prepare', base({
  purpose: '校验并去重待入班的工号全集（内部人员与外部学员合并结果），生成添加学员的提交草稿；只做本地校验，不发请求。',
  effect: 'prepare',
  inputs: {
    gradeId: idParameter('班级 ID。', '班级学员页路由参数 id'),
    staffCodeList: parameter('待入班工号全集：内部人员取 username、外部学员取 staffCode，两类合并成一个数组。不是用户 ID，也不是班级学员关联记录 ID。', 'study-grade-staff-search 或 study-grade-student-candidate 的 username，与 study-grade-external-student-list 的 staffCode', {
      type: '(string | number)[]',
      constraints: [...idRules, '非空数组：页面在什么都没选时会发出空数组，服务端无法处理这种请求，SDK 在本地就拒绝。', 'SDK 在本地去重。'],
    }),
  },
  output: draftOutput('添加学员', [
    field('draft.gradeId', 'string | number', '班级 ID。'),
    field('draft.staffCodeList', '(string | number)[]', '本地校验并去重后的工号全集。'),
    field('draft.staffCodeList[]', 'string | number', '一个待入班的工号。'),
  ]),
  consume: [
    '页面没有任何"未选"保护：不勾任何人也会发一条空数组请求（服务端随后在 in () 上失败）。SDK 在 prepare 阶段就拒绝空数组，这是**刻意的偏离**，不是页面行为。',
    '去重只影响本地数组长度，不改变服务端语义。',
  ],
  steps: [
    { role: 'required', when: '用户确认添加学员', capabilityId: 'study-grade-student-create', mapping: { draft: 'result.draft' }, instruction: '原样提交 draft。' },
    { role: 'cancel', when: '用户取消添加', capabilityId: 'study-grade-student-create-cancel', instruction: '丢弃本地草稿，不发送请求。' },
  ],
  completion: '得到通过本地校验的工号全集草稿；班级成员尚未改变。',
  idempotency: null,
}))

add('study-grade-student-create', base({
  purpose: '提交添加学员入班：把草稿里的工号写进班级，并同步外部群成员。',
  effect: 'write',
  inputs: {
    draft: draftParameter('添加学员'),
    'draft.gradeId': idParameter('班级 ID。', 'study-grade-student-create-prepare.draft.gradeId'),
    'draft.staffCodeList': parameter('待入班工号全集。', 'study-grade-student-create-prepare.draft.staffCodeList', { type: '(string | number)[]', constraints: [...idRules, '非空数组'] }),
  },
  output: undefinedOutput,
  consume: [
    '请求体是 { gradeId, staffCodeList }，POST /study/grade/student/addGradeStudent；服务端没有回执 data，undefined 不是成功证据。',
    '服务端第一步就查这些工号里有没有已经在班级的：有任何一个是，整单报错「X已在班级中请移除后再添加学员」，**一个都不会加进去**。拿到这个错先回查班级学员列表，再让用户去掉已在班的人。',
    '通过后会：补建学员主表记录、写班级学员关联（入班方式为"手动添加"）、给正在上课的课堂补班课学员关联，最后调外部云信群接口把这些人加进群并推送消息。',
    '本地写有事务，但外部群调整与推送不在事务里：本地回滚了不代表群成员没被加过。',
  ],
  steps: [
    { role: 'required', when: '请求成功或超时', capabilityId: 'study-grade-student-list', mapping: { gradeId: 'args.draft.gradeId' }, instruction: '按同一班级的学员关联数组核对目标staffCode已出现；人员候选不能证明入班结果。' },
    { role: 'cancel', when: '提交前用户取消', capabilityId: 'study-grade-student-create-cancel', instruction: '仅在未提交时有效；提交后要撤销必须走"移出学员"，且外部群成员也需要另行处理。' },
  ],
  completion: '班级学员列表回查确认目标工号已入班、且外部群成员调整已确认或明确记录未确认后，才能报告完成。',
  idempotency: '服务端零幂等标识：重复提交同一批工号会被"已在班级中"整单拒绝，所以超时后不要盲目重发，先回查班级学员列表再决定。',
}))

add('study-grade-student-create-cancel', base({
  purpose: '取消尚未提交的添加学员草稿。',
  effect: 'local',
  inputs: {},
  output: cancelOutput,
  consume: ['只丢弃 study-grade-student-create-prepare 的本地结果，不调用 Portal，也不移除已经入班的学员或已加入群的人。'],
  steps: [],
  completion: '返回 cancelled=true 且没有网络副作用。',
  idempotency: null,
}))

const statusInputs = { draft: parameter('同一次状态准备/check返回的{id,status}；status是绝对目标状态0或1。', 'study-grade-status-prepare.result.draft / study-grade-status-check.result.draft', { type: '{ id: string | number, status: 0 | 1 }' }) }
const statusReadback: AiContract['steps'] = [{ role: 'recovery', when: '请求成功、超时或响应不确定', capabilityId: 'study-grade-list', instruction: '保留原筛选并逐页按同一ID核对status；第一步有群聊副作用，不能因状态已改变就声称全部外部副作用已验证，也不要盲目重发第一步。' }]
const statusIdempotency = '没有requestId。两次PUT使用同一绝对目标状态；第一步可能创建云信群、课程并拉成员。超时先回查，不重新取反或自动重发。取消不回滚第一步。'
add('study-grade-status-prepare', base({
  purpose: '根据当前班级行状态生成启停目标草稿，不发请求。', effect: 'prepare',
  inputs: { id: idParameter('班级ID。', 'study-grade-list.result.list[].id'), currentStatus: parameter('当前状态：0停用、1启用；只接受0或1。', '同一班级最新列表行.status', { type: '0 | 1' }) },
  output: draftOutput('班级启停', [field('draft.id', 'string | number', '班级ID'), field('draft.status', '0 | 1', '取反后的绝对目标状态：0停用、1启用')]),
  consume: ['向用户确认班级与目标状态；prepare不读取或锁定服务端状态。'],
  steps: [{ role: 'required', when: '用户确认启停', capabilityId: 'study-grade-status-check', mapping: { draft: 'result.draft' }, instruction: '执行第一步真实写操作。' }, { role: 'cancel', when: '用户取消', capabilityId: 'study-grade-status-cancel', instruction: '只丢弃本地草稿。' }],
  completion: '得到本地状态草稿，服务端尚未变更。', idempotency: null,
}))
add('study-grade-status-check', base({
  purpose: '执行Portal班级启停第一步真实PUT /study/grade/studygrade/updateStatus；不是只读预检。', effect: 'write', inputs: statusInputs,
  output: { shape: '{ draft: { id, status }, message: string | null }', fields: [field('draft.id', 'string | number', '同一班级ID'), field('draft.status', '0 | 1', '保持不变的绝对目标状态'), field('message', 'string | null', '服务端返回的追加确认提示；null表示没有提示', { nullable: true, nullMeaning: '无追加确认提示' })], empty: '成功空回执归一为message=null；形状错误或业务失败抛错。' },
  consume: ['第一步本身可能已写status、创建云信群聊/即时通讯课程并拉入成员。SDK不自动发第二步。', 'message非空时向用户展示并取得追加确认；message=null且用户此前已确认时继续第二步。'],
  steps: [{ role: 'required', when: '没有追加提示，或用户接受服务端提示', capabilityId: 'study-grade-status-submit', mapping: { draft: 'result.draft' }, instruction: '发送同一份草稿；不要根据新状态重新取反。' }, ...statusReadback, { role: 'cancel', when: '用户拒绝追加提示', capabilityId: 'study-grade-status-cancel', instruction: '停止第二步并回查；取消不会回滚第一步。' }],
  completion: '第一步请求完成，保留目标草稿与提示；不能报告整个启停流程已完成。', idempotency: statusIdempotency,
}))
add('study-grade-status-submit', base({
  purpose: '执行Portal班级启停第二步PUT /study/grade/studygrade，body为{id,status}。', effect: 'write', inputs: statusInputs, output: undefinedOutput,
  consume: ['必须使用同一次check返回的草稿；有提示时先确认。完成后按同一班级ID回查status。'], steps: statusReadback,
  completion: '第二步完成且独立列表回查确认status等于目标状态；群聊副作用未观测时如实说明。', idempotency: statusIdempotency,
}))
add('study-grade-status-cancel', base({ purpose: '丢弃本地班级启停草稿并停止后续请求；不撤销已发送的第一步。', effect: 'local', inputs: {}, output: cancelOutput, consume: ['如果check已执行，需要回查status；cancel不是服务端撤销。'], steps: [], completion: '返回cancelled=true，无新增网络副作用。', idempotency: null }))
const timeReadbackInputs = {
  createTimeStart: optional('创建时间起YYYY-MM-DD HH:mm:ss。', '用户选定日期区间开始日零点', '空串', { type: 'string', constraints: ['与createTimeEnd成对'] }),
  createTimeEnd: optional('创建时间止，开区间：结束日加一天零点。', '用户选定日期区间结束日加一天', '空串', { type: 'string', constraints: ['与createTimeStart成对；不早于起点'] }),
}
add('study-grade-student-list', base({
  purpose: `按班级详情隐藏子页读取学员关联GET ${STUDY_GRADE_STUDENT_LIST_PATH}，用于入班/移出独立回查。`, effect: 'read',
  inputs: { gradeId: idParameter('班级ID，不是学员ID。', 'study-grade-list.result.list[].id / 班级详情路由id'), name: optional('学员姓名模糊筛选。', '用户输入', '空串', { type: 'string' }), mobile: optional('手机号筛选。', '用户输入', '空串', { type: 'string | number' }), staffCode: optional('工号筛选，不是关联记录ID。', '当前候选工号或用户输入', '空串', { type: 'string | number' }), isRelatedLayer: optional('是否关联智慧蛋鸡原码。', '页面同名字典或用户筛选', '空串', { type: 'string | number' }), ...timeReadbackInputs },
  output: arrayOutput([field('id', 'string | number', '班级学员关联记录ID；移出使用这个ID，不能用学员主表ID'), field('staffCode', 'string | number', '学员工号；入班后按此核对'), field('name', 'string', '学员姓名'), field('mobile', 'string | number', '联系方式原值'), field('organizationName', 'string', '组织结构名称'), field('inClassType', 'string | number', '入班方式原码，按页面字典显示'), field('isRelatedLayer', 'string | number', '是否关联智慧蛋鸡原码'), field('createTime', 'string', '关联创建时间原值')], '班级学员关联'),
  consume: ['非分页数组，order/orderField及空筛选值仍照发；有过滤时只能证明该过滤范围。', '移出后按关联记录id确认消失；入班后按staffCode确认出现，同名不能当成同一人。'], steps: [], completion: '得到同一班级当前筛选范围的关联记录；错误形状抛错，不当成空列表。', idempotency: null,
}))
add('study-grade-management-center-list', base({
  purpose: `按学习组织结构隐藏班级子页读取GET ${STUDY_GRADE_LIST_PATH}；使用组织结构页权限上下文。`, effect: 'read',
  inputs: { managementCenterId: idParameter('学习组织结构ID，不是行政组织ID。', 'base-management-center-list.result.list[].id'), name: optional('班级名称模糊筛选。', '用户输入', '空串', { type: 'string' }), type: optional('班级类型原码。', '页面字典或用户筛选', '空串', { type: 'string | number' }), ...timeReadbackInputs, ...pageInputs(20) },
  output: pageOutput([field('id', 'string | number', '班级ID'), field('name', 'string', '班级名称'), field('serialNumber', 'string', '班级编号'), field('type', 'string | number', '班级类型原码'), field('teachingAssistantName', 'string', '助教姓名'), field('status', 'number', '0停用、1启用', { values: { '0': '停用', '1': '启用' } }), field('creatorName', 'string', '创建人'), field('createTime', 'string', '创建时间原值'), field('updaterName', 'string', '修改人'), field('updateTime', 'string', '修改时间原值')], '组织结构班级'),
  consume: ['保留managementCenterId和原筛选，按total继续分页；某一页未出现目标ID不能证明删除完成。'], steps: [], completion: '返回当前组织结构下的班级分页，独立回查覆盖原查询范围后再判断删除。', idempotency: null,
}))

/**
 * 本文件覆盖的能力 → SDK 方法名。**是 `STUDY_GRADE_METHODS` 的一个子集**：
 * 班级删除与讲师/类型等写入口在 `contracts-study-grade-teacher.ts` 里。
 */
export const STUDY_GRADE_HIDDEN_METHODS = {
  'study-grade-status-prepare': 'prepareStatus',
  'study-grade-status-check': 'checkStatus',
  'study-grade-status-submit': 'submitStatus',
  'study-grade-status-cancel': 'cancelStatus',
  'study-grade-student-list': 'listStudents',
  'study-grade-management-center-list': 'listManagementCenterGrades',
  'study-grade-staff-search': 'searchStaffCandidates',
  'study-grade-staff-resolve': 'resolveStaffByUsername',
  'study-grade-organization-list': 'listOrganizations',
  'study-grade-add-organization-prepare': 'prepareAddOrganizations',
  'study-grade-add-organization-rel': 'addOrganizations',
  'study-grade-add-organization-cancel': 'cancelAddOrganizations',
  'hr-organization-setting-post-tree': 'getPostTree',
  'study-grade-post-list': 'listPosts',
  'study-grade-post-staff-list': 'listPostStaff',
  'study-grade-post-add-prepare': 'prepareAddPosts',
  'study-grade-post-add': 'addPosts',
  'study-grade-post-add-cancel': 'cancelAddPosts',
  'study-grade-student-candidate': 'searchStudentCandidates',
  'study-grade-external-student-list': 'listExternalStudents',
  'study-grade-student-create-prepare': 'prepareAddStudents',
  'study-grade-student-create': 'addStudents',
  'study-grade-student-create-cancel': 'cancelAddStudents',
} as const

// 本文件与 STUDY_GRADE_METHODS 必须对得上：漏一个说明能力加了但说明没跟上；
// 多一个说明说明指向了不存在的方法。方法名写错也要在这里断掉，而不是等到接线时。
const mismatched = Object.entries(STUDY_GRADE_HIDDEN_METHODS).filter(
  ([id, method]) => (STUDY_GRADE_METHODS as Record<string, string>)[id] !== method,
)
if (mismatched.length > 0) {
  throw new Error(
    `Study grade hidden method mapping mismatch: ${mismatched.map(([id, method]) => `${id}→${method}`).join(',')}`,
  )
}

export const STUDY_GRADE_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.keys(STUDY_GRADE_HIDDEN_METHODS).map(id => [id, contracts[id]!]),
)

export const STUDY_GRADE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(STUDY_GRADE_HIDDEN_METHODS).map(([id, method]) => [
    `studyGrade.${method}`,
    {
      ...STUDY_GRADE_AI_CONTRACTS[id]!,
      boundaries: [
        ...STUDY_GRADE_AI_CONTRACTS[id]!.boundaries,
        `这是公开门面 sdk.studyGrade.${method}；invoke 使用 capabilityId=${id}。prepare 只产生本地草稿，cancel 只丢弃未提交草稿，不能被误报为已写入或已回滚。`,
      ],
    },
  ]),
)
