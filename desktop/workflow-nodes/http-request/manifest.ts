import { Globe } from "lucide-react"
import type { NodeManifest } from "../types"
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
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
  ],
  configSchema: httpRequestNodeConfigSchema,
}
