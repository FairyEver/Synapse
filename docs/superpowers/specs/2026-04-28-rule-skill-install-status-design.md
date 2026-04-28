# Rule / Skill 安装状态与写入流程设计

## 背景

Synapse 已经支持三类相关动作：

- 从内容库把 Rule / Skill 安装到 Codex、Claude Code、Cursor、Windsurf。
- 扫描本机编辑器中的 Rule / Skill。
- 从 IDE 扫描详情把单条 Rule / Skill 复制到另一个编辑器目标。

当前缺口是闭环。用户执行安装或复制后，只能从 toast 看到目标路径，无法在内容详情页直接判断这个内容已经安装到哪些编辑器、目标是否冲突、是否需要更新。另一个问题是“复制到编辑器”流程里仍显示“安装到”“安装失败”等文案，动作语义不清。

本设计覆盖第一阶段 A+B：

- A：安装状态与验证闭环。
- B：安装 / 复制语义统一，并补强写入安全。

## 目标

1. Rule / Skill 详情页展示安装状态，让用户打开内容后能看到当前内容在各编辑器中的落点。
2. 安装和复制共用目标选择与写入流程，但用户界面中的动作词保持准确。
3. 安装或复制完成后刷新扫描结果，详情页状态随之更新。
4. 写入编辑器目录、覆盖、替换、备份失败等敏感路径有明确确认、失败处理和审计记录。

## 非目标

- 不做多选批量分发矩阵。
- 不做跨设备同步。
- 不检测编辑器运行时是否已经重新加载或实际生效。
- 不重做内容库、IDE 扫描页或编辑器适配器的整体视觉系统。
- 不引入新的组件库、主题色或自定义视觉风格。

## 现有落点

- 内容详情弹窗：`desktop/src/modules/content/components/content-detail-dialog.tsx`
- 内容详情主体：`desktop/src/modules/content/components/content-detail-panel.tsx`
- 内容安装弹窗：`desktop/src/modules/content/components/content-install-dialog.tsx`
- 目标选择器：`desktop/src/modules/content/components/editor-install-target-selector.tsx`
- IDE 扫描页：`desktop/src/modules/editor-scan/index.tsx`
- IDE 扫描详情：`desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`
- 编辑器复制弹窗：`desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx`
- 编辑器扫描服务：`desktop/electron/services/editor-scan-service.ts`
- 编辑器目标解析：`desktop/electron/services/editor-adapter-service.ts`
- 内容安装服务：`desktop/electron/services/content-install-service.ts`
- 编辑器复制服务：`desktop/electron/services/editor-copy-service.ts`
- 写入工具：`desktop/electron/services/editor-file-write-utils.ts`
- 权限与审计：`desktop/electron/runtime/security/`

## 用户体验

### 安装状态面板

在 Rule / Skill 的内容详情弹窗中，标题信息区和预览区域之间增加一个紧凑的“安装状态”区。

显示规则：

- 仅 Rule / Skill 显示，Prompt 不显示。
- 默认展示摘要，不占用大块阅读空间。
- 按编辑器分组展示 Codex、Claude Code、Cursor、Windsurf。
- 每个编辑器展示全局和项目两个目标。项目目标来自 Synapse 配置中的项目目录。
- 展开某一项后显示目标路径和可执行操作。

状态枚举：

- `未安装`：目标可解析，但扫描结果没有对应内容。
- `已安装`：扫描结果中存在同一个 Synapse 内容 ID。
- `需更新`：扫描结果中存在同一个 Synapse 内容 ID，但当前内容与目标内容的可比较正文不同。
- `外部同名`：目标文件名或 Skill 目录名与当前内容目标冲突，但没有 Synapse 标记。Codex / Windsurf 这类聚合 Rule 文件里存在其他手写内容时，不因为文件本身存在就标记为外部同名。
- `冲突`：目标解析返回同名 Skill 属于另一个内容 ID。
- `不支持`：编辑器适配器明确不支持该范围或内容类型，例如 Cursor 全局 Rule。
- `不可用`：路径不存在、编辑器目录不存在，或目标暂时无法解析。

操作：

- `安装`：未安装、不可用恢复后可安装的目标。
- `更新`：已安装但需更新的目标。
- `打开位置`：已有目标路径时可用。
- `刷新`：手动重新扫描并刷新状态。

文案保持克制。不要写功能介绍段落，不解释实现细节，不把“当前共 N 个目标”这类重复状态写进界面。

### 安装与复制语义

底层流程统一为：

```text
source -> target -> preview -> confirm -> write -> verify
```

界面动作词由来源决定：

- 内容库来源：`install`
  - 标题：`安装到 {editor}`
  - 主按钮：`安装`
  - 成功：`已安装到 {editor}`
  - 失败：`安装失败。`
  - 覆盖提示：`目标位置已有内容，安装后会被替换。`

- IDE 扫描来源：`copy`
  - 标题：`复制到 {editor}`
  - 主按钮：`复制`
  - 成功：`已复制到 {editor}`
  - 失败：`复制失败。`
  - 覆盖提示：`目标位置已有内容，复制后会被替换。`

目标选择、范围选择、项目路径选择、目标路径预览、冲突确认、写入后刷新可以共用；用户看到的标题、按钮、toast、错误文案不能混用。

## 数据与状态计算

### 状态来源

第一阶段不新增持久化数据库表。安装状态由以下来源即时计算：

1. `editorAdapterService.resolveTarget(...)` 返回目标能力、路径、冲突状态。
2. `editor-scan-service.scanAll()` 返回全局与项目扫描结果。
3. 内容详情提供当前内容 ID、类型、名称、正文与附件元信息。

新增主进程能力建议命名：

- `editorInstallStatus.resolveForContent(payload)`

输入：

```ts
type ResolveEditorInstallStatusPayload = {
  contentType: "rule" | "skill"
  contentId: string
  contentName?: string
  title?: string
  projectPaths: Array<{ id: string; name: string; path: string }>
}
```

输出：

```ts
type EditorInstallStatusEntry = {
  editorId: SynapseEditorId
  editorLabel: string
  scope: "global" | "project"
  projectId?: string
  projectName?: string
  status: "not_installed" | "installed" | "needs_update" | "external_same_name" | "conflict" | "unsupported" | "unavailable"
  targetPath: string | null
  message: string | null
}
```

### `需更新` 口径

第一版只做磁盘可回读的保守判断：

- Rule：扫描项能提供正文时，比较规范化后的扫描正文与当前内容正文。
- Skill：比较主 `SKILL.md` 的正文；附件差异第一版不作为 `需更新` 判定依据。
- 如果无法可靠读取正文，显示 `已安装`，不猜测 `需更新`。

后续可以给 Skill 的 `.synapse.json` 扩展 `fingerprint`，再把附件 hash 纳入状态。该扩展必须保持兼容：旧文件只有 `{ id }` 时仍可识别为 `已安装`。

## 架构

### 主进程

新增服务：

- `desktop/electron/services/editor-install-status-service.ts`

职责：

- 调用编辑器适配器解析目标。
- 调用扫描逻辑读取现有安装结果。
- 合并出每个编辑器 / 范围 / 项目的状态。
- 不负责写入，不负责 UI 文案。

安装与复制写入安全：

- `content-install-service.installToEditor(...)`
- `editor-copy-service.copy(...)`

这两个写入动作需要接入 `PermissionGuard` 和 `AuditSink`。为了避免扩大改动，可以在 IPC handler 中解析 `core.permission-guard` 和 `core.audit-sink`，传入服务方法的可选 deps：

```ts
type EditorWriteSecurityDeps = {
  actor: { kind: "user" }
  permissionGuard: PermissionGuard
  auditSink: AuditSink
}
```

写入前检查：

- action: `fs.write`
- resource: 目标路径
- metadata: contentType、contentId、editorId、scope、operation

审计记录：

- 成功：`outcome: "allowed"`
- 权限拒绝：`outcome: "denied"`
- 写入失败：`outcome: "failed"`

注意 metadata 不记录正文、prompt、secret、token。

### 备份与覆盖

当前 Skill 替换时，备份失败会 warn 后继续安装。第一阶段改为：

- 需要备份时，备份失败必须阻断替换。
- 替换失败时返回明确错误，不继续覆盖目标目录。
- 仍保留原子替换工具 `replaceDirectoryAtomically` 和 `replaceFileAtomically`。

覆盖确认规则：

- 覆盖已有目标文件或目录前必须弹确认。
- 同名 Skill 属于另一个内容 ID 时使用“替换”确认。
- 同一路径复制仍保持不可用，防止源目标相同。

### Renderer

新增模块内组件：

- `desktop/src/modules/content/components/editor-install-status-panel.tsx`

职责：

- 展示状态摘要。
- 展开显示路径和操作。
- 调用刷新。
- 从状态入口打开安装弹窗。

新增 hook：

- `desktop/src/modules/content/hooks/use-editor-install-status.ts`

职责：

- 在详情弹窗打开且内容类型为 Rule / Skill 时加载状态。
- 安装 / 复制完成后重新加载。
- 暴露 loading、error、entries、refresh。

目标选择器泛化：

- 将 `EditorInstallTargetSelector` 泛化为 `EditorWriteTargetSelector`。
- props 增加 `actionKind: "install" | "copy"` 或由父组件决定文案。
- 目标解析逻辑继续由父组件传入，不在选择器里知道来源。

流程状态抽取：

- 新增 `useEditorWriteFlow`，收敛安装和复制中重复的状态：
  - selectedEditor
  - target selection
  - activeTarget
  - busy state
  - overwrite confirm
  - conflict confirm
  - project rule form
  - error

`ContentInstallDialog` 和 `EditorCopyDialog` 保留薄 UI 壳，传入 actionKind、source、resolveTarget、executeWrite。

## UI 规范

必须使用现有 shadcn/Radix 基线：

- `Button`
- `Badge`
- `Collapsible` 或现有等价组件
- `Tabs`
- `AlertDialog`
- `Dialog`
- `Tooltip`

禁止：

- 自定义颜色、hex/rgb/hsl 字面色。
- 内联样式。
- 渐变、glow、营销式空文案。
- 卡片套卡片。

安装状态面板不做大号 hero，不写功能介绍，只保留标题、状态、路径和必要操作。

## 验证刷新

写入完成后：

1. 安装 / 复制服务返回目标路径和目标编辑器。
2. Renderer 关闭写入弹窗。
3. 触发 IDE 扫描刷新。
4. 触发安装状态面板刷新。
5. toast 只展示动作结果，不展示长路径；路径放在状态面板展开区。

推荐 toast：

- `已安装到 Codex`
- `已复制到 Claude Code`
- `目标已更新`

## 错误处理

需要区分：

- 目标不可用：显示目标解析返回的 message。
- 权限拒绝：`没有写入该位置的权限。`
- 备份失败：`备份旧 Skill 失败，未替换目标。`
- 覆盖取消：不显示错误。
- 扫描刷新失败：写入成功 toast 保留，同时状态面板显示 `刷新失败` 和 `重试`。

不允许空 `catch {}`。能恢复的错误记录结构化日志，不能恢复的错误向上抛出。

## 测试策略

主进程测试：

- status service 能合并 ready、unsupported、unavailable、conflict。
- Rule 通过 `synapseContentId` 匹配为已安装。
- Rule 正文不同且可比较时显示需更新。
- Skill `.synapse.json` 只有 id 时显示已安装。
- Skill 同名无 id 时显示外部同名。
- 备份失败时阻断替换。
- 写入成功 / 权限拒绝 / 写入失败记录 AuditSink。

Renderer 测试：

- 内容详情页 Rule / Skill 显示安装状态面板。
- Prompt 不显示安装状态面板。
- 安装流程显示安装文案。
- 复制流程显示复制文案。
- 写入成功后调用状态刷新。
- 状态面板错误时显示重试入口。

回归测试：

- `pnpm desktop:typecheck`
- `pnpm desktop:test`
- `pnpm desktop:check:hard-constraints`

## 成功标准

- 用户打开 Rule / Skill 详情页能看到各编辑器安装状态。
- 从内容库安装时，全链路只使用“安装”文案。
- 从 IDE 扫描复制时，全链路只使用“复制”文案。
- 写入后状态自动刷新。
- Skill 备份失败不会继续覆盖。
- 写入动作通过 PermissionGuard 和 AuditSink。
- 不引入新的视觉系统，不违反 shadcn/Radix 约束。
