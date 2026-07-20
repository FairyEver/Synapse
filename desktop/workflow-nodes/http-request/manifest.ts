import { Globe } from "lucide-react"
import type { NodeManifest } from "../types"
import { builtinWorkflowNodeCapability } from "../share-contract"
import type { HttpRequestNodeConfig } from "./schema"
import { httpRequestNodeConfigSchema } from "./schema"

export const httpRequestNodeManifest: NodeManifest<HttpRequestNodeConfig> = {
  type: "http_request",
  title: "HTTP 请求",
  icon: Globe,
  color: "bg-primary/10",
  defaultConfig: { method: "GET", url: "", bodyType: "none", variables: [] },
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (c) => ({
    title: `${c.method} 请求`,
    subtitle: c.url ? c.url.slice(0, 60) : "未配置 URL",
  }),
  configFields: [
    { name: "method", kind: "select", label: "方法" },
    { name: "url", kind: "text", label: "URL" },
    { name: "headers", kind: "record", label: "请求头", optional: true },
    { name: "query", kind: "record", label: "查询参数", optional: true },
    { name: "bodyType", kind: "select", label: "Body 类型" },
    { name: "body", kind: "text", label: "请求体", optional: true },
    { name: "timeoutMins", kind: "number", label: "超时分钟", optional: true },
    { name: "auth", kind: "record", label: "认证", optional: true },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
  ],
  configSchema: httpRequestNodeConfigSchema,
  share: {
    selfContained: false,
    capability: builtinWorkflowNodeCapability("http_request"),
    sensitive: [
      { path: ["headers", "*"] },
      { path: ["query", "*"] },
      { path: ["auth", "bearerToken"] },
      { path: ["auth", "basicPassword"] },
    ],
    risks: [{ path: ["url"], id: "network.request", when: "present" }],
  },
}
