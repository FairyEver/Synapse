/**
 * Phase 0.3 — Minimal preload bridge.
 *
 * Creates a type-safe bridge for renderer-to-main communication.
 */

import { contextBridge, ipcRenderer, webUtils } from "electron"
import type {
  DriveDocumentImageImportBridgeRequest,
  DriveDocumentImageSourceContext,
  DriveLocalUploadProgressEvent,
  DriveLocalUploadRequest,
  DrivePublicAssetBinaryUploadRequest,
  SynapseBridge,
} from "../src/types/bridge"
import type { SynapseAgentDomainEvent } from "../src/types/agent"
import type { AgentDetachedConversation } from "../src/types/agent-conversation-window"
import type { OpenAgentSessionPayload } from "../src/types/agent-navigation"
import type { SynapseAccountStateChangedEvent } from "../src/types/account"
import type { SynapseLiveStateChangedEvent } from "../src/types/live"
import type { SynapseContentChangedEvent } from "../src/types/content"
import type { DatabaseChangeEvent } from "../src/types/database"
import type { InstallStatusChangedEvent } from "../src/types/install-status"
import type {
  SynapsePendingPushUpdatedEvent,
  SynapseRepositoryProgressEvent,
  SynapseRepositorySyncSnapshotUpdatedEvent,
  SynapseRepositoryUpdatedEvent,
} from "../src/types/repository"
import type { SynapseAppUpdateState } from "../src/types/update"
import type { AutomationChangedEvent } from "../src/types/automation"
import type { WorkflowEvent } from "../src/types/workflow"
import type { SynapseCheatCodeStateChangedEvent } from "../src/types/cheat-code"
import type { SynapseKnowledgeBaseStorageMigrationProgress } from "../src/types/knowledge-base"
import type { SwarmTaskChangedEvent } from "../app-capabilities/swarm-task/shared/schema"
import type { SynapseGitUserFacingFailure } from "../src/types/git"
import type {
  SynapseTerminalDataEvent,
  SynapseTerminalSession,
  SynapseTerminalSessionDeletedEvent,
} from "../src/types/terminal"
import type { IpcChannelMap } from "./generated/ipc-channels.generated"
import type { DomainEvent, EventDomain, Unsubscribe } from "./runtime/event-bus"

const OPEN_AGENT_SESSION_EVENT = "synapse:open-agent-session"
const IPC_ERROR_ENVELOPE_KEY = "__synapseIpcError"

type IpcErrorEnvelope = {
  readonly [IPC_ERROR_ENVELOPE_KEY]: true
  readonly message: string
  readonly name?: string
  readonly userFacingFailure?: SynapseGitUserFacingFailure
}

const IPC_CHANNELS = {
  "content": {
    "list": "synapse:content:list",
    "getContent": "synapse:content:get-content",
    "getDetail": "synapse:content:get-detail",
    "getAttachmentFile": "synapse:content:get-attachment-file",
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
    "openCreateWindow": "synapse:content:open-create-window",
    "openEditWindow": "synapse:content:open-edit-window",
    "readEditorInitPayload": "synapse:content:read-editor-init-payload",
    "resolveEditorInstallTarget": "synapse:content:resolve-editor-install-target",
    "installToEditor": "synapse:content:install-to-editor",
    "readEditorInstallFormValues": "synapse:content:read-editor-install-form-values",
    "getIconPromptTemplate": "synapse:content:get-icon-prompt-template",
  },
  "skill-repository-install": {
    "resolve": "synapse:skill-repository-install:resolve",
    "prepare": "synapse:skill-repository-install:prepare",
    "recordComplete": "synapse:skill-repository-install:record-complete",
  },
  "installers": {
    "inspectGlobalSkillInstallations": "synapse:installers:inspect-global-skill-installations",
    "inspectSkillEnvSource": "synapse:installers:inspect-skill-env-source",
    "installSourceToEditor": "synapse:installers:install-source-to-editor",
    "installSourceToEditorTargets": "synapse:installers:install-source-to-editor-targets",
    "prepareLocalSkillSource": "synapse:installers:prepare-local-skill-source",
    "prepareInlineRuleSource": "synapse:installers:prepare-inline-rule-source",
  },
  "synapse-skill": {
    "prepareInstallSource": "synapse:synapse-skill:install-source:prepare",
  },
  "skill-uninstaller": {
    "scan": "synapse:skill-uninstaller:scan",
    "scanNames": "synapse:skill-uninstaller:names:scan",
    "cancelScan": "synapse:skill-uninstaller:scan:cancel",
    "uninstall": "synapse:skill-uninstaller:uninstall",
  },
  "config": {
    "get": "synapse:config:get",
    "update": "synapse:config:update",
    "exportBackup": "synapse:config:export-backup",
    "importBackup": "synapse:config:import-backup",
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
    "prepareQuickPublishDraft": "synapse:editor-scan:prepare-quick-publish-draft",
    "finalizeQuickPublish": "synapse:editor-scan:finalize-quick-publish",
    "trashItem": "synapse:editor-scan:trash-item",
    "uploadSkillToSkillRepository": "synapse:editor-scan:upload-skill-to-skill-repository",
  },
  "editor-copy": {
    "resolveTarget": "synapse:editor-copy:resolve-target",
    "copy": "synapse:editor-copy:copy",
  },
  "editor-install-status": {
    "resolveForContent": "synapse:editor-install-status:resolve-for-content",
  },
  "install-status": {
    "getAll": "synapse:install-status:get-all",
    "uninstall": "synapse:install-status:uninstall",
  },
  "knowledge-base": {
    "createManaged": "synapse:knowledge-base:create-managed",
    "deleteManaged": "synapse:knowledge-base:delete-managed",
    "listRawDirectory": "synapse:knowledge-base:list-raw-directory",
    "uploadRawFiles": "synapse:knowledge-base:upload-raw-files",
    "uploadRawItems": "synapse:knowledge-base:upload-raw-items",
    "createRawFolder": "synapse:knowledge-base:create-raw-folder",
    "renameRawEntry": "synapse:knowledge-base:rename-raw-entry",
    "moveRawEntries": "synapse:knowledge-base:move-raw-entries",
    "trashRawEntries": "synapse:knowledge-base:trash-raw-entries",
    "addUrlSource": "synapse:knowledge-base:add-url-source",
    "selectAndUploadRawFiles": "synapse:knowledge-base:select-and-upload-raw-files",
    "selectAndUploadRawDirectory": "synapse:knowledge-base:select-and-upload-raw-directory",
    "exportRawEntries": "synapse:knowledge-base:export-raw-entries",
    "openSourceManager": "synapse:knowledge-base:open-source-manager",
    "getStorageStatus": "synapse:knowledge-base:get-storage-status",
    "getStorageMigrationState": "synapse:knowledge-base:get-storage-migration-state",
    "startStorageMigration": "synapse:knowledge-base:start-storage-migration",
    "cancelStorageMigration": "synapse:knowledge-base:cancel-storage-migration",
    "recheckStorage": "synapse:knowledge-base:recheck-storage",
    "storageMigrationChanged": "synapse:knowledge-base:storage-migration-changed",
  },
  "editor": {
    "getGlobalDirectories": "synapse:editor:get-global-directories",
    "createDirectory": "synapse:editor:create-directory",
  },
  "shell": {
    "openExternal": "synapse:shell:open-external",
    "showItemInFolder": "synapse:shell:show-item-in-folder",
  },
  "repository": {
    "getStates": "synapse:repository:get-states",
    "checkInitializationPreview": "synapse:repository:check-initialization-preview",
    "createLocalRepository": "synapse:repository:create-local-repository",
    "getPendingPushes": "synapse:repository:get-pending-pushes",
    "getSyncSnapshots": "synapse:repository:get-sync-snapshots",
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
  "cheat-code": {
    "getStates": "synapse:cheat-code:states:get",
    "setState": "synapse:cheat-code:state:set",
    "toggleState": "synapse:cheat-code:state:toggle",
  },
  "agent": {
    "status": "synapse:agent:status",
    "listSessions": "synapse:agent:list-sessions",
    "listAllSessions": "synapse:agent:list-all-sessions",
    "openConversationWindow": "synapse:agent:open-conversation-window",
    "focusConversationWindow": "synapse:agent:focus-conversation-window",
    "replaceConversationWindowTarget": "synapse:agent:replace-conversation-window-target",
    "listDetachedConversationWindows": "synapse:agent:list-detached-conversation-windows",
    "getTimeline": "synapse:agent:get-timeline",
    "exportConversationBundle": "synapse:agent:export-conversation-bundle",
    "createSession": "synapse:agent:create-session",
    "switchSession": "synapse:agent:switch-session",
    "deleteSession": "synapse:agent:delete-session",
    "renameSession": "synapse:agent:rename-session",
    "updateSessionPersona": "synapse:agent:session-persona:update",
    "send": "synapse:agent:send",
    "listPendingPermissions": "synapse:agent:list-pending-permissions",
    "respondPermission": "synapse:agent:respond-permission",
    "setPermissionMode": "synapse:agent:set-permission-mode",
    "cancelTurn": "synapse:agent:cancel-turn",
    "forceKillTurn": "synapse:agent:force-kill-turn",
    "getProviders": "synapse:agent:get-providers",
    "listProviders": "synapse:agent:list-providers",
    "listProviderPresets": "synapse:agent:list-provider-presets",
    "createProvider": "synapse:agent:create-provider",
    "createProviderFromPreset": "synapse:agent:create-provider-from-preset",
    "previewCcSwitchClaudeProviders": "synapse:agent:preview-cc-switch-claude-providers",
    "importCcSwitchClaudeProviders": "synapse:agent:import-cc-switch-claude-providers",
    "chooseCcSwitchClaudeImportSource": "synapse:agent:choose-cc-switch-claude-import-source",
    "chooseProviderPackageImportSource": "synapse:agent:choose-provider-package-import-source",
    "chooseProviderPackageExportTarget": "synapse:agent:choose-provider-package-export-target",
    "previewProviderPackageImport": "synapse:agent:preview-provider-package-import",
    "importProviderPackage": "synapse:agent:import-provider-package",
    "exportProviderPackage": "synapse:agent:export-provider-package",
    "updateProvider": "synapse:agent:update-provider",
    "archiveProvider": "synapse:agent:archive-provider",
    "deleteProvider": "synapse:agent:delete-provider",
    "listAllProviders": "synapse:agent:list-all-providers",
    "scanProviderReferences": "synapse:agent:scan-provider-references",
    "migrateProviderReferences": "synapse:agent:migrate-provider-references",
    "setActiveProvider": "synapse:agent:set-active-provider",
    "getRuntimeStatus": "synapse:agent:get-runtime-status",
    "listCommands": "synapse:agent:list-commands",
    "openReference": "synapse:agent:open-reference",
    "openConversation": "synapse:agent:open-conversation",
    "getAvailableAgents": "synapse:agent:get-available-agents",
    "event": "synapse:events:agent",
  },
  "automation": {
    "openCreateEditorWindow": "synapse:automation:editor:open-create",
    "openEditorWindow": "synapse:automation:editor:open-edit",
    "listItems": "synapse:automation:items:list",
    "getItem": "synapse:automation:items:get",
    "createItem": "synapse:automation:items:create",
    "updateItem": "synapse:automation:items:update",
    "deleteItem": "synapse:automation:items:delete",
    "setItemEnabled": "synapse:automation:items:set-enabled",
    "runItem": "synapse:automation:items:run",
    "stopRun": "synapse:automation:runs:stop",
    "listRuns": "synapse:automation:runs:list",
    "changed": "synapse:events:automation",
  },
  "ops": {
    "diagnostics": "synapse:ops:diagnostics",
    "runDiagnostics": "synapse:ops:diagnostics:run",
    "exportDiagnosticsBundle": "synapse:ops:diagnostics:export-bundle",
    "ping": "synapse:ops:ping",
    "openLogDirectory": "synapse:ops:open-log-directory",
    "runAsGet": "synapse:ops:run-as:get",
    "runAsUpdate": "synapse:ops:run-as:update",
    "runAsPreflight": "synapse:ops:run-as:preflight",
    "runAsAuditProbe": "synapse:ops:run-as:audit-probe",
    "webhookStatus": "synapse:ops:webhook:status",
    "webhookUpdate": "synapse:ops:webhook:update",
    "webhookRuns": "synapse:ops:webhook:runs",
    "relayBindings": "synapse:ops:relay:bindings",
    "relayRuns": "synapse:ops:relay:runs",
    "relayUnbind": "synapse:ops:relay:unbind",
    "compressGet": "synapse:ops:compress:get",
    "compressUpdate": "synapse:ops:compress:update",
  },
  "workflow": {
    "list": "synapse:workflow:list",
    "get": "synapse:workflow:get",
    "create": "synapse:workflow:create",
    "save": "synapse:workflow:save",
    "delete": "synapse:workflow:delete",
    "validate": "synapse:workflow:validate",
    "run": "synapse:workflow:run",
    "runDefinition": "synapse:workflow:run-definition",
    "rerun": "synapse:workflow:rerun",
    "openRunner": "synapse:workflow:open-runner",
    "cancel": "synapse:workflow:cancel",
    "activeRuns": "synapse:workflow:active-runs",
    "runHistory": "synapse:workflow:run-history",
    "runStatus": "synapse:workflow:run-status",
    "openEditor": "synapse:workflow:open-editor",
    "editorState": "synapse:workflow:editor-state",
    "checkCanSync": "synapse:workflow:check-can-sync",
    "exportPackage": "synapse:workflow:export-package",
    "inspectImportPackage": "synapse:workflow:inspect-import-package",
    "importPackage": "synapse:workflow:import-package",
    "chooseParamFile": "synapse:workflow:param-file:choose",
    "chooseParamDirectory": "synapse:workflow:param-directory:choose",
    "chooseParamFiles": "synapse:workflow:param-files:choose",
    "chooseParamDirectories": "synapse:workflow:param-directories:choose",
    "paramPresetsList": "synapse:workflow:param-presets:list",
    "paramPresetsSave": "synapse:workflow:param-presets:save",
    "paramPresetsDelete": "synapse:workflow:param-presets:delete",
    "event": "synapse:workflow:event",
  },
  "usage-analysis": {
    "ccRefresh": "synapse:usage-analysis:cc:refresh",
    "ccOverview": "synapse:usage-analysis:cc:overview",
    "ccTime": "synapse:usage-analysis:cc:time",
    "ccModels": "synapse:usage-analysis:cc:models",
    "ccProjects": "synapse:usage-analysis:cc:projects",
    "ccTools": "synapse:usage-analysis:cc:tools",
    "ccDetails": "synapse:usage-analysis:cc:details",
    "ccRecordsList": "synapse:usage-analysis:cc:records:list",
    "ccRecordDetailsList": "synapse:usage-analysis:cc:record-details:list",
    "ccRecordsSearchText": "synapse:usage-analysis:cc:records:search-text",
    "ccConversationsList": "synapse:usage-analysis:cc:conversations:list",
    "ccConversationGet": "synapse:usage-analysis:cc:conversation:get",
    "ccConversationChunkGet": "synapse:usage-analysis:cc:conversation:chunk:get",
    "ccConversationSearchText": "synapse:usage-analysis:cc:conversation:search-text",
    "ccConversationWindowOpen": "synapse:usage-analysis:cc:conversation-window:open",
    "codexRefresh": "synapse:usage-analysis:codex:refresh",
    "codexOverview": "synapse:usage-analysis:codex:overview",
    "codexTime": "synapse:usage-analysis:codex:time",
    "codexModels": "synapse:usage-analysis:codex:models",
    "codexProjects": "synapse:usage-analysis:codex:projects",
    "codexTools": "synapse:usage-analysis:codex:tools",
    "codexDetails": "synapse:usage-analysis:codex:details",
    "pricingRulesGet": "synapse:usage-analysis:pricing-rules:get",
    "pricingRulesSave": "synapse:usage-analysis:pricing-rules:save",
    "pricingRulesReset": "synapse:usage-analysis:pricing-rules:reset",
  },
  "model-price": {
    "coverageList": "synapse:model-price:coverage:list",
    "presetsList": "synapse:model-price:presets:list",
    "presetsImport": "synapse:model-price:presets:import",
    "rulesGet": "synapse:model-price:rules:get",
    "rulesSave": "synapse:model-price:rules:save",
    "rulesClear": "synapse:model-price:rules:clear",
    "rulesReset": "synapse:model-price:rules:reset",
  },
  "account": {
    "getState": "synapse:account:get-state",
    "startLogin": "synapse:account:start-login",
    "refresh": "synapse:account:refresh",
    "logout": "synapse:account:logout",
    "listWebhooks": "synapse:account:webhooks:list",
    "listDriveItems": "synapse:account:drive:items:list",
    "prepareDriveUpload": "synapse:account:drive:uploads:prepare",
    "prepareDriveFolderUpload": "synapse:account:drive:uploads:folder:prepare",
    "completeDriveUpload": "synapse:account:drive:uploads:complete",
    "uploadDrivePreparedFile": "synapse:account:drive:uploads:put",
    "uploadDriveLocalItems": "synapse:account:drive:uploads:local-items",
    "cancelDriveUpload": "synapse:account:drive:uploads:cancel",
    "createDriveFolder": "synapse:account:drive:folders:create",
    "getDriveItemPreviewUrl": "synapse:account:drive:items:preview-url",
    "renameDriveItem": "synapse:account:drive:items:rename",
    "moveDriveItem": "synapse:account:drive:items:move",
    "deleteDriveItem": "synapse:account:drive:items:delete",
    "listDriveFileVersions": "synapse:account:drive:file-versions:list",
    "downloadDriveFileVersion": "synapse:account:drive:file-versions:download",
    "restoreDriveFileVersion": "synapse:account:drive:file-versions:restore",
    "deleteDriveFileVersion": "synapse:account:drive:file-versions:delete",
    "updateDriveFileVersionPin": "synapse:account:drive:file-versions:pin",
    "resolveDriveLink": "synapse:account:drive:links:resolve",
    "listDriveLink": "synapse:account:drive:links:list",
    "readDriveLinkText": "synapse:account:drive:links:read-text",
    "materializeDriveLink": "synapse:account:drive:links:materialize",
    "downloadDriveLinkFile": "synapse:account:drive:links:download-file",
    "shareDriveItem": "synapse:account:drive:items:share",
    "disableDriveShare": "synapse:account:drive:shares:disable",
    "getDriveUsage": "synapse:account:drive:usage:get",
    "getDriveShare": "synapse:account:drive:shares:get",
    "listDriveShares": "synapse:account:drive:shares:list",
    "listDrivePublicAssets": "synapse:account:drive:public-assets:list",
    "getDrivePublicAsset": "synapse:account:drive:public-assets:get",
    "uploadDrivePublicAssets": "synapse:account:drive:public-assets:upload",
    "uploadDrivePublicAssetBinary": "synapse:account:drive:public-assets:upload-binary",
    "scanDriveDocumentImageSources": "synapse:account:drive:document-images:scan",
    "importDriveDocumentImages": "synapse:account:drive:document-images:import",
    "replaceDrivePublicAssetFile": "synapse:account:drive:public-assets:replace-file",
    "renameDrivePublicAsset": "synapse:account:drive:public-assets:rename",
    "trashDrivePublicAsset": "synapse:account:drive:public-assets:trash",
    "restoreDrivePublicAsset": "synapse:account:drive:public-assets:restore",
    "preflightDriveSite": "synapse:account:drive:sites:preflight",
    "createDriveSite": "synapse:account:drive:sites:create",
    "listDriveSites": "synapse:account:drive:sites:list",
    "updateDriveSiteAccess": "synapse:account:drive:sites:access:update",
    "disableDriveSite": "synapse:account:drive:sites:disable",
    "enableDriveSite": "synapse:account:drive:sites:enable",
    "deleteDriveSite": "synapse:account:drive:sites:delete",
    "republishDriveSite": "synapse:account:drive:sites:republish",
    "listDriveTrash": "synapse:account:drive:trash:list",
    "restoreDriveTrashItem": "synapse:account:drive:trash:restore",
    "deleteDriveTrashItem": "synapse:account:drive:trash:delete",
    "stateChanged": "synapse:events:account",
    "driveLocalUploadProgress": "synapse:events:account",
  },
  "live": {
    "getState": "synapse:live:get-state",
    "stateChanged": "synapse:events:live",
  },
  "apps": {
    "openSystemApp": "synapse:apps:open-system-app",
  },
  "documentTemplate": {
    "chooseTemplateFile": "synapse:document-template:template:choose",
    "chooseJsonFile": "synapse:document-template:json:choose",
    "chooseOutputFile": "synapse:document-template:output:choose",
    "generateDocx": "synapse:document-template:docx:generate",
  },
  "quickInput": {
    "list": "synapse:quick-input:list",
    "create": "synapse:quick-input:create",
    "update": "synapse:quick-input:update",
    "delete": "synapse:quick-input:delete",
    "changed": "synapse:quick-input:changed",
  },
  "secrets": {
    "list": "synapse:secrets:list",
    "get": "synapse:secrets:get",
    "create": "synapse:secrets:create",
    "update": "synapse:secrets:update",
    "upsert": "synapse:secrets:upsert",
    "delete": "synapse:secrets:delete",
    "scanSkillEnvBindings": "synapse:secrets:scan-skill-env-bindings",
    "queueSkillEnvBindings": "synapse:secrets:queue-skill-env-bindings",
    "changed": "synapse:secrets:changed",
  },
  "agentPersonas": {
    "list": "synapse:agent-personas:list",
    "create": "synapse:agent-personas:create",
    "update": "synapse:agent-personas:update",
    "updateBuiltinModel": "synapse:agent-personas:builtin-model:update",
    "delete": "synapse:agent-personas:delete",
    "changed": "synapse:agent-personas:changed",
  },
  "driveSync": {
    "getSnapshot": "synapse:drive-sync:snapshot:get",
    "previewBinding": "synapse:drive-sync:bindings:preview",
    "createSafeBinding": "synapse:drive-sync:bindings:safe-create",
    "removeBinding": "synapse:drive-sync:bindings:remove",
    "pauseBinding": "synapse:drive-sync:bindings:pause",
    "resumeBinding": "synapse:drive-sync:bindings:resume",
    "updateExcludeRules": "synapse:drive-sync:bindings:exclude-rules:update",
    "rescanBinding": "synapse:drive-sync:bindings:rescan",
    "pollRemoteChanges": "synapse:drive-sync:remote:poll",
    "resolveConflict": "synapse:drive-sync:conflicts:resolve",
    "chooseLocalPath": "synapse:drive-sync:local-path:choose",
    "changed": "synapse:drive-sync:changed",
  },
  "soundNotifier": {
    "getSettings": "synapse:sound-notifier:settings:get",
    "updateSettings": "synapse:sound-notifier:settings:update",
    "play": "synapse:sound-notifier:play",
    "preview": "synapse:sound-notifier:preview",
    "changed": "synapse:sound-notifier:changed",
    "playRequested": "synapse:sound-notifier:play-requested",
  },
  "swarmTask": {
    "listTasks": "synapse:swarm-task:tasks:list",
    "createTask": "synapse:swarm-task:tasks:create",
    "updateTask": "synapse:swarm-task:tasks:update",
    "deleteTask": "synapse:swarm-task:tasks:delete",
    "startRun": "synapse:swarm-task:runs:start",
    "stopRefill": "synapse:swarm-task:runs:stop-refill",
    "cancelRun": "synapse:swarm-task:runs:cancel",
    "listRuns": "synapse:swarm-task:runs:list",
    "getRun": "synapse:swarm-task:runs:get",
    "listWorkerRuns": "synapse:swarm-task:worker-runs:list",
    "changed": "synapse:events:swarm-task",
  },
  "terminal": {
    "chooseDefaultCwd": "synapse:terminal:group:choose-default-cwd",
    "listGroups": "synapse:terminal:group:list",
    "createGroup": "synapse:terminal:group:create",
    "renameGroup": "synapse:terminal:group:rename",
    "updateGroupSettings": "synapse:terminal:group:update-settings",
    "createGroupCommand": "synapse:terminal:group-command:create",
    "updateGroupCommand": "synapse:terminal:group-command:update",
    "deleteGroupCommand": "synapse:terminal:group-command:delete",
    "launchGroupCommand": "synapse:terminal:group-command:launch",
    "deleteGroup": "synapse:terminal:group:delete",
    "listSessions": "synapse:terminal:session:list",
    "createSession": "synapse:terminal:session:create",
    "getSession": "synapse:terminal:session:get",
    "readSession": "synapse:terminal:session:read",
    "renameSession": "synapse:terminal:session:rename",
    "writeSession": "synapse:terminal:session:write",
    "resizeSession": "synapse:terminal:session:resize",
    "deleteSession": "synapse:terminal:session:delete",
    "stopSession": "synapse:terminal:session:stop",
    "runStartupCommand": "synapse:terminal:session:run-startup-command",
    "data": "synapse:terminal:data",
    "sessionChanged": "synapse:terminal:session-changed",
    "sessionDeleted": "synapse:terminal:session-deleted",
  },
  "git": {
    "checkEnvironment": "synapse:git:environment:check",
    "configureIdentity": "synapse:git:environment:configure-identity",
    "getSshPublicKey": "synapse:git:environment:get-ssh-public-key",
    "checkAccess": "synapse:git:access:check",
    "configureCredentialHelper": "synapse:git:access:configure-credential-helper",
    "saveHttpsCredential": "synapse:git:access:save-https-credential",
    "clearHttpsCredential": "synapse:git:access:clear-https-credential",
    "generateSshKey": "synapse:git:access:generate-ssh-key",
    "testSshConnection": "synapse:git:access:test-ssh-connection",
    "listRepositories": "synapse:git:repositories:list",
    "listRepositorySummaries": "synapse:git:repositories:list-summaries",
    "addLocalRepository": "synapse:git:repositories:add-local",
    "removeRepository": "synapse:git:repositories:remove",
    "cloneRepository": "synapse:git:repositories:clone",
    "getSnapshot": "synapse:git:status:get-snapshot",
    "getDiff": "synapse:git:status:get-diff",
    "commit": "synapse:git:commit:create",
    "fetch": "synapse:git:sync:fetch",
    "pull": "synapse:git:sync:pull",
    "push": "synapse:git:sync:push",
    "sync": "synapse:git:sync:sync",
    "listBranches": "synapse:git:branches:list",
    "checkoutBranch": "synapse:git:branches:checkout",
    "createBranch": "synapse:git:branches:create",
    "listHistory": "synapse:git:history:list",
    "getCommit": "synapse:git:history:get-commit",
  },
} as const satisfies IpcChannelMap

// Legacy event channels that are not declared by IpcModule descriptors yet.
const EVENT_CHANNELS = {
  update: {
    stateChanged: "synapse:update:state-changed",
    openUpdatePage: "synapse:update:open-update-page",
  },
  agent: {
    event: "synapse:events:agent",
    detachedConversationsChanged: "synapse:agent:detached-conversations-changed",
  },
  workflow: {
    event: "synapse:events:workflow",
  },
  installStatus: {
    changed: "synapse:events:install-status",
  },
  diagnostics: {
    ping: "synapse:diagnostics:ping",
    pong: "synapse:diagnostics:pong",
  },
  apps: {
    contentOpenRequest: "synapse:apps:content-open-request",
  },
}

// HTTP test channels (not yet migrated to IpcModule)
const HTTP_CHANNELS = {
  testRequest: "synapse:http:test-request",
} as const

// Database channels (not yet migrated to IpcModule)
const DATABASE_CHANNELS = {
  databaseTableList: "synapse:database:table:list",
  databaseTableCreate: "synapse:database:table:create",
  databaseTableDelete: "synapse:database:table:delete",
  databaseTableDescribe: "synapse:database:table:describe",
  databaseOverviewGet: "synapse:database:overview:get",
  databaseTableUpdate: "synapse:database:table:update",
  databaseColumnCreate: "synapse:database:column:create",
  databaseColumnUpdate: "synapse:database:column:update",
  databaseChoiceUpdate: "synapse:database:choice:update",
  databaseChoiceUsageGet: "synapse:database:choice-usage:get",
  databaseRowCreate: "synapse:database:row:create",
  databaseRowsCreate: "synapse:database:rows:create",
  databaseRowList: "synapse:database:row:list",
  databaseRowUpdate: "synapse:database:row:update",
  databaseRowDelete: "synapse:database:row:delete",
  databaseRowsUpdate: "synapse:database:rows:update",
  databaseRowsDelete: "synapse:database:rows:delete",
  databaseRowCount: "synapse:database:row:count",
  databaseTableRename: "synapse:database:table:rename",
  databaseColumnRename: "synapse:database:column:rename",
  databaseColumnDelete: "synapse:database:column:delete",
  databaseSqlExecute: "synapse:database:sql:execute",
  databaseStatusGet: "synapse:database:status:get",
  databaseExport: "synapse:database:export",
  databaseImport: "synapse:database:import",
  databaseTableExport: "synapse:database:table:export",
  databaseTableImportInspect: "synapse:database:table-import:inspect",
  databaseTableImport: "synapse:database:table:import",
  databaseMcpHttpStatusGet: "synapse:database:mcp-http-status:get",
  databaseMcpStatusGet: "synapse:database:mcp-status:get",
  databaseMcpServersGet: "synapse:database:mcp-servers:get",
  databaseMcpSettingsOpen: "synapse:database:mcp-settings:open",
  databaseMcpRegister: "synapse:database:mcp:register",
  databaseFolderList: "synapse:database:folder:list",
  databaseFolderCreate: "synapse:database:folder:create",
  databaseFolderRename: "synapse:database:folder:rename",
  databaseFolderDelete: "synapse:database:folder:delete",
  databaseFolderMoveTable: "synapse:database:folder:move-table",
  databaseFolderReorder: "synapse:database:folder:reorder",
  databaseFolderReorderFolders: "synapse:database:folder:reorder-folders",
} as const

type RawSubscribe = (channel: string) => (listener: (payload: unknown) => void) => Unsubscribe

const channelForDomain = (domain: EventDomain): string => `synapse:events:${domain}`

function isDomainEvent(
  payload: unknown,
  domain: EventDomain,
  type: string,
): payload is DomainEvent {
  if (typeof payload !== "object" || payload === null) {
    return false
  }

  const event = payload as Partial<DomainEvent>

  return event.domain === domain && event.type === type && "payload" in event
}

function createDomainEventPayloadSubscription<TPayload>(
  subscribeToChannel: RawSubscribe,
  domain: EventDomain,
  type: string,
): (listener: (payload: TPayload) => void) => Unsubscribe {
  return (listener) =>
    subscribeToChannel(channelForDomain(domain))((event) => {
      if (isDomainEvent(event, domain, type)) {
        listener(event.payload as TPayload)
      }
    })
}

function createRawPayloadSubscription<TPayload>(
  subscribeToChannel: RawSubscribe,
  channel: string,
): (listener: (payload: TPayload) => void) => Unsubscribe {
  return (listener) =>
    subscribeToChannel(channel)((payload) => {
      listener(payload as TPayload)
    })
}

const SENSITIVE_IPC_FIELD_PATTERN =
  /(password|token|secret|credential|api[-_]?key|app[-_]?secret|private[-_ ]?key|cookie|authorization)/i
const SENSITIVE_IPC_TEXT_FIELD_PATTERN =
  /(content|prompt|message|body|text|params|definition|payload)/i
const URL_LIKE_IPC_FIELD_PATTERN =
  /(url|uri|remote|href|link)/i
const URL_TEXT_PATTERN =
  /\b(?:https?|ssh|git):\/\/[^\s"'<>]+/gi
const URL_CREDENTIAL_PATTERN =
  /(\/\/)([^/\s:@]+):([^/\s@]+)@/g
const SENSITIVE_URL_QUERY_PATTERN =
  /([?&](?:access[-_]?token|auth|authorization|credential|password|secret|token|api[-_]?key|key)=)[^&\s]+/gi
const SENSITIVE_ERROR_VALUE_PATTERN =
  /\b(secret|token|api[-_]?key|authorization|cookie|password|credential)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const SECRET_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}\b/g
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\(?:[^\\\s"')]+\\)+[^\\\s"'),;]+/g
const POSIX_PATH_PATTERN = /(^|[\s("'])\/(?:[^/\s"')]+\/)+[^/\s"'),;]+/g

function sanitizeIpcPayload(fieldName: string, value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "string") {
    if (SENSITIVE_IPC_FIELD_PATTERN.test(fieldName)) return "[redacted]"
    if (SENSITIVE_IPC_TEXT_FIELD_PATTERN.test(fieldName)) return textFieldSummary(value)
    const sanitizedValue = sanitizeIpcUrlValue(fieldName, value)
    return sanitizedValue.length > 300
      ? `${sanitizedValue.slice(0, 120)}...[truncated ${sanitizedValue.length} chars]`
      : sanitizedValue
  }
  if (Array.isArray(value)) {
    if (SENSITIVE_IPC_TEXT_FIELD_PATTERN.test(fieldName)) {
      return { type: "array", itemCount: value.length }
    }
    return value.slice(0, 20).map((item) => sanitizeIpcPayload(fieldName, item, depth + 1))
  }
  if (typeof value === "object") {
    if (SENSITIVE_IPC_TEXT_FIELD_PATTERN.test(fieldName)) {
      return { type: "object", keyCount: Object.keys(value as Record<string, unknown>).length }
    }
    if (depth >= 3) return "[object]"
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeIpcPayload(key, item, depth + 1),
      ]),
    )
  }
  return String(value)
}

function textFieldSummary(value: string): { type: "text"; length: number } {
  return { type: "text", length: value.length }
}

function sanitizeIpcUrlValue(fieldName: string, value: string): string {
  if (!URL_LIKE_IPC_FIELD_PATTERN.test(fieldName) && !URL_TEXT_PATTERN.test(value)) return value
  return value
    .replace(URL_TEXT_PATTERN, (match) => sanitizeSingleIpcUrl(match))
    .replace(URL_CREDENTIAL_PATTERN, "$1[redacted]:[redacted]@")
    .replace(SENSITIVE_URL_QUERY_PATTERN, "$1[redacted]")
}

function sanitizeSingleIpcUrl(value: string): string {
  try {
    const parsed = new URL(value)
    if (parsed.username) parsed.username = "redacted"
    if (parsed.password) parsed.password = "redacted"
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_IPC_FIELD_PATTERN.test(key)) {
        parsed.searchParams.set(key, "redacted")
      }
    }
    return parsed.toString()
  } catch {
    return value
  }
}

function describeIpcError(error: unknown): string {
  return sanitizeIpcErrorMessage(error instanceof Error ? error.message : String(error))
}

function sanitizeIpcErrorMessage(value: string): string {
  return value
    .replace(BEARER_TOKEN_PATTERN, "Bearer [redacted]")
    .replace(SENSITIVE_ERROR_VALUE_PATTERN, "$1=[redacted]")
    .replace(SECRET_KEY_PATTERN, "[key]")
    .replace(WINDOWS_PATH_PATTERN, "[path]")
    .replace(POSIX_PATH_PATTERN, "$1[path]")
    .trim()
}

function writeRendererIpcFailureLog(channel: string, args: unknown, error: unknown, durationMs: number): void {
  void ipcRenderer.invoke(IPC_CHANNELS.log.write, {
    level: "error",
    category: "renderer.ipc",
    message: "IPC invoke failed.",
    details: {
      channel,
      durationMs,
      error: describeIpcError(error),
      request: sanitizeIpcPayload("request", args),
    },
  }).catch(() => undefined)
}

function summarizeDriveLocalUploadRequest(input: unknown): unknown {
  if (!input || typeof input !== "object") {
    return { inputType: typeof input }
  }
  const request = input as Partial<DriveLocalUploadRequest>
  const items = Array.isArray(request.items) ? request.items : []
  const fileCount = items.reduce((count, item) => {
    if (!item || typeof item !== "object") return count
    if (item.kind === "file") return count + 1
    if (item.kind === "folder" && Array.isArray(item.files)) return count + item.files.length
    return count
  }, 0)
  return {
    parentId: typeof request.parentId === "string" || request.parentId === null ? request.parentId : undefined,
    itemCount: items.length,
    fileCount,
  }
}

function summarizeDrivePublicAssetBinaryUploadRequest(input: unknown): unknown {
  if (!input || typeof input !== "object") {
    return { inputType: typeof input }
  }
  const request = input as Partial<DrivePublicAssetBinaryUploadRequest>
  return {
    name: typeof request.name === "string" ? request.name : undefined,
    mimeType: typeof request.mimeType === "string" ? request.mimeType : undefined,
    byteLength: binaryDataByteLength(request.data),
  }
}

function summarizeDriveDocumentImageSourceContext(input: unknown): unknown {
  if (!input || typeof input !== "object") {
    return { inputType: typeof input }
  }
  const request = input as Partial<DriveDocumentImageSourceContext>
  return {
    kind: request.kind,
    itemId: "itemId" in request ? request.itemId : undefined,
    shareId: "shareId" in request ? request.shareId : undefined,
  }
}

function summarizeDriveDocumentImageImportRequest(input: unknown): unknown {
  const context = summarizeDriveDocumentImageSourceContext(input)
  if (!input || typeof input !== "object") return context
  const request = input as Partial<DriveDocumentImageImportBridgeRequest>
  return {
    ...(context as Record<string, unknown>),
    sourceCount: Array.isArray(request.sources) ? request.sources.length : undefined,
  }
}

function summarizeSecretsMutationRequest(input: unknown): unknown {
  if (!input || typeof input !== "object") {
    return { inputType: typeof input }
  }
  const request = input as Record<string, unknown>
  return {
    nameProvided: typeof request.name === "string",
    valueProvided: typeof request.value === "string",
    descriptionProvided: typeof request.description === "string",
  }
}

function binaryDataByteLength(value: unknown): number | undefined {
  if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") {
    return (value as ArrayBuffer).byteLength
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength
  }
  return undefined
}

// Helper to create invoke wrapper
const invoke = (channel: string) => async (args?: unknown) => {
  const startedAt = performance.now()
  try {
    return unwrapIpcResult(await ipcRenderer.invoke(channel, args))
  } catch (error) {
    if (channel !== IPC_CHANNELS.log.write) {
      writeRendererIpcFailureLog(channel, args, error, Math.round(performance.now() - startedAt))
    }
    throw error
  }
}

const invokeWithFailureLogRequest = (
  channel: string,
  describeRequest: (args: unknown) => unknown,
) => async (args?: unknown) => {
  const startedAt = performance.now()
  try {
    return unwrapIpcResult(await ipcRenderer.invoke(channel, args))
  } catch (error) {
    if (channel !== IPC_CHANNELS.log.write) {
      writeRendererIpcFailureLog(channel, describeRequest(args), error, Math.round(performance.now() - startedAt))
    }
    throw error
  }
}

function unwrapIpcResult(result: Awaited<ReturnType<typeof ipcRenderer.invoke>>) {
  if (!isIpcErrorEnvelope(result)) return result
  const error = new Error(result.message)
  error.name = result.name ?? "Error"
  if (result.userFacingFailure) {
    Object.defineProperty(error, "userFacingFailure", {
      configurable: true,
      enumerable: true,
      value: result.userFacingFailure,
      writable: false,
    })
  }
  throw error
}

function isIpcErrorEnvelope(value: unknown): value is IpcErrorEnvelope {
  if (!value || typeof value !== "object") return false
  const record = value as Partial<IpcErrorEnvelope>
  return record[IPC_ERROR_ENVELOPE_KEY] === true && typeof record.message === "string"
}

// Helper to create subscription
const subscribe = (channel: string) => (listener: (payload: unknown) => void) => {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return (): void => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const synapseBridge: SynapseBridge = {
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
  isPackaged: !process.env.VITE_DEV_SERVER_URL,
  apps: {
    openSystemApp: (appId, options) => invoke(IPC_CHANNELS.apps.openSystemApp)({ appId, options }),
    onContentOpenRequest: createRawPayloadSubscription(
      subscribe,
      EVENT_CHANNELS.apps.contentOpenRequest,
    ),
  },
  documentTemplate: {
    chooseTemplateFile: () => invoke(IPC_CHANNELS.documentTemplate.chooseTemplateFile)(),
    chooseJsonFile: () => invoke(IPC_CHANNELS.documentTemplate.chooseJsonFile)(),
    chooseOutputFile: (input) => invoke(IPC_CHANNELS.documentTemplate.chooseOutputFile)(input),
    generateDocx: (input) => invoke(IPC_CHANNELS.documentTemplate.generateDocx)(input),
  },
  skillUninstaller: {
    scan: invoke(IPC_CHANNELS["skill-uninstaller"].scan),
    scanNames: invoke(IPC_CHANNELS["skill-uninstaller"].scanNames),
    cancelScan: invoke(IPC_CHANNELS["skill-uninstaller"].cancelScan),
    uninstall: invoke(IPC_CHANNELS["skill-uninstaller"].uninstall),
  },
  quickInput: {
    list: () => invoke(IPC_CHANNELS.quickInput.list)(),
    create: (input) => invoke(IPC_CHANNELS.quickInput.create)(input),
    update: (input) => invoke(IPC_CHANNELS.quickInput.update)(input),
    delete: (input) => invoke(IPC_CHANNELS.quickInput.delete)(input),
    onChanged: createRawPayloadSubscription(
      subscribe,
      IPC_CHANNELS.quickInput.changed,
    ),
  },
  secrets: {
    list: () => invoke(IPC_CHANNELS.secrets.list)(),
    get: (input) => invoke(IPC_CHANNELS.secrets.get)(input),
    create: (input) => invokeWithFailureLogRequest(
      IPC_CHANNELS.secrets.create,
      summarizeSecretsMutationRequest,
    )(input),
    update: (input) => invokeWithFailureLogRequest(
      IPC_CHANNELS.secrets.update,
      summarizeSecretsMutationRequest,
    )(input),
    upsert: (input) => invokeWithFailureLogRequest(
      IPC_CHANNELS.secrets.upsert,
      summarizeSecretsMutationRequest,
    )(input),
    delete: (input) => invoke(IPC_CHANNELS.secrets.delete)(input),
    scanSkillEnvBindings: (input) => invoke(IPC_CHANNELS.secrets.scanSkillEnvBindings)(input),
    queueSkillEnvBindings: (input) => invoke(IPC_CHANNELS.secrets.queueSkillEnvBindings)(input),
    onChanged: createRawPayloadSubscription(
      subscribe,
      IPC_CHANNELS.secrets.changed,
    ),
  },
  agentPersonas: {
    list: () => invoke(IPC_CHANNELS.agentPersonas.list)(),
    create: (input) => invoke(IPC_CHANNELS.agentPersonas.create)(input),
    update: (input) => invoke(IPC_CHANNELS.agentPersonas.update)(input),
    updateBuiltinModel: (input) => invoke(IPC_CHANNELS.agentPersonas.updateBuiltinModel)(input),
    delete: (input) => invoke(IPC_CHANNELS.agentPersonas.delete)(input),
    onChanged: createRawPayloadSubscription(
      subscribe,
      IPC_CHANNELS.agentPersonas.changed,
    ),
  },
  driveSync: {
    getSnapshot: () => invoke(IPC_CHANNELS.driveSync.getSnapshot)(),
    previewBinding: (input) => invoke(IPC_CHANNELS.driveSync.previewBinding)(input),
    createSafeBinding: (input) => invoke(IPC_CHANNELS.driveSync.createSafeBinding)(input),
    removeBinding: (input) => invoke(IPC_CHANNELS.driveSync.removeBinding)(input),
    pauseBinding: (input) => invoke(IPC_CHANNELS.driveSync.pauseBinding)(input),
    resumeBinding: (input) => invoke(IPC_CHANNELS.driveSync.resumeBinding)(input),
    updateExcludeRules: (input) => invoke(IPC_CHANNELS.driveSync.updateExcludeRules)(input),
    rescanBinding: (input) => invoke(IPC_CHANNELS.driveSync.rescanBinding)(input),
    pollRemoteChanges: (input = {}) => invoke(IPC_CHANNELS.driveSync.pollRemoteChanges)(input),
    resolveConflict: (input) => invoke(IPC_CHANNELS.driveSync.resolveConflict)(input),
    chooseLocalPath: (input) => invoke(IPC_CHANNELS.driveSync.chooseLocalPath)(input),
    onChanged: createRawPayloadSubscription(
      subscribe,
      IPC_CHANNELS.driveSync.changed,
    ),
  },
  soundNotifier: {
    getSettings: () => invoke(IPC_CHANNELS.soundNotifier.getSettings)(),
    updateSettings: (input) => invoke(IPC_CHANNELS.soundNotifier.updateSettings)(input),
    play: (input = {}) => invoke(IPC_CHANNELS.soundNotifier.play)(input),
    preview: (input = {}) => invoke(IPC_CHANNELS.soundNotifier.preview)(input),
    onChanged: createRawPayloadSubscription(
      subscribe,
      IPC_CHANNELS.soundNotifier.changed,
    ),
    onPlayRequested: createRawPayloadSubscription(
      subscribe,
      IPC_CHANNELS.soundNotifier.playRequested,
    ),
  },
  swarmTask: {
    listTasks: () => invoke(IPC_CHANNELS.swarmTask.listTasks)(),
    createTask: (input) => invoke(IPC_CHANNELS.swarmTask.createTask)(input),
    updateTask: (input) => invoke(IPC_CHANNELS.swarmTask.updateTask)(input),
    deleteTask: (taskId) => invoke(IPC_CHANNELS.swarmTask.deleteTask)({ taskId }),
    startRun: (input) => invoke(IPC_CHANNELS.swarmTask.startRun)(input),
    stopRefill: (runId) => invoke(IPC_CHANNELS.swarmTask.stopRefill)({ runId }),
    cancelRun: (runId) => invoke(IPC_CHANNELS.swarmTask.cancelRun)({ runId }),
    listRuns: (input = {}) => invoke(IPC_CHANNELS.swarmTask.listRuns)(input),
    getRun: (runId) => invoke(IPC_CHANNELS.swarmTask.getRun)({ runId }),
    listWorkerRuns: (runId) => invoke(IPC_CHANNELS.swarmTask.listWorkerRuns)({ runId }),
    onChanged: createDomainEventPayloadSubscription<SwarmTaskChangedEvent>(
      subscribe,
      "swarm-task",
      "swarm-task.changed",
    ),
  },
  terminal: {
    chooseDefaultCwd: () => invoke(IPC_CHANNELS.terminal.chooseDefaultCwd)(),
    listGroups: () => invoke(IPC_CHANNELS.terminal.listGroups)(),
    createGroup: (input) => invoke(IPC_CHANNELS.terminal.createGroup)(input),
    renameGroup: (input) => invoke(IPC_CHANNELS.terminal.renameGroup)(input),
    updateGroupSettings: (input) => invoke(IPC_CHANNELS.terminal.updateGroupSettings)(input),
    createGroupCommand: (input) => invoke(IPC_CHANNELS.terminal.createGroupCommand)(input),
    updateGroupCommand: (input) => invoke(IPC_CHANNELS.terminal.updateGroupCommand)(input),
    deleteGroupCommand: (input) => invoke(IPC_CHANNELS.terminal.deleteGroupCommand)(input),
    launchGroupCommand: (input) => invoke(IPC_CHANNELS.terminal.launchGroupCommand)(input),
    deleteGroup: (input) => invoke(IPC_CHANNELS.terminal.deleteGroup)(input),
    listSessions: () => invoke(IPC_CHANNELS.terminal.listSessions)(),
    createSession: (input) => invoke(IPC_CHANNELS.terminal.createSession)(input),
    getSession: (input) => invoke(IPC_CHANNELS.terminal.getSession)(input),
    readSession: (input) => invoke(IPC_CHANNELS.terminal.readSession)(input),
    renameSession: (input) => invoke(IPC_CHANNELS.terminal.renameSession)(input),
    writeSession: (input) => invoke(IPC_CHANNELS.terminal.writeSession)(input),
    resizeSession: (input) => invoke(IPC_CHANNELS.terminal.resizeSession)(input),
    deleteSession: (input) => invoke(IPC_CHANNELS.terminal.deleteSession)(input),
    stopSession: (input) => invoke(IPC_CHANNELS.terminal.stopSession)(input),
    runStartupCommand: (input) => invoke(IPC_CHANNELS.terminal.runStartupCommand)(input),
    onData: createRawPayloadSubscription<SynapseTerminalDataEvent>(
      subscribe,
      IPC_CHANNELS.terminal.data,
    ),
    onSessionChanged: createRawPayloadSubscription<SynapseTerminalSession>(
      subscribe,
      IPC_CHANNELS.terminal.sessionChanged,
    ),
    onSessionDeleted: createRawPayloadSubscription<SynapseTerminalSessionDeletedEvent>(
      subscribe,
      IPC_CHANNELS.terminal.sessionDeleted,
    ),
  },
  git: {
    checkEnvironment: invoke(IPC_CHANNELS.git.checkEnvironment),
    configureIdentity: (input) =>
      invoke(IPC_CHANNELS.git.configureIdentity)(input),
    getSshPublicKey: invoke(IPC_CHANNELS.git.getSshPublicKey),
    checkAccess: (input = {}) =>
      invoke(IPC_CHANNELS.git.checkAccess)(input),
    configureCredentialHelper: (input) =>
      invoke(IPC_CHANNELS.git.configureCredentialHelper)(input),
    saveHttpsCredential: (input) =>
      invoke(IPC_CHANNELS.git.saveHttpsCredential)(input),
    clearHttpsCredential: (input) =>
      invoke(IPC_CHANNELS.git.clearHttpsCredential)(input),
    generateSshKey: (input) =>
      invoke(IPC_CHANNELS.git.generateSshKey)(input),
    testSshConnection: (input) =>
      invoke(IPC_CHANNELS.git.testSshConnection)(input),
    listRepositories: invoke(IPC_CHANNELS.git.listRepositories),
    listRepositorySummaries: invoke(IPC_CHANNELS.git.listRepositorySummaries),
    addLocalRepository: (input) =>
      invoke(IPC_CHANNELS.git.addLocalRepository)(input),
    removeRepository: (input) =>
      invoke(IPC_CHANNELS.git.removeRepository)(input),
    cloneRepository: (input) =>
      invoke(IPC_CHANNELS.git.cloneRepository)(input),
    getSnapshot: (repositoryId) =>
      invoke(IPC_CHANNELS.git.getSnapshot)({ repositoryId }),
    getDiff: (input) =>
      invoke(IPC_CHANNELS.git.getDiff)(input),
    commit: (input) =>
      invoke(IPC_CHANNELS.git.commit)(input),
    fetch: (repositoryId) =>
      invoke(IPC_CHANNELS.git.fetch)({ repositoryId }),
    pull: (repositoryId) =>
      invoke(IPC_CHANNELS.git.pull)({ repositoryId }),
    push: (repositoryId) =>
      invoke(IPC_CHANNELS.git.push)({ repositoryId }),
    sync: (repositoryId) =>
      invoke(IPC_CHANNELS.git.sync)({ repositoryId }),
    listBranches: (repositoryId) =>
      invoke(IPC_CHANNELS.git.listBranches)({ repositoryId }),
    checkoutBranch: (repositoryId, branchName) =>
      invoke(IPC_CHANNELS.git.checkoutBranch)({ branchName, repositoryId }),
    createBranch: (repositoryId, branchName) =>
      invoke(IPC_CHANNELS.git.createBranch)({ branchName, repositoryId }),
    listHistory: (input) =>
      invoke(IPC_CHANNELS.git.listHistory)(input),
    getCommit: (repositoryId, hash) =>
      invoke(IPC_CHANNELS.git.getCommit)({ hash, repositoryId }),
  },
  account: {
    getState: invoke(IPC_CHANNELS.account.getState),
    startLogin: invoke(IPC_CHANNELS.account.startLogin),
    refresh: invoke(IPC_CHANNELS.account.refresh),
    logout: invoke(IPC_CHANNELS.account.logout),
    listWebhooks: invoke(IPC_CHANNELS.account.listWebhooks),
    listDriveItems: invoke(IPC_CHANNELS.account.listDriveItems),
    prepareDriveUpload: invoke(IPC_CHANNELS.account.prepareDriveUpload),
    prepareDriveFolderUpload: invoke(IPC_CHANNELS.account.prepareDriveFolderUpload),
    completeDriveUpload: invoke(IPC_CHANNELS.account.completeDriveUpload),
    uploadDrivePreparedFile: invoke(IPC_CHANNELS.account.uploadDrivePreparedFile),
    uploadDriveLocalItems: invokeWithFailureLogRequest(
      IPC_CHANNELS.account.uploadDriveLocalItems,
      summarizeDriveLocalUploadRequest,
    ),
    filePathForDroppedFile: (file: File) => webUtils.getPathForFile(file) || null,
    cancelDriveUpload: invoke(IPC_CHANNELS.account.cancelDriveUpload),
    createDriveFolder: invoke(IPC_CHANNELS.account.createDriveFolder),
    getDriveItemPreviewUrl: invoke(IPC_CHANNELS.account.getDriveItemPreviewUrl),
    renameDriveItem: invoke(IPC_CHANNELS.account.renameDriveItem),
    moveDriveItem: invoke(IPC_CHANNELS.account.moveDriveItem),
    deleteDriveItem: invoke(IPC_CHANNELS.account.deleteDriveItem),
    listDriveFileVersions: invoke(IPC_CHANNELS.account.listDriveFileVersions),
    downloadDriveFileVersion: invoke(IPC_CHANNELS.account.downloadDriveFileVersion),
    restoreDriveFileVersion: invoke(IPC_CHANNELS.account.restoreDriveFileVersion),
    deleteDriveFileVersion: invoke(IPC_CHANNELS.account.deleteDriveFileVersion),
    updateDriveFileVersionPin: invoke(IPC_CHANNELS.account.updateDriveFileVersionPin),
    resolveDriveLink: invoke(IPC_CHANNELS.account.resolveDriveLink),
    listDriveLink: invoke(IPC_CHANNELS.account.listDriveLink),
    readDriveLinkText: invoke(IPC_CHANNELS.account.readDriveLinkText),
    materializeDriveLink: invoke(IPC_CHANNELS.account.materializeDriveLink),
    downloadDriveLinkFile: invoke(IPC_CHANNELS.account.downloadDriveLinkFile),
    shareDriveItem: invoke(IPC_CHANNELS.account.shareDriveItem),
    disableDriveShare: invoke(IPC_CHANNELS.account.disableDriveShare),
    getDriveUsage: invoke(IPC_CHANNELS.account.getDriveUsage),
    getDriveShare: invoke(IPC_CHANNELS.account.getDriveShare),
    listDriveShares: invoke(IPC_CHANNELS.account.listDriveShares),
    listDrivePublicAssets: invoke(IPC_CHANNELS.account.listDrivePublicAssets),
    getDrivePublicAsset: invoke(IPC_CHANNELS.account.getDrivePublicAsset),
    uploadDrivePublicAssets: invokeWithFailureLogRequest(
      IPC_CHANNELS.account.uploadDrivePublicAssets,
      (input) => {
        const files = typeof input === "object" && input && "files" in input && Array.isArray(input.files)
          ? input.files
          : []
        return {
          fileCount: files.length,
          fileNames: files.map((file) => (
            typeof file === "object" && file && "name" in file && typeof file.name === "string" ? file.name : undefined
          )).slice(0, 10),
        }
      },
    ),
    uploadDrivePublicAssetBinary: invokeWithFailureLogRequest(
      IPC_CHANNELS.account.uploadDrivePublicAssetBinary,
      summarizeDrivePublicAssetBinaryUploadRequest,
    ),
    scanDriveDocumentImageSources: invokeWithFailureLogRequest(
      IPC_CHANNELS.account.scanDriveDocumentImageSources,
      summarizeDriveDocumentImageSourceContext,
    ),
    importDriveDocumentImages: invokeWithFailureLogRequest(
      IPC_CHANNELS.account.importDriveDocumentImages,
      summarizeDriveDocumentImageImportRequest,
    ),
    replaceDrivePublicAssetFile: invokeWithFailureLogRequest(
      IPC_CHANNELS.account.replaceDrivePublicAssetFile,
      (input) => {
        const payload = typeof input === "object" && input ? input : {}
        return {
          assetId: "assetId" in payload && typeof payload.assetId === "string" ? payload.assetId : undefined,
          fileName: "name" in payload && typeof payload.name === "string" ? payload.name : undefined,
        }
      },
    ),
    renameDrivePublicAsset: invoke(IPC_CHANNELS.account.renameDrivePublicAsset),
    trashDrivePublicAsset: invoke(IPC_CHANNELS.account.trashDrivePublicAsset),
    restoreDrivePublicAsset: invoke(IPC_CHANNELS.account.restoreDrivePublicAsset),
    preflightDriveSite: invoke(IPC_CHANNELS.account.preflightDriveSite),
    createDriveSite: invoke(IPC_CHANNELS.account.createDriveSite),
    listDriveSites: invoke(IPC_CHANNELS.account.listDriveSites),
    updateDriveSiteAccess: invoke(IPC_CHANNELS.account.updateDriveSiteAccess),
    disableDriveSite: invoke(IPC_CHANNELS.account.disableDriveSite),
    enableDriveSite: invoke(IPC_CHANNELS.account.enableDriveSite),
    deleteDriveSite: invoke(IPC_CHANNELS.account.deleteDriveSite),
    republishDriveSite: invoke(IPC_CHANNELS.account.republishDriveSite),
    listDriveTrash: invoke(IPC_CHANNELS.account.listDriveTrash),
    restoreDriveTrashItem: invoke(IPC_CHANNELS.account.restoreDriveTrashItem),
    deleteDriveTrashItem: invoke(IPC_CHANNELS.account.deleteDriveTrashItem),
    onStateChanged: createDomainEventPayloadSubscription<SynapseAccountStateChangedEvent>(
      subscribe,
      "account",
      "account.stateChanged",
    ),
    onDriveLocalUploadProgress: createDomainEventPayloadSubscription<DriveLocalUploadProgressEvent>(
      subscribe,
      "account",
      "account.driveLocalUploadProgress",
    ),
  },
  live: {
    getState: invoke(IPC_CHANNELS.live.getState),
    onStateChanged: createDomainEventPayloadSubscription<SynapseLiveStateChangedEvent>(
      subscribe,
      "live",
      "live.stateChanged",
    ),
  },
  content: {
    list: invoke(IPC_CHANNELS.content.list),
    getContent: invoke(IPC_CHANNELS.content.getContent),
    getDetail: invoke(IPC_CHANNELS.content.getDetail),
    getAttachmentFile: invoke(IPC_CHANNELS.content.getAttachmentFile),
    create: invoke(IPC_CHANNELS.content.create),
    update: invoke(IPC_CHANNELS.content.update),
    deleteContent: invoke(IPC_CHANNELS.content.deleteContent),
    onChanged: createDomainEventPayloadSubscription<SynapseContentChangedEvent>(
      subscribe,
      "content",
      "content.changed",
    ),
    listDeleted: invoke(IPC_CHANNELS.content.listDeleted),
    restore: invoke(IPC_CHANNELS.content.restore),
    purge: invoke(IPC_CHANNELS.content.purge),
    download: invoke(IPC_CHANNELS.content.download),
    openDetailWindow: invoke(IPC_CHANNELS.content.openDetailWindow),
    openCreateWindow: invoke(IPC_CHANNELS.content.openCreateWindow),
    openEditWindow: invoke(IPC_CHANNELS.content.openEditWindow),
    readEditorInitPayload: invoke(IPC_CHANNELS.content.readEditorInitPayload),
    getEditorAdapters: invoke(IPC_CHANNELS.content.getEditorAdapters),
    installToEditor: invoke(IPC_CHANNELS.content.installToEditor),
    readEditorInstallFormValues: invoke(IPC_CHANNELS.content.readEditorInstallFormValues),
    getIconPromptTemplate: invoke(IPC_CHANNELS.content.getIconPromptTemplate),
    readIconImage: invoke(IPC_CHANNELS.content.readIconImage),
    resolveEditorInstallTarget: invoke(IPC_CHANNELS.content.resolveEditorInstallTarget),
  },
  skillRepositoryInstall: {
    resolve: (sessionId) => invoke(IPC_CHANNELS["skill-repository-install"].resolve)({ sessionId }),
    prepare: (sessionId) => invoke(IPC_CHANNELS["skill-repository-install"].prepare)({ sessionId }),
    recordComplete: (sessionId) =>
      invoke(IPC_CHANNELS["skill-repository-install"].recordComplete)({ sessionId }),
  },
  installers: {
    inspectGlobalSkillInstallations: invoke(IPC_CHANNELS.installers.inspectGlobalSkillInstallations),
    inspectSkillEnvSource: invoke(IPC_CHANNELS.installers.inspectSkillEnvSource),
    installSourceToEditor: invoke(IPC_CHANNELS.installers.installSourceToEditor),
    installSourceToEditorTargets: invoke(IPC_CHANNELS.installers.installSourceToEditorTargets),
    prepareLocalSkillSource: invoke(IPC_CHANNELS.installers.prepareLocalSkillSource),
    prepareInlineRuleSource: invoke(IPC_CHANNELS.installers.prepareInlineRuleSource),
  },
  synapseSkill: {
    prepareInstallSource: invoke(IPC_CHANNELS["synapse-skill"].prepareInstallSource),
  },
  config: {
    exportBackup: invoke(IPC_CHANNELS.config.exportBackup),
    get: invoke(IPC_CHANNELS.config.get),
    importBackup: invoke(IPC_CHANNELS.config.importBackup),
    resetApp: invoke(IPC_CHANNELS.config.resetApp),
    update: invoke(IPC_CHANNELS.config.update),
  },
  identity: {
    adoptExistingUserId: (userId, repoId) =>
      invoke(IPC_CHANNELS.identity.adoptExistingUserId)({ repoId, userId }),
    generateNewId: invoke(IPC_CHANNELS.identity.generateNewId),
    getLocalState: invoke(IPC_CHANNELS.identity.getLocalState),
  },
  userProfile: {
    getRepoState: (repoId) => invoke(IPC_CHANNELS["user-profile"].getRepoState)({ repoId }),
    listRepoProfiles: (repoId) => invoke(IPC_CHANNELS["user-profile"].listRepoProfiles)({ repoId }),
    updateDisplayName: (repoId, displayName) =>
      invoke(IPC_CHANNELS["user-profile"].updateDisplayName)({ displayName, repoId }),
  },
  log: {
    clear: invoke(IPC_CHANNELS.log.clear),
    export: invoke(IPC_CHANNELS.log.export),
    listFiles: invoke(IPC_CHANNELS.log.listFiles),
    readAll: invoke(IPC_CHANNELS.log.readAll),
    readFiles: (fileNames: string[]) => invoke(IPC_CHANNELS.log.readFiles)(fileNames),
    write: (payload) => invoke(IPC_CHANNELS.log.write)(payload),
  },
  editor: {
    getGlobalDirectories: invoke(IPC_CHANNELS.editor.getGlobalDirectories),
    createDirectory: (dirPath: string) => invoke(IPC_CHANNELS.editor.createDirectory)({ dirPath }),
  },
  editorScan: {
    scanAll: invoke(IPC_CHANNELS["editor-scan"].scanAll),
    readItemContent: (filePath: string) =>
      invoke(IPC_CHANNELS["editor-scan"].readItemContent)({ filePath }),
    listSkillFiles: (dirPath: string) =>
      invoke(IPC_CHANNELS["editor-scan"].listSkillFiles)({ dirPath }),
    prepareQuickPublishDraft: (request) =>
      invoke(IPC_CHANNELS["editor-scan"].prepareQuickPublishDraft)(request),
    finalizeQuickPublish: (request) =>
      invoke(IPC_CHANNELS["editor-scan"].finalizeQuickPublish)(request),
    trashItem: (request) =>
      invoke(IPC_CHANNELS["editor-scan"].trashItem)(request),
    uploadSkillToSkillRepository: (request) =>
      invoke(IPC_CHANNELS["editor-scan"].uploadSkillToSkillRepository)(request),
  },
  editorCopy: {
    resolveTarget: invoke(IPC_CHANNELS["editor-copy"].resolveTarget),
    copy: invoke(IPC_CHANNELS["editor-copy"].copy),
  },
  editorInstallStatus: {
    resolveForContent: invoke(IPC_CHANNELS["editor-install-status"].resolveForContent),
  },
  installStatus: {
    getAll: invoke(IPC_CHANNELS["install-status"].getAll),
    uninstall: (payload: { contentId: string; editorId: string }) =>
      invoke(IPC_CHANNELS["install-status"].uninstall)(payload),
    onChanged: createDomainEventPayloadSubscription<InstallStatusChangedEvent>(
      subscribe,
      "install-status",
      "install-status.changed",
    ),
  },
  knowledgeBase: {
    createManaged: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].createManaged)(payload),
    deleteManaged: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].deleteManaged)(payload),
    listRawDirectory: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].listRawDirectory)(payload),
    uploadRawFiles: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].uploadRawFiles)(payload),
    uploadRawItems: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].uploadRawItems)(payload),
    createRawFolder: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].createRawFolder)(payload),
    renameRawEntry: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].renameRawEntry)(payload),
    moveRawEntries: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].moveRawEntries)(payload),
    trashRawEntries: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].trashRawEntries)(payload),
    addUrlSource: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].addUrlSource)(payload),
    selectAndUploadRawFiles: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].selectAndUploadRawFiles)(payload),
    selectAndUploadRawDirectory: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].selectAndUploadRawDirectory)(payload),
    exportRawEntries: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].exportRawEntries)(payload),
    openSourceManager: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].openSourceManager)(payload),
    getStorageStatus: invoke(IPC_CHANNELS["knowledge-base"].getStorageStatus),
    getStorageMigrationState: invoke(IPC_CHANNELS["knowledge-base"].getStorageMigrationState),
    startStorageMigration: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].startStorageMigration)(payload),
    cancelStorageMigration: invoke(IPC_CHANNELS["knowledge-base"].cancelStorageMigration),
    recheckStorage: invoke(IPC_CHANNELS["knowledge-base"].recheckStorage),
    onStorageMigrationChanged: createDomainEventPayloadSubscription<SynapseKnowledgeBaseStorageMigrationProgress>(
      subscribe,
      "knowledge-base",
      "knowledge-base.storageMigrationChanged",
    ),
    filePathForDroppedFile: (file: File) => webUtils.getPathForFile(file) || null,
  },
  shell: {
    openExternal: (url: string) => {
      return invoke(IPC_CHANNELS.shell.openExternal)({ url })
    },
    showItemInFolder: (filePath: string) => {
      return invoke(IPC_CHANNELS.shell.showItemInFolder)({ fullPath: filePath })
    },
    filePathForDroppedFile: (file: File) => webUtils.getPathForFile(file) || null,
  },
  repository: {
    checkInitializationPreview: (repositoryUuid) =>
      invoke(IPC_CHANNELS.repository.checkInitializationPreview)({ repositoryUuid }),
    createLocalRepository: (payload) =>
      invoke(IPC_CHANNELS.repository.createLocalRepository)(payload),
    chooseDirectory: invoke(IPC_CHANNELS.repository.chooseDirectory),
    flushPendingPushes: (repositoryUuid) =>
      invoke(IPC_CHANNELS.repository.flushPendingPushes)({ repositoryUuid }),
    getPendingPushes: (repositoryUuid) =>
      invoke(IPC_CHANNELS.repository.getPendingPushes)({ repositoryUuid }),
    getSyncSnapshots: invoke(IPC_CHANNELS.repository.getSyncSnapshots),
    getStates: invoke(IPC_CHANNELS.repository.getStates),
    initializeStructure: (repositoryUuid, options) =>
      invoke(IPC_CHANNELS.repository.initializeStructure)({ options, repositoryUuid }),
    onPendingPushesUpdated: createDomainEventPayloadSubscription<SynapsePendingPushUpdatedEvent>(
      subscribe,
      "repository",
      "repository.pendingPushesUpdated",
    ),
    onSyncSnapshotUpdated: createDomainEventPayloadSubscription<SynapseRepositorySyncSnapshotUpdatedEvent>(
      subscribe,
      "repository",
      "repository.syncSnapshotUpdated",
    ),
    runMaintenance: (repositoryUuid) =>
      invoke(IPC_CHANNELS.repository.runMaintenance)({ repositoryUuid }),
    sync: (repositoryUuid) => invoke(IPC_CHANNELS.repository.sync)({ repositoryUuid }),
    onProgress: createDomainEventPayloadSubscription<SynapseRepositoryProgressEvent>(
      subscribe,
      "repository",
      "repository.progress",
    ),
    onUpdated: createDomainEventPayloadSubscription<SynapseRepositoryUpdatedEvent>(
      subscribe,
      "repository",
      "repository.updated",
    ),
    validateDirectory: (targetPath) =>
      invoke(IPC_CHANNELS.repository.validateDirectory)({ targetPath }),
  },
  updater: {
    cancelDownload: invoke(IPC_CHANNELS.update.cancelDownload),
    checkForUpdates: invoke(IPC_CHANNELS.update.checkForUpdates),
    getState: invoke(IPC_CHANNELS.update.getState),
    installUpdate: invoke(IPC_CHANNELS.update.installUpdate),
    onStateChanged: createRawPayloadSubscription<SynapseAppUpdateState>(
      subscribe,
      EVENT_CHANNELS.update.stateChanged,
    ),
    onOpenUpdatePage: createRawPayloadSubscription<void>(
      subscribe,
      EVENT_CHANNELS.update.openUpdatePage,
    ),
  },
  cheatCodes: {
    getStates: (names?: readonly string[]) =>
      invoke(IPC_CHANNELS["cheat-code"].getStates)(names ? { names } : undefined),
    setState: (payload) => invoke(IPC_CHANNELS["cheat-code"].setState)(payload),
    toggleState: (name) => invoke(IPC_CHANNELS["cheat-code"].toggleState)({ name }),
    onStateChanged: createDomainEventPayloadSubscription<SynapseCheatCodeStateChangedEvent>(
      subscribe,
      "cheat-code",
      "cheat-code.stateChanged",
    ),
  },
  database: {
    databaseTableList: invoke(DATABASE_CHANNELS.databaseTableList),
    databaseTableCreate: (params) => invoke(DATABASE_CHANNELS.databaseTableCreate)(params),
    databaseTableDelete: (name) => invoke(DATABASE_CHANNELS.databaseTableDelete)(name),
    databaseTableDescribe: (name) => invoke(DATABASE_CHANNELS.databaseTableDescribe)(name),
    databaseOverviewGet: invoke(DATABASE_CHANNELS.databaseOverviewGet),
    databaseTableUpdate: (params) =>
      invoke(DATABASE_CHANNELS.databaseTableUpdate)(params),
    databaseColumnCreate: (params) => invoke(DATABASE_CHANNELS.databaseColumnCreate)(params),
    databaseColumnUpdate: (params) =>
      invoke(DATABASE_CHANNELS.databaseColumnUpdate)(params),
    databaseChoiceUpdate: (params) =>
      invoke(DATABASE_CHANNELS.databaseChoiceUpdate)(params),
    databaseChoiceUsageGet: (params) =>
      invoke(DATABASE_CHANNELS.databaseChoiceUsageGet)(params),
    databaseRowCreate: (params) => invoke(DATABASE_CHANNELS.databaseRowCreate)(params),
    databaseRowsCreate: (params) => invoke(DATABASE_CHANNELS.databaseRowsCreate)(params),
    databaseRowList: (params) => invoke(DATABASE_CHANNELS.databaseRowList)(params),
    databaseRowUpdate: (params) => invoke(DATABASE_CHANNELS.databaseRowUpdate)(params),
    databaseRowDelete: (params) => invoke(DATABASE_CHANNELS.databaseRowDelete)(params),
    databaseRowsUpdate: (params) => invoke(DATABASE_CHANNELS.databaseRowsUpdate)(params),
    databaseRowsDelete: (params) => invoke(DATABASE_CHANNELS.databaseRowsDelete)(params),
    databaseRowCount: (params) => invoke(DATABASE_CHANNELS.databaseRowCount)(params),
    databaseTableRename: (params) => invoke(DATABASE_CHANNELS.databaseTableRename)(params),
    databaseColumnRename: (params) => invoke(DATABASE_CHANNELS.databaseColumnRename)(params),
    databaseColumnDelete: (params) => invoke(DATABASE_CHANNELS.databaseColumnDelete)(params),
    databaseSqlExecute: (params) => invoke(DATABASE_CHANNELS.databaseSqlExecute)(params),
    databaseStatusGet: invoke(DATABASE_CHANNELS.databaseStatusGet),
    databaseExport: invoke(DATABASE_CHANNELS.databaseExport),
    databaseImport: invoke(DATABASE_CHANNELS.databaseImport),
    databaseTableExport: (table) => invoke(DATABASE_CHANNELS.databaseTableExport)(table),
    databaseTableImportInspect: invoke(DATABASE_CHANNELS.databaseTableImportInspect),
    databaseTableImport: (input) => invoke(DATABASE_CHANNELS.databaseTableImport)(input),
    databaseMcpHttpStatusGet: invoke(DATABASE_CHANNELS.databaseMcpHttpStatusGet),
    databaseMcpStatusGet: invoke(DATABASE_CHANNELS.databaseMcpStatusGet),
    databaseMcpServersGet: invoke(DATABASE_CHANNELS.databaseMcpServersGet),
    databaseMcpSettingsOpen: (target) =>
      invoke(DATABASE_CHANNELS.databaseMcpSettingsOpen)(target),
    databaseMcpRegister: (target) => invoke(DATABASE_CHANNELS.databaseMcpRegister)(target),
    databaseFolderList: invoke(DATABASE_CHANNELS.databaseFolderList),
    databaseFolderCreate: (params) => invoke(DATABASE_CHANNELS.databaseFolderCreate)(params),
    databaseFolderRename: (params) => invoke(DATABASE_CHANNELS.databaseFolderRename)(params),
    databaseFolderDelete: (params) => invoke(DATABASE_CHANNELS.databaseFolderDelete)(params),
    databaseFolderMoveTable: (params) => invoke(DATABASE_CHANNELS.databaseFolderMoveTable)(params),
    databaseFolderReorder: (params) => invoke(DATABASE_CHANNELS.databaseFolderReorder)(params),
    databaseFolderReorderFolders: (params) => invoke(DATABASE_CHANNELS.databaseFolderReorderFolders)(params),
    onChanged: createDomainEventPayloadSubscription<DatabaseChangeEvent>(
      subscribe,
      "database",
      "database.changed",
    ),
  },
  automation: {
    openCreateEditorWindow: () => invoke(IPC_CHANNELS.automation.openCreateEditorWindow)(),
    openEditorWindow: (id) => invoke(IPC_CHANNELS.automation.openEditorWindow)({ automationId: id }),
    listItems: invoke(IPC_CHANNELS.automation.listItems),
    getItem: (id) => invoke(IPC_CHANNELS.automation.getItem)({ automationId: id }),
    createItem: (input) => invoke(IPC_CHANNELS.automation.createItem)(input),
    updateItem: (payload) => invoke(IPC_CHANNELS.automation.updateItem)(payload),
    deleteItem: (id) => invoke(IPC_CHANNELS.automation.deleteItem)({ automationId: id }),
    setItemEnabled: (payload) =>
      invoke(IPC_CHANNELS.automation.setItemEnabled)({
        automationId: payload.id,
        enabled: payload.enabled,
      }),
    runItem: (id) => invoke(IPC_CHANNELS.automation.runItem)({ automationId: id }),
    stopRun: (runId) => invoke(IPC_CHANNELS.automation.stopRun)({ runId }),
    listRuns: (automationId, options) =>
      invoke(IPC_CHANNELS.automation.listRuns)({ automationId, limit: options?.limit }),
    onChanged: createDomainEventPayloadSubscription<AutomationChangedEvent>(
      subscribe,
      "automation",
      "automation.itemChanged",
    ),
  },
  agent: {
    status: (projectId) => invoke(IPC_CHANNELS.agent.status)({ projectId }),
    listSessions: (projectId) => invoke(IPC_CHANNELS.agent.listSessions)({ projectId }),
    listAllSessions: () => invoke(IPC_CHANNELS.agent.listAllSessions)({}),
    openConversationWindow: (request) => invoke(IPC_CHANNELS.agent.openConversationWindow)(request),
    focusConversationWindow: (target) => invoke(IPC_CHANNELS.agent.focusConversationWindow)(target),
    replaceConversationWindowTarget: (request) =>
      invoke(IPC_CHANNELS.agent.replaceConversationWindowTarget)(request),
    listDetachedConversationWindows: () => invoke(IPC_CHANNELS.agent.listDetachedConversationWindows)({}),
    getTimeline: (args) => invoke(IPC_CHANNELS.agent.getTimeline)(args),
    exportConversationBundle: (args) => invoke(IPC_CHANNELS.agent.exportConversationBundle)(args),
    createSession: (args) => invoke(IPC_CHANNELS.agent.createSession)(args),
    switchSession: (args) => invoke(IPC_CHANNELS.agent.switchSession)(args),
    updateSessionPersona: (args) => invoke(IPC_CHANNELS.agent.updateSessionPersona)(args),
    deleteSession: (args) => invoke(IPC_CHANNELS.agent.deleteSession)(args),
    renameSession: (args) => invoke(IPC_CHANNELS.agent.renameSession)(args),
    send: (args) => invoke(IPC_CHANNELS.agent.send)(args),
    listPendingPermissions: (projectId) =>
      invoke(IPC_CHANNELS.agent.listPendingPermissions)({ projectId }),
    respondPermission: (args) => invoke(IPC_CHANNELS.agent.respondPermission)(args),
    setPermissionMode: (args) => invoke(IPC_CHANNELS.agent.setPermissionMode)(args),
    cancelTurn: (args) => invoke(IPC_CHANNELS.agent.cancelTurn)(args),
    forceKillTurn: (args) => invoke(IPC_CHANNELS.agent.forceKillTurn)(args),
    getProviders: () => invoke(IPC_CHANNELS.agent.getProviders)({}),
    listProviders: () => invoke(IPC_CHANNELS.agent.listProviders)({}),
    listProviderPresets: () => invoke(IPC_CHANNELS.agent.listProviderPresets)({}),
    createProvider: (args) => invoke(IPC_CHANNELS.agent.createProvider)(args),
    createProviderFromPreset: (args) => invoke(IPC_CHANNELS.agent.createProviderFromPreset)(args),
    previewCcSwitchClaudeProviders: (args) =>
      invoke(IPC_CHANNELS.agent.previewCcSwitchClaudeProviders)(args ?? {}),
    importCcSwitchClaudeProviders: (args) =>
      invoke(IPC_CHANNELS.agent.importCcSwitchClaudeProviders)(args),
    chooseCcSwitchClaudeImportSource: () =>
      invoke(IPC_CHANNELS.agent.chooseCcSwitchClaudeImportSource)({}),
    chooseProviderPackageImportSource: () =>
      invoke(IPC_CHANNELS.agent.chooseProviderPackageImportSource)({}),
    chooseProviderPackageExportTarget: (args) =>
      invoke(IPC_CHANNELS.agent.chooseProviderPackageExportTarget)(args),
    previewProviderPackageImport: (args) =>
      invoke(IPC_CHANNELS.agent.previewProviderPackageImport)(args),
    importProviderPackage: (args) =>
      invoke(IPC_CHANNELS.agent.importProviderPackage)(args),
    exportProviderPackage: (args) =>
      invoke(IPC_CHANNELS.agent.exportProviderPackage)(args),
    updateProvider: (args) => invoke(IPC_CHANNELS.agent.updateProvider)(args),
    archiveProvider: (args) => invoke(IPC_CHANNELS.agent.archiveProvider)(args),
    deleteProvider: (args) => invoke(IPC_CHANNELS.agent.deleteProvider)(args),
    listAllProviders: () => invoke(IPC_CHANNELS.agent.listAllProviders)({}),
    scanProviderReferences: (args) => invoke(IPC_CHANNELS.agent.scanProviderReferences)(args),
    migrateProviderReferences: (args) => invoke(IPC_CHANNELS.agent.migrateProviderReferences)(args),
    setActiveProvider: (args) => invoke(IPC_CHANNELS.agent.setActiveProvider)(args),
    getRuntimeStatus: invoke(IPC_CHANNELS.agent.getRuntimeStatus),
    listCommands: (projectId) => invoke(IPC_CHANNELS.agent.listCommands)({ projectId }),
    openReference: (args) => invoke(IPC_CHANNELS.agent.openReference)(args),
    openConversation: (target) => invoke(IPC_CHANNELS.agent.openConversation)(target),
    getAvailableAgents: () => invoke(IPC_CHANNELS.agent.getAvailableAgents)({}),
    onOpenConversation: createRawPayloadSubscription<OpenAgentSessionPayload>(
      subscribe,
      OPEN_AGENT_SESSION_EVENT,
    ),
    onEvent: createRawPayloadSubscription<SynapseAgentDomainEvent>(
      subscribe,
      EVENT_CHANNELS.agent.event,
    ),
    onDetachedConversationWindowsChanged: createRawPayloadSubscription<AgentDetachedConversation[]>(
      subscribe,
      EVENT_CHANNELS.agent.detachedConversationsChanged,
    ),
  },
  ops: {
    diagnostics: (payload) => invoke(IPC_CHANNELS.ops.diagnostics)(payload ?? {}),
    runDiagnostics: (payload) => invoke(IPC_CHANNELS.ops.runDiagnostics)(payload ?? {}),
    exportDiagnosticsBundle: (payload) => invoke(IPC_CHANNELS.ops.exportDiagnosticsBundle)(payload),
    ping: invoke(IPC_CHANNELS.ops.ping),
    openLogDirectory: invoke(IPC_CHANNELS.ops.openLogDirectory),
    runAsGet: (projectId) => invoke(IPC_CHANNELS.ops.runAsGet)({ projectId }),
    runAsUpdate: (payload) => invoke(IPC_CHANNELS.ops.runAsUpdate)(payload),
    runAsPreflight: (projectId) => invoke(IPC_CHANNELS.ops.runAsPreflight)({ projectId }),
    runAsAuditProbe: (projectId) => invoke(IPC_CHANNELS.ops.runAsAuditProbe)({ projectId }),
    webhookStatus: invoke(IPC_CHANNELS.ops.webhookStatus),
    webhookUpdate: (payload) => invoke(IPC_CHANNELS.ops.webhookUpdate)(payload),
    webhookRuns: (payload) => invoke(IPC_CHANNELS.ops.webhookRuns)(payload),
    relayBindings: (payload) => invoke(IPC_CHANNELS.ops.relayBindings)(payload),
    relayRuns: (payload) => invoke(IPC_CHANNELS.ops.relayRuns)(payload),
    relayUnbind: (id) => invoke(IPC_CHANNELS.ops.relayUnbind)({ id }),
    compressGet: (projectId) => invoke(IPC_CHANNELS.ops.compressGet)({ projectId }),
    compressUpdate: (payload) => invoke(IPC_CHANNELS.ops.compressUpdate)(payload),
  },
  workflow: {
    list: invoke(IPC_CHANNELS.workflow.list),
    get: (id: string) => invoke(IPC_CHANNELS.workflow.get)({ id }),
    create: () => invoke(IPC_CHANNELS.workflow.create)(),
    save: (def) => invoke(IPC_CHANNELS.workflow.save)(def),
    delete: (id: string) => invoke(IPC_CHANNELS.workflow.delete)({ id }),
    validate: (def) => invoke(IPC_CHANNELS.workflow.validate)(def),
    run: (id: string, params: Record<string, unknown>) => invoke(IPC_CHANNELS.workflow.run)({ id, params }),
    runDefinition: (def: unknown, params: Record<string, unknown>, force?: boolean) =>
      invoke(IPC_CHANNELS.workflow.runDefinition)({ definition: def, params, force }),
    rerun: (previousRunId: string, params: Record<string, unknown>, force?: boolean) =>
      invoke(IPC_CHANNELS.workflow.rerun)({ previousRunId, params, force }),
    openRunner: (workflowId: string, runId: string) =>
      invoke(IPC_CHANNELS.workflow.openRunner)({ workflowId, runId }),
    cancel: (runId: string) => invoke(IPC_CHANNELS.workflow.cancel)({ runId }),
    activeRuns: () => invoke(IPC_CHANNELS.workflow.activeRuns)(),
    runHistory: (workflowId: string) => invoke(IPC_CHANNELS.workflow.runHistory)({ workflowId }),
    runStatus: (runId: string) => invoke(IPC_CHANNELS.workflow.runStatus)({ runId }),
    openEditor: (id: string, runId?: string) => invoke(IPC_CHANNELS.workflow.openEditor)({ id, runId }),
    editorState: invoke(IPC_CHANNELS.workflow.editorState),
    checkCanSync: invoke(IPC_CHANNELS.workflow.checkCanSync),
    exportPackage: (workflowId: string, workflowName?: string) =>
      invoke(IPC_CHANNELS.workflow.exportPackage)({ workflowId, workflowName }),
    inspectImportPackage: () => invoke(IPC_CHANNELS.workflow.inspectImportPackage)(),
    importPackage: (packagePath: string, mappings, options, packageDigest?: string) =>
      invoke(IPC_CHANNELS.workflow.importPackage)({ packagePath, packageDigest, mappings, options }),
    chooseParamFile: () => invoke(IPC_CHANNELS.workflow.chooseParamFile)(),
    chooseParamDirectory: () => invoke(IPC_CHANNELS.workflow.chooseParamDirectory)(),
    chooseParamFiles: () => invoke(IPC_CHANNELS.workflow.chooseParamFiles)(),
    chooseParamDirectories: () => invoke(IPC_CHANNELS.workflow.chooseParamDirectories)(),
    onEvent: (listener) =>
      subscribe(EVENT_CHANNELS.workflow.event)((domainEvent) => {
        listener((domainEvent as DomainEvent).payload as WorkflowEvent)
      }),
    onDefinitionUpdated: createDomainEventPayloadSubscription<{ workflowId: string; source?: string; versionHash?: string }>(
      subscribe,
      "workflow",
      "workflow:definition-updated",
    ),
    onRunnerSwitchRun: createRawPayloadSubscription<{ runId: string }>(
      subscribe,
      "synapse:workflow:runner-switch-run",
    ),
    onEditorRefocus: createRawPayloadSubscription<{ runId?: string }>(
      subscribe,
      "synapse:workflow:editor-refocus",
    ),
  },
  workflowParamPresets: {
    list: (workflowId: string) => invoke(IPC_CHANNELS.workflow.paramPresetsList)({ workflowId }),
    save: (input) => invoke(IPC_CHANNELS.workflow.paramPresetsSave)(input),
    delete: (id: string) => invoke(IPC_CHANNELS.workflow.paramPresetsDelete)({ id }),
  },
  usageAnalysis: {
    cc: {
      refresh: (input) => input
        ? invoke(IPC_CHANNELS["usage-analysis"].ccRefresh)(input)
        : invoke(IPC_CHANNELS["usage-analysis"].ccRefresh)(),
      getOverview: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccOverview)(range),
      getTime: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccTime)(range),
      getModels: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccModels)(range),
      getProjects: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccProjects)(range),
      getTools: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccTools)(range),
      getDetails: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccDetails)(range),
      listRecords: (input) => invoke(IPC_CHANNELS["usage-analysis"].ccRecordsList)(input),
      listRecordDetails: (input) => invoke(IPC_CHANNELS["usage-analysis"].ccRecordDetailsList)(input),
      listConversations: (input) => invoke(IPC_CHANNELS["usage-analysis"].ccConversationsList)(input),
      getConversation: (sessionId, focus) =>
        invoke(IPC_CHANNELS["usage-analysis"].ccConversationGet)({ sessionId, focus }),
      getConversationChunk: (input) => invoke(IPC_CHANNELS["usage-analysis"].ccConversationChunkGet)(input),
      searchRecordsText: (input) => invoke(IPC_CHANNELS["usage-analysis"].ccRecordsSearchText)(input),
      searchConversationText: (input) => invoke(IPC_CHANNELS["usage-analysis"].ccConversationSearchText)(input),
      openConversationWindow: (request) => invoke(IPC_CHANNELS["usage-analysis"].ccConversationWindowOpen)(request),
    },
    codex: {
      refresh: (input) => input
        ? invoke(IPC_CHANNELS["usage-analysis"].codexRefresh)(input)
        : invoke(IPC_CHANNELS["usage-analysis"].codexRefresh)(),
      getOverview: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexOverview)(range),
      getTime: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexTime)(range),
      getModels: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexModels)(range),
      getProjects: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexProjects)(range),
      getTools: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexTools)(range),
      getDetails: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexDetails)(range),
    },
    getPricingRules: invoke(IPC_CHANNELS["usage-analysis"].pricingRulesGet),
    savePricingRules: (rules) => invoke(IPC_CHANNELS["usage-analysis"].pricingRulesSave)(rules),
    resetPricingRules: invoke(IPC_CHANNELS["usage-analysis"].pricingRulesReset),
  },
  modelPrice: {
    listCoverage: (input) => invoke(IPC_CHANNELS["model-price"].coverageList)(input),
    listPresets: invoke(IPC_CHANNELS["model-price"].presetsList),
    importPreset: (presetId) => invoke(IPC_CHANNELS["model-price"].presetsImport)(presetId),
    importPresets: (presetIds) => invoke(IPC_CHANNELS["model-price"].presetsImport)(presetIds),
    getRules: invoke(IPC_CHANNELS["model-price"].rulesGet),
    saveRules: (rules) => invoke(IPC_CHANNELS["model-price"].rulesSave)(rules),
    clearRules: invoke(IPC_CHANNELS["model-price"].rulesClear),
    // Compatibility bridge: legacy reset callers now use clear semantics.
    resetRules: invoke(IPC_CHANNELS["model-price"].rulesReset),
  },
  http: {
    testRequest: invoke(HTTP_CHANNELS.testRequest),
  },
  diagnostics: {
    onPing: (listener: () => void) => {
      const wrapped = () => listener()
      ipcRenderer.on(EVENT_CHANNELS.diagnostics.ping, wrapped)
      return () => { ipcRenderer.removeListener(EVENT_CHANNELS.diagnostics.ping, wrapped) }
    },
    pong: () => {
      ipcRenderer.send(EVENT_CHANNELS.diagnostics.pong)
    },
  },
}

contextBridge.exposeInMainWorld("synapse", synapseBridge)
