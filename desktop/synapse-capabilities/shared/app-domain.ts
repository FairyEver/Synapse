import {
  DOCUMENT_TEMPLATE_CAPABILITY_ID,
  DOCUMENT_TEMPLATE_MCP_TOOL_NAME,
} from "../../app-capabilities/document-template/shared/capability"
import {
  TERMINAL_GROUP_COMMAND_CREATE_CAPABILITY_ID,
  TERMINAL_GROUP_COMMAND_DELETE_CAPABILITY_ID,
  TERMINAL_GROUP_COMMAND_LAUNCH_CAPABILITY_ID,
  TERMINAL_GROUP_COMMAND_UPDATE_CAPABILITY_ID,
  TERMINAL_GROUP_CREATE_CAPABILITY_ID,
  TERMINAL_GROUP_DELETE_CAPABILITY_ID,
  TERMINAL_GROUP_LIST_CAPABILITY_ID,
  TERMINAL_GROUP_RENAME_CAPABILITY_ID,
  TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID,
  TERMINAL_MCP_TOOL_NAMES,
  TERMINAL_SESSION_CREATE_CAPABILITY_ID,
  TERMINAL_SESSION_DELETE_CAPABILITY_ID,
  TERMINAL_SESSION_GET_CAPABILITY_ID,
  TERMINAL_SESSION_LIST_CAPABILITY_ID,
  TERMINAL_SESSION_READ_CAPABILITY_ID,
  TERMINAL_SESSION_RENAME_CAPABILITY_ID,
  TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
  TERMINAL_SESSION_STOP_CAPABILITY_ID,
  TERMINAL_SESSION_WRITE_CAPABILITY_ID,
} from "../../app-capabilities/terminal/shared/capability"
import {
  SECRETS_CAPABILITY_IDS,
  SECRETS_ITEM_CREATE_CAPABILITY_ID,
  SECRETS_ITEM_DELETE_CAPABILITY_ID,
  SECRETS_ITEM_GET_CAPABILITY_ID,
  SECRETS_ITEM_LIST_CAPABILITY_ID,
  SECRETS_ITEM_UPDATE_CAPABILITY_ID,
  SECRETS_ITEM_UPSERT_CAPABILITY_ID,
  SECRETS_MCP_TOOL_NAMES,
} from "../../app-capabilities/secrets/shared/capability"
import {
  SOUND_NOTIFIER_PLAY_CAPABILITY_ID,
  SOUND_NOTIFIER_PLAY_MCP_TOOL_NAME,
} from "../../app-capabilities/sound-notifier/shared/capability"
import {
  SOUND_NOTIFIER_DEFAULT_INTERVAL_MS,
  SOUND_NOTIFIER_DEFAULT_REPEAT_COUNT,
  SOUND_NOTIFIER_EVENT_TYPES,
  SOUND_NOTIFIER_MAX_INTERVAL_MS,
  SOUND_NOTIFIER_MAX_REPEAT_COUNT,
  SOUND_NOTIFIER_MIN_INTERVAL_MS,
  SOUND_NOTIFIER_MIN_REPEAT_COUNT,
  SOUND_NOTIFIER_PRESET_IDS,
} from "../../app-capabilities/sound-notifier/shared/defaults"
import {
  SWARM_TASK_CAPABILITY_IDS,
  SWARM_TASK_MCP_TOOL_NAMES,
  SWARM_TASK_RUN_CANCEL_CAPABILITY_ID,
  SWARM_TASK_RUN_GET_CAPABILITY_ID,
  SWARM_TASK_RUN_LIST_CAPABILITY_ID,
  SWARM_TASK_RUN_START_CAPABILITY_ID,
  SWARM_TASK_RUN_STOP_REFILL_CAPABILITY_ID,
  SWARM_TASK_TASK_CREATE_CAPABILITY_ID,
  SWARM_TASK_TASK_DELETE_CAPABILITY_ID,
  SWARM_TASK_TASK_GET_CAPABILITY_ID,
  SWARM_TASK_TASK_LIST_CAPABILITY_ID,
  SWARM_TASK_TASK_UPDATE_CAPABILITY_ID,
} from "../../app-capabilities/swarm-task/shared/capability"
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"

const appCapabilities: readonly CapabilityDefinition[] = [
  {
    id: DOCUMENT_TEMPLATE_CAPABILITY_ID,
    title: "Generate Word document from template",
    description: "Generate a local .docx file from a local .docx template and JSON object data.",
    mutates: true,
  },
  {
    id: TERMINAL_GROUP_CREATE_CAPABILITY_ID,
    title: "Create terminal group",
    description: "Create a Synapse terminal group.",
    mutates: true,
  },
  {
    id: TERMINAL_GROUP_LIST_CAPABILITY_ID,
    title: "List terminal groups",
    description: "List Synapse terminal groups.",
    mutates: false,
  },
  {
    id: TERMINAL_GROUP_RENAME_CAPABILITY_ID,
    title: "Rename terminal group",
    description: "Rename a Synapse terminal group.",
    mutates: true,
  },
  {
    id: TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID,
    title: "Update terminal group settings",
    description: "Update a terminal group's name and default working directory.",
    mutates: true,
  },
  {
    id: TERMINAL_GROUP_COMMAND_CREATE_CAPABILITY_ID,
    title: "Create terminal group command",
    description: "Create a named command under a Synapse terminal group.",
    mutates: true,
  },
  {
    id: TERMINAL_GROUP_COMMAND_UPDATE_CAPABILITY_ID,
    title: "Update terminal group command",
    description: "Update a named command under a Synapse terminal group.",
    mutates: true,
  },
  {
    id: TERMINAL_GROUP_COMMAND_DELETE_CAPABILITY_ID,
    title: "Delete terminal group command",
    description: "Delete a named command from a Synapse terminal group.",
    mutates: true,
  },
  {
    id: TERMINAL_GROUP_COMMAND_LAUNCH_CAPABILITY_ID,
    title: "Launch terminal group command",
    description: "Create a new terminal session from a named terminal group command.",
    mutates: true,
  },
  {
    id: TERMINAL_GROUP_DELETE_CAPABILITY_ID,
    title: "Delete terminal group",
    description: "Delete a Synapse terminal group and all sessions in it.",
    mutates: true,
  },
  {
    id: TERMINAL_SESSION_CREATE_CAPABILITY_ID,
    title: "Create terminal session",
    description: "Create a Synapse-managed terminal session.",
    mutates: true,
  },
  {
    id: TERMINAL_SESSION_LIST_CAPABILITY_ID,
    title: "List terminal sessions",
    description: "List Synapse terminal sessions.",
    mutates: false,
  },
  {
    id: TERMINAL_SESSION_GET_CAPABILITY_ID,
    title: "Get terminal session",
    description: "Get terminal session status.",
    mutates: false,
  },
  {
    id: TERMINAL_SESSION_READ_CAPABILITY_ID,
    title: "Read terminal output",
    description: "Read retained terminal output by sequence cursor.",
    mutates: false,
  },
  {
    id: TERMINAL_SESSION_RENAME_CAPABILITY_ID,
    title: "Rename terminal session",
    description: "Rename a Synapse terminal session.",
    mutates: true,
  },
  {
    id: TERMINAL_SESSION_WRITE_CAPABILITY_ID,
    title: "Write terminal input",
    description: "Write raw input to a Synapse terminal session.",
    mutates: true,
  },
  {
    id: TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
    title: "Resize terminal session",
    description: "Resize a terminal session pty.",
    mutates: true,
  },
  {
    id: TERMINAL_SESSION_DELETE_CAPABILITY_ID,
    title: "Delete terminal session",
    description: "Delete a Synapse terminal session and its retained output.",
    mutates: true,
  },
  {
    id: TERMINAL_SESSION_STOP_CAPABILITY_ID,
    title: "Stop terminal session",
    description: "Stop a Synapse terminal session.",
    mutates: true,
  },
  {
    id: SOUND_NOTIFIER_PLAY_CAPABILITY_ID,
    title: "Play sound",
    description: "Play a semantic Sound Notifier reminder on the local computer.",
    mutates: false,
  },
  ...SECRETS_CAPABILITY_IDS.map((id): CapabilityDefinition => ({
    id,
    title: secretsCapabilityTitle(id),
    description: secretsCapabilityDescription(id),
    mutates: !id.endsWith(".list") && !id.endsWith(".get"),
    risk: "high",
  })),
  ...SWARM_TASK_CAPABILITY_IDS.map((id): CapabilityDefinition => ({
    id,
    title: swarmTaskCapabilityTitle(id),
    description: swarmTaskCapabilityDescription(id),
    mutates: !id.endsWith(".list") && !id.endsWith(".get"),
  })),
]

export const APP_DOMAIN: CapabilityDomainDefinition = {
  id: "app",
  capabilities: appCapabilities,
}

export const APP_MCP_TOOL_ACTIONS: Record<string, string> = {
  [DOCUMENT_TEMPLATE_MCP_TOOL_NAME]: DOCUMENT_TEMPLATE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.groupCreate]: TERMINAL_GROUP_CREATE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.groupList]: TERMINAL_GROUP_LIST_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.groupRename]: TERMINAL_GROUP_RENAME_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.groupUpdateSettings]: TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.groupCommandCreate]: TERMINAL_GROUP_COMMAND_CREATE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.groupCommandUpdate]: TERMINAL_GROUP_COMMAND_UPDATE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.groupCommandDelete]: TERMINAL_GROUP_COMMAND_DELETE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.groupCommandLaunch]: TERMINAL_GROUP_COMMAND_LAUNCH_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.groupDelete]: TERMINAL_GROUP_DELETE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionCreate]: TERMINAL_SESSION_CREATE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionList]: TERMINAL_SESSION_LIST_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionGet]: TERMINAL_SESSION_GET_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionRead]: TERMINAL_SESSION_READ_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionRename]: TERMINAL_SESSION_RENAME_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionWrite]: TERMINAL_SESSION_WRITE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionResize]: TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionDelete]: TERMINAL_SESSION_DELETE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionStop]: TERMINAL_SESSION_STOP_CAPABILITY_ID,
  [SOUND_NOTIFIER_PLAY_MCP_TOOL_NAME]: SOUND_NOTIFIER_PLAY_CAPABILITY_ID,
  [SECRETS_MCP_TOOL_NAMES.list]: SECRETS_ITEM_LIST_CAPABILITY_ID,
  [SECRETS_MCP_TOOL_NAMES.get]: SECRETS_ITEM_GET_CAPABILITY_ID,
  [SECRETS_MCP_TOOL_NAMES.create]: SECRETS_ITEM_CREATE_CAPABILITY_ID,
  [SECRETS_MCP_TOOL_NAMES.update]: SECRETS_ITEM_UPDATE_CAPABILITY_ID,
  [SECRETS_MCP_TOOL_NAMES.upsert]: SECRETS_ITEM_UPSERT_CAPABILITY_ID,
  [SECRETS_MCP_TOOL_NAMES.delete]: SECRETS_ITEM_DELETE_CAPABILITY_ID,
  [SWARM_TASK_MCP_TOOL_NAMES.taskCreate]: SWARM_TASK_TASK_CREATE_CAPABILITY_ID,
  [SWARM_TASK_MCP_TOOL_NAMES.taskList]: SWARM_TASK_TASK_LIST_CAPABILITY_ID,
  [SWARM_TASK_MCP_TOOL_NAMES.taskGet]: SWARM_TASK_TASK_GET_CAPABILITY_ID,
  [SWARM_TASK_MCP_TOOL_NAMES.taskUpdate]: SWARM_TASK_TASK_UPDATE_CAPABILITY_ID,
  [SWARM_TASK_MCP_TOOL_NAMES.taskDelete]: SWARM_TASK_TASK_DELETE_CAPABILITY_ID,
  [SWARM_TASK_MCP_TOOL_NAMES.runStart]: SWARM_TASK_RUN_START_CAPABILITY_ID,
  [SWARM_TASK_MCP_TOOL_NAMES.runStopRefill]: SWARM_TASK_RUN_STOP_REFILL_CAPABILITY_ID,
  [SWARM_TASK_MCP_TOOL_NAMES.runCancel]: SWARM_TASK_RUN_CANCEL_CAPABILITY_ID,
  [SWARM_TASK_MCP_TOOL_NAMES.runList]: SWARM_TASK_RUN_LIST_CAPABILITY_ID,
  [SWARM_TASK_MCP_TOOL_NAMES.runGet]: SWARM_TASK_RUN_GET_CAPABILITY_ID,
}

const stringField = (description: string, options?: { minLength?: number; maxLength?: number }) => ({
  type: "string",
  ...options,
  description,
})
const positiveIntField = (description: string, maximum?: number) => ({
  type: "integer",
  minimum: 1,
  ...(maximum ? { maximum } : {}),
  description,
})
const nonnegativeIntField = (description: string) => ({
  type: "integer",
  minimum: 0,
  description,
})
const booleanField = (description: string) => ({ type: "boolean", description })

const sessionIdProperty = stringField("Terminal session id.", { minLength: 1 })
const strictEmptyInputSchema = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
}
const swarmTaskConfigSchema = {
  type: "object",
  properties: {
    projectId: stringField("Agent project id.", { minLength: 1 }),
    workspacePath: stringField("Absolute workspace path used by swarm workers.", { minLength: 1 }),
    prompt: stringField("Worker prompt.", { minLength: 1, maxLength: 256 * 1024 }),
    presetId: stringField("Optional preset id. Defaults to general.", { minLength: 1 }),
    injectOptions: {
      type: "object",
      properties: {
        workerIdentity: booleanField("Inject worker identity."),
        roundContext: booleanField("Inject round context."),
        runContext: booleanField("Inject run context."),
        outputProtocol: booleanField("Inject output protocol."),
        parallelContext: booleanField("Inject parallel context."),
        gitContext: booleanField("Inject git context."),
        customAppendix: stringField("Custom prompt appendix.", { maxLength: 16 * 1024 }),
      },
      additionalProperties: false,
    },
    runMode: {
      type: "string",
      enum: ["batch", "continuous"],
      description: "batch runs a bounded swarm; continuous can refill workers.",
    },
    concurrency: positiveIntField("Maximum parallel workers.", 20),
    maxRounds: positiveIntField("Maximum rounds.", 500),
    output: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["managed-directory", "target-file", "both"],
          description: "Where workers write outputs.",
        },
        managedDirectory: stringField("Optional managed output directory.", { minLength: 1 }),
        targetFile: stringField("Optional target output file.", { minLength: 1 }),
        targetFilePolicy: {
          type: "string",
          enum: ["append-only", "section-update", "free-edit"],
          description: "How workers may write the target file.",
        },
      },
      additionalProperties: false,
    },
    summary: {
      type: "object",
      properties: {
        enabled: booleanField("Ask workers to emit a summary."),
        injectRecent: booleanField("Inject recent summaries into later rounds."),
        recentLimit: positiveIntField("Number of recent summaries to inject.", 20),
      },
      additionalProperties: false,
    },
    handoff: {
      type: "object",
      properties: {
        enabled: booleanField("Ask each worker to leave a handoff for the next round."),
      },
      additionalProperties: false,
    },
    agent: {
      type: "object",
      properties: {
        providerId: stringField("Optional provider id.", { minLength: 1 }),
        modelTier: stringField("Optional model tier.", { minLength: 1 }),
        permissionMode: stringField("Optional permission mode.", { minLength: 1 }),
        mainThreadPersonaId: stringField("Optional persona id.", { minLength: 1 }),
      },
      additionalProperties: false,
    },
  },
  required: ["projectId", "workspacePath", "prompt"],
  additionalProperties: false,
} as const

export function buildAppTools(): McpToolDefinition[] {
  return [
    {
      name: DOCUMENT_TEMPLATE_MCP_TOOL_NAME,
      description: "Generate a local .docx file from a .docx template and JSON data. Provide exactly one of dataPath or data. Existing outputPath is rejected unless overwrite is true.",
      inputSchema: {
        type: "object",
        properties: {
          templatePath: stringField("Absolute local .docx template path."),
          outputPath: stringField("Absolute local .docx output path."),
          dataPath: stringField("Absolute local .json data path. Mutually exclusive with data."),
          data: {
            type: "object",
            description: "Inline JSON object data. Mutually exclusive with dataPath.",
          },
          overwrite: {
            type: "boolean",
            description: "When true, replace outputPath if it already exists. Defaults to false.",
          },
        },
        required: ["templatePath", "outputPath"],
        anyOf: [
          { required: ["dataPath"] },
          { required: ["data"] },
        ],
      },
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.groupCreate,
      description: "Create a Synapse terminal group.",
      inputSchema: {
        type: "object",
        properties: {
          name: stringField("Group name.", { minLength: 1, maxLength: 80 }),
        },
        required: ["name"],
      },
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.groupList,
      description: "List Synapse terminal groups.",
      inputSchema: strictEmptyInputSchema,
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.groupRename,
      description: "Rename a Synapse terminal group.",
      inputSchema: {
        type: "object",
        properties: {
          groupId: stringField("Terminal group id.", { minLength: 1 }),
          name: stringField("New group name. Leading and trailing whitespace is trimmed.", { minLength: 1, maxLength: 80 }),
        },
        required: ["groupId", "name"],
      },
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.groupUpdateSettings,
      description: "Update a terminal group's name and default working directory.",
      inputSchema: {
        type: "object",
        properties: {
          groupId: stringField("Terminal group id.", { minLength: 1 }),
          name: stringField("Group name. Leading and trailing whitespace is trimmed.", { minLength: 1, maxLength: 80 }),
          settings: {
            type: "object",
            properties: {
              defaultCwd: stringField("Optional absolute working directory for future sessions in this group.", { minLength: 1 }),
            },
            additionalProperties: false,
          },
        },
        required: ["groupId", "name"],
      },
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.groupCommandCreate,
      description: "Create a named command under a Synapse terminal group.",
      inputSchema: {
        type: "object",
        properties: {
          groupId: stringField("Terminal group id.", { minLength: 1 }),
          name: stringField("Command display name.", { minLength: 1, maxLength: 80 }),
          command: stringField("Multi-line command text.", { minLength: 1, maxLength: 64 * 1024 }),
        },
        required: ["groupId", "name", "command"],
      },
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.groupCommandUpdate,
      description: "Update a named command under a Synapse terminal group.",
      inputSchema: {
        type: "object",
        properties: {
          groupId: stringField("Terminal group id.", { minLength: 1 }),
          commandId: stringField("Terminal group command id.", { minLength: 1 }),
          name: stringField("Command display name.", { minLength: 1, maxLength: 80 }),
          command: stringField("Multi-line command text.", { minLength: 1, maxLength: 64 * 1024 }),
        },
        required: ["groupId", "commandId", "name", "command"],
      },
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.groupCommandDelete,
      description: "Delete a named command from a Synapse terminal group.",
      inputSchema: {
        type: "object",
        properties: {
          groupId: stringField("Terminal group id.", { minLength: 1 }),
          commandId: stringField("Terminal group command id.", { minLength: 1 }),
        },
        required: ["groupId", "commandId"],
      },
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.groupCommandLaunch,
      description: "Create a new terminal session from a named command and run it in the group default directory.",
      inputSchema: {
        type: "object",
        properties: {
          groupId: stringField("Terminal group id.", { minLength: 1 }),
          commandId: stringField("Terminal group command id.", { minLength: 1 }),
          cols: positiveIntField("Optional terminal columns. Defaults to 80.", 500),
          rows: positiveIntField("Optional terminal rows. Defaults to 24.", 200),
        },
        required: ["groupId", "commandId"],
      },
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.groupDelete,
      description: "Delete a Synapse terminal group and every terminal session in it. Running sessions are stopped before deletion.",
      inputSchema: {
        type: "object",
        properties: {
          groupId: stringField("Terminal group id.", { minLength: 1 }),
        },
        required: ["groupId"],
      },
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.sessionCreate,
      description: "Create a Synapse-managed terminal session using the user's default shell.",
      inputSchema: {
        type: "object",
        properties: {
          groupId: stringField("Optional group id. Defaults to the first group or creates the default group.", { minLength: 1 }),
          title: stringField("Optional session title.", { minLength: 1, maxLength: 120 }),
          cwd: stringField("Optional existing absolute working directory.", { minLength: 1 }),
          cols: positiveIntField("Optional terminal columns. Defaults to 80.", 500),
          rows: positiveIntField("Optional terminal rows. Defaults to 24.", 200),
        },
      },
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.sessionList,
      description: "List Synapse terminal sessions.",
      inputSchema: strictEmptyInputSchema,
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.sessionGet,
      description: "Get terminal session status.",
      inputSchema: {
        type: "object",
        properties: { sessionId: sessionIdProperty },
        required: ["sessionId"],
      },
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.sessionRead,
      description: "Read retained terminal output by sequence cursor.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: sessionIdProperty,
          afterSeq: nonnegativeIntField("Optional sequence cursor. Returns output after this sequence."),
          limitBytes: positiveIntField("Optional maximum bytes to read. Maximum 1048576.", 1024 * 1024),
        },
        required: ["sessionId"],
      },
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.sessionRename,
      description: "Rename a Synapse terminal session.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: sessionIdProperty,
          title: stringField("New session title. Leading and trailing whitespace is trimmed.", { minLength: 1, maxLength: 120 }),
        },
        required: ["sessionId", "title"],
      },
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.sessionWrite,
      description: "Write raw input to a Synapse terminal session. Include a newline to submit a shell command.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: sessionIdProperty,
          data: stringField("Raw terminal input.", { minLength: 1, maxLength: 64 * 1024 }),
        },
        required: ["sessionId", "data"],
      },
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.sessionResize,
      description: "Resize a running terminal session pty.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: sessionIdProperty,
          cols: positiveIntField("Terminal columns.", 500),
          rows: positiveIntField("Terminal rows.", 200),
        },
        required: ["sessionId", "cols", "rows"],
      },
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.sessionDelete,
      description: "Delete a Synapse terminal session and its retained output. Running sessions are stopped before deletion.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: sessionIdProperty,
        },
        required: ["sessionId"],
      },
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.sessionStop,
      description: "Stop a Synapse terminal session.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: sessionIdProperty,
          force: booleanField("When true, force stop if supported."),
        },
        required: ["sessionId"],
      },
    },
    {
      name: SOUND_NOTIFIER_PLAY_MCP_TOOL_NAME,
      description: "Play a short local Sound Notifier reminder. Prefer eventType so the sound matches the reminder situation.",
      inputSchema: {
        type: "object",
        properties: {
          eventType: {
            type: "string",
            enum: SOUND_NOTIFIER_EVENT_TYPES,
            description: "Reminder event type: message, input-required, success, long-running-complete, or error. Defaults to message.",
          },
          presetId: {
            type: "string",
            enum: SOUND_NOTIFIER_PRESET_IDS,
            description: "legacy sound preset id. Prefer eventType. Do not pass both eventType and presetId.",
          },
          repeatCount: {
            type: "integer",
            minimum: SOUND_NOTIFIER_MIN_REPEAT_COUNT,
            maximum: SOUND_NOTIFIER_MAX_REPEAT_COUNT,
            description: `Optional repeat count for this reminder. Defaults to ${SOUND_NOTIFIER_DEFAULT_REPEAT_COUNT}.`,
          },
          intervalMs: {
            type: "integer",
            minimum: SOUND_NOTIFIER_MIN_INTERVAL_MS,
            maximum: SOUND_NOTIFIER_MAX_INTERVAL_MS,
            description: `Optional start-to-start interval in milliseconds between repeated plays. Defaults to ${SOUND_NOTIFIER_DEFAULT_INTERVAL_MS}.`,
          },
        },
        oneOf: [
          { required: ["eventType"], not: { required: ["presetId"] } },
          { required: ["presetId"], not: { required: ["eventType"] } },
          { not: { anyOf: [{ required: ["eventType"] }, { required: ["presetId"] }] } },
        ],
        additionalProperties: false,
      },
    },
    {
      name: SECRETS_MCP_TOOL_NAMES.list,
      description: "List user-scoped local secrets as safe metadata. Values are never returned.",
      inputSchema: strictEmptyInputSchema,
    },
    {
      name: SECRETS_MCP_TOOL_NAMES.get,
      description: "Get one user-scoped local secret. Set includeValue to true only when the stored value is explicitly needed.",
      inputSchema: {
        type: "object",
        properties: {
          name: stringField("Secret name. Letters, digits, and underscores only.", { minLength: 1 }),
          includeValue: booleanField("When true, return the stored value after secret-read permission."),
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: SECRETS_MCP_TOOL_NAMES.create,
      description: "Create a user-scoped local secret. Fails if the name already exists.",
      inputSchema: {
        type: "object",
        properties: {
          name: stringField("Secret name. Letters, digits, and underscores only.", { minLength: 1 }),
          value: stringField("Secret value."),
          description: stringField("Optional secret description."),
        },
        required: ["name", "value"],
        additionalProperties: false,
      },
    },
    {
      name: SECRETS_MCP_TOOL_NAMES.update,
      description: "Update an existing user-scoped local secret value or description.",
      inputSchema: {
        type: "object",
        properties: {
          name: stringField("Existing secret name. Letters, digits, and underscores only.", { minLength: 1 }),
          value: stringField("Optional replacement secret value."),
          description: stringField("Optional replacement description. Empty clears the description."),
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: SECRETS_MCP_TOOL_NAMES.upsert,
      description: "Create or update a user-scoped local secret by name.",
      inputSchema: {
        type: "object",
        properties: {
          name: stringField("Secret name. Letters, digits, and underscores only.", { minLength: 1 }),
          value: stringField("Secret value. Required when creating a new secret."),
          description: stringField("Optional secret description. Empty clears the description on update."),
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: SECRETS_MCP_TOOL_NAMES.delete,
      description: "Delete a user-scoped local secret by name.",
      inputSchema: {
        type: "object",
        properties: {
          name: stringField("Secret name. Letters, digits, and underscores only.", { minLength: 1 }),
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: SWARM_TASK_MCP_TOOL_NAMES.taskCreate,
      description: "Create a reusable Swarm Task configuration.",
      inputSchema: {
        type: "object",
        properties: {
          name: stringField("Task name.", { minLength: 1, maxLength: 120 }),
          description: stringField("Optional task description.", { maxLength: 4096 }),
          config: swarmTaskConfigSchema,
        },
        required: ["name", "config"],
        additionalProperties: false,
      },
    },
    {
      name: SWARM_TASK_MCP_TOOL_NAMES.taskList,
      description: "List reusable Swarm Tasks.",
      inputSchema: strictEmptyInputSchema,
    },
    {
      name: SWARM_TASK_MCP_TOOL_NAMES.taskGet,
      description: "Get one Swarm Task by id.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: stringField("Swarm Task id.", { minLength: 1 }),
        },
        required: ["taskId"],
        additionalProperties: false,
      },
    },
    {
      name: SWARM_TASK_MCP_TOOL_NAMES.taskUpdate,
      description: "Update a Swarm Task name, description, or current configuration.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: stringField("Swarm Task id.", { minLength: 1 }),
          patch: {
            type: "object",
            properties: {
              name: stringField("Optional task name.", { minLength: 1, maxLength: 120 }),
              description: stringField("Optional task description.", { maxLength: 4096 }),
              currentConfig: swarmTaskConfigSchema,
            },
            additionalProperties: false,
          },
        },
        required: ["taskId", "patch"],
        additionalProperties: false,
      },
    },
    {
      name: SWARM_TASK_MCP_TOOL_NAMES.taskDelete,
      description: "Delete a Swarm Task and its run history by id. Fails while the task has a running or draining run.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: stringField("Swarm Task id.", { minLength: 1 }),
        },
        required: ["taskId"],
        additionalProperties: false,
      },
    },
    {
      name: SWARM_TASK_MCP_TOOL_NAMES.runStart,
      description: "Start a Swarm Task run.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: stringField("Swarm Task id.", { minLength: 1 }),
          configOverride: {
            type: "object",
            description: "Optional partial config override for this run.",
            additionalProperties: true,
          },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
    },
    {
      name: SWARM_TASK_MCP_TOOL_NAMES.runStopRefill,
      description: "Stop launching new workers for a running Swarm Task run and let active workers finish.",
      inputSchema: {
        type: "object",
        properties: {
          runId: stringField("Swarm run id.", { minLength: 1 }),
        },
        required: ["runId"],
        additionalProperties: false,
      },
    },
    {
      name: SWARM_TASK_MCP_TOOL_NAMES.runCancel,
      description: "Cancel a nonterminal Swarm Task run.",
      inputSchema: {
        type: "object",
        properties: {
          runId: stringField("Swarm run id.", { minLength: 1 }),
        },
        required: ["runId"],
        additionalProperties: false,
      },
    },
    {
      name: SWARM_TASK_MCP_TOOL_NAMES.runList,
      description: "List Swarm Task runs.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: stringField("Optional Swarm Task id.", { minLength: 1 }),
          limit: positiveIntField("Optional maximum runs to return.", 200),
        },
        additionalProperties: false,
      },
    },
    {
      name: SWARM_TASK_MCP_TOOL_NAMES.runGet,
      description: "Get one Swarm Task run by id.",
      inputSchema: {
        type: "object",
        properties: {
          runId: stringField("Swarm run id.", { minLength: 1 }),
        },
        required: ["runId"],
        additionalProperties: false,
      },
    },
  ]
}

function secretsCapabilityTitle(id: string): string {
  switch (id) {
    case SECRETS_ITEM_LIST_CAPABILITY_ID:
      return "List secrets"
    case SECRETS_ITEM_GET_CAPABILITY_ID:
      return "Get secret"
    case SECRETS_ITEM_CREATE_CAPABILITY_ID:
      return "Create secret"
    case SECRETS_ITEM_UPDATE_CAPABILITY_ID:
      return "Update secret"
    case SECRETS_ITEM_UPSERT_CAPABILITY_ID:
      return "Upsert secret"
    case SECRETS_ITEM_DELETE_CAPABILITY_ID:
      return "Delete secret"
    default:
      return "Secrets action"
  }
}

function secretsCapabilityDescription(id: string): string {
  switch (id) {
    case SECRETS_ITEM_LIST_CAPABILITY_ID:
      return "List user-scoped local secrets without returning values."
    case SECRETS_ITEM_GET_CAPABILITY_ID:
      return "Get one user-scoped local secret, optionally including its value."
    case SECRETS_ITEM_CREATE_CAPABILITY_ID:
      return "Create a user-scoped local secret."
    case SECRETS_ITEM_UPDATE_CAPABILITY_ID:
      return "Update a user-scoped local secret."
    case SECRETS_ITEM_UPSERT_CAPABILITY_ID:
      return "Create or update a user-scoped local secret."
    case SECRETS_ITEM_DELETE_CAPABILITY_ID:
      return "Delete a user-scoped local secret."
    default:
      return "Operate on user-scoped local secrets."
  }
}

function swarmTaskCapabilityTitle(id: string): string {
  switch (id) {
    case SWARM_TASK_TASK_CREATE_CAPABILITY_ID:
      return "Create Swarm Task"
    case SWARM_TASK_TASK_LIST_CAPABILITY_ID:
      return "List Swarm Tasks"
    case SWARM_TASK_TASK_GET_CAPABILITY_ID:
      return "Get Swarm Task"
    case SWARM_TASK_TASK_UPDATE_CAPABILITY_ID:
      return "Update Swarm Task"
    case SWARM_TASK_TASK_DELETE_CAPABILITY_ID:
      return "Delete Swarm Task"
    case SWARM_TASK_RUN_START_CAPABILITY_ID:
      return "Start Swarm Task run"
    case SWARM_TASK_RUN_STOP_REFILL_CAPABILITY_ID:
      return "Stop Swarm Task new workers"
    case SWARM_TASK_RUN_CANCEL_CAPABILITY_ID:
      return "Cancel Swarm Task run"
    case SWARM_TASK_RUN_LIST_CAPABILITY_ID:
      return "List Swarm Task runs"
    case SWARM_TASK_RUN_GET_CAPABILITY_ID:
      return "Get Swarm Task run"
    default:
      return "Swarm Task action"
  }
}

function swarmTaskCapabilityDescription(id: string): string {
  switch (id) {
    case SWARM_TASK_TASK_CREATE_CAPABILITY_ID:
      return "Create a reusable Swarm Task configuration."
    case SWARM_TASK_TASK_LIST_CAPABILITY_ID:
      return "List reusable Swarm Tasks."
    case SWARM_TASK_TASK_GET_CAPABILITY_ID:
      return "Get one Swarm Task configuration."
    case SWARM_TASK_TASK_UPDATE_CAPABILITY_ID:
      return "Update a Swarm Task configuration."
    case SWARM_TASK_TASK_DELETE_CAPABILITY_ID:
      return "Delete a Swarm Task configuration."
    case SWARM_TASK_RUN_START_CAPABILITY_ID:
      return "Start a Swarm Task run."
    case SWARM_TASK_RUN_STOP_REFILL_CAPABILITY_ID:
      return "Stop launching new workers for a Swarm Task run."
    case SWARM_TASK_RUN_CANCEL_CAPABILITY_ID:
      return "Cancel a Swarm Task run."
    case SWARM_TASK_RUN_LIST_CAPABILITY_ID:
      return "List Swarm Task runs."
    case SWARM_TASK_RUN_GET_CAPABILITY_ID:
      return "Get one Swarm Task run."
    default:
      return "Run a Swarm Task capability."
  }
}
