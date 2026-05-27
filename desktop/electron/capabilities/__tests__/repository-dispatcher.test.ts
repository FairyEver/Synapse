import { describe, expect, it } from "vitest"

import { createDefaultConfig } from "../../../src/lib/config"
import type { SynapseConfig } from "../../../src/types/config"
import { createRepositoryCapabilityDispatcher } from "../repository-dispatcher"

function configFixture(patch: Partial<SynapseConfig> = {}): SynapseConfig {
  return {
    ...createDefaultConfig(),
    ...patch,
  }
}

describe("repository capability dispatcher", () => {
  it("lists configured repositories and marks the active repository", async () => {
    const dispatcher = createRepositoryCapabilityDispatcher({
      loadConfig: async () =>
        configFixture({
          activeRepoUuid: "repo-2",
          repositories: [
            {
              uuid: "repo-1",
              name: "One",
              localPath: "/repo/one",
              contentDirs: {},
              variables: [{ name: "TOKEN", value: "secret" }],
            },
            {
              uuid: "repo-2",
              name: "Two",
              localPath: "/repo/two",
              contentDirs: {},
            },
          ],
        }),
    })

    await expect(dispatcher.dispatch("repository.item.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: {
        activeRepositoryUuid: "repo-2",
        repositories: [
          {
            uuid: "repo-1",
            name: "One",
            localPath: "/repo/one",
            isActive: false,
            variableCount: 1,
          },
          {
            uuid: "repo-2",
            name: "Two",
            localPath: "/repo/two",
            isActive: true,
            variableCount: 0,
          },
        ],
      },
      total: 2,
    })
  })

  it("rejects unknown repository actions", async () => {
    const dispatcher = createRepositoryCapabilityDispatcher({
      loadConfig: async () => configFixture(),
    })

    await expect(dispatcher.dispatch("repository.item.delete", {}, { source: "api" })).rejects.toThrow(
      "Unknown repository action",
    )
  })
})
