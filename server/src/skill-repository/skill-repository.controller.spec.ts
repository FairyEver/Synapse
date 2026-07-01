import { BadRequestException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { SkillRepositoryController } from "./skill-repository.controller"

describe("SkillRepositoryController", () => {
  it("passes authenticated user id and parsed import body to the service", async () => {
    const service = createService()
    const controller = new SkillRepositoryController(service as never)
    const files = [{ path: "SKILL.md", contentBase64: Buffer.from("# Skill").toString("base64"), mimeType: " text/markdown " }]

    await controller.importRepository({
      repositoryId: " repo-1 ",
      name: " skill-name ",
      title: " Skill Title ",
      description: " Description ",
      files,
    }, request("user-1"))

    expect(service.importRepository).toHaveBeenCalledWith("user-1", {
      repositoryId: "repo-1",
      name: "skill-name",
      title: "Skill Title",
      description: "Description",
      files: [{ path: "SKILL.md", contentBase64: files[0].contentBase64, mimeType: "text/markdown" }],
    })
  })

  it("rejects invalid import body before calling the service", () => {
    const service = createService()
    const controller = new SkillRepositoryController(service as never)

    expect(() => controller.importRepository({
      name: "",
      files: [],
    }, request("user-1"))).toThrow(BadRequestException)

    expect(service.importRepository).not.toHaveBeenCalled()
  })

  it("passes repository file paths through without trimming", async () => {
    const service = createService()
    const controller = new SkillRepositoryController(service as never)
    const file = { path: "SKILL.md ", contentBase64: Buffer.from("# Skill").toString("base64") }

    await controller.importRepository({ name: "skill-name", files: [file] }, request("user-1"))

    expect(service.importRepository).toHaveBeenCalledWith("user-1", expect.objectContaining({
      files: [file],
    }))
  })

  it("passes authenticated user id to listMine", async () => {
    const service = createService()
    const controller = new SkillRepositoryController(service as never)

    await controller.listMine(request("user-1"))

    expect(service.listMine).toHaveBeenCalledWith("user-1")
  })

  it("passes authenticated user id and repository id to getMine", async () => {
    const service = createService()
    const controller = new SkillRepositoryController(service as never)

    await controller.getMine("repo-1", request("user-1"))

    expect(service.getMine).toHaveBeenCalledWith("user-1", "repo-1")
  })

  it("normalizes optional nullish import fields to undefined", async () => {
    const service = createService()
    const controller = new SkillRepositoryController(service as never)
    const file = { path: "SKILL.md", contentBase64: Buffer.from("# Skill").toString("base64"), mimeType: null }

    await controller.importRepository({
      repositoryId: null,
      name: null,
      title: null,
      description: null,
      files: [file],
    }, request("user-1"))

    expect(service.importRepository).toHaveBeenCalledWith("user-1", {
      repositoryId: undefined,
      name: undefined,
      title: undefined,
      description: undefined,
      files: [file],
    })
  })
})

function createService() {
  return {
    importRepository: vi.fn().mockResolvedValue({ id: "repo-1" }),
    listMine: vi.fn().mockResolvedValue([]),
    getMine: vi.fn().mockResolvedValue({ id: "repo-1" }),
  }
}

function request(userId: string) {
  return { user: { id: userId }, ip: "127.0.0.1" } as never
}
