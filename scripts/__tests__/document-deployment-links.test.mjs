import assert from "node:assert/strict"
import test from "node:test"

import {
  replaceDocumentDeploymentLinks,
  resolveDocumentAppPublicUrl,
} from "../../document/.vitepress/deployment-links.mjs"

test("document dev always targets the local app service by default", () => {
  assert.equal(resolveDocumentAppPublicUrl({ APP_PUBLIC_URL: "https://synapse.d2.pub" }, true), "http://localhost:3000")
})

test("document dev accepts an explicit document-build override", () => {
  assert.equal(resolveDocumentAppPublicUrl({
    SYNAPSE_DOCUMENT_APP_PUBLIC_URL: "http://127.0.0.1:3100/",
  }, true), "http://127.0.0.1:3100")
})

test("document production build uses the deployed public app root", () => {
  assert.equal(resolveDocumentAppPublicUrl({ APP_PUBLIC_URL: "https://app.example.com/" }, false), "https://app.example.com")
})

test("document links and copied Markdown share one environment replacement", () => {
  assert.equal(
    replaceDocumentDeploymentLinks(
      "[契约]({{APP_PUBLIC_URL}}/api/open/openapi.json)\n`{{APP_PUBLIC_URL}}/api/open/v1`",
      "http://localhost:3000",
    ),
    "[契约](http://localhost:3000/api/open/openapi.json)\n`http://localhost:3000/api/open/v1`",
  )
})
