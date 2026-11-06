import { readVariablePath } from "../../../automation-trigger-packages/variable-contract"
import { describe, expect, it } from "vitest"
import { LIVE_MESSAGE_TYPES } from "@synapse/shared"

import {
  buildAutomationTemplateVariables,
  renderActionTemplate,
  renderStringRecordTemplates,
} from "../template-variables"

describe("action template variables", () => {
  it.each([
    { query: { tag: ["a", "b"] }, headers: { "x-test": "value" }, body: { order: { id: 12 }, items: [{ name: "中文" }] } },
    { query: {}, headers: {}, body: {} },
    {},
  ])("renders every declared whole Webhook value, including empty or missing fields", (request) => {
    const variables = webhookVariables(request)
    for (const field of ["body", "query", "headers"] as const) {
      const expected = request[field] === undefined ? "" : JSON.stringify(request[field])
      for (const prefix of ["trigger.request", "trigger.payload.request"]) {
        expect(renderActionTemplate(`{{${prefix}.${field}}}`, variables)).toBe(expected)
      }
    }
  })

  it("renders selected nested Webhook objects and arrays as JSON on both paths", () => {
    const variables = webhookVariables({
      body: { order: { id: 12, optional: null }, items: [{ name: "中文" }], empty: [], nil: null },
      query: { tag: ["a", "b"] }, headers: {},
    })
    for (const prefix of ["trigger.request", "trigger.payload.request"]) {
      expect(renderActionTemplate(`{{${prefix}.body.order}}`, variables)).toBe('{"id":12,"optional":null}')
      expect(renderActionTemplate(`{{${prefix}.body.items}}`, variables)).toBe('[{"name":"中文"}]')
      expect(renderActionTemplate(`{{${prefix}.body.empty}}`, variables)).toBe("[]")
      expect(renderActionTemplate(`{{${prefix}.body.nil}}`, variables)).toBe("")
      expect(renderActionTemplate(`{{${prefix}.query.tag}}`, variables)).toBe('["a","b"]')
    }
  })

  it("keeps declared whole values available when a wide body exhausts the flatten budget", () => {
    const body = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`key${index}`, index]))
    const variables = webhookVariables({ body, query: { marker: "query" }, headers: { marker: "header" } })
    for (const prefix of ["trigger.request", "trigger.payload.request"]) {
      expect(renderActionTemplate(`{{${prefix}.body}}`, variables)).toBe(JSON.stringify(body))
      expect(renderActionTemplate(`{{${prefix}.query}}`, variables)).toBe('{"marker":"query"}')
      expect(renderActionTemplate(`{{${prefix}.headers}}`, variables)).toBe('{"marker":"header"}')
    }
    expect(Object.keys(variables).length).toBeLessThanOrEqual(200)
    expect(renderActionTemplate("{{trigger.request.body.key499}}", variables)).toBe("499")
    expect(renderActionTemplate("{{trigger.request.query.marker}}", variables)).toBe("query")
  })

  it("uses the same depth boundary for short and original request paths", () => {
    const body = { a: { b: { c: { d: { e: { f: { g: { h: "depth-eight" } } } } } } } }
    const variables = webhookVariables({ body, query: {}, headers: {} })
    for (const prefix of ["trigger.request", "trigger.payload.request"]) {
      expect(renderActionTemplate(`{{${prefix}.body.a.b.c.d.e.f.g.h}}`, variables)).toBe("depth-eight")
    }
  })

  it.each([
    { body: null, expected: "" }, { body: false, expected: "false" },
    { body: 0, expected: "0" }, { body: "中文文本", expected: "中文文本" },
  ])("preserves scalar and null body semantics on both paths", ({ body, expected }) => {
    const variables = webhookVariables({ body, query: {}, headers: {} })
    expect(renderActionTemplate("{{trigger.request.body}}", variables)).toBe(expected)
    expect(renderActionTemplate("{{trigger.payload.request.body}}", variables)).toBe(expected)
  })

  it("renders braced variables and supports optional dollar prefix", () => {
    expect(renderActionTemplate(
      "run {{trigger.automationName}} at {{$trigger.triggeredAt}}",
      {
        "trigger.automationName": "Daily",
        "trigger.triggeredAt": "2026-06-06T00:00:00.000Z",
      },
    )).toBe("run Daily at 2026-06-06T00:00:00.000Z")
  })

  it("fails on unknown variables", () => {
    expect(() => renderActionTemplate("{{trigger.missing}}", {}))
      .toThrow("未知变量：trigger.missing")
  })

  it("renders record keys and values", () => {
    expect(renderStringRecordTemplates(
      { "X-{{trigger.type}}": "run-{{trigger.triggeredBy}}" },
      {
        "trigger.type": "builtin.cron",
        "trigger.triggeredBy": "trigger",
      },
    )).toEqual({ "X-builtin.cron": "run-trigger" })
  })

  it("builds schedule trigger variables from automation context", () => {
    expect(buildAutomationTemplateVariables({
      triggerType: "builtin.cron",
      triggerConfig: { expr: "0 9 * * *", timezone: "Asia/Shanghai" },
      triggeredBy: "trigger",
      triggeredAt: "2026-06-06T01:00:00.000Z",
      scheduledAt: "2026-06-06T01:00:00.000Z",
      automationId: "automation:1",
      automationName: "Morning",
    })).toEqual(expect.objectContaining({
      "trigger.type": "builtin.cron",
      "trigger.triggeredBy": "trigger",
      "trigger.triggeredAt": "2026-06-06T01:00:00.000Z",
      "trigger.scheduledAt": "2026-06-06T01:00:00.000Z",
      "trigger.automationId": "automation:1",
      "trigger.automationName": "Morning",
      "trigger.cron": "0 9 * * *",
      "trigger.timezone": "Asia/Shanghai",
    }))
  })

  it("flattens event payload variables without logging raw payload", () => {
    expect(buildAutomationTemplateVariables({
      triggerType: "builtin.webhook",
      triggerConfig: {},
      triggeredBy: "trigger",
      triggeredAt: "2026-06-06T01:00:00.000Z",
      scheduledAt: "2026-06-06T01:00:00.000Z",
      automationId: "automation:1",
      automationName: "Webhook",
      event: {
        source: "github",
        type: "issue",
        receivedAt: "2026-06-06T01:00:01.000Z",
        payload: { issue: { title: "Bug", number: 12 }, labels: ["bug"] },
      },
    })).toEqual(expect.objectContaining({
      "trigger.source": "github",
      "trigger.eventType": "issue",
      "trigger.receivedAt": "2026-06-06T01:00:01.000Z",
      "trigger.payload": "{\"issue\":{\"title\":\"Bug\",\"number\":12},\"labels\":[\"bug\"]}",
      "trigger.payload.issue.title": "Bug",
      "trigger.payload.issue.number": "12",
      "trigger.payload.labels.0": "bug",
    }))
  })

  it("builds direct webhook request variables", () => {
    const variables = buildAutomationTemplateVariables({
      triggerType: "builtin.webhook",
      triggerConfig: { webhookPublicId: "wh_public", webhookName: "GitHub" },
      triggeredBy: "trigger",
      triggeredAt: "2026-06-06T01:00:00.000Z",
      scheduledAt: "2026-06-06T01:00:00.000Z",
      automationId: "automation:1",
      automationName: "Webhook",
      event: {
        source: "webhook",
        type: LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
        receivedAt: "2026-06-06T01:00:01.000Z",
        payload: {
          deliveryId: "delivery-1",
          webhook: { id: "webhook-1", publicId: "wh_public", name: "GitHub" },
          request: {
            method: "POST",
            contentType: "application/json",
            query: { event: "push" },
            headers: { "x-github-event": "push" },
            body: { repository: { full_name: "FairyEver/Synapse" } },
            bodyText: "{\"repository\":{\"full_name\":\"FairyEver/Synapse\"}}",
          },
        },
      },
    })

    expect(variables).toEqual(expect.objectContaining({
      "trigger.deliveryId": "delivery-1",
      "trigger.webhook": "{\"id\":\"webhook-1\",\"publicId\":\"wh_public\",\"name\":\"GitHub\"}",
      "trigger.webhook.id": "webhook-1",
      "trigger.webhook.publicId": "wh_public",
      "trigger.webhook.name": "GitHub",
      "trigger.request": "{\"method\":\"POST\",\"contentType\":\"application/json\",\"query\":{\"event\":\"push\"},\"headers\":{\"x-github-event\":\"push\"},\"body\":{\"repository\":{\"full_name\":\"FairyEver/Synapse\"}},\"bodyText\":\"{\\\"repository\\\":{\\\"full_name\\\":\\\"FairyEver/Synapse\\\"}}\"}",
      "trigger.request.method": "POST",
      "trigger.request.contentType": "application/json",
      "trigger.request.query.event": "push",
      "trigger.request.headers.x-github-event": "push",
      "trigger.request.body": "{\"repository\":{\"full_name\":\"FairyEver/Synapse\"}}",
      "trigger.request.body.repository.full_name": "FairyEver/Synapse",
      "trigger.request.bodyText": "{\"repository\":{\"full_name\":\"FairyEver/Synapse\"}}",
      "trigger.payload.request.body.repository.full_name": "FairyEver/Synapse",
    }))
    expect(renderActionTemplate("repo={{trigger.request.body.repository.full_name}}", variables))
      .toBe("repo=FairyEver/Synapse")
  })

  it("exposes whole webhook request json and empty defaults for body-less deliveries", () => {
    const variables = buildAutomationTemplateVariables({
      triggerType: "builtin.webhook",
      triggerConfig: { webhookPublicId: "wh_public", webhookName: "Ping" },
      triggeredBy: "trigger",
      triggeredAt: "2026-06-06T01:00:00.000Z",
      scheduledAt: "2026-06-06T01:00:00.000Z",
      automationId: "automation:1",
      automationName: "Webhook",
      event: {
        source: "webhook",
        type: LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
        receivedAt: "2026-06-06T01:00:01.000Z",
        payload: {
          deliveryId: "delivery-get",
          webhook: { id: "webhook-1", publicId: "wh_public", name: "Ping" },
          request: {
            method: "GET",
            query: { run: "e2e" },
            headers: { "x-codex-e2e": "marker" },
          },
        },
      },
    })

    expect(variables).toEqual(expect.objectContaining({
      "trigger.request": "{\"method\":\"GET\",\"query\":{\"run\":\"e2e\"},\"headers\":{\"x-codex-e2e\":\"marker\"}}",
      "trigger.request.method": "GET",
      "trigger.request.contentType": "",
      "trigger.request.body": "",
      "trigger.request.bodyText": "",
      "trigger.request.query.run": "e2e",
      "trigger.request.headers.x-codex-e2e": "marker",
    }))
    expect(() => renderActionTemplate("{{trigger.payload.request.body.nested.hello}}", variables)).toThrow("字段不存在")
  })

  it("reports missing webhook dynamic fields instead of silently rendering empty strings", () => {
    const variables = buildAutomationTemplateVariables({
      triggerType: "builtin.webhook",
      triggerConfig: { webhookPublicId: "wh_public", webhookName: "Plain Text" },
      triggeredBy: "trigger",
      triggeredAt: "2026-06-06T01:00:00.000Z",
      scheduledAt: "2026-06-06T01:00:00.000Z",
      automationId: "automation:1",
      automationName: "Webhook",
      event: {
        source: "webhook",
        type: LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
        receivedAt: "2026-06-06T01:00:01.000Z",
        payload: {
          deliveryId: "delivery-text",
          webhook: { id: "webhook-1", publicId: "wh_public", name: "Plain Text" },
          request: {
            method: "POST",
            contentType: "text/plain",
            query: {},
            headers: {},
            body: { text: "hello" },
            bodyText: "hello",
          },
        },
      },
    })

    for (const key of ["trigger.request.body.nested.hello", "trigger.request.query.source", "trigger.request.headers.x-codex-e2e"]) {
      expect(() => renderActionTemplate(`{{${key}}}`, variables)).toThrow("字段不存在")
    }
  })
})

function webhookVariables(request: Record<string, unknown>) {
  return buildAutomationTemplateVariables({
    triggerType: "builtin.webhook", triggerConfig: {}, triggeredBy: "trigger",
    triggeredAt: "2026-11-06T00:00:00.000Z", scheduledAt: "2026-11-06T00:00:00.000Z",
    automationId: "automation:fixture", automationName: "Webhook",
    event: { source: "webhook", type: LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
      receivedAt: "2026-11-06T00:00:00.000Z", payload: { request } },
  })
}


describe("variable product contract", () => {
  it("resolves deep paths and literal dotted/slashed keys without collisions or prototype traversal", () => {
    const variables = webhookVariables({ body: { "order.id": "literal", order: { id: "nested" }, "a/b": 0, nil: null } })
    expect(renderActionTemplate("{{trigger.request.body.order.id}}", variables)).toBe("nested")
    expect(renderActionTemplate("{{trigger.request.body#/order.id}}", variables)).toBe("literal")
    expect(renderActionTemplate("{{trigger.request.body#/a~1b}}", variables)).toBe("0")
    expect(renderActionTemplate("{{trigger.request.body.nil}}", variables)).toBe("")
    expect(() => renderActionTemplate("{{trigger.request.body.toString}}", variables)).toThrow("字段不存在")
    let body: unknown = "deep"
    for (let i = 0; i < 20; i++) body = { a: body }
    expect(renderActionTemplate("{{trigger.request.body." + Array(20).fill("a").join(".") + "}}", webhookVariables({ body }))).toBe("deep")
    expect(() => renderActionTemplate("{{trigger.request.body." + Array(65).fill("a").join(".") + "}}", webhookVariables({ body }))).toThrow("路径")
  })
  it("rejects an event-free Webhook even for a nested optional field", () => {
    expect(() => renderActionTemplate("{{trigger.request.body.order.id}}", {})).toThrow("未知变量")
  })
  it("separates execution time and schedule business date across midnight with an effective timezone", () => {
    const variables = buildAutomationTemplateVariables({ triggerType: "builtin.cron", triggerConfig: { expr: "0 23 * * *", timezone: "Asia/Shanghai" }, triggeredBy: "missed_run", triggeredAt: "2026-11-06T18:00:00.000Z", executedAt: "2026-11-06T18:01:00.000Z", scheduledAt: "2026-11-06T15:00:00.000Z", runId: "run-1", automationId: "auto", automationName: "report" })
    expect(variables["trigger.date"]).toBe("2026-11-06")
    expect(variables["trigger.executedAt"]).toBe("2026-11-06T18:01:00.000Z")
    expect(variables["trigger.runId"]).toBe("run-1")
    expect(variables["trigger.timezone"]).toBe("Asia/Shanghai")
    const local = buildAutomationTemplateVariables({ triggerType: "builtin.cron", triggerConfig: { expr: "0 9 * * *" }, triggeredBy: "manual", triggeredAt: "2026-11-06T00:00:00.000Z", scheduledAt: "2026-11-06T00:00:00.000Z", automationId: "auto", automationName: "report" })
    expect(local["trigger.timezone"]).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })
})


it("preserves event occurrence and receipt times while execution starts on another day", () => {
  const variables = buildAutomationTemplateVariables({ triggerType: "builtin.mail-internal-received", triggerConfig: { timezone: "UTC" }, triggeredBy: "trigger", triggeredAt: "2026-11-06T00:30:00.000Z", executedAt: "2026-11-06T01:00:00.000Z", scheduledAt: "2026-11-06T00:30:00.000Z", automationId: "a", automationName: "mail", event: { source: "mail-internal", type: "message.received", occurredAt: "2026-11-05T23:00:00.000Z", receivedAt: "2026-11-06T00:30:00.000Z", payload: {} } })
  expect(variables["trigger.triggeredAt"]).toBe("2026-11-05T23:00:00.000Z")
  expect(variables["trigger.receivedAt"]).toBe("2026-11-06T00:30:00.000Z")
  expect(variables["trigger.executedAt"]).toBe("2026-11-06T01:00:00.000Z")
  expect(variables["trigger.date"]).toBe("2026-11-05")
})


it("keeps every declared static Webhook alias usable after a wide body", () => {
  const body = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`key${index}`, index]))
  const variables = buildAutomationTemplateVariables({ triggerType: "builtin.webhook", triggerConfig: {}, triggeredBy: "trigger", triggeredAt: "2026-11-06T00:00:00.000Z", scheduledAt: "2026-11-06T00:00:00.000Z", automationId: "a", automationName: "webhook", event: { source: "webhook", type: "received", receivedAt: "2026-11-06T01:00:00.000Z", occurredAt: "2026-11-06T00:00:00.000Z", payload: { deliveryId: "d", webhook: { id: "w", publicId: "public", name: "ERP" }, request: { body, method: "POST", receivedAt: "2026-11-06T00:00:00.000Z" } } } })
  for (const [key, expected] of Object.entries({ "trigger.payload.request.method": "POST", "trigger.payload.request.contentType": "", "trigger.payload.request.bodyText": "", "trigger.payload.request.remoteAddress": "", "trigger.payload.webhook.id": "w", "trigger.payload.webhook.publicId": "public", "trigger.payload.webhook.name": "ERP", "trigger.payload.request.receivedAt": "2026-11-06T00:00:00.000Z" })) {
    expect(renderActionTemplate(`{{${key}}}`, variables)).toBe(expected)
  }
})

it("rejects template delimiters in a raw pointer and supports encoded braces and trailing spaces", () => {
  expect(() => readVariablePath({}, "#/a{b")).toThrow("编码")
  const variables = webhookVariables({ body: { "a{b": "brace", "tail ": "space" } })
  expect(renderActionTemplate("{{trigger.request.body#/a%7Bb}}", variables)).toBe("brace")
  expect(renderActionTemplate("{{trigger.request.body#/tail%20}}", variables)).toBe("space")
})
