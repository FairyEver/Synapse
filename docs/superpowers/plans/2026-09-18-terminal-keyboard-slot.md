# 键盘面板改为键盘槽位 · 实施计划

> 权威设计见 `docs/superpowers/specs/2026-09-18-terminal-keyboard-slot-design.md`。**决策、非目标、验收基线都以它为准**，本文件只回答"分几步做、每步改哪、怎么验"。
> 界面原型：`docs/prototypes/2026-09-18-terminal-keyboard-slot.html`（仓库内路径）。

---

## 总览

| 阶段 | 内容 | 能不能单独上线 |
|---|---|---|
| 0 | 终端：内容不满一屏时贴底 | 能 |
| 1 | 面板：从 sheet 搬进键盘槽位、固定高度、不可拖拽 | 能，但不建议单独发（§3.4 的收起规则还缺） |
| 2 | 面板与键盘的互斥、收起规则 | 与阶段 1 一起发 |
| 3 | 真机验收与装机 | — |

**本次不涉及服务端与桌面端**，没有 `MOBILE_KEYS` 之类的多端契约，不需要跨端升级顺序。

每个阶段独立验证、独立提交。**不要攒到最后一次提交。**

---

## 阶段 0 · 终端：内容不满一屏时贴底

### 产物

`SynapseMobile/SynapseMobile/Features/Terminal/TerminalTextView.swift`：让滚动视图在**内容比可视区短**的时候把内容推到底边。

做法是给 `TerminalCollectionView` 维护一个顶部 inset：

```
inset.top = max(0, bounds.height - contentSize.height)
```

- 内容满了之后它是 0，等于什么都没做，正常滚动不受影响；
- 内容短的时候它把整块内容推到贴着底边。

### 关键约束

- **写之前先读 §2.2。** `TerminalTextView.layoutSubviews` 里那段"高度变化时贴回底部"的逻辑（`:318`）是**故意**的，本阶段**不要动它**——它管的是"内容超过一屏"的情况，本阶段管的是"内容不满一屏"，两者互补。
- **`isPinnedToBottom` 的判定不要改。** `scrollViewDidScroll` 里的 `distanceFromBottom < 40` 依赖 `contentOffset`；加了顶部 inset 之后静止时的 `contentOffset.y` 是负值，算出来仍然是 0，判定依旧为真。改判定就会把"翻到历史里不打扰用户"这条一起弄坏。
- **避免自激**：设置 `contentInset` 会触发一次布局，布局里又去设置它就会来回抖。只在**算出来的值和当前值不同**时才写。
- 内容变化（新输出、行数变化、字号变化）也要重算，不只是 `bounds` 变化时。建议收敛到一处 `updateBottomInset()`，在 `layoutSubviews` 与快照应用之后各调一次。
- **顺手确认它到底有没有生效**：`content = 120 行` 而 `bounds` 装得下 150 行时，inset 应当是正数；若算出来恒为 0，说明那几行空白是 TUI 自己画的（设计文档 §2.3 的第二种），本阶段就不产生任何可见变化——**不要因此去裁行**，那是另一个问题，回来说一声即可。

### 涉及文件

- `SynapseMobile/SynapseMobile/Features/Terminal/TerminalTextView.swift`
- `SynapseMobile/SynapseMobileTests/` 下新增一个布局单测（见验证）

### 验证

```bash
xcodebuild -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

单测（不需要 server、不需要 mock 桌面端）：

```bash
xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests -parallel-testing-enabled NO
```

`TerminalCollectionView` 可以直接在单测里构造（`@testable import`），断言的是"布局落在哪儿"这类问题，不必截图：

- 给一个**比内容高**的 frame → 内容第一行的 `y` 应当 **> 0**（贴底）；
- 给一个**比内容矮**的 frame → inset 应当是 0，且第一行的 `y` 为 0（正常贴顶 + 可滚动）;
- 既有断言 `lessThanAPaneOfOutputSitsAtTheTop` **会因此变红**——它钉的就是"不满一屏时贴顶"这条旧行为。**本次要改的是这条断言的期望值**（改成贴底），不是删掉它；改完在提交信息里说明为什么翻这条口径。

### 完成标准

- 新单测覆盖上面三种情形，并且在把 `updateBottomInset()` 摘掉时会变红；
- 旧断言按新口径更新，没有删除；
- `SynapseMobileTests` 全绿。

---

## 阶段 1 · 面板：从 sheet 搬进键盘槽位

### 产物

1. **`TerminalScreen.swift`**：面板不再是 `.sheet`，而是 `VStack` 里 `inputBar` 下面的一行。

   现在的形态是：

   ```swift
   .sheet(isPresented: $keyboardPanelPresented) {
       TerminalKeyboardPanel(isEnabled: isRunning) { actions in … }
       .presentationDragIndicator(.visible)
   }
   ```

   改成 `VStack` 的成员，严格排在 `inputBar` 之后——这样工具栏和输入框天然在它上方，终端可视区天然变矮，不需要任何额外的避让计算。

2. **`TerminalKeyboardPanel.swift`**：
   - 去掉 body 上的 `.presentationDetents(...)`（连同 `.large`）；
   - 去掉 `KeyboardPanelCategory` 上的 `gridHeight` / `restingHeight` 两个按分类取值；
   - `KeyboardPanelMetrics` 收敛成**一个**面板高度常量（起始 370）；
   - 面板自身撑满这个固定高度；**非全键盘页的键位格顶部对齐**，下面空出来的部分保持空白（这是设计文档 §3.2 明说接受的代价）。

3. **面板不再是模态**，所以它下面的画布重新可点——这正是阶段 2 要处理的事。

### 关键约束

- **面板里的按键、分类、锁存交互一个字都不改。** 所有 `panelkey-*` 的 accessibility identifier 保持不变，否则上一轮的走查测试会集体失效。
- **`isEnabled` 的语义不变**：终端不在运行时整块面板灰掉。
- 不要给面板加圆角容器、阴影或下拉把手——它现在是一个键盘（设计文档 §3.1）。
- 终端不在运行时、以及面板收起时，`VStack` 里不要留一个高度为 0 的空视图（会引入额外的布局通道）；用 `if keyboardPanelPresented { … }`。

### 涉及文件

- `SynapseMobile/SynapseMobile/Features/Terminal/TerminalScreen.swift`
- `SynapseMobile/SynapseMobile/Features/Terminal/TerminalKeyboardPanel.swift`

### 验证

```bash
xcodebuild -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

在模拟器上手工过一遍设计文档 §5 的 1–5、10–12 条。

### 完成标准

- 点 ⌨ 后面板在键盘的位置升起，工具栏与输入框可见；
- 四页高度一致，切页时面板边缘与工具栏都不动；
- 没有下拉把手，向下滑不改变任何东西。

---

## 阶段 2 · 互斥与收起规则

### 产物

设计文档 §3.4 的那张表：

| 操作 | 结果 |
|---|---|
| 点 ⌨ | 面板升起（系统键盘收起，这是现状，保持） |
| 再点 ⌨ | 面板收起 |
| 点输入框 | 面板收起、系统键盘升起 |
| 点终端画布 | 面板收起 |

### 关键约束

- **点画布收起面板**这一条写在终端画布的 `onTap` 里（现在是 `inputFocused = false`），与"点别处收起键盘"共用同一个入口——两条规则不应该各写一遍。
- **任何时候两者都不同时出现。** 面板升起前必须先把输入框失焦（现状已如此）；反过来点输入框时也必须先收面板。
- 收起面板**不要**让终端跳回顶部：阶段 0 的贴底与 §2.2 的"在底部则跟随"两条都要保持成立（验收基线第 12 条）。

### 涉及文件

- `SynapseMobile/SynapseMobile/Features/Terminal/TerminalScreen.swift`

### 验证

模拟器手工过设计文档 §5 的第 6、7、12 条。

---

## 阶段 3 · 真机验收与装机

### 收尾清单

- 逐条走设计文档 §5 的 12 条验收基线，每条都要能说出"怎么验的"；
- 跑一遍上一轮的全键盘走查（`TerminalFlowUITests/TerminalToolbar…`），确认锁存、`⇧tab`、`Ctrl+I→Tab`、`Alt` 组合都没有回归；
- **装到李杨的 iPhone 上真机走一遍**，不能拿"测试通过"交差。快速装机：`pnpm mobile:install`；
- 更新 `RELEASE_NOTES_PENDING.md`（用户可感知：面板不再盖住工具栏和输入框、高度不再跳、内容贴底）；
- 核对 `docs/agents/capability-registry.md`（本次**不新增 capability**，按 CLAUDE.md 要求核对一遍确认表格无变化）；
- 把产品设计文档与实施计划落进仓库：
  - `docs/superpowers/specs/2026-09-18-terminal-keyboard-slot-design.md`
  - `docs/superpowers/plans/2026-09-18-terminal-keyboard-slot.md`
  - 原型可放 `docs/prototypes/2026-09-18-terminal-keyboard-slot.html`

---

## 全局验证清单

```bash
xcodebuild -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build

xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests -parallel-testing-enabled NO
```

端到端走查需要一个"桌面端"当终端来源，用仓库里的模拟桌面端（`server/test/mock-desktop.mjs`，用法见 `SynapseMobile/README.md`）；它会把发出去的键名回显出来。

**不要用裸 `npx vitest`**（桌面端无关，但仓库规矩）：它会解析到缓存副本、静默少跑文件。

---

## 风险

| 风险 | 表现 | 怎么防 |
|---|---|---|
| 顺手把 §2.2 那段"高度变化时贴回底部"当成 bug 改掉 | 内容超过一屏时新输出滑出可视区 | 设计文档 §2.2 写死了它是故意的；阶段 0 的关键约束重复了一遍 |
| 顶部 inset 与既有 `isPinnedToBottom` 打架 | 键盘弹起后翻到历史里的用户被强行拽回底部 | 不要改判定；阶段 0 的单测覆盖"内容超过一屏"的情形 |
| 设置 inset 触发自激 | 界面持续重绘、文字闪烁 | 只在值变化时写；参考 `layoutSubviews` 里既有的"只在 pane 尺寸真变了才重算"的写法 |
| 面板改成槽位后走查测试集体失效 | UI 测试找不到 `panelkey-*` | identifier 全部保持不变；阶段 3 专门跑一遍上一轮的走查 |
| 固定高度取值过大 | 上方终端被挤得太短，按着键盘看不见输出 | 起始 370，真机上以"放得下四行且不挤压上方终端"为准（开放项 1） |
| 点画布收起面板误触太多 | 一边看一边按时面板反复消失 | 开放项 2 留了口子：真机手感不好就撤掉这条，只留 ⌨ 切换 |
