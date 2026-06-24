import {
  DOCUMENT_TEMPLATE_CAPABILITY_ID,
  DOCUMENT_TEMPLATE_MCP_TOOL_NAME,
} from "../../app-capabilities/document-template/shared/capability"
import {
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
  SCREENSHOT_CAPTURE_CAPABILITY_ID,
  SCREENSHOT_CAPTURE_MCP_TOOL_NAME,
  SCREENSHOT_FILE_SAVE_CAPABILITY_ID,
  SCREENSHOT_FILE_SAVE_MCP_TOOL_NAME,
} from "../../app-capabilities/screenshot/shared/capability"
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
    description: "Update a terminal group's name, default working directory, and startup command.",
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
    id: SCREENSHOT_CAPTURE_CAPABILITY_ID,
    title: "Capture screenshot",
    description: "Capture a fullscreen or coordinate-region PNG screenshot and return a temporary artifact.",
    mutates: false,
  },
  {
    id: SCREENSHOT_FILE_SAVE_CAPABILITY_ID,
    title: "Save screenshot file",
    description: "Capture a fullscreen or coordinate-region PNG screenshot and save it to a local .png file.",
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
  [TERMINAL_MCP_TOOL_NAMES.groupRename]: TERMINAL_GROUP_RENAME_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.groupUpdateSettings]: TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID,
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
  [SCREENSHOT_CAPTURE_MCP_TOOL_NAME]: SCREENSHOT_CAPTURE_CAPABILITY_ID,
  [SCREENSHOT_FILE_SAVE_MCP_TOOL_NAME]: SCREENSHOT_FILE_SAVE_CAPABILITY_ID,
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
const numberField = (description: string) => ({ type: "number", description })

const sessionIdProperty = stringField("Terminal session id.", { minLength: 1 })
const strictEmptyInputSchema = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
}
const screenshotRegionSchema = {
  type: "object",
  description: "Screen coordinates for a region capture.",
  properties: {
    x: numberField("Left screen coordinate."),
    y: numberField("Top screen coordinate."),
    width: numberField("Region width in screen coordinates."),
    height: numberField("Region height in screen coordinates."),
  },
  required: ["x", "y", "width", "height"],
} as const
const screenshotCaptureProperties = {
  mode: {
    type: "string",
    enum: ["fullscreen", "region"],
    description: "Use fullscreen for the current focused Synapse window's screen, or region with explicit screen coordinates.",
  },
  region: screenshotRegionSchema,
  hideCurrentWindow: {
    type: "boolean",
    description: "When true, Synapse hides the current focused Synapse window before capture when available.",
  },
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
      description: "Update a terminal group's name, default working directory, and startup command for future sessions.",
      inputSchema: {
        type: "object",
        properties: {
          groupId: stringField("Terminal group id.", { minLength: 1 }),
          name: stringField("Group name. Leading and trailing whitespace is trimmed.", { minLength: 1, maxLength: 80 }),
          settings: {
            type: "object",
            properties: {
              defaultCwd: stringField("Optional absolute working directory for future sessions in this group.", { minLength: 1 }),
              startupCommand: stringField("Optional multi-line command text to run automatically in future sessions.", { minLength: 1, maxLength: 64 * 1024 }),
            },
            additionalProperties: false,
          },
        },
        required: ["groupId", "name"],
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
      name: SCREENSHOT_CAPTURE_MCP_TOOL_NAME,
      description: "Capture a fullscreen or coordinate-region PNG screenshot. Fullscreen uses the current focused Synapse window's screen when available, otherwise the primary screen. Region captures require x, y, width, and height screen coordinates. Returns metadata and a temporary PNG path; raw image bytes are not returned through MCP.",
      inputSchema: {
        type: "object",
        properties: screenshotCaptureProperties,
        required: ["mode"],
        allOf: [
          {
            if: { properties: { mode: { const: "region" } } },
            then: { required: ["region"] },
          },
        ],
      },
    },
    {
      name: SCREENSHOT_FILE_SAVE_MCP_TOOL_NAME,
      description: "Capture a fullscreen or coordinate-region PNG screenshot and save it to outputPath. Existing outputPath is rejected unless overwrite is true.",
      inputSchema: {
        type: "object",
        properties: {
          capture: {
            type: "object",
            description: "Screenshot capture input.",
            properties: screenshotCaptureProperties,
            required: ["mode"],
          },
          outputPath: stringField("Absolute local .png output path."),
          overwrite: {
            type: "boolean",
            description: "When true, replace outputPath if it already exists. Defaults to false.",
          },
        },
        required: ["capture", "outputPath"],
      },
    },
  ]
}
