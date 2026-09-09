# Drive Milkdown Renderer Design

## Goal

在网页端云盘纯 Markdown 文件中增加与预览、MDXEditor、代码同级的 Milkdown 打开方式，同时复用现有保存、托管图片和评论能力。默认打开方式继续是预览。

## Hard Rules

- Milkdown 只对 `.md`、`.markdown` 或 Markdown MIME 文件开放；`.mdx` 文件名优先排除，不解析 JSX 或 MDX ESM。
- Markdown 源文本仍是版本历史权威数据。保存必须使用现有 `editContext.saveText` 和 `baseVersionId`，409 冲突不得覆盖本地草稿。
- 粘贴、拖放和文件选择图片必须使用现有托管文档图片接口，正文只写稳定 `/object/<objectId>`；相对图片预览只通过 DOM URL 代理，不得改写源文本。
- YAML/TOML Frontmatter、编辑器创建失败或已确认无法安全往返的语法进入可保存源码模式，禁止静默丢失内容。
- 评论继续使用服务端 Markdown projection。Milkdown 只定位已有评论，不提供富文本选区创建评论。
- 仅导入 Crepe 的结构样式；颜色、字体和阴影必须映射到 Dashboard 现有主题 Token，不加载独立主题配色。
- Milkdown 与 MDXEditor 富文本正文必须复用 Dashboard 全局 Drive 编辑器排版层；H1–H6、正文、列表、引用、代码和表格不得在 renderer 内分别维护视觉常量。第三方编辑器只保留稳定 DOM 结构所需的薄适配规则。

## Renderer Contract

- 打开方式顺序固定为：预览、MDXEditor、Milkdown、代码。Milkdown 使用 full container，截断内容显示为禁用。
- React 集成使用 `MilkdownProvider`、`useEditor` 和 Crepe。监听 `markdownUpdated` 更新本地草稿，外部确认的版本通过 `replaceAll` 写入；只读变化通过 `setReadonly` 应用，卸载时销毁实例。
- Crepe 保留 CommonMark/GFM、表格、任务列表、代码块、链接、图片、选区工具栏与块操作；TopBar 和 AI 保持关闭，保存操作继续位于云盘共享工具栏。图片使用保留标准 `alt`、`title` 与 URL 的 CommonMark image schema；不得启用会把 `alt` 复用为缩放比例的 ImageBlock schema。
- 在服务端 Markdown projection 支持数学语法前，Milkdown 必须关闭 LaTeX feature，并将 `$...$` 保持为普通 Markdown 文本，避免编辑器与评论文本模型产生分歧。
- 切换到 Milkdown 时，如当前文件启用协同快照，必须先 reload 最新检查点再挂载。

## Save and Image Behavior

- 支持未保存状态、`Cmd/Ctrl+S`、保存与重载互斥、重新加载确认、本地副本下载、登录提示和权限只读状态。
- 图片格式限定 PNG/JPG/JPEG/GIF/WebP/AVIF/ICO，单图 20 MB。上传期间禁止保存；并发上传以计数归零作为结束条件。
- 图片上传失败保留当前文档内容并显示错误，不插入临时 blob/data URL。

## Comments

- 宽屏复用可调编辑器/评论分栏，窄屏复用评论 Sheet。
- Milkdown 与 MDXEditor 复用 Drive editor 通用评论 geometry API，并分别声明自身内容根节点与忽略元素；Milkdown 从 `.milkdown .ProseMirror` 建立 Unicode code-point 文本模型，文字范围、图片序号、滚动位置和编辑后范围迁移规则与现有评论契约一致。
- 源码保底模式和无法可靠定位的范围只进入评论列表，不猜测重挂。

## Verification

- 注册表覆盖纯 Markdown、Markdown MIME、`.mdx` 排除、截断禁用和默认预览。
- 编辑器覆盖创建/销毁、只读、外部替换、保存、冲突、重载、快捷键和源码保底。
- 图片覆盖粘贴、拖放、文件选择、校验、上传失败、稳定 URL 与相对预览 URL。
- 往返测试覆盖 CommonMark/GFM、列表起始序号、任务列表、表格、代码、Unicode、原始 HTML、HTML 注释和图片。
- 评论覆盖 ProseMirror 范围定位、图片定位、编辑迁移、宽屏分栏和窄屏列表。
