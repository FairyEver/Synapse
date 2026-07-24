import { ClipboardCopy, ClipboardPaste } from "lucide-react"
import type { NodeManifest } from "../../../workflow-nodes/types"
import {
  CLIPBOARD_CAPABILITY_VERSION,
  CLIPBOARD_TEXT_READ_CAPABILITY_ID,
  CLIPBOARD_TEXT_READ_WORKFLOW_NODE_TYPE,
  CLIPBOARD_TEXT_WRITE_CAPABILITY_ID,
  CLIPBOARD_TEXT_WRITE_WORKFLOW_NODE_TYPE,
} from "../shared/capability"
import {
  clipboardTextReadNodeConfigSchema,
  clipboardTextWriteNodeConfigSchema,
  type ClipboardTextReadNodeConfig,
  type ClipboardTextWriteNodeConfig,
} from "./schema"

export const clipboardTextWriteNodeManifest: NodeManifest<ClipboardTextWriteNodeConfig> = {
  type: CLIPBOARD_TEXT_WRITE_WORKFLOW_NODE_TYPE,
  title: "写入剪贴板",
  icon: ClipboardPaste,
  color: "bg-primary/10",
  defaultConfig: {
    text: "",
    variables: [],
  },
  ports: {
    inputs: [{ id: "in", label: "输入" }],
    outputs: [{ id: "out", label: "结果" }],
  },
  cardSummary: () => ({
    title: "写入剪贴板",
    subtitle: "",
  }),
  configFields: [
    { name: "text", kind: "text", label: "文本" },
    { name: "variables", kind: "variable-binding-list", label: "输入映射" },
  ],
  configSchema: clipboardTextWriteNodeConfigSchema,
  publicOutputs: ["success"],
  share: {
    selfContained: false,
    capability: {
      id: CLIPBOARD_TEXT_WRITE_CAPABILITY_ID,
      minVersion: CLIPBOARD_CAPABILITY_VERSION,
      installSourceId: "synapse.builtin",
    },
    sensitive: [{ path: ["text"] }],
    risks: [{
      path: [],
      id: "clipboard.write",
      when: "always",
    }],
  },
}

export const clipboardTextReadNodeManifest: NodeManifest<ClipboardTextReadNodeConfig> = {
  type: CLIPBOARD_TEXT_READ_WORKFLOW_NODE_TYPE,
  title: "读取剪贴板",
  icon: ClipboardCopy,
  color: "bg-primary/10",
  defaultConfig: {},
  ports: {
    inputs: [{ id: "in", label: "输入" }],
    outputs: [{ id: "out", label: "文本" }],
  },
  cardSummary: () => ({
    title: "读取剪贴板",
    subtitle: "",
  }),
  configFields: [],
  configSchema: clipboardTextReadNodeConfigSchema,
  publicOutputs: ["text"],
  share: {
    selfContained: false,
    capability: {
      id: CLIPBOARD_TEXT_READ_CAPABILITY_ID,
      minVersion: CLIPBOARD_CAPABILITY_VERSION,
      installSourceId: "synapse.builtin",
    },
    risks: [{
      path: [],
      id: "clipboard.read",
      when: "always",
    }],
  },
}
