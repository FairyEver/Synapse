import { randomUUID } from "node:crypto"
import { BrowserWindow, nativeImage, session } from "electron"
import { CHROMIUM_WORKER_WEB_PREFERENCES } from "../../script-runtime/main/chromium-worker-runner"
import { externalAssetPath } from "../../../electron/runtime/data-repo/assets"
import { SKILL_HUB_LIMITS as limits } from "@synapse/shared/skill-hub-contracts"
import { withHubPermission, type HubSecurity, type SkillHubCaller } from "./access"
import { readHubExternalFile } from "./package-service"
import { SkillHubDesktopError } from "./error"

const png = Buffer.from("89504e470d0a1a0a", "hex")
const invalid = () => new SkillHubDesktopError("HUB_ICON_INVALID", "请选择有效的 PNG、JPEG 或 WebP 图标。")

function jpegDimensions(bytes: Buffer): [number, number] | null {
  let offset = 2
  while (offset + 4 < bytes.length && bytes[offset++] === 0xff) {
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) return null
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) return null
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 7) return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)]
    offset += length
  }
  return null
}

function dimensions(bytes: Buffer): [number, number] | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(png) && bytes.toString("ascii", 12, 16) === "IHDR") {
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegDimensions(bytes)
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return null
  const tag = bytes.toString("ascii", 12, 16)
  if (tag === "VP8X") return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1]
  if (tag === "VP8L" && bytes[20] === 0x2f) {
    const header = bytes.readUInt32LE(21)
    return [(header & 0x3fff) + 1, ((header >>> 14) & 0x3fff) + 1]
  }
  if (tag === "VP8 " && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 1, 0x2a]))) {
    return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff]
  }
  return null
}

function boundedDimensions(bytes: Buffer): [number, number] {
  const measured = bytes.length <= limits.originalIconBytes && dimensions(bytes)
  if (!measured || !measured.every((size) => size > 0 && size <= 4096) || measured[0] * measured[1] > 16_000_000) throw invalid()
  return measured
}

export function normalizeHubIcon(bytes: Buffer, decode = nativeImage.createFromBuffer): Buffer {
  const measured = boundedDimensions(bytes)
  const image = decode(bytes)
  if (image.isEmpty()) throw invalid()
  const { width, height } = image.getSize()
  if (width !== measured[0] || height !== measured[1]) throw invalid()
  const side = Math.min(width, height)
  const crop = image.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
  const normalized = crop.resize({ width: limits.iconSize, height: limits.iconSize, quality: "best" }).toPNG()
  if (!normalized.length || normalized.length > limits.iconBytes) throw invalid()
  return normalized
}

// nativeImage only guarantees PNG/JPEG decoding. Use an isolated Chromium
// surface for a fixed bitmap operation; the input bytes are never executable.
async function normalizeWebp(bytes: Buffer, signal: AbortSignal): Promise<Buffer> {
  const [width, height] = boundedDimensions(bytes)
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(8_000)])
  timeout.throwIfAborted()
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      ...CHROMIUM_WORKER_WEB_PREFERENCES,
      session: session.fromPartition(`skill-hub-icon:${randomUUID()}`, { cache: false }),
    },
  })
  const close = () => { if (!window.isDestroyed()) window.destroy() }
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", (event) => event.preventDefault())
  timeout.addEventListener("abort", close, { once: true })
  try {
    await window.loadURL("about:blank")
    const encoded = JSON.stringify(bytes.toString("base64"))
    const output: unknown = await window.webContents.executeJavaScript(`(async () => {
      const data = Uint8Array.from(atob(${encoded}), ch => ch.charCodeAt(0));
      const image = await createImageBitmap(new Blob([data], { type: "image/webp" }));
      try {
        if (image.width !== ${width} || image.height !== ${height}) throw new Error("bad dimensions");
        const size = ${limits.iconSize};
        const canvas = new OffscreenCanvas(size, size);
        const side = Math.min(image.width, image.height);
        canvas.getContext("2d").drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size);
        const png = await canvas.convertToBlob({ type: "image/png" });
        if (png.size > ${limits.iconBytes}) throw new Error("bad size");
        return Array.from(new Uint8Array(await png.arrayBuffer()));
      } finally { image.close() }
    })()`, false)
    timeout.throwIfAborted()
    if (!Array.isArray(output) || !output.length || output.length > limits.iconBytes) throw invalid()
    return Buffer.from(output)
  } finally {
    timeout.removeEventListener("abort", close)
    close()
  }
}

export async function prepareHubIcon(input: string, security: HubSecurity, caller: SkillHubCaller, signal: AbortSignal) {
  const source = await externalAssetPath(input).catch(() => { throw invalid() })
  return withHubPermission(security, caller, "fs.read.outside-userdata", source, "icon.prepare", async () => {
    try {
      const bytes = await readHubExternalFile(source, limits.originalIconBytes, signal)
      return bytes.toString("ascii", 8, 12) === "WEBP" ? await normalizeWebp(bytes, signal) : normalizeHubIcon(bytes)
    }
    catch (error) { if (signal.aborted) signal.throwIfAborted(); throw invalid() }
  })
}
