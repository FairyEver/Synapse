import "reflect-metadata"
import { PATH_METADATA } from "@nestjs/common/constants"
import { Test } from "@nestjs/testing"
import request from "supertest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  OPEN_API_CREATE_DOWNLOAD_PATHS,
  OPEN_API_NOTIFICATIONS_BASE_PATH,
  OPEN_API_NOTIFICATION_KEY_SEND_PATH,
  OPEN_API_NOTIFICATION_PATH_SEND_PATH,
  OPEN_API_NOTIFICATION_SEND_PATH,
  OPEN_API_PUBLIC_LINK_DOWNLOAD_PATH,
  createOpenApiContractDocument,
  createDownloadRequestSchema,
} from "./open-api-contract"
import { apiKeySecretPatternSource } from "../api-keys/api-key-token"
import { OpenApiContractController } from "./open-api-contract.controller"

describe("Open API machine-readable contract", () => {
  const contractDocument = createOpenApiContractDocument("http://localhost:19773/document")

  beforeEach(() => {
    vi.stubEnv("APP_PUBLIC_URL", "http://localhost:3000")
    vi.stubEnv("DOCUMENT_PUBLIC_URL", "http://localhost:19773/document")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("publishes a stable OpenAPI 3.1 discovery endpoint", () => {
    expect(Reflect.getMetadata(PATH_METADATA, OpenApiContractController)).toBe("/api/open")
    expect(Reflect.getMetadata(PATH_METADATA, OpenApiContractController.prototype.document)).toBe("/openapi.json")
    expect(Reflect.getMetadata("THROTTLER:SKIPdefault", OpenApiContractController.prototype.document)).toBe(true)
    expect(new OpenApiContractController().document()).toEqual(contractDocument)
    expect(contractDocument.openapi).toBe("3.1.0")
    expect(contractDocument.servers).toEqual([{ url: "/api/open/v1" }])
    expect(contractDocument.externalDocs.url).toBe("http://localhost:19773/document/open-api/")
  })

  it("serves the contract as OpenAPI JSON over HTTP", async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OpenApiContractController],
    }).compile()
    const app = moduleRef.createNestApplication()
    await app.init()
    try {
      const response = await request(app.getHttpServer())
        .get("/api/open/openapi.json")
        .expect(200)
      expect(response.headers["content-type"]).toContain("application/vnd.oai.openapi+json")
      expect(response.headers["cache-control"]).toBe("public, max-age=300")
      expect(response.body).toEqual(contractDocument)
    } finally {
      await app.close()
    }
  })

  it("describes the canonical, legacy, and temporary download endpoints", () => {
    const paths = contractDocument.paths
    expect(paths[OPEN_API_PUBLIC_LINK_DOWNLOAD_PATH].post).toMatchObject({
      operationId: "createPublicLinkDownload",
      security: [{ ApiKeyBearer: [] }],
      "x-required-scope": "drive.public_link.download",
    })
    expect(paths["/drive/share-links/downloads"].post).toMatchObject({
      operationId: "createShareLinkDownloadLegacy",
      deprecated: true,
    })
    expect(paths["/downloads/{grantId}"].get).toMatchObject({
      operationId: "downloadPublicLinkArtifact",
      security: [{ DownloadToken: [] }],
    })
    expect(OPEN_API_CREATE_DOWNLOAD_PATHS).toEqual([
      "/drive/public-links/downloads",
      "/drive/share-links/downloads",
    ])
  })

  it("describes the three notification send shapes without an Authorization header", () => {
    const paths = contractDocument.paths
    expect(OPEN_API_NOTIFICATIONS_BASE_PATH).toBe("/api/open/v1/notifications")
    expect(OPEN_API_NOTIFICATION_SEND_PATH).toBe("/notifications")
    expect(OPEN_API_NOTIFICATION_KEY_SEND_PATH).toBe("/notifications/{key}")
    expect(OPEN_API_NOTIFICATION_PATH_SEND_PATH).toBe("/notifications/{key}/{title}/{body}")

    const operations = [
      paths[OPEN_API_NOTIFICATION_SEND_PATH].post,
      paths[OPEN_API_NOTIFICATION_KEY_SEND_PATH].post,
      paths[OPEN_API_NOTIFICATION_PATH_SEND_PATH].get,
    ]
    expect(operations.map((operation) => operation.operationId)).toEqual([
      "sendNotification",
      "sendNotificationWithKeyInPath",
      "sendNotificationFromPath",
    ])
    for (const operation of operations) {
      // 凭证是路径段或请求体里的 `key`；OpenAPI 3.1 的 apiKey scheme 表达不了路径段，
      // 所以这里刻意不声明 security，由必需参数和 x-required-scope 承担。
      expect(operation.security).toEqual([])
      expect(operation["x-required-scope"]).toBe("notification.send")
    }
    // 路径式必须能从 query 补充分组、链接和级别。
    expect(paths[OPEN_API_NOTIFICATION_PATH_SEND_PATH].get.parameters.map((parameter) => parameter.name))
      .toEqual(["key", "title", "body", "group", "url", "level", "Idempotency-Key"])
    // HEAD 探测不该触发推送，所以这条形状额外声明 405。
    expect(Object.keys(paths[OPEN_API_NOTIFICATION_PATH_SEND_PATH].get.responses)).toContain("405")
    expect(contractDocument.components.schemas.ErrorResponse).toMatchObject({
      properties: { error: { properties: { code: { enum: expect.arrayContaining(["METHOD_NOT_ALLOWED"]) } } } },
    })
  })

  it("accepts both JSON and form encoding for the message body", () => {
    const content = contractDocument.paths[OPEN_API_NOTIFICATION_KEY_SEND_PATH].post.requestBody.content
    expect(Object.keys(content).sort()).toEqual(["application/json", "application/x-www-form-urlencoded"])
    expect(content["application/json"].schema).toEqual({ $ref: "#/components/schemas/SendNotificationRequest" })
  })

  it("generates the notification JSON schemas from the runtime Zod schemas", () => {
    expect(contractDocument.components.schemas.SendNotificationRequest).toMatchObject({
      type: "object",
      required: ["title", "body"],
      additionalProperties: false,
      properties: {
        title: { type: "string", minLength: 1, maxLength: 64 },
        body: { type: "string", minLength: 1, maxLength: 512 },
        group: { type: "string", minLength: 1, maxLength: 64 },
        url: { type: "string", maxLength: 2048, pattern: "^https:" },
        // `level` 有默认值，所以不进入 required。
        level: { type: "string", default: "active" },
      },
    })
    expect(contractDocument.components.schemas.SendNotificationWithKeyRequest).toMatchObject({
      required: ["title", "body", "key"],
      additionalProperties: false,
      properties: { key: { type: "string", pattern: apiKeySecretPatternSource } },
    })
  })

  it("shares the strict request schema with the JSON contract", () => {
    expect(createDownloadRequestSchema.safeParse({
      url: "https://synapse.example/share/shr_example",
    }).success).toBe(true)
    expect(createDownloadRequestSchema.safeParse({
      url: "https://synapse.example/share/shr_example",
      password: "separate-secret",
    }).success).toBe(false)
    expect(contractDocument.components.schemas.CreateDownloadRequest).toEqual({
      type: "object",
      properties: {
        url: {
          type: "string",
          maxLength: 2048,
          format: "uri",
          description: "完整的同源 Synapse Drive 公共 URL，支持 /share、/sites 和 /files。",
        },
      },
      required: ["url"],
      additionalProperties: false,
    })
  })

  it("documents stable response envelopes and security schemes", () => {
    expect(contractDocument.components.securitySchemes).toEqual({
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
    })
    expect(contractDocument.components.schemas.CreateDownloadResponse)
      .toMatchObject({ required: ["requestId", "data"] })
    expect(contractDocument.components.schemas.ErrorResponse)
      .toMatchObject({ required: ["requestId", "error"] })
  })

  it("serializes to JSON without dangling internal references", () => {
    const document = JSON.parse(JSON.stringify(contractDocument)) as Record<string, unknown>
    const references = collectReferences(document)
    expect(references.length).toBeGreaterThan(0)
    for (const reference of references) {
      expect(resolveJsonPointer(document, reference), `Missing OpenAPI reference: ${reference}`).toBeDefined()
    }
  })
})

function collectReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectReferences)
  if (!value || typeof value !== "object") return []
  return Object.entries(value).flatMap(([key, nested]) => (
    key === "$ref" && typeof nested === "string"
      ? [nested]
      : collectReferences(nested)
  ))
}

function resolveJsonPointer(document: Record<string, unknown>, reference: string): unknown {
  if (!reference.startsWith("#/")) return undefined
  return reference.slice(2).split("/").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined
    const key = segment.replace(/~1/gu, "/").replace(/~0/gu, "~")
    return (current as Record<string, unknown>)[key]
  }, document)
}
