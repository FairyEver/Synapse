# Skill 卸载器设计

## 背景

Synapse 已有 Skill 安装器、IDE 管理扫描、单项移入废纸篓和批量移入废纸篓能力，但卸载入口与 IDE 管理模块耦合，缺少可以被独立系统应用和其它 renderer 模块共同调用的 Skill 卸载能力。

本次新增独立 Skill 卸载器。它按 Skill 名称扫描所有匹配的安装位置，允许用户多选后统一移入系统废纸篓。卸载器同时提供独立系统应用页面和调用式弹窗，两种载体共用同一交互流程与主进程 service。IDE 管理中的 Skill 卸载也收敛到这套公共能力。

## 目标

- 按 Skill 名称查找并卸载 Synapse 安装或外部安装的 Skill。
- 不传搜索路径时，扫描所有已注册 Agent adapter 的全局 Skill 根目录。
- 传入搜索路径时，从该目录向下进行受限递归扫描。
- 扫描结果默认全部不选，支持逐项勾选和全选。
- 所有卸载均移入系统废纸篓，不永久删除。
- 独立页面和调用式弹窗共用同一个 renderer flow。
- IDE 管理复用公共扫描、校验和卸载 service，不再独立维护文件删除逻辑。
- 复用现有权限检查、审计、Agent adapter、状态刷新和安全错误格式化能力。

## 非目标

- 不做永久删除。
- 不做模糊名称搜索。
- 不在未传搜索路径时自动扫描 Synapse 配置的所有项目。
- 不跟随符号链接。
- 不保存安装历史、卸载历史、持久化任务或后台恢复状态。
- 当前不提供 MCP、Workflow 节点或自动卸载能力。
- 当前不扩展到 Rule 或 Prompt。
- 不重写现有安装器，也不把卸载流程并入安装器。

## 产品入口

### 独立系统应用

新增 `skill-uninstaller` 系统应用。页面遵循单任务工具布局，使用收窄的居中工作卡片，包含：

- Skill 名称：必填。
- 搜索目录：可选，支持手动输入和目录选择。
- 未填写搜索目录时，搜索范围显示为全局 Skill 目录。
- 扫描操作。
- 扫描结果、选择操作和批量移入废纸篓操作。

页面不增加功能介绍、营销文案、嵌套卡片或重复状态说明。

### 调用式弹窗

其它 renderer 模块可以用函数或共享 controller 打开卸载弹窗，并传入：

```ts
type OpenSkillUninstallerOptions = {
  initialName: string
  initialSearchRootPath?: string
  onCompleted?: (result: SkillUninstallBatchResult) => void
}
```

参数完整时，弹窗打开后自动扫描。名称和搜索路径在弹窗中可见但默认不可编辑，避免调用方设定的操作范围被意外改变。弹窗与独立页面复用同一个 `SkillUninstallerFlow`，只由不同容器承载。

### IDE 管理

- 全局 Skill 的单项卸载调用弹窗，只传 Skill 名称。
- 项目 Skill 的单项卸载调用弹窗，传 Skill 名称和项目路径作为递归搜索根目录。
- IDE 管理已有的多项移入废纸篓交互可以保留，但底层必须改为调用公共卸载 service。
- 所有入口最终使用相同的目标复查、权限检查、审计和结果格式。

## 能力包结构

新增能力包：

```text
desktop/app-capabilities/skill-uninstaller/
├── shared/       # query、candidate、result schema 与 capability id
├── main/         # 扫描 service、卸载 service、IPC dispatcher
└── renderer/     # 系统应用、共享 flow、弹窗容器
```

核心逻辑集中在 `main/service.ts` 或同级聚焦 service。系统应用、弹窗、IPC 和 IDE 管理只能作为入口适配器，不得复制递归扫描、路径校验或卸载实现。

## 公共数据模型

```ts
type SkillUninstallQuery = {
  name: string
  searchRootPath?: string
}

type SkillUninstallCandidate = {
  path: string
  name: string
  frontmatterName?: string
  editorIds: SynapseEditorId[]
  source: "synapse" | "external"
  synapseContentId?: string
}

type SkillUninstallScanResult = {
  candidates: SkillUninstallCandidate[]
  complete: boolean
  warnings: string[]
}

type SkillUninstallTarget = {
  query: SkillUninstallQuery
  path: string
}

type SkillUninstallBatchResult = {
  results: Array<{
    path: string
    status: "trashed" | "failed" | "skipped"
    error?: string
    warning?: string
  }>
}
```

`path` 用于向用户展示真实位置和标识候选项，但主进程不得直接信任 renderer 回传的路径。执行前必须按原查询重新验证目标。

同一真实路径只能产生一个候选项。如果同一物理目录被多个 Agent 识别，`editorIds` 记录所有关联 Agent，界面不得生成多个可重复删除的行。无法归属任何已注册 Agent 的匹配项仍然返回，界面显示为“其它位置”。

全局扫描根据候选项所属的 adapter 全局根目录确定 `editorIds`。自定义目录扫描沿候选路径向上检查可能的项目根，并调用各 adapter 的 `projectPaths()` 解析结果进行比较；同一路径符合多个 adapter 规则时保留全部关联 Agent。该判断只用于展示，不影响能否卸载，也不得在卸载时把 Agent 归属当作安全边界。

`.synapse.json` 只用于读取来源、`synapseContentId` 等展示与状态刷新信息，不影响能否卸载。

## 扫描语义

### 搜索范围

未传 `searchRootPath` 时：

- 从所有已注册且支持 Skill 的 Agent adapter 获取全局 Skill 根目录。
- 对真实路径去重后，使用统一递归扫描器扫描每个根目录。
- 不扫描项目配置列表。

传入 `searchRootPath` 时：

- 将它视为递归搜索根目录，而不是项目根、Skill 父目录或具体 Skill 目录的固定语义。
- 搜索根目录可以位于目标 Skill 的任意祖先层级。
- 自定义搜索根必须经过读取权限检查和审计。

### 名称匹配

输入名称去除首尾空白后不能为空。候选目录必须包含可读取的 `SKILL.md`，并满足下列任一条件：

- 目录名与输入名称忽略大小写后精确相等。
- `SKILL.md` frontmatter 的 `name` 与输入名称忽略大小写后精确相等。

不使用子串、拼音、slug 推断或其它模糊匹配。目录名匹配时不要求 frontmatter 一定存在 `name`，以兼容不同 Agent 和外部 Skill。

### 目录遍历

递归扫描不设置 Agent 路径优先级，必须完整收集当前扫描边界内的所有匹配项。

默认排除以下目录名，按 basename 精确匹配：

```text
node_modules
.git
.svn
.hg
.next
.nuxt
.cache
.turbo
dist
build
out
coverage
target
vendor
```

扫描规则：

- 不跟随目录符号链接。
- 发现可读取的 `SKILL.md` 后，将当前目录视为一个 Skill 根，不再进入其附件子目录。
- 使用迭代遍历和有界并发，不递归堆栈调用。
- 默认最大深度为 32 层。
- 默认最多访问 50,000 个目录。
- 默认超时为 30 秒。
- 默认目录读取并发数为 8。
- 支持用户取消正在进行的扫描。

达到深度、目录数量或超时上限时，返回已经发现的候选项，同时将 `complete` 设为 `false` 并提供简短 warning。界面不得把受限结果展示为完整扫描。

单个目录不可读时继续扫描其它目录，并把安全格式化后的信息加入 warnings。搜索根不存在或搜索根本身不可读时，扫描整体失败。

## 卸载语义

### 执行前复查

主进程接收用户选择的目标列表，每个目标都携带发现它时使用的原始 query。每个目标执行前必须重新验证：

- 目标仍然存在且是目录。
- 目标不是符号链接。
- 目标真实路径仍位于本次全局根目录或 `searchRootPath` 的真实路径内。
- 目标目录仍包含可读取的 `SKILL.md`。
- 目录名或当前 frontmatter `name` 仍与 query 名称精确匹配。
- 目标仍可由同一 query 的扫描规则发现。

任何前置检查失败时，该项返回 `skipped`，不得继续删除。文件系统操作已经开始后发生的错误返回 `failed`。renderer 传入任意路径不能绕过搜索边界和名称校验。

### 文件操作

- 每个目标分别执行写入权限检查和审计。
- 使用 Electron `shell.trashItem` 移入系统废纸篓。
- 目标按顺序处理，不并发移动多个目录。
- 单项失败不阻断后续项。
- 错误返回现有安全格式化文案，不暴露堆栈或无关敏感上下文。

### 后置刷新

- 有 `synapseContentId` 的成功项刷新对应 install status cache 并发送既有状态变更事件。
- IDE 管理调用方在完成回调中重新扫描当前视图。
- 状态刷新失败不得把已经成功移入废纸篓的操作改判为失败；记录结构化 warning 并提示刷新失败。

## 共享交互流程

`SkillUninstallerFlow` 管理以下状态：

1. 查询输入。
2. 扫描中、扫描取消、扫描错误和扫描不完整。
3. 候选结果。
4. 用户选择。
5. 卸载确认。
6. 顺序执行与逐项结果。

结果列表每行只展示：

- 勾选框。
- Skill 名称。
- 关联 Agent；无法识别时显示“其它位置”。
- 实际目录路径。
- 来源：Synapse 或外部。

交互规则：

- 扫描完成后默认全部不选。
- 支持逐项勾选和全选/取消全选。
- 未选择任何项时，“移到废纸篓”不可用。
- 操作按钮显示选择数量，但不增加重复统计文案。
- 执行前使用统一确认框，列出数量和目标位置。
- 成功项从当前结果移除。
- 失败或跳过项保留，并显示简短原因。
- 部分失败时展示汇总，同时允许用户重试剩余项。

## 公共接口与调用边界

主进程公共 service 提供：

```ts
scan(query: SkillUninstallQuery, security: EditorReadSecurityDeps): Promise<SkillUninstallScanResult>

uninstall(
  targets: SkillUninstallTarget[],
  security: EditorTrashSecurityDeps,
): Promise<SkillUninstallBatchResult>
```

共享单名称 flow 将同一个 query 附加到所有选中路径。IDE 管理批量操作可以为不同名称的目标分别构造 query，因此不需要为每个名称重复打开弹窗，也不会绕过目标自己的搜索边界。

IPC bridge 只暴露扫描、取消扫描和执行卸载能力。打开弹窗属于 renderer 应用层，不属于主进程 bridge。renderer 为每次扫描生成 `scanId`；IPC handler 为进行中的 `scanId` 保存临时 `AbortController`，取消或扫描结束后立即清理，不持久化扫描状态。

renderer 调用方可以传初始 query、关闭回调和完成回调，但不能通过 UI controller 绕过确认直接执行删除。确有现成交互的 IDE 管理批量操作可以直接调用公共 service 对应 bridge，但仍必须保留其确认步骤。

## 错误处理

- 名称为空：不开始扫描，显示必填错误。
- 全局根目录不存在：该 Agent 返回空结果，不作为整体失败。
- 自定义搜索根不存在或不可读：扫描失败，保留查询条件供用户修改或重试。
- 部分子目录不可读：继续扫描，返回 partial warnings。
- 扫描被取消：保留已经发现的结果，但标记扫描未完成。
- 扫描达到限制：保留结果并明确标记未完成。
- 执行前目标变化：该项跳过，其它项继续。
- 移入废纸篓失败：该项失败，其它项继续。
- 后置刷新失败：卸载结果保持成功，只提示刷新失败。

## 测试计划

### 主进程扫描

- 无路径查询从所有已注册且支持 Skill 的 Agent adapter 获取全局根目录。
- 有路径查询递归扫描任意祖先目录。
- 所有排除目录生效，且按 basename 精确匹配。
- 目录符号链接不被跟随。
- 发现 Skill 后不继续扫描其附件子目录。
- 目录名和 frontmatter `name` 均支持忽略大小写的精确匹配。
- 目录名匹配且 frontmatter 无 `name` 时仍可发现。
- 同一真实路径被多个 Agent 识别时只返回一项并聚合 `editorIds`。
- 外部 Skill 和 Synapse Skill 均可发现。
- 未识别 Agent 的 Skill 返回为空 `editorIds`。
- 达到深度、目录数和超时限制时返回 partial result。
- 取消扫描返回 partial result。
- 不可读子目录不会中断其它目录扫描。

### 主进程卸载

- 选中目标按顺序移入系统废纸篓。
- 单项失败不阻断后续目标。
- renderer 注入搜索范围外路径时被拒绝。
- 符号链接逃逸、`..` 逃逸和真实路径变化时被拒绝。
- 扫描后 `SKILL.md` 被删除、名称变化或目录被替换时被拒绝。
- 每项执行权限检查并记录审计结果。
- 外部 Skill 可以卸载。
- 后置刷新失败不改变成功的卸载结果。

### Renderer

- 页面和弹窗使用同一 `SkillUninstallerFlow`。
- 独立页面支持名称和可选目录输入。
- 弹窗参数完整时自动扫描，查询字段默认不可编辑。
- 扫描完成后默认没有选中项。
- 逐项选择、全选和取消全选正确。
- 无选择时操作按钮不可用。
- 确认框展示选中数量和目标位置。
- 成功、部分失败、全部失败和跳过状态正确展示。
- 扫描未完成时有明确提示。
- IDE 管理单项卸载打开共享弹窗。
- IDE 管理批量 Skill 删除进入公共 service。

### 回归

- 现有 Skill 安装器行为不变。
- 现有编辑器扫描、Rule 移入废纸篓和复制功能不退化。
- install status cache 对 Synapse Skill 的刷新继续生效。
- 系统应用 registry、独立窗口和弹窗关闭行为符合现有约定。

## 文档与发布同步

实现时需要同步：

- `docs/reference/editor-integration-matrix.md`：说明公共卸载扫描和名称匹配边界。
- `AGENTS.md`：记录 Skill 卸载统一走公共能力、只移入废纸篓以及自定义根目录的受限递归扫描边界。
- `RELEASE_NOTES_PENDING.md`：面向用户说明新增 Skill 卸载器、全局/目录扫描、多选卸载及 IDE 管理复用。
