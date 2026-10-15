# 把链接推到用户手机，并退役终端嗅探 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 能把一条链接推给用户账号并落到手机通知中心（点一下直接打开），同时删掉手机端从终端画面嗅探链接的整套机制。

**Architecture:** 投递链路全部复用现有账号通知：`NotificationService.create()` 本来就接受 `url`/`group`，缺口只在桌面写入入口 `desktopWriteSchema` 与 `SystemNotifierService` 的输入校验。嗅探退役是三端联动的删除：手机端三个实现文件加它专用的 `wrapFlags` 协议字段（该字段只有一个读者，就是嗅探）。

**Tech Stack:** NestJS + Prisma + zod（server）、Electron 主进程 + Vitest（desktop）、Swift 6 / swift-testing / XCTest（SynapseMobile）

**Spec:** `docs/superpowers/specs/2026-10-15-mobile-link-push-design.md`

## Global Constraints

- `url` 只允许 **https**，长度 **≤2048**；`group` 长度 **≤64**，且不得带首尾空白、控制字符、孤立代理项。
- **`url` 与 `group` 的长度按 UTF-16 码元计**，与服务端 zod 的 `.max()` 一致。桌面既有的 `validateField` 按码点数，两者对增补平面字符（emoji 等）会差一倍——所以新字段只走码元这一道：码元数是码点数的上界，一道就同时覆盖两者（再加一道码点检查会是一行永远走不到的代码）。
- 这三个限制必须在**三处**都处理到，但三处的**能力不同**，不要把它们说成一回事：
  - **执行**在桌面 `validateSystemNotificationInput` 与服务端 `desktopWriteSchema` 两处，两层都必须真的拒。
  - **MCP 工具 `inputSchema` 只能声明，不能约束**：JSON Schema 的 `maxLength` 数**码点**（不是码元），`pattern` 对多数客户端也只是提示，而且这个仓库里没有任何一步拿 `inputSchema` 去校验 invoke 参数——它只喂检索索引与 `tools/list`。所以这一层对增补平面字符客观上比服务端**宽**，这是做不到，不是没做；不要在注释或描述里声称它守住了。
  - 正因为模型从这一层学不到形状规则，`description` 必须把单行要求**写给模型看**：title / body / url / group 都是单行、无首尾空白，且增补平面字符按两个计。写在描述里它才可能不撞墙。
- `url` 与 `group` **都可选**。不传时输出里不出现该键（不要写 `undefined`）。
- **不新增** `source`；**不暴露** `level`；**不暴露** `sourceKey`。
- `desktopWriteSchema` 的 `.strict()` 与 `DESKTOP_NOTIFICATION_SOURCES` 白名单**必须保留**——那是授权边界。
- **不删 `LinkBrowser`**（`SynapseMobile/.../DesignSystem/LinkBrowser.swift`）：全 App 共用，也是新方案的落点。
- 无新表、无数据库迁移（`UserNotification.url` 与 `.group` 已存在）。
- 提交用中文说明，**必须带文件列表**；不得 `git add -A`，不得 push。
- 每个 Task 结束跑一次该 Task 范围内的测试；Phase 结束跑一次全量。

## Review Focus

| # | 输入 / 条件 | 合理预期 |
|---|---|---|
| 1 | AI 把带 `?password=` / `token=` 的分享地址当 `url` 传进来 | Skill 明确禁止（Task 5）。服务端明文留存与今天开放 API 同级，**锁屏不受影响**（APNs payload 不含 url）。这是**接受项，没有测试**——不假装有一条守得住它的断言。 |
| 2 | `url` 传 `http://` / `ftp://` / 根本不是 URL | 三处都拒。Task 1 覆盖服务端，Task 2 覆盖桌面（报 `not_https`）。**不能**只在服务端拒。 |
| 3 | `url` 超 2048、`group` 超 64；以及**用 emoji 之类增补平面字符把码元数顶过 64 而码点数没超** | 都报 `too_long`，且**没有半条进任何存储**。Task 1 覆盖 `group` 65 字；Task 2 覆盖 `group` 65 字与 33 个 emoji（33 码点 / 66 码元）。 |
| 4 | `group` 里带换行或控制字符 | 桌面侧报 `forbidden_character`（Task 2）。⚠️ 服务端 `notificationGroupSchema` 只有 trim + 长度，**不带控制字符检查**——这是开放 API 今天就有的状态，本次不扩大也不顺手补：`group` 的唯一写入方是桌面路径，而桌面已经拦下。若将来有第二个写入方，这里要一起补。 |
| 5 | 版本错配：新桌面 + 旧手机（或反之） | 不崩。Task 7 有回归位断言 `toLineWire` 不再产出第三项；手机端解码顺序保持「text → runs」，多余的第三项被自然忽略。 |

---

# Phase 1 — A：链接推送

## Task 1: 服务端 `desktopWriteSchema` 接受 url 与 group

**Files:**
- Modify: `server/src/open-api/open-api-contract.ts:31,34`（把两个 schema 导出）
- Modify: `server/src/notifications/notification.controller.ts:49-57`
- Test: `server/src/notifications/notification.controller.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces: `POST /api/notifications/desktop` 的请求体接受可选 `url`（https-only ≤2048）与 `group`（trim 后 1–64）

- [ ] **Step 1: 写失败测试**

在 `server/src/notifications/notification.controller.spec.ts` 的 `describe("NotificationController")` 里，紧跟在既有用例 `"writes desktop-owned sources to the caller's own queue"` 之后加入：

```ts
  it("carries an optional link and group without widening the desktop-owned sources", async () => {
    const service = { create: vi.fn(async () => ({ id: "message-1" })) }
    const endpoint = new NotificationController(service as never)
    const request = { user: { id: "user-1" } }

    await expect(endpoint.createFromDesktop(request as never, {
      source: "system-notifier",
      title: "周报已生成",
      body: "点开查看完整报告",
      group: "云盘分享",
      url: "https://synapse.d2.pub/share/shr_9Kx2M4Qr7Tv1Bw8Zc3Nd6Fh5Jp0Ls",
    })).resolves.toEqual({ id: "message-1" })
    expect(service.create).toHaveBeenCalledWith({
      source: "system-notifier",
      title: "周报已生成",
      body: "点开查看完整报告",
      group: "云盘分享",
      url: "https://synapse.d2.pub/share/shr_9Kx2M4Qr7Tv1Bw8Zc3Nd6Fh5Jp0Ls",
      userId: "user-1",
    })
  })

  it("refuses a link the desktop could not open on a phone", async () => {
    const service = { create: vi.fn(async () => ({ id: "message-1" })) }
    const endpoint = new NotificationController(service as never)
    const request = { user: { id: "user-1" } }

    for (const url of ["http://example.com/x", "ftp://example.com/x", "not a url"]) {
      await expect(endpoint.createFromDesktop(request as never, {
        source: "system-notifier", title: "标题", body: "正文", url,
      })).rejects.toMatchObject({ status: 400 })
    }
    await expect(endpoint.createFromDesktop(request as never, {
      source: "system-notifier", title: "标题", body: "正文", group: "云".repeat(65),
    })).rejects.toMatchObject({ status: 400 })
    expect(service.create).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd server && ./node_modules/.bin/vitest run src/notifications/notification.controller.spec.ts
```

Expected: 两条新用例 FAIL，报 `status: 400`（`.strict()` 把 `url`/`group` 当未知字段）。既有用例仍绿。

- [ ] **Step 3: 导出开放 API 的两个 schema**

`server/src/open-api/open-api-contract.ts` 里把这两行的 `const` 改成 `export const`：

```ts
export const notificationGroupSchema = z.string().trim().min(1).max(64)
/** 契约文档沿用 `pattern: "^https:"` 表达协议限制，`.regex()` 才能在 JSON Schema 里体现出来。 */
export const notificationUrlSchema = z.url().max(2048).regex(/^https:/u)
```

- [ ] **Step 4: 复用它们**

`server/src/notifications/notification.controller.ts`：

在既有的 `from "../open-api/open-api-contract"` import 块里加两个名字（按字母序插进 `OPEN_API_NOTIFICATIONS_BASE_PATH` 之后）：

```ts
  notificationGroupSchema,
  notificationUrlSchema,
```

把 `desktopWriteSchema` 改成：

```ts
const desktopWriteSchema = z.object({
  source: z.enum(DESKTOP_NOTIFICATION_SOURCES),
  sourceKey: z.string().min(8).max(160).optional(),
  title: z.string().trim().min(1).max(64),
  body: z.string().trim().min(1).max(512),
  // 链接与分组复用开放 API 的同一份 schema：同一条消息不该因为传参形状不同被区别对待。
  group: notificationGroupSchema.optional(),
  url: notificationUrlSchema.optional(),
  targetId: z.string().min(1).max(120).optional(),
  deviceId: z.string().min(1).max(120).optional(),
}).strict()
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd server && ./node_modules/.bin/vitest run src/notifications/notification.controller.spec.ts
```

Expected: 全绿，含既有的 `"refuses sources the desktop does not own"`。

- [ ] **Step 6: 提交**

```bash
cd /Users/liyang/Documents/code/github/Synapse && git add server/src/open-api/open-api-contract.ts server/src/notifications/notification.controller.ts server/src/notifications/notification.controller.spec.ts && git commit -m "feat: 桌面写入通知时接受可选链接与分组

放开 desktopWriteSchema 的 url 与 group，复用开放 API 已有的两份 schema，不另立
一份。授权边界不变：source 白名单与 .strict() 都保留，桌面仍只能写自己拥有的来源。"
```

---

## Task 2: 桌面校验器接受 url 与 group

**Files:**
- Modify: `desktop/app-capabilities/system-notifier/shared/schema.ts`
- Test: `desktop/app-capabilities/system-notifier/shared/__tests__/schema.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `SystemNotificationInput` 变成 `{ title: string; body: string; group?: string; url?: string }`；`SYSTEM_NOTIFICATION_GROUP_MAX_LENGTH = 64`、`SYSTEM_NOTIFICATION_URL_MAX_LENGTH = 2048`（按 UTF-16 码元）；新增拒绝原因 `"not_https"`

- [ ] **Step 1: 写失败测试**

在 `desktop/app-capabilities/system-notifier/shared/__tests__/schema.test.ts` 的 `describe` 内追加：

```ts
  it("carries an optional link and group, and omits them when absent", () => {
    expect(validateSystemNotificationInput({
      title: "周报已生成",
      body: "点开查看完整报告",
      group: "云盘分享",
      url: "https://synapse.d2.pub/share/shr_9Kx2M4Qr7Tv1Bw8Zc3Nd6Fh5Jp0Ls",
    })).toEqual({
      ok: true,
      data: {
        title: "周报已生成",
        body: "点开查看完整报告",
        group: "云盘分享",
        url: "https://synapse.d2.pub/share/shr_9Kx2M4Qr7Tv1Bw8Zc3Nd6Fh5Jp0Ls",
      },
    })

    // 没传就不出现该键。这里必须是 `toStrictEqual` 而不是 `toEqual`：vitest 的 `toEqual`
    // 忽略值为 `undefined` 的键，一个「永远写出 url/group、但值可能是 undefined」的实现
    // 拿它跑照样绿 —— 那这条断言就没守它声称要守的东西。
    expect(validateSystemNotificationInput({ title: "标题", body: "正文" })).toStrictEqual({
      ok: true,
      data: { title: "标题", body: "正文" },
    })
  })

  it.each([
    [{ title: "标题", body: "正文", url: "http://example.com/x" }, "url", "not_https"],
    [{ title: "标题", body: "正文", url: "ftp://example.com/x" }, "url", "not_https"],
    [{ title: "标题", body: "正文", url: "not a url" }, "url", "not_https"],
    [{ title: "标题", body: "正文", url: "" }, "url", "required"],
    [{ title: "标题", body: "正文", url: 42 }, "url", "type"],
    [{ title: "标题", body: "正文", url: " https://example.com/" }, "url", "leading_or_trailing_whitespace"],
    [{ title: "标题", body: "正文", url: `https://example.com/${"a".repeat(2048)}` }, "url", "too_long"],
    [{ title: "标题", body: "正文", group: "云盘\n分享" }, "group", "forbidden_character"],
    [{ title: "标题", body: "正文", group: " 云盘分享" }, "group", "leading_or_trailing_whitespace"],
    [{ title: "标题", body: "正文", group: "" }, "group", "required"],
    [{ title: "标题", body: "正文", group: "云".repeat(65) }, "group", "too_long"],
    // 33 个 emoji 是 33 个码点、66 个 UTF-16 码元：码点检查放过它，码元检查必须拦下。
    // 服务端 zod 的 `.max(64)` 数的是码元，桌面只数码点就会比服务端宽。
    [{ title: "标题", body: "正文", group: "😀".repeat(33) }, "group", "too_long"],
    [{ title: "标题", body: "正文", group: null }, "group", "type"],
    [{ title: "标题", body: "正文", level: "passive" }, "request", "unknown_field"],
    // body 排在 url 前面：两个都坏时先报 body。没有这一行，一个先校验 url 的实现
    // 能把上面所有行都跑绿。
    [{ title: "标题", body: " 正文", url: "http://x/" }, "body", "leading_or_trailing_whitespace"],
  ])("rejects an unusable link or group at %#", (input, field, reason) => {
    expect(invalid(input).data).toEqual({ field, reason })
  })

  it("accepts values exactly at the limit and rejects the next character", () => {
    // 界内必须放行：把 `>` 写成 `>=` 会让服务端接受的值在这里被拒，
    // 而上面那些用例全都在界限之外，没有一个会因此变红。
    expect(validateSystemNotificationInput({
      title: "标题",
      body: "正文",
      group: "云".repeat(64),
      url: `https://example.com/${"a".repeat(2028)}`,
    })).toMatchObject({ ok: true })
    expect(invalid({ title: "标题", body: "正文", group: "云".repeat(65) }).data)
      .toEqual({ field: "group", reason: "too_long" })
  })
```

并把既有的 `"uses request, title, body and field checks in the fixed first-error order"` 用例名改为 `"uses request, title, body, url, group and field checks in the fixed first-error order"`，在该用例末尾补上顺序断言：

```ts
    // url 排在 group 之前：先报链接再报标签，模型一次只会看到一条。
    expect(invalid({ title: "标题", body: "正文", url: "http://x/", group: "" }).data)
      .toEqual({ field: "url", reason: "not_https" })
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd desktop && ./node_modules/.bin/vitest run app-capabilities/system-notifier/shared/__tests__/schema.test.ts
```

Expected: 新用例 FAIL（`unknown_field`），既有 13 条 `it.each` 仍绿。

- [ ] **Step 3: 加常量、加拒绝原因**

`desktop/app-capabilities/system-notifier/shared/schema.ts`：

```ts
export const SYSTEM_NOTIFICATION_TITLE_MAX_CODE_POINTS = 64
export const SYSTEM_NOTIFICATION_BODY_MAX_CODE_POINTS = 256
// 名字说码元不说码点：这两个字段按 UTF-16 码元卡，与服务端 zod 的 `.max()` 同宽
// （上面 title/body 那两个常量按码点算，那是它们各自的既有语义，互不影响）。
export const SYSTEM_NOTIFICATION_GROUP_MAX_LENGTH = 64
export const SYSTEM_NOTIFICATION_URL_MAX_LENGTH = 2048
```

```ts
export const SYSTEM_NOTIFICATION_INVALID_FIELDS = ["request", "title", "body", "url", "group"] as const
export const SYSTEM_NOTIFICATION_INVALID_REASONS = [
  "required",
  "type",
  "leading_or_trailing_whitespace",
  "forbidden_character",
  "invalid_unicode",
  "too_long",
  // 链接只允许 https：一个 http 地址到了手机上打不开或降级，不如在门口拦下。
  "not_https",
  "unknown_field",
] as const
```

```ts
export interface SystemNotificationInput {
  readonly title: string
  readonly body: string
  readonly group?: string
  readonly url?: string
}
```

- [ ] **Step 4: 改校验函数**

把 `validateSystemNotificationInput` 里那段 key 检查换成集合判断，并在 body 之后依次校验 url、group：

```ts
const ACCEPTED_KEYS = new Set<string>(["title", "body", "url", "group"])

export function validateSystemNotificationInput(request: unknown): SystemNotificationInputValidation {
  if (!isPlainObject(request)) return invalid("request", "type")

  const keys = Object.keys(request)
  if (keys.some((key) => !ACCEPTED_KEYS.has(key))) return invalid("request", "unknown_field")

  const titleError = validateField(request, "title", SYSTEM_NOTIFICATION_TITLE_MAX_CODE_POINTS)
  if (titleError) return titleError
  const bodyError = validateField(request, "body", SYSTEM_NOTIFICATION_BODY_MAX_CODE_POINTS)
  if (bodyError) return bodyError
  // url 先于 group：链接是这条消息的目的，标签只是装饰，先报前者。
  const urlError = validateOptionalField(request, "url", SYSTEM_NOTIFICATION_URL_MAX_LENGTH)
  if (urlError) return urlError
  if (request.url !== undefined && !isHttpsUrl(request.url as string)) return invalid("url", "not_https")
  const groupError = validateOptionalField(request, "group", SYSTEM_NOTIFICATION_GROUP_MAX_LENGTH)
  if (groupError) return groupError

  return {
    ok: true,
    data: {
      title: request.title as string,
      body: request.body as string,
      ...(request.url !== undefined ? { url: request.url as string } : {}),
      ...(request.group !== undefined ? { group: request.group as string } : {}),
    },
  }
}
```

先把「什么算单行文本」那一段从 `validateField` 里提出来，做成两个校验器共用的一个函数。提出来是必需的，不是顺手重构：`validateField`（title/body）与新的 `validateOptionalField`（url/group）必须对「单行文本」给出同一个答案，两份各写一遍，往其中一份加一个禁用字符，另一份就会静默地更松 —— 而这两个字段将来会各自被不同的上游喂。

`validateField` 因此会改动，但**行为一字不变**：它原有的 13 行 `it.each` 与「接受精确单行 Unicode」用例钉着这一点，改完必须全绿。唯一被放宽的是本计划先前的「`validateField` 一字未动」——那条是为了保住行为，不是禁止一次保行为的提取。

加这三个私有函数：

```ts
/**
 * 单行文本的共同形状：非空、无首尾空白、无孤立代理项、无控制字符。
 *
 * 提出来是因为 `validateField`（title/body）与 `validateOptionalField`（url/group）
 * 必须对「什么算单行文本」给出同一个答案 —— 两份各写一遍，往其中一份加一个禁用字符，
 * 另一份就会静默地更松。
 */
function validateSingleLineShape(
  value: string,
  field: SystemNotificationInvalidField,
): SystemNotificationInvalidInput | null {
  if (value === "") return invalid(field, "required")
  if (value !== value.trim()) return invalid(field, "leading_or_trailing_whitespace")
  if (hasUnpairedSurrogate(value)) return invalid(field, "invalid_unicode")
  if (/[\p{Cc}\u2028\u2029]/u.test(value)) return invalid(field, "forbidden_character")
  return null
}

/**
 * 可选字段的校验。与 `validateField` 的差别全在两头：字段缺省是合法的，
 * 长度按码元而不是码点算。
 */
function validateOptionalField(
  request: Record<string, unknown>,
  field: "url" | "group",
  maxLength: number,
): SystemNotificationInvalidInput | null {
  if (!(field in request) || request[field] === undefined) return null
  const value = request[field]
  if (typeof value !== "string") return invalid(field, "type")
  const shapeError = validateSingleLineShape(value, field)
  if (shapeError) return shapeError
  // 服务端 zod 的 `.max()` 数的是 UTF-16 码元，不是码点，所以这里也按码元卡：
  // 33 个 emoji 是 33 码点、66 码元，只数码点就会放行，然后在服务端被打回来，
  // 而调用方早已被告知成功。码元数天然是码点数的上界，这一条同时覆盖两者，
  // 不需要再来一遍码点检查（那会是一行永远走不到的代码）。
  if (value.length > maxLength) return invalid(field, "too_long")
  return null
}

/**
 * 比服务端那一条更窄一点：服务端是 `z.url()` 加 `/^https:/`，这里要求字面量
 * `https://` 前缀。窄的一侧在客户端，两边就不会出现「桌面放行、服务端 400」
 * 这种只在联调时才发现的错位。
 */
function isHttpsUrl(value: string): boolean {
  if (!value.startsWith("https://")) return false
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd desktop && ./node_modules/.bin/vitest run app-capabilities/system-notifier/shared/__tests__/schema.test.ts
```

Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
cd /Users/liyang/Documents/code/github/Synapse && git add desktop/app-capabilities/system-notifier/shared/schema.ts desktop/app-capabilities/system-notifier/shared/__tests__/schema.test.ts && git commit -m "feat: 系统通知输入接受可选链接与分组

校验沿用既有那套 code-point 与字符检查，新增 not_https 一个拒绝原因。链接判断比
服务端窄一档（要求字面 https:// 前缀），错位只会发生在「桌面拒、服务端也拒」这一
侧，不会出现桌面放行而服务端 400。"
```

---

## Task 3: 把 url 与 group 透传到账号写入

**Files:**
- Modify: `desktop/electron/services/account-service.ts:540-552`（只扩类型）
- Modify: `desktop/app-capabilities/system-notifier/main/service.ts`（新增一个纯映射函数）
- Modify: `desktop/electron/bootstrap/descriptors.ts:865-869`（接线改调那个函数）
- Test: `desktop/electron/services/__tests__/account-service.test.ts`
- Test: `desktop/app-capabilities/system-notifier/main/__tests__/service.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `SystemNotificationInput`
- Produces: `systemNotificationAccountWrite(input: SystemNotificationInput): { source: "system-notifier"; title: string; body: string; group?: string; url?: string }`（从 `system-notifier/main/service.ts` 导出），以及 `AccountService.createInternalNotification` 的入参类型接受可选 `group`、`url`

> `SystemNotifierService` **不需要改**：`trigger` 收下整个 `input` 后原样交给 `sendToAccount` → `sync(input)`，字段自动流过。

- [ ] **Step 1: 写失败测试**

在 `desktop/electron/services/__tests__/account-service.test.ts` 里，紧跟既有用例 `"reports sent after the account accepts a desktop notification"` 之后加入：

```ts
  it("carries a link and a group into the desktop write body", async () => {
    const fetch = vi.fn(async (url: unknown) => {
      if (String(url).endsWith("/auth/refresh")) {
        return jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" })
      }
      if (String(url).endsWith("/auth/me")) {
        return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" } })
      }
      if (String(url).includes("/notifications/")) return jsonResponse({ id: "message-1" })
      throw new Error(`unexpected url ${String(url)}`)
    })
    const { namespace, service } = await createTestAccountService({ fetch: fetch as unknown as typeof fetch })
    await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })
    await service.refreshFromStorage()

    await expect(service.createInternalNotification({
      source: "system-notifier",
      title: "周报已生成",
      body: "点开查看完整报告",
      group: "云盘分享",
      url: "https://synapse.d2.pub/share/shr_9Kx2M4Qr7Tv1Bw8Zc3Nd6Fh5Jp0Ls",
    })).resolves.toBe("sent")

    const write = fetch.mock.calls.find(([url]) => String(url).endsWith("/notifications/desktop"))
    expect(write).toBeDefined()
    expect(JSON.parse(String((write?.[1] as RequestInit).body))).toMatchObject({
      source: "system-notifier",
      group: "云盘分享",
      url: "https://synapse.d2.pub/share/shr_9Kx2M4Qr7Tv1Bw8Zc3Nd6Fh5Jp0Ls",
    })
  })

  it("leaves the optional fields out of the body when the caller did not ask for them", async () => {
    const fetch = vi.fn(async (url: unknown) => {
      if (String(url).endsWith("/auth/refresh")) {
        return jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" })
      }
      if (String(url).endsWith("/auth/me")) {
        return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" } })
      }
      if (String(url).includes("/notifications/")) return jsonResponse({ id: "message-1" })
      throw new Error(`unexpected url ${String(url)}`)
    })
    const { namespace, service } = await createTestAccountService({ fetch: fetch as unknown as typeof fetch })
    await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })
    await service.refreshFromStorage()

    await service.createInternalNotification({ source: "system-notifier", title: "标题", body: "正文" })

    const write = fetch.mock.calls.find(([url]) => String(url).endsWith("/notifications/desktop"))
    const body = JSON.parse(String((write?.[1] as RequestInit).body))
    expect(body).not.toHaveProperty("url")
    expect(body).not.toHaveProperty("group")
  })
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd desktop && ./node_modules/.bin/vitest run electron/services/__tests__/account-service.test.ts
```

Expected: **这里没有运行时 RED，这是实测结论，不要伪造成有。** `createInternalNotification` 把 `input` 整个交给 `requestAuthenticatedJson`，`JSON.stringify` 照样写出 `group`/`url` —— 运行时本来就在转发，被挡住的只是**类型**。所以：

- 第一条新用例在改之前就是绿的，它守的是「将来有人把那个方法改成逐字段挑」这个方向，不是现在的行为。
- 第二条同理是回归位。注意它真正守的是**默认值**（`?? ""`、`?? null` 这类会活过 `JSON.stringify` 的东西），不是 `undefined` —— `JSON.stringify` 本来就会丢掉 `undefined`。
- 真正的 RED 在类型层：`descriptors.ts` 传那两个字段时会得到 `TS2353: 'group' does not exist in type …`。把这条原始诊断记进报告的 RED 证据里。
- 唯一的运行时 RED 在下面 Step 4 新增的那个映射函数上。

- [ ] **Step 3: 扩入参类型**

`desktop/electron/services/account-service.ts` 的 `createInternalNotification`：

```ts
  async createInternalNotification(input: {
    source: DesktopNotificationSource
    sourceKey?: string
    title: string
    body: string
    group?: string
    url?: string
    targetId?: string
    deviceId?: string
  }): Promise<DesktopNotificationOutcome> {
```

方法体不动——它把 `input` 整个交给 `requestAuthenticatedJson`。

- [ ] **Step 4: 把映射提成纯函数**

这是本任务唯一有运行时行为的改动，也是整条链路上唯一**逐字段挑**的地方：`trigger` 与 `sendToAccount` 都原样转发整个 input，只有接线这里可能把新字段挑漏。挑漏一个，那个字段就永远到不了手机，而且没有任何运行时症状可追 —— 所以它不能留在一行没人测的接线里。

先在 `desktop/app-capabilities/system-notifier/main/__tests__/service.test.ts` 里写失败测试（把 `systemNotificationAccountWrite` 加进该文件顶部从 `../service` 的 import 里）：

```ts
  it("carries the link and the group into the account write, and omits them when absent", () => {
    // `toStrictEqual` 而不是 `toEqual`：后者忽略值为 undefined 的键，所以一个
    // 「永远写出 url/group」的实现照样绿。
    expect(systemNotificationAccountWrite({ title: "标题", body: "正文" })).toStrictEqual({
      source: "system-notifier",
      title: "标题",
      body: "正文",
    })
    expect(systemNotificationAccountWrite({
      title: "周报已生成",
      body: "点开查看完整报告",
      group: "云盘分享",
      url: "https://synapse.d2.pub/share/shr_9Kx2M4Qr7Tv1Bw8Zc3Nd6Fh5Jp0Ls",
    })).toStrictEqual({
      source: "system-notifier",
      title: "周报已生成",
      body: "点开查看完整报告",
      group: "云盘分享",
      url: "https://synapse.d2.pub/share/shr_9Kx2M4Qr7Tv1Bw8Zc3Nd6Fh5Jp0Ls",
    })
  })
```

跑它，确认 FAIL（函数还不存在）。然后在 `desktop/app-capabilities/system-notifier/main/service.ts` 里加上它：

```ts
/**
 * `sync` 端口的入参形状：把一条系统通知映射成一次账号写入。
 *
 * 单独提出来是因为这里是这条链路上唯一逐字段挑的地方 —— `trigger` 与 `sendToAccount`
 * 都原样转发整个 input，只有它可能把新字段挑漏。挑漏一个，那个字段就永远到不了手机，
 * 而且没有任何运行时症状可以追。提成纯函数，才有地方钉住它。
 */
export function systemNotificationAccountWrite(input: SystemNotificationInput): {
  readonly source: "system-notifier"
  readonly title: string
  readonly body: string
  readonly group?: string
  readonly url?: string
} {
  return {
    source: "system-notifier",
    title: input.title,
    body: input.body,
    ...(input.url !== undefined ? { url: input.url } : {}),
    ...(input.group !== undefined ? { group: input.group } : {}),
  }
}
```

- [ ] **Step 5: 接线**

`desktop/electron/bootstrap/descriptors.ts` 的 `sync:` 端口（约 :865）改成调用它。该文件已经从同一个模块 import 了 `SystemNotifierService`，把那行 import 扩成同时引入 `systemNotificationAccountWrite`，不要新起一行：

```ts
      sync: (input) => accountService.createInternalNotification(systemNotificationAccountWrite(input)),
```

- [ ] **Step 6: 跑测试确认通过，并做两次变异验证**

```bash
cd desktop && ./node_modules/.bin/vitest run electron/services/__tests__/account-service.test.ts app-capabilities/system-notifier/main/__tests__/service.test.ts
```

Expected: 全绿。`service.test.ts` 里既有的 `SystemNotifierService` 用例是回归位——它不该因为这次改动而变。

两次变异验证，证明新用例真的在守那条映射：

1. 从 `systemNotificationAccountWrite` 里删掉 `url` 与 `group` 两个展开 → 新用例必须变红。
2. 只删掉其中一个（留另一个）→ 新用例仍必须变红。一个只转发一个字段的映射不能蒙混过关。

两次都 revert，逐字节核对。

- [ ] **Step 7: 提交**

```bash
cd /Users/liyang/Documents/code/github/Synapse && git add \
  desktop/electron/services/account-service.ts \
  desktop/app-capabilities/system-notifier/main/service.ts \
  desktop/electron/bootstrap/descriptors.ts \
  desktop/electron/services/__tests__/account-service.test.ts \
  desktop/app-capabilities/system-notifier/main/__tests__/service.test.ts && git commit -m "feat: 账号通知写入带上链接与分组

createInternalNotification 的入参扩两个可选字段，接线处按既有写法做条件展开，
不传就不出现在请求体里 —— 服务端 schema 是 .strict()，写 undefined 只会多一种
只在联调时才发现的漂移。SystemNotifierService 不需要改，它原样转发整个输入。"
```

---

## Task 4: MCP 工具接受 url 与 group

**Files:**
- Modify: `desktop/synapse-capabilities/shared/app-domain.ts`（`SYSTEM_NOTIFIER_TRIGGER_MCP_TOOL_NAME` 那一条）
- Test: `desktop/tests/unit/synapse-tool-router-search.test.ts`、`desktop/tests/unit/api-mcp-capability-surface.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `SYSTEM_NOTIFICATION_GROUP_MAX_LENGTH`、`SYSTEM_NOTIFICATION_URL_MAX_LENGTH`（按 UTF-16 码元；`..._TITLE_MAX_CODE_POINTS` 与 `..._BODY_MAX_CODE_POINTS` 保持原名与码点语义）
- Produces: `app_system_notifier_notification_trigger` 的 `inputSchema` 多两个可选属性，`required` 仍是 `["title", "body"]`

- [ ] **Step 1: 写失败测试（schema 形状 + 检索语料）**

`desktop/tests/unit/synapse-tool-router-search.test.ts` 的 `INTENT_CORPUS` 里加一条：

```ts
  ["把链接发我手机上", "app_system_notifier_notification_trigger"],
```

`desktop/tests/unit/api-mcp-capability-surface.test.ts` 里，在既有的工具 schema 断言旁加：

```ts
  it("lets the notifier carry a link without making it mandatory", () => {
    const tool = buildAllMcpTools().find((entry) => entry.name === "app_system_notifier_notification_trigger")
    expect(tool).toBeDefined()
    expect(tool?.inputSchema.required).toEqual(["title", "body"])
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(["title", "body", "url", "group"])
    // 这一层只能「声明」，不能「约束」：JSON Schema 的 maxLength 数码点，pattern 对多数
    // 客户端也只是提示，而且本仓库没有任何一步拿 inputSchema 去校验 invoke 参数。
    // 真正的闸门是桌面校验器与服务端 schema —— 所以这里断言的是「声明到位」，不是「守住了」。
    expect(tool?.inputSchema.properties?.url).toMatchObject({ pattern: "^https://", maxLength: 2048 })
    expect(tool?.inputSchema.properties?.group).toMatchObject({ maxLength: 64 })
  })
```

（若该文件里没有 `buildAllMcpTools` 的 import，按文件顶部既有 import 的写法补上。）

- [ ] **Step 2: 跑测试确认失败**

```bash
cd desktop && ./node_modules/.bin/vitest run tests/unit/api-mcp-capability-surface.test.ts
```

Expected: 新用例 FAIL（`properties` 里只有 `title`/`body`）；**既有计数断言（`285`、`289`、`93`、`89`）必须仍绿**——本次不新增也不删除工具。

```bash
cd desktop && ./node_modules/.bin/vitest run tests/unit/synapse-tool-router-search.test.ts
```

Expected: 新语料条 FAIL 或 PASS 都记录下来。`手机` 已经在 `synapse-tool-router-lexicon.ts` 里映射到 `notification`，这一条大概率直接通过。

- [ ] **Step 3: 改工具定义**

`desktop/synapse-capabilities/shared/app-domain.ts`，import 块补两个常量：

```ts
  SYSTEM_NOTIFICATION_GROUP_MAX_LENGTH,
  SYSTEM_NOTIFICATION_URL_MAX_LENGTH,
```

工具条目改成：

```ts
    {
      name: SYSTEM_NOTIFIER_TRIGGER_MCP_TOOL_NAME,
      description: "Notify the user. This computer shows a native notification, and when the desktop app is signed in and online the same message also reaches the account message center and the user's registered phones without any API key. Use it when the user asks to be notified or reminded now or at a later point, when something finishes, or on their phone or another device; these asks count even when the user never names this tool, and an active standing notification instruction covers them too. Use it also when the user wants a link handed to their phone: pass it as url, and the notification opens that address in one tap. Use it only for a request of that kind, not to volunteer progress updates. Chinese intent: 提醒我, 到点提醒我, 干完通知我, 给我手机发消息, 推到我手机上, 把链接发我手机上. title, body, url and group must all be single-line text with no leading or trailing whitespace. url must be an https address with no credentials or password in it; group is a short label shown beside the title. A successful result means Synapse accepted the fire-and-forget request; it does not mean the notification was delivered or displayed.",
      inputSchema: {
        type: "object",
        properties: {
          title: stringField("Single-line notification title with no leading or trailing whitespace.", {
            maxLength: SYSTEM_NOTIFICATION_TITLE_MAX_CODE_POINTS,
          }),
          body: stringField("Single-line notification body with no leading or trailing whitespace.", {
            maxLength: SYSTEM_NOTIFICATION_BODY_MAX_CODE_POINTS,
          }),
          url: stringField("Optional single https address the user should open, with no leading or trailing whitespace. An emoji or other astral character counts as two against the length limit. It must carry no credentials or password; the address itself never reaches a lock screen.", {
            maxLength: SYSTEM_NOTIFICATION_URL_MAX_LENGTH,
            pattern: "^https://",
          }),
          group: stringField("Optional short label shown beside the title, such as the source of the link, with no leading or trailing whitespace. An emoji or other astral character counts as two against the length limit.", {
            maxLength: SYSTEM_NOTIFICATION_GROUP_MAX_LENGTH,
          }),
        },
        required: ["title", "body"],
        additionalProperties: false,
      },
    },
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd desktop && ./node_modules/.bin/vitest run tests/unit/api-mcp-capability-surface.test.ts tests/unit/synapse-tool-router-search.test.ts
```

Expected: 全绿。

若语料那条**仍然失败**：在 `desktop/electron/services/agent-runtime/synapse-tool-router-lexicon.ts` 的 notification 段补一条，`term` 取查询里最不含歧义的两字以上中文词、`token` 必须是 `app_system_notifier_notification_trigger` 里真实出现的英文段（`notifier` 或 `notification`），然后在提交信息里写清加了哪一条、为什么。**不要**为了让一条语料通过而改动 `search`/`invoke` 的定义或权重。

- [ ] **Step 5: 提交**

```bash
cd /Users/liyang/Documents/code/github/Synapse && git add desktop/synapse-capabilities/shared/app-domain.ts desktop/tests/unit/synapse-tool-router-search.test.ts desktop/tests/unit/api-mcp-capability-surface.test.ts && git commit -m "feat: 通知工具接受可选链接，用户要链接到手机时有地方可交

description 里补上「用户要一条链接到手机」这个场景与对应中文说法，schema 加 url
与 group 两个可选属性。工具数量不变，能力注册表的计数不动。"
```

---

## Task 5: Skill 指南、能力注册表与发布说明

**Files:**
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/app/index.md`
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/app/api-reference.md`
- Modify: `docs/agents/capability-registry.md`
- Modify: `RELEASE_NOTES_PENDING.md`

**Interfaces:**
- Consumes: Task 4 的 MCP 工具契约
- Produces: 无（文档）

- [ ] **Step 1: 补 Skill 的场景说明**

`desktop/app-capabilities/synapse-skill/skill-package/app/index.md` 的 System Notifier 一节（`## System Notifier`，约 :161-184）：

在 `Use it when the user explicitly asks to be notified at some point, or when an existing standing instruction covers the event.` 那一段之后插入：

```markdown
The same call hands a link to the user's phone. When the user wants an address they can open
away from the computer — a share link, a page you published, a release or pull request — pass it
as `url` and the notification opens it in one tap. Put a short label in `group` when the source
is worth naming, such as 云盘分享. Never pass an address that carries a password, a token, or any
other credential anywhere in it — in the user name, the host, the path, or the query string. The
record is stored in plain text on the server, and no other layer checks this for you.
```

把既有的字段规则那一条改成同时覆盖新字段：

```markdown
- Pass exactly one non-empty, single-line `title` and `body` with no leading or trailing whitespace. The title limit is 64 Unicode code points and the body limit is 256. `url` is optional, must be `https`, and is capped at 2048; `group` is optional and capped at 64. `url` and `group` are single-line too — no leading or trailing whitespace, no line breaks — and an emoji or other astral character counts as two against their limits.
- `url` must carry no password, token, or other credential anywhere in it — including a user name before the `@`, or a parameter in the query string. `https://user:pass@host/` is accepted by the tool schema and by the desktop validator alike, so nothing else will stop you. The record is stored in plain text on the server.
```

把既有的禁令那条按 spec 收窄——它现在字面上会把新字段一起挡掉：

```markdown
- Do not add any field beyond `title`, `body`, `url`, and `group`. Do not add caller identity, a notification id, an idempotency key, or a retry loop.
```

- [ ] **Step 2: 补 api-reference 参数表**

`desktop/app-capabilities/synapse-skill/skill-package/app/api-reference.md` 的 `## \`app_system_notifier_notification_trigger\`` 一节（约 :253）：把参数表里 `title` / `body` 两行之后补上 `url` 与 `group` 两行。

**这两行用英文写** —— 那份文件整份是英文，塞中文会与全文语体断裂；而且「必填否」这件事既有行的格式本身就在渲染，不必再用「可选」二字说一遍。照抄相邻行的句式（`- \`X\` optional: …`），每行都要带全它该管的事：`url` 要写清单个 https 地址、长度上限、无首尾空白、增补平面字符按两个计、以及**地址里任何位置都不得携带凭据**（含 `@` 前的用户名）；`group` 要写短标签、长度上限、无首尾空白、增补平面字符按两个计。

同一节里被新字段证伪的说明要同批改准，否则新加的两行会与它们直接矛盾：单行规则的作用面从 `Both fields` 改成四个字段，`INVALID_INPUT` 的 `data.field` / `data.reason` 枚举补上 `url`、`group`、`not_https`（枚举需与 `schema.ts` 的取值集合**及顺序**一致）。

- [ ] **Step 2b: 三处措辞收尾**

1. `app/index.md` 里「Keep Token values, passwords, … out of **both fields**」这句：契约现在是四个字段，「both」已无所指，而且与新规则并读会产生一种误读——工具里 `url` 的说明写了「地址本身不会上锁屏」，模型可能据此推断 `url` 里的凭据可以接受。改成写清是哪两个字段：「out of `title` and `body` — the fields that reach a lock screen」，让上面那条凭据规则明确压过它。
2. `app/index.md` 那句中文口语列表（`提醒我 / 到点提醒我 / 完事提醒我一声 / 给我手机发消息 / 推到我手机上 / 构建完叫我一声 / 出错了告诉我`）末尾追加 `把链接发我手机上`。发布说明正是让用户这么说的，而工具描述里已经有这句 —— 判断层缺了它，两层的词表就不对称。**只能追加在末尾**：`api-mcp-capability-surface.test.ts` 把这份列表当作一整段连续子串断言。
3. `docs/agents/capability-registry.md` 里新加的那段例外说明若没有 `- ` 列表标记，在 markdown 里会终止上面的列表、渲染成夹在两条 bullet 之间的一段正文；补上标记。

- [ ] **Step 3: 改能力注册表的例外说明**

`docs/agents/capability-registry.md` 里 System Notifier 的例外段：说明这个工具除通知外还能携带一条 https 链接与一个分组标签，**MCP 工具数不变（仍 1）**，三张表的数字都不动。

- [ ] **Step 4: 写发布说明**

`RELEASE_NOTES_PENDING.md` 顶部追加一条，面向用户说明「得到什么、什么变了」，不写代码路径：

```markdown
- 现在可以让 AI 把一条链接直接发到你的手机：对 AI 说「把链接发我手机上」，手机上会收到一条通知，点一下直接打开。链接以文本发送，不经过终端画面，所以长地址不会被截断。
```

- [ ] **Step 5: 跑文档门禁**

```bash
cd desktop && ./node_modules/.bin/vitest run tests/unit/api-mcp-capability-surface.test.ts
```

Expected: 全绿。该文件要求 31 个 `index.md`/`api-reference.md` 都含 `"Reaching Synapse tools"` 与 `"publishes only two tools"`——本次只改内容不新增领域目录，这两个断言与 `148`、`247` 都不动。

- [ ] **Step 6: 提交**

```bash
cd /Users/liyang/Documents/code/github/Synapse && git add desktop/app-capabilities/synapse-skill/skill-package/app/index.md desktop/app-capabilities/synapse-skill/skill-package/app/api-reference.md docs/agents/capability-registry.md RELEASE_NOTES_PENDING.md && git commit -m "docs: 补齐链接推送的 Skill 指南、能力说明与发布说明

Skill 里补上「用户要一条链接到手机」这个场景与禁止携带凭据的约束；把原来那条
「不要加平台特有字段」按实际要挡的东西收窄，否则字面上会把新加的 url 与 group
一起挡掉。能力注册表只需改例外说明，工具数量不变。"
```

- [ ] **Step 7: Phase 1 全量验证**

```bash
cd server && ./node_modules/.bin/vitest run src/notifications
cd /Users/liyang/Documents/code/github/Synapse/desktop && ./node_modules/.bin/vitest run app-capabilities/system-notifier electron/services/__tests__/account-service.test.ts tests/unit
cd /Users/liyang/Documents/code/github/Synapse && pnpm --filter @synapse/desktop run typecheck
```

Expected: 全绿。

---

# Phase 2 — B：终端嗅探退役

## 手机端测试怎么跑（Task 6、Task 7 共用）

```bash
cd /Users/liyang/Documents/code/github/Synapse

# 1. 选一台可用的 iPhone 模拟器，记下它的 UDID
xcrun simctl list devices available | grep -i iphone

# 2. 构建测试包（只需一次，改了源码要重跑）
xcodebuild build-for-testing -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath SynapseMobile/build/sniffing-removal CODE_SIGNING_ALLOWED=NO

# 3. 跑指定用例
xcodebuild test-without-building -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination "platform=iOS Simulator,id=$SIMULATOR_UDID" \
  -derivedDataPath SynapseMobile/build/sniffing-removal \
  -only-testing:SynapseMobileTests/TerminalFrameDecodingTests
```

⚠️ 本仓库里 swift-testing 套件（`struct` + `@Test`）的 `-only-testing` 选择器**不要带括号**。Task 6 实测：`-only-testing:SynapseMobileTests/TerminalFrameDecodingTests()` 跑 **0 个用例**并且退出码为 0、连 swift-testing 的输出都没有 —— 正是「静默全绿」那个坑，只是由**加上括号**触发；写成不带括号反而是好的（输出 `✔ Test run with 2 tests in 1 suite passed`）。

**判据永远是用例数，不是退出码**：任何一次 iOS 测试运行，若看不到真实用例数，就当它没跑，改选择器重跑。

## Task 6: 手机端摘掉资源采集与面板

**Files:**
- Delete: `SynapseMobile/SynapseMobile/Features/Terminal/TerminalResources.swift`
- Delete: `SynapseMobile/SynapseMobile/Features/Terminal/TerminalResourcesSheet.swift`
- Delete: `SynapseMobile/SynapseMobile/Features/Terminal/TerminalResourceReachability.swift`
- Delete: `SynapseMobile/SynapseMobileTests/TerminalResourcesTests.swift`
- Delete: `SynapseMobile/SynapseMobileTests/TerminalResourceReachabilityTests.swift`
- Modify: `SynapseMobile/SynapseMobile/Features/Terminal/TerminalStore.swift`
- Modify: `SynapseMobile/SynapseMobile/Features/Terminal/TerminalScreen.swift`
- Modify: `SynapseMobile/SynapseMobileUITests/WorkspaceFilesUITests.swift:648-661`

**Interfaces:**
- Consumes: 无
- Produces: `TerminalStore` 不再有 `resources` / `resourceCollector`；`TerminalScreen` 不再有 `resourcesPresented` / `pendingResourceURL` / `openedResource`

- [ ] **Step 1: 先跑一遍要保留的手机端终端用例，留一份基线**

```bash
cd /Users/liyang/Documents/code/github/Synapse
xcodebuild build-for-testing -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath SynapseMobile/build/sniffing-removal CODE_SIGNING_ALLOWED=NO
xcodebuild test-without-building -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination "platform=iOS Simulator,id=$SIMULATOR_UDID" \
  -derivedDataPath SynapseMobile/build/sniffing-removal \
  -only-testing:SynapseMobileTests/TerminalFrameDecodingTests
```

Expected: PASS。记下结果当作改动前的对照。

- [ ] **Step 2: 删五个文件**

```bash
cd /Users/liyang/Documents/code/github/Synapse
git rm SynapseMobile/SynapseMobile/Features/Terminal/TerminalResources.swift \
       SynapseMobile/SynapseMobile/Features/Terminal/TerminalResourcesSheet.swift \
       SynapseMobile/SynapseMobile/Features/Terminal/TerminalResourceReachability.swift \
       SynapseMobile/SynapseMobileTests/TerminalResourcesTests.swift \
       SynapseMobile/SynapseMobileTests/TerminalResourceReachabilityTests.swift
```

- [ ] **Step 3: 清 `TerminalStore`**

`SynapseMobile/SynapseMobile/Features/Terminal/TerminalStore.swift`：删掉 `:34` 的 `resources`、`:35` 的 `resourceCollector`、`:126-127` 的两行、`:173` 与 `:226` 两处 `collectResources(in: frame)` 调用，以及 `:234-240` 整个 `collectResources(in:)` 方法。

- [ ] **Step 4: 清 `TerminalScreen`**

`SynapseMobile/SynapseMobile/Features/Terminal/TerminalScreen.swift`：删掉 `:57` `resourcesPresented`、`:58` `pendingResourceURL`、`:59` `openedResource`；`:330` 条件表达式里的 `|| resourcesPresented`；`:837-851` 整个 `.inspector(isPresented: $resourcesPresented) { … }` 连同其后的 `.linkBrowser($openedResource)`；`:965` 的 `if !toolbarStandDown && !store.resources.isEmpty { resourceBar }`；`:1353-1372` 整个 `resourceBar` 计算属性。

⚠️ 只拆这条调用链。`DesignSystem/LinkBrowser.swift` 里的 `WebLink`、`LinkBrowser`、`.linkBrowser(_:)` 全部保留——云盘、站内信、通知都在用。

- [ ] **Step 5: 改那条依赖资源面板的 UI 用例——只摘一句，别删用例**

`SynapseMobile/SynapseMobileUITests/WorkspaceFilesUITests.swift:648` 的 `testWideTerminalKeepsItsOwnTitleAndStatusBeforeAnyResourcePresentation` **名字像是只为资源面板而存在，实际不是**：它同时锁着「系统导航栏保留会话标题与状态」（宽屏下的真回归位）和后面的附件弹层流程。整个用例必须保留。

只做三件事：

1. 删掉 `XCTAssertFalse(app.navigationBars.staticTexts["会话资源"].exists)` 这一行。
2. 把标题那条断言的失败文案从 `"A hidden resource inspector must not replace the selected terminal's navigation title"` 改成 `"The system navigation bar must retain the selected terminal's navigation title"`（去掉已不存在的对象的引用）。
3. 用例名去掉 `BeforeAnyResourcePresentation` 尾巴，改成 `testWideTerminalKeepsItsOwnTitleAndStatusInSplitView`，并把 `capture(app, name:)` 的截图名一并改掉。

其余一行不动。

- [ ] **Step 6: 构建并跑留下的终端用例**

```bash
cd /Users/liyang/Documents/code/github/Synapse
xcodebuild build-for-testing -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath SynapseMobile/build/sniffing-removal CODE_SIGNING_ALLOWED=NO
xcodebuild test-without-building -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination "platform=iOS Simulator,id=$SIMULATOR_UDID" \
  -derivedDataPath SynapseMobile/build/sniffing-removal \
  -only-testing:SynapseMobileTests/TerminalFrameDecodingTests
```

Expected: PASS，与 Step 1 一致。若 SourceKit 在编辑器里报 `Cannot find type … in scope`，那是单文件分析的噪声，只信 `xcodebuild` 的结果。

- [ ] **Step 7: 提交**

```bash
cd /Users/liyang/Documents/code/github/Synapse && git add \
  SynapseMobile/SynapseMobile/Features/Terminal/TerminalStore.swift \
  SynapseMobile/SynapseMobile/Features/Terminal/TerminalScreen.swift \
  SynapseMobile/SynapseMobileUITests/WorkspaceFilesUITests.swift && git commit -m "refactor: 手机端不再从终端画面嗅探链接

删掉采集器、资源面板与有效性校验三个实现文件和它们的两个测试文件，以及终端页上
那条资源栏。跨物理行拼 URL 的那套形状推断的不确定性来自渲染层，改不掉，所以连
带它一起退役。

LinkBrowser 保留：它是全 App 共用的打开器，也是新的链接推送的落点。"
```

> 用显式文件列表，不用 `git add -A <目录>`：这是一个与其它会话共享的工作区，目录范围会把别人正在改的文件一起卷进来。提交前仍要 `git status` 核对暂存区。
>
> 列表里**只有被编辑的三个文件**，没有那五个被删的：Step 2 的 `git rm` 已经把删除动作放进暂存区了，再对已删路径跑 `git add` 会直接 `fatal: pathspec … did not match any files` 并**中止整条命令**（用 `&&` 连接时后面三个编辑就永远staged 不上，而失败的是一条「看起来只是多写了几个路径」的命令）。

---

## Task 7: 三端删掉 `wrapFlags`

**Files:**
- Modify: `SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift:356-382`
- Modify: `shared/src/mobile-live.ts:394-404`
- Modify: `desktop/electron/services/mobile-gateway/frame-builder.ts:176-180`
- Modify: `desktop/app-capabilities/terminal/main/emulator.ts:40,42,379-385`
- Test: `desktop/electron/services/__tests__/frame-builder.test.ts`、`desktop/app-capabilities/terminal/main/__tests__/emulator.test.ts`、`shared/src/mobile-live.test.ts`

**Interfaces:**
- Consumes: 无（Task 6 之后 `wrapFlags` 已无读者）
- Produces: 行编码回到 `[text]` 或 `[text, runs]` 两种形态

- [ ] **Step 1: 写失败测试**

`desktop/electron/services/__tests__/frame-builder.test.ts`：把断言 wrap flags 的用例（`:63-70` 附近）改成断言**不带第三项**，并在同一个 `describe` 里加一条回归位：

```ts
  it("never emits a third element now that no client reads wrap metadata", () => {
    for (const line of [
      { text: "https://example.com/" },
      { text: "path" },
      { text: "abcdefghij" },
      { text: "styled", runs: [[0, 6, 0, 0, 0]] as const },
    ]) {
      expect(toLineWire(line).length).toBeLessThanOrEqual(2)
    }
  })
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd desktop && ./node_modules/.bin/vitest run electron/services/__tests__/frame-builder.test.ts
```

Expected: 新用例与改写过的用例 FAIL。

- [ ] **Step 3: 删桌面侧的产出与打包**

`desktop/app-capabilities/terminal/main/emulator.ts`：删掉 `:40` 的 `readonly wrappedFromPrevious?: true`、`:42` 的 `readonly wrappedToNext?: true`，以及 `readStyledLine`（约 `:379-385`）里的两个条件展开与 `wrappedToNext = false` 形参。

`desktop/electron/services/mobile-gateway/frame-builder.ts` 的 `toLineWire`（约 `:176-180`）改成：

```ts
export function toLineWire(input: TerminalStyledLine): MobileLineWire {
  const text = input.text
  const runs = input.runs
  // `runs` 对无样式的行整个省掉：日志输出绝大多数没有样式，省下的是近一半载荷。
  if (!runs || runs.length === 0) return [text]
  return [text, runs]
}
```

- [ ] **Step 4: 删 shared 与手机端的解码**

`shared/src/mobile-live.ts:394-404`：

```ts
/**
 * Compact line encoding. `runs` is omitted entirely for unstyled lines, which is
 * the overwhelming majority of log output and roughly halves the payload.
 */
export type MobileLineWire =
  | readonly [text: string]
  | readonly [text: string, runs: readonly MobileRunWire[]]
```

`SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift:356-382`：删掉 `let wrapFlags: Int`、`wrappedFromPrevious`、`wrappedToNext` 三行，以及 `init(from:)` 里 `wrapFlags = 0` 与末尾 `wrapFlags = (try? container.decode(Int.self)) ?? 0` 两处赋值。解码顺序保持「text → runs」，第三项若来自旧桌面端会被自然忽略。

- [ ] **Step 5: 跑两端测试**

```bash
cd desktop && ./node_modules/.bin/vitest run electron/services/__tests__/frame-builder.test.ts app-capabilities/terminal/main/__tests__/emulator.test.ts
cd /Users/liyang/Documents/code/github/Synapse/shared && ./node_modules/.bin/vitest run src/mobile-live.test.ts
```

Expected: 全绿。`emulator.test.ts` 里 `:415-419` 的 `referenceReadStyledLine` 是一份镜像实现，随同删除。

- [ ] **Step 6: 跑手机端解码用例**

```bash
cd /Users/liyang/Documents/code/github/Synapse
xcodebuild build-for-testing -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath SynapseMobile/build/sniffing-removal CODE_SIGNING_ALLOWED=NO
xcodebuild test-without-building -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination "platform=iOS Simulator,id=$SIMULATOR_UDID" \
  -derivedDataPath SynapseMobile/build/sniffing-removal \
  -only-testing:SynapseMobileTests/TerminalFrameDecodingTests
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
cd /Users/liyang/Documents/code/github/Synapse && git add shared/src/mobile-live.ts SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift desktop/electron/services/mobile-gateway/frame-builder.ts desktop/app-capabilities/terminal/main/emulator.ts desktop/electron/services/__tests__/frame-builder.test.ts desktop/app-capabilities/terminal/main/__tests__/emulator.test.ts && git commit -m "refactor: 删掉只为嗅探存在的折行标记

wrapFlags 从 xterm 的 isWrapped 一路走到手机端，只有一个读者：已经不存在的链接
采集器。手机端判断续行用的是自己折行算出来的 isContinuation，桌面端也只有
mobile gateway 一串消费 TerminalStyledLine，所以整条可以拆掉。

代价写在设计里：新桌面配旧手机的窗口内，旧手机还在嗅探却收不到折行标记，跨行的
长 URL 更容易猜错。不崩，且那条路径本来就是要删掉的。"
```

---

## Task 8: 文档与 Skill 收尾

**Files:**
- Modify: `SynapseMobile/README.md:32-40`
- Modify: `desktop/app-capabilities/synapse-skill/skill-package/SKILL.md:54`
- Modify: `RELEASE_NOTES_PENDING.md`

**Interfaces:**
- Consumes: Task 5 的发布说明条目、Task 4 的工具契约
- Produces: 无（文档）

- [ ] **Step 1: 改 README**

`SynapseMobile/README.md:32-40` 整段在描述嗅探：从手机收到的行里收集链接、桌面端在行帧里附带软换行标记、半条链接标「链接不完整」等。把这四段删掉，换成：

```markdown
终端页不再从收到的行里收集链接。链接改由产生它的那一方推给用户账号：AI 调
`app_system_notifier_notification_trigger` 并带上 `url`，手机收到一条通知，点一下直接打开。
这条路径不经过终端渲染，所以长地址不会被折行截断。做法与边界见
`docs/superpowers/specs/2026-10-15-mobile-link-push-design.md`。
```

- [ ] **Step 2: 改 Skill 里那条链接书写指引**

`desktop/app-capabilities/synapse-skill/skill-package/SKILL.md:54`：原文要求把 Synapse 链接写成 URL 本身、独占一行或放在普通句子里、不要藏进 Markdown 链接文字、绝不放进表格单元格。其中「绝不放进表格」的理由（手机端嗅探拆不开表格单元格）随嗅探消失。改成：

```markdown
When the answer includes a Synapse link for the user to open — a share link, a Drive item link, a site or public asset link, or a `synapse://` deep link — write the URL itself out, on a line of its own or inside a plain sentence. Do not hide it behind Markdown link text. When the user wants that address on their phone, hand it over with `app_system_notifier_notification_trigger` and its `url` field (`app/index.md`) instead of expecting them to read it off the terminal.
```

- [ ] **Step 3: 补发布说明**

`RELEASE_NOTES_PENDING.md` 顶部追加：

```markdown
- 手机端终端页的「会话资源」已移除。它是从终端画面里猜链接得到的，长地址被折行时会拼错。需要把链接拿到手机上时，直接对 AI 说「把链接发我手机上」。
```

- [ ] **Step 4: 提交**

```bash
cd /Users/liyang/Documents/code/github/Synapse && git add SynapseMobile/README.md desktop/app-capabilities/synapse-skill/skill-package/SKILL.md RELEASE_NOTES_PENDING.md && git commit -m "docs: 跟上嗅探退役，把链接书写指引改指到链接推送

README 里那几段在描述已经删掉的嗅探行为。SKILL.md 那条要求把 Synapse 链接写成
URL 本身、绝不放进表格单元格的指引里，「绝不放进表格」的理由随嗅探消失，但
「用户要能拿到这个地址」的理由还在，而且现在直接指向新的推送工具。"
```

- [ ] **Step 5: Phase 2 全量验证**

```bash
cd /Users/liyang/Documents/code/github/Synapse
pnpm --filter @synapse/shared run build
cd desktop && ./node_modules/.bin/vitest run
cd /Users/liyang/Documents/code/github/Synapse && pnpm --filter @synapse/desktop run check:hard-constraints
```

外加 Task 6 遗留的一条：那条被裁剪的 UI 用例 `testWideTerminalKeepsItsOwnTitleAndStatusInSplitView` 需要 iPad 宽布局才会真跑（`XCTSkipIf` 要求 ≥600pt）。2026-10-15 已在同一台 iPadOS 18.6 上完成改动前基线与当前版对照，两侧均实际执行 1 条、通过 1 条、0 失败、0 跳过；详见 [验收记录及 26.5 失败边界](2026-10-15-mobile-link-push-ipad-acceptance.md)。运行方式：

```bash
xcodebuild build-for-testing -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath SynapseMobile/build/sniffing-removal CODE_SIGNING_ALLOWED=NO
xcodebuild test-without-building -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination "platform=iOS Simulator,id=$IPAD_SIMULATOR_UDID" \
  -derivedDataPath SynapseMobile/build/sniffing-removal \
  -only-testing:SynapseMobileUITests/WorkspaceFilesUITests/testWideTerminalKeepsItsOwnTitleAndStatusInSplitView
```

⚠️ 这个套件在 iPad 上本来就有与产品无关的既有红（无障碍对比度审计与超时），所以判据是**这条用例自己的结果**，不是整轮退出码。跑之前先用同一台模拟器在本次改动**之前**的提交上取一次基线，否则分不清哪条红是既有、哪条是本次引入。

Expected: 全绿。

---

## 计划外（本计划明确不做）

- 推之前用 `app_drive_link_resolve` 复核链接（spec 的「可靠性不是零风险」一节把它列为后续可选）。
- 通知中心里给链接类消息做筛选或专属入口（`group` 已经能做分组，够用）。
- 移动端 UI 测试：Phase 1 手机端产品代码零改动，Phase 2 只删不加。
