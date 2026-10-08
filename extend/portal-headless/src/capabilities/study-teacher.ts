import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * 学习管理域「基础数据」里与**讲师**有关的三页。
 *
 * | 页面 | 菜单路径 | 接口 | 走哪个实例 |
 * | --- | --- | --- | --- |
 * | 讲师管理 | `/dashboard/base/teacher/list` | `/manage/getAllProfessorPage.lay` | **smart-layer-admin** |
 * | 讲师类型 | `/dashboard/base/teacher-level/list` | `/manage/study/teacherlevelmanagement.lay` | **smart-layer-admin** |
 * | 评价设置 | `/dashboard/base/teacher-appraise-setting/list` | `/study/base/studyappraiseteacher/list` | platform |
 *
 * 逐字段基准：`baseline/study-teacher.browser.json`
 * 四件套记录：`docs/pages/{讲师管理,讲师类型,评价设置}.md`
 *
 * ## 前两页走的**不是 platform 实例**，而且**不套 platform 那层包络**
 *
 * 它们打的是 `.lay` 接口，host 是 `smarterlayeradmintest.zhihuidanji.com/admin`。
 * 那个实例的响应规则（`smart-layer` 那一档，见 `src/context/http-instance.ts`）
 * **不看 `ret`，看 `code`**；而且页面调用时都带 `isOriginal: true` ——
 * 于是拿到的就是**整个响应体**，页面自己再去取 `result.page.results`。
 *
 * 实测原始体（2026-09-21）：
 *
 * ```json
 * {"ret":"SUCCESS","code":200,
 *  "page":{"pageNo":1,"pageSize":2,"totalRecord":133,"totalPage":67,"results":[…]}}
 * ```
 *
 * ⇒ 本能力把 `{page: {results, totalRecord}}` 归一成 `{list, total}`，
 * 与其它能力同形；**归一是在能力里做的，不是把原始体透出去**。
 *
 * ⚠️ **这两页曾经做不了**：SDK 早先只实现了 `portal-standard` 一种包络，
 * 其余四档一律抛 `HttpInstanceUnsupportedError`。用户 2026-09-21 要求
 * **按各实例自己的规则复刻**，于是 `client.ts` 里补上了 `applyEnvelope()` 的四条规则
 * （测试 `test/http-envelope.test.ts`），这两页才做得成。
 *
 * ## 实例是**逐请求**声明的，不是页面级规则
 *
 * 这两页的**列表**走 smart-layer-admin，而**删除**（`DELETE /study/base/studyteacher`）
 * 走 **platform**。`src/context/http-instance.ts` 的 `isPageShapedPath` 注释写着这条道理：
 * "同一次页面操作里可能有多个实例，所以实例必须能逐请求指定，不能只当页面属性"。
 * 所以这里用请求级的 `httpInstance`，没有往 `HTTP_INSTANCE_PAGE_RULES` 里加页面规则
 * ——加了 `test/http-instances.test.ts` 的相等性断言会红，而且它是对的。
 *
 * **代价（conventions 第 27 条）**：这个实例的 baseURL 必须由调用方显式给，
 * 没给就**拒绝发请求**（失败关闭），不会拿默认 baseURL 去凑。
 *
 * ## 写操作
 *
 * 讲师相关写能力分布在讲师主体、讲师类型和评价设置三个页面：
 *
 * | 能力 | 端点 | 页面 |
 * | --- | --- | --- |
 * | `study-teacher-save` | `POST /manage/{add,update}ProfessorStudy.lay`（必要时先 platform 创建学员） | 讲师管理表单 |
 * | `study-teacher-status` / `study-teacher-remove` | `GET /manage/updateProfessor.lay` / `DELETE /study/base/studyteacher` | 讲师列表 |
 * | `study-teacher-level-save/status/remove` | `POST /manage/study/{insert,update}TeacherLevel.lay`、`POST updateTeacherLevelStatus.lay`、`GET deleteTeacherLevel.lay` | 讲师类型表单/列表 |
 * | `study-teacher-save-teacher` | `POST /study/base/studystudent/saveTeacher`（platform） | 讲师管理表单（没有 staffCode 时先建学员记录） |
 * | `study-appraise-setting-save` | `POST /study/base/studyappraiseteacher`（platform，**数组 body**） | 评价设置 |
 *
 * 讲师主体 `.lay` 保存/编辑、讲师主体启停与删除、讲师类型启停与删除均已接入；真实环境回查仍需按契约执行。
 */

export const STUDY_TEACHER_PAGE_PATH = '/dashboard/base/teacher/list'
export const STUDY_TEACHER_LEVEL_PAGE_PATH = '/dashboard/base/teacher-level/list'
export const STUDY_APPRAISE_SETTING_PAGE_PATH = '/dashboard/base/teacher-appraise-setting/list'

/** 讲师管理 / 讲师类型列表走这个实例 —— 调用方必须显式给它的 baseURL（conventions 27） */
export const STUDY_TEACHER_HTTP_INSTANCE = 'smart-layer-admin'

export const STUDY_TEACHER_LIST_PATH = '/manage/getAllProfessorPage.lay'
export const STUDY_TEACHER_LEVEL_LIST_PATH = '/manage/study/teacherlevelmanagement.lay'
export const STUDY_APPRAISE_SETTING_LIST_PATH = '/study/base/studyappraiseteacher/list'
/** 讲师创建页无 staffCode 时创建外部讲师学员记录 */
export const STUDY_TEACHER_SAVE_TEACHER_PATH = '/study/base/studystudent/saveTeacher'
export const STUDY_TEACHER_CREATE_PATH = '/manage/addProfessorStudy.lay'
export const STUDY_TEACHER_UPDATE_PATH = '/manage/updateProfessorStudy.lay'
export const STUDY_TEACHER_STATUS_PATH = '/manage/updateProfessor.lay'
export const STUDY_TEACHER_DELETE_PATH = '/study/base/studyteacher'
export const STUDY_TEACHER_LEVEL_STATUS_PATH = '/manage/updateTeacherLevelStatus.lay'
export const STUDY_TEACHER_LEVEL_DELETE_PATH = '/manage/deleteTeacherLevel.lay'
export const STUDY_TEACHER_MODULE_TYPE = 12

// ---------------------------------------------------------------------------
// 本轮补齐的三处：人员候选、教师类型字典、以及两个 `.lay` 写入口 + 评价设置保存
// ---------------------------------------------------------------------------

/**
 * 讲师管理表单里「讲师姓名」下拉的候选：**不是讲师的学员**（`student/[mode]/[id].vue:185`）。
 *
 * ⚠️ 它**一个参数都没有**（页面就是 `http.get(url)`），所以本能力也不接受参数 ——
 * 这一条与 conventions 第 11 条「长选项先要关键字」不冲突：那不是"少传一个关键字"，
 * 是后端根本没有关键字入口。代价是调用方拿到的是一整批候选（规模未实测），
 * 见能力说明里的 `gaps`。
 *
 * 走 **platform** 实例（页面上写的是 `import { http } from platform.js`），
 * 而讲师页的其余请求走 smart-layer-admin —— 同一次页面操作里两个实例，见文件头。
 */
export const STUDY_TEACHER_CANDIDATE_STUDENT_PATH = '/study/base/studystudent/studentNoTeacherList'

/**
 * 教师类型字典（`/dict/selectByPage.lay`）。**smart-layer-admin** 实例。
 *
 * 页面两处（列表页 141 行、表单页 199 行）都传同一组固定值：
 * `{ type: 'teacher_type', page: 1, pageSize: -1 }` —— `pageSize: -1` 就是这个字典接口的"全量"写法，
 * 与 `searchUsers()` 拒绝的那个 `-1` 不是一回事：那边是全租户几千人，这边是教师分类这几条。
 * 因为它没有可变的输入，本能力**不接受参数**，把三个值钉死在实现里。
 */
export const STUDY_TEACHER_TYPE_DICT_PATH = '/dict/selectByPage.lay'
/** 字典类型固定值（页面两处都写死它） */
export const STUDY_TEACHER_TYPE_DICT_TYPE = 'teacher_type'
/** 字典接口的"全量"页大小（页面写死 -1） */
export const STUDY_TEACHER_TYPE_DICT_PAGE_SIZE = -1

/** 讲师类型页的新建（同一个表单页的 create 分支） */
export const STUDY_TEACHER_LEVEL_CREATE_PATH = '/manage/study/insertTeacherLevel.lay'
/** 讲师类型页的修改（派单表点名的那一条） */
export const STUDY_TEACHER_LEVEL_UPDATE_PATH = '/manage/study/updateTeacherLevel.lay'

/** 页面表单规则：类型名称 ≤10 字（`teacher-level/[mode]/[id].vue` 的 `rules.name`） */
export const TEACHER_LEVEL_NAME_MAX_LENGTH = 10
/** 页面表单规则：类型 a-input-number `:min="1" :max="99" :precision="0"` */
export const TEACHER_LEVEL_LEVEL_RANGE = { min: 1, max: 99 } as const
/** 页面表单规则：排序 a-input-number `:min="1" :max="999" :precision="0"` */
export const TEACHER_LEVEL_SORT_RANGE = { min: 1, max: 999 } as const

/** 页面表单规则：题目内容 ≤100 字（`teacher-appraise-setting/components/form.vue` 的 `rules`） */
export const APPRAISE_CONTENT_MAX_LENGTH = 100
/**
 * 后端硬限制：题目数量 3~5（`StudyAppraiseTeacherServiceImpl.saveInfo`）。
 * 页面上「新增一项」按钮做到 5 就停、删除按钮在只剩 1 项时禁用 —— 但**页面允许到 1 项**，
 * 是后端在 3 项以下才报错。所以 SDK 以后端为准：3~5。
 */
export const APPRAISE_ITEM_COUNT_RANGE = { min: 3, max: 5 } as const

/** 讲师管理页的每页条数参数名是 `limit`（它覆写了 `fieldNamePageSize`） */
export const DEFAULT_LIMIT = 20
/** 讲师类型页没有覆写，用的是默认的 `pageNo`；但请求里只发了 `page` */
export const DEFAULT_PAGE_SIZE = 20

export type PageResult<T> = { list: T[]; total: number }

/** 讲师行（字段取自页面 `columns`，其余原样透传） */
export type StudyTeacherRow = {
  id?: string
  /** 讲师姓名 */
  name?: string
  briefIntro?: string
  /** 讲师类型 */
  level?: string | number
  teacherType?: string | number
  status?: number
  [key: string]: unknown
}

/** 讲师类型行 */
export type StudyTeacherLevelRow = {
  id?: string
  /** 类型名称 */
  name?: string
  level?: string | number
  sort?: number
  status?: number
  [key: string]: unknown
}

/** 评价设置行（`GET /study/base/studyappraiseteacher/list` 的返回） */
export type StudyAppraiseSettingRow = Record<string, unknown>

/** 评价设置页的保存端点：`POST /study/base/studyappraiseteacher`，body 是**数组** */
export const STUDY_APPRAISE_SETTING_SAVE_PATH = '/study/base/studyappraiseteacher'

/**
 * 讲师管理的查询条件。
 *
 * 页面只有两个筛选项（`name` 与 `level`），且 `level` 的初值是 **`undefined`**
 * —— 与别的页"初值是空串、照样发"**相反**：这个实例走的是 axios 默认序列化，
 * `undefined` 会被整个丢掉。实测：无筛选时 URL 上是 `?order=&orderField=&name=&page=1&limit=20`
 * —— **没有 `level`**。
 */
export type StudyTeacherQuery = {
  /** 讲师姓名（模糊匹配） */
  name?: string
  /** 讲师类型。页面是下拉，**取值域未实测**（基准里连这一项都没发）—— 只透传、不给枚举 */
  level?: string | number
  page?: number
  limit?: number
}

export type StudyTeacherForm = {
  mode: 'create' | 'edit'
  id?: string | number
  staffCode?: string | number | null
  name: string
  jobTitle: string
  briefIntro: string
  detailedIntro: string
  img: string
  level: string | number
  teacherType: string | number
  videoIds?: Array<string | number> | null
  [key: string]: unknown
}

export type StudyTeacherDraft = {
  mode: 'create' | 'edit'
  professor: Record<string, unknown>
  videoIds: unknown[] | null
}

/** 讲师类型的查询条件：页面**只有一个分页参数** */
export type StudyTeacherLevelQuery = {
  page?: number
}

/**
 * 「讲师姓名」下拉的候选行。
 *
 * 页面 `options` 只取两个字段（`value: item.staffCode`、`label: item.name`），
 * 所以本能力也只承诺这两个；其余字段（组织名、是否员工…）**与页面动作无关**，
 * 按 conventions 第 33 条的范围口径不列进契约。
 *
 * ⚠️ `staffCode` 在后端 DTO 里是 `Long`，而本仓库多处实测后端会把 Long 序列化成**字符串**
 * （如 `base-management-center` 的 `"id":"36"`）—— 这里两种都接受，不在 SDK 侧做强转。
 */
export type StudyTeacherCandidateRow = {
  /** 学员工号。表单选中它作为讲师的 `staffCode`（**不是** `sys_user.id`） */
  staffCode?: string | number | null
  /** 学员姓名。下拉的显示文本 */
  name?: string | null
  [key: string]: unknown
}

/** 教师类型字典项。页面对 `value` 自己做了 `Number(...)`，SDK 不改写原值 */
export type StudyTeacherTypeDictItem = {
  /** 字典值原样（页面再 `Number(item.value)`） */
  value: string
  /** 字典显示文本 */
  label: string
}

/**
 * 讲师类型保存的表单。
 *
 * `mode` 决定打哪个端点 —— 页面上就是同一个表单页的两个分支
 * （`customSubmit` 里 `isCreateMode ? insertTeacherLevel.lay : updateTeacherLevel.lay`）。
 */
export type StudyTeacherLevelForm = {
  /** `create` 打 insertTeacherLevel.lay；`edit` 打 updateTeacherLevel.lay */
  mode: 'create' | 'edit'
  /** 记录 id。**`edit` 必填**，`create` 不允许带（页面新建态没有这个字段） */
  id?: string | number
  /** 类型名称，必填、≤10 字、不能全是空格 */
  name: string
  /**
   * 类型（1~99 的整数）。必填。
   * ⚠️ **编辑态页面上这个输入框是 `disabled` 的**（`rrForm.isEditMode`），也就是改不了；
   * 但页面仍然会把它原样回传，所以 SDK 也接受它、原样发。
   */
  level: number | string
  /** 排序（1~999 的整数）。必填 */
  sort: number | string
  /** 编辑态 bridge 可能回传 status 等业务字段；prepare 按 Portal omit 规则保留它们。 */
  [key: string]: unknown
}

/** 讲师类型的 save 草稿：载荷按端点分岔，所以把 mode 与目标端点一起记下来 */
export type StudyTeacherLevelDraft = {
  mode: 'create' | 'edit'
  /** 实际要 POST 的路径 */
  url: string
  /** 实际要 POST 的 body（键序 name, level, sort，编辑态多一个 id） */
  body: Record<string, unknown>
}

/** 评价设置的一条题目（表单里就是一串 `content`） */
export type StudyAppraiseSettingItem = {
  /** 题干，必填、≤100 字、不能全是空格 */
  content: string
  /** 题号。页面在提交时按**列表下标 +1** 重排（`sort: index + 1`），所以调用方给了也会被覆盖 */
  sort?: number
}

/** 评价设置保存草稿 */
export type StudyAppraiseSettingDraft = {
  /** 按顺序排列的题目；提交时 `sort` 会被重排成 1..N */
  items: Array<{ sort: number; content: string }>
}

const TEACHER_PARAMS: ParamSpec[] = [
  { name: 'name', kind: 'text', required: false, description: '讲师姓名（模糊匹配）' },
  {
    name: 'level',
    kind: 'text',
    required: false,
    description:
      '讲师类型。页面是下拉但**取值域没有实测过**（无筛选时它根本不发这一项），所以只透传、不给枚举',
  },
  { name: 'page', kind: 'number', required: false, description: '页码，默认 1（**参数名是 page，不是 pageNo**）' },
  { name: 'limit', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_LIMIT}（**是 limit，不是 pageSize**）` },
]

const SAVE_TEACHER_NAME_PARAM: ParamSpec = {
  name: 'name',
  kind: 'text',
  required: true,
  description: '外部讲师姓名；页面表单要求非空，原样作为 DTO 的 name 字段发送',
}

const SAVE_TEACHER_DRAFT_PARAM: ParamSpec = {
  name: 'draft',
  kind: 'text',
  required: true,
  description: 'prepareSaveTeacher 返回的草稿；submit 时发送为 `{ name }` DTO body',
}

const LEVEL_FORM_PARAM: ParamSpec = {
  name: 'form',
  kind: 'text',
  required: true,
  description:
    '讲师类型表单：mode（create/edit）、name、level、sort，编辑态另有 id。' +
    `name ≤${TEACHER_LEVEL_NAME_MAX_LENGTH} 字；level ${TEACHER_LEVEL_LEVEL_RANGE.min}~${TEACHER_LEVEL_LEVEL_RANGE.max}；` +
    `sort ${TEACHER_LEVEL_SORT_RANGE.min}~${TEACHER_LEVEL_SORT_RANGE.max}（都是页面 a-input-number 的 min/max）`,
}

const LEVEL_DRAFT_PARAM: ParamSpec = {
  name: 'draft',
  kind: 'text',
  required: true,
  description:
    'prepareSaveLevel 返回的草稿；里面已经带好要打哪个端点（create→insertTeacherLevel.lay，edit→updateTeacherLevel.lay）与完整 body',
}

const APPRAISE_ITEMS_PARAM: ParamSpec = {
  name: 'items',
  kind: 'array',
  required: true,
  description:
    `题目数组，${APPRAISE_ITEM_COUNT_RANGE.min}~${APPRAISE_ITEM_COUNT_RANGE.max} 条（后端硬限制），` +
    `每条 content 必填、≤${APPRAISE_CONTENT_MAX_LENGTH} 字、不能全是空格。顺序即题号（提交时按 1..N 重排 sort）`,
}

const APPRAISE_DRAFT_PARAM: ParamSpec = {
  name: 'draft',
  kind: 'text',
  required: true,
  description: 'prepareSaveAppraiseSetting 返回的草稿；submit 时作为 JSON **数组** body 发送，不是 `{ items }` 包装',
}

export const studyTeacherCapabilities: CapabilityDefinition[] = [
  {
    id: 'study-teacher-list',
    title: '查询讲师列表',
    pagePath: STUDY_TEACHER_PAGE_PATH,
    permission: '/dashboard/base/teacher',
    write: false,
    params: TEACHER_PARAMS,
  },
  {
    id: 'study-teacher-level-list',
    title: '查询讲师类型列表',
    pagePath: STUDY_TEACHER_LEVEL_PAGE_PATH,
    permission: '/dashboard/base/teacher-level',
    write: false,
    params: [{ name: 'page', kind: 'number', required: false, description: '页码，默认 1' }],
  },
  {
    id: 'study-appraise-setting-list',
    title: '查询评价设置列表（讲师评价配置）',
    pagePath: STUDY_APPRAISE_SETTING_PAGE_PATH,
    permission: '/dashboard/base/teacher-appraise-setting',
    write: false,
    // 这个接口**一个参数都没有**（页面就是 `http.get(url)`），所以参数表是空的 —— 空表是有意的
    params: [],
  },
  {
    id: 'study-teacher-prepare-save-teacher',
    title: '准备创建外部讲师学员记录',
    pagePath: STUDY_TEACHER_PAGE_PATH,
    permission: '/dashboard/base/teacher',
    moduleType: STUDY_TEACHER_MODULE_TYPE,
    httpInstance: 'platform',
    write: false,
    params: [SAVE_TEACHER_NAME_PARAM],
  },
  {
    id: 'study-teacher-save-teacher',
    title: '创建外部讲师学员记录',
    pagePath: STUDY_TEACHER_PAGE_PATH,
    permission: '/dashboard/base/teacher',
    moduleType: STUDY_TEACHER_MODULE_TYPE,
    httpInstance: 'platform',
    write: true,
    params: [SAVE_TEACHER_DRAFT_PARAM],
  },
  {
    id: 'study-teacher-cancel-save-teacher',
    title: '取消创建外部讲师学员记录',
    pagePath: STUDY_TEACHER_PAGE_PATH,
    permission: '/dashboard/base/teacher',
    moduleType: STUDY_TEACHER_MODULE_TYPE,
    httpInstance: 'platform',
    write: false,
    params: [],
  },
  {
    id: 'study-teacher-prepare-save', title: '准备保存讲师主体', pagePath: STUDY_TEACHER_PAGE_PATH, permission: '/dashboard/base/teacher', moduleType: STUDY_TEACHER_MODULE_TYPE, httpInstance: STUDY_TEACHER_HTTP_INSTANCE, write: false, params: [{ name: 'form', kind: 'text', required: true, description: '讲师表单对象' }],
  },
  {
    id: 'study-teacher-save', title: '保存讲师主体', pagePath: STUDY_TEACHER_PAGE_PATH, permission: '/dashboard/base/teacher', moduleType: STUDY_TEACHER_MODULE_TYPE, httpInstance: STUDY_TEACHER_HTTP_INSTANCE, write: true, params: [{ name: 'draft', kind: 'text', required: true, description: 'prepareSave 返回的讲师草稿' }],
  },
  {
    id: 'study-teacher-prepare-status', title: '准备讲师启停', pagePath: STUDY_TEACHER_PAGE_PATH, permission: '/dashboard/base/teacher', moduleType: STUDY_TEACHER_MODULE_TYPE, httpInstance: STUDY_TEACHER_HTTP_INSTANCE, write: false, params: [{ name: 'id', kind: 'text', required: true, description: '讲师 ID' }, { name: 'currentStatus', kind: 'number', required: true, description: '当前状态 0 或 1' }],
  },
  {
    id: 'study-teacher-status', title: '变更讲师状态', pagePath: STUDY_TEACHER_PAGE_PATH, permission: '/dashboard/base/teacher', moduleType: STUDY_TEACHER_MODULE_TYPE, httpInstance: STUDY_TEACHER_HTTP_INSTANCE, write: true, params: [{ name: 'draft', kind: 'text', required: true, description: '状态草稿' }],
  },
  {
    id: 'study-teacher-prepare-remove', title: '准备删除讲师', pagePath: STUDY_TEACHER_PAGE_PATH, permission: '/dashboard/base/teacher', moduleType: STUDY_TEACHER_MODULE_TYPE, httpInstance: 'platform', write: false, params: [{ name: 'ids', kind: 'array', required: true, description: '讲师 ID 数组' }],
  },
  {
    id: 'study-teacher-remove', title: '删除讲师', pagePath: STUDY_TEACHER_PAGE_PATH, permission: '/dashboard/base/teacher', moduleType: STUDY_TEACHER_MODULE_TYPE, httpInstance: 'platform', write: true, params: [{ name: 'ids', kind: 'array', required: true, description: '讲师 ID 数组' }],
  },
  {
    id: 'study-teacher-level-prepare-status', title: '准备讲师类型启停', pagePath: STUDY_TEACHER_LEVEL_PAGE_PATH, permission: '/dashboard/base/teacher-level', moduleType: STUDY_TEACHER_MODULE_TYPE, httpInstance: STUDY_TEACHER_HTTP_INSTANCE, write: false, params: [{ name: 'id', kind: 'text', required: true, description: '讲师类型 ID' }, { name: 'currentStatus', kind: 'number', required: true, description: '当前状态 0 或 1' }],
  },
  {
    id: 'study-teacher-level-status', title: '变更讲师类型状态', pagePath: STUDY_TEACHER_LEVEL_PAGE_PATH, permission: '/dashboard/base/teacher-level', moduleType: STUDY_TEACHER_MODULE_TYPE, httpInstance: STUDY_TEACHER_HTTP_INSTANCE, write: true, params: [{ name: 'draft', kind: 'text', required: true, description: '状态草稿' }],
  },
  {
    id: 'study-teacher-level-prepare-remove', title: '准备删除讲师类型', pagePath: STUDY_TEACHER_LEVEL_PAGE_PATH, permission: '/dashboard/base/teacher-level', moduleType: STUDY_TEACHER_MODULE_TYPE, httpInstance: STUDY_TEACHER_HTTP_INSTANCE, write: false, params: [{ name: 'id', kind: 'text', required: true, description: '讲师类型 ID' }],
  },
  {
    id: 'study-teacher-level-remove', title: '删除讲师类型', pagePath: STUDY_TEACHER_LEVEL_PAGE_PATH, permission: '/dashboard/base/teacher-level', moduleType: STUDY_TEACHER_MODULE_TYPE, httpInstance: STUDY_TEACHER_HTTP_INSTANCE, write: true, params: [{ name: 'id', kind: 'text', required: true, description: '讲师类型 ID' }],
  },
  {
    id: 'study-teacher-candidate-student-list',
    title: '查询「不是讲师的学员」候选列表',
    pagePath: STUDY_TEACHER_PAGE_PATH,
    permission: '/dashboard/base/teacher',
    moduleType: STUDY_TEACHER_MODULE_TYPE,
    // 页面上这一条走 platform（`http.get`），讲师页其余请求走 smart-layer-admin
    httpInstance: 'platform',
    write: false,
    // 后端这个方法**没有参数**（`studentNoTeacherList()`），所以参数表是空的 —— 空表是有意的
    params: [],
  },
  {
    id: 'study-teacher-type-dict',
    title: '查询教师类型字典',
    pagePath: STUDY_TEACHER_PAGE_PATH,
    permission: '/dashboard/base/teacher',
    moduleType: STUDY_TEACHER_MODULE_TYPE,
    httpInstance: STUDY_TEACHER_HTTP_INSTANCE,
    write: false,
    // 三个值（type/page/pageSize）都由页面写死，不接受调用方改写 —— 空表是有意的
    params: [],
  },
  {
    id: 'study-teacher-level-prepare-save',
    title: '准备保存讲师类型',
    pagePath: STUDY_TEACHER_LEVEL_PAGE_PATH,
    permission: '/dashboard/base/teacher-level',
    moduleType: STUDY_TEACHER_MODULE_TYPE,
    httpInstance: STUDY_TEACHER_HTTP_INSTANCE,
    write: false,
    params: [LEVEL_FORM_PARAM],
  },
  {
    id: 'study-teacher-level-save',
    title: '保存讲师类型（新建 / 修改）',
    pagePath: STUDY_TEACHER_LEVEL_PAGE_PATH,
    permission: '/dashboard/base/teacher-level',
    moduleType: STUDY_TEACHER_MODULE_TYPE,
    httpInstance: STUDY_TEACHER_HTTP_INSTANCE,
    write: true,
    params: [LEVEL_DRAFT_PARAM],
  },
  {
    id: 'study-appraise-setting-prepare-save',
    title: '准备保存评价设置题目',
    pagePath: STUDY_APPRAISE_SETTING_PAGE_PATH,
    permission: '/dashboard/base/teacher-appraise-setting',
    write: false,
    params: [APPRAISE_ITEMS_PARAM],
  },
  {
    id: 'study-appraise-setting-save',
    title: '保存评价设置题目',
    pagePath: STUDY_APPRAISE_SETTING_PAGE_PATH,
    permission: '/dashboard/base/teacher-appraise-setting',
    write: true,
    params: [APPRAISE_DRAFT_PARAM],
  },
]

/** 页面能力 ID 与 SDK 方法名的固定映射；供目录和统一调用入口复用。 */
for (const [id, title, pagePath, permission, httpInstance] of [
  ['study-teacher-cancel-save', '取消讲师保存草稿', STUDY_TEACHER_PAGE_PATH, '/dashboard/base/teacher', STUDY_TEACHER_HTTP_INSTANCE],
  ['study-teacher-cancel-status', '取消讲师启停草稿', STUDY_TEACHER_PAGE_PATH, '/dashboard/base/teacher', STUDY_TEACHER_HTTP_INSTANCE],
  ['study-teacher-cancel-remove', '取消讲师删除草稿', STUDY_TEACHER_PAGE_PATH, '/dashboard/base/teacher', 'platform'],
  ['study-teacher-level-cancel-status', '取消讲师类型启停草稿', STUDY_TEACHER_LEVEL_PAGE_PATH, '/dashboard/base/teacher-level', STUDY_TEACHER_HTTP_INSTANCE],
  ['study-teacher-level-cancel-remove', '取消讲师类型删除草稿', STUDY_TEACHER_LEVEL_PAGE_PATH, '/dashboard/base/teacher-level', STUDY_TEACHER_HTTP_INSTANCE],
] as const) {
  studyTeacherCapabilities.push({ id, title, pagePath, permission, httpInstance, moduleType: STUDY_TEACHER_MODULE_TYPE, write: false, params: [] })
}

export const STUDY_TEACHER_METHODS = {
  'study-teacher-list': 'list',
  'study-teacher-level-list': 'listLevels',
  'study-appraise-setting-list': 'listAppraiseSettings',
  'study-teacher-prepare-save-teacher': 'prepareSaveTeacher',
  'study-teacher-save-teacher': 'submitSaveTeacher',
  'study-teacher-cancel-save-teacher': 'cancelSaveTeacher',
  'study-teacher-prepare-save': 'prepareSave',
  'study-teacher-save': 'save',
  'study-teacher-cancel-save': 'cancelSave',
  'study-teacher-prepare-status': 'prepareStatus',
  'study-teacher-status': 'setStatus',
  'study-teacher-cancel-status': 'cancelStatus',
  'study-teacher-prepare-remove': 'prepareRemove',
  'study-teacher-remove': 'remove',
  'study-teacher-cancel-remove': 'cancelRemove',
  'study-teacher-candidate-student-list': 'listCandidateStudents',
  'study-teacher-type-dict': 'listTeacherTypes',
  'study-teacher-level-prepare-save': 'prepareSaveLevel',
  'study-teacher-level-save': 'saveLevel',
  'study-teacher-level-prepare-status': 'prepareLevelStatus',
  'study-teacher-level-status': 'setLevelStatus',
  'study-teacher-level-cancel-status': 'cancelLevelStatus',
  'study-teacher-level-prepare-remove': 'prepareRemoveLevel',
  'study-teacher-level-remove': 'removeLevel',
  'study-teacher-level-cancel-remove': 'cancelRemoveLevel',
  'study-appraise-setting-prepare-save': 'prepareSaveAppraiseSetting',
  'study-appraise-setting-save': 'submitAppraiseSetting',
} as const

/**
 * 能力实现。
 *
 * `request` 由 SDK 门面注入：讲师那两页的页面上下文会解析成 `smart-layer-admin` 实例，
 * 所以调用方**必须**在 `httpBaseUrls` 里给它 baseURL，否则这里会失败关闭（conventions 27）。
 */
/** 类型名称：必填、≤10 字、不能全是空格（页面 `rules.name` 的三条） */
function levelNameOf (value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('讲师类型名称必填（页面的 validateOnlySpace 规则也不允许全是空格）')
  }
  const trimmed = value.trim()
  if (trimmed.length > TEACHER_LEVEL_NAME_MAX_LENGTH) {
    throw new Error(
      `讲师类型名称不超过 ${TEACHER_LEVEL_NAME_MAX_LENGTH} 字（页面规则），收到的是 ${trimmed.length} 字`,
    )
  }
  return trimmed
}

/** `a-input-number` 的 `:precision="0"` + `:min` / `:max` —— 整数且落在闭区间内 */
function integerInRangeOf (
  value: unknown,
  label: string,
  range: { min: number; max: number },
): number {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isInteger(parsed)) {
    throw new Error(`${label} 必须是整数，收到的是 ${JSON.stringify(value)}`)
  }
  if (parsed < range.min || parsed > range.max) {
    throw new Error(`${label} 必须在 ${range.min}~${range.max} 之间（页面 a-input-number 的 min/max），收到 ${parsed}`)
  }
  return parsed
}

/** 题干：必填、不能全是空格、≤100 字（页面 `rules` 的三条） */
function appraiseContentOf (value: unknown, index: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`评价设置 items[${index}].content 必填（页面的 validateOnlySpace 规则也不允许全是空格）`)
  }
  const trimmed = value.trim()
  if (trimmed.length > APPRAISE_CONTENT_MAX_LENGTH) {
    throw new Error(
      `评价设置 items[${index}].content 不超过 ${APPRAISE_CONTENT_MAX_LENGTH} 字（页面规则），收到 ${trimmed.length} 字`,
    )
  }
  return trimmed
}

/** 讲师类型表单 → 保存草稿（含端点选择）。纯本地，不发请求 */
function buildLevelDraft (value: unknown): StudyTeacherLevelDraft {
  const form = (value ?? {}) as Partial<StudyTeacherLevelForm>
  if (form.mode !== 'create' && form.mode !== 'edit') {
    throw new Error('讲师类型表单.mode 只能是 create（新建）或 edit（修改）')
  }
  const name = levelNameOf(form.name)
  const level = integerInRangeOf(form.level, '讲师类型表单.level', TEACHER_LEVEL_LEVEL_RANGE)
  const sort = integerInRangeOf(form.sort, '讲师类型表单.sort', TEACHER_LEVEL_SORT_RANGE)
  if (form.mode === 'create') {
    if (form.id !== undefined && form.id !== null && String(form.id).trim() !== '') {
      throw new Error('新建讲师类型不能带 id（页面新建态的 bridge 里没有记录）')
    }
    const { mode: _mode, createTime: _createTime, updateTime: _updateTime, id: _id, ...body } = form as StudyTeacherLevelForm & Record<string, unknown>
    return {
      mode: 'create',
      url: STUDY_TEACHER_LEVEL_CREATE_PATH,
      // 页面实际发送 omit(form, ['createTime', 'updateTime'])，保留 bridge 中的业务字段。
      body: { ...body, name, level, sort },
    }
  }
  const id = String(form.id ?? '').trim()
  if (id === '') throw new Error('修改讲师类型必须给 id（来自讲师类型列表行）')
  const { mode: _mode, createTime: _createTime, updateTime: _updateTime, ...body } = form as StudyTeacherLevelForm & Record<string, unknown>
  return {
    mode: 'edit',
    url: STUDY_TEACHER_LEVEL_UPDATE_PATH,
    // 页面实际发送 omit(form, ['createTime', 'updateTime'])，编辑行上的 status 等字段也要保留。
    body: { ...body, id, name, level, sort },
  }
}

/** 题目数组 → 保存草稿。`sort` 按数组下标重排（与页面 `onSubmit` 一致） */
function buildAppraiseDraft (value: unknown): StudyAppraiseSettingDraft {
  if (!Array.isArray(value)) throw new Error('评价设置 items 必须是数组')
  if (value.length < APPRAISE_ITEM_COUNT_RANGE.min || value.length > APPRAISE_ITEM_COUNT_RANGE.max) {
    throw new Error(
      `评价设置题目数量必须在 ${APPRAISE_ITEM_COUNT_RANGE.min}~${APPRAISE_ITEM_COUNT_RANGE.max} 条之间` +
        `（后端硬限制），收到 ${value.length} 条`,
    )
  }
  return {
    items: value.map((item, index) => ({
      sort: index + 1,
      content: appraiseContentOf((item as StudyAppraiseSettingItem | undefined)?.content, index),
    })),
  }
}

/**
 * 自己判一次 smart-layer 的业务成败。
 *
 * 为什么需要它：讲师两页的页面上下文在接线处被**整体**配成了
 * `{ httpInstance: 'smart-layer-admin', isOriginal: true }`，
 * 而 `applyEnvelope` 在 `isOriginal` 时**直接返回响应体、连 `code` 都不看**
 * （`src/http/client.ts:135`）。页面上那几个调用（`/dict/selectByPage.lay`、
 * `insertTeacherLevel.lay`、`updateTeacherLevel.lay`）**都没带** `isOriginal`
 * —— 它们是靠实例拦截器按 `code !== 200` 抛错来发现失败的。
 *
 * 所以这里把那条失败语义补回来：拿到的是 smart-layer 形状的响应体且 `code !== 200` 就抛。
 * 不这么做的话，业务失败会以"成功的 undefined"返回 —— 写操作会静默失败，读会静默变空。
 */
function assertSmartLayerSuccess (body: unknown, what: string): void {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return
  const code = (body as { code?: unknown }).code
  if (code === undefined || Number(code) === 200) return
  const msg = (body as { msg?: unknown }).msg
  throw new Error(
    `${what}失败：smart-layer 返回 code=${String(code)}` +
      (typeof msg === 'string' && msg !== '' ? `，msg=${msg}` : ''),
  )
}

/**
 * 从响应体里取字典数组。
 *
 * 页面写的是 `const { results } = await smartLayerAdminHttp.get(…)`，也就是 `results`
 * 在**包络拆完之后的那个对象**上。而这一页的请求被接线配成 `isOriginal: true`
 * （见 `assertSmartLayerSuccess`），此时拿到的是原始体 —— 于是两种形状都可能出现：
 * 顶层 `results`，或包络里的 `data.results`。两种都认，取不到就当场抛，
 * 不静默返回空数组（空数组会让调用方以为"这个租户没有教师分类"）。
 */
function dictResultsOf (body: unknown): unknown[] {
  const top = (body ?? {}) as { results?: unknown; data?: { results?: unknown } }
  if (Array.isArray(top.results)) return top.results
  if (Array.isArray(top.data?.results)) return top.data.results
  throw new Error(
    '教师类型字典的响应里没有 results 数组：页面靠 `const { results } = …` 取数，' +
      '形状变了要当场炸，不能静默返回空的类型列表',
  )
}

function binaryStatusDraftOf (value: unknown, label: string): { id: string | number; status: 0 | 1 } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  const draft = value as { id?: unknown; status?: unknown }
  const id = typeof draft.id === 'number' && Number.isSafeInteger(draft.id) && draft.id > 0
    ? draft.id
    : typeof draft.id === 'string' && /^[1-9]\d*$/.test(draft.id) ? draft.id : null
  if (id === null) throw new Error(`${label}.id必须为正整数 ID`)
  if (draft.status !== 0 && draft.status !== 1) throw new Error(`${label}.status只能是0或1`)
  return { id, status: draft.status }
}

function idsOf (value: unknown, label: string): Array<string | number> {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}必须是非空数组`)
  return value.map((id, index) => {
    if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) return id
    if (typeof id === 'string' && /^[1-9]\d*$/.test(id)) return id
    throw new Error(`${label}[${index}]必须为正整数 ID`)
  })
}

function teacherFormDraftOf (value: unknown): StudyTeacherDraft {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('讲师表单必须是对象')
  const form = value as StudyTeacherForm
  if (form.mode !== 'create' && form.mode !== 'edit') throw new Error('讲师表单.mode只能是create或edit')
  if (typeof form.name !== 'string' || form.name.trim() === '') throw new Error('讲师姓名不能为空')
  for (const [key, max] of [['jobTitle', 3], ['briefIntro', 50]] as const) {
    const text = form[key]
    if (typeof text !== 'string' || text.trim() === '' || text.length > max) throw new Error(`讲师表单.${key}必填且不超过${max}个字符`)
  }
  for (const key of ['detailedIntro', 'img', 'level', 'teacherType'] as const) {
    if (form[key] === undefined || form[key] === null || form[key] === '') throw new Error(`讲师表单.${key}必填`)
  }
  if (typeof form.detailedIntro !== 'string' || form.detailedIntro.replace(/<[^<>]+>/g, '').length > 500) throw new Error('讲师图文介绍必须为字符串且去标签后不超过500个字符')
  if (typeof form.img !== 'string') throw new Error('讲师形象照必须为地址字符串')
  if (form.mode === 'create' && form.id !== undefined && form.id !== null && form.id !== '') throw new Error('新建讲师不能带 id')
  if (form.mode === 'edit') idsOf([form.id], '讲师 ID')
  if (form.staffCode !== undefined && form.staffCode !== null && form.staffCode !== '') idsOf([form.staffCode], '讲师工号')
  if (form.videoIds !== undefined && form.videoIds !== null && !Array.isArray(form.videoIds)) throw new Error('讲师表单.videoIds必须为数组或null')
  if (Array.isArray(form.videoIds) && form.videoIds.length > 0) idsOf(form.videoIds, '讲师视频 ID')
  const professor: Record<string, unknown> = { ...form }
  delete professor.mode
  delete professor.videoIds
  delete professor.createTime
  delete professor.lastUpdateTime
  const videoIds = Array.isArray(form.videoIds) ? [...form.videoIds] : null
  return { mode: form.mode, professor, videoIds }
}

export function createStudyTeacherCapability (
  /** 讲师管理页 —— 调用方要保证它的请求带 `httpInstance: 'smart-layer-admin'` 与 `isOriginal: true` */
  requestTeacher: PortalRequest,
  /** 讲师类型页 —— 同上 */
  requestLevel: PortalRequest,
  /** 评价设置页（走 platform 实例） */
  requestAppraise: PortalRequest,
  /**
   * 讲师页上所有**走 platform**的调用：`saveTeacher` 与 `studentNoTeacherList`。
   * 单独可注入以便逐请求验证实例（platform、不带 `isOriginal`）。
   */
  requestSaveTeacher: PortalRequest = requestAppraise,
) {
  type SaveTeacherDraft = { name: string }

  const prepareSaveTeacherDraft = (input: { name: string }): { draft: SaveTeacherDraft } => {
    if (typeof input?.name !== 'string' || input.name.trim().length === 0) {
      throw new Error('外部讲师姓名不能为空')
    }
    return { draft: { name: input.name } }
  }

  /**
   * 把 smart-layer 那两个接口的原始体归一成 `{list, total}`。
   *
   * 页面拿到 `isOriginal: true` 的整个响应体之后，自己写的是
   * `{ list: result.page.results, total: result.page.totalRecord }` ——
   * 这里逐字复刻那一句。**没有 `page` 就当场抛**：静默返回空列表会让调用方
   * 以为"真的没有讲师"，而实际是响应形状变了。
   */
  const fromPagedBody = <T>(body: unknown): PageResult<T> => {
    const page = (body as { page?: { results?: T[]; totalRecord?: number } } | null)?.page
    if (page === undefined || page === null) {
      throw new Error(
        '讲师接口的响应里没有 page 字段：这一族（smart-layer）的页面靠 `result.page.results` 取数，' +
          '形状变了要当场炸，不能静默返回空列表',
      )
    }
    return { list: page.results ?? [], total: page.totalRecord ?? 0 }
  }

  return {
    /**
     * 「讲师姓名」下拉的候选列表（不是讲师的学员）。只读、**无参数**。
     *
     * 走 platform 实例（`requestSaveTeacher`，与评价设置同一份 platform 上下文）。
     * 页面拿到的是一个数组，`options` 直接 map 成 `{value: staffCode, label: name}`；
     * 本能力把这两个字段挑出来（其余后端字段与页面动作无关，不进契约）。
     *
     * ⚠️ 后端那个方法**没有关键字入口**，所以这里也不假装有 —— 它返回的是"所有还不是讲师的学员"。
     * 规模没有实测（见契约的 `gaps`）；调用方需要精确的人时，改用带关键字的 `base-user-search`。
     */
    async listCandidateStudents (): Promise<StudyTeacherCandidateRow[]> {
      const list = await requestSaveTeacher<unknown>({
        url: STUDY_TEACHER_CANDIDATE_STUDENT_PATH,
        method: 'get',
      })
      if (!Array.isArray(list)) {
        throw new Error(
          '「不是讲师的学员」接口没有返回数组：这一族（platform）的页面直接对结果 map，' +
            '形状变了要当场炸，不能静默返回空候选',
        )
      }
      return list.map((item) => {
        const row = (item ?? {}) as Record<string, unknown>
        return {
          staffCode: (row.staffCode ?? null) as string | number | null,
          name: (row.name ?? null) as string | null,
        }
      })
    },

    /**
     * 查询教师类型字典。只读、**无参数**（三个值都由页面写死，见文件里的常量）。
     *
     * ⚠️ 走 smart-layer-admin，但页面上这一条**没有** `isOriginal` —— 是拦截器按 `code` 判成败的。
     * 而讲师两页的页面上下文在接线处被整体配成了 `isOriginal: true`（那里逐页写着），
     * 于是包络检查会被跳过；所以这里**自己再判一次 `code`**（`assertSmartLayerSuccess`），
     * 把页面本来依赖拦截器得到的那条失败语义补回来。
     *
     * 响应里真正的数组是 `results`（页面 `const { results } = await …`）。
     */
    async listTeacherTypes (): Promise<StudyTeacherTypeDictItem[]> {
      const body = await requestTeacher<unknown>({
        url: STUDY_TEACHER_TYPE_DICT_PATH,
        method: 'get',
        params: {
          type: STUDY_TEACHER_TYPE_DICT_TYPE,
          page: 1,
          pageSize: STUDY_TEACHER_TYPE_DICT_PAGE_SIZE,
        },
      })
      assertSmartLayerSuccess(body, '查询教师类型字典')
      const results = dictResultsOf(body)
      return results.map((item) => {
        const row = (item ?? {}) as Record<string, unknown>
        return { value: String(row.value ?? ''), label: String(row.label ?? '') }
      })
    },

    /**
     * 校验讲师类型表单，生成保存草稿（**不发请求**）。
     *
     * `mode` 决定端点：`create` → `insertTeacherLevel.lay`；`edit` → `updateTeacherLevel.lay`。
     * 与页面 `customSubmit` 的两个分支逐字对应。
     *
     * ⚠️ **与页面的一处已知差异**：页面在编辑态是把 bridge 里的**整行**（去掉 `createTime`/`updateTime`）
     * 回传，除这四个字段外还可能带 `status`；SDK 只发 `{id, name, level, sort}`。
     * 依据是这几项都是表单里真正有控件的字段，而 smart-layer 后端不在本仓库的两个固定检出内、
     * 无法核实它是否依赖行上的其它字段 —— 如实记在契约的 `gaps` 里。
     */
    prepareSaveLevel (input: { form: StudyTeacherLevelForm }): { draft: StudyTeacherLevelDraft } {
      return { draft: buildLevelDraft(input?.form) }
    },

    /**
     * 保存讲师类型（**写操作**）。请求形状与页面 `customSubmit` 一致：
     * `.lay` 端点、smart-layer-admin 实例、POST JSON body。
     *
     * ⚠️ 返回值**不含业务数据**：Portal 页面也不读它（保存成功只弹一句提示）。
     * 失败由 `code !== 200` 判定并抛出（见 `assertSmartLayerSuccess`），
     * 成功要靠 `listLevels` 回查确认（D12：接口返回成功不算验证）。
     *
     * ⚠️ 端点**没有防重键**，`insertTeacherLevel.lay` 重发会建出第二条同类型记录；
     * 超时先回查列表再决定，不要盲目重发。
     */
    async saveLevel (input: { draft: StudyTeacherLevelDraft }): Promise<void> {
      const draft = input?.draft as StudyTeacherLevelDraft | undefined
      if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) {
        throw new Error('讲师类型保存草稿必须是对象')
      }
      if (draft.mode !== 'create' && draft.mode !== 'edit') {
        throw new Error('讲师类型保存草稿.mode 只能是 create 或 edit')
      }
      const expected = draft.mode === 'create' ? STUDY_TEACHER_LEVEL_CREATE_PATH : STUDY_TEACHER_LEVEL_UPDATE_PATH
      if (draft.url !== expected) {
        throw new Error(
          `讲师类型保存草稿.url 与 mode 不匹配：mode=${draft.mode} 应打 ${expected}，收到 ${String(draft.url)}`,
        )
      }
      // 重新走一遍 prepare 的校验，避免调用方手搓一个绕过规则的草稿
      const body = buildLevelDraft({
        ...(draft.body as Record<string, unknown>),
        mode: draft.mode,
      } as StudyTeacherLevelForm).body
      const result = await requestLevel<unknown>({
        url: draft.url,
        method: 'post',
        data: body,
      })
      assertSmartLayerSuccess(result, draft.mode === 'create' ? '新建讲师类型' : '修改讲师类型')
    },

    /**
     * 校验评价设置的题目数组，生成保存草稿（**不发请求**）。
     *
     * 校验三条，全部来自页面或后端：
     * 1. 条数 `3~5`（后端 `saveInfo` 的硬限制；页面的「新增一项」在 5 就停）；
     * 2. `content` 必填、不能全是空格（页面 `validateOnlySpace`）；
     * 3. `content` ≤100 字（页面 `max: 100`）。
     *
     * **顺序即题号**：提交时按数组下标重排 `sort = index + 1`（页面 `onSubmit` 就是这么做的），
     * 调用方自己填的 `sort` 会被覆盖 —— 拖拽排序只体现在数组顺序上。
     */
    prepareSaveAppraiseSetting (input: { items: StudyAppraiseSettingItem[] }): {
      draft: StudyAppraiseSettingDraft
    } {
      return { draft: buildAppraiseDraft(input?.items) }
    },

    /**
     * 保存评价设置题目（**写操作**）。
     *
     * 请求形状与页面一致：`POST /study/base/studyappraiseteacher`，body 是**数组**，
     * 每项 `{sort, content}`。走 platform 实例（不加 `httpInstance`、不带 `isOriginal`）。
     *
     * ⚠️ 后端是**整份替换**：`saveInfo` 先把现有题目全部置 `is_del=1`，再按传入数组重插一遍。
     * 所以"只加一条"必须把**现有的全部**一起传回来。
     *
     * ⚠️ 页面会把读回来的整行（含 id/isDel/creator…）一起回传，SDK 只回传 `{sort, content}` ——
     * 后端只读这两个字段（`saveInfo` 里逐行 `setSort`/`setContent`，其余一律由后端填）。
     */
    async submitAppraiseSetting (input: { draft: StudyAppraiseSettingDraft }): Promise<void> {
      const draft = input?.draft as StudyAppraiseSettingDraft | undefined
      if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) {
        throw new Error('评价设置草稿必须是对象')
      }
      // 草稿同样重跑一遍规则校验（会重排 sort，保证题号与数组顺序一致）
      const prepared = buildAppraiseDraft(
        (Array.isArray(draft.items) ? draft.items : []).map((item) => ({ content: item?.content as string })),
      )
      await requestAppraise<unknown>({
        url: STUDY_APPRAISE_SETTING_SAVE_PATH,
        method: 'post',
        data: prepared.items,
      })
    },

    /**
     * 分页查询**讲师列表**。只读。
     *
     * ⚠️ 走 **smart-layer-admin** 实例（另一个 host），且用 `isOriginal` 拿整个响应体
     * —— 与页面上那一句 `smartLayerAdminHttp.get(…, { isOriginal: true })` 一致。
     * 返回的是**归一后**的 `{list, total}`，不是原始体。
     */
    // `async` 是**刻意**的：实例解析失败（没配 baseURL）时 `call` 是**同步抛**的，
    // 而本族的约定是走 Promise.reject（与 `baseSale` 的 `SaleNotWiredError` 一致）。
    // 不包这一层，`cap.list().catch(...)` 会漏掉那个错。
    async list (query: StudyTeacherQuery = {}): Promise<PageResult<StudyTeacherRow>> {
      const params: Record<string, unknown> = {
        order: '',
        orderField: '',
        name: query.name === undefined ? '' : query.name,
        page: query.page === undefined ? 1 : query.page,
        limit: query.limit === undefined ? DEFAULT_LIMIT : query.limit,
      }
      // ⚠️ `level` 只在**调用方真的给了**的时候才放进去：页面的初值是 undefined，
      // axios 默认序列化会把它整个丢掉 —— 空串反而会被发出去。实测基准里没有这一项。
      if (query.level !== undefined) params.level = query.level
      const body = await requestTeacher<unknown>({
        url: STUDY_TEACHER_LIST_PATH,
        method: 'get',
        params,
        isOriginal: true,
      })
      return fromPagedBody<StudyTeacherRow>(body)
    },

    /** 分页查询**讲师类型列表**。只读。同样走 smart-layer-admin + isOriginal */
    async listLevels (query: StudyTeacherLevelQuery = {}): Promise<PageResult<StudyTeacherLevelRow>> {
      const body = await requestLevel<unknown>({
        url: STUDY_TEACHER_LEVEL_LIST_PATH,
        method: 'get',
        params: { page: query.page === undefined ? 1 : query.page },
        isOriginal: true,
      })
      return fromPagedBody<StudyTeacherLevelRow>(body)
    },

    /**
     * 查询评价设置（讲师评价配置）列表。只读，**无参数**。
     *
     * 这一页不是列表页（`page-catalog` 把它归成「其他/自定义页面」）：它挂载时
     * `http.get(...)` 拿全部配置，再交给一个表单组件渲染。所以这里也不分页。
     */
    listAppraiseSettings (): Promise<StudyAppraiseSettingRow[]> {
      return requestAppraise<StudyAppraiseSettingRow[]>({
        url: STUDY_APPRAISE_SETTING_LIST_PATH,
        method: 'get',
      })
    },

    prepareSaveTeacher (input: { name: string }): { draft: SaveTeacherDraft } {
      return prepareSaveTeacherDraft(input)
    },

    async submitSaveTeacher (input: { draft: SaveTeacherDraft }): Promise<number> {
      const prepared = prepareSaveTeacherDraft(input?.draft)
      return requestSaveTeacher<number>({
        url: STUDY_TEACHER_SAVE_TEACHER_PATH,
        method: 'post',
        data: prepared.draft,
      })
    },

    prepareSave (input: { form: StudyTeacherForm }): { draft: StudyTeacherDraft } {
      return { draft: teacherFormDraftOf(input?.form) }
    },

    async save (input: { draft: StudyTeacherDraft }): Promise<void> {
      if (!input?.draft || !input.draft.professor || typeof input.draft.professor !== 'object' || Array.isArray(input.draft.professor)) throw new Error('讲师保存草稿必须包含 professor 对象')
      const draft = teacherFormDraftOf({ ...input?.draft.professor, mode: input?.draft.mode, videoIds: input?.draft.videoIds })
      let professor = draft.professor
      if (draft.mode === 'create' && (professor.staffCode === undefined || professor.staffCode === null || professor.staffCode === '')) {
        const staffCode = await requestSaveTeacher<number | string>({
          url: STUDY_TEACHER_SAVE_TEACHER_PATH,
          method: 'post',
          data: { name: String(professor.name) },
        })
        idsOf([staffCode], '外部讲师创建返回的工号')
        professor = { ...professor, staffCode }
      }
      const result = await requestTeacher<unknown>({
        url: draft.mode === 'create' ? STUDY_TEACHER_CREATE_PATH : STUDY_TEACHER_UPDATE_PATH,
        method: 'post',
        data: { professor, videoIds: draft.videoIds },
      })
      assertSmartLayerSuccess(result, draft.mode === 'create' ? '保存讲师' : '修改讲师')
    },

    prepareStatus (input: { id: string | number; currentStatus: number }): { draft: { id: string | number; status: 0 | 1 } } {
      const draft = binaryStatusDraftOf({ id: input?.id, status: input?.currentStatus }, '讲师状态')
      return { draft: { id: draft.id, status: draft.status === 0 ? 1 : 0 } }
    },

    async setStatus (input: { draft: { id: string | number; status: 0 | 1 } }): Promise<void> {
      const draft = binaryStatusDraftOf(input?.draft, '讲师状态草稿')
      const result = await requestTeacher<unknown>({ url: STUDY_TEACHER_STATUS_PATH, method: 'get', params: draft })
      assertSmartLayerSuccess(result, '变更讲师状态')
    },

    prepareRemove (input: { ids: Array<string | number> }): { ids: Array<string | number> } {
      return { ids: idsOf(input?.ids, '讲师 ID') }
    },

    async remove (input: { ids: Array<string | number> }): Promise<void> {
      await requestSaveTeacher({ url: STUDY_TEACHER_DELETE_PATH, method: 'delete', data: idsOf(input?.ids, '讲师 ID') })
    },

    prepareLevelStatus (input: { id: string | number; currentStatus: number }): { draft: { id: string | number; status: 0 | 1 } } {
      const draft = binaryStatusDraftOf({ id: input?.id, status: input?.currentStatus }, '讲师类型状态')
      return { draft: { id: draft.id, status: draft.status === 0 ? 1 : 0 } }
    },

    async setLevelStatus (input: { draft: { id: string | number; status: 0 | 1 } }): Promise<void> {
      const draft = binaryStatusDraftOf(input?.draft, '讲师类型状态草稿')
      const result = await requestLevel<unknown>({ url: STUDY_TEACHER_LEVEL_STATUS_PATH, method: 'post', data: draft })
      assertSmartLayerSuccess(result, '变更讲师类型状态')
    },

    prepareRemoveLevel (input: { id: string | number }): { id: string | number } {
      return { id: idsOf([input?.id], '讲师类型 ID')[0]! }
    },

    async removeLevel (input: { id: string | number }): Promise<void> {
      const id = idsOf([input?.id], '讲师类型 ID')[0]
      const result = await requestLevel<unknown>({ url: STUDY_TEACHER_LEVEL_DELETE_PATH, method: 'get', params: { id } })
      assertSmartLayerSuccess(result, '删除讲师类型')
    },

    cancelSave (): { cancelled: true } { return { cancelled: true } },
    cancelStatus (): { cancelled: true } { return { cancelled: true } },
    cancelRemove (): { cancelled: true } { return { cancelled: true } },
    cancelLevelStatus (): { cancelled: true } { return { cancelled: true } },
    cancelRemoveLevel (): { cancelled: true } { return { cancelled: true } },

    cancelSaveTeacher (): { cancelled: true } {
      return { cancelled: true }
    },
  }
}

export type StudyTeacherCapability = ReturnType<typeof createStudyTeacherCapability>
