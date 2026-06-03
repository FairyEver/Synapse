# Provider Package Share And Import Design

## Context

Synapse already has a Claude provider foundation in `desktop/electron/services/provider/`.
It supports user-created providers, preset creation, CC Switch import, encrypted secret
storage, active provider selection, reference protection, and runtime environment
construction for Claude SDK sessions.

Users need a way to share one complete provider configuration as a file and import it
on another Synapse installation. The exported file must include the provider secret so
the imported provider is usable immediately.

## Goal

Add single-provider package export and import for user providers.

- Export one user provider to a `Synapse Provider Package v1` JSON file.
- Include the API key and secret env values in the package.
- Import a package as a new user provider.
- If the source provider ID already exists, derive a new ID such as `deepseek-2`.
- Do not change the active/default provider after import.
- Keep renderer code out of file I/O and secret handling.

## Non-Goals

- No batch provider export or import.
- No clipboard share flow.
- No export for the built-in `local-claude-code` provider.
- No overwrite or merge mode for existing providers.
- No password protection or encryption for the exported package.
- No workflow/task reference migration during provider package import.
- No provider package repository or cloud sharing feature.

## UX

Update the existing `Claude 供应商` card in settings. Do not add a new page.

Header actions:

- `导入文件`
- `从 CCS 导入`
- `新建`

Row actions:

- Add `导出` for user providers.
- Hide `导出` for the built-in `本机 Claude Code` provider.

### Export Flow

The user clicks `导出` on a user provider row. Synapse opens a system save dialog with
the default filename:

`<provider-name>.synapse-provider.json`

If the user cancels, nothing is shown. If export succeeds, show:

`已导出供应商配置`

If export fails, show:

`导出失败`

No extra warning dialog is required for this version. The product requirement is that
the package includes secrets and can be imported directly.

### Import Flow

The user clicks `导入文件`. Synapse opens a system file picker that accepts:

- `.synapse-provider.json`
- `.json`

After selecting a file, Synapse builds an import preview before writing anything.
The preview dialog title is:

`导入供应商`

Preview fields:

- 名称
- 请求地址
- 模型
- Key 字段
- 导入后 ID

If the original ID conflicts, the preview shows the derived ID, for example:

`deepseek -> deepseek-2`

Dialog actions:

- `取消`
- `导入`

On success, close the dialog, refresh the provider list, and show:

`已导入供应商配置`

The imported provider is not set as active.

### UI Constraints

Use the existing shadcn/Radix baseline and current settings panel structure.

- Use existing `Button`, `Dialog`, `Table`, and row action patterns.
- Use normal `default` and `outline` button variants.
- Do not add custom colors, gradients, glow, inline styles, marketing copy, or nested cards.
- Keep copy operational and short.

## Package Format

The file is JSON with a stable top-level marker:

```json
{
  "kind": "synapse.provider.package",
  "version": 1,
  "exportedAt": "2026-06-03T00:00:00.000Z",
  "provider": {
    "id": "deepseek",
    "name": "DeepSeek",
    "category": "cn_official",
    "baseUrl": "https://api.deepseek.com",
    "apiKeyField": "ANTHROPIC_AUTH_TOKEN",
    "model": "deepseek-chat",
    "haikuModel": "deepseek-chat",
    "sonnetModel": "deepseek-reasoner",
    "opusModel": "deepseek-reasoner",
    "websiteUrl": "https://www.deepseek.com",
    "note": "",
    "settingsConfig": {},
    "env": {},
    "secretEnv": {}
  },
  "secrets": {
    "apiKey": "sk-...",
    "env": {}
  }
}
```

The package does not include local machine state:

- `active`
- `readonly`
- `source`
- `configured`
- `configPath`
- `archived`
- `sortIndex`
- `createdAt`
- `updatedAt`

`secrets.apiKey` and `secrets.env` are plaintext in the package. Import writes them
back through the existing `ProviderSecretStore`.

## Main Process Architecture

Add package import/export logic under the provider service boundary. Renderer code
only starts the action and displays the result.

Provider service methods:

- `exportProviderPackage(providerId, targetPath, context?)`
- `previewProviderPackageImport(sourcePath, context?)`
- `importProviderPackage(sourcePath, input?, context?)`

The service owns:

- provider lookup;
- secret reads;
- package validation;
- conflict-free target ID generation;
- secret writes through `createProvider`;
- permission checks and audit records for file reads/writes and secret access.

IPC methods remain under the existing `agent` namespace:

- `synapse:agent:export-provider-package`
- `synapse:agent:preview-provider-package-import`
- `synapse:agent:import-provider-package`
- `synapse:agent:choose-provider-package-import-source`

The save/open dialogs live in main-process IPC descriptors, matching the current CC
Switch import source picker pattern.

## Export Rules

1. Reject `local-claude-code`.
2. Load the provider by ID.
3. Read `secretRef` and `secretEnvRefs` through existing secret read permission and
   audit paths.
4. Build a v1 package with user-shareable provider fields and plaintext secrets.
5. Write the JSON package to the selected file path.
6. Audit the file write with path, provider ID, package kind, and version. Do not log
   secret values.

## Import Rules

Preview does not write data.

1. Read the selected file.
2. Parse JSON.
3. Require `kind === "synapse.provider.package"`.
4. Require `version === 1`.
5. Validate required provider fields:
   - `id`
   - `name`
   - `category`
   - `apiKeyField`
6. Require `secrets.apiKey`, because this version is direct-import only.
7. Reject packages that identify the provider as built-in/local.
8. Resolve a target ID. If the source ID exists, derive `id-2`, then `id-3`, and so on.
9. Return preview data including the original ID and target ID.

Import repeats validation from the selected file, then calls `createProvider` with:

- the resolved target ID;
- `active: false`;
- provider metadata from the package;
- `apiKey: secrets.apiKey`;
- `secretEnv: secrets.env`;
- normal `env` and `settingsConfig` from the package.

Imported providers are appended to the user provider list using the next available
sort index.

## Error Handling

Export:

- User cancels save dialog: return `null`.
- Built-in provider: `不支持导出内置供应商`.
- Missing provider: `供应商不存在`.
- Secret read failure: `供应商密钥读取失败`.
- File write failure: UI shows `导出失败`; structured logs keep sanitized context.

Import:

- User cancels file picker: return `null`.
- File read failure: `读取失败`.
- Invalid JSON or missing package marker: `无法识别该文件`.
- Unsupported version: `不支持的配置版本`.
- Missing required fields or missing API key: `配置不完整`.
- Built-in/local package: `不支持导入内置供应商`.
- Provider creation failure: no partial provider should remain. Existing secret rollback
  behavior in `createProvider` must still apply.

Logs and audit metadata must never include API key or secret env values.

## Types

Renderer-facing types should mirror the package preview rather than expose the full
secret-bearing package.

```ts
type SynapseProviderPackageImportPreview = {
  sourcePath: string
  packageVersion: 1
  sourceProviderId: string
  targetProviderId: string
  name: string
  category: SynapseAgentProviderCategory
  baseUrl?: string
  apiKeyField: SynapseAgentProviderApiKeyField
  model?: string
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
}

type SynapseProviderPackageImportResult = {
  provider: SynapseAgentProvider
}

type SynapseProviderPackageExportResult = {
  filePath: string
}
```

The plaintext package type should remain main-process/provider-service internal.

## Tests

Provider service tests:

- Exports a user provider with metadata, API key, and secret env values.
- Rejects export for `local-claude-code`.
- Does not include local-only fields in the package.
- Previews a valid package without writing a provider.
- Imports a valid package and stores secrets through the secret store.
- Derives `id-2` when the source provider ID already exists.
- Imports with `active: false`.
- Rejects unsupported versions.
- Rejects invalid JSON, missing required fields, missing API key, and local provider packages.
- Does not leave a partial provider when secret write or provider upsert fails.

IPC tests:

- Export dialog cancel returns `null`.
- Import file picker cancel returns `null`.
- Export/import methods call the provider service with renderer actor context.
- Response schemas do not expose plaintext secret values.

Renderer tests:

- Header shows `导入文件`.
- User provider rows show `导出`.
- Built-in provider rows do not show `导出`.
- Import preview displays name, base URL, model, key field, and target ID.
- Conflict preview displays the derived target ID.
- Successful import refreshes the provider list.

Verification commands:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop test -- provider
pnpm --filter @synapse/desktop test -- provider-panel
```
