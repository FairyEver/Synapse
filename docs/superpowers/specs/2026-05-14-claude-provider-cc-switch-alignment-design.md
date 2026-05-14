# Claude Provider cc-switch Alignment Design

## Goal

Align Synapse's Claude provider configuration with the core cc-switch provider experience.

The first pass only covers Claude providers. It excludes unified providers, usage query, speed testing, health testing, endpoint benchmarking, and model test panels.

## Current State

Synapse currently exposes Claude providers as a table with add/edit dialogs. The backend provider service can store core Claude env values and extra env values, but the renderer and IPC create/update schemas only pass the core fields today.

cc-switch exposes provider configuration as a continuous form with preset chips at the top, provider identity fields, API Key and request URL fields, advanced model/API fields, and a JSON config editor.

## Chosen Direction

Use a hybrid inline editor.

Keep a lightweight provider selector/management area so users can still switch among multiple Synapse providers. Replace the high-frequency edit experience with a cc-switch-style inline form for the selected provider.

## UI Shape

The Claude provider settings panel will contain:

1. A compact provider selector with active provider state and actions to add, delete, and set default.
2. A preset chip area for supported Claude provider presets, including a custom configuration option.
3. Core fields:
   - provider name
   - note
   - website URL
   - API Key
   - request URL
4. Advanced fields in a collapsible section:
   - API key env field
   - default model
   - Haiku model
   - Sonnet model
   - Opus model
   - sort order if still needed by provider management
5. A JSON config editor focused on provider config:
   - `env`
   - `hooks`
   - `permissions`

The UI must use existing Synapse shadcn/Radix components and theme tokens. Do not copy cc-switch hard-coded colors, gradients, inline styles, or custom CSS.

## Preset Alignment

Sync the Claude provider presets with the supplied cc-switch source where Synapse can support the preset with the current runtime.

Expected preset changes include:

- update DeepSeek model defaults to cc-switch values
- add Baidu Qianfan Coding Plan
- add Compshare Coding Plan
- align Kimi For Coding website URL
- keep filtering unsupported OAuth or non-anthropic API format presets unless Synapse runtime support is explicitly added

Preset environment values must be the source of truth for generated form defaults.

## Data Flow

Provider form state will be derived from:

- selected existing provider, when editing
- selected preset defaults, when creating
- manual custom values, when the custom preset is selected

The JSON config editor will parse and serialize provider configuration. Core values remain visible in dedicated fields, and extra supported config values must round-trip through the provider service rather than being silently dropped.

Renderer, bridge types, IPC schemas, and provider service calls must support `env` for create/update. Secret values in `env` should continue to use the existing `secretEnv` path when they are not the main provider API key.

## Validation And Errors

Hard validation:

- provider id is required for create
- provider name is required
- JSON config must parse before save

Soft behavior:

- API Key may be blank for edits to preserve the existing secret
- unsupported presets remain hidden from the preset list
- readonly local Claude provider can be selected and inspected, but not edited

Errors should use existing renderer logging and concise toast copy. Do not surface raw secrets or exception messages in UI.

## Tests

Add or update focused tests for:

- preset list includes newly aligned supported cc-switch presets
- preset adapter maps the new presets and DeepSeek defaults correctly
- renderer create/update sends extra `env` from JSON config
- invalid JSON blocks save and shows concise error copy
- readonly local provider does not enter editable state

Verification commands:

```bash
pnpm --filter @synapse/desktop run test -- provider
pnpm --filter @synapse/desktop run check:hard-constraints
```

Do not start a development server or browser preview for verification unless explicitly requested.
