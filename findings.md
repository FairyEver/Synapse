# 发现与决策

## 2026-08-26 阶段 23 第 4 轮 Drive Markdown / MDX / Mermaid 审查

- 起始基线为 `dca057a0f0d3deb16c32d7622f5a114160d23bc3`，工作树在本轮记录前干净；固定比较范围为 `db189074...HEAD`。
- 主任务给出的 `f937c5e73b8a29c845fae73f539a44fd9d32dff4` 不是现有对象；同前缀真实 Mermaid 提交为 `f937c5e73c3ee3525eddcaa820287eac461d9d7f`。
- 权威边界：Markdown 源文本始终是协同和版本历史的权威；普通 `.md/.markdown` 需要兼容 CommonMark 文本，`.mdx` 保持严格解析；评论锚点只接受服务端 projection 的保守解析，Renderer 不猜测重挂；MDXEditor 保存继续复用现有版本冲突与失败保留链路。

### 第 4 轮修改点矩阵（完成 12 项）

| # | 修改点 | 文件 / 提交 | 用户行为 | 自动化 | 实机 | 结论 |
|---:|---|---|---|---|---|---|
| 1 | Mermaid figure 取消默认横向 margin | Mermaid renderer；`f937c5e73` | 宽图与正文、表格共用内容边界 | Mermaid renderer 专项通过 | 合法宽图完成渲染并与正文/表格对比 | 通过 |
| 2 | Mermaid 多图、错误、取消、主题重绘 | Mermaid renderer/test；`f937c5e73` | 多图独立，异常保留源码，旧渲染不回写 | 多图、异常、取消、重绘均通过 | 合法图可见；编辑损坏后的非法图保留源码 | 通过；多图竞态由同层自动化覆盖 |
| 3 | Mermaid 内容宽度与横向滚动 | Mermaid renderer/test；本轮补回归 | SVG 保留固有宽度，窄窗在图内滚动 | 新增 `1200px` SVG 宽度、`max-width` 清除、scroller 断言通过 | 1325/1063/768 px 检查无页面级横向溢出；合法宽图在编辑前可见 | 通过；图内滚动行为由布局专项补证 |
| 4 | 普通 Markdown `<=` 兼容 | CommonMark plugin；`5c2ac491` + 本轮修复 | `a <= b` 可进入富文本且保存不加反斜杠 | 真实 MDXEditor 比较、代码、转义往返通过 | 线上旧版本富文本报严格 MDX 错误；源码编辑、同步、重开可持久化 | 红灯后修复；本地热更新 UI 受登录阻塞，不能声称修复后实机通过 |
| 5 | `.md` HTML/JSX/表达式/代码/转义/注释边界 | CommonMark plugin / renderer；本轮修复 | 普通 HTML 与代码示例不误判，HTML 注释不丢失 | HTML、属性、代码块、行内代码、转义、注释边界通过 | 普通正文/代码路径可达；生产测试文档未构造全部语法组合 | 通过；HTML 注释保守进入源码模式 |
| 6 | `.mdx` 严格解析与恢复编辑 | MDXEditor renderer；`5c2ac491` + 本轮修复 | 合法 JSX 可编辑；非法 MDX 显示源码；ESM 不静默丢失 | 真实 MDXEditor 覆盖属性、表达式、嵌套组件、注释；ESM/非法专项通过 | 线上合法 MDX 仍报 `mdxJsxTextElement`，非法 MDX 正确报错 | 红灯后修复；部署版验证了旧失败与严格错误，本地 UI 登录受阻 |
| 7 | 有序/无序/三级混合列表 marker 与缩进 | MDXEditor/reader；`5c2ac491` + 本轮修复 | 编辑与阅读 marker、层级一致 | 真实编辑器三级混合列表往返通过 | 预览显示三层混合与任务项；线上编辑批量输入后缩进变形 | 当前代码通过；部署版旧行为失败，修复后实机受登录阻塞 |
| 8 | 列表编号起始、任务列表、空项与保存重开 | 新 ordered-list start plugin；本轮修复 | 非 1 起始、任务/空项不变形 | 真实编辑器 `3.` 起始、混合嵌套、任务、空项 7/7 通过 | 测试文档同步并重开成功，但线上编辑已把编号/缩进规范化 | 红灯后修复；持久化通过，修复后格式实机受环境阻塞 |
| 9 | 空 heading 不进入目录 | server markdown renderer；`5c2ac491` | 空标题无目录占位项 | Server renderer/projection 专项通过 | 线上目录仍出现 `heading 2` | 当前 main 已有修复且自动化通过；部署版落后，未把线上失败算作修复后通过 |
| 10 | 重复/Unicode/显式 ID 与目录顺序 | server markdown renderer | 重复标题唯一 ID，Unicode 与顺序稳定 | renderer/projection 专项通过 | 重复标题生成 `-2`，Unicode 标题稳定；CommonMark `{#id}` 按正文显示 | 通过；显式 ID 不是当前 CommonMark 产品契约 |
| 11 | heading/list projection 与评论定位 | server projection + dashboard annotation；本轮收紧评论格式 | 选文评论保存后仍对准正文，非 `.md` 不开放评论 | projection、annotation、link intake、`.md` 边界专项通过 | 对 `projection` 建评论，刷新后正文与评论锚点仍在 | 通过 |
| 12 | 保存/读取/竞态/XSS、错误状态与样式纪律 | Drive save、server renderer、MDXEditor；本轮审查 | 失败保留源码，内容安全，无新增自定义视觉 | Server/Dashboard/Shared 20 文件 533 项；build/typecheck/hard constraints 通过 | `.md` 保存显示“已同步”且刷新持久；非法 `.mdx` 错误可见；本地两入口均受登录阻塞 | 通过；本轮未新增颜色、内联样式、依赖或吞错 |

### 第 4 轮红绿灯与代码审查结论

- 红灯 1：真实 MDXEditor 将普通 Markdown 的 `a <= b` 序列化为带额外转义的源码；兼容 serializer 同时归一 `\\<\\=` 与 `\\<=` 后，正文、行内代码、代码块和显式转义往返通过。
- 红灯 2：`.mdx` 没有 JSX descriptor，合法组件在真实 UI/真实编辑器中报 `mdxJsxTextElement`；仅对 `.mdx` 注册通用 JSX editor，属性、表达式、嵌套组件和 MDX 注释均保留，非法 MDX 继续严格报错。
- 红灯 3：MDXEditor 对顶层 `import`/`export` 和 CommonMark HTML 注释不能无损往返；检测 fenced code 之外的对应源码并进入现有 Textarea 源码模式，不引入新的保存链路。
- 红灯 4：MDXEditor 默认丢失有序列表非 1 起始值；新增窄插件只在 list import/export 补 `start`，三级混合、任务列表与空项继续走上游 list visitor。
- 红灯 5：评论格式边界在 Renderer、服务端 target 和链接 intake 不一致，曾允许 `.markdown`、`.mdx` 或仅 MIME 命中的文件；提取共享 `.md` 判定并在三层统一。
- Mermaid 生产代码本轮未再改动；新增布局回归固定 SVG 原始宽度、清理上游内联 `max-width`、内容 `min-w-fit` 与 figure 横向滚动约束。空 heading、重复/Unicode 标题、projection 顺序、异常 Mermaid、XSS、保存冲突与错误保留均复核既有实现及专项，未发现需要扩大修改范围的问题。
- Standards：diff 只使用现有 MDXEditor、Textarea、主题 token 和 utility class；聚焦扫描命中的两处 inline style 是既有评论浮层动态坐标/高度，不是本轮新增。无自定义颜色、渐变、`console.log`、新依赖或跨模块内部导入。
- Spec：Markdown 源码仍是版本与协作权威；`.md` 使用 CommonMark 兼容链，`.mdx` 保持严格语法；评论只支持 `.md`；保存、冲突和失败恢复继续复用既有 Drive text save flow。

### 第 4 轮实机证据与环境边界

- Electron Drive 停在“需要登录账号”，本地 Dashboard `127.0.0.1:3000` 同样重定向登录；未输入或迁移生产凭据。随后只用 Computer Use 的持久 `node_repl + @oai/sky` 操作已有登录态的 `synapse.d2.pub`，每次动作后重新读取应用状态。
- 新建无敏感目录 `Codex Round 4 Markdown Test 2026-08-26`，保留 `.md`、合法 `.mdx`、非法 `.mdx` 三份测试文档供验收。`.md` 完成正文、三级混合列表、任务项、比较表达式、空/重复/Unicode heading、Mermaid、表格和评论操作；`.mdx` 分别覆盖合法组件与严格错误。
- `.md` 先在阅读预览确认宽 Mermaid、正文、表格、列表、TOC，再切编辑。线上部署版暴露 `<=` 误报、列表缩进往返、空 heading 占位三项旧失败；源码模式编辑后显示“已同步”，刷新确认持久化。
- Computer Use 对代码编辑器执行批量 `type_text` 时丢失了部分中文和 Markdown 缩进，测试专用 `.md` 因而保留为可识别但部分畸形的 545 B 内容；未修改用户重要文档，也不把该次畸形保存解释为产品通过。
- 选中正文 `projection` 后创建评论 `Round 4 projection 定位测试`，刷新后评论与正文锚点仍在。合法 `.mdx` 在部署版进入编辑时复现缺 descriptor 的解析错误，非法 `.mdx` 复现严格错误状态。
- 窗口依次检查约 1325×768、1063×768、768×775；紧凑工具栏可用且没有页面级横向溢出。由于当前运行页面是未包含本轮本地修复的部署版、两个本地入口又受登录阻塞，所有“修复后实机”缺口均明确标为环境阻塞，并由真实组件/服务同层专项覆盖，未声称实机通过。

### 第 4 轮最终验证

- Dashboard Markdown/MDX/Mermaid/editor/preview/comment/TOC：12 文件、235/235。
- Server Drive 保存、Markdown renderer/projection、annotation 与 link intake：7 文件、255/255；Shared Drive 契约：1 文件、43/43。合计 20 文件、533/533。
- Dashboard production build（6,801 modules）、Server typecheck/build、Desktop typecheck、`check:hard-constraints`、`git diff --check` 均通过；构建只有既有大 chunk 警告。本轮未改变 IPC 或打包边界，不运行 IPC codegen / `check:packaged-asar`。

## 2026-08-26 阶段 23 第 3 轮 Git diff 工作台审查

- 基线为 `2cdd8a39370dd26d73b4fa77b9fce3c0add0630a`，起始工作树干净；固定代码比较范围 `db189074...HEAD`，本轮产品主题固定为 `7b474594f` 及其在 `5c2ac491` 中的 Git diff 直接后续变化。
- 权威 Spec 为 `docs/superpowers/specs/2026-06-17-git-module-design.md`，并结合 `docs/superpowers/plans/2026-07-31-git-reliability-remediation-review.md` 的竞态、截断、特殊路径、merge/root、二进制和主进程信任边界结论。
- 当前直接文件范围共 12 个 Git/发布文件，并追踪 `desktop/package.json` 与 `pnpm-lock.yaml` 的依赖变化；preload/bridge 在基准区间的变化仅属于 Agent 附件契约，不算 Git diff 生产变化。
- 已排除依赖残留候选：`5c2ac491` 已同时删除 `@git-diff-view/react` 源码、CSS、package 与 lockfile 条目；当前 `rg` 无任何引用，前两轮“已移除依赖”的验收记录正确。
- 确定缺陷 1：`useGitWorktreeStatus.loadDiff()` 把失败写入共享 `status.error`，但 `GitChangesTab` 主详情只判断 loading/diff/空状态；普通查看失败会被误呈现为“选择文件查看差异”，混淆错误与未选择。
- 确定缺陷 2：统一与分栏的代码列使用 `minmax(max-content,1fr)`；即使换行开关改为 `whitespace-pre-wrap break-words`，grid 最小轨道仍会被长行固有宽度撑开，不能实现真正的窄窗自动换行。
- 确定缺陷 3：工作区文件行使用 `role="button"` 的容器包住复选框，只手写 Enter 键行为；形成嵌套交互控件且 Space 键不能按原生按钮语义预览文件。
- 确定缺陷 4：历史文件选择只在 `useEffect([selectedCommit.hash])` 中把 index 重置为 0；Profiler 稳定记录到提交切换先提交旧索引文件、再回到首文件的两次 React commit，形成可见旧 diff 闪回。
- 确定缺陷 5：历史详情直接展开提交的全部文件且没有高度上限；真实 `dfcf00abf` 提交的 161 文件列表把 diff 推到长页下方，文件选择与差异阅读不能在同一视野内完成。

### 第 3 轮 Git diff 修改点矩阵（完成 15 项）

| # | 修改点 | 文件 / 提交 | 用户行为 | 自动化 | 实机 | 当前结论 |
|---:|---|---|---|---|---|---|
| 1 | 历史 rename patch 检测 | `git-history-service.ts`; `7b474594f` | 历史重命名按旧/新路径展示 | 410 项 Git 全专项 | `dfcf00abf` 显示 rename from/to | 通过 |
| 2 | 第三方 renderer 替换 | package、lock、viewer；`5c2ac491` | 主题一致的差异查看 | workbench + 静态扫描 | 跟随系统浅色、深色各查看一次 | 通过；源码/依赖均移除 |
| 3 | unified 行号与增删背景 | viewer；`5c2ac491` | 查看新旧行号/增删 | workbench | 当前工作区修改文件 | 通过 |
| 4 | split 左右行号配对 | viewer | 左旧右新、复杂增删块 | 新增不等长块/无换行覆盖 | 当前工作区分栏逐行查看 | 通过 |
| 5 | 行内差异 | viewer | 修改片段高亮 | workbench | changes tab 源码在浅/深色查看 | 通过 |
| 6 | 自动换行 | viewer/workbench | 窄窗长行换行 | shrinkable grid 红灯 | 1180→960 宽，长行真实折行 | 修复并通过 |
| 7 | 统一/分栏偏好跨 Tab | workbench | 工作区与历史共用设置 | workbench | 分栏+换行后切历史仍保持 | 通过 |
| 8 | 工作区文件列表与 diff | changes/hook | 多文件、选择、错误、键盘 | 错误态/原生按钮红灯 | 多文件切换；Tab/Space 预览与勾选 | 修复并通过 |
| 9 | 历史延迟加载与请求代次 | history hook/tab | 进入历史、提交切换 | hook 竞态覆盖 | 改动→历史，切 `7b474594f`/`f937c5e73` | 通过 |
| 10 | 历史多文件映射与选中项 | history/sections | 每文件对应 patch，无旧帧 | Profiler 旧帧红灯 | `7b474594f` 12 文件逐项与跨提交切换 | 修复并通过 |
| 11 | 解析失败 raw fallback | sections/`GitRawDiff` | 不安全映射显示原文 | section/workbench | 未伪造损坏的生产响应 | 自动化通过；实机不构造 |
| 12 | binary/empty/no-newline/truncated/大提交 | viewer/service | 明确区分状态 | viewer/service + 新无换行覆盖 | `dfcf00abf` 161 文件、PNG 不可预览 | 通过；空/截断由自动化覆盖 |
| 13 | 特殊字符/Unicode/pathspec/rename | service/sections | 文件名不串位 | parser/integration/pathspec | 中文路径可见；rename 旧/新名一致 | 通过 |
| 14 | 主题、滚动、窄宽、键盘焦点 | viewer/changes/history | 双主题与可达性 | 布局/原生按钮覆盖 | 滚动、宽窄、Tab/Space、主题恢复 | 通过 |
| 15 | 大提交文件列表高度 | history/workbench | 文件列表独立滚动，diff 不被推离 | 161 行列表红灯/绿灯 | `dfcf00abf` 首批→中段独立滚动 | 修复并通过 |

### 第 3 轮红绿灯记录

- 红灯：`git-workbench.test.tsx` 37 项中 34 通过、3 失败；失败精确命中自动换行轨道、读取错误误呈现为空状态、文件行嵌套交互且非原生按钮。
- 绿灯：最小修改 viewer grid、changes 主视图和 worktree hook 后，`git-workbench.test.tsx` 与 `use-git-worktree-status.test.tsx` 共 2 文件 40/40 通过。
- 修复范围：换行开启时使用可收缩 `minmax(0,1fr)`，关闭时保留横向滚动；读取失败显示 destructive Alert，并在新请求/成功响应时清除旧错误；复选框与原生预览按钮成为同级控件。
- 第二个红灯：Profiler 专项 38 项中 37 通过、1 失败，稳定记录到提交切换先提交旧索引文件 `docs/d.md`；以 `{ commitHash, index }` 键控选择后，history/worktree 三文件 43/43 通过，最终 workbench 39/39 通过。
- 第三个红灯：161 行历史文件列表专项 40 项中 39 通过、1 失败，稳定证明容器没有高度上限和纵向滚动；仅为该容器增加 `max-h-80` 与独立纵向滚动后 workbench 40/40 通过。

### 第 3 轮实机证据与双轴结论

- 当前工作区前置为 7 个真实修改；统一→分栏、换行关闭→开启后，行号、左右配对、增删和行内标记均可见，控制状态正确。
- 多文件从 `progress.md` 切到 viewer/hook 源码，标题和内容同步更新，没有旧请求覆盖；Tab 顺序为复选框→预览按钮，Space 可预览，也可切换勾选并恢复 7/7。
- 窗口从约 1180 px 收窄到 960 px，开启换行后长代码真实折行且详情未横向撑破；恢复宽窗后布局正常。
- 工作区切到历史后，点击 `7b474594f` 可见 12 个对应文件；新增 viewer 文件显示 `new file mode`，再切单一 Drive 提交显示其首文件，没有最终串位。
- `dfcf00abf` 的 161 文件提交完成真实滚动；重命名显示 `.claude/rules/website-copy.md` → `.claude/rules/document-copy.md`，删除文本显示旧侧行号，`website/public/icon.png` 显示“文件已变更。”而不误解析二进制。
- 长列表修复后再次打开 `dfcf00abf`：文件区先显示首批路径，向下滚动后显示中段路径，提交标题与下方 diff 同时保留在详情布局中，独立滚动通过。
- 初始主题为“跟随系统”浅色；切到深色后复查增删背景、文字和行号均可读，随后恢复“跟随系统”，设置保存提示可见。
- 只检查提交/推送/拉取/同步入口可见性，未执行任何会改远端或历史的动作；未启停开发服务。
- Standards：变更只用现有 shadcn/Radix 与主题 token；聚焦静态扫描无自定义色、字面颜色、内联样式、`console.log` 或第三方 diff 依赖，未新增依赖和跨模块耦合。
- Spec：主进程 `--find-renames` 与 status/file patch 对齐；path/pathspec、Unicode、rename、binary、truncation、权限/审计由 service/parser/integration 覆盖；hook 请求代次阻止旧异步响应，历史选择键控消除旧 diff 首帧。
- 最终 Git 全专项为 36 文件、410/410；新增不等长 split/无换行与大提交文件列表覆盖后 workbench 定向 40/40。Desktop typecheck、IPC codegen、hard constraints、renderer/electron production build 与 `git diff --check` 均通过。

## 2026-08-26 阶段 23 第 2 轮审查发现

- 基线为 `d779bee0d90c252a904e4d7eb076835795584060`，工作树干净；固定比较范围 `db189074...HEAD`。
- 附件主链已确认 Renderer send 只提交正文、`displayContent` 和有序 `{ attachmentId, order }`；主进程由 metadata 解析受控路径，Claude SDK 仅收到一次 `inputQueue.push` 主消息，没有 Base64 图片块、隐藏 query、Provider/模型附件分支。
- 确定缺陷 1（红绿灯完成）：`AgentComposer` 原先在组件生命周期内复用同一 draft scope，SDK live session 又累积该根授权；现已在每个提交批次立即轮换 scope，失败恢复原 scope，附件轮结束后关闭当前 live session 并按 SDK session id 恢复。
- 确定缺陷 2（红绿灯完成）：目录 v2 ref 原本携带真实 `sourcePath`，会经选择 IPC、草稿 title、history、timeline 和 export 暴露；现仅主进程 metadata 保存真实目录，Renderer/旧历史投影和导出只保留名称。
- 确定缺陷 3（红绿灯完成）：`AgentArtifactStore.retryOrphanCleanup` 原先拿当前项目会话集合清理全局 artifact 行，初始化其它项目服务会误删仍有会话归属的 committed 附件。50 图实机会话的元数据与受控文件被稳定误删，数据库仍保留会话，是直接现场证据；现先按 `projectId` 过滤再回收。修复后另发 1 图，切换其它项目再返回，历史缩略图与灯箱仍可用。
- 确定缺陷 4（红绿灯完成）：IPC 对选择路径逐项暂存，后项触发配额时会保留本次前项。现使用明确 quota error，配额失败会释放本次调用已经暂存的全部 id；普通坏路径仍保持逐项拒绝。
- 目录符号链接检查在选择和运行时各执行一次，并对最终文件使用 `O_NOFOLLOW`；仍存在目录验证完成到 SDK Read 之间无法持有目录句柄的外部替换窗口，这是路径授权模型的剩余平台风险，需要结合修复方案避免扩大授权面。
- Slash 路由审查暂未发现误匹配：只发布 `/compact`，旧 `/compress` 进入未知命令错误；MRU 只在 `chat.sendMessage` 返回成功且无 `result.error` 后更新，失败队列保留原消息。
- 本轮剩余风险有四项：macOS AX/sky 未能完成 Finder 拖放；目录在验证后到 SDK Read 前仍有外部替换窗口；当前项目没有知识库 Slash 候选；未实际执行付费 `/compact`。另因旧跨项目清理已删除首轮 50 图受控文件，修复后的跨项目历史恢复只用 1 图实证，不把旧 50 图历史宣称为通过。

### 第 2 轮附件与 Slash 修改点矩阵（26 项）

固定提交范围为 `a41ba9a8`、`5c2ac491`、`d779bee0` 与本轮未提交修复；下表覆盖该范围内全部附件/Slash 生产改动，测试文件不重复列入“代码”列。

| # | 修改点 | 代码 / 提交 | 用户行为 | 自动化 | 实机 | 结论 |
|---:|---|---|---|---|---|---|
| 1 | v2 引用、bridge 与 preload | `agent-attachment.ts`、`agent.ts`、`bridge.ts`、`preload.ts`；`5c2ac491` | Renderer 仅拿 metadata/id | type、preload、IPC schema | 选择 1/4/9/20/50 图 | 通过；目录 path 本轮移除 |
| 2 | 选择/拖放路径 IPC | `ipc-messages.ts`、`ipc-shared.ts`、`ipc-tools.ts`；两提交 | 有序返回、坏路径逐项拒绝 | IPC 59 项相关覆盖 | 文件/文件夹/选择/拖放 | 拖放受 AX 限制；其余通过 |
| 3 | 系统剪贴板图片 | `clipboard-attachment-service.ts`；`5c2ac491` | 粘贴图片进入暂存 | IPC/Composer | Finder 复制 9/20/50 图后粘贴 | 通过 |
| 4 | 魔数、MIME、尺寸与原子写 | `attachment-staging-service.ts`；`5c2ac491` | 伪造或空图不入草稿 | staging | PNG 数字素材；JPEG 未单独实机选择 | 自动化通过 |
| 5 | 50 图/字节/项目/全局配额 | 同上；`5c2ac491`、本轮 | 超限整批拒绝 | staging + 新 IPC quota 红灯 | 50 图完整添加 | 本轮修复部分提交 |
| 6 | 文件受控副本 | 同上 | 文件只授权自身副本 | staging/runtime | TXT 32 B 添加并清除 | 通过 |
| 7 | 文件夹精确授权与 symlink | 同上 | 只授权所选目录 | staging/runtime | 文件夹 picker | 安全校验通过；TOCTOU 留平台风险 |
| 8 | draft/commit/rollback/release | `attachment-staging-service.ts`、`agent-runtime-service.ts` | 失败可重试、取消可回滚 | staging/router | 草稿逐组清空 | 通过 |
| 9 | 每批 scope 与授权撤销 | `agent-composer.tsx`、`agent-conversation-workspace.tsx`、`conversation-router.ts`；本轮 | 后轮不能访问旧草稿根 | Composer/router 红绿灯 | 1 图修复后真实发送 | 本轮修复 |
| 10 | 跨项目孤儿回收 | `artifact-store.ts`、`index.ts`；`a41ba9a8`/本轮 | 切项目不丢历史图 | artifact-store 红绿灯 | Projects_Js↔Synapse 后仍可预览 | 本轮修复 |
| 11 | 路径型 runtime 清单 | `attachments.ts`、`types.ts`；`5c2ac491` | 原图由 Read 按需读 | attachments/session | 工具输入显示附件标签 | 通过 |
| 12 | 单主 query、Provider 中立 | `claude-sdk-session.ts`、`session-manager.ts`；`5c2ac491` | Kimi/Qwen/自定义同链 | provider 参数化/session | 百炼 qwen3.7-plus 两次 | 通过；无白名单/附件分支 |
| 13 | 发送路由与顺序 | `conversation-router.ts`；两提交 | 一次发送一次 query，保持 order | router | 50 图第 1 张读出 01 | 通过 |
| 14 | 会话创建/恢复生命周期 | `session-lifecycle.ts`、`session-repository.ts` | 新旧会话一致恢复 | repository/router | 切换历史会话 | 修复后新附件恢复通过 |
| 15 | history 附件 metadata | `attachments.ts`、`conversation-router.ts` | 正文与附件分离 | router/timeline | 正文无占位/路径 | 通过 |
| 16 | timeline/transcript 投影 | `agent-timeline.ts`、`agent-transcript.ts` | Read 路径显示稳定标签 | timeline/transcript | `Read {file_path:[Synapse attachment…]}` | 通过 |
| 17 | 导出与脱敏 | `conversation-export-service.ts`、`ipc-messages.ts` | ZIP 无 OS path/Base64/原图 | export/IPC | 导出 23 文件并全文检索 | 通过：原路径/Base64 0 文件 |
| 18 | Composer 添加/粘贴/删除 | `agent-composer.tsx`、`agent-composer-input-box.tsx`、`use-agent-attachment-actions.ts` | 文件/目录/图片可管理 | Composer | 各组添加后删除草稿 | 通过 |
| 19 | 乐观消息与失败队列 | `use-chat-connection.ts`、`use-agent-chat.ts` | 失败不吞消息/附件 | workspace/pending/chat | 未制造真实付费失败 | 自动化通过 |
| 20 | 附件条布局 | `agent-composer-attachment-strip.tsx`、`agent-composer-image-thumbnail.tsx` | 顶部/左右留白一致 | strip/Composer | 各数量草稿观察 | 通过 |
| 21 | 消息气泡与附件内容 | `agent-message-attachments.tsx`、`agent-message-bubble.tsx`、`agent-message-event.tsx`、`agent-message-toolbar.tsx` | 正文无自动清单，附件独立显示 | row/bubble/timeline | 50 图消息正文与附件分离 | 通过 |
| 22 | 九宫格与灯箱 | `agent-message-attachments.tsx`、`agent-tool-image-artifacts.tsx` | 最多 9 缩略图，可看全部 | row/timeline | `+41`、9/50、50/50 | 通过；原 50 图后来被红灯误删 |
| 23 | Slash 数据源与去重 | `command-registry.ts`、`skill-registry.ts`、`slash-menu.ts` | Synapse Skill/其它 Skill/KB/命令分组 | registry/slash | 当前项目显示三类；无 KB 候选 | 通过；KB 当前项目不适用 |
| 24 | `/compact` 与 `/compress` | `command-router.ts`、`command-registry.ts`、`conversation-router.ts` | 仅 `/compact` 可路由 | command/router | `/compact` 唯一，`/compress` 0 | 通过；未执行付费 compact |
| 25 | Slash 搜索、键盘、鼠标与关闭 | `agent-slash-menu.tsx`、`agent-composer.tsx` | 上下选择/确认/Escape/点击 | composer/slash menu | Down/Return、Escape、鼠标点击 | 通过 |
| 26 | 最近使用成功门禁 | `agent-conversation-workspace.tsx` | 成功后更新；失败保留队列 | workspace/MRU/pending | 未实际发送 Skill，配置未改 | 自动化通过；实机验证无副作用 |

## 2026-08-26 阶段 23 第 1 轮现场

- 起始时间 `2026-08-26 01:10:00 CST`；HEAD `5c2ac491b16f0507a3409731733e1a1c4c87f6c7`；当前分支 `main`，相对 `origin/main` ahead 6。
- 起始未提交文件只有 `task_plan.md`、`progress.md`、`findings.md`，均为主任务刚追加的阶段 23 编排记录；本轮不得覆盖或拆分为其它任务。
- 固定审查基准为用户指定的 `db1890741738f5d9a7e93ab8b940a0a0887f9832`，同时另行盘点 2026-08-25 00:00–23:59 CST 提交及当日形成、午夜后连续提交的直接变更。
- 审查方法保留 code-review 的 Standards / Spec 双轴，但因用户禁止子任务而在当前任务内串行完成。
- 真实 UI 证据必须通过 computer-use 技能的 `node_repl + @oai/sky`，每次动作后重新获取应用状态；不使用 AppleScript、System Events、浏览器自动化或 Playwright。
- 权威产品边界：实验 router 默认关闭，只在对话创建时固化；第三方端点才启用，Anthropic 官方端点保持原生，Provider 切换时按快照和端点重建并重新计算。
- 任何 discovery、其它 MCP 重建、显式 Synapse 权限规则、policy helper 或 server 工具策略无法无损保持时，必须整会话回退完整 MCP；回退提示至多一次，配置/header/env/secret/reason 不得进入 history 或导出。
- `invoke` 必须把真实 `mcp__synapse-mcp__<tool>` 名称、参数和 `toolUseId` 端到端投影回 Persona、子 Agent、权限、事件、history 与导出；底层继续经过 action router、PermissionGuard、AuditSink。
- 模型目录只允许用规范化 Base URL + 精确模型 ID/官方别名配置新 SDK 会话及 Tooltip 参考；显式 `CLAUDE_CODE_MAX_CONTEXT_TOKENS` 优先，未知端点/模型不注入，目录变化必须进入 session 复用键。
- 顶栏百分比与分母只能来自 SDK 实际 `contextWindowTokens`；`/compact` 后只接受当前 Query `getContextUsage()`，查询失败即清空旧快照。目录上限仅作为 Tooltip 参考，不得伪造运行窗口。
- 设置与顶栏 UI 必须复用 radix-nova/shadcn、主题 token、现有 Field/Progress/Tooltip 与 container query，不新增颜色、CSS、层级或解释性文案；宽窄窗口和键盘/Tooltip 可访问性均属于验收范围。

### 提交与基准盘点

- 2026-08-25 00:00–23:59 CST 共 5 个提交：`dd38e75625ce03243568d6c9e20cebc812c6adf9`（Drive 大目录回收站）、`876e2223c6a8c8c5555cc4b1a45670df9d83d9b7`（部署维护）、`7b474594f7ba2115d3403b6b47c48b2f467a489e`（Git diff）、`a41ba9a887118f0c51dd11dd7e10045862e2c12e`（Agent 附件与 Slash）、`f937c5e73b8a29c845fae73f539a44fd9d32dff4`（Drive Markdown/Mermaid）。
- 当日直接形成、午夜后连续提交的是 `5c2ac491b16f0507a3409731733e1a1c4c87f6c7`（2026-08-26 01:02:27 CST，Agent 附件链路、MCP router、模型目录与上下文能力）；本轮主范围均位于该提交，纳入当日连续变更。
- 用户指定基准 `db1890741738f5d9a7e93ab8b940a0a0887f9832` 与当前 HEAD 的 merge-base 相同；区间共 173 个文件、17,354 行新增、4,522 行删除。第 1 轮深入 Agent/MCP/模型/上下文及其 IPC、history、export、规则，Drive/Git 仅完成提交与边界盘点，留给后续轮次深入。

### 第 1 轮修改点矩阵（19 项）

| # | 修改点 | 代码 / 提交 | 用户可感知行为 | 自动化测试 | 实机用例 | 本轮状态 |
|---:|---|---|---|---|---|---|
| 1 | 实验开关默认值、非法值迁移、备份/IPC | config types/default/normalizer/backup；`5c2ac491` | 升级或缺字段时保持关闭 | config/backup/IPC 专项 | 设置初始关闭，结束恢复关闭 | 通过 |
| 2 | 设置“实验功能”分组与开关 | settings data/category；`5c2ac491` | 可保存开关，不增加解释层级 | settings data/category | 宽屏及主窗口最小宽度切换 | 通过 |
| 3 | 设置行响应式与右缘对齐 | SettingsGroup/SettingsFieldRow；`5c2ac491` | 开关、重置、服务器状态右缘一致 | settings layout | 账号/基础/实验三页宽窄观察 | 通过 |
| 4 | 新会话快照与旧会话兼容 | ConversationRouter/SessionRepository/runtime service；`5c2ac491` | 仅新会话采用创建时开关，旧会话不漂移 | router/repository/config | 关闭旧会话→开启→旧会话无路由、新会话进入路由/回退 | 通过；旧会话测试轮已取消 |
| 5 | 第三方 Provider scope 与 Anthropic 官方排除 | provider helpers/session manager；`5c2ac491` | 仅第三方兼容端点进入实验路由 | provider/session manager | 百炼 qwen3.7-plus 新会话 | 通过；官方端点只做自动化 |
| 6 | discovery、其它 MCP 严格重建与整会话回退 | synapse-tool-router-query；`5c2ac491` | 无法等价重建时恢复完整 MCP并提示一次 | router query | 项目会话安全回退；本地会话正常路由 | 通过 |
| 7 | 223 工具目录与中英文搜索排序 | synapse-tool-router；`5c2ac491` | 中英文通用文件列表优先正确工具 | router catalog/ranking | 中文请求搜索到自动化触发器工具 | 通过 |
| 8 | invoke 包络、取消、结果归一化 | synapse-tool-router；`5c2ac491` | 精确名称调用并保持原结果/取消语义 | router invocation | router search→真实只读工具→3 个类型 | 通过 |
| 9 | invoke MCP 风险注解 | synapse-tool-router；本轮修复 | 模型不再把可写统一入口误认为只读/封闭世界 | 新增注册元数据回归 | 真实只读调用冒烟 | 红灯命中并修复，实机通过 |
| 10 | Persona、permission mode、tool policy | ClaudeSDKSession/session manager；`5c2ac491` | 路由调用仍按原工具权限审批/拒绝 | session permission/persona | 当前“跳过权限确认”模式只读调用 | 自动化通过；未改用户权限模式 |
| 11 | 子 Agent、真实工具名、toolUseId、事件投影 | ClaudeSDKSession/history mapper；`5c2ac491` | 时间线/权限卡显示真实 Synapse 工具 | session/timeline/history | 恢复后显示真实 `app_automation_trigger_type_list` | 通过；子 Agent 只做自动化 |
| 12 | 回退提示及内部原因脱敏 | ClaudeSDKSession/events/history/export；本轮修复 | 只显示通用回退状态，内部原因不进入持久事件/导出 | 新增 fallback payload 回归 | 项目会话回退 + 调试包全文检索 | 红灯命中并修复，实机/导出通过 |
| 13 | 模型目录 schema、来源、更新门禁 | model-capability catalog/updater；`5c2ac491` | 打包快照可校验、异常下降拒绝 | catalog/check | Tooltip 显示 Alibaba Cloud 与 2026-08-25 | 通过；更新时戳语义列风险 |
| 14 | Base URL + 精确模型/别名匹配与未知降级 | model-capability catalog；`5c2ac491` | 仅已知精确端点/模型配置窗口 | catalog exact-match | 百炼 qwen3.7-plus 显示 1M | 通过；未知模型只做自动化 |
| 15 | 用户环境变量优先与 SDK session 复用键 | catalog/session manager；`5c2ac491` | 显式窗口不覆盖，派生配置变化重建 | catalog/session manager | 不读取/不改凭据与 env | 自动化通过，实机无侵入核验 |
| 16 | 主线程上下文聚合与子线程隔离 | context-usage/ClaudeSDKSession；`5c2ac491` | 顶栏实时显示主线程实际占用 | context/session | 历史 96.8K、新会话 39.7K、主/独立窗口 | 通过 |
| 17 | `/compact` 后权威刷新与失败清空 | context-usage/ClaudeSDKSession；`5c2ac491` | 压缩后不显示摘要 token 或旧值 | context/session | Slash 菜单出现 `/compact`，未触发计费压缩 | 自动化通过；实机仅菜单边界 |
| 18 | 上下文 IPC、history metadata、export 投影 | ipc-shared/timeline/export；`5c2ac491` | 恢复实际窗口与官方参考，不泄露内部字段 | IPC/history/timeline/export | 切换恢复 + 两份 ZIP 脱敏检索 | 通过 |
| 19 | 主/独立窗口宽窄顶栏与 Tooltip 可访问性 | AgentContextUsageIndicator/workspace；本轮修复 | 两种窗口响应式一致，键盘可打开详情 | 新增键盘焦点回归 + UI 专项 | 主窗口支持最小宽度、独立窗 700→430px、键盘 Tooltip | 红灯命中并修复，实机通过 |

### 首轮代码审查发现

- **缺陷：** `synapseToolRouterFallback` 把内部安全原因枚举写入通用 `sdkEvent.payload`；事件先于 history projection 持久化，违反设计中“reason 不进入 events/history/export”的边界。回归从期望空载荷稳定失败，修复后只保留一次通用事件；诊断原因仍由 router query 的结构化日志记录。
- **缺陷：** 统一 `invoke` 能调用可写、破坏性和外部世界工具，却声明 `readOnlyHint: true / destructiveHint: false / openWorldHint: false`。这不会绕过宿主 PermissionGuard，但会误导模型规划。按可调用能力上界改为 `false / true / true`，`search` 保持只读。
- **缺陷：** 顶栏 Tooltip trigger 是不可聚焦的普通 `span`，键盘用户无法触达模型上限和来源详情。新增焦点回归后补 `tabIndex=0` 与主题 token 焦点环。
- **缺陷：** SDK 会在连续 `thinking_delta` 之间插入 `system/thinking_tokens` 元数据事件，ConversationRouter 原先把任何非思考事件都当成过程边界，导致历史恢复后每个词组成为独立“思考过程”。实机复现后新增交错元数据回归，修复为仅忽略不改变内容边界的 `sdkEvent`；工具、文本和结果仍会刷新思考块。
- **无问题：** 新会话快照不在旧会话恢复时重读全局值；第三方 scope、Provider 变化重建、精确模型匹配、用户 env 优先、SDK 配置复用键、主/子线程上下文隔离、compact 失败清空、真实工具权限投影均未发现契约偏差。
- **待后续风险：** 更新脚本把 `GENERATED_AT` 固定为首版日期；`generatedAt` 语义与刷新命令可能不一致，但脚本并未逐一重新抓取直连来源，不能把全部 `verifiedAt/retrievedAt` 简单刷成当前时间。本轮不制造虚假核验，建议下一轮把“快照生成时间、实际抓取时间、人工核验时间”拆开设计并补命令级回归。

### 第 1 轮实机证据

- **设置宽屏：** 前置为主窗口正常宽度；依次进入账号、基础设置、实验功能；服务器状态、重置按钮、实验开关均贴右缘且无多余层级。结果通过。
- **设置窄屏：** 将主窗口拖至应用允许的最小宽度（代码下限 880px）；三处右侧动作仍对齐且无截断。结果通过。
- **默认关闭与快照：** 前置为开关关闭并已有百炼会话；开启后旧会话请求未获得 router 工具并取消，新建项目会话触发一次安全回退，新建本地会话实际执行 router search→invoke；结束时开关恢复关闭。快照边界通过，旧会话取消轮保留。
- **路由正常路径：** 新建本地会话，发送无敏感请求“列出自动化触发器类型”；过程调用 router search 后投影真实 `app_automation_trigger_type_list`，返回 `builtin.cron/interval/webhook`，上下文 39.7K/1M。结果通过。
- **路由回退路径：** 新建项目会话发送同一只读请求；UI 只显示通用回退提示，完整 MCP 调用成功。结构化日志内部原因为 `explicit-permission-rule`，没有出现在 UI。结果通过。
- **历史恢复：** 新会话首段连续思考夹有 20 个 `thinking_tokens` 元数据事件；切换到另一会话再返回后仍为一个完整思考块，工具边界后的思考另行分段。结果通过。
- **导出脱敏：** 通过 UI 分别导出正常 router 与回退会话，ZIP 全内容检索 `explicit-permission-rule`、fallbackReason 及常见 API key 字段均无命中。结果通过；测试包保留在 Downloads 供主任务复核。
- **上下文与 Tooltip：** 主窗口历史会话显示 96.8K/1M·10%，新会话显示 39.7K/1M·4%；键盘能打开已用/剩余、运行窗口/模型上限、最大输入/输出、官方来源与日期。结果通过。
- **独立窗口宽窄：** 700px 宽显示 96.8K/1M·10%；缩至约 430px 后收敛为“上下文 10%”，标题、操作和用量区无横向溢出；Shift+Tab 打开完整 Tooltip。结果通过，随后关闭独立窗口。
- **Slash：** 输入 `/` 后原生命令区出现 `/compact — Compact the current agent context`；未执行压缩，避免不必要模型调用。结果通过到菜单边界。
- 本轮共发起 4 次最小百炼调用：旧快照会话 1 次取消、项目回退会话 1 次成功、本地 router 会话 2 次成功；请求均只查询内置触发器类型，不含用户数据或凭据。

### 第 1 轮自动化与门禁

- 初始三缺陷红灯：3 个文件、93 项中 90 通过/3 失败；修复后 93/93 通过。
- 历史碎片红灯：ConversationRouter 定向 1 项稳定失败；修复后定向 1/1、整文件 70/70 通过。
- 最终组合专项：24 个文件、523/523 通过，覆盖配置、目录、Runtime、router、session、IPC、history/export、timeline、设置和顶栏 UI。
- `model-capabilities:check`：116 条通过；Desktop typecheck、IPC codegen、hard constraints、renderer production build、Electron/preload production build、`git diff --check` 全部通过。
- 测试期间出现既有的 Electron mock `app.getPath/getAppPath` 兼容日志，所有测试仍通过；renderer build 只有既有大 chunk 警告。本轮未修改打包结构，因此没有重做 macOS 安装包或 `check:packaged-asar`。

## 阶段 18：主流模型能力目录

- 阿里云帮助中心把完整正文放在 `window.__ICE_PAGE_PROPS__` 的结构化 JSON 中；更新器可稳定解析其中表格，无需依赖页面视觉抄录。当前公开文本生成能力表得到 93 个带上下文值的百炼模型 ID。
- 首版打包目录共 116 条：93 条百炼中国区文本生成记录，以及 Anthropic、Gemini、DeepSeek、Kimi Code、Moonshot、GLM、MiniMax、StepFun、MiMo 的 23 条官方直连记录。
- Provider scope 让同一模型在百炼和官方直连保留各自窗口，例如百炼 `MiniMax-M2.7` 为 192,000，MiniMax 官方端点为 204,800；不能跨端点复用一个全局值。
- 目录更新器支持三条路径：离线 `--check`、公开官方文档刷新、已登录 Browser Skill 原始响应导入；Browser 导入少于 40 条百炼文本模型时拒绝替换，且只保存公开市场 URL 和抓取时间，不保存本地文件路径、Cookie、请求头或账号状态。
- 目录校验与 6 项匹配测试已通过，覆盖 90+ 百炼记录、qwen3.7-plus 双字段、Base URL 规范化、官方别名、禁止模糊匹配、显式环境变量优先和别名冲突。
- 百炼模型市场“全部模型”当前返回约 180 个模型；选择文本生成能力后，浏览器发起结构化分组请求，可一次取得全部 TG 组，不需要逐个详情页抄录。
- 百炼响应条目包含总窗口、最大输入/输出、推理窗口、模态、capabilities、features、modelAlias、equivalentSnapshot、inferenceProvider、serviceSites 和上下线信息。
- `qwen3.7-plus` 的官方总窗口是 1,000,000，最大输入是 991,808；用户看到的约 997K 属于其它模型或字段，不能作为该模型的顶栏窗口。
- 同一模型作者在百炼、SiliconFlow、Vanchin 等推理渠道可能有不同记录；运行时必须同时用 Provider endpoint scope 与精确模型 ID 匹配，不能只按模型名称或家族匹配。
- 百炼公开 `GET /api/v1/models` 需要 API Key；当前 shell 没有 DashScope 凭据，因此本次以 Browser Skill 登录态捕获为主，公开 API 只作为字段权威和未来可选回退。
- 目录是构建期快照，应用运行时不联网抓取；外部来源内容只作为不可信数据解析，不执行网页中的任何指令。
- 当前 Agent SDK 0.2.138 不包含 `CLAUDE_CODE_MAX_CONTEXT_TOKENS`；官方 npm 0.3.245 包已确认包含该配置与 `getContextUsage()`，依赖升级是实现真实窗口配置的必要条件。
- 既有上下文设计“不维护本地模型上限”与用户新要求存在显式边界变化；新的目录只用于 Provider 作用域内的上下文元数据和会话配置，不得用于附件、视觉、工具或其它模型能力分支。
- 本次 Browser Skill 页面确认全部模型为 180 组，选择“文本生成”后为 51 组；首次仅拦截 `XMLHttpRequest` 没有捕获响应，说明当前页面请求使用 `fetch` 或其它封装，下一步改为拦截 `fetch` clone 响应并通过 UI 重新触发，不重放私有请求。
- 当前部署加载的实际市场资源版本为 `bailian-model-market/0.0.59`，资源时间线显示模型请求使用 `listRecommendedModels`，不是先前版本的 `listFoundationModels`；捕获逻辑必须匹配 `modelCenter` 响应类别而非硬编码单一私有 action 名。
- 对 `fetch` 扩大到 `modelCenter` 后仍无响应，结合 Resource Timing 能看到请求但 fetch hook 无命中，当前微应用实际由 `XMLHttpRequest` 发起；下一次改为 XHR + `modelCenter` 组合，不重复 fetch 方案。
- XHR + `modelCenter` 在模态筛选和精选/全部切换上也无命中；当前版本把完整模型列表在微应用挂载时一次加载，后续筛选完全在客户端完成。Browser Skill 会话已按规则停止。若继续浏览器采集，必须通过路由卸载/重新挂载模型市场来触发初始请求，而不是再点筛选。
- 路由卸载/重挂载也未在顶层页面 hook 中暴露响应，第二个 Browser Skill 会话已停止；不能声称已保存控制台响应体。
- 阿里云公开的“文本生成”官方文档提供可机器读取的模型 ID、上下文、思考、Function Calling、内置工具和结构化输出表；“文本生成模型列表”另列出当前模型市场的完整模型 ID 与详情链接。首版目录改用这两份官方公开资料作为百炼事实源，Browser capture 作为后续可选补充而非阻塞条件。
- 官方公开表确认当前代表值：Qwen3.7 Plus/Flash 1M、DeepSeek V4 Pro/Flash 1M、GLM-5.2 1M、Kimi K2.7 Code 256K、MiniMax M3 192K、MiMo v2.5 Pro 1M；旧版和第三方常用条目也有上下文表。
- 运行时链路最终确认：tier/Persona 模型解析完成后，用规范化 Base URL 与精确模型 ID/官方别名匹配；显式 Provider 环境变量不被覆盖，目录派生窗口参与 live session 复用键。
- SDK 实际窗口与目录官方上限保持双字段：顶栏只使用 `getContextUsage()` 的实际窗口，目录上限、最大输入/输出和核验日期只进入 Tooltip 与历史 metadata。
- SDK 0.3.245 随包 Claude Code 二进制版本为 2.1.245；正式 arm64 包内已确认存在当前平台二进制和完整 116 条目录 JSON。
- 真实百炼新会话最终返回 `93.3K / 1M · 9%`，证明 `qwen3.7-plus` 的 1,000,000 配置已被 SDK 接受；旧会话仍显示 200K 符合“配置只作用于新会话”的边界。

## 阶段 17：Synapse MCP 搜索排序优化

- 真实百炼日志确认 router 主链路生效，但 `list files drive` 的初始 Fuse 排序依次为站点启用、回收站列表、普通文件列表；目标工具虽然被模型正确选中，排序本身不符合通用意图优先原则。
- 根因是 Fuse 对整句做模糊匹配，缺少分词后的命中覆盖、规范 action 精确度和同一语义文本内的词距信号。
- 优化继续保留 Fuse 处理拼写容错和候选召回，在其上按 capability title、名称、action、描述、schema 和 domain alias 做词法重排；同等覆盖时优先规范 action 更短、更精确的通用工具，再比较词距、Fuse score 和名称。
- 中文自然表达额外把云盘、文件/文件夹、列表/列出/清单映射为规范索引词；这是本地领域检索词汇，不依赖 Provider 或模型白名单。
- 回归锁定 `list files drive` 与“查看云盘文件列表”均把 `app_drive_item_list` 排在第 1，同时保留精确名称、中文 domain、schema、稳定排序、空结果和 1–5 限制。

## 阶段 16：Synapse MCP 工具按需加载

- Claude Agent SDK 0.2.138 的 `disallowedTools`、运行时 MCP toggle 和同名 programmatic server 覆盖都不能可靠移除原 `synapse-mcp` schema。
- 已验证的可行链路是：无模型请求的 SDK discovery 读取有效 MCP 配置，排除 `synapse-mcp`，再以 `strictMcpConfig: true` 保留其它 MCP 并注入独立的 `synapse-tool-router`。
- 实验只适用于新对话固化开启且使用第三方 Anthropic-compatible 端点的场景；Anthropic 官方端点保持原生 Tool Search。
- 任何 discovery 配置无法安全重建、重复 server 名冲突或显式权限规则引用 `mcp__synapse-mcp__*` 时，必须回退完整 MCP，不能牺牲其它工具或权限语义换取 token 节省。
- `docs/agents/knowledge-base.md` 的“不得程序化注入 MCP”需要增加上述显式实验的窄例外；默认路径、知识库专用能力和公开 `/mcp` 均保持不变。
- 当前工作区包含附件、上下文统计、Git 和 Drive 的大量用户改动；阶段 16 只增量修改命中的设置、Agent Runtime、能力文档和测试，不覆盖既有工作。
- Settings 的通用数据模型支持 item 自定义 `getValue/createPatch`，Agent 开关可直接写入现有 `config.agent`，无需新增 IPC 或跨模块状态。
- Settings 主页面会自动渲染普通 `toggle` item；新增分类、data item 和现有 category/layout 测试即可，不需要新面板或样式。
- 新对话由 `ConversationRouter` 与 `SessionRepository` 创建并持久化 provider/agent/persona 快照；实验开关必须在这条主进程创建链固化，而不是由 Renderer send payload 决定。
- Provider 判定已有 `isThirdPartyAnthropicCompatibleBaseUrl()`：无 base URL 或 Anthropic 官方 host 不启用；其它/非法自定义 URL 视为第三方。该逻辑可直接复用并导出测试，不增加模型白名单。
- Claude SDK 当前类型确认 `Query.initializationResult()`、`mcpServerStatus()`、`resolveSettings()`、`createSdkMcpServer()`、`tool()` 和 `strictMcpConfig` 均存在；`McpServerStatus.config` 可返回 stdio/SSE/HTTP/sdk 描述，`claudeai-proxy` 不能作为 programmatic `mcpServers` 直接重建，必须回退。
- 有效权限规则位于 `resolveSettings().effective.permissions.allow/deny/ask`；只要任一规则引用 `mcp__synapse-mcp__` 就回退完整 MCP，避免泛化 invoke 改变语义。
- 最终实现中的 `strictMcpConfig` 不是直接开启：它只在 discovery 已取得所有有效 server 配置、逐项确认可安全重建并显式保留其它 MCP 后用于正式 query。早期“直接开启会隐藏其它 MCP”的结论仍成立，但不适用于这条先发现、后完整重建的受控路径。
- Provider 判定同时检查元数据与端点：`category: official` 无论代理 URL 如何都保持原生模式；无 base URL、Anthropic 官方 host 也不启用。其它非官方端点不维护模型名白名单。
- Router `invoke` 的 SDK 表面是 wrapper，但 canUseTool、Persona、子 Agent、permission card、toolUse/toolResult 和 history 全部恢复为规范 `mcp__synapse-mcp__<app_*>`；底层 action dispatcher 继续执行权限与审计。
- 公开能力注册没有变化：内部 `search/invoke` 不进入 capability catalog、`/mcp tools/list` 或 Claude Code 注册，225 capability / 223 MCP tool 数量保持不变。

## 需求

- Synapse Agent 对话需要稳定支持用户一次选择、粘贴或拖入最多 50 张图片。
- 同一能力还要正确处理普通文件和文件夹。
- 方案以稳定可用、功能正常和多 Provider 兼容为优先，不以改动最少为目标。
- 用户认为全量 Base64 方案不合理，需要结合 Claude Agent SDK、Codex 行为和当前代码重新设计。
- 用户已在后续消息中明确授权全自主逐阶段实施阶段 1–9，包括产品代码、测试和必要文档更新。

## 当前实现

- 当前 Composer 会把粘贴或拖入的图片 File 转成 ArrayBuffer 并保存在草稿中。
- 系统文件选择器会在主进程读取图片字节，再把 ArrayBuffer 返回 Renderer。
- 发送 IPC 再把完整图片字节传回主进程。
- Agent runtime 的 buildClaudeUserMessageContent 会把本轮每张图片转换成 Claude SDK Base64 image block。
- 当前限制为最多 8 张、单张 10 MiB、图片总量 20 MiB。
- 文件和文件夹不作为字节块发送，而是加入路径上下文并通过 additionalDirectories 授权。
- 对单个外部文件，当前实现会授权它的父目录，权限范围大于用户明确选择的文件。
- 当前 `AgentImageAttachment` 仍直接携带 `ArrayBuffer | Uint8Array`，`buildClaudeUserMessageContent` 对每张图片同步转 Base64；这是阶段 2–4 要替换的精确边界。
- 当前用户消息展示元数据版本为 1，图片依赖发送前持久化得到的 artifact，路径附件仍保存绝对路径。
- 当前 `directoriesForPathAttachments` 对外部单文件返回其父目录，确认阶段 6 的最小权限问题在现有实现中真实存在。
- 桌面端使用 `@anthropic-ai/claude-agent-sdk ^0.2.138`；阶段 5 必须以实际安装类型验证进程内 MCP 图片结果支持，不能仅依赖旧计划示例。

## 已完成任务的影响

- “增强聊天气泡图片显示”任务已经完成，并通过 250 项附件专项测试、desktop typecheck、hard constraints 和 diff 检查。
- 它已经实现用户图片持久化、结构化历史附件、1–8 图宫格、灯箱、失败回退、文件与文件夹打开、删除清理和孤儿重试。
- 历史中只保存图片 artifact 元数据和安全 URL，不保存 Base64 或原始字节。
- 这项修改是新方案的基础，不需要重新建设聊天气泡和持久化展示。
- 它没有修改 Claude SDK 模型输入方式，因此不解决 50 图的请求体、内存和 Provider 兼容问题。
- 现有 `AgentArtifactStore` 已提供受控根目录、SHA-256、DataRepository 元数据、会话删除与孤儿会话清理，可直接演进为暂存服务，避免另建并行存储。
- 现有 artifact 写入使用 `writeFile` 直接落最终路径，schema 为 v1 且强制 conversation/turn；尚无 draft scope、staged/committed 状态、原子 rename、缩略图/预览衍生物或配额。
- `agent.artifacts` 已有 conversation/turn SQLite 索引，升级 v2 时应保留 v1 验证兼容，并新增 draft/status/过期查询所需索引。

## 为什么不能直接提高到 50 张

- 原始字节在 File、ArrayBuffer、IPC 序列化、主进程对象和 Base64 字符串之间可能同时存在。
- Base64 通常会比原始二进制增加约三分之一体积，还会产生额外字符串内存。
- 50 张图片会把 Renderer 和主进程内存峰值、IPC 拷贝和模型请求体同时放大。
- Anthropic 官方、百炼兼容端点和自定义兼容端点的图片数量与请求体限制并不一致。
- 单纯依赖发送失败后重试，会出现 0 秒失败、草稿丢失或不确定请求是否已被接收的问题。

## Base64 的正确边界

- Base64 不是错误格式；对于本地图片直接进入 Claude 消息，它仍是通用且合法的最终传输格式。
- 错误的是让 Base64 或完整图片字节贯穿 UI、IPC、历史和大批量单次请求。
- 正确做法是选择时受控落盘，内部只流转附件引用，只在最终 SDK 组包时为小批量或单个工具结果临时编码。
- URL 和 Provider Files API 可以作为未来的可选策略，但不适合作为多 Provider 基础架构。

## Claude Agent SDK 相关能力

- SDK 支持在用户消息内容中传入 Base64 image blocks。
- SDK 支持 additionalDirectories，使 Claude 内置 Read、Glob 和 Grep 可以访问额外路径。
- SDK 支持 createSdkMcpServer 和进程内工具，MCP 工具结果可以返回图片内容。
- 因此可以建立只读、会话绑定的附件服务，让模型按 attachmentId 分批取图。
- 需要用当前安装版本的类型与集成测试再次确认图片型工具结果在各 Provider 下的真实兼容性。
- 已核对本地 `@anthropic-ai/claude-agent-sdk` 类型：`createSdkMcpServer({ name, version, tools, alwaysLoad })` 返回带进程内 `McpServer` 实例的 `McpSdkServerConfigWithInstance`，可直接放入 SDK `mcpServers`；工具 handler 返回 MCP content block，因此实现进程内只读附件工具在 SDK 契约上可行。
- SDK 类型只证明本地 Anthropic Agent SDK 可以承载 MCP 图片 content；不证明所有自定义/百炼兼容端点都接受图片型 tool result，能力画像仍需保守区分。

## 当前 IPC 精确边界

- 主进程选择器 `attachmentCandidatesFromPaths` 读取图片完整文件并把 `ArrayBuffer` 返回 Renderer；发送 schema 又接收完整字节，构成明确的双向 IPC 字节链路。
- 现有限制定义在 `desktop/electron/modules/agent/ipc-messages.ts`：8 张、单张 10 MiB、合计 20 MiB；Renderer 草稿 `AgentDraftImageAttachment` 也直接保存 `bytes: ArrayBuffer`。
- 路径选择会递归扫描文件夹并拒绝其中任一符号链接；这会让大目录选择成本与目录规模绑定，阶段 6 应改为只验证精确根目录与读取时边界，而不是预扫描整个树。
- Agent IPC 的实际回归测试文件是 `desktop/electron/modules/agent/__tests__/ipc.test.ts`，不是旧计划中的 `ipc-messages.test.ts`。

## 推荐架构

### 1. 受控暂存

- 选择、粘贴和拖拽统一进入主进程 AttachmentStagingService。
- 主进程流式读取、校验、原子写入，并生成 SHA-256、缩略图和模型预览图。
- Renderer 只拿 AttachmentRef 和受控预览 URL。
- 原始图片不进入会话历史、日志、导出或配置备份。

### 2. 生命周期

- staged：属于草稿，可移除、可超时清理。
- committed：消息成功入队和历史提交后归属于 conversation/turn。
- orphaned：提交中断或删除失败，进入可重试清理。
- 应用启动时进行有界恢复，不阻塞主窗口。

### 3. 自适应派发

- 小批量：根据 Provider 安全预算直接 inline。
- 大批量：发送编号总览图与 manifest，模型通过 attachment_read 分批获取预览或原图。
- 不支持视觉或工具图片结果：在发送前降级或拒绝，保留草稿。
- Base64 只在最终组包或单次工具结果中短暂出现。

### 4. 总览图

- 使用 Electron nativeImage 或已有能力在本地生成一个或多个编号总览图。
- 总览图只用于定位和全局理解，不能替代原图细节分析。
- 每张原图都有稳定编号，manifest、总览图和 attachmentId 一一对应。
- 用户要求检查全部时，系统提示 Agent 必须按批次读取全部编号。

### 5. 内部附件工具

- attachment_list 只返回当前用户轮次的可信 manifest。
- attachment_read 只接收 attachmentId、detail 和有界 ID 列表。
- 工具不接受任意本地路径。
- 每次调用限制图片数、像素、解码后字节和响应体。
- 会话、conversation、turn、MIME、哈希和所有权全部由主进程校验。

### 6. 文件与文件夹

- 单文件复制到受控存储后再让 Agent 读取，避免授权原父目录。
- 明确选择的文件夹继续走精确 additionalDirectories。
- 文件夹不递归复制，避免大目录磁盘和耗时风险。
- 普通文件优先交给 Claude Read 等工具，不统一转 Base64。

## Provider 能力画像

建议字段：

- vision
- inlineImage
- imageToolResult
- urlImage
- providerFileId
- maxInlineImages
- maxInlineImageBytes
- maxRequestBytes
- preferredBatchImages
- preferredPreviewPixels
- verifiedAt
- source

未知或自定义 Provider 使用允许图片内联的保守预算，不按模型名称设置白名单。能力画像仍区分“文档声明”“保守默认”和“用户手动覆盖”。

## 配额建议

- 产品数量上限：50 张。
- 初始单张上限：沿用现有 10 MiB。
- 单轮暂存总量必须允许 50 张达到单张上限，即至少 500 MiB 级别，但实现必须流式处理，不能一次载入内存。
- 单次模型读取批次远小于单轮存储配额，具体值由 Provider 契约和压测确定。
- 还需要会话级和全局磁盘配额、LRU 或过期清理以及清晰的用户错误。
- 数量上限与字节上限同时生效；“支持 50 张”不代表支持任意尺寸或 RAW 格式。

## 安全结论

- 用户明确附加某个文件，等价于授权读取该附件本身，不等价于授权其父目录。
- 内部附件读取是消息输入基础设施，不应成为任意文件系统工具。
- 内部 artifact 路径不进入模型提示、日志、历史或导出。
- 必须防御路径穿越、符号链接逃逸、TOCTOU、伪造 MIME、跨会话 attachmentId 和已删除附件复用。
- 外部读取、受控写入、删除和工具访问均需经过 PermissionGuard 与 AuditSink。

## 失败与重试

- 预检失败：不入队、不创建模型轮次、保留草稿。
- 暂存失败：只标记失败附件，允许移除或重新选择。
- Provider 明确拒绝且可确认未接收：允许重新规划一次。
- Provider 状态不确定：禁止自动重发，避免重复用户轮次。
- 工具读取失败：返回结构化错误和失败 ID，不把路径或二进制写入日志。

## 代码范围

- Renderer：Agent composer、连接 hook、消息附件和类型。
- IPC：Agent message schema、shared contract、tools 与 preload bridge。
- Runtime：artifact store、attachments、conversation router、Claude SDK session、session manager。
- Provider：preset、store、schema、能力画像和错误归一化。
- Persistence：Agent artifact schema v2、迁移、引用和清理。
- Docs：附件设计、runtime security、knowledge base、Agent 指南、必要的 capability 说明和发布说明。

## 当前工作区注意事项

- 2026-08-25 恢复时 `git status --short` 仅显示三份规划文件有修改；先前记录的产品代码改动当前已不在未提交工作树中。
- 后续实现仍以当前已落入仓库的附件能力为基线，逐阶段做聚焦 diff。
- 不得覆盖或回退用户及其它 Codex 任务的现有修改。
- 当前规划文件已按用户要求重置，旧规划历史不再保留在这三份活动文件中。

## 阶段 1 规则发现

- 当前附件设计的 Hard Rules 明确要求所有图片直接成为 SDK `image` block；这与 50 图有界请求目标冲突，必须先修订设计文档再改变实现。
- Renderer 必须只通过类型化 preload bridge 访问暂存能力；主进程 handler 只校验和调度，文件系统、原子写入、权限与审计下沉到 service。
- 用户可感知附件行为必须同步更新 `RELEASE_NOTES_PENDING.md`；新增运行时工具若进入能力注册面，还需同步 capability registry、系统 Skill 和 Agent 指南。
- UI 改动继续使用现有 shadcn/Radix 组件、主题 token 和布局 utility，不新增颜色、样式层或解释性文案。
- 验证采用专项 Vitest、desktop typecheck、hard constraints 和 diff check，不启动应用或开发服务器。

## 待验证问题

- 百炼当前所选 Kimi 模型对图片数量、单图大小、总请求体和图片型 tool result 的官方限制。
- 自定义 Anthropic-compatible 端点能否可靠处理 MCP 图片工具结果。
- Electron nativeImage 对项目需要支持的 HEIC、GIF 和超大图片的解码行为。
- 50 张典型手机照片暂存、生成缩略图和恢复历史时的实际内存峰值。
- 内部 MCP 工具是否需要在现有 Persona 工具策略中单独声明基础设施豁免。

## 2026-08-25 官方限制核实

- Anthropic 官方 Vision 文档当前声明：API 每个请求在 200k context 模型上最多 100 张、其他模型最多 600 张；单图最大 8000×8000，超过 20 个图片/文档 block 时应用更严格的单图尺寸限制，跨平台安全做法是边长不超过 2000 px。
- Anthropic 直连 API 的 Base64 编码后单图上限为 10 MB，Messages API 请求体上限为 32 MB；因此产品“单张原始文件 10 MiB”和“50 张均直接内联”不能同时成立，必须区分存储配额与派发预算。
- Anthropic 官方支持 JPEG、PNG、GIF、WebP，GIF 只使用首帧；支持 Base64、URL 和 Files API `file_id` 三种图像来源，但伙伴平台能力可能更窄。
- 阿里云百炼官方 `kimi-k2.5` 页面明确它是原生多模态，输入支持 Text/Image/Video；搜索摘要未给出图片数量、单图字节、Anthropic-compatible 图片工具结果等边界，未声明项必须使用保守能力画像和假端点契约测试，不能沿用 Anthropic 数值。
- 官方来源：`https://platform.claude.com/docs/en/build-with-claude/vision`、`https://platform.claude.com/docs/en/api/errors`、`https://help.aliyun.com/zh/model-studio/kimi-k2-5`。

## 阶段 1 合成内存基线

- 使用 Node 进程模拟每张 1 MiB 图片在 Renderer Uint8Array、IPC 主进程副本和最终 Base64 请求三层同时存在；该测量用于比较链路放大，不代表 Electron GUI 的绝对 RSS。
- 1 张：外部内存约从 1.3 MiB 增至 4.6 MiB，请求 Base64 约 1.33 MiB。
- 8 张：外部内存约从 1.5 MiB 增至 28.2 MiB，请求 Base64 约 10.67 MiB。
- 20 张：外部内存约从 1.5 MiB 增至 68.2 MiB，请求 Base64 约 26.67 MiB，已接近 Anthropic 32 MB 请求上限且尚未计算 JSON/文本开销。
- 50 张：外部内存约从 1.5 MiB 增至 168.2 MiB，请求 Base64 约 66.67 MiB，必然超过 Anthropic 32 MB 请求上限。
- 结论：引用化能移除前两层长期副本，大批量仍必须使用有界 overview/tool 分批读取，不能仅把 Base64 延迟到发送瞬间。

## 安全接入发现

- `PermissionGuard.check` 与 `AuditSink.record` 已是仓库统一边界；附件暂存、受控复制、删除和读取应复用现有 actor/action/resource 结构，审计 metadata 只记录计数、字节、状态和 attachmentId，不记录原始路径或正文。
- 受控 `userData` 内写入使用现有 `fs.write`；读取外部用户选择源文件使用 `fs.read.outside-userdata`。拒绝时先写 denied 审计，成功/失败分别记录 allowed/failed。
- DataRepository 的 namespace 泛型不做运行时事务；staged → committed 需要通过单条 metadata `upsert` 变更实现原子状态切换，文件在同一受控根目录中保持稳定身份，避免多文件搬移事务。
- 现有 migration 框架按 namespace envelope 版本迁移；`agent.artifacts` 当前每条记录已有 `schemaVersion`，升级时需要同时保证旧 v1 行可读取和新 v2 行验证，不能只改常量而让已有行失效。

## 阶段 2 实施发现

- 新暂存服务通过串行 mutation lock 避免并发暂存绕过计数/字节配额；50 张 1 个小 PNG 的测试可稳定通过。
- 每个受控文件写入临时文件、fsync 后 rename；图片原件、模型预览和 UI 缩略图使用独立路径，默认衍生器保留原字节，后续可从主进程注入 Electron `nativeImage` 缩放而不改变契约。
- 多附件 commit 先验证全部引用的 project/draft/lifecycle，再逐行 upsert；中途失败会补偿回滚已更新行。DataRepository 当前没有公开事务接口，这是现有边界内最强一致性方案。
- 单文件 `stagePaths` 使用流式复制到受控目录；文件夹只记录用户明确选择的精确真实路径，不递归扫描也不扩大到父目录。
- `AgentRuntimeService` 是项目级长生命周期对象，适合作为 staging service 的所有者并向 UI IPC 暴露窄方法；这样同一项目的选择、粘贴、发送和清理共享并发锁与配额视图。
- 当前 ConversationRouter 在 turnId 创建后才持久化用户图片；引用化后应在同一位置把 staged 元数据 commit 到 conversation/turn，并直接复用受控预览 URL，不再复制一份 user-message artifact。
- SQLite namespace 构造只更新 meta schema version，不会自动逐行重写 JSON；`agent.artifacts` v2 validator 必须同时接受 v1 与 v2 行，迁移声明保持兼容而不能假定已有行已改写。

## 阶段 3 接入点

- Agent UI IPC descriptor 直接来自 `ipc-messages.ts` 的 `messageMethods`，新增 UI-only operation 后由现有 definitions registry 生成 channel；preload 必须同步提供窄 bridge 方法。
- 现有 IPC 测试明确断言文件选择返回图片 `ArrayBuffer`，阶段 3 需要把这些测试翻转为返回 staged reference，并给请求增加 `projectId + draftScopeId`。
- `AgentRuntimeService` 已是项目容器解析出的对象，IPC 可调用其 staging wrapper；不应在每个 IPC handler 临时 new 服务，否则会绕过项目级 mutation lock。
- Composer 现有单测和附件 strip 依赖 `URL.createObjectURL(bytes)`；引用化后应直接使用受控 `thumbnailUrl/previewUrl`，并删除 Renderer 对 Blob URL 的生命周期管理。
- 当前 Composer 草稿仍保存 `ArrayBuffer`，发送时再次转换成 bridge `data`；文件选择器也在主进程先读取图片再回传字节。这两段都必须改为项目级暂存服务只返回 ref。
- 新发送契约只携带 `draftScopeId` 和有序 `attachmentId`；主进程在生成 turnId 后 commit，并只在最终 provider 边界读取受控文件。旧字节结构仅保留在 runtime/旧历史兼容层。
- `AgentComposer` 当前没有 `projectId` / draft scope 入参，附件选择与拖放也只调用无项目上下文的 bridge；阶段 3 必须由上层会话把当前项目和稳定的 composer draft scope 传入，不能在 picker 内猜测默认项目。
- `useChatConnection` 还维护 optimistic Blob URL map 和全局 revoke 生命周期；ref 草稿可直接复用受控 `previewUrl`，删除该内存与清理分支后，optimistic timeline 仍能立即显示缩略图。
- 旧 IPC 除图片字节外还在发送时递归扫描文件夹并重新 `lstat` 路径；引用化后这些校验应只发生在 staging service，发送 handler 不再接受 Renderer 提供的路径或执行第二次目录扩张扫描。
- ConversationRouter 有两个 turnId 生成/用户历史入口（常规队列与生命周期流），都调用同一个 `prepareUserMessageHistory`；commit/ref 历史逻辑必须落在共享入口或共享预处理方法，避免只修一条发送路径。
- 粘贴板图片若从 DOM `File.arrayBuffer()` 送 IPC，仍违反阶段 3 的退出条件；应让 Renderer 只发“暂存当前剪贴板图片”命令，由主进程 `clipboard.readImage()` 读取并调用同一 staging service。拖放/文件选择则只传 Electron 提供的绝对路径。
- `prepareUserMessageHistory` 目前会把 runtime image 再物化为一份 v1 artifact；v2 committed refs 应直接生成现有气泡 metadata，避免受控附件重复复制，同时保留 v1 `attachments` 分支供旧调用者使用。
- `AgentRuntimeService` 已暴露 stage/commit/release wrapper，且构造 ConversationRouter 时能直接追加同一 staging service 依赖；无需让 IPC 或 router 再访问 DataRepository 内部 namespace。
- 受控预览 URL 已由 `agentArtifactUrlForRelativePath` 生成并沿用现有 `synapse-agent-artifact://` 协议，因此 Renderer 可直接展示 ref URL，不需要新增协议、file URL 或数据 URL。
- staging commit 的现有所有权校验要求 draftScopeId；发送 IPC 可以只传 ID/order，由主进程先按 project+ID 解析可信 staged metadata，并从记录中恢复唯一 draftScopeId，再交给 router commit。
- 当前 staging service 已能读取 committed 受控文件字节，但只返回裸字节；阶段 3 可在 router 最终旧 SDK 边界临时组装 legacy runtime attachment，同时 ref 历史直接复用 v2 URL，下一阶段再把读取纳入 dispatch planner。
- Renderer 首次引用化 typecheck 只剩测试 fixture 与一个 hook 依赖数组残留，说明生产 Renderer 的 ArrayBuffer/Blob URL 主链已被类型系统切断；测试需同步断言 ref URL 和 ID/order payload。
- 文件 ref 不再暴露源路径，因此可读正文和乐观气泡只能显示文件名；文件实际受控副本路径仅在主进程临时 runtime attachment 中出现，满足阶段 6 的父目录隔离目标。
- IPC codegen 可由仓库现有 `pnpm --filter @synapse/desktop run generate:ipc` 生成新增 channel；无需手改 generated 文件。
- 剩余失败均是测试继续期待 `blob:` 和旧 `{kind,data}` payload，而非生产类型错误；新预期应直接检查受控缩略图/预览 URL 及 `{attachmentId, order}`。
- 完整 desktop typecheck 已在 Renderer/bridge 初步引用化后通过；下一步专项测试会暴露行为断言和主进程流程问题。
- `stagePaths` 当前把所有普通文件（包括图片路径）当作 file ref 复制，只有 `stageBytes(kind:image)` 生成 image ref/衍生图；文件选择与拖放图片必须在 staging service 内按扩展候选+魔数识别后走图片持久化，不能在 IPC 重新读字节。
- 图片路径识别应只把 JPEG/PNG/GIF/WebP 扩展作为“需要视觉校验”的候选，最终仍由魔数决定；扩展伪造必须拒绝而不是静默降级成普通文件。
- 阶段 3 首轮综合专项 120 tests 中 116 通过；staging 8 项和 conversation-router 65 项全绿，4 项失败均为旧 UI/发送断言，未发现新的 runtime 回归。
- Agent IPC 测试 harness 使用轻量 agent mock；引用化选择测试应在 mock 中提供 `stageAttachmentPaths`，发送附件测试应提供 `resolveStagedAttachments`，不需要在 IPC 测试里重建真实 staging 文件系统。
- IPC 专项 55 项中 41 已通过；14 项失败由旧测试仍向 send 提交 path/data 结构导致。新 IPC 的职责是拒绝这些 legacy payload，并把最多 50 个有序 ID 解析为主进程可信 refs；路径/MIME/配额细节已由 staging 专项覆盖。
- 更新 IPC 契约测试后阶段 3 六组专项已达 175/175；额外 Composer 全量回归暴露测试环境没有 projectId 且统一 bridge fixture 仍返回旧 candidate，生产组件的严格项目上下文不应因此放宽。
- Clipboard 主进程读取无法恢复 DOM File 原名；Renderer 可以随“暂存当前剪贴板图片”命令附带 name/size 作为纯显示提示，但主进程必须以 `clipboard.readImage()` 的实际 PNG 字节和魔数为准，不能信任提示 MIME/大小。
- Composer fixture 第一轮升级后已有 55/68 通过；剩余集中在旧 Blob URL、文件源路径 title、path-kind 断言以及少数测试未安装 bridge，均应更新为 ref 身份和最小路径暴露。
- Composer 全量 68/68 已通过；生产 Agent Renderer 搜索已无 ArrayBuffer、Uint8Array、File.arrayBuffer、Blob URL、data URL 或 Base64 附件链路（bridge.ts 的其它模块二进制接口不属于 Agent）。
- 常规 router 当前在 queue-limit 和本地 command 路由前 commit，会让被本地处理或因队列已满拒绝的附件变成无历史 committed 记录；commit 必须下移到命令确定需要模型且队列有容量之后。
- commit 已下移到本地 command 已处理且 queue 有容量之后；普通 legacy 空正文路径附件仍由 `withReadablePathAttachmentContent` 生成模型正文，prompt command 才覆盖 live content。相关 router 65/65 与完整 typecheck 通过。

## 阶段 4 实施发现

- Provider 实体已有 `settingsConfig` 扩展面，能力高级覆盖可存放在 `settingsConfig.attachmentCapabilities`，无需升级 provider schema 或新增 UI 字段；解析器仅接受完整 version 1 且所有预算为非负整数的结构。
- Anthropic 官方画像使用已核实的 10 MiB 单图、32 MiB 请求体和工具图片能力；初始内联上限主动收紧到 20 张，超过预算转 overview-and-tools。
- 用户选择的百炼或其它模型不再按名称白名单判断视觉能力；非 Anthropic 官方端点统一允许最多 8 图、20 MiB 的保守内联，图片型工具结果仍按未证实处理。
- 自定义端点默认允许保守内联；完整高级覆盖可显式关闭视觉或调整预算。Planner 返回冻结的 inline、overview-and-tools 或 reject 计划。
- 2026-08-25 按用户要求移除模型名白名单：能力解析类型不再接收 `model` 字段；Anthropic 官方以外统一使用 8 图、单图 10 MiB、请求 20 MiB 的保守内联画像，Provider 自行确认所选模型是否支持图片。
- 阶段 4 专项 68 tests 与完整 desktop typecheck 通过；未实现自动重试，因而天然满足“无法确认未接收时不重试”的去重约束。

## 阶段 5 接入发现

- Claude Agent SDK `Options` 原生支持 `mcpServers: Record<string, McpServerConfig>`，`createSdkMcpServer` 返回带实例的 in-process config，`tool` handler 可返回 MCP image content；无需端口或子进程。
- `ClaudeSDKSession` 当前在构造时冻结 query options，因此附件 MCP 必须在 SessionManager 创建/恢复 live session 时根据已预检的 message 注入；不能在 `send()` 后再修改 mcpServers。
- live session 可能跨 turn 复用，附件 MCP 又必须绑定单一 conversation/turn；SessionManager 需要用 attachment transport key 参与复用判断，使带不同附件或下一轮无附件时重建/关闭旧 server，避免工具继续暴露前一轮 manifest。
- overview-and-tools 计划不能继续 `materializeCommitted` 全部图片；初始 SDK message 只读取 overview IDs，剩余图片仅由 MCP `attachment_read` 在每批上限内读取。
- 上一轮被截断的路由补丁只落入了“commit 后仍物化全部附件”的中间态，尚未加入 overview ID 选择、turn 绑定和 runtime appendix；继续实现前必须先补齐这三个字段，避免阶段 5 以半成品进入测试。
- SessionManager 的 session state 已集中保存 provider/model/sdk settings/additional directories，适合新增单一 `attachmentTransportKey`；ClaudeSDKSession 的构造输入则可直接扩展 `mcpServers`，不需要改变通用 AgentLiveSession 接口。
- SessionManager 复用判定发生在 provider 环境、persona 与 SDK settings 全部解析之后；附件 transport key 应在同一区域提前解析并加入 `canReuseBaseSession`，重建分支也要把 key 变化写入结构化日志和 state reset。
- ClaudeSDKSession 的用户消息内容仅在 `send()` 通过 `buildClaudeUserMessageContent` 构造；阶段 5 的运行时指令可以只拼到这一次 SDK 输入，不进入持久化的 `message.content`，从而避免内部工具提示污染对话历史。
- Staging service 已具备 turn/project/conversation 四重所有权校验、批次数量和累计字节预算，MCP 层只需再用本轮 manifest 白名单约束 ID 并把结果转换成 image content；工具层不应重新接触存储路径。
- 本地 Claude Agent SDK 类型声明确认 `createSdkMcpServer` 与 `tool` 可直接导入，`Options.mcpServers` 接受 in-process config；实现应只扫描 `.d.ts`，避免对压缩后的浏览器 bundle 做宽泛搜索造成无效大输出。
- 路由概览策略已改为只物化 `overviewAttachmentIds` 与非图片附件；完整 committed refs、turnId 和内部读取指令仍随运行时消息传递，用户历史继续只保存原正文与引用元数据。
- 阶段 5 接线后的完整 desktop typecheck 已通过；附件工具测试可直接复用 staging 专项的内存 namespace，SessionManager 现有 FakeLiveSession/createSession input harness 可验证 transport key 导致跨轮重建。
- 阶段 5 的 168 项专项已全绿，覆盖 MCP 注入、运行时 appendix、跨 turn session 重建、plain turn 移除服务、manifest 无路径与批量/所有权拒绝。
- 生产 `AttachmentStagingService` 尚未注入 `createImageDerivatives`，默认 preview/thumbnail 仍复用原字节且缺尺寸；完成阶段 5/7 前必须用 Electron nativeImage 在主进程生成有界衍生图，并让工具像素预算基于可信尺寸生效。
- 衍生图可能改变编码格式（GIF/WebP 缩放后统一 PNG），因此 v2 元数据需要可选保存 preview MIME、preview SHA 与 preview 尺寸；旧 v2 行继续由可选字段兼容，工具对新记录执行像素和完整性校验。
- 阶段 5 最终 193 项专项与完整 desktop typecheck 全绿；初始请求仅包含最多 4 张编号预览，其余图片只通过 turn 绑定的进程内 MCP 分批读取，下一普通轮会销毁旧 manifest transport。

## 阶段 6 接入发现

- 单文件已经复制进每个 attachmentId 独占的受控目录，SessionManager 即使授权 `dirname(storagePath)` 也只能看到该附件的原件/衍生物，无法读取原文件相邻项。
- 文件夹当前只对最终路径执行 `lstat`，未检查祖先 symlink 或目录内部 symlink；旧 IPC 的 raw path 安全测试已因新 schema 只验证 legacy payload 被拒绝，必须把真实检查迁到 staging service 并新增对应测试。
- `directoriesForPathAttachments` 对 directory 使用精确选择路径，对 file 使用受控副本的独占父目录；无需改变 SDK additionalDirectories 算法。
- 新 ref 历史分支对单文件只保存显示名，不保存受控 storagePath；legacy `attachmentDiagnostics` 仅服务无 ref 的旧消息。文件夹路径仍是用户明确选择且 SDK 必需的精确授权对象。
- 目录在暂存后仍可能被替换或撤销权限，`materializeCommitted` 应在每次发送前重新执行路径/树安全检查；普通文件则从已提交的受控副本读取。

## 阶段 7 接入发现

- Impeccable 的 Synapse 产品 register 要求保持 Precision Workbench：固定紧凑字号、token-only、标准 Button/Dialog、无装饰动效或新增视觉层，和仓库 UI 硬规则一致。
- 当前消息附件组件会为全部 images 构建并渲染网格与 lightbox manifest；50 张虽用了 lazy `<img>`，仍会挂载 50 个按钮/图片节点。应把气泡网格限制为前 8 张，并用第 8 格的剩余数量作为打开完整灯箱入口。
- 预期的 `agent-attachment-strip.tsx` 文件不存在，需要用 `rg --files` 定位 Composer 实际附件条组件，不猜路径。
- 实际 Composer 组件为 `agent-composer-attachment-strip.tsx`；它横向渲染 ref 缩略图并已有 scroll controls，可在同一单层容器上方增加一行必要的“图片数 · 总大小”摘要，无需新卡片或样式文件。
- 共享 ImageLightbox 只挂载当前 active `<img>`，其余 49 张只是 URL manifest，已经满足灯箱按需解码；气泡只需把初始网格节点裁到 8 个并保留完整 lightbox manifest。
- Composer 已显示必要的图片数/附件数与总字节摘要，缩略图增加浏览器 lazy/async 解码；消息气泡只挂载前 8 个缩略图，第 8 格显示剩余数量，点击仍以 8/50 打开完整灯箱。
- 阶段 7 的 98 项 UI 专项与完整 desktop typecheck 通过；实现只复用既有 Button、Dialog、主题 token 和 utility class，没有新增颜色、CSS 文件、依赖或说明性废话。

## 阶段 8 接入发现

- AgentArtifactStore 与 AttachmentStagingService 共用 `agent.artifacts` namespace，现有 `removeConversationArtifacts` 已识别 schema v2、删除 attachmentId 独占目录再移除 metadata；会话删除无需再做第二套清理服务。
- Artifact cleanup 失败日志仍包含 `artifactId`，阶段 8 应改为 schemaVersion/kind 等无身份元数据，避免 committed attachmentId 进入诊断日志。
- 回退不应恢复 Renderer raw bytes IPC。安全做法是保留引用暂存链路，只把 dispatch 能力收紧为“最多 8 张直接内联、禁用工具图片”，同时支持 references 总开关与显式 legacy-inline 开关。
- Planner 是记录 count/bytes/strategy/error category 的最窄可观测点；结构化日志不需要 attachmentId、名称、路径或工具返回内容。
- ArtifactStore 现有删除测试主要覆盖 v1 user-message，需新增 committed v2 独占目录删除用例，并把失败日志断言翻转为“不包含 artifactId”。
- 功能开关测试可直接作用于纯函数：默认 references 开启；`SYNAPSE_AGENT_ATTACHMENT_REFERENCES=0` 或 `SYNAPSE_AGENT_ATTACHMENT_LEGACY_INLINE=1` 都把 Anthropic 9 图计划从 overview-and-tools 收紧为发送前 payload_too_large。
- Conversation export 的 artifact 依赖仍明确为 v1 tool/user image rows，v2 staging metadata 与受控附件文件不会进入导出复制；Agent Renderer 生产链搜索只剩主进程最终 SDK/MCP 边界的 Uint8Array/Base64，未重新引入 Renderer bytes。
- 阶段 8 首轮 87 项 lifecycle/flags/artifact/router 专项全绿。
- 阶段 8 完整 desktop typecheck 通过；默认 reference transport、两个安全回退开关、v1/v2 删除、启动后台清理、无附件身份日志和灰度/回滚文档均已落地。

## 阶段 9 审计发现

- 最终 diff 审计发现 overview 计划虽然只选前 4 张，但 Router 仍物化原图，且 planner 用原图大小估算后没有确保 overview 自身落在请求体预算内；4×10 MiB 会超过 Anthropic 32 MiB。必须把 previewByteSize 纳入 ref/metadata，overview 只物化受控 1568 预览，并按实际预览估算逐张截断或拒绝。
- 工作区变更均属于本 9 阶段附件任务及三份规划文件，未发现并行无关产品代码；`git diff --check` 当前通过，发布说明尚未增加本任务条目。
- overview 已改为物化 preview 变体，ref/schema 携带可选 previewByteSize；planner 逐张纳入 32 MiB 请求预算，10 MiB 旧预览最多选 2 张，新 1568 预览通常仍选 4 张。
- 阶段 9 已补 1/4/8/9/20/50 策略矩阵、51 图原子拒绝、JPEG/PNG/GIF/WebP 魔数、伪造 MIME、衍生解码失败回滚，以及 preview/original 物化差异测试。

## Drive MDXeditor 列表修复发现

- 用户测试条目 `2026_08_19_流程设计与开发规范讨论会.md` 的权威源码已正确保存无序列表 `*` 和有序列表 `1.`；问题不是保存或序列化丢失。
- Owner preview 的服务端 HTML 已正确生成 `ul`、`ol`、`li`；列表容器和每个列表项都保留 `data-drive-markdown-block-id`，评论投影与 block identity 未丢失。
- 截图中切换列表后仅行距变化，与 Tailwind preflight 清除浏览器默认 `ul/ol` marker 的表现一致；MDXeditor 的 `contentEditableClassName` 当前只有布局类，没有显式 `list-disc` / `list-decimal` 和层级缩进。
- 阅读态通过 `github-markdown-css` 恢复列表样式，但应增加本模块的显式回归契约，避免 CSS 导入顺序变化再次清除 marker。
- 修复应限制在编辑器/阅读正文的 `ul`、`ol` 选择器，不改 Markdown 源文本、MDX/CommonMark 插件、服务端 projection、annotation selectors 或评论定位算法。
- 最终实现仅向两个正文容器增加 Tailwind 内置 `list-disc`、`list-decimal` 和 `pl-6` utility；MDXEditor 的结构性 nested/task list item 仍可用自身 `list-style: none`，不会额外显示 marker。
- 生产构建产物已生成作用于正文后代 `ul/ol` 的 marker 与 padding 规则，Dashboard 构建和 Server typecheck 通过。
- 三层嵌套列表投影测试不仅验证 block id，还用 V2 semantic/position/quote selectors 实际解析最深层文本评论，结果保持 `attached` 与 `exact`。
- Dashboard 全量当前有 10 项既有失败：路由生成快照 1、字节格式化 1、旧页面文案 1、SSR 中访问 `document` 7；失败文件与新增列表样式/测试无交集，相关专项 115/115 通过。

## 本次新增问题

- 搜索 MDXEditor 安装样式时，zsh 对不存在的 glob 先行展开并报 `no matches found`；后续改用 `rg --files -uu` 定位依赖文件，不重复该 glob。

## 阶段 10 通用 Provider 重构发现

- 用户明确否定以 Anthropic 官方能力为主、百炼为降级的架构；Kimi、Qwen 等百炼模型必须走通用主路径。
- 通用主路径只能依赖图片作为 user message inline content；URL/File API、Anthropic 32 MiB/20 图预算和 MCP 图片 tool result 都不能作为基础假设。
- 受控暂存、引用 IPC、预览衍生物、生命周期、安全校验和 50 图 UI 与 Provider 无关，可保留；需要推翻的是派发契约、运行时组包与图片 MCP 会话逻辑。
- 当前 Claude Agent SDK 已使用 `AsyncIterable<SDKUserMessage>` streaming input，`ClaudeSDKSession` 内部有长期 `AsyncQueue`；SDK 类型同时暴露 `streamInput`/`send`，说明通用多批 user-message 输入无需图片型 MCP，但仍需核实一轮逻辑事件和最终回答的编排语义。
- 现有 Anthropic 耦合点集中在 `overview-and-tools` 计划、Router 只物化预览、SessionManager 的 attachmentTransportKey/MCP 注入和 AgentRuntime 的 turn-scoped server factory，删除范围明确。
- SDK `SDKUserMessage.shouldQuery=false` 会把消息合并进下一条查询，因此不能用它实现请求体分批；它仍可能把 50 图合并到同一 Provider 请求。
- `shouldQuery=true` 可触发多个模型轮次，但当前 `ClaudeSDKSession` 的统一事件泵会把每个中间 assistant 输出送入同一用户可见会话。通用方案需要隔离的批次分析调用，或显式抑制中间事件，不能简单向现有 input queue 连续塞批次。
- 本地 SDK 没有说明 `isSynthetic` 会抑制 assistant 事件，不能依赖未文档化行为。现有 AgentLiveSession 只有 send/nextEvent，主 SessionManager 又负责 Provider env、模型、settings、Persona 与权限组装；通用批次分析应复用这套 session factory 输入，但使用隔离的短生命周期会话收集 resultText，不污染主会话事件流。
- SessionManager 当前因为 attachment MCP transport key 在附件轮次间强制重建会话；移除图片 MCP 后该重建条件与 `mcpServers` 注入可删除，主会话可按 Provider/模型/settings 正常复用。
- 百炼官方文档确认其 Anthropic-compatible 端点可供 Claude Code 使用；Kimi K2.5/K2.6/K2.7/K3 支持文本与图片输入，Qwen 3.x 多个模型也可在 Claude Code 中直接粘贴/拖拽图片。百炼主路径的共同基础是 user message 图片输入，而不是图片型 tool result。
- 百炼官方没有给 Kimi、Qwen 提供统一的图片数量/请求字节上限；通用实现不能把 Anthropic 的 20 图、32 MiB 或 Files/URL 能力套用为 Provider 限制。批次上限应定义为 Synapse 自身的内存/稳定性预算，并允许 Provider 在模型不兼容时返回错误。
- 官方资料来源：`https://help.aliyun.com/zh/model-studio/kimi-api`、`https://help.aliyun.com/zh/model-studio/add-vision-skill`、`https://help.aliyun.com/zh/model-studio/more-tools`。
- Kimi 官方多图示例把多张图片作为同一 user message 的 `image_url` content；这与 Claude SDK 当前 `image` content block 的最小语义一致。Qwen 在 Claude Code 中也以粘贴/拖拽直接引用图片，证明 inline user input 是百炼兼容面的正确基础。
- 百炼还存在把图片列表编码为 video 的 Kimi 专有接口，但 Qwen/其他 Provider 不共享该协议，不能作为 Synapse 通用层。
- `ClaudeSDKSession.buildQueryOptions` 已集中生成 Provider env/model/cwd/abort 等 SDK 配置。通用批次分析可以从同一基础 options 派生隔离 query，但必须关闭 tools、plugins、MCP、hooks、resume、sessionStore 与项目 settings 副作用，只保留 Provider/model/网络和 abort。
- AgentLiveSession 的公开接口无需暴露批次细节；可在 ClaudeSDKSession 内完成“按批加载受控原图 → 独立单轮 query 得到 result → 汇总注入主会话”，主 Router 只传版本化计划和可信 loader。
- SDK 结果已由现有 bridge 统一从 `SDKResultMessage.result` 映射为 `AgentResultEvent.content`；隔离批次 query 可直接读取原始 result 字符串，不需要复用或污染主 event bridge。

## 资料

- Claude Agent SDK streaming input：https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
- Claude Agent SDK TypeScript：https://code.claude.com/docs/en/agent-sdk/typescript
- Claude Code tools reference：https://code.claude.com/docs/en/tools-reference
- Claude vision：https://platform.claude.com/docs/en/build-with-claude/vision
- 本地附件设计：docs/superpowers/specs/2026-08-25-agent-attachments-generic-provider-design.md
- 图片 artifact 计划：docs/superpowers/plans/2026-07-03-agent-image-artifacts.md

## 遇到的问题

| 问题 | 解决方案 |
|------|----------|
| 旧规划文件混入多个已结束任务 | 按用户要求重置三份活动规划文件，只保留本任务 |
| 当前任务尚未核实百炼最新限制 | 在阶段 1 使用官方资料与契约测试确认，不在计划中编造数值 |
| 阶段 3 findings 补丁锚点与现有标题不一致 | 搜索实际章节后，将发现追加到既有“阶段 3 接入点” |
| 搜索 SDK 工具导出时命中压缩 browser bundle，输出被截断 | 缩小到 `sdk.d.ts` 精确行范围，后续不再扫描编译产物 |
| 阶段 7 预期附件条文件名不存在 | 用 `rg --files desktop/src/modules/agent` 定位实际组件 |
| 阶段 8 导出搜索包含一个不存在的旧服务路径 | 以实际 `agent-runtime/conversation-export-service.ts` 为准，未改动导出边界 |
| 阶段 8 typecheck：legacy rollback 循环已窄化为 schema v1 后仍比较 v2 | 该日志直接使用 v1 `origin`，仅通用 conversation cleanup 分支判断 v2 kind |
| 阶段 9 专项 198 项中 1 项失败：解码回滚保留了空的 `staged/project/draft` 祖先目录 | 元数据和 attachmentId 文件目录已正确清除；测试改为断言 draft 目录为空，不要求删除共享祖先结构 |
| 阶段 5 首次 typecheck：`fs.read` 不属于现有 `PermissionAction` | 受控附件属于内容读取，复用现有 `content.read`，不为内部 userData 读取误用 outside-userdata 或擅自扩展权限枚举 |
| 阶段 5 首轮 168 项专项有 2 项失败：Buffer/Uint8Array 断言差异；plain turn 仍调用通用 MCP factory | 测试按字节数组比较；SessionManager 仅在存在 attachment transport key 时解析附件 MCP，确保下一普通轮构造时配置为空 |
| 注入 nativeImage 衍生器的补丁命中相邻 Provider factory | 立即移除误加参数并把 callback 精确放入 `new AttachmentStagingService` 配置，不改 Provider 边界 |
| 阶段 6 首轮 55 项专项有 2 项失败：macOS 临时目录路径经过系统级 `/var` symlink | 只豁免 macOS 固定根级别 `/var`、`/tmp`、`/etc` 别名；继续拒绝用户路径中的任意其它 symlink segment |
| 超大文件稀疏测试直接对不存在路径调用 `truncate` | 先创建空文件再扩展为稀疏文件，保持测试不实际写入 500 MiB |
| 阶段 6 typecheck 将 `Stats.size` 推断为 `number | bigint` | 在配额边界显式 `Number(sourceStat.size)`，项目未使用 bigint stat 选项且配额本身是 number |
| 阶段 9 全量测试调用输出超过当前上下文而未保留退出码 | 检查进程确认测试已结束；改用 Vitest `dot` reporter 重跑以保留明确结果，不把截断当作通过 |
| 阶段 9 全量测试 7971 项中 4 项失败：旧 IPC schema 测试仍发送 `Uint8Array`/`Buffer`/绝对路径 | 生产 schema 已只接受引用；将正向测试迁移为最小 `{ attachmentId, order }` 引用，把原始字节、跨 realm Buffer 和绝对路径收拢为负向测试 |
| 阶段 9 修复后全量测试 | 859 个测试文件、7971 项全部通过；引用正向契约与 raw bytes/raw path 负向契约均纳入全量验证 |
| 阶段 9 最终 typecheck 发现 3 个测试类型错误 | IPC schema parse 结果在测试中声明最小结构；materialize 测试通过局部 `toBytes` helper 将 `ArrayBuffer | Uint8Array` 统一后比较，不放宽生产 API |
| IPC 测试窄化补丁首次命中同文件更早的 `}).toMatchObject` | 立即移除误加断言，并用 `const parsed = ...` 邻接块作为唯一锚点重新应用 |
| 最终规划补丁未命中且发现 `task_plan.md` 被并发任务切换为 Drive MDXEditor 插入修复 | 不覆盖共享规划文件的当前阶段；只在附件阶段 9 自身区块记录已完成的自动化门禁，保留真实 Provider 人工验收状态 |
| 真实 Provider 验收边界复核 | 现有自动化已覆盖 Anthropic 与百炼能力契约和 SDK mock；真实端点需要本机 SecretStore 凭据并产生外部付费调用，不能把 mock 结果冒充人工验收 |
| 真实 Provider 凭据可用性 | 当前 shell 未配置 Anthropic/百炼环境变量；Provider 凭据由 DataRepository 的 secret namespace 以 `provider:<id>:api-key` 管理，不能从源码测试上下文无凭据调用真实端点 |
| 本机 DataRepository 定位 | 应用数据位于 `~/Library/Application Support/Synapse/data-v1/runtime.sqlite`；可只读检查 Provider/secret 记录是否存在，但不得在日志中输出 secret value |
| Provider/secret 后端实际分布 | `providers` 使用明文 JSON 元数据，`secrets` 使用 Electron safeStorage 加密的 `secrets.bin`；可以安全检查 provider 类型与 secretRef 是否存在，但真实密钥只能由 Electron 主进程解密 |
| 本机 Provider 元数据检查 | 存在两个带 secretRef 的 Provider，其中一个指向 `dashscope.aliyuncs.com`；另一个没有可识别的官方 Anthropic base URL。凭据存在性不等于可在非 Electron 测试进程中解密或完成真实双端验收 |
| Computer Use 只读检查 | 当前运行的是 `/Applications/Synapse.app` 的已打包 `app.asar`，不是本工作树未提交代码；用它做图片发送不能验收本次实现。仓库规则又禁止未经明确要求启动开发应用，因此不执行会产生费用但无效的真实发送 |
| 阶段 9 收口策略 | 将已证实完成的自动化、文档和 N/A 打包项勾选；真实 Anthropic/百炼人工验收保持未勾选，阶段状态继续 `in_progress`，避免虚报 9 阶段完成 |
| 最终静态泄漏/UI 审计 | 新增 diff 无 `console.log`、内联 style、自定义色或 data URL；Agent bridge 已移除 image `ArrayBuffer`，搜索残留的 bridge `ArrayBuffer` 仅属于既有 Drive 上传和通用 HTTP PUT |
| 最终工作树审计 | `git diff --check` 通过；检测到并发任务新增 `server/src/drive/drive-markdown-projection.spec.ts` 改动，未读取或修改其内容 |

---

每执行两次查看、浏览器或搜索操作后更新本文件。

## 2026-08-25：SDK/runtime 客户端自动压缩实施分析

- 当前安装的 `@anthropic-ai/claude-agent-sdk` 为 0.2.138，内置 Claude Code runtime 为 2.1.138。SDK `Settings` 已公开 `autoCompactEnabled?: boolean` 与 `autoCompactWindow?: number`，运行中 streaming query 还公开 `applyFlagSettings()`；因此不需要在 Synapse 另写摘要器。
- `ClaudeSDKSession.buildQueryOptions()` 已把 `sdkSettings` 展开到 `Options.settings`，并继续把 Provider `ANTHROPIC_*` 同时写入 `Options.env` 与 `Options.settings.env`。压缩摘要请求会沿当前百炼 base URL、凭据和模型映射发出，不应增加 Anthropic beta header 或 `context_management`。
- 当前缺口集中在两处：`ClaudeSDKRuntimeSettings` 只声明 `skipWebFetchPreflight`；`resolveProviderSdkSettings()` 与 `sdkSettingsEqual()` 也只处理该字段。第一版应增加 `autoCompactEnabled`，显式默认为 `true`；先不设置 `autoCompactWindow`，让 runtime 使用自身 auto window，避免按百炼模型名猜窗口。
- 如果以后开放自定义窗口，本地 0.2.138 设置 schema 只接受 100,000–1,000,000 的整数；应作为 Provider/会话显式配置传入，窗口变化必须进入 `sdkSettingsEqual()`。首版最稳妥的生效方式是关闭 live query 后以原 `sdkSessionId` resume，新配置作用于既有 transcript；不必立即扩展运行中热更新。
- runtime 还识别 `CLAUDE_CODE_AUTO_COMPACT_WINDOW`、`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` 与 `DISABLE_AUTO_COMPACT`；其中窗口环境变量明确高于 settings。由于 `buildQueryOptions()` 会继承 host env，产品必须明确权威来源：建议由 Synapse inline settings 决定正式行为，并在子进程环境中移除这些隐藏 override；若保留为高级逃生口，则要在诊断中仅报告“存在覆盖”并加入回归，不能出现 UI 显示已开启而 runtime 实际被环境变量关闭。
- SDK `Query` 没有独立 `compact()` 方法。用户手动压缩只能显式放行 runtime 原生 `/compact`，或以后提供调用该 native slash 的宿主操作；这不是自动压缩 MVP 的前置条件。
- 现有 `compact_boundary` 已通过 event bridge 暴露，`context-usage.ts` 已用 `post_tokens` 降低顶栏占用，最终 `result.metadata.contextUsage` 也会持久化。第一版无需新 IPC、无需把摘要写进 Synapse history，也不应记录 `PostCompact.compact_summary`，避免正文、路径与敏感信息进入日志或导出。
- 当前恢复依赖 `conversation.sdkSessionId -> Options.resume` 和 SDK 本地 JSONL transcript。单机常规恢复足够；但 SDK transcript 被清理、应用迁移或跨设备时，Synapse 的完整可见历史不能直接重建 runtime 的压缩状态。若产品要求 Synapse 自主管理耐久恢复，需要第二阶段实现完整 `SessionStore.append/load` 镜像；当前仅用于标题的 store 不具备该能力，且 SDK 将此接口标为 alpha。
- `PreCompact`/`PostCompact` hooks 与 `compact_boundary` 都存在。自动压缩 MVP 以 boundary 作为成功事实源即可；只有需要审计阻塞/失败时再加脱敏 hook，禁止持久化 `compact_summary`。开启插件 hooks 的知识库会话还需验证自定义 `PreCompact` 不会意外阻断压缩。
- 压缩是有损摘要，并会产生额外一次模型采样、token、延迟与费用；不能宣传成 Codex opaque compaction 的等价无损能力。精确依赖早期逐字内容的任务应允许用户新建会话、手动重述或关闭自动压缩。
- 自动化验收至少覆盖：新建/恢复会话设置透传、配置变化后同 session resume、boundary 的 auto trigger 与 pre/post token、结果快照持久化/恢复、摘要不进入 history/log/export、插件 hook 边界、压缩失败不自动重发用户轮次。
- 百炼真实验收分两档：先用原生 `/compact` 做低成本的摘要与 resume 闭环；发布前再做一次超过自动阈值的长上下文验收，证明 runtime 真正自动触发。不能只用伪造 `compact_boundary` 单测宣称端到端完成。
- 文档依据：Anthropic 官方说明客户端 compaction 会在阈值后注入摘要请求、以摘要替换活动历史并继续执行；百炼官方兼容面只承诺 `/v1/messages`，并明确 Claude Code 通过该端点工作。阿里云也直接建议第三方工具使用 `/compact` 减少历史上下文。

## 2026-08-25：`/compress` 报错诊断

- 截图错误由 Synapse 主进程固定文案产生，不是百炼或 Claude Agent SDK 返回。`AgentCommandRouter` 把 `/compress` 路由到 `ConversationRouter.compressSession()`，而该方法当前无条件调用 `finishWithError(..., AGENT_COMPRESSION_UNSUPPORTED_MESSAGE)`。
- Claude Agent SDK 0.2.138 的原生手动命令是 `/compact`，不是 `/compress`。普通项目当前没有把 `/compact` 加入 `agentNativeSlashAllowlist`，`allowAgentNativeSlash` 又只放行受管知识库命令，因此两个命令没有接通。
- 现有 `agent.compress_state`、`getCompressionState()`、`updateCompressionState()` 是未完成的宿主压缩脚手架：默认 `enabled: false`、`maxTokens: 60_000`，但没有实际执行器；`markCompressionState()` 也没有调用点。
- 截图出现两条相同错误是事件双发：`finishWithError()` 内部先 `emitEvent()`，随后 `enqueueTurn()` 收到命令结果后再次遍历 `commandResult.events` 并 `emitEvent()`。这不是 Provider 重试或两次压缩请求。
- 顶栏 `91.6K / 200K` 只是上下文观测结果，不代表手动压缩能力已经接通；自动压缩与 `/compress` 宿主命令也是两条独立路径。
## 2026-08-25：阶段 10 补充发现

- Claude Agent SDK 的成功结果事件包含最终 `result` 文本，可以用短生命周期、无工具、无会话恢复的独立查询收集每批图片摘要，再把摘要交给主会话完成用户任务。
- 现有 Anthropic 特化链路分散在 Provider 能力解析、`overview-and-tools` 规划、附件 MCP、会话按 turn 重建和运行时提示词中；通用化需要同时移除这些耦合，不能只删模型白名单。
- 为避免 50 张图片在 Router 中一次性解码，批次应只携带附件 ID；SDK 会话在处理每批前通过受信任的、带 project/conversation/turn 所有权校验的加载器按需物化原图。
- 当前 Provider 能力对象不仅保存“是否支持图片”，还编码了 Anthropic 的 20 张/32 MiB、工具图片结果和 URL/File API 等假设；这些字段及用户覆盖入口都应从派发契约删除。
- Router 当前仅为 `overview-and-tools` 物化预览图并注入附件 MCP 提示词；改成通用批次后，Router 可只给普通 inline 方案物化图片，批次方案仅提交引用并保留 turn 所有权信息。
- SessionManager 当前因附件 MCP 的 turn 级配置而比较 `attachmentTransportKey` 并重建主会话；通用批次加载器与会话无关，可删除这条重建条件，避免每个大图 turn 丢失连续会话。
- `AttachmentStagingService.materializeCommitted` 已按 project/conversation/turn/attachmentId 校验所有权并支持只加载指定原图，足以直接作为 SDK 批次加载器，不需要公开图片读取 MCP。
- 主会话的 SDK 事件由后台 pump 持续转发到 UI，不能直接拿主会话逐批发图而隐藏中间回答；独立 query 才能隔离批次分析事件并只保留最终结果。
- 测试已有可控 `QueryFactory`/`FakeQuery`，可以扩展为主 query 与批次 query 序列，验证批次输入、无工具配置、摘要注入和失败传播，而不连接真实 Provider。
- 通用 planner 已不再接收 Provider/model，v2 计划只区分 `inline` 与 `inline-batches`；4 张/16 MiB 是 Synapse 单进程内存批次预算，不能作为模型能力声明或发送前兼容性判定。
- SessionManager 的附件 transport 状态还有一处 close 清理残留；ClaudeSDKSession 的批次 query 还需补齐独立 options/prompt helper，并将关闭异常显式记录，才能通过硬约束与类型检查。
- 附件 MCP 是 `readToolImages` 和 `AttachmentToolImage` 的唯一消费者；删除 MCP 后可同步移除这组公开读取 API，批次加载只保留带 turn 所有权校验的 `materializeCommitted`。
- 现有 SessionManager 回归测试明确要求大图 turn 重建会话并注入 MCP；通用设计应反转该断言：不同图片 turn 和后续纯文本 turn都复用同一主会话，批次加载器仅在首次创建时注入。
- 附件契约单测仍固定 dispatch v1，需随 `inline-batches` 契约升级为 v2；安全与设计文档仍包含 Anthropic 官方画像、能力覆盖和 overview/MCP 描述，必须整体重写对应章节。
- 活跃设计文档的标题、目标、Hard Rules、派发步骤、SDK 构造、错误处理、回滚和测试仍以 Claude/Anthropic 专属能力为中心；仅局部改字会留下冲突，应将其改名为通用 Provider 设计并替换整个派发章节。
- 历史 implementation plan 文件没有被运行时或规则文档引用，可保留为历史记录；当前 `task_plan.md` 的阶段 4/5/8 和风险表则是活动计划，需明确标为已由阶段 10 取代或直接改写为最终通用决策。
- 进一步检查发现旧 implementation plan 不只是历史命名，还包含 Renderer 原始 `ArrayBuffer`、Claude 专属 chip 和旧 IPC 步骤，与当前安全边界冲突；应删除该可执行旧计划并以简短的通用 Provider 实施计划替代，防止后续 Agent 按错误步骤执行。
- `task_plan.md` 顶部目标、成功标准和目标架构仍是“Provider 能力预检/总览按需读取/8 图回退”，与已完成的阶段 10 冲突；这些总纲必须改成无能力判断的 inline/inline-batches，阶段 1 的研究项也只保留“最小共同输入面”结论。
- 代码搜索确认旧 Provider capability、overview、附件 MCP、工具读取 API、legacy flags 和会话 transport key 已全部清除；ClaudeSDKSession 之前为附件 MCP 新增的通用 `mcpServers` 构造参数也已移除，隔离批次只保留空 MCP 配置以阻止项目 MCP 加载。
- 最终实现用全局 `[Image #N]` 标签连接批次观察与原始用户消息，不向模型暴露内部 attachmentId；批次输出在主会话中被明确标记为不可信数据，降低图片内提示注入被当成新指令的风险。
- 最终代码与活动设计搜索无旧 capability/MCP/legacy flag 引用；仅 findings/progress 保留被阶段 10 推翻的历史研究记录，便于解释迁移原因。

## 2026-08-25：阶段 11 Read 图片契约实测

- 用户已明确授权使用本机百炼配置进行 Kimi、Qwen 两次真实端到端调用，会产生少量百炼用量。
- 测试不使用业务截图，改用无敏感信息且视觉答案唯一的本地图片夹具。
- 成功必须同时满足：SDK 事件中存在 Read 工具调用；Read 没有返回不支持图片或权限错误；所选模型正确回答图片中的颜色、形状与测试码。
- 仅把绝对路径写入提示词，不通过 Composer 图片附件入口发送，从而隔离验证“路径 → Claude Agent SDK Read → 百炼模型”这一条链路。
- 已生成并人工核对 `/tmp/synapse-read-tool-test.png`：960×640、31,381 字节，红色背景、黑色三角形、黄色圆形、白色测试码 `READ-824`；文件名不包含颜色或形状答案。
- Computer Use 后端已可用；应用注册名不是窗口标题 `Synapse AI Studio`，需用实际进程应用名继续读取界面。
- 进程核对确认当前工作树开发版已在运行：Electron 主进程工作目录为仓库 `desktop`，userData 为 `~/Library/Application Support/Synapse`；不是旧 `/Applications/Synapse.app`。
- Computer Use 已成功连接 `Electron` 并识别窗口 `Synapse AI Studio`；当前界面显示此前 49 图 Kimi 会话，右上角模型为百炼 `kimi-k2.6`。
- 应用列表确认开发版注册为运行中的 `Electron`，正式安装版 `Synapse` 当前未运行；后续测试不会误连正式包。
- `com.github.Electron` bundle id 在本机有多个开发应用而产生歧义；Computer Use 必须使用当前仓库 Electron.app 的完整路径，并在需要时用 `disableDiff: true` 获取完整可访问性树。
- Synapse 项目“新建对话”已进入空白草稿并聚焦输入框；当前继承所选模型百炼 `kimi-k2.6`。
- 为排除工作目录授权对 Read 的干扰，夹具已复制到当前项目根目录 `/Users/liyang/Documents/code/github/Synapse/synapse-read-tool-test.png`；仍只通过提示词传路径，不作为附件发送。
- 新建动作最终创建了 `Synapse` 项目会话“新对话 16:02”，模型确认为百炼 `kimi-k2.6`，消息区为空。
- Kimi 实测已获得中间证据：提示只含绝对路径，SDK 事件显示 `Read Done`，参数为精确 PNG 路径，工具输出呈现 `Read image 1` 图片预览；说明本地 Read 已成功把图片型工具结果送入当前百炼 Kimi 会话。
- Kimi 最终成功：`kimi-k2.6` 正确回答红色背景、黑色等边三角形内有黄色圆形、测试码 `READ-824`；总处理约 15 秒，Usage 显示新增输入 304、输出 315、缓存读 77,150、缓存写 78,142 token。
- 已建立第二个完全空白的 `Synapse` 项目对话用于 Qwen；模型初始继承 `kimi-k2.6`，需在发送前切换。
- 代码确认项目行“+”是快速创建并直接使用默认模型；模型标签本身不可切换。要选 Qwen，必须从项目“更多操作”进入自定义“新建对话”对话框的 ProviderModelPicker。
- 自定义对话框已打开，但本机百炼四个已配置槽位当前是 `glm-5.1`、`deepseek-v4-pro`、`kimi-k2.6`、`deepseek-v4-flash`，没有 Qwen；Qwen 实测需要选择一个准确的百炼 Qwen 视觉模型 ID并临时配置，测试后恢复原槽位。
- 仓库价格预设、SDK 测试与百炼官方文档一致支持 `qwen3.5-plus`；官方当前明确其输入模态含 Text/Image/Video，并给出 Claude Code `/model qwen3.5-plus` 的视觉用法，因此选它作为 Qwen 实测型号。
- 模型与供应商设置确认百炼配置可编辑，原四槽位值已记录；计划只临时替换 #2 `deepseek-v4-pro`，不触碰当前 Kimi #3、API 密钥或默认供应商。
- 百炼 #2 已临时从 `deepseek-v4-pro` 改为 `qwen3.5-plus` 并出现“Provider 已保存”；配置 JSON 同步只改变 `ANTHROPIC_DEFAULT_OPUS_MODEL`，其余字段与密钥保持不变。
- 返回对话后重新打开自定义新建对话，模型选择器已显示百炼 #2 `qwen3.5-plus`，当前仍选中 Kimi #3；尚未创建或发送 Qwen 会话。
- 已创建独立空白会话“新对话 16:08”，会话头明确显示百炼 `qwen3.5-plus`；未继承 Kimi 内容，输入区为空。
- Qwen 实测同样出现 `Read Done`、精确路径参数和 `Read image 1` 预览，证明图片型工具结果已送入百炼 `qwen3.5-plus`。
- Qwen 正确识别红色背景、黑色三角形和黄色圆形，但把清晰的 `READ-824` 误读成 `READ-0824`；这是模型视觉/OCR 误差，不是 Read 传输失败。总处理约 17 秒，Usage 显示新增输入 308、输出 424、缓存读 89,713、缓存写 90,397 token。
- Qwen 对话调试包已导出到 `/Users/liyang/Downloads/synapse-agent-conversation-Read and analyze local PNG image-20260825-081028Z.zip`，保留模型名、Read 事件、工具图片结果、最终答案和 Usage 证据。
- 调试包复核进一步确认：runtime `models` 为 `qwen3.5-plus`，42/42 SDK stream events 全部导出、`toolCallCount=1`、`toolResultCount=1`、`failedToolCount=0`，事件流明确包含 `tool_use` 名称 `Read`；该轮汇总成本为 $0.621978。
- 百炼 #2 已恢复为原值 `deepseek-v4-pro` 并再次显示“Provider 已保存”；Kimi #3、默认模型和其它配置未改变。
- 契约结论：当前 Claude Agent SDK 的 Read 图片工具结果可以被百炼 `kimi-k2.6` 与 `qwen3.5-plus` 正常接收；两者都完成了真实 tool_use → image tool_result → 第二次模型响应闭环。
- 质量结论：Kimi 本轮答案全对；Qwen 明确收到图片但有一次字符级 OCR 误差。因此“能接收图片”已证实，“每张图都识别完全正确”不能由传输层保证。
- 架构结论：路径 + Read 可以替代当前额外隔离模型查询作为更直接的主路径，但本轮只验证 1 图。要承诺大量图片全部读取，仍需保留有序 manifest、精确文件授权、数量/磁盘配额和完成性核对，并追加 20/50 路径压力测试；不需要 Provider/模型白名单。
- 测试夹具源文件已从仓库根目录删除，未留下未跟踪图片；Qwen 导出包内保留同一 31,381 字节 PNG，可复核且可恢复。
- Synapse 开发进程在测试完成后已不再运行；Computer Use 的后续状态读取误启动了一个 Electron 默认页，已按精确 PID 关闭，未重启 Synapse 或触碰其它服务。
# 2026-08-25 路径化重构新增结论

- 百炼 `kimi-k2.6` 与 `qwen3.5-plus` 的真实测试均证明：Claude Agent SDK `Read` 返回的图片工具结果能够到达当前百炼模型；Qwen 的一次 OCR 偏差属于模型识别质量，不是传输失败。
- 当前图片派发复杂度集中在 `AttachmentDispatchPlan`、`attachment-dispatch.ts`、`ClaudeSDKSession` 隔离 query 和批次摘要回灌；这些均可删除。
- 每个受控文件位于 `staged/<projectId>/<draftScopeId>/<attachmentId>/original.*`；同一草稿根目录只包含本轮显式添加的受控文件，适合作为一个精确 `additionalDirectories` 授权范围。
- 新链路应让 Renderer 只发送实际用户正文和 attachmentId；主进程临时构造有序路径清单，Synapse 历史继续只保存用户正文与结构化附件元数据。
- 用户明确选择“仅路径提示”和“原图”：Synapse 不追踪模型是否读完，也不使用 1568 预览图替代模型输入。
- 运行时 manifest 只需要字符串路径，不需要 SDK 图片 content block；同一个 `ClaudeSDKSession.send()` 可对 Kimi、Qwen 和自定义 Provider 生成完全相同的附件内容。
- 动态授权必须以草稿受控根目录为单位。只授权各文件父目录会扩大状态数量，授权原始父目录则会扩大权限范围。
- SDK 的 `input_json_delta` 可能把绝对路径拆成多个字符串片段，逐字符串替换无法可靠脱敏；存在附件上下文时应省略该流式 partial JSON，等待完整 tool-use 输入后再做路径投影。
- 完整生产 build 不执行 Renderer TypeScript 语义检查，不能替代 `typecheck`；本次两者分别运行并通过。

## 2026-08-25：阶段 10 多图消息缩略图密度

- 当前消息附件组件只渲染前 8 个图片格，最后一格覆盖剩余数量；全部图片仍进入灯箱。
- 用户截图中的多图区域需要稳定的 3×3 结构，因此消息内可见格数量应改为 9，超过 9 张时由第 9 格显示剩余数量。
- 单张消息气泡宽度上限为 `max-w-lg`；多图网格使用现有 Tailwind 尺寸类收窄即可，不需要新增 CSS、颜色或布局 primitive。
- 本次只改变时间线展示密度，不改变最多 50 张的选择、发送、历史元数据或灯箱图片集合。

## 2026-08-25：阶段 11 用户消息气泡内边距

- 当前用户消息气泡使用 `px-5 py-3`，即水平 20px、垂直 12px，截图中的四边视觉差异来自这一既有规则。
- `docs/superpowers/specs/2026-05-09-agent-timeline-ui-polish-design.md` 与 `docs/superpowers/specs/2025-05-08-agent-timeline-elegant-redesign.md` 都显式保留该非等距值；用户最新要求取代旧基线，需要同步更新两份设计说明。
- 使用现有 Tailwind `p-4` 可把四边统一为 16px，不新增 CSS、任意值或运行时几何常量。
- 图片与正文之间的 `mt-3` 属于内容分组间距，不是气泡外层内边距，本次保持不变。

## 2026-08-25：阶段 12 Agent 顶栏实时上下文占用

- Claude Agent SDK `usage.iterations` 的最后一项可表达当前迭代真实上下文；无该字段时才使用输入、缓存读、缓存写和输出 token 求和。
- `message_delta.usage` 的输入与缓存字段可能为空，运行时需要保留上一份分项并用累计输出更新，不能把空值当成上下文归零。
- `modelUsage.*.contextWindow` 是窗口上限的可靠来源；只允许当前主线程模型精确匹配，或唯一有效候选回退，不维护本地模型上限表。
- 当前上下文占用与回复下方的会话累计计费 token 是两个独立口径，后者不改动。
- 实时快照必须独立于 50ms 文本流批次更新；时间线增量 reducer 保留当前快照，完整会话加载才从最近 result metadata 恢复或清空。
- 主界面和独立窗口已经共享 `AgentConversationWorkspace`，因此指标放在该组件内即可覆盖两种窗口，不需要新增同步通道。

## 2026-08-25：百炼模型上下文压缩可行性

- 结论是可实现，而且当前 `@anthropic-ai/claude-agent-sdk 0.2.138` 内置的 Claude Code 2.1.138 runtime 已包含客户端自动压缩能力；不需要、也不应依赖 Anthropic Messages API 的 Claude 服务端 compaction。
- 本地 SDK 类型公开 `Settings.autoCompactEnabled`、`Settings.autoCompactWindow`、`PreCompact`、`PostCompact`、`SDKCompactBoundaryMessage`、`Query.getContextUsage()` 和 `Options.resume`。runtime 还明确说明实际自动压缩阈值取配置窗口与模型最大上下文的较小值。
- runtime 的客户端压缩会调用模型生成结构化续写摘要，以压缩摘要和 `compact_boundary` 替换旧活动上下文，再继续同一 SDK session。摘要请求走当前 `ANTHROPIC_BASE_URL` 和当前模型，因此百炼 Qwen/Kimi 只需继续满足现有 Anthropic Messages 兼容链路。
- 阿里云官方文档确认百炼提供 Anthropic 兼容 `/v1/messages`，支持 Claude Code、流式响应、思考和工具调用；未声明支持 Anthropic 专用 `context_management` 服务端压缩。百炼链路应使用 SDK/runtime 客户端压缩，不透传 Claude beta compaction 参数。
- Synapse 已保存 `sdkSessionId` 并通过 `Options.resume` 恢复会话；SDK transcript 会保存压缩摘要和边界，恢复时加载压缩后的活动链。Synapse 自己的可见 history 可以继续保留完整消息，两者不应互相覆盖。
- 当前实现已桥接 `compact_boundary`，并用 `post_tokens` 实时降低顶栏上下文占用；但 `ClaudeSDKRuntimeSettings` 目前只承载 `skipWebFetchPreflight`，尚未显式锁定或配置自动压缩策略，也没有对百炼真实长上下文压缩做端到端验收。
- 若只要自动压缩，推荐显式设置 `autoCompactEnabled: true` 并优先保留 `autoCompactWindow` 的 SDK `auto` 行为；不要按模型名维护上下文白名单。若产品要求自定义阈值，应把窗口作为 Provider/会话显式配置或使用 SDK 确认的模型窗口，未知窗口不猜测。
- 若要用户手动触发，SDK `Query` 没有独立 `compact()` 控制方法；可把 runtime 原生 `/compact` 作为明确 allowlist 的 native slash 透传。自行另起摘要 query、重建 session 只应作为 SDK 压缩不可用时的后备方案。
- 与 Codex 的差异：OpenAI Responses compaction 返回服务端生成的加密 opaque compaction item；这里是当前百炼模型生成的可见客户端摘要。两者都能缩小活动上下文并延长任务，但客户端摘要更依赖模型总结质量，不能宣称语义等价或无损。

## 2026-08-25：百炼 MCP Tool Search 实测

- 当前运行中的开发版会话使用百炼 `qwen3.7-plus`，未显式开启 Tool Search 的一轮简单问答后，顶栏显示当前上下文 `90.2K / 200K`；Usage 为新增输入 237、输出 1,789、缓存读 88,530、缓存写 89,139。
- 当前 Synapse MCP `tools/list` 实测为 223 个工具、完整定义 JSON 203,397 字符；这解释了自定义端点回退到全量 Schema 时的高基线上下文。
- 后续必须用独立空白会话显式设置 `ENABLE_TOOL_SEARCH=true`，并以 ToolSearch 事件和实际 MCP 调用共同判断百炼是否兼容 `tool_reference`，不能只看最终回答。
- 百炼 Provider 当前配置确认未设置 `ENABLE_TOOL_SEARCH`；请求地址是 `https://dashscope.aliyuncs.com/apps/anthropic`，主模型映射为 `qwen3.7-plus`。测试只在既有 `env` 增加该布尔开关，其余模型、插件、Hook、权限与密钥保持不变。
- 显式开启后的第一轮真实调用没有协议错误，`app_automation_trigger_type_list` 返回 `builtin.cron`、`builtin.interval`、`builtin.webhook`；但空白会话结束时上下文仍为 `91.6K / 200K`，Usage 为输入 266、输出 390、缓存读 89,672、缓存写 91,472。仅凭调用成功不能证明 Tool Search 生效，反而与全量工具上下文基线接近。
- 调试包完整保存 71/71 个 SDK stream events 和 24 个 Agent events：Tool Search 相关字符串命中 0，唯一 `tool_use` 是目标 Synapse MCP 工具；`sessionInit.tools` 也不包含 `ToolSearch`。
- 本地 Agent SDK 0.2.138 内置 Claude Code 2.1.138 runtime 明确包含门禁文案：非 Sonnet 4+/Opus 4+ 模型会因不支持 `tool_reference` 被禁用 Tool Search。`ENABLE_TOOL_SEARCH=true` 只覆盖非第一方 Base URL/Vertex 回退，不覆盖模型兼容门禁。
- 官方 `_SUPPORTED_CAPABILITIES` 只允许声明 effort、thinking、adaptive/interleaved thinking 等能力，没有 `tool_reference` 或 Tool Search 能力值，因此不能用百炼 Provider 环境变量合法声明 Qwen 支持该协议。
- 结论：当前百炼 `qwen3.7-plus` + Claude Code 2.1.138 不能实际开启 MCP Tool Search；保留开关只会造成“配置看似开启、运行时仍全量加载”的假象。

## 2026-08-25：GitHub 相关 Issue 复核

- `anthropics/claude-code#77928` 中，Claude Code 协作者明确确认：非 Anthropic `ANTHROPIC_BASE_URL` 默认不启用 Tool Search；显式设置 `ENABLE_TOOL_SEARCH=true` 等于声明该端点支持 `defer_loading`、`tool_reference` 和对应 beta 请求形态。后端不支持时应取消该变量或设为 `false`，这不是普通 tool calling 能力可以替代的。
- `anthropics/claude-code#89211` 仍为 open，复现了非 Anthropic 模型通过自定义 `ANTHROPIC_BASE_URL` 时，deferred tools 被后端拒绝并返回 400；建议客户端能力探测、自动回退或启动警告。
- `anthropics/claude-code#16925` 的调试日志与本地 runtime 字符串一致：Tool Search 的模型门禁只认可 Sonnet 4+/Opus 4+ 及更新模型；这支持“百炼 Qwen 在 Claude Code 2.1.138 先被客户端门禁禁用”的实测结论。
- `MoonshotAI/kimi-cli#2223` 与 `farion1231/cc-switch#2941` 均复现 Kimi Anthropic-compatible 端点收到 `tool_reference` 后持续 400；`cc-switch#6681` 进一步用 A/B 说明把 `ENABLE_TOOL_SEARCH=true` 注入第三方 Provider 会触发同类失败。
- `sgl-project/sglang#35692` 和 `vllm-project/vllm#52489` 均复现 Qwen chat template 无法处理 `tool_reference`，说明“兼容 Anthropic Messages/普通工具调用”不等于实现 deferred-tool 协议。
- `QwenLM/qwen-code#6721` 展示 Qwen Code 自己的渐进工具发现实现：通过稳定的应用层 meta-tool/代理调用加载工具，而不是证明 Qwen 支持 Claude Code 的 Anthropic `tool_reference` 协议。若 Synapse 要跨 Provider 降低 Schema token，应优先考虑这种客户端级工具目录与加载器。

## 2026-08-25：OpenCode MCP 工具压缩方案复核

- OpenCode 旧/稳定路径仍把连接的 MCP 工具完整转换为 Provider tools；官方 MCP 文档也明确提醒每个 MCP server 都会增加上下文。
- OpenCode 没有采用 Anthropic `defer_loading` / `tool_reference`。维护者在 `anomalyco/opencode#9461` 明确选择 Code Mode，核心实现由 PR `#34677`、`#35185` 合并。
- Code Mode 开启时，`SessionTools.resolve()` 在注册内置工具与 MCP resource helper 后提前返回，不再把每个 MCP action 加入顶层 Provider tool 列表；Provider 只看到一个普通 `execute({ code })` 工具来访问 MCP actions。
- `execute` 的 description 附带受预算约束的 MCP catalog：所有 namespace 与工具数量常驻，完整签名按 namespace 轮询装入，默认 catalog entry 预算约 2,000 token；目录不完整时，模型可在受限脚本内调用 `tools.$codemode.search({ query, namespace, limit, offset })`，搜索结果直接返回路径、描述和 TypeScript 风格签名。
- 同一次 `execute` 可通过受限 JavaScript 调用、串联、分支或 `Promise.all` 并行执行多个 MCP 工具，并只把需要的聚合结果返回模型；运行时不提供文件系统、进程、网络、模块或环境变量等 ambient authority，实际 MCP 权限继续由 OpenCode 宿主检查。
- 该方案只要求 Provider 支持普通 function/tool calling，不依赖 Anthropic 专有 content block，因此天然适用于 Qwen、Kimi 和其它 Provider；代价是模型必须可靠地产生受限脚本，目录搜索与执行 UI/错误处理更复杂，当前 v1 仍通过 `OPENCODE_EXPERIMENTAL_CODE_MODE=true` 开启。
- `anomalyco/opencode#35376` 的协作者说明：OpenCode v2 默认使用 Code Mode，但文档仍在完善且存在少量缺口。当前 dev 源码继续保留 v1 实验开关，不能把 v2 默认行为表述为所有 OpenCode 发行渠道均已默认开启。
- 对 Synapse 的直接启示：223 个 MCP 工具可以收敛为一个稳定的 `execute` schema + 受预算目录，规避 Claude Code 的模型名门禁与 `tool_reference` 兼容问题；这比简单的 search-then-load 更进一步，但实施复杂度和模型脚本可靠性风险也更高。

## 2026-08-25：Claude Agent SDK 客户端 Tool Search / Invoke 方案评估

- 当前项目实际使用 `@anthropic-ai/claude-agent-sdk 0.2.138`。官方文档与本地类型都确认可用 `tool()` + `createSdkMcpServer()` 注册进程内自定义工具，并通过 `Options.mcpServers` 交给同一条 `query()`；工具全名为 `mcp__<server>__<tool>`。
- 已用当前安装依赖完成无模型调用的最小原型：`tool_search(query, limit)` 与 `tool_invoke(tool_name, arguments)` 能被进程内 MCP client 列出和调用；`arguments: z.record(z.string(), z.unknown())` 被转换为标准对象 schema，嵌套数字和布尔值原样到达 handler。SDK 传输层可实现，不需要百炼支持 `tool_reference`。
- 阿里云 Anthropic-compatible Messages 官方文档明确支持普通 `tools[].input_schema`、模型返回 `tool_use.input` 对象和客户端回传 `tool_result`；文档没有声明 `defer_loading` 或 `tool_reference`。这与百炼 Qwen 已成功调用普通 Synapse MCP 工具、但 Tool Search 事件为 0 的实测一致。
- 只新增两个包装工具没有 token 价值：Synapse 当前 `ClaudeSDKSession.buildQueryOptions()` 固定加载 `settingSources: ['user','project','local']`，用户配置中的原 `synapse-mcp` 仍会列出 223 个工具。必须同时传 `disallowedTools: ['mcp__synapse-mcp__*']`；Agent SDK 官方权限文档确认这种 bare tool-name glob 会把匹配定义从模型请求中移除，而不是只在执行时拒绝。
- 不应使用 `strictMcpConfig: true`：当前随包 Claude Code 2.1.138 的实际 `--help` 语义是只保留 `--mcp-config`、忽略其它 MCP，会同时隐藏用户的 Chrome、shadcn 等服务器。本地 SDK 类型注释把它描述成“严格校验”，与随包二进制真实行为不一致，方案不能依赖该字段。
- 最安全的接入形态是会话级进程内 router：保留公开 loopback `/mcp` 的完整 223-tool 契约给 Claude Code/Codex/OpenCode 等外部客户端；仅在 Synapse Agent query 中隐藏 `mcp__synapse-mcp__*`，新增不同 server 名的 always-loaded `search/invoke`。不得把公开 `/mcp` 的 `tools/list` 改成两个 meta-tool，否则会破坏能力注册表和外部编辑器兼容。
- 当前能力注册表已经提供 `buildAllMcpTools()`、`MCP_TOOL_ACTIONS` 和统一 `SynapseActionRouter`；router 的检索应复用前者，invoke 应复用既有 HTTP MCP `tools/call` 或 action router，不能复制 223 个 dispatcher。通过现有 HTTP MCP 转发可原样保留 `PermissionGuard`、`AuditSink`、abort 和统一结果归一化边界。
- 真实目录为 223 个定义、203,397 字符，其中 description 46,952、schema 140,330；单工具定义中位数 624 字符、P95 2,157、最大 14,428。两个建议包装 schema 合计约 913 字符；一次典型 top-5 搜索结果约数千字符，即使退化为全部 name+description 目录也只有 59,722 字符，仍明显小于全量 schema。
- 按字符/4 只能粗估：全量定义约 50.8K token、固定包装约 0.23K；结合百炼空白会话 91.6K/200K 的实测，潜在首轮上下文降幅很大，但不能在集成 A/B 前宣称会精确降到某个数。官方对原生 Tool Search 的经验值是工具定义通常减少 85% 以上，本方案目标可参考但不能直接继承其结果。
- 价值是真实的：223 已远超 Anthropic 提醒的 30–50 工具选择准确率退化区间；无工具任务可避免每轮携带全量 schema，有工具任务通常用一次额外搜索 round-trip 换取更小上下文。Prompt cache 只能降低重复输入价格，不能释放上下文窗口，因此不能替代此方案。
- 主要风险不在 SDK，而在产品语义：`tool_invoke` 会把 223 个底层工具统一成一个模型可见名字。若直接实现，Persona/子代理 allowlist 可能被绕过，权限卡片和 timeline 只显示 generic invoke，底层参数 schema 也不再由模型 tool schema 强约束。必须在 search 结果、PreToolUse/canUseTool、handler 与事件投影中把 `tool_name` 映射回原 `mcp__synapse-mcp__<name>`，并由 dispatcher 再次校验参数。
- 检索质量仍需真实验证：工具名、description 和参数说明主要为英文，而用户提示可能是中文；朴素 substring 不足以发布。建议对规范 name/description/property names 做本地 BM25/关键词排序，提供 domain/resource/action 过滤与无命中浏览回退，返回最多 5 个完整 schema；不为搜索另接远程 embedding 服务。
- 当前长期规则与方案存在明确产品边界冲突：`docs/agents/knowledge-base.md` 要求 Knowledge Base 不做 MCP 隔离，并禁止通过 SDK `mcpServers` 注入“修复”知识库 MCP。会话级 router 虽不改用户配置、也不隐藏其它 MCP，但会替换 Knowledge Base 会话中的 Synapse MCP 暴露方式；正式实施前必须由用户批准这一边界并同步规则文档，不能静默绕过。
- 结论：方案在 SDK 与当前代码结构上可实现，且 token/上下文价值很可能显著；但“只写两个工具”不是完整实现。建议先做显式实验开关下的 fresh-session A/B，覆盖 Qwen/Kimi、无工具、简单读取、相似工具消歧、复杂 schema、写操作、Persona 和子代理；通过上下文、任务成功率、参数错误、权限一致性和延迟指标后再决定默认启用。

## 2026-08-25：`/compact` 手动压缩修复

- 内置命令目录只发布 SDK 官方 `/compact`；旧 `/compress` 已删除且不保留别名。
- Command Router 对 `/compact` 直接返回 native slash 路由，不经过普通项目 allowlist；Conversation Router 沿用既有 live session 创建/复用、原样发送和终态等待链路。
- 已删除 `compressSession` 依赖、硬编码“不支持压缩”的占位实现和对应错误常量，因此请求会真正进入当前 Claude Code runtime 与百炼 Provider。
- `compact_boundary` 继续透传 `trigger`、`pre_tokens/post_tokens` 与实时上下文占用；用户历史保留 `/compact`，没有新增隐藏摘要 query 或 Synapse 摘要历史。
- 成功、SDK error 和旧 `/compress` 均覆盖单一结果/错误事件回归；专项 286 项、Desktop typecheck、hard constraints 与 `git diff --check` 全部通过。
- 后续截图发现 Renderer 的 Claude Code 静态定义仍发布 `/compress`，与 runtime 的 `/compact` 被菜单合并后同时显示；现已同步改为 `/compact`，两个来源会按同名去重为一项。

## 2026-08-25：`/compact` 真实结果与 416 上下文诊断

- 调试包与 SDK transcript 确认手动压缩成功：同一 `sdkSessionId`、`compact_result: success`、`trigger: manual`，耗时 15,513 ms，并写入 `isCompactSummary: true` 的续写摘要。
- 原始 transcript 的边界值为 `preTokens: 90,848`、`postTokens: 416`；416 对应压缩摘要侧 token，不是下一轮完整模型请求上下文。
- 压缩边界后 SDK 重新发出 init，仍加载 20 个内置工具、4 个 MCP server 和完整 Skills/规则；这些固定前缀会在下一轮重新进入上下文，不能被 416 代表。
- Synapse 当前 `AgentContextUsageTracker` 在 compact boundary 上直接执行 `usedTokens = post_tokens`，因此把摘要 token 错标成顶栏完整“上下文”占用；下一次普通模型轮次到来后预计会重新跳回约 86K–90K。
- SDK `Query.getContextUsage()` 已提供按 system prompt、tools、messages、MCP tools、memory files 分类的 `totalTokens/maxTokens`；正确修复应在压缩完成后读取该权威总量，或在下一次真实 usage 前显示未知，不能继续把 `post_tokens` 当完整上下文。
- 修复采用现有 SDK control request，不新增 IPC：`compact_boundary` 先使旧快照失效，再由同一 Query 的 `getContextUsage()` 用完整 `totalTokens/maxTokens/model` 重建；control request 失败只记录结构化警告并让顶栏保持未知。
# 2026-08-25 全量回归审计

## 今日变更边界

- 基准提交：`db1890741738f5d9a7e93ab8b940a0a0887f9832`，范围为当日 00:00 至当前工作树。
- 已提交主题：Drive 1000 文件目录回收站事务、Git diff 浏览器、Agent 附件展示与斜杠菜单、Drive MDX/CommonMark 兼容、Mermaid 横向边距。
- 未提交主题：Agent 附件路径化、受控暂存、上下文占用与 `/compact` 统计修复、Drive 多级列表编辑/预览一致性。
- 最终差异共 125 个文件、6509 行新增、4331 行删除；生产风险集中在 Agent runtime/IPC/Renderer、Git diff 渲染、Drive Markdown 和大目录事务。

## 自动化测试预算

| 主题 | 目标用例 | 重点边界 |
|---|---:|---|
| Drive 生命周期 | 30+ | 1000 文件、事务 maxWait/timeout、审计、失败与容量 |
| Git diff | 50+ | 工作区/历史、重命名、二进制、截断、解析失败、布局/换行/主题 |
| Agent runtime 与 IPC | 120+ | 1/4/20/50 图、顺序、权限、配额、生命周期、脱敏、单 query |
| Agent Renderer | 80+ | 选择/粘贴/拖放、九宫格、灯箱、气泡、历史恢复、双窗口 |
| Context 与 compact | 40+ | 聚合、上限、无效 usage、压缩刷新、失败清空 |
| Drive Markdown/MDX/Mermaid | 50+ | 多级列表、comment projection、CommonMark、横向滚动 |

自动化目标合计 370+，高于用户提出的一两百项；真实 UI 作为端到端证据，不替代可重复测试。

## 首轮自动化结果

| 范围 | 文件 | 用例 | 结果 |
|---|---:|---:|---|
| Desktop Agent + Git | 103 | 1413 | passed |
| Server Drive | 3 | 45 | passed |
| Dashboard Markdown/MDX/Mermaid | 5 | 129 | passed |
| 合计 | 111 | 1587 | passed |

现有测试已经覆盖 50 图并发配额、单 query 路径清单、九宫格与完整灯箱、上下文 SDK 统计、`/compact` 刷新、Git 重命名/二进制/截断/解析失败、1000 文件目录事务和多级列表 projection。

## 双轴审查与修复

- Spec：子智能体 `result` 曾在主线程过滤前更新窗口，失败发送的 `result.error` 曾被 Renderer 当成功，附件 commit 曾在失败/取消后保持永久状态，受控草稿根目录曾只授权不投影。四项均以失败回归复现并修复。
- Standards：移除 `@git-diff-view/react` 的硬编码 GitHub 色板，改用应用主题 token 渲染统一/分栏差异；Renderer 附件 IPC 调用集中到 hook，主进程剪贴板物化集中到服务；临时文件与句柄清理失败不再静默吞没。
- 修复后的功能专项为 204/204，通过；Git/Composer/IPC/附件清理组合专项为 184/184，通过。

## 最终验收

| 范围 | 文件 | 用例 | 结果 |
|---|---:|---:|---|
| Desktop Agent + Git | 103 | 1420 | passed |
| Server Drive | 3 | 45 | passed |
| Dashboard Markdown/MDX/Mermaid | 3 | 119 | passed |
| 合计 | 109 | 1584 | passed |

- Desktop、Server、Dashboard 类型检查通过；Desktop hard constraints 与 IPC codegen 通过；Desktop renderer 和 Dashboard production build 通过。
- 完整 Desktop 串行复跑 1420/1420；此前并发构建负载下唯一一次 5 秒测试超时单独与全组复跑均通过，归类为资源竞争型 flake。
- Computer Use 复验热更新后的 Git 本地主题渲染器：统一/分栏、自动换行、行号、增删与行内差异均正常。Agent 顶栏、Slash、图片/文件夹附件、灯箱、独立窗口和历史 Git 路径此前均已实机通过。
- 本地 Drive 受登录门槛限制，未输入或迁移生产凭据；对应风险由 Dashboard 119 项最终回归和 Server 45 项回归覆盖。
# 2026-08-26 持续复审编排约束

- 当前时间 2026-08-26 01:08 CST，距离用户指定停止时刻约 5 小时 52 分钟。
- Synapse 保存项目 ID 为 `local-ccdce33f42886d88206d465d33094f50`，是 Git 仓库；用户明确要求直接使用现有项目，因此新任务必须选择 `environment.type=local`，不得使用默认 worktree。
- 当前主分支 `main` 相对 `origin/main` ahead 6，启动时工作树无未提交文件；每轮应在开始和结束都记录 HEAD 与 `git status`，避免跨轮覆盖。
- 2026-08-25 提交日志显示 5 个当日提交：`dd38e7562`、`876e2223c`、`7b474594f`、`a41ba9a8d`、`f937c5e73`。此前活动记录还包含当日后续已提交的 Agent 路径化、上下文、MCP 搜索与模型目录能力，需要按提交时间、基准 `db189074...` 和最终 diff 重新核定完整范围，不能只复查这 5 个摘要。
- Computer Use 必须使用 `node_repl` + `@oai/sky`；当前仓库 Electron 开发版此前可通过仓库内 Electron.app 的绝对路径访问，不能因为 `Synapse` 名称或 bundle id 冲突失败就宣称界面不可测。
# 2026-08-26 阶段 23 第 1 轮现场

- 起始时间 `2026-08-26 01:10:00 CST`；HEAD `5c2ac491b16f0507a3409731733e1a1c4c87f6c7`；当前分支 `main`，相对 `origin/main` ahead 6。
- 起始未提交文件只有 `task_plan.md`、`progress.md`、`findings.md`，均为主任务刚追加的阶段 23 编排记录；本轮不得覆盖或拆分为其它任务。
- 固定审查基准为用户指定的 `db1890741738f5d9a7e93ab8b940a0a0887f9832`，同时另行盘点 2026-08-25 00:00–23:59 CST 提交及当日形成、午夜后连续提交的直接变更。
- 审查方法保留 code-review 的 Standards / Spec 双轴，但因用户禁止子任务而在当前任务内串行完成。
- 真实 UI 证据必须通过 computer-use 技能的 `node_repl + @oai/sky`，每次动作后重新获取应用状态；不使用 AppleScript、System Events、浏览器自动化或 Playwright。
