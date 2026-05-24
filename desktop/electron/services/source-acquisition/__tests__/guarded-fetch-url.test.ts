import { describe, expect, it } from "vitest"

import { createGuardedFetchUrl } from "../guarded-fetch-url"

describe("createGuardedFetchUrl", () => {
  it("rejects private literal hosts before opening a request", async () => {
    const fetchUrl = createGuardedFetchUrl()

    await expect(fetchUrl("http://127.0.0.1/source", {
      signal: new AbortController().signal,
    })).rejects.toThrow("Local and private network URLs are not allowed.")
  })
})
