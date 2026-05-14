# CC Switch Claude Provider Import Design

## Goal

在「系统设置 → 智能体 → Claude 供应商」里增加从 CC Switch 导入 Claude provider 的能力。用户点击入口后，Synapse 扫描本机 CC Switch 配置，展示可导入项，让用户勾选后再导入。

第一版只导入 CC Switch 的 `claude` providers，不导入 `claude-desktop`、`codex`、`gemini`、`opencode`、`openclaw` 或 `hermes`。

## User Experience

入口放在 `Claude 供应商` 区块头部，靠近现有「新建」按钮：

- 主按钮保持「新建」。
- 新增次级按钮「从 CCS 导入」。
- 按钮使用现有 shadcn `Button`，不增加自定义颜色、渐变、内联样式或额外视觉系统。

点击后打开导入弹窗。弹窗遵循「扫描 -> 预览 -> 勾选导入」：

1. 扫描中：显示简短加载状态「正在扫描」。
2. 扫描成功且有结果：显示可勾选表格。
3. 没有结果：显示「未找到 CC Switch 配置」和「选择文件」兜底入口。
4. 扫描失败：显示「读取失败」和「重试」。
5. 导入完成：关闭弹窗、刷新 provider 列表、toast「已导入」。

表格列：

- 选择
- 名称
- 请求地址
- 模型
- Key 字段
- 状态

状态文案：

- `可导入`
- `已存在`
- `缺少 API Key`
- `无法识别`

默认只勾选 `可导入` 项。`已存在`、`缺少 API Key`、`无法识别` 项不可勾选，但保留在列表里，帮助用户理解扫描结果。

弹窗底部操作：

- `取消`
- `导入所选`

`导入所选` 在没有选中项或正在导入时禁用。

## Data Sources

CC Switch 当前主存储是 SQLite：

- 默认路径：`<home>/.cc-switch/cc-switch.db`
- 表：`providers`
- 关键字段：`id`、`app_type`、`name`、`settings_config`、`website_url`、`category`、`created_at`、`sort_index`、`notes`、`is_current`

兼容旧版 JSON：

- 默认路径：`<home>/.cc-switch/config.json`
- 只在 SQLite 文件不存在时尝试读取。

跨平台路径策略：

- macOS / Linux：使用 `os.homedir()` 拼接 `.cc-switch/cc-switch.db`。
- Windows：优先使用 `os.homedir()` 拼接 `.cc-switch/cc-switch.db`。
- Windows 兼容兜底：当默认路径不存在时，检测 `process.env.HOME/.cc-switch/cc-switch.db`。这是为了兼容 CC Switch 旧版本曾受 Git/MSYS/Cygwin 注入的 `HOME` 影响的情况。
- 路径全部使用 `path.join`，不拼接 `/` 或 `\` 字符串。

用户选择文件兜底：

- 允许选择 `cc-switch.db` 或旧版 `config.json`。
- 选择文件只作为读取来源，不修改原文件。
- 读取外部配置前经过 `PermissionGuard.check()`，并通过 `AuditSink` 记录结果。记录 metadata 时只包含路径、来源类型和数量，不记录 API Key。

## Import Mapping

只读取 `app_type = "claude"` 的 provider 行。

从 CC Switch `settings_config` 中提取：

- `env.ANTHROPIC_BASE_URL` -> Synapse `baseUrl`
- `env.ANTHROPIC_AUTH_TOKEN` -> Synapse `apiKey` + `apiKeyField = "ANTHROPIC_AUTH_TOKEN"`
- `env.ANTHROPIC_API_KEY` -> Synapse `apiKey` + `apiKeyField = "ANTHROPIC_API_KEY"`
- `env.ANTHROPIC_MODEL` -> Synapse `model`
- `env.ANTHROPIC_DEFAULT_HAIKU_MODEL` -> Synapse `haikuModel`
- `env.ANTHROPIC_DEFAULT_SONNET_MODEL` -> Synapse `sonnetModel`
- `env.ANTHROPIC_DEFAULT_OPUS_MODEL` -> Synapse `opusModel`

其他字段：

- `name` -> `name`
- `website_url` -> `websiteUrl`
- `category` -> Synapse 支持的 category；未知值回落为 `custom`
- `notes` -> `note`
- `sort_index` -> `sortIndex`

敏感数据处理：

- API Key 不进入 provider JSON。
- 导入时调用现有 `ProviderService.createProvider`，由 `ProviderSecretStore` 存入 encrypted secrets。
- 其他敏感 env key 如果未来需要支持，必须走 `secretEnv`，不直接写 `env`。

ID 规则：

- 先尝试使用 CC Switch provider `id`。
- 如果 Synapse 中已有同 ID provider，预览状态显示 `已存在`，默认不导入。
- 用户第一版不做覆盖、不做合并、不做重命名编辑。
- 重复项重命名导入不在第一版实现范围内。

## Architecture

新增 main-process service，不把文件读取或 SQLite 逻辑放进 React：

- `desktop/electron/services/provider/cc-switch-importer.ts`

职责：

- 解析默认候选路径。
- 从 SQLite 只读读取 `claude` providers。
- 从旧 JSON 兼容读取 `claude` providers。
- 转换为 Synapse provider import preview。
- 执行导入并复用 `ProviderService.createProvider`。
- 对默认路径和用户选择路径执行权限检查与审计。

Provider service 增加两个方法：

- `previewCcSwitchClaudeProviders(input?: { sourcePath?: string })`
- `importCcSwitchClaudeProviders(input: { providerIds: string[]; sourcePath?: string })`

IPC 增加两个方法，挂在现有 `agent` namespace：

- `synapse:agent:preview-cc-switch-claude-providers`
- `synapse:agent:import-cc-switch-claude-providers`

Preload / renderer bridge 增加对应类型方法：

- `agent.previewCcSwitchClaudeProviders(args?)`
- `agent.importCcSwitchClaudeProviders(args)`

Renderer 只负责 UI 状态和用户选择：

- `desktop/src/modules/settings/components/provider-panel.tsx`
- 新增 `desktop/src/modules/settings/components/cc-switch-import-dialog.tsx`，避免 `provider-panel.tsx` 继续膨胀。

## Result Types

Preview item:

```ts
type CcSwitchClaudeProviderPreview = {
  id: string
  name: string
  baseUrl?: string
  apiKeyField?: "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY"
  model?: string
  category: SynapseAgentProviderCategory
  status: "ready" | "duplicate" | "missing_api_key" | "unsupported"
  selectedByDefault: boolean
}
```

Preview result:

```ts
type CcSwitchClaudeProviderPreviewResult = {
  sourcePath?: string
  sourceKind?: "sqlite" | "json"
  items: CcSwitchClaudeProviderPreview[]
}
```

Import result:

```ts
type CcSwitchClaudeProviderImportResult = {
  imported: number
  skipped: number
  providers: SynapseAgentProvider[]
}
```

## Error Handling

Scanning:

- Missing file is not treated as a crash. Return empty result so UI can show the no-config state.
- Permission denial returns a controlled read error and logs an audit denial.
- Invalid SQLite schema returns a controlled read error.
- Invalid JSON returns a controlled read error.
- Locked database returns a controlled read error and does not retry in a loop.

Importing:

- If a selected provider becomes duplicate between preview and import, skip it.
- If selected provider no longer exists in source, skip it.
- If selected provider has no API Key, skip it.
- Partial success is allowed. UI shows a concise toast based on imported count.

Logging:

- Renderer logs sanitized metadata only.
- Main process logs path and counts, not API Key values.
- No `console.log` in production code.

## UI Quality Constraints

Follow Synapse shadcn/Radix baseline:

- Use existing `Dialog`, `Button`, `Table`, `Badge`, `Checkbox` if available.
- Use token classes such as `text-muted-foreground`, `border-border`, `bg-background`.
- No custom colors, hex/rgb/hsl literals, gradients, glow, card nesting, or inline styles.
- Keep copy terse. No feature-introduction paragraph.
- Align table actions right and keep numeric/count text compact.

Dialog copy must stay operational:

- Good: `未找到 CC Switch 配置`
- Good: `读取失败`
- Good: `导入所选`
- Avoid: long explanation of CC Switch internals inside the UI.

## Tests

Main process tests:

- Resolves default CC Switch paths for macOS/Linux/Windows-style inputs.
- Uses Windows `HOME` fallback only when default db is missing.
- Reads SQLite `providers` rows where `app_type = "claude"` only.
- Ignores non-Claude rows.
- Extracts API Key and model fields correctly.
- Marks duplicate provider IDs as `duplicate`.
- Rejects missing API Key as `missing_api_key`.
- Imports selected ready providers through `ProviderService.createProvider`.
- Does not persist API Key in provider namespace.

Renderer tests:

- Button appears next to `新建`.
- Opening dialog triggers preview.
- Ready rows are selected by default.
- Duplicate / missing-key rows are disabled.
- `导入所选` is disabled when nothing is selected.
- Successful import refreshes provider list and closes dialog.
- Errors show sanitized copy and log sanitized metadata.

Verification commands:

- `pnpm --filter @synapse/desktop run typecheck`
- `pnpm --filter @synapse/desktop run test -- provider`
- `pnpm --filter @synapse/desktop run check:hard-constraints`

No dev server, browser preview, Playwright session, or running Electron app is required for this feature unless explicitly requested.

## Out of Scope

- Importing CC Switch `codex`、`gemini`、`opencode`、`openclaw`、`hermes` providers.
- Importing Claude Desktop 3P providers.
- Writing back to CC Switch.
- Overwriting or merging existing Synapse providers.
- Editing imported values in the import preview.
- Importing CC Switch usage scripts, endpoint health, failover queues, MCP servers, prompts, or skills.
