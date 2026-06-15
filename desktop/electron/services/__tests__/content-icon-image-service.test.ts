import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const imageMockState = vi.hoisted(() => ({
  crop: vi.fn(),
  getSize: vi.fn(() => ({ width: 400, height: 200 })),
  isEmpty: vi.fn(() => false),
  resize: vi.fn(),
  toPNG: vi.fn(() => Buffer.from("png")),
}))

vi.mock("electron", () => {
  const resized = { toPNG: imageMockState.toPNG }
  const cropped = { resize: imageMockState.resize }
  const image = {
    crop: imageMockState.crop,
    getSize: imageMockState.getSize,
    isEmpty: imageMockState.isEmpty,
  }
  imageMockState.crop.mockReturnValue(cropped)
  imageMockState.resize.mockReturnValue(resized)

  return {
    app: {
      getAppPath: () => "/tmp/synapse-content-icon-image-test-app",
      getPath: (which: string) => `/tmp/synapse-content-icon-image-test-${which}`,
      getName: () => "synapse-test",
      getVersion: () => "0.0.0-test",
      isPackaged: false,
    },
    nativeImage: {
      createFromBuffer: vi.fn(() => image),
    },
  }
})

import { ContentCapabilityError } from "../content-capability-errors"
import {
  ICON_IMAGE_OUTPUT_SIZE,
  prepareContentIconImageBytes,
} from "../content-icon-image-service"

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `synapse-icon-image-${randomUUID()}-`))
  tempRoots.push(root)
  return root
}

describe("content icon image service", () => {
  afterEach(async () => {
    imageMockState.crop.mockClear()
    imageMockState.getSize.mockReturnValue({ width: 400, height: 200 })
    imageMockState.isEmpty.mockReturnValue(false)
    imageMockState.resize.mockClear()
    imageMockState.toPNG.mockReturnValue(Buffer.from("png"))
    vi.restoreAllMocks()
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("returns undefined when no image input is provided", async () => {
    await expect(prepareContentIconImageBytes({})).resolves.toBeUndefined()
  })

  it("center-crops and resizes image bytes to a square PNG", async () => {
    const bytes = await prepareContentIconImageBytes({
      iconImageBase64: Buffer.from("image").toString("base64"),
    })

    expect(Buffer.from(bytes ?? []).toString("utf8")).toBe("png")
    expect(imageMockState.crop).toHaveBeenCalledWith({
      x: 100,
      y: 0,
      width: 200,
      height: 200,
    })
    expect(imageMockState.resize).toHaveBeenCalledWith({
      width: ICON_IMAGE_OUTPUT_SIZE,
      height: ICON_IMAGE_OUTPUT_SIZE,
      quality: "best",
    })
  })

  it("reads image bytes from a path after permission is allowed", async () => {
    const root = await createTempRoot()
    const filePath = path.join(root, "icon.png")
    await mkdir(root, { recursive: true })
    await writeFile(filePath, Buffer.from("image"))
    const auditSink = {
      clearForTests: vi.fn(),
      list: vi.fn(() => []),
      record: vi.fn(),
    }
    const permissionGuard = {
      check: vi.fn().mockResolvedValue({ allowed: true as const }),
      registerPolicy: vi.fn(() => () => {}),
    }

    await expect(prepareContentIconImageBytes({
      iconImagePath: filePath,
    }, {
      actor: { kind: "agent", id: "mcp-client" },
      auditSink,
      permissionGuard,
    })).resolves.toBeInstanceOf(Uint8Array)
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      resource: filePath,
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "allowed",
      resource: filePath,
    }))
  })

  it("rejects symlink image paths before reading the target", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "target.png")
    const linkPath = path.join(root, "icon-link.png")
    await mkdir(root, { recursive: true })
    await writeFile(targetPath, Buffer.from("image"))
    await symlink(targetPath, linkPath)
    const auditSink = {
      clearForTests: vi.fn(),
      list: vi.fn(() => []),
      record: vi.fn(),
    }
    const permissionGuard = {
      check: vi.fn().mockResolvedValue({ allowed: true as const }),
      registerPolicy: vi.fn(() => () => {}),
    }

    await expect(prepareContentIconImageBytes({
      iconImagePath: linkPath,
    }, {
      actor: { kind: "agent", id: "mcp-client" },
      auditSink,
      permissionGuard,
    })).rejects.toMatchObject({
      code: "CONTENT_INVALID_INPUT",
    })

    expect(imageMockState.crop).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "failed",
      resource: linkPath,
    }))
  })

  it("rejects invalid base64", async () => {
    await expect(prepareContentIconImageBytes({
      iconImageBase64: "not base64!",
    })).rejects.toThrow(ContentCapabilityError)
  })

  it("rejects unreadable image bytes", async () => {
    imageMockState.isEmpty.mockReturnValue(true)

    await expect(prepareContentIconImageBytes({
      iconImageBase64: Buffer.from("image").toString("base64"),
    })).rejects.toThrow(ContentCapabilityError)
  })
})
