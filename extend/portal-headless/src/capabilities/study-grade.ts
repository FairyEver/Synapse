import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * 班级管理 —— 学习管理域「课堂管理 → 班级管理」。
 *
 * 页面：`/dashboard/grade/grade/list`
 * 路由文件：`app/portal/views/dashboard/education/grade/grade/list.vue`
 * 逐字段基准：`baseline/study-base.browser.json`
 * 四件套记录：`docs/pages/班级管理.md`
 *
 * ## 这一页**没有** `convertFetchForm`
 *
 * 它是"纯声明式"那一类：参数顺序就是 `order → orderField → 表单原样 → pageNo → pageSize → _t`
 * （`list.js:473-483`）。实测 URL：
 *
 * ```text
 * /admin-api/study/grade/studygrade/page
 *   ?order=&orderField=&name=&type=&studentNumMin=&studentNumMax=&teacherName=&teachingAssistantName=&orgId=&pageNo=1&pageSize=20&_t=…
 * ```
 *
 * ⚠️ 注意与**同域那几个带 `convertFetchForm` 的页面相反**：这一页的每一个空值也照发，
 * 而且没有 `date` 被拆成两个标量这回事。
 *
 * ## 它同时是**别处的班级候选入口**——但别照抄页面那一套
 *
 * 课堂三页与学员统计页挂载时都会拉 `GET /study/grade/studygrade/page?pageSize=99999&pageNo=1`
 * 把**全部班级**塞进下拉（实测：一次 99999 条）。那是页面的做法，**无头不能照抄**
 * （设计 D6 / H35：长选项参数必须先要关键字）。
 * 所以本能力提供的 `searchByKeyword` 是**按下拉那一套的替代**：强制要关键字、在本地过滤后再限量返回。
 *
 * ## 写操作
 *
 * 班级删除和班级详情里的「移出学员」都按 prepare → submit → cancel 暴露。
 * prepare/cancel 只在本地校验或返回取消标记；submit 才发送真实请求。
 * 页面行尾的「启用/停用」按 Portal 两步写暴露：先 `PUT /study/grade/studygrade/updateStatus`，
 * 再 `PUT /study/grade/studygrade`；第一步本身可能已写状态或创建群聊，不能当只读检查。
 *
 * ## 弹窗与隐藏子页（本文件第二批）
 *
 * 列表行的「关联组织 / 关联业务 / 管理学员」三个动作各自打一个弹窗或隐藏子路由
 * （`grade/components/organization.vue`、`grade/components/post.vue`、
 * `grade/student/[id]/components/add-student.vue`），班级表单 `[mode]/[id].vue`
 * 还带自己的人员候选。这些请求原先整块漏掉，本批补齐：
 *
 * | 能力 id | 端点 | 性质 |
 * | --- | --- | --- |
 * | `study-grade-staff-search` | `GET /sys/user/getUserListPage`（`name`） | 读 |
 * | `study-grade-staff-resolve` | `GET /sys/user/getUserListPage`（`username`） | 读 |
 * | `study-grade-organization-list` | `GET /study/grade/studygrade/getGradeOrganization` | 读 |
 * | `study-grade-add-organization-prepare/rel/cancel` | `POST …/addGradeOrganizationRelV2` | 写 |
 * | `hr-organization-setting-post-tree` | `GET /org/organization/getOrganizationPost` | 读 |
 * | `study-grade-post-list` | `GET /study/grade/studygrade/getGradePost` | 读 |
 * | `study-grade-post-staff-list` | `POST /org/staff/getStaffListByPostId` | 读 |
 * | `study-grade-post-add-prepare/add/cancel` | `POST …/addGradePostRel` | 写 |
 * | `study-grade-student-candidate` | `GET /sys/user/userNotInGrade` | 读 |
 * | `study-grade-external-student-list` | `GET /study/grade/student/getExternalStudentList` | 读 |
 * | `study-grade-student-create-prepare/create/cancel` | `POST /study/grade/student/addGradeStudent` | 写 |
 *
 * ### 两条**同名不同动作**的写：别按 DTO 类名认，也别按方法名认
 *
 * `addGradeOrganizationRelV2` 与 `addGradePostRel` 收的是**同一个 DTO 类**
 * （`StudyGradeOrganizationRelDTO`），但一个读 `organizationIdList`、一个读 `postIdList`，
 * 做的是完全不同的事。而 `addGradeOrganizationRelV2` 那条路由的**控制器方法名叫
 * `addGradeOrganizationRelV1`**（`StudyGradeController` 里路径与方法名不一致，`@LogRecord`
 * 的 `subType` 也照抄了这个错名）—— 按路径猜方法名会找错实现。
 *
 * ### 两个「关联」写都是**集合替换**，且各自带一个静默的删除分支
 *
 * 两者都把收到的列表当作**目标全集**：先算出「之前关联过、这次不在列表里」的组织/岗位，
 * 把它们软删（`is_del=1`），**同时把它们名下的班级学员关联也软删**，并按被移除学员
 * 推送一次「移出」消息。目标列表不含旧项就等于一次批量移除，页面上没有二次确认。
 *
 * 两个写都**没有** `@Transactional`（`StudyGradeOrganizationRelServiceImpl` 上只有
 * `addGradeOrganizationRel`(V1) 与另一个方法带注解），所以「移除做完、新增失败」这种
 * 半成品是可能的。完成判据必须回查，不能只看 HTTP 成功。
 *
 * ### 外部依赖：云信群成员与推送（写完成条件不能写成「班级已更新」）
 *
 * 两条写以及「添加学员」都会落到 `pushGradeMessage`：
 *
 * - 有学员被移出时 → `zhdjClient.doPost(ADJUST_MEMBERS_FOR_STUDY, …)`（云信群调成员，
 *   `removePhoneList`）+ `zhdjClient.doPost(PUSH_GRADE_API_URL, …)`（推送消息）；
 * - `addGradeStudent` 走的是 type=1（加入）：`ADJUST_MEMBERS_FOR_STUDY` 带 `addPhoneList`，
 *   并且**只在班级有班主任且已有群 ID 时才调**；随后同样推 `PUSH_GRADE_API_URL`。
 * - 云信调用失败会抛「远程调用接口出现异常！」。
 *
 * ⚠️ 一条**实测出来的不对称**（读源码，未做运行时验证）：`addGradeOrganizationRelV2`
 * 的**新增**分支**不调云信**，只写本地组织关联与学员关联；云信只出现在**移除**分支。
 * 旧的 `addGradeOrganizationRel`(V1) 反过来：新增会带 `addPhoneList` 调云信。
 * 前端现在调用的是 V2（`organization.vue:80`，V1 那行是注释掉的），所以 SDK 只按 V2 交付。
 *
 * ### 人员候选：三处都按 conventions 第 11 条**必须先要关键字**
 *
 * 「人员候选」在 Portal 里是几千条量级。`GET /sys/user/getUserListPage` 的 `pageNo`/`pageSize`
 * 在后端是**硬校验**的（`HrSysUserServiceImpl.validatePage`：null、<1、>500 都抛），
 * `name` 是 `real_name LIKE %kw%`；而 `GET /sys/user/userNotInGrade` 与
 * `GET /study/grade/student/getExternalStudentList` **后端不限页数**，无关键字翻页 =
 * 翻全量。三处 SDK 都**拒绝无关键字调用**，并拒绝 `pageSize <= 0`（`-1` 是全量拉取）。
 * **这是 SDK 侧的策略，不是后端要求**（无关键字时后端照样返回 200，与 `searchUsers` 同款）。
 *
 * ### `GET /sys/user/userNotInGrade` 的一个后端缺陷（读源码实测）
 *
 * 它的 SQL 把「本班学员」子查询 `LEFT JOIN` 进来了，却**从没在 `WHERE` 或 `SELECT` 里用它**
 * （`SysUserDao.xml:197`）：
 *
 * ```sql
 * LEFT JOIN (SELECT distinct staff_code FROM hr_study_grade_student_rel
 *            WHERE is_del = 0 AND type != 2 AND grade_id = #{dto.gradeId}) s
 *            ON t1.username = s.staff_code
 * ```
 *
 * 结果是：这个名叫「不在该班级的用户列表」的接口**并不过滤已在班级的人**，
 * 它返回的是所有在职、组织非空的用户按姓名前缀过滤后的分页。`gradeId` 只进那条
 * 子查询，对结果集没有任何影响。
 * ⇒ SDK **原样透传这个语义，不替后端补一个本地过滤**（那会把"服务端到底给了什么"
 * 这件事藏起来）；文档与 AI 说明都点明这一点，调用方要判断"是否已在班级"必须另行核对。
 *
 * 另外两处**不同**的匹配方式，别互相照抄：
 *
 * | 端点 | `name` 的匹配 |
 * | --- | --- |
 * | `getUserListPage` | `real_name LIKE %kw%`（包含） |
 * | `userNotInGrade` | `real_name LIKE kw%`（**仅前缀**） |
 * | `getExternalStudentList` | `name LIKE %kw%` **或** `mobile LIKE %kw%`（同时匹配手机号） |
 *
 * ### 凭据形状的字段：裁剪掉，不端给 AI
 *
 * `GET /sys/user/getUserListPage` 与 `GET /sys/user/userNotInGrade` 的响应 DTO 里带
 * `password` / `password2` / `salt`。`password` 上有 `@JsonProperty(WRITE_ONLY)` 不会序列化，
 * 但 **`password2`（口令散列）与 `salt` 会真的出现在响应里**（`SysUserDTO:53-60`）。
 * 排班管理那边遇到同一个形状时的处置是**干脆不给这个能力**（`attendance-team.ts` 文件头）；
 * 这两条不能拒——它们就是本批要补的缺口——所以 SDK 采取同族的另一种处置：
 * **照常返回候选行，但把这三个键裁掉**（`withoutCredentials`，白名单式地只删这三个）。
 * 这是刻意的、可测的偏离：调用方拿不到它们，页面也不需要它们。
 */

export const STUDY_GRADE_PAGE_PATH = '/dashboard/grade/grade/list'
export const STUDY_GRADE_PERMISSION = '/dashboard/grade/grade'

/** 列表接口。同时也是**班级候选**的来源 */
export const STUDY_GRADE_LIST_PATH = '/study/grade/studygrade/page'
/** 启用/停用的第一步（真实写操作） */
export const STUDY_GRADE_UPDATE_STATUS_PATH = '/study/grade/studygrade/updateStatus'
/** 班级删除入口（批量，body 是裸 ID 数组） */
export const STUDY_GRADE_DELETE_PATH = '/study/grade/studygrade'
/** 班级详情学员关联列表（独立回查入口） */
export const STUDY_GRADE_STUDENT_LIST_PATH = '/study/grade/student'
/** 班级详情「移出学员」入口（批量，body 是班级学员关联 ID 的裸数组） */
export const STUDY_GRADE_STUDENT_DELETE_PATH = '/study/grade/student'
export const STUDY_GRADE_STUDENT_PAGE_PATH = STUDY_GRADE_PAGE_PATH
export const STUDY_GRADE_STUDENT_PERMISSION = STUDY_GRADE_PERMISSION
/** 组织结构下的隐藏「管理班级」页复用的班级删除入口 */
export const STUDY_GRADE_MANAGEMENT_CENTER_PAGE_PATH = '/dashboard/base/management-center/list'
export const STUDY_GRADE_MANAGEMENT_CENTER_PERMISSION = '/dashboard/base/management-center'
export const STUDY_GRADE_MODULE_TYPE = 12

/** 关联组织弹窗读当前已关联组织（`grade/components/organization.vue:52`） */
export const STUDY_GRADE_ORGANIZATION_PATH = '/study/grade/studygrade/getGradeOrganization'
/** 关联组织弹窗的提交口（路由 `…RelV2`，控制器方法名叫 `addGradeOrganizationRelV1`） */
export const STUDY_GRADE_ORGANIZATION_SAVE_PATH = '/study/grade/studygrade/addGradeOrganizationRelV2'
/** 关联业务弹窗读组织＋岗位结构树（`grade/components/post.vue:74`），**没有任何参数** */
export const HR_ORGANIZATION_POST_TREE_PATH = '/org/organization/getOrganizationPost'
/** 关联业务弹窗读当前已关联岗位（`grade/components/post.vue:85`） */
export const STUDY_GRADE_POST_PATH = '/study/grade/studygrade/getGradePost'
/** 关联业务弹窗按岗位取在职员工（`grade/components/post.vue:118`），**POST 但只读** */
export const HR_STAFF_BY_POST_ID_PATH = '/org/staff/getStaffListByPostId'
/** 关联业务弹窗的提交口（`grade/components/post.vue:157`） */
export const STUDY_GRADE_POST_SAVE_PATH = '/study/grade/studygrade/addGradePostRel'
/** 班级表单的人员分页候选（`grade/[mode]/[id].vue:74` / `:84`） */
export const SYS_USER_LIST_PAGE_PATH = '/sys/user/getUserListPage'
/** 添加学员弹窗的「内部学员」候选（`grade/student/[id]/components/add-student.vue:154`） */
export const SYS_USER_NOT_IN_GRADE_PATH = '/sys/user/userNotInGrade'
/** 添加学员弹窗的「外部学员」候选（同文件 `:235`） */
export const STUDY_GRADE_EXTERNAL_STUDENT_PATH = '/study/grade/student/getExternalStudentList'
/** 添加学员弹窗的提交口（同文件 `:367`） */
export const STUDY_GRADE_STUDENT_SAVE_PATH = '/study/grade/student/addGradeStudent'

/**
 * 这批能力的页面归属。
 *
 * 班级列表的三个弹窗与学员子页都没有自己的菜单权限，只能由列表行进入；组织结构下的
 * 隐藏班级子页另有自己的页面上下文，不能复用这里的权限。
 */
const HIDDEN_SURFACE = {
  pagePath: STUDY_GRADE_PAGE_PATH,
  permission: STUDY_GRADE_PERMISSION,
  moduleType: STUDY_GRADE_MODULE_TYPE,
  httpInstance: 'platform',
} as const

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

/**
 * 「添加学员」弹窗里两张候选表的每页条数。页面写死 `pageSize: 5`
 * （`add-student.vue:159` 与 `:239`）。
 */
export const CANDIDATE_TABLE_PAGE_SIZE = 5

/**
 * 班级表单的人员下拉每页条数。
 *
 * ⚠️ 与上面的 5 **不是同一个数**：那两个下拉走 `usePagedUserOptions`，
 * 它的 `DEFAULT_PAGE_SIZE = 20`（`app/portal/utils/user/use-paged-user-options.js:4`），
 * 组件没有把 pageSize 传进来，所以 `fetchStudentPage` 每次收到的是 20。
 * 照抄「候选一律 5 条」会让默认请求与页面不一致。
 */
export const CANDIDATE_DROPDOWN_PAGE_SIZE = 20

/**
 * 人员候选的单页上限。
 *
 * 两个 `/sys/user/*` 端点里，`getUserListPage` 后端**硬校验** `pageSize ∈ [1, 500]`
 * （`HrSysUserServiceImpl.validatePage`），所以 500 是后端的真实边界；
 * `userNotInGrade` / `getExternalStudentList` 后端不限，这里沿用同一个数，
 * 让「一页最多 500」在所有人员候选上一致。
 */
export const MAX_PERSON_PAGE_SIZE = 500

/** 响应里**必须裁掉**的三个键（`SysUserDTO` 的口令散列与盐，见文件头） */
const CREDENTIAL_KEYS = ['password', 'password2', 'salt'] as const

/**
 * 页面自己给班级下拉用的每页条数（`pageSize=99999`）。
 *
 * ⚠️ **本能力不提供这个用法** —— 列在这里是为了让读代码的人知道
 * 「别处的 99999 是从哪来的」，以及为什么这里不照抄（设计 D6 / H35）。
 * 要候选请用 `searchByKeyword`。
 */
export const PAGE_GRADE_ALL_PAGE_SIZE = 99999

export type PageResult<T> = { list: T[]; total: number }

/** 班级列表行（字段取自页面 `columns`，其余原样透传） */
export type StudyGradeRow = {
  id: string
  /** 编号（页面上那一列叫「编号」） */
  serialNumber?: string
  /** 班级名称 */
  name?: string
  /** 状态。页面行尾的「启用/停用」按 `status === 0` 判断方向 */
  status?: number
  type?: number
  /** 学员数 */
  studentNum?: number
  teacherName?: string
  teachingAssistantName?: string
  /** 归属组织 id */
  orgId?: number
  [key: string]: unknown
}

export type StudyGradeQuery = {
  /** 班级名称（模糊匹配） */
  name?: string
  /** 班级类型。页面上是下拉，**取值域未实测**（基准里是空串）—— 只透传、不给枚举 */
  type?: number | string
  /** 学员数下限 */
  studentNumMin?: number | string
  /** 学员数上限 */
  studentNumMax?: number | string
  /** 讲师姓名（模糊，不是 id） */
  teacherName?: string
  /** 助教姓名（模糊，不是 id） */
  teachingAssistantName?: string
  /**
   * 归属组织 id。候选来源：`base-dept-*`（部门树）或
   * `GET /org/organization/getRoleOrganizationTree`（页面用的那个，按角色变）。
   * **先问用户要关键字**再取候选，不要猜 id。
   */
  orgId?: number
  pageNo?: number
  pageSize?: number
}

export type StudyGradeStudentQuery = {
  gradeId: StudyGradeId
  name?: string
  mobile?: string | number
  staffCode?: string | number
  isRelatedLayer?: number | string
  createTimeStart?: string
  createTimeEnd?: string
}

export type StudyGradeManagementCenterQuery = {
  managementCenterId: StudyGradeId
  name?: string
  type?: number | string
  createTimeStart?: string
  createTimeEnd?: string
  pageNo?: number
  pageSize?: number
}

const STUDENT_LIST_ORDER = ['gradeId', 'name', 'mobile', 'staffCode', 'isRelatedLayer', 'createTimeStart', 'createTimeEnd'] as const
const MANAGEMENT_CENTER_LIST_ORDER = ['order', 'orderField', 'managementCenterId', 'name', 'type', 'createTimeStart', 'createTimeEnd', 'pageNo', 'pageSize'] as const

/**
 * 这一页的参数顺序 —— **顺序即 qs 序列化后的顺序**，是契约不是默认值表（D20）。
 * 依据是浏览器实测的那条 URL（见文件头）。
 */
const LIST_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'name', defaultValue: '' },
  { name: 'type', defaultValue: '' },
  { name: 'studentNumMin', defaultValue: '' },
  { name: 'studentNumMax', defaultValue: '' },
  { name: 'teacherName', defaultValue: '' },
  { name: 'teachingAssistantName', defaultValue: '' },
  { name: 'orgId', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/** 按契约里的**固定顺序**拼参数：调用方的实参顺序不影响 qs 序列化结果（D20） */
function buildParams (
  query: Record<string, unknown>,
  override: Record<string, unknown> = {},
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const item of LIST_ORDER) {
    if (Object.prototype.hasOwnProperty.call(override, item.name)) {
      params[item.name] = override[item.name]
      continue
    }
    const value = query[item.name]
    params[item.name] = value === undefined ? item.defaultValue : value
  }
  return params
}

const LIST_PARAMS: ParamSpec[] = [
  { name: 'name', kind: 'text', required: false, description: '班级名称（模糊匹配）' },
  {
    name: 'type',
    kind: 'text',
    required: false,
    description: '班级类型。页面是下拉但**取值域没有实测过**，这里只透传、不给枚举',
  },
  { name: 'studentNumMin', kind: 'number', required: false, description: '学员数下限' },
  { name: 'studentNumMax', kind: 'number', required: false, description: '学员数上限' },
  { name: 'teacherName', kind: 'text', required: false, description: '讲师姓名（模糊匹配，不是 id）' },
  { name: 'teachingAssistantName', kind: 'text', required: false, description: '助教姓名（模糊匹配，不是 id）' },
  {
    name: 'orgId',
    kind: 'tree',
    required: false,
    description: '归属组织 id。**先问用户关键字**再取候选（页面用的是按角色变的组织树），不要猜 id',
    lookup: { capabilityId: 'base-dept-search', keywordParam: 'keyword' },
  },
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

export type StudyGradeId = number | string

function parseIds (value: unknown, label: string): StudyGradeId[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label}必须是非空数组`)
  }
  return value.map((id) => {
    if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) return id
    if (typeof id === 'string' && /^[1-9]\d*$/.test(id)) return id
    throw new Error(`${label}只能包含正整数 ID`)
  })
}

const GRADE_IDS_PARAMS: ParamSpec[] = [
  {
    name: 'ids',
    kind: 'array',
    required: true,
    description: '要删除的班级 ID 非空数组；不能传组织 ID 或对象数组',
  },
]

const GRADE_STUDENT_IDS_PARAMS: ParamSpec[] = [
  {
    name: 'ids',
    kind: 'array',
    required: true,
    description: '班级学员关联记录 ID 非空数组；不是学员主表 ID、staffCode 或对象数组',
  },
]

function prepareIds (value: { ids: StudyGradeId[] }, label: string): { ids: StudyGradeId[] } {
  return { ids: parseIds(value?.ids, label) }
}

/* =====================================================================
 * 弹窗与隐藏子页：类型
 * ===================================================================== */

/**
 * `getGradeOrganization` 的行。
 *
 * SQL 只 `select distinct t3.name, t3.code, t3.id`（`StudyGradeOrganizationRelDao.xml`），
 * 所以只有这三个字段有值。`id` 是 **`hr_organization.id`**，与
 * `addGradeOrganizationRelV2` 收的 `organizationIdList` **同一个 ID 空间**；
 * `code` 是 `hr_organization.code`（关联表里那一列叫 `organization_code`）。
 */
export type StudyOrganizationRow = {
  id?: StudyGradeId
  code?: string | null
  name?: string | null
  [key: string]: unknown
}

/**
 * `getGradePost` 的行。
 *
 * ⚠️ 这里的 `id` 是 **`hr_post.id`（岗位 id）**，SQL 写的是 `t3.id as id`。
 * 它**不是** `getOrganizationPost` 树里岗位节点的 `id` —— 那个是
 * `Long.valueOf(organizationId + "" + postId)` 拼出来的合成 id，真实岗位 id 在那个节点的
 * `postId` 上。`addGradePostRel` 收的是**这一个** id。
 */
export type StudyPostRow = {
  id?: StudyGradeId
  name?: string | null
  [key: string]: unknown
}

/**
 * `getOrganizationPost` 树的节点（组织节点与岗位节点共用一层结构，按 `postId` 区分）。
 *
 * | 节点 | `id` | `postId` | `orgPostId` | `pid` |
 * | --- | --- | --- | --- | --- |
 * | 组织 | `hr_organization.id` | `null` | `null` | 父组织 id |
 * | 岗位 | `organizationId + '' + postId` 拼成的**合成 id** | `hr_post.id` | `hr_organization_post.id` | 所属组织 id |
 *
 * 页面把无 `postId` 的节点置成 `disabled`（`post.vue:177`），所以可选中的只有岗位节点，
 * 提交的是节点的 **`postId`**，不是节点的 `id`。
 */
export type StudyPostTreeNode = {
  id?: StudyGradeId
  postId?: StudyGradeId | null
  organizationId?: StudyGradeId | null
  orgPostId?: StudyGradeId | null
  name?: string | null
  pid?: StudyGradeId | null
  children?: StudyPostTreeNode[]
  [key: string]: unknown
}

/**
 * `getStaffListByPostId` 的行（`HrStaffDTO`）。
 *
 * SQL 过滤是 `post in (…) and is_del = 0 and status in (1, 4, 5)`
 * （`HrStaffDao.xml:882`，`EMPLOYED_STAFF` = 在职/试用等三个状态码），
 * 页面只取 `{ id, name }` 两个字段。
 */
export type StudyStaffRow = {
  id?: StudyGradeId
  name?: string | null
  /** 工号 */
  staffCode?: StudyGradeId | null
  /** 岗位 id；不是岗位名 */
  post?: StudyGradeId | null
  status?: number | null
  mobile?: StudyGradeId | null
  [key: string]: unknown
}

/**
 * `getUserListPage` / `userNotInGrade` 的行（`SysUserDTO` 的裁剪结果）。
 *
 * 页面用法（两张候选表都只有三列）：`name ← realName`、`staffCode ← username`、
 * `organizationName`。`username` **是工号字符串**，班级表单里 班主任/班长/助教
 * 存的也是它（`portal-education-dropdown-student` 的 `normalizeItem`：有 `fetchPage`
 * 时 `value = item.username`）。
 *
 * ⚠️ 两个端点填的字段**不一样**：`userNotInGrade` 的 SQL 有
 * `hro.full_path as organizationName`，而 `getUserListPage` 走 MyBatis-Plus 实体查询后
 * `ConvertUtils` 转换，`SysUserEntity` 上**没有** `organizationName` 这一列 ⇒
 * `getUserListPage` 回的 `organizationName` 恒为 `null`。
 */
export type StudyUserCandidateRow = {
  id?: StudyGradeId
  /** 工号（`hr_sys_user.username`），不是用户 id */
  username?: string | null
  /** 姓名 */
  realName?: string | null
  mobile?: string | null
  organizationId?: StudyGradeId | null
  /** 组织全路径。**只有 `userNotInGrade` 会填**；`getUserListPage` 恒为 null */
  organizationName?: string | null
  status?: number | null
  postId?: StudyGradeId | null
  [key: string]: unknown
}

/**
 * `getExternalStudentList` 的行（`StudyStudentDTO`，外部学员主表 `hr_study_student`）。
 *
 * SQL 的 select 列表里**没有** `organization_id` / `organization_name`，所以这两个
 * 字段在这条响应上恒为 null；有值的是 `staffCode`（工号）、`name`、`mobile`、
 * `isRelatedClass`、`isRelatedLayer` 与 `createTime`。页面表格只显示 姓名 / 手机号。
 * 服务端**无条件**把 `isStaff` 置 0（`StudyStudentServiceImpl.pageExternalStudent`），
 * 所以这条只可能返回外部学员，调用方无法从这个参数改范围。
 */
export type StudyExternalStudentRow = {
  id?: StudyGradeId
  /** 工号；外部学员的工号可能是页面手填的文本 */
  staffCode?: StudyGradeId | null
  name?: string | null
  /** 手机号。DTO 里是 `Long`，JSON 里是数字 */
  mobile?: StudyGradeId | null
  /** 是否已关联班级：0 否、1 是 */
  isRelatedClass?: number | null
  /** 是否已关联智慧蛋鸡账号：0 否、1 是 */
  isRelatedLayer?: number | null
  isCreateManually?: number | null
  organizationCode?: StudyGradeId | null
  isDel?: number | null
  createTime?: string | null
  [key: string]: unknown
}

/** 关联组织的提交体，也就是 Portal 的 `StudyGradeOrganizationRelDTO` */
export type StudyGradeOrganizationDraft = { gradeId: StudyGradeId; organizationIdList: StudyGradeId[] }
/** 关联业务的提交体，**同一个 DTO 类**、另一个字段 */
export type StudyGradePostDraft = { gradeId: StudyGradeId; postIdList: StudyGradeId[] }
/** 添加学员的提交体（`AddStudentDTO`），`staffCodeList` 是**工号**列表 */
export type StudyGradeStudentDraft = { gradeId: StudyGradeId; staffCodeList: StudyGradeId[] }

/* =====================================================================
 * 弹窗与隐藏子页：参数与本地校验
 * ===================================================================== */

/** 按契约里的**固定顺序**拼参数（新端点各自有一张顺序表，见各能力注释） */
function orderedParams (
  order: readonly string[],
  query: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const name of order) {
    const value = query[name]
    if (value === undefined) continue
    params[name] = value
  }
  return params
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): StudyGradeId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数 ID`)
}

function statusDraftOf (value: unknown): { id: StudyGradeId; status: 0 | 1 } {
  const draft = objectOf(value, '状态草稿')
  if (draft.status !== 0 && draft.status !== 1) throw new Error('状态草稿.status只能是0或1')
  return {
    id: idOf(draft.id, '状态草稿.id'),
    status: draft.status,
  }
}

function assertReadbackTimeRange (query: { createTimeStart?: string; createTimeEnd?: string }): void {
  const start = query.createTimeStart ?? ''
  const end = query.createTimeEnd ?? ''
  if ((start === '') !== (end === '')) throw new Error('创建时间起止必须成对给出')
  if (start !== '' && (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(end) || end < start)) throw new Error('创建时间必须为YYYY-MM-DD HH:mm:ss，结束时间不早于开始时间')
}

/** 非空去重 ID 数组。去重是**本地的**：重复项对服务端是同一个集合，去掉不改变语义。 */
function idListOf (value: unknown, label: string): StudyGradeId[] {
  const ids = parseIds(value, label)
  const seen = new Set<string>()
  const unique: StudyGradeId[] = []
  for (const id of ids) {
    const key = String(id)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(id)
  }
  return unique
}

/**
 * 人员候选的**必填关键字**。
 *
 * SDK 侧的策略，不是后端要求：三个人员候选端点在无关键字时都能返回 200，
 * 但那是「全公司的人」（conventions 第 11 条 / D6 / H35）。与
 * `base-shell.searchUsers()`、`study-grade-search` 同一条规则。
 */
function keywordOf (value: unknown, label: string): string {
  const keyword = typeof value === 'string' ? value.trim() : ''
  if (keyword === '') {
    throw new Error(
      `${label}属于长选项参数：必须提供 keyword，不允许无条件下全量拉取（设计 D6 / H35）。` +
        '后端在无关键字时不会报错，返回的是全部人员。用户说不出完整名字时，先问他名字里的一两个字。',
    )
  }
  return keyword
}

/** 页码：正整数，默认 1 */
function pageNoOf (value: unknown, label: string): number {
  if (value === undefined || value === null || value === '') return 1
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label}必须为正整数`)
  }
  return value
}

/**
 * 每页条数。
 *
 * `-1`（以及任何 ≤0）**单独拒绝**而不是截断 —— 那是「全量拉取」，静默截断会让调用方
 * 以为自己拿到了全部（与 `base-shell.assertNotFullPull` 同款）。
 * 超过上限也拒绝：`getUserListPage` 的后端本来就会抛（`validatePage` 上限 500），
 * 在本地先拦能省一次注定失败的请求。
 */
function pageSizeOf (value: unknown, label: string, fallback: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数`)
  if (value < 1) {
    throw new Error(`${label}必须 ≥ 1；-1 或 0 是"全量拉取"，SDK 不接受（设计 D6）`)
  }
  if (value > max) throw new Error(`${label}最多 ${max}（本接口单页上限）`)
  return value
}

/** 裁掉 `SysUserDTO` 上的口令散列与盐（见文件头「凭据形状的字段」） */
function withoutCredentials<T extends Record<string, unknown>> (row: T): T {
  const copy = { ...row }
  for (const key of CREDENTIAL_KEYS) delete copy[key]
  return copy
}

function candidatePageOf (value: unknown): PageResult<StudyUserCandidateRow> {
  const page = objectOf(value, '人员候选分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total)) {
    throw new Error('人员候选分页响应缺少有效 list 或 total')
  }
  return {
    list: page.list.map((row, index) => withoutCredentials(objectOf(row, `人员候选[${index}]`)) as StudyUserCandidateRow),
    total: page.total as number,
  }
}

function listOf<T> (value: unknown, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${label}响应不是数组`)
  return value as T[]
}

/* =====================================================================
 * 弹窗与隐藏子页：参数声明
 * ===================================================================== */

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({
  name,
  kind,
  required,
  description,
})

const GRADE_ID_PARAM = p(
  'gradeId',
  'text',
  true,
  '班级 ID（`hr_study_grade.id`）。来自班级列表行的 `id`，不是班级名称或编号',
)

const ORGANIZATION_IDS_PARAM = p(
  'organizationIdList',
  'array',
  true,
  '目标组织 ID **全集**（`hr_organization.id`，与 getGradeOrganization 返回的 id 同一空间）。' +
    '不是增量：后端会移除"之前关联过、这次不在列表里"的组织，连同它们名下的班级学员。' +
    '候选来自 hr-organization-setting-post-tree 的组织节点，或用户直接给的已知 id',
)

const POST_IDS_PARAM = p(
  'postIdList',
  'array',
  true,
  '目标岗位 ID **全集**（`hr_post.id`）。不是 getOrganizationPost 树节点的合成 id，' +
    '也不是岗位名；本页的候选来自 study-grade-post-list 或树节点的 postId。' +
    '后端会移除"之前关联过、这次不在列表里"的岗位，连同它们名下的班级学员',
)

const STAFF_CODE_LIST_PARAM = p(
  'staffCodeList',
  'array',
  true,
  '待加入班级的**工号**全集（内部人员取 `username`、外部学员取 `staffCode`）。不是用户 id、' +
    '不是班级学员关联记录 id。候选人来自 study-grade-staff-search 或 ' +
    'study-grade-external-student-list',
)

const candidatePageParams = (fallback: number): ParamSpec[] => [
  p('pageNo', 'number', false, '页码，从 1 开始；默认 1'),
  p('pageSize', 'number', false, `每页条数；默认 ${fallback}（与页面一致），上限 ${MAX_PERSON_PAGE_SIZE}`),
]

const DRAFT_PARAM = (label: string): ParamSpec =>
  p('draft', 'text', true, `对应 prepare 能力返回的${label}草稿；只提交 SDK 生成的字段，不要自行追加服务端 DTO 字段`)

const USER_CANDIDATE_PARAMS: ParamSpec[] = [
  p(
    'keyword',
    'text',
    true,
    '人员姓名关键字。**必填**：人员候选在 Portal 里是几千条，无关键字时后端照样返回 200 但那是全部人员' +
      '（conventions 第 11 条 / D6）。SDK 侧拒绝无关键字调用；用户说不出完整名字时先问他名字里的一两个字',
  ),
  ...candidatePageParams(CANDIDATE_DROPDOWN_PAGE_SIZE),
]

const GRADE_USER_CANDIDATE_PARAMS: ParamSpec[] = [GRADE_ID_PARAM, ...USER_CANDIDATE_PARAMS]

export const studyGradeCapabilities: CapabilityDefinition[] = [
  {
    id: 'study-grade-list',
    title: '查询班级列表',
    pagePath: STUDY_GRADE_PAGE_PATH,
    permission: STUDY_GRADE_PERMISSION,
    write: false,
    params: LIST_PARAMS,
  },
  {
    id: 'study-grade-search',
    title: '按关键字查班级（长选项参数的候选入口）',
    pagePath: STUDY_GRADE_PAGE_PATH,
    permission: STUDY_GRADE_PERMISSION,
    write: false,
    params: [
      {
        name: 'keyword',
        kind: 'text',
        required: true,
        description:
          '班级名称的关键字。**必填**：页面为了让下拉能搜，挂载时一次拉 99999 条全部班级，' +
          '无头不能照抄（设计 D6 / H35）。用户说不出完整名字时，先问他名字里的一两个字。',
      },
      { name: 'limit', kind: 'number', required: false, description: '最多返回几条，默认 20' },
    ],
  },
  {
    id: 'study-grade-status-prepare',
    title: '准备启停班级',
    pagePath: STUDY_GRADE_PAGE_PATH,
    permission: STUDY_GRADE_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: false,
    params: [
      { name: 'id', kind: 'text', required: true, description: '班级列表行 ID' },
      { name: 'currentStatus', kind: 'number', required: true, description: '当前状态，只接受 0 或 1' },
    ],
  },
  {
    id: 'study-grade-status-check',
    title: '执行班级启停第一步',
    pagePath: STUDY_GRADE_PAGE_PATH,
    permission: STUDY_GRADE_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: true,
    params: [{ name: 'draft', kind: 'text', required: true, description: 'study-grade-status-prepare 返回的状态草稿' }],
  },
  {
    id: 'study-grade-status-submit',
    title: '提交班级启停第二步',
    pagePath: STUDY_GRADE_PAGE_PATH,
    permission: STUDY_GRADE_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: true,
    params: [{ name: 'draft', kind: 'text', required: true, description: '同一次 check 返回的状态草稿' }],
  },
  {
    id: 'study-grade-status-cancel',
    title: '取消班级启停',
    pagePath: STUDY_GRADE_PAGE_PATH,
    permission: STUDY_GRADE_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: false,
    params: [],
  },
  {
    id: 'study-grade-student-list',
    title: '查询班级学员关联',
    pagePath: STUDY_GRADE_STUDENT_PAGE_PATH,
    permission: STUDY_GRADE_STUDENT_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: false,
    params: [
      { name: 'gradeId', kind: 'text', required: true, description: '班级 ID' },
      ...['name', 'mobile', 'staffCode', 'isRelatedLayer'].map(name => ({ name, kind: 'text' as const, required: false, description: '班级学员子页同名筛选条件；未给时发空串' })),
      ...['createTimeStart', 'createTimeEnd'].map(name => ({ name, kind: 'date' as const, required: false, description: '创建时间范围；结束时间为所选结束日加一天的零点，需成对给出' })),
    ],
  },
  {
    id: 'study-grade-management-center-list',
    title: '查询组织结构下班级',
    pagePath: STUDY_GRADE_MANAGEMENT_CENTER_PAGE_PATH,
    permission: STUDY_GRADE_MANAGEMENT_CENTER_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: false,
    params: [
      { name: 'managementCenterId', kind: 'text', required: true, description: '学习组织结构 ID' },
      { name: 'name', kind: 'text', required: false, description: '班级名称模糊筛选' },
      { name: 'type', kind: 'text', required: false, description: '班级类型原码' },
      ...['createTimeStart', 'createTimeEnd'].map(name => ({ name, kind: 'date' as const, required: false, description: '创建时间范围；结束时间为所选结束日加一天的零点，需成对给出' })),
      ...candidatePageParams(DEFAULT_PAGE_SIZE),
    ],
  },
  {
    id: 'study-grade-prepare-remove',
    title: '准备删除班级',
    pagePath: STUDY_GRADE_PAGE_PATH,
    permission: STUDY_GRADE_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: false,
    params: GRADE_IDS_PARAMS,
  },
  {
    id: 'study-grade-remove',
    title: '删除班级',
    pagePath: STUDY_GRADE_PAGE_PATH,
    permission: STUDY_GRADE_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: true,
    params: GRADE_IDS_PARAMS,
  },
  {
    id: 'study-grade-cancel-remove',
    title: '取消删除班级',
    pagePath: STUDY_GRADE_PAGE_PATH,
    permission: STUDY_GRADE_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    write: false,
    params: [],
  },
  {
    id: 'study-grade-student-prepare-remove',
    title: '准备从班级移出学员',
    pagePath: STUDY_GRADE_STUDENT_PAGE_PATH,
    permission: STUDY_GRADE_STUDENT_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: false,
    params: GRADE_STUDENT_IDS_PARAMS,
  },
  {
    id: 'study-grade-student-remove',
    title: '从班级移出学员',
    pagePath: STUDY_GRADE_STUDENT_PAGE_PATH,
    permission: STUDY_GRADE_STUDENT_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: true,
    params: GRADE_STUDENT_IDS_PARAMS,
  },
  {
    id: 'study-grade-student-cancel-remove',
    title: '取消从班级移出学员',
    pagePath: STUDY_GRADE_STUDENT_PAGE_PATH,
    permission: STUDY_GRADE_STUDENT_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: false,
    params: [],
  },
  {
    id: 'study-grade-management-center-prepare-remove',
    title: '准备从组织结构删除班级',
    pagePath: STUDY_GRADE_MANAGEMENT_CENTER_PAGE_PATH,
    permission: STUDY_GRADE_MANAGEMENT_CENTER_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: false,
    params: GRADE_IDS_PARAMS,
  },
  {
    id: 'study-grade-management-center-remove',
    title: '从组织结构删除班级',
    pagePath: STUDY_GRADE_MANAGEMENT_CENTER_PAGE_PATH,
    permission: STUDY_GRADE_MANAGEMENT_CENTER_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: true,
    params: GRADE_IDS_PARAMS,
  },
  {
    id: 'study-grade-management-center-cancel-remove',
    title: '取消从组织结构删除班级',
    pagePath: STUDY_GRADE_MANAGEMENT_CENTER_PAGE_PATH,
    permission: STUDY_GRADE_MANAGEMENT_CENTER_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: false,
    params: [],
  },

  // ---- 弹窗与隐藏子页（见文件头「弹窗与隐藏子页」） ----

  {
    id: 'study-grade-staff-search',
    title: '按关键字查人员（班级表单的人员候选入口）',
    ...HIDDEN_SURFACE,
    write: false,
    params: USER_CANDIDATE_PARAMS,
  },
  {
    id: 'study-grade-staff-resolve',
    title: '按工号回显人员（班级表单已选讲师的姓名）',
    ...HIDDEN_SURFACE,
    write: false,
    params: [
      p(
        'usernames',
        'array',
        true,
        '工号数组（`username`，精确匹配）。用于把班级表单里已保存的班主任/班长/助教工号换回姓名；' +
          '不是用户 id、不是姓名。未知工号会在返回的 missing 里列出',
      ),
    ],
  },
  {
    id: 'study-grade-organization-list',
    title: '查询班级已关联组织',
    ...HIDDEN_SURFACE,
    write: false,
    params: [GRADE_ID_PARAM],
  },
  {
    id: 'study-grade-add-organization-prepare',
    title: '准备关联组织',
    ...HIDDEN_SURFACE,
    write: false,
    params: [GRADE_ID_PARAM, ORGANIZATION_IDS_PARAM],
  },
  {
    id: 'study-grade-add-organization-rel',
    title: '保存班级关联组织',
    ...HIDDEN_SURFACE,
    write: true,
    params: [DRAFT_PARAM('关联组织')],
  },
  {
    id: 'study-grade-add-organization-cancel',
    title: '取消关联组织',
    ...HIDDEN_SURFACE,
    write: false,
    params: [],
  },
  {
    id: 'hr-organization-setting-post-tree',
    title: '查询组织与岗位结构树',
    ...HIDDEN_SURFACE,
    write: false,
    // 后端 `getOrganizationPost()` 不收任何参数；关键字过滤只能在本地做（见 AI 说明）
    params: [],
  },
  {
    id: 'study-grade-post-list',
    title: '查询班级已关联岗位',
    ...HIDDEN_SURFACE,
    write: false,
    params: [GRADE_ID_PARAM],
  },
  {
    id: 'study-grade-post-staff-list',
    title: '按岗位查询在职员工',
    ...HIDDEN_SURFACE,
    write: false,
    params: [
      p(
        'postIdList',
        'array',
        true,
        '岗位 ID 非空数组（`hr_post.id`）；不是树节点的合成 id。页面在空数组时根本不发请求',
      ),
    ],
  },
  {
    id: 'study-grade-post-add-prepare',
    title: '准备关联业务（岗位）',
    ...HIDDEN_SURFACE,
    write: false,
    params: [GRADE_ID_PARAM, POST_IDS_PARAM],
  },
  {
    id: 'study-grade-post-add',
    title: '保存班级关联业务（岗位）',
    ...HIDDEN_SURFACE,
    write: true,
    params: [DRAFT_PARAM('关联业务')],
  },
  {
    id: 'study-grade-post-add-cancel',
    title: '取消关联业务（岗位）',
    ...HIDDEN_SURFACE,
    write: false,
    params: [],
  },
  {
    id: 'study-grade-student-candidate',
    title: '查询可加入班级的内部人员候选',
    ...HIDDEN_SURFACE,
    write: false,
    params: GRADE_USER_CANDIDATE_PARAMS,
  },
  {
    id: 'study-grade-external-student-list',
    title: '查询外部学员候选',
    ...HIDDEN_SURFACE,
    write: false,
    params: [
      p(
        'keyword',
        'text',
        true,
        '姓名或手机号关键字。**必填**（人员候选一律先要关键字，conventions 第 11 条）。' +
          '后端把它同时拿去匹配 `name` 与 `mobile`（都是包含匹配），所以传手机号片段也有效',
      ),
      ...candidatePageParams(CANDIDATE_TABLE_PAGE_SIZE),
    ],
  },
  {
    id: 'study-grade-student-create-prepare',
    title: '准备添加学员',
    ...HIDDEN_SURFACE,
    write: false,
    params: [GRADE_ID_PARAM, STAFF_CODE_LIST_PARAM],
  },
  {
    id: 'study-grade-student-create',
    title: '添加学员入班',
    ...HIDDEN_SURFACE,
    write: true,
    params: [DRAFT_PARAM('添加学员')],
  },
  {
    id: 'study-grade-student-create-cancel',
    title: '取消添加学员',
    ...HIDDEN_SURFACE,
    write: false,
    params: [],
  },
]

/** 页面能力 ID 与 SDK 方法名的固定映射；供目录和统一调用入口复用。 */
export const STUDY_GRADE_METHODS = {
  'study-grade-list': 'list',
  'study-grade-search': 'searchByKeyword',
  'study-grade-status-prepare': 'prepareStatus',
  'study-grade-status-check': 'checkStatus',
  'study-grade-status-submit': 'submitStatus',
  'study-grade-status-cancel': 'cancelStatus',
  'study-grade-student-list': 'listStudents',
  'study-grade-management-center-list': 'listManagementCenterGrades',
  'study-grade-prepare-remove': 'prepareRemove',
  'study-grade-remove': 'remove',
  'study-grade-cancel-remove': 'cancelRemove',
  'study-grade-student-prepare-remove': 'prepareRemoveStudents',
  'study-grade-student-remove': 'removeStudents',
  'study-grade-student-cancel-remove': 'cancelRemoveStudents',
  'study-grade-management-center-prepare-remove': 'prepareRemoveManagementCenterGrades',
  'study-grade-management-center-remove': 'removeManagementCenterGrades',
  'study-grade-management-center-cancel-remove': 'cancelRemoveManagementCenterGrades',
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

/**
 * 能力实现。`request` 由 SDK 门面注入，已经带好页面上下文
 * （module-type 走 `/dashboard/grade/grade/list` 的推导结果 = 12 学习管理）。
 */
export function createStudyGradeCapability (request: PortalRequest, requestManagementCenter: PortalRequest = request) {
  return {
    /** 分页查询班级列表。只读 */
    list (query: StudyGradeQuery = {}): Promise<PageResult<StudyGradeRow>> {
      return request<PageResult<StudyGradeRow>>({
        url: STUDY_GRADE_LIST_PATH,
        method: 'get',
        params: buildParams(query as Record<string, unknown>),
      })
    },

    /**
     * 按关键字查班级（只读）。**这是给"班级候选"用的入口**，不是列表页的替代。
     *
     * 为什么要关键字：页面为了让下拉能本地搜，挂载时发的是
     * `pageSize=99999` 一次拉全量；无头照着发会把整个班级表冲进调用方的上下文
     * （设计 D6 / H35）。这里强制要关键字，并且**在本地再过滤一次**（后端的 `name`
     * 是模糊匹配，但本地过滤能保证"关键字真的出现在结果里"这件事可预期），
     * 最后按 `limit` 截断。
     *
     * ⚠️ `matched` 是**过滤后**的条数、`total` 是后端报的总数 —— 两者不同名是有意的：
     * 调用方需要知道"后端一共多少、我拿到多少"，好判断要不要让用户再收窄关键字。
     */
    async searchByKeyword (
      query: { keyword: string; limit?: number },
    ): Promise<{ list: StudyGradeRow[]; total: number; matched: number }> {
      const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : ''
      if (keyword.length === 0) {
        throw new Error(
          '班级属于长选项参数：必须提供 keyword，不允许无条件下全量拉取（设计 D6 / H35）。' +
            '用户说不出完整名字时，先问他名字里的一两个字。',
        )
      }
      const limit = query.limit === undefined ? 20 : query.limit
      const page = await request<PageResult<StudyGradeRow>>({
        url: STUDY_GRADE_LIST_PATH,
        method: 'get',
        params: buildParams({ name: keyword }, { pageNo: 1, pageSize: limit }),
      })
      const lowered = keyword.toLowerCase()
      const matched = (page.list ?? []).filter((row) =>
        String(row.name ?? '').toLowerCase().includes(lowered),
      )
      return { list: matched, total: page.total, matched: matched.length }
    },

    prepareStatus (input: { id: StudyGradeId; currentStatus: number }): { draft: { id: StudyGradeId; status: 0 | 1 } } {
      const id = idOf(input?.id, '班级 ID')
      if (input?.currentStatus !== 0 && input?.currentStatus !== 1) throw new Error('班级当前状态只能是0或1')
      return { draft: { id, status: input.currentStatus === 0 ? 1 : 0 } }
    },

    async checkStatus (input: { draft: { id: StudyGradeId; status: 0 | 1 } }): Promise<{ draft: { id: StudyGradeId; status: 0 | 1 }; message: string | null }> {
      const draft = statusDraftOf(input?.draft)
      const result = await request<unknown>({ url: STUDY_GRADE_UPDATE_STATUS_PATH, method: 'put', data: draft })
      if (result === undefined || result === null || result === '') return { draft, message: null }
      if (typeof result !== 'string') throw new Error('班级启停第一步响应不是确认提示文本')
      return { draft, message: result }
    },

    async submitStatus (input: { draft: { id: StudyGradeId; status: 0 | 1 } }): Promise<void> {
      const draft = statusDraftOf(input?.draft)
      await request({ url: STUDY_GRADE_DELETE_PATH, method: 'put', data: draft })
    },

    cancelStatus (): { cancelled: true } { return { cancelled: true } },

    async listStudents (query: StudyGradeStudentQuery): Promise<Record<string, unknown>[]> {
      const gradeId = idOf(query?.gradeId, '班级 ID')
      assertReadbackTimeRange(query)
      const params: Record<string, unknown> = { order: '', orderField: '' }
      for (const name of STUDENT_LIST_ORDER) params[name] = name === 'gradeId' ? gradeId : (query as Record<string, unknown>)[name] ?? ''
      const result = await request<unknown>({ url: STUDY_GRADE_STUDENT_LIST_PATH, method: 'get', params })
      if (!Array.isArray(result)) throw new Error('班级学员关联响应必须是数组，不能将形状错误当作移出成功')
      return result.map((row, index) => objectOf(row, `班级学员关联[${index}]`))
    },

    async listManagementCenterGrades (query: StudyGradeManagementCenterQuery): Promise<PageResult<StudyGradeRow>> {
      const managementCenterId = idOf(query?.managementCenterId, '组织结构 ID')
      assertReadbackTimeRange(query)
      const source = query as Record<string, unknown>
      const params: Record<string, unknown> = { order: '', orderField: '' }
      for (const name of MANAGEMENT_CENTER_LIST_ORDER.slice(2)) params[name] = name === 'managementCenterId' ? managementCenterId : source[name] ?? (name === 'pageNo' ? 1 : name === 'pageSize' ? DEFAULT_PAGE_SIZE : '')
      params.pageNo = pageNoOf(query.pageNo, '组织结构班级 pageNo')
      params.pageSize = pageSizeOf(query.pageSize, '组织结构班级 pageSize', DEFAULT_PAGE_SIZE, MAX_PERSON_PAGE_SIZE)
      const result = objectOf(await requestManagementCenter<unknown>({ url: STUDY_GRADE_LIST_PATH, method: 'get', params }), '组织结构班级响应')
      if (!Array.isArray(result.list) || typeof result.total !== 'number' || !Number.isFinite(result.total) || result.total < 0) {
        throw new Error('组织结构班级响应必须包含 list 数组和非负 total')
      }
      return { list: result.list.map((row, index) => objectOf(row, `组织结构班级[${index}]`) as StudyGradeRow), total: result.total }
    },

    prepareRemove (input: { ids: StudyGradeId[] }): { ids: StudyGradeId[] } {
      return prepareIds(input, '班级 ID')
    },

    async remove (input: { ids: StudyGradeId[] }): Promise<void> {
      const prepared = prepareIds(input, '班级 ID')
      await request({ url: STUDY_GRADE_DELETE_PATH, method: 'delete', data: prepared.ids })
    },

    cancelRemove (): { cancelled: true } {
      return { cancelled: true }
    },

    prepareRemoveStudents (input: { ids: StudyGradeId[] }): { ids: StudyGradeId[] } {
      return prepareIds(input, '班级学员关联 ID')
    },

    async removeStudents (input: { ids: StudyGradeId[] }): Promise<void> {
      const prepared = prepareIds(input, '班级学员关联 ID')
      await request({ url: STUDY_GRADE_STUDENT_DELETE_PATH, method: 'delete', data: prepared.ids })
    },

    cancelRemoveStudents (): { cancelled: true } {
      return { cancelled: true }
    },

    prepareRemoveManagementCenterGrades (input: { ids: StudyGradeId[] }): { ids: StudyGradeId[] } {
      return prepareIds(input, '组织结构中的班级 ID')
    },

    async removeManagementCenterGrades (input: { ids: StudyGradeId[] }): Promise<void> {
      const prepared = prepareIds(input, '组织结构中的班级 ID')
      await requestManagementCenter({ url: STUDY_GRADE_DELETE_PATH, method: 'delete', data: prepared.ids })
    },

    cancelRemoveManagementCenterGrades (): { cancelled: true } {
      return { cancelled: true }
    },

    /* ---------------- 弹窗与隐藏子页（见文件头） ---------------- */

    /**
     * 班级表单的人员分页候选。只读。
     *
     * URL 上就是 `GET /sys/user/getUserListPage?pageNo=&pageSize=&name=`，
     * 与 `[mode]/[id].vue:74` 的 `fetchStudentPage` 逐字段一致（`name` 在有值时才有）。
     * 后端 `getUserListPageData` 会**先校验页码**（`pageNo`/`pageSize` 为 null、<1、>500
     * 都抛「用户查询页码必须大于 0，单页条数必须在 1 到 500 之间」），所以 `pageNo`/`pageSize`
     * 在后端其实是必填的；SDK 补上默认值 1 / 20（20 是下拉组件的默认值，见
     * `CANDIDATE_DROPDOWN_PAGE_SIZE`），行为与页面一致。
     */
    async searchStaffCandidates (query: {
      keyword: string
      pageNo?: number
      pageSize?: number
    }): Promise<PageResult<StudyUserCandidateRow>> {
      const keyword = keywordOf(query?.keyword, '人员候选')
      return request<unknown>({
        url: SYS_USER_LIST_PAGE_PATH,
        method: 'get',
        params: orderedParams(['pageNo', 'pageSize', 'name'], {
          pageNo: pageNoOf(query?.pageNo, '人员候选 pageNo'),
          pageSize: pageSizeOf(query?.pageSize, '人员候选 pageSize', CANDIDATE_DROPDOWN_PAGE_SIZE, MAX_PERSON_PAGE_SIZE),
          name: keyword,
        }),
      }).then(candidatePageOf)
    },

    /**
     * 按工号把已选人员的姓名取回来。只读。
     *
     * 页面的 `fetchSelectedStudents`（`[mode]/[id].vue:84`）**每个工号发一条请求**：
     * `{ username, pageNo: 1, pageSize: 1 }` —— `username` 是**精确匹配**
     * （`buildUserListQuery` 里是 `.eq("username", …)`），所以 `pageSize: 1` 足够。
     * SDK 保持同样的请求形状（含 qs 键序），串行发，并把结果合成一个数组。
     *
     * 取不到的工号不报错，而是列在 `missing` 里 —— 页面对这种情况是退回
     * 「工号：xxx」的兜底选项（`use-paged-user-options.js` 的 `createFallbackOption`），
     * 不是失败。
     */
    async resolveStaffByUsername (input: {
      usernames: Array<string | number>
    }): Promise<{ list: StudyUserCandidateRow[]; missing: string[] }> {
      if (!Array.isArray(input?.usernames) || input.usernames.length === 0) {
        throw new Error('回显人员时必须提供非空的 usernames 工号数组')
      }
      const usernames = input.usernames.map((item, index) => {
        const value = typeof item === 'number' ? String(item) : item
        if (typeof value !== 'string' || value.trim() === '') {
          throw new Error(`usernames[${index}]必须为非空工号`)
        }
        return value.trim()
      })
      const list: StudyUserCandidateRow[] = []
      const missing: string[] = []
      for (const username of usernames) {
        const page = candidatePageOf(await request<unknown>({
          url: SYS_USER_LIST_PAGE_PATH,
          method: 'get',
          params: orderedParams(['username', 'pageNo', 'pageSize'], { username, pageNo: 1, pageSize: 1 }),
        }))
        if (page.list.length === 0) missing.push(username)
        else list.push(...page.list)
      }
      return { list, missing }
    },

    /** 读班级**当前**已关联的组织（扁平、去重；只有 id/code/name）。只读 */
    async listOrganizations (input: { gradeId: StudyGradeId }): Promise<StudyOrganizationRow[]> {
      const gradeId = idOf(input?.gradeId, '班级 ID')
      return request<unknown>({
        url: STUDY_GRADE_ORGANIZATION_PATH,
        method: 'get',
        params: { gradeId },
      }).then((value) => listOf<StudyOrganizationRow>(value, '班级已关联组织'))
    },

    /** 只校验并去重组织 ID 全集，不发请求 */
    prepareAddOrganizations (input: {
      gradeId: StudyGradeId
      organizationIdList: StudyGradeId[]
    }): { draft: StudyGradeOrganizationDraft } {
      return {
        draft: {
          gradeId: idOf(input?.gradeId, '班级 ID'),
          organizationIdList: idListOf(input?.organizationIdList, '组织 ID'),
        },
      }
    },

    /**
     * 保存班级关联组织（`POST /study/grade/studygrade/addGradeOrganizationRelV2`）。**写**。
     *
     * 这是**集合替换**：不在 `organizationIdList` 里的旧组织会被软删，其名下学员关联同时
     * 被软删，并按被移除学员调云信群接口调成员 + 推消息（见文件头）。没有 `@Transactional`，
     * 半成品可能落库。返回 undefined，完成判据必须回查 `listOrganizations`。
     */
    async addOrganizations (input: { draft: StudyGradeOrganizationDraft }): Promise<void> {
      const draft = objectOf(input?.draft, '关联组织草稿')
      await request<unknown>({
        url: STUDY_GRADE_ORGANIZATION_SAVE_PATH,
        method: 'post',
        data: {
          gradeId: idOf(draft.gradeId, '关联组织草稿.gradeId'),
          organizationIdList: idListOf(draft.organizationIdList, '关联组织草稿.organizationIdList'),
        },
      })
    },

    cancelAddOrganizations (): { cancelled: true } {
      return { cancelled: true }
    },

    /**
     * 读「组织＋岗位」结构树。只读。
     *
     * **后端一个参数都不收**（`HrOrganizationController#getOrganizationPost`），
     * 所以关键字过滤只能在调用方本地做 —— SDK 不做这个过滤，如实把整棵树交出去
     * （与 `study-grade-search` 那条"页面全量拉、SDK 不照抄"不同：这里连一个能收关键字的
     * 上游参数都没有，藏起来只会让调用方拿不到候选）。节点语义见 `StudyPostTreeNode`。
     */
    async getPostTree (): Promise<StudyPostTreeNode[]> {
      return request<unknown>({
        url: HR_ORGANIZATION_POST_TREE_PATH,
        method: 'get',
      }).then((value) => listOf<StudyPostTreeNode>(value, '组织岗位树'))
    },

    /** 读班级**当前**已关联岗位（`{id, name}`，`id` 是 `hr_post.id`）。只读 */
    async listPosts (input: { gradeId: StudyGradeId }): Promise<StudyPostRow[]> {
      const gradeId = idOf(input?.gradeId, '班级 ID')
      return request<unknown>({
        url: STUDY_GRADE_POST_PATH,
        method: 'get',
        params: { gradeId },
      }).then((value) => listOf<StudyPostRow>(value, '班级已关联岗位'))
    },

    /**
     * 按岗位取在职员工。只读（**POST 但服务端不写任何东西**）。
     *
     * 请求体是**裸的岗位 ID 数组**，不是 `{ postIdList }` 包装 —— 与
     * `HrStaffController#getStaffListByPostId(@RequestBody List<Long> postIdList)` 一致，
     * 与页面的 `http.post('/org/staff/getStaffListByPostId', checkedPostIds.value)` 一致。
     */
    async listPostStaff (input: { postIdList: StudyGradeId[] }): Promise<StudyStaffRow[]> {
      const postIdList = idListOf(input?.postIdList, '岗位 ID')
      return request<unknown>({
        url: HR_STAFF_BY_POST_ID_PATH,
        method: 'post',
        data: postIdList,
      }).then((value) => listOf<StudyStaffRow>(value, '岗位在职员工'))
    },

    /** 只校验并去重岗位 ID 全集，不发请求 */
    prepareAddPosts (input: {
      gradeId: StudyGradeId
      postIdList: StudyGradeId[]
    }): { draft: StudyGradePostDraft } {
      return {
        draft: {
          gradeId: idOf(input?.gradeId, '班级 ID'),
          postIdList: idListOf(input?.postIdList, '岗位 ID'),
        },
      }
    },

    /**
     * 保存班级关联业务（岗位）（`POST /study/grade/studygrade/addGradePostRel`）。**写**。
     *
     * 同样是**集合替换**：不在 `postIdList` 里的旧岗位被软删，其名下学员关联一并软删并推送
     * 移出消息；新岗位下**在职**员工（`status in (1,4,5)`）被写成班级学员（`type=1`）。
     * 与关联组织**不是同一个动作**，尽管两者收的是同一个 DTO 类（文件头）。
     */
    async addPosts (input: { draft: StudyGradePostDraft }): Promise<void> {
      const draft = objectOf(input?.draft, '关联业务草稿')
      await request<unknown>({
        url: STUDY_GRADE_POST_SAVE_PATH,
        method: 'post',
        data: {
          gradeId: idOf(draft.gradeId, '关联业务草稿.gradeId'),
          postIdList: idListOf(draft.postIdList, '关联业务草稿.postIdList'),
        },
      })
    },

    cancelAddPosts (): { cancelled: true } {
      return { cancelled: true }
    },

    /**
     * 添加学员弹窗「内部学员」候选。只读。
     *
     * ⚠️ 端点名叫「不在该班级的用户列表」，但**当前的 SQL 并不过滤已在班级的人**（文件头）。
     * SDK 原样返回服务端给的东西，不补本地过滤；要判断"是否已在班级"必须另行核对
     * （例如 `GET /study/grade/student?gradeId=` 的班级学员列表）。
     * `keyword` 在服务端是 **`real_name LIKE 'kw%'`（仅前缀）**，不是包含匹配。
     */
    async searchStudentCandidates (query: {
      gradeId: StudyGradeId
      keyword: string
      pageNo?: number
      pageSize?: number
    }): Promise<PageResult<StudyUserCandidateRow>> {
      const gradeId = idOf(query?.gradeId, '班级 ID')
      const keyword = keywordOf(query?.keyword, '内部学员候选')
      return request<unknown>({
        url: SYS_USER_NOT_IN_GRADE_PATH,
        method: 'get',
        params: orderedParams(['gradeId', 'name', 'pageNo', 'pageSize'], {
          gradeId,
          name: keyword,
          pageNo: pageNoOf(query?.pageNo, '内部学员候选 pageNo'),
          pageSize: pageSizeOf(query?.pageSize, '内部学员候选 pageSize', CANDIDATE_TABLE_PAGE_SIZE, MAX_PERSON_PAGE_SIZE),
        }),
      }).then(candidatePageOf)
    },

    /**
     * 添加学员弹窗「外部学员」候选。只读。
     *
     * 页面发的是 `{ name, pageNo, pageSize }` —— `gradeId` 那一行在源码里是**注释掉的**，
     * 而且 `StudyStudentPageDTO` 上根本没有 `gradeId` 字段，发过去也会被忽略，所以 SDK 不收它。
     * 服务端**无条件** `setIsStaff(0)`：这条只返回外部学员。
     * `keyword` 同时匹配 `name` 与 `mobile`（都是包含匹配）。
     */
    async listExternalStudents (query: {
      keyword: string
      pageNo?: number
      pageSize?: number
    }): Promise<PageResult<StudyExternalStudentRow>> {
      const keyword = keywordOf(query?.keyword, '外部学员候选')
      return request<unknown>({
        url: STUDY_GRADE_EXTERNAL_STUDENT_PATH,
        method: 'get',
        params: orderedParams(['name', 'pageNo', 'pageSize'], {
          name: keyword,
          pageNo: pageNoOf(query?.pageNo, '外部学员候选 pageNo'),
          pageSize: pageSizeOf(query?.pageSize, '外部学员候选 pageSize', CANDIDATE_TABLE_PAGE_SIZE, MAX_PERSON_PAGE_SIZE),
        }),
      }).then((value) => {
        const page = objectOf(value, '外部学员候选分页响应')
        if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total)) {
          throw new Error('外部学员候选分页响应缺少有效 list 或 total')
        }
        return { list: page.list as StudyExternalStudentRow[], total: page.total as number }
      })
    },

    /**
     * 只校验工号全集，不发请求。
     *
     * 页面把「内部学员」与「外部学员」两张表的勾选**合并成一个数组**再提交
     * （`add-student.vue:366`），两边都是工号，所以这里也收一个合并后的数组。
     * 去重是本地做的：重复工号对服务端是同一个集合。
     */
    prepareAddStudents (input: {
      gradeId: StudyGradeId
      staffCodeList: StudyGradeId[]
    }): { draft: StudyGradeStudentDraft } {
      return {
        draft: {
          gradeId: idOf(input?.gradeId, '班级 ID'),
          staffCodeList: idListOf(input?.staffCodeList, '学员工号'),
        },
      }
    },

    /**
     * 添加学员入班（`POST /study/grade/student/addGradeStudent`）。**写**。
     *
     * 服务端会：① 先查这些工号里有没有**已经在班级**的，有就整单报错
     * （「X已在班级中请移除后再添加学员」）；② 建/补 `hr_study_student` 学员行；
     * ③ 写班级学员关联（`type = 0` **手动入班**，与按组织/岗位带进来的 `type = 1` 不同）；
     * ④ 对**正在上课**的周课堂补班课学员关联；⑤ 调云信群接口加成员并推消息（见文件头）。
     * 本地写有 `@Transactional`，但第 ⑤ 步的外部副作用不在事务里。
     */
    async addStudents (input: { draft: StudyGradeStudentDraft }): Promise<void> {
      const draft = objectOf(input?.draft, '添加学员草稿')
      await request<unknown>({
        url: STUDY_GRADE_STUDENT_SAVE_PATH,
        method: 'post',
        data: {
          gradeId: idOf(draft.gradeId, '添加学员草稿.gradeId'),
          staffCodeList: idListOf(draft.staffCodeList, '添加学员草稿.staffCodeList'),
        },
      })
    },

    cancelAddStudents (): { cancelled: true } {
      return { cancelled: true }
    },
  }
}

export type StudyGradeCapability = ReturnType<typeof createStudyGradeCapability>
