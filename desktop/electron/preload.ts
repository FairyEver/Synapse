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
import type { SynapseAppUpdateOpenRequest, SynapseAppUpdateState } from "../src/types/update"
import type { AutomationChangedEvent } from "../src/types/automation"
import type { WorkflowEvent } from "../src/types/workflow"
import type { SynapseCheatCodeStateChangedEvent } from "../src/types/cheat-code"
import type { SynapseKnowledgeBaseStorageMigrationProgress } from "../src/types/knowledge-base"
import type { SynapseGitUserFacingFailure } from "../src/types/git"
import type {
  SynapseTerminalDataEvent,
  SynapseTerminalSession,
  SynapseTerminalSessionDeletedEvent,
} from "../src/types/terminal"
import { IPC_CHANNELS } from "./generated/ipc-channels.generated"
import type { DomainEvent, EventDomain, Unsubscribe } from "./runtime/event-bus"

const OPEN_AGENT_SESSION_EVENT = "synapse:app:open_agent_session:operation"
const IPC_ERROR_ENVELOPE_KEY = "__synapseIpcError"

type IpcErrorEnvelope = {
  readonly [IPC_ERROR_ENVELOPE_KEY]: true
  readonly message: string
  readonly name?: string
  readonly userFacingFailure?: SynapseGitUserFacingFailure
}


// Legacy event channels that are not declared by IpcModule descriptors yet.
const EVENT_CHANNELS = {
  update: {
    stateChanged: "synapse:app:update:operation:state_changed",
    openUpdatePage: "synapse:app:update:operation:open_update_page",
  },
  agent: {
    detachedConversationsChanged: "synapse:app:agent:operation:detached_conversations_changed",
  },
  diagnostics: {
    ping: "synapse:app:diagnostics:operation:ping",
    pong: "synapse:app:diagnostics:operation:pong",
  },
  apps: {
    contentOpenRequest: "synapse:app:apps:operation:content_open_request",
  },
}

// HTTP test channels (not yet migrated to IpcModule)
const HTTP_CHANNELS = {
  testRequest: "synapse:app:http:operation:test_request",
} as const

const DATABASE_CHANNELS = IPC_CHANNELS.database

type RawSubscribe = (channel: string) => (listener: (payload: unknown) => void) => Unsubscribe

const channelForDomain = (domain: EventDomain): string =>
  `synapse:app:events:operation:${domain.replaceAll("-", "_")}`

const operationIdForChannel = (channel: string): string =>
  channel.startsWith("synapse:app:")
    ? channel.slice("synapse:".length).replaceAll(":", ".")
    : channel

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
const SENSITIVE_IPC_MAP_FIELD_PATTERN = /^(skillEnvValues|skillEnvReplacementValues|variableSubstitutions|skillEnvSecretNames|variableSecretNames)$/i
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
  if (SENSITIVE_IPC_MAP_FIELD_PATTERN.test(fieldName)) {
    return sensitiveIpcMapSummary(value)
  }
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

function sensitiveIpcMapSummary(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "[redacted]"
  return {
    type: "sensitive-map",
    keyCount: Object.keys(value as Record<string, unknown>).length,
  }
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
      operationId: operationIdForChannel(channel),
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
    template: { choose: () => invoke(IPC_CHANNELS.documentTemplate.chooseTemplateFile)() },
    json: { choose: () => invoke(IPC_CHANNELS.documentTemplate.chooseJsonFile)() },
    output: { choose: (input) => invoke(IPC_CHANNELS.documentTemplate.chooseOutputFile)(input) },
    docx: { generate: (input) => invoke(IPC_CHANNELS.documentTemplate.generateDocx)(input) },
  },
  skillUninstaller: {
    scan: invoke(IPC_CHANNELS["skill-uninstaller"].scan),
    scanNames: invoke(IPC_CHANNELS["skill-uninstaller"].scanNames),
    cancelScan: invoke(IPC_CHANNELS["skill-uninstaller"].cancelScan),
    cancelUninstall: invoke(IPC_CHANNELS["skill-uninstaller"].cancelUninstall),
    uninstall: invoke(IPC_CHANNELS["skill-uninstaller"].uninstall),
  },
  quickInput: {
    item: {
      list: () => invoke(IPC_CHANNELS.quickInput.list)(),
      create: (input) => invoke(IPC_CHANNELS.quickInput.create)(input),
      update: (input) => invoke(IPC_CHANNELS.quickInput.update)(input),
      delete: (input) => invoke(IPC_CHANNELS.quickInput.delete)(input),
      onChanged: createRawPayloadSubscription(subscribe, IPC_CHANNELS.quickInput.changed),
    },
  },
  secrets: {
    item: {
      list: () => invoke(IPC_CHANNELS.secrets.list)(),
      get: (input) => invoke(IPC_CHANNELS.secrets.get)(input),
      create: (input) => invokeWithFailureLogRequest(IPC_CHANNELS.secrets.create, summarizeSecretsMutationRequest)(input),
      update: (input) => invokeWithFailureLogRequest(IPC_CHANNELS.secrets.update, summarizeSecretsMutationRequest)(input),
      upsert: (input) => invokeWithFailureLogRequest(IPC_CHANNELS.secrets.upsert, summarizeSecretsMutationRequest)(input),
      delete: (input) => invoke(IPC_CHANNELS.secrets.delete)(input),
      onChanged: createRawPayloadSubscription(subscribe, IPC_CHANNELS.secrets.changed),
    },
    operation: {
      scanSkillEnvBindings: (input) => invoke(IPC_CHANNELS.secrets.scanSkillEnvBindings)(input),
      scanSkillEnvBindingsBatch: (input) => invoke(IPC_CHANNELS.secrets.scanSkillEnvBindingsBatch)(input),
      queueSkillEnvBindings: (input) => invoke(IPC_CHANNELS.secrets.queueSkillEnvBindings)(input),
    },
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
    settings: {
      get: () => invoke(IPC_CHANNELS.soundNotifier.getSettings)(),
      update: (input) => invoke(IPC_CHANNELS.soundNotifier.updateSettings)(input),
    },
    sound: {
      play: (input = {}) => invoke(IPC_CHANNELS.soundNotifier.play)(input),
      preview: (input = {}) => invoke(IPC_CHANNELS.soundNotifier.preview)(input),
    },
    operation: {
      onChanged: createRawPayloadSubscription(subscribe, IPC_CHANNELS.soundNotifier.changed),
      onPlayRequested: createRawPayloadSubscription(subscribe, IPC_CHANNELS.soundNotifier.playRequested),
    },
  },
  terminal: {
    group: {
      chooseDefaultCwd: () => invoke(IPC_CHANNELS.terminal.chooseDefaultCwd)(),
      list: () => invoke(IPC_CHANNELS.terminal.listGroups)(),
      create: (input) => invoke(IPC_CHANNELS.terminal.createGroup)(input),
      rename: (input) => invoke(IPC_CHANNELS.terminal.renameGroup)(input),
      updateSettings: (input) => invoke(IPC_CHANNELS.terminal.updateGroupSettings)(input),
      delete: (input) => invoke(IPC_CHANNELS.terminal.deleteGroup)(input),
    },
    groupCommand: {
      create: (input) => invoke(IPC_CHANNELS.terminal.createGroupCommand)(input),
      update: (input) => invoke(IPC_CHANNELS.terminal.updateGroupCommand)(input),
      delete: (input) => invoke(IPC_CHANNELS.terminal.deleteGroupCommand)(input),
      launch: (input) => invoke(IPC_CHANNELS.terminal.launchGroupCommand)(input),
    },
    session: {
      list: () => invoke(IPC_CHANNELS.terminal.listSessions)(),
      create: (input) => invoke(IPC_CHANNELS.terminal.createSession)(input),
      get: (input) => invoke(IPC_CHANNELS.terminal.getSession)(input),
      read: (input) => invoke(IPC_CHANNELS.terminal.readSession)(input),
      rename: (input) => invoke(IPC_CHANNELS.terminal.renameSession)(input),
      write: (input) => invoke(IPC_CHANNELS.terminal.writeSession)(input),
      resize: (input) => invoke(IPC_CHANNELS.terminal.resizeSession)(input),
      delete: (input) => invoke(IPC_CHANNELS.terminal.deleteSession)(input),
      stop: (input) => invoke(IPC_CHANNELS.terminal.stopSession)(input),
      runStartupCommand: (input) => invoke(IPC_CHANNELS.terminal.runStartupCommand)(input),
    },
    operation: {
      onData: createRawPayloadSubscription<SynapseTerminalDataEvent>(subscribe, IPC_CHANNELS.terminal.data),
      onSessionChanged: createRawPayloadSubscription<SynapseTerminalSession>(subscribe, IPC_CHANNELS.terminal.sessionChanged),
      onSessionDeleted: createRawPayloadSubscription<SynapseTerminalSessionDeletedEvent>(subscribe, IPC_CHANNELS.terminal.sessionDeleted),
    },
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
    onStateChanged: createDomainEventPayloadSubscription<SynapseAccountStateChangedEvent>(
      subscribe,
      "account",
      "account.stateChanged",
    ),
  },
  drive: {
    item: {
      list: invoke(IPC_CHANNELS.account.listDriveItems),
      previewUrl: invoke(IPC_CHANNELS.account.getDriveItemPreviewUrl),
      rename: invoke(IPC_CHANNELS.account.renameDriveItem),
      move: invoke(IPC_CHANNELS.account.moveDriveItem),
      delete: invoke(IPC_CHANNELS.account.deleteDriveItem),
    },
    upload: {
      prepare: invoke(IPC_CHANNELS.account.prepareDriveUpload),
      folder: { prepare: invoke(IPC_CHANNELS.account.prepareDriveFolderUpload) },
      complete: invoke(IPC_CHANNELS.account.completeDriveUpload),
      put: invoke(IPC_CHANNELS.account.uploadDrivePreparedFile),
      localItems: invokeWithFailureLogRequest(
        IPC_CHANNELS.account.uploadDriveLocalItems,
        summarizeDriveLocalUploadRequest,
      ),
      cancel: invoke(IPC_CHANNELS.account.cancelDriveUpload),
      onLocalProgress: createDomainEventPayloadSubscription<DriveLocalUploadProgressEvent>(
        subscribe,
        "account",
        "account.driveLocalUploadProgress",
      ),
    },
    localFile: { pathForDroppedFile: (file: File) => webUtils.getPathForFile(file) || null },
    folder: { create: invoke(IPC_CHANNELS.account.createDriveFolder) },
    fileVersion: {
      list: invoke(IPC_CHANNELS.account.listDriveFileVersions),
      restore: invoke(IPC_CHANNELS.account.restoreDriveFileVersion),
      delete: invoke(IPC_CHANNELS.account.deleteDriveFileVersion),
    },
    fileVersionDownload: { create: invoke(IPC_CHANNELS.account.downloadDriveFileVersion) },
    fileVersionPin: { update: invoke(IPC_CHANNELS.account.updateDriveFileVersionPin) },
    link: {
      resolve: invoke(IPC_CHANNELS.account.resolveDriveLink),
      list: invoke(IPC_CHANNELS.account.listDriveLink),
      readText: invoke(IPC_CHANNELS.account.readDriveLinkText),
      materialize: invoke(IPC_CHANNELS.account.materializeDriveLink),
      downloadFile: invoke(IPC_CHANNELS.account.downloadDriveLinkFile),
    },
    share: {
      create: invoke(IPC_CHANNELS.account.shareDriveItem),
      disable: invoke(IPC_CHANNELS.account.disableDriveShare),
      get: invoke(IPC_CHANNELS.account.getDriveShare),
      list: invoke(IPC_CHANNELS.account.listDriveShares),
    },
    usage: { get: invoke(IPC_CHANNELS.account.getDriveUsage) },
    directLink: {
      list: invoke(IPC_CHANNELS.account.listDrivePublicAssets),
      get: invoke(IPC_CHANNELS.account.getDrivePublicAsset),
      upload: invokeWithFailureLogRequest(
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
      uploadBinary: invokeWithFailureLogRequest(
        IPC_CHANNELS.account.uploadDrivePublicAssetBinary,
        summarizeDrivePublicAssetBinaryUploadRequest,
      ),
      update: invokeWithFailureLogRequest(
        IPC_CHANNELS.account.replaceDrivePublicAssetFile,
        (input) => {
          const payload = typeof input === "object" && input ? input : {}
          return {
            assetId: "assetId" in payload && typeof payload.assetId === "string" ? payload.assetId : undefined,
            fileName: "name" in payload && typeof payload.name === "string" ? payload.name : undefined,
          }
        },
      ),
      rename: invoke(IPC_CHANNELS.account.renameDrivePublicAsset),
      delete: invoke(IPC_CHANNELS.account.trashDrivePublicAsset),
      restore: invoke(IPC_CHANNELS.account.restoreDrivePublicAsset),
    },
    documentImages: {
      scan: invokeWithFailureLogRequest(
        IPC_CHANNELS.account.scanDriveDocumentImageSources,
        summarizeDriveDocumentImageSourceContext,
      ),
      import: invokeWithFailureLogRequest(
        IPC_CHANNELS.account.importDriveDocumentImages,
        summarizeDriveDocumentImageImportRequest,
      ),
    },
    site: {
      preflight: invoke(IPC_CHANNELS.account.preflightDriveSite),
      create: invoke(IPC_CHANNELS.account.createDriveSite),
      list: invoke(IPC_CHANNELS.account.listDriveSites),
      updateAccess: invoke(IPC_CHANNELS.account.updateDriveSiteAccess),
      disable: invoke(IPC_CHANNELS.account.disableDriveSite),
      enable: invoke(IPC_CHANNELS.account.enableDriveSite),
      delete: invoke(IPC_CHANNELS.account.deleteDriveSite),
      republish: invoke(IPC_CHANNELS.account.republishDriveSite),
    },
    trash: {
      list: invoke(IPC_CHANNELS.account.listDriveTrash),
      restore: invoke(IPC_CHANNELS.account.restoreDriveTrashItem),
      delete: invoke(IPC_CHANNELS.account.deleteDriveTrashItem),
    },
  },
  live: {
    getState: invoke(IPC_CHANNELS.live.getState),
    onStateChanged: createDomainEventPayloadSubscription<SynapseLiveStateChangedEvent>(
      subscribe,
      "live",
      "live.stateChanged",
    ),
  },
  resourceRepository: {
    item: {
      list: invoke(IPC_CHANNELS.content.list),
      create: invoke(IPC_CHANNELS.content.create),
      update: invoke(IPC_CHANNELS.content.update),
      restore: invoke(IPC_CHANNELS.content.restore),
      purge: invoke(IPC_CHANNELS.content.purge),
      download: invoke(IPC_CHANNELS.content.download),
      onChanged: createDomainEventPayloadSubscription<SynapseContentChangedEvent>(
        subscribe,
        "content",
        "content.changed",
      ),
    },
    operation: {
      getContent: invoke(IPC_CHANNELS.content.getContent),
      getDetail: invoke(IPC_CHANNELS.content.getDetail),
      getAttachmentFile: invoke(IPC_CHANNELS.content.getAttachmentFile),
      deleteContent: invoke(IPC_CHANNELS.content.deleteContent),
      listDeleted: invoke(IPC_CHANNELS.content.listDeleted),
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
    releaseInstallSource: (preparedSourceId) => invoke(IPC_CHANNELS["synapse-skill"].releaseInstallSource)({ preparedSourceId }),
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
    cancelScan: invoke(IPC_CHANNELS["editor-scan"].cancelScan),
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
    retrySkillRepositoryIdentity: (request) =>
      invoke(IPC_CHANNELS["editor-scan"].retrySkillRepositoryIdentity)(request),
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
  settings: {
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
  },
  updater: {
    acknowledgeOpenRequest: (id) =>
      invoke(IPC_CHANNELS.update.acknowledgeOpenRequest)({ id }),
    cancelDownload: invoke(IPC_CHANNELS.update.cancelDownload),
    checkForUpdates: invoke(IPC_CHANNELS.update.checkForUpdates),
    checkForUpdatesOnPageEnter: invoke(IPC_CHANNELS.update.checkForUpdatesOnPageEnter),
    downloadUpdate: invoke(IPC_CHANNELS.update.downloadUpdate),
    getPendingOpenRequest: invoke(IPC_CHANNELS.update.getPendingOpenRequest),
    getState: invoke(IPC_CHANNELS.update.getState),
    installUpdate: invoke(IPC_CHANNELS.update.installUpdate),
    onOpenRequest: createRawPayloadSubscription<SynapseAppUpdateOpenRequest>(
      subscribe,
      IPC_CHANNELS.update.openRequest,
    ),
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
    table: {
      list: invoke(DATABASE_CHANNELS.databaseTableList),
      create: (params) => invoke(DATABASE_CHANNELS.databaseTableCreate)(params),
      delete: (name) => invoke(DATABASE_CHANNELS.databaseTableDelete)(name),
      describe: (name) => invoke(DATABASE_CHANNELS.databaseTableDescribe)(name),
      update: (params) => invoke(DATABASE_CHANNELS.databaseTableUpdate)(params),
      rename: (params) => invoke(DATABASE_CHANNELS.databaseTableRename)(params),
      export: (table) => invoke(DATABASE_CHANNELS.databaseTableExport)(table),
      import: (input) => invoke(DATABASE_CHANNELS.databaseTableImport)(input),
    },
    tableImport: { inspect: invoke(DATABASE_CHANNELS.databaseTableImportInspect) },
    overview: { get: invoke(DATABASE_CHANNELS.databaseOverviewGet) },
    column: {
      create: (params) => invoke(DATABASE_CHANNELS.databaseColumnCreate)(params),
      update: (params) => invoke(DATABASE_CHANNELS.databaseColumnUpdate)(params),
      rename: (params) => invoke(DATABASE_CHANNELS.databaseColumnRename)(params),
      delete: (params) => invoke(DATABASE_CHANNELS.databaseColumnDelete)(params),
    },
    choice: { update: (params) => invoke(DATABASE_CHANNELS.databaseChoiceUpdate)(params) },
    choiceUsage: { get: (params) => invoke(DATABASE_CHANNELS.databaseChoiceUsageGet)(params) },
    row: {
      create: (params) => invoke(DATABASE_CHANNELS.databaseRowCreate)(params),
      list: (params) => invoke(DATABASE_CHANNELS.databaseRowList)(params),
      update: (params) => invoke(DATABASE_CHANNELS.databaseRowUpdate)(params),
      delete: (params) => invoke(DATABASE_CHANNELS.databaseRowDelete)(params),
      count: (params) => invoke(DATABASE_CHANNELS.databaseRowCount)(params),
    },
    rows: {
      create: (params) => invoke(DATABASE_CHANNELS.databaseRowsCreate)(params),
      update: (params) => invoke(DATABASE_CHANNELS.databaseRowsUpdate)(params),
      delete: (params) => invoke(DATABASE_CHANNELS.databaseRowsDelete)(params),
    },
    sql: { execute: (params) => invoke(DATABASE_CHANNELS.databaseSqlExecute)(params) },
    status: { get: invoke(DATABASE_CHANNELS.databaseStatusGet) },
    operation: {
      export: invoke(DATABASE_CHANNELS.databaseExport),
      import: invoke(DATABASE_CHANNELS.databaseImport),
      onChanged: createDomainEventPayloadSubscription<DatabaseChangeEvent>(
        subscribe,
        "database",
        "database.changed",
      ),
    },
    mcpHttpStatus: { get: invoke(DATABASE_CHANNELS.databaseMcpHttpStatusGet) },
    mcpStatus: { get: invoke(DATABASE_CHANNELS.databaseMcpStatusGet) },
    mcpServers: { get: invoke(DATABASE_CHANNELS.databaseMcpServersGet) },
    mcpSettings: { open: (target) => invoke(DATABASE_CHANNELS.databaseMcpSettingsOpen)(target) },
    mcp: { register: (target) => invoke(DATABASE_CHANNELS.databaseMcpRegister)(target) },
    folder: {
      list: invoke(DATABASE_CHANNELS.databaseFolderList),
      create: (params) => invoke(DATABASE_CHANNELS.databaseFolderCreate)(params),
      rename: (params) => invoke(DATABASE_CHANNELS.databaseFolderRename)(params),
      delete: (params) => invoke(DATABASE_CHANNELS.databaseFolderDelete)(params),
      moveTable: (params) => invoke(DATABASE_CHANNELS.databaseFolderMoveTable)(params),
      reorder: (params) => invoke(DATABASE_CHANNELS.databaseFolderReorder)(params),
      reorderFolders: (params) => invoke(DATABASE_CHANNELS.databaseFolderReorderFolders)(params),
    },
  },
  automation: {
    editor: {
      openCreate: () => invoke(IPC_CHANNELS.automation.openCreateEditorWindow)(),
      openEdit: (id) => invoke(IPC_CHANNELS.automation.openEditorWindow)({ automationId: id }),
    },
    item: {
      list: invoke(IPC_CHANNELS.automation.listItems),
      get: (id) => invoke(IPC_CHANNELS.automation.getItem)({ automationId: id }),
      create: (input) => invoke(IPC_CHANNELS.automation.createItem)(input),
      update: (payload) => invoke(IPC_CHANNELS.automation.updateItem)(payload),
      delete: (id) => invoke(IPC_CHANNELS.automation.deleteItem)({ automationId: id }),
      setEnabled: (payload) => invoke(IPC_CHANNELS.automation.setItemEnabled)({
        automationId: payload.id,
        enabled: payload.enabled,
      }),
      onChanged: createDomainEventPayloadSubscription<AutomationChangedEvent>(
        subscribe,
        "automation",
        "automation.itemChanged",
      ),
    },
    run: {
      execute: (id) => invoke(IPC_CHANNELS.automation.runItem)({ automationId: id }),
      disable: (runId) => invoke(IPC_CHANNELS.automation.stopRun)({ runId }),
      list: (automationId, options) => invoke(IPC_CHANNELS.automation.listRuns)({ automationId, limit: options?.limit }),
    },
  },
  agent: {
    status: (projectId) => invoke(IPC_CHANNELS.agent.status)({ projectId }),
    listSessions: (projectId) => invoke(IPC_CHANNELS.agent.listSessions)({ projectId }),
    listAllSessions: (request: { excludeProjectIds?: string[]; limit?: number }) =>
      invoke(IPC_CHANNELS.agent.listAllSessions)(request),
    openConversationWindow: (request) => invoke(IPC_CHANNELS.agent.openConversationWindow)(request),
    focusConversationWindow: (target) => invoke(IPC_CHANNELS.agent.focusConversationWindow)(target),
    replaceConversationWindowTarget: (request) =>
      invoke(IPC_CHANNELS.agent.replaceConversationWindowTarget)(request),
    listDetachedConversationWindows: () => invoke(IPC_CHANNELS.agent.listDetachedConversationWindows)({}),
    getTimeline: (args) => invoke(IPC_CHANNELS.agent.getTimeline)(args),
    exportConversationBundle: (args) => invoke(IPC_CHANNELS.agent.exportConversationBundle)(args),
    createSession: (args) => invoke(IPC_CHANNELS.agent.createSession)(args),
    switchSession: (args) => invoke(IPC_CHANNELS.agent.switchSession)(args),
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
      channelForDomain("agent"),
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
    definition: {
      list: invoke(IPC_CHANNELS.workflow.list),
      get: (id: string) => invoke(IPC_CHANNELS.workflow.get)({ id }),
      create: () => invoke(IPC_CHANNELS.workflow.create)(),
      update: (def) => invoke(IPC_CHANNELS.workflow.save)(def),
      delete: (id: string, options?: { cleanupImportedChildren?: boolean }) => invoke(IPC_CHANNELS.workflow.delete)({ id, ...options }),
      inspect: (def) => invoke(IPC_CHANNELS.workflow.validate)(def),
    },
    run: {
      execute: (id: string, params: Record<string, unknown>) => invoke(IPC_CHANNELS.workflow.run)({ id, params }),
      disable: (runId: string) => invoke(IPC_CHANNELS.workflow.cancel)({ runId }),
      listActive: () => invoke(IPC_CHANNELS.workflow.activeRuns)(),
      list: (workflowId: string) => invoke(IPC_CHANNELS.workflow.runHistory)({ workflowId }),
      get: (runId: string, workflowId?: string) => invoke(IPC_CHANNELS.workflow.runStatus)({ runId, workflowId }),
    },
    operation: {
      runDefinition: (def: unknown, params: Record<string, unknown>, force?: boolean) =>
        invoke(IPC_CHANNELS.workflow.runDefinition)({ definition: def, params, force }),
      rerun: (previousRunId: string, params: Record<string, unknown>, force?: boolean, workflowId?: string) =>
        invoke(IPC_CHANNELS.workflow.rerun)({ previousRunId, params, force, workflowId }),
      openRunner: (workflowId: string, runId: string) =>
        invoke(IPC_CHANNELS.workflow.openRunner)({ workflowId, runId }),
      openEditor: (id: string, runId?: string) => invoke(IPC_CHANNELS.workflow.openEditor)({ id, runId }),
      editorState: invoke(IPC_CHANNELS.workflow.editorState),
      setEditorMutationState: (workflowId: string, dirty: boolean, saving: boolean) =>
        invoke(IPC_CHANNELS.workflow.setEditorMutationState)({ workflowId, dirty, saving }),
      checkCanSync: invoke(IPC_CHANNELS.workflow.checkCanSync),
      inspectDeletePackage: (workflowId: string) =>
        invoke(IPC_CHANNELS.workflow.inspectDeletePackage)({ workflowId }),
      inspectExportPackage: (workflowId: string) =>
        invoke(IPC_CHANNELS.workflow.inspectExportPackage)({ workflowId }),
      exportPackage: (workflowId: string, workflowName?: string, migrationDiagnosticId?: string, shareNote?: string, expectedDigestSeed?: string) =>
        invoke(IPC_CHANNELS.workflow.exportPackage)({
          workflowId,
          workflowName,
          ...(migrationDiagnosticId ? { migrationDiagnosticId } : {}),
          ...(shareNote !== undefined ? { shareNote } : {}),
          ...(expectedDigestSeed !== undefined ? { expectedDigestSeed } : {}),
        }),
      inspectImportPackage: () => invoke(IPC_CHANNELS.workflow.inspectImportPackage)(),
      importPackage: (packagePath: string, mappings, options, packageDigest?: string) =>
        invoke(IPC_CHANNELS.workflow.importPackage)({ packagePath, packageDigest, mappings, options }),
      importSharePackage: (packagePath: string, selections, packageDigest: string) =>
        invoke(IPC_CHANNELS.workflow.importPackage)({ packagePath, packageDigest, selections }),
      undoShareImport: (lineageId: string) => invoke(IPC_CHANNELS.workflow.undoShareImport)({ lineageId }),
      onEvent: (listener) =>
        subscribe(channelForDomain("workflow"))((domainEvent) => {
          listener((domainEvent as DomainEvent).payload as WorkflowEvent)
        }),
      onRunnerSwitchRun: createRawPayloadSubscription<{ runId: string }>(
        subscribe,
        "synapse:app:workflow:operation:runner_switch_run",
      ),
      onEditorRefocus: createRawPayloadSubscription<{ runId?: string }>(
        subscribe,
        "synapse:app:workflow:operation:editor_refocus",
      ),
    },
    paramFile: { choose: () => invoke(IPC_CHANNELS.workflow.chooseParamFile)() },
    paramDirectory: { choose: () => invoke(IPC_CHANNELS.workflow.chooseParamDirectory)() },
    paramFiles: { choose: () => invoke(IPC_CHANNELS.workflow.chooseParamFiles)() },
    paramDirectories: { choose: () => invoke(IPC_CHANNELS.workflow.chooseParamDirectories)() },
    paramPreset: {
      list: (workflowId: string) => invoke(IPC_CHANNELS.workflow.paramPresetsList)({ workflowId }),
      resolveResourceEntryTypes: (id: string) => invoke(IPC_CHANNELS.workflow.paramPresetsResolveResourceEntryTypes)({ id }),
      save: (input) => invoke(IPC_CHANNELS.workflow.paramPresetsSave)(input),
      delete: (id: string) => invoke(IPC_CHANNELS.workflow.paramPresetsDelete)({ id }),
    },
    editor: {
      onDefinitionUpdated: createDomainEventPayloadSubscription<{ workflowId: string; source?: string; versionHash?: string }>(
        subscribe,
        "workflow",
        "workflow:definition-updated",
      ),
    },
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
  },
  modelPrice: {
    usedModel: {
      list: (input) => invoke(IPC_CHANNELS["model-price"].coverageList)(input),
    },
    preset: {
      list: invoke(IPC_CHANNELS["model-price"].presetsList),
      import: (presetIds) => invoke(IPC_CHANNELS["model-price"].presetsImport)(presetIds),
    },
    rule: {
      list: invoke(IPC_CHANNELS["model-price"].rulesGet),
      save: (rules) => invoke(IPC_CHANNELS["model-price"].rulesSave)(rules),
      clear: invoke(IPC_CHANNELS["model-price"].rulesClear),
    },
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
