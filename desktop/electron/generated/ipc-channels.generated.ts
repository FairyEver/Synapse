/**
 * AUTO-GENERATED FILE — DO NOT EDIT.
 * Source: scripts/generate-ipc.mjs
 * Run `pnpm --filter @synapse/desktop run generate:ipc` to regenerate.
 */

/* eslint-disable */

export const IPC_CHANNELS = {
  "content": {
    "list": "synapse:content:list",
    "getContent": "synapse:content:get-content",
    "getDetail": "synapse:content:get-detail",
    "getHistory": "synapse:content:get-history",
    "getHistoryVersion": "synapse:content:get-history-version",
    "getEditorAdapters": "synapse:content:get-editor-adapters",
    "create": "synapse:content:create",
    "update": "synapse:content:update",
    "deleteContent": "synapse:content:delete-content",
    "listDeleted": "synapse:content:list-deleted",
    "restore": "synapse:content:restore",
    "purge": "synapse:content:purge",
    "download": "synapse:content:download",
    "readIconImage": "synapse:content:read-icon-image",
    "openDetailWindow": "synapse:content:open-detail-window",
    "resolveEditorInstallTarget": "synapse:content:resolve-editor-install-target",
    "installToEditor": "synapse:content:install-to-editor",
    "readEditorInstallFormValues": "synapse:content:read-editor-install-form-values",
  },
  "cli": {
    "detect": "synapse:cli:detect",
  },
  "config": {
    "get": "synapse:config:get",
    "update": "synapse:config:update",
    "exportBackup": "synapse:config:export-backup",
    "importBackup": "synapse:config:import-backup",
    "previewLegacyCcConfigImport": "synapse:config:preview-legacy-cc-config-import",
    "resetApp": "synapse:config:reset-app",
  },
  "identity": {
    "getLocalState": "synapse:identity:get-local-state",
    "adoptExistingUserId": "synapse:identity:adopt-existing-user-id",
    "generateNewId": "synapse:identity:generate-new-id",
  },
  "user-profile": {
    "getRepoState": "synapse:user-profile:get-repo-state",
    "listRepoProfiles": "synapse:user-profile:list-repo-profiles",
    "updateDisplayName": "synapse:user-profile:update-display-name",
  },
  "log": {
    "write": "synapse:log:write",
    "export": "synapse:log:export",
    "clear": "synapse:log:clear",
    "readAll": "synapse:log:read-all",
    "listFiles": "synapse:log:list-files",
    "readFiles": "synapse:log:read-files",
  },
  "editor-scan": {
    "scanAll": "synapse:editor-scan:scan-all",
    "readItemContent": "synapse:editor-scan:read-item-content",
    "listSkillFiles": "synapse:editor-scan:list-skill-files",
  },
  "editor": {
    "getGlobalDirectories": "synapse:editor:get-global-directories",
    "createDirectory": "synapse:editor:create-directory",
  },
  "shell": {
    "showItemInFolder": "synapse:shell:show-item-in-folder",
  },
  "repository": {
    "getStates": "synapse:repository:get-states",
    "checkInitializationPreview": "synapse:repository:check-initialization-preview",
    "createLocalRepository": "synapse:repository:create-local-repository",
    "getPendingPushes": "synapse:repository:get-pending-pushes",
    "initializeStructure": "synapse:repository:initialize-structure",
    "chooseDirectory": "synapse:repository:choose-directory",
    "validateDirectory": "synapse:repository:validate-directory",
    "sync": "synapse:repository:sync",
    "runMaintenance": "synapse:repository:run-maintenance",
    "flushPendingPushes": "synapse:repository:flush-pending-pushes",
  },
  "update": {
    "getState": "synapse:update:get-state",
    "checkForUpdates": "synapse:update:check-for-updates",
    "cancelDownload": "synapse:update:cancel-download",
    "installUpdate": "synapse:update:install-update",
  },
  "connectors": {
    "listDescriptors": "synapse:connectors:list-descriptors",
    "createDraft": "synapse:connectors:create-draft",
    "normalizeInbound": "synapse:connectors:normalize-inbound",
  },
  "agent-sessions": {
    "list": "synapse:agent-sessions:list",
    "getDetail": "synapse:agent-sessions:get-detail",
    "create": "synapse:agent-sessions:create",
    "switchSession": "synapse:agent-sessions:switch",
    "listCommands": "synapse:agent-sessions:list-commands",
    "executeCommand": "synapse:agent-sessions:execute-command",
    "send": "synapse:agent-sessions:send",
    "respondPermission": "synapse:agent-sessions:respond-permission",
  },
} as const

export type IpcChannelMap = typeof IPC_CHANNELS
