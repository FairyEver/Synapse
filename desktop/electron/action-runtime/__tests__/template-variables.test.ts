import { describe, expect, it } from "vitest"
import { LIVE_MESSAGE_TYPES } from "@synapse/shared"

import {
  buildAutomationTemplateVariables,
  renderActionTemplate,
  renderStringRecordTemplates,
} from "../template-variables"

describe("action template variables", () => {
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
      "trigger.payload.issue.title": "Bug",
      "trigger.payload.issue.number": "12",
      "trigger.payload.labels.0": "bug",
    }))
  })

  it("builds direct webhook request variables", () => {
    expect(buildAutomationTemplateVariables({
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
    })).toEqual(expect.objectContaining({
      "trigger.deliveryId": "delivery-1",
      "trigger.webhook.id": "webhook-1",
      "trigger.webhook.publicId": "wh_public",
      "trigger.webhook.name": "GitHub",
      "trigger.request.method": "POST",
      "trigger.request.contentType": "application/json",
      "trigger.request.query.event": "push",
      "trigger.request.headers.x-github-event": "push",
      "trigger.request.body": "{\"repository\":{\"full_name\":\"FairyEver/Synapse\"}}",
      "trigger.request.bodyText": "{\"repository\":{\"full_name\":\"FairyEver/Synapse\"}}",
      "trigger.payload.request.body.repository.full_name": "FairyEver/Synapse",
    }))
  })
})
