# 终端快捷输入 · 实施计划

> 配套文档：`docs/superpowers/specs/2026-09-21-terminal-quick-input-design.md`（口径与验收基线，冲突时以它为准）、`docs/prototypes/2026-09-21-terminal-quick-input.html`
> 每个阶段结束都要能单独验证。阶段完成就提交，只提交本阶段的文件。

## 总览

| 阶段 | 内容 | 主要文件 |
|---|---|---|
| 0 | 开工前核对 | — |
| 1 | 术语改名：终端那套自定义按钮 → 快捷命令 | `terminal-toolbar-manager-dialog.tsx`、`index.tsx` |
| 2 | 把 `useQuickInputItems` 提到共享 hooks | `src/hooks/use-quick-input-items.ts` |
| 3 | 新建面板组件 | `terminal-quick-input-menu.tsx` |
| 4 | 接进命令条最左侧（钉住） | `index.tsx` |
| 5 | 写入通道：bracketed paste，不显示重复提示 | `index.tsx`、`terminal-workspace-view.tsx` |
| 6 | 规则文档、发布说明、收尾 | `docs/agents/*`、`RELEASE_NOTES_PENDING.md` |

阶段 1 和 2 是准备，可以并行做，也可以先做。**阶段 4 之前不要合并阶段 3**，否则命令条上会先出现一颗点了没反应的按钮。

---

## 阶段 0：开工前的核对

- [ ] 读 `产品设计文档.md` §2「现状」，逐条在代码里核对。里面的行号是写文档那天（2026-09-21）的，可能已经漂移。
- [ ] `pnpm --filter @synapse/desktop run check:hard-constraints` 先跑一遍，确认基线是绿的。
- [ ] 确认 `desktop/src/components/ui/popover.tsx` 存在（它存在，不需要新增 shadcn 组件，不需要装依赖）。
- [ ] 确认 `@xterm/xterm` 的类型里有 `modes.bracketedPasteMode`（在 `node_modules/@xterm/xterm/typings/xterm.d.ts`）。
- [ ] 确认 Terminal MCP 工具数量基线是 49，收尾时要还是 49。

**称谓注意**：`app-capabilities/` 下的文件一律用相对路径 import（`../../../src/components/ui/...`），不用 `@/` 别名。

---

## 阶段 1：术语改名

**只改名字，不改东西。** `app.terminal.toolbar-actions` 的存储、字段、IPC、权限、加密状态一律不动。

### 改动的字符串（用户可见，全部要改）

`desktop/app-capabilities/terminal/renderer/terminal-toolbar-manager-dialog.tsx`：

| 现在 | 改成 |
|---|---|
| `编辑快捷输入` / `新增快捷输入`（表单标题） | `编辑快捷命令` / `新增快捷命令` |
| `自定义快捷输入`（弹窗标题） | `快捷命令` |
| `编辑快捷输入：{label}`（aria） | `编辑快捷命令：{label}` |
| `删除快捷输入：{label}`（aria） | `删除快捷命令：{label}` |
| `暂无自定义快捷输入`（空态） | `暂无快捷命令` |
| `新增快捷输入`（空态按钮） | `新增快捷命令` |
| `删除快捷输入？`（确认框标题） | `删除快捷命令？` |
| `删除快捷输入`（确认按钮） | `删除快捷命令` |

`desktop/app-capabilities/terminal/renderer/index.tsx`：

| 现在 | 改成 |
|---|---|
| aria `${pressEnter ? "运行" : "输入"}快捷输入：{label}` | `…快捷命令：{label}` |
| aria `管理自定义快捷输入` | `管理快捷命令` |

弹窗里那句 sr-only 描述「管理终端快捷栏中的自定义按钮。」保留原意、措辞跟着改。

### 测试

`desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx` 里有一批断言按这些字符串找元素，必须同步改（同一批字符串，逐处替换即可）：

- `button[aria-label='管理自定义快捷输入']` 的查询（多处）
- 工具栏 aria-label 顺序的整条断言数组
- 弹窗标题、`新增快捷输入`、`编辑快捷输入：部署`、`删除快捷输入：发布`、`删除快捷输入？`、`删除快捷输入`、`暂无自定义快捷输入`

**查全**：`rg -n "快捷输入" desktop/app-capabilities/terminal/` 应该只剩新功能的（阶段 3 之后才会有）。

### 完成标准

- `pnpm --filter @synapse/desktop run test` 全绿。
- 界面上点铅笔，弹窗标题是「快捷命令」。
- `rg -n "自定义快捷输入" desktop/` 零命中（除了 git 历史）。

---

## 阶段 2：把 `useQuickInputItems` 提到共享位置

现在它在 `desktop/src/modules/agent/components/agent-conversation-workspace.tsx` 里，是模块私有的。终端是 app-capability，按仓库规则不能从 `src/modules/agent` 取东西。

### 新增文件

`desktop/src/hooks/use-quick-input-items.ts`

- 从 `agent-conversation-workspace.tsx:936` 原样搬过来，**签名一字不改**：
  `function useQuickInputItems(initialItems: readonly SynapseQuickInputItem[] = EMPTY_QUICK_INPUTS): readonly SynapseQuickInputItem[]`
- 一并搬过去：`EMPTY_QUICK_INPUTS` 常量、它用到的那份小 `errorDiagnostic`（各模块各有一份，不强行统一）。
- 自带一个 logger：`createRendererLogger("renderer.quick-input")`，边界字符串相应变成 `renderer.quick-input.load` / `renderer.quick-input.bridge`（原来是 `renderer.agent.quick-input.*`）。这是诊断日志的分域变化，不是行为变化。
- import 用 `@/` 别名（`src/hooks/` 下的既有文件就是这风格）。
- 行为逐条对齐原实现：失败只 `warn` 不抛；`disposed` 标记防止卸载后 setState；卸载时 `unsubscribe`。

### 改动的文件

`desktop/src/modules/agent/components/agent-conversation-workspace.tsx`

- 删掉本地的 `useQuickInputItems` 和 `EMPTY_QUICK_INPUTS`，改成从 `@/hooks/use-quick-input-items` import。
- **本地那份 `errorDiagnostic` 留着** —— 文件里另有几处在用它。
- 调用点（`:231`）和 props 注入（`:836`）不动。

### 测试

- 新增 `desktop/src/hooks/__tests__/use-quick-input-items.test.ts`：桥可用时读得到列表、`onChanged` 推来的更新会生效、桥不可用时返回初始值且不抛、卸载后不再 setState。
- Agent 侧既有测试（`agent-conversation-workspace` 相关）应当**一条都不用改**，这就是「签名一字不改」的验收。

### 完成标准

- `rg -n "function useQuickInputItems" desktop/src` 只剩一处（新位置）。
- Agent 侧的快捷输入菜单行为不变：点一条仍然追加到草稿末尾、不发送。

---

## 阶段 3：面板组件

### 新增文件

`desktop/app-capabilities/terminal/renderer/terminal-quick-input-menu.tsx`

```tsx
type TerminalQuickInputMenuProps = {
  readonly items: readonly SynapseQuickInputItem[]
  readonly disabled?: boolean
  readonly onPick: (content: string) => void
}
```

**`items.length === 0` 时返回 `null`。**

结构：

- `Popover`（`../../../src/components/ui/popover`，`PopoverTrigger asChild`）+ 一颗 ghost 按钮：
  文案「快捷输入」+ `ChevronUp`，`h-7`，`text-foreground/75`，`hover:bg-accent`，`aria-label="快捷输入"`。
- `PopoverContent`：`side="top"`、`avoidCollisions={false}`、`align="start"`、宽 392px。
  **外层容器带 `.dark`** —— 终端区那个 `.dark` 管不到挂到 `body` 的弹层。
- 面板内部：外层 `flex`，左边是列表（最大高度 340px，`overflow-y:auto`），右边是预览卡（未打开时 `hidden`）。
  预览卡与列表同高、同底、同描边，`user-select: text`。
- 行（左起）：
  - 第一行 = `content` 的第一个非空行，`text-foreground`，单行截断。
  - 第二行 = 其余内容把换行折成空格，`text-muted-foreground`，单行截断；没有就不渲染。
  - 行尾眼睛按钮 → 打开预览（`aria-label="看全文：{标签}"`）。
  - 行主体是 `button`，眼睛是**兄弟** `button`，不要嵌套（`button` 里不能放 `button`）。
  - `aria-label="填入快捷输入：{标签}"`。
- 预览卡标题「全文」+ 右上角 X（`aria-label="收起全文"`）。
- **没有标题栏，没有空态文案**（空的时候整个组件不渲染）。
- 预览打开时点行，面板整个关掉，预览一起关。

**取标签和折叠正文的两个小函数要有测试**（第一行全空、只有一行、行首有空白、正文里有多余空行这几种输入）。

### 测试

`desktop/app-capabilities/terminal/renderer/__tests__/terminal-quick-input-menu.test.tsx`

- 空列表不渲染任何东西。
- 六条内置句子（`quick-input/shared/defaults.ts` 那六条）逐条渲染出正确的标签与正文。
- 点一行 → `onPick` 收到的是**完整原文**（含换行），不是标签。
- 点眼睛 → 预览出现且含换行；点 X → 收起。
- 点眼睛不触发 `onPick`。
- 眼睛带 `aria-label`，键盘可达。

### 完成标准

- 只跑组件测试就能确认面板长相与行为。
- 这个阶段**不碰 `index.tsx`**，命令条上还看不到它。

---

## 阶段 4：接进命令条最左侧

`desktop/app-capabilities/terminal/renderer/index.tsx:1746-1822`。

### 结构改成

```tsx
<div className="relative shrink-0">
  <div data-terminal-toolbar className="flex min-h-10 items-center border-t bg-card">
    {/* 新增：钉住的左端，在滚动区之外 */}
    <div className="flex shrink-0 items-center px-2.5 py-1.5">
      <TerminalQuickInputMenu items={quickInputItems} disabled={…} onPick={…} />
    </div>
    <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
    {/* 原来的滚动容器，内容一个字不动 */}
    <div className="no-scrollbar flex min-h-10 flex-1 items-center gap-1 overflow-x-auto px-2.5 py-1.5 whitespace-nowrap">
      …原有全部子节点…
    </div>
  </div>
  {sessionLockedByMobile ? <遮罩/> : null}
</div>
```

**两条硬要求：**

1. `data-terminal-toolbar` **留在最外层**。它现在挂在唯一那个滚动容器上，测试和样式都按它找；留在外层，既有查询（`toolbar.querySelector(...)`）才继续成立。
2. 滚动容器里原有的子节点**一个都不许动**，只加一层包裹。麦克风仍在滚动区末尾（产品文档 §6 非目标）。

### 数据与禁用

```tsx
const quickInputItems = useQuickInputItems()
const quickInputDisabled = terminalSessionStatus !== "running" || sessionLockedByMobile
```

`onPick` 本阶段先接一个占位（`toast` 或空实现），阶段 5 接上写入 —— 或者干脆把阶段 4 和 5 合成一个提交做，别在中间留下点了没反应的按钮。

### 测试

`terminal-module.test.tsx` 里补：

- 命令条上有 aria-label 为「快捷输入」的按钮，且它是 `[data-terminal-toolbar]` 下**第一个**按钮。
- 给它一批假 items，点一条 → 收到原文。
- items 为空 → 命令条上**没有**这个按钮，其余按钮一个不少。
- 会话非 running → 按钮 `disabled`。
- 手机占用（`sessionLockedByMobile`）→ 按钮 `disabled`。
- **既有那条「工具栏按钮顺序」的断言要跟着更新**（新按钮插在最前）。

### 完成标准

- 命令条最左出现「快捷输入」，点开有面板。
- 把命令条横向滚到底，这颗按钮不动（在测试里用 `scrollLeft` 或结构断言证明它在滚动容器之外）。

---

## 阶段 5：写入通道

### 5.1 bracketed paste

`desktop/app-capabilities/terminal/renderer/terminal-workspace-view.tsx`

- `PaneControls`（`:115`）加一项 `isBracketedPasteMode(): boolean`。
- pane 子组件里构造 `clear()` / `focus()` 的地方补上它，读 `xterm.modes.bracketedPasteMode`（`xterm` 实例在该组件里）。
- `TerminalWorkspaceViewHandle`（`:113`）加 `isBracketedPasteMode(): boolean`，`useImperativeHandle`（`:356`）里照着 `clearActivePane()` 的样子解析到当前 pane。

`index.tsx` 新增一个纯函数（放 `shared/` 或 renderer 内均可，**必须单独可测**）：

```ts
function wrapBracketedPaste(content: string, enabled: boolean): string {
  return enabled ? `\x1b[200~${content}\x1b[201~` : content
}
```

选一句之后：

```tsx
const data = wrapBracketedPaste(content, workspaceViewRefs.current.get(activeWorkspace.id)?.isBracketedPasteMode() ?? false)
await terminalBridge.session.write({ sessionId: activeSession.id, data })
setPendingInputText(null)   // 清除已有提示，见 5.2
```

**不补 `\r`。** 不走 `buildTerminalCommandWrites`。

### 5.2 快捷输入不显示待执行提示

2026-09-22 调整：快捷输入成功写入后清除 `pendingInputText`，不重复展示输入内容或「待执行 · Enter 执行」。语音输入自身的提示行为保持不变。

### 5.3 错误路径

写入失败：`logger.error` + `toast.error("写入终端失败")`，与 `commitVoiceInput` 完全一致。

### 测试

- `wrapBracketedPaste` 的单元测试：`enabled` 真假两条、内容含换行、内容为空。
- 选一句之后：`session.write` 收到的是 `\x1b[200~…\x1b[201~`，且**以 `\x1b[201~` 结尾、不含 `\r`**。
- 应用没开 bracketed paste 时收到的是原文。
- 写入后不显示「待执行」提示；按 Enter 那条路不被本改动影响。
- **反证**：把 `wrapBracketedPaste` 的 `enabled` 恒置为 `false`，断言必须红；把 `\x1b[201~` 去掉，断言必须红。只断言「收到了内容」的测试在这两种坏法下都是绿的。

### 完成标准

- 在 Claude Code TUI 会话里点一句：整段进输入框、多行保留、**没有提交**。
- 在纯 zsh 会话里点一句：整段进命令行、**没有执行**。
- 命令条上方不显示待执行提示。

---

## 阶段 6：规则文档、发布说明、收尾

### 规则文档（CLAUDE.md 的硬要求，不能漏）

- `docs/agents/module-boundaries.md:59`：把「内置快捷输入 / 用户快捷输入」的措辞改成「内置快捷命令 / 用户快捷命令」。**那句约束本身一个字不改**（两者不得混存、不得注册 MCP 工具）。
- `docs/agents/capability-registry.md`：同一批措辞跟着改；**新增一条**说明桌面终端读取「快捷输入」App 的句子只走现有渲染进程 UI，不注册 System App / Dock / Workflow Node / Automation Action / MCP capability/tool / Deep Link，Terminal MCP 工具数量保持 49。
- 把原型与三份文档落进仓库 `docs/prototypes/` 与 `docs/superpowers/specs|plans/`（仓库惯例，见 `ead683b001`）。

### 发布说明

`RELEASE_NOTES_PENDING.md` 「功能优化」补一条，面向用户说清得到什么：

> 终端底部命令条最左侧多了一颗「快捷输入」，点开就能把你在「快捷输入」里维护的句子填进命令行；句子不会自动执行，按 Enter 才执行。终端里原来那套自定义按钮改叫「快捷命令」，和手机端叫法一致。

### 最后一遍验收

逐条走 `产品设计文档.md` §8 的 13 条，报告要如实 —— 红就是红。

### 完成标准

- `pnpm --filter @synapse/desktop run check:hard-constraints` 通过。
- `pnpm --filter @synapse/desktop run test` 全绿。
- Terminal MCP 工具数量仍是 49。
- `RELEASE_NOTES_PENDING.md` 已更新。
