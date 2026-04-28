# IDE 单条复制到编辑器设计

## 背景

用户同时使用多个编辑器，例如 Codex、Cursor、Claude Code、Windsurf。Rule / Skill 经常只安装在其中一个编辑器里，其他编辑器不会自动同步。

本功能的目标是让用户从 IDE 扫描详情页把单条 Rule 或 Skill 复制到另一个编辑器。这里的动作严格是复制，不是移动、删除或迁移。

## 现有代码落点

- IDE 扫描页：`desktop/src/modules/editor-scan/index.tsx`
- 扫描详情弹窗：`desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`
- 扫描数据与本地内容读取：`desktop/electron/services/editor-scan-service.ts`
- 编辑器安装目标解析：`desktop/electron/services/editor-adapter-service.ts`
- Synapse 仓库内容安装到编辑器：`desktop/electron/services/content-install-service.ts`
- 编辑器路径与格式适配：`desktop/src/ide-definitions/*`

当前代码已经能扫描本机各编辑器里的 Rule / Skill，也能把 Synapse 仓库内容安装到编辑器。缺口是：从扫描到的本地单条内容直接复制到另一个编辑器。

## 产品范围

本次只做单条复制：

- 支持从详情弹窗复制当前打开的 1 条 Rule 或 1 个 Skill。
- 不支持多选批量复制。
- 不删除源内容。
- 不修改源内容。
- 不要求先导入 Synapse 仓库。
- 不做跨设备云同步。

## 用户体验

### 入口

在扫描详情弹窗 footer 右侧新增按钮：

- `复制到编辑器`

该按钮与现有主按钮并列：

- 外部内容：`导入到仓库` + `复制到编辑器`
- 已关联 Synapse 内容：`查看仓库内容` + `复制到编辑器`

footer 左侧继续显示本地路径，不改变现有布局。

### 复制流程

点击 `复制到编辑器` 后先打开目标编辑器选择弹窗。这个弹窗把仓库内容“安装”下拉菜单里的编辑器选择改成弹窗形式，选择后进入与现有“安装到编辑器”一致的目标范围弹窗。

目标编辑器选择弹窗：

- 标题：`选择编辑器`
- 列表：支持当前 Rule / Skill 类型的编辑器
- 取消按钮：`取消`

目标范围弹窗复用现有安装弹窗 UI：

- 标题：`安装到 {editor}`
- 字段：`范围`
- 字段：`项目目录`，仅项目范围显示
- 区块：`目标位置`
- 取消按钮：`取消`
- 确认按钮：`安装`

目标编辑器允许选择当前来源的同一编辑器。全局到项目、项目到全局、项目 A 到项目 B 都允许。唯一禁止条件是解析后的目标路径与源路径完全相同。

范围使用现有安装语义：

- `全局`
- `项目`

如果目标编辑器不支持某个范围或内容类型，对应选项禁用。

### 覆盖策略

目标位置已有内容时，第一版采用覆盖目标。

确认弹窗：

- 标题：`覆盖目标？`
- 描述：`目标位置已有内容，复制后会被替换。`
- 取消按钮：`取消`
- 确认按钮：`覆盖`

确认后覆盖目标内容。源内容仍然不变。

### 成功与失败

成功提示：

- `已复制到 {editor}`

失败提示直接显示主进程返回的错误，例如：

- `目标位置不可写：{path}`
- `当前编辑器暂时不能复制到这个位置。`

复制成功后刷新 IDE 扫描结果。

## 行为规则

### Rule

Rule 复制不是裸拷贝文件，而是读取源内容后按目标编辑器的规则格式写入目标位置。

原因：

- Codex 和 Windsurf 的全局 Rule 可能写入单个聚合文件。
- Cursor 项目 Rule 使用 `.mdc` 和 frontmatter。
- Claude Code 项目 Rule 使用 `.md`，可带 `paths` frontmatter。

目标项目 Rule 需要元数据时，复用现有编辑器安装表单：

- Claude Code：`paths`
- Cursor：`description`、`globs`、`alwaysApply`
- Windsurf：`trigger`、`description`、`globs`

### Skill

Skill 复制按目录写入目标编辑器：

- 主文件统一写为 `SKILL.md`
- 保留可复制附件的相对路径
- 不复制 `.synapse.json`
- 跳过隐藏文件
- 跳过 symlink
- 拒绝敏感文件名和敏感扩展名
- 沿用现有附件大小限制

目标目录名使用源 Skill 的目录名，进入目标前仍走现有 skill name 规范化逻辑。

### 同一路径防护

如果解析出的目标路径与源路径完全相同，禁用复制并显示：

- `目标位置与源位置相同`

## 开发设计

### 新增服务

新增独立服务：

- `desktop/electron/services/editor-copy-service.ts`

不要把本地扫描项复制塞进 `content-install-service.ts`。后者当前假设来源是 Synapse 仓库内容；复制功能来源是本地编辑器扫描项，两者数据来源不同。

### 类型

新增类型文件：

- `desktop/src/types/editor-copy.ts`

核心类型：

```ts
type EditorCopySource = {
  itemType: "rule" | "skill"
  itemPath: string
  itemName: string
  editorId: SynapseEditorId
  scope: EditorScanScope
  content?: string
  metadata?: Record<string, string>
}

type EditorCopyPayload = {
  source: EditorCopySource
  targetEditorId: SynapseEditorId
  targetScope: SynapseEditorInstallScope
  targetProjectPath?: string
  installFormValues?: SynapseEditorInstallFormValues
  overwriteConfirmed?: boolean
}
```

返回结果包含：

- 目标编辑器
- 目标范围
- 内容类型
- 目标路径
- 是否覆盖

### IPC

新增 IPC module：

- `desktop/electron/modules/editor-copy/ipc.ts`

方法：

- `resolveTarget`
- `copy`

`resolveTarget` 用于弹窗中展示目标位置和是否存在。`copy` 执行实际写入。

### 复用能力

应复用：

- editor adapter 的目标路径解析能力
- editor install strategy 的 Rule 格式写入能力
- editor scan 的 Skill 主文件解析和附件收集规则
- 现有原子写入思路

如果现有 helper 只在 `content-install-service.ts` 内部，需要抽成小型共享 helper，保持改动最小。

### Renderer

新增组件：

- `desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx`
- `desktop/src/modules/content/components/editor-install-target-selector.tsx`

在 `ScanItemDetailDialog` 中维护打开状态并传入当前 item。`editor-copy-dialog` 只负责 IDE 扫描项复制流程：第一步选择编辑器，第二步复用公共目标范围选择器，最后接 `editorCopy.copy`。

现有 `ContentInstallDialog` 也改为复用 `EditorInstallTargetSelector`。这样全局 / 项目 / 项目目录 / 目标路径解析 / 目标位置展示只维护一套。

UI 使用现有 shadcn 组件：

- `Dialog`
- `Button`
- `Tabs`
- `Select`
- `Input`
- `Label`
- `AlertDialog`

不新增自定义样式，不写自定义颜色，不写内联 style。

## 验收标准

- 详情弹窗 footer 里出现 `复制到编辑器`。
- 点击后可以选择目标编辑器和范围。
- 项目范围可以选择或浏览项目目录。
- 目标位置已有内容时必须确认覆盖。
- 确认覆盖后目标内容被替换。
- 源内容不删除、不移动、不改写。
- Cursor 全局 Rule 不可选。
- 复制成功后刷新 IDE 扫描结果。
- UI 中不出现“转移”“迁移”“移动”作为该功能名称。
- 不新增自定义颜色、内联样式、CSS module 或全局 CSS。

## 测试设计

主进程测试：

- Rule 从 Codex 复制到 Claude Code 项目规则文件。
- Rule 从 Claude Code 复制到 Codex AGENTS.md，验证 section 覆盖。
- Skill 复制时保留附件相对路径。
- Skill 复制时不复制 `.synapse.json`。
- Skill 复制时拒绝敏感附件。
- 目标路径等于源路径时拒绝复制。
- 目标存在且未确认覆盖时返回冲突。
- 确认覆盖后替换目标。

Renderer 测试：

- `ScanItemDetailDialog` footer 包含 `复制到编辑器`。
- 复制弹窗目标存在时显示 `覆盖目标？`。
- 源内容主操作仍保留 `导入到仓库` 或 `查看仓库内容`。

## 风险与取舍

- 第一版只做单条复制，避免批量复制带来的部分成功、失败回滚和结果汇总复杂度。
- 覆盖目标符合“同步同一条配置”的使用目的，但必须弹窗确认。
- 不先导入仓库可以减少步骤，但复制后的目标内容不一定会变成 Synapse 仓库内容。
- Rule 需要按目标编辑器格式写入，不能简单复制源文件，否则容易生成目标编辑器不识别的内容。
