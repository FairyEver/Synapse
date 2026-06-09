import { BadRequestException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { ContentStoreAdminController, ContentStoreUserController } from "./content-store.controller"

describe("ContentStoreUserController", () => {
  it("passes authenticated user identity and parsed filters to list routes", async () => {
    const service = {
      listStore: vi.fn().mockResolvedValue({ data: [], total: 0, page: 2, pageSize: 10 }),
      listMine: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 }),
    }
    const controller = new ContentStoreUserController(service as never)
    const request = userRequest("user-1")

    await controller.listStore({ page: "2", pageSize: "10", sortBy: "updatedAt", type: "skill", query: "sync" }, request)
    await controller.listMine({ sortBy: "createdAt", type: "prompt" }, request)

    expect(service.listStore).toHaveBeenCalledWith("user-1", {
      page: 2,
      pageSize: 10,
      sortBy: "updatedAt",
      sortOrder: "desc",
      type: "skill",
      query: "sync",
    })
    expect(service.listMine).toHaveBeenCalledWith("user-1", {
      page: 1,
      pageSize: 20,
      sortBy: "createdAt",
      sortOrder: "desc",
      type: "prompt",
      query: undefined,
    })
  })

  it("parses draft payloads and forwards draft mutations", async () => {
    const service = {
      createDraft: vi.fn().mockResolvedValue({ id: "draft-1" }),
      saveDraft: vi.fn().mockResolvedValue({ id: "draft-1", revision: 3 }),
      publishDraft: vi.fn().mockResolvedValue({ id: "version-1" }),
    }
    const controller = new ContentStoreUserController(service as never)
    const request = userRequest("user-1")
    const file = { path: "SKILL.md", contentBase64: Buffer.from("# Skill").toString("base64") }

    await controller.createDraft({ type: "skill", title: "  Skill  ", files: [file] }, request)
    await controller.saveDraft("item-1", { baseRevision: 2, title: "Rule", body: "body" }, request)
    await controller.publishDraft("item-1", { baseRevision: 3 }, request)

    expect(service.createDraft).toHaveBeenCalledWith("user-1", {
      type: "skill",
      title: "Skill",
      description: null,
      body: null,
      files: [file],
    })
    expect(service.saveDraft).toHaveBeenCalledWith("user-1", "item-1", 2, {
      title: "Rule",
      description: null,
      body: "body",
      files: undefined,
    })
    expect(service.publishDraft).toHaveBeenCalledWith("user-1", "item-1", 3)
  })

  it("forwards item actions with authenticated user identity", async () => {
    const service = {
      getDetail: vi.fn().mockResolvedValue({ id: "item-1" }),
      copyToMine: vi.fn().mockResolvedValue({ id: "copy-1" }),
      deletePrivateItem: vi.fn().mockResolvedValue({ ok: true }),
    }
    const controller = new ContentStoreUserController(service as never)
    const request = userRequest("user-1")

    await controller.getDetail("item-1", request)
    await controller.copyToMine("item-1", request)
    await controller.deletePrivateItem("item-1", request)

    expect(service.getDetail).toHaveBeenCalledWith("user-1", "item-1")
    expect(service.copyToMine).toHaveBeenCalledWith("user-1", "item-1")
    expect(service.deletePrivateItem).toHaveBeenCalledWith("user-1", "item-1")
  })

  it("parses visibility payloads", async () => {
    const service = { setVisibility: vi.fn().mockResolvedValue({ id: "item-1" }) }
    const controller = new ContentStoreUserController(service as never)

    await controller.setVisibility("item-1", { visibility: "public" }, userRequest("user-1"))

    expect(service.setVisibility).toHaveBeenCalledWith("user-1", "item-1", "public")
  })

  it("rejects invalid input before calling the service", async () => {
    const service = {
      createDraft: vi.fn(),
      setVisibility: vi.fn(),
      recordInstall: vi.fn(),
    }
    const controller = new ContentStoreUserController(service as never)
    const request = userRequest("user-1")

    expect(() => controller.createDraft({ type: "skill", title: "" }, request)).toThrow(BadRequestException)
    expect(() => controller.setVisibility("item-1", { visibility: "team" }, request)).toThrow(BadRequestException)
    expect(() => controller.recordInstall("session-1", { clientInstanceId: "" }, request)).toThrow(BadRequestException)

    expect(service.createDraft).not.toHaveBeenCalled()
    expect(service.setVisibility).not.toHaveBeenCalled()
    expect(service.recordInstall).not.toHaveBeenCalled()
  })

  it("uses a default install deep link and completes install sessions", async () => {
    const service = {
      createInstallSession: vi.fn().mockResolvedValue({ id: "session-1" }),
      resolveInstallSession: vi.fn().mockResolvedValue({ id: "session-1" }),
      recordInstall: vi.fn().mockResolvedValue({ ok: true }),
    }
    const controller = new ContentStoreUserController(service as never)
    const request = userRequest("user-1")

    await controller.createInstallSession("item-1", {}, request)
    await controller.createInstallSession("item-2", { deepLinkBase: "synapse://custom-install" }, request)
    await controller.resolveInstallSession("session-1", request)
    await controller.recordInstall("session-1", { clientInstanceId: "desktop-1" }, request)

    expect(service.createInstallSession).toHaveBeenNthCalledWith(1, "user-1", "item-1", "synapse://content-install")
    expect(service.createInstallSession).toHaveBeenNthCalledWith(2, "user-1", "item-2", "synapse://custom-install")
    expect(service.resolveInstallSession).toHaveBeenCalledWith("user-1", "session-1")
    expect(service.recordInstall).toHaveBeenCalledWith("user-1", "session-1", "desktop-1")
  })
})

describe("ContentStoreAdminController", () => {
  it("forwards admin list and detail routes", async () => {
    const service = {
      listAdmin: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 }),
      getAdminDetail: vi.fn().mockResolvedValue({ id: "item-1" }),
    }
    const controller = new ContentStoreAdminController(service as never)

    await controller.listAdmin({ type: "rule", visibility: "public", moderationStatus: "normal", query: "hook" })
    await controller.getAdminDetail("item-1")

    expect(service.listAdmin).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      sortBy: "createdAt",
      sortOrder: "desc",
      type: "rule",
      visibility: "public",
      moderationStatus: "normal",
      query: "hook",
    })
    expect(service.getAdminDetail).toHaveBeenCalledWith("item-1")
  })

  it("passes admin email and ip into feature and remove actions", async () => {
    const service = {
      setFeaturedAsAdmin: vi.fn().mockResolvedValue({ id: "item-1" }),
      setRemovedAsAdmin: vi.fn().mockResolvedValue({ id: "item-1" }),
    }
    const controller = new ContentStoreAdminController(service as never)
    const request = adminRequest("admin@example.com", "127.0.0.1")

    await controller.setFeatured("item-1", { value: true }, request)
    await controller.setRemoved("item-1", { value: false }, request)

    expect(service.setFeaturedAsAdmin).toHaveBeenCalledWith("admin@example.com", "127.0.0.1", "item-1", true)
    expect(service.setRemovedAsAdmin).toHaveBeenCalledWith("admin@example.com", "127.0.0.1", "item-1", false)
  })

  it("rejects invalid admin moderation payloads", async () => {
    const service = { setFeaturedAsAdmin: vi.fn() }
    const controller = new ContentStoreAdminController(service as never)

    expect(() => controller.setFeatured("item-1", { value: "yes" }, adminRequest("admin@example.com"))).toThrow(BadRequestException)

    expect(service.setFeaturedAsAdmin).not.toHaveBeenCalled()
  })
})

function userRequest(userId: string) {
  return { user: { id: userId }, ip: "127.0.0.1" } as never
}

function adminRequest(email: string, ip = "system") {
  return { admin: { id: "admin-1", email }, ip } as never
}
