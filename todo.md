## 2026-04-21 17:54:08 +0800

### UI 日志审计结论

- 使用技能：`.claude/skills/ui-log-audit/SKILL.md`
- 本次审计范围：当前 `git diff` 中的 UI 相关文件，以及直接承接这些交互的共享 hook
- 底层埋点基线已存在：`Button`、`Dialog`、`AlertDialog`、`Tabs`、`Select`、`Input`、`Textarea`、`Slider` 等已接入 `track()`
- 异步通知基线已存在：`src/app-shell/notifications.tsx` 中 `promise()` 会记录 loading/success/fail 与耗时

### 本次确认的缺口

- `src/modules/content/hooks/use-content-create-form.ts`
  创建/编辑表单此前缺少业务层日志补位，尤其是：
  - 对话框显隐
  - 放弃确认弹窗显隐
  - 确认放弃
  - 校验失败字段
  - 外观相关字段切换
- `src/modules/content/hooks/use-content-icon-image.ts`
  图标图片相关流程此前缺少日志，且已有一次失败被静默吞掉：
  - 读取已有 icon 预览失败无日志
  - 选择新图片并写入预览无业务日志
  - 移除图片无业务日志

### 本次已修改代码

- `src/modules/content/hooks/use-content-create-form.ts`
  - 新增 renderer logger 接入
  - 新增创建/编辑对话框显隐日志
  - 新增放弃确认弹窗显隐日志
  - 新增确认放弃日志
  - 保留并复用表单校验失败日志、关键外观字段切换日志
- `src/modules/content/hooks/use-content-icon-image.ts`
  - 为 icon 预览加载失败补 `logger.error`
  - 为 icon 图片更新补 `logger.info`
  - 为 icon 图片移除补 `logger.info`
  - 为本地 blob 读取失败补 `logger.error`
- `src/modules/prompts/components/prompt-create-dialog.tsx`
  - 通过 `logContext` 把 prompt 创建/编辑表单接到共享日志 hook
- `src/modules/rules/components/rule-create-dialog.tsx`
  - 通过 `logContext` 把 rule 创建/编辑表单接到共享日志 hook
- `src/modules/skills/components/skill-create-dialog.tsx`
  - 通过 `logContext` 把 skill 创建/编辑表单接到共享日志 hook

### 同范围内已覆盖、无需重复补的点

- `src/modules/content/components/content-appearance-fields.tsx`
  - `Tabs` 已补 `data-track="content-appearance-mode"`
- `src/modules/content/components/content-background-picker.tsx`
  - 背景色选择已补 `track()`
- `src/modules/content/components/content-icon-picker.tsx`
  - 图标选择已补 `track()`
- `src/modules/content/components/content-detail-window-page.tsx`
  - 详情窗口视图切换、历史版本切换已补业务日志
- `src/modules/content/hooks/use-content-download-actions.tsx`
  - 安装对话框显隐、安装目标加载、复制/下载流程已有业务日志
- `src/modules/prompts/components/prompt-create-dialog.tsx`
  - 分类选择器已补 `data-track="prompt-category-select"`
- `src/modules/rules/components/rule-create-dialog.tsx`
  - 分类选择器已补 `data-track="rule-category-select"`
- `src/modules/skills/components/skill-create-dialog.tsx`
  - 分类选择器已补 `data-track="skill-category-select"`
  - 附件选择、拖拽、清空、移除已有业务日志

### 验证

- 已执行：`pnpm typecheck`
- 结果：通过

### 补充

- `src/modules/skills/components/skill-create-dialog.tsx`
  - 已补 `mode` 透传到 `useContentIconImage()`，避免 Skill 图标图片日志缺少 create/edit 上下文
- 再次执行：`pnpm typecheck`
- 结果：通过

### UI Log Audit 追加记录

- 使用检查说明：`/Users/liyang/Documents/code/github/Synapse/.claude/skills/ui-log-audit/SKILL.md`
- 本轮结论：
  - 当前 diff 范围里，底层 `track()` 对按钮、对话框、Tabs、Select、基础 picker 交互已经基本覆盖
  - 业务层剩余的高价值缺口主要在共享创建/编辑表单和 icon 预览异步链路
  - `useContentCreateForm()` 里的日志文案原先偏向 create-only，我已改成同时适用于 create/edit，避免编辑场景日志语义失真
  - `useContentIconImage()` 原先只覆盖失败或本地更新/移除，本轮补齐了预览加载开始、加载成功、空结果和失败日志

### 本次已修改代码

- `src/modules/content/hooks/use-content-create-form.ts`
  - 将共享表单日志文案改为中性表述：`Content editor...` / `Content form...`
  - 保持对 dialog 显隐、放弃确认显隐、关键外观字段变化、校验失败、放弃编辑的日志覆盖
- `src/modules/content/hooks/use-content-icon-image.ts`
  - 新增 icon 预览读取开始日志
  - 新增 icon 预览读取成功日志
  - 新增 icon 预览空结果日志
  - 在已有更新/移除/失败日志上补充 `mode` 上下文
- `src/modules/prompts/components/prompt-create-dialog.tsx`
  - 透传 `mode` 给 `useContentIconImage()`
- `src/modules/rules/components/rule-create-dialog.tsx`
  - 透传 `mode` 给 `useContentIconImage()`
- `src/modules/skills/components/skill-create-dialog.tsx`
  - 确认 `mode` 已透传给 `useContentIconImage()`，与共享 hook 日志上下文保持一致

### 验证

- 已执行：`pnpm -s exec tsc --noEmit --pretty false`
- 结果：通过

## 2026-04-21 18:06:46 CST UI Log Audit

### 范围

- 按 `/Users/liyang/Documents/code/github/Synapse/.claude/skills/ui-log-audit/SKILL.md` 规则执行只读审计
- 依据当前 `git diff --name-only` 扫描 `src/app-shell/active-repository-switch.tsx`、`src/modules/content`、`src/modules/prompts`、`src/modules/rules`、`src/modules/settings`、`src/modules/skills`
- 额外补看共享交互组件 `src/components/image-crop-dialog.tsx`

### 结论

- `src/components/ui/` 交互底层组件里，已接入 `track()` 的是 25/27
- 本轮从交互事件角度确认的底层缺口是 `src/components/ui/carousel.tsx`、`src/components/ui/input-group.tsx`、`src/components/ui/sidebar.tsx`
- 业务层主流程里，大部分分类切换、排序切换、收藏、安装、切库、通知异步耗时已经有覆盖
- 还剩 8 处需要补日志或补日志语义的问题，优先处理 P0 和 P1

### P0

- `src/modules/content/hooks/use-content-detail-state.ts:89`
  问题：详情首次读取和历史版本读取只在失败时写 `logger.error(...)`，没有开始/成功/`elapsedMs`。打开详情弹窗、详情窗口、切换历史版本时缺少异步闭环日志。
  修改：在两段异步读取前补 started 日志，在成功分支补 success + `elapsedMs` + `contentId/contentType/historyDirname`。

- `src/modules/content/components/content-browser-page.tsx:860`
  问题：单条恢复、单条永久删除、批量恢复/删除都没走 `promise()`，也没有手动耗时日志；现在只有 initiated/fail 或 completed 统计，慢操作和卡顿无法定位。
  修改：为恢复/删除/批量动作补 `performance.now()` 耗时日志，或改成 `promise()` 包装，同时保留 `contentId` / `count` / `action`。

### P1

- `src/modules/content/components/content-browser-page.tsx:879`
  问题：单条永久删除只是 `setPurgeTarget(item)`，没有像批量操作那样记录“确认框打开”日志。底层 `AlertDialog` 只会留下通用标题 `永久删除`，缺少 `contentId`。
  修改：在设置 `purgeTarget` 前补 `logger.info("Content purge dialog opened.", { contentId, contentType })`，关闭时补 cancel/close。

- `src/modules/settings/components/project-list-editor.tsx:56`
  问题：新增项目失败没有 `logger.error`；删除项目在 `await onSave(...)` 前就写了 `Project removed.`，失败时会留下假阳性成功日志。
  修改：把新增/删除都改成 started / succeeded / failed 三段式；删除成功日志移到 `await onSave(...)` 之后，失败分支补 `projectId` 和错误详情。

- `src/modules/settings/components/repository-list-editor.tsx:369`
  问题：仓库初始化流程只有失败日志；读取初始化预览、打开危险确认框、真正开始初始化都没有带 `repositoryUuid` 的业务日志。
  修改：在 `checkInitializationPreview(...)` 开始/成功、`setInitializationTarget(...)` 前、`runInitialization(...)` 前后补日志，并记录 `elapsedMs`。

- `src/app-shell/active-repository-switch.tsx:146`
  问题：切库 onboarding 完成动作没有 submit / success / fail 日志，`updateRepoDisplayName(...)` 这一步在切库链路里完全不可见。
  修改：给 `completePendingSwitchOnboarding()` 补 `logger.info/error`，至少带上 `repositoryUuid`、`userId`、`elapsedMs`。

### P2

- `src/modules/content/components/content-action-split-button.tsx:99`
  问题：更多操作菜单的 `<DropdownMenu>` 没有 `data-track`，底层 open/close 只会上报成通用 `dropdown-menu`。
  修改：给菜单 root 补语义化 `data-track`，至少能区分内容操作菜单。

- `src/modules/content/create-content-module.tsx:61`
  问题：创建内容的 `promise()` loading 文案统一是 `正在保存...`，通知侧异步耗时日志无法区分 prompt / rule / skill。
  修改：改成内容类型明确的 loading label，例如 `正在保存提示词...`、`正在保存规则...`、`正在保存 Skill...`。

- `src/modules/content/components/content-detail-dialog.tsx:220`
  问题：详情页编辑保存同样使用统一 `正在保存...`，通知侧 `[async:ok]` / `[async:fail]` 日志语义不够。
  修改：改成带内容类型的 loading label，并尽量把 `contentId` 保留在业务日志里一起看。

- `src/components/ui/carousel.tsx:62`
  问题：carousel 有 slide 切换和前后翻页交互，但没有 `track()`。
  修改：给 select / prev / next 接入底层 `track()`。

- `src/components/ui/input-group.tsx:56`
  问题：`InputGroupAddon` 点击聚焦输入框没有 `track()`，辅助交互在日志里不可见。
  修改：如果保留该交互，给 addon click 补 track，或明确约定这类辅助聚焦不需要日志。

- `src/components/ui/sidebar.tsx:75`
  问题：sidebar 展开/收起、快捷键切换、rail/trigger 点击没有 `track()`。
  修改：在 `setOpen` / `toggleSidebar` / `SidebarTrigger` / `SidebarRail` 接入 track，至少记录 `open/close + source`。

## 2026-04-21 18:05:50 CST - UI Log Audit

Scope: 按 `ui-log-audit` skill 的默认范围检查当前 diff 涉及模块 `src/modules/content`、`src/modules/prompts`、`src/modules/rules`、`src/modules/settings`、`src/modules/skills`，并补查 `src/app-shell/`。

### 底层组件覆盖

- `src/components/ui/` 中已接入 `track()` 的组件约 `25/54`。
- 当前范围里直接受益的已接入组件包括 `Button`、`Dialog`、`AlertDialog`、`Tabs`、`Select`、`Checkbox`、`Switch`、`DropdownMenu`、`Menubar`、`Input`、`Textarea`。
- 当前 `ui/` 目录里仍未接入 `track()`、但具有交互潜力的通用组件包括 `calendar`、`carousel`、`hover-card`、`pagination`、`resizable`、`sidebar`、`tooltip`。
- `src/components/module-sidebar.tsx` 里的 `ModuleSidebarItem` 也是共享点击入口，但它本身没有底层埋点；当前两个使用点分别由 `settings` 和 `content browser` 的业务 logger 覆盖，后续复用时要注意。

### 需要补的日志

- `[P0]` `src/modules/content/components/content-detail-dialog.tsx:245` 和 `src/modules/content/components/content-detail-dialog.tsx:285`
  保存冲突、删除冲突都直接走 `promise(...).success` 分支里的 `setConflictState(...)` 打开冲突对话框，但没有任何 `logger` 记录“冲突已发生”。这条路径既不是 error，也不会留下成功日志，属于最关键的可观测性盲区。
  建议修改：在两个 `setConflictState(...)` 前分别补 `logger.warn/info("Content save conflict detected" / "Content delete conflict detected", {...})`，至少带上 `contentId`、`contentType`、`latestHistoryDirname`、`force`。

- `[P1]` `src/app-shell/components/repo-onboarding-dialog.tsx:49` 和 `src/app-shell/components/repo-onboarding-dialog.tsx:106`
  首次仓库身份补录弹窗由派生状态 `isOpen` 直接驱动显示，没有显式 `onOpenChange`，也没有业务层的 “dialog opened” 日志。因为它不是通过用户触发的 Radix `onOpenChange` 打开的，底层 `Dialog track()` 不会自动补到这一跳。
  建议修改：加一个基于 `isOpen` 的显隐 effect，记录 `Repo onboarding dialog opened/closed`，带上 `repositoryUuid`。

- `[P1]` `src/modules/settings/components/repository-list-editor.tsx:394` 和 `src/modules/settings/components/repository-list-editor.tsx:403`
  点击“初始化”后，如果目录非空，会先跑 `checkInitializationPreview()`，再用 `setInitializationTarget(...)` 打开二次确认弹窗；这里没有日志记录“用户已请求初始化”或“初始化确认弹窗已打开”。
  建议修改：在 `checkInitializationPreview()` 前后补日志，尤其在 `setInitializationTarget(...)` 前记录 `repositoryUuid`、`previewCount`。

- `[P1]` `src/modules/settings/components/repository-list-editor.tsx:424` 和 `src/modules/settings/components/repository-list-editor.tsx:632`
  删除仓库配置的确认弹窗通过 `onRemove={setPendingRemovalUuid}` 直接打开，没有业务日志记录是哪一个仓库进入了确认态。按钮自身只有通用 `Button track()`，不够还原目标仓库。
  建议修改：把 `setPendingRemovalUuid` 包一层 handler，在打开确认弹窗前记录 `Repository removal confirm opened` 和 `repositoryUuid`。

- `[P1]` `src/modules/settings/components/repository-list-editor.tsx:493` 和 `src/modules/settings/components/repository-list-editor.tsx:659`
  “新建本地仓库”按钮直接 `setIsCreateDialogOpen(true)`，绕过了已经写好打开日志的 `handleCreateDialogOpenChange(true)`，导致这个入口实际没有业务层打开日志。
  建议修改：把按钮改成调用 `handleCreateDialogOpenChange(true)`，不要直接 set state。

- `[P1]` `src/modules/content/components/content-browser-page.tsx:879` 和 `src/modules/content/components/content-browser-page.tsx:918`
  已删除内容列表里的单项“永久删除”先 `setPurgeTarget(item)` 打开确认弹窗，但没有像批量删除那样记录 “dialog opened” 日志。后续只有真正确认删除时才会出现 `Content purge initiated.`。
  建议修改：在 `onPurge` 里先记一条 `Content purge dialog opened`，至少带上 `contentId`、`contentType`、`title`。

- `[P2]` `src/modules/settings/components/log-export-panel.tsx:144`、`src/modules/settings/components/log-export-panel.tsx:250` 和 `src/modules/settings/components/log-export-panel.tsx:307`
  多文件复制对话框通过 `setLogFilePickerState(...)` 打开、清空日志确认框通过 `setIsClearDialogOpen(true)` 打开，两个打开动作都没有业务日志；同时多文件选择列表里的 `Checkbox` 没有 `data-track` / `aria-label`，底层埋点会退回成统一的 `"checkbox"`，无法区分具体文件。
  建议修改：为两个弹窗补 `dialog opened` 日志，并给每个日志文件 checkbox 加语义化 `data-track`，例如 `log-file:<file.name>`。

### 当前覆盖较好的区域

- `src/App.tsx` 已覆盖顶层 tab 切换、待同步弹窗显隐、手动同步仓库。
- `src/modules/content/components/content-browser-page.tsx` 已覆盖分类切换、删除视图筛选、搜索词、防抖搜索、排序切换、批量恢复/删除、详情打开。
- `src/modules/content/components/content-install-dialog.tsx` 已覆盖安装范围切换、项目选择、目录浏览、覆盖确认、Skill 冲突确认、Cursor frontmatter 弹窗、安装耗时。
- `src/modules/skills/components/skill-create-dialog.tsx` 已覆盖附件拖拽、文件/文件夹选择、清空、移除、无效附件和收集失败。
- `src/modules/settings/index.tsx`、`src/modules/settings/components/repository-list-item.tsx`、`src/modules/settings/components/project-list-editor.tsx`、`src/modules/settings/components/repository-display-name-field.tsx`、`src/modules/settings/components/config-backup-panel.tsx`、`src/modules/settings/components/identity-panel.tsx`、`src/modules/settings/components/about-panel.tsx` 的主流程日志都比较完整。

### 异步操作检查

- 当前范围内走 `promise()` 的异步操作，`loading` 文案整体是具体可读的，没有看到泛化成 “加载中...” 的情况。
- 绝大多数关键异步操作要么走了 `promise()`，要么有手动 `performance.now()` 日志。
- 最明显的异步盲区仍然是 `src/modules/content/components/content-detail-dialog.tsx` 的冲突分支：它不是失败，也不是成功提示，所以必须单独补业务日志。

## UI Log Audit 2026-04-21 18:06:05 CST

### 范围

- 按 `ui-log-audit` skill 扫描了当前 `git diff --name-only` 涉及模块：`src/modules/content`、`src/modules/prompts`、`src/modules/rules`、`src/modules/settings`、`src/modules/skills`
- 同时覆盖了 `src/app-shell/`
- 已先读取日志基础设施：`src/lib/ui-tracking.ts`、`src/app-shell/logging.ts`、`src/app-shell/notifications.tsx`

### 底层覆盖

- `src/components/ui/` 当前有 `25/54` 个 primitive 已接入 `track()`
- 已覆盖的高频交互 primitive 包括：`Button`、`Dialog`、`AlertDialog`、`Tabs`、`Select`、`Input`、`Textarea`、`Checkbox`、`Switch`、`DropdownMenu`、`Menubar`
- 这轮审计里最需要注意的未覆盖 primitive 是 `CommandInput`，它会直接影响命令面板/快速切换类搜索入口

### 需要修改

#### P0

- `src/modules/content/components/content-browser-page.tsx:860-874`
  - 单条 `restoreContent()` 只有“开始”和“失败”日志，没有“成功”或耗时日志，而且没有走 `promise()` 包装
  - 建议：改成 `promise()` 包装，或者在成功分支补 `logger.info("Content restored.", { contentId, contentType, elapsedMs })`

- `src/modules/content/components/content-browser-page.tsx:930-943`
  - 单条 `purgeContent()` 也是同样问题，成功后只弹 toast，没有业务日志记录“哪条内容被永久删除成功”
  - 建议：补成功日志和耗时，或统一走 `promise()`

- `src/modules/content/components/content-browser-page.tsx:974-991`
  - 批量恢复/批量永久删除在循环里用了裸 `catch {}`，失败项会被静默吞掉，只剩最终成功数
  - 建议：在 `catch` 里补 `logger.error("Batch content action failed.", { action, contentId: item.id, contentType, error })`

#### P1

- `src/modules/settings/components/log-export-panel.tsx:144-147`
  - 多文件复制路径在打开“选择要复制的日志文件”对话框时没有业务日志，当前只有前置的 `Log copy to clipboard initiated.`
  - 建议：补 `logger.info("Log file picker opened.", { fileCount, defaultSelected })`

- `src/modules/settings/components/log-export-panel.tsx:178-205`
  - 确认复制已选日志文件时，没有记录选中了哪些文件/多少文件，也没有单独的成功日志
  - 建议：在进入 `promise()` 前后补 `logger.info`，至少记录 `selectedNames` 或 `selectedCount`

- `src/modules/settings/components/log-export-panel.tsx:307-320`
  - 多文件复制对话框里勾选变化只有 `Checkbox` 底层埋点，没有业务层“当前选中了哪些日志文件”的语义日志
  - 建议：在 `setLogFilePickerState` 更新选择集时补一条节流后的 `logger.info("Log file picker selection changed.", { selectedCount, selectedNames })`

- `src/app-shell/components/quick-repository-switch-dialog.tsx:81`
  - 仓库快速切换的搜索框使用的是 `CommandInput`，这个 primitive 本身不发 `track()`，组件里也没有补 `logger.info`
  - 建议：在该组件内补 `searchQuery` + `useDeferredValue/useEffect`，记录搜索词变化

#### P2

- `src/modules/content/hooks/use-content-recently-viewed.ts:24-37`
  - 打开内容详情后会异步写入 recently viewed，但这里完全没有业务日志；如果配置写入失败，当前审计链路里看不到
  - 建议：在 hook 内补 `logger.info/error`，或者让调用方 `await` 后记录成功/失败

### data-track 语义缺失

- `src/modules/content/components/content-detail-dialog.tsx:411-415`
  - 详情弹窗没有显式 `data-track`
- `src/components/ui/dialog.tsx:11-25`
  - `Dialog` 会回退到 `DialogTitle` 作为日志名；这里的标题是内容标题，属于高基数值，不利于聚合分析
  - 建议：给详情弹窗补稳定名称，例如 `data-track="content-detail-dialog"`，具体内容信息继续走已有 `logger.info`

## UI Log Audit 2026-04-21 18:07:26 CST

- 范围：按 `.claude/skills/ui-log-audit/SKILL.md` 静态审计 `src/app-shell/` 与当前 diff 涉及模块 `content / prompts / rules / settings / skills`，补看 `src/components/image-crop-dialog.tsx`
- 结论：
  - P0 暂未发现明显遗漏；顶层 Tab、Settings 分类、内容分类/搜索/排序、仓库切换、主要 create/save/delete/install 异步流都有业务日志
  - 审计范围内共检查到 `promise()` 异步提示 20 处，loading 文案都比较具体，没有看到 `"加载中..."` 这类泛化占位
  - `src/components/ui/` 的 interactive primitive 覆盖率约为 `25 / 28`；未接入 `track()` 的交互型底层组件是 `src/components/ui/carousel.tsx`、`src/components/ui/input-group.tsx`、`src/components/ui/sidebar.tsx`

### P1

- `src/modules/settings/components/log-export-panel.tsx:144`
  - 多文件复制路径直接 `setLogFilePickerState(...)` 打开选择对话框，业务日志没有记录对话框 open/close；当前只能看到后续复制动作，看不到“用户进入过多文件选择”
  - 修改建议：封装 `setLogFilePickerState` / `closeLogFilePicker`，补 `logger.info("Log file picker dialog visibility changed.", { open, fileCount, selectedCount })`

- `src/modules/settings/components/log-export-panel.tsx:250`
  - 删除全部日志确认框通过 `setIsClearDialogOpen(true)` 打开，没有业务层可读日志；如果用户打开后取消，日志里没有痕迹
  - 修改建议：封装 `setIsClearDialogOpen`，记录 `logger.info("Log clear dialog visibility changed.", { open })`

- `src/modules/settings/components/repository-list-editor.tsx:403`
  - 初始化预览 / 危险确认框只做 `setInitializationTarget(...)`，没有记录确认框出现 / 关闭；目录初始化是高风险操作，缺口比较明显
  - 修改建议：封装 `setInitializationTarget`，记录 `logger.info("Repository initialization confirm visibility changed.", { open, repositoryUuid, previewCount })`

- `src/modules/settings/components/repository-list-editor.tsx:424`
  - 删除仓库确认框只在真正删除时记日志，打开 / 取消完全无业务日志
  - 修改建议：封装 `setPendingRemovalUuid`，记录 `logger.info("Repository removal confirm visibility changed.", { open, repositoryUuid })`

- `src/modules/settings/components/repository-list-editor.tsx:660`
  - “新建本地仓库”按钮直接 `setIsCreateDialogOpen(true)`，绕过了已经带日志的 `handleCreateDialogOpenChange()`，所以这个入口的 dialog open 不会进业务日志
  - 修改建议：这里改为调用 `handleCreateDialogOpenChange(true)`，或抽统一 setter

- `src/modules/content/components/content-browser-page.tsx:879`
  - 单条内容“永久删除”确认框通过 `setPurgeTarget(item)` 打开，没有记录用户针对哪个内容打开了确认框；只有确认后才有 `Content purge initiated`
  - 修改建议：封装 `setPurgeTarget`，记录 `logger.info("Content purge dialog visibility changed.", { open, contentId, contentType })`

- `src/modules/content/components/content-detail-dialog.tsx:246`
  - 保存 / 删除冲突只设置 `conflictState` 打开冲突对话框，没有记录冲突弹窗 surfaced / close / continue；并发覆盖问题本来就是最依赖日志排查的场景
  - 修改建议：在设置 / 清空 `conflictState` 和 `handleConflictContinue()` 时补 `logger.warn/info(...)`，带上 `mode`、`contentId`、`latestHistoryDirname`

### P2

- `src/components/image-crop-dialog.tsx:38`
  - 裁剪弹窗通过文件选择后 `setOpen(true)` 打开，这个 open 不会经过 `Dialog` 的 `onOpenChange` 埋点；现在只能看到按钮点击 / 滑块变化，看不到“裁剪器真的打开了”
  - 修改建议：给 `open` 增加业务层 visibility log，或在 `handleFileChange` / `handleCancel` / `handleConfirm` 里显式记日志

- `src/components/ui/carousel.tsx:62`
  - `Carousel` 没有接 `track()`；键盘左右切换、Embla `select` 切换、上一张 / 下一张都没有统一日志
  - 修改建议：在 `onSelect`、`scrollPrev`、`scrollNext` 里补 `track({ component: "carousel", ... })`

- `src/components/ui/sidebar.tsx:75`
  - `Sidebar` 没有接 `track()`；快捷键 `Cmd/Ctrl+B`、rail 点击、`SidebarTrigger` 切换都不会留下统一日志
  - 修改建议：在 `toggleSidebar` / `setOpen` / `setOpenMobile` 周围补 `track()`，并带上 `source: trigger | rail | shortcut | mobile`

- `src/components/ui/input-group.tsx:45`
  - `InputGroupAddon` 点击后会主动 focus 到输入框，但这里没有任何埋点；价值较低，但目前确实是交互盲区
  - 修改建议：如果这个行为对分析有价值，在 `onClick` 里补一个 `track({ component: "input-group-addon", action: "focus" })`

### data-track 语义

- `src/modules/content/components/content-detail-dialog.tsx:411`
  - 详情弹窗没有显式 `data-track`，`Dialog` 会退回到内容标题；标题是高基数字段，不利于聚合
  - 修改建议：补稳定值，例如 `data-track="content-detail-dialog"`

- `src/app-shell/components/repo-onboarding-dialog.tsx:106`
  - onboarding 弹窗标题包含仓库名，若后续补 visibility log，仍建议同时补稳定 `data-track`
  - 修改建议：补 `data-track="repo-onboarding-dialog"`

- `src/app-shell/components/switch-repository-onboarding-dialog.tsx:83`
  - 切换仓库 onboarding 同样依赖动态仓库名作为 fallback
  - 修改建议：补 `data-track="switch-repository-onboarding-dialog"`

## 2026-04-21 18:06:46 CST UI Log Audit

### 范围

- 按 `/Users/liyang/Documents/code/github/Synapse/.claude/skills/ui-log-audit/SKILL.md` 规则执行只读审计
- 依据当前 `git diff --name-only` 扫描 `src/app-shell/active-repository-switch.tsx`、`src/modules/content`、`src/modules/prompts`、`src/modules/rules`、`src/modules/settings`、`src/modules/skills`
- 额外补看共享交互组件 `src/components/image-crop-dialog.tsx`

### 结论

- `src/components/ui/` 交互底层组件里，已接入 `track()` 的是 25/27
- 本轮从交互事件角度确认的底层缺口是 `src/components/ui/carousel.tsx`、`src/components/ui/input-group.tsx`、`src/components/ui/sidebar.tsx`
- 业务层主流程里，大部分分类切换、排序切换、收藏、安装、切库、通知异步耗时已经有覆盖
- 还剩 8 处需要补日志或补日志语义的问题，优先处理 P0 和 P1

### P0

- `src/modules/content/hooks/use-content-detail-state.ts:89`
  问题：详情首次读取和历史版本读取只在失败时写 `logger.error(...)`，没有开始/成功/`elapsedMs`。打开详情弹窗、详情窗口、切换历史版本时缺少异步闭环日志。
  修改：在两段异步读取前补 started 日志，在成功分支补 success + `elapsedMs` + `contentId/contentType/historyDirname`。

- `src/modules/content/components/content-browser-page.tsx:860`
  问题：单条恢复、单条永久删除、批量恢复/删除都没走 `promise()`，也没有手动耗时日志；现在只有 initiated/fail 或 completed 统计，慢操作和卡顿无法定位。
  修改：为恢复/删除/批量动作补 `performance.now()` 耗时日志，或改成 `promise()` 包装，同时保留 `contentId` / `count` / `action`。

### P1

- `src/modules/content/components/content-browser-page.tsx:879`
  问题：单条永久删除只是 `setPurgeTarget(item)`，没有像批量操作那样记录“确认框打开”日志。底层 `AlertDialog` 只会留下通用标题 `永久删除`，缺少 `contentId`。
  修改：在设置 `purgeTarget` 前补 `logger.info("Content purge dialog opened.", { contentId, contentType })`，关闭时补 cancel/close。

- `src/modules/settings/components/project-list-editor.tsx:56`
  问题：新增项目失败没有 `logger.error`；删除项目在 `await onSave(...)` 前就写了 `Project removed.`，失败时会留下假阳性成功日志。
  修改：把新增/删除都改成 started / succeeded / failed 三段式；删除成功日志移到 `await onSave(...)` 之后，失败分支补 `projectId` 和错误详情。

- `src/modules/settings/components/repository-list-editor.tsx:369`
  问题：仓库初始化流程只有失败日志；读取初始化预览、打开危险确认框、真正开始初始化都没有带 `repositoryUuid` 的业务日志。
  修改：在 `checkInitializationPreview(...)` 开始/成功、`setInitializationTarget(...)` 前、`runInitialization(...)` 前后补日志，并记录 `elapsedMs`。

- `src/app-shell/active-repository-switch.tsx:146`
  问题：切库 onboarding 完成动作没有 submit / success / fail 日志，`updateRepoDisplayName(...)` 这一步在切库链路里完全不可见。
  修改：给 `completePendingSwitchOnboarding()` 补 `logger.info/error`，至少带上 `repositoryUuid`、`userId`、`elapsedMs`。

### P2

- `src/modules/content/components/content-action-split-button.tsx:99`
  问题：更多操作菜单的 `<DropdownMenu>` 没有 `data-track`，底层 open/close 只会上报成通用 `dropdown-menu`。
  修改：给菜单 root 补语义化 `data-track`，至少能区分内容操作菜单。

- `src/modules/content/create-content-module.tsx:61`
  问题：创建内容的 `promise()` loading 文案统一是 `正在保存...`，通知侧异步耗时日志无法区分 prompt / rule / skill。
  修改：改成内容类型明确的 loading label，例如 `正在保存提示词...`、`正在保存规则...`、`正在保存 Skill...`。

- `src/modules/content/components/content-detail-dialog.tsx:220`
  问题：详情页编辑保存同样使用统一 `正在保存...`，通知侧 `[async:ok]` / `[async:fail]` 日志语义不够。
  修改：改成带内容类型的 loading label，并尽量把 `contentId` 保留在业务日志里一起看。

- `src/components/ui/carousel.tsx:62`
  问题：carousel 有 slide 切换和前后翻页交互，但没有 `track()`。
  修改：给 select / prev / next 接入底层 `track()`。

- `src/components/ui/input-group.tsx:56`
  问题：`InputGroupAddon` 点击聚焦输入框没有 `track()`，辅助交互在日志里不可见。
  修改：如果保留该交互，给 addon click 补 track，或明确约定这类辅助聚焦不需要日志。

- `src/components/ui/sidebar.tsx:75`
  问题：sidebar 展开/收起、快捷键切换、rail/trigger 点击没有 `track()`。
  修改：在 `setOpen` / `toggleSidebar` / `SidebarTrigger` / `SidebarRail` 接入 track，至少记录 `open/close + source`。

## UI Log Audit - 2026-04-21 18:08:11 CST

- 审计方式：按 `/Users/liyang/Documents/code/github/Synapse/.claude/skills/ui-log-audit/SKILL.md` 做静态检查，不启动应用。
- 审计范围：`src/app-shell/`，以及当前 diff 涉及的 `src/modules/content/`、`src/modules/prompts/`、`src/modules/rules/`、`src/modules/settings/`、`src/modules/skills/`。
- 底层覆盖概览：粗扫 `src/components/ui/` 有 25/54 个文件包含 `track()` 相关逻辑；和本次范围直接相关的 `Button`、`Dialog`、`AlertDialog`、`Select`、`Tabs`、`Input`、`Textarea`、`Switch`、`DropdownMenu`、`Menubar`、`CommandItem`、`Slider` 已接入。关键底层缺口是 `src/components/ui/command.tsx` 里的 `CommandInput` 还没有埋点。
- 结论：`content/prompts/rules/skills` 主流程大多已有 `logger.*()` 或底层 `track()` 覆盖；当前明显缺口主要集中在 `settings` 的仓库管理异步入口，以及 `app-shell` 的快速切仓搜索输入。

### P1 必补

- `src/modules/settings/components/repository-list-editor.tsx:369`
  - 仓库初始化链路只有 `promise()` 通知和失败日志，没有“开始初始化 / 打开初始化预览确认 / 初始化成功”的业务语义日志。出问题时只能看到失败，看不到用户是否点过初始化、初始化的是哪个仓库、是否先弹过确认。
  - 建议修改：在 `handleInitializeRepository()` / `runInitialization()` 补 `logger.info()`，至少记录 `repositoryUuid`、`localPath`、`previewEntryCount`、`fromPreviewConfirm`、`elapsedMs`。

- `src/modules/settings/components/repository-list-editor.tsx:191`
  - “新建本地仓库 -> 选择保存位置” 的原生目录选择器没有任何日志；打开、取消、选中、失败都不会留下记录。
  - 建议修改：参照 `src/app-shell/components/empty-repository-state.tsx` 的目录选择器写法，补 `startedAt + logger.info/warn/error`。

- `src/modules/settings/components/repository-list-editor.tsx:270`
  - “修改仓库 -> 选择文件夹” 同样没有打开 / 取消 / 选中 / 失败日志。
  - 建议修改：同上补齐目录选择器链路日志，并带上 `repositoryUuid`。

- `src/modules/settings/components/repository-list-editor.tsx:162`
  - 从设置页添加已有仓库时，目录校验失败只显示 `formError`，没有 `warn/error` 记录校验失败原因和 `missingDirectories`；同类失败在 `src/app-shell/components/empty-repository-state.tsx` 已有日志，这条链路现在不一致。
  - 建议修改：校验失败时补 `logger.warn("Chosen repository directory failed validation.", { repositoryUuid/localPath/message/missingDirectories })`。

### P2 建议补

- `src/app-shell/components/quick-repository-switch-dialog.tsx:81`
  - 快速切仓的搜索输入没有任何业务日志；这里只有条目选中日志，用户输入了什么关键字完全不可见。
  - 根因位置：`src/components/ui/command.tsx:67` 的 `CommandInput` 没有 `track()`，当前也没有像 `src/modules/content/components/content-browser-page.tsx` 那样用 `useDeferredValue + logger.info()` 记录最终搜索词。
  - 建议修改：优先在 `quick-repository-switch-dialog` 增加防抖 / deferred 搜索日志；如果后续会复用命令面板搜索，再考虑给 `CommandInput` 做统一埋点。

- `src/modules/settings/components/project-list-editor.tsx:130`
  - 修改项目时的目录选择器只记录了 “opened”，没有记录取消、选中结果或失败；同文件新增项目目录选择器已经有 open/dismiss 日志，编辑路径链路不对称。
  - 建议修改：补齐 dismiss / selected / error 日志，保持与 `handleChooseProjectPath()` 一致。

## UI Log Audit 2026-04-21 18:07:51 CST

### 范围

- 按 `ui-log-audit` skill 扫描当前 `git diff` 命中的模块：`src/modules/content`、`src/modules/prompts`、`src/modules/rules`、`src/modules/settings`、`src/modules/skills`
- 同时补扫了 `src/app-shell/`
- 这次没有把 `src/components/image-crop-dialog.tsx` 纳入主结论，因为它不在这个 skill 的默认业务扫描范围

### 结论

- 当前 UI 日志主干覆盖已经比较完整：`Button`、`Dialog`、`AlertDialog`、`Tabs`、`Select`、`Checkbox`、`Switch`、`Input`、`Textarea`、`DropdownMenu`、`Menubar` 这些高频交互 primitive 都已经接入 `track()`
- 真正需要补的缺口集中在三类：`CommandInput` 搜索词没有任何日志、多文件日志复制流程缺少文件级语义、以及若干 tracked primitive 的使用点没有补 `data-track` 导致日志名退回成泛化值或高基数值

### 需要修改

- `[P1]` `src/modules/settings/components/log-export-panel.tsx:178`
  - 多文件复制确认动作直接进入 `promise()`，但没有业务层 `logger.info` 记录 `selectedCount` / `selectedNames`；当前日志里只有通知系统的通用 `"正在复制日志..."`，排查时看不出到底复制了哪些文件。
  - 建议修改：在进入 `promise()` 前补 `logger.info("Selected log copy initiated.", { selectedCount, selectedNames })`，必要时在成功后补 `logger.info("Selected log copy completed.", { selectedCount })`。

- `[P2]` `src/modules/settings/components/log-export-panel.tsx:307`
  - 日志文件勾选项没有 `data-track` 或 `aria-label`，`Checkbox` 会统一退回成 `"checkbox"`，多文件选择过程基本不可审计。
  - 建议修改：给每个 `Checkbox` 增加稳定语义名，例如 `data-track="log-file-picker-checkbox"`；具体文件名和选中数量放进业务 logger 的 details，不要直接塞进 track 名。

- `[P2]` `src/modules/content/components/content-action-split-button.tsx:99`
  - 下载/安装更多操作菜单没有 `data-track`，底层 open/close 只能落成泛化的 `"dropdown-menu"`，后续和仓库里其他下拉菜单混在一起。
  - 建议修改：给 `DropdownMenu` 补稳定名称，例如 `data-track={\`content-${item.type}-actions-menu\`}`。

- `[P2]` `src/app-shell/components/quick-repository-switch-dialog.tsx:93`、`src/components/ui/command.tsx:148`
  - 当前 `CommandItem` 的 fallback 会把 `${repository.name} ${repository.localPath}` 直接写进 `track()`；虽然业务 logger 已经记录了 `repositoryUuid/repositoryName`，但底层 UI tracking 仍然会产生高基数、带本地路径的 name/value。
  - 建议修改：给仓库条目补稳定 `data-track`；如果还想保留 cmdk 的搜索 `value`，最好让 `CommandItem` 额外支持独立的 `trackName` / `trackValue`，避免把 `localPath` 直接打进 UI tracking。

### 底层覆盖补记

- `src/components/ui/command.tsx` 当前只覆盖了 `CommandItem` 选择，没有覆盖 `CommandInput` 本身；这也正好解释了 quick switch 搜索为什么会成为日志盲区。
- `src/components/ui/tooltip.tsx`、`src/components/ui/hover-card.tsx`、`src/components/ui/calendar.tsx`、`src/components/ui/carousel.tsx`、`src/components/ui/pagination.tsx`、`src/components/ui/sidebar.tsx` 这些仍然没有 `track()`；如果后续页面更依赖这些 primitive，需要再单独评估是否补底层埋点。

## [2026-04-21 18:10:10 CST] UI Log Audit（按 git diff 涉及模块 + `src/app-shell/`）

### 结论

- 这轮范围内，主链路日志基础已经比较完整：`src/App.tsx` 的顶层 tab 切换、`src/modules/content/components/content-browser-page.tsx` 的搜索/分类/排序/详情打开、`src/modules/content/components/content-detail-dialog.tsx` 的 view mode/history/save/delete、`src/app-shell/active-repository-switch.tsx` 的仓库切换、`src/modules/settings/index.tsx` 的设置分类切换，基本都有业务层 logger。
- 底层 `src/components/ui/` 粗扫结果：按事件 props 粗看共有 26 个明显交互型 ui 文件，23 个已经接入 `track()`；文件级明确缺口是 `src/components/ui/carousel.tsx`、`src/components/ui/sidebar.tsx`。另外 `src/components/ui/menubar.tsx` 虽然 item/radio/checkbox 已接埋点，但 `MenubarTrigger` 的打开动作仍然没有记录。

### 需要修改的代码

- `[P0]` `src/modules/content/components/content-browser-page.tsx:860-1000`
  - 最近删除页的“恢复”“永久删除”“全部恢复/全部删除”三条异步链路没有走 `promise()`，也没有手动 `elapsedMs`。现在单个 restore/purge 只有 initiated/fail，没有 success；batch 只有 initiated/completed，没有耗时和失败摘要。
  - 建议修改：统一改成 `promise()`，或者至少补 `startedAt = performance.now()`，在 success/fail logger 里带 `elapsedMs`、`contentId`、`action`、`successCount`、`total`。

- `[P1]` `src/modules/content/hooks/use-content-download-actions.tsx:97-132`
  - `loadInstallTargets()` 是真实 IO，但当前只记了 “Loading install targets.” / “Install targets loaded.” / fail，没有耗时；而这段又是由菜单 hover/focus 触发，排查“下载菜单第一次打开很慢”时信息不够。
  - 建议修改：给这段预取补 `elapsedMs`，或者统一走一个异步包装；成功日志继续保留 `supportedCount`。

- `[P1]` `src/App.tsx:275-298`
  - “同步变更”弹窗里的“立即同步”直接进入 `promise()`，只有失败 logger，没有业务层 initiated 日志；日志里看不出这次 push 是从 pending-push dialog 触发的。
  - 建议修改：在 `promise()` 前补 `logger.info("Pending push flush initiated from app shell.", { source: "dialog", repositoryUuid, pendingCount })`，必要时在成功后补 source 维度的 completed 日志。

- `[P1]` `src/modules/settings/components/log-export-panel.tsx:178-205`
  - 多文件复制动作没有业务 logger，通知系统只会留下通用的 “正在复制日志...”，无法区分单文件复制和多文件复制，也看不到 `selectedCount` / `selectedNames`。
  - 建议修改：进入 `promise()` 前补 `logger.info("Selected log copy initiated.", { selectedCount, selectedNames })`；成功后补 `completed`，失败时补 `logger.error`。

- `[P2]` `src/app-shell/components/quick-repository-switch-dialog.tsx:81`
  - 仓库 quick switch 的搜索输入没有业务层搜索日志；`CommandInput` 目前只靠基础 input 行为，最终搜索词不会进 logger。
  - 建议修改：把 `CommandInput` 改成受控值，配合 `useDeferredValue + useEffect` 记录最终查询词的 `from -> to`。

- `[P2]` `src/modules/settings/components/log-export-panel.tsx:307-321`
  - 文件勾选 `Checkbox` 没有 `data-track` / `aria-label` / `id`。按 `src/components/ui/checkbox.tsx` 当前实现，这些点击会统一落成 `"checkbox"`，多文件选择过程几乎不可读。
  - 建议修改：给每个勾选框补稳定语义名，例如 `data-track="log-file-picker-checkbox"`，并把 `file.name` / `checked` 放进业务 logger details。

- `[P2]` `src/app-shell/components/sync-status-chip.tsx:43-50`
  - 待同步 chip 依赖按钮文字 fallback；当前 track name 会随数量变化成 `"1 条待同步"` / `"9+ 条待同步"`，日志基数不稳定。
  - 建议修改：给按钮补稳定 `data-track`，例如 `data-track="pending-push-chip"`，数量继续放在业务 logger details。

- `[P2]` `src/components/ui/menubar.tsx:50-63`、`src/modules/content/components/content-detail-menubar.tsx:103-109`
  - `Menubar` 目前只跟踪 item/radio/checkbox，菜单 trigger 的打开动作没被记录；内容详情里的“下载”菜单因此只有后续 item select，没有 menu open。
  - 建议修改：在 `MenubarTrigger` 增加 open/select track，并在业务侧传稳定 `data-track`，例如 `content-detail-download-menu`。

### 底层覆盖补记

- `src/components/ui/carousel.tsx:62-103` 还没有记录键盘左右切换或 slide change。
- `src/components/ui/sidebar.tsx:75-109` 还没有记录 open/close/toggle/shortcut。
- `src/components/ui/input-group.tsx` 也被事件扫描命中，但它的 `onClick` 主要是辅助 focus，不建议当成这轮日志遗漏优先处理。

## UI Log Audit 2026-04-21 18:09:51 CST

### 范围

- 按 `/Users/liyang/Documents/code/github/Synapse/.claude/skills/ui-log-audit/SKILL.md` 扫描
- 覆盖 `src/app-shell/`
- 按当前 `git diff` 涉及模块补扫 `src/modules/content`、`src/modules/prompts`、`src/modules/rules`、`src/modules/settings`、`src/modules/skills`

### 结论

- 底层 `track()` 已接入 `src/components/ui/` 的 25/54 个文件，主干覆盖已经够用：`button`、`dialog`、`alert-dialog`、`tabs`、`select`、`checkbox`、`switch`、`input`、`textarea`、`dropdown-menu`、`menubar`、`command-item` 等高频交互都在
- 这轮没有看到 `P0`
- 主要缺口集中在“受控弹窗/确认框通过外部 `setState(true)` 打开”的链路。当前 `Dialog` / `AlertDialog` 的底层 `track()` 只覆盖 Radix 触发的 `onOpenChange`，不覆盖外部程序化 open，所以如果业务层不补 `logger.info(...)`，日志里就只剩一个按钮点击，看不到“哪个弹窗真的被打开了”
- 交互型 primitive 里还没接入 `track()` 的主要有：`calendar`、`carousel`、`hover-card`、`pagination`、`resizable`、`sidebar`、`tooltip`。本轮没在高优先级业务链路里形成 blocker，但后续如果这些 primitive 承担关键交互，仍然要补底层埋点

### 需要修改

- `[P1]` `src/modules/settings/components/repository-list-editor.tsx:660`
  - “新建本地仓库”按钮直接 `setIsCreateDialogOpen(true)`，绕过了同文件 `handleCreateDialogOpenChange()` 里的 `logger.info("Create repository dialog opened.")`。这个入口下，对话框打开本身没有任何业务日志。
  - 建议修改：把这里改成走 `handleCreateDialogOpenChange(true)`，或者在设置状态前补一条同语义的 `logger.info(...)`。

- `[P1]` `src/modules/settings/components/repository-list-item.tsx:209`
  - “删除”按钮只把 `repositoryUuid` 交给 `onRemove(...)`，随后 `src/modules/settings/components/repository-list-editor.tsx:424` 的确认框通过 `pendingRemovalUuid` 受控打开，但没有记录“删除确认框已打开”。
  - 建议修改：在设置 `pendingRemovalUuid` 前补 `logger.info("Repository remove confirm dialog opened.", { repositoryUuid })`。

- `[P1]` `src/modules/settings/components/repository-list-item.tsx:190`
  - “初始化”按钮触发 `onInitialize(repository)` 后，`src/modules/settings/components/repository-list-editor.tsx:394` 会在预览非空时直接 `setInitializationTarget(...)` 打开风险确认框，但当前只有预览读取失败日志，没有“初始化确认框已打开”的成功路径日志。
  - 建议修改：在 `preview.isEmpty === false` 分支里补 `logger.info("Repository initialization warning dialog opened.", { repositoryUuid, previewCount })`。

- `[P1]` `src/modules/settings/components/log-export-panel.tsx:144`
  - 多文件日志复制场景会直接 `setLogFilePickerState(...)` 打开“选择要复制的日志文件”对话框，但没有任何业务日志记录 `fileCount`、默认选中了谁。
  - 建议修改：在设置 `logFilePickerState` 前补 `logger.info("Log file picker opened.", { fileCount, defaultSelected })`。

- `[P1]` `src/modules/settings/components/log-export-panel.tsx:250`
  - “删除全部日志”按钮直接 `setIsClearDialogOpen(true)`，删除确认框的打开没有业务层日志。
  - 建议修改：在打开前补 `logger.info("Log clear confirm dialog opened.")`。

- `[P1]` `src/modules/content/components/content-browser-page.tsx:879`
  - 最近删除列表里的“永久删除”先 `setPurgeTarget(item)` 打开确认框，真正的删除动作有 `logger.info("Content purge initiated.")`，但用户先进入确认框这一步没有日志。
  - 建议修改：在 `setPurgeTarget(item)` 前补 `logger.info("Content purge confirm dialog opened.", { contentId: item.id, contentType })`。

- `[P1]` `src/modules/content/components/content-detail-dialog.tsx:246`
  - 保存发生冲突时直接 `setConflictState(...)` 打开冲突确认框，但没有记录“保存冲突确认框已打开”。
  - 建议修改：在 `result.status === "conflict"` 分支里补 `logger.info("Content conflict dialog opened.", { mode: "save", contentId: detail.id, contentType, latestHistoryDirname: result.latestHistoryDirname ?? null })`。

- `[P1]` `src/modules/content/components/content-detail-dialog.tsx:285`
  - 删除发生冲突时同样直接 `setConflictState(...)` 打开冲突确认框，缺少“删除冲突确认框已打开”的日志。
  - 建议修改：在对应冲突分支补 `logger.info("Content conflict dialog opened.", { mode: "delete", contentId: deleteTarget.id, contentType, latestHistoryDirname: result.latestHistoryDirname ?? null })`。

- `[P2]` `src/modules/settings/components/log-export-panel.tsx:307`
  - 多文件复制对话框里的 `Checkbox` 没有 `data-track` 或 `aria-label`，底层 `Checkbox` 只能把事件统一记成 `"checkbox"`，无法从 UI tracking 看出是哪个文件被勾选/取消。
  - 建议修改：给每个 `Checkbox` 补稳定语义名，例如 `data-track="log-file-picker-checkbox"` 或 `aria-label={file.name}`；具体文件名建议放进业务 `logger.details`，不要直接塞进 track name。

## UI Log Audit 2026-04-21 18:09:30 CST

### 范围

- 按 `ui-log-audit` skill 扫描当前 `git diff` 命中的模块：`src/modules/content`、`src/modules/prompts`、`src/modules/rules`、`src/modules/settings`、`src/modules/skills`
- 同时补扫了 `src/app-shell/`
- 额外核对了 `src/components/ui/` 的底层 `track()` 覆盖边界

### 结论

- 这轮主链路里，顶部 Tab 切换、内容详情打开、创建/编辑弹窗、下载/复制/安装主流程的日志已经比较完整
- 真正需要补的缺口主要集中在三类：已删除内容的异步操作结果日志、批量操作里的吞错、以及少数使用点/底层 primitive 的语义化埋点不足

### 底层覆盖

- 按“交互型 ui primitive 是否直接接入 `track()`”统计，这轮扫到的是 `24/27`
- 缺失：`src/components/ui/sidebar.tsx`、`src/components/ui/carousel.tsx`、`src/components/ui/input-group.tsx`

### 需要修改

- `[P0]` `src/modules/content/components/content-browser-page.tsx:860`
  - 已删除列表里的单项恢复只记了 `initiated` 和 `failed`；成功分支只有 toast，没有业务层 success 日志，也没有耗时。
  - 建议修改：改成 `promise()` 包装，或补 `performance.now()` + `logger.info("Content restore completed.", { contentId, contentType, elapsedMs })`。

- `[P0]` `src/modules/content/components/content-browser-page.tsx:930`
  - 单项永久删除链路同样缺 success / elapsed 日志；当前只能看到开始和失败，看不到一次 purge 是否真正完成。
  - 建议修改：和 restore 一样补 success + elapsed，最好统一走 `promise()`。

- `[P0]` `src/modules/content/components/content-browser-page.tsx:977`
  - 批量恢复 / 批量永久删除在循环里直接 `catch {}` 吞掉了单项失败；最终只剩一条 completed 计数日志，排查时无法定位失败的 `contentId` 和错误原因。
  - 建议修改：在 `catch` 里至少补 `logger.error("Batch action item failed.", { action, contentId: item.id, contentType, error })`，必要时把 `failedCount` / `failedIds` 一起记下来。

- `[P1]` `src/modules/content/components/content-browser-page.tsx:879`
  - 从已删除列表点“永久删除”只是 `setPurgeTarget(item)`，没有业务层“确认框已打开”日志。底层 `AlertDialog` 只能记录通用 title，看不到是哪条内容触发了确认。
  - 建议修改：在设置 `purgeTarget` 前补 `logger.info("Content purge confirm dialog opened.", { contentId, contentType })`。

- `[P2]` `src/modules/settings/components/log-export-panel.tsx:144`
  - 多文件复制分支打开选择对话框时没有业务日志，后续 `handleCopySelectedFiles()` 也没有记录 `selectedCount` / `selectedNames`；通知层只会留下“正在复制日志...”这类通用消息。
  - 建议修改：对话框打开时记录 `fileCount` / `defaultSelected`，确认复制时记录 `selectedCount` / `selectedNames`。

- `[P2]` `src/modules/settings/components/log-export-panel.tsx:307`
  - 日志文件列表里的 `Checkbox` 没有 `data-track` 或 `aria-label`，底层埋点会统一退回成 `"checkbox"`，勾选过程不可区分。
  - 建议修改：给 `Checkbox` 补稳定语义名，例如 `data-track="log-file-picker-checkbox"`；具体文件名和数量放业务 logger 的 details。

- `[P2]` `src/modules/content/components/content-action-split-button.tsx:99`
  - “更多操作”菜单缺 `data-track`，开关菜单只能落成泛化的 `"dropdown-menu"`，后续和别的下拉菜单混在一起。
  - 建议修改：给 `DropdownMenu` 补稳定 `data-track`，例如 `content-actions-menu` 或带 `item.type` 的稳定名称。

### 底层补记

- `src/components/ui/sidebar.tsx:75`
  - `setOpen()` / `toggleSidebar()` / `SidebarRail` 的收起展开都没有底层 `track()`；桌面侧边栏状态切换目前最多只有按钮点击日志，没有 from/to 状态。

- `src/components/ui/carousel.tsx:62`
  - 轮播切换状态和键盘左右键没有任何 carousel 级别埋点；当前最多只能拿到按钮点击，拿不到实际 slide 变化。

- `src/components/ui/input-group.tsx:56`
  - `InputGroupAddon` 点击后会把焦点转交给输入框，但这个快捷交互没有底层埋点；如果它继续用于搜索框、身份输入等高频入口，后面会成为盲区。

## UI Log Audit - 2026-04-21 18:10:32 CST

- 审计方式：按 `/Users/liyang/Documents/code/github/Synapse/.claude/skills/ui-log-audit/SKILL.md` 做静态检查，不启动应用。
- 审计范围：`src/app-shell/`，以及当前 diff 涉及的 `src/modules/content/`、`src/modules/prompts/`、`src/modules/rules/`、`src/modules/settings/`、`src/modules/skills/`。
- 底层覆盖概览：`src/components/ui/` 中 25/54 个文件已接入 `track()`；本次命中的 `Button`、`Dialog`、`AlertDialog`、`Select`、`Tabs`、`Checkbox`、`Switch`、`Input`、`Textarea`、`DropdownMenu`、`Menubar`、`CommandItem`、`Slider` 已覆盖。当前最直接的底层缺口仍是 `CommandInput`，另外 `calendar`、`carousel`、`hover-card`、`pagination`、`resizable`、`sidebar`、`tooltip` 这类交互型 primitive 也还没统一接入。
- 结论：创建、详情、安装、收藏、搜索主流程整体覆盖率还可以；明显遗漏主要集中在 settings 的原生目录选择器、app-shell 的快速切仓搜索，以及几处动态标题 Dialog 的 `data-track` 语义。

### P1 必补

- `src/modules/settings/components/repository-list-editor.tsx:191`
  - “新建本地仓库 -> 选择保存位置” 直接 `chooseDirectory()` 后写状态，没有打开、取消、选中、失败日志；这是一条真实的原生 IO 入口，排查失败时现在完全不可见。
  - 修改：参考 `src/app-shell/components/empty-repository-state.tsx`，补 `startedAt + logger.info/warn/error`，至少带 `selectedPath`、`elapsedMs`。

- `src/modules/settings/components/repository-list-editor.tsx:270`
  - “修改仓库 -> 选择文件夹” 同样没有任何目录选择器链路日志，和同文件 `handleAddRepository()` 的日志粒度不一致。
  - 修改：补 open、dismiss、selected、error 日志，并带上 `repositoryUuid`。

- `src/app-shell/components/repo-onboarding-dialog.tsx:49`
  - 当前仓库的 onboarding 弹窗是由派生态 `isOpen` 直接驱动的，但文件里只有 submit、success、fail 日志，没有“弹窗出现”这条记录。这个入口不是按钮点开，后面如果只看 renderer 日志，很难判断用户有没有被拦在 onboarding。
  - 修改：给 `isOpen` 加一个 visibility effect，记录 `open` 和 `repositoryUuid`；同时给 Dialog 加稳定 `data-track`。

### P2 建议补

- `src/app-shell/components/quick-repository-switch-dialog.tsx:81`
  - 快速切仓搜索框没有任何搜索日志；`src/components/ui/command.tsx` 目前只给 `CommandItem` 做了 `track()`，`CommandInput` 本身还是盲区。
  - 修改：像 `content-browser-page` 一样用 `useDeferredValue + logger.info()` 记录最终搜索词；如果命令面板后面会复用，再考虑给 `CommandInput` 做统一埋点。

- `src/modules/settings/components/log-export-panel.tsx:144`
  - 多日志文件时会切到“选择要复制的日志文件”对话框，但这里只有最外层的 `Log copy to clipboard initiated.`，没有记录 picker 被打开、默认选中了哪个文件、总共多少文件。
  - 修改：在 `setLogFilePickerState(...)` 前补 `logger.info("Log file picker opened.", { fileCount, defaultSelected })`。

- `src/modules/settings/components/log-export-panel.tsx:307`
  - 文件选择 checkbox 没有 `data-track`、`aria-label`、`id`，底层 `Checkbox` 会统一回退成 `"checkbox"`，日志里无法区分用户勾的是哪个文件。
  - 修改：给 checkbox 至少补稳定 `data-track`，或者在 `onCheckedChange` 里补一条带 `file.name`、`checked`、`selectedCount` 的业务日志。

### data-track 语义缺失

- `src/modules/content/components/content-detail-dialog.tsx:411`
  - 详情弹窗没有 `data-track`，底层 Dialog 会退回到内容标题；同一个交互会被拆成成百上千个动态名字，不利于聚合。
  - 修改：补稳定标识，例如 `data-track="content-detail-dialog"`，把内容 ID 放到业务 logger 里。

- `src/modules/content/components/content-install-dialog.tsx:643`
  - 安装弹窗没有 `data-track`，当前 fallback 是 `安装到 {editor.label}`；换 editor 后日志名会漂移。
  - 修改：补稳定 `data-track="content-install-dialog"`。

- `src/app-shell/components/repo-onboarding-dialog.tsx:106`
  - onboarding Dialog 没有 `data-track`，fallback 依赖仓库名。
  - 修改：补稳定 `data-track="repo-onboarding-dialog"`。

- `src/app-shell/components/switch-repository-onboarding-dialog.tsx:83`
  - 切仓 onboarding Dialog 同样依赖动态仓库名作为 fallback。
  - 修改：补稳定 `data-track="switch-repository-onboarding-dialog"`。

## UI 日志审计 2026-04-21 18:09:22 CST
- 范围：按 `ui-log-audit` 技能，审计 `git diff --name-only` 涉及模块（`content` / `prompts` / `rules` / `settings` / `skills`）和 `src/app-shell/`。
- 日志入口基线：`src/lib/ui-tracking.ts` 的 `track()`，`src/app-shell/logging.ts` 的 `createRendererLogger()`，`src/app-shell/notifications.tsx` 的 `promise()` / `showToast()`。
- 结论：常规按钮、Tabs、Select、收藏、下载、复制、保存主链路大多已有覆盖，当前主要缺口集中在“程序化打开的受控弹窗”、“命令面板搜索输入”和“缺少语义化 data-track 的选择控件”。

### P0
- 暂未发现必须立刻补上的 P0 缺口。

### P1
- [ ] `src/modules/content/components/content-detail-dialog.tsx:246` / `src/modules/content/components/content-detail-dialog.tsx:285` / `src/modules/content/components/content-detail-dialog.tsx:374`
  冲突弹窗通过 `setConflictState(...)` 程序化打开和关闭，但这里没有任何 `logger.info(...)` 记录冲突弹窗出现、关闭、模式（`save` / `delete`）和目标内容。当前只能看到保存/删除动作本身，看不到“为什么突然进入冲突处理弹窗”。
  建议修改：在写入/清空 `conflictState` 的路径补 `logger.info("Conflict dialog visibility changed.", { open, mode, contentId, contentType, latestHistoryDirname })`。

- [ ] `src/modules/settings/components/log-export-panel.tsx:144` / `src/modules/settings/components/log-export-panel.tsx:250` / `src/modules/settings/components/log-export-panel.tsx:285` / `src/modules/settings/components/log-export-panel.tsx:335`
  “选择要复制的日志文件”弹窗和“删除全部日志”确认框都是受控弹窗，打开或通过按钮关闭时都只是直接改 state，没有业务日志。按钮 click 和 `promise()` 异步日志还在，但缺少弹窗可见性日志，排查用户为什么停留在确认框/文件选择框时上下文不完整。
  建议修改：抽 `openClearDialog` / `closeClearDialog` / `openLogFilePicker` / `closeLogFilePicker`，统一记录 `open`、`fileCount`、`selectedCount`、`source`（`cancel-button` / `dismiss` / `copy-success` / `delete-success`）。

- [ ] `src/app-shell/components/repo-onboarding-dialog.tsx:49`
  当前仓库进入 `needs-onboarding` 时会自动弹出 onboarding 对话框，但没有任何“对话框出现/消失”的日志；现在只记录了提交成功/失败，缺少用户为什么被阻塞在这个流程的前置上下文。
  建议修改：用 `useRef + useEffect` 记录 `isOpen` 从 `false -> true` 和 `true -> false`，带上 `repositoryUuid`。

### P2
- [ ] `src/app-shell/components/quick-repository-switch-dialog.tsx:81`
  仓库切换面板的搜索输入没有 `track()` 或业务 logger；`CommandInput` 本身也不产生日志，所以搜索词变化完全不可见。
  建议修改：在这个组件本地持有 search state，并用 debounce `logger.info("Repository switch search changed.", { query, resultCount })`；或者给 `src/components/ui/command.tsx` 的 `CommandInput` 增加 `data-track` + `change` 事件支持。

- [ ] `src/modules/settings/components/log-export-panel.tsx:307`
  文件选择列表里的 `Checkbox` 没有 `data-track` / `aria-label` / `id`，底层日志名会统一退化成 `checkbox`，无法知道用户勾选的是哪个日志文件。
  建议修改：给每个 `Checkbox` 增加稳定 `data-track`（例如 `settings-log-file-<index>`），并在 `onCheckedChange` 里补 `fileName`、`selectedCount` 业务日志。

- [ ] `src/modules/content/components/content-detail-dialog.tsx:411`
  详情 `Dialog` 没有 `data-track`，底层 dialog track 会退化成动态标题 `resolvedItem.title`。日志名高基数且不稳定，不利于聚合和按内容类型统计。
  建议修改：给详情弹窗补稳定 `data-track`，例如 `content-detail-${contentType}`，内容 ID 继续放在业务 logger 里。

- [ ] `src/app-shell/components/empty-repository-state.tsx:210` / `src/app-shell/components/empty-repository-state.tsx:247`
  新建仓库弹窗打开时已有业务日志，但通过取消按钮或直接关闭弹窗时只是改 state，没有“放弃创建仓库”的语义日志。这个流程是空仓库启动期的主路径，缺少关闭日志后不容易判断用户是取消了创建还是流程异常中断。
  建议修改：封装 `closeCreateDialog(source)`，统一记录 `source: cancel-button | dialog-dismiss | create-success`。

### data-track 语义备注
- `src/app-shell/components/quick-repository-switch-dialog.tsx:93` 的 `CommandItem` 没有显式 `data-track`，底层 `command-item` 会回落到 `${repository.name} ${repository.localPath}`，名字过长且高基数。这里已有 `logger.info("Repository switch selected.", ...)`，所以不是遗漏，但仍建议补稳定 `data-track`。

### 已覆盖的主链路
- `src/App.tsx` 已记录顶层 Tab 切换、内容弹窗显隐、待同步弹窗显隐、手动同步。
- `src/modules/content/hooks/use-content-create-form.ts` 已记录创建/编辑弹窗显隐、放弃确认弹窗显隐、分类/图标相关字段切换、校验失败、放弃编辑。
- `src/modules/content/create-content-module.tsx` 已记录创建提交；`src/modules/content/components/content-detail-dialog.tsx` 已记录详情页模式切换、历史版本切换、编辑打开、删除确认打开、收藏切换、新窗口打开、保存/删除发起。
- `src/modules/content/hooks/use-content-download-actions.tsx` 已记录安装弹窗显隐、安装目标加载、下载、复制正文。
- `src/modules/content/hooks/use-content-favorites.ts` 已记录收藏/取消收藏。
- `src/modules/settings/index.tsx` 已记录设置分类切换、设置保存、仓库列表保存、项目列表保存。
- `src/app-shell/active-repository-switch.tsx`、`src/app-shell/components/switch-repository-onboarding-dialog.tsx`、`src/app-shell/components/identity-gate.tsx` 的主要动作已具备业务日志。

### 底层组件覆盖率
- `src/components/ui` 已接入 `track()`：`accordion.tsx`, `alert-dialog.tsx`, `button.tsx`, `checkbox.tsx`, `collapsible.tsx`, `command.tsx`, `context-menu.tsx`, `dialog.tsx`, `drawer.tsx`, `dropdown-menu.tsx`, `input-otp.tsx`, `input.tsx`, `menubar.tsx`, `native-select.tsx`, `navigation-menu.tsx`, `popover.tsx`, `radio-group.tsx`, `select.tsx`, `sheet.tsx`, `slider.tsx`, `switch.tsx`, `tabs.tsx`, `textarea.tsx`, `toggle-group.tsx`, `toggle.tsx`（25 / 54）。
- `src/components/ui` 未接入 `track()`：`alert.tsx`, `aspect-ratio.tsx`, `avatar.tsx`, `badge.tsx`, `breadcrumb.tsx`, `button-group.tsx`, `calendar.tsx`, `card.tsx`, `carousel.tsx`, `chart.tsx`, `direction.tsx`, `empty.tsx`, `field.tsx`, `hover-card.tsx`, `input-group.tsx`, `item.tsx`, `kbd.tsx`, `label.tsx`, `pagination.tsx`, `progress.tsx`, `resizable.tsx`, `scroll-area.tsx`, `separator.tsx`, `sidebar.tsx`, `skeleton.tsx`, `sonner.tsx`, `spinner.tsx`, `table.tsx`, `tooltip.tsx`。

## [2026-04-21 18:11:22 CST] UI Log Audit

范围：按 `.claude/skills/ui-log-audit/SKILL.md` 扫描 `src/app-shell/`，并结合 `git diff --name-only` 审查 `src/modules/content`、`src/modules/prompts`、`src/modules/rules`、`src/modules/settings`、`src/modules/skills`，额外看了 `src/components/image-crop-dialog.tsx`。

### 结论
- 现有项目在底层 `track()` 和业务层 `logger` 上已经有一层基础覆盖，常规按钮点击、Tabs/Select 切换、创建/保存/下载/复制等主路径多数都有日志。
- 这轮最明显的缺口集中在 3 类：
  1. silent async load 只有失败日志，缺开始/成功/耗时；
  2. 仓库切换弹窗搜索没有任何日志；
  3. 少数 tracked primitive 缺少语义化 `data-track`，日志会退化成通用名或动态标题，不利于聚合分析。

### 底层覆盖
- 已接入 `track()` 的 UI 原子文件：`accordion`、`alert-dialog`、`button`、`checkbox`、`collapsible`、`command`、`context-menu`、`dialog`、`drawer`、`dropdown-menu`、`input`、`input-otp`、`menubar`、`native-select`、`navigation-menu`、`popover`、`radio-group`、`select`、`sheet`、`slider`、`switch`、`tabs`、`textarea`、`toggle`、`toggle-group`。
- 明显仍未接入或覆盖不完整的交互型原子：`calendar`、`carousel`、`hover-card`、`pagination`、`resizable`、`sidebar`、`tooltip`。
- `src/components/ui/command.tsx` 这个文件虽然已经给 `CommandItem` 做了 `track()`，但 `CommandInput` 仍然是裸 `cmdk` input，没有任何输入日志。

### 已覆盖较完整的区域
- `src/app-shell/active-repository-switch.tsx`：仓库切换、弹窗开关、onboarding cancel/complete、promise 包装的切换动作都已记录。
- `src/modules/content/create-content-module.tsx` + `src/modules/content/hooks/use-content-create-form.ts`：创建弹窗可见性、放弃编辑、校验失败、提交动作已覆盖。
- `src/modules/content/hooks/use-content-download-actions.tsx`：下载、复制、安装目标加载、安装弹窗开关已覆盖。
- `src/modules/settings/components/log-export-panel.tsx`：导出/复制/清空日志三个主动作基本都有 `logger + promise`，主要问题只剩文件选择语义弱。
- `src/modules/skills/components/skill-create-dialog.tsx`：附件拖拽、文件/文件夹选择、清空、单项移除都有业务日志。

### 需要修改的代码

#### P0
- `src/modules/content/hooks/use-content-detail-state.ts:67-133`
  - 问题：打开详情弹窗/详情窗口时的 `readDetail + readHistory` 只在 catch 里记了 `Failed to load content detail.`，没有开始/成功/elapsed。
  - 建议：在 effect 内补 `startedAt`，增加 `detail load started / completed / failed` 三段日志，至少带 `contentId`、`contentType`、`historyCount`、`elapsedMs`。
- `src/modules/content/hooks/use-content-detail-state.ts:150-205`
  - 问题：历史版本切换后的 `readHistoryVersion()` 也只有失败日志，没有开始/成功/elapsed。
  - 建议：补 `history version load started / completed / failed`，带 `contentId`、`historyDirname`、`elapsedMs`。
- `src/modules/content/hooks/use-deleted-content.ts:18-29`
  - 问题：Deleted 列表加载/刷新完全没有日志；无开始、无成功、无失败、无耗时。
  - 建议：引入 `createRendererLogger("content.deleted")`，在 `refresh()` 里补 started/completed/failed + `contentType` + `count` + `elapsedMs`。

#### P1
- `src/modules/content/components/content-browser-page.tsx:860-877`
  - 问题：单条恢复只记了 `Content restore initiated.` / `Content restore failed.`，成功和耗时没有日志。
  - 建议：改成 `promise()` 或手动 `performance.now()`，补 `Content restored.` + `elapsedMs`。
- `src/modules/content/components/content-browser-page.tsx:930-944`
  - 问题：单条永久删除同样只记 initiated / failed，没有 success / elapsed。
  - 建议：同上，补 success/fail/elapsed。
- `src/modules/content/components/content-browser-page.tsx:977-990`
  - 问题：批量恢复/删除循环里的失败被空 `catch {}` 吞掉；最后只有 `successCount` 汇总，看不到失败的是哪条内容。
  - 建议：至少在循环 catch 里记 `logger.warn/error`，带 `action`、`contentId`、`title`、`error`；如果担心日志量大，可以只在失败时记。
- `src/app-shell/components/quick-repository-switch-dialog.tsx:81`
  - 问题：仓库切换弹窗的搜索输入没有任何日志；这是 skill 里明确要求单独检查的搜索入口。
  - 建议：本地加 `query state + useDeferredValue/useEffect` 记录最终搜索词，或者把能力下沉到 `CommandInput`。
- `src/components/ui/command.tsx:67-81`
  - 问题：`CommandInput` 目前是裸 `CommandPrimitive.Input`，既没有 `track()`，也没有统一的输入语义。
  - 建议：给 `CommandInput` 补最少的 `focus/blur/change` track，避免所有基于 command palette 的搜索入口都变成日志盲区。

#### P2 / data-track 语义
- `src/modules/content/components/content-action-split-button.tsx:99-108`
  - 问题：`DropdownMenu` 没有 `data-track`，打开/关闭日志会统一退化成 `dropdown-menu`，无法区分这是内容操作菜单。
  - 建议：给 `DropdownMenu` 加 `data-track="content-action-menu"`，最好再带 `item.type`。
- `src/modules/content/components/content-detail-dialog.tsx:411-415`
  - 问题：详情根 `Dialog` 没有 `data-track`，当前 fallback 是动态标题 `resolvedItem.title`。单次排查能看懂，但聚合时会把同一种详情弹窗拆成大量动态 name。
  - 建议：给根 `Dialog` 补稳定语义名，例如 `data-track={`${contentType}-detail-dialog`}`。
- `src/modules/settings/components/log-export-panel.tsx:303-321`
  - 问题：日志文件多选里的 `Checkbox` 没有 `data-track` 或 `name`，底层日志只会记成通用 `checkbox`，看不出这是“选择待复制日志文件”。
  - 建议：给 `Checkbox` 加稳定语义名，例如 `data-track="log-file-select"`；如果还想要文件维度，再补业务 logger 记录 selected count。

### 额外备注
- `src/modules/prompts/components/prompt-create-dialog.tsx`、`src/modules/rules/components/rule-create-dialog.tsx`、`src/modules/skills/components/skill-create-dialog.tsx` 本身没有明显“完全没日志”的主交互缺口，更多是沿用了 `useContentCreateForm` / `useContentIconImage` / `ContentAppearanceFields` 的统一覆盖。
- `src/components/image-crop-dialog.tsx` 的打开/关闭、确认、缩放 slider 已经能通过 `Dialog` / `Button` / `Slider` 看到基础埋点；这轮没有把裁剪区域拖拽/滚轮缩放记成必须补的缺口，主要因为那类连续交互很容易变成高噪音日志。

## [2026-04-21 18:12:00 +0800] ui-log-audit 扫描补充

### 范围
- 按 `.claude/skills/ui-log-audit/SKILL.md` 扫描。
- 这轮优先看当前 `git diff --name-only` 触达的模块：`src/modules/content`、`src/modules/prompts`、`src/modules/rules`、`src/modules/settings`、`src/modules/skills`，并始终包含 `src/app-shell/`。

### 结论
- 变更范围里的主流程整体覆盖不差：顶层 Tab 切换、内容浏览页的分类/搜索/排序、详情页的视图切换/历史切换、安装流程、收藏切换、设置分类切换，基本都有 `track()` 或业务 `logger`。
- 这轮确认的主要缺口集中在 3 类：`Command` 搜索输入没有日志、少数直接异步操作没有耗时、以及个别 `data-track` fallback 语义过弱。

### 底层组件覆盖
- `src/components/ui/` 里文件级已接入 `track()` 的是 `25/54`。
- 已接入的核心交互 primitive：`accordion`、`alert-dialog`、`button`、`checkbox`、`collapsible`、`command`、`context-menu`、`dialog`、`drawer`、`dropdown-menu`、`input`、`input-otp`、`menubar`、`native-select`、`navigation-menu`、`popover`、`radio-group`、`select`、`sheet`、`slider`、`switch`、`tabs`、`textarea`、`toggle`、`toggle-group`。
- 仍未接入、且比较像交互/导航 primitive 的文件：`src/components/ui/calendar.tsx`、`src/components/ui/carousel.tsx`、`src/components/ui/hover-card.tsx`、`src/components/ui/pagination.tsx`、`src/components/ui/resizable.tsx`、`src/components/ui/sidebar.tsx`、`src/components/ui/tooltip.tsx`。
- `src/components/ui/command.tsx` 是“部分覆盖”：`CommandItem` 已埋点，但 `CommandInput` 仍是盲区。

### 需要修改的代码

#### P1
- `src/app-shell/components/quick-repository-switch-dialog.tsx:81`
  - 问题：仓库切换弹窗的 `CommandInput` 没有任何搜索词日志；当前只能看到打开弹窗和最终选中了哪个仓库，看不到“搜了什么但没选”。
  - 建议：把输入做成受控状态，配 `useDeferredValue + useEffect` 记录最终搜索词、结果数、是否命中当前仓库。

- `src/components/ui/command.tsx:67-87`
  - 问题：`CommandInput` 目前只是裸 `CommandPrimitive.Input`，没有 `track()`，导致所有基于 command palette 的搜索入口都默认失去输入层日志。
  - 建议：在 primitive 层补最小覆盖，至少支持 `focus/blur`，并为需要搜索审计的场景提供 `data-track` + `onValueChange`/`change` 记录入口。

- `src/modules/settings/components/adopt-identity-dialog.tsx:42-59`
  - 问题：`adoptExistingUserId()` 是直接异步提交，现有日志只有 submitted/succeeded/failed，没有 `elapsedMs`；按 skill 的异步检查规则，这类没走 `promise()` 的操作应该补手动耗时。
  - 建议：提交前记 `startedAt = performance.now()`，在 success / fail 日志都补 `elapsedMs`；或者统一改成 `promise()` 包装。

#### P2
- `src/modules/skills/components/skill-create-dialog.tsx:301-329`
  - 问题：拖拽附件只记了 `Skill attachment drop started.` 和失败日志，成功路径没有耗时；排查“大目录拖入很慢/卡住”时看不到静态日志证据。
  - 建议：在 `handleDrop()` 里补 `startedAt`，在成功、空结果、失败三条路径都带上 `elapsedMs`。

#### data-track / 语义问题
- `src/app-shell/components/quick-repository-switch-dialog.tsx:93-96`
  - 问题：`CommandItem` 没有显式 `data-track`，底层 fallback 会直接拿 `value={`${repository.name} ${repository.localPath}`}` 当日志名，日志里会混入本地路径，既噪音大也不稳定。
  - 建议：给 `CommandItem` 加稳定语义名，例如 `data-track="repository-switch-item"`；仓库维度信息继续放在现有 `logger.info(..., { repositoryUuid, repositoryName })` 里。

- `src/modules/settings/components/log-export-panel.tsx:307-321`
  - 问题：多文件复制对话框里的 `Checkbox` 没有 `data-track`、`aria-label` 或 `id`，底层日志只会得到通用的 `checkbox`，无法区分这是“日志文件选择”。
  - 建议：至少补稳定语义名，例如 `data-track="log-file-select"` 或 `aria-label={`选择日志文件 ${file.name}`}`；如果需要更高价值，还可以补一个业务 logger 记录 selected count 变化。

### 额外备注
- `src/modules/content/components/content-browser-page.tsx` 这一块的分类切换、删除筛选、搜索、防抖搜索日志、批量操作、详情打开、恢复/清理动作，覆盖已经比较完整。
- `src/modules/prompts/components/prompt-create-dialog.tsx`、`src/modules/rules/components/rule-create-dialog.tsx`、`src/modules/skills/components/skill-create-dialog.tsx` 的常规表单流主要依赖 `useContentCreateForm` / `useContentIconImage` / `ContentAppearanceFields`，这轮没有发现新的“完全无日志”主交互缺口。

## UI Log Audit 2026-04-21 18:12:16 CST

范围：
- `src/modules/*`
- `src/app-shell/*`
- 审计口径来自 `.claude/skills/ui-log-audit/SKILL.md`

结论：
- 底层 primitive 埋点基础可用，但受控弹窗 visibility 和内容删除/恢复这两类交互仍有明显遗漏。
- `src/components/ui` 里 54 个 primitive 中 25 个已接入 `track()`；本次路径直接相关的 `Button`、`Dialog`、`AlertDialog`、`Tabs`、`Select`、`DropdownMenu`、`Menubar`、`Input`、`Textarea`、`Checkbox`、`Switch`、`Slider` 已接入。
- 需要特别注意：当前 `Dialog` / `AlertDialog` 的埋点只挂在 `onOpenChange`。对外部 `setState(true/false)` 驱动的受控弹窗，程序化 open/close 不会自动产生日志，必须在业务层补 visibility log。

### P0
- `src/modules/content/components/content-browser-page.tsx:860` 单条恢复操作只有 `Content restore initiated` / `Content restore failed`，成功态只走 `toast.success`，没有 success/elapsedMs，也绕过了 `notificationLogger`。建议改成 `useAppNotifications().promise()` 或至少补 success + elapsedMs 日志。
- `src/modules/content/components/content-browser-page.tsx:930` 单条永久删除操作同样只有 initiated / failed；成功态只走 `toast.success`，没有 success/elapsedMs，也没有统一通知日志。建议同上。
- `src/modules/content/components/content-browser-page.tsx:997` 批量恢复/批量永久删除虽然有 `Batch action completed`，但最终反馈仍直接走 `toast.success` / `toast.warning`，不会进入 `notificationLogger`。建议统一走通知封装，至少保留结果消息和耗时。

### P1
- `src/app-shell/components/repo-onboarding-dialog.tsx:49` 仓库 onboarding 弹窗是受控弹窗，`isOpen` 由状态派生；当前只有 submit / completed / failed，没有 dialog opened / closed。由于 `Dialog` 只在 `onOpenChange` 里 track，这个弹窗的出现/消失不会自动记日志。建议用 `useEffect` 对 `isOpen` 做前后值比较并记录 visibility。
- `src/app-shell/components/switch-repository-onboarding-dialog.tsx:33` 切换仓库 onboarding 同样缺少 visibility 日志；现在只有 submit / completed / failed，打开时没有 opened，非 cancel 场景关闭也没有 closed。建议同样在 `isOpen` 派生状态处补。
- `src/modules/settings/components/repository-display-name-field.tsx:104` 作者署名弹窗只记录 opened / saved / failed；`handleCancel()` 和保存成功后的 `setIsOpen(false)` 都是程序化关闭，close/cancel 没日志。建议把 `open=true/false` 都放进统一 setter/logger。
- `src/modules/settings/components/identity-panel.tsx:61` 与 `src/modules/settings/components/adopt-identity-dialog.tsx:63` “接续已有身份”只记录 opened / submitted / succeeded / failed；取消按钮和外部关闭只会 `setIsAdoptDialogOpen(false)`，没有 closed/cancelled。建议在父层统一封装 `setIsAdoptDialogOpen`，记录 from/to。
- `src/modules/settings/components/project-list-editor.tsx:47` 添加项目弹窗只记 opened；取消、保存成功后的 `setIsDialogOpen(false)`、编辑弹窗 `handleEditDialogClose()` 都没有 closed/cancelled。建议为 add/edit 两个 dialog 都补 visibility 日志。
- `src/modules/settings/components/repository-list-editor.tsx:178` 仓库创建/编辑弹窗同样只记 opened；`setIsCreateDialogOpen(false)`、`handleEditDialogClose()` 都没有 close/cancel 日志。建议与 project editor 同步补齐。
- `src/modules/content/components/content-browser-page.tsx:879` 单条永久删除确认框打开时只是 `setPurgeTarget(item)`，没有 opened 日志；`src/modules/content/components/content-browser-page.tsx:918` 关闭时只是 `setPurgeTarget(null)`，取消/关闭也没有日志。建议为 purge confirm 增加明确的 open/close 记录。
- `src/modules/content/components/content-browser-page.tsx:824` 批量操作确认框虽然记录了 opened，但 `src/modules/content/components/content-browser-page.tsx:953` 取消或关闭只 `setBatchAction(null)`，缺少 closed/cancelled。建议把 `batchAction` 包一层 setter 统一记录。
- `src/modules/content/components/content-detail-dialog.tsx:445` 删除确认框和冲突确认框只记录 opened/后续动作，close/cancel 不完整；尤其成功删除后 `setIsDeleteConfirmOpen(false)`、冲突框 `setConflictState(null)` 都是程序化关闭。建议统一补 visibility log。
- `src/modules/settings/components/log-export-panel.tsx:250` 删除日志确认框与多文件复制选择弹窗 `src/modules/settings/components/log-export-panel.tsx:285` 都缺少 opened/cancelled/closed 日志；现在只有真正执行 clear/copy 时才写日志。建议在 `setIsClearDialogOpen` / `setLogFilePickerState` 变化处补。

### P2
- `src/components/inline-notice.tsx:10` `InlineNotice` 直接写 `sonner.toast`，不会进入 `notificationLogger`；当前 `content-version-view` 的“该内容已被删除”提醒因此没有通知日志。建议改用统一通知封装，或者至少在 `showInlineNoticeToast()` 内补 logger。
- `src/modules/content/components/content-detail-dialog.tsx:411`、`src/app-shell/components/repo-onboarding-dialog.tsx:106`、`src/app-shell/components/switch-repository-onboarding-dialog.tsx:83`、`src/modules/settings/components/project-list-editor.tsx:239`、`src/modules/settings/components/repository-list-editor.tsx:493`、`src/modules/settings/components/log-export-panel.tsx:285` 等受控 `Dialog/AlertDialog` 没有 `data-track`；当前 fallback 依赖动态标题或通用标题，后续查日志时语义不稳定。建议为这些 dialog 补稳定 `data-track` 名称。

## [2026-04-21 18:12:00 +0800] ui-log-audit 扫描补充（EOF 追加版）

### 范围
- 按 `.claude/skills/ui-log-audit/SKILL.md` 扫描。
- 这轮优先看当前 `git diff --name-only` 触达的模块：`src/modules/content`、`src/modules/prompts`、`src/modules/rules`、`src/modules/settings`、`src/modules/skills`，并始终包含 `src/app-shell/`。

### 结论
- 变更范围里的主流程整体覆盖不差：顶层 Tab 切换、内容浏览页的分类/搜索/排序、详情页的视图切换/历史切换、安装流程、收藏切换、设置分类切换，基本都有 `track()` 或业务 `logger`。
- 这轮确认的主要缺口集中在 3 类：`Command` 搜索输入没有日志、少数直接异步操作没有耗时、以及个别 `data-track` fallback 语义过弱。

### 底层组件覆盖
- `src/components/ui/` 里文件级已接入 `track()` 的是 `25/54`。
- 已接入的核心交互 primitive：`accordion`、`alert-dialog`、`button`、`checkbox`、`collapsible`、`command`、`context-menu`、`dialog`、`drawer`、`dropdown-menu`、`input`、`input-otp`、`menubar`、`native-select`、`navigation-menu`、`popover`、`radio-group`、`select`、`sheet`、`slider`、`switch`、`tabs`、`textarea`、`toggle`、`toggle-group`。
- 仍未接入、且比较像交互/导航 primitive 的文件：`src/components/ui/calendar.tsx`、`src/components/ui/carousel.tsx`、`src/components/ui/hover-card.tsx`、`src/components/ui/pagination.tsx`、`src/components/ui/resizable.tsx`、`src/components/ui/sidebar.tsx`、`src/components/ui/tooltip.tsx`。
- `src/components/ui/command.tsx` 是“部分覆盖”：`CommandItem` 已埋点，但 `CommandInput` 仍是盲区。

### 需要修改的代码

#### P1
- `src/app-shell/components/quick-repository-switch-dialog.tsx:81`
  - 问题：仓库切换弹窗的 `CommandInput` 没有任何搜索词日志；当前只能看到打开弹窗和最终选中了哪个仓库，看不到“搜了什么但没选”。
  - 建议：把输入做成受控状态，配 `useDeferredValue + useEffect` 记录最终搜索词、结果数、是否命中当前仓库。

- `src/components/ui/command.tsx:67-87`
  - 问题：`CommandInput` 目前只是裸 `CommandPrimitive.Input`，没有 `track()`，导致所有基于 command palette 的搜索入口都默认失去输入层日志。
  - 建议：在 primitive 层补最小覆盖，至少支持 `focus/blur`，并为需要搜索审计的场景提供 `data-track` + `onValueChange`/`change` 记录入口。

- `src/modules/settings/components/adopt-identity-dialog.tsx:42-59`
  - 问题：`adoptExistingUserId()` 是直接异步提交，现有日志只有 submitted/succeeded/failed，没有 `elapsedMs`；按 skill 的异步检查规则，这类没走 `promise()` 的操作应该补手动耗时。
  - 建议：提交前记 `startedAt = performance.now()`，在 success / fail 日志都补 `elapsedMs`；或者统一改成 `promise()` 包装。

#### P2
- `src/modules/skills/components/skill-create-dialog.tsx:301-329`
  - 问题：拖拽附件只记了 `Skill attachment drop started.` 和失败日志，成功路径没有耗时；排查“大目录拖入很慢/卡住”时看不到静态日志证据。
  - 建议：在 `handleDrop()` 里补 `startedAt`，在成功、空结果、失败三条路径都带上 `elapsedMs`。

#### data-track / 语义问题
- `src/app-shell/components/quick-repository-switch-dialog.tsx:93-96`
  - 问题：`CommandItem` 没有显式 `data-track`，底层 fallback 会直接拿 `value={`${repository.name} ${repository.localPath}`}` 当日志名，日志里会混入本地路径，既噪音大也不稳定。
  - 建议：给 `CommandItem` 加稳定语义名，例如 `data-track="repository-switch-item"`；仓库维度信息继续放在现有 `logger.info(..., { repositoryUuid, repositoryName })` 里。

- `src/modules/settings/components/log-export-panel.tsx:307-321`
  - 问题：多文件复制对话框里的 `Checkbox` 没有 `data-track`、`aria-label` 或 `id`，底层日志只会得到通用的 `checkbox`，无法区分这是“日志文件选择”。
  - 建议：至少补稳定语义名，例如 `data-track="log-file-select"` 或 `aria-label={`选择日志文件 ${file.name}`}`；如果需要更高价值，还可以补一个业务 logger 记录 selected count 变化。

### 额外备注
- `src/modules/content/components/content-browser-page.tsx` 这一块的分类切换、删除筛选、搜索、防抖搜索日志、批量操作、详情打开、恢复/清理动作，覆盖已经比较完整。
- `src/modules/prompts/components/prompt-create-dialog.tsx`、`src/modules/rules/components/rule-create-dialog.tsx`、`src/modules/skills/components/skill-create-dialog.tsx` 的常规表单流主要依赖 `useContentCreateForm` / `useContentIconImage` / `ContentAppearanceFields`，这轮没有发现新的“完全无日志”主交互缺口。
