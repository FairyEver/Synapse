import type { ActionManifest } from "../../types"
import {
  httpRequestActionConfigSchema,
  type HttpRequestActionConfig,
} from "./schema"

export const httpRequestActionManifest = {
  id: "builtin.http-request",
  title: "HTTP 请求",
  permissions: ["network.connect"],
  defaultConfig: {
    method: "GET",
    url: "",
    bodyType: "none",
    timeoutMins: 5,
  },
  configSchema: httpRequestActionConfigSchema,
} satisfies ActionManifest<HttpRequestActionConfig>
