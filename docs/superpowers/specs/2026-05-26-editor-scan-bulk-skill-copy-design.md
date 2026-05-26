# 本机 Skill 批量复制设计

日期：2026-05-26

## 背景

本机扫描页已经能识别各编辑器中已安装的 Rule 和 Skill。用户可以打开单个扫描项详情，并通过“复制到其它编辑器”把一个 Skill 复制到另一个编辑器。

当前缺口是批量同步。用户在多个编辑器之间来回切换时，经常需要让一组 Skill 保持一致。如果只能逐个打开详情再复制，操作成本很高。

## 目标

1. 在本机扫描页的 Skill 列表中支持多选。
2. 用户可以把当前页选中的多个 Skill 批量复制到另一个编辑器。
3. 复制前先预检目标位置，汇总可复制项、覆盖项和不可用项。
4. 如果存在覆盖项，用户一次确认后再执行。
5. 尽量复用现有单个复制流程的目标选择、目标解析、写入逻辑、安全检查和错误处理。

## 非目标

- 不支持 Rule 批量复制。
- 不支持内容仓库中的 Skill 批量安装或复制。
- 不做跨设备同步。
- 不做后台自动同步。
- 不新增主进程批量复制事务。
- 不改变现有单个扫描项详情的复制入口和行为。
- 不引入新的组件库、主题、颜色或自定义视觉风格。

## 范围

多选只在当前上下文生效：

- 当前选中的编辑器。
- 当前 `Skill` tab。
- 当前范围 tab：全局或项目。

切换编辑器、切换 Skill / Rule、切换全局 / 项目、刷新扫描结果后清空选择。这样避免用户误以为能同时处理多个来源和多个范围的 Skill。

项目范围下，多选覆盖当前项目列表中可见的 Skill。复制目标仍由用户在批量复制弹窗中选择，可以是全局或某个项目。

## 用户体验

### 列表多选

在 Skill 列表卡片上增加轻量选择控件：

- 每个 Skill 卡片显示 `Checkbox`。
- 点击 checkbox 只切换选中状态，不打开详情。
- 点击卡片主体仍打开详情。
- Rule 列表不显示 checkbox。
- 空态和加载态不显示批量操作。

顶部工具栏在有选中项时显示：

- `已选 N 个`
- `取消选择`
- `复制到...`

`复制到...` 打开批量复制弹窗。

### 批量复制弹窗

弹窗分两步，但不需要做成复杂向导。

第一步选择目标编辑器：

- 复用单个复制弹窗的编辑器列表样式。
- 仅显示支持 Skill 的编辑器。

第二步选择目标范围：

- 复用 `EditorWriteTargetSelector`。
- 用户选择全局或项目目标。
- 目标改变后自动重新预检选中的 Skill。

预检区域显示摘要：

- `可复制 N 个`
- `将覆盖 N 个`
- `不可用 N 个`

如果有覆盖项，显示紧凑列表，列出 Skill 名称和目标路径。用户点击 `复制并覆盖` 后才执行。

如果没有覆盖项，主按钮为 `复制`。

不可用项默认跳过，保留在结果中展示，不阻断其它 Skill。

### 结果反馈

执行完成后：

- 全部成功：toast `已复制 N 个 Skill`，关闭弹窗并刷新扫描结果。
- 部分成功：toast `已复制 X/Y 个 Skill`，弹窗保留结果摘要和失败项。
- 全部失败：toast `复制失败`，弹窗保留失败项。
- 刷新失败：复制结果保留，提示 `复制完成，刷新失败`。

## 架构

### 复用现有能力

批量复制复用现有单个复制链路：

- `useEditorAdaptersForContentType({ contentType: "skill" })`
- `EditorWriteTargetSelector`
- `resolveEditorCopyTarget(payload)`
- `copyToEditor(payload)`
- `editor-copy-service.copy(...)`

不新增主进程批量复制 IPC。写入仍逐个调用现有 IPC，因此继续复用当前的：

- 同路径保护。
- 覆盖检查。
- `PermissionGuard` 写入权限检查。
- `AuditSink` 审计记录。
- Skill 目录替换逻辑。
- 编辑器 adapter 目标解析逻辑。

### 新增 renderer 组件

新增：

- `desktop/src/modules/editor-scan/components/editor-bulk-skill-copy-dialog.tsx`

职责：

- 接收选中的扫描 Skill。
- 加载可用目标编辑器。
- 管理目标编辑器和目标范围选择。
- 调用预检。
- 汇总预检和执行结果。
- 调用现有 `copyToEditor` 顺序执行。

新增：

- `desktop/src/modules/editor-scan/lib/editor-copy-source.ts`

职责：

- 从 `ScanItemForDetail` 或批量列表项构建 `SynapseEditorCopySource`。
- 被 `EditorCopyDialog` 和批量复制弹窗共同使用。

新增：

- `desktop/src/modules/editor-scan/lib/bulk-skill-copy.ts`

职责：

- 纯函数处理预检结果归类。
- 生成执行队列。
- 计算结果摘要。

### 现有组件调整

`EditorScanModule`：

- 管理当前上下文下的 `selectedSkillKeys`。
- 构建选中的 Skill copy items。
- 切换编辑器、tab、scope 或刷新后清空选择。
- 挂载 `EditorBulkSkillCopyDialog`。

`GlobalOverview`：

- Skill 模式接收选择状态和选择回调。
- 把选择 props 传给 `ScanItemCard`。

`ProjectOverview`：

- Skill 模式接收选择状态和选择回调。
- 项目 Skill 的 selection key 包含项目路径，避免不同项目中同名或同路径展示冲突。

`ScanItemCard`：

- 支持可选 checkbox。
- checkbox 事件阻止冒泡。
- 选中态使用现有 token 和 shadcn/Radix 基线，不新增颜色。

`EditorCopyDialog`：

- 将内部 `createCopySource` 改为使用 `editor-copy-source.ts` helper。
- 单个复制行为不变。

## 数据模型

批量列表项使用 renderer 内部类型：

```ts
type EditorScanSkillCopyItem = {
  key: string
  name: string
  path: string
  source: EditorScanItemSource
  preview: string
  fileCount: number
  synapseContentId: string | null
  editorId: SynapseEditorId
  editorLabel: string
  scope: EditorScanScope
  projectName?: string
  projectPath?: string
  trash: EditorScanTrashInfo
}
```

预检结果：

```ts
type BulkSkillCopyPreflightItem =
  | {
      status: "ready"
      item: EditorScanSkillCopyItem
      source: SynapseEditorCopySource
      targetPath: string
      overwrite: false
    }
  | {
      status: "overwrite"
      item: EditorScanSkillCopyItem
      source: SynapseEditorCopySource
      targetPath: string
      overwrite: true
    }
  | {
      status: "unavailable"
      item: EditorScanSkillCopyItem
      source: SynapseEditorCopySource
      message: string
    }
```

执行结果：

```ts
type BulkSkillCopyResultItem =
  | { status: "copied"; item: EditorScanSkillCopyItem; targetPath: string; overwritten: boolean }
  | { status: "failed"; item: EditorScanSkillCopyItem; message: string }
  | { status: "skipped"; item: EditorScanSkillCopyItem; message: string }
```

## 预检规则

目标选择完成后，对每个 source 调用 `resolveEditorCopyTarget`：

- `ready` 且 `targetExists === false`：归类为 `ready`。
- `ready` 且 `targetExists === true`：归类为 `overwrite`。
- `unavailable`、`unsupported` 或其它非 ready 状态：归类为 `unavailable`。
- 调用抛错：归类为 `unavailable`，message 使用错误信息。

`editor-copy-service` 目前会把 Skill conflict 归一成 `ready + targetExists=true`，批量复制中统一当作覆盖项处理。

## 执行规则

用户确认后顺序执行，不并发写文件：

1. 跳过 `unavailable` 项。
2. 对 `ready` 项调用 `copyToEditor`，不传 `overwriteConfirmed`。
3. 对 `overwrite` 项调用 `copyToEditor`，传 `overwriteConfirmed: true`。
4. 单项失败记录为 `failed`，不中断后续项。
5. 批量结束后刷新扫描结果。

目标编辑器不需要过滤当前来源编辑器，因为以下场景是有效的：

- 同一编辑器全局 Skill 复制到项目范围。
- 同一编辑器项目 Skill 复制到全局范围。
- 同一编辑器不同项目之间复制。

如果源路径和目标路径相同，现有服务会在预检中返回不可用。

## UI 规范

必须遵守当前 shadcn/Radix 基线：

- 使用 `Checkbox`、`Button`、`Dialog`、`AlertDialog`、`Badge`、`ScrollArea`、`Tabs` 等现有组件。
- 使用 token 类：`bg-card`、`bg-muted`、`text-foreground`、`text-muted-foreground`、`border-border`。
- 不使用内联 style。
- 不使用 hex/rgb/hsl 字面颜色。
- 不写渐变、glow、营销文案、emoji heading。
- 不做卡片套卡片。

UI 文案只保留必要操作、状态和错误：

- `复制到...`
- `已选 N 个`
- `取消选择`
- `将覆盖 N 个 Skill`
- `复制并覆盖`
- `已复制 X/Y 个 Skill`

## 错误处理

- 预检失败不逐个弹 toast，统一显示在预检结果中。
- 覆盖确认取消后不执行任何复制。
- 执行中单项失败不阻断其它项。
- 扫描刷新失败不改变复制结果，记录日志并显示短提示。
- 所有 catch 必须处理或记录结构化日志，不允许空 catch。
- 日志不记录 Skill 正文、附件内容、secret 或 token。

## 测试策略

单元测试：

- `editor-copy-source`：Skill 扫描项能生成正确 `SynapseEditorCopySource`。
- `bulk-skill-copy`：能把预检结果归类为 ready、overwrite、unavailable。
- `bulk-skill-copy`：执行队列对 overwrite 项传 `overwriteConfirmed: true`。
- `bulk-skill-copy`：单项失败不中断后续项。

组件测试：

- Skill 页显示 checkbox 和批量按钮。
- Rule 页不显示 checkbox 和批量按钮。
- 点击 checkbox 不打开详情。
- 切换编辑器、tab、scope 后清空选择。
- 有覆盖项时显示一次覆盖确认。
- 部分失败时显示结果摘要。

回归验证：

- `pnpm --filter @synapse/desktop run typecheck`
- `pnpm --filter @synapse/desktop run test -- editor-scan`
- `pnpm --filter @synapse/desktop run check:hard-constraints`

## 发布说明

本次改动是用户可感知功能，需要更新根目录 `RELEASE_NOTES_PENDING.md`。

建议文案：

```md
- 本机 Skill 扫描页支持多选后批量复制到其它编辑器，复制前会汇总覆盖项，适合在多个编辑器之间同步 Skill。
```

## 成功标准

- 用户能在本机扫描页 Skill 列表多选多个 Skill。
- 用户能一次选择目标编辑器和目标范围。
- 复制前能看到覆盖项汇总，并一次确认。
- 不可用项会跳过并显示结果，不阻断可复制项。
- 单个复制入口行为保持不变。
- 写入逻辑继续走现有 `copyToEditor` IPC 和主进程安全检查。
- 实现不违反当前 UI、文案和工程约束。
