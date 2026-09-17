# 手机端创建 Claude Code 对话 · 设计文档

日期：2026-09-17
状态：待评审
原型：`docs/prototypes/2026-09-17-mobile-claude-code-conversation.html`
实施计划：`docs/superpowers/plans/2026-09-17-mobile-claude-code-conversation.md`
关联：`docs/superpowers/specs/2026-07-20-agent-persona-conversation-creation-design.md`、`docs/adr/0216`、`docs/adr/0218`

---

## 1. 背景：桌面端现在怎么做的

桌面端有两个入口——侧边栏项目行上 `⌘+点击加号`，以及新建弹窗里的「创建终端cc对话」——最终落到同一个 IPC：

`app.agent.operation.create_claude_code_terminal`
（`desktop/electron/modules/agent/ipc-claude-code-terminal.ts`）

它做四件事：

1. `resolveProjectAgent(ctx.resolve, projectId)` 解析项目，拿到该项目的 `ProviderService`；
2. `providerService.buildEnv(providerId, …)` 取该供应商的凭据环境；
3. `resolveTierModelFromEnv(providerEnv, modelTier)` 按档位解析真实模型名，写一份 `0600` 的临时 `settings.json`；
4. `terminal.createSessionWithEphemeralEnvironment({ title, cwd: project.localPath, shell: 内置 claude, args: ["--settings", …, "--model", …, "--permission-mode", …], environment })`。

几个必须记住的既有事实：

- 标题是 `Claude Code · {项目名}`，`cwd` 来自 `project.localPath`。
- `persistEnvironment: false`，**凭据永不进终端记录**；源码注释明写「凭据永不进 renderer，也不进 terminal store」。
- 它**不创建任何 Agent 对话**，不新增 `conversations` 记录；退出终端即结束。
- 没有 `groupId`，落进 `ensureDefaultGroup()`（`terminal/main/service.ts:934`）。
- 默认值解析在渲染进程：`pickInitialProviderModelSelection(providers, config.agent.defaultProviderModel)`。

### 桌面端「快捷创建」的契约

`docs/superpowers/specs/2026-07-20-agent-persona-conversation-creation-design.md` 写得很明确：

> 直接点击加号时，以自动生成的名称、"普通"智能体和当前默认模型快捷创建对话……按住 ⌘ 点击同一个加号时跳过弹窗，用同一套默认模型解析结果在终端里启动内置 Claude Code；无法解析可用模型时同样回退到弹窗。**快捷创建无法解析可用模型或创建失败时，也回退到同一弹窗。**

它敢一键，靠的是两件事：

1. 那个 `+` **挂在某个项目行上**——项目本身是已知的，不用选；
2. 供应商和模型的默认值由电脑当场解析，解析不出来才回退到弹窗。

**这两点是本次移动端设计要逐条对齐的东西。**

---

## 2. 约束：为什么不能在手机上跑

手机端 Synapse Remote 是**瘦客户端**（`SynapseMobile/README.md`）：

```
iPhone ──wss──▶ Synapse 云 ──wss──▶ 桌面端网关 ──▶ Terminal 能力 ──▶ PTY
```

- 终端完全跑在电脑上，手机看到的是桌面对终端的**派生视图**（已渲染的行）；
- 手机只发**意图**，电脑执行；写租约由桌面网关代持；
- 云端刻薄：`mobile-live-relay.service.ts` 头注释写明它「只路由不解释、只记最近一份会话列表、**从不存终端输出**」。

而供应商凭据只存在于桌面主进程（`provider-service.ts:536` `buildEnv`），手机与电脑之间只有这条窄链路。

**结论：这个功能只能是「手机选参数、电脑照办」。** 手机把项目、供应商、模型档位发给电脑，电脑用自己本地的配置和密钥完成创建。手机全程不接触任何 API Key。

---

## 3. 决策

### 3.1 形态

新增一条意图 `createAgentConversation`，字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `projectId` | 是 | 手机侧一定有一个选择（记住的或当场选的），显式传 |
| `providerId` | 否 | 缺省由电脑解析 |
| `modelTier` | 否 | 缺省由电脑解析 |
| `cols` / `rows` / `deviceLabel` | 否 | 初始尺寸，三者同进同出 |

桌面端执行后返回既有的 `createdSessionId`，手机直接进终端页。**不需要新增结果字段。**

### 3.2 默认值由电脑算，不由手机算

`providerId` / `modelTier` 缺省时，电脑走与 `⌘+加号` **完全相同**的一套解析（`pickInitialProviderModelSelection(providers, config.agent.defaultProviderModel)`：先看全局默认，再回退到当前激活 Provider，再回退到首个可用 Provider）。

这样「手机上的默认」和「电脑上 `⌘+加号` 的默认」永远是同一个东西，不会因为两端各算一遍而分叉。

这不是新发明——桌面自己的 MCP 能力 `app.agent.conversation.create` 已经是这个形状：入参里供应商和模型可选，缺省就走 `desktop/electron/modules/agent/conversation-creation.ts` 里同一份选型函数。**手机端照抄这个形状，不另立一套。**

### 3.3 入口：底部面板 + 分段选择器

`＋` 打开一个 SwiftUI `presentationDetents([.fraction(0.75), .large])` 的底部面板，默认停在约 3/4 屏高。顶部是分段选择器，默认选中「对话」：

| 分段 | 选什么 | 电脑上对应 | 结果 |
|---|---|---|---|
| **对话** | 项目（「本地对话」+ 已配置项目） | Agent 对话侧边栏的顶层分组，即 `app.agent.group.list`（`{projectId, name, isDefault}`，见 `agent/main/control-service.ts:125`） | 在该项目目录里建 Claude Code 对话 |
| **终端** | 终端分组 | 终端应用左侧的终端分组（`terminal.listGroups()`） | 在该分组里建普通终端 |

**分段切换的是「你要新建什么」，不是「你在看什么」。** 建好的 Claude Code 对话照样出现在「终端」页的列表里。两个入口，一个列表。

### 3.4 「对话」段：三行参数 + 一颗主按钮

```
项目      Synapse  [上次]        ›
供应商    Anthropic 官方        ›
模型      Opus                  ›

        [    开始对话    ]
```

`＋` → 开始对话 = **两次点击、零个决定**。

这是「默认供应商模型」这条能力的落点：它不是把值预填进输入框，而是**让用户不必做那个决定**。三行里没有任何一行需要先读再判断。

**项目这一项的默认从哪来**：桌面靠「`+` 挂在项目行上」提供了上下文，手机 `＋` 在导航栏没有，所以要补上——**记住上次在这个手机上建过的项目**，预选并标「上次」。首次使用没有默认，就自然退化成从列表里选一个。存在手机本地（照 `TerminalDisplaySettings` 的既有做法），不上传、不影响桌面。

### 3.5 「终端」段不改

保持现在的行为——点分组即建，不加确认按钮。终端分组没有可省的默认值，硬加一颗「开始」是纯摩擦。

两段在这里不一致是**故意的**：对话段有默认可省，终端段没有。

### 3.6 尺寸不做特例

手机上建 Claude Code 对话，本质就是**开一个终端、附带一条启动命令**，与平时先开终端再跑 Claude Code 是同一件事。尺寸沿用新建终端的既有行为（优先移动端），不为它新增设置或第三种显示模式；Claude Code 在窄宽度下的观感不在本次范围内。

### 3.7 落点分组不另建

与桌面 `⌘+加号` 一致，进电脑上的默认分组（因为没有 `groupId`，`createSessionRecord` 会走 `ensureDefaultGroup()`），靠标题「Claude Code · 项目名」和「需要我」标记被人认出来。

### 3.8 叫法统一到「Claude Code」

桌面端按钮现在写「创建终端cc对话」，而它建出来的会话标题是「Claude Code · 项目名」——同一个东西两个名字。界面上一律用 **Claude Code**，「cc」只留在模板文件名这类内部位置。桌面那个按钮文案一并改成「创建 Claude Code 对话」。

---

## 4. 失败与离线

| 情况 | 表现 |
|---|---|
| 电脑不在线 | 不排队、不假装成功。`＋` 保持禁用，说明原因 |
| 电脑缺内置 Claude Code runtime | 面板保持打开，三行选择不丢，错误就地显示在面板里；文案复用桌面端口径「内置 Claude Code runtime 缺失，请更新或重新安装 Synapse。」 |
| 供应商凭据缺失 / 项目不可用 | 同上，就地显示 |
| 手机请求里没有可用的默认模型 | 电脑按 `⌘+加号` 的同一套规则回退；仍解析不出则拒绝并说明 |
| 电脑端版本太旧 | 见 §5.3，手机要把 `timeout` 翻译成可照做的一句话，而不是原样抛错误码 |

---

## 5. 协议

### 5.1 新增意图

`MobileIntent` 增加 `createAgentConversation`，`isMobileIntent` 增加对应分支。

**注意**：`isMobileIntent` 是 `switch` + `default: return false`（`shared/src/mobile-live.ts:653`），**云端和桌面端都用它做出入口校验**（`isLiveMobileClientMessage` / `isLiveDesktopServerMessage`，`shared/src/live.ts:108/165`）。所以一个新 kind 若某一端不认识，会被**静默丢在边缘**，手机拿不到任何结果——这直接决定了升级顺序（§5.3）。

### 5.2 项目与供应商摘要怎么下发

手机需要「项目列表」和「供应商摘要」。供应商摘要只含 id、名称、四个档位对应的模型名——**不含 `baseUrl`，不含任何密钥**。

**方案：并进 `mobile.summary`**，作为两个可选区块。

- `maxSummaryBytes` 是 240 KiB，而这两份目录实际只有约 1 KB，预算上完全不是问题；摘要本来就有成体系的上限常量、生产端裁剪和「永不丢会话」的收缩逻辑（`mobile-gateway-service.ts:572`），这两块并进去可以复用。
- 面板打开时数据已经在手上，**零等待**，不需要加载态。
- 可选字段而非必填，沿用现有「Optional rather than nullable so the common payload stays byte-for-byte what it was before this field existed」的做法：字段缺失时旧手机渲染得和以前一模一样。

**被否掉的方案**：新增一条按需拉取的消息（与 `mobile.summary` 平行）。它的好处是空闲零增量、有自己的尺寸上限，代价是要新增消息类型、云端路由分支、两端校验和手机端加载态。在 240 KiB 预算下不值当。

**重新评估的触发条件**：项目或供应商数量显著增长、摘要逼近预算时。

### 5.3 升级顺序（硬约束）

因为 §5.1 的静默丢弃行为，**必须按 服务端 → 桌面端 → 手机端 的顺序升级**：

- 服务端不先升级：新手机发的意图被云端在校验层丢掉，手机只能等到本地 10 秒超时。
- 桌面端不先升级：意图到了电脑但被丢弃，云端在 8 秒后以 `code: "timeout"` 回给手机（`mobile-live-relay.service.ts:20` `INTENT_RESULT_TIMEOUT_MS = 8_000`）。

手机端已有对 `"no_result" / "delivery_failed" / "timeout"` 的分类处理（`SynapseAppModel.swift:1246`，这三类**从不重放**）。本次要把 `timeout` 在这条创建路径上翻译成「电脑端版本太旧，请在电脑上升级 Synapse」。

---

## 6. 安全

- 手机请求里**没有密钥字段**。意图只带 `projectId` / `providerId` / `modelTier`。
- 摘要里的供应商区块**不含 `baseUrl`**，也不含任何密钥字段。桌面端的 `SynapseAgentProviderSummary` 带 `baseUrl`，**下发前必须剔除**。
- 创建在桌面主进程执行，凭据经 `providerService.buildEnv` 读取，该调用本身已过 `permissionGuard.check({ action: "secret.read" })` 并写审计。
- 意图执行前过 `PermissionGuard`：`terminal.session.create`（带初始尺寸时再加 `terminal.session.resize`，ADR 0063 要求两者都授权），并写 `AuditSink`，与现有 `create` intent 一致。
- `createdByClientId` 沿用 `mobile:<mobileClientInstanceId>`，与 `launchCommand` 的既有做法一致。

---

## 7. 非目标

- **不在手机上管理供应商**。增删改、填 Key 全部留在电脑；手机只做只读选择。
- **不支持中途换模型**。模型是启动参数，换等于重开。
- **不做手机端排队创建**。电脑关机就是关机。
- **不动桌面端「智能体对话」那条线**（SDK 聊天）。本次只做 Claude Code 终端对话。
- **不顺手接「已保存命令」**。协议里已有 `launchCommand`，但手机端既没有界面也拿不到命令列表，一直是死路。它和本次是同一个形状（开终端 + 启动命令），将来可以一并收口，但不是这次。
- **不把 `＋` 做成真·一键**。理由见下。

### 关于「真·一键」为什么不采纳

让 `＋` 本身直接创建（长按才开面板）确实能压到一次点击，但：

- `＋` 现在的语义是「我要新建东西」，直接建出一个用户没点过名的对话会让人意外；
- 首次使用没有「上次的项目」，必然建错地方；
- 长按是隐藏手势，换项目会变成没人发现得了的功能；
- 桌面端敢一键，是因为**失败能回退到弹窗**。手机上弹窗本来就是开着的，没有非要抢那一次点击的理由。

**值得省的是判断，不是点击。** §3.4 把判断省掉了，这个方案只是把点击藏起来。

---

## 8. 验收基线

1. 电脑在线时，**点 `＋` → 点「开始对话」，两次点击、零个决定**就建出一个 Claude Code 对话并直接进入终端。
2. 第二次打开面板时，项目 / 供应商 / 模型三行都已是上次用的值，用户不需要读它们就能直接按「开始对话」。
3. 面板默认停在约 3/4 屏高，向上能拉满，向下能关掉；分段默认停在「对话」。
4. 「终端」段的行为与现在完全一致（点分组即建），原有使用习惯不被打断。
5. 手机全程不出现、不传输任何 API Key 或供应商地址。
6. 电脑不在线时不能创建，且说清原因。
7. 创建失败不产生半成品会话；面板保持打开，三行的选择不丢。
8. 电脑端缺内置 Claude Code runtime 时，手机看到的提示与桌面端同一口径。
9. 老版本电脑 + 新手机：提示升级，不崩、不卡在加载中。
10. 旧手机 + 新桌面端：摘要里多出来的两个区块不影响既有渲染。

---

## 9. 开放项

| # | 事项 | 现状 |
|---|---|---|
| 1 | 「终端」段是否也要「预选 + 开始」 | 已定：不加。若实际使用中发现同一个面板里两套交互容易点错，再统一 |
| 2 | 项目摘要是否需要分页/搜索 | 项目数量少，首版不分页。超过阈值时再评估 |
| 3 | 是否支持从手机端打开一个已存在的 Claude Code 对话的供应商信息 | 不在本次范围 |
| 4 | `capability-registry.md` 是否需要更新 | 本次不新增 capability（新意图走 mobile gateway，不是 `app.*`）。但消费了 `app.agent.group.list`，落地时需按 CLAUDE.md 核对一遍注册表与文档 |
| 5 | `RELEASE_NOTES_PENDING.md` | 需要更新（用户可感知的新功能） |
