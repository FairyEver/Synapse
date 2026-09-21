# 手机端终端 · Git 操作 · 实施计划

> 权威设计见 `docs/superpowers/specs/2026-09-21-mobile-terminal-git-design.md`。**决策、非目标、验收基线都以它为准**，本文件只回答「分几步做、每步改哪、怎么验」。
> 界面原型：`docs/prototypes/2026-09-21-mobile-terminal-git.html`（仓库内路径）。
> 每个阶段结束都要能单独验证。阶段完成就提交，只提交本阶段的文件。
> 文档里的行号是写它的那天（2026-09-21）核过的，实施时会漂移 —— **先核对再动手**。

## 总览

| 阶段 | 内容 | 主要文件 |
|---|---|---|
| 0 | 开工前核对 | — |
| 1 | 让 shell 上报当前目录（OSC 7 钩子） | `terminal/main/agent-notification-service.ts` |
| 2 | cwd 探测兜底 | `terminal/main/`、`electron/services/mobile-gateway/` |
| 3 | 按目录跑 git 的服务 | 新增 `electron/services/terminal-git/` |
| 4 | 协议：`git` intent + `mobile.gitStatus` | `shared/src/`、`mobile-gateway/`、**`server/src/`（两处）**、`LiveProtocol.swift` |
| 5 | 手机端：第二行、⋯ 菜单、状态存储 | `TerminalScreen.swift`、`SynapseAppModel.swift` |
| 6 | 手机端：Git 面板与各子页 | 新增 `Features/Terminal/Git/` |
| 7 | 规则文档、发布说明、收尾 | `docs/agents/*`、`RELEASE_NOTES_PENDING.md` |

**阶段 1 与阶段 3 可以并行**，它们不相干。**阶段 4 必须等 3**。**阶段 5、6 必须等 4，且必须先部署服务端**（见 §升级顺序）。

---

## 升级顺序（贯穿全程的硬约束）

新的 intent kind 与新的下行消息都进共享校验表。**旧服务端遇到不认识的 intent kind 或消息类型，会直接切断整条连接** ——
用户看到的是「设备莫名离线」，日志里只有一句校验失败。两处的断连代码：

- 旧服务端遇新 intent：`server/src/mobile-live/mobile-live.gateway.ts:392-400` →
  `:260-263` 的 `socket.close(1003, "invalid_message")`。
- 旧服务端遇新下行消息：`server/src/live/live-desktop.gateway.ts:824` → `:400-405` 同样的 1003
  —— **这一条断的是电脑，不是手机**，症状更隐蔽。

反过来是安全的：新服务端 + 旧客户端没问题（旧手机不认识的 type 在
`RealtimeClient.swift:404` 静默 return，不断连）。

所以真正上线时：**服务端 → 桌面端 → 手机端**，一步都不能颠倒
（`docs/releases/v1.0.3.md:119,123` 与 `docs/superpowers/plans/2026-09-17-terminal-shortcut-sync.md:43` 都写着同一条）。
阶段 4 改完 `shared/` 之后，把它单独部署一次再往下走。

---

## 阶段 0：开工前的核对

- [ ] 读 `产品设计文档.md` §2「现状」，逐条在代码里核对。**§2.2 和 §2.4 是决定方案形态的，必须亲自确认。**
- [ ] `pnpm --filter @synapse/desktop run check:hard-constraints` 先跑一遍，确认基线是绿的。
- [ ] 确认 Terminal MCP 工具数量基线是 **49**，收尾时要还是 49。
- [ ] 确认 `desktop/electron/services/git-command.ts` 与 `git-client/` 的实际位置与文件名（本轮以 `git-command.ts` 在 `services/` 下、`git-command-runner.ts` 在 `git-client/` 下为准）。
- [ ] 从 `desktop/app-capabilities/terminal/main/service.ts` 导出面上确认 `getCurrentWorkingDirectory` 可用（约 `:3437`，返回对象约 `:3486`）。
- [ ] 确认这四件事**一件都不做**：不注册 MCP capability/tool、不注册 System App/Dock/Workflow Node/Automation Action/Deep Link、不碰 `app.git.*` 既有 IPC 面、不产生「代码仓库」条目。

**称谓注意**：`app-capabilities/` 下的文件用相对路径 import，不用 `@/` 别名；`electron/services/` 下的按该目录既有风格。

---

## 阶段 1：让 shell 上报当前目录（OSC 7 钩子）

**这是整轮的根。** 没有它，第二行显示的是会话创建时的目录，而不是用户 `cd` 到的地方（见设计文档 §2.2）。

### 1.1 现状：生产端不存在

消费端已经好了，不要动它：`terminal/main/emulator.ts:131-144` 注册了 OSC 7 处理器，
解析出来写进 `currentCwd`，变化时才回调 `onWorkingDirectoryChanged`；
`service.ts:1026-1039` 据此 emit `workingDirectoryChanged`（会话「未发布」期间不发事件，但 `currentCwd` 已经更新，所以 `getCurrentWorkingDirectory` 仍是对的）。

缺的是**让 shell 主动发**。macOS 自带的发射器在 `/etc/zshrc_Apple_Terminal`，而 `/etc/zshrc` 只在
`$TERM_PROGRAM` 匹配时才 source 它 —— Synapse 把 `TERM_PROGRAM` 设成了 `Synapse`，所以那个文件永远不会被加载。

### 1.2 **三条必须先知道的硬约束**

1. **URL 必须空主机名。** `emulator.ts:135` 直接调 `fileURLToPath(url)`。
   实测：`file:///tmp/a` 与 `file://localhost/tmp/a` 都可以；**`file://myhost/tmp/a` 会抛
   `ERR_INVALID_FILE_URL_HOST`，被 handler 的 `return false` 静默吃掉**。
   所以生产端只能写 `file://$PWD`（`$PWD` 以 `/` 开头，拼出来天然是三个斜杠），
   **绝对不要按 iTerm2 的惯例拼 `$(hostname)`**。
2. **唯一能同时改 env 与 shellArgs 的钩子是 `agent-notification-service.ts:349-408` 的 `prepareSession`**，
   调用点 `terminal/main/service.ts:1277-1303`（`integration?.env ?? launchEnvironment`）。
   没有第二个扩展点。
3. **但那个钩子现在被「agent 原生通知」开关短路**：`agent-notification-service.ts:356`
   在 `settings.enabled` 为假时直接 `return null`。**用户不开 agent 通知就完全没有 shell 集成。**

### 1.3 做法：把「shell 集成」与「agent 通知开关」解耦

不新建服务，改造既有的那个。`prepareSession` 的返回类型 `TerminalAgentLaunchIntegration`
（`agent-notification-service.ts:70-73`，`{env, shellArgs?}`）一个字不改，只改它什么时候返回什么。

**拆开的判据**：

| 部分 | 什么时候注入 |
|---|---|
| **OSC 7 上报** | **总是**（只要 shell 认得出） |
| PATH shim / 官方 Hook（agent 通知） | 仍然只在 `settings.enabled` 为真时 |

具体：

- 外层门控从 `settings.enabled && binding && runtime` 改成**只看 `runtime`**。
  **不能要求 `binding`**：它只在通知打开时才建（`startIngress` 要占一个 loopback 端口），
  要求它会让关掉通知的人永远进不来，与「OSC 7 总是注入」直接冲突；通知相关的部分另用
  `settings.enabled && binding` 判。
  —— 注意 `runtime` 原本是随通知功能建立的，**要让它在通知关闭时也建立**。
- `enableRuntime()` / `ensureRuntimeFiles()`（`:470-520`）里那次 `permissionGuard.check({action:"fs.write",
  resource: runtimeDir})` 保持不变 —— 现在它成了每条 PTY 都要过的路，**确认它在通知关闭时也会被调用**。
- zsh 启动文件（`zshStartupFiles()`，`:930-954`）：四个文件里**总是**追加 OSC 7 的 `precmd` 钩子；
  PATH 前置那两行按 `settings.enabled` 取舍。用户原本的 `.zshenv/.zprofile/.zshrc/.zlogin`
  照旧被 source（`:945-952`），这条**一个字都不能动**。
- bash（`bashIntegrationScript()`，`:956-968`）：同样处理，用 `PROMPT_COMMAND`。
- fish（`:399-400` 的 `--init-command`）：同样处理，用 `fish_prompt`。
- pwsh / cmd / 其它：**不动**，交给阶段 2 的兜底。

**OSC 7 的 shell 写法**（三处语义一致，注意结尾用 BEL `\a`）：

```sh
# zsh：放进 precmd 钩子。**结尾用 BEL（`\a`）**，与 /etc/zshrc_Apple_Terminal 一致。
_synapse_report_cwd() { printf '\033]7;file://%s\a' "$PWD" }
autoload -Uz add-zsh-hook 2>/dev/null && add-zsh-hook precmd _synapse_report_cwd
```

**不要重复注册**：如果用户自己的配置已经在发 OSC 7（比如他自己装了类似的钩子），
再挂一个只是多发一次 —— 消费端 `emulator.ts:136` 有 `nextCwd !== currentCwd` 的去重，代价可接受。
但钩子名要固定，重复 source 时用 `add-zsh-hook` 的幂等性兜住。

### 1.4 已知的接受面（写进代码注释，别让后人以为是 bug）

- **只对新开的 PTY 生效**，已开着的会话拿不到（env 在 spawn 时就定型了）。
- 沿用 `module-boundaries.md:61` 已经写明的限制：**绝对路径调用、远程 Shell、主动重置 PATH 的情况不承诺接入**
  —— 这些交给阶段 2。
- 生成的文件**关闭后不清理**（既有行为，本轮不改）。

### 1.5 测试

**照抄现成的范式**：`terminal/main/__tests__/agent-notification-service.test.ts:129-167`
已经在临时 `HOME` 里写真实 `.zshrc`、调 `prepareSession`、再 `spawnSync("/bin/zsh", ["-i","-c", ...])`
验证用户的 alias 与 PATH 都生效。**这是现成的「shim 不破坏用户 rc」集成测试，本轮要在它旁边加同款**。

- **不破用户配置**：注入之后，用户在 `.zshrc` 里定义的 alias / 函数 / PATH 仍然生效（复用上面那条范式）。
- **通知关闭时也注入**：`settings.enabled = false` 时 `prepareSession` 仍然返回带 `ZDOTDIR` 的 env。
- **通知关闭时 PATH 没被动过**：同样的用例里断言 shim 目录**不在** PATH 里。
- **发出的序列能被消费端解析**：把 shell 打印的那串字节喂给 `createTerminalCoreEmulator`，
  断言 `currentCwd` 变成 `$PWD`。**这条是关键** —— 它把「shell 发什么」和「模拟器认什么」钉在一起，
  空主机名那一条就是在这里守住的。
- **反证（必须做）**：把 URL 改成带 hostname 的形式，上面那条断言必须红。
  只断言「发了 OSC 7」的测试在带 hostname 时也是绿的 —— 而那正是会被静默丢弃的那一种。
- **反证二**：把 `settings.enabled` 重新塞回外层门控，第二条断言必须红。
- **不污染显示**：喂 `accept("]7;file:///x[Hhi")` 之后，
  断言序列化出来的屏幕**只含 `hi`**。既有的 `emulator.test.ts:31-48` 只断言了 `currentCwd`，
  **没有**断言「不显示」—— 这条是新增的。

### 1.6 完成标准

- 在 Synapse 终端里 `cd /tmp`，桌面端文件树（打开时）的根目录跟着变 —— 这是**不碰手机就能看到**的证据。
- 设置里**关掉** agent 原生通知，重开一个终端，上面这条仍然成立。
- `pnpm --filter @synapse/desktop run test` 全绿。

---

## 阶段 2：cwd 探测兜底

阶段 1 覆盖不到的时候（自定义 shell、Windows 的 pwsh/cmd、用户主动重置了 PATH），
直接去问一次 PTY 子进程的当前目录。

**这一阶段是整轮里最不确定的一块**，动手前先把 2.1 的接点确认清楚。

### 2.1 可用的接点

- **按 PTY 反查进程**：`terminal/main/service.ts:119-125` 的 `PtyLike.ptsName`，注释里已经写明
  「外部可以 `ps -t <设备名>` 反查进程」；`getSessionState` 的 `tty` 字段（约 `:3149`）已经把它露出来了。
  但**探测代码一行都没有** —— 全仓 grep `lsof` 只有测试里的字符串。
- **受控进程执行器**：`electron/runtime/process/controlled-runner.ts`，
  `createControlledProcessRunner({permissionGuard, auditSink, …})`，
  `run(request)` / `start(request)`；**权限检查在 `:230-235`**。
  它的 `request.action` **只能取 `"agent.spawn" | "shell.exec"`**（`ControlledProcessAction`，`:60-63`）。
- **`core.terminal` 描述符没有这些依赖**：`bootstrap/descriptors.ts:481-484` 只注入了
  `core.data-repository` 与 agent-notification。要探测就得先加依赖。

### 2.2 做法

1. **新增一个窄动作，不要复用 `shell.exec`。**
   往 `ControlledProcessAction` 加一个 `"process.cwd_probe"`，请求里只允许出现
   `tty`（或 pid）与固定的 `lsof` argv。理由：`module-boundaries.md:68` 明令
   「不得新增通用 `shell.exec`……旁路」—— 把一个通用执行动作接进 terminal 侧，
   等于给终端开了一条谁都能用的命令通道。窄动作没有这个面。
   > 若评审认为加动作过重，退路是走既有的 `shell.exec`（actor 为 system 时被
   > `systemShellExecPolicy` 放行，不会弹权限），但**必须在代码注释里写明它只跑固定的 lsof**。
2. **给 `core.terminal` 描述符补依赖**：`core.permission-guard`、`core.audit-sink`、进程运行时。
   注意 `bootstrap/index.ts` 不导出 git descriptors 的既有约定，改的是 `descriptors.ts` 与 `registry.ts` 两处。
3. **探测实现**放 `terminal/main/working-directory-probe.ts`：
   - 先 `ps -t <tty> -o pid=` 拿前台 pid（拿不到就退回 PTY 子进程 pid）；
   - 再 `lsof -a -d cwd -p <pid> -Fn` 解析出 cwd；
   - **带 3 秒硬超时**（照 `diagnostics-service.ts:1672` 的 `timeout: 3000` 那种写法）；
   - 失败一律**返回 null，不抛** —— 兜底失败不是错误，阶段 1 的结果仍然有效。
4. **接到 `getCurrentWorkingDirectory`**：实现改成「先读 `emulator.currentCwd`；为空则**按需**探测并缓存」。
   - **缓存必须带失效条件**，否则 `cd` 之后就永远是第一次那个值 —— 缓存键是
     「该 session 的 PTY 输出水位」，输出一动就重探。
   - 只在**有人问**的时候才探（手机 attach、打开 Git 面板、面板下拉刷新），**不做定时轮询**。

### 2.3 测试

- 用一个假 PTY（`spawnImpl` 注入）返回固定的 `ps` / `lsof` 输出 → 解析出正确路径。
- `ps` / `lsof` 返回空、返回垃圾、超时三种情况 → 都返回 null，**不抛**。
- 水位不变时只探一次（用假执行器计数）；水位变了重探。
- **反证**：把水位判断去掉，断言「同一水位下第二次询问也去执行了一次命令」——
  也就是证明缓存确实在拦，而不是测试恰好只问了一次。
- 权限被拒时（`permissionGuard.check` 抛）→ 返回 null，且**有一条 audit 记录**。

### 2.4 完成标准

- 在**探测路径单独生效**的情况下（临时把阶段 1 的钩子关掉来造这个条件），
  `getCurrentWorkingDirectory` 在 `cd` 之后返回新目录。
- 关掉阶段 1 的钩子时，`pnpm --filter @synapse/desktop run test` 仍然全绿（证明兜底真的兜住了）。

---

## 阶段 3：按目录跑 git 的服务

**新增一个服务，只认路径，不认识 `repositoryId`、不碰注册表。**（设计文档决策二）

### 3.1 放哪、怎么装配

新增 `desktop/electron/services/terminal-git/`（目录，不是一个文件 —— 状态/分支/集成三块各自成文件）。

装配要改**三处**（照 git 那一批的既有做法）：

1. `electron/bootstrap/descriptors.ts` 的 import 段（git 那批在约 `:256` 之后）；
2. `descriptors.ts` 里新增 `export const …Descriptor`（放在 git 那批之后，约 `:2925`）；
3. `electron/bootstrap/registry.ts` 的 import（`:91-102`）与 `registry.register(…)`（`:191-203`）。

`bootstrap/index.ts` **不用改**（它本来就不导出 git descriptors）。

### 3.2 底座：直接用既有的执行与解析，不要重写

- **命令执行**：`desktop/electron/services/git-command.ts` 的 `runGitCommand({cwd, args, …})`
  —— `cwd` 本来就是必填的任意目录，`spawn("git", args, {cwd})` 是 argv 数组，
  且已经设了 `GIT_TERMINAL_PROMPT=0` 与 `LANG/LC_ALL=C`。
  **它的安全策略在 bootstrap 一次性接好了**（`descriptors.ts:1142-1145` 的 `configureGitCommandSecurity`，
  actor 为 system、走 `systemShellExecPolicy`）—— 也就是说**只要走它，权限与审计自动就过了**，不需要为核心路径再写一遍。
  上层封装用 `git-client/git-command-runner.ts` 的 `createGitClientCommandRunner({logger, runGitCommand})`，
  它默认 60s 超时。
- **状态解析**：`git-client/git-status-parser.ts` 的 `parseGitStatusPorcelainV2(stdout)`（`:348`）
  与流式版 `createGitStatusPorcelainV2Parser`（`:287`）都是纯函数，**不碰 repository / registry**，直接拿来用。
  命令固定为 `status --porcelain=v2 -z --branch --untracked-files=all`（照 `git-status-service.ts:158-161`）。

**超时单独定**：同步类操作慢，给它单独的值（参考 `git-sync-service.ts` 的 120s），不要用默认 60s。

### 3.3 各动作怎么做

| 动作 | 做法 |
|---|---|
| 读状态 | `status --porcelain=v2 -z --branch --untracked-files=all` + 解析器。**先 `rev-parse --show-toplevel` 判断是不是仓库**，不是就返回「不是仓库」。 |
| 列分支 | `for-each-ref --format=%(refname:short) refs/heads` + `symbolic-ref --quiet --short HEAD`（照 `git-branch-service.ts:92-120`）。**只返回名字与是否当前** —— 手机端不需要更多。 |
| 切分支 | 校验分支名 → `checkout`。**脏工作区不在这里拦**（见下）。要丢弃时才带 `-f`。 |
| 新建分支 | 校验分支名 → `checkout -b <新名> <起点>`。 |
| 提交 | `add -A` + `commit -m <信息>`。**一律全量**，不挑文件（设计文档决策七）。 |
| 推送 | 有上游 → `push`；没有上游 → `push --set-upstream origin <分支>`（照 `git-sync-service.ts:146-155` 的形态）。 |
| 同步 | 照 `git-sync-service.ts:324-400` 的语义：**先脏检查→有上游检查→`fetch --prune`→`merge --ff-only @{u}`→有领先再 `push`**。 |
| 合并 | **新写**，见 3.4。 |

**`mergeUpstream` 不能直接复用**：`git-sync-service.ts:68-85` 把目标写死成 `@{u}` 且带 `--ff-only`。
同步那条路照旧用它；合并走新函数。

**`assertAutomaticIntegrationAllowed`（`:487-496`）不可复用** —— 它的语义是「禁止分叉时自动集成」，
与「合任意分支」不是一回事。合并要另写守卫。

### 3.4 合并（本轮唯一的新算法）

**一条铁律：进入 merge 之前先记录「合并前状态」，冲突时用它证明回退了。**

```
merge(direction, branch):
  cur = 当前分支（detached 时直接拒绝：「游离状态下不能合并」）
  若 direction == "outOfCurrent":
      目标 = branch；来源 = cur
  else:
      目标 = cur；来源 = branch

  1. before = 取一次状态快照            ← 冲突回退后的比对基准
  2. 若目标 != cur：切到目标（这一步同样要过脏检查，见下）
  3. 跑 git merge <来源>（不带 --ff-only，允许产生合并提交）
  4a. 成功：
      - direction == "outOfCurrent" → 切回 cur
      - 返回成功
  4b. 冲突（退出码非 0 且状态里 `hasConflicts`）：
      - 立刻 git merge --abort
      - 若 direction == "outOfCurrent" → 切回 cur
      - 再取一次快照，**断言与 before 一致**（不一致就如实报告，不要假装回退了）
      - 返回冲突结果：来源、目标、冲突文件列表（从快照的 `changes` 里筛 conflicted）
  4c. 其它失败（比如未跟踪文件会被覆盖）：abort（如果 merge 已经起来）+ 切回 cur + 原样返回 stderr
```

**冲突文件的来源**：`git-status-parser.ts` 已经能把 `UU`/`AA` 这类解析成 `status: "conflicted"`
（`:127-128`、`:197-207`）。从快照的 `changes` 里筛出来即可，不用另跑命令。

**「一段拼好的文本」由这一层生成**，手机端不解析文件清单（设计文档决策六）。
格式见设计文档决策九 —— 那是给别的 Agent 读的，措辞要完整。

### 3.5 脏工作区与两个「带副作用」的切换

- **脏检查放在这一层，不放在 UI**：切分支、新建分支、合并方向二的第一次切换，都先取快照；
  `changeCount > 0` 时不自己决定怎么办，**返回一个「需要用户决定」的结果**（而不是抛错），
  由手机弹出三个选项。
- **「丢弃改动并切换」= `checkout -f`**，**不加 `clean`**。
  未跟踪文件**必须留着**（设计文档决策十）—— 这是这一阶段最容易做过头的一处。
- **「提交并切换」不在这里做成一个复合动作**：手机先发 `commit`，成功了再发 `checkout`。
  复合动作会让「提交失败」和「切换失败」共用一个结果，手机分不清该报哪一句。

### 3.6 测试

- **每个动作一个用例**，用真实的临时 git 仓库（`mkdtemp` + `git init`），不要 mock `git`。
- **不是仓库的目录** → 读状态返回「不是仓库」，其余动作一律拒绝且**不执行任何命令**。
- **子目录**：在仓库的子目录里读状态，结果与在根目录一致（git 自己会往上找）。
- **分支名校验**：`../x`、`a b`、`-x`、空串 → 拒绝且**不执行命令**。
- **合并成功**：造两条分支，合并后断言目标分支上能看到来源的提交。
- **合并冲突**（最重要的一条）：造两条改同一行的分支 →
  - 断言返回了冲突结果；
  - 断言 `git status` 里**没有** `MERGE_HEAD`（即 abort 干净了）；
  - 断言快照与合并前**逐字段一致**（分支、改动数、领先落后）；
  - 断言冲突文件列表与真实冲突文件一致。
- **方向二**：冲突后断言**回到了原分支**；成功后也断言回到了原分支。
- **反证（必须做）**：去掉 `merge --abort`，上面「没有 MERGE_HEAD」与「与合并前一致」两条必须红。
  只断言「返回了冲突」的测试在没 abort 时也是绿的。
- **另一条反证**：把 `checkout -f` 改成 `checkout -f` + `clean -fd`，
  「未跟踪文件仍然存在」那条断言必须红。
- **脏工作区**：返回「需要用户决定」，且**没有动过工作区**（比对前后快照）。
- **不产生仓库条目**：跑完所有动作后断言 `repositories.json` **没有被创建或修改**。
  这条是设计文档决策二的守门人。

### 3.7 完成标准

- 全部用例用真实仓库跑通。
- `repositories.json` 在测试前后逐字节一致。
- 桌面端 Git 工作台的所有既有测试**一条都不用改**（这就是「没碰它」的验收）。

---

## 阶段 4：协议

### 4.1 上行：一个 `git` intent

`shared/src/mobile-live.ts:774` 的 `MobileIntent` 联合新增一种（**不新增九个**，设计文档决策十一）：

```ts
| (MobileIntentEnvelope<"git"> & {
    readonly sessionId: string
    readonly action:
      | "status" | "branches" | "checkout" | "createBranch"
      | "commit" | "push" | "sync" | "merge"
    readonly branch?: string          // checkout / createBranch / merge
    readonly fromBranch?: string      // createBranch 的起点
    readonly message?: string         // commit
    readonly pushAfterCommit?: boolean
    readonly direction?: "intoCurrent" | "outOfCurrent"   // merge
    readonly discardChanges?: boolean // checkout 的「丢弃改动并切换」
  })
```

**`action` 必须是枚举，不接受任意命令字符串。** 这是 `module-boundaries.md:68`
「不得新增通用 shell.exec」在协议层的落点 —— 这条要写进类型上的注释。

**还要同步改三处，漏掉任何一处都有明确症状**：

| 位置 | 漏掉的后果 |
|---|---|
| `isMobileIntent` 的校验分支（`:1155-1219`，写法是**逐 kind 的 `switch`**，`default: return false`） | 手机发的 intent 被判为非法 → 1003 断连 |
| `intent-executor.ts:919-938` 的 `UNFINISHED_OPERATION_MESSAGES` | **typecheck 直接失败**（它是 `Record<MobileIntent["kind"], string>`，少一个 key 就不完整）。这是唯一一个编译器会替你抓的地方，其余全靠人 |
| `MobileIntentResult` 加一个字段（见 4.3） | 结果回来了但手机读不到 |

`MobileIntentKind`（`:937`）是从联合派生的，不用手改。

**手机侧**：`LiveProtocol.swift:729-769` 的 `MobileIntentRequest` 是一个**扁平 struct、字段全是
`var Optional`**，靠 Swift 合成的 Codable 省掉 nil（`AgentConversationTests.swift:150-151`
明确断言「Omitted rather than null」）。加参数就是加 optional 字段。
手机端的 kind 是裸 `String`，**没有枚举要同步**。

### 4.2 下行：`mobile.gitStatus`

**不塞进 `mobile.summary`。** 理由不是字节预算，是**代价**：摘要在有输出时以 1 Hz 刷新，
而 git 状态要跑一次 `git status` —— 塞进去等于每秒 spawn 一次 git（`SUMMARY_INTERVAL_MS = 1_000`，
`mobile-gateway-service.ts:57`）。这条理由要写进注释。

形状（`shared/src/mobile-live.ts`）：

```ts
export interface MobileGitStatus {
  readonly cwd: string
  readonly branch: string | null        // null = 游离
  readonly detachedSha?: string
  readonly upstream: string | null
  readonly ahead: number
  readonly behind: number
  readonly changeCount: number
  readonly hasConflicts: boolean
}

export interface MobileGitStatusPayload {
  readonly desktopClientInstanceId: string
  readonly mobileClientInstanceId: string
  readonly sessionId: string
  readonly revision: number
  /** `null` = 这个目录不是 Git 仓库（第二行要退回显示版本号）。 */
  readonly status: MobileGitStatus | null
}
```

**新增一条下行消息要动五层，缺一层就是断连或静默丢弃**（以 `mobile.toolbar` 为范本）：

| 层 | 位置 |
|---|---|
| 共享契约（**四处**） | `shared/src/live.ts:16-34` 常量、`:97-107` 电脑上行联合、`:130-140` 手机下行联合、`:150-166` / `:186-202` 两个校验分支 |
| 共享 payload | `shared/src/mobile-live.ts` 的接口与校验器（照 `:667` / `:752` 与 `:1102` / `:1123`）。若需要新的尺寸上限，加进 `MOBILE_FRAME_LIMITS`（`:34` 起）**并同步** `shared/src/mobile-live-constants.cjs:105-120`（有一致性测试在 `mobile-live.test.ts:1014-1026`） |
| **服务端（两处，不是纯透传）** | `server/src/live/live-desktop.gateway.ts:68-108` 的 handler 接口、`:535-546` 的类型门、`:758-769` 的派发；`server/src/mobile-live/mobile-live-relay.service.ts:81-91` 的装配 + 一个 `handleGitStatus`（照 `:224-227` 的 `handleToolbar`）。**`:532-534` 的注释明确警告：漏在类型门那里会被静默丢弃、不报错** |
| 桌面网关 | `mobile-gateway/transport.ts` 的 Draft 类型与 `sendGitStatus`（照 `:65` 的 `sendToolbar`）；`live-connection-service.ts` 的 `sendMobileGitStatus`（照 `:434-442`）；`bootstrap/app-ready.ts:163-177` 的装配 |
| 手机 | `LiveProtocol.swift:23/29/37` 常量 + payload struct（照 `:573` / `:629` / `:688`）；`RealtimeClient.swift:112-117` 回调、`:373-384` 的 `knownMessageTypes`、`:447-458` 的 dispatch；`SynapseAppModel.swift:770-781` 接线 |

**不要动 `MOBILE_PROTOCOL_VERSION`**（`shared/src/mobile-live.ts:32`，值 `1`）。
它只在帧与 intent 两处比较，且手机端把 `1` **硬编码**在 `LiveProtocol.swift:730` ——
改成 2 会让所有老手机的帧和 intent 全部校验失败，等于同步断代。**加新消息不该动它。**

### 4.3 结果：状态走推送，其余走 `MobileIntentResult`

`MobileIntentResult` 目前**没有结构化数据字段**（只有 `code`/`message`/`landedPath` 这类为单个场景加的字段）。
本轮照同样的先例，加一个：

```ts
/** Set for `git`, for the two actions whose answer is data rather than a side effect. */
readonly git?: {
  readonly branches?: readonly { readonly name: string; readonly current: boolean }[]
  readonly conflict?: {
    readonly source: string
    readonly target: string
    readonly files: readonly string[]
    /** 给别的 Agent 读的整段文本，手机端只负责复制。 */
    readonly summaryText: string
  }
  /** 脏工作区，需要用户先选一个走法。 */
  readonly needsDecision?: "dirty"
}
```

**`status` 这个动作的回答不用看这里** —— 手机端的状态**永远**以 `mobile.gitStatus` 为准。
两个来源写同一件事，迟早会分叉。

### 4.4 什么时候推 `mobile.gitStatus`（**这是最容易做错的一处**）

`mobile-gateway-service.ts:332-340` 的注释写得明明白白：

> Four listeners here plus the six the terminal IPC layer registers lands at Node's default cap of ten;
> that is the whole budget, so this list should not grow.

**预算的证据**（写进代码注释，让下一个想加监听器的人先看见）：

| 谁 | 几个 | 在哪 |
|---|---|---|
| 网关 | 4 | `mobile-gateway-service.ts:345-348`（`data` / `stateChanged` / `sessionChanged` / `sessionDeleted`） |
| 终端 IPC 层 | 6 | `terminal/main/ipc.ts:122`(data) `:125`(sessionChanged) `:131`(sessionDeleted) `:134`(resized) `:137`(domainChanged) `:140`(**workingDirectoryChanged**) |

**4 + 6 = 10**，正好是 Node 默认上限；全仓 grep `setMaxListeners` 零命中。
**再加就是第 11 个。**

> 注意最后那一行：`workingDirectoryChanged` **已经被 IPC 层订阅了**，而且它就是我们要的那个事件。
> 也不能「搭它的车」—— 订阅一次就是一个监听器，跟是不是同一个事件无关。

**做法**（与 `flushToolbar` 搭 `flushSummary` 是同一个套路）：

1. **在既有的 `flushSummary()`（`:888`）里加一次调用**：紧挨着 `this.flushToolbar()`（`:894`）加
   `this.flushGitStatus()`。**不新增任何监听器。**
2. `flushGitStatus()` 里**先做一次廉价的目录比较**：对**被手机 attach 的**会话，
   把 `terminal.getCurrentWorkingDirectory(sessionId)` 与上次算过的值比一下。
   **只有变了（或从没算过、或被显式要求重发）才真的去跑 git。**
   这一条是必须的 —— 摘要在有输出时是 1 Hz（`SUMMARY_INTERVAL_MS = 1_000`，`:57`），
   不加这道闸就等于每秒 spawn 一次 git。
3. 真的去算时，照 `flushToolbar()`（`:841-857`）的形状写：
   **算内容 → 序列化 → 与上次相同就不发**，不同才推并递增 revision。空闲的桌面因此零流量。
4. **显式重发**照 `resendToolbar()`（`:860-863`）：`sync` 与 `attach` 两个时刻清掉记录再推一次
   —— 刚连上的手机什么都没收到。接到 `intent-executor.ts` 已有的 `sendToolbar` / `sendQuickPhrases`
   注入位上（`:200-202` 的 sync、`:233-234` 的 attach），**不新开时机**。

> **为什么能跟上 `cd`**：终端服务**每个输出 chunk 都会同时 emit `data` 和 `stateChanged`**
> （`terminal/main/service.ts:1062-1067`），网关的 `handleStateChanged`（`:434-448`）转手就调
> `scheduleSummary()` —— 所以「任何终端在打字时 1 Hz」这个心跳本来就活着，`cd` 之后的提示符重绘
> 一定落在它上面，**延迟 ≤1 秒**。
>
> `cd` 自己**不会** emit `sessionChanged`（那个只在 `updateSessionState` 里发），
> 所以目录变化没有任何专属事件可搭 —— 这是「搭 summary tick」而不是「搭目录事件」的原因。

### 4.5 权限与审计：两层，不要只做一层

**第一层已经现成，不用管。** 真正跑 git 的那条路（阶段 3 走 `git-command.ts`）已经被
`descriptors.ts:1142-1145` 一次性接上了受控执行器，actor 为 system、走 `systemShellExecPolicy`，
权限与审计自动有。**别为核心路径再写一遍。**

**第二层要新写：每个 intent 都必须自己 `authorize`。** 现有 19 个 kind 无一例外
（`terminal.discover` / `terminal.state.read` / `terminal.session.control` / …… / `fileUpload` 用的是
`fs.write.outside-userdata`，`intent-executor.ts:485`）。`git` 也必须有一个。

`PermissionAction` 的定义在 `runtime/security/permission-guard.ts:14-64`，**没有 `git.*`**。两条路：

| 走法 | 代价 | 评价 |
|---|---|---|
| **新增 `terminal.git.manage`**（推荐） | 改 `permission-guard.ts` 的枚举 + 对应 policy 表；读操作用既有的 `terminal.state.read` | **审计记录说的是实话**。「手机让电脑改动了用户的仓库」是这一轮新出现的一件事，借一个别的名字记，事后查审计的人会被误导 |
| 复用 `fs.write.outside-userdata` | 零改动 | 有 `fileUpload` 的先例，但它表达的是「落一个文件」，与「改一个仓库」差得远 |

`authorize` 的实现与三态审计（allowed / denied / failed 都落 `auditSink.record`）在
`mobile-gateway-service.ts:1408-1430` 与 `:1432-1449`，**照用，不要另起一套**。

> 顺带一个事实：既有的桌面 Git IPC（`electron/modules/git/ipc.ts`）**完全不走 PermissionGuard**
> （全文件 grep `authorize|audit|permission` 零命中）。**本轮不改它** —— 那是另一件事，混进来会让这个提交说不清。

### 4.6 手机侧会话目录顺手修一行

`mobile-gateway-service.ts:1102` 现在写的是 `session.cwd`（**创建时**的目录）。
改成 `this.terminal.getCurrentWorkingDirectory(session.id)` —— 一行，同步方法，没有额外 await。
顺手让摘要里的目录也变成实时的（阶段 1 之前它是陈旧的）。

### 4.7 测试

- `isMobileIntent` 对 `git` 的接受 / 拒绝各若干条（缺 `sessionId`、`action` 不在枚举里、`action` 是别的字符串）。
- **协议一致性**：`live.ts` 的四个位置各漏一处的话，对应的往返测试必须红（这是那四个位置的守门人）。
- **服务端那一层也要测**：漏在 `live-desktop.gateway.ts:535-546` 的类型门上会被**静默丢弃**，
  所以不能只断言「服务端没报错」—— 要断言**手机端真的收到了**。
- 权限：`git` 的写动作在权限被拒时返回拒绝结果，且 `auditSink` 里有一条 `denied`。
- `MobileGitStatusPayload` 的编解码往返。
- `flushGitStatus`：内容不变时**一个字节都不发**；变了发且 revision 递增；没有 attach 的会话不算。
- **反证**：把去重比对去掉，断言「同一内容连续 flush 两次」只发一次 —— 反过来说，去掉去重后这条必须红。
- **反证**：在 `flushSummary` 里把 `flushGitStatus` 换成新增一个 `terminal.events.on`，
  监听器总数必须超过 10（用 `events.listenerCount()` 断言）—— 这条测试的用途是**把预算这条约束钉死**，
  让下一个想加监听器的人先撞上它。
- intent 分派：八个 action 各自路由到 `terminal-git` 服务的对应方法（mock 服务，断言调用与参数）。

### 4.8 完成标准

- `pnpm --filter @synapse/desktop run check:hard-constraints` 通过，`shared` 与 `server` 的类型检查通过。
- `MOBILE_PROTOCOL_VERSION` **仍然是 1**。
- **先部署服务端**，再往下走（见文首「升级顺序」）。

---

## 阶段 5：手机端 —— 第二行、入口、状态存储

### 5.1 状态存储

照 `TerminalQuickPhrasesState` 的既有范式（`Features/Terminal/TerminalQuickPhrasesState.swift`）：
新增 `Features/Terminal/TerminalGitStatusState.swift`，`Equatable`，
带 `adopt(payload)` / `reset()`，并且**按「哪台电脑」比对归属**
（`SynapseAppModel.swift:30-33` 就是这么做的，`:483` 断开时 `reset()`，`:774` 收消息时 `adopt`）。

**必须区分「不是 Git 仓库」与「还没收到回答」** —— 这正是 `TerminalQuickPhrasesState`
用 `Optional` 而不是空数组的原因（它的注释把这条说得最清楚，照抄那个口径）。
前者第二行退回版本号，后者保持现状不动。

### 5.2 顶栏第二行

`Features/Terminal/TerminalScreen.swift:1073` 的 `titleBlock`。

现在的第二行是 `● statusLabel · AppVersion.label`。改成按状态三选一：

| 状态 | 第二行 |
|---|---|
| 没收到回答 / 不是仓库 | `● 运行中 · 1.0.16 (13)`（**现状，一个字不改**） |
| 是仓库 | `● <分支> · <N 个改动>`，见设计文档决策四的完整表格 |

- **圆点保留**（它是会话状态，与 Git 无关）。
- **`lineLimit(1)` 必须保持** —— 换行会多占一行，把终端挤矮（既有代码的注释已经写过这个理由）。
- 横屏那条 `compactTitleBlock`（`:1106`）**不动**：它本来就丢掉了版本文本，
  本轮不给它再加东西（横屏一行还要装下指令条）。

### 5.3 ⋯ 菜单

`TerminalScreen.swift:1122` 的 `moreMenu`，在那几个动作的最前面加一行 `Text("Git")`，
动作是打开面板。**不是 Git 仓库时这一行不渲染**（设计文档决策四）。

打开面板要调 `noteChromeActivity()`（`:1163`-ish 的既有写法），否则面板开着三条栏会被闲置收走。

### 5.4 完成标准

- 在终端里 `cd` 到 Git 仓库 → 第二行变成分支名与改动数。
- `cd` 到非仓库目录 → 第二行退回版本号。
- ⋯ 菜单里能看到 / 看不到「Git」。
- 关掉电脑上的 agent 通知再试一遍，行为不变。

---

## 阶段 6：手机端 —— Git 面板与各子页

### 6.1 放在哪

新增 `Features/Terminal/Git/`，一个屏幕一个文件：
`TerminalGitPanel.swift`、`TerminalGitBranchList.swift`、`TerminalGitNewBranch.swift`、
`TerminalGitCommit.swift`、`TerminalGitMerge.swift`、`TerminalGitConflictSheet.swift`、
`TerminalGitDirtySheet.swift`。

### 6.2 面板

`TerminalScreen.swift:1122` 的 ⋯ 菜单外面加一个 `.sheet`（照 `:752` 那个既有 sheet 的写法，
**并同样挂 `.noticeOverlay(model)`** —— sheet 会盖住页面的 overlay，那一处的注释写明了原因）。

**形态照 `TerminalShortcutPanel.swift` 抄**：`NavigationStack` + `.listStyle(.insetGrouped)` +
`.presentationDetents([.medium, .large])` + `.presentationDragIndicator(.visible)`。
**不要自创一套长得不一样的面板** —— 用户明确要求「符合苹果设计规范，不做特立独行的设计」。

内容与可用态见设计文档 §4.3。「分支」那一行既显示当前分支、也是进入分支列表的入口
（带 `›`），这是设置类应用的标准写法。

### 6.3 子页

各自 `push` 进 `NavigationStack`，规格见设计文档 §4.4–§4.9。几条硬要求：

- **凡是选分支的页面都必须有搜索框**（`.searchable`）—— 用户点名要求，三处都要：
  切换分支、新建分支的起点、合并的来源/目标。
- 空态用 `ContentUnavailableView`（照 `TerminalShortcutPanel.swift:243-252` 的做法，
  **标识符挂在说明那一行，不要挂在容器上** —— 那条注释写明了原因）。
- 反馈用 `Haptics.select()` / `Haptics.success()`。
- 关键控件加 `accessibilityIdentifier`，**命名沿用既有风格**（`toolbar-keyboard` / `shortcut-commands-empty` 这种）。
- **手机端不写中文字面量以外的本地化**（本仓没有本地化机制，照现状）。
- 冲突弹窗里的「复制冲突信息」用 `UIPasteboard.general.string`（既有代码这么用）。

### 6.4 三个动作的时序（容易做错）

1. **「提交并切换」**：手机先发 `commit` → 成功后**再发 `checkout`**。
   两个 intent，不是一个复合动作（见阶段 3.5）。
2. **「丢弃改动并切换」**：先二次确认，再发 `checkout` 且带 `discardChanges: true`。
   二次确认的文案必须写明**不会删未跟踪的新文件**。
3. **合并冲突**：`merge` 的结果里带 `conflict` → 弹冲突页。
   **不要在这里做「要不要重试」** —— 冲突的结果已经是「已回退」，页面只负责说明与复制。

### 6.5 错误显示

失败用系统 `alert`，正文放电脑返回的**原文**（`message`），不改写。
`module-boundaries.md:76` 那条规矩照办：**不得自己编造失败原因**，电脑给不出原因时只说「哪个操作没有完成」。

### 6.6 测试

按仓库既有的 iOS 测试做法写（`SynapseMobile` 的 UI 测试能真跑，见 iOS 侧的既有套件）。
**测试夹具要一起补**：`server/test/mock-desktop.mjs` 是 iOS UI 测试用的假电脑，
它现在按 `:295-330`(toolbar) `:332-355`(quickPhrases) `:359-390`(clipboard) 三套下发，
`mobile.gitStatus` 要照这个形状加一套，控制开关照 `:940` 那几处的写法接上。
**不补夹具，新面板的 UI 测试根本没法写。**

- 面板：四个动作的**可用/禁用**四态（有改动、无改动、有未推送、没上游）逐条断言。
- 分支列表：搜索框存在且能过滤；搜不到时是空态；当前分支有勾。
- 脏工作区：**恰好三个选项**，且没有「暂存并切换」（用 `XCTAssertFalse` 显式钉住 ——
  这是被砍掉的一项，防止有人按初稿又加回来）。
- 冲突页：说明里有来源分支、目标分支、冲突文件数；「复制冲突信息」把文本写进了剪贴板
  （UI 测试里读 `UIPasteboard` 断言）。
- **顶栏第二行**：喂三种 `mobile.gitStatus`，断言第二行的三种文案。
- **反证**：把「不是仓库」那一态也走成「显示分支」，断言必须红 ——
  区分「不是仓库」与「还没收到」正是这一轮最容易做塌的地方。

### 6.7 完成标准

- 原型里能点的每一条路径，真机上都走通（`pnpm mobile:install`）。
- 终端里跑着 Claude Code 全屏界面时，所有操作可用且**屏幕不被写入任何字符**。

---

## 阶段 7：规则文档、发布说明、收尾

### 7.1 规则文档（CLAUDE.md 的硬要求，不能漏）

- **`docs/agents/capability-registry.md`**：新增一条，说明手机端 Git 操作走一个新的 `git` intent、
  **不注册 System App / Dock / Workflow Node / Automation Action / MCP capability/tool / Deep Link**，
  **Terminal MCP 工具数量保持 49**；并写明它按终端当前目录执行、**不产生「代码仓库」条目**
  （与 `app.git.*` 那套无产品关系）。措辞照 `:70`、`:71` 那两条的句式。
- **`docs/agents/module-boundaries.md`**：在 Terminal 那节新增一条 ——
  手机端 Git 操作只接受**枚举动作**、不接受任意命令字符串，因而不构成 `:68` 所禁止的通用 `shell.exec`；
  它不写终端、不碰代码仓库注册表。
  **同时要改 `:61`**：那一条现在写着「Agent 原生通知是默认关闭的 Terminal 启动设置……
  启用后可为 codex、claude 注入会话级 PATH shim」—— 本轮之后 **shell 集成的注入不再由该开关门控**
  （OSC 7 总是注入，只有 PATH shim 仍受开关控制）。**这一条不改，规则就与代码脱节了。**
- **`docs/agents/repository-guide.md`**：如果里面记了终端 shell 启动环境的约定，一并核对。
- 把原型与三份文档落进仓库 `docs/prototypes/` 与 `docs/superpowers/specs|plans/`（仓库惯例）。

### 7.2 发布说明

`RELEASE_NOTES_PENDING.md` 「新增功能」补一条，面向用户说清得到什么，不写实现：

> 手机连着电脑的终端时，右上角菜单里多了一个「Git」：能看当前在哪个分支、有多少改动没提交，
> 也能直接切分支、新建分支、提交、推送、同步和合并分支。操作的是**终端当前所在的目录**，
> 你在终端里 `cd` 到哪它就跟着到哪。合并一旦遇到冲突会**自动取消并退回原样**，
> 并把冲突信息复制好，你可以直接粘给别的 AI 去处理。

「技术调整」补一条 shell 集成的行为变化（用户可能感知到 `ZDOTDIR`）：

> 终端启动时会给 shell 注入一小段集成脚本，用来上报当前目录。用户自己的 `.zshrc` / `.zprofile`
> 等配置照常生效。

### 7.3 最后一遍验收

逐条走 `产品设计文档.md` §8 的 40 条。**报告要如实，红就是红。**
其中第 39、40 条（不影响 Git 工作台、不传文件清单）要真的去查，不要想当然。

### 7.4 完成标准

- `pnpm --filter @synapse/desktop run check:hard-constraints` 通过。
- `pnpm --filter @synapse/desktop run test` 全绿。
- iOS 侧测试全绿，并已装到真机上走通。
- Terminal MCP 工具数量仍是 49。
- `RELEASE_NOTES_PENDING.md` 已更新。
- `repositories.json` 在整轮验证前后没有变化。
