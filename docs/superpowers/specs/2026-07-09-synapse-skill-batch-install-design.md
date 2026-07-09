# Synapse Skill 批量安装与更新设计

## 背景

当前 Synapse Skill 系统 App 只展示全局安装状态，并通过通用安装器进入单次安装流程。用户可以看到每个编辑器的状态，但不能直接打开目标目录，不能在某一行直接安装，也不能一键安装缺失项或更新已安装项。

这个能力不应只在 Synapse Skill 页面里实现。定向安装、批量安装、更新检测和结果汇总属于公共安装能力，Synapse Skill 页面只是第一个使用方。

## 目标

- 每个编辑器的 Skill 目标路径可点击，并通过系统文件管理器打开。
- 未安装的编辑器可以在当前行直接安装。
- 安装器支持传入明确的编辑器目标，跳过选择编辑器步骤。
- 安装器支持传入多个明确目标，顺序安装并返回逐项结果。
- Synapse Skill 包更新后，安装状态能显示 `需更新`，并支持一键批量更新。
- 公共能力可以被内容详情页、系统 App 和后续其它批量安装入口复用。

## 非目标

- 不新增独立安装任务系统，不做持久化队列和后台恢复。
- 不支持并发写入多个编辑器目录。批量安装按顺序执行，降低文件写入风险。
- 不把冲突和外部同名项目纳入默认一键批量操作。替换外部内容必须由用户单独确认。
- 不重写现有 `EditorInstallCore` 的安装细节。新增能力复用现有安全、审计、备份和原子替换逻辑。

## 公共类型

在 `desktop/src/types/installers.ts` 增加公共目标和批量结果类型：

```ts
export type SynapseInstallSourceTarget = {
  editorId: SynapseEditorId
  scope: SynapseEditorInstallScope
  projectPath?: string
}

export type SynapseInstallSourceToEditorTargetsPayload = {
  source: SynapseInstallerSource
  targets: SynapseInstallSourceTarget[]
  mode: "install" | "reinstall" | "update"
  overwriteConfirmed?: boolean
  replaceConfirmed?: boolean
  variableSubstitutions?: Record<string, string>
}

export type SynapseInstallSourceTargetResult = {
  target: SynapseInstallSourceTarget
  status: "installed" | "failed"
  result?: SynapseContentInstallResult
  error?: string
}

export type SynapseInstallSourceToEditorTargetsResult = {
  results: SynapseInstallSourceTargetResult[]
}
```

`mode` 用于日志、审计上下文和 UI 文案，不改变底层写入策略。真正是否允许覆盖仍由目标解析结果、`overwriteConfirmed`、`replaceConfirmed` 和现有 core 校验决定。

## 主进程安装服务

`EditorInstallService` 增加：

```ts
installSourceToEditorTargets(
  payload: SynapseInstallSourceToEditorTargetsPayload,
  security?: EditorWriteSecurityDeps,
): Promise<SynapseInstallSourceToEditorTargetsResult>
```

实现规则：

- 逐个 target 调用现有 `installSourceToEditor`。
- 每个 target 转换为单目标 payload：`editorId`、`scope`、`projectPath`、`source` 和确认参数保持一致。
- 单个失败不阻断后续目标，结果以 `failed` 返回。
- 空 targets 直接返回空结果。
- prepared source 的生命周期仍由单次安装管理。批量安装不绕过 `beginPreparedInstall`、`markPreparedInstalled`、`endPreparedInstall`。
- 批量结果中的错误文案使用现有格式化后的错误，不暴露堆栈或敏感路径上下文。

`desktop/electron/modules/installers/ipc.ts` 增加 IPC 方法：

- channel: `synapse:installers:install-source-to-editor-targets`
- bridge: `window.synapse.installers.installSourceToEditorTargets`
- renderer helper: `installSourceToEditorTargets`

安装成功后通知 install status refresh：

- repository source 继续按 `repositoryContentId` 通知。
- prepared Synapse Skill source 需要通知 `synapse-skill`。
- 如果替换了旧 content id，继续通知被替换 id。

## 定向安装 UI Flow

`SharedInstallerFlow` 已支持 `initialEditor`，可以跳过选择编辑器步骤。为状态行安装补齐使用方式：

- 从状态行传入 `initialEditor`。
- 从状态行传入 `initialSelection`，例如 `{ scope: "global" }` 或项目目标。
- flow 直接进入 `target` 步骤，仍展示目标位置确认、变量替换、冲突确认和覆盖确认。

这个 flow 用于单个行操作，例如“安装”“更新”“重新安装”。批量操作不走 `SharedInstallerFlow`，因为批量不需要用户逐个选择目标。

## Synapse Skill 版本与更新检测

prepared Synapse Skill 需要可比较的版本标识。新增 `sourceFingerprint`：

- 由 `skill-package` 内所有文件的相对路径、文件大小和内容 sha256 生成。
- 文件排序固定，确保同一包在不同平台得到相同 fingerprint。
- `prepareInstallSource()` 返回 `sourceFingerprint`。
- `synapseSkillInstallerSourceSchema`、公共 installer source 类型和 IPC schema 同步增加该可选字段。

安装时将 fingerprint 写入 Skill 身份元数据。复用当前 `.synapse.json` 身份文件，新增字段示例：

```json
{
  "id": "synapse-skill",
  "sourceFingerprint": "sha256:..."
}
```

`EditorScanSkillItem` 增加可选 `sourceFingerprint`。扫描 Skill 目录时读取该字段。

`SynapseResolveEditorInstallStatusPayload` 增加可选 `sourceFingerprint`。`EditorInstallStatusService.statusFromSkill` 规则调整：

- content id 不等价：`external_same_name`
- payload 和扫描项都有 fingerprint 且不同：`needs_update`
- payload 有 fingerprint，扫描项没有 fingerprint，且 content id 是 Synapse Skill：`needs_update`
- repositoryVersion 双方都有且不同：`needs_update`
- 其它同 id 情况：`installed`

这样旧版已安装 Synapse Skill 会在新版本上线后提示更新，用户可以通过一键更新补齐元数据。

## Synapse Skill 页面

页面保留系统 App 单任务工具布局，不新增营销说明。

列表行为：

- 每行显示编辑器图标、名称、目标路径和状态。
- `targetPath` 存在时路径可点击，调用 `shell.showItemInFolder(targetPath)`。
- `not_installed` 行显示“安装”。
- `needs_update` 行显示“更新”。
- `installed` 行提供“重新安装”，放在更多菜单中。
- `unsupported`、`unavailable` 显示状态和 message，不显示安装按钮。
- `conflict`、`external_same_name` 不进入一键批量操作，行级操作必须进入单目标 flow 并触发现有确认。

底部主按钮根据可批量处理状态变化：

- 同时有缺失和需更新：`安装并更新`
- 只有缺失：`安装缺失项`
- 只有需更新：`更新已安装项`
- 没有可处理目标：`全部已安装`

批量按钮只选择状态为 `not_installed` 或 `needs_update` 的全局目标。批量执行期间禁用刷新和行级动作，完成后刷新状态并显示结果 toast：

- 全部成功：`安装完成`
- 部分失败：`部分安装失败`
- 全部失败：`安装失败`

失败详情保留在列表状态和 toast description 中，不新增大段说明文案。

## 数据流

1. 页面加载 editor adapters。
2. 页面调用 `prepareInstallSource()`，得到 Synapse Skill source 和 `sourceFingerprint`。
3. 页面调用 `resolveEditorInstallStatus()`，payload 带 `sourceFingerprint`。
4. 用户点击行级操作时，进入 `SharedInstallerFlow`，传入明确 editor 和 selection。
5. 用户点击批量按钮时，页面构造 targets，调用 `installSourceToEditorTargets()`。
6. 主进程顺序安装每个目标，复用 `EditorInstallCore`。
7. 页面收到批量结果，刷新状态。

## 错误处理

- 状态读取失败显示短错误，并保留刷新按钮。
- 打开目录失败只 toast 错误，不改变安装状态。
- 单目标安装失败由 `SharedInstallerFlow` 显示现有错误。
- 批量安装单项失败不阻断其它项。
- 批量安装结果包含失败时，页面展示简短 toast，并保持用户可刷新状态。
- prepared source 不可用时，所有安装入口都显示“Synapse Skill 安装源不可用。”。

## 测试计划

主进程：

- `EditorInstallService.installSourceToEditorTargets` 顺序调用单目标安装并汇总结果。
- 单项失败不阻断后续目标。
- 批量 prepared source 安装仍调用 prepared provider 生命周期。
- IPC schema 接受 targets，拒绝空 editor id 和非法 scope。
- Synapse Skill fingerprint 不同返回 `needs_update`。
- 旧版 Synapse Skill 无 fingerprint 返回 `needs_update`。
- 非 Synapse Skill 且无 fingerprint 保持现有 installed 兼容逻辑。

Renderer：

- Synapse Skill 页面路径点击调用 `shell.showItemInFolder`。
- 未安装行点击安装时跳过编辑器选择。
- 需更新行点击更新时跳过编辑器选择。
- 批量按钮只包含 `not_installed` 和 `needs_update`。
- 批量安装成功后刷新状态。
- 部分失败时展示失败 toast。
- 全部已安装时主按钮不可执行。

回归：

- 现有内容详情安装状态面板不退化。
- 现有 `SharedInstallerFlow` 变量替换、覆盖确认、冲突确认测试继续通过。
- 打包校验确认 `synapse-skill` skill-package 文件仍进入 resources。

## 发布记录

实现完成后需要更新根目录 `RELEASE_NOTES_PENDING.md`，说明 Synapse Skill 支持按编辑器直接安装、打开目录、一键安装缺失项和更新已安装项。
