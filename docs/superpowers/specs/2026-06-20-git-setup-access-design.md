# Git Setup And Access Design

## Summary

Git 应用新增成熟的环境准备与访问修复能力。第一期覆盖 Git 安装引导、Git 身份配置、HTTPS 凭证处理、SSH 公钥处理，以及克隆、同步、拉取、推送失败后的图形化修复入口。

这不是教程页，也不是 Synapse 自己实现的密码库。Synapse 负责读取和设置 Git 相关配置，把凭证写入 Git credential helper 或系统凭证管理器；Synapse 不在自己的数据库保存密码、访问令牌或私钥。

## Goals

- 在 Git 应用中常驻 `安装 Git` Tab，引导 Windows 和 macOS 用户通过官方网页下载并图形化安装 Git。
- 在 Git 应用中新增 `访问` Tab，统一处理 HTTPS 凭证、SSH 公钥和仓库认证失败。
- 克隆、同步、拉取、推送遇到阻塞时，把 Git 错误归因为用户可理解的状态，并提供明确主操作。
- 支持 GitHub 的正确认证方式：HTTPS 使用浏览器登录/Git Credential Manager、访问令牌或改用 SSH；SSH 使用 SSH Key。
- 支持公司 HTTP/HTTPS 仓库的用户名和密码登录，凭证保存到 Git credential helper 或系统凭证管理器。
- 支持读取和设置 Git `credential.helper`，保存和清除指定 host 的 HTTPS 凭证。
- 支持检测、复制、生成 SSH 公钥，并测试 SSH host 连接。
- 保持 Synapse UI 克制、图形化、可回到原操作重试，不要求用户输入命令。
- 所有新增能力必须从现有 Git 应用界面可触达，不能只存在于 service、IPC 或隐藏诊断中。
- 所有 Git 阻塞和失败都必须翻译成可见状态、用户动作和脱敏诊断，不能让 Git 进程失败或停止后只留下后台日志。

## Non-Goals

- 不托管 Git 安装包。
- 不在 Synapse 内置下载安装器。
- 不静默安装 Git。
- 不执行系统级安装命令。
- 不提供 Linux 图形化安装引导。
- 不把账号、密码、访问令牌或私钥保存到 Synapse 数据库。
- 不展示已保存密码或访问令牌。
- 不把密码或访问令牌写入 remote URL。
- 不把 GitHub 设计成账号密码登录。
- 不做完整平台账号系统，不接管 GitHub/Gitee/GitLab OAuth。

## Current Context

当前 Git 模块已有：

- `desktop/src/modules/git/index.tsx`：Git 应用入口，目前包含 `仓库` 和 `环境` Tab。
- `desktop/src/modules/git/components/git-environment-panel.tsx`：显示 Git、身份、SSH、公钥和仓库诊断。
- `desktop/src/modules/git/components/git-clone-dialog.tsx`：克隆仓库，已能识别 HTTPS/SSH。
- `desktop/electron/services/git-client/git-environment-service.ts`：检测 Git、SSH、公钥、Git 身份。
- `desktop/electron/services/git-client/git-command-runner.ts`：统一执行 Git 命令并分类部分错误。
- `desktop/electron/modules/git/ipc.ts`：Git IPC 边界。

当前环境页只提示安装 Git，认证失败通常仍落在 Git 错误文案上。新设计将安装、身份、访问和失败修复连成闭环。

## Existing Extension Points

本设计必须基于当前已经实现的 Git 应用扩展，不另做一套独立入口或悬空向导。

### Renderer

- `GitModule` 继续作为 Git 应用唯一入口，复用当前 `SystemAppWindowShell` 顶栏 Tab 结构。
- `GitEnvironmentPanel` 继续承载环境诊断详情，新增入口要从这里跳到 `安装 Git` 或 `访问`，不要复制一份诊断 UI。
- `GitCloneDialog` 继续作为克隆入口，新增登录、公钥、缺 Git、缺身份处理都从这个弹窗的提交流程接出。
- `GitRepositoryList` 继续显示仓库级状态，认证、路径、网络、SSH 等失败必须在对应仓库行或列表顶部 Alert 可见。
- `GitWorkbench` 继续显示单仓库工作台，拉取、推送、同步、提交等操作失败必须在工作台内有可见状态和处理按钮。
- `useGitOperations` 当前只返回字符串错误。实现时需要升级为结构化失败结果，供列表、工作台和访问页决定主操作。
- `git-status-view.ts` 当前只给仓库快照生成状态和少量错误建议。实现时应扩展为共享的错误归因与 UI action 映射，不要在多个组件里各写一套正则。

### Main Process

- `git-environment-service.ts` 继续负责 Git、PATH、身份、SSH 基础检测。
- `git-command-runner.ts` 继续作为 Git 命令执行边界，但错误需要返回结构化 category、summary、detail 和 suggestedAction。
- `git-error-utils.ts` 和 `git-client/git-logging.ts` 已有脱敏与分类能力，新增访问功能必须复用或扩展它们。
- `gitIpcModule` 继续作为 Git IPC 唯一模块；新增 access 方法挂在同一模块下，避免新建平行的 Git IPC 风格。

## Reachability Rules

每个新增能力都必须有明确 UI 入口：

```text
能力                         入口
------------------------------------------------------------
打开 Git 下载页               安装 Git Tab 主按钮
重新检测 Git                  安装 Git Tab / 环境 Tab
设置 Git 身份                 环境 Tab / 克隆缺身份弹窗
设置 credential.helper        访问 Tab 凭证保存区域
保存 HTTPS 凭证               访问 Tab / 克隆失败登录弹窗 / 同步失败登录弹窗
清除 HTTPS 凭证               访问 Tab host 行
生成 SSH 公钥                 访问 Tab SSH 区域 / SSH 克隆阻塞弹窗
复制 SSH 公钥                 访问 Tab / 环境 Tab / 克隆弹窗
打开 SSH Key 页面             访问 Tab / SSH 失败状态
测试 SSH 连接                 访问 Tab SSH host 行
处理认证失败                  仓库列表 / 工作台 / 克隆弹窗的主操作
重试原操作                    访问 Tab pending action 区域
复制诊断信息                  环境 Tab / 失败状态旁的次操作
```

如果某个 service 或 IPC 能力没有对应 UI 入口、空态、失败态和测试，就不属于第一期实现范围。

## Information Architecture

Git 应用顶栏改为：

```text
仓库 | 环境 | 安装 Git | 访问
```

- `仓库`：日常仓库列表、克隆、同步、拉取、推送、提交。
- `环境`：诊断详情，保留 Git、PATH、身份、SSH、公钥、仓库状态和复制诊断。
- `安装 Git`：Git 安装状态、官方下载页、重新检测。
- `访问`：HTTPS 凭证、SSH 公钥、仓库访问问题和原操作重试。

Git 不可用时，进入 Git 应用后自动切到 `安装 Git`。认证失败时，从失败位置进入 `访问`，并保留短期的原操作重试上下文。

## Installation Tab

`安装 Git` 常驻。它只显示状态、必要字段和动作，不展示教程段落。

### States

```text
未检测到 Git
已安装
检测失败
当前系统暂不支持图形化引导
```

### Windows

```text
安装 Git

状态    未检测到 Git
系统    Windows
来源    Git for Windows

[打开下载页面] [重新检测]

步骤
✓ 检测系统
○ 打开下载页面
○ 完成安装
○ 重新检测
```

`打开下载页面` 使用系统浏览器打开 Git 官方 Windows 下载页面。

### macOS

```text
安装 Git

状态    未检测到 Git
系统    macOS
来源    Git for macOS

[打开下载页面] [重新检测]
```

`打开下载页面` 使用系统浏览器打开 Git 官方 macOS 下载页面。

### Installed

```text
安装 Git

状态    已安装
版本    git version 2.xx.x
位置    /usr/bin/git

[重新检测] [打开下载页面]
```

### Linux

```text
安装 Git

状态    当前系统暂不支持图形化引导
系统    Linux

[重新检测] [复制诊断信息]
```

第一期不展示 Linux 命令说明，避免违背图形化目标。

## Access Tab

`访问` 是 Git 访问状态面板，不是密码库。

```text
访问

凭证保存
状态      Git Credential Manager
操作      [设置凭证保存] [重新检测]

HTTPS
github.com
状态      未登录
操作      [浏览器登录] [使用访问令牌] [改用 SSH]

git.company.com
状态      认证失败
操作      [登录] [清除凭证] [重新检测]

SSH
公钥      id_ed25519.pub
状态      已检测到公钥
操作      [复制公钥] [打开 SSH Key 页面] [测试连接]
```

### Credential Helper

Synapse 使用 `--show-origin --get-all` 读取完整 `credential.helper` 链及来源。状态分为未配置、Synapse 支持的安全 helper、已知明文 helper、外部配置管理。自定义 helper 或多 helper 链属于外部管理：Synapse 不覆盖、不重排，也不阻断用户直接执行 Git 操作。只有完全未配置，或用户配置中唯一 helper 为已知明文 `store` 时，才允许切换到平台安全 helper；失败时恢复原值。

如果没有安全凭证保存方式，访问页显示：

```text
凭证保存
状态      未设置

[设置凭证保存]
```

设置时优先使用平台安全方式：

- Windows：Git Credential Manager 或 Windows Credential Manager。
- macOS：Git Credential Manager 或 macOS Keychain。
- Linux：第一期不主动配置图形化凭证保存。

不得默认配置 `git-credential-store`，因为它会把凭证明文写到磁盘。

### SSH 主机密钥

SSH remote descriptor 保留用户名和端口。连接测试使用真实用户名、端口、批处理模式和严格 host-key 校验。未知主机先通过 `ssh-keyscan` 获取公钥并显示 SHA-256 指纹，用户确认后原子写入 `known_hosts`。已有主机记录与扫描结果不一致时视为 host-key changed，Synapse 不提供覆盖操作，只显示诊断并要求人工核验。所有 `.ssh` 写入、网络访问和进程执行必须经过 PermissionGuard 与 AuditSink。

### GitHub HTTPS

GitHub host 第一期只识别 `github.com`。命中 GitHub HTTPS 后，不显示账号密码弹窗。

```text
GitHub
方式    HTTPS
状态    未登录

[浏览器登录] [使用访问令牌] [改用 SSH]
```

`浏览器登录` 优先触发本机 Git Credential Manager 的图形登录能力；如果不可用，打开 GitHub 官方凭证说明页面。

访问令牌弹窗：

```text
使用访问令牌

账号      [________]
访问令牌  [________]

[打开令牌页面] [保存并重试]
```

保存时通过 Git credential 机制写入 host 凭证，然后立刻清空 renderer 表单和 main 进程临时变量。

### Company HTTP/HTTPS

未知 host 或公司 host 走通用 HTTP/HTTPS 登录。公司仓库允许账号密码。

```text
登录仓库

主机      git.company.com
用户名    [________]
密码      [________]

[取消] [保存并重试]
```

保存动作：

```text
git credential approve
protocol=<remote 的 http 或 https>
host=<remote host；非默认端口必须保留为 host:port，IPv6 使用 [host]:port>
username=<user input>
password=<password input>
```

保存、查询和清除必须使用完全相同的协议与 host/port 上下文，避免 HTTP、HTTPS 和非默认端口之间串用凭据。旧的无端口 HTTPS 凭据继续按原 host 查询。Synapse 不持久化用户名密码；凭证由当前 Git credential helper 保存。

### SSH

SSH 面板显示公钥状态、路径、类型和指纹。只允许复制 `.pub` 内容，不显示或复制私钥。

无公钥：

```text
SSH
状态    未检测到公钥

[生成 SSH 公钥] [重新检测]
```

生成公钥：

```text
生成 SSH 公钥？

路径    ~/.ssh/id_ed25519
邮箱    user@example.com

[取消] [生成]
```

有公钥但访问失败：

```text
SSH
状态    SSH 访问失败
公钥    id_ed25519.pub
指纹    SHA256:xxxx

[复制公钥] [打开 SSH Key 页面] [测试连接]
```

已知平台打开对应 SSH Key 页面；未知平台只提供复制公钥、测试连接和复制诊断。

## Operation Flow

### Clone Preflight

克隆前先做轻量检查：

```text
克隆仓库
  ↓
检查 Git 是否可用
  ↓
检查 Git 身份
  ↓
识别 remote protocol + host
  ↓
检查目标目录
  ↓
开始 clone
```

处理规则：

- 缺 Git：切到 `安装 Git`。
- 缺用户名或邮箱：弹出 `设置 Git 身份`。
- 目标目录不可写：显示 `无法写入该文件夹`，提供 `重新选择文件夹`。
- HTTPS 公开仓库：不强制提前登录，直接 clone。
- HTTPS 认证失败：按 host 进入 `访问` 或弹登录。
- SSH 无公钥：进入 SSH 公钥处理。

### Failure Routing

Git 操作失败后，Synapse 显示归因和动作，不直接把原始 stderr 作为主文案。

```text
失败类别                状态文案                 主操作
------------------------------------------------------------
git-missing             未检测到 Git              安装 Git
missing-identity        缺少 Git 身份             设置身份
auth-failed             认证失败                  处理访问
https-login-required    需要登录                  登录仓库
ssh-publickey           SSH 访问失败              设置 SSH 访问
repository-not-found    仓库不存在或无权限         处理访问
network                 网络连接失败              重试
path                    本地路径不可用             重新选择/移除
dirty                   本地有未提交改动           查看改动
conflict                需要处理冲突               查看改动
unknown                 Git 操作失败               复制诊断信息
```

服务层返回结构化失败，renderer 不再只依赖普通字符串：

```ts
type GitUserFacingFailure = {
  category:
    | "git-missing"
    | "missing-identity"
    | "https-auth"
    | "github-auth"
    | "ssh-auth"
    | "credential-helper-missing"
    | "repository-not-found"
    | "network"
    | "path"
    | "dirty"
    | "conflict"
    | "non-fast-forward"
    | "timeout"
    | "unknown"
  title: string
  message: string
  detail: string | null
  host: string | null
  protocol: "https" | "ssh" | "file" | "unknown"
  primaryAction:
    | "install-git"
    | "set-identity"
    | "login-host"
    | "handle-github-auth"
    | "handle-ssh"
    | "configure-credential-helper"
    | "retry"
    | "choose-directory"
    | "open-workbench"
    | "copy-diagnostics"
    | null
}
```

`detail` 可以包含脱敏后的 Git 原始错误首行或短摘要，但不能包含 token、password、Authorization、Cookie 或带凭证 URL。

示例：

```text
同步失败

认证失败
git.company.com 需要登录。

[登录仓库] [复制诊断信息]
```

```text
推送失败

SSH 访问失败
当前公钥没有访问 github.com 的权限。

[复制公钥] [打开 SSH Key 页面] [测试连接]
```

```text
克隆失败

仓库不存在或无权限。

[处理访问] [修改仓库地址]
```

### Visible Failure Surfaces

每个失败必须出现在用户当前操作上下文中：

```text
克隆弹窗失败
→ 弹窗内 Alert 显示归因
→ 主按钮变成对应处理动作
→ 保留仓库地址和保存位置

仓库列表同步失败
→ 列表顶部 Alert 显示归因
→ 对应仓库行 badge/状态显示失败
→ 对应仓库行提供主操作

工作台操作失败
→ 工作台顶部或当前 Tab 内 Alert 显示归因
→ 不丢提交说明、文件选择或当前查看文件

访问页处理失败
→ 当前 host/SSH 区域内显示失败
→ 保留非敏感输入
→ 清空密码和访问令牌字段

后台环境检测失败
→ 环境 Tab 和安装 Git Tab 都能看到检测失败
→ 提供重新检测和复制诊断
```

禁止只在以下位置记录错误：

```text
只写 main 日志
只写 console
只更新不可见状态
只把原始错误放进复制诊断
只让按钮停止 loading
```

### Error Translation Rules

错误翻译集中维护。优先在主进程分类并脱敏，renderer 只做展示和动作路由。

```text
Git 原始信号                                      用户可见标题
----------------------------------------------------------------
ENOENT / no available git / no git command         未检测到 Git
user.name missing / user.email missing             缺少 Git 身份
Authentication failed / 401 / 403                  认证失败
could not read Username                            需要登录
Permission denied (publickey)                      SSH 访问失败
Could not read from remote repository              SSH 访问失败 / 仓库无权限
Repository not found / not found                   仓库不存在或无权限
Could not resolve host / failed to connect         网络连接失败
Operation timed out / connection timed out         操作超时
not a git repository                               不是 Git 仓库
No such file or directory                          本地路径不可用
local changes would be overwritten                 本地有未提交改动
non-fast-forward / fetch first / rejected          需要先拉取远程更新
merge conflict / CONFLICT                          需要处理冲突
```

同类错误在仓库列表、工作台、克隆弹窗和访问页必须显示同一套标题和主操作。不要让同一个 `Authentication failed` 在不同页面分别显示为 `操作失败`、`状态读取失败` 和 `检查账号、凭据或仓库地址`。

### Retry Original Action

认证或 SSH 处理完成后，用户可以回到原操作。

```text
克隆失败
  ↓
登录仓库
  ↓
保存凭证
  ↓
[重试克隆]
```

```text
同步失败
  ↓
处理访问
  ↓
保存凭证或添加公钥
  ↓
[重试同步]
```

Renderer 保存短期 `pendingGitAction`，窗口关闭即丢弃。

```ts
type PendingGitAction =
  | { type: "clone"; input: CloneInput; host: string; port: number | null; protocol: "http" | "https" | "ssh" }
  | { type: "pull" | "push" | "sync"; repositoryId: string; host: string; port: number | null; protocol: "http" | "https" | "ssh" }
```

## Main Process Architecture

新增服务：

```text
desktop/electron/services/git-client/git-access-service.ts
```

职责：

- 读取 credential helper。
- 配置 credential helper。
- 保存 HTTP/HTTPS 凭证。
- 按协议和 host/port 清除 HTTP/HTTPS 凭证。
- 解析 remote URL 的 protocol、host、port、username 和 provider。
- 生成 SSH 公钥。
- 测试 SSH 连接。
- 返回 provider 对应外部页面。

新增 IPC：

```text
synapse:git:access:check
synapse:git:access:configure-credential-helper
synapse:git:access:save-https-credential
synapse:git:access:clear-https-credential
synapse:git:access:generate-ssh-key
synapse:git:access:test-ssh-connection
synapse:git:access:open-provider-page
```

Bridge 增加：

```ts
window.synapse.git.checkAccess(...)
window.synapse.git.configureCredentialHelper(...)
window.synapse.git.saveHttpsCredential(...)
window.synapse.git.clearHttpsCredential(...)
window.synapse.git.generateSshKey(...)
window.synapse.git.testSshConnection(...)
window.synapse.git.openProviderPage(...)
```

## Renderer Architecture

新增组件：

```text
desktop/src/modules/git/components/git-install-panel.tsx
desktop/src/modules/git/components/git-access-panel.tsx
desktop/src/modules/git/components/git-credential-dialog.tsx
desktop/src/modules/git/components/git-ssh-key-dialog.tsx
```

新增 hook：

```text
desktop/src/modules/git/hooks/use-git-access.ts
desktop/src/modules/git/hooks/use-pending-git-action.ts
```

`GitModule` 负责：

- 新增 `安装 Git` 和 `访问` Tab。
- Git 缺失时自动切到 `安装 Git`。
- 接收克隆、同步、拉取、推送失败后的处理请求。
- 在访问处理完成后提供重试原操作。
- 继续复用现有 `SystemAppWindowShell` 居中顶栏，不新增独立窗口标题或第二套导航。

`GitCloneDialog` 负责：

- 继续识别 HTTPS/SSH。
- 提交失败后按错误类别打开对应修复入口。
- 缺身份时弹身份设置，而不是让 clone 直接失败。
- 认证失败时保留仓库地址和保存位置，避免用户修复后重新填写。

`GitRepositoryList` 和 `GitWorkbench` 负责：

- 对认证、SSH、路径、网络等失败显示主操作。
- `处理访问` 切到 `访问` Tab 并带上 host、protocol 和 pending action。

实现约束：

- 不新增第二套 Git 应用壳层。
- 不把访问修复做成只有弹窗、没有 Tab 状态的临时流程。
- 不把错误分类散落在 JSX 内联判断里。
- 不把业务逻辑写在 JSX 中；remote 解析、provider 判断、错误归因和 action plan 应放在 `lib/` 或 hook 中。
- 不让 `useGitOperations` 继续只暴露一个全局字符串错误；它应返回最近失败的结构化结果，并允许组件定位到仓库或 clone input。
- 不新增不可触达 IPC；每个新增 bridge 方法必须在 `安装 Git`、`访问`、克隆弹窗、仓库列表或工作台中至少有一个用户入口。

## Provider Rules

第一期内置 provider 识别：

```text
github.com      GitHub
gitee.com       Gitee
gitlab.com      GitLab
```

GitHub HTTPS：

- 推荐浏览器登录/Git Credential Manager。
- 支持访问令牌。
- 支持改用 SSH。
- 不显示账号密码登录。

GitHub SSH：

- 复制公钥。
- 打开 GitHub SSH Key 页面。
- 测试 `git@github.com`。

Gitee/GitLab：

- SSH 提供复制公钥、打开 SSH Key 页面和测试连接。
- HTTPS 使用通用账号密码或访问令牌处理，不显示平台专属登录。

未知 host：

- HTTPS/HTTP：用户名密码或访问令牌。
- SSH：复制公钥、测试连接、复制诊断。

## Copy Rules

UI 文案只保留状态、动作和必要错误。

允许：

```text
未检测到 Git
打开下载页面
安装完成后重新检测
已安装
未登录
认证失败
登录仓库
保存并重试
清除凭证
生成 SSH 公钥
复制公钥
测试连接
```

禁止：

```text
Git 是一个分布式版本控制系统
该页面用于帮助您管理 Git 环境
为了提升您的开发效率
请根据您的操作系统执行以下复杂步骤
作为您的智能助手
```

按钮使用动作词，不使用模糊的 `确定`。

## Security And Logging

- 密码和访问令牌只在用户提交时进入一次 IPC 请求。
- Renderer 提交后立即清空敏感表单状态。
- Main 进程调用 Git credential 后不保留敏感值。
- 日志、错误、诊断和导出必须脱敏 token、password、Authorization、Bearer、Cookie 和带凭证 URL。
- `toolInput` 或权限摘要里的脱敏文本不得回流为真实凭证输入。
- SSH 私钥内容不得读取、显示、复制或写入诊断信息。
- 复制诊断信息可以保留普通本地路径，但不得包含 secret。
- `git-credential-store` 明文存储不得作为默认推荐项。

## Accessibility And UI Constraints

- 使用现有 shadcn/Radix 组件：`Tabs`、`Card`、`Alert`、`Button`、`Badge`、`Dialog`、`Input`、`Label`、`Table`。
- 不写自定义颜色、hex/rgb/hsl、Tailwind 任意颜色值、渐变、glow、emoji heading。
- 不做卡片套卡片。
- 状态不能只靠颜色表达，必须有文字和图标或 badge。
- 数字列右对齐，路径和错误详情允许选择和复制。
- 敏感输入框使用 password 类型，并提供清晰 label。
- 弹窗关闭不代表同意；用户取消后原操作停止。

### Dialog Rules

所有弹窗必须使用项目现有 shadcn/Radix 弹窗组件：

- 表单、登录、访问令牌、生成 SSH 公钥、选择项使用 `Dialog`、`DialogContent`、`DialogHeader`、`DialogTitle`、`DialogFooter`。
- 危险确认、清除凭证、覆盖或删除类确认使用 `AlertDialog`、`AlertDialogContent`、`AlertDialogHeader`、`AlertDialogTitle`、`AlertDialogDescription`、`AlertDialogFooter`。
- 不允许自制 modal、手写 fixed overlay、手写 focus trap、手写关闭按钮。
- 不允许绕过 `desktop/src/components/ui/dialog.tsx` 和 `desktop/src/components/ui/alert-dialog.tsx`。

实现前必须参考现有弹窗代码：

```text
短表单：
desktop/src/modules/git/components/git-clone-dialog.tsx
desktop/src/modules/git/components/git-branch-switcher.tsx

可滚动表单：
desktop/src/components/form-dialog.tsx
desktop/src/modules/database/components/table-schema-sheet.tsx

历史/列表内容：
desktop/src/modules/workflow/components/run-history-dialog.tsx
desktop/src/modules/automation/components/automation-runs-dialog.tsx

确认弹窗：
desktop/src/modules/git/components/git-repository-list.tsx
desktop/src/modules/git/components/git-environment-panel.tsx
desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx
```

布局要求：

- 普通短表单使用 `sm:max-w-md` 或 `sm:max-w-lg`，不要让默认窄弹窗承载多列复杂内容。
- 复杂或长内容弹窗使用 `max-h-[calc(100vh-2rem)]` 或 `max-h-[calc(100vh-4rem)]`，并把 `DialogContent` 设为 `overflow-hidden`。
- 长内容必须在弹窗内部使用 `ScrollArea`，footer 保持可见，不允许整个弹窗被内容撑出视口。
- 表单 footer 使用 `DialogFooter`，操作按钮在移动端可换行，桌面端右对齐。
- 弹窗中的路径、host、错误详情必须使用 `min-w-0`、`break-all`、`truncate` 或内部滚动处理，不能挤压按钮和表单字段。
- 访问令牌、密码、长 URL、SSH 公钥、Git stderr 等长文本不得撑宽弹窗。
- 弹窗关闭时，如果正在保存、生成 key、测试连接或写凭证，不得误判为同意；取消后停止后续敏感操作。
- `DialogDescription` 只用于必要的可访问说明；没有可见说明时按现有写法设置 `aria-describedby={undefined}` 或使用 `sr-only` 描述，避免多余界面文案。

## Testing Plan

Main process tests:

- Git 缺失返回安装状态。
- credential helper 读取和配置。
- 保存 HTTPS 凭证调用 Git credential approve。
- 清除 HTTPS 凭证调用 Git credential reject。
- 保存凭证日志不包含密码、token 或带凭证 URL。
- GitHub host 识别不显示账号密码路径。
- 公司 host 走通用账号密码路径。
- SSH 公钥检测、生成、指纹解析。
- SSH 测试失败返回可显示状态。
- Git 错误分类覆盖认证失败、SSH publickey、仓库不存在、网络失败、超时、目录缺失、非 Git 仓库、dirty、non-fast-forward、conflict。
- 错误分类结果包含用户标题、主操作、host、protocol 和脱敏 detail。

Renderer tests:

- Git 缺失自动切到 `安装 Git`。
- `安装 Git` 在 Windows/macOS 打开对应官方页面。
- Linux 显示暂不支持图形化引导。
- GitHub HTTPS 显示 `浏览器登录`、`使用访问令牌`、`改用 SSH`。
- 公司 HTTP/HTTPS 显示用户名密码弹窗。
- SSH 无公钥显示 `生成 SSH 公钥`。
- 认证失败显示 `处理访问`。
- 保存凭证后显示 `重试克隆` 或 `重试同步`。
- 敏感输入提交后清空。
- 复制诊断信息不包含 canary secret。
- 克隆失败时错误显示在克隆弹窗内，并保留仓库地址和保存位置。
- 仓库列表同步失败时错误在列表可见，对应仓库行有处理入口。
- 工作台推送失败时错误在工作台可见，并提供处理入口。
- 同一类认证错误在克隆弹窗、仓库列表、工作台使用同一标题和主操作。
- 新增 bridge 方法都有对应 UI 入口测试，避免存在不可触达功能。
- 登录、访问令牌、生成 SSH 公钥、清除凭证等弹窗均使用 shadcn `Dialog` 或 `AlertDialog` 组件。
- 长 host、长路径、长 URL、长错误详情不会撑宽弹窗或挤压 footer 按钮。
- 长内容弹窗在桌面和窄窗口下都有内部滚动，footer 始终可见。

## References

- Git credentials: https://git-scm.com/docs/gitcredentials
- Git Credential Manager: https://github.com/git-ecosystem/git-credential-manager
- GitHub authentication: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github
- GitHub credential caching: https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git
- GitHub set up Git: https://docs.github.com/en/get-started/git-basics/set-up-git
