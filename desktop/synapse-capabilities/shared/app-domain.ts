import {
  DOCUMENT_TEMPLATE_CAPABILITY_ID,
  DOCUMENT_TEMPLATE_MCP_TOOL_NAME,
} from "../../app-capabilities/document-template/shared/capability"
import {
  TEXT_EXTRACTOR_CAPABILITY_ID,
  TEXT_EXTRACTOR_MCP_TOOL_NAME,
  TEXT_EXTRACTOR_TO_FILE_CAPABILITY_ID,
  TEXT_EXTRACTOR_TO_FILE_MCP_TOOL_NAME,
} from "../../app-capabilities/text-extractor/shared/capability"
import {
  TERMINAL_CAPABILITY_CATALOG,
  TERMINAL_MCP_TOOL_ACTIONS,
} from "../../app-capabilities/terminal/shared/capability"
import { buildTerminalMcpTools } from "../../app-capabilities/terminal/shared/mcp-tools"
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
  SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID,
  SYSTEM_NOTIFIER_TRIGGER_MCP_TOOL_NAME,
} from "../../app-capabilities/system-notifier/shared/capability"
import {
  SYSTEM_NOTIFICATION_BODY_MAX_CODE_POINTS,
  SYSTEM_NOTIFICATION_TITLE_MAX_CODE_POINTS,
} from "../../app-capabilities/system-notifier/shared/schema"
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
import {
  TEXT_FILE_WRITER_CAPABILITY_ID,
  TEXT_FILE_WRITER_MCP_TOOL_NAME,
} from "../../app-capabilities/text-file-writer/shared/capability"
import {
  DEFAULT_TEXT_FILE_ENCODING,
  DEFAULT_TEXT_FILE_OVERWRITE,
  TEXT_FILE_ENCODINGS,
} from "../../app-capabilities/text-file-writer/shared/schema"
import { TEXT_EXTRACTION_OUTPUT_FORMATS } from "../../app-capabilities/text-extractor/shared/schema"
import {
  HTML_GENERATOR_EJS_CAPABILITY_ID,
  HTML_GENERATOR_EJS_FILE_CAPABILITY_ID,
  HTML_GENERATOR_EJS_MCP_TOOL_NAME,
  HTML_GENERATOR_EJS_FILE_MCP_TOOL_NAME,
} from "../../app-capabilities/html-generator/shared/capability"
import {
  PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID,
  PROBLEM_FEEDBACK_SUBMIT_MCP_TOOL_NAME,
} from "../../app-capabilities/problem-feedback/shared/capability"
import {
  JSON_REPAIR_CAPABILITY_ID,
  JSON_REPAIR_MCP_TOOL_NAME,
} from "../../app-capabilities/json-repair/shared/capability"
import {
  JSON_REPAIR_SCHEMA_MAX_LENGTH,
} from "../../app-capabilities/json-repair/shared/schema"
import {
  JAVASCRIPT_RUN_CAPABILITY_ID,
  NODEJS_RUN_CAPABILITY_ID,
} from "../../app-capabilities/script-runtime/shared/capability"
import {
  CLIPBOARD_TEXT_READ_CAPABILITY_ID,
  CLIPBOARD_TEXT_WRITE_CAPABILITY_ID,
} from "../../app-capabilities/clipboard/shared/capability"

const appCapabilities: readonly CapabilityDefinition[] = [
  {
    id: TEXT_EXTRACTOR_CAPABILITY_ID,
    title: "Extract document text",
    description: "Extract normalized text and metadata from a local PDF or DOCX document.",
    mutates: false,
  },
  {
    id: TEXT_EXTRACTOR_TO_FILE_CAPABILITY_ID,
    title: "Extract document text to file",
    description: "Extract normalized text from a local PDF or DOCX and write it directly to a local text file.",
    mutates: true,
    risk: "high",
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
    id: TEXT_FILE_WRITER_CAPABILITY_ID,
    title: "Write text to local file",
    description: "Write one complete text value to any absolute local file path.",
    mutates: true,
    risk: "high",
  },
  {
    id: HTML_GENERATOR_EJS_CAPABILITY_ID,
    title: "Generate HTML with EJS",
    description: "Render a trusted executable EJS template string with structured JSON data and return the complete HTML text.",
    mutates: false,
    risk: "high",
  },
  {
    id: HTML_GENERATOR_EJS_FILE_CAPABILITY_ID,
    title: "Generate HTML file with EJS",
    description: "Render a trusted executable EJS template string and write the complete HTML text to a local file.",
    mutates: true,
    risk: "high",
  },
  ...TERMINAL_CAPABILITY_CATALOG.map((item): CapabilityDefinition => ({
    id: item.id,
    title: item.title,
    description: item.description,
    mutates: item.mutates,
    risk: item.risk,
  })),
  {
    id: SOUND_NOTIFIER_PLAY_CAPABILITY_ID,
    title: "Play sound",
    description: "Play a semantic Sound Notifier reminder on the local computer.",
    mutates: false,
  },
  {
    id: SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID,
    title: "Trigger system notification",
    description: "Trigger a one-way native system notification on the local computer.",
    mutates: false,
  },
  {
    id: PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID,
    title: "Submit problem feedback",
    description: "Submit the exact user-confirmed plain-text problem report to the configured Synapse deployment.",
    mutates: true,
    risk: "high",
  },
  {
    id: JSON_REPAIR_CAPABILITY_ID,
    title: "Repair JSON text",
    description: "Best-effort repair of one input string into validated JSON text.",
    mutates: false,
  },
  {
    id: CLIPBOARD_TEXT_READ_CAPABILITY_ID,
    title: "Read system clipboard text",
    description: "Read up to 1 MiB of plain text from the standard system clipboard through a Workflow node.",
    mutates: false,
    risk: "high",
  },
  {
    id: CLIPBOARD_TEXT_WRITE_CAPABILITY_ID,
    title: "Write system clipboard text",
    description: "Write up to 1 MiB of plain text to the standard system clipboard through a Workflow node.",
    mutates: true,
    risk: "high",
  },
  {
    id: JAVASCRIPT_RUN_CAPABILITY_ID,
    title: "Run JavaScript",
    description: "Run one JavaScript file in a Chromium Dedicated Worker.",
    mutates: true,
    risk: "high",
  },
  {
    id: NODEJS_RUN_CAPABILITY_ID,
    title: "Run Node.js",
    description: "Run one Node.js file with the current operating-system user permissions.",
    mutates: true,
    risk: "high",
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
  [TEXT_EXTRACTOR_TO_FILE_MCP_TOOL_NAME]: TEXT_EXTRACTOR_TO_FILE_CAPABILITY_ID,
  [DOCUMENT_TEMPLATE_MCP_TOOL_NAME]: DOCUMENT_TEMPLATE_CAPABILITY_ID,
  [FILE_OPENER_MCP_TOOL_NAME]: FILE_OPENER_CAPABILITY_ID,
  [TEXT_FILE_WRITER_MCP_TOOL_NAME]: TEXT_FILE_WRITER_CAPABILITY_ID,
  [HTML_GENERATOR_EJS_MCP_TOOL_NAME]: HTML_GENERATOR_EJS_CAPABILITY_ID,
  [HTML_GENERATOR_EJS_FILE_MCP_TOOL_NAME]: HTML_GENERATOR_EJS_FILE_CAPABILITY_ID,
  ...TERMINAL_MCP_TOOL_ACTIONS,
  [SOUND_NOTIFIER_PLAY_MCP_TOOL_NAME]: SOUND_NOTIFIER_PLAY_CAPABILITY_ID,
  [SYSTEM_NOTIFIER_TRIGGER_MCP_TOOL_NAME]: SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID,
  [PROBLEM_FEEDBACK_SUBMIT_MCP_TOOL_NAME]: PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID,
  [JSON_REPAIR_MCP_TOOL_NAME]: JSON_REPAIR_CAPABILITY_ID,
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
const booleanField = (description: string) => ({ type: "boolean", description })
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
      name: TEXT_EXTRACTOR_TO_FILE_MCP_TOOL_NAME,
      description: "Extract complete normalized plain text from one local PDF or DOCX and write it directly to an absolute local .txt, .md, or .csv file inside Synapse. The text is not returned through MCP. Extraction and writing reuse the same limits, permission checks, and atomic file-write behavior as the dedicated tools. Existing output files are rejected unless overwrite is true.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: stringField("Absolute local .pdf or .docx source path."),
          outputPath: stringField(`Absolute local output path ending in ${TEXT_EXTRACTION_OUTPUT_FORMATS.map((format) => `.${format}`).join(", ")}.`),
          encoding: {
            type: "string",
            enum: TEXT_FILE_ENCODINGS,
            default: DEFAULT_TEXT_FILE_ENCODING,
            description: "Output character encoding. Defaults to utf8. A BOM is never added automatically.",
          },
          overwrite: {
            type: "boolean",
            default: DEFAULT_TEXT_FILE_OVERWRITE,
            description: "When true, replace an unchanged existing regular output file. Defaults to false.",
          },
        },
        required: ["filePath", "outputPath"],
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
      name: TEXT_FILE_WRITER_MCP_TOOL_NAME,
      description: "Write one complete text value to any absolute local file path, including paths with arbitrary extensions or no extension. Missing parent directories are created automatically. Text is preserved exactly apart from encoding; no BOM, trimming, newline normalization, final newline, or format-specific processing is added. Existing files are rejected unless overwrite is true. Synapse sets no product-level text length limit, although IPC, memory, filesystem, and disk limits still apply.",
      inputSchema: {
        type: "object",
        properties: {
          text: stringField("Complete text to write. Empty text is valid and no product-level maximum length is imposed."),
          path: stringField("Absolute local output path. Any extension or no extension is accepted."),
          encoding: {
            type: "string",
            enum: TEXT_FILE_ENCODINGS,
            default: DEFAULT_TEXT_FILE_ENCODING,
            description: "Character encoding. Defaults to utf8. A BOM is never added automatically.",
          },
          overwrite: {
            type: "boolean",
            default: DEFAULT_TEXT_FILE_OVERWRITE,
            description: "When true, replace an unchanged existing regular file. Defaults to false.",
          },
        },
        required: ["text", "path"],
        additionalProperties: false,
      },
    },
    {
      name: HTML_GENERATOR_EJS_MCP_TOOL_NAME,
      description: "Render one trusted executable EJS template string with a structured JSON object and return the complete HTML text and UTF-8 byte size. EJS JavaScript executes in a one-shot Worker that is not a security sandbox; built-in include and template file loading are disabled. HTML Generator does not automatically save, open, preview, sanitize, or validate the result.",
      inputSchema: {
        type: "object",
        properties: {
          template: stringField("Trusted EJS template string. It executes JavaScript and must contain at least one character.", { minLength: 1 }),
          data: {
            type: "object",
            description: "Strict JSON object exposed to EJS as the data root.",
            additionalProperties: true,
          },
        },
        required: ["template", "data"],
        additionalProperties: false,
      },
    },
    {
      name: HTML_GENERATOR_EJS_FILE_MCP_TOOL_NAME,
      description: "Render one trusted executable EJS template string with a structured JSON object and write the complete result as UTF-8 to an absolute local .html or .htm path. EJS JavaScript executes in a one-shot Worker that is not a security sandbox; built-in include and template file loading are disabled. Existing files are rejected unless overwrite is true. The result is not opened, previewed, sanitized, or validated.",
      inputSchema: {
        type: "object",
        properties: {
          template: stringField("Trusted EJS template string. It executes JavaScript and must contain at least one character.", { minLength: 1 }),
          data: {
            type: "object",
            description: "Strict JSON object exposed to EJS as the data root.",
            additionalProperties: true,
          },
          outputPath: stringField("Absolute local output path ending in .html or .htm."),
          overwrite: {
            type: "boolean",
            default: false,
            description: "When true, replace an unchanged existing regular file. Defaults to false.",
          },
        },
        required: ["template", "data", "outputPath"],
        additionalProperties: false,
      },
    },
    ...buildTerminalMcpTools(),
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
      name: SYSTEM_NOTIFIER_TRIGGER_MCP_TOOL_NAME,
      description: "Trigger one native system notification only when the user explicitly asks to be notified or has an active standing notification instruction. title and body must be single-line text with no leading or trailing whitespace. A successful result means Synapse accepted the fire-and-forget request; it does not mean the notification was delivered or displayed.",
      inputSchema: {
        type: "object",
        properties: {
          title: stringField("Single-line notification title with no leading or trailing whitespace.", {
            maxLength: SYSTEM_NOTIFICATION_TITLE_MAX_CODE_POINTS,
          }),
          body: stringField("Single-line notification body with no leading or trailing whitespace.", {
            maxLength: SYSTEM_NOTIFICATION_BODY_MAX_CODE_POINTS,
          }),
        },
        required: ["title", "body"],
        additionalProperties: false,
      },
    },
    {
      name: PROBLEM_FEEDBACK_SUBMIT_MCP_TOOL_NAME,
      description: "Submit one exact plain-text problem report to Synapse. Before every call, show the complete final content to the user and obtain a new unambiguous confirmation in the next user message. The content must exclude secrets, real local paths, identifying information, raw user materials, unsafe URLs, and correlation identifiers. One confirmation authorizes exactly one call. Never retry automatically.",
      inputSchema: {
        type: "object",
        properties: {
          content: stringField("The exact complete text shown to and confirmed by the user. The runtime limit is 256 KiB UTF-8 and additional plain-text and privacy rules apply.", {
            minLength: 1,
            maxLength: 262144,
          }),
        },
        required: ["content"],
        additionalProperties: false,
      },
    },
    {
      name: JSON_REPAIR_MCP_TOOL_NAME,
      description: "Repair one string into complete JSON text only when the user explicitly needs JSON repair. This is best-effort: heuristic repairs can change meaning. Synapse verifies that the complete result parses as JSON and contains only finite JSON numbers, but the result remains untrusted data and is not sanitized, business-validated, or checked against a Schema. Do not retry automatically.",
      inputSchema: {
        type: "object",
        properties: {
          text: stringField("Original complete text to repair. Pass it without pre-cleaning or re-serializing.", {
            minLength: 1,
            maxLength: JSON_REPAIR_SCHEMA_MAX_LENGTH,
          }),
        },
        required: ["text"],
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
