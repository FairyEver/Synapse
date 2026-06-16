# Drive Finder Render Refactor Design

Date: 2026-06-16
Scope: `dashboard/src/features/drive-browser/`, `RELEASE_NOTES_PENDING.md`

## Goal

重构 console 网盘承接界面，把现有 `DriveBrowser` 拆成清晰的 Finder、Renderer Registry 和 Host 三层。Finder 负责浏览文件路径和当前目录内容，Renderer 负责显示某个文件，Host 负责把 Finder 或 Renderer 放进 console、分享页、owner 独立页或单文件新窗口。

本次重构以用户提供的三种状态为准：

- 进入一个目录，没有选择某一个文件。
- 进入一个目录，并且选择了一个文件。
- 在新窗口打开一个文件，或其它用户看分享出来的文件。

截图中的黄色区域表示 Finder，浅灰区域表示 Renderer。截图文字是需求说明，不进入最终 UI。

## Product Behavior

### Console: Folder Without Selected File

console 网盘进入目录且当前 item 是文件夹时，页面保留 console shell 和页面标题。

内容区分为两部分：

- 顶部路径区：显示当前网盘路径，使用面包屑形式，每一级都可点击。
- 顶部按钮区：当前只需要显示 `下载整个目录`。
- 主体 Finder：当前层级文件夹下的文件列表占满可用内容区。

此状态不渲染文件 Renderer，不显示预览占位文案。

### Console: Folder With Selected File

用户在目录中选中文件后，console shell 保持不变。

内容区布局：

- 顶部路径区仍显示当前路径面包屑。
- 顶部按钮区仍显示目录级操作，例如 `下载整个目录`。
- 左侧 Finder 显示当前层级文件列表。
- 右侧渲染区包含文件 header 和 Renderer。

文件 header 属于 Finder/Host 协调区，不属于 Renderer 内部。它显示：

- 文件名。
- `下载`。
- `新窗口打开`。
- `切换显示` 下拉菜单。

`切换显示` 用于选择当前文件可用的 Renderer。Finder 负责根据 Renderer Registry 提供可选项，Renderer 只负责实际显示。

### Single File Window And Shared File

用户在新窗口打开一个文件，或其它用户直接访问分享出来的文件时，页面不再包外部容器或边框。整个页面 body 就是 Renderer 的显示范围。

Renderer 自己决定内容宽度：

- Markdown 和代码类可以使用中间阅读宽度。
- 图片可以使用更宽的媒体宽度。
- iframe 类可以接近满页。
- 仅下载文件显示下载状态。

右下角固定一个悬浮按钮。点击后以菜单形式打开文件操作：

- 文件名。
- 文件信息。
- 下载。
- 切换显示。

悬浮菜单不承担分享、发布、重命名、移动或删除等管理动作。

### Shared Folder

其它用户访问分享出来的目录时，页面使用 Finder。目录页可以浏览层级和下载目录。进入某个分享文件时切换为单文件 Renderer 页面。

## Architecture

### Host Layer

Host 负责路由和外壳：

- console host：保留 console sidebar、header、main content。
- owner standalone host：登录用户通过 `/drive/...` 打开自己的文件或目录。
- share host：通过 `/files/...` 访问分享内容。
- single file host：用于新窗口文件阅读。

Host 不直接实现文件列表或文件渲染逻辑。

### Finder Layer

Finder 是 Drive 文件浏览系统，可以在指定时机、指定区域加载 Renderer。

Finder 负责：

- 路径面包屑。
- 当前层级文件列表。
- 目录空状态。
- 目录下载按钮。
- 当前选中文件的列表高亮。
- 文件 header。
- 将当前文件交给 Renderer Registry。
- 根据 Host 模式决定布局：目录全宽、目录加右侧 Renderer、或分享目录。

Finder 不负责：

- Markdown 渲染。
- HTML iframe 加载。
- 图片显示。
- 文件内容安全处理。
- 分享、发布、重命名、移动、删除等管理动作。

### Renderer Registry

Renderer Registry 根据当前文件和 preview 数据返回可用 Renderer。

第一版保留轻量注册表，不做运行时插件系统。注册表应是静态、类型安全、可测试的映射。

每个 Renderer 声明：

- 稳定 id。
- 用户可见 label。
- 支持的 preview kind。
- 是否可作为默认 Renderer。
- 是否可在当前 access context 下启用。
- 是否需要 full body、reading width、media width 或 iframe style 的容器策略。

### Renderer Layer

Renderer 只负责显示文件内容。

第一版内置 Renderer：

- Markdown Renderer：默认显示渲染结果，支持切换源码。
- Source Renderer：显示文本、代码、HTML 源码。
- Image Renderer：显示图片。
- Iframe Renderer：只在 owner context 且后端提供可访问 URL 时启用。
- Download Renderer：用于压缩包、未知类型和不可预览文件。

Renderer 不做：

- 路径导航。
- 目录列表。
- 文件管理动作。
- 分享或发布动作。
- 访问权限判断。

## Access And Security

现有访问模型继续成立：

- owner context 由服务端校验登录用户和 item 所属者。
- share context 由服务端校验 shareId、启用状态、过期时间、密码或访问 cookie。
- 下载接口和预览接口继续复用对应访问上下文的权限校验。
- share context 不显示 owner-only iframe 或 `访问` 能力。
- 文件浏览器 UI 不展示内部 item id、storage key、owner email、删除状态或管理元数据。

HTML 的 iframe 渲染必须只使用服务端返回的安全 URL。没有安全 URL 时只能显示源码或下载。

## UI Rules

- 使用 dashboard 现有 shadcn/Radix 组件和 Tailwind token。
- 不新增自定义颜色、hex/rgb/hsl 字面色或 Tailwind 任意颜色。
- 不使用渐变、glow、装饰性阴影、卡片套卡片或营销文案。
- UI 文案只保留必要标题、路径、按钮、列表、加载、空、错误状态。
- 截图里的说明文字不进入 UI。
- 目录列表的行点击行为要保持清晰，行内按钮必须阻止事件冒泡。
- 表格数字列右对齐。

## Data Flow

继续使用 `DriveBrowserSnapshotDto` 作为页面数据源。

推荐新增前端视图模型 helper：

- `getDriveFinderActions(snapshot)`：返回目录级动作和文件级动作。
- `getDriveRendererOptions(snapshot)`：返回当前文件可用 Renderer 列表。
- `selectDefaultDriveRenderer(snapshot)`：决定默认 Renderer。
- `shouldRenderDriveFinder(snapshot, hostMode)`：决定当前页面是否需要 Finder。
- `shouldRenderDriveBodyRenderer(snapshot, hostMode)`：决定是否直接用 Renderer 占满 body。

这些 helper 不发请求，不读取浏览器状态，便于单元测试。

## Migration Strategy

本次没有历史包袱，可以以模块内重构方式直接拆分现有 `drive-browser-page.tsx`。

建议落地结构：

```text
dashboard/src/features/drive-browser/
  drive-browser-page.tsx
  drive-console-page.tsx
  finder/
    drive-finder.tsx
    drive-finder-actions.ts
    drive-finder-breadcrumbs.tsx
    drive-finder-list.tsx
    drive-finder-layout.tsx
  renderers/
    drive-renderer-registry.ts
    drive-renderer-shell.tsx
    markdown-renderer.tsx
    source-renderer.tsx
    image-renderer.tsx
    iframe-renderer.tsx
    download-renderer.tsx
  shared/
    drive-format.ts
    drive-icons.tsx
    drive-view-model.ts
```

如果现有文件中有可直接复用的函数，应搬到 `shared/`，不要复制。

## Testing

Renderer tests:

- console 目录页无选中文件时不渲染 Renderer 区。
- console 目录页选中文件时渲染左侧 Finder 和右侧 Renderer。
- 单文件新窗口或分享文件页直接渲染 body-level Renderer。
- 分享 HTML 文件不出现 iframe 或 owner-only 访问入口。
- owner HTML 文件在存在 `visitUrl` 时出现 iframe 或访问类 Renderer 选项。
- Markdown 默认显示渲染结果，并可切换源码。
- download-only 文件显示下载状态。
- 目录下载按钮只在目录上下文显示。
- 行点击进入对应 `browserUrl`。

View model tests:

- Renderer Registry 按 `preview.kind` 返回正确候选。
- 默认 Renderer 选择稳定。
- `getDriveFinderActions()` 不返回分享、发布、重命名、移动或删除动作。

## Acceptance Criteria

- console 网盘目录页清楚区分 Finder 和 Renderer。
- 没有选中文件时 Finder 文件列表占满内容区。
- 选中文件时 Finder 在左，Renderer 在右。
- 单文件新窗口和分享文件页不显示 finder 外框，Renderer 占满 body。
- 右下角悬浮菜单提供文件信息、下载和切换显示。
- renderer 切换由注册表驱动，不散落在 Finder JSX 中。
- 文件承接页不出现分享或发布管理动作。
- UI 遵守现有 shadcn/Radix 和 token 规范。
- `RELEASE_NOTES_PENDING.md` 记录面向用户的网盘界面变化。
