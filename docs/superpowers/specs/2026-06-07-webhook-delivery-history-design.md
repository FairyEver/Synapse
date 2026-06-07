# Webhook Delivery History Design

Date: 2026-06-07
Scope: `server/`, `shared/`, `dashboard/`

## Goal

Give both ordinary dashboard users and admins a clear Webhook delivery history page. The page shows which external Webhook requests were received, how they were broadcast to desktop clients, and the final delivery status.

History must remain visible after a Webhook is deleted. Deleting a Webhook revokes the public URL and removes it from the management list, but it does not delete delivery or client receipt records.

## Current Findings

The server already stores live Webhook receive and broadcast data:

- `WebhookDelivery` records method, masked path, sanitized query and headers, body summary, receive time, broadcast counts, status, and error.
- `WebhookDeliveryReceipt` records per-client send and acknowledgement status.
- `GET /api/dashboard/webhooks/:id/deliveries` returns the latest 100 records for one owned Webhook.
- The dashboard currently exposes those records only through a per-Webhook sheet opened from the Webhook card.

The missing product surface is a global history page. There is also a data-retention mismatch: `WebhookDelivery.webhook` currently cascades on Webhook deletion, so deleting a Webhook deletes its history.

## Confirmed Decisions

- Use soft delete for `UserWebhook`.
- Keep the existing per-Webhook recent-100 retention rule.
- Preserve deleted Webhook history and client receipts.
- Add a user history page for the current user's Webhook deliveries.
- Add an admin history page for all users' Webhook deliveries.
- User and admin details both show sanitized summaries only.
- Do not store or display raw full payloads in this change.
- Do not display Webhook secrets, full URLs, Authorization, Cookie, or token-like values in history.
- Replace the Webhook card's sheet-style "记录" action with navigation to the history page filtered to that Webhook.

## Non-Goals

- Do not build a replay queue, retry queue, or dead-letter workflow.
- Do not report local Automation match, skip, run, or failure results.
- Do not add provider-specific parsing or signature validation.
- Do not create a second immutable history table.
- Do not expose raw payload storage for ordinary users.
- Do not add marketing copy or explanatory UI text.

## Data Model

`UserWebhook` gains:

```prisma
deletedAt DateTime?
```

Deletion becomes a soft delete:

- Set `deletedAt` to the current time.
- Set `enabled` to `false`.
- Set nullable `secret` to `null` so the full URL is no longer copyable.
- Keep `secretHash` because the current schema requires it, but public receive logic must ignore deleted rows.
- Keep `publicId`, `name`, `createdAt`, and `updatedAt` for history display.

`WebhookDelivery` gains snapshot columns:

```prisma
webhookPublicId String
webhookName     String
```

New deliveries write these snapshots when the request is accepted. Existing deliveries are backfilled from their related `UserWebhook` during migration when possible.

These snapshots make historical rows stable if the Webhook is renamed later. The relation to `UserWebhook` remains so the UI can show whether the Webhook is now deleted.

Retention stays per Webhook:

- After accepting a delivery, keep the latest 100 deliveries for that Webhook.
- This applies to active and deleted Webhooks.
- Soft deletion does not trigger delivery pruning.

## Receive Behavior

The public Webhook lookup must only accept active rows:

```ts
publicId matches &&
deletedAt === null &&
enabled === true &&
secret verifies
```

Deleted Webhooks should continue returning the same generic not-found response used for unknown, disabled, or wrong-secret Webhooks.

When accepting a delivery, the server stores:

- `webhookId`
- `userId`
- `webhookPublicId`
- `webhookName`
- sanitized request metadata
- body summary and preview
- broadcast counts and status
- per-client receipts

The server must not log or store full secret-bearing URLs in delivery records.

## User API

Add:

```text
GET /api/dashboard/webhook-deliveries
```

Query parameters:

- `page`
- `pageSize`
- `sortBy`
- `sortOrder`
- `webhookId`
- `status`
- `from`
- `to`

Allowed sort fields:

- `receivedAt`
- `status`
- `method`

Response is paginated and scoped to the authenticated user.

Each row includes:

- delivery fields already present in `WebhookDeliveryDto`
- `webhook: { id, publicId, name, currentName, deletedAt }`
- `clientReceipts`

`name` is the delivery-time snapshot. `currentName` is optional and comes from the related Webhook if it still exists. The table should display the snapshot name.

Keep:

```text
GET /api/dashboard/webhooks/:id/deliveries
```

It may internally call the same query path with `webhookId`.

## Admin API

Add:

```text
GET /api/admin/webhook-deliveries
```

Query parameters:

- `page`
- `pageSize`
- `sortBy`
- `sortOrder`
- `userId`
- `user`
- `webhookId`
- `status`
- `from`
- `to`

`user` filters by email or display name substring. `userId` is exact.

Allowed sort fields:

- `receivedAt`
- `status`
- `method`

Each row includes the user summary:

```ts
user: {
  id: string
  email: string
  displayName: string | null
}
```

Admin responses still contain only sanitized query, headers, and body preview.

Admin list reads should be audited with page, page size, and non-sensitive filters.

## Shared DTOs

Add a shared paginated history DTO rather than duplicating dashboard/server shapes:

```ts
export interface WebhookDeliveryHistoryDto extends WebhookDeliveryDto {
  readonly webhook: {
    readonly id: string
    readonly publicId: string
    readonly name: string
    readonly currentName?: string
    readonly deletedAt?: string
  }
  readonly user?: {
    readonly id: string
    readonly email: string
    readonly displayName: string | null
  }
}
```

The admin endpoint includes `user`; the user endpoint omits it.

## Dashboard UX

### User Navigation

Keep the existing `Webhooks` management item.

Add `Webhook 历史` for ordinary users. The route is:

```text
/webhook-deliveries
```

The Webhook card's `记录` action navigates to:

```text
/webhook-deliveries?webhookId=<id>
```

The per-Webhook sheet is no longer the primary record surface and should be removed unless implementation risk requires a temporary compatibility step.

### Admin Navigation

Add `Webhook 历史` under the admin management group.

Use the same route component where practical, switching data source and columns by role. If route guards make that awkward, use a thin admin route wrapper that renders the same feature component in admin mode.

### History Table

Use `dashboard/src/components/data-table/server-data-table.tsx`.

User columns:

- time
- Webhook
- method
- status
- clients
- body
- actions

Admin columns add:

- user

Column details:

- Time uses `receivedAt`.
- Webhook shows the delivery snapshot name and a secondary `publicId`.
- Deleted Webhooks show an `已删除` badge.
- Clients shows `acknowledged/sent/online`.
- Body shows `bodyKind` and `bodySize`.
- Actions contains only `详情`.

Toolbar filters:

- status
- Webhook
- time range
- user search for admins

Filter UI should use existing dashboard shadcn primitives and table patterns. Do not hand-roll table markup on the page.

### Detail Sheet

The detail sheet shows:

- Webhook name and public ID
- method
- status
- received time
- masked path
- sanitized query
- sanitized headers
- body kind, size, and preview
- client receipts
- error, if present

Keep text short:

- Page title: `Webhook 历史`
- Empty state: `暂无数据`
- Error state: `加载失败`
- Detail action: `详情`

Do not add explanatory paragraphs such as "此页面用于..." or implementation notes.

## Security And Privacy

History data uses the same sanitization boundary as the receive pipeline.

The following must not appear in user or admin history responses:

- full Webhook URL with secret
- `secret`
- `secretHash`
- `Authorization`
- `Bearer`
- `Cookie`
- token-like header values
- raw full body outside the stored preview

Admin and user detail views both use the same sanitized summary. Ordinary users do not get a raw-payload exception.

Public receive errors should stay generic to avoid exposing whether a deleted public ID existed.

## Migration And Backfill

Migration steps:

1. Add nullable `deletedAt` to `UserWebhook`.
2. Add nullable `webhookPublicId` and `webhookName` to `WebhookDelivery`.
3. Backfill delivery snapshots from related `UserWebhook`.
4. Make `webhookPublicId` and `webhookName` required after backfill.

The current foreign key relationship guarantees existing delivery rows have a related Webhook, so the migration should not leave nullable snapshot columns behind.

## Testing

Server tests:

- Deleting a Webhook soft-deletes it and keeps deliveries and receipts.
- Deleted Webhooks no longer accept public requests.
- `GET /api/dashboard/webhooks` excludes deleted Webhooks.
- User delivery history returns only the current user's rows.
- Admin delivery history returns rows across users.
- `webhookId`, `status`, `from`, and `to` filters work.
- Admin `user` or `userId` filters work.
- Sorting rejects unsupported fields.
- History DTO maps snapshot name and deleted badge data.
- Secret-bearing URLs and sensitive headers are absent from history responses.
- Existing `/:id/deliveries` remains compatible.

Dashboard tests:

- Webhook card `记录` navigates with `webhookId`.
- User history page renders the server data table.
- Admin history page includes the user column and user filter.
- Deleted Webhooks show `已删除`.
- Detail sheet renders sanitized query, headers, body preview, client receipts, and errors.
- Empty, loading, and error states are short and non-marketing.

Shared tests:

- DTO type exports remain available to server and dashboard.
- Status label helpers cover all existing `WebhookDeliveryStatus` values.

## Release Notes

Implementation must update `RELEASE_NOTES_PENDING.md` because this changes user-visible dashboard behavior and Webhook deletion semantics.
