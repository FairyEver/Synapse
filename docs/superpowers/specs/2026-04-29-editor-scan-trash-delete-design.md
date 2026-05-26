# IDE 本机内容移到废纸篓设计

## 背景

IDE 扫描页已经能展示本机各编辑器中的 Rule / Skill，并支持查看详情、导入到仓库、复制到其它编辑器。用户现在需要在同一个界面管理本机内容，包括把本机 Rule / Skill 移到系统废纸篓。

本功能的目标是提供安全、可恢复的单条删除能力。这里的删除语义是移到系统废纸篓，不做永久删除。

现状补充（2026-05-26）：本机 Skill 列表已扩展支持多选后批量移到系统废纸篓；批量执行逐条复用同一个 `trashItem` 安全边界。Rule 仍不支持批量删除，永久删除仍不支持。

## 现有代码落点

- IDE 扫描页：`desktop/src/modules/editor-scan/index.tsx`
- 扫描详情弹窗：`desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`
- 扫描数据与本地内容读取：`desktop/electron/services/editor-scan-service.ts`
- 扫描 IPC：`desktop/electron/modules/editor-scan/ipc.ts`
- Bridge 类型：`desktop/src/types/bridge.ts`
- 预加载暴露：`desktop/electron/preload.ts`
- 编辑器扫描策略：`desktop/src/definitions/editor/*/scan.ts`
- 共享 Rule 扫描：`desktop/src/definitions/editor/shared-rule-scanners.ts`

## 产品范围

本次只做单条移到废纸篓：

- 支持 Skill 目录。
- 支持独立 Rule 文件。
- 支持共享文件中有明确 Synapse 标记边界的 Rule 块。
- 支持 Synapse 来源和外部来源。
- 不支持批量删除。
- 不支持永久删除。
- 不在 Synapse 内置仓库或内容仓库中删除对应内容。
- 不删除共享文件中没有明确边界的外部手写 Rule。

## 用户体验

### 入口

只在扫描详情弹窗里提供删除入口。列表卡片不显示删除按钮。

详情弹窗底部右侧新增操作：

```text
移到废纸篓
```

用户需要先打开详情，看到名称、来源、类型、路径和内容预览后再执行删除。

### 可删除状态

可删除时按钮可用。

不可删除时按钮禁用，并通过 tooltip 提示原因：

```text
当前 Rule 没有明确边界，请在 Finder 中处理。
```

第一版不可删除的主要场景是：共享文件中的外部手写 Rule，没有 Synapse 标记块可定位。

### 确认弹窗

点击 `移到废纸篓` 后打开确认弹窗。

标题：

```text
移到废纸篓？
```

描述只保留必要信息：

- 当前名称。
- 当前路径。
- 可从系统废纸篓恢复。

按钮：

- 取消：`取消`
- 确认：`移到废纸篓`

### 成功与失败

成功后：

- 关闭确认弹窗。
- 关闭详情弹窗。
- 刷新扫描结果。
- toast 显示：

```text
已移到废纸篓
```

失败后：

- 保持详情弹窗打开。
- 显示主进程返回的简短错误。
- 不修改当前扫描状态，用户可以重试或在 Finder 中处理。

## 删除规则

### Skill

Skill 是目录。删除时把整个 Skill 目录移到系统废纸篓。

服务端执行前重新校验：

- 路径存在。
- 路径是目录。
- 当前路径仍能被识别为 Skill 目录。
- 不跟随 symlink。

### 独立 Rule 文件

独立 Rule 文件直接移到系统废纸篓。

适用场景包括：

- Claude Code / Cursor / Windsurf 项目规则目录中的单个规则文件。
- 其它扫描策略明确返回的单文件 Rule。

服务端执行前重新校验：

- 路径存在。
- 路径是文件。
- 文件扩展名符合该编辑器扫描策略识别的 Rule 文件。
- 不跟随 symlink。

### 共享文件 Rule 块

共享文件不移到废纸篓，因为同一个文件可能包含多个 Rule 或用户手写内容。

适用场景包括：

- Codex 的 `AGENTS.md`。
- Windsurf 全局 `global_rules.md`。

只有带明确 Synapse 标记的块允许删除：

```text
<!-- synapse-rule:<id>:begin -->
...
<!-- synapse-rule:<id>:end -->
```

删除时：

1. 读取共享文件。
2. 按 rule id 定位完整标记块。
3. 移除该块。
4. 原子写回共享文件。
5. 保留其它 Synapse 块和外部手写内容。

共享文件中的外部手写 Rule 没有稳定边界，第一版不删除。

## 类型与数据

扫描项需要带上删除能力信息，避免 renderer 自己猜路径语义。

新增类型：

```ts
type EditorScanTrashMode =
  | "path"
  | "rule-section"
  | "unsupported"

type EditorScanTrashInfo = {
  mode: EditorScanTrashMode
  disabledReason?: string
}
```

`EditorScanSkillItem`：

- `trash.mode` 固定为 `"path"`。

`EditorScanRuleItem`：

- 独立文件：`trash.mode = "path"`。
- Synapse 标记块：`trash.mode = "rule-section"`。
- 共享文件外部手写内容：`trash.mode = "unsupported"`。

Renderer 只根据 `trash` 决定按钮可用性和 tooltip。实际删除仍由主进程重新校验。

## IPC 与服务

在 `editor-scan` IPC module 中新增方法：

```ts
trashItem(payload: EditorScanTrashRequest): Promise<EditorScanTrashResult>
```

请求包含：

- `itemType`
- `itemName`
- `itemPath`
- `editorId`
- `scope`
- `source`
- `trash`
- `synapseContentId`

返回包含：

- `trashed: true`
- `mode`
- `path`

实现放在 `desktop/electron/services/editor-scan-service.ts` 或同模块内的小型 helper 中，保持扫描和本机扫描项操作的边界一致。

不要在 React 组件中直接调用文件系统。Renderer 只能通过 `window.synapse.editorScan.trashItem` 发起。

## 权限与审计

移到废纸篓属于本机文件写操作，主进程必须走安全边界：

- `PermissionGuard.check({ action: "fs.write" })`
- `AuditSink.record(...)`

审计 metadata：

- `operation: "trash"`
- `editorId`
- `scope`
- `contentType`
- `source`
- `trashMode`

权限拒绝时不执行删除，并返回：

```text
没有写入该位置的权限。
```

## 错误处理

主进程错误文案保持短句：

- 路径不存在：`目标不存在。`
- 路径类型不匹配：`目标类型不匹配。`
- 共享 Rule 无边界：`当前 Rule 没有明确边界，请在 Finder 中处理。`
- 文件不可写：沿用现有 `formatEditorWriteFailure` 的权限文案。

Renderer：

- 删除中禁用确认按钮。
- 删除失败显示错误。
- 删除成功后关闭弹窗并刷新。

## 测试计划

主进程测试：

- Skill 目录会调用废纸篓移动能力。
- 独立 Rule 文件会调用废纸篓移动能力。
- 共享文件中目标 Synapse 标记块会被移除。
- 共享文件中其它 Synapse 标记块和外部手写内容保留。
- 共享文件外部手写 Rule 被拒绝。
- 权限拒绝时不执行删除并记录 denied audit。
- 删除失败时记录 failed audit。
- 删除成功时记录 allowed audit。

Renderer 测试：

- 详情弹窗显示 `移到废纸篓`。
- `unsupported` 扫描项禁用删除按钮并显示原因。
- 点击删除会打开确认弹窗。
- 删除成功后调用刷新并关闭详情。
- 删除失败时显示错误并保留详情。

## 实现边界

- 不新增依赖。
- 不启动开发服务器或浏览器验证。
- 不做批量删除。
- 不做恢复入口。
- 不改列表卡片布局。
- 不改 Synapse 仓库内容删除逻辑。
- UI 使用现有 shadcn `Button`、`AlertDialog`、`Tooltip`、`Alert`。
- 不写自定义颜色、自定义样式或内联 style。

## 验收标准

- 用户可以从详情弹窗把 Skill 目录移到系统废纸篓。
- 用户可以从详情弹窗把独立 Rule 文件移到系统废纸篓。
- 用户可以从详情弹窗删除共享文件里的 Synapse 标记 Rule 块。
- 共享文件里的外部手写 Rule 不会被误删。
- 删除成功后扫描结果刷新。
- 删除失败时用户能看到明确错误。
- 删除操作经过权限检查和审计记录。
