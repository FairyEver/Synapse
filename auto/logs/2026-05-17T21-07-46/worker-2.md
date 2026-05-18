# Worker 2

{"type":"thread.started","thread_id":"019e37c4-3863-7d63-8fca-2b2808769726"}


```json
{
  "type": "thread.started",
  "thread_id": "019e37c4-3863-7d63-8fca-2b2808769726"
}
```
{"type":"turn.started"}


```json
{
  "type": "turn.started"
}
```


**stderr**

2026-05-17T21:07:50.113248Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when UnexpectedContentType(Some("missing-content-type; body: "))



**stderr**

2026-05-17T21:07:50.799534Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: IO error: peer closed connection without sending TLS close_notify: https://docs.rs/rustls/latest/rustls/manual/_03_howto/index.html#unexpected-eof, url: wss://chatgpt.com/backend-api/codex/responses

{"type":"error","message":"You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at May 20th, 2026 4:03 PM."}


```json
{
  "type": "error",
  "message": "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at May 20th, 2026 4:03 PM."
}
```
{"type":"turn.failed","error":{"message":"You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at May 20th, 2026 4:03 PM."}}


```json
{
  "type": "turn.failed",
  "error": {
    "message": "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at May 20th, 2026 4:03 PM."
  }
}
```


---
**Duration:** 7.6s | **Status:** error | **Exit:** 1
