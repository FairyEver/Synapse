import { BadRequestException } from "@nestjs/common"
import { Readable, Writable } from "node:stream"
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

  it("allows empty base64 content for non-main files", async () => {
    const service = createService()
    const controller = new SkillRepositoryController(service as never)
    const files = [
      { path: "SKILL.md", contentBase64: Buffer.from("# Skill").toString("base64") },
      { path: "assets/.keep", contentBase64: "" },
    ]

    await controller.importRepository({ name: "skill-name", files }, request("user-1"))

    expect(service.importRepository).toHaveBeenCalledWith("user-1", expect.objectContaining({
      files,
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

  it("passes parsed repository updates to the service", async () => {
    const service = createService()
    const controller = new SkillRepositoryController(service as never)

    await controller.updateMine("repo-1", {
      name: " new-name ",
      title: " New Title ",
      description: " Description ",
    }, request("user-1"))

    expect(service.updateMine).toHaveBeenCalledWith("user-1", "repo-1", {
      name: "new-name",
      title: "New Title",
      description: "Description",
    })
  })

  it("passes authenticated user id and repository id to deleteMine", async () => {
    const service = createService()
    const controller = new SkillRepositoryController(service as never)

    await controller.deleteMine("repo-1", request("user-1"))

    expect(service.deleteMine).toHaveBeenCalledWith("user-1", "repo-1")
  })

  it("passes file content path query to the service", async () => {
    const service = createService()
    const controller = new SkillRepositoryController(service as never)

    await controller.getFileContent("repo-1", { path: "docs/README.md" }, request("user-1"))

    expect(service.getFileContent).toHaveBeenCalledWith("user-1", "repo-1", "docs/README.md")
  })

  it("streams owned repository file downloads with attachment headers", async () => {
    const service = createService()
    const controller = new SkillRepositoryController(service as never)
    const response = downloadResponse()

    await controller.downloadFile("repo-1", { path: "assets/logo.png" }, request("user-1"), response as never)

    expect(service.openFileDownload).toHaveBeenCalledWith("user-1", "repo-1", "assets/logo.png")
    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "image/png")
    expect(response.setHeader).toHaveBeenCalledWith("Content-Length", "4")
    expect(response.setHeader).toHaveBeenCalledWith("Content-Disposition", 'attachment; filename="logo.png"')
    expect(response.bytes()).toEqual(Buffer.from("logo"))
  })

  it("resolves public path before streaming public file downloads", async () => {
    const service = createService()
    const controller = new SkillRepositoryController(service as never)
    const response = downloadResponse()

    await controller.downloadPublicFile("alice", "demo-skill", { path: "README.md" }, request("user-2"), response as never)

    expect(service.getPublicByPath).toHaveBeenCalledWith("user-2", "alice", "demo-skill")
    expect(service.openFileDownload).toHaveBeenCalledWith("user-2", "repo-1", "README.md")
  })

  it("passes text save body to the service", async () => {
    const service = createService()
    const controller = new SkillRepositoryController(service as never)
    const expectedSha256 = "a".repeat(64)

    await controller.saveTextFile("repo-1", {
      path: "SKILL.md",
      text: "# Skill",
      expectedSha256,
    }, request("user-1"))

    expect(service.saveTextFile).toHaveBeenCalledWith("user-1", "repo-1", {
      path: "SKILL.md",
      text: "# Skill",
      expectedSha256,
    })
  })

  it("normalizes nullish delete expected sha to undefined", async () => {
    const service = createService()
    const controller = new SkillRepositoryController(service as never)

    await controller.deleteFile("repo-1", {
      path: "README.md",
      expectedSha256: null,
    }, request("user-1"))

    expect(service.deleteFile).toHaveBeenCalledWith("user-1", "repo-1", {
      path: "README.md",
      expectedSha256: undefined,
    })
  })

  it("passes rename body to the service", async () => {
    const service = createService()
    const controller = new SkillRepositoryController(service as never)

    await controller.renameFile("repo-1", {
      fromPath: "README.md",
      toPath: "docs/README.md",
    }, request("user-1"))

    expect(service.renameFile).toHaveBeenCalledWith("user-1", "repo-1", {
      fromPath: "README.md",
      toPath: "docs/README.md",
    })
  })

  it("rejects invalid file mutation bodies before calling the service", () => {
    const service = createService()
    const controller = new SkillRepositoryController(service as never)

    expect(() => controller.saveTextFile("repo-1", {
      path: "SKILL.md",
      text: "# Skill",
      expectedSha256: "short",
    }, request("user-1"))).toThrow(BadRequestException)

    expect(service.saveTextFile).not.toHaveBeenCalled()
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
    resolveLegacyContentRoute: vi.fn().mockResolvedValue({ status: "not_found" }),
    getPublicByPath: vi.fn().mockResolvedValue({ repository: { id: "repo-1" } }),
    getMine: vi.fn().mockResolvedValue({ id: "repo-1" }),
    updateMine: vi.fn().mockResolvedValue({ id: "repo-1" }),
    deleteMine: vi.fn().mockResolvedValue({ id: "repo-1", status: "removed" }),
    getFileContent: vi.fn().mockResolvedValue({ file: { path: "SKILL.md" }, text: "# Skill" }),
    openFileDownload: vi.fn().mockResolvedValue({
      stream: Readable.from([Buffer.from("logo")]),
      contentType: "image/png",
      size: 4,
      filename: "logo.png",
    }),
    saveTextFile: vi.fn().mockResolvedValue({ id: "repo-1" }),
    renameFile: vi.fn().mockResolvedValue({ id: "repo-1" }),
    deleteFile: vi.fn().mockResolvedValue({ id: "repo-1" }),
  }
}

function request(userId: string) {
  return { user: { id: userId }, ip: "127.0.0.1" } as never
}

function downloadResponse() {
  const chunks: Buffer[] = []
  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      callback()
    },
  }) as Writable & {
    setHeader: ReturnType<typeof vi.fn>
    headersSent: boolean
    destroyed: boolean
    bytes: () => Buffer
  }
  response.setHeader = vi.fn()
  response.headersSent = false
  response.destroyed = false
  response.bytes = () => Buffer.concat(chunks)
  return response
}
