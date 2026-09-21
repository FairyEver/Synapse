# 终端快捷输入 · 产品设计文档

> 状态：**定稿，可实施。** 两个待定点已由产品负责人拍板（见 §3 决策七、决策二）。
> 界面原型：`docs/prototypes/2026-09-21-terminal-quick-input.html`（用浏览器打开，可直接点）
> 实施计划：`docs/superpowers/plans/2026-09-21-terminal-quick-input.md`
> 相邻两轮：手机端终端工具栏改造（`docs/superpowers/specs/2026-09-18-mobile-terminal-toolbar-design.md`）、终端快捷指令同步（`docs/superpowers/specs/2026-09-17-terminal-shortcut-sync-design.md`）。关系见 §5.5。

---

## 1. 要解决什么

桌面端的终端底部有一条命令条。用户在终端里跑 `claude` 的时候，最常打的就是那几句「帮我捋一下」「给个结论」——这些句子他已经维护在「快捷输入」App 里了，Agent 对话里点得到，手机终端里也点得到，**唯独在桌面终端里够不着**。

这一轮就是把这条通道接到命令条上。要解决的就是这一件事，没有第二件。

增量比看上去小：数据（`core.quick-input`）、面板的长相、以及「点一句只填不执行」这条口径，三样都是现成的，这一轮是把它们接到终端上。

---

## 2. 现状（实施前必须核对，不要凭印象）

### 2.1 「快捷输入」是一个独立的 System App

- 模块：`desktop/app-capabilities/quick-input/`。appId `quick-input`，显示名「快捷输入」。
- 存储：DataRepository 命名空间 `app.quick-input.items`（backend `sqlite`，未加密），一条长这样：
  `{ id, schemaVersion: 1, content, sortOrder, createdAt, updatedAt }`（`shared/schema.ts`）。
- **`content` 是唯一用户可写字段**，`z.string().min(1)` —— 只有下限，没有上限。没有标题、没有分类、没有变量、没有快捷键。
- 内容是**多行**的，第一行天然当标题用。内置六条（`shared/defaults.ts`）全是这个形状：
  `"帮我捋一下\n把这里的信息重新整理一下，重点放在结论、分歧和下一步。"`
- 服务 `core.quick-input`（`electron/bootstrap/descriptors.ts`），有 `list()` 和一个 `changed` 事件。
- 渲染进程读它：`requireBridgeDomain("quickInput")` → `item.list()` / `item.onChanged()`。

### 2.2 终端底部那条命令条是什么

`desktop/app-capabilities/terminal/renderer/index.tsx:1746-1822`：

```tsx
<div className="relative shrink-0">
  <div data-terminal-toolbar
    className="no-scrollbar flex min-h-10 items-center gap-1 overflow-x-auto border-t bg-card px-2.5 py-1.5 whitespace-nowrap">
    {toolbarActions.map(...)}          // 内置：回车 / Ctrl+C / Clear │ /exit / /clear
    <span divider />
    <div data-terminal-custom-toolbar-actions>{customToolbarActions.map(...)}<铅笔/></div>
    {voice.available ? <麦克风/> : null}
  </div>
  {sessionLockedByMobile ? <遮罩/> : null}
</div>
```

三个要点：

1. **整条是一个横向滚动容器。** 用户的指令没有上限，指令一多最左边的东西会被滚出屏幕。手机端上一轮踩过这个坑（那颗 ⌨ 会被滑走），做法是「左固定 · 中横滑 · 右固定」。
2. 内置五条是代码写死的（`shared/toolbar-actions.ts`），最左现在是「回车」。
3. `sessionLockedByMobile` 时整条盖一层遮罩，里面所有按钮禁用。

### 2.3 终端那块永远是深色

`index.tsx:1628`：`<div className="dark flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">`。应用切浅色主题时，窗口壳和侧栏是浅的，**终端区是深的**。命令条取 `bg-card`，在 `.dark` 下是深色。

### 2.4 终端已经有一条「落进命令行、不执行」的通道

语音输入（`index.tsx:1253` `commitVoiceInput`）：

```tsx
await terminalBridge.session.write({ sessionId: activeSession.id, data: text })
setPendingVoiceText(text)
```

注释写得很清楚：**不补 `"\r"`**，执行与否留给用户按 Enter；也不走 `buildTerminalCommandWrites`（那个 helper 会给每一行补 `\r`，是「执行」语义）。

落地之后命令条上方出现一条提示（`index.tsx:1723`，`data-terminal-pending-voice`）：「待执行 · Enter 执行」，右侧一枚 X 关掉。会话一换这条提示就清掉。

**这一轮复用它。**

### 2.5 Agent 对话里的现成做法

`desktop/src/modules/agent/components/quick-input-menu.tsx`：

- 一颗 ghost 按钮，文案「快捷输入」+ `ChevronUp`；`side="top"`、`avoidCollisions={false}`，只向上弹。
- 每行取**第一行非空文本**做标签，超过 24 字符截断加 `…`；行 `truncate` 单行。
- 点一条 → `insertComposerText(content, "end")`：追加到草稿末尾、必要时补一个空格、**不发送**、焦点回到输入框。
- **`quickInputs.length === 0` 时整个不渲染。**

### 2.6 手机端面板里的那一段

手机端终端工具栏上那一轮（2026-09-18）已经开了面板，分「快捷命令 / 快捷输入」两段。短语段点一条只是 `draft = phrase.content` —— 进输入框，不发送、不聚焦（不聚焦是因为聚焦会抬起系统键盘，正好盖住终端）。行尾一枚眼睛看全文。

数据是电脑推过去的（`mobile.quickPhrases`）。

### 2.7 术语现状：同一个词在三处指三种东西

| 出处 | 「快捷输入」指的是 |
|---|---|
| 终端工具栏的铅笔按钮、它打开的弹窗 | **命令按钮**（名称 + 内容 + 是否回车），存 `app.terminal.toolbar-actions` |
| 手机端终端面板的第二段 | 「快捷输入」App 里的**句子** |
| 独立 App 名 | 「快捷输入」App 里的**句子** |

第一行是历史遗留：终端弹窗标题原本叫「自定义快捷输入」，表单叫「新增快捷输入」，空态叫「暂无自定义快捷输入」，铅笔的 aria-label 是「管理自定义快捷输入」，自定义按钮的 aria-label 是「输入/运行快捷输入：X」。

**这一轮先把它改掉再接入**，否则同一根命令条上会出现两个同名的东西。

---

## 3. 决策

### 决策一：入口在命令条最左侧，且在滚动区之外

和其它按钮并排放在滚动容器里，指令一多它就会被滚走。**放在滚动容器外面、左侧，钉住不动**，与命令条之间一根分隔线。这与手机端「左固定 · 中横滑」是同一种做法。

### 决策二：点一句只落进命令行，不执行

写 `content` 原文进 PTY，**不补 `\r`**，走 §2.4 那条现成通道。命令错一个字符就可能是破坏性操作，执行与否必须留给用户按 Enter。

**换行按 bracketed paste 包一层**（产品负责人已拍板）：句子天生是多行的，原样写进纯 shell 时第二个换行会被行规程当成行终止符执行掉。详见 §5.1。

### 决策三：复用已有的「待执行」提示条

不新造一条提示。语音那条（`pendingVoiceText`）语义完全一致：有东西在命令行里等着执行。状态变量随之改名（见实施计划阶段 5），行为不变。

### 决策四：列表为空时，入口不出现

与 Agent 对话里的做法一致（`quickInputs.length === 0` 时整个不渲染）。不摆一个点开是空的按钮。

注意：不能把「加载失败」也做成静默消失。加载失败时不渲染入口，只在 renderer logger 里留一条 warn —— 与 Agent 侧 `useQuickInputItems` 的失败处理一致。

### 决策五：面板永远深色

终端区自带 `.dark`，面板浮在终端上，必须跟着是深的。**这条不能靠继承**——弹层默认挂到 `body`，继承的是窗口壳的主题，浅色主题下会变成一块浅色浮层压在深色终端上。实现时把面板包在 `.dark` 里。

### 决策六：面板是列表，不是菜单

用 Popover 承载一个可滚动的行列表，**不用 `DropdownMenu`**。理由：每一行是「第一行标签 + 其余内容」的两行结构，行尾还要一枚眼睛按钮；菜单项里嵌按钮会破坏菜单的键盘语义。Agent 侧用 `DropdownMenu` 是因为那里每行只有一行纯文本。

行结构（左起）：

- 第一行：标签（第一行非空文本），`text-foreground`，单行截断。
- 第二行：其余内容（把换行折成空格），`text-muted-foreground`，单行截断。没有第二行时不渲染这一行。
- 行尾：眼睛按钮 → 打开全文预览（可选中复制），与手机端同一套。

不接受 hover 才浮出眼睛：键盘用户也要能到。

### 决策七：终端原来那套改叫「快捷命令」

**改的是名字，不是东西。** `app.terminal.toolbar-actions` 的存储、字段、IPC、权限、加密状态一律不动。要改的字符串见实施计划阶段 1。

改完之后四处叫法一致：终端工具栏上的命令按钮、那个弹窗、手机端面板的「快捷命令」段、以及 `module-boundaries.md` 里的措辞。

### 决策八：不新增存储、不新增协议、不新增 MCP 工具

- 不加任何存储：读的就是 `app.quick-input.items`，没有副本、没有缓存、没有终端侧的表。
- 不加任何协议或 IPC：走的是现成的 `window.synapse.quickInput.item.*`。
- 不注册 MCP capability / tool / Deep Link / Workflow Node / Automation Action，**Terminal MCP 工具数量保持 49**。
- 手机端那条 `mobile.quickPhrases` 完全不动，两条通道互不依赖。

---

## 4. 交互规格

### 4.1 入口

- 位置：命令条最左，滚动区之外。与滚动区之间一根 1px 分隔线（与命令条内既有的分隔线同款）。
- 形态：ghost 按钮，`h-7`，圆角与命令条上其它按钮一致，文案「快捷输入」+ `ChevronUp`，`text-foreground/75`，hover 取 `bg-accent`。
  与 Agent 对话里那颗键**同词、同箭头**，两个地方学一次就够。
- 展开时箭头翻转 180°。
- 禁用条件：`terminalSessionStatus !== "running"` 或 `sessionLockedByMobile`。前者因为写不进去 PTY，后者与命令条上其它按钮一致。
- **列表为空（或加载失败）时不渲染。**

### 4.2 面板

- 锚点：入口正上方，`side="top"`，左对齐；**只向上弹，不下翻**。
- 宽 392px，最大高度 340px，超出滚动。
- 深色 token：`--popover` 作为底、`--border` 描边、`--radius` 圆角、一层投影。
- 行 hover 取 `bg-accent`。
- **没有标题。** 入口上已经写着「快捷输入」，面板里再写一遍是重复。
- 关闭：点面板外、Esc、再点入口。

### 4.3 全文预览

- 行尾眼睛 → 面板**右侧**展开一张同高的卡片，显示整条原文（保留换行），文字可选中复制，右上角一枚 X 收起。
- 与手机端一致：预览里的文字可长按/拖选复制。
- 关面板时预览一起关。

### 4.4 选中之后

1. 面板收起（预览一并收起）。
2. `content` 原文写进当前 session。多行时按 §5.1 包 bracketed paste，**不补 `\r`**。
3. 命令条上方出现「待执行 · Enter 执行」那条提示（复用），右侧 X 可关掉。
4. 焦点留在终端里，用户直接按 Enter。

写入失败：`toast.error("写入终端失败")` + renderer logger error，与语音输入同一条错误路径。

### 4.5 状态与禁用

| 状态 | 入口 |
|---|---|
| 有句子、会话 running、未被手机占用 | 可用 |
| 无句子 / 加载失败 | **不渲染** |
| 会话非 running | 渲染但禁用 |
| 手机占用会话 | 渲染但禁用（遮罩在命令条之上） |
| 面板开着时会话状态变成非 running | 面板立即收起 |

### 4.6 文案表

| 位置 | 文案 |
|---|---|
| 入口 | 快捷输入 |
| 入口 aria-label | 快捷输入 |
| 行 aria-label | 填入快捷输入：{标签} |
| 眼睛 aria-label | 看全文：{标签} |
| 预览卡标题 | 全文 |
| 预览卡关闭 aria-label | 收起全文 |
| 待执行提示 | 待执行 · Enter 执行（沿用） |
| 写入失败 | 写入终端失败（沿用） |

面板无空态文案 —— 空的时候入口就不在了。

---

## 5. 平台能力与代价

### 5.1 换行：只在应用自己开了 bracketed paste 时才包

**问题**：句子是多行的。原样写进 PTY，第二个换行可能被行规程当成行终止符执行掉。

**做法**：写成 `\x1b[200~` + 原文 + `\x1b[201~`，并且**只在当前 pane 的 xterm 报告 `modes.bracketedPasteMode === true` 时**才包。

xterm.js 已经在 `Terminal.modes.bracketedPasteMode` 上暴露了这个状态（`@xterm/xterm` 的类型里就有），它由前台应用通过 DECSET 2004 打开。终端模拟器粘贴时用的就是这个判据，这里照做。

- 应用开了（Claude Code TUI、zsh、bash 5.1+）：整段当一次粘贴插入，换行是换行，**不提交**。这正是要的效果。
- 应用没开：退回今天的行为（原样写）。不硬塞控制序列，免得在认不出它的应用里显示成乱码。

需要在 `TerminalWorkspaceViewHandle` 上加一个读取口（现在只有 `clearActivePane()`），实现见实施计划阶段 5。

### 5.2 面板的深色不能靠继承

弹层默认挂到 `body`。终端区那个 `.dark` 管不到它。要在面板自己的容器上带 `.dark`。

### 5.3 「钉住」要动命令条结构，选择器必须保住

`data-terminal-toolbar` 现在挂在唯一那个滚动容器上，测试和样式都按它找。改造时**把它留在最外层容器上**，滚动容器变成一个内层 div，这样既有查询（`toolbar.querySelector("button[aria-label='…']")`）继续成立。

### 5.4 句子是跨模块数据，hook 要提到共享位置

`useQuickInputItems` 现在写在 `agent-conversation-workspace.tsx` 里，是模块私有的。终端是 app-capability，按仓库规则不能从 `src/modules/agent` 里取东西。

做法：把这个 hook 提到 `desktop/src/hooks/use-quick-input-items.ts`，Agent 侧改成从新位置 import。逻辑一行不改，只挪位置。

### 5.5 与手机端的关系

同一份数据，两条互不依赖的通道：

- 手机：主进程 `MobileGatewayService.flushQuickPhrases()` → `mobile.quickPhrases` → 手机端 `TerminalQuickPhrasesState`。
- 桌面（本轮）：渲染进程直接 `bridge.item.list()` + `onChanged`。

手机那条完全不动。桌面侧「列表变了」由 `changed` 事件驱动，面板开着的时候也会跟着更新。

### 5.6 不改协议、不改网关

本轮的接收方是桌面自己的渲染进程，不经过 socket，因此不碰 `shared/src/live.ts`、不碰 `mobile-live.ts`、不碰服务端。手机端那条 `mobile.quickPhrases` 的字节预算（64 条 / 单条 4096 / 共 64KiB）与本轮无关 —— 那些是推给手机的裁剪，桌面这里读的是完整列表。

### 5.7 「快捷命令」改名会碰到的规则文档

- `docs/agents/module-boundaries.md:59`：「Terminal 底部**内置快捷输入**由代码定义且只读；**用户快捷输入**是独立的应用级数据……两者不得混存，也不得注册 MCP 工具。」→ 措辞改成「内置快捷命令 / 用户快捷命令」。
- `docs/agents/capability-registry.md`：同一段里「Terminal 用户快捷输入」和「手机端终端快捷栏……与用户的快捷输入投影」两处措辞跟着改。
- 同一份文档里**新增一条**：桌面终端读取「快捷输入」App 的句子只走现有 UI，不注册 System App / Dock / Workflow Node / Automation Action / MCP capability/tool / Deep Link，Terminal MCP 工具数量保持 49。

---

## 6. 非目标

- **不做直接发送。** 不提供「点一句就回车」的开关或长按变体。旧配置里的 `directSend` 字段已经被迁移丢弃（`quick-input` App 的设计文档明确「`directSend` is not part of the new model」），不要因为这一轮把它复活。
- **不在终端里增删改句子。** 维护仍只在「快捷输入」App 里。面板不提供「新增」「编辑」「删除」入口。
- **不做分组、搜索、排序、置顶、最近使用。** 列表按 `sortOrder` 原样铺开，与 App 里一致。
- **不做 `[快捷命令 | 快捷输入]` 分段面板。** 那是手机端的形态 —— 手机上横向空间紧张，才需要把两套东西收进一个面板。桌面上命令条本身就是平的，再套一层分段只是多一次点击。
- **不动麦克风的位置。** 它仍在滚动区的末尾，本轮不给它做右侧钉住。
- **不改内置那五条命令。**
- **不改手机端任何东西。**
- **不给面板加「管理」跳转入口。** 想改句子去 Dock 里的「快捷输入」App。

---

## 7. 已定口径

1. 点一句 = 落进命令行，不执行。
2. 列表为空 = 入口不出现（加载失败亦然）。
3. 面板永远深色。
4. 入口钉在命令条最左，不随滚动移动。
5. 终端原来的自定义按钮改叫「快捷命令」，「快捷输入」只指 App 里的句子。
6. 多行写入按 bracketed paste 包一层，且只在应用开了它的时候包。
7. 不新增存储、IPC、协议、MCP 工具。

---

## 8. 验收基线

1. 命令条最左出现「快捷输入」，与内置命令之间有一根分隔线。
2. 把命令条横向滚到底，这颗按钮**不动**。
3. 点它，面板向上弹出，列出「快捷输入」App 里的全部句子（就是内置那六条，除非用户改过）。
4. 面板里每行显示第一行标签；有第二行的显示第二行；超长截断加省略号。
5. 点眼睛，右侧出现全文，文字可以选中复制。
6. 点其中一句：面板收起，那句话出现在命令行里，`\r` **没有**被补上（会话没有执行）。
7. 命令行上方出现「待执行 · Enter 执行」，按 Enter 才执行。
8. 在「快捷输入」App 里新增一句，面板开着的时候能看到它出现。
9. 在 App 里删光所有句子，命令条的入口**消失**。
10. 会话非 running 时入口禁用；手机占用会话时入口禁用。
11. 应用切浅色主题，面板仍然是深的。
12. 点铅笔打开的那个弹窗，标题是「快捷命令」，不是「自定义快捷输入」。
13. `pnpm --filter @synapse/desktop run check:hard-constraints` 通过，Terminal MCP 工具数量仍是 49。
