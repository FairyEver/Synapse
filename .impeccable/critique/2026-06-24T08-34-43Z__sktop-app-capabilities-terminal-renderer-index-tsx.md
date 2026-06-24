---
target: 终端应用界面与 UE
total_score: 17
p0_count: 0
p1_count: 4
timestamp: 2026-06-24T08-34-43Z
slug: sktop-app-capabilities-terminal-renderer-index-tsx
---
# 终端应用界面与 UE 审查

Target: `desktop/app-capabilities/terminal/renderer/index.tsx`

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | 只有“运行中”徽标，缺少 exit code、断开原因、当前进程、同步/读取失败等状态 |
| 2 | Match System / Real World | 2 | 终端用户预期 tabs/splits/current cwd/shell controls，现在更像分组列表 + 黑色预览区 |
| 3 | User Control and Freedom | 2 | 有停止/删除，但停止、删除、重启语义不够清楚，误操作恢复路径弱 |
| 4 | Consistency and Standards | 2 | 全局新建、分组新建、会话操作分散在三处，层级不像常见终端工具 |
| 5 | Error Prevention | 2 | 删除有确认，但停止会话、读写失败、断开、输出截断缺少用户可见保护 |
| 6 | Recognition Rather Than Recall | 2 | 重命名/删除/分组新建终端都藏在省略号里，需要用户探索 |
| 7 | Flexibility and Efficiency | 1 | 缺少快捷键、标签页、搜索、分屏、复制粘贴提示、最近 cwd 等高频效率入口 |
| 8 | Aesthetic and Minimalist Design | 2 | 头部、会话头、侧栏、终端边框叠加，真正输入区域被过多 chrome 包围 |
| 9 | Error Recovery | 1 | 多数错误只写 logger，用户看不到失败原因和重试动作 |
| 10 | Help and Documentation | 1 | 终端特有操作没有最小可发现线索，空状态也没有引导创建上下文 |
| **Total** | | **17/40** | **可用，但还不像可信的高频终端工作区** |

## Anti-Patterns Verdict

**LLM assessment:** 不像典型 AI 渐变/卡片堆砌界面，静态风格比较克制，符合 Synapse 的 neutral token 基线。但它有产品 UI 的另一类问题：布局看起来“拼起来了”，不是围绕终端任务重新组织。用户看到的是应用壳、返回栏、按钮栏、分组栏、会话头、黑色容器层层叠加，终端本体反而像嵌入预览。

**Deterministic scan:** `detect.mjs --json desktop/app-capabilities/terminal/renderer/index.tsx` 返回 `[]`。没有检测到典型 slop 规则命中。这里的主要缺陷是任务流、信息架构、响应式与状态反馈，不是 detector 能抓的样式反模式。

**Visual evidence:** 基于用户提供截图和源码审查。未启动 dev server，未做 browser overlay；这是 Electron 内嵌应用截图，且仓库规则要求非必要不主动启动本地应用。

## Overall Impression

当前界面能打开一个 shell，但没有让用户感觉“这是我可以长时间工作的终端”。最大机会是把终端本体提升为第一层，把分组、会话和危险操作压缩成围绕当前会话的辅助控制。

## What's Working

- xterm 集成方向正确：FitAddon、WebLinksAddon、WebGL fallback、Powerline/Nerd Font 字体链都在考虑真实终端显示。
- 分组、会话、重命名、删除等数据能力已经存在，后续重排 UI 不需要重写核心能力。
- 删除终端/分组有确认弹窗，至少没有把破坏性删除做成静默操作。

## Priority Issues

### [P1] 终端输入区被过多外壳降级

**Why it matters:** 终端是高频输入界面，用户需要第一眼就能定位光标、当前路径和可输入区域。现在左侧 13.5rem 侧栏、二级会话头、终端容器圆角边框一起挤占空间，黑色区域像被放进一个展示框。

**Fix:** 让 xterm 区域在当前会话下 full-bleed，占满剩余空间；移除终端容器的 `rounded-lg border`；侧栏默认可折叠或改成更轻的会话 rail；会话标题/状态/动作合并成一条紧凑 toolbar。

**Suggested command:** `$impeccable layout`

### [P1] 会话模型不符合终端用户心智

**Why it matters:** 终端用户首先想切换 session/tab、看 cwd、开新 shell、分屏或恢复最近上下文。当前主要结构是“分组 -> 会话”，而且“新建分组”比当前会话操作更显眼，用户会疑惑分组是不是必须步骤。

**Fix:** 以会话 tab 或 session rail 为主，分组作为可选筛选/整理能力；“新建终端”应支持当前 cwd、新 cwd、指定分组三个明确入口；当前会话的 cwd/shell 应能直接编辑或复制。

**Suggested command:** `$impeccable shape`

### [P1] 状态与危险动作权重错误

**Why it matters:** “运行中”是 outline badge，“停止会话”也是 outline button，两者同权重；用户无法判断停止是关闭视图、终止 shell、还是删除会话。停止运行中任务是高风险操作，尤其在命令执行时。

**Fix:** 区分状态、非破坏动作和终止动作：状态用紧凑状态点/label；停止用更明确的“终止进程”或“停止终端”，必要时确认；退出态显示退出码/结束时间；断开态显示“只读”和重连/新开入口。

**Suggested command:** `$impeccable clarify`

### [P1] 错误、断开、读写失败没有用户可见恢复

**Why it matters:** 代码里加载、创建、停止、读输出、写输入、resize 失败大多只写 logger。用户看到的可能只是空黑屏、按钮无反应或 stale 输出，无法自救。

**Fix:** 对关键失败给 toast 或 inline banner：加载失败、创建失败、写入失败、读取失败、resize 失败降级；给“重试加载”“重新连接”“复制错误”这样的直接动作。输出被截断时应显示边界提示。

**Suggested command:** `$impeccable harden`

### [P2] 操作分散且发现成本高

**Why it matters:** 全局“新建终端”在上层 header，分组“新建终端”藏在 group 菜单，会话重命名/删除藏在 row 菜单，停止在会话头。用户需要在三个区域寻找操作。

**Fix:** 统一动作层级：主动作只保留“新建终端”；当前会话动作集中在当前会话 toolbar；分组动作只在管理模式/右键菜单出现；给常用操作增加快捷键和命令面板入口。

**Suggested command:** `$impeccable distill`

## Persona Red Flags

**Alex, Power User:** 需要快速开多个 session、切换目录、查历史输出。当前无 tab/split/search/快捷键可见，左侧分组占空间但不提升效率，高频工作会觉得慢。

**Jordan, First-Timer:** 看到“新建分组”和“新建终端”两个主入口，不知道先建哪个；“在此处新开”语义含糊；省略号菜单隐藏了重命名/删除。

**Chen, Operations User:** 在运行命令时需要明确状态和错误恢复。当前只有“运行中”，没有进程/退出码/失败原因；停止会话含义不够危险明确。

## Minor Observations

- 当前路径在侧栏 row 和会话 header 重复，占用横向空间。
- 左侧栏宽度固定为 `13.5rem`，不可拖拽，长路径只能截断。
- 小屏下侧栏变成顶部 `max-h-48` 列表，终端会被压到下方，移动/窄窗口体验很差。
- header 使用 `flex-wrap`，窄窗口时状态和按钮可能换行，占用终端高度。
- 空状态只有“暂无会话”，缺少最短路径，比如直接创建当前默认 shell。
- `在此处新开` 不够像用户语言，应说明是在同 cwd 新建终端，还是恢复断开会话。
- xterm 区域缺少明确 `aria-label`/region label，屏幕阅读器无法知道黑色区域是什么。
- terminal focus 状态不明显，用户不确定键盘输入是否已经进入 xterm。
- 暗色终端嵌在浅色应用里可接受，但现在边框和圆角让它像卡片，不像工作区。
- 分组标题右侧省略号和会话右侧省略号视觉重复，鼠标悬停前区分度低。
- 删除分组说明提到会停止运行中会话，但没有列出受影响会话数量。
- 停止当前会话没有确认或 undo，对运行中命令风险较高。
- 没有复制 cwd、打开当前目录、从当前 cwd 新建等终端常见辅助动作。
- 没有显示 shell 类型、开始时间、结束时间、退出码或最后活跃时间。
- 没有输出搜索、清屏、复制全部输出、保存输出等操作入口。

## Questions to Consider

- 终端的主对象到底是“分组”，还是“当前可输入的 session”？
- 用户最常做的是管理终端，还是在终端里工作？现在视觉权重更偏前者。
- 停止会话在产品语义里是关闭视图、kill process，还是删除 runtime？按钮文案必须只表达其中一个。
- 这个应用要成为轻量内嵌终端，还是 Synapse 的长期工作终端？两者布局密度不同。
