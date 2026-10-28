# 通知携带图片

日期：2026-10-28
状态：待评审

## 目标

用户说「把这张图发我手机上」时，AI 用一条通知把图片交给用户。手机收到通知后点一下，直接进入 Synapse 的图片查看，底部有「保存到相册」；桌面消息中心能看到同一张图。

只扩展现有通知能力，不新建图片通知体系：

- 通知契约增加一个可选图片引用，形状与 `url` / `group` / `copyOnTap` 的既有加法一致。
- 图片字节存进现有 `PlatformMediaStorage`，不新建存储系统。
- 手机端查看器做成通用组件，通知只是第一个入口。

## 非目标

- **不做推送缩略图。** 通知横幅仍只有标题和正文；要在横幅上显示图片需要 Notification Service Extension + `aps.mutable-content`，另算成本。
- **不改开放 API。** `POST /notifications` 等三个形状继续明确不支持图片。
- **不做多图、相册、图片编辑。** 一条通知最多一张图。
- **不给通知增加动作按钮。**
- **Workflow 节点不新增图片参数。** 节点 config 目前只有 `title` / `body` / `variables` / `copyOnTap`，连 `url` / `group` 都没有；本轮保持 1 个节点、字段不变。
- **不做桌面端保存或导出。** 桌面只提供查看。
- **不引入图片转码或处理依赖。** 所有格式归一化由调用方（AI）在调用前完成。

## 语义

### 规范输入只有一种

MCP 参数 `imagePath`：Synapse 所在电脑上的**绝对路径**，指向 PNG / JPEG / GIF / WebP 普通文件，单张 ≤ 10 MiB。

不接受 URL、base64、`file://`、目录、符号链接外的路径写法。调用方拿到的东西不管来自哪里，都先落成一个这样的文件再调用。理由：

- 能力本身不碰网络、不碰剪贴板、不碰截图，权限面最小，不需要 SSRF 防护。
- AI 本来就有 shell，归一化是它擅长的；工具只负责「读文件 → 校验 → 上传 → 建通知」。
- 模型只有一个参数要看，比多形态入参更不容易选错。

### 归一化责任在调用方

Skill 必须写清每种输入怎么变成 `imagePath`。macOS 命令已实测可用：

| 用户给的 | AI 调用前做什么 |
|---|---|
| 本地图片 / `file://` | 取绝对路径、去掉 scheme，直接传 |
| 剪贴板里的图片 | `osascript` 把剪贴板 PNG 写成 `/tmp/...png`；剪贴板没有图片时报 -1700 |
| 屏幕上某个区域截图 | `screencapture -i /tmp/...png` 让用户框选，或 `-R x,y,w,h` 指定区域 |
| 网络图片链接 | `curl -L --fail -o /tmp/...png <url>`，再用 `file` 确认确实是图片 |
| HEIC 或其它格式 | `sips -s format png in.heic --out /tmp/...png`（macOS 自带） |

Windows 的归一化命令列为实现交付物：必须在实现阶段按 PowerShell 实测后写入 Skill，未实测不得写入。

### 与其它字段的关系

- 与 `url` 可以并存。点按优先打开图片；通知详情仍保留链接动作。
- 与 `copyOnTap` 不冲突：点按时先复制正文，再进入图片查看（沿用现有顺序）。
- 与 `group` / `level` 无关。
- 只有 `system-notifier` 来源能带图片；服务端自有来源不传，恒为空。

## 数据流

```
AI 把任意来源归一化成 /tmp/x.png
  └─ app_system_notifier_notification_trigger { title, body, imagePath? }
      └─ 桌面校验 + 读文件（PermissionGuard / AuditSink）
          └─ PUT /api/notifications/desktop/image      Bearer 桌面登录态，原始字节
              └─ PlatformMediaStorage notification-images/<objectKey>（pending，24h）
          └─ POST /api/notifications/desktop { title, body, imageId? }
              └─ UserNotification.imageId + NotificationImage 转 attached
                  ├─ Live 广播 → 桌面消息中心
                  └─ APNs（payload 不变，仍只带 notificationId）
                      └─ 手机点通知 → GET /api/notifications/:id
                          └─ 有 image → GET /api/notifications/:id/image
                              └─ 查看器 → 保存到相册
```

图片从不进入 APNs payload，因此不需要 Service Extension；手机始终按通知 id 回查完整记录再决定去向。

## 服务端

### 数据

新增一张表，不把图片元数据塞进 `UserNotification` 的散列字段：

```
NotificationImage
  id            主键
  userId        所有者
  objectKey     存储键（notification-images/<32 位 Base62 随机串>）
  mimeType      image/png | image/jpeg | image/gif | image/webp
  byteSize      BigInt
  state         pending | attached
  createdAt
  expiresAt     pending 24 小时
```

`UserNotification` 增加可空 `imageId`，与 `NotificationImage` 一对零或一。迁移只有新表加可空列，不重写现有表。

对象键用随机串而不是数据库 id：即使存储桶的键被看到，也不能反推通知或用户。

### 上传

`PUT /api/notifications/desktop/image`，沿用 `PUT /api/mail-internal/attachments/local` 的原始字节读流写法（`server/src/mail/mail.controller.ts:112`），不引入 multipart 依赖，也不需要改 body parser：该请求的 `Content-Type` 是图片类型，不会被 1mb 的 JSON parser 消费。

- 只接受桌面登录态；`UserAuthGuard` 已在控制器上。
- 流式累计到 10 MiB 即拒绝（413），与终端粘贴图片同一上限。
- 校验魔数，复用 `detectPublicAssetImageType`（`server/src/drive/drive-public-asset-policy.ts:35`），只放行 PNG / JPEG / GIF / WebP；AVIF / ICO 不接受。桌面端上传时按其本地检测结果设置 `Content-Type`，服务端仍以自己的检测结果为准，不信任请求头。
- 写入 `PlatformMediaStorage`。该服务目前只有预签名 PUT、head、get、delete，需要补一个服务端 `putObject(key, bytes, contentType)`，COS 与本地两种模式都实现，不改现有方法语义。
- 返回 `{ imageId, mimeType, byteSize }`，其中 `imageId` 是 `NotificationImage.id`；行状态 `pending`，24 小时未被认领即清理。

`expiresAt` 清理与文档图片的临时态同思路，但不复用 `DocumentHostedImage`：那张表绑定文档与留言的权限模型，通知图片与它没有共同生命周期。

### 创建

`POST /api/notifications/desktop` 的 `desktopWriteSchema`（`server/src/notifications/notification.controller.ts:51`）增加可选 `imageId`。

创建前认领：`imageId` 必须属于当前用户且状态为 `pending`；认领后置 `attached`、清空 `expiresAt` 并写入通知。不属于本人、已认领、已过期一律 400，不能把别人的图片挂到自己的通知上。

`NotificationService.create()`（`server/src/notifications/notification.service.ts:73`）只多写一个 `imageId`；`createInTransaction()` 同步接受该字段，便于将来其他来源使用。

### 读取

`GET /api/notifications/:id/image`：

- 当前用户、通知未删除、存在 `imageId`，否则 404。
- 从 `PlatformMediaStorage.getObjectStream` 流式返回。
- `Content-Type` 取记录里的 `mimeType`；`Cache-Control: private, no-store`；`Content-Disposition: inline`。
- 不签发公开 URL，也不使用 `/object/<id>` 这类无鉴权 capability URL：通知图片是私有内容。

列表与详情投影增加 `image: { id, mimeType, byteSize } | null`，不暴露 `objectKey`。投影在 `toNotificationProjection`（`notification.service.ts:268`）一层完成。

### 清理

- 用户删除单条或清空通知：删除对象、删除 `NotificationImage` 行、把通知的 `imageId` 置空，与软删除同一次请求完成。
- 90 天清理（`notification.service.ts:262`）：先删图片对象，再删通知记录。
- `pending` 超过 24 小时：删对象与行。
- 上传成功但创建通知失败：留在 pending，由 24 小时任务兜底，不影响任何可见状态。

### 开放 API

`open-api-contract.ts` 不动。三个发送形状继续不接受图片、`imageId` 或任何图片相关字段；`docs/agents/module-boundaries.md` 里「仍不支持图片」那句继续成立，只补充说明 MCP / 桌面路径另行支持。

## 桌面端

### 输入与校验

`SystemNotificationInput`（`desktop/app-capabilities/system-notifier/shared/schema.ts:29`）增加：

- `imagePath?: string`：对外输入，仅 MCP 直接调用使用。
- `imageId?: string`：内部暂存结果，不对外开放。

`ACCEPTED_KEYS`、`SYSTEM_NOTIFICATION_INVALID_FIELDS` 各增加 `imagePath`，MCP `inputSchema`（`desktop/synapse-capabilities/shared/app-domain.ts:477`）增加同名可选字符串属性；`additionalProperties:false` 保持不变。校验规则：

- 字符串、非空、无控制字符与换行；
- 必须是绝对路径（`path.isAbsolute`），长度 ≤1024；
- 只做形状校验；文件是否存在、是否图片留给暂存步骤。

新增失败原因：`not_absolute`、`not_found`、`not_regular_file`、`unreadable`、`unsupported_type`、`too_large`、`service_outdated`。字段统一为 `imagePath`。

### 暂存

MCP dispatcher（`system-notifier/main/dispatcher.ts`）在调用 `trigger` 前完成一次同步暂存：

1. 发送总闸 `sendEnabled` 为假：维持现状，不读文件、不发送，返回 `{success:true}` 并记诊断。
2. `stat` 普通文件、大小 ≤10 MiB、读头 16 字节校验魔数、`readFile`。
3. 通过账号服务把字节 `PUT` 到服务端，拿到 `imageId`。
4. 把 `imageId` 交给 `trigger`；`systemNotificationAccountWrite`（`system-notifier/main/service.ts:101`）负责透传，漏掉这一字段就是静默失败，单测钉住。

读本地文件再上传到用户自己账号，本质是一个数据出口：走 `PermissionGuard` + `AuditSink`，审计只记 mime 与字节数，不记路径和内容。与邮件「导入本地附件」是同一类操作。

### 失败语义

这是对「触发永远返回 success」的一次**有意例外**，范围只限 `imagePath`：

| 情况 | 返回 | 理由 |
|---|---|---|
| 路径非绝对、不存在、非普通文件、不可读、类型不支持、超限 | `INVALID_INPUT` / `imagePath` / 对应原因 | 调用方给了坏输入，静默成功会让用户以为图已发出 |
| 服务端不支持该端点（404/405）或其余明确 4xx | `INVALID_INPUT` / `imagePath` / `service_outdated` | 新桌面 + 旧服务端，必须当场暴露 |
| 未登录、离线、401/403、5xx、网络失败 | `{success:true}` + `notification_sync` 诊断 | 与文本通知一致：凭证或投递结果不可知，诊断可查 |

文本通知路径完全不变。

### 消息中心

详情页在有 `image` 时显示缩略图与「查看图片」，复用 `ui/src/image-lightbox.tsx` 的 `ImageLightbox`（全屏、缩放、切换）。图片由主进程带 Bearer 下载后交给渲染层，不新增本地持久缓存；列表不加载图片。

不新增保存/导出按钮：本轮只服务手机。

## iOS

### 模型与路由

`SynapseNotification`（`SynapseMobile/.../Features/Inbox/NotificationStore.swift:50`）增加可选 `image: { id, mimeType, byteSize }?`。

`NotificationDestination.resolve`（`.../Features/Inbox/NotificationDestination.swift:24`）在 `url` 判断之前增加一条：`item.image != nil` → `.image(notificationId: item.id)`。动作标签「查看图片」。

`NotificationRouter.Destination` 增加 `.image(notificationId:)`。`RootView` 以全屏方式呈现查看器，而不是压进某个 Tab 的导航栈：冷启动、通知列表点击、APNs 点按因此共用同一条路径，也不依赖当前停在哪个 Tab。

旧服务端不返回 `image`：行为与今天完全一致。

### 查看器

- 全屏黑底；捏合缩放、双击切换 1:1、拖动平移；加载中与失败重试。实现为一个接受「按 id 取图」数据源的通用查看器，通知只是第一个调用方，站内信附件与云盘图片后续可复用。
- 首次进入按通知 id 下载，内存缓存同一张图，旋转与返回不重复下载。
- 显示用 ImageIO 降采样（`CGImageSourceCreateThumbnailAtIndex`），不整图解码，避免超大图片在手机上撑爆内存。
- 底部只有一个主按钮「保存到相册」。不做分享、不做编辑。

### 下载

`APIClient` 增加 `downloadNotificationImage(id)`：Bearer 头、写 `temporaryDirectory/<UUID>`，沿用站内信附件下载（`SynapseMobile/.../Core/Networking/APIClient.swift:1337`）与云盘下载的既有模式。不把带鉴权的地址交给 `AsyncImage`。

### 保存到相册

- `PHPhotoLibrary.requestAuthorization(for: .addOnly)`；用户原本就授予读写的，直接视为可写。
- 用 `PHAssetCreationRequest.addResource(with: .photo, data: 原始字节, options:)` 保存原始文件：保留 GIF 动画、EXIF 方向与原始画质，不重新编码，也不需要整图解码。
- 成功与失败都通过现有 `model.notice` 提示；被拒绝时提示并提供「去设置」（`UIApplication.openSettingsURLString`）。
- `SynapseMobile/SynapseMobile/Info.plist` 增加 `NSPhotoLibraryAddUsageDescription`。现有 `NSPhotoLibraryUsageDescription` 是读取最近一张照片，不改。

## Skill 与文档

发送侧必须同口径：工具 `description`、`app/index.md` 的 System Notifier 段、`app/api-reference.md`、`SKILL.md`。核心判断是：

> 当用户要的东西本质上是一张图（截图、剪贴板图、生成图、网络图片），并且希望在手机上看到或保存，先把任意来源归一化成绝对路径的本地图片，再调用本工具并传 `imagePath`。

同时说明：只支持 PNG/JPEG/GIF/WebP、≤10 MiB；HEIC 先转换；不要伪造路径。

读取侧（`notifications/index.md`）补一句：带图片的通知点开进入查看器，可保存到相册。

规则与设计同步：

- `docs/agents/capability-registry.md`：System Notifier 例外说明补图片；**MCP 工具数仍 1，Workflow 节点仍 1，三张表数字不动**。
- `docs/agents/module-boundaries.md`：通知一段补「可选单图」与「开放 API 仍不支持图片」。
- `docs/superpowers/specs/2026-09-23-account-notification-center-design.md`：第 35 行的不支持清单保持，但明确区分开放 API 与 MCP/桌面路径。
- `RELEASE_NOTES_PENDING.md`：用户可感知变化——通知可以带图，手机上点开可保存到相册。

## 稳定身份与版本

这是既有能力的可选输入扩展，不新增 App、capability、MCP 工具、Workflow 节点、Automation Action 或 Deep Link：

- App ID：`system-notifier`（不变）
- Capability：`app.system_notifier.notification.trigger@1.0.0`（**不 bump**）
- MCP 工具：`app_system_notifier_notification_trigger`（**仍 1 个**）
- Workflow 节点：`system_notifier_notification_trigger`（**仍 1 个，字段不变**）

与 `url` / `group` / `copyOnTap` 的既有做法一致：可选字段是向后兼容的加法。

## 上线顺序

**服务端 → 桌面端 → iOS，不能乱。**

- 新桌面 + 旧服务端：上传端点不存在，暂存按 `service_outdated` 明确失败，不会出现「AI 说发了、其实没发」。
- 新桌面 + 新服务端 + 旧 iOS：忽略 `image` 字段，点通知落到通知详情，属于合理降级。
- 旧桌面 + 新服务端：不受影响。
- 新 iOS + 旧服务端：没有 `image` 字段，行为不变。

## 测试计划

**服务端**
- 上传：PNG/JPEG/GIF/WebP 通过；伪装成 PNG 的文本被拒；>10 MiB 被拒；未登录 401。
- 认领：本人 pending 成功；他人图片 400；重复认领 400；过期 400。
- 读取：本人可读；他人 404；已删除 404；无图 404；响应头正确。
- 清理：单条删除与清空删除对象；90 天清理先删对象；pending 过期清理。
- 投影：列表与详情带 `image`，不出现 `objectKey`。
- 回归：开放 API 带 `imageId` 或图片字段仍被拒。

**桌面**
- 校验：非绝对路径、缺失文件、目录、不可读、伪造魔数、超限各一条。
- 暂存：成功映射 `imageId`；`systemNotificationAccountWrite` 不丢字段；4xx 映射 `service_outdated`；未登录/离线保持 success + 诊断。
- 审计：只记 mime 与字节数，不记路径。
- 回归：不带 `imagePath` 的触发行为与今天一致。

**iOS**
- 路由：有 image 返回 `.image`；无 image 维持原去向；`url` 与 image 并存时优先图片。
- 查看器：下载成功、失败重试、内存缓存不重复下载。
- 保存：授权成功、用户拒绝、保存失败三种路径的提示。
- 冷启动：从 APNs 点按直接进入查看器。
- 真机：真实相册授权与保存；iPad 分屏与旋转；旧服务端降级。

**跨端**
- 部署顺序按上节验证一次「新桌面 + 旧服务端」的明确失败。

## 风险

| 风险 | 影响 | 处理 |
|---|---|---|
| 任意本地文件被读取上传 | 数据出口，可能被提示注入利用 | 只读图片魔数文件、≤10 MiB、PermissionGuard + AuditSink、只传到用户自己账号 |
| 私有图片泄露 | 图片是用户内容 | 不使用无鉴权 `/object` 直链；下载端点校验归属 |
| 新桌面 + 旧服务端 | 静默失败 | 上传 404 明确返回 `service_outdated`；上线顺序服务端先行 |
| 超大图片解码 | 手机内存告警或崩溃 | 字节上限 10 MiB；显示走 ImageIO 降采样；保存写原始字节不解码 |
| 孤儿对象 | 存储成本 | pending 24 小时清理；删除与 90 天清理同步删对象 |
| 图片与链接语义冲突 | 用户不确定点开去哪 | 图片优先；详情页仍提供链接动作，文档写死 |
| 桌面端只做查看 | 电脑上无法保存 | 明确非目标，避免半成品按钮 |

## 明确不改的东西

- APNs payload、`category`、`thread-id`、通知分级。
- `open-api-contract.ts` 与开放接口文档的「不支持图片」边界。
- Workflow 节点字段与数量。
- 通知列表的加载体积与分页方式。
- 账号消息中心的保留期（90 天）。
