import type { CapabilityDefinition } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'
import { buildCreateTimeRange } from './assignment.js'

/**
 * 图库管理 —— 阶段① 的第二条「普通 CRUD」业务线，形态与作业管理同族，但**三处不一样**。
 *
 * 页面：`/dashboard/base/image/list`（`generated/page-catalog.json` 里 id `c8047a`，
 * domain `base`，权限码 `/dashboard/base/image`，moduleType 12 学习管理）
 * 路由文件：`app/portal/views/dashboard/education/base/image/list.vue`
 *
 * | 动作 | 请求 | 出处 |
 * | --- | --- | --- |
 * | 列表 | `GET /sys/imagemanage/page` | `list.vue` 的 `getDataListURL` |
 * | 详情 | `GET /sys/imagemanage/{id}` | `[mode]/[id].vue` 的 `objectURL` + `form.js:176` |
 * | 新建（保存） | `POST /sys/imagemanage`，**body 是数组** | `create-multiple/create.vue:131` |
 * | 新建（保存并发布） | `POST /sys/imagemanage/saveAndRelease`，body 同为数组 | 同上，`handleSubmit(1)` |
 * | 修改 | `PUT /sys/imagemanage` | `form.js:131`（非 create 分支） |
 * | 改状态 | `PUT /sys/imagemanage`，body `{id, status}` | `list.vue` 的 `actionStatus` |
 * | 删除 | `DELETE /sys/imagemanage`，body `[id]` | `list.js:517` 的 `deleteIsBatch` 分支 |
 *
 * ## 与作业管理同族：同样没有 `prepare`
 *
 * 后端没有任何"提交前先问一次"的接口（`SysImageManageController` 一共就 5 个方法），
 * 所以写链路是 `get → create/createRelease → update/setStatus → remove`。
 * 硬造一个 `prepare` 就是给"读"套上"提交流程"的名字。
 *
 * ## 三处与作业管理**不一样**的地方（都是实测，不是推断）
 *
 * ### ① 上传不在接口里，`url` 由调用方给
 *
 * 这个页面**没有 multipart 上传接口**。图片先由页面的上传组件直传 OSS
 * （`create-multiple/create.vue` 的 `common-upload-dragger` + `ossConfigForImage`），
 * 上传成功后组件回调给出 `{ url, fileName }`，页面把它们塞进 `fileList`，
 * 点「保存」时才把 `fileList` 整个 POST 出去：
 *
 * ```js
 * function onFileUploadDone ({ url, fileName }) {
 *   fileList.value.push({ name: fileName, url })
 * }
 * ```
 *
 * 所以**接口收的是 OSS 地址字符串，不是字节**。**SDK 现在有上传能力**（`baseUpload`，见 docs/base/上传.md），
 * 可以先用它把文件传上去拿到 url，再把 url 传进这里（上传本身不在这条能力的职责里）。
 * （可以把 OSS 上已有的图片地址传进来，也可以传任何后端愿意存下来的字符串——
 * 后端 `save` 这条路径**一个校验注解都没有**）。
 *
 * ### ② `remove` 是**物理删除**（与作业管理正相反）
 *
 * `SysImageManageEntity` 没有逻辑删除字段（没有 `@TableLogic`），`CrudServiceImpl.delete`
 * 直接走 `baseDao.deleteBatchIds`。实测：删完 `list` 查不到，`get(id)` 返回 **null**。
 * ⇒ 这里可以用 `get` 复核"删掉了没有"；作业管理那条线**不可以**（那边是软删）。
 * 两条线都是实测结论，不要互相套用。
 *
 * ### ③ `PUT` 不传 `status` 会 500（后端拆箱 NPE）
 *
 * `SysImageManageServiceImpl.updateInfo`：
 *
 * ```java
 * if (dto.getStatus() == 1) { entity.setPublishTime(LocalDateTime.now()); }
 * ```
 *
 * `status` 是 `Integer`，为 null 时 `== 1` 触发**拆箱 NPE** → 500。而 `updateById` 本身是
 * MyBatis-Plus 的**部分更新**（只写非 null 字段），所以「只改名字」这件事在后端语义上
 * 本来是成立的 —— 卡住它的是那一行拆箱。因此本 SDK 的 `update` **强制要求 `status`**，
 * 并在缺的时候当场报错（详见 `createBaseImageCapability.update` 的说明）。
 */

export const BASE_IMAGE_PAGE_PATH = '/dashboard/base/image/list'

/** 该页的权限码（实测自 `generated/page-catalog.json`） */
export const BASE_IMAGE_PERMISSION = '/dashboard/base/image'

/**
 * 该页的 module-type。
 *
 * 实测：浏览器发 `module-type: 12`（学习管理），规则来源是 `app/portal/menus/index.js`
 * 的前缀规则 `/dashboard/base/`，与 `resolveModuleType(BASE_IMAGE_PAGE_PATH)` 一致。
 *
 * ⚠️ 与作业管理页同一个坑：这个头读的是 cookie `hr-0.0.0-menuPath`，那个 cookie 是
 * **浏览器 profile 全局**的。抓基准那一轮里，本页 URL 没变、只因并行会话在别的标签页
 * 跳走，就抓到过 `11` 与「完全不发」两种异常值。SDK 按页面路径推导，给出的恰好是
 * 「单标签页正常导航」下的值（conventions 第 1 条）。
 */
export const BASE_IMAGE_MODULE_TYPE = 12

export type BaseImage = {
  /**
   * 记录 id。**这里是数字**，与作业管理那条线（后端把 Long 序列化成字符串）不同：
   * 本页基准里 `GET /sys/imagemanage/11`、`DELETE` body `[11]`、`PUT` body `"id":11`
   * 全是数字。
   */
  id?: number
  /** OSS 地址（页面上传组件给的） */
  url?: string
  /** 图片名称 */
  name?: string
  /** 发布状态 0 未发布 / 1 已发布（实体注释与 `saveImage(list, status)` 都这么写） */
  status?: number
  /** 项目，1 学习。`saveImage` 里 null 会被填成 1 */
  project?: number
  creator?: number
  createTime?: string
  updater?: number | null
  updateTime?: string | null
  /** 上传人姓名。**只出现在列表接口**（SQL 里 join `hr_sys_user`），`get` 回来的永远是 null */
  creatorName?: string | null
  publishTime?: string | null
  [key: string]: unknown
}

export type BaseImagePageQuery = {
  /**
   * 图片名称。**前缀匹配**，不是模糊匹配 ——
   * SQL 是 `t1.name like CONCAT(#{imgName},'%')`。
   */
  imgName?: string
  /** 发布状态。取值 0/1（见 `BASE_IMAGE_STATUS_OPTIONS`） */
  status?: number | ''
  /** 上传人姓名。同样是**前缀匹配**（`t2.real_name like CONCAT(#{name},'%')`） */
  name?: string
  /** 创建时间起，`YYYY-MM-DD HH:mm:ss` */
  createTimeStart?: string
  /** 创建时间止，`YYYY-MM-DD HH:mm:ss`，**开区间**（用 `buildCreateTimeRange` 生成） */
  createTimeEnd?: string
  pageNo?: number
  pageSize?: number
  order?: string
  orderField?: string
}

/**
 * 列表接口默认会带的空值查询参数，**顺序就是契约的一部分**。
 *
 * 依据：`common/libs/renren/list.js:474-481` 拼 params 的顺序是
 * `order, orderField, ...convertFetchForm(formState), pageNo, pageSize`，
 * 而 `list.vue` 的 `convertFetchForm` 把 `date` 换成 `createTimeStart/End` 之后，
 * formState 剩 `imgName, status, name`。浏览器的真实请求
 * （`baseline/base-image.browser.json` 第一条）逐字节就是：
 *
 * ```
 * ?order=&orderField=&imgName=&status=&name=&createTimeStart=&createTimeEnd=&pageNo=1&pageSize=20&_t=<ts>
 * ```
 *
 * ⚠️ 这里**不能**用「`{...DEFAULTS, ...query}`」的写法：那样 `pageSize` 会插到
 * `pageNo` 前面（对象字面量展开保持插入位置），序列化出来的 URL 参数顺序就与浏览器
 * 不同了。`list()` 里逐个字段显式写死顺序，`test/base-image.test.ts` 有一条用例
 * 专门传 `{ pageSize }` 来盯这件事。
 */
const LIST_PARAM_ORDER = [
  'order',
  'orderField',
  'imgName',
  'status',
  'name',
  'createTimeStart',
  'createTimeEnd',
] as const

/**
 * 发布状态。这两个值来自**实体注释与后端 `saveImage(list, status)` 的调用点**
 * （`save` 传 0、`saveAndRelease` 传 1），并且实测 `status=1` / `status=0` 都能正确过滤。
 *
 * ⚠️ 页面自己那个下拉框是**坏的**：它用 `portal-education-dict-select type="status"`，
 * 而 `status` 是全平台共用的字典 key，装的是**交易状态**（`TRADE_FINISHED` 之类）。
 * 浏览器实测的请求里就是 `status=TRADE_FINISHED`。本 SDK **不复刻这个错误**：
 * 参数收的是后端真正认的 0/1，页面缺陷如实写在 `docs/pages/图库管理.md` 里。
 */
export const BASE_IMAGE_STATUS_OPTIONS = [
  { label: '未发布', value: 0 },
  { label: '已发布', value: 1 },
] as const

/** 分页每页条数默认 20：`useListPageModule` 的 `styleV2` 分支（`list.js:391`） */
const DEFAULT_PAGE_SIZE = 20

/**
 * 新建载荷。**逐字段复刻 `create-multiple/create.vue` 的 `onFileUploadDone`**：
 * fileList 里每一项只有 `name` 与 `url` 两个键，POST 出去的就是这个数组。
 *
 * 项目 / 创建人 / 创建时间 / 状态 / 发布时间**都不由客户端给**：
 * 后端 `saveImage` 里写死（`project` 为 null 时填 1，`creator` 取登录用户，
 * `status` 取调用的是 `save` 还是 `saveAndRelease`，`publishTime` 两条路径都写 now）。
 */
export type BaseImageDraft = {
  /** 图片名称。页面表单规则要求必填（后端没有校验注解） */
  name: string
  /** OSS 地址。页面表单规则要求必填（后端没有校验注解）；由调用方给（可用 `baseUpload` 先传文件拿到） */
  url: string
}

/** 修改载荷：部分更新（`updateById` 只写非 null 字段），但 `status` **必须给** */
export type BaseImageUpdateDraft = {
  /** 记录 id，来自 `list()` / `get()`。数字，不要转成字符串 */
  id: number | string
  /**
   * 发布状态。**必填**，理由见文件头的 ③：后端 `if (dto.getStatus() == 1)` 对 null
   * 的 Integer 拆箱 NPE，500。要"保持原状"就先 `get()` 读回来再原样传。
   */
  status: 0 | 1
  /** 新的图片名称；不传则不改 */
  name?: string
  /** 新的 OSS 地址；不传则不改 */
  url?: string
}

/**
 * id 归一成**数字**。
 *
 * 与作业管理那条线正好相反：那边后端把 Long 序列化成字符串，这边序列化成数字
 * （基准里 `GET /sys/imagemanage/11`、`DELETE` body `[11]`、`PUT` body `"id":11`）。
 * 浏览器把 `record.id` 原样回传，所以这里也归一成数字，保证请求逐字节一致。
 */
function normalizeId (id: number | string): number {
  const value = typeof id === 'number' ? id : Number(String(id).trim())
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`图库记录 id 应为正整数，收到的是 ${JSON.stringify(id)}`)
  }
  return value
}

/** 状态只接受 0/1（后端那两个值），别的值当场拦住而不是让后端 500 */
function normalizeStatus (status: unknown): 0 | 1 {
  if (status !== 0 && status !== 1) {
    throw new Error(`发布状态只能是 1（已发布）或 0（未发布），收到的是 ${JSON.stringify(status)}`)
  }
  return status
}

/**
 * 构造列表接口的 params。
 *
 * **键顺序显式写死**（见 `LIST_PARAM_ORDER` 的说明）：`order, orderField, imgName, status,
 * name, createTimeStart, createTimeEnd, pageNo, pageSize`。`_t` 由 `src/http/client.ts`
 * 的 GET 防缓存逻辑追加在最后，与浏览器一致。
 *
 * 导出是为了让回归测试能直接钉住参数顺序（不改实现就改不动它）。
 */
export function buildListParams (query: BaseImagePageQuery = {}): Record<string, unknown> {
  const defaults: Record<string, unknown> = {
    order: '',
    orderField: '',
    imgName: '',
    status: '',
    name: '',
    createTimeStart: '',
    createTimeEnd: '',
  }
  for (const key of LIST_PARAM_ORDER) {
    const value = (query as Record<string, unknown>)[key]
    if (value !== undefined && value !== null) {
      defaults[key] = value
    }
  }
  defaults.pageNo = query.pageNo ?? 1
  defaults.pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE
  return defaults
}

export const baseImageCapabilities: CapabilityDefinition[] = [
  {
    id: 'base-image-list',
    title: '查询图库列表',
    pagePath: BASE_IMAGE_PAGE_PATH,
    permission: BASE_IMAGE_PERMISSION,
    write: false,
    params: [
      {
        name: 'imgName',
        kind: 'text',
        required: false,
        description:
          '图片名称，**前缀匹配**（不是模糊匹配）：传「SDK-TEST」能查到「SDK-TEST-abc」，' +
          '传「TEST」查不到。所以查名字要用名字的开头那一段',
      },
      {
        name: 'status',
        kind: 'enum',
        required: false,
        description:
          '发布状态。⚠️ 页面上那个下拉框是坏的（它用的是全平台共用的 status 字典，' +
          '实测会发出 TRADE_FINISHED 这种交易状态值）；这里收的是后端真正认的 0/1',
        options: BASE_IMAGE_STATUS_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
      },
      {
        name: 'name',
        kind: 'text',
        required: false,
        description: '上传人姓名，**前缀匹配**（join hr_sys_user 的 real_name）',
      },
      {
        name: 'createTimeStart',
        kind: 'date',
        required: false,
        description:
          '创建时间起 YYYY-MM-DD HH:mm:ss；与 createTimeEnd 成对，用 buildCreateTimeRange 生成',
      },
      {
        name: 'createTimeEnd',
        kind: 'date',
        required: false,
        description:
          '创建时间止 YYYY-MM-DD HH:mm:ss。**两端都是开区间**：页面是「结束日 +1 天」，' +
          '后端 SQL 是 `create_time > start and create_time < end`，用 buildCreateTimeRange 生成',
      },
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
      { name: 'pageSize', kind: 'number', required: false, description: '每页条数，默认 20' },
    ],
  },
  {
    id: 'base-image-get',
    title: '查询单张图片详情',
    pagePath: BASE_IMAGE_PAGE_PATH,
    permission: BASE_IMAGE_PERMISSION,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '记录 id（数字），来自 base-image-list。**本页是物理删除**：删掉之后再查这里' +
          '返回的是 null，所以这个接口可以用来复核"删干净了没有"',
      },
    ],
  },
  {
    id: 'base-image-create',
    title: '新建图片（保存，未发布）',
    pagePath: BASE_IMAGE_PAGE_PATH,
    permission: BASE_IMAGE_PERMISSION,
    write: true,
    params: [
      { name: 'name', kind: 'text', required: true, description: '图片名称' },
      {
        name: 'url',
        kind: 'text',
        required: true,
        description:
          '图片的 OSS 地址。页面是先把文件直传 OSS 再把这个地址 Post 过来的；' +
          '所以要由调用方给出一个可用的地址',
      },
    ],
  },
  {
    id: 'base-image-create-release',
    title: '新建图片并直接发布',
    pagePath: BASE_IMAGE_PAGE_PATH,
    permission: BASE_IMAGE_PERMISSION,
    write: true,
    params: [
      { name: 'name', kind: 'text', required: true, description: '图片名称' },
      { name: 'url', kind: 'text', required: true, description: '图片的 OSS 地址，同 base-image-create' },
    ],
  },
  {
    id: 'base-image-update',
    title: '修改图片名称 / 地址 / 状态',
    pagePath: BASE_IMAGE_PAGE_PATH,
    permission: BASE_IMAGE_PERMISSION,
    write: true,
    params: [
      { name: 'id', kind: 'number', required: true, description: '记录 id（数字）' },
      {
        name: 'status',
        kind: 'enum',
        required: true,
        description:
          '发布状态，**必填**。后端 `updateInfo` 里 `if (dto.getStatus() == 1)` 对 null 会拆箱 NPE（500），' +
          '所以改名字也必须把当前状态一起传回来（先 base-image-get 读一下）',
        options: BASE_IMAGE_STATUS_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
      },
      { name: 'name', kind: 'text', required: false, description: '新的图片名称；不传则不改' },
      { name: 'url', kind: 'text', required: false, description: '新的 OSS 地址；不传则不改' },
    ],
  },
  {
    id: 'base-image-set-status',
    title: '发布 / 取消发布图片',
    pagePath: BASE_IMAGE_PAGE_PATH,
    permission: BASE_IMAGE_PERMISSION,
    write: true,
    params: [
      { name: 'id', kind: 'number', required: true, description: '记录 id（数字）' },
      {
        name: 'status',
        kind: 'enum',
        required: true,
        description: '**目标状态**（1 已发布 / 0 未发布），不是"切换"。写绝对值才可重发',
        options: BASE_IMAGE_STATUS_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
      },
    ],
  },
  {
    id: 'base-image-remove',
    title: '删除图片记录',
    pagePath: BASE_IMAGE_PAGE_PATH,
    permission: BASE_IMAGE_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '记录 id（数字）。**物理删除**（实体没有逻辑删除字段，后端走 deleteBatchIds）：' +
          '删完列表查不到、get 也返回 null。⚠️ 它只删数据库记录，**不会删 OSS 上的文件**',
      },
    ],
  },
]

export function createBaseImageCapability (request: PortalRequest) {
  return {
    /**
     * 分页查询图库。
     *
     * 基准：`baseline/base-image.browser.json`（浏览器点「查询」时发出的真实请求）。
     *
     * ⚠️ `order` / `orderField` 这两个参数**后端不认**：这一页的 SQL 是写死的
     * `order by t1.publish_time desc, t1.create_time desc`（`SysImageManageDao.xml`），
     * 没有 `${order}` 拼接。页面照样发它们，SDK 也照样发（逐字段一致），但别指望能排序。
     *
     * ⚠️ 这条 SQL 里**没有租户、也没有数据范围条件**（`SysImageManageSelectDTO` 虽然
     * 继承了 `DataScopeEntity`，XML 里一个字段都没用到）。所以列表是**跨创建人**的：
     * "我建的图片"要自己用 `name`（上传人姓名）或人工过滤，`creator` 不是查询条件。
     * 实测证据写在 `docs/pages/图库管理.md`。
     */
    async list (query: BaseImagePageQuery = {}): Promise<PageResult<BaseImage>> {
      return request<PageResult<BaseImage>>({
        url: '/sys/imagemanage/page',
        method: 'get',
        params: buildListParams(query),
      })
    },

    /** 单条详情。页面的编辑态就是先打它（`form.js:176` 的 `formLoad`） */
    async get (id: number | string): Promise<BaseImage | null> {
      return request<BaseImage | null>({
        url: `/sys/imagemanage/${normalizeId(id)}`,
        method: 'get',
      })
    },

    /**
     * 新建（**写操作**，status=0 未发布）。
     *
     * 页面把上传组件攒下的 `fileList` **整个数组** POST 出去，
     * 所以这里也收数组：传一条就是一个元素的数组。**body 逐字节就是
     * `[{"name":...,"url":...}]`**（键顺序 name, url，与页面的 `onFileUploadDone` 一致）。
     *
     * 后端 `insertBatch` 一次插一批，**返回体里没有 id**（`Result` 的 data 是 null），
     * 所以"建成功了没有"只能靠 `list()` 再查一次（D12：接口返回成功不算验证）。
     */
    async create (draft: BaseImageDraft | BaseImageDraft[]): Promise<unknown> {
      return request({
        url: '/sys/imagemanage',
        method: 'post',
        data: buildCreatePayload(draft),
      })
    },

    /**
     * 新建并直接发布（**写操作**，status=1）。
     *
     * 与 `create` **只有 URL 不同**：后端 `saveAndRelease` 调的是
     * `saveImage(list, 1)`，`publishTime` 两条路径都写当前时间。
     */
    async createRelease (draft: BaseImageDraft | BaseImageDraft[]): Promise<unknown> {
      return request({
        url: '/sys/imagemanage/saveAndRelease',
        method: 'post',
        data: buildCreatePayload(draft),
      })
    },

    /**
     * 修改（**写操作**）。
     *
     * 后端 `updateById` 是**部分更新**（MyBatis-Plus 只写非 null 字段），所以载荷里
     * 只放真要改的字段是安全的、不会把别的字段清空 —— 但 `status` **必须带上**：
     * `updateInfo` 里 `if (dto.getStatus() == 1)` 对 null 的 Integer 会拆箱 NPE（500）。
     * 所以这里在本地就拦住缺 `status` 的调用，报一个能看懂的错，而不是把 500 丢给调用方。
     *
     * 与页面编辑态的差别（**有意为之**）：页面是把 `GET /{id}` 的整个响应铺回表单再整份
     * PUT（body 里带着 `creator` / `createTime` / `publishTime` 这些只读字段）。SDK 只发
     * 调用方点名的字段 —— 逐字段一致在这里让位于"不要回写服务端字段"，
     * 依据是后端本来就是部分更新，两种载荷的**终态相同**。
     */
    async update (draft: BaseImageUpdateDraft): Promise<unknown> {
      const status = normalizeStatus(draft.status)
      const data: Record<string, unknown> = { id: normalizeId(draft.id) }
      if (draft.name !== undefined) data.name = draft.name
      if (draft.url !== undefined) data.url = draft.url
      data.status = status
      return request({
        url: '/sys/imagemanage',
        method: 'put',
        data,
      })
    },

    /**
     * 改发布状态（**写操作**）。
     *
     * 页面在客户端算好绝对值再发（`record.status === 0 ? 1 : 0`），所以收的是目标状态
     * 而不是"切换"。载荷只有两个键、顺序与浏览器一致：`{ id, status }`，且都是数字。
     *
     * ⚠️ `status=1` 时后端会顺手把 `publishTime` 刷成当前时间；`status=0` 不会。
     */
    async setStatus (id: number | string, status: 0 | 1): Promise<unknown> {
      return request({
        url: '/sys/imagemanage',
        method: 'put',
        data: { id: normalizeId(id), status: normalizeStatus(status) },
      })
    },

    /**
     * 删除（**写操作**，物理删除）。
     *
     * 页面的 `logicDelete` 走 `deleteIsBatch: true` 分支：`http.delete(url, { data: [id] })`，
     * 即 **body 是一个数字 id 数组**（`[11]`），不是路径参数。
     *
     * ⚠️ 两条必须说清楚的事：
     * 1. **这是物理删除**。删完 `list()` 查不到、`get()` 返回 null（实测）。
     *    与作业管理那条线（软删、`get` 仍返回整行）**正相反**，别互相套用。
     * 2. **它不碰 OSS**。后端 `CrudServiceImpl.delete` → `baseDao.deleteBatchIds`，
     *    只删数据库行；文件是页面自己在上传/删除图片时用 `ossDeleteMulti` 清的
     *    （`[mode]/[id].vue` 的 `afterFormSubmit`）。所以删记录不会删掉别人的文件，
     *    反过来删了记录也不等于文件被清了。
     */
    async remove (id: number | string | Array<number | string>): Promise<unknown> {
      const ids = (Array.isArray(id) ? id : [id]).map(normalizeId)
      if (ids.length === 0) {
        throw new Error('删除图库记录需要至少一个 id')
      }
      return request({
        url: '/sys/imagemanage',
        method: 'delete',
        data: ids,
      })
    },
  }
}

/**
 * 构造新建的请求体。**永远是一个数组**（后端是 `@RequestBody List<SysImageManageDTO>`），
 * 每项只有 `name` / `url` 两个键，键顺序与页面推 `fileList` 时一致。
 */
function buildCreatePayload (draft: BaseImageDraft | BaseImageDraft[]): Array<{ name: string; url: string }> {
  const list = Array.isArray(draft) ? draft : [draft]
  if (list.length === 0) {
    throw new Error('新建图库记录至少要有一条（后端收的是数组）')
  }
  return list.map((item) => {
    if (!item || typeof item.name !== 'string' || item.name === '') {
      throw new Error('图片名称必填')
    }
    if (typeof item.url !== 'string' || item.url === '') {
      throw new Error('图片地址必填（url 由调用方给；可用 baseUpload 先传文件拿到）')
    }
    return { name: item.name, url: item.url }
  })
}

/** 与作业管理共用同一个区间构造函数（页面的 `convertFetchForm` 两边逐字节相同） */
export { buildCreateTimeRange }

export type BaseImageCapability = ReturnType<typeof createBaseImageCapability>

/**
 * 门面上带防重的那一层。与作业管理同样的分工：`withIdempotency` 需要**身份**，
 * 那是会话层的东西，所以包装放在组装点（`src/index.ts` / `src/server.ts`），
 * 不放进能力模块。这里只声明"多了两个带 requestId 的方法"的形状。
 *
 * **这一页有两个写能力会产生新记录**（`create` 与 `createRelease`，后者还会直接发布），
 * 所以两个都要包；`update` / `setStatus` / `remove` 不要包 —— 它们重发一次终态相同
 * （实测依据见 `docs/pages/图库管理.md` 的写链路一节）。
 */
export type BaseImageCapabilityWithIdempotency = BaseImageCapability & {
  /**
   * 带短窗口防重的建图（设计 D12）。`requestId` 由调用方生成并保管，
   * 超时重试时**原样传回上一次那个**（用 `createRequestId()` 生成）。
   */
  createIdempotent: (
    params: BaseImageDraft & { requestId: string },
  ) => Promise<unknown>
  /** 带短窗口防重的「新建并发布」。理由同上：它同样会多出一条记录 */
  createReleaseIdempotent: (
    params: BaseImageDraft & { requestId: string },
  ) => Promise<unknown>
}
