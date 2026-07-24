import type { ActionManifest } from "../../../action-packages/types"
import { NODEJS_RUN_AUTOMATION_ACTION_TYPE } from "../../script-runtime/shared/capability"
import {
  nodejsAutomationConfigSchema,
  type NodejsAutomationConfig,
} from "../../script-runtime/shared/schema"

export const nodejsRunActionManifest = {
  id: NODEJS_RUN_AUTOMATION_ACTION_TYPE,
  title: "Node.js 运行",
  permissions: [],
  authorization: "none",
  previousOutputs: "none",
  resultPersistence: "raw",
  automationPolicy: {
    initiallyDisabled: true,
    disableOnExecutionChange: true,
    nonExecutionConfigFields: ["saveRunContent"],
    runContentPersistenceConfigField: "saveRunContent",
  },
  defaultConfig: {
    source: "",
    inputs: [],
    timeoutSeconds: 60,
    saveRunContent: true,
    moduleMode: "commonjs",
  },
  configFields: [
    { name: "source", kind: "string", required: true },
    { name: "inputs", kind: "record", required: false },
    { name: "moduleMode", kind: "enum", required: true, choices: ["commonjs", "esm"], defaultValue: "commonjs" },
    { name: "timeoutSeconds", kind: "number", required: true, defaultValue: 60 },
    { name: "saveRunContent", kind: "boolean", required: true, defaultValue: true },
  ],
  configSchema: nodejsAutomationConfigSchema,
} satisfies ActionManifest<NodejsAutomationConfig>
