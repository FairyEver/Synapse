import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

/**
 * 人工智能域「知识管理」下的两个页面。
 *
 * | 页面 | 菜单路径 | 接口 | 方法 |
 * | --- | --- | --- | --- |
 * | 知识空间 | `/dashboard/platform/intelligence/knowledge/document/workspace/list` | `/manager/knowledgeFile/*` | GET/POST/PUT/DELETE |
 * | 知识审核 | `/dashboard/platform/intelligence/knowledge/review/list` | `/manager/knowledgeChangeRecord/*` | GET/**PUT** |
 *
 * 路由文件：
 * - `app/portal/views/dashboard/platform/intelligence/knowledge/document/workspace/list.vue`
 *   （逻辑在**同目录**的 `use.js`，页面形态是**树 + 文档**，不是列表页）
 * - `app/portal/views/dashboard/platform/intelligence/knowledge/review/list.vue`
 *
 * 四件套记录：`docs/pages/知识空间.md`、`docs/pages/知识审核.md`
 *
 * ## 这些契约是什么级别的证据（别把「跑通了」读成「逐字段一致」）
 *
 * | 级别 | 覆盖到哪 |
 * | --- | --- |
 * | **真机实测**（2026-09-21，测试环境租户 1） | 九条接口全部打通：读的返回形状、写的 body/路径参数、`create → rename/取消 → move/取消 → setPermission/取消 → audit → remove → audit` 整条链（56 个请求，失败 0），数据全部 `SDK-TEST-` 前缀并在同一轮里清理干净 |
 * | **源码读出** | 参数顺序、空值发不发（`use.js` / `list.js` / `share.js`）、UI 侧的分支（`isAdmin` 才显示「权限设置」、根目录不能新建文档、搜索框是空壳） |
 * | **后端源码读出** | 校验与副作用（空目录不能删、`getAuditor` 找不到人就报错、`audit` 的两个方向的破坏性、`setPermission` 的三分支与级联） |
 * | **⚠️ 没有的** | **浏览器基准**：`baseline/ai-knowledge.browser.json` 在写这份文件时还不存在（另一个子代理在抓）。所以「**与浏览器逐字段一致**」这一条**目前没有独立证据** —— 真机验证证明的是「这套请求能打通后端」。逐条清单见两份逐页文档的「等基准才能写的断言」 |
 *
 * 本地检出落后线上 435 个提交（conventions 第 31 条），但派单方已逐文件 diff 过：
 * 这两页的路由文件与 `test/ai-knowledge.test.ts` 依赖的源码与线上**逐字节一致**。
 *
 * ---------------------------------------------------------------------------------------
 * 一、`permission` 字段：两页都有 **v1 / v2 两代权限码**，定义里用当前生效的 v2
 * ---------------------------------------------------------------------------------------
 *
 * Portal 当前菜单入口（`app/portal/menus/index.js` → `menus/mall.v2.js`）与路由文件用的是 v2：
 *
 * | 页面 | v1（旧菜单文件 `mall.js`） | v2（当前菜单 / 路由文件 `<route>` 的 `meta.permission`） |
 * | --- | --- | --- |
 * | 知识空间 | `/dashboard/platform/intelligence/knowledge/document/workspace` | `/dashboard/platform-v2/intelligence/knowledge/document/workspace` |
 * | 知识审核 | `/dashboard/platform/intelligence/knowledge/review` | `/dashboard/platform-v2/intelligence/knowledge/review` |
 *
 * 两代都写在这里，`CapabilityDefinition.permission` 取 **v2**（与当前菜单逐字一致，
 * `test/ai-knowledge.test.ts` 拿 `page-catalog.json` 钉着）。
 * `src/catalog/visibility.ts:122` 的归一化会把 `platform-v2` 折回 `platform`，所以两代是同一个页面。
 *
 * ---------------------------------------------------------------------------------------
 * 二、module-type：**不发**（conventions 第 2 条）
 * ---------------------------------------------------------------------------------------
 *
 * 两个页面路径在规则表里都匹配不到（`generated/page-catalog.json` 里这两条的
 * `moduleType` 都是 `null`）。浏览器在这些页面上同样不发这个头，SDK 保持沉默。
 * **不要给它编一个。**
 *
 * ---------------------------------------------------------------------------------------
 * 三、「知识空间」是树 + 文档界面：触发请求的方式是**进目录**，不是点查询
 * ---------------------------------------------------------------------------------------
 *
 * 页面没有分页、没有查询按钮。`use.js:83-103` 的 `actionRefreshCurrentView` 用
 * `parentId` 打一次 `/manager/knowledgeFile/list`，**在挂载时就会打一次**（`use.js:288`，
 * `parentId` 初值 0 = 根）。面包屑、返回上级、点目录、点后端的「移动到」弹窗里的树，
 * 走的都是同一个接口，只是 `parentId` 不同（`remove-modal/index.vue:44,75` 甚至把根和每一层
 * 各拉一次）。
 *
 * 接口**没有分页**：`KnowledgeFileMapper.xml` 的 `findList` 是
 * `where is_del = 0 and parent_id = #{parentId} order by type, name` —— 一次给全该层。
 * 所以本能力**没有** `pageNo` / `pageSize` 参数，也**不该**有（照抄隔壁列表页会凭空多两个参数）。
 *
 * ⚠️ 页面右上角那个「搜索文件」是**空壳**：`components/search-modal/index.vue` 的
 * `actionStart()` 函数体是空的（`@search` / `@focus` 都调它），**一个请求都不发**。
 * 所以「搜索文档」这件事在这一页上**用户做不到** ⇒ 本能力不提供（conventions 第 28 条同一精神）。
 * 后端 `findList` 其实认一个精确匹配的 `name`（`dto.name != null and dto.name != ''` → `name = #{dto.name}`），
 * 但页面从不发它，本能力也不开放（见两份逐页文档的「尚未覆盖」）。
 *
 * ---------------------------------------------------------------------------------------
 * 四、写链路：`prepare`（只读）→ `submit`（真写）→ `cancel`（撤销），逐条说清哪条腿是真的
 * ---------------------------------------------------------------------------------------
 *
 * 知识库**没有审批流**（不像会议室 / 请假单那样走 BPM），所以 conventions 第 13 条里
 * 「prepare 问后端这次要人工指定哪些审批人」这个具体职责在这两页上**不存在**。
 * 但「先读后写」这个形状是真的，只是读的那一半长得不一样 —— 逐条列：
 *
 * | 写 | prepare（只读） | submit | cancel（撤销） |
 * | --- | --- | --- | --- |
 * | 新建目录/文档 | `prepareCreate` → 读该层现有子项（查重名） | `createFolder` / `createFile` | **没有** —— 见下面「后端没有回滚这条路」 |
 * | 重命名 | 列表本身（`listChildren` 给出当前名字） | `rename` | `cancelRename` → 用**旧名字**再 `update` 一次 |
 * | 移动 | `prepareMove` → 读目标层（确认目标是目录、查同名） | `move` | `cancelMove` → 移回**原父目录** |
 * | 删 除 | 列表本身（确认这一层是空的） | `remove` | **没有** —— 同「新建」 |
 * | 权限设置 | `getPermission`（**整单替换**，必须先读当前值） | `setPermission` | `cancelSetPermission` → 把 `getPermission` 读到的旧值原样写回 |
 * | 审核（知识审核页） | 列表本身（`listRecords` 给出 `auditStatus` / `auditorId`） | `audit` | **没有** —— 审核是**终态**，后端无撤回接口 |
 *
 * ⚠️ **`cancelSetPermission` 的 `previous` 必须来自 `setPermission` 之前那次 `getPermission`。**
 * 事后回读的 `isAllManager` **不可信**（「全部用户」回读出来是 3 + 空数组，见 `getPermission` 的
 * 说明与 `docs/pages/知识空间.md` 的实测记录）。撤销要在同一轮里把读到的旧值留着。
 *
 * ### 后端没有回滚这条路（读 `KnowledgeFileServiceImpl` 源码得到的结论）
 *
 * `add` 做两件事：往 `zhdj_knowledge_file` 插一行（`audit_status = 2` 待审核）+ 往
 * `zhdj_knowledge_change_record` 插一条 `audit_type = 1(新建文件夹) / 4(新建文档)` 的待审记录。
 * 之后**没有**任何接口能删掉那条变更记录或恢复文件行 —— 唯一的出路是让审核人去
 * `PUT /manager/knowledgeChangeRecord/audit` 出一份决定。所以 `cancelCreate` **不存在**，
 * 不是没做，是做不出来。`remove` 同理（它本身也只是把最新那条待审记录的 `audit_type`
 * 改成 `3/6(删除)`，文件行仍在，`KnowledgeFileServiceImpl.delete` 的注释与代码都写着）。
 *
 * ### `audit` 的两个值都有**破坏性副作用**（读 `strategy/knowledge/**` 得到）
 *
 * - `auditStatus = 1`（通过）：`AuditDeleteFolder` **硬删**文件行 + 章节 + 权限行；
 *   `AuditMoveFolder` **顺带重写两个目录的权限**（7 种情况的分支）。
 * - `auditStatus = 3`（拒绝）：`AuditAddFolder` 会把文件**改名成
 *   `String(System.currentTimeMillis())`**（`AuditAddFolder.java` 里那行），不是删除、也不是保留原名。
 *
 * 所以 `audit` 只接受 `1` / `3`（页面上的「审核通过」/「审核拒绝」两个按钮就是这两个值），
 * 传 `2`（待审核）当场拒绝 —— 后端**不校验**这个值，传什么就存什么，那是纯粹写坏数据。
 *
 * ---------------------------------------------------------------------------------------
 * 五、长选项参数（conventions 第 11 条）：三处，都不照抄页面
 * ---------------------------------------------------------------------------------------
 *
 * | 参数 | 页面怎么取候选 | 本能力 |
 * | --- | --- | --- |
 * | `parentId` / `targetParentId`（知识空间） | 就是这棵树本身，一层一层展开 | `tree` + `lookup` 指回本页的读能力（**必须**一层一层走，没有「拉全量」的需求） |
 * | `authManagerIds` / `auditorId` | `portal-hxr-select-user`（跨页面的通用人员选择器） | `search` + `lookup` → `base-user-search`（强制要关键字） |
 * | `authRoleIds` | `portal-hxr-select-role-by-system`（跨页面的通用角色选择器） | `text`（逗号串）+ 描述里写明**没有候选入口**（SDK 里没有角色检索能力） |
 *
 * `permission-modal/index.vue:87` 的 `GET /manager/knowledgeFile/getPermission/{id}` 是**只读**的，
 * 单独做成了 `ai-knowledge-workspace-permission-get`：它既是给 AI 看当前权限的入口，
 * 也是 `setPermission`（整单替换）的 prepare 那一半。
 */

// ---------------------------------------------------------------------------
// 页面路径与权限码
// ---------------------------------------------------------------------------

export const AI_KNOWLEDGE_WORKSPACE_PAGE_PATH =
  '/dashboard/platform/intelligence/knowledge/document/workspace/list'
export const AI_KNOWLEDGE_REVIEW_PAGE_PATH = '/dashboard/platform/intelligence/knowledge/review/list'

/** 生效权限码（`menus/index.js` 加载的 `menus/mall.v2.js` 与路由文件 `<route>` 一致）。 */
export const AI_KNOWLEDGE_WORKSPACE_PERMISSION = '/dashboard/platform-v2/intelligence/knowledge/document/workspace'
export const AI_KNOWLEDGE_REVIEW_PERMISSION = '/dashboard/platform-v2/intelligence/knowledge/review'

/** 显式保留 v2 别名，便于排障代码按 Portal 的版本命名引用。 */
export const AI_KNOWLEDGE_WORKSPACE_PERMISSION_V2 = AI_KNOWLEDGE_WORKSPACE_PERMISSION
export const AI_KNOWLEDGE_REVIEW_PERMISSION_V2 = AI_KNOWLEDGE_REVIEW_PERMISSION

/** 旧菜单文件里的 v1 权限码，仅用于历史基准对照，不接入能力定义。 */
export const AI_KNOWLEDGE_WORKSPACE_PERMISSION_V1 = '/dashboard/platform/intelligence/knowledge/document/workspace'
export const AI_KNOWLEDGE_REVIEW_PERMISSION_V1 = '/dashboard/platform/intelligence/knowledge/review'

const VIEWS = 'app/portal/views/dashboard/platform/intelligence/knowledge'

/** 路由文件，写进文档与排障时用得上 */
export const AI_KNOWLEDGE_ROUTE_FILES = {
  workspace: `${VIEWS}/document/workspace/list.vue`,
  /** 知识空间页面的**全部逻辑**都在同目录的这个 `use.js` 里，`list.vue` 只是个壳 */
  workspaceUse: `${VIEWS}/document/workspace/use.js`,
  review: `${VIEWS}/review/list.vue`,
  /** 审核弹窗（`auditType` 不是 7/8/9 时用它，见 `review/list.vue:158-180`） */
  reviewModal: `${VIEWS}/review/components/review.vue`,
  /**
   * 审核提交的**共享函数**。`review/list.vue:94` 与 `components/review.vue:63` 都从这里 import，
   * 它实际打的是 `PUT /manager/knowledgeChangeRecord/audit`（见下面 `audit` 的说明）——
   * **只看调用点会以为它是另一个接口**。
   */
  reviewSubmit: 'app/portal/components/portal/platform/document/utils/share.js',
  /** 审核类型 / 审核状态的枚举与标签（11 + 3 个值），本文件逐字照抄 */
  reviewDefine: 'app/portal/components/portal/platform/document/utils/define.js',
} as const

// ---------------------------------------------------------------------------
// 接口
// ---------------------------------------------------------------------------

/**
 * 知识空间（`KnowledgeFileController`，`@RequestMapping("/manager/knowledgeFile")`）。
 *
 * ⚠️ 路径按**页面源码原样**写成 `/manager/...`（不带 `/admin-api`）：
 * `platform.js:18-20` 的拦截器会补上前缀，SDK 的 `applyUrlRewrite` 同样补
 * （`src/context/http-instance.ts` 的 `platform` 画像）。**不要**在这里手写 `/admin-api`，
 * 那会走 passthrough 分支、结果虽然一样，但就不是「复刻拦截器」了。
 */
export const KNOWLEDGE_FILE_LIST_PATH = '/manager/knowledgeFile/list'
export const KNOWLEDGE_FILE_ADD_PATH = '/manager/knowledgeFile/add'
export const KNOWLEDGE_FILE_UPDATE_PATH = '/manager/knowledgeFile/update'
/** 后面接 `/{id}`（`@DeleteMapping("/delete/{id}")`，`@PathVariable`） */
export const KNOWLEDGE_FILE_DELETE_PATH = '/manager/knowledgeFile/delete'
/** 后面接 `/{fromFileId}/{targetFileId}`（`@PostMapping("/move/{fromFileId}/{targetFileId}")`） */
export const KNOWLEDGE_FILE_MOVE_PATH = '/manager/knowledgeFile/move'
/** 后面接 `/{id}`（`@GetMapping("/getPermission/{id}")`） */
export const KNOWLEDGE_FILE_GET_PERMISSION_PATH = '/manager/knowledgeFile/getPermission'
export const KNOWLEDGE_FILE_SET_PERMISSION_PATH = '/manager/knowledgeFile/setPermission'

/** 知识审核（`KnowledgeChangeRecordController`，`@RequestMapping("/manager/knowledgeChangeRecord")`） */
export const KNOWLEDGE_CHANGE_RECORD_LIST_PATH = '/manager/knowledgeChangeRecord/list'
export const KNOWLEDGE_CHANGE_RECORD_AUDIT_PATH = '/manager/knowledgeChangeRecord/audit'

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

// ---------------------------------------------------------------------------
// 枚举：逐字照抄 `app/portal/components/portal/platform/document/utils/define.js`
// ---------------------------------------------------------------------------

/** 节点类型（`document/workspace/define.js:1-2`，后端 `KnowledgeEnum` 里没有这一对，是文件表自己的约定） */
export const KNOWLEDGE_FILE_TYPE_FOLDER = 1
export const KNOWLEDGE_FILE_TYPE_DOCUMENT = 2

export const KNOWLEDGE_FILE_TYPE_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '文件夹', value: KNOWLEDGE_FILE_TYPE_FOLDER },
  { label: '文档', value: KNOWLEDGE_FILE_TYPE_DOCUMENT },
]

/** 审核状态（`define.js:57-71`）。**1 通过 / 2 待审 / 3 拒绝** */
export const AUDIT_STATUS_PENDING = 2
export const AUDIT_STATUS_SUCCESS = 1
export const AUDIT_STATUS_FAILED = 3

export const AUDIT_STATUS_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '待审核', value: AUDIT_STATUS_PENDING },
  { label: '审核成功', value: AUDIT_STATUS_SUCCESS },
  { label: '审核失败', value: AUDIT_STATUS_FAILED },
]

/**
 * 审核类型（`define.js:1-49` 与后端 `KnowledgeEnum` **两边一致**，11 个值）。
 *
 * ⚠️ 顺序照抄前端的 `AUDIT_TYPE_OPTIONS`（10 与 11 **排在最后**，与后端枚举的定义顺序相反）——
 * 下拉里的顺序就是用户看到的顺序。
 */
export const AUDIT_TYPE_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '新建文件夹', value: 1 },
  { label: '修改文件夹', value: 2 },
  { label: '删除文件夹', value: 3 },
  { label: '新建文档', value: 4 },
  { label: '修改文档', value: 5 },
  { label: '删除文档', value: 6 },
  { label: '新建章节', value: 7 },
  { label: '修改章节', value: 8 },
  { label: '删除章节', value: 9 },
  { label: '移动文档', value: 10 },
  { label: '移动文件夹', value: 11 },
]

/** 章节类的三种审核类型（`review/list.vue:159`）。这三种**不在弹窗里审**，而是跳到文章审核页 */
export const AUDIT_TYPE_CHAPTER = [7, 8, 9] as const

// ---------------------------------------------------------------------------
// 形状
// ---------------------------------------------------------------------------

/**
 * 知识空间里的一个节点（一层目录里的一项）。
 *
 * 页面自己只留 4 个字段（`use.js:92-97` 的 `raw => ({id, type, name, updateTime})`）；
 * 本能力**多留三个**：`parentId`（`use.js` 把它扔了，但它是判断「这一项在哪一层」的唯一依据）、
 * `auditStatus` / `auditorId`（待审核状态在这一页上**没有任何 UI**，而那正是「为什么我刚建的东西
 * 名字没变」的答案）。三个都不是敏感字段。
 */
export type KnowledgeNode = {
  /** 后端是 `Long`，实测必须是数字 id（路径参数，传字符串形式的非数字会 400） */
  id: number | string
  /** 1 文件夹 / 2 文档 */
  type: number
  name: string
  /** 上级 id。根层的节点是 0 */
  parentId?: number | string
  /** 1 通过 / 2 待审 / 3 拒绝 */
  auditStatus?: number
  /** 这一项的审核人（后端 `getAuditor` 一层层向上找到的那个），可能为 null */
  auditorId?: number | string | null
  createTime?: string | null
  updateTime?: string | null
  [key: string]: unknown
}

/** `GET /manager/knowledgeFile/list` 的返回（**不是分页**，见文件头第三节） */
export type KnowledgeChildren = {
  /** 当前登录人是否「知识空间管理员」角色（后端按角色名 `知识空间管理员` 判，见 `KnowledgeFileServiceImpl.list`） */
  isAdmin: boolean
  /** 这一层的全部节点，后端按 `type, name` 排序 */
  list: KnowledgeNode[]
}

/** `GET /manager/knowledgeFile/getPermission/{id}` 的返回 */
export type KnowledgePermission = {
  /** 1 全部用户 / 2 指定角色 / 3 指定用户。注意它是后端**回显时推出来的**（见下） */
  isAllManager?: number | null
  /** 指定审核人。可能是 null（表示「向上找」） */
  auditorId?: number | string | null
  /** 有角色权限时才有这一项（后端 `getByFileId` 非空才 put） */
  authRoleIds?: Array<number | string> | null
  /** 有用户权限时才有这一项（**`managerId = 0` 那条「全部用户」会被过滤掉**，所以「全部用户」时这里是空数组） */
  authManagerIds?: Array<number | string> | null
  [key: string]: unknown
}

/** 一条待审/已审的变更记录（`KnowledgeChangeRecordVO`）。字段名以后端 VO 为准 */
export type KnowledgeChangeRecord = {
  id: number | string
  /** 被改的那个文件/文件夹 id。审核时要用的不是这个，是记录自己的 `id` */
  knowledgeId?: number | string
  /** 同一行的别名：`selectByPage` 把 `a.file_id` 也查出来了 */
  fileId?: number | string
  submitterId?: number | string
  submitterName?: string | null
  auditorId?: number | string | null
  auditorName?: string | null
  submitTime?: string | null
  auditTime?: string | null
  /** 审核状态：1 通过 / 2 待审 / 3 拒绝 */
  auditStatus?: number
  /** 审核类型，取值见 `AUDIT_TYPE_OPTIONS` */
  auditType?: number
  /** 1 文件/文件夹 / 2 章节 */
  knowledgeType?: number
  /** 新内容。**重命名的目标名字就存在这里** —— 文件行的 `name` 审核通过前不会变，见 `docs/pages/知识空间.md` */
  newContent?: string | null
  newHeading?: string | null
  newBlocks?: string | null
  /** join 出来的文件名（`zkf1.name`） */
  fileName?: string | null
  /** join 出来的上级目录名（`zkf2.name`） */
  parentFileName?: string | null
  [key: string]: unknown
}

/** 权限设置的载荷。三个 id 类字段页面是**逗号串**（`permission-modal/index.vue:133-135`） */
export type KnowledgePermissionDraft = {
  id: number | string
  /** 1 全部用户 / 2 指定角色 / 3 指定用户 */
  isAllManager: number
  /**
   * 指定用户 id（多选）。数组会被**逗号拼起来**（页面就是 `.join(',')`）。
   * 只有 `isAllManager === 3` 时才发，其余一律发 `null`（页面行为，逐字照抄）。
   */
  authManagerIds?: Array<number | string> | string | null
  /** 指定角色 id（多选）。只有 `isAllManager === 2` 时才发，其余发 `null` */
  authRoleIds?: Array<number | string> | string | null
  /** 指定审核人。页面不判空、原样发（`permission-modal/index.vue:135`） */
  auditorId?: number | string | null
}

// ---------------------------------------------------------------------------
// 参数装配
// ---------------------------------------------------------------------------

/**
 * 按契约里的**固定顺序**拼参数。键序就是 qs 序列化后的 URL 顺序，
 * 不同也算法不一致（D20）。空串照发、`null` 被 `skipNulls` 丢掉。
 */
function buildOrdered (
  order: ReadonlyArray<{ name: string; defaultValue: unknown }>,
  query: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const item of order) {
    const value = query[item.name]
    params[item.name] = value === undefined ? item.defaultValue : value
  }
  return params
}

/**
 * 知识审核列表的参数顺序。
 *
 * `useListPageModule` 的 `logicFetch`（`list.js:469-482`）先拼
 * `{ order, orderField, ...convertFetchForm(formState) }`，再追加 `pageNo` / `pageSize`。
 * `convertFetchForm`（`review/list.vue:146-152`）做的是
 * `omit(form, ['submitTime'])` 再补 `submitStartTime` / `submitEndTime` ——
 * 所以那两项排在**表单原有 6 项之后、分页之前**，不是插在中间。
 *
 * 表单 6 项的初值全是 `null`（`review/list.vue:112-118`），被 `skipNulls` 丢掉 ⇒
 * 页面刚打开时浏览器只发 `order=&orderField=&pageNo=1&pageSize=20&_t=`。
 *
 * ⚠️ `order` / `orderField` 是**空串**，不会被丢掉，**一定会发**。
 */
const REVIEW_LIST_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'parentFileName', defaultValue: null },
  { name: 'fileName', defaultValue: null },
  { name: 'submitterName', defaultValue: null },
  { name: 'auditStatus', defaultValue: null },
  { name: 'auditorName', defaultValue: null },
  { name: 'auditType', defaultValue: null },
  { name: 'submitStartTime', defaultValue: null },
  { name: 'submitEndTime', defaultValue: null },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/** 数组或逗号串 → 逗号串（页面是 `arr.join(',')`）；空 / null 一律给 `null` 好让 qs 丢掉 */
function joinIds (value: Array<number | string> | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.length === 0 ? null : value.join(',')
  const text = String(value).trim()
  return text === '' ? null : text
}

/** id 归一成**字符串**只用于报错与校验；发给后端的保持调用方给的类型（路径参数原样拼） */
function assertId (value: unknown, label: string): string {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error(`${label}不能为空`)
  }
  return String(value).trim()
}

function assertName (value: unknown, label: string): string {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error(`${label}不能为空（页面的新建/重命名弹窗在名字为空时会拦住不提交）`)
  }
  return String(value)
}

// ---------------------------------------------------------------------------
// 参数表
// ---------------------------------------------------------------------------

function text (name: string, description: string, required = false): ParamSpec {
  return { name, kind: 'text', required, description }
}

/** 组织/目录类长选项：候选就是这棵树本身，必须一层一层走（conventions 第 11 条） */
const PARENT_LOOKUP = { capabilityId: 'ai-knowledge-workspace-list', keywordParam: 'parentId' } as const

const PARENT_ID_PARAM: ParamSpec = {
  name: 'parentId',
  kind: 'tree',
  required: true,
  description:
    '目录节点 id，**根是 0**（页面的 `parentId` 初值就是 0，挂载时打的就是 `parentId=0`）。' +
    '候选就是这棵树本身：用 ai-knowledge-workspace-list 一层层展开，没有「一次拉全量」的入口',
  lookup: PARENT_LOOKUP,
}

const WORKSPACE_LIST_PARAMS: ParamSpec[] = [PARENT_ID_PARAM]

const PERMISSION_GET_PARAMS: ParamSpec[] = [
  {
    name: 'id',
    kind: 'tree',
    required: true,
    description:
      '节点 id。**只读**，实现里既是查当前权限的入口，也是 ai-knowledge-workspace-set-permission（整单替换）的 prepare',
    lookup: PARENT_LOOKUP,
  },
]

const CREATE_PARAMS: ParamSpec[] = [
  {
    name: 'type',
    kind: 'enum',
    required: true,
    description: '1 文件夹 / 2 文档。页面是两个按钮，打的**是同一个接口**（`use.js:126` 与 `:164`）',
    options: KNOWLEDGE_FILE_TYPE_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
  },
  text('name', '新节点的名字。⚠️ 后端与页面**都不查重名**，同一层可以建出两个同名项', true),
  PARENT_ID_PARAM,
]

const RENAME_PARAMS: ParamSpec[] = [
  {
    name: 'id',
    kind: 'tree',
    required: true,
    description: '要改名的节点 id，来自 ai-knowledge-workspace-list',
    lookup: PARENT_LOOKUP,
  },
  text('name', '新名字。⚠️ 文件行的名字**不会立刻变**，见 docs/pages/知识空间.md', true),
]

const MOVE_PARAMS: ParamSpec[] = [
  {
    name: 'id',
    kind: 'tree',
    required: true,
    description: '要移动的节点 id（页面里是「移动到」弹窗选中的那一项）',
    lookup: PARENT_LOOKUP,
  },
  {
    name: 'targetParentId',
    kind: 'tree',
    required: true,
    description:
      '目标目录 id（根是 0）。⚠️ 后端**不校验**目标是不是目录 —— 移到一份文档底下它照样成功，' +
      '用 ai-knowledge-workspace-list 确认目标的 type 是 1 再移',
    lookup: PARENT_LOOKUP,
  },
]

const REMOVE_PARAMS: ParamSpec[] = [
  {
    name: 'id',
    kind: 'tree',
    required: true,
    description:
      '要删除的节点 id。⚠️ 后端**先检查目录是否为空**（`KnowledgeFileServiceImpl.delete`：' +
      '「该文件夹不为空，不能删除」），而且这条删除只是**提了一条待审记录**，文件行仍在',
    lookup: PARENT_LOOKUP,
  },
]

const SET_PERMISSION_PARAMS: ParamSpec[] = [
  {
    name: 'id',
    kind: 'tree',
    required: true,
    description: '目标节点 id。**整单替换**：三个 id 字段里没被选中的那些要显式发 `null`，见下',
    lookup: PARENT_LOOKUP,
  },
  {
    name: 'isAllManager',
    kind: 'enum',
    required: true,
    description:
      '权限范围。1 全部用户 / 2 指定角色 / 3 指定用户。' +
      '⚠️ 后端三分支是 if/else：`isAllManager === 1` 走「全部用户」，' +
      '否则看 `authManagerIds` 非空走「指定用户」，**再否则无条件走 `authRoleIds.split(",")`** —— ' +
      '两个都没给时后端会 NPE。本能力按 `isAllManager` 决定发哪一个，另一个发 `null`',
    options: [
      { label: '全部用户', value: 1 },
      { label: '指定角色', value: 2 },
      { label: '指定用户', value: 3 },
    ],
  },
  {
    name: 'authManagerIds',
    kind: 'search',
    required: false,
    description:
      '指定用户 id（可多个；数组会被逗号拼成字符串，与页面 `.join(",")` 一致）。' +
      '**只有 `isAllManager=3` 时才发**，其余发 `null`。' +
      '⚠️ 页面用跨页面的通用人员选择器（`portal-hxr-select-user`），候选是**全量**的；' +
      '本能力要求先用关键字检索（conventions 第 11 条）',
    lookup: { capabilityId: 'base-user-search', keywordParam: 'keyword' },
  },
  {
    name: 'authRoleIds',
    kind: 'text',
    required: false,
    description:
      '指定角色 id（可多个，逗号串或数组）。**只有 `isAllManager=2` 时才发**，其余发 `null`。' +
      '⚠️ **本能力不提供角色候选入口**：页面用的是跨页面的通用角色选择器' +
      '（`portal-hxr-select-role-by-system :use-system="SYSTEM_PLATFORM_VALUE"`），' +
      'SDK 里没有对应的检索能力，角色 id 要调用方自己给',
  },
  {
    name: 'auditorId',
    kind: 'search',
    required: false,
    description:
      '指定这一项的审核人。⚠️ 页面**不做任何校验**、原样发（`null` 也发，它会让后端跳过那次 update）；' +
      '发一个值则会改写 `zhdj_knowledge_file.auditor_id`，影响**之后**新建/移动时 `getAuditor` 找谁审。' +
      '候选走 base-user-search',
    lookup: { capabilityId: 'base-user-search', keywordParam: 'keyword' },
  },
]

const REVIEW_LIST_PARAMS: ParamSpec[] = [
  text('parentFileName', '上级目录名，后端是 `like concat(#{}, \'%\')`（**前缀匹配**）'),
  text('fileName', '文档/文件夹名，**前缀匹配**'),
  text('submitterName', '提交人姓名，**前缀匹配**（`c.real_name like concat(#{}, \'%\')`）'),
  text('auditorName', '审核人姓名，**前缀匹配**'),
  {
    name: 'auditStatus',
    kind: 'enum',
    required: false,
    description: '审核状态，精确匹配。**待办箱就靠 `auditStatus=2`**',
    options: AUDIT_STATUS_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
  },
  {
    name: 'auditType',
    kind: 'enum',
    required: false,
    description: '审核类型，精确匹配。下拉顺序照抄前端（移动那两项在最后）',
    options: AUDIT_TYPE_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
  },
  {
    name: 'submitStartTime',
    kind: 'date',
    required: false,
    description:
      '提交时间起 `YYYY-MM-DD HH:mm:ss`，后端 `a.submit_time >= #{...}`。' +
      '页面上是一个 `a-range-picker show-time`（`value-format="YYYY-MM-DD HH:mm:ss"`），' +
      '提交前被 `convertFetchForm` 拆成起止两项；⚠️ **不是**别处那种「结束日 +1 天」的开区间，' +
      '两个值就是用户选的那两个时刻',
  },
  {
    name: 'submitEndTime',
    kind: 'date',
    required: false,
    description: '提交时间止 `YYYY-MM-DD HH:mm:ss`，后端 `a.submit_time <= #{...}`（**闭区间**）',
  },
  {
    name: 'pageNo',
    kind: 'number',
    required: false,
    description:
      '页码，默认 1。⚠️ 后端这个接口的 `pageNo` / `pageSize` 是**独立的 `@RequestParam(defaultValue)`**，' +
      '默认 1 / 10；本能力按页面的 `styleV2` 给 20',
  },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

const AUDIT_PARAMS: ParamSpec[] = [
  {
    name: 'id',
    kind: 'number',
    required: true,
    description:
      '**变更记录的 id**（`zhdj_knowledge_change_record.id`），来自 ai-knowledge-review-list 的 `id`。' +
      '⚠️ **不是** `fileId` / `knowledgeId` —— 传错那一个后端 `selectByPrimaryKey` 会取到 null 然后 NPE 报 500',
  },
  {
    name: 'auditStatus',
    kind: 'enum',
    required: true,
    description:
      '1 通过 / 3 拒绝（页面上的两个按钮）。⚠️ **两个值都有破坏性副作用**：' +
      '通过一条「删除」记录会**硬删**文件；拒绝一条「新建」记录会把文件**改名成当前时间戳**。' +
      '传 2（待审核）当场拒绝：后端不校验这个值，传什么存什么',
    options: [
      { label: '审核成功', value: AUDIT_STATUS_SUCCESS },
      { label: '审核失败', value: AUDIT_STATUS_FAILED },
    ],
  },
]

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

export const aiKnowledgeCapabilities: CapabilityDefinition[] = [
  {
    id: 'ai-knowledge-workspace-list',
    title: '知识空间：展开一层目录（读该层的文件夹与文档）',
    pagePath: AI_KNOWLEDGE_WORKSPACE_PAGE_PATH,
    permission: AI_KNOWLEDGE_WORKSPACE_PERMISSION,
    write: false,
    params: WORKSPACE_LIST_PARAMS,
  },
  {
    id: 'ai-knowledge-workspace-permission-get',
    title: '知识空间：读一个节点的当前权限（也是设置权限的 prepare）',
    pagePath: AI_KNOWLEDGE_WORKSPACE_PAGE_PATH,
    permission: AI_KNOWLEDGE_WORKSPACE_PERMISSION,
    write: false,
    params: PERMISSION_GET_PARAMS,
  },
  {
    id: 'ai-knowledge-workspace-create',
    title: '知识空间：新建目录 / 新建文档（同一接口，靠 type 区分）',
    pagePath: AI_KNOWLEDGE_WORKSPACE_PAGE_PATH,
    permission: AI_KNOWLEDGE_WORKSPACE_PERMISSION,
    write: true,
    params: CREATE_PARAMS,
  },
  {
    id: 'ai-knowledge-workspace-rename',
    title: '知识空间：重命名文件夹 / 文档（撤销：用新名字再调一次）',
    pagePath: AI_KNOWLEDGE_WORKSPACE_PAGE_PATH,
    permission: AI_KNOWLEDGE_WORKSPACE_PERMISSION,
    write: true,
    params: RENAME_PARAMS,
  },
  {
    id: 'ai-knowledge-workspace-move',
    title: '知识空间：把文件夹 / 文档移动到另一个目录（撤销：移回原父目录）',
    pagePath: AI_KNOWLEDGE_WORKSPACE_PAGE_PATH,
    permission: AI_KNOWLEDGE_WORKSPACE_PERMISSION,
    write: true,
    params: MOVE_PARAMS,
  },
  {
    id: 'ai-knowledge-workspace-remove',
    title: '知识空间：删除文件夹 / 文档（只是提交一条待审记录，**不可撤销**）',
    pagePath: AI_KNOWLEDGE_WORKSPACE_PAGE_PATH,
    permission: AI_KNOWLEDGE_WORKSPACE_PERMISSION,
    write: true,
    params: REMOVE_PARAMS,
  },
  {
    id: 'ai-knowledge-workspace-set-permission',
    title: '知识空间：设置节点的读写权限与审核人（整单替换，先读后写）',
    pagePath: AI_KNOWLEDGE_WORKSPACE_PAGE_PATH,
    permission: AI_KNOWLEDGE_WORKSPACE_PERMISSION,
    write: true,
    params: SET_PERMISSION_PARAMS,
  },
  {
    id: 'ai-knowledge-review-list',
    title: '知识审核：分页查询知识变更记录（待办箱用 auditStatus=2）',
    pagePath: AI_KNOWLEDGE_REVIEW_PAGE_PATH,
    permission: AI_KNOWLEDGE_REVIEW_PERMISSION,
    write: false,
    params: REVIEW_LIST_PARAMS,
  },
  {
    id: 'ai-knowledge-review-audit',
    title: '知识审核：审核通过 / 拒绝一条变更记录（**终态，不可撤回**）',
    pagePath: AI_KNOWLEDGE_REVIEW_PAGE_PATH,
    permission: AI_KNOWLEDGE_REVIEW_PERMISSION,
    write: true,
    params: AUDIT_PARAMS,
  },
]

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

/** 两个 `prepare` 的返回形状：只回答「按下去会发生什么」，不发任何写请求 */
export type KnowledgePrepareResult = {
  /** 目标目录 id */
  parentId: number | string
  /** 目标目录下已有的节点（`prepareCreate` / `prepareMove` 都是同一份读） */
  siblings: KnowledgeNode[]
  /**
   * 目标目录下**有没有同名项**（只在调用方给了 `name` 时才算）。
   * ⚠️ 这是 **SDK 侧**的提示，不是后端约束：后端与页面都不查重，重名会真的建出两条。
   */
  duplicateName: boolean
  /** 当前登录人是不是知识空间管理员 */
  isAdmin: boolean
}

/**
 * 造这两个页面的能力实现。
 *
 * `requestWorkspace` / `requestReview` 由 SDK 门面注入，各带各的页面上下文
 * （这两个页面都匹配不到 module-type 规则 ⇒ 都不发这个头）。
 *
 * ⚠️ **两个 request 不能合并**：能力与页面的绑定是调度单位（设计 H2），
 * 拿 workspace 的 request 去打 review 的接口会让错误归因指向错的页面。
 */
export function createAiKnowledgeCapability (
  /** 知识空间页（`/dashboard/platform/intelligence/knowledge/document/workspace/list`） */
  requestWorkspace: PortalRequest,
  /** 知识审核页（`/dashboard/platform/intelligence/knowledge/review/list`） */
  requestReview: PortalRequest,
) {
  /** 读一层目录。`prepareCreate` / `prepareMove` 与 `listChildren` 用的是同一次读 */
  async function listChildren (query: { parentId: number | string }): Promise<KnowledgeChildren> {
    const parentId = query?.parentId
    assertId(parentId, 'parentId（根目录传 0）')
    const payload = await requestWorkspace<{ isAdmin?: unknown; list?: unknown }>({
      url: KNOWLEDGE_FILE_LIST_PATH,
      method: 'get',
      // 页面的 params 只有这一项（`use.js:87-89`），`_t` 由实例拦截器补
      params: { parentId },
    })
    const rows = Array.isArray(payload?.list) ? payload.list : []
    return {
      isAdmin: payload?.isAdmin === true,
      list: rows as KnowledgeNode[],
    }
  }

  /** 从一份 `listChildren` 的结果里挑出同名的（查重用） */
  function hasDuplicate (siblings: KnowledgeNode[], name: string): boolean {
    const target = String(name)
    return siblings.some((node) => String(node?.name ?? '') === target)
  }

  async function prepare (
    parentId: number | string,
    name?: string,
  ): Promise<KnowledgePrepareResult> {
    const { isAdmin, list } = await listChildren({ parentId })
    return {
      parentId,
      siblings: list,
      duplicateName: name === undefined ? false : hasDuplicate(list, name),
      isAdmin,
    }
  }

  /** 权限设置的公共实现：`setPermission` 与 `cancelSetPermission` 都走它（撤销就是把旧值原样写回） */
  function submitPermission (draft: KnowledgePermissionDraft): Promise<unknown> {
    assertId(draft?.id, 'id（要设权限的节点 id）')
    const isAllManager = draft?.isAllManager
    if (isAllManager !== 1 && isAllManager !== 2 && isAllManager !== 3) {
      return Promise.reject(
        new Error(
          `isAllManager 只能是 1 全部用户 / 2 指定角色 / 3 指定用户，收到的是 ${JSON.stringify(isAllManager)}。` +
            '后端按这三个值走 if / else-if / else 三条分支，别的值会掉进最后那条 `authRoleIds.split(",")`。',
        ),
      )
    }
    const authManagerIds = isAllManager === 3 ? joinIds(draft.authManagerIds) : null
    const authRoleIds = isAllManager === 2 ? joinIds(draft.authRoleIds) : null
    if (isAllManager === 3 && authManagerIds === null) {
      return Promise.reject(new Error('isAllManager = 3（指定用户）时必须给 authManagerIds'))
    }
    if (isAllManager === 2 && authRoleIds === null) {
      return Promise.reject(new Error('isAllManager = 2（指定角色）时必须给 authRoleIds'))
    }
    return requestWorkspace({
      url: KNOWLEDGE_FILE_SET_PERMISSION_PATH,
      method: 'put',
      data: {
        id: draft.id,
        isAllManager,
        authManagerIds,
        authRoleIds,
        // 页面不判空、原样发（null 也发，后端 `if (auditorId != null)` 会跳过）
        auditorId: draft.auditorId === undefined ? null : draft.auditorId,
      },
    })
  }

  return {
    // -----------------------------------------------------------------------
    // 读
    // -----------------------------------------------------------------------

    /**
     * 展开一层目录（**只读**）。页面的挂载、面包屑、返回上级、点目录、移动到弹窗里的树，
     * 走的都是它（`use.js:86`、`remove-modal/index.vue:44,75`）。
     *
     * ⚠️ 接口**没有分页**，一次给全该层；返回的 `list` 里也**没有** `total`。
     * 后端按 `type, name` 排序（`KnowledgeFileMapper.xml` 的 `findList`），不是按时间。
     */
    listChildren,

    /**
     * 读一个节点的当前权限（**只读**）。页面的「权限设置」弹窗一打开就调它
     * （`permission-modal/index.vue:87` 的 `loadData`）。
     *
     * 它同时是 `setPermission`（整单替换）的 **prepare**：PUT 打的是整份权限，
     * 不先读一次就写等于把没提到的那些权限静默清掉。
     *
     * ⚠️⚠️ **返回里的 `isAllManager` 不能当成"当前权限范围"读。** 它是**后端推出来的近似值**
     * （`KnowledgeFileServiceImpl.getPermission`：有角色权限行 → 置 2、有用户权限行 → 置 3），
     * 而 `setPermission` **从来不更新** `zhdj_knowledge_file.is_all_manager` 这个列。
     *
     * 2026-09-21 真机实测（同一个节点、连续三次读）：
     *
     * ```text
     * 新建后                → {auditorId: null, isAllManager: 3, authManagerIds: [18243]}
     * setPermission(全部用户) 后 → {auditorId: null, isAllManager: 3, authManagerIds: []}   ← 不是 1
     * 写回旧值后             → {auditorId: null, isAllManager: 3, authManagerIds: [18243]}
     * ```
     *
     * 原因：「全部用户」存的是 `manager_id = 0` 那一行，它被
     * `filter(kfm -> kfm.getManagerId() != 0)` 过滤掉（所以数组是空的），
     * 但 `knowledgeFileManagers` 本身非空 ⇒ 仍然 `put("isAllManager", 3)`。
     * ⇒ **「全部用户」与「指定用户但一个都没剩」在这条回显上长得一模一样。**
     * 要确认某次 `setPermission` 是否真生效，看的是它自己的返回值是否成功 +
     * 后端三分支走了哪一条（本能力按 `isAllManager` 决定发哪两个字段），**不是**回读这个字段。
     */
    async getPermission (id: number | string): Promise<KnowledgePermission> {
      assertId(id, 'id（要查权限的节点 id）')
      return requestWorkspace<KnowledgePermission>({
        url: `${KNOWLEDGE_FILE_GET_PERMISSION_PATH}/${id}`,
        method: 'get',
      })
    },

    /**
     * 新建前的**只读预检**：读目标目录那一层，回报有没有同名项、当前人是不是管理员。
     *
     * 页面**没有**这一步（建之前什么都不查），所以它是 SDK 侧多的一层，
     * 而且**只是提示**：`duplicateName: true` 不代表后端会拒绝（它不查重）。
     * 放在这里是因为「同一层建出两个同名目录」在页面上是能真的发生的，事后很难分清谁是谁。
     */
    prepareCreate (query: { parentId: number | string; name?: string }): Promise<KnowledgePrepareResult> {
      return prepare(query.parentId, query.name)
    },

    /**
     * 移动前的**只读预检**：读**目标**目录那一层（不是被移动的那一项所在的层）。
     * 给了 `name`（要移过去的那一项的名字）就顺带算出目标层里有没有同名项。
     *
     * ⚠️ 这次读**回答不了**「目标是不是文档」—— 后端不校验目标类型，移到一份文档底下它照样
     * 返回成功，而那一项之后在页面上就**再也点不开了**（它的 parent 是一份文档，谁都不会展开
     * 一份文档）。要判类型只能再读一次**目标所在的那一层**、在兄弟里找它：
     * 本能力不替调用方做那次读（它需要的是目标 id，而目标 id 是调用方给的）。
     *
     * 撤销 `cancelMove` 要的 `originalParentId` 也不在这次读里 ——
     * 它是**被移动那一项自己那一行**的 `parentId`，从之前那次 `listChildren` 的行上取。
     */
    prepareMove (query: { targetParentId: number | string; name?: string }): Promise<KnowledgePrepareResult> {
      return prepare(query.targetParentId, query.name)
    },

    // -----------------------------------------------------------------------
    // 写：新建（submit 那一半；**没有** cancelCreate，见文件头第四节）
    // -----------------------------------------------------------------------

    /**
     * 新建目录（**写操作**）。页面「新建目录」按钮（`use.js:106-141`）。
     *
     * body 键序照抄页面：`{type, name, parentId}`，JSON。
     * 后端返回**新节点的 id**（`CommonResult<Long>`）。
     *
     * ⚠️ 建出来的是 `audit_status = 2`（待审核）：它**当场就在这一层可见**（`list` 会返回它），
     * 但同时会生成一条 `audit_type = 1` 的待审记录，要等审核人出决定。
     * 后端**没有回滚这条路** ⇒ 本能力**没有** `cancelCreate`（详见文件头第四节）。
     */
    async createFolder (draft: { parentId: number | string; name: string }): Promise<unknown> {
      assertId(draft?.parentId, 'parentId（根目录传 0）')
      assertName(draft?.name, '目录名')
      return requestWorkspace({
        url: KNOWLEDGE_FILE_ADD_PATH,
        method: 'post',
        // 键序照抄 `use.js:126-130`
        data: { type: KNOWLEDGE_FILE_TYPE_FOLDER, name: draft.name, parentId: draft.parentId },
      })
    },

    /**
     * 新建文档（**写操作**）。页面「新建文档」按钮（`use.js:144-179`）。
     * **与新建目录是同一个接口**，只有 `type` 不同（1 vs 2）。
     *
     * ⚠️ 页面上「新建文档」在**根目录是禁用的**（`list.vue:38-45`：`breadcrumbList.length > 1`
     * 才显示可用按钮，否则是一个 disabled + tooltip「请在目录内新建」）。
     * **后端没有这条限制**，在根建文档它会成功 —— 本能力按后端的能力开放，
     * 但这是页面做不到的事，用之前心里有数。
     */
    async createFile (draft: { parentId: number | string; name: string }): Promise<unknown> {
      assertId(draft?.parentId, 'parentId（根目录传 0）')
      assertName(draft?.name, '文档名')
      return requestWorkspace({
        url: KNOWLEDGE_FILE_ADD_PATH,
        method: 'post',
        data: { type: KNOWLEDGE_FILE_TYPE_DOCUMENT, name: draft.name, parentId: draft.parentId },
      })
    },

    /**
     * 重命名文件夹 / 文档（**写操作**）。页面行内菜单的「重命名」（`use.js:182-216`）。
     *
     * body 键序照抄页面：`{id, name}`。
     *
     * ⚠️ **后端不会立刻改名**。`KnowledgeFileServiceImpl.update` 在「已经有待审记录」时
     * 只改那条记录的 `new_content`；否则插一条 `audit_type = 2/5` 的新记录并把文件行
     * 打成待审核，**文件行的 `name` 到审核通过才变**（`AuditUpdateFolder` 里才 `setName`）。
     *
     * 所以「改名成没成功」**不要看 `listChildren`**，要看
     * `ai-knowledge-review-list` 里那条记录的 `newContent`（2026-09-21 真机验证过）。
     *
     * `list` 里确实有一段「把待审的新名字换上去」的代码（`KnowledgeFileServiceImpl.list`），
     * 但它有三个条件：**非管理员** + 那条记录 `audit_type ∈ {2 修改文件夹, 5 修改文档}` +
     * 提交人是我。实测在「新建还没审就改名」这条路径上它**不生效** ——
     * 因为后端那时把记录的 `audit_type` 保留成 1（新建），而替换分支只认 2 / 5。
     * 也就是说这条替换比看上去更容易不触发，**别依赖它**。
     */
    async rename (draft: { id: number | string; name: string }): Promise<unknown> {
      assertId(draft?.id, 'id（要改名的节点 id）')
      assertName(draft?.name, '新名字')
      return requestWorkspace({
        url: KNOWLEDGE_FILE_UPDATE_PATH,
        method: 'put',
        data: { id: draft.id, name: draft.name },
      })
    },

    /**
     * 重命名的**撤销**：把名字改回 `originalName`，同样是 `PUT /update`。
     *
     * 它不是「删除那条变更记录」，而是**再用旧名字提一次修改** ——
     * 因为上一条待审记录还在，后端会把它的 `new_content` 改回旧名，
     * 净效果就是这次改名没有发生过（这一点在真机验证里确认过，见 `docs/pages/知识空间.md`）。
     */
    async cancelRename (draft: { id: number | string; originalName: string }): Promise<unknown> {
      assertId(draft?.id, 'id（要还原的节点 id）')
      assertName(draft?.originalName, 'originalName（改之前的名字）')
      return requestWorkspace({
        url: KNOWLEDGE_FILE_UPDATE_PATH,
        method: 'put',
        data: { id: draft.id, name: draft.originalName },
      })
    },

    /**
     * 移动文件夹 / 文档到另一个目录（**写操作**）。页面行内菜单的「移动至」
     * （`remove-modal/index.vue:99`）。
     *
     * ⚠️ **路径参数**：`POST /manager/knowledgeFile/move/{fromFileId}/{targetFileId}`，
     * 顺序是「源 → 目标」，**没有请求体**。页面传的是 `(props.id, selectedKeys[0])`，
     * 也就是「被移动的那一项」在前、「选中的目标目录」在后 —— 写反了会把目标目录整体搬走。
     *
     * 后端在这里做的检查（`KnowledgeFileServiceImpl.move`）：`isAuthFile(fromFileId)`（有没有权限）
     * + `getAuditor(fromFileId)` 非空 + `fromFileId != targetFileId`。
     * **不检查目标是不是文档、也不检查目标是不是自己的子孙**。
     *
     * 与改名一样，移动**当场生效**（文件行的 `parent_id` 立刻改了），
     * 但同时落一条 `audit_type = 10/11` 的待审记录；审核**拒绝**时 `AuditMoveFolder`
     * 会把它放回 `history_parent_id`，并且**顺带重写两个目录的权限**（7 种情况的分支）。
     */
    async move (draft: { id: number | string; targetParentId: number | string }): Promise<unknown> {
      assertId(draft?.id, 'id（要移动的节点 id）')
      assertId(draft?.targetParentId, 'targetParentId（目标目录 id，根是 0）')
      return requestWorkspace({
        url: `${KNOWLEDGE_FILE_MOVE_PATH}/${draft.id}/${draft.targetParentId}`,
        method: 'post',
      })
    },

    /**
     * 移动的**撤销**：移回原来的父目录（`originalParentId` 从 `prepareMove` 之前的那次
     * `listChildren` 里那一行的 `parentId` 拿，或者调用方自己记着）。
     *
     * ⚠️ 与 `cancelRename` 一样，它**不是**把那条待审记录删掉，而是再提一次移动，
     * 所以会留下两条待审记录（后一条把东西挪回来）。审核人按顺序审，
     * 中间那一段状态不是「没动过」。
     */
    async cancelMove (draft: { id: number | string; originalParentId: number | string }): Promise<unknown> {
      assertId(draft?.id, 'id（要还原的节点 id）')
      assertId(draft?.originalParentId, 'originalParentId（移动之前的父目录 id，根是 0）')
      return requestWorkspace({
        url: `${KNOWLEDGE_FILE_MOVE_PATH}/${draft.id}/${draft.originalParentId}`,
        method: 'post',
      })
    },

    /**
     * 删除文件夹 / 文档（**写操作**）。页面行内菜单的「删除」有二次确认
     * （`Modal.confirm`，`use.js:258-269`），接口是 `DELETE /manager/knowledgeFile/delete/{id}`。
     *
     * 后端行为（`KnowledgeFileServiceImpl.delete`，与目录/文档分别对应 `audit_type = 3/6`）：
     * 1. **先查这一层是否为空** —— 目录里有东西就抛「该文件夹不为空，不能删除」（不走审核，直接失败）；
     * 2. 若最新一条变更记录还在待审，**把那条记录的 `audit_type` 改成 3/6** 然后返回
     *    （也就是「新建还没审就删」会净效果成一条「删除」记录，文件行仍在）；
     * 3. 否则插一条新的待审记录并把文件行打成待审核。
     *
     * ⇒ 这一页的「删除」**不是即时删除**，`listChildren` 之后仍然看得到它，
     * 直到审核人在 `ai-knowledge-review-audit` 上通过（`AuditDeleteFolder` 那时才**硬删**）。
     * 没有撤销。
     */
    async remove (id: number | string): Promise<unknown> {
      assertId(id, 'id（要删除的节点 id）')
      return requestWorkspace({
        url: `${KNOWLEDGE_FILE_DELETE_PATH}/${id}`,
        method: 'delete',
      })
    },

    /**
     * 设置节点的读写权限与审核人（**写操作**）。页面行内菜单的「权限设置」
     * （**只有 `isAdmin` 才显示这一项**，`item-render/index.vue:47`），保存时走
     * `permission-modal/index.vue:138`。
     *
     * body 键序照抄页面（`permission-modal/index.vue:130-136`）：
     * `{id, isAllManager, authManagerIds, authRoleIds, auditorId}`。
     *
     * ⚠️ **整单替换**：`authManagerIds` 只在 `isAllManager === 3` 时是逗号串，
     * 其余一律发 `null`；`authRoleIds` 只在 `isAllManager === 2` 时是逗号串，其余发 `null`。
     * 这两条是页面 `.join(',') : null` 三元表达式的原样复刻，**不要**改成「不传就不发」——
     * 后端三分支是 if/else-if/**else 无条件 `authRoleIds.split(",")`**，`null` 会 NPE。
     *
     * 后端还会**级联到所有子目录**（`getSubFilesById` 那一圈循环），不只是一层。
     *
     * 撤销用 `cancelSetPermission`，输入是 `getPermission` 读过的那一份。
     */
    setPermission: submitPermission,

    /**
     * 权限设置的**撤销**：把 `getPermission` 读到的旧值原样写回。
     *
     * 这个撤销是**真的干净**的，因为 `setPermission` 是整单替换：
     * 把 prepare 那一份原样送回来，后端算出来的三个分支与之前一致。
     *
     * ⚠️ 一个如实说明：`getPermission` 回来的 `authManagerIds` 在「全部用户」时**是空的**
     * （后端把 `manager_id = 0` 那行过滤掉了），所以 `previous.isAllManager = 1` 时
     * 直接传回来就行 —— 走的是 `isAllManager === 1` 那条分支，不看另两个字段。
     *
     * ⚠️ 但 `getPermission` 的 `isAllManager` 本身**不可靠**（见 `getPermission` 的说明）：
     * 「全部用户」它回的是 3 + 空数组。真机实测那条往返是这么走的 ——
     * 用 `{isAllManager: 3, authManagerIds: []}` 当 previous 传进来时，
     * 本能力会按「指定用户」发（`authManagerIds` 为 null）而被自己拒绝；
     * 所以**撤销要么用 setPermission 之前读的那一份**，要么按 `isAllManager = 1` 显式重设。
     */
    cancelSetPermission (draft: { id: number | string; previous: KnowledgePermission }): Promise<unknown> {
      assertId(draft?.id, 'id（要还原权限的节点 id）')
      const previous = draft?.previous
      if (previous === null || typeof previous !== 'object') {
        return Promise.reject(
          new Error('previous 必填：它必须是 ai-knowledge-workspace-permission-get 的返回，不能是凭记忆拼的'),
        )
      }
      const isAllManager = previous.isAllManager
      if (isAllManager !== 1 && isAllManager !== 2 && isAllManager !== 3) {
        return Promise.reject(
          new Error(
            `previous.isAllManager 是 ${JSON.stringify(isAllManager)}，不是 1/2/3 —— ` +
              '多半是没先 getPermission 就调了撤销',
          ),
        )
      }
      return submitPermission({
        id: draft.id,
        isAllManager,
        authManagerIds: previous.authManagerIds ?? null,
        authRoleIds: previous.authRoleIds ?? null,
        auditorId: previous.auditorId ?? null,
      })
    },

    // -----------------------------------------------------------------------
    // 知识审核
    // -----------------------------------------------------------------------

    /**
     * 分页查询知识变更记录（**只读**）。知识审核页的列表（`review/list.vue:101-107`）。
     *
     * 参数顺序见 `REVIEW_LIST_ORDER`（`order`/`orderField` 两个空串一定会发，
     * 表单那 6 项初值是 `null` ⇒ 不填就不发）。
     *
     * ⚠️ 后端**永远** `order by id desc`（`selectByPage` 的 XML 里写死），
     * 页面的 `order` / `orderField` 传什么都不影响排序。
     *
     * ⚠️ 页面的「审核」按钮只在 `auditStatus === 2 && String(userStore.state.id) === String(record.auditorId)`
     * 时才显示（`review/list.vue:154-156`）。**后端不校验审核人** —— 本能力照抄的是请求，
     * 不是那条 UI 判据，调用方要自己看 `auditorId`。
     */
    listRecords (query: {
      parentFileName?: string
      fileName?: string
      submitterName?: string
      auditorName?: string
      auditStatus?: number
      auditType?: number
      submitStartTime?: string
      submitEndTime?: string
      pageNo?: number
      pageSize?: number
      order?: string
      orderField?: string
    } = {}): Promise<PageResult<KnowledgeChangeRecord>> {
      return requestReview<PageResult<KnowledgeChangeRecord>>({
        url: KNOWLEDGE_CHANGE_RECORD_LIST_PATH,
        method: 'get',
        params: buildOrdered(REVIEW_LIST_ORDER, query as Record<string, unknown>),
      })
    },

    /**
     * 审核通过 / 拒绝一条变更记录（**写操作，终态**）。
     *
     * 页面上有两个入口，打的是**同一条请求**：
     * - 行内「审核」→ 弹窗（`components/review.vue`）→ 通过 / 拒绝两个按钮
     * - 「批量通过 / 批量拒绝」→ `review/list.vue:182-199` 里**逐条 await** 同一个函数
     *   （不是批量接口，本能力也不做批量：循环调它即可）
     *
     * 请求的真实出处是**共享函数** `httpReviewSubmit`
     * （`app/portal/components/portal/platform/document/utils/share.js`）：
     * `PUT /manager/knowledgeChangeRecord/audit`，body `{id, auditStatus}` ——
     * 只看调用点（它俩都只写 `httpReviewSubmit({reviewId, status})`）是看不出 URL 的。
     *
     * ⚠️ **`id` 是变更记录的 id，不是 `fileId`**（弹窗里那句 `data.id` 是列表行自己的 id）。
     *
     * ⚠️ **不可撤回**，而且两个方向都有破坏性副作用（见文件头第四节）：
     * 通过一条删除记录会**硬删**文件与它的章节/权限；拒绝一条新建记录会把文件
     * **改名成毫秒时间戳**。审之前把 `auditType` 看清楚。传别的值（比如 2 待审核）当场拒绝。
     */
    async audit (draft: { id: number | string; auditStatus: number }): Promise<unknown> {
      assertId(draft?.id, 'id（**变更记录**的 id，不是 fileId）')
      const status = draft?.auditStatus
      if (status !== AUDIT_STATUS_SUCCESS && status !== AUDIT_STATUS_FAILED) {
        return Promise.reject(
          new Error(
            `auditStatus 只能是 1 审核通过 / 3 审核拒绝，收到的是 ${JSON.stringify(status)}。` +
              '后端不校验这个值、传什么存什么；页面上也只有这两个按钮。' +
              '⚠️ 两个方向都有破坏性副作用（硬删 / 改名成时间戳），见 docs/pages/知识审核.md。',
          ),
        )
      }
      return requestReview({
        url: KNOWLEDGE_CHANGE_RECORD_AUDIT_PATH,
        method: 'put',
        // 键序照抄 share.js 的 `{ id: reviewId, auditStatus: status }`
        data: { id: draft.id, auditStatus: status },
      })
    },
  }
}

export type AiKnowledgeCapability = ReturnType<typeof createAiKnowledgeCapability>
