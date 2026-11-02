import assert from "node:assert/strict"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const directory = resolve(root, "dashboard/src/game-center/games/poker/assets/ability-cards/v1")
try {
  assert(existsSync(directory), "60张正式封面尚未生成")
  const expected = Array.from({ length: 60 }, (_, i) => String(i + 1).padStart(2, "0"))
  const actual = readdirSync(directory).filter(file => file.endsWith(".png")).sort()
  assert.deepEqual(actual, expected.map(id => `${id}.png`), "需要恰好60个唯一编号PNG")
  const catalog = resolve(root, "server/src/game/poker/engine/cards/catalog")
  const ids = readdirSync(catalog).filter(file => file.endsWith(".ts")).flatMap(file => [...readFileSync(resolve(catalog, file), "utf8").matchAll(/\bcard\("(\d{2})"/g)].map(match => match[1])).sort()
  assert.deepEqual(ids, expected, "封面ID必须与正式目录一致")
  const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8"))
  assert.equal(manifest.assetVersion, "v1")
  assert.deepEqual(manifest.cards.map(card => card.cardId).sort(), expected)
  assert.equal(new Set(manifest.cards.map(card => card.cardId)).size, 60)
  const hashes = new Set()
  for (const card of manifest.cards) {
    assert.equal(card.assetVersion, "v1"); assert.equal(card.file, `${card.cardId}.png`)
    assert.equal(card.tool, "image_gen.imagegen")
    assert.equal(typeof card.model, "string"); assert(card.model.trim())
    assert.equal(typeof card.prompt, "string"); assert(card.prompt.length > 100)
    const bytes = readFileSync(resolve(directory, card.file))
    assert(bytes.length > 1024, `${card.file}为空或非正式图像`)
    assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${card.file}不是PNG`)
    assert.equal(bytes.toString("ascii", 12, 16), "IHDR")
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
    assert(width >= 768 && height >= 768 && width <= 4096 && height <= 4096)
    assert.equal(card.width, width); assert.equal(card.height, height)
    const hash = createHash("sha256").update(bytes).digest("hex")
    assert.equal(card.sha256, hash); assert(!hashes.has(hash), "不同卡牌不能复用同一张图")
    hashes.add(hash)
    assert.equal(card.displayAspectRatio, "4:5"); assert.equal(card.reviewed, true)
  }
  process.stdout.write("扑克卡牌正式封面：60/60，目录、PNG、尺寸、唯一性和溯源均有效。\n")
} catch (error) {
  process.stderr.write(`扑克卡牌封面检查失败：${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
