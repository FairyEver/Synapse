import { describe, expect, it } from "vitest"

import {
  buildUserSecretChangeSet,
  hasUserSecretChanges,
} from "../repository-variables"
import type { SecretSafeView } from "../../../../../app-capabilities/secrets/shared/schema"

const secrets: SecretSafeView[] = [
  { id: "secret-1", name: "TOKEN", description: "Existing token", hasValue: true },
  { id: "secret-2", name: "UNCHANGED", hasValue: true },
]

describe("user secret change helpers", () => {
  it("detects new and updated secrets from submitted substitutions", () => {
    const changeSet = buildUserSecretChangeSet(secrets, {
      token: "new",
      API_URL: "https://example.test",
      EMPTY: "",
      UNCHANGED: "same",
    })

    expect(changeSet).toEqual({
      newSecrets: [
        { name: "API_URL", value: "https://example.test" },
      ],
      updatedSecrets: [
        { name: "TOKEN", value: "new" },
        { name: "UNCHANGED", value: "same" },
      ],
    })
    expect(hasUserSecretChanges(changeSet)).toBe(true)
  })

  it("ignores blank substitution values", () => {
    const changeSet = buildUserSecretChangeSet(secrets, {
      EMPTY: "",
    })

    expect(changeSet).toEqual({
      newSecrets: [],
      updatedSecrets: [],
    })
    expect(hasUserSecretChanges(changeSet)).toBe(false)
  })

  it("detects no changes when a saved secret already has a value and the user leaves it blank", () => {
    const changeSet = buildUserSecretChangeSet(secrets, {
      TOKEN: "",
    })

    expect(changeSet).toEqual({
      newSecrets: [],
      updatedSecrets: [],
    })
    expect(hasUserSecretChanges(changeSet)).toBe(false)
  })

  it("detects no changes when a saved secret value is unchanged", () => {
    const changeSet = buildUserSecretChangeSet(
      secrets,
      { TOKEN: "saved-token" },
      { TOKEN: "saved-token" },
    )

    expect(changeSet).toEqual({
      newSecrets: [],
      updatedSecrets: [],
    })
    expect(hasUserSecretChanges(changeSet)).toBe(false)
  })
})
