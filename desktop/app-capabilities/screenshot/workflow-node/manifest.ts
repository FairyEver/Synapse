import { Camera } from "lucide-react"
import type { NodeManifest } from "../../../workflow-nodes/types"
import { SCREENSHOT_WORKFLOW_NODE_TYPE } from "../shared/capability"
import { screenshotNodeConfigSchema, type ScreenshotNodeConfig } from "./schema"

export const screenshotNodeManifest: NodeManifest<ScreenshotNodeConfig> = {
  type: SCREENSHOT_WORKFLOW_NODE_TYPE,
  title: "截图",
  icon: Camera,
  color: "bg-primary/10",
  defaultConfig: {
    mode: "fullscreen",
    x: "0",
    y: "0",
    width: "800",
    height: "600",
    outputPath: "",
    overwrite: false,
    hideCurrentWindow: false,
    variables: [],
  },
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (config) => ({
    title: "截图",
    subtitle: config.outputPath || "未设置输出文件",
  }),
  configFields: [
    { name: "mode", kind: "select", label: "模式" },
    { name: "x", kind: "text", label: "X", optional: true },
    { name: "y", kind: "text", label: "Y", optional: true },
    { name: "width", kind: "text", label: "W", optional: true },
    { name: "height", kind: "text", label: "H", optional: true },
    { name: "outputPath", kind: "text", label: "输出文件" },
    { name: "overwrite", kind: "record", label: "覆盖", optional: true },
    { name: "hideCurrentWindow", kind: "record", label: "隐藏当前窗口", optional: true },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
  ],
  configSchema: screenshotNodeConfigSchema,
}
