/**
 * 文件 / 图片上传 —— **基础能力**（不属于任何页面）。
 *
 * 这是「所有带附件的表单」脚下的那块地基：Portal 里 `common-upload-*` 组件族被用了
 * **322 次**（调查 §5.1），而它们的收口点只有一个文件 ——
 * `common/utils/oss.js`（全仓唯一 `import OSS from 'ali-oss'` 的地方）。
 * 本文件复刻的就是那个文件的 `ossPut` 链路。
 *
 * ## 为什么它是地基：一句写在代码里的缺口
 *
 * `src/capabilities/base-image.ts` 的 `base-image-create` 要求调用方给 `url`，注释写着
 * 「SDK 不覆盖上传，url 必须由调用方提供」。**调用方拿不到 url，那个能力就是半残的**：
 * AI 只能让用户手动去页面上传。本文件补的就是这一段。
 *
 * ## ⚠️ 凭据：SDK 不读、不找、不落盘
 *
 * OSS 的 AK/SK 是**长期密钥**。它们必须由调用方通过配置传入（`OssUploadConfig`），
 * SDK 自己**不去任何地方找凭据**：
 *
 * - 不从环境变量读（`process.env.VITE_OSS_*` 之类一律不碰）；
 * - 不从 Portal 前端仓库的文件里读 —— 那边 `build/env/.env.build.test` 里有一份明文，
 *   那是**那个仓库的安全问题**，不是本 SDK 的配置来源；
 * - 不从浏览器 / cookie / 页面里抓（与 conventions 第 8 条一致）；
 * - **不进错误信息、不进日志**。`redactConfig` 把 `accessKeySecret` 全部换成
 *   `<redacted>` 之后才允许出现在任何文本里；`accessKeyId` 也只留前 4 位。
 *
 * 缺凭据时**失败关闭**：`assertOssConfig` 抛错，不做「先用空字符串试试」这种事
 * （与 `src/call.ts` 抛 `HttpInstanceResolutionError` 的风格一致）。
 * 本文件里**没有任何硬编码的 AK/SK**，测试用的也是明显的假串（`test-ak` 之类）。
 *
 * ⚠️ **校验时机是「第一次真要用凭据」，不是「创建能力时」** —— 理由与取舍写在
 * `createBaseUploadCapability` 里那个 `resolve()` 的注释上。要点：失败关闭的性质不变，
 * 三个会发请求的方法（`upload` / `getAcl` / `putAcl`）**一个都没漏**，
 * 都在发网络之前先抛同一个 `OssCredentialError`。
 *
 * ## 签名版本：**V1**（结论有出处，不是猜的）
 *
 * 调查 §8 留了一个必须回答的问题：ali-oss 6.x 在这个 Portal 里默认用 V1 还是 V4？
 * **答案：V1。** 三条证据，逐条可复核（只读）：
 *
 * | # | 出处 | 内容 |
 * | --- | --- | --- |
 * | 1 | `Projects_Js/node_modules/ali-oss/lib/common/client/initOptions.js:50` | `authorizationV4: false // 启用v4签名，默认关闭` |
 * | 2 | `Projects_Js/common/utils/oss.js:33-40`（`ossConfigV2`） | 只给了 ak/sk/region/bucket/cname/endpoint，**没有 `authorizationV4`** |
 * | 3 | `Projects_Js/node_modules/ali-oss/lib/common/utils/createRequest.js:31,101-102` | 该字段为假值时走 `x-oss-date` 的 RFC1123 格式 + `this.authorization(...)`（V1 分支），V4 的 `OSS4-HMAC-SHA256` 分支不执行 |
 *
 * 装的是 **ali-oss 6.20.0**（`node_modules/ali-oss/package.json` 的 `version`；
 * Portal 的 `package.json:45` 声明的是 `^6.17.1`）。**V4 的代码在包里存在**
 * （`lib/common/signUtils.js:199` 起），但**默认关着**，Portal 也没打开它。
 *
 * 所以本文件实现的是 **V1**：`Authorization: OSS {ak}:{base64(HMAC-SHA1(canonicalString))}`。
 * 若将来 Portal 打开 `authorizationV4`，这里要跟着重写 —— 见 `docs/base/上传.md` 的欠账一节。
 *
 * ## 复刻范围（只做 `ossPut` 真正走过的那几步）
 *
 * ```
 * PutObject         PUT  /{key}          ← 传字节
 * GetObjectACL      GET  /{key}?acl      ← 读回 ACL（用于复核，见下）
 * PutObjectACL      PUT  /{key}?acl      + x-oss-object-acl: public-read
 * ```
 *
 * `PutObjectACL` **不能省**：桶不是默认公共读，省了的话「上传成功但 URL 读不出来」，
 * 而且失败方式是静默的（线索来自 `oss.js:176-177`）。本实现的 `upload()` 把
 * put + putACL 做成**一步**，就是为了不让调用方有机会漏掉后半步。
 *
 * ## 明确不做（浏览器独有，无头下没有对应物）
 *
 * 图片切割 / 压缩（`canvas`）、PDF 页数（`pdfjs-dist`）、视频信息（`mediainfo.js` + wasm）、
 * 宽高比探测（`new Image()` + `URL.createObjectURL`）。这些是**边角加工**，不是地基；
 * 调用方要给**已处理好的字节**。
 *
 * 也没有做**分片上传**（`ossMultipartUpload`，>300MB 时才走）与 **DeleteObject**
 * （写链路的 `cancel`）。理由与欠账写在 `docs/base/上传.md`。
 */

import { createHash, createHmac, randomBytes as nodeRandomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { CapabilityDefinition, ParamSpec } from './types.js'

/**
 * 这一族能力挂在哪。
 *
 * ⚠️ **它不是菜单路径，是一个刻意的哨兵值**：上传没有自己的页面，它是
 * `common/utils/oss.js` 这个被 322 处复用的工具函数。用真实菜单路径（比如
 * `/dashboard/base/image/list`）会让 CLAUDE.md 的「完成状态是推导的」把那个页面
 * 错误地判为已完成 —— 那是**谎报进度**。
 *
 * 这个路径在模块表里匹配不到，所以 `resolveModuleType()` 返回 `null`、**不发
 * `module-type` 头**。这是对的：本族能力打的是 OSS，不是 Portal 后端，
 * 一个 Portal 的 module-type 头在这里毫无意义（conventions 第 1/2 条讲的是后端数据范围）。
 */
export const BASE_UPLOAD_SOURCE = 'common/utils/oss.js'

/**
 * 批量删除单次的上限。OSS `DeleteMultipleObjects` 的硬限制就是 1000。
 * 超了**当场拒**，不自动拆包（拆包会把"部分成功"的语义藏起来）。
 */
export const OSS_DELETE_MULTI_LIMIT = 1000

/** 该能力的权限码：**没有**。OSS 的鉴权是 AK/SK 签名，不走 Portal 的权限码体系。 */
export const BASE_UPLOAD_PERMISSION: string | undefined = undefined

// ---------------------------------------------------------------------------
// 配置（凭据从这里进来）
// ---------------------------------------------------------------------------

/** 只用到 fetch 的一小片形状，便于注入替身（测试不碰网络） */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/**
 * OSS 侧的配置。**逐字段对应 `oss.js:33-40` 的 `ossConfigV2`**，一个都不多。
 *
 * 名字与 Portal 的 env 变量一一对应，方便接入方从自己那边映射过来：
 *
 * | 本字段 | Portal 的 env（`build/env/.env.build.test`） |
 * | --- | --- |
 * | `accessKeyId` | `VITE_OSS_V2_ACCESS_KEY_ID` |
 * | `accessKeySecret` | `VITE_OSS_V2_ACCESS_KEY_SECRET` |
 * | `region` | `VITE_OSS_V2_REGION` |
 * | `bucket` | `VITE_OSS_V2_BUCKET` |
 * | `endpoint` | `VITE_OSS_V2_ENDPOINT` |
 *
 * ⚠️ 这张表只说「哪个字段对应哪个变量」，**没有、也不会**写出那些变量的值。
 * 值请由接入方通过自己的密钥管理注入（`docs/base/上传.md` 的欠账一节有步骤）。
 *
 * ## 为什么只收**一份**配置（Portal 里其实有 5 套凭据）
 *
 * `grep -roh 'VITE_[A-Z_]*OSS[A-Z_]*' app common` 能扫出 5 套 env 前缀
 * （`VITE_OSS_V2_*`、`VITE_EDUCATION_ADMIN_OSS_CONFIG_IMAGE_*`、
 * `VITE_MALL_ADMIN_OSS_CONFIG_IMAGE_*`、`VITE_MALL_ADMIN_OSS_CONFIG_APP_*`、
 * `VITE_SHOP_ADMIN_OSS_CONFIG_IMAGE_*`），页面也确实会把各自那套当 prop 传给上传组件
 * （例 `create-multiple/create.vue:8` 的 `:config="ossConfigForImage"`）。
 *
 * **但那套 prop 在当前版本里是失效的。** 实测
 * `common/components/common/upload/dragger/index.vue`：
 *
 * ```js
 * config: { type: Object },                            // :42  声明了
 * url = await ossPut({ file, folder: props.folder })   // :85  没传下去
 * ```
 *
 * 而 `ossPut` 的 `config` 形参本身是注释掉的（`oss.js:134`「在新版不再需要」），
 * 正文写死 `cloneDeep(ossConfigV2)`。⇒ **356 处上传组件实际都落到同一个桶**，
 * 「哪套凭据」不随页面变。
 *
 * 所以这里收一份配置不是简化，是**与现状一致**；收多份反而是复刻一个不起作用的机制。
 * 顺带记一个陷阱：别按页面去对凭据，图库管理页看起来用的是教育后台那个桶，**它不是**。
 */
export type OssUploadConfig = {
  /** OSS AccessKeyId。**凭据**，[必填] */
  accessKeyId: string
  /** OSS AccessKeySecret。**凭据**，[必填]。任何输出里都被 `redactOssConfig` 抹掉 */
  accessKeySecret: string
  /** 桶名，例 `my-bucket`。[必填] */
  bucket: string
  /**
   * 端点主机名，例 `oss-cn-hangzhou.aliyuncs.com`。**不要带协议前缀**。
   *
   * [必填]：cname 模式下它就是 URL 的 host，缺了拼不出可访问地址。
   * （ali-oss 允许只给 region 让它自己推 `oss-{region}.aliyuncs.com`，
   * 但 Portal 的 `ossConfigV2` 两个都给，本实现也要求显式给 endpoint ——
   * 「拼出一个我没把握的 host」比「报错让调用方补上」糟得多。）
   */
  endpoint: string
  /**
   * 区域。**V1 签名用不到它**（region 只出现在 V4 的 scope 里）。
   * 收在这里是为了与 `ossConfigV2` 逐字段对齐、并让 `redactOssConfig` 有完整的画像。
   */
  region?: string
  /**
   * 是否 cname（自定义域名）模式。默认 **true**。
   *
   * 依据：`oss.js:37` 写死 `cname: !!import.meta.env.VITE_OSS_V2_ENDPOINT` ——
   * 只要配了 endpoint，cname 就是真。两个模式的区别只在 URL：
   * cname 走 `https://{endpoint}/{key}`，非 cname 走 `https://{bucket}.{endpoint}/{key}`；
   * **签名用的 canonical resource 两种模式都是 `/{bucket}/{key}`**（ali-oss 的 `_getResource` 恒带桶名）。
   */
  cname?: boolean
  /**
   * 用 https（默认 **true**）。
   *
   * ⚠️ 这里**刻意不复刻** Portal 的行为：ali-oss 的 `secure` 默认 `false`，所以
   * `ossPut` 实际返回的是 **`http://`** 开头的 url，Portal 前端靠 91 处 `fixHttpsUrl` 兜底
   * （调查 §5.3 已记）。SDK 直接给 https —— 把一个已知缺陷照抄进无头层没有意义，
   * 而且调用方拿到的 url 通常要存进业务表给浏览器读。
   */
  secure?: boolean
  /**
   * 测试用注入点。**生产不要传。**
   *
   * - `fetch`：换掉全局 fetch（测试里指到一个假的 OSS 端点，一个字节都不出本机）
   * - `now`：换掉时钟（对象名的年/月、签名里的日期都读它，conventions 第 22 条要求
   *   可注入时钟而不是真 sleep）
   * - `randomName`：换掉随机名生成（默认是 16 位小写字母，见 `generateRandomObjectName`）
   */
  runtime?: {
    fetch?: FetchLike
    now?: () => Date
    randomName?: () => string
  }
}

/**
 * 凭据缺失 / 非法。**失败关闭**：缺什么就说什么，不让调用方拿着一个含糊的 403 去猜。
 *
 * 与 `src/call.ts` 的 `HttpInstanceResolutionError` 同一个立场：宁可拒绝发起请求，
 * 也不要用一个"凑出来的"默认值打出去 —— 后者往往只是一个不显眼的 200。
 */
export class OssCredentialError extends Error {
  /** 缺/错的字段名，便于程序化处理 */
  readonly fields: readonly string[]

  constructor (fields: readonly string[], detail: string) {
    super(
      `OSS 上传需要调用方提供凭据（缺失/非法字段：${fields.join(', ')}）。\n` +
        `${detail}\n` +
        'SDK 不会自己去任何地方找凭据：不读环境变量、不读 Portal 前端仓库的 .env、' +
        '不从浏览器抓。请在创建上传能力时把它们传进来。',
    )
    this.name = 'OssCredentialError'
    this.fields = fields
  }
}

/** OSS 明确拒绝了这次请求（非 2xx）。带上 OSS 自己的错误码与 requestId，便于定位。 */
export class OssRequestError extends Error {
  readonly status: number
  readonly code: string | undefined
  readonly requestId: string | undefined
  readonly ossMessage: string | undefined
  /** 触发这次调用的能力 ID */
  readonly capabilityId: string | undefined

  constructor (init: {
    status: number
    code?: string
    requestId?: string
    ossMessage?: string
    capabilityId?: string
    detail?: string
  }) {
    super(
      `OSS 请求失败：HTTP ${init.status}` +
        (init.code ? ` ${init.code}` : '') +
        (init.ossMessage ? ` —— ${init.ossMessage}` : '') +
        (init.requestId ? `（requestId=${init.requestId}）` : '') +
        (init.detail ? `\n${init.detail}` : ''),
    )
    this.name = 'OssRequestError'
    this.status = init.status
    this.code = init.code
    this.requestId = init.requestId
    this.ossMessage = init.ossMessage
    this.capabilityId = init.capabilityId
  }
}

/** 本地参数不合法（folder 不在白名单、content 与 path 都没给、objectKey 越界……） */
export class OssUploadParamError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'OssUploadParamError'
  }
}

/**
 * 抹掉凭据之后的配置画像。**任何要输出配置的地方都必须先过这里。**
 *
 * 规则：`accessKeySecret` 全抹；`accessKeyId` 只留前 4 位（AK 本身不是秘密，但它
 * 能用来定位到具体是哪把钥匙，而**没有任何理由**让完整 AK 出现在日志或报错里）。
 */
export function redactOssConfig (config: Partial<OssUploadConfig>): Record<string, unknown> {
  const ak = typeof config.accessKeyId === 'string' ? config.accessKeyId : undefined
  return {
    accessKeyId: ak ? `${ak.slice(0, 4)}<redacted>` : undefined,
    accessKeySecret: config.accessKeySecret ? '<redacted>' : undefined,
    bucket: config.bucket,
    endpoint: config.endpoint,
    region: config.region,
    cname: config.cname,
    secure: config.secure,
  }
}

/**
 * 凭据校验：**缺一个就抛，不做部分降级**。返回归一化后的配置（供内部使用）。
 *
 * 为什么不是「返回 boolean 让调用方决定」：这条链上**没有**「没有凭据也能跑」的分支，
 * 一个需要凭据的能力收不到凭据时，唯一正确的动作就是当场失败。
 */
export function assertOssConfig (config: Partial<OssUploadConfig>): Required<
  Pick<OssUploadConfig, 'accessKeyId' | 'accessKeySecret' | 'bucket' | 'endpoint'>
> & { region?: string; cname: boolean; secure: boolean; runtime?: OssUploadConfig['runtime'] } {
  const missing: string[] = []
  const blank = (value: unknown): boolean => typeof value !== 'string' || value.trim() === ''

  if (blank(config.accessKeyId)) missing.push('accessKeyId')
  if (blank(config.accessKeySecret)) missing.push('accessKeySecret')
  if (blank(config.bucket)) missing.push('bucket')
  if (blank(config.endpoint)) missing.push('endpoint')

  if (missing.length > 0) {
    throw new OssCredentialError(
      missing,
      `收到的是：${JSON.stringify(redactOssConfig(config ?? {}))}`,
    )
  }

  const endpoint = String(config.endpoint).trim()
  if (endpoint.includes('://')) {
    throw new OssUploadParamError(
      `endpoint 只写主机名，不要带协议前缀（收到 ${JSON.stringify(endpoint)}）。` +
        '协议由 secure 决定：true → https，false → http',
    )
  }

  return {
    accessKeyId: String(config.accessKeyId).trim(),
    accessKeySecret: String(config.accessKeySecret).trim(),
    bucket: String(config.bucket).trim(),
    endpoint,
    region: config.region,
    cname: config.cname ?? true,
    // 默认 true：不复刻 ali-oss 的 secure=false 缺陷（见 OssUploadConfig.secure 的说明）
    secure: config.secure ?? true,
    runtime: config.runtime,
  }
}

// ---------------------------------------------------------------------------
// folder 白名单（逐条抄自 oss.js:42-95 的 ossFilePathOptions）
// ---------------------------------------------------------------------------

/**
 * `folder` 的合法取值。**逐条抄自 `common/utils/oss.js:42-95` 的 `ossFilePathOptions`**，
 * 按源码里的分组顺序排列（不是字典序 —— 顺序是给人看的，读起来能对上源码）。
 *
 * 源码里那段校验是**被注释掉的**（`oss.js:151-153`），但参数注释写着「只允许在
 * ossFilePathOptions 中取值」。SDK **把它恢复成硬校验**：这是白名单，不是建议。
 * 传一个不在表里的 folder 说明调用方在按自己的想象拼路径 —— 那类对象事后没人找得到。
 */
export const OSS_FOLDERS = [
  // 不属于任何系统 比如临时文件
  'Public/public',
  'Website/international',
  // 人
  'HR/public',
  'HR/kpi',
  'HR/study',
  'HR/organize',
  'HR/salary',
  'HR/approval',
  'HR/risk',
  // 财
  'Finance/public',
  'Finance/expense',
  'Finance/income',
  'Finance/allocation',
  'Finance/fund',
  'Finance/increase',
  'Finance/audit',
  // 物
  'Material/public',
  'Material/assets',
  'Material/store',
  'Material/operation',
  // 产
  'Production/public',
  // 供
  'Procurement/public',
  'Procurement/admittance',
  'Procurement/plans',
  'Procurement/purchase',
  'Procurement/inbound',
  'Procurement/payment',
  // 销
  'CRM/public',
  'CRM/customer',
  // 门户
  'Portal/public',
  // 科研
  'Research/public',
] as const

export type OssFolder = (typeof OSS_FOLDERS)[number]

const OSS_FOLDER_SET: ReadonlySet<string> = new Set(OSS_FOLDERS)

/** 单段路径里允许出现的字符：**ASCII 可打印、无空格、无 `?` `#`**。 */
const SAFE_SEGMENT = /^[A-Za-z0-9._!$&'()*+,;=@~-]+$/

function assertSafeSegment (value: string, what: string): string {
  if (value === '' || !SAFE_SEGMENT.test(value)) {
    throw new OssUploadParamError(
      `${what} 只允许 ASCII 字母数字与 . _ - ~ 一类可打印字符，不能含空格、` +
        `非 ASCII、/ ? # % \\ 等（收到 ${JSON.stringify(value)}）。` +
        '注意 object 的签名用的是**原样字符串**，含特殊字符时签名与请求路径会不一致',
    )
  }
  return value
}

/** `folder` 必须在白名单里，且每一段都得是安全段 */
export function assertFolder (folder: unknown): string {
  if (typeof folder !== 'string' || folder.trim() === '') {
    throw new OssUploadParamError(
      `folder 必填（常见取值见 OSS_FOLDERS，例 ${JSON.stringify(OSS_FOLDERS[0])}）`,
    )
  }
  const value = folder.trim()
  if (!OSS_FOLDER_SET.has(value)) {
    throw new OssUploadParamError(
      `folder ${JSON.stringify(value)} 不在白名单里。允许的取值只有 ` +
        `${OSS_FOLDERS.length} 个（取自 common/utils/oss.js 的 ossFilePathOptions）：` +
        OSS_FOLDERS.join('、'),
    )
  }
  return value
}

// ---------------------------------------------------------------------------
// 纯函数：对象名、URL、签名
//   全部导出且不碰网络 —— 测试直接钉住这些（签名算法必须有测试钉住）。
// ---------------------------------------------------------------------------

/**
 * 随机对象名：**16 位小写字母**。
 *
 * 复刻 `oss.js:12` 的 `customAlphabet('abcdefghijklmnopqrstuvwxyz', 16)`。
 *
 * ⚠️ **只复刻形状，不复刻 nanoid 的算法**。nanoid 用它自己的 PRNG + 掩码，
 * 本实现用 `crypto.randomBytes` 取模 26。两者产出的都是「16 位小写字母」，
 * 但**同一次调用不会得到同一个串**，不要拿它做任何跨实现的断言。
 */
export function generateRandomObjectName (randomBytes?: (size: number) => Buffer): string {
  const bytes = (randomBytes ?? nodeRandomBytes)(16)
  const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'
  let out = ''
  for (let i = 0; i < 16; i += 1) {
    out += ALPHABET.charAt((bytes[i] ?? 0) % 26)
  }
  return out
}

/** 从文件名里取扩展名（`oss.js:108,120` 的 `name.split('.').pop()`，但要先判有没有点） */
export function extensionOf (fileName: string): string {
  const parts = fileName.split('.')
  if (parts.length <= 1) return ''
  return parts[parts.length - 1] ?? ''
}

/**
 * 扩展名白名单。**不在表里的一律不带扩展名**（而不是瞎猜一个 content-type）。
 *
 * 这一条与 Portal **不一致**，是有意的：`renameRandom` 会把 `file.name` 的
 * `split('.').pop()` 原样拼上去，`a.tar.gz` 得到 `.gz`，`README` 得到不带扩展名。
 * 复刻它意味着要把调用方给的字符串**原样塞进 URL 路径**，而那个字符串可能带 `?`、`/`、
 * 甚至 `..`。所以本实现只接受这张表里的扩展名，其余情况给**不带扩展名**的随机名。
 */
const SAFE_EXTENSIONS: ReadonlySet<string> = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'heic',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'md', 'rtf',
  'zip', 'rar', '7z', 'tar', 'gz',
  'mp3', 'wav', 'flac', 'aac', 'mp4', 'mov', 'avi', 'mkv', 'webm',
  'json', 'xml', 'yaml', 'yml',
])

/** 取一个安全的扩展名（带点，或空串） */
export function safeExtension (fileName: string): string {
  const raw = extensionOf(fileName).toLowerCase()
  if (!SAFE_EXTENSIONS.has(raw)) return ''
  return `.${raw}`
}

/**
 * 生成 objectKey：`{folder}/{YYYY}/{MM}/{name}{.ext}`。
 *
 * 逐字段复刻 `oss.js:171` 的模板字面量（年月来自 dayjs，本实现从注入的时钟取 UTC 月）。
 *
 * `fixedName` 走的是 `renameRandom` 的 `fixedName` 分支（`oss.js:112-117`）：
 * 给了就用它，**并且在这里也走一遍安全段校验**（原实现不校验，见 `safeExtension` 的说明）。
 */
export function buildObjectKey (input: {
  folder: string
  fileName?: string
  /** 上传文件原始名，用来取扩展名 */
  sourceFileName?: string
  /** 固定名（不含扩展名）。不给则用随机名 */
  fixedName?: string
  now: Date
  randomName?: () => string
}): { objectKey: string; objectName: string } {
  const folder = assertFolder(input.folder)
  const year = String(input.now.getUTCFullYear()).padStart(4, '0')
  const month = String(input.now.getUTCMonth() + 1).padStart(2, '0')

  let base: string
  if (input.fixedName !== undefined && input.fixedName !== '') {
    base = assertSafeSegment(input.fixedName, 'fixedName')
  } else {
    base = (input.randomName ?? generateRandomObjectName)()
    if (!/^[a-z]{16}$/.test(base)) {
      throw new OssUploadParamError(
        `随机的对象名应当是 16 位小写字母，收到 ${JSON.stringify(base)}`,
      )
    }
  }

  const ext = safeExtension(input.sourceFileName ?? input.fileName ?? '')
  const objectName = `${base}${ext}`
  return { objectKey: `${folder}/${year}/${month}/${objectName}`, objectName }
}

/**
 * URL 里那一段对象路径。复刻 ali-oss 的 `_escape`：
 * `encodeURIComponent(key).replace(/%2F/g, '/')`（保留 `/`，与 `getReqUrl` 一致）。
 */
export function escapeObjectKey (objectKey: string): string {
  return encodeURIComponent(objectKey).replace(/%2F/g, '/')
}

/** 签名用的 canonical resource：**恒带桶名**，与 cname 与否无关（ali-oss `_getResource`）。 */
export function buildCanonicalResource (
  bucket: string,
  objectKey: string,
  subresources?: Readonly<Record<string, string>>,
): string {
  return buildCanonicalizedResource(`/${bucket}/${objectKey}`, subresources)
}

/**
 * canonicalized resource。逐行复刻 `signUtils.js:11-41`：
 * 有子资源时按 key 字典序拼 `?k[=v]`，**值为空串时只留 key 不带 `=`**（`?acl`）。
 */
export function buildCanonicalizedResource (
  resourcePath: string,
  subresources?: Readonly<Record<string, string>>,
): string {
  const entries = Object.entries(subresources ?? {})
  if (entries.length === 0) return resourcePath
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  let out = resourcePath
  let sep = '?'
  for (const [key, value] of entries) {
    out += `${sep}${key}`
    if (value) out += `=${value}`
    sep = '&'
  }
  return out
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

function pad2 (value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * V1 签名用的日期串，格式 `ddd, dd mmm yyyy HH:MM:ss GMT`。
 *
 * 出处：`createRequest.js:31` —— `authorizationV4` 为假时用
 * `dateformat(date, "UTC:ddd, dd mmm yyyy HH:MM:ss 'GMT'")`。
 * **必须用 UTC**，而且这个格式与 HTTP 的 `Date` 头一致。
 */
export function formatOssDateV1 (date: Date): string {
  const day = DAY_NAMES[date.getUTCDay()] ?? 'Thu'
  const month = MONTH_NAMES[date.getUTCMonth()] ?? 'Jan'
  return (
    `${day}, ${pad2(date.getUTCDate())} ${month} ${date.getUTCFullYear()} ` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())} GMT`
  )
}

/**
 * V1 的 canonical string。逐行复刻 `signUtils.js:44-83`：
 *
 * ```
 * VERB\n
 * Content-MD5\n
 * Content-Type\n
 * Date\n                  ← ali-oss 传的是 x-oss-date 的值（它不发 Date 头）
 * CanonicalizedOSSHeaders ← 排序后的 x-oss-*，形如 "x-oss-date:...\n"
 * CanonicalizedResource
 * ```
 *
 * ⚠️ 一个容易漏的点：**`x-oss-date` 出现两次** —— 第 4 行（占 `Date` 的位置）
 * 和 canonicalized OSS headers 里各一次。ali-oss 没有把它从后者排除
 * （`signUtils.js:59-72` 只按 `x-oss-` 前缀收集），OSS 服务端也是这么算的。
 * 所以这里也照做，不是笔误。
 */
export function buildCanonicalStringV1 (input: {
  method: string
  contentMd5?: string
  contentType?: string
  /** 已格式化的 RFC1123 GMT 串，见 formatOssDateV1 */
  date: string
  ossHeaders?: Readonly<Record<string, string>>
  resource: string
}): string {
  const lines: string[] = [
    input.method.toUpperCase(),
    input.contentMd5 ?? '',
    input.contentType ?? '',
    input.date,
  ]

  // 键统一成小写后排序（ali-oss 的 lowercaseKeyHeader + .sort()）
  const normalized = new Map<string, string>()
  for (const [key, value] of Object.entries(input.ossHeaders ?? {})) {
    normalized.set(key.toLowerCase(), String(value).trim())
  }
  for (const key of [...normalized.keys()].sort()) {
    lines.push(`${key}:${normalized.get(key)}`)
  }

  lines.push(input.resource)
  return lines.join('\n')
}

/** `base64(HMAC-SHA1(secret, canonicalString))`，逐行复刻 `signUtils.js:88-91`。 */
export function computeSignatureV1 (accessKeySecret: string, canonicalString: string): string {
  return createHmac('sha1', accessKeySecret).update(Buffer.from(canonicalString, 'utf8')).digest('base64')
}

/**
 * 完整的 `Authorization` 头：`OSS {ak}:{signature}`。
 * 出处：`signUtils.js:98-100`（拼法），`createRequest.js:101-102`（V1 分支）。
 */
export function buildAuthorizationV1 (input: {
  accessKeyId: string
  accessKeySecret: string
  canonicalString: string
}): string {
  const signature = computeSignatureV1(input.accessKeySecret, input.canonicalString)
  return `OSS ${input.accessKeyId}:${signature}`
}

/** `base64(md5(content))`，ali-oss 在 content 是 Buffer 时会带上它（`createRequest.js:70-75`） */
export function contentMd5Base64 (content: Buffer): string {
  return createHash('md5').update(content).digest('base64')
}

/**
 * 按扩展名猜 content-type。**`mime` 包那张表的一个子集**，不是全表。
 *
 * 认不出来时给 `application/octet-stream` —— 与直接摘掉 Content-Type 相比，
 * 一个明确的 octet-stream 更容易排查（而且 Content-Type 是 canonical string 的第 3 行，
 * 一旦为空就必须发空串，容易和「没设」混淆）。
 */
export function contentTypeOf (fileName: string): string {
  const ext = extensionOf(fileName).toLowerCase()
  const table: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    tiff: 'image/tiff',
    heic: 'image/heic',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv',
    txt: 'text/plain',
    md: 'text/markdown',
    rtf: 'application/rtf',
    zip: 'application/zip',
    rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar',
    gz: 'application/gzip',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    aac: 'audio/aac',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    json: 'application/json',
    xml: 'application/xml',
    yaml: 'application/yaml',
    yml: 'application/yaml',
  }
  return table[ext] ?? 'application/octet-stream'
}

/** 可公开读的最终 URL。cname 与否只影响 host，不影响路径。 */
export function buildPublicUrl (input: {
  endpoint: string
  bucket: string
  objectKey: string
  cname: boolean
  secure: boolean
}): string {
  const scheme = input.secure ? 'https' : 'http'
  const host = input.cname ? input.endpoint : `${input.bucket}.${input.endpoint}`
  return `${scheme}://${host}/${escapeObjectKey(input.objectKey)}`
}

// ---------------------------------------------------------------------------
// 一次 OSS 请求的拼装与执行
// ---------------------------------------------------------------------------

type ResolvedConfig = ReturnType<typeof assertOssConfig>

/** 一次签名请求的完整形状 —— `prepare()` 的产出，也是 `send()` 的输入 */
/**
 * 把「多个 objectKey」的分隔字符串拆成数组。
 *
 * 为什么要有这个：`ParamSpec` 的 `kind` 里**没有数组类型**（`src/capabilities/types.ts`），
 * 所以 AI 侧只能用一段文本来表达多个键。这里收**换行与逗号**两种分隔符 ——
 * 换行是模型列清单时最自然的写法，逗号是手写时最自然的写法。
 *
 * 顺带做三件清理：去首尾空白、丢掉空段（末尾多一个换行不该变成"要删一个空键"）、去重。
 */
export function splitObjectKeyList (text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((part) => part.trim())
        .filter((part) => part !== ''),
    ),
  ]
}

/**
 * 本文件用得着的 OSS 动词。
 *
 * - `PUT` —— `PutObject` / `PutObjectACL`
 * - `GET` —— `GetObjectACL`
 * - `DELETE` —— `DeleteObject`（单个删除）
 * - `POST` —— `DeleteMultipleObjects`（批量删，`POST /?delete` + XML body）
 * - `HEAD` —— 目前没有能力用它，留着是因为签名逻辑对它是通用的
 */
export type OssMethod = 'PUT' | 'GET' | 'DELETE' | 'POST' | 'HEAD'

export type OssPreparedRequest = {
  method: OssMethod
  url: string
  headers: Record<string, string>
  /** 已经算好的 canonical string，调试时唯一需要看的东西（**不含密钥**） */
  canonicalString: string
  objectKey: string
  /** 子资源，例 `{acl: ''}` */
  subresources?: Readonly<Record<string, string>>
  /** 要发的字节（只有 PutObject 有） */
  body?: Buffer
  /** 该对象上传成功后可访问的 URL（只有 PutObject 有；GET/PUT ACL 不产出它） */
  publicUrl?: string
}

function resolveFetch (config: ResolvedConfig): FetchLike {
  const injected = config.runtime?.fetch
  if (injected) return injected
  if (typeof globalThis.fetch !== 'function') {
    throw new OssUploadParamError(
      '当前运行时没有全局 fetch（需要 Node 18+）。' +
        '可以通过 config.runtime.fetch 注入一个实现',
    )
  }
  return globalThis.fetch.bind(globalThis) as FetchLike
}

/**
 * 组装一次带 V1 签名的 OSS 请求。**纯本地、不发网络。**
 *
 * 这是本文件的核心：签名算法全部经过这里，测试直接钉它的输出
 * （canonical string 与 Authorization 两段）。
 */
export function prepareOssRequest (input: {
  config: ResolvedConfig
  method: OssMethod
  objectKey: string
  subresources?: Readonly<Record<string, string>>
  /** 额外的 x-oss-* 头，会进 canonical string，例 `{ 'x-oss-object-acl': 'public-read' }` */
  ossHeaders?: Readonly<Record<string, string>>
  contentType?: string
  body?: Buffer
  /** 覆盖签名日期（测试用；不传则读时钟） */
  now?: Date
}): OssPreparedRequest {
  const { config } = input
  const now = input.now ?? config.runtime?.now?.() ?? new Date()
  const date = formatOssDateV1(now)

  const headers: Record<string, string> = {
    // ali-oss 不发 Date 头，用 x-oss-date 代替（createRequest.js:29-31）
    'x-oss-date': date,
  }
  if (input.contentType) {
    headers['Content-Type'] = input.contentType
  }
  if (input.body) {
    headers['Content-MD5'] = contentMd5Base64(input.body)
    headers['Content-Length'] = String(input.body.length)
  }
  for (const [key, value] of Object.entries(input.ossHeaders ?? {})) {
    headers[key] = value
  }

  // canonical string 里的 x-oss-* 头：把上面所有 x-oss- 前缀的（含 x-oss-date）收进去
  const ossHeaders: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase().startsWith('x-oss-')) {
      ossHeaders[key.toLowerCase()] = value
    }
  }

  const canonicalString = buildCanonicalStringV1({
    method: input.method,
    contentMd5: headers['Content-MD5'],
    contentType: headers['Content-Type'],
    date,
    ossHeaders,
    resource: buildCanonicalResource(config.bucket, input.objectKey, input.subresources),
  })

  headers.Authorization = buildAuthorizationV1({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    canonicalString,
  })

  const base = buildPublicUrl({
    endpoint: config.endpoint,
    bucket: config.bucket,
    objectKey: input.objectKey,
    cname: config.cname,
    secure: config.secure,
  })
  // ⚠️ 这里与 canonical resource **故意不一致**，是复刻 ali-oss 的真实行为：
  // URL 上是 `?acl=`（`url.format({acl:''})` 会补上等号，实测），而 canonical resource
  // 上是 `?acl`（`buildCanonicalizedResource` 对空值不拼 `=`）。
  // 两处都照抄，因为 Portal 的上传一直是这么发且 OSS 接受；改成"看着更对"的 `?acl`
  // 意味着签名以外的字节与线上不一致，反而更难比对。
  const query = Object.keys(input.subresources ?? {})
    .sort()
    .map((key) => `${key}=`)
    .join('&')

  return {
    method: input.method,
    url: query ? `${base}?${query}` : base,
    headers,
    canonicalString,
    objectKey: input.objectKey,
    subresources: input.subresources,
    body: input.body,
    publicUrl: input.method === 'PUT' && !input.subresources ? base : undefined,
  }
}

/** 从 OSS 的 XML 错误体里抠出 `<Code>` / `<Message>`。抠不到就返回空，不猜。 */
export function parseOssErrorXml (xml: string): { code?: string; message?: string } {
  const code = /<Code>([^<]*)<\/Code>/.exec(xml)?.[1]
  const message = /<Message>([^<]*)<\/Message>/.exec(xml)?.[1]
  return { code: code || undefined, message: message || undefined }
}

/** 从 GetObjectACL 的 XML 里抠出 `<Grant>` */
export function parseAclXml (xml: string): string | undefined {
  const grant = /<Grant>([^<]*)<\/Grant>/.exec(xml)?.[1]
  return grant || undefined
}

/**
 * XML 文本转义。**只转这 5 个**（OSS 的 `utility.escape` 转的就是这几个）。
 *
 * 为什么必须转：objectKey 里出现 `&` 或 `<` 时，不转义会拼出一段**结构被改掉**的 XML ——
 * 轻则 OSS 报 MalformedXML，重则删掉一个键名被截断的对象。这是删东西的接口，
 * 宁可在这里多一道。
 */
export function escapeXmlText (value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 批量删除的请求体（`DeleteMultipleObjects`，`POST /?delete`）。
 *
 * 逐字段照抄 ali-oss 的 `deleteMulti`（`lib/common/object/deleteMulti.js`）+
 * `obj2xml(obj, { headers: true })`：
 *
 * ```xml
 * <?xml version="1.0" encoding="UTF-8"?>
 * <Delete><Quiet>false</Quiet><Object><Key>a.png</Key></Object><Object><Key>b.png</Key></Object></Delete>
 * ```
 *
 * ⚠️ `Quiet` 是 **`false`** —— ali-oss 写的是 `!!options.quiet`，不传就是 false。
 * 这个值很重要：`Quiet=false` 时 OSS 才会在响应里**逐个列出真正删掉的 Key**，
 * 那正是我们要的"独立证实"的证据。设成 `true` 就只能拿到一个 200，
 * 又回到"接口返回成功不算验证"。
 */
export function buildDeleteMultiXml (objectKeys: readonly string[]): string {
  const objects = objectKeys
    .map((key) => `<Object><Key>${escapeXmlText(key)}</Key></Object>`)
    .join('')
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + `<Delete><Quiet>false</Quiet>${objects}</Delete>`
}

/**
 * 从批量删除的响应里抠出 OSS 说**真的删掉了**的 Key。
 *
 * `DeleteResult` 里 `Deleted` 与 `Error` 是并列的：**有的键删成功、有的删失败**，
 * 一次请求里可能两者都有（例如权限只覆盖一部分前缀）。所以这里必须把 `Deleted` 与
 * `Error` 分开返回 —— 只看 HTTP 200 会把"部分失败"读成"全成功"。
 */
export function parseDeleteMultiXml (xml: string): {
  deleted: string[]
  errors: Array<{ key?: string; code?: string; message?: string }>
} {
  const deleted: string[] = []
  for (const match of xml.matchAll(/<Deleted>([\s\S]*?)<\/Deleted>/g)) {
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(match[1] ?? '')?.[1]
    if (key !== undefined) deleted.push(key)
  }

  const errors: Array<{ key?: string; code?: string; message?: string }> = []
  for (const match of xml.matchAll(/<Error>([\s\S]*?)<\/Error>/g)) {
    const block = match[1] ?? ''
    errors.push({
      key: /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1],
      code: /<Code>([\s\S]*?)<\/Code>/.exec(block)?.[1],
      message: /<Message>([\s\S]*?)<\/Message>/.exec(block)?.[1],
    })
  }

  return { deleted, errors }
}

async function send (prepared: OssPreparedRequest, config: ResolvedConfig, capabilityId: string): Promise<string> {
  const fetchImpl = resolveFetch(config)
  const init: RequestInit = { method: prepared.method, headers: prepared.headers }
  if (prepared.body) {
    // Buffer 是 Uint8Array 的子类，undici 直接收；用 RequestInit['body'] 取类型，
    // 不直接写 BodyInit —— 那个名字在 lib ES2023 + types node 下不是全局可见的
    init.body = prepared.body as unknown as RequestInit['body']
  }

  let response: Response
  try {
    response = await fetchImpl(prepared.url, init)
  } catch (error) {
    throw new OssRequestError({
      status: 0,
      capabilityId,
      detail:
        `连不上 OSS（${prepared.method} ${prepared.url}）：` +
        (error instanceof Error ? error.message : String(error)) +
        '\n注意这里**没有**回显任何请求头，Authorization 里含签名，不该进日志。',
    })
  }

  const text = await response.text()

  if (!response.ok) {
    const parsed = parseOssErrorXml(text)
    throw new OssRequestError({
      status: response.status,
      code: parsed.code,
      ossMessage: parsed.message,
      requestId: response.headers.get('x-oss-request-id') ?? undefined,
      capabilityId,
      detail:
        'canonical string（不含密钥，可直接与 OSS 文档对照）：\n' +
        prepared.canonicalString,
    })
  }

  return text
}

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

/**
 * 一次上传要传的字节从哪里来。**二选一**，两个都给会报错（不猜优先级）。
 *
 * - `content`：已经在内存里的字节（程序化调用用这个）
 * - `path`：本地文件路径（AI 侧用这个 —— 它只能给路径，给不了 Buffer）
 */
export type OssUploadSource =
  | { content: Buffer; path?: undefined }
  | { path: string; content?: undefined }

export type OssUploadRequest = OssUploadSource & {
  /** 白名单里的目录，见 `OSS_FOLDERS` */
  folder: string
  /**
   * 文件名，**含扩展名**。角色等同 Portal 里的 `file.name`（`oss.js:108` 的
   * `file.name.split('.')`）——扩展名与 content-type 都是从这里推的。
   *
   * 用 `path` 作来源时不给也行（路径的 basename 就是它）；用 `content`（Buffer）时
   * **必须给**，否则对象名不带扩展名、content-type 只能是 `application/octet-stream`
   * —— 浏览器里每个 File 都自带名字，无头下没有别的地方能推出来。
   */
  fileName?: string
  /**
   * 固定对象名（**不含扩展名**），复刻 `renameRandom` 的 `fixedName` 分支
   * （`oss.js:112-117`）。不给则用 16 位小写字母的随机名。
   *
   * ⚠️ 固定名会**直接覆盖**桶里的同名对象，成组上传时才用它。
   */
  fixedName?: string
  /** 覆盖 content-type；不给则按文件名扩展名猜 */
  contentType?: string
}

export type OssUploadResult = {
  /** 可访问的 url（**https**，除非显式 secure: false） */
  url: string
  /** 桶内路径，业务接口通常存的是 url 而不是它，但排查时要 */
  objectKey: string
  /** 本次实际发出去的 content-type */
  contentType: string
  /** 字节数 */
  size: number
  /**
   * 读回的 ACL。**这是复核的产物**，不是我们自己填的那个值：
   * `upload()` 在 putACL 之后会再 GetObjectACL 一次，把 OSS 的答复放在这里。
   * 拿不到（GetObjectACL 本身失败）时是 `undefined`，不影响上传结果。
   */
  acl?: string
}

/**
 * 把「上传一个文件、拿回可访问 url」做成一个能力。
 *
 * 与别的写能力不同：这里**没有后端接口**，走的是 OSS 的纯 HTTP + V1 签名，
 * 所以不需要 `PortalRequest`（那是 Portal 后端的请求函数），而需要 `OssUploadConfig`。
 */
export function createBaseUploadCapability (config: Partial<OssUploadConfig>) {
  const raw = config ?? {}

  /**
   * **懒校验**：凭据在「第一次真的要发请求」的那一刻才校验，不在创建时。
   *
   * 为什么不是创建时校验（这一条 2026-09-20 由派单方拍板改过）：
   * 上传是**可选**能力，把 OSS 配置放进 SDK 配置里就意味着绝大多数调用方
   * **根本不配它**。如果在 `createPortalHeadless()` 里就校验，一个不传 OSS 配置的
   * 用户会**整个 SDK 创建不出来** —— 一个可选能力把主干弄挂，代价远大于收益。
   *
   * ⚠️ **失败关闭的性质没有变，只变了时机**：`upload` / `getAcl` / `putAcl` 三个方法
   * 都在**发出任何网络请求之前**先调 `resolve()`，所以未配置凭据时它们抛的仍然是
   * 同一个 `OssCredentialError`、文案里仍然逐条列出缺哪几个字段。
   * 三个方法**一个都没漏** —— 漏掉任何一个都等于给「悄悄用空凭据去试一下」开口子。
   */
  let cached: ResolvedConfig | undefined
  function resolve (): ResolvedConfig {
    if (!cached) cached = assertOssConfig(raw)
    return cached
  }

  /** 读字节。`path` 走 fs，`content` 直接用 */
  async function readSource (source: OssUploadSource): Promise<{ bytes: Buffer; name: string }> {
    const hasContent = source.content !== undefined
    const hasPath = source.path !== undefined
    if (hasContent && hasPath) {
      throw new OssUploadParamError('content 与 path 只能给一个（两个都给了，无法判断以哪个为准）')
    }
    if (!hasContent && !hasPath) {
      throw new OssUploadParamError('必须给 content（Buffer）或 path（本地文件路径）其中之一')
    }
    if (hasPath) {
      const path = String(source.path)
      let bytes: Buffer
      try {
        bytes = await readFile(path)
      } catch (error) {
        throw new OssUploadParamError(
          `读不到本地文件 ${JSON.stringify(path)}：` +
            (error instanceof Error ? error.message : String(error)),
        )
      }
      return { bytes, name: path.split(/[\\/]/).pop() ?? '' }
    }
    const bytes = source.content as Buffer
    if (!Buffer.isBuffer(bytes)) {
      throw new OssUploadParamError(
        `content 必须是 Buffer（收到 ${typeof bytes}）。字符串请先 Buffer.from(..., 'utf8')`,
      )
    }
    return { bytes, name: '' }
  }

  /**
   * 读 ACL 的实现。抽成闭包而不是对象上的方法，是因为 `upload()` 要调它 ——
   * 用 `this.getAcl(...)` 的话，调用方一解构方法就炸（`this` 丢了），
   * 而这类失败在类型上完全看不出来。
   */
  async function getAcl (objectKey: string): Promise<string | undefined> {
    // 凭据先于一切：连参数都不看，先确认自己有凭据可用（失败关闭，见 resolve 的说明）
    const resolved = resolve()
    const key = assertSafeObjectKey(objectKey)
    const prepared = prepareOssRequest({
      config: resolved,
      method: 'GET',
      objectKey: key,
      subresources: { acl: '' },
    })
    const xml = await send(prepared, resolved, 'base-upload-acl-get')
    return parseAclXml(xml)
  }

  async function putAcl (
    objectKey: string,
    acl: 'public-read' | 'private' | 'public-read-write' | 'default',
  ): Promise<void> {
    const resolved = resolve()
    const key = assertSafeObjectKey(objectKey)
    const prepared = prepareOssRequest({
      config: resolved,
      method: 'PUT',
      objectKey: key,
      subresources: { acl: '' },
      ossHeaders: { 'x-oss-object-acl': acl },
      contentType: 'application/xml',
    })
    await send(prepared, resolved, 'base-upload-acl-set')
  }

  /**
   * 删一个对象（`DELETE /{key}`）。**写操作，不可撤销。**
   *
   * ⚠️ `DeleteObject` 是**幂等**的：删一个不存在的 key，OSS 同样返回 204。
   * 所以"到底删掉了没有"**不能靠这次调用的返回值判断** ——
   * 要像 `test/base-upload.test.ts` 的 LIVE 组那样，删完再去读一次。
   */
  async function deleteObject (objectKey: string): Promise<{ objectKey: string }> {
    const resolved = resolve()
    const key = assertSafeObjectKey(objectKey)
    const prepared = prepareOssRequest({
      config: resolved,
      method: 'DELETE',
      objectKey: key,
    })
    await send(prepared, resolved, 'base-upload-delete')
    return { objectKey: key }
  }

  /**
   * 批量删（`POST /?delete` + XML body）。**写操作，不可撤销。**
   *
   * ⚠️ 与 `deleteObject` 不同，这一条**会逐个回报结果**：响应里 `Deleted` 是真删掉的，
   * `Error` 是没删掉的（可以同时存在）。所以它比单个删除**更能证实自己干了什么** ——
   * 这也是它值得单独存在的理由之一。
   *
   * 单次上限 **1000 个键**（OSS 的限制），超了当场拒，不拆包 ——
   * 悄悄拆成多次请求意味着"部分成功"的语义变得难说清楚。
   */
  async function deleteMulti (
    objectKeys: readonly string[] | string,
  ): Promise<{ deleted: string[]; errors: Array<{ key?: string; code?: string; message?: string }> }> {
    const resolved = resolve()
    // 既收数组（程序化调用），也收分隔字符串（AI 侧：能力参数类型里没有数组）。
    // 直接在这里收下字符串，是为了让 invoke 的绑定就写 `host.deleteMulti(args.objectKeys)`
    // 一行 —— 不必再多导出一个"把字符串拆成数组"的函数出来当公共 API。
    const list = typeof objectKeys === 'string' ? splitObjectKeyList(objectKeys) : objectKeys
    if (!Array.isArray(list) || list.length === 0) {
      throw new OssUploadParamError('批量删除至少要给一个 objectKey')
    }
    if (list.length > OSS_DELETE_MULTI_LIMIT) {
      throw new OssUploadParamError(
        `批量删除一次最多 ${OSS_DELETE_MULTI_LIMIT} 个（OSS 的限制），收到 ${list.length} 个。` +
          '请分批调用 —— 不自动拆包，因为拆包会把"部分成功"的语义藏起来',
      )
    }
    const keys = list.map((key) => assertSafeObjectKey(key))

    const prepared = prepareOssRequest({
      config: resolved,
      method: 'POST',
      // 桶级操作：objectKey 是空的，目标全在 body 里
      objectKey: '',
      subresources: { delete: '' },
      contentType: 'application/xml',
      body: Buffer.from(buildDeleteMultiXml(keys), 'utf8'),
    })
    const xml = await send(prepared, resolved, 'base-upload-delete-multi')
    return parseDeleteMultiXml(xml)
  }

  return {
    /**
     * **只读的一步：把这次上传会产生的身份算出来，一个字节都不发。**
     *
     * ⚠️ 与业务写能力的 `prepare()` **不是一回事**，别混。那边问的是后端
     * 「这次要哪些审批人」（`docs/conventions.md` 第 13 条），是网络请求；
     * 这里纯粹是本地计算 —— OSS 没有「上传前先问一次」这种东西。
     * 它的用处是：**在上传之前就能把 url 写进别的表单**，以及出问题时能拿
     * canonical string 跟 OSS 文档逐行对照。
     *
     * 因为不发网络，它**不消耗任何 OSS 配额，也不会产生垃圾对象**，可以放心先跑。
     */
    async prepare (request: OssUploadRequest): Promise<OssPreparedRequest> {
      // 凭据先于一切：连本地文件都不读（readSource 会碰 fs），先确认凭据可用。
      // prepare 不发网络，但**仍然要校验凭据** —— 否则它会返回一个签名好的请求形状，
      // 让调用方以为"这一步过了就没问题"，而问题恰恰在凭据上。
      const resolved = resolve()
      const { bytes, name } = await readSource(request)
      const folder = assertFolder(request.folder)
      const sourceFileName = request.fileName && request.fileName !== ''
        ? request.fileName
        : name
      const { objectKey } = buildObjectKey({
        folder,
        sourceFileName,
        fixedName: request.fixedName,
        now: resolved.runtime?.now?.() ?? new Date(),
        randomName: resolved.runtime?.randomName,
      })
      const contentType = request.contentType ?? contentTypeOf(sourceFileName || objectKey)
      return prepareOssRequest({
        config: resolved,
        method: 'PUT',
        objectKey,
        contentType,
        body: bytes,
        now: resolved.runtime?.now?.(),
      })
    },

    /**
     * **写操作**：PutObject + PutObjectACL，然后把 ACL 读回来复核。返回可访问 url。
     *
     * 三步的顺序是刻意的：
     * 1. `PUT /{key}` 传字节；
     * 2. `PUT /{key}?acl` 设 `public-read` —— **不能省**，桶不是默认公共读，
     *    省了的话上传"成功"而 url 读不出来（`oss.js:176-177` 的由来）；
     * 3. `GET /{key}?acl` 读回来 —— 第 2 步返回 200 只说明 OSS **收下了**这个请求，
     *    不代表 ACL 真变成了 public-read。这一步的结论放在 `result.acl` 里。
     *    （这是本项目「接口返回成功不算验证」那条规矩在上传链上的落地。）
     *
     * ⚠️ **没有 `cancel`**。写链路的撤销在这里对应 OSS 的 `DeleteObject`，本能力
     * **没有实现它** —— 见 `docs/base/上传.md` 的欠账一节。也就是说：上传成功但业务
     * 表单没提交成功时，OSS 上会留下一个**孤儿对象**。当前只能由调用方自行清理。
     */
    async upload (request: OssUploadRequest): Promise<OssUploadResult> {
      const resolved = resolve()
      const { bytes, name } = await readSource(request)
      const folder = assertFolder(request.folder)
      const sourceFileName = request.fileName && request.fileName !== ''
        ? request.fileName
        : name
      const { objectKey } = buildObjectKey({
        folder,
        sourceFileName,
        fixedName: request.fixedName,
        now: resolved.runtime?.now?.() ?? new Date(),
        randomName: resolved.runtime?.randomName,
      })
      const contentType = request.contentType ?? contentTypeOf(sourceFileName || objectKey)

      const put = prepareOssRequest({
        config: resolved,
        method: 'PUT',
        objectKey,
        contentType,
        body: bytes,
      })
      await send(put, resolved, 'base-upload-file')

      const aclPut = prepareOssRequest({
        config: resolved,
        method: 'PUT',
        objectKey,
        subresources: { acl: '' },
        ossHeaders: { 'x-oss-object-acl': 'public-read' },
        contentType: 'application/xml',
      })
      await send(aclPut, resolved, 'base-upload-file')

      // 复核：读回来的是 OSS 说的，不是我们填的。失败不影响上传结果本身。
      let acl: string | undefined
      try {
        acl = await getAcl(objectKey)
      } catch {
        acl = undefined
      }

      return {
        url: put.publicUrl as string,
        objectKey,
        contentType,
        size: bytes.length,
        acl,
      }
    },

    /**
     * 读对象的 ACL（`GET /{key}?acl`）。**只读**，用来复核一个对象的可读性。
     *
     * 返回 `<Grant>` 的原文（通常是 `public-read` / `private` / `default`）。
     * Portal 的 `ossPut` 也调了一次 `getACL` 但把返回值丢掉了（`oss.js:176`）——
     * 本实现留着一个可调用的入口，让「url 到底能不能被外人读到」有地方问。
     */
    getAcl,

    /**
     * 改对象的 ACL（`PUT /{key}?acl`）。**写操作**。
     *
     * 单独暴露它的理由：`upload()` 走到第 2 步失败时（网络抖一下之类），对象已经在
     * 桶里了，只剩 ACL 没设 —— 这时不需要重传字节，只需要补这一步。除此之外
     * **不要**用它去改别人的对象。
     */
    putAcl,

    /**
     * 删一个对象（`DeleteObject`）。**写操作，不可撤销。**
     *
     * SDK 直到 2026-09-21 才有这个能力 —— 之前"上传上去就删不掉"，
     * 测试产物会一直堆在桶里（真实踩到：调休流程那条线传的一个 70 字节 png 没有出口）。
     *
     * ⚠️ **幂等**：删不存在的 key 也返回 204，所以"删掉了没有"要靠**再读一次**来证实，
     * 不能靠这次调用的返回值。LIVE 测试里就是这么做的。
     */
    deleteObject,
    deleteMulti,

    /**
     * 抹掉凭据之后的配置画像。要用配置做日志/报错时走这里，别直接 JSON.stringify。
     *
     * 读的是**原始**（未校验的）配置，所以它在没配凭据时**也能跑、也不抛** ——
     * 它正是用来回答「到底配上了没有」的，如果它自己也抛，就没法排查了。
     */
    describeConfig (): Record<string, unknown> {
      return redactOssConfig(raw)
    },
  }
}

/**
 * 调用方给回来的 objectKey 也要过一遍：它会被直接拼进签名资源与 URL。
 * 拒绝绝对路径、`..`、以及任何带 `?`/`#` 的串（那些能改变请求的语义）。
 */
export function assertSafeObjectKey (objectKey: unknown): string {
  if (typeof objectKey !== 'string' || objectKey.trim() === '') {
    throw new OssUploadParamError('objectKey 必填')
  }
  const key = objectKey.trim()
  if (key.startsWith('/')) {
    throw new OssUploadParamError(
      `objectKey 不要以前导 / 开头（收到 ${JSON.stringify(key)}）。` +
        '它是桶内路径，例 HR/public/2026/09/abcdefghijklmnop.png',
    )
  }
  if (key.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) {
    throw new OssUploadParamError(
      `objectKey 里不能有空段、. 或 ..（收到 ${JSON.stringify(key)}）`,
    )
  }
  const urlUnsafe = /[?#%\s]/.test(key)
  if (urlUnsafe) {
    throw new OssUploadParamError(
      `objectKey 不能含空格、? # % 一类会改变 URL 语义的字符（收到 ${JSON.stringify(key)}）`,
    )
  }
  return key
}

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

/**
 * 凭据字段的声明。`ParamSpec` 描述的是**调用方（AI）要填的参数**，而凭据不是
 * 每次调用都填的东西 —— 它是 SDK 创建时由接入方注入的。所以它单独一类，
 * 但仍然要**在契约里能看出来哪些是凭据**（本单的要求）。
 *
 * `kind` 只有两个值：
 * - `'credential'`：秘密，任何输出里都必须被抹掉（`redactOssConfig`）
 * - `'target'`：不是秘密，但同样是 SDK 创建时注入的、指向「传到哪个桶」
 */
export type OssCredentialField = {
  name: keyof OssUploadConfig
  kind: 'credential' | 'target'
  required: boolean
  description: string
}

export type BaseUploadCapabilityDefinition = CapabilityDefinition & {
  /** 本族能力需要的**创建期**配置。凭据只在这里出现，绝不进 `params`。 */
  credentials: OssCredentialField[]
}

const OSS_CREDENTIALS: OssCredentialField[] = [
  {
    name: 'accessKeyId',
    kind: 'credential',
    required: true,
    description: 'OSS AccessKeyId。由接入方通过 SDK 配置传入，SDK 不读环境变量、不读文件、不从浏览器抓',
  },
  {
    name: 'accessKeySecret',
    kind: 'credential',
    required: true,
    description: 'OSS AccessKeySecret。**绝不进日志、报错、测试或提交**；输出前一律经 redactOssConfig 抹成 <redacted>',
  },
  {
    name: 'bucket',
    kind: 'target',
    required: true,
    description: '目标桶名。不是秘密，但同样在创建期给，不随每次调用变',
  },
  {
    name: 'endpoint',
    kind: 'target',
    required: true,
    description: '端点主机名（不带协议），例 oss-cn-hangzhou.aliyuncs.com',
  },
  {
    name: 'region',
    kind: 'target',
    required: false,
    description: '区域。V1 签名用不到它，收在这里只为与 Portal 的 ossConfigV2 逐字段对齐',
  },
]

const FOLDER_PARAM: ParamSpec = {
  name: 'folder',
  kind: 'enum',
  required: true,
  description:
    '上传到桶里的哪个目录。取值是白名单（取自 Portal 的 common/utils/oss.js 的 ossFilePathOptions），' +
    `共 ${OSS_FOLDERS.length} 个。选错不会报错，只会让文件散在一个没人找得到的地方`,
  options: OSS_FOLDERS.map((value) => ({ label: value, value })),
}

export const baseUploadCapabilities: BaseUploadCapabilityDefinition[] = [
  {
    id: 'base-upload-file',
    title: '上传文件到 OSS 并拿到可访问 url',
    pagePath: BASE_UPLOAD_SOURCE,
    permission: BASE_UPLOAD_PERMISSION,
    write: true,
    credentials: OSS_CREDENTIALS,
    params: [
      {
        name: 'path',
        kind: 'text',
        required: true,
        description:
          '本地文件路径。上传的就是这个文件里的字节；SDK 不做图片压缩/切割/PDF 解析' +
          '（那些要浏览器 canvas / wasm），需要处理过的字节请调用方先处理好',
      },
      FOLDER_PARAM,
      {
        name: 'fileName',
        kind: 'text',
        required: false,
        description:
          '文件名，**含扩展名**（例 invoice.pdf）。扩展名与 content-type 都从它推，' +
          '可识别的扩展名有限（png/jpg/pdf/docx/xlsx/zip/mp4 等），认不出就不带扩展名。' +
          '给 path 时可以省（路径自带名字）；用 content 传 Buffer 时最好给',
      },
      {
        name: 'fixedName',
        kind: 'text',
        required: false,
        description:
          '固定对象名，**不含扩展名**（扩展名仍从 fileName 推）。不给则用 16 位小写字母的随机名。' +
          '⚠️ 同名会**直接覆盖**桶里已有的对象，批量上传不要用它',
      },
      {
        name: 'contentType',
        kind: 'text',
        required: false,
        description: '覆盖 content-type；不给则按扩展名猜，猜不到给 application/octet-stream',
      },
    ],
  },
  {
    id: 'base-upload-acl-get',
    title: '查询 OSS 对象的读权限',
    pagePath: BASE_UPLOAD_SOURCE,
    permission: BASE_UPLOAD_PERMISSION,
    write: false,
    credentials: OSS_CREDENTIALS,
    params: [
      {
        name: 'objectKey',
        kind: 'text',
        required: true,
        description:
          '桶内路径，形如 HR/public/2026/09/abcdefghijklmnop.png（base-upload-file 会返回它）。' +
          '返回 public-read 才说明外人能直接打开这个 url',
      },
    ],
  },
  {
    id: 'base-upload-delete',
    title: '删除 OSS 上的一个对象',
    pagePath: BASE_UPLOAD_SOURCE,
    permission: BASE_UPLOAD_PERMISSION,
    write: true,
    credentials: OSS_CREDENTIALS,
    params: [
      {
        name: 'objectKey',
        kind: 'text',
        required: true,
        description:
          '桶内路径，形如 HR/approval/2026/09/abcdefghijklmnop.png（base-upload-file 会返回它）。' +
          '⚠️ **不可撤销**，且**幂等**：删不存在的 key 也返回成功，所以"删掉了没有"要再读一次才算',
      },
    ],
  },
  {
    id: 'base-upload-delete-multi',
    title: '批量删除 OSS 上的多个对象',
    pagePath: BASE_UPLOAD_SOURCE,
    permission: BASE_UPLOAD_PERMISSION,
    write: true,
    credentials: OSS_CREDENTIALS,
    params: [
      {
        name: 'objectKeys',
        kind: 'text',
        required: true,
        description:
          '要删的桶内路径，**多个用换行或逗号分隔**（参数类型里没有数组，所以用分隔符表达）。' +
          `一次最多 ${OSS_DELETE_MULTI_LIMIT} 个；返回里会**逐个**说明哪些删掉了、哪些没删掉`,
      },
    ],
  },
  {
    id: 'base-upload-acl-set',
    title: '设置 OSS 对象的读权限',
    pagePath: BASE_UPLOAD_SOURCE,
    permission: BASE_UPLOAD_PERMISSION,
    write: true,
    credentials: OSS_CREDENTIALS,
    params: [
      {
        name: 'objectKey',
        kind: 'text',
        required: true,
        description: '桶内路径。一般只在 base-upload-file 传完字节、设 ACL 那一步失败时用来补',
      },
      {
        name: 'acl',
        kind: 'enum',
        required: true,
        description:
          '目标 ACL。Portal 上传后固定设 public-read（桶不是默认公共读，不设的话 url 打不开）',
        options: [
          { label: 'public-read（任何人可读，Portal 上传后的取值）', value: 'public-read' },
          { label: 'private（仅持有签名者可读）', value: 'private' },
          { label: 'public-read-write（任何人可读可写，通常不该用）', value: 'public-read-write' },
          { label: 'default（继承桶的 ACL）', value: 'default' },
        ],
      },
    ],
  },
]

export type BaseUploadCapability = ReturnType<typeof createBaseUploadCapability>
