import type { BuiltinConnectorDefinition } from "./types"

export const figmaConnector = {
  id: "figma",
  name: "Figma",
  description: "连接 Figma Desktop MCP",
  documentationUrl: "https://synapse.d2.pub/document/connectors/figma",
  skillPackageId: "figma-skill",
  integration: {
    kind: "mcp-streamable-http",
    endpoint: "http://127.0.0.1:3845/mcp",
    requiredTools: ["get_design_context", "get_screenshot"],
  },
} as const satisfies BuiltinConnectorDefinition

export const portalTestConnector = {
  id: "portal-headless-test",
  name: "Portal Link Test",
  integration: {
    kind: "portal-session",
    environmentId: "test",
    baseUrl: "https://biz-api-test.wodecorp.cn",
    portalWebUrl: "https://webtest01.wodecorp.cn/portal.html#/",
    authorizationUrl: "https://webtest01.wodecorp.cn/portal.html#/connect/synapse",
    callbackUrl: "synapse://portal-headless-test/callback",
    language: "zh-CN",
  },
} as const satisfies BuiltinConnectorDefinition

export const portalConnector = {
  id: "portal-headless",
  name: "Portal Link",
  integration: {
    kind: "portal-session",
    environmentId: "prod",
    baseUrl: "https://biz-api.wodecorp.cn",
    portalWebUrl: "https://portal.wodecorp.cn/#/",
    authorizationUrl: "https://portal.wodecorp.cn/#/connect/synapse",
    callbackUrl: "synapse://portal-headless/callback",
    language: "zh-CN",
  },
} as const satisfies BuiltinConnectorDefinition

export const wecomMailConnector = {
  id: "wecom-mail",
  name: "企业微信邮箱",
  description: "通过企业微信扫码连接邮箱",
  integration: {
    kind: "wecom-mail",
  },
} as const satisfies BuiltinConnectorDefinition

export const builtinConnectors = [figmaConnector, portalTestConnector, portalConnector, wecomMailConnector] as const satisfies readonly BuiltinConnectorDefinition[]

const definitionsById = new Map<string, BuiltinConnectorDefinition>()
for (const definition of builtinConnectors) {
  if (definitionsById.has(definition.id)) {
    throw new Error(`Duplicate builtin connector id: ${definition.id}`)
  }
  definitionsById.set(definition.id, definition)
}

export function getBuiltinConnectorDefinition(id: string): BuiltinConnectorDefinition | undefined {
  return definitionsById.get(id)
}
