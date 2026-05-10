# 扫描详情新增"发布到仓库"设计

## 背景

IDE 扫描页可以展示本机各编辑器中的 Rule / Skill，并能识别一项是不是从 Synapse 安装的。识别为 Synapse 安装的条目（`source==='synapse'` 且 `synapseContentId` 不为空）目前在详情弹窗的"操作"菜单里只有 `查看仓库内容`、`重新安装`、`移到废纸篓`、`复制到其它编辑器`，没有把本地修改推回仓库的入口。

用户在编辑器里直接修改了已经安装的 Skill 或 Rule 后，需要一条把本地版本推回 Synapse 仓库的路径，并能选择覆盖原内容或发布为新内容。

## 现有代码落点

- 扫描详情弹窗：`desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`
- Quick publish 载荷构建：`desktop/src/modules/editor-scan/lib/quick-publish.ts`
- Quick publish 主进程读取：`desktop/electron/modules/editor-scan/ipc.ts`（`prepareQuickPublishDraft`）
- 内容打开请求事件：`desktop/src/app-shell/content-navigation.ts`
- 内容详情弹窗（含编辑态）：`desktop/src/modules/content/components/content-detail-dialog.tsx`
- 内容更新 API：`desktop/src/app-shell/content.ts`（`updateRule` / `updateSkill`）
- 创建/编辑表单（Skill / Rule）：`desktop/src/modules/skills/*`、`desktop/src/modules/rules/*`

## 产品范围

- 在扫描详情弹窗里给 Synapse 安装的 Skill 和 Rule 新增 `发布到仓库` 操作。
- 点击后让用户选 `覆盖仓库现有内容` 或 `发布为新的 Skill / Rule`。
- 覆盖路径跳进该仓库内容的详情编辑态，body（以及 Skill 的附件）由本地版本预填，其它字段保留仓库现值，用户保存才落库。
- 新建路径完全复用现有 quick publish 流程。
- 不改外部条目的 `导入到仓库` 标签和行为。
- 不改 `重新安装`、`移到废纸篓`、`复制到其它编辑器` 行为。
- 不引入 diff 预览、不静默写库、不做批量发布。

## 用户体验

### 菜单形态

Synapse 链接条目的菜单顺序（新增第 3 项）：

```text
1. 查看仓库内容
2. 重新安装
3. 发布到仓库       ← 新增
4. 移到废纸篓
5. 复制到其它编辑器
```

外部条目菜单不变：

```text
1. 导入到仓库
2. 移到废纸篓
3. 复制到其它编辑器
```

### "发布到仓库"选择弹窗

点击 `发布到仓库` 打开 `AlertDialog`：

标题：

```text
发布到仓库
```

描述：

```text
把本地内容推回仓库。覆盖会替换该 {Skill|Rule} 在仓库的现有内容，仓库会保留历史版本，可回退。
```

按钮：

- 取消：`取消`
- 主按钮：`覆盖现有内容`
- 次按钮：`发布为新内容`

类型 token `{Skill|Rule}` 跟随 `item.type` 切换。

### 覆盖路径

1. renderer 调 `bridge.editorScan.prepareQuickPublishDraft` 拿到本地 body / metadata / 附件。
2. renderer 派发 `kind: "edit-overwrite"` 的 `ContentOpenRequest`，关闭扫描详情弹窗。
3. 内容详情容器接到事件，按 `contentId` 加载详情。
4. 加载完成后自动进入编辑态，把 prefill 灌进编辑表单：
   - Rule：覆写表单的 `content`，其它字段保留仓库现值。
   - Skill：覆写表单的 `content` 和 `files`（完全镜像，本地有什么文件，表单的附件就是什么），其它字段保留仓库现值。
5. 用户检查后点保存，沿用既有 `manager.updateContent` 的更新链路、冲突处理与推送。

### 新建路径

完全复用现有 `publishAsNew()` 流程：读 quick publish draft → 用 `buildRuleQuickPublishPayload` / `buildSkillQuickPublishPayload` → 派发 `kind: "create"` 的 `ContentOpenRequest` → 用户在新建对话框里再确认。

### 降级：仓库内容已删除或不可用

只在覆盖路径需要降级。在加载阶段如果命中以下任一情况：

- `readDetail` 抛错。
- `detail.deleted === true`。

走现有 `fallbackReason` AlertDialog（`关联内容不可用，可以作为新内容导入。`），点击后触发 `publishAsNew()`。新建路径不需要降级。

### 成功与失败

- 覆盖路径成功：沿用现有内容详情保存流程，由 `ContentDetailDialog` 自身的 toast / dialog 行为处理。扫描详情弹窗在派发请求时已关闭。
- 覆盖路径失败（draft 准备阶段）：保持扫描详情弹窗打开，在弹窗内的 `Alert` 区显示错误，沿用 `quickPublishError` 这个状态。
- 新建路径：维持现状。

## 类型与数据

### `ContentOpenRequest` 扩展

在 `desktop/src/app-shell/content-navigation.ts` 新增一种 kind：

```ts
type EditOverwriteRulePrefill = {
  contentType: "rule"
  content: string
}

type EditOverwriteSkillPrefill = {
  contentType: "skill"
  content: string
  files: SkillAttachmentInput[]
}

type EditOverwriteContentOpenRequest =
  | {
      kind: "edit-overwrite"
      requestId: string
      contentType: "rule"
      contentId: string
      prefill: EditOverwriteRulePrefill
      sourceLabel: string
    }
  | {
      kind: "edit-overwrite"
      requestId: string
      contentType: "skill"
      contentId: string
      prefill: EditOverwriteSkillPrefill
      sourceLabel: string
    }
```

并提供 `requestOpenContentEditOverwrite(request)` 派发函数。

`SkillAttachmentInput` 直接复用 `desktop/src/modules/skills/types.ts` 中现有的 attachment input 形态（`originalName` / `size` / `bytes`），保证和 quick publish 新建路径一致。

### 内容详情容器

容器层（订阅 `subscribeContentOpenRequest` 的位置）需要识别 `kind: "edit-overwrite"`：

- 打开对应内容的详情弹窗（同 `kind: "detail"`）。
- 把 `prefill` 透传给 `ContentDetailDialog`。

### `ContentDetailDialog`

新增可选 props：

```ts
overwritePrefill?: {
  requestId: string
  prefill: EditOverwriteRulePrefill | EditOverwriteSkillPrefill
}
```

行为：

- 当 `detail` 加载完成且 `overwritePrefill` 存在且 `requestId` 未消费过时：
  - `setIsEditOpen(true)`
  - 在 `renderCreateDialog` 的 `initialValue` 上覆写：
    - Rule：覆写 `content`
    - Skill：覆写 `content` 和 `files`
- 消费后清空内部记录的 `requestId`，避免重复注入。

容器在切换内容时清理 prefill。

## 实现概览

### renderer 改动

`desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`

- 新增 `canPublishToRepo = item.source === "synapse" && Boolean(item.synapseContentId)`。
- 在操作菜单里 `重新安装` 后插入 `发布到仓库`。仅在 `canPublishToRepo` 时显示。
- 新增 `isPublishChoiceOpen` 状态控制选择弹窗。
- 新增 `handlePublishOverwrite()`：调 `prepareQuickPublishDraft` → 构造 `kind: "edit-overwrite"` 请求 → `requestOpenContentEditOverwrite` → 关闭扫描详情。
- 新增 `handlePublishAsNewFromChoice()`：直接调用现有 `publishAsNew()`。
- `quickPublishError` 复用展示逻辑。

`desktop/src/app-shell/content-navigation.ts`

- 扩展 `ContentOpenRequest` 联合类型。
- 导出 `requestOpenContentEditOverwrite`。

`desktop/src/modules/content/components/content-detail-dialog.tsx`

- 新增 `overwritePrefill` prop。
- 在 detail 加载完成的 effect 里消费 `overwritePrefill`，进入编辑态。
- 在 `renderCreateDialog` 调用处对 `initialValue` 做合并（仅在有未消费 prefill 时）。
- Rule / Skill 的合并逻辑分别在两边的 `buildInitialValue` 调用处实现，避免污染容器层。

容器层（订阅 `subscribeContentOpenRequest` 的地方）

- 处理 `kind: "edit-overwrite"`：等同于 `kind: "detail"` 打开内容，再把 `prefill` 传给 `ContentDetailDialog`。

### 主进程改动

无。`prepareQuickPublishDraft`、`updateContent` 已具备覆盖路径所需的全部能力。

## 日志

新增结构化日志（沿用 `createRendererLogger("editor-scan")`）：

- `Publish-to-repo choice opened.` —— 菜单触发，字段 `editorId`、`scope`、`itemType`、`synapseContentId`。
- `Publish-to-repo overwrite dispatched.` —— 派发 `edit-overwrite`，字段同上 + `requestId`。
- `Publish-to-repo overwrite fallback.` —— 链接失效降级到新建，字段同上 + `reason`。
- `Publish-to-repo publish-as-new chosen.` —— 用户主动选新建，字段同上。

错误用 `logger.error` / `logger.warn` 沿用现有风格。

## 测试计划

renderer 单测：

- Synapse 安装的 Skill 在菜单里出现 `发布到仓库`，外部 Skill 不出现。
- Synapse 安装的 Rule 在菜单里出现 `发布到仓库`，外部 Rule 不出现。
- 点击 `发布到仓库` 打开选择弹窗，标题与描述按 `item.type` 渲染正确文案。
- 选 `覆盖现有内容` 调用 `prepareQuickPublishDraft`，派发 `kind: "edit-overwrite"`，关闭扫描详情。
- 选 `发布为新内容` 调用现有 `publishAsNew` 路径。
- `prepareQuickPublishDraft` 抛错时弹窗保持打开，错误显示在 `Alert` 中。

`ContentDetailDialog` 单测：

- 接到 `overwritePrefill` 且 `detail` 已加载时自动进入编辑态。
- Rule 表单初始值的 `content` 被本地版本覆写，其它字段保留仓库现值。
- Skill 表单初始值的 `content` 和 `files` 被本地版本完全镜像。
- `requestId` 相同时只消费一次。
- 切换到另一条内容时不残留上一条的 prefill。

降级路径单测：

- `readDetail` 抛错时进入 `fallbackReason` 流程并能跳转到新建。
- `detail.deleted === true` 时同上。

## 实现边界

- 不新增依赖。
- 不启动开发服务器或浏览器验证，留给用户运行。
- 不引入 diff 预览。
- 不做静默覆盖。
- 不改外部条目主操作标签。
- 不改主进程能力，纯 renderer / 共享层改造。
- UI 使用现有 shadcn `DropdownMenu`、`AlertDialog`、`Button`、`Alert`。
- 不写自定义颜色、自定义样式或内联 style。

## 验收标准

- Synapse 安装的 Skill 和 Rule 在扫描详情菜单里都有 `发布到仓库`。
- 外部条目菜单保持原样。
- 选 `覆盖现有内容` 后跳进该仓库内容的详情编辑态，body 是本地版本，其它字段是仓库现值；Skill 附件等于本地目录里的文件。
- 选 `发布为新内容` 后进入新建对话框，行为与现有 `导入到仓库` 一致。
- 链接的仓库内容已删除时降级到新建路径并提示原因。
- 草稿读取失败时用户能在扫描详情看到明确错误。
- 覆盖保存沿用既有冲突处理与推送链路，无需新主进程能力。
