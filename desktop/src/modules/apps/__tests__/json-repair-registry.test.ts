import { readFile } from "node:fs/promises"
import path from "node:path"
import { inflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { parseSystemAppId } from "../definitions"
import { getSystemAppManifest } from "../registry"

describe("JSON Repair app registry", () => {
  it("does not register JSON Repair as a system app", () => {
    expect(getSystemAppManifest("json-repair")).toBeNull()
    expect(parseSystemAppId("json-repair")).toBeNull()
  })

  it("ships a readable RGBA PNG icon at 32px, 64px, and 256px", async () => {
    const icon = await readFile(
      path.resolve(__dirname, "../../../../app-capabilities/json-repair/renderer/assets/icon.png"),
    )

    expect(icon.subarray(1, 4).toString("ascii")).toBe("PNG")
    expect(icon.readUInt32BE(16)).toBe(256)
    expect(icon.readUInt32BE(20)).toBe(256)
    expect(icon[25]).toBe(6)

    const decoded = decodeRgbaPng(icon)
    expect([32, 64, 256].map((size) => analyzeDownsampledSubject(decoded, size)))
      .toEqual([
        {
          size: 32,
          subjectPixels: 152,
          bounds: [5, 26, 6, 25],
          leftStrokePixels: 18,
          rightStrokePixels: 18,
          centerRowPixels: 16,
          centerRegionPixels: 18,
        },
        {
          size: 64,
          subjectPixels: 572,
          bounds: [10, 53, 12, 51],
          leftStrokePixels: 36,
          rightStrokePixels: 34,
          centerRowPixels: 34,
          centerRegionPixels: 72,
        },
        {
          size: 256,
          subjectPixels: 8_184,
          bounds: [40, 215, 50, 205],
          leftStrokePixels: 140,
          rightStrokePixels: 140,
          centerRowPixels: 120,
          centerRegionPixels: 900,
        },
      ])
  })
})

type DecodedPng = {
  readonly width: number
  readonly height: number
  readonly pixels: Buffer
}

function decodeRgbaPng(png: Buffer): DecodedPng {
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0) {
    throw new Error("Expected an 8-bit, non-interlaced RGBA PNG.")
  }

  const chunks: Buffer[] = []
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)
    const type = png.toString("ascii", offset + 4, offset + 8)
    if (type === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }

  const filtered = inflateSync(Buffer.concat(chunks))
  const stride = width * 4
  const pixels = Buffer.alloc(width * height * 4)
  let sourceOffset = 0
  for (let y = 0; y < height; y++) {
    const filter = filtered[sourceOffset++]
    for (let x = 0; x < stride; x++) {
      const value = filtered[sourceOffset++]
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0
      const above = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const upperLeft = y > 0 && x >= 4
        ? pixels[(y - 1) * stride + x - 4]
        : 0
      pixels[y * stride + x] = unfilterByte(
        filter,
        value,
        left,
        above,
        upperLeft,
      )
    }
  }
  return { width, height, pixels }
}

function unfilterByte(
  filter: number,
  value: number,
  left: number,
  above: number,
  upperLeft: number,
): number {
  if (filter === 0) return value
  if (filter === 1) return (value + left) & 0xff
  if (filter === 2) return (value + above) & 0xff
  if (filter === 3) return (value + Math.floor((left + above) / 2)) & 0xff
  if (filter === 4) return (value + paeth(left, above, upperLeft)) & 0xff
  throw new Error(`Unsupported PNG filter: ${filter}`)
}

function paeth(left: number, above: number, upperLeft: number): number {
  const prediction = left + above - upperLeft
  const leftDistance = Math.abs(prediction - left)
  const aboveDistance = Math.abs(prediction - above)
  const upperLeftDistance = Math.abs(prediction - upperLeft)
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left
  return aboveDistance <= upperLeftDistance ? above : upperLeft
}

function analyzeDownsampledSubject(decoded: DecodedPng, size: number) {
  const backgroundOffset = (32 * decoded.width + 32) * 4
  const background = decoded.pixels.subarray(backgroundOffset, backgroundOffset + 3)
  const subject: boolean[] = []

  for (let targetY = 0; targetY < size; targetY++) {
    for (let targetX = 0; targetX < size; targetX++) {
      const sums = [0, 0, 0, 0]
      let count = 0
      for (
        let sourceY = Math.floor(targetY * decoded.height / size);
        sourceY < Math.floor((targetY + 1) * decoded.height / size);
        sourceY++
      ) {
        for (
          let sourceX = Math.floor(targetX * decoded.width / size);
          sourceX < Math.floor((targetX + 1) * decoded.width / size);
          sourceX++
        ) {
          const offset = (sourceY * decoded.width + sourceX) * 4
          for (let channel = 0; channel < 4; channel++) {
            sums[channel] += decoded.pixels[offset + channel]
          }
          count++
        }
      }
      const average = sums.map((sum) => sum / count)
      const contrast = Math.abs(average[0] - background[0])
        + Math.abs(average[1] - background[1])
        + Math.abs(average[2] - background[2])
      subject.push(average[3] > 200 && contrast > 120)
    }
  }

  const coordinates = subject.flatMap((active, index) => (
    active ? [[index % size, Math.floor(index / size)] as const] : []
  ))
  const activeAt = (x: number, y: number) => subject[y * size + x]
  return {
    size,
    subjectPixels: coordinates.length,
    bounds: [
      Math.min(...coordinates.map(([x]) => x)),
      Math.max(...coordinates.map(([x]) => x)),
      Math.min(...coordinates.map(([, y]) => y)),
      Math.max(...coordinates.map(([, y]) => y)),
    ],
    leftStrokePixels: Array.from(
      { length: size },
      (_, y) => activeAt(Math.floor(size * 0.25), y),
    ).filter(Boolean).length,
    rightStrokePixels: Array.from(
      { length: size },
      (_, y) => activeAt(Math.floor(size * 0.75), y),
    ).filter(Boolean).length,
    centerRowPixels: Array.from(
      { length: size },
      (_, x) => activeAt(x, Math.floor(size * 0.5)),
    ).filter(Boolean).length,
    centerRegionPixels: coordinates.filter(([x, y]) => (
      x >= size * 0.4
      && x <= size * 0.6
      && y >= size * 0.4
      && y <= size * 0.6
    )).length,
  }
}
