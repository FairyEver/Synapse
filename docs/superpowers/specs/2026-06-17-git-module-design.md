# Git 模块设计

> 状态：设计确认，等待用户审阅

## 背景

Synapse 需要新增一个独立的 Git 模块，面向偏文科的文档编写人员提供类似 SourceTree 的可视化 Git 能力。用户需要克隆公司的仓库，日常完成文档修改、提交和同步。该模块不关联现有 Synapse 仓库功能，也不复用当前内容仓库、资源仓库或项目仓库的业务语义。

目标用户通常不熟悉命令行，也可能没有安装 Git。模块需要先帮助用户建立标准 Git 环境，再用克制的可视化界面完成常用操作。产品不内置 Git，默认协助用户安装和使用系统 Git，保证仓库仍能被 VS Code、SourceTree、命令行、公司脚本和其它工具共同管理。

## 目标

- 提供一个全新的独立 Git 模块，用于管理多个本地 Git 仓库。
- 帮助用户检测和安装系统 Git，不随应用内置 Git。
- 支持用户粘贴 HTTPS 或 SSH 仓库地址并 clone 到本地。
- 支持添加已有本地 Git 仓库到模块列表。
- 支持查看仓库工作区改动、文件 diff、当前分支、ahead/behind 状态。
- 支持文件级勾选提交。
- 支持强确认后按文件丢弃改动；新增和未跟踪文件只移入系统废纸篓。
- 提供同步、拉取、推送三个操作，其中同步是默认常用操作。
- 支持查看本地分支和缓存的远程分支、切换或新建本地分支，并从远程分支创建 tracking 分支。
- 支持查看当前分支的提交历史、提交详情和提交 diff。
- 面向非研发用户提供短、直接、可操作的错误状态。

## 非目标

- 不关联现有 Synapse repository、resource repository、content store 或项目配置。
- 不内置 Git runtime。
- 不做分支树视图。
- 不做可视化冲突解决。
- 不做 stash、rebase、cherry-pick、tag、仓库级 reset/clean、force push。
- 不做远程分支树、远程分支创建、删除、重命名或上游配置管理。
- 不做 `.gitignore` 可视化管理，完全遵循标准 Git 忽略规则。
- 不做子模块或 Git LFS 管理界面。
- 不集成代码托管平台 API，不拉取公司仓库列表，仓库地址由用户自己粘贴。

## 产品结构

Git 模块由仓库列表、克隆向导、仓库工作台和 Git 环境诊断组成。

```text
Git
├─ 仓库列表
│  ├─ 克隆仓库
│  ├─ 添加本地仓库
│  ├─ 打开目录
│  └─ 进入工作台
│
├─ 克隆向导
│  ├─ 检测系统 Git
│  ├─ 检测用户名 / 邮箱
│  ├─ 粘贴仓库地址
│  ├─ 自动识别 HTTPS / SSH
│  ├─ 选择保存位置
│  └─ 执行 clone
│
└─ 仓库工作台
   ├─ 顶部：当前分支、同步状态、拉取、推送、同步
   ├─ 改动 Tab：文件列表、diff、勾选提交
   ├─ 历史 Tab：当前分支提交历史、提交详情、提交 diff
   └─ 分支切换：查看本地分支、切换、新建
```

## 图标

Git 模块需要一个独立系统 App 图标，显示在应用启动器中。图标资产落在：

```text
desktop/src/modules/git/assets/icon.png
```

尺寸与现有系统 App 图标保持一致，使用 `1254 x 1254` PNG。启动器中按现有样式显示为 `48 x 48`，圆角由启动器统一处理，图标图片本身不要依赖额外 CSS。

图标必须和现有系统 App 图标保持同一视觉家族。参考 `resource-repository`、`database`、`editor-scan`、`usage-analysis`、`model-price` 的图标：深色圆角底板、拟物 3D 物件、白/灰主体材质、柔和投影、少量琥珀色强调。Git 模块不能改成线性 lucide 图标、扁平 logo 或单独的品牌插画。

图标概念采用“仓库分支 + 文档页”的组合，表达这是面向文档仓库的 Git 工具，而不是通用开发终端。推荐画面是一个深色底板上的白色文档托盘或文件夹，前景叠加 3D 分支节点；其中一个节点或小标记使用现有系统 App 同款琥珀强调色。

```text
┌────────────────────┐
│                    │
│        ○           │
│        │           │
│   ◻────○────◻      │
│        │           │
│        ○           │
│                    │
└────────────────────┘
```

视觉规则：

- 主体是 Git 分支节点，旁边叠一张简化文档页、文件夹或托盘。
- 使用现有系统 App 的拟物 3D 风格：厚度、圆角、材质、投影和视角都要贴近已有图标。
- 颜色以深灰底、白/灰主体、少量琥珀强调为主，避免新增独立色系。
- 不使用 Git 官方标志，避免商标和视觉风格绑定。
- 不使用彩虹、蓝紫粉渐变、glow、霓虹、装饰性粒子。
- 不使用线性 lucide 风格、扁平 logo 风格或单色 glyph 风格。
- 不使用终端符号作为主视觉，避免把模块误读成开发者命令行工具。
- 小尺寸下优先保证分支节点和文档轮廓可辨认。
- 图标背景保持简洁，不承载功能说明文字。

## 入口页

仓库列表展示用户添加或克隆过的仓库。列表项显示仓库名称、本地路径、当前分支、改动数量、ahead/behind 状态和主要操作。

```text
┌────────────────────────────────────────────────────────────┐
│ Git                                             [克隆仓库]  │
├────────────────────────────────────────────────────────────┤
│ [全部] [需要处理] [同步中]                                  │
│                                                            │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ 文档中心                         main   ↑1 ↓2  3 个改动 │ │
│ │ /Users/me/work/docs                                   │ │
│ │                         [拉取] [推送] [同步] [进入]    │ │
│ └────────────────────────────────────────────────────────┘ │
│                                                            │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ 官网内容仓库                       main   已同步        │ │
│ │ /Users/me/work/website-docs                            │ │
│ │                         [拉取] [推送] [同步] [进入]    │ │
│ └────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

移除列表项只从 Git 模块中移除记录，不删除用户本地文件。删除本地文件、清理仓库、强制覆盖等危险操作不在第一期提供。

## 克隆向导

克隆向导保持单页表单或轻量分步表单。用户填写仓库地址和保存位置后，系统检测 Git 环境与认证方式。

```text
┌────────────────────────────────────────────────────────────┐
│ 克隆仓库                                                   │
├────────────────────────────────────────────────────────────┤
│ 仓库地址                                                   │
│ [ https://git.company.com/team/docs.git                 ]  │
│                                                            │
│ 父目录                                                     │
│ [ /Users/me/work                                       ]   │
│ 仓库目录名                                                 │
│ [ docs                                                ]   │
│ 最终路径 /Users/me/work/docs                               │
│                                                            │
│ 检查结果                                                   │
│ Git 可用                                                   │
│ 认证方式：HTTPS                                            │
│                                                            │
│                                      [取消] [开始克隆]      │
└────────────────────────────────────────────────────────────┘
```

HTTPS 是默认推荐路径。首次 clone 时认证交给系统 Git 和 Git Credential Manager 处理，Synapse 不保存账号密码、token 或 cookie。

SSH 是高级路径。Synapse 可以检测 `ssh` 是否可用、是否存在常见 SSH key、生成 SSH key、复制公钥、测试连接。Synapse 不保存私钥，也不要求用户把私钥粘贴到应用里。

克隆目标始终由“父目录 + 单段仓库目录名”计算；已存在的目标子目录必须拒绝，不能覆盖。clone 先在同一父目录的 Synapse 专属临时容器中执行，容器同时具备文件系统 marker 和 DataRepository journal 记录；成功后才把完整仓库原子移动到最终目录。取消、失败和启动恢复只清理 marker 与 journal 双重匹配的临时容器，不删除最终目录或其它已有文件。若完整仓库移动成功但列表注册失败，保留仓库并明确提示用户通过“添加本地仓库”恢复。添加本地仓库时必须解析真实路径并验证 Git 顶层目录，仓库子目录统一登记为其真实 Git 根目录。

工作台采用文件级提交语义：预览显示 `HEAD` 到当前工作树的完整文件变化，提交所选文件时包含该文件的全部变化。未跟踪文件使用 `/dev/null` 到文件的新增差异。差异和提交详情使用受控输出上限；提交文件列表与 diff 分别报告截断状态，截断只影响显示，不改变提交内容。

同一真实 Git 根目录的修改操作使用可见 FIFO 队列；Git System App 与内容仓库共用同一仓库锁。读取等待当前修改完成。clone、fetch、pull、push、sync 支持 operation ID 和取消，取消后重新读取真实状态。Coordinator 只保留排队和运行中的操作；完成、失败和取消终态发出事件后立即释放内部记录。

工作台可见时每 5 秒后台刷新，并在窗口重新聚焦时立即刷新；仓库列表只在窗口聚焦或用户手动操作时刷新，避免仓库较多时持续启动 Git 进程。后台刷新保留仍有效的文件选择和提交说明，新发现文件默认不选中。打开提交确认时由主进程为当前选择记录 HEAD、权威状态、重命名映射和内容指纹；提交在仓库 FIFO 内再次验证，任何变化都使短期选择令牌失效并要求重新审阅。

没有 Git 时显示安装引导。安装引导按平台给出短操作，并提供重新检测入口。应用不内置 Git，也不在第一期自动下载安装器。

## 仓库工作台

仓库工作台采用顶部状态区和 Tab 内容区。顶部显示仓库名称、本地路径、当前分支、ahead/behind、拉取、推送、同步。

```text
┌────────────────────────────────────────────────────────────┐
│ 文档中心                                      main [切换]   │
│ /Users/me/work/docs                           ↑1 ↓0        │
│                                   [拉取] [推送] [同步]     │
├────────────────────────────────────────────────────────────┤
│ [改动] [历史]                                                │
├───────────────┬────────────────────────────────────────────┤
│ 改动文件       │ 文件差异                                   │
│               │                                            │
│ [x] intro.md  │ - 原内容                                   │
│ [x] guide.md  │ + 新内容                                   │
│ [ ] logo.png  │                                            │
├───────────────┴────────────────────────────────────────────┤
│ 提交说明                                                   │
│ [ 更新入职文档说明                                      ]   │
│                                      [提交选中文件]         │
└────────────────────────────────────────────────────────────┘
```

工作台不显示功能介绍段落，不解释 Git 内部机制。界面只保留必要标题、字段、状态和操作。

## 改动与提交

改动 Tab 显示 Git 标准状态中的新增、修改、删除、重命名、未跟踪文件。`.gitignore` 已忽略的文件不显示；如果 `.gitignore` 文件本身被修改，则作为普通改动显示。

提交采用文件级勾选，不支持行级或块级选择。

```text
提交选中文件
├─ 校验至少选中 1 个文件
├─ 校验提交说明不为空
├─ 主进程验证仓库绑定的短期选择令牌
├─ 从 HEAD 创建临时 index，只暂存令牌中的权威路径
├─ 再次验证 HEAD、状态和内容指纹
├─ 使用临时 index 创建提交
├─ 只校正所选路径在用户 index 中的状态
├─ 刷新工作区状态
└─ 如果还有未提交文件，继续留在改动列表
```

文本文件显示 diff。`.docx`、图片、PDF 等二进制文件显示文件变更状态，不展示文本 diff。提交失败时保留用户输入的提交说明和勾选状态。临时 index 不读取或覆盖用户已有的无关暂存内容；提交失败不得污染真实 index。

按文件丢弃必须经过强确认，并列出操作数量和关键路径。Renderer 先为当前勾选文件准备仓库绑定的选择令牌，主进程在仓库 FIFO 内再次验证 HEAD、状态、重命名映射和内容指纹；Renderer 不得提交原始删除路径。

```text
丢弃选中文件
├─ 主进程验证选择令牌两次，冲突或未知状态停止
├─ 修改、删除文件同时恢复 index 与工作区到 HEAD
├─ 重命名恢复旧路径，并将新路径移入系统废纸篓
├─ 新增、未跟踪文件移入系统废纸篓
├─ 只校正所选路径，保留未选中路径的暂存状态
├─ 废纸篓失败时停止，不回退为永久删除
└─ 刷新工作区状态
```

冲突文件不提供伪解决入口，继续要求用户在外部 Git 工具中处理。该能力不是仓库级 reset 或 clean，不接受任意 pathspec 或 Git 参数。

## 同步、拉取和推送

工作台和仓库列表都提供同步、拉取、推送三个操作。同步是视觉上的主操作。

```text
同步 = 先拉取，再推送
拉取 = 只从远程更新到本地
推送 = 只把本地提交发到远程
```

第一期同步策略：

```text
同步点击
├─ 检查工作区
│  ├─ 有未提交改动：停止，提示先提交
│  └─ 工作区干净：继续
├─ 检查上游
│  ├─ 上游已删除：停止，提示重新推送或调整 upstream
│  └─ 本地与上游分叉：停止，提示使用外部 Git 工具处理
├─ fetch
├─ 重新检查上游和分叉状态
├─ 如果 behind > 0：pull --ff-only
├─ 如果 ahead > 0：push
└─ 刷新状态
```

第一期不自动 merge、不自动 rebase。遇到 non-fast-forward、冲突、认证失败或网络错误时停止操作，刷新状态并显示短提示。

默认 push remote 严格按 Git 配置解析：`branch.<name>.pushRemote` → `remote.pushDefault` → `branch.<name>.remote` → `origin` → 唯一远端。存在多个远端且仍无法判定时必须要求用户选择，不得使用配置文件中的第一个远端。

状态文案控制在操作层面：

```text
已同步
有本地提交待推送 ↑1
有远程更新待拉取 ↓2
有未提交改动 3
需要处理
```

## 分支

分支能力覆盖当前分支、本地分支，以及从本地缓存的远程引用创建 tracking 分支。

```text
分支
├─ 显示当前分支
├─ 列出本地分支
├─ 按远端分组列出缓存的远程分支，排除 remote/HEAD
├─ 用户明确操作时执行可取消的 fetch --all --prune
├─ 切换本地分支
├─ 新建本地分支
├─ 从远程分支创建同名或用户命名的本地 tracking 分支
├─ 如果工作区有未提交改动，切换前阻止并提示先提交
└─ 不做分支树、远程分支写操作或合并
```

分支切换入口位于顶部当前分支旁。打开列表只读取本地 `refs/remotes`，不得隐式访问网络；“获取远程分支”才执行 `git fetch --all --prune`。检出远程分支时，默认创建同名本地 tracking 分支；同名本地分支已跟踪该远端时直接切换，跟踪其它上游时要求用户填写其它本地名称。分支名使用 Git 原生校验，工作区不干净或目标分支已被其它 Worktree 占用时必须停止并给出可操作提示。

```text
┌──────────────────────────┐
│ 当前分支：main            │
├──────────────────────────┤
│ main              当前    │
│ docs-update               │
│ release/manual            │
├──────────────────────────┤
│ origin                    │
│   docs/topic              │
├──────────────────────────┤
│ [获取远程分支] [新建分支] │
└──────────────────────────┘
```

## 历史

历史 Tab 只显示当前分支历史，不显示分支树。

```text
┌───────────────┬────────────────────────────────────────────┐
│ 当前分支历史   │ 提交详情                                   │
│               │                                            │
│ 更新入职文档   │ 更新入职文档                               │
│ 张三 · 今天    │ a1b2c3d · 张三 · 2026-06-17                │
│               │                                            │
│ 修正文案错字   │ 改动文件                                   │
│ 李四 · 昨天    │ M docs/intro.md                            │
│               │ A docs/new-guide.md                        │
└───────────────┴────────────────────────────────────────────┘
```

提交列表显示提交说明、作者、时间和短 hash。点击提交后显示提交详情、改动文件列表和该提交 diff。二进制文件仍只显示文件变更状态。不提供回滚、reset、revert 或 cherry-pick。

## 技术架构

模块采用 renderer、IPC、Electron service、系统 Git 四层。

```text
Renderer
只负责界面状态、表单、列表、选中文件、操作触发

IPC
只暴露结构化 API，不暴露任意 git 命令执行

Electron Service
负责路径校验、Git 命令参数、错误归一化、结果解析

System Git
唯一真实 Git 执行环境
```

建议目录：

```text
desktop/src/modules/git/
├─ app-definition.ts
├─ app-manifest.ts
├─ index.tsx
├─ components/
│  ├─ git-repository-list.tsx
│  ├─ git-clone-dialog.tsx
│  ├─ git-workbench.tsx
│  ├─ git-changes-tab.tsx
│  ├─ git-discard-changes-dialog.tsx
│  ├─ git-history-tab.tsx
│  └─ git-branch-switcher.tsx
├─ hooks/
│  ├─ use-git-repositories.ts
│  ├─ use-git-worktree-status.ts
│  ├─ use-git-history.ts
│  ├─ use-git-branches.ts
│  └─ use-git-operations.ts
└─ types.ts

desktop/electron/modules/git/ipc.ts

desktop/electron/services/git-client/
├─ git-environment-service.ts
├─ git-repository-registry.ts
├─ git-command-runner.ts
├─ git-status-service.ts
├─ git-commit-service.ts
├─ git-discard-service.ts
├─ git-sync-service.ts
├─ git-branch-service.ts
└─ git-history-service.ts

desktop/src/types/git.ts
```

`desktop/electron/services/git-client/` 可以复用现有 `runGitCommand` 的受控执行思路，但服务命名、数据模型和持久化记录保持独立，不接入当前 repository sync、内容仓库或资源仓库逻辑。

## 数据模型

Git 模块自己维护仓库列表。

```ts
type GitManagedRepository = {
  id: string
  name: string
  localPath: string
  addedAt: string
  lastOpenedAt: string | null
}
```

仓库工作台快照实时从 Git 读取，不长期存储。

```ts
type GitRepositorySnapshot = {
  repositoryId: string
  pathExists: boolean
  isGitRepository: boolean
  currentBranch: string | null
  upstream: string | null
  ahead: number
  behind: number
  hasConflicts: boolean
  changeCount: number
  changesTruncated: boolean
  changes: GitFileChange[]
}
```

状态命令使用 NUL 分隔的 porcelain v2 流式解析。主进程始终解析完整状态以得到准确的 `changeCount` 和冲突状态，Renderer 最多接收前 10,000 项；超出时通过 `changesTruncated` 明确提示，不得把工作区误判为空或把输出上限显示为命令失败。

历史按当前分支每页 40 条分页加载，只有存在下一页时显示“加载更多”。空提交说明是合法历史记录，界面显示“无提交说明”。

仓库、分支、历史列表或提交选择变化都会使旧详情请求失效。只有最新请求代次可以更新详情、错误与 loading，避免较慢的旧响应覆盖当前选择。

```ts
type GitCommitSummary = {
  hash: string
  shortHash: string
  subject: string
  authorName: string
  authorEmail: string
  committedAt: string
}
```

提交详情同时返回 `filesTruncated`、`diffTruncated`，并保留兼容聚合字段 `truncated`。文件列表和 diff 分别执行固定输出限流，UI 分区提示截断，不将截断显示为命令失败。

仓库注册表使用主文件和备份文件。主文件缺失或结构无效而备份有效时，必须先将备份原子恢复为主文件再返回；两者均无效时保留原始证据并显式报告损坏，禁止静默返回空仓库列表。

## Git 命令策略

所有 Git 操作都通过结构化服务 API 进入主进程。服务内部使用参数数组执行系统 Git，不拼接 shell 字符串。

```text
git status --porcelain=v2 -z --branch --untracked-files=all
git diff -- <path>
git diff --staged -- <path>
git add -- <paths>
git reset -- <paths>
git restore --source=HEAD --staged --worktree -- <paths>
git commit -m <message>
git fetch --prune
git pull --ff-only
git push
git symbolic-ref --quiet --short HEAD
git for-each-ref --format=%(refname:short) refs/heads
git for-each-ref ... refs/remotes
git fetch --all --prune
git check-ref-format --branch <branch>
git checkout <branch>
git checkout -b <branch>
git checkout -b <branch> --track <remote>/<branch>
git log --date=iso-strict --pretty=...
git show --name-status -z --find-renames --format=...
```

Renderer 不允许传任意 Git 参数。IPC 方法只表达业务动作，例如：

```text
git.environment.check
git.repositories.list
git.repositories.addLocal
git.repositories.clone
git.status.getSnapshot
git.changes.prepare
git.changes.discard
git.commit.create
git.sync.fetch
git.sync.pull
git.sync.push
git.sync.sync
git.branches.list
git.branches.checkout
git.branches.create
git.branches.listRemote
git.branches.fetchRemote
git.branches.checkoutRemote
git.history.list
git.history.getCommit
```

## 环境向导

环境检测覆盖：

```text
gitEnvironment.check()
├─ git 是否可执行
├─ git version
├─ user.name / user.email
├─ ssh 是否可执行
├─ 常见 SSH key 是否存在
└─ 平台安装建议
```

`user.name` 和 `user.email` 缺失时，提供简单表单帮助用户写入全局 Git 配置。写入前展示将要保存的值，确认后执行。模块不把用户身份信息复制到 Synapse 私有仓库配置里。

## 安全边界

- Renderer 不能执行任意 Git 命令。
- 差异预览请求只携带仓库 ID 和当前路径；文件状态与重命名原路径必须由主进程重新读取当前工作区状态后确定，非当前改动路径一律拒绝。
- Renderer 只能提交仓库 ID、选择令牌和提交说明；原始路径、状态、重命名映射及内容指纹由主进程持有并在提交事务内复核，选择令牌不可跨仓库复用。
- 所有仓库路径必须来自用户显式添加或克隆的仓库。
- clone 目标路径必须由用户选择，且不能静默覆盖已有目录。
- 移除仓库列表项不删除本地文件。
- 丢弃改动、删除分支等可能丢内容的操作第一期不提供；未来若提供必须强确认。
- SSH 私钥、token、Authorization、Cookie、remote URL 中的凭据必须在日志、错误和 UI 中脱敏。
- 操作输出进入 UI 前必须做敏感信息脱敏。
- Git 进程必须禁用交互式 terminal prompt，避免后台挂起。
- 长时间操作需要超时和取消能力。

## 错误处理

服务层把 Git 原始错误归类，UI 用短文案展示。

```text
git-missing
auth-failed
network-failed
path-missing
not-git-repository
working-tree-dirty
non-fast-forward
conflict
unknown
```

示例文案：

```text
无法同步
需要先提交本地改动

认证失败
请重新登录或检查仓库地址

发生冲突
请联系协作者处理后再同步
```

UI 不展示长篇 Git 教程。需要排查时可以提供“查看详情”，详情中仍需脱敏。

## UI 基线

Git 模块遵循现有 Synapse shadcn/Radix 基线。

- 使用 `desktop/components.json` 中的 `radix-nova` preset。
- 优先使用 `desktop/src/components/ui/` 中的 `Button`、`Input`、`Textarea`、`Dialog`、`Tabs`、`DropdownMenu`、`Badge`、`Tooltip`、`ScrollArea`、`Separator`。
- 颜色来自主题 token 和 Tailwind 默认 token，不写 hex/rgb/hsl 字面色，不使用 Tailwind 任意颜色。
- 不使用装饰性渐变、glow、emoji heading。
- 不写营销式欢迎横幅或功能介绍段落。
- 列表项主区域可点击进入工作台，行内按钮阻止冒泡。
- 表格或列表中的数字状态右对齐或固定宽度，避免刷新时跳动。

## 测试

环境检测：

- 无 Git 时返回 `git-missing` 并给出平台安装建议。
- Git 可用时返回版本。
- `user.name` / `user.email` 缺失时识别为待配置。
- SSH key 存在和不存在两种状态都能识别。

仓库操作：

- HTTP、HTTPS 和 SSH URL 能正确识别，并保留用户名、IPv6 host 与非默认端口。
- clone 目标目录已存在时不静默覆盖。
- 添加已有 Git 目录成功。
- 添加非 Git 目录时给出明确状态。
- 仓库路径消失时列表项显示不可访问。

工作区：

- 修改、新增、删除、未跟踪文件都能显示。
- `.gitignore` 已忽略文件不显示。
- 勾选文件提交只提交选中的文件。
- 二进制文件 diff 降级为文件变更状态。
- 提交失败后保留提交说明和勾选状态。

同步：

- ahead、behind、dirty 状态识别正确。
- 有未提交改动时同步停止。
- `pull --ff-only` 遇到 non-fast-forward 时停止。
- 冲突状态能识别并归类。
- push 被拒绝时提示先拉取或同步。
- 多远端 push 目标遵循 Git 的 pushRemote、pushDefault、branch remote、origin、唯一远端优先级。

分支：

- 能列出本地分支。
- 工作区干净时可切换本地分支。
- 工作区有未提交改动时阻止切换。
- 能从当前 HEAD 新建本地分支。

历史：

- 只读取当前分支历史。
- 支持分页加载。
- 点击提交能显示提交详情和改动文件。
- 文本提交 diff 可展示，二进制文件降级显示。

## 发布说明

实现时需要更新 `RELEASE_NOTES_PENDING.md`，面向用户说明 Synapse 新增 Git 模块，支持克隆公司仓库、查看改动、选择文件提交、同步远程和查看当前分支历史。
