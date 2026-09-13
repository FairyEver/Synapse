import { deflateSync } from "node:zlib"

const glyphs: Record<string, string[]> = {
  "0": ["11111","10001","10011","10101","11001","10001","11111"],
  "1": ["00100","01100","00100","00100","00100","00100","11111"],
  "2": ["11111","00001","00001","11111","10000","10000","11111"],
  "3": ["11111","00001","00001","11111","00001","00001","11111"],
  "4": ["10001","10001","10001","11111","00001","00001","00001"],
  "5": ["11111","10000","10000","11111","00001","00001","11111"],
  "6": ["11111","10000","10000","11111","10001","10001","11111"],
  "7": ["11111","00001","00010","00100","01000","01000","01000"],
  "8": ["11111","10001","10001","11111","10001","10001","11111"],
  "9": ["11111","10001","10001","11111","00001","00001","11111"],
}
/** Deterministic 720 x 480 PNG, approx. 340 KB, with a large independently
 * checkable four-digit marker; bottom noise supplies realistic transport cost. */
export function markedImage(marker: string, seed: number, width = 720, height = 480): Buffer {
  const noiseRows = Math.floor(339120 / (width * 3))
  const rows = Buffer.alloc(height * (1 + width * 3), 255)
  let random = seed | 0
  for (let y = 0; y < height; y++) {
    rows[y * (1 + width * 3)] = 0
    if (y >= height - noiseRows) for (let x = 0; x < width * 3; x++) {
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5
      rows[y * (1 + width * 3) + x + 1] = random & 255
    }
  }
  const scale = 22
  for (const [index, char] of [...marker].entries()) {
    const glyph = glyphs[char]!
    for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
      if (glyph[gy]![gx] !== "1") continue
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const x = 100 + index * 132 + gx * scale + dx, y = 70 + gy * scale + dy
        rows.fill(0, y * (1 + width * 3) + x * 3 + 1, y * (1 + width * 3) + x * 3 + 4)
      }
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))])
}
function chunk(type: string, data: Buffer): Buffer {
  const result = Buffer.alloc(12 + data.length)
  result.writeUInt32BE(data.length); result.write(type, 4); data.copy(result, 8)
  let crc = 0xffffffff
  for (const byte of result.subarray(4, -4)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4)
  return result
}
