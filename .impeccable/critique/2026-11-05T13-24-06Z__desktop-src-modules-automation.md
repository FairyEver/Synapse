---
score: 19
max: 40
p0: 0
p1: 5
p2: 23
p3: 2
timestamp: 2026-11-05T13-24-06Z
slug: desktop-src-modules-automation
---
# 自动化应用界面设计评估

日期：2026-11-05，Asia/Shanghai。目标：/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation 及真实可达共享配置、结果组件。分支 main，读取时 HEAD b3dc1566c；包含当前未提交工作区。评估期间存在其他任务持续修改，已重读新增附加条件与旧版停用状态，行号为本轮快照。

结论：本轮确认30项问题，P0为0、P1为5、P2为23、P3为2，另有3组待实测布局风险。启发式设计健康度19/40。核心问题是状态表达、执行语义、防错恢复和组件组合一致性。当前没有足够证据宣称穷尽所有运行时设计缺陷。

## 范围与证据

- 源码覆盖：列表/筛选/搜索/空错加载状态，详情及运行策略，新建与编辑，5种触发器（Cron、固定间隔、Webhook、站内信、邮件），2种执行器（Agent、Claude Code），新增附加条件，类型菜单与替换确认，变量查看/搜索/插入，运行记录与结果、停止、删除与未保存保护。
- 实际应用：看到运行中的Synapse Dev列表及可访问树，正常站内信任务下次运行显示未知。未保存、启停、执行或删除任何真实任务。
- 浏览器：使用现有21:01构建的React组件预览，展开Cron、Agent、Claude Code、类型菜单、替换确认、变量面板，并取得详情截图。预览早于新增条件等并发变化，不将其旧布局认定为当前事实。
- 原生工具后续返回App quit；浏览器会话返回session_window_closed，未擅自重启应用或服务。因此最新条件区、全部弹层的窄窗/暗色/键盘/VoiceOver验收尚未完成。
- Impeccable两路评估独立进行，A未运行detector或阅读B结果。B在自动化目录及真实可达表单运行detector，结果均为[]，命中0、规则0、误报0。零命中不覆盖交互语义、动态状态或布局正确性。

## 截图问题

已启用状态胶囊、编辑按钮和停用动作被当成三个平级元素摆放。状态和启停没有形成一组，列表又用Switch，造成同一应用内的启停表达不一致。Badge和Button不同高本身不是错误，也不应机械统一成大按钮。修正应先明确状态控制组，再把编辑作为独立动作，并统一列表与详情启停语言。

## 高优先级问题

| 编号 | 优先级与位置 | Before 当前问题及影响 | After 修正方向 | 证据 |
|---|---|---|---|---|
| 01 | P1 离开编辑 | 只有“放弃 / 保存”，缺少可见的继续编辑入口；校验失败后鼠标用户难以回到表单。 | 增加“继续编辑”，保留草稿并允许定位错误。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/editor/editor-form.tsx:53) |
| 02 | P1 Cron 预览 | 未来5次忽略所选时区及附加条件，可能显示实际不会执行的时间。 | 与调度共用时区和条件计算，显示有效时区。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/automation-triggers/cron-input.tsx:20) |
| 03 | P1 Cron 模式切换 | 高级表达式无法推断模板时，“常用”显示默认每天9点，但保存的仍是原表达式。 | 明确转换并同步值；不能无损转换时说明并让用户选择模板。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/automation-triggers/cron-input.tsx:17) |
| 04 | P1 保存校验 | 项目、模型、提示词等错误合并在页尾；没有字段定位、就近错误及自动展开。 | 保留错误字段路径，关联 aria-invalid/描述，聚焦首错。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/editor/editor-form.tsx:44) |
| 05 | P1 Cron 计算 | 未来5次即使折叠仍同步逐分钟计算；稀疏表达式会造成长任务。 | 按需计算，采用跳跃算法或后台计算。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/automation-triggers/cron-input.tsx:20) |

Cron具体证据：纯函数导入后，表达式0 9,17 * * *的inferCronTemplate返回null，默认模板却生成0 9 * * *。切换常用标签没有同步表达式。性能单次复测：每分钟计划2ms，每年元旦计划924ms，每年2月29日计划4856ms，均为固定起点2026-11-05T12:00:00Z取5次。测量是同一计算函数的终端耗时，不等同于已录制的Renderer帧率；源码显示它在Renderer useMemo中同步计算。

## 交互和视觉一致性问题

| 编号 | 优先级与位置 | Before 当前问题及影响 | After 修正方向 | 证据 |
|---|---|---|---|---|
| 06 | P2 详情操作组 | 已启用胶囊、outline编辑和ghost停用零散并列；启停与列表Switch不一致。 | 状态与开关组成一组，编辑作为独立动作，统一启停词汇。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/detail/automation-detail.tsx:65) |
| 07 | P2 列表状态 | 运行中仍可能显示已启用或上次失败，只靠Play变Square提示运行。 | 明确区分启停、当前运行和上次结果。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/components/automation-list-row.tsx:32) |
| 08 | P2 下次运行 | 事件任务正常等待也显示未知；完成后起算的运行中任务同样显示未知。 | 分别显示等待事件、本次完成后计算，异常才使用未知。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/utils.ts:210) |
| 09 | P2 列表辨识 | 副标题只展示触发器/执行器类型，多条同类任务难以比较。 | 优先展示计划、来源账号或Webhook名称等区分信息。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/components/automation-list-row.tsx:65) |
| 10 | P2 搜索范围 | 搜索只匹配名称，界面可见项目和触发来源搜不到。 | 覆盖必要可见信息，或明确标为按名称搜索。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/index.tsx:372) |
| 11 | P2 详情字段 | accountId、singleRun直接用原始key，账号ID未转可识别名称。 | 补中文展示元数据和账号名称映射。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/detail/configuration-fields.ts:7) |
| 12 | P2 Claude Code模式 | “单次模式”易被理解为自动化仅运行一次；实际控制CLI生命周期。 | 改为明确生命周期的标签或必要短说明，保持运行契约。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/action-packages/builtin/claude-code/config.renderer.tsx:30) |
| 13 | P2 无配置触发器 | 站内信这类无配置项的触发器仍渲染空配置主体和分隔线。 | 无字段时省去空主体，将变量入口放到有效内容旁。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/editor/trigger-executor-builder.tsx:111) |
| 14 | P2 附加条件详情 | 触发/执行区有修改入口，新附加条件区只有摘要。 | 补同样的分段修改入口并定位条件区。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/detail/automation-detail.tsx:98) |
| 15 | P2 旧版停用状态 | 提示请新建重新配置，却没有直接的新建入口。 | 在受限状态提供新建自动化，保留旧配置供核对。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/detail/automation-detail.tsx:77) |
| 16 | P2 数字输入 | 固定间隔每键立即Number转换，清空变0，非法输入变NaN；Cron数字字段也混淆暂态值。 | 保留字符串编辑态，blur/提交解析，提供范围与就近错误。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/automation-trigger-packages/builtin/interval/config.renderer.tsx:25) |
| 17 | P2 项目空状态 | Agent和Claude Code项目选择器在无项目时为空，没有下一步。 | 显示尚无项目及有效的项目设置入口。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/action-packages/builtin/claude-code/config.renderer.tsx:19) |
| 18 | P2 邮件先决条件 | 无邮箱账号时仅显示全部邮箱账号；未登录提示缺少就近登录入口。 | 说明当前无可监听账号并提供配置入口；保留全部账号的未来加入语义。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/automation-trigger-packages/builtin/mail-received/config.renderer.tsx:14) |
| 19 | P2 Webhook空状态 | 列表为空时是空下拉，虽然有创建入口，但无数据与加载问题的区分不足。 | 明确无Webhook，并关联已有创建入口。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/automation-trigger-packages/builtin/webhook/config.renderer.tsx:144) |
| 20 | P2 表单可访问名称 | Webhook标签未关联选择器；间隔起算组无名称；Agent会话组使用英文名称。 | 用可见中文label的ID关联组和选择器，并关联错误。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/action-packages/builtin/agent/config.renderer.tsx:140) |
| 21 | P2 后台刷新 | 列表失败替换整个已有内容；历史刷新先清空旧记录，引起阅读中断和跳变。 | 保留上次成功内容，初次加载和后台刷新分别反馈。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/components/automation-runs-dialog.tsx:45) |
| 22 | P2 历史信息密度 | 最多100条运行的结果、错误默认全展开，难以扫描时间和状态。 | 每条先给时间、状态和短结果，详细输出按需展开。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/components/automation-runs-dialog.tsx:155) |
| 23 | P2 历史范围 | 默认只取100条，却没有范围说明或继续查看入口。 | 明确最近100条；按现有协议提供继续查看或准确标注限制。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/hooks/use-automation.ts:92) |
| 24 | P2 停止反馈 | 停止无独立pending，可重复点击；停止失败旁的重试实际只重载历史。 | 锁定该运行的停止动作，显示请求中；恢复按钮匹配失败操作。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/components/automation-runs-dialog.tsx:84) |
| 25 | P2 删除核对 | 删除确认不显示任务名称，点错垃圾桶后无法最后核对对象。 | 确认中展示具体任务名，支持长名称折行。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/index.tsx:463) |
| 26 | P2 编辑页运行记录 | 不订阅运行变化；停留页内可能一直显示旧状态，焦点刷新又受dirty限制。 | 独立订阅当前任务运行变化，更新记录而不覆盖草稿。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/hooks/use-automation-editor.ts:90) |
| 27 | P2 详情标题焦点 | 预览进入详情后自动聚焦h1，整行出现类似输入框的轮廓。 | 保留导航焦点与读屏定位，避免非交互标题呈现可编辑控件外观。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/detail/automation-detail.tsx:37) |
| 28 | P2 变量反馈 | 变量分组仅用外观表达选中，复制成功/失败没有主动播报。 | 补aria-pressed等选中语义，复制结果用role=status。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/editor/trigger-variables-dialog.tsx:108) |

## 细节问题

| 编号 | 优先级与位置 | Before 当前问题及影响 | After 修正方向 | 证据 |
|---|---|---|---|---|
| 29 | P3 折叠箭头 | 未来5次、会话与超时的箭头始终向下，视觉上不反映展开。 | 随状态切换方向；沿用共享尺寸及减少动画偏好。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/automation-triggers/cron-editor-dialog.tsx:221) |
| 30 | P3 图标光学对齐 | 详情编辑/停用、类型菜单缺少共享Button支持的图标侧标记。 | 补data-icon位置标记，复用现有内边距校正。 | [源码](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/detail/automation-detail.tsx:67) |

## 待实测布局风险

| 风险 | 源码依据 | 验收条件 |
|---|---|---|
| 窄应用中名称列可能被压缩 | automation-list.tsx的5个固定列合计544px，名称列w-auto；共享Table有横向滚动，不能据此直接判定不可用 | 按实际应用内容区收窄，测名称、操作和滚动可达性，不能只测整个桌面宽度 |
| 内部表单的断点依据不一致 | 外层容器查询，Agent内部sm:grid-cols-2、会话高级区固定两列；变量组xl:grid-cols使用viewport | 大桌面中的窄应用窗、半宽配置面板，长供应商/权限名及200%缩放 |
| 变量区长内容滚动待确认 | trigger-variables-dialog.tsx外层flex-1，内部max-h-[60vh]，并有多层overflow | Webhook长模板、动态路径、长变量列表滚到最后；键盘焦点不被裁剪 |

新条件区的“并且符合以下条件”与内部“或者”可正确表示trigger AND (A OR B)，不把它误报为逻辑冲突。若重整文案，可明确“满足全部/任一附加条件”，以降低理解成本。

## 设计健康度

| Nielsen维度 | 分数 满分4 | 主要依据 |
|---|---|---|
| 状态可见性 | 2 | 等待事件被标未知，执行与启停混杂 |
| 符合用户语言 | 2 | 原始字段、账号ID与单次模式 |
| 控制与退出 | 1 | 离开确认没有可见继续编辑 |
| 一致性与标准 | 2 | Switch与Power、分段编辑不一致 |
| 防错 | 2 | 有确认，但计划预览和校验定位不足 |
| 识别胜于记忆 | 2 | 类型摘要辨识不足，空选择器缺下一步 |
| 使用效率 | 2 | 行内操作可用，搜索与历史范围有限 |
| 简洁与视觉层级 | 2 | 状态重复，历史输出密集 |
| 错误恢复 | 2 | 有重试，字段和停止恢复不匹配 |
| 必要帮助 | 2 | 变量工具可用，先决条件和关键语义不足 |
| 总计 | 19/40 | 需要系统处理体验问题 |

这是启发式判断，不是完整WCAG验收或客观认证分数。未测量对比度，不对深色主题、VoiceOver全流程及实际帧率作通过/失败判定。

## 整体设计与认知负荷

不是典型的装饰性AI界面：主题token、单一字体和共享组件基础可靠。问题是组合时状态、动作、信息优先级没有形成统一体系。新建时用户要判断触发、条件、项目、模型、权限、会话，反馈却集中在页尾；历史则把全部详细结果同时展开。这两个位置增加了任务本不需要的记忆与查找负担。

首次用户的低谷是遇到空项目/账号选择、误解单次模式、找不到继续编辑；熟练用户的低谷是区分同类任务、查找历史和辨认实时运行状态。任务结束时应让用户明确知道保存结果、启停状态及后续运行含义，目前这些表达尚不一致。

## Persona检查

- Jordan 首次使用者：空项目/账号缺就近下一步；单次模式容易误读；正常等待却显示未知。
- Alex 熟练用户：列表同类型任务缺区分信息，项目搜索不到，历史范围不明确、输出墙难扫描。
- Sam 辅助技术与键盘用户：标签关联和分组选中语义不足；保存错误不能直达字段；确认缺可见取消出口。

## 应保留的实现

- 同页触发/执行、唯一共享壳层、容器查询主布局、min-w-0和长文本折行。
- 类型更换前确认且只替换一侧；配置折叠和配置/历史切换保留表单输入。
- 运行结果依据历史executorType显示，终端入口失败不会自动新建会话。
- 已有全局字体平滑，运行时间和耗时已有tabular-nums，菜单使用Radix portal和radio语义。

## 修正顺序建议

1. impeccable harden：先处理离开恢复、字段错误定位与运行反馈；同时修正Cron真实值和预览契约。
2. impeccable optimize：移走Renderer同步Cron长计算。
3. impeccable clarify与layout：统一状态控制组、列表摘要、关键标签、历史信息层级，再验收3组布局风险。
4. impeccable polish：最后处理箭头、图标侧间距和一致性复核。

不建议新增装饰阴影、无目的动画、整组放大控件或迁移组件库。32px桌面默认按钮和28px行内按钮符合现有规范；通用40/44px建议不机械套用。当前轮次只评估，未修复产品代码、未部署、未执行真实自动化，也未创建代码提交。

## 证据图片

预览截图保存在本机：
- /tmp/synapse-automation-audit-cron.png
- /tmp/synapse-automation-audit-claude.png
- /tmp/synapse-automation-audit-agent.png
- /tmp/synapse-automation-audit-menu.png
- /tmp/synapse-automation-audit-vars.png
- /tmp/synapse-automation-audit-detail.png

这些是本轮本地证据，尚无在线链接，系统临时目录可能被清理。用户原始截图位于/var/folders/hw/zmxbg73s4r5g7x_39ymh_xbm0000gn/T/codex-clipboard-09ed2682-964b-4eaf-b31d-a3290a70e407.png。
