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
 * 讲师创建页在没有 staffCode 时，先通过 platform 的 `saveTeacher` 辅助接口创建学员记录；
 * 讲师主体的后续 `.lay` 保存、编辑、删除以及讲师类型页的增删改仍未覆盖。
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
export const STUDY_TEACHER_MODULE_TYPE = 12

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

/** 讲师类型的查询条件：页面**只有一个分页参数** */
export type StudyTeacherLevelQuery = {
  page?: number
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
]

/** 页面能力 ID 与 SDK 方法名的固定映射；供目录和统一调用入口复用。 */
export const STUDY_TEACHER_METHODS = {
  'study-teacher-list': 'list',
  'study-teacher-level-list': 'listLevels',
  'study-appraise-setting-list': 'listAppraiseSettings',
  'study-teacher-prepare-save-teacher': 'prepareSaveTeacher',
  'study-teacher-save-teacher': 'submitSaveTeacher',
  'study-teacher-cancel-save-teacher': 'cancelSaveTeacher',
} as const

/**
 * 能力实现。
 *
 * `request` 由 SDK 门面注入：讲师那两页的页面上下文会解析成 `smart-layer-admin` 实例，
 * 所以调用方**必须**在 `httpBaseUrls` 里给它 baseURL，否则这里会失败关闭（conventions 27）。
 */
export function createStudyTeacherCapability (
  /** 讲师管理页 —— 调用方要保证它的请求带 `httpInstance: 'smart-layer-admin'` 与 `isOriginal: true` */
  requestTeacher: PortalRequest,
  /** 讲师类型页 —— 同上 */
  requestLevel: PortalRequest,
  /** 评价设置页（走 platform 实例） */
  requestAppraise: PortalRequest,
  /** saveTeacher 与评价设置同走 platform；单独可注入以便逐请求验证实例 */
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

    cancelSaveTeacher (): { cancelled: true } {
      return { cancelled: true }
    },
  }
}

export type StudyTeacherCapability = ReturnType<typeof createStudyTeacherCapability>
