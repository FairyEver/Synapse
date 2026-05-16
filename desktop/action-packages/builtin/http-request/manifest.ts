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
  configFields: [
    {
      name: "method",
      kind: "enum",
      required: true,
      description: "HTTP method.",
      choices: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      defaultValue: "GET",
    },
    {
      name: "url",
      kind: "string",
      required: true,
      description: "Absolute request URL.",
      defaultValue: "",
    },
    {
      name: "headers",
      kind: "record",
      required: false,
      description: "Request headers.",
    },
    {
      name: "query",
      kind: "record",
      required: false,
      description: "Query parameters.",
    },
    {
      name: "bodyType",
      kind: "enum",
      required: true,
      description: "Request body type.",
      choices: ["none", "json", "text"],
      defaultValue: "none",
    },
    {
      name: "body",
      kind: "string",
      required: false,
      description: "Request body.",
    },
    {
      name: "timeoutMins",
      kind: "number",
      required: false,
      description: "Timeout in minutes. Null disables the timeout.",
      defaultValue: 5,
    },
    {
      name: "auth",
      kind: "record",
      required: false,
      description: "Auth configuration (bearer token or basic auth).",
    },
  ],
  configSchema: httpRequestActionConfigSchema,
} satisfies ActionManifest<HttpRequestActionConfig>
