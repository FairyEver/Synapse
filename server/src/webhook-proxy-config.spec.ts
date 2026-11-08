import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("Webhook proxy privacy", () => {
  it("never logs raw request addresses or buffers webhook bodies to disk", () => {
    const config = readFileSync("nginx.conf", "utf8")
    const block = config.match(/location ~\* \^\/webhooks\/ \{([\s\S]*?)\n  \}/)?.[1]
    expect(block).toBeDefined()
    for (const directive of ["access_log off;", "error_log /dev/null crit;", "proxy_request_buffering off;", "client_max_body_size 256k;", "client_body_buffer_size 256k;"]) {
      expect(block).toContain(directive)
    }
  })
})
