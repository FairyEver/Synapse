# Drive File Browser Access Design

Date: 2026-06-11
Scope: `server/`, `dashboard/`, `desktop/`, `shared/`, `docs/`

## 2026-06-16 Current URL Baseline

The route model below was revised after this design:

- `/console/drive` is the console Drive manager; `/console/drive/folders/:folderId` browses a user's folder inside the console.
- `/drive/items/:itemId` is the owner standalone browser for any owned file or folder.
- `/drive/items/:itemId/render` renders an owned HTML file after owner permission checks.
- `/drive/items/:itemId/download` downloads an owned file or returns a folder zip.
- `/share/:shareId` and `/share/:shareId/items/:itemId` are the public share browser routes.
- `/share/:shareId/render` and `/share/:shareId/items/:itemId/render` render shared HTML after the same share, expiry, password, and descendant checks.
- `/share/:shareId/download` and `/share/:shareId/items/:itemId/download` download files or return folder zip.
- `/files/*`, `/pages/*`, `/sites/*`, owner nested `rootItemId/items/:itemId`, and explicit `/zip` URLs are no longer canonical.
- Page/site publication and DrivePublication snapshot semantics are removed; HTML rendering is a live Drive share/owner preview capability.

## 2026-08-03 Markdown Relative Image Exception

The normal file-share browser boundary remains the entry file itself, and folder shares remain limited to the shared root subtree. One narrow read exception exists for `.md` and `.markdown` previews:

- `/share/:shareId/items/:itemId/download` may return a safe raster image for a single-file Markdown share only when the current entry version contains a static relative image reference that resolves to that exact Drive item.
- This exception grants no child browser snapshot, annotation, edit, ZIP, history, rename, move, upload, or arbitrary sibling download capability.
- Folder-share relative images still have to resolve inside the shared root subtree.
- Share enablement, expiry, password/cookie, source lifecycle, current version, and current Drive tree are revalidated before image download; unauthorized and missing targets use the same not-found response.
- The generated Markdown preview URL is a derived rendering result. Stored Markdown and historical versions are not rewritten.

## Goal

重构 Synapse Drive 的文件承接页，让用户不需要先创建分享链接也能查看自己上传的文件。文件承接页统一负责文件夹浏览、文件预览和下载；分享访问复用同一套浏览器体验；发布网页和发布站点继续走独立的直出渲染链路。同时把 Web 管理入口从 `dashboard` 规范为 `console`，并把本次新增的 owner 文件访问路由命名为资源集合式路径。

本设计把云盘分成四类页面：

- 云盘管理页：上传、新建文件夹、删除、移动、重命名、分享、发布。
- 控制台网盘页：登录用户在 Web console 里浏览自己的网盘内容，复用文件浏览器和预览器，可在外层挂接管理动作。
- 文件承接页：浏览文件夹、预览文件、下载文件或文件夹。
- 发布页：直接渲染已发布 HTML 页面或站点资源。

核心边界是：访问上下文和文件浏览器解耦，预览能力和发布能力解耦，管理动作和承接页解耦。

## Route Naming Standard

本次任务同时规范域名下的一级路由。

一级产品空间使用单数：

```text
/console/   管理和用户控制台 SPA
/drive/     登录用户自己的 Drive 文件承接空间
/api/       程序接口命名空间
/healthz    健康检查
```

资源集合使用复数：

```text
/files/     分享文件承接页
/pages/     发布单页
/sites/     发布站点
/webhooks/  公开 Webhook 接收
```

`/dashboard/` 不再作为 canonical Web 入口。新的 canonical 入口是 `/console/`。代码内部包名和部分历史类型名可以分阶段迁移，但对外 URL 和新增 API 以 `console` 为准。

## Current Context

现有 Drive 已经包含：

- 桌面端云盘管理页，支持上传、文件夹、搜索、分享、发布、删除、移动、重命名。
- 分享 URL：`/files/:shareId`。
- 发布 URL：`/pages/:publishId`、`/sites/:publishId/*`。
- 密码保护设计已经要求文件和文件夹分享都必须进入承接网页，而不是文件分享直接下载。

目前缺口是：

- 登录用户自己查看文件没有专用承接页。
- 分享承接页还是服务端轻量 HTML，不是可复用文件浏览器。
- 文件预览类型、HTML 源码预览、owner-only HTML 访问入口没有统一抽象。

## Confirmed Product Decisions

- 用户自己看文件不需要先分享。
- 管理后台对外入口从 `/dashboard/` 改为 `/console/`。
- 控制台 API canonical namespace 从 `/api/dashboard` 改为 `/api/console`。
- 用户侧边栏增加 `网盘`，入口在 console 内，使用用户自己的 Drive 数据源。
- 自己预览、console 网盘和分享访问复用同一个文件浏览器组件与文件预览器。
- 自己预览和分享访问只差访问上下文、权限校验和能力开关。
- 文件承接页不放分享和发布管理动作。
- console 网盘可以在 FileBrowser 外层增加管理动作，但文件浏览器和预览器本身仍只负责浏览、预览和下载。
- 分享和发布入口仍保留在云盘管理页。
- HTML 文件在文件承接页默认显示源码。
- 用户自己看自己的 HTML 文件时，显示 `访问` 按钮；点击后打开 owner-only HTML 渲染页面。
- 分享访问 HTML 文件时，只显示源码预览和下载，不显示 `访问`。
- 发布网页和发布站点打开后直接展示渲染结果，不进入文件浏览器。
- 图片直接预览。
- 文本、Markdown、HTML 以文本或源码方式预览。
- 压缩包和未知类型不做内容预览，只提供下载。
- 文件夹可以逐级浏览；文件夹下载走打包下载。

## Hard Rules

- 分享不是预览的前置条件。
- 文件承接页不得出现分享、发布、重新发布、取消分享、取消发布等管理动作。
- 分享访问不得暴露 owner-only HTML `访问` 能力。
- `/pages/:publishId` 和 `/sites/:publishId/*` 不得复用文件浏览器 UI；它们只负责发布内容直出。
- owner preview 的权限必须由服务端校验登录用户和 Drive item 所属者。
- share browser 的权限必须由服务端校验 shareId、启用状态、过期时间、密码或访问 cookie。
- 下载接口必须和对应访问上下文使用同一套权限校验，不能成为绕过入口。
- 单文件 Markdown 分享的相对图片下载只能使用上述“当前版本静态引用 + Drive 路径解析”专用校验，不能放宽通用 share browser 子项边界。
- 文件浏览器 UI 不展示内部 item id、storage key、owner email、删除状态或其它管理元数据。
- UI 使用现有 shadcn/Radix 基线和 token，不新增自定义颜色、渐变、卡片套卡片或营销文案。

## Non-Goals

- 不做转存、订阅、保存到自己云盘、客户端拉起等网盘平台功能。
- 不在本次设计中实现 Office、PDF、音视频的完整在线预览。
- 不做公开分享访问统计、下载统计或访问者审计 UI。
- 不把文件承接页变成完整 Web 管理后台。
- 不改变发布快照语义；发布仍由已有 DrivePublication 链路管理。
- 不把 owner-only HTML `访问` 链接变成分享链接或发布链接。

## Product Model

### AccessContext

文件浏览器通过访问上下文获得数据和能力。

```ts
type DriveAccessContextKind = "ownerBrowser" | "sharedBrowser"
type DriveBrowserSurface = "standalone" | "console"

type DriveAccessCapabilities = {
  browse: true
  preview: true
  download: true
  htmlAccess: boolean
}
```

`ownerBrowser`：

- 来源：登录用户点击自己的文件或文件夹预览，或在 console 网盘中浏览自己的 Drive。
- 校验：登录态 + item 所属者 + item 未删除 + storage 状态可访问。
- 能力：browse、preview、download；HTML 文件额外允许 `htmlAccess`。
- surface：standalone 表示 `/drive/...` 承接页；console 表示 `/console/drive...` 控制台网盘页。

`sharedBrowser`：

- 来源：第三方打开 `/files/:shareId`。
- 校验：shareId + 分享启用 + 未过期 + 密码或访问 cookie + 源 item 可访问。
- 能力：browse、preview、download；不允许 `htmlAccess`。

### FileBrowser

FileBrowser 是纯浏览器，不承担管理动作。

职责：

- 渲染路径面包屑。
- 渲染当前文件夹列表。
- 渲染当前文件预览。
- 发起下载。
- 在 owner preview 且 HTML 文件时展示 `访问`。
- 展示加载、空、错误和无预览状态。

不职责：

- 创建分享。
- 创建发布。
- 修改文件名、移动文件、删除文件。
- 展示管理状态。
- 展示密码或分享设置。

console 网盘页可以用 `DriveConsoleShell` 包在 FileBrowser 外层。这个 shell 负责 sidebar 入口、上传、新建文件夹、分享、发布等管理动作；FileBrowser 和 PreviewRenderer 不因为 console surface 而复制一套。

### PreviewRenderer

PreviewRenderer 只关心文件类型怎么展示。

```text
image    -> 图片预览
text     -> 文本预览
markdown -> 文本预览，后续可增强为 Markdown 渲染
html     -> 源码预览
archive  -> 仅下载
unknown  -> 仅下载
```

类型判断优先级：

1. 服务端已知 mimeType。
2. 文件扩展名。
3. 无法判断时归为 unknown。

文本预览应设置大小上限。超出上限时展示前段内容和下载入口，避免承接页加载大文件导致卡顿。

### PublishRenderer

PublishRenderer 是发布链路，不属于 FileBrowser。

职责：

- `/pages/:publishId` 返回已发布 HTML。
- `/sites/:publishId/*` 返回已发布站点资源。
- 继续遵守发布密码保护、过期、启停和快照校验。

不职责：

- 展示文件夹列表。
- 展示源码预览。
- 提供 owner-only `访问`。

## Route Design

### Console

```text
GET /console/
GET /console/*
GET /dashboard
GET /dashboard/
GET /dashboard/*
```

`/console/` 是新的控制台 SPA canonical 入口。

兼容规则：

- `/dashboard` 301 到 `/console/`。
- `/dashboard/` 和 `/dashboard/*` 301 到对应 `/console/` 路径。
- 新生成的团队邀请链接、登录回跳、桌面授权回调等控制台链接都使用 `/console/`。
- 前端 Vite base 从 `/dashboard/` 改为 `/console/`。
- 生产 Nginx 静态托管从 `/dashboard/` 改为 `/console/`，保留 `/dashboard*` 重定向。

console 内新增用户网盘入口：

```text
GET /console/drive
GET /console/drive/folders/:folderId
```

`/console/drive` 表示登录用户自己的 Drive 虚拟根目录，列出 `parentId = null` 的文件和文件夹。

`/console/drive/folders/:folderId` 只用于控制台内浏览文件夹。文件独立查看统一走 `/drive/items/:itemId`，普通用户侧边栏文案为 `网盘`。现有 admin 全局云盘管理页需要避免与用户 `网盘` 语义冲突，可迁移为 admin 区域内的 `云盘管理`。

### Console API

```text
/api/console/*
/api/dashboard/*
```

`/api/console/*` 是新的控制台 API canonical namespace。它承接当前 `/api/dashboard/*` 的职责，例如登录、登出、session、当前用户资料、当前用户设备、Webhook 管理、Webhook delivery 列表和控制台 live stream。

兼容规则：

- `/api/dashboard/*` 在迁移期保留为兼容 alias，避免旧桌面版本或已打开的控制台页面立即失效。
- API 兼容不使用 301/302 重定向，避免 POST、PATCH、DELETE 语义和 cookie 行为出错。
- 新代码、新 dashboard API client、测试和文档都使用 `/api/console/*`。
- `/api/admin/*` 保持 admin-only API 语义，不随 console 命名迁移。

### Owner Browser

```text
GET /drive/items/:rootItemId
GET /drive/items/:rootItemId/download
GET /drive/items/:rootItemId/zip
GET /drive/items/:rootItemId/render
GET /drive/items/:rootItemId/items/:browserItemId
GET /drive/items/:rootItemId/items/:browserItemId/download
GET /drive/items/:rootItemId/items/:browserItemId/zip
GET /drive/items/:rootItemId/items/:browserItemId/render
```

`/drive/items/:rootItemId`：

- item 是文件夹时显示文件夹浏览器。
- item 是文件时显示文件预览。
- rootItemId 是本次承接页的根 item。

`/drive/items/:rootItemId/items/:browserItemId`：

- 表示在 rootItemId 根节点下钻到某个浏览器 item。
- 只允许访问 root item 自身或其后代。
- browserItemId 不属于 rootItemId 子树时返回统一不可访问状态。

直接响应路由：

- 文件下载使用当前节点的 `download`。
- 文件夹下载使用当前节点的 `zip`。
- HTML owner-only 访问使用当前节点的 `render`。

`/drive/items/:rootItemId/render` 和 `/drive/items/:rootItemId/items/:browserItemId/render`：

- 只允许 owner preview 上下文访问。
- 只允许 HTML 文件。
- 返回 HTML 渲染结果。
- 不得作为分享链接或发布链接复制给第三方使用。

### Share Browser

```text
GET /files/:shareId
GET /files/:shareId/download
GET /files/:shareId/zip
GET /files/:shareId/items/:browserItemId
GET /files/:shareId/items/:browserItemId/download
GET /files/:shareId/items/:browserItemId/zip
```

`/files/:shareId`：

- share 指向文件夹时显示文件夹浏览器。
- share 指向文件时显示文件预览。

`/files/:shareId/items/:browserItemId`：

- 只允许访问 share 根节点自身或其后代。
- `/files/:shareId` 表示分享根节点。
- `/files/:shareId/items/:browserItemId` 表示分享根节点下的某个浏览器 item。
- item 不属于该 share 子树时返回统一不可访问状态。

下载接口必须复用 share browser 访问校验。

`browserItemId` 是承接页使用的浏览器节点标识，不在 UI 中显示。服务端实现可以先复用当前 Drive item id，但所有校验都必须按 share 根节点子树约束执行；如果后续需要隐藏内部 id，可以在不改变 FileBrowser 组件的前提下替换为 share-scoped opaque id。

owner、share 和 console 网盘的下钻语义统一为：

```text
context root URL
context root URL + /items/:browserItemId
```

区别只在 context root 的表达：

- owner standalone item：`/drive/items/:itemId`
- share root：`/share/:shareId`
- console virtual root：`/console/drive`
- console folder：`/console/drive/folders/:folderId`

### Shared Render

```text
GET /pages/:publishId
GET /sites/:publishId/
GET /sites/:publishId/*
```

保持现有发布语义。发布链接打开后直接展示网页或站点资源，不进入文件浏览器。

## API Design

服务端为 FileBrowser 提供统一 DTO。实现可以是 REST，也可以在现有 controller 中分 owner/share 两套入口，但返回结构要共享。

```ts
type DriveBrowserContextDto = {
  kind: "ownerBrowser" | "sharedBrowser"
  surface: "standalone" | "console"
  capabilities: DriveAccessCapabilities
}

type DriveBrowserItemDto = {
  browserItemId: string
  parentId: string | null
  type: "file" | "folder"
  name: string
  size: string
  mimeType: string | null
  previewKind: "image" | "text" | "markdown" | "html" | "archive" | "unknown"
  updatedAt: string
}

type DriveBrowserSnapshotDto = {
  context: DriveBrowserContextDto
  root: DriveBrowserItemDto
  current: DriveBrowserItemDto
  path: DriveBrowserItemDto[]
  children: DriveBrowserItemDto[] | null
  preview: DrivePreviewDto | null
}

type DrivePreviewDto =
  | { kind: "image"; url: string }
  | { kind: "text" | "markdown" | "html"; content: string; truncated: boolean }
  | { kind: "archive" | "unknown"; downloadable: true }
```

`image.url` 必须是短期、受权限保护的 URL，或由服务端代理返回。不能给出绕过 owner/share 校验的永久对象地址。

文本预览由服务端读取受控字节数并返回。不要把大文件整段塞进页面。

## UI Design

文件承接页参考网盘分享页的承接模式，但只保留 Synapse 需要的能力。

### 文件夹视图

```text
+--------------------------------------------------------------------------------+
| Synapse 云盘                                                    用户或分享状态 |
+--------------------------------------------------------------------------------+
| 文件夹                         | 根目录 / 网站                                  |
|                                |------------------------------------------------|
| > 根目录                       | [搜索当前文件夹................] [下载]       |
|   > 网站                       |                                                |
|     > assets                   | +--------------------------------------------+ |
|   > 照片                       | | 名称                     大小     更新时间 | |
|                                | |--------------------------------------------| |
|                                | | [DIR] assets             -        06/11    | |
|                                | | [HTML] index.html        12 KB    06/11    | |
|                                | | [TXT] styles.css         4 KB     06/11    | |
|                                | | [IMG] cover.png          2.4 MB   06/10    | |
|                                | +--------------------------------------------+ |
+--------------------------------------------------------------------------------+
```

文件夹视图主操作：

- 点击文件夹进入下一级。
- 点击文件进入预览。
- 下载当前文件夹。
- 搜索当前文件夹。

### Owner HTML 文件预览

```text
+--------------------------------------------------------------------------------+
| Synapse 云盘                                                    用户            |
+--------------------------------------------------------------------------------+
| 文件夹                         | 根目录 / 网站 / index.html                     |
|                                |------------------------------------------------|
| > 根目录                       | [访问] [下载]                                  |
|   > 网站                       |                                                |
|     > assets                   | +--------------------------------------------+ |
|                                | | [HTML] index.html              [返回文件夹] | |
|                                | |--------------------------------------------| |
|                                | | <!doctype html>                            | |
|                                | | <html lang="zh-CN">                        | |
|                                | | ...                                        | |
|                                | +--------------------------------------------+ |
+--------------------------------------------------------------------------------+
```

`访问` 只在 owner preview 且当前文件为 HTML 时出现。

### Share HTML 文件预览

```text
+--------------------------------------------------------------------------------+
| Synapse 云盘                                               分享访问            |
+--------------------------------------------------------------------------------+
|                                | 根目录 / 网站 / index.html                     |
|                                |------------------------------------------------|
|                                | [下载]                                         |
|                                |                                                |
|                                | +--------------------------------------------+ |
|                                | | [HTML] index.html              [返回文件夹] | |
|                                | |--------------------------------------------| |
|                                | | <!doctype html>                            | |
|                                | | <html lang="zh-CN">                        | |
|                                | | ...                                        | |
|                                | +--------------------------------------------+ |
+--------------------------------------------------------------------------------+
```

分享访问不显示 `访问`。

### Download-only 文件

```text
+--------------------------------------------------------------------------------+
| 根目录 / backup.zip                                      [下载]                |
|--------------------------------------------------------------------------------|
|                                                                                |
|                         此文件不能预览                                          |
|                         压缩包需要下载后查看                                    |
|                                                                                |
|                         [下载]                                                  |
|                                                                                |
+--------------------------------------------------------------------------------+
```

## Server Authorization

### Owner Browser

服务端必须：

- 验证用户登录。
- 验证 item 属于当前用户。
- 验证 item 未删除。
- 验证文件 storageStatus 可访问。
- standalone 下钻时验证目标 item 是 rootItemId 自身或后代。
- console 虚拟根下钻时验证目标 item 属于当前用户；console item root 下钻时验证目标 item 是 rootItemId 自身或后代。

owner download、folder zip、image preview URL、text preview、HTML render 都必须复用这套校验。

### Shared Browser

服务端必须：

- 验证 shareId 存在且启用。
- 验证 share 未过期。
- 验证密码或访问 cookie 有效。
- 验证源 item 未删除且可访问。
- 下钻时验证目标 item 在分享根节点子树内。

shared download、folder zip、image preview URL、text preview 都必须复用这套校验。

## Migration And Compatibility

现有 `/files/:shareId` 继续作为分享入口，但行为统一成文件承接页。

旧的文件分享直下载行为迁移为：

- 打开 `/files/:shareId` 显示文件预览或下载-only 页面。
- 下载按钮进入 `/files/:shareId/download`。

现有 `/pages/:publishId`、`/sites/:publishId/*` 保持发布直出语义，不受文件浏览器重构影响。

现有 `/dashboard/` 迁移为 `/console/`：

- Nginx 新增 `/console/` 静态托管。
- Nginx 保留 `/dashboard*` 到 `/console*` 的 301。
- Dashboard Vite base 改为 `/console/`。
- TanStack Router 的逻辑路由不需要带 `/console` 前缀；它仍运行在 SPA base 下。
- 旧邀请链接 `/dashboard/team-invite?token=...` 通过 301 到 `/console/team-invite?token=...`。
- 普通用户侧边栏新增 `网盘`，进入 `/console/drive`。
- 当前 admin-only `/drive` 导航应避免继续占用用户网盘语义；迁移后 admin 侧边栏使用 `云盘管理`，路由可放在 `/console/admin-drive` 或等价 admin 区域。

现有 `/api/dashboard/*` 迁移为 `/api/console/*`：

- 新 API client base path 使用 `/api/console`。
- 服务端为 `/api/dashboard/*` 保留兼容 alias。
- 测试覆盖 canonical `/api/console/*` 和兼容 `/api/dashboard/*`。

桌面端云盘管理页可增加预览入口：

- 文件夹行和文件行的主打开行为仍服务云盘管理导航。
- 预览入口放在更多菜单中，菜单项文案为 `预览`。
- 管理页中的分享和发布入口保持在管理页，不带入承接页。

console 网盘页使用同一数据源：

- `/console/drive` 列出当前登录用户的根目录文件。
- 点击文件夹进入下级时使用同一套 FileBrowser 与 PreviewRenderer。
- console 页允许在 FileBrowser 外层添加上传、新建文件夹、分享、发布等管理入口。
- 分享出去的 `/files/*` 页面仍不显示这些管理入口。

## Testing

服务端测试：

- owner 可以打开自己的文件夹承接页。
- owner 可以打开自己的文件承接页。
- owner 不能打开别人的 item。
- owner standalone 和 share browser 下钻 URL 都使用 context root + `/items/:browserItemId` 模型。
- console 网盘可以从虚拟根目录进入文件夹下级。
- owner HTML 文件返回 `htmlAccess=true`。
- shared HTML 文件返回 `htmlAccess=false`。
- share 访问只能下钻到分享根节点及后代。
- 禁用、过期、密码错误、源文件删除时不返回文件列表、预览内容或下载地址。
- owner render 路由只允许当前用户访问 root 或 child HTML 文件。
- 下载接口不能绕过 owner/share 权限。

前端测试：

- owner 文件夹视图只显示浏览、搜索、下载，不显示分享和发布。
- owner HTML 文件预览显示 `访问` 和下载。
- shared HTML 文件预览只显示下载。
- 图片文件进入图片预览。
- 文本、Markdown、HTML 进入文本或源码预览。
- 压缩包和未知类型进入 download-only 状态。
- 面包屑和返回文件夹可用。
- 移动端布局不遮挡操作按钮和文件名。

Regression：

- 发布网页仍直接渲染 HTML。
- 发布站点仍直接渲染站点资源。
- 云盘管理页分享和发布入口仍可用。
- 密码保护页仍不泄露受保护资源名称或内容。

## Implementation Notes

实现阶段应优先提取共享纯逻辑：

- `DriveAccessContext` 类型和 capability 判断。
- `DriveBrowserSnapshot` DTO mapper。
- `DrivePreviewKind` 判断 helper。
- owner/share 共用的 descendant 校验 helper。
- text preview 读取上限常量。

前端应优先提取模块内组件：

- `DriveBrowserPage`
- `DriveBreadcrumbs`
- `DriveBrowserToolbar`
- `DriveFolderTable`
- `DrivePreviewPanel`
- `DrivePreviewRenderer`

这些组件应避免直接散落 fetch 逻辑。数据加载通过页面级 hook 或 route loader 封装。
