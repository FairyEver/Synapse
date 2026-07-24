import type { ActionManifest } from "../../../action-packages/types"
import { JAVASCRIPT_RUN_AUTOMATION_ACTION_TYPE } from "../../script-runtime/shared/capability"
import {
  javascriptAutomationConfigSchema,
  type JavascriptAutomationConfig,
} from "../../script-runtime/shared/schema"

export const javascriptRunActionManifest = {
  id: JAVASCRIPT_RUN_AUTOMATION_ACTION_TYPE,
  title: "JavaScript 运行",
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
  },
  configFields: [
    { name: "source", kind: "string", required: true },
    { name: "inputs", kind: "record", required: false },
    { name: "timeoutSeconds", kind: "number", required: true, defaultValue: 60 },
    { name: "saveRunContent", kind: "boolean", required: true, defaultValue: true },
  ],
  configSchema: javascriptAutomationConfigSchema,
} satisfies ActionManifest<JavascriptAutomationConfig>
