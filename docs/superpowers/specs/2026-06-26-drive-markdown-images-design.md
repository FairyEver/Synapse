# 云盘 Markdown 图片上传与转存设计

日期：2026-06-26

## 背景

Synapse 云盘未来需要支持直接编辑 Markdown/MDX 文档。用户在编辑文档时，应能像本地编辑器一样粘贴截图或拖拽图片，并自动完成上传、插入和保存。

这个能力同时涉及云盘容量、公共素材归属、分享编辑权限、Markdown 渲染器、MDXEditor 插件和文档版本。设计的核心目标是让插图体验顺手，同时避免协作者消耗文档所有者容量，避免公共素材生命周期和 Markdown 引用混在一起。

## 已验证上下文

- 当前依赖中存在 `@mdxeditor/editor`，版本为 `4.0.4`。
- MDXEditor 官方 `imagePlugin` 支持 `imageUploadHandler(file)`，可处理图片上传并返回图片 URL。
- MDXEditor `4.0.4` 同时支持 `imagePreviewHandler(imageSource)`，可以只转换编辑器展示地址而不改写节点中的 Markdown 来源。
- MDXEditor 官方建议不要把 `markdown` 当强受控值反复回灌，保存时应通过 editor ref 获取内容，外部文件变化时再调用 `setMarkdown()`。
- 现有公共素材模型 `PublicAsset` 归属于 `userId`，并和云盘容量 `DriveUsage` 关联。
- 现有公共素材上传链路偏向本地路径上传，粘贴图片需要补充 `File` / `Blob` / `ArrayBuffer` 上传入口。
- 分享编辑接口要求登录；未登录用户不能保存分享文档内容。
- `link_edit` 和 `specified_users_edit` 能编辑文档，但不应因此获得消耗文档所有者容量的能力。

参考文档：

- https://mdxeditor.dev/editor/docs/images
- https://mdxeditor.dev/editor/api/functions/imagePlugin
- https://mdxeditor.dev/editor/api/type-aliases/ImageUploadHandler
- https://mdxeditor.dev/editor/docs/getting-started
- https://mdxeditor.dev/editor/docs/customizing-toolbar
- https://mdxeditor.dev/editor/docs/diff-source
- https://mdxeditor.dev/editor/docs/error-handling
- https://mdxeditor.dev/editor/docs/theming
- https://mdxeditor.dev/editor/docs/content-styling

## 目标

- 用户在 Markdown 编辑器中粘贴或拖拽图片后，图片自动上传到当前登录用户的公共素材。
- 上传成功后，编辑器在当前位置插入 Markdown 图片。
- 协作者编辑分享文档时，图片归协作者，占用协作者容量。
- 文档所有者可以把外部图片或协作者公共素材转存到自己的公共素材，并更新 Markdown 链接。
- Markdown 预览和编辑模式都可以查看当前文档图片来源。
- 顶栏保持通用，不把 Markdown 图片治理逻辑写进统一顶栏。

## 非目标

- 不支持匿名用户编辑或上传。
- 不允许协作者消耗文档所有者容量。
- 不做自动转存。
- 不做删除 Markdown 引用时自动删除公共素材。
- 不做文档附件目录。
- 不做 SVG 上传或转存。
- 不做完整强一致图片引用表。
- 不做公共素材删除前的全局强拦截。
- 不做图片裁剪、压缩、标注等编辑功能。
- 不把图片来源治理入口放到公共素材页面作为主入口。
- 不把图片来源治理入口放到云盘文件列表行操作作为第一版主入口。

## 核心产品规则

1. 谁上传，图片就归谁。
2. 谁拥有图片，谁承担容量，谁能删除这个公共素材。
3. 协作者不能消耗文档所有者容量。
4. 文档所有者可以主动转存图片，把图片收归自己名下。
5. Markdown 图片引用不等于资产所有权。
6. 删除 Markdown 图片引用，不删除公共素材。
7. 删除公共素材，可能导致文档图片失效。
8. 转存会修改 Markdown 内容，必须产生新文件版本。

## 用户流程

### 所有者编辑自己的文档

1. 用户打开自己的 Markdown 文档。
2. 用户粘贴截图或拖拽图片。
3. 编辑器显示上传状态。
4. 图片上传到用户自己的公共素材。
5. 上传成功后，Markdown 中插入图片 URL。
6. 用户保存文档。

容量和所有权：图片归文档所有者，占文档所有者容量。

### 协作者编辑分享文档

1. 协作者登录后打开可编辑分享链接。
2. 协作者粘贴或拖拽图片。
3. 图片上传到协作者自己的公共素材。
4. Markdown 中插入协作者公共素材 URL。
5. 协作者保存文档。
6. 文档所有者之后可以在图片来源面板中看到该图片是协作者素材。
7. 文档所有者可以选择转存。

容量和所有权：图片归协作者，占协作者容量；转存后会创建一份归文档所有者的新公共素材。

### 所有者治理外部图片

1. 文档中已有外部图片 URL。
2. 所有者在 Markdown 预览态或编辑态打开文档，顶栏显示 `图片来源 2`。
3. 所有者打开图片来源面板。
4. 所有者点击 `转存`、`转存所选` 或 `转存全部`。
5. 服务端创建所有者公共素材，并替换 Markdown 图片 URL。
6. 转存操作提交为新的文档版本。

这个流程不要求用户进入 MDXEditor。预览态看到外部图片或协作者素材时，也可以从同一个图片来源面板完成转存。

## 架构分层

### Public Asset 服务

职责：

- 校验当前登录用户。
- 校验图片类型、大小和文件签名。
- 创建当前用户的公共素材。
- 扣减当前用户容量。
- 返回公开可访问 URL。

Public Asset 服务不关心图片来自 Markdown、公共素材页还是未来其它入口。

### Drive Markdown Image 服务

职责：

- 扫描 Markdown 中的图片引用。
- 识别图片来源类型。
- 判断当前用户是否可转存。
- 处理所有者转存。
- 基于当前文档版本提交新的 Markdown 文件版本。

这层运行在服务端，因为权限、外链下载、容量、版本冲突和 Markdown 修改都必须由可信端处理。

### Drive Browser / Finder 渲染层

职责：

- 提供 renderer action slot。
- 当前 Markdown renderer 注册 `图片来源` action。
- 顶栏只渲染 action，不判断文件类型。
- 图片来源面板以当前文档上下文内的侧边面板或 Sheet 打开，不跳转到公共素材页。

统一顶栏不直接包含 Markdown 图片逻辑。

### MDXEditor 编辑层

职责：

- 处理粘贴图片。
- 处理拖拽图片。
- 调用 `imageUploadHandler(file)`。
- 展示上传中、失败、重试、取消状态。
- 上传成功后插入 Markdown 图片。

MDXEditor 不处理容量归属、转存、公共素材生命周期和文档图片治理。

### MDXEditor 集成基线

MDXEditor 按官方插件体系集成，不重写编辑器内核。

第一版建议启用：

- `headingsPlugin`
- `listsPlugin`
- `quotePlugin`
- `linkPlugin`
- `linkDialogPlugin`
- `imagePlugin`
- `tablePlugin`
- `thematicBreakPlugin`
- `codeBlockPlugin`
- `codeMirrorPlugin`
- `diffSourcePlugin`
- `markdownShortcutPlugin`

工具栏使用官方 toolbar 组件组合。`InsertImage` 依赖 `imagePlugin`，`CreateLink` 依赖 `linkDialogPlugin`，源码或 diff 切换依赖 `diffSourcePlugin`。

Markdown 内容管理规则：

- 初次打开文件时传入 `markdown`。
- 编辑中用 `onChange` 维护 dirty 状态，不把变化后的内容反复回灌给 `markdown`。
- 保存时通过 editor ref 获取当前 Markdown。
- 外部切换文件或远端内容刷新时，通过 editor ref 更新 Markdown。

错误恢复规则：

- 保留 source/diff 模式，作为复杂 Markdown、HTML、历史内容或解析异常时的兜底入口。
- 富文本解析异常不应导致文档空白或无法保存。

样式规则：

- 只把 MDXEditor 适配到 Synapse 现有 shadcn/Tailwind token。
- 不写自定义颜色，不做独立编辑器皮肤。
- 不用泛选择器覆盖编辑器内部 `div` 等基础节点。

## 上传设计

公共素材上传入口需要支持两类输入：

```ts
type PublicAssetUploadInput =
  | { kind: "localPath"; path: string; name: string; mimeType?: string | null }
  | { kind: "binary"; name: string; mimeType: string; size: number; data: ArrayBuffer }
```

公共素材页面继续使用 `localPath`。MDXEditor 粘贴和拖拽图片使用 `binary`。

Renderer 侧提供 Markdown 专用 uploader：

```ts
type MarkdownImageUploadContext = {
  itemId: string
  shareId?: string | null
}

function uploadMarkdownImage(
  file: File,
  context: MarkdownImageUploadContext
): Promise<string>
```

归属规则：

- 上传 API 不接受 `ownerUserId`。
- 上传者只能给自己创建公共素材。
- 文档上下文只能用于日志、来源标记或后续统计，不能决定资产归属。

上传限制：

- 支持格式必须复用公共素材图片白名单，第一版为 `jpg`、`jpeg`、`png`、`webp`、`gif`、`avif`、`ico`。
- 粘贴或拖拽多图时保持插入顺序稳定。
- 上传并发受控，第一版建议同一编辑器内并发 2 到 3 个。
- 单次粘贴或拖拽数量需要有限制，第一版建议不超过 20 张。
- 非图片文件不上传，提示 `仅支持图片`。

## 图片来源扫描

图片来源分为：

- `owner_asset`：文档所有者自己的公共素材。
- `collaborator_asset`：其它用户的公共素材。
- `external`：外部 HTTP/HTTPS 图片。
- `relative`：相对路径。
- `data`：data/base64 图片。
- `invalid`：失效或无法识别。
- `unsupported`：不支持的格式或协议。

DTO：

```ts
type DriveDocumentImageSource = {
  id: string
  imageKey: string
  src: string
  kind:
    | "owner_asset"
    | "collaborator_asset"
    | "external"
    | "relative"
    | "data"
    | "invalid"
    | "unsupported"
  occurrenceCount: number
  altText?: string
  previewUrl?: string
  assetId?: string
  assetOwnerId?: string
  assetOwnerName?: string
  canImport: boolean
  status: "ready" | "checking" | "unreachable" | "importing" | "imported" | "failed"
  reason?: string
  importDisabledReason?:
    | "not_owner"
    | "already_owned"
    | "unreachable"
    | "unsupported"
    | "quota"
    | "too_large"
}
```

扫描响应：

```ts
type DriveDocumentImageSourcesDto = {
  itemId: string
  versionId: string | null
  canImport: boolean
  sources: DriveDocumentImageSource[]
  summary: {
    total: number
    ownerAsset: number
    collaboratorAsset: number
    external: number
    invalid: number
    unsupported: number
    importable: number
  }
}
```

扫描策略：

- 打开 Markdown 文档时异步扫描，用于顶栏 badge。
- 保存 Markdown 后异步刷新扫描结果。
- 打开图片来源面板时强扫描当前版本。
- 转存前服务端必须重新扫描当前 Markdown，不能信任前端扫描结果。

图片去重和排序：

- 同一个规范化后的 `src` 在面板中合并为一行，使用 `occurrenceCount` 展示出现次数。
- `imageKey` 由 `normalizeImageSrc(src)` 后哈希生成。
- `normalizeImageSrc` 只做 trim、实体解码、URL 标准化等稳定处理，不丢弃 query 参数。
- 面板默认按处理优先级排序：已失效图片、外部图片、协作者素材、data/base64、相对路径、所有者素材。

## 相对路径图片预览与分享

相对路径图片读取与“图片转存”是两条独立链路。转存扫描继续使用 20 个来源的业务上限；预览解析最多处理当前 128 KiB Markdown 内容中的 256 个唯一相对图片来源，不创建公共素材，也不改写 Markdown。

- 仅 `.md`、`.markdown` 启用；`.mdx` 和其它文件类型保持原行为。
- 路径从 Markdown 的 `DriveItem.parentId` 开始，按现有父子目录树解析 `.`、`..` 和普通文件名；不得越过所有者 Drive 顶层。
- 支持 Markdown inline image、reference image，以及独立且 `src` 带引号的静态 `<img>`；inline image 兼容安全栅格相对路径中的未转义空格，但不扩展普通链接或其它非标准 Markdown 语法。
- 兼容以 `.\` 或 `..\` 开头且全程使用反斜杠的 Windows 相对图片路径；裸反斜杠相对路径、根路径、盘符、UNC、编码分隔符和正反斜杠混用均不识别。兼容解析不得改写 Markdown 原文。
- Agent 新建或改写图片引用时必须优先生成使用 `/` 的标准 inline image；路径含空格时优先使用尖括号 destination，也可使用 `%20`，reference image 同样支持。反斜杠和未转义空格只作为既有文档的输入兼容，不作为推荐输出。
- 仅解析 PNG、JPEG、WebP、GIF、AVIF、ICO；SVG、HTML 和未知格式不产生读取 URL。
- owner 预览生成 `/drive/items/<imageItemId>/download`；share 预览生成 `/share/<shareId>/items/<imageItemId>/download`。
- 文件夹分享只允许共享根子树内的图片。单文件 Markdown 分享只允许当前版本实际引用且成功解析的图片，不开放兄弟文件浏览或通用下载权限。
- 密码、过期、停用、入口删除和生命周期检查继续复用 DriveShare 读取校验；未引用、越界、缺失和不支持目标统一按未找到处理。
- Dashboard Markdown 预览使用服务端转换后的 HTML；实时协作 HTML 通过同一响应中的权限化 `relativeImages` 映射恢复图片地址；MDXEditor 通过 `imagePreviewHandler` 使用该映射，编辑和保存内容仍保留原始相对路径。
- query 和 fragment 不参与 Drive 查找，解析成功后原样附加到生成 URL；以 `/` 开头的路径不支持。
- 解析结果只做进程内派生缓存，以分享 ID、当前版本 ID 和所有者最新 DriveChange sequence 失效，不新增数据库表或存储副本。
- 该能力不得扩展到 `.html`、`.htm` 或普通文件夹分享中的 HTML。独立 HTML 只保持单文件分享语义；需要相对 CSS、JavaScript、图片或页面跳转时，用户必须明确从文件夹创建“网页分享”。

## 转存设计

转存只允许文档所有者操作。

接口形态：

```text
POST /api/drive/items/:itemId/image-sources/import
POST /api/drive/browser/shares/:shareId/items/:itemId/image-sources/import
```

第二个接口只用于文档所有者通过分享页查看自己文件的场景。普通协作者即使有编辑权限，也不能转存到文档所有者公共素材。

请求：

```ts
type DriveDocumentImageImportRequest = {
  baseVersionId: string
  sources: Array<{ src: string }>
}
```

响应：

```ts
type DriveDocumentImageImportResult = {
  itemId: string
  versionId: string
  imported: Array<{
    previousSrc: string
    nextSrc: string
    assetId: string
    size: string
  }>
  failed: Array<{
    src: string
    reason:
      | "unreachable"
      | "unsupported"
      | "too_large"
      | "quota"
      | "changed"
      | "unknown"
    message: string
  }>
  summary: {
    importedCount: number
    failedCount: number
    replacedOccurrenceCount: number
  }
}
```

服务端流程：

1. 校验当前用户是文档所有者。
2. 校验 `baseVersionId` 仍是当前版本。
3. 重新读取 Markdown 内容。
4. 重新解析图片节点。
5. 只处理请求中仍存在于当前 Markdown 的 `src`。
6. 对外部 URL 执行安全下载和文件校验。
7. 对 Synapse 公共素材 URL 解析 assetId，优先走内部对象复制。
8. 创建归文档所有者的新公共素材。
9. 基于 Markdown AST 替换 image node 的 URL。
10. 提交新的文件版本，标记来源为 `markdown_image_import`。
11. 返回成功和失败列表。

版本冲突：

- 如果当前版本不等于 `baseVersionId`，不创建公共素材，不修改 Markdown。
- 前端显示 `文档已更新`，提供 `刷新`。

批量限制：

- 单次 import 的 `sources` 数量必须有服务端上限，第一版建议不超过 20 个。
- 超过上限时返回可读错误，不执行部分转存。

## 外部 URL 安全

外链转存必须把 URL 当作不可信输入。

要求：

- 只允许 `http` 和 `https`。
- 禁止访问 localhost、内网 IP、link-local、metadata 地址。
- DNS 解析后校验 IP。
- 跟随重定向时每一跳重新校验。
- 设置连接和下载超时。
- 设置最大下载大小。
- 校验 `Content-Type`，但不能只信任它。
- 下载后校验文件签名。
- 拒绝 HTML、SVG、脚本和未知二进制。
- 确定文件大小后再检查并扣减容量。
- 任一步失败都不创建公共素材。

## UI 设计

### 顶栏 action

Markdown renderer 注册 action：

```text
图片来源
图片来源 3
```

badge 只统计需要关注的项，例如外部图片、协作者图片、失效图片、无法转存图片。不统计已经属于文档所有者的图片。

扫描中可以显示轻量 loading。扫描失败不把顶栏变成强警告，只在打开面板后显示 `检查失败`。

顶栏不显示 `转存全部`。批量动作只出现在图片来源面板内。

### 编辑器上传状态

状态文案：

- `上传中`
- `上传 2/4`
- `上传失败`
- `重试`
- `取消`
- `图片上传中`

规则：

- 上传状态是 editor decoration，不写入 Markdown。
- 只有上传成功并拿到 URL 后才插入 Markdown 图片。
- 多图上传可以并发，但插入顺序应保持粘贴或拖拽顺序。
- 上传中禁止保存。
- 拖拽投放区域只覆盖编辑器区域，不把整个 Finder 页面变成 drop zone。
- 粘贴外部图片 URL 时默认作为外链插入，不自动转存。

### 图片来源面板

图片来源面板从当前 Markdown 文件的顶栏 action 打开，使用侧边面板或 Sheet。它属于当前文档治理，不属于公共素材库管理页。

分组：

- `需处理`
- `已托管`

所有者操作：

- `转存`
- `转存所选`
- `转存全部`
- `刷新`

协作者视角：

- 可以查看来源状态。
- 不显示批量转存主操作。
- 对不能操作的项目显示短状态，例如 `所有者可转存`。

行为规则：

- owner 保存后如果发现外部图片或协作者素材，可以给轻提示 `发现 2 张需处理图片`，操作为 `查看`。
- 协作者保存后不弹转存提示。
- 不自动打开图片来源面板。
- 转存成功后，成功行移动到 `已托管`，顶栏 badge 减少。
- 部分失败时，失败行留在 `需处理` 并显示短原因和重试入口。

状态文案：

- `我的素材`
- `所有者素材`
- `协作者素材`
- `外部图片`
- `相对路径`
- `内嵌图片`
- `已失效`
- `无法转存`
- `容量不足`
- `图片过大`
- `格式不支持`
- `文档已更新`
- `检查失败`

## 状态机

### 上传状态机

```text
idle
  -> queued
  -> uploading
  -> uploaded
  -> inserted

queued/uploading
  -> failed
  -> canceled

failed
  -> queued
  -> canceled
```

规则：

- `failed` 不写入 Markdown。
- `uploaded` 后才能插入 Markdown。
- `inserted` 后才算进入文档内容。

### 图片来源面板状态机

```text
closed
  -> opening
  -> scanning
  -> ready
  -> importing
  -> ready

scanning
  -> failed

importing
  -> conflict
  -> partial_failed
  -> ready
```

规则：

- `importing` 只禁用相关行和批量按钮。
- `conflict` 只提供刷新。
- 扫描失败不影响文档编辑。

## 派生 inventory

可以增加派生缓存表，但它不是强一致引用表。

建议结构：

```ts
type DriveDocumentImageInventory = {
  itemId: string
  versionId: string
  imageKey: string
  src: string
  kind: string
  occurrenceCount: number
  assetId?: string
  assetOwnerId?: string
  lastSeenAt: string
  status: string
}
```

定位：

- 加速顶栏 badge。
- 加速图片来源面板首屏展示。
- 支持未来公共素材删除前提示可能影响的文档。

不用于：

- 判断权限。
- 阻止删除公共素材。
- 直接替换 Markdown。
- 作为转存依据。

真相永远是当前 Markdown 内容。转存前必须重新读取并重新解析。

## 错误处理

- 上传失败：不插入 Markdown，显示 `上传失败`，支持重试或取消。
- 上传成功但保存失败：公共素材保留，用户可重试保存。
- 协作者容量不足：上传失败，不消耗文档所有者容量。
- 所有者容量不足：上传或转存失败，不修改文档。
- 外部图片转存失败：失败行保留原链接，其它成功项正常替换。
- 公共素材被删除：扫描显示失效，文档引用不自动删除。
- 文档版本冲突：不创建素材，不改 Markdown，提示刷新。
- 相对路径：不可转存；符合上节规则时可直接从 Drive 目录树预览和分享。
- data/base64：第一版可识别，默认不开放转存。
- SVG：第一版不支持上传或转存。
- 删除公共素材前可以基于 inventory 做影响提示，但第一版不阻止删除。

## 日志与审计

建议记录结构化事件：

- `markdown_image_upload_started`
- `markdown_image_upload_succeeded`
- `markdown_image_upload_failed`
- `markdown_image_sources_scanned`
- `markdown_image_import_started`
- `markdown_image_import_completed`
- `markdown_image_import_failed`

日志不得记录完整外部 URL。最多记录 host、来源类型、失败类型、文件大小和 mimeType。

## 测试计划

上传插入：

- 粘贴 PNG 后上传成功并插入 Markdown 图片。
- 拖拽多张图片后插入顺序稳定。
- 拖拽非编辑器区域不触发编辑器上传。
- 上传中保存被阻止。
- 上传失败不写入 Markdown。
- 上传失败后重试成功。
- 非图片文件拖入提示 `仅支持图片`。
- 粘贴外部图片 URL 时默认插入外链，不自动转存。

MDXEditor 集成：

- `imagePlugin` 的 `imageUploadHandler(File)` 被调用并返回公共素材 URL。
- 保存时通过 editor ref 获取 Markdown，不把 `onChange` 内容回灌为强受控 `markdown`。
- source/diff 模式在复杂 Markdown 或解析异常时可用。
- toolbar 组件和插件依赖匹配。

归属和容量：

- 所有者编辑时图片归所有者。
- 协作者编辑时图片归协作者。
- 协作者容量不足时上传失败，不消耗所有者容量。
- 未登录用户不能编辑和上传。

图片来源扫描：

- 所有者素材识别为 `owner_asset`。
- 协作者素材识别为 `collaborator_asset`。
- 外部 URL 识别为 `external`。
- 相对路径识别为 `relative`。
- data URL 识别为 `data`。
- 已删除公共素材识别为失效。

转存：

- 所有者可以转存外部图片。
- 所有者可以转存协作者公共素材。
- 协作者不能转存。
- 转存成功后 Markdown URL 被替换。
- 转存失败时原 URL 保留。
- 部分成功部分失败时，成功项更新，失败项保留。

并发和安全：

- `baseVersionId` 不一致时返回冲突。
- 单次上传数量超过上限时被拦截。
- 单次 import sources 数量超过上限时被拒绝。
- 外部 URL 下载超时不创建 asset。
- 外部 URL 不是图片不创建 asset。
- 单文件分享未引用的兄弟图片直接请求返回 404。
- 文件夹分享中的 `..` 不能读取分享根外图片。
- 图片移动、重命名、删除、恢复和 Markdown 版本回滚后，相对路径授权按当前目录树和当前版本重新计算。
- SVG 不允许转存。
- 超大图片不创建 asset。
- 内网地址被拦截。
- Synapse 公共素材 URL 通过集中解析器识别，不靠字符串 includes 判断。

## 实施顺序建议

1. 公共素材 binary 上传 bridge。
2. Markdown 编辑器接入 MDXEditor image plugin。
3. 编辑器上传队列和反馈。
4. 图片扫描 API 和 DTO。
5. 顶栏 renderer action slot。
6. 图片来源面板。
7. 所有者转存 API。
8. 派生 inventory 缓存和公共素材删除影响提示。

## 第一版默认取舍

- data/base64 第一版只识别，不开放转存。
- 图片节点局部菜单第一版只做 `替换`、`复制链接`、`删除引用`，不放 `转存`。
- inventory 缓存不阻塞核心链路，核心能力跑通后再补。
