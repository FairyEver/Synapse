# Agent Permission Default Implementation Plan

**Goal:** Prevent invalid runtime upgrades to `bypassPermissions` and add a
global Agent permission-mode default that uses the same dropdown option set as
the conversation composer.

**Architecture:** Store `agent.defaultPermissionMode` in the existing Synapse
config store, normalize missing values to `default`, migrate legacy
`defaultBypassPermissions: true` to `bypassPermissions`, and resolve the
effective mode when creating Agent sessions. The composer keeps runtime
capability handling separate from JSX through a small helper.

## File Map

- `desktop/src/types/config.ts`: Agent config type.
- `desktop/src/constants/defaults.ts`: default Agent permission mode.
- `desktop/src/lib/config.ts`: config normalization, patching, legacy migration.
- `desktop/electron/modules/config/ipc.ts`: config IPC response schema.
- `desktop/electron/modules/agent/ipc-sessions.ts`: create-session mode
  resolution.
- `desktop/electron/services/agent-runtime/*`: create-session mode persistence.
- `desktop/src/modules/agent/permission-mode-capability.ts`: runtime capability
  model.
- `desktop/src/modules/agent/permission-mode-options.ts`: shared dropdown
  labels, descriptions, and option order.
- `desktop/src/modules/agent/components/agent-composer.tsx`: bypass selection
  routes to a new-session dialog.
- `desktop/src/modules/settings/components/agent-defaults-panel.tsx`: settings
  dropdown for the global default.

## Tasks

- [x] Add `agent.defaultPermissionMode` config shape and defaults.
- [x] Normalize missing/invalid values and migrate the legacy bypass boolean.
- [x] Pass explicit or global default permission mode into Agent session
  creation.
- [x] Persist session-level `agentConfig.mode` during session creation.
- [x] Route live `bypassPermissions` selection to a new-session dialog.
- [x] Replace the settings switch with a permission-mode dropdown matching the
  composer option set.
- [x] Confirm only when selecting `bypassPermissions` as the global default.
- [x] Add focused tests for config, settings dropdown, composer behavior, and
  IPC mode resolution.

## Verification

- `pnpm --dir desktop exec vitest run src/lib/__tests__/config.test.ts src/modules/settings/components/__tests__/agent-defaults-panel.test.tsx src/modules/agent/__tests__/agent-composer.test.tsx electron/modules/config/__tests__/ipc.test.ts electron/services/__tests__/config-store.test.ts`
- `pnpm --dir desktop exec vitest run electron/modules/agent/__tests__/ipc.test.ts electron/modules/agent/__tests__/ipc-schema.test.ts -t "create-session|sets conversation permission mode|uses global default permission mode|lets explicit create-session mode"`
- `pnpm --dir desktop exec tsc -p tsconfig.json --noEmit && pnpm --dir desktop exec tsc -p tsconfig.electron.json --noEmit`
- `pnpm --filter @synapse/desktop run check:hard-constraints`
