import { z } from "zod"
import { PUBLIC_LINK_DOWNLOAD_SCOPE } from "../api-keys/api-key-capabilities"

export const OPEN_API_CONTRACT_BASE_PATH = "/api/open"
export const OPEN_API_CONTRACT_PATH = "/openapi.json"
export const OPEN_API_V1_BASE_PATH = "/api/open/v1"
export const OPEN_API_DOWNLOADS_BASE_PATH = `${OPEN_API_V1_BASE_PATH}/downloads`
export const OPEN_API_PUBLIC_LINK_DOWNLOAD_PATH = "/drive/public-links/downloads"
export const OPEN_API_LEGACY_SHARE_LINK_DOWNLOAD_PATH = "/drive/share-links/downloads"
export const OPEN_API_DOWNLOAD_PATH = "/downloads/{grantId}"
export const OPEN_API_CREATE_DOWNLOAD_PATHS = [
  OPEN_API_PUBLIC_LINK_DOWNLOAD_PATH,
  OPEN_API_LEGACY_SHARE_LINK_DOWNLOAD_PATH,
] as const

export const createDownloadRequestSchema = z.object({
  url: z.string()
    .max(2048)
    .url()
    .describe("完整的同源 Synapse Drive 公共 URL，支持 /share、/sites 和 /files。"),
}).strict()

const generatedCreateDownloadRequestSchema = z.toJSONSchema(createDownloadRequestSchema)
const { $schema: _jsonSchemaDialect, ...createDownloadRequestJsonSchema } = generatedCreateDownloadRequestSchema

const requestIdHeader = {
  description: "用于定位本次请求的高熵标识。",
  schema: { type: "string" },
} as const

const noStoreHeader = {
  description: "响应不得缓存。",
  schema: { type: "string", const: "no-store" },
} as const

const errorResponse = (description: string) => ({
  description,
  headers: {
    "X-Request-Id": { $ref: "#/components/headers/RequestId" },
    "Cache-Control": { $ref: "#/components/headers/NoStore" },
  },
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
    },
  },
})

const createDownloadOperation = {
  tags: ["Public links"],
  summary: "创建公共链接下载地址",
  operationId: "createPublicLinkDownload",
  security: [{ ApiKeyBearer: [] }],
  "x-required-scope": PUBLIC_LINK_DOWNLOAD_SCOPE,
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/CreateDownloadRequest" },
      },
    },
  },
  responses: {
    "201": {
      description: "已创建十分钟有效的临时下载地址。",
      headers: {
        "X-Request-Id": { $ref: "#/components/headers/RequestId" },
        "Cache-Control": { $ref: "#/components/headers/NoStore" },
      },
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/CreateDownloadResponse" },
        },
      },
    },
    "400": errorResponse("请求体无效（INVALID_REQUEST）。"),
    "401": errorResponse("API 密钥无效（INVALID_API_KEY）。"),
    "403": errorResponse("权限不足或链接密码错误（INSUFFICIENT_SCOPE、LINK_PASSWORD_REQUIRED_OR_INVALID）。"),
    "404": errorResponse("公共链接不存在或已失效（LINK_NOT_FOUND）。"),
    "413": errorResponse("归档超过支持边界（ARCHIVE_TOO_LARGE）。"),
    "422": errorResponse("不支持该公共链接（UNSUPPORTED_LINK）。"),
    "503": errorResponse("用量日志暂不可用（USAGE_LOG_UNAVAILABLE）。"),
    "500": errorResponse("服务端内部错误（INTERNAL_ERROR）。"),
  },
} as const

const OPEN_API_CONTRACT_DOCUMENT_BASE = {
  openapi: "3.1.0",
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  info: {
    title: "Synapse Open API",
    version: "1.0.0",
    description: "Synapse 面向服务端、CLI 和自动化客户端的开放接口。",
  },
  servers: [{ url: OPEN_API_V1_BASE_PATH }],
  tags: [
    {
      name: "Public links",
      description: "将 Synapse Drive 公共链接转换为临时下载制品。",
    },
  ],
  paths: {
    [OPEN_API_PUBLIC_LINK_DOWNLOAD_PATH]: {
      post: createDownloadOperation,
    },
    [OPEN_API_LEGACY_SHARE_LINK_DOWNLOAD_PATH]: {
      post: {
        ...createDownloadOperation,
        summary: "创建公共链接下载地址（旧路径）",
        operationId: "createShareLinkDownloadLegacy",
        deprecated: true,
        description: "仅兼容已有集成；新集成使用 /drive/public-links/downloads。",
      },
    },
    [OPEN_API_DOWNLOAD_PATH]: {
      get: {
        tags: ["Public links"],
        summary: "下载临时制品",
        operationId: "downloadPublicLinkArtifact",
        description: "原样使用创建接口返回的临时下载 URL；地址有效期为十分钟。",
        security: [{ DownloadToken: [] }],
        parameters: [
          {
            name: "grantId",
            in: "path",
            required: true,
            schema: {
              type: "string",
              pattern: "^dlg_[a-f0-9]{32}$",
            },
          },
          {
            name: "token",
            in: "query",
            required: true,
            schema: {
              type: "string",
              pattern: "^[A-Za-z0-9_-]{43}$",
            },
          },
        ],
        responses: {
          "200": {
            description: "原文件或 ZIP 制品。Content-Type 和文件名由制品决定。",
            headers: {
              "X-Request-Id": { $ref: "#/components/headers/RequestId" },
              "Cache-Control": {
                description: "下载响应不得缓存。",
                schema: { type: "string", const: "private, no-store" },
              },
              "Content-Disposition": {
                description: "包含 UTF-8 下载文件名。",
                schema: { type: "string" },
              },
              "Content-Length": {
                description: "原文件响应包含已知字节数；ZIP 响应不提供。",
                schema: { type: "integer", format: "int64", minimum: 0 },
              },
              "Referrer-Policy": {
                schema: { type: "string", const: "no-referrer" },
              },
              "X-Content-Type-Options": {
                schema: { type: "string", const: "nosniff" },
              },
            },
            content: {
              "*/*": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          "400": errorResponse("临时下载 token 无效（INVALID_DOWNLOAD_TOKEN）。"),
          "404": errorResponse("临时下载地址不存在（DOWNLOAD_NOT_FOUND）。"),
          "410": errorResponse("临时下载地址已失效（DOWNLOAD_UNAVAILABLE）。"),
          "503": errorResponse("用量日志暂不可用（USAGE_LOG_UNAVAILABLE）。"),
          "500": errorResponse("服务端内部错误（INTERNAL_ERROR）。"),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyBearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "syn_sk_...",
        description: "Console 创建的 Synapse API 密钥。",
      },
      DownloadToken: {
        type: "apiKey",
        in: "query",
        name: "token",
        description: "创建下载地址接口返回的十分钟临时 bearer token。",
      },
    },
    headers: {
      RequestId: requestIdHeader,
      NoStore: noStoreHeader,
    },
    schemas: {
      CreateDownloadRequest: createDownloadRequestJsonSchema,
      CreateDownloadResponse: {
        type: "object",
        required: ["requestId", "data"],
        additionalProperties: false,
        properties: {
          requestId: { type: "string" },
          data: {
            type: "object",
            required: ["sourceType", "artifact", "download"],
            additionalProperties: false,
            properties: {
              sourceType: {
                type: "string",
                enum: ["share", "share_item", "site", "site_path", "public_asset"],
              },
              artifact: {
                type: "object",
                required: ["type", "fileName", "mimeType", "size", "entryPath", "snapshotId"],
                additionalProperties: false,
                properties: {
                  type: { type: "string", enum: ["file", "archive"] },
                  fileName: { type: "string" },
                  mimeType: { type: "string" },
                  size: {
                    oneOf: [
                      { type: "string", pattern: "^[0-9]+$" },
                      { type: "null" },
                    ],
                  },
                  entryPath: {
                    oneOf: [
                      { type: "string" },
                      { type: "null" },
                    ],
                  },
                  snapshotId: { type: "string", pattern: "^snap_[A-Za-z0-9_-]{43}$" },
                },
              },
              download: {
                type: "object",
                required: ["method", "url", "expiresAt"],
                additionalProperties: false,
                properties: {
                  method: { type: "string", const: "GET" },
                  url: { type: "string", format: "uri" },
                  expiresAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["requestId", "error"],
        additionalProperties: false,
        properties: {
          requestId: { type: "string" },
          error: {
            type: "object",
            required: ["code", "message"],
            additionalProperties: false,
            properties: {
              code: {
                type: "string",
                enum: [
                  "INVALID_REQUEST",
                  "INVALID_API_KEY",
                  "INSUFFICIENT_SCOPE",
                  "LINK_PASSWORD_REQUIRED_OR_INVALID",
                  "LINK_NOT_FOUND",
                  "ARCHIVE_TOO_LARGE",
                  "UNSUPPORTED_LINK",
                  "INVALID_DOWNLOAD_TOKEN",
                  "DOWNLOAD_NOT_FOUND",
                  "DOWNLOAD_UNAVAILABLE",
                  "USAGE_LOG_UNAVAILABLE",
                  "INTERNAL_ERROR",
                ],
              },
              message: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const

export function createOpenApiContractDocument(documentPublicUrl: string) {
  return {
    ...OPEN_API_CONTRACT_DOCUMENT_BASE,
    externalDocs: {
      description: "开放接口文档",
      url: new URL("open-api/", `${documentPublicUrl.replace(/\/+$/u, "")}/`).toString(),
    },
  } as const
}
