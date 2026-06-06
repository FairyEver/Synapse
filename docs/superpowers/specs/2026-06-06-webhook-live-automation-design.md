# Webhook Live Automation Design

Date: 2026-06-06
Scope: `shared/`, `server/`, `dashboard/`, `desktop/`

## Goal

Add cloud Webhooks for logged-in Synapse users. A user creates any number of Webhooks in the dashboard, copies a public URL into GitHub or another external service, and Synapse forwards each accepted request through the existing desktop Live WebSocket connection to all of that user's online desktop clients. The desktop Automation module gains a `Webhook` trigger that can select one of the user's Webhooks and expose the received request as trigger variables.

This is a forwarding feature. The server accepts and broadcasts the Webhook request, but it does not wait for desktop clients or local Automation execution results.

## Confirmed Product Decisions

- Public URL shape:

  ```text
  https://<domain>/webhooks/<publicId>/<secret>
  ```

- The server broadcasts each accepted Webhook delivery to all online desktop clients for the Webhook owner.
- The server returns `202 Accepted` after receive-and-broadcast bookkeeping; it does not wait for client execution.
- Offline clients do not receive missed Webhooks later in this version.
- If multiple online desktop clients have matching local Automations, all of them may execute.
- The server stores receive and broadcast records for troubleshooting.
- Each Webhook keeps its most recent 100 delivery records.
- The existing desktop `AutomationIngressService` is local HTTP ingress and remains separate from this cloud Webhook feature.

## Non-Goals

- Do not build a durable per-client queue, ack protocol, retry queue, or dead-letter workflow.
- Do not return desktop Automation execution results to the external caller.
- Do not synchronize local Automation trigger configuration back to the server.
- Do not add admin management of user Webhooks in this version.
- Do not implement GitHub, Stripe, or other provider-specific signature validation in this version.
- Do not merge cloud Webhooks into the existing local desktop webhook/ingress service.

## Architecture

Add a new workspace package named `@synapse/shared` under `shared/`. It owns cross-package protocol strings and DTO types used by `server`, `dashboard`, and `desktop`.

Suggested package layout:

```text
shared/
  package.json
  tsconfig.json
  src/
    index.ts
    live.ts
    webhook.ts
```

The shared package should define Live message type constants, Live envelope types, Webhook management DTOs, and Webhook delivery payloads. Server, dashboard, and desktop must import those definitions instead of duplicating event-name strings or DTO shapes.

End-to-end flow:

1. A logged-in dashboard user creates a Webhook and receives a URL shaped like `https://<domain>/webhooks/<publicId>/<secret>`.
2. An external service calls that URL.
3. Nginx forwards `/webhooks/` to NestJS.
4. NestJS validates `publicId` and `secret`, parses the request within the body-size limit, creates a delivery record, and broadcasts a Live downlink message to every online desktop socket for that user.
5. The server updates the delivery record with online client count, sent count, failed send count, and status.
6. The server returns `202 Accepted` to the external caller.
7. Each desktop client validates the Live message, converts it to an `AutomationTriggerEvent`, and calls local `AutomationService.acceptEvent(event)`.
8. Local `builtin.webhook` triggers match by `webhookPublicId`; matching enabled Automations execute locally.

## Shared Live Protocol

Live messages must use a single shared protocol model. `@synapse/shared` owns the `type` constants, payload DTOs, and the complete client/server Live message discriminated unions. Server and desktop must import those definitions instead of declaring local string literals or parallel message types.

All Live messages use this envelope shape:

```ts
export type LiveEnvelope<TType extends string, TPayload> = {
  readonly type: TType
  readonly id: string
  readonly sentAt: string
  readonly payload: TPayload
}
```

`@synapse/shared` exports stable type constants:

```ts
export const LIVE_MESSAGE_TYPES = {
  hello: "live.hello",
  welcome: "live.welcome",
  ping: "live.ping",
  pong: "live.pong",
  webhookDeliveryReceived: "webhook.delivery.received",
} as const
```

This feature migrates the existing `hello`, `welcome`, `ping`, and `pong` wire messages to the same shared envelope model instead of keeping a second protocol shape. The migration belongs in the same implementation because the user-facing Webhook feature depends on a Live channel that can support multiple event types cleanly.

Shared unions:

```ts
export type LiveDesktopClientMessage =
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.hello, LiveDesktopHelloPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.ping, LiveDesktopPingPayload>

export type LiveDesktopServerMessage =
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.welcome, LiveDesktopWelcomePayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.pong, LiveDesktopPongPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.webhookDeliveryReceived, WebhookDeliveryReceivedPayload>
```

The parser on both ends should reject malformed envelopes and unknown required payload fields. Unknown future message types are ignored with structured diagnostics that record only the message type and do not log payload content.

Webhook downlink payload:

```ts
export type WebhookDeliveryReceivedPayload = {
  readonly deliveryId: string
  readonly webhook: {
    readonly id: string
    readonly publicId: string
    readonly name: string
  }
  readonly request: {
    readonly method: string
    readonly url: string
    readonly query: Record<string, string | readonly string[]>
    readonly headers: Record<string, string>
    readonly body: unknown
    readonly bodyText?: string
    readonly contentType?: string
    readonly receivedAt: string
    readonly remoteAddress?: string
  }
}
```

## Server Data Model

Add Prisma models:

```prisma
model UserWebhook {
  id         String            @id @default(cuid())
  userId     String
  user       User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  publicId   String            @unique
  secretHash String
  name       String            @db.VarChar(80)
  enabled    Boolean           @default(true)
  createdAt  DateTime          @default(now())
  updatedAt  DateTime          @updatedAt
  deliveries WebhookDelivery[]

  @@index([userId, createdAt])
}

model WebhookDelivery {
  id                String      @id @default(cuid())
  webhookId         String
  webhook           UserWebhook @relation(fields: [webhookId], references: [id], onDelete: Cascade)
  userId            String
  method            String
  path              String
  query             Json
  headers           Json
  bodyKind          String
  bodySize          Int
  bodyPreview       String?
  receivedAt        DateTime    @default(now())
  onlineClientCount Int
  sentClientCount   Int
  failedClientCount Int
  status            String
  error             String?

  @@index([webhookId, receivedAt])
  @@index([userId, receivedAt])
}
```

`User` gains a `webhooks UserWebhook[]` relation.

Identifier rules:

- `publicId`: random, URL-safe, effectively non-guessable, such as `wh_` plus 32 base62/base64url characters.
- `secret`: random URL-safe secret, such as `whsec_` plus 32 bytes encoded with base64url.
- Database stores only `secretHash`.
- The full URL is returned only on create and reset-secret responses.
- List/detail responses show only a masked URL such as `https://synapse.d2.pub/webhooks/wh_xxx/***`.

Delivery retention:

- After inserting a delivery, keep only the most recent 100 deliveries for that Webhook.
- Retention cleanup should be best-effort but structured-warn on failure without failing an already accepted delivery.

## Server Public Webhook Endpoint

Add a NestJS `WebhookModule` with public route:

```text
ALL /webhooks/:publicId/:secret
```

Behavior:

- Unknown `publicId`, wrong `secret`, disabled Webhook, or deleted Webhook returns a generic failure. Prefer a uniform `404` to reduce enumeration signals.
- Supported methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- Request body limit: `256KB`.
- Oversized body returns `413` and is not broadcast.
- JSON body is parsed to `body`.
- Text body sets `bodyText` and `body: { text: bodyText }`.
- URL-encoded form body is parsed to an object.
- Binary or unsafe content types are rejected in this version.
- The external response is `202 Accepted`:

  ```json
  {
    "ok": true,
    "deliveryId": "...",
    "acceptedAt": "..."
  }
  ```

The route must not require dashboard cookies or bearer tokens. The URL secret is the public-call credential.

## Live Server Broadcast

Extend the server Live layer with a bounded method such as:

```ts
broadcastToUser(userId: string, message: LiveServerMessage): {
  readonly onlineClientCount: number
  readonly sentClientCount: number
  readonly failedClientCount: number
}
```

Rules:

- Broadcast only to active sockets for the Webhook owner.
- Do not throw after partial send failure; return counts and record failures.
- Do not log payload body, full URL, or secret.
- Unknown or stale sockets should not block response to the external caller.

## Nginx And Deployment

`server/nginx.conf` must route Webhook paths to NestJS:

```nginx
location /webhooks/ {
  proxy_pass http://127.0.0.1:3001;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Current production Nginx redirects unknown paths to `/dashboard/`, so this location is required for `https://<domain>/webhooks/<publicId>/<secret>` to work.

Update `deploy.sh`, `restart.sh`, and `server/src/deploy-config.spec.ts` with a health check that proves `/webhooks/...` is not redirected to `/dashboard/`. A request such as `/webhooks/not-found/test` should return a NestJS-controlled error like `404`, not a `302` dashboard redirect.

Update `server/README.md` to document the `/webhooks/` route in deployment diagnostics.

## Dashboard User APIs

Authenticated ordinary users manage only their own Webhooks:

```text
GET    /api/dashboard/webhooks
POST   /api/dashboard/webhooks
PATCH  /api/dashboard/webhooks/:id
DELETE /api/dashboard/webhooks/:id
POST   /api/dashboard/webhooks/:id/reset-secret
GET    /api/dashboard/webhooks/:id/deliveries
```

Create input:

```ts
type CreateWebhookInput = {
  readonly name: string
}
```

Update input:

```ts
type UpdateWebhookInput = {
  readonly name?: string
  readonly enabled?: boolean
}
```

List item:

```ts
type DashboardWebhookDto = {
  readonly id: string
  readonly publicId: string
  readonly name: string
  readonly enabled: boolean
  readonly maskedUrl: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastDeliveryAt?: string
  readonly lastDeliveryStatus?: string
}
```

Create and reset-secret responses include `url` once. Normal list/detail responses do not include the raw secret.

All create, update, delete, and reset-secret operations should be audited without raw secret values.

## Dashboard UX

Add a user dashboard page for Webhooks. Ordinary users should see it after login. Admin users do not need a Webhook management page in this version.

Navigation:

- Add `Webhooks` for role `user`.
- It can live under the existing account group or a small automation group. Keep the navigation minimal.

Page:

- Title: `Webhooks`
- Primary action: `新建`
- Table/list columns: name, enabled status, masked URL, last received time, last broadcast summary, created time, actions.
- Actions: copy URL when available, show deliveries, rename, enable/disable, reset secret, delete.
- Empty state: `暂无 Webhook` and `新建`.
- Delivery detail surface shows the most recent 100 deliveries with time, method, status, online client count, sent count, failed count, body size, and error.

UI rules:

- Use existing dashboard shadcn/ui primitives and shared table components.
- Do not add custom colors, gradients, card nesting, marketing copy, or explanatory feature paragraphs.
- For server-side paged delivery tables, use `ServerDataTable`.

## Desktop Live Handling

`LiveConnectionService` should parse Webhook downlink messages after `welcome/pong` handling:

- Valid `webhook.delivery.received`: pass to a main-process handler.
- Unknown `type`: ignore and structured-warn with only the type string.
- Invalid payload: ignore and structured-warn without payload contents.

The Webhook delivery handler lives in Electron main process, not React. It converts the shared payload into:

```ts
automation.acceptEvent({
  source: "webhook",
  type: "webhook.delivery.received",
  receivedAt: payload.request.receivedAt,
  payload: {
    deliveryId: payload.deliveryId,
    webhook: payload.webhook,
    request: {
      method: payload.request.method,
      query: payload.request.query,
      headers: payload.request.headers,
      body: payload.request.body,
      bodyText: payload.request.bodyText,
      contentType: payload.request.contentType,
      remoteAddress: payload.request.remoteAddress,
    },
  },
})
```

The desktop handler must not persist the raw Webhook event outside normal Automation run behavior.

## Automation Webhook Trigger

Add a built-in event trigger package:

```text
desktop/automation-trigger-packages/builtin/webhook/
  config.renderer.tsx
  index.main.ts
  index.renderer.ts
  index.shared.ts
  manifest.ts
  runtime.main.ts
  schema.ts
```

Config:

```ts
type WebhookTriggerConfig = {
  readonly webhookPublicId: string
  readonly webhookName?: string
}
```

Main runtime match:

```ts
event.source === "webhook" &&
event.type === "webhook.delivery.received" &&
event.payload.webhook.publicId === config.webhookPublicId
```

Renderer config:

- Shows a select for the current user's server Webhooks.
- Requires a logged-in account.
- Does not store the Webhook secret in Automation config.
- If logged out, show `登录后可选择 Webhook`.
- If loading fails, show `加载失败` and `重试`.
- If saved `webhookPublicId` no longer exists, mark config as needing update and show `Webhook 不存在或已删除`.

Desktop should expose a narrow IPC method or existing account-aware API helper for listing the current user's Webhooks from `/api/dashboard/webhooks`.

## Trigger Variables

The Webhook trigger declares variables in its manifest so the existing Automation variable popover can expose them.

Common variables:

- `trigger.type`
- `trigger.triggeredBy`
- `trigger.triggeredAt`
- `trigger.automationId`
- `trigger.automationName`

Webhook-specific variables:

- `trigger.webhook.id`
- `trigger.webhook.publicId`
- `trigger.webhook.name`
- `trigger.deliveryId`
- `trigger.request.method`
- `trigger.request.contentType`
- `trigger.request.bodyText`

Dynamic variables continue to be available through flattened payload paths:

- `trigger.payload.webhook.name`
- `trigger.payload.request.query.<key>`
- `trigger.payload.request.headers.<key>`
- `trigger.payload.request.body.<path>`

Extend `buildAutomationTemplateVariables` to map common Webhook fields to the short paths above while preserving the existing `trigger.payload.*` flattening behavior.

Header handling:

- Normalize header keys to lower case for stable variable names.
- Sensitive headers such as `authorization`, `cookie`, and token-like keys should be redacted or omitted before variable exposure.
- Server delivery records store only redacted header summaries.

## Security And Logging

- Secret is part of the URL because many external services only accept a URL field.
- Full secret must not appear in dashboard list responses, delivery records, audit logs, server logs, desktop logs, or deployment diagnostics.
- `publicId` can appear in logs and UI.
- Request body is forwarded to the user's own desktop clients, but server records store only safe body metadata and a redacted preview.
- Permission and audit logging must not include full Webhook URL.
- Existing server pino redaction and desktop structured logger conventions still apply.
- Existing Automation executor redaction remains responsible for executor logs and run results.

## Error Handling

- Invalid URL credentials: generic failure, no broadcast.
- Disabled Webhook: generic failure, no broadcast.
- Body too large: `413`, no broadcast.
- Unsupported body type: `415`, no broadcast.
- Broadcast with zero online clients: response remains `202`; delivery status records zero targets.
- Partial socket send failure: response remains `202`; delivery records failed count.
- Desktop invalid Live payload: no Automation event.
- Desktop Webhook trigger config stale: automation validation reports needs update.

## Tests

Server:

- Create, list, update, delete, and reset secret for current user.
- Users cannot read or mutate another user's Webhooks.
- `publicId` is unique.
- Secret hash validates current URL and rejects old secret after reset.
- Public Webhook route returns `202` and does not wait for client execution.
- No online clients still returns `202` and records `onlineClientCount: 0`.
- Multiple online clients produce matching broadcast counts.
- Only 100 most recent deliveries remain per Webhook.
- Oversized body returns `413`.
- Secret does not appear in logs, delivery records, audit records, or masked DTOs.

Shared/Live:

- Server and desktop use shared message constants for `webhook.delivery.received`.
- Existing `hello`, `welcome`, `ping`, and `pong` use the same shared envelope protocol and shared DTO definitions.
- Unknown Live messages do not trigger Automation.
- Malformed Webhook delivery messages do not trigger Automation.

Desktop Automation:

- `builtin.webhook` registers in main and renderer registries.
- Logged-out state prevents selecting Webhooks.
- Matching `webhookPublicId` triggers execution.
- Non-matching events do not trigger execution.
- Query, header, body, and short Webhook variables render through existing template substitution.
- Sensitive headers are not exposed as raw variables.
- Existing cron and interval triggers continue to work.

Deployment:

- `server/nginx.conf` contains `/webhooks/` proxy location.
- `deploy.sh` and `restart.sh` check that `/webhooks/...` is handled by NestJS rather than redirected to `/dashboard/`.
- `server/src/deploy-config.spec.ts` covers the route and health-check expectations.

## Implementation Order

1. Add `@synapse/shared` and move shared Live/Webhook message constants and DTOs into it.
2. Add server Prisma migration and `WebhookModule` management APIs.
3. Add public `/webhooks/:publicId/:secret` receive endpoint and delivery retention.
4. Migrate Live `hello`, `welcome`, `ping`, and `pong` to the shared envelope protocol, then extend Live server registry/gateway with user broadcast.
5. Update Nginx, deploy checks, restart checks, and server README.
6. Add dashboard API types, route, navigation, management UI, and delivery records UI.
7. Add desktop Live downlink handler that calls `AutomationService.acceptEvent`.
8. Add `builtin.webhook` Automation trigger package and renderer config.
9. Extend Automation template variables for short Webhook paths.
10. Add tests and release notes.

## Acceptance Criteria

- A logged-in user can create a Webhook and copy a URL shaped like `https://<domain>/webhooks/<publicId>/<secret>`.
- Calling that URL returns `202` without waiting for desktop Automation execution.
- The server broadcasts accepted deliveries to all online desktop clients for the owner.
- A desktop Automation with the matching Webhook trigger runs locally when a delivery arrives.
- Webhook query, headers, body, method, delivery id, and Webhook metadata are available as trigger variables.
- The dashboard shows recent receive/broadcast records, capped to the most recent 100 per Webhook.
- `/webhooks/` works through production Nginx and is not redirected to `/dashboard/`.
- Shared protocol strings and DTOs, including existing Live heartbeat messages and new Webhook delivery messages, are defined once in `@synapse/shared`.
- Full URL secrets are not stored or displayed in logs, delivery records, audit records, or normal dashboard list responses.
