import {
  DOCUMENT_TEMPLATE_CAPABILITY_ID,
  DOCUMENT_TEMPLATE_MCP_TOOL_NAME,
} from "../../app-capabilities/document-template/shared/capability"
import {
  TEXT_EXTRACTOR_CAPABILITY_ID,
  TEXT_EXTRACTOR_MCP_TOOL_NAME,
} from "../../app-capabilities/text-extractor/shared/capability"
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
import { SECRET_NAME_REGEX } from "../../app-capabilities/secrets/shared/schema"
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
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"
import {
  FILE_OPENER_CAPABILITY_ID,
  FILE_OPENER_MCP_TOOL_NAME,
} from "../../app-capabilities/file-opener/shared/capability"

const appCapabilities: readonly CapabilityDefinition[] = [
  {
    id: TEXT_EXTRACTOR_CAPABILITY_ID,
    title: "Extract document text",
    description: "Extract normalized text and metadata from a local PDF or DOCX document.",
    mutates: false,
  },
  {
    id: DOCUMENT_TEMPLATE_CAPABILITY_ID,
    title: "Generate Word document from template",
    description: "Generate a local .docx file from a local .docx template and JSON object data.",
    mutates: true,
  },
  {
    id: FILE_OPENER_CAPABILITY_ID,
    title: "Open local file with default application",
    description: "Submit one existing local regular file to the operating system's default application.",
    mutates: false,
    risk: "high",
  },
  {
    id: TERMINAL_GROUP_CREATE_CAPABILITY_ID,
    title: "Create terminal group",
    description: "Create a Synapse terminal group after terminal permission approval.",
    mutates: true,
  },
  {
    id: TERMINAL_GROUP_LIST_CAPABILITY_ID,
    title: "List terminal groups",
    description: "List Synapse terminal groups and saved command settings after terminal permission approval.",
    mutates: false,
  },
  {
    id: TERMINAL_GROUP_RENAME_CAPABILITY_ID,
    title: "Rename terminal group",
    description: "Rename a Synapse terminal group after terminal permission approval.",
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
]

export const APP_DOMAIN: CapabilityDomainDefinition = {
  id: "app",
  capabilities: appCapabilities,
}

export const APP_MCP_TOOL_ACTIONS: Record<string, string> = {
  [TEXT_EXTRACTOR_MCP_TOOL_NAME]: TEXT_EXTRACTOR_CAPABILITY_ID,
  [DOCUMENT_TEMPLATE_MCP_TOOL_NAME]: DOCUMENT_TEMPLATE_CAPABILITY_ID,
  [FILE_OPENER_MCP_TOOL_NAME]: FILE_OPENER_CAPABILITY_ID,
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
}

const stringField = (
  description: string,
  options?: { minLength?: number; maxLength?: number; pattern?: string },
) => ({
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
const secretNameProperty = stringField("Secret name. Letters, digits, and underscores only.", {
  minLength: 1,
  pattern: SECRET_NAME_REGEX.source,
})
const strictEmptyInputSchema = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
}
export function buildAppTools(): McpToolDefinition[] {
  return [
    {
      name: TEXT_EXTRACTOR_MCP_TOOL_NAME,
      description: "Extract complete normalized plain text and metadata from one local PDF or DOCX. The file must be an absolute path to a regular, non-symbolic-link document whose extension matches its content. PDF extraction reads the existing text layer; DOCX extraction reads main-document paragraphs, list text, table cells, and recognizable text boxes. It does not perform OCR or layout reconstruction. An empty text result is successful. Limits: 50 MiB source file, 5 MiB UTF-8 text, 2,000 PDF pages, 60 seconds, and two concurrent tasks.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: stringField("Absolute local .pdf or .docx file path."),
        },
        required: ["filePath"],
        additionalProperties: false,
      },
    },
    {
      name: DOCUMENT_TEMPLATE_MCP_TOOL_NAME,
      description: "Generate a local .docx file from a .docx template and JSON data. Provide exactly one of dataPath or data. Existing outputPath is rejected unless overwrite is true; symbolic-link outputs are always rejected.",
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
      },
    },
    {
      name: FILE_OPENER_MCP_TOOL_NAME,
      description: "Submit one existing absolute local regular file to the operating system's default application. URLs, directories, symbolic links, multiple files, and selecting a specific application are not supported. Success means the operating system accepted the request.",
      inputSchema: {
        type: "object",
        properties: {
          path: stringField("Absolute local file path."),
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.groupCreate,
      description: "Create a Synapse terminal group after terminal permission approval.",
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
      description: "List Synapse terminal groups and saved command settings after terminal permission approval.",
      inputSchema: strictEmptyInputSchema,
    },
    {
      name: TERMINAL_MCP_TOOL_NAMES.groupRename,
      description: "Rename a Synapse terminal group after terminal permission approval.",
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
              defaultCwd: stringField("Optional existing absolute working directory for future sessions in this group.", { minLength: 1 }),
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
          name: secretNameProperty,
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
          name: secretNameProperty,
          value: stringField("Secret value."),
          description: stringField("Optional secret description."),
        },
        required: ["name", "value"],
        additionalProperties: false,
      },
    },
    {
      name: SECRETS_MCP_TOOL_NAMES.update,
      description: "Update an existing user-scoped local secret value or description. Provide at least one of value or description.",
      inputSchema: {
        type: "object",
        properties: {
          name: secretNameProperty,
          value: stringField("Optional replacement secret value."),
          description: stringField("Optional replacement description. Empty clears the description."),
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: SECRETS_MCP_TOOL_NAMES.upsert,
      description: "Create or update a user-scoped local secret by name and value. Use update for metadata-only changes.",
      inputSchema: {
        type: "object",
        properties: {
          name: secretNameProperty,
          value: stringField("Secret value."),
          description: stringField("Optional secret description. Empty clears the description on update."),
        },
        required: ["name", "value"],
        additionalProperties: false,
      },
    },
    {
      name: SECRETS_MCP_TOOL_NAMES.delete,
      description: "Delete a user-scoped local secret by name.",
      inputSchema: {
        type: "object",
        properties: {
          name: secretNameProperty,
        },
        required: ["name"],
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
