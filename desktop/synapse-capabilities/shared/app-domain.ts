import {
  DOCUMENT_TEMPLATE_CAPABILITY_ID,
  DOCUMENT_TEMPLATE_MCP_TOOL_NAME,
} from "../../app-capabilities/document-template/shared/capability"
import {
  TERMINAL_GROUP_CREATE_CAPABILITY_ID,
  TERMINAL_GROUP_LIST_CAPABILITY_ID,
  TERMINAL_MCP_TOOL_NAMES,
  TERMINAL_SESSION_CREATE_CAPABILITY_ID,
  TERMINAL_SESSION_GET_CAPABILITY_ID,
  TERMINAL_SESSION_LIST_CAPABILITY_ID,
  TERMINAL_SESSION_READ_CAPABILITY_ID,
  TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
  TERMINAL_SESSION_STOP_CAPABILITY_ID,
  TERMINAL_SESSION_WRITE_CAPABILITY_ID,
} from "../../app-capabilities/terminal/shared/capability"
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
    id: TERMINAL_SESSION_WRITE_CAPABILITY_ID,
    title: "Write terminal input",
    description: "Write raw input to an Agent-controlled terminal session.",
    mutates: true,
  },
  {
    id: TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
    title: "Resize terminal session",
    description: "Resize a terminal session pty.",
    mutates: true,
  },
  {
    id: TERMINAL_SESSION_STOP_CAPABILITY_ID,
    title: "Stop terminal session",
    description: "Stop an Agent-controlled terminal session.",
    mutates: true,
  },
]

export const APP_DOMAIN: CapabilityDomainDefinition = {
  id: "app",
  capabilities: appCapabilities,
}

export const APP_MCP_TOOL_ACTIONS: Record<string, string> = {
  [DOCUMENT_TEMPLATE_MCP_TOOL_NAME]: DOCUMENT_TEMPLATE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.groupCreate]: TERMINAL_GROUP_CREATE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.groupList]: TERMINAL_GROUP_LIST_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionCreate]: TERMINAL_SESSION_CREATE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionList]: TERMINAL_SESSION_LIST_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionGet]: TERMINAL_SESSION_GET_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionRead]: TERMINAL_SESSION_READ_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionWrite]: TERMINAL_SESSION_WRITE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionResize]: TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionStop]: TERMINAL_SESSION_STOP_CAPABILITY_ID,
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
          agentControl: booleanField("When true, allow MCP write and stop operations for this session."),
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
      name: TERMINAL_MCP_TOOL_NAMES.sessionWrite,
      description: "Write raw input to an Agent-controlled terminal session. Include a newline to submit a shell command.",
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
      name: TERMINAL_MCP_TOOL_NAMES.sessionStop,
      description: "Stop an Agent-controlled terminal session.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: sessionIdProperty,
          force: booleanField("When true, force stop if supported."),
        },
        required: ["sessionId"],
      },
    },
  ]
}
