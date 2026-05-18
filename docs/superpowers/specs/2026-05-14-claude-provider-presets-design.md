# Claude Provider Presets Design

## Context

Synapse already has a Claude provider foundation in `desktop/electron/services/provider/`.
It supports global provider records, encrypted API key storage, active provider selection,
and runtime environment construction for Claude SDK sessions.

The requested source data is not in `/Users/liyang/Desktop/cc-connect-main/provider-presets.json`.
That file only contains a smaller cc-connect preset list. The screenshot matches
`/Users/liyang/Desktop/code-guide/cc-switch-main/src/config/claudeProviderPresets.ts`,
which contains the full Claude preset catalog.

## Goal

Bring the useful Claude provider preset catalog into Synapse with a source-data-first
design:

- Copy the cc-switch Claude preset source into Synapse as internal preset data.
- Preserve the meaningful provider configuration fields 1:1 where they apply.
- Add a Synapse adapter that converts presets into the existing `ProviderService`
  model instead of creating a parallel provider system.
- Keep secrets in the existing encrypted secret store.
- Add a restrained preset selection flow to the existing Provider settings panel.

## Non-Goals

The following cc-switch features are intentionally out of scope:

- Model test configuration.
- Pricing and usage configuration.
- Provider health checks, speed tests, and balance queries.
- Universal provider synchronization across Claude, Codex, and Gemini.
- OAuth or proxy-conversion providers that require cc-switch runtime behavior.
- Rebuilding cc-switch's proxy/router subsystem.

`GitHub Copilot` and `Codex` Claude presets are excluded for now because they depend
on OAuth and proxy conversion behavior that Synapse does not currently provide.

## Preset Data

Add a Synapse-owned source file under the provider service area, for example:

`desktop/electron/services/provider/claude-provider-presets.ts`

The source shape should stay close to cc-switch:

- `name`
- `nameKey`
- `websiteUrl`
- `apiKeyUrl`
- `settingsConfig`
- `category`
- `apiKeyField`
- `templateValues`
- `endpointCandidates`
- `apiFormat`
- `providerType`
- `requiresOAuth`

Visual-only fields such as custom icon colors can be kept in the source data when
already present, but Synapse UI should not use hard-coded colors from them. They are
metadata, not styling instructions.

## Supported Preset Filter

Only presets that Synapse can run through Claude SDK environment variables should be
shown as selectable by default.

Hidden or unsupported presets:

- `requiresOAuth === true`
- `providerType` is `github_copilot` or `codex_oauth`
- `apiFormat` is present and not `anthropic`, unless a Synapse-compatible adapter exists

This means `GitHub Copilot` and `Codex` are excluded immediately. Presets such as
`Gemini Native` and `Nvidia` should be treated as requiring a compatibility layer
before they become selectable, because cc-switch uses request transformation for
those formats.

## Adapter

Add a small adapter near `ProviderService`, for example:

`desktop/electron/services/provider/provider-preset-adapter.ts`

The adapter converts a Claude preset plus user-entered values into `CreateProviderInput`.

Mapping rules:

- `settingsConfig.env.ANTHROPIC_BASE_URL` -> `baseUrl`
- `settingsConfig.env.ANTHROPIC_MODEL` -> `model`
- `settingsConfig.env.ANTHROPIC_DEFAULT_HAIKU_MODEL` -> `haikuModel`
- `settingsConfig.env.ANTHROPIC_DEFAULT_SONNET_MODEL` -> `sonnetModel`
- `settingsConfig.env.ANTHROPIC_DEFAULT_OPUS_MODEL` -> `opusModel`
- `apiKeyField`, if present, chooses the secret target field
- otherwise use `ANTHROPIC_AUTH_TOKEN` when the env contains it, then `ANTHROPIC_API_KEY`
- remaining env values stay in `env`

Template variables are applied before mapping. For example, AWS Bedrock variables
replace `${AWS_REGION}`, `${AWS_ACCESS_KEY_ID}`, and `${AWS_SECRET_ACCESS_KEY}` in
the copied config.

## Service API

Extend the global provider service surface with read-only preset access:

- `listProviderPresets()`
- `createProviderFromPreset(input)`

`createProviderFromPreset(input)` should:

- validate that the preset exists and is supported;
- require the API key unless the preset has no key field;
- apply template variables;
- derive a stable provider id from the preset name, with conflict handling;
- write the API key through `ProviderSecretStore`;
- create the provider through the same internal path as manual providers.

Sensitive values must continue to go through the existing secret store and audit path.

## Renderer Flow

Update the existing settings Provider panel instead of adding a new page.

Add one secondary action near the existing add button:

- `从预设添加`

Opening it shows a searchable/selectable list of supported presets. Selecting a preset
opens the existing provider form with fields prefilled. The user supplies:

- API Key
- any required template variables
- optional name or sort order changes

The UI should use existing shadcn components and token classes. It should not copy
cc-switch colors, badges, gradients, or long marketing copy. Provider names, URLs,
and necessary labels are enough.

## Runtime Behavior

Runtime continues through the current path:

`ProviderService.buildEnv()` -> `AgentRuntimeSessionManager` -> `ClaudeSDKSession`

No renderer code writes Claude settings directly. No new direct IPC channels are added
outside the existing agent IPC module pattern.

## Error Handling

- Unsupported presets are not selectable.
- Missing required template variables block save with a short validation message.
- Duplicate provider ids are resolved deterministically, such as `packycode-2`.
- Secret storage failures surface as save failures and use existing audit/error paths.

## Verification

Implementation should be verified with focused tests:

- preset filtering excludes OAuth/proxy-only presets;
- preset adapter maps Anthropic env fields into `CreateProviderInput`;
- template variables are applied before provider creation;
- API keys are stored through `ProviderSecretStore`;
- `buildEnv()` returns the same Claude env shape expected by runtime;
- Provider settings UI can open the preset picker and prefill the form.

Run the relevant provider service and settings panel tests, then run the hard constraint
check before completion:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop test -- provider
```
