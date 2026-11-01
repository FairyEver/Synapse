# HTTP workflow

Use `/api/open/openapi.json` for exact schemas. All table paths below are relative to `/api/open/v1`.

```sh
curl --fail-with-body --silent --show-error \
  "$SY_API_BASE_URL/api/open/v1/tables/TABLE_ID/schema" \
  -H "Authorization: Bearer $SY_API_KEY"
```

Query with `POST /tables/{id}/records/query`:

```json
{"filters":[{"field":"status","op":"eq","value":"open"}],"sort":[{"field":"$createdAt","direction":"asc"}],"limit":50}
```

Read `data` and `nextCursor`; continue with unchanged filters/sort until the cursor is null. It binds table, calling identity and schema. After changes, restart. Pagination is not a snapshot; do not assume a total count or load an entire table for a small query. JSON and multi-select are stored values, not deep-query or sorting expressions.

Create with `POST /tables/{id}/records`, `{ "values": { "name": "A" } }`. Update with `PATCH /tables/{id}/records/{recordId}`, `{ "version": 1, "values": { "name": "B" } }`. Delete with `DELETE` and `{ "version": 1 }`. Server controls IDs, creator, timestamps and versions. Missing update fields stay unchanged; null clears optional fields. Defaults apply only on creation.

Writes return minimal ID/version confirmations, not the complete record. Generate one random `Idempotency-Key` per logical record mutation and reuse the same key and body for retries within 24 hours. Changed requests with the same key return409. After an ambiguous network failure, retry the original key before creating a new operation.

Batch import with `POST /tables/{id}/records/batch`:

```json
{"operations":[{"action":"create","values":{"name":"A"}},{"action":"update","id":"RECORD_ID","version":1,"values":{"name":"B"}}]}
```

Split by both count and size: at most100 operations, 1MiB per request, 64KiB per row. Each batch is atomic; failures commit no rows. There is no transaction spanning batches. Updates/deletes need explicit record IDs and versions; do not turn a filter into an unreviewed bulk deletion.

On409, reread and reconcile the schema or row rather than overwriting newer data. On503, honor Retry-After with exponential backoff/jitter, retaining the write key; do not amplify concurrency. On401/403, resolve credentials/ACL, never downgrade a private request to anonymous.

Public webpages use only explicitly anonymous operations, `credentials: 'omit'`, and no API key. Visitors' SY login identity is unsupported in v1, including SY shares. Do not solve private access by embedding the owner's key; use a caller-controlled backend with a server-held restricted key, or official Console.

Tables, rows and archived fields have30-day recovery. Only the owner manages recovery. Table recovery closes anonymous access; reopening is a separate explicit decision. Incompatible schema recovery returns409. Use request IDs for diagnostics, never values or credentials.
