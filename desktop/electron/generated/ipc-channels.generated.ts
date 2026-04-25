/**
 * AUTO-GENERATED FILE — DO NOT EDIT.
 * Source: scripts/generate-ipc.mjs
 * Run `pnpm --filter @synapse/desktop run generate:ipc` to regenerate.
 */

/* eslint-disable */

export const IPC_CHANNELS = {
  "shell": {
    "showItemInFolder": "synapse:shell:show-item-in-folder",
  },
  "cli": {
    "detect": "synapse:cli:detect",
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
  "update": {
    "getState": "synapse:update:get-state",
    "checkForUpdates": "synapse:update:check-for-updates",
    "cancelDownload": "synapse:update:cancel-download",
    "installUpdate": "synapse:update:install-update",
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
  "config": {
    "get": "synapse:config:get",
    "update": "synapse:config:update",
    "exportBackup": "synapse:config:export-backup",
    "importBackup": "synapse:config:import-backup",
    "resetApp": "synapse:config:reset-app",
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
} as const

export type IpcChannelMap = typeof IPC_CHANNELS
