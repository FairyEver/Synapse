# Expose a minimal brokered Web API to restricted JavaScript

Status: deprecated; replaced by accepted ADR-0204

The restricted JavaScript V1 host exposes a fixed ECMAScript profile, immutable `input`, bounded console logging, URL and text-encoding utilities, abort signals, one-shot timers, and a deliberately limited `fetch` surface. It provides no Node.js, DOM, module, storage, worker, WebAssembly, streaming, socket, periodic timer, ambient credential, or direct-network API; every HTTP or HTTPS request and redirect hop crosses the shared network broker.
