import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const assets = resolve(root, "dashboard/src/game-center/games/poker/assets/ability-cards")
const hashes = new Set()

function checkPack(assetVersion, names) {
  const directory = resolve(assets, assetVersion)
  const expected = [...names.keys()].sort()
  const actual = readdirSync(directory).filter(file => file.endsWith(".png")).sort()
  assert.deepEqual(actual, expected.map(id => `${id}.png`), `${assetVersion} 的封面必须与正式目录一致`)
  const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8"))
  assert.equal(manifest.assetVersion, assetVersion)
  assert.deepEqual(manifest.cards.map(card => card.cardId).sort(), expected)
  for (const card of manifest.cards) {
    assert.equal(card.assetVersion, assetVersion); assert.equal(card.file, `${card.cardId}.png`)
    assert.equal(card.name, names.get(card.cardId), `${assetVersion}/${card.cardId} 的牌名必须与正式目录一致`)
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
}

try {
  const catalog = resolve(root, "server/src/game/poker/engine/cards/catalog")
  const definitions = readdirSync(catalog).filter(file => file.endsWith(".ts")).flatMap(file =>
    [...readFileSync(resolve(catalog, file), "utf8").matchAll(/\bcard\("(\d{2})", "([^"]+)"/g)].map(([, id, name]) => [id, name]))
  assert.deepEqual(definitions.map(([id]) => id).sort(), Array.from({ length: 60 }, (_, i) => String(i + 1).padStart(2, "0")))
  checkPack("v1", new Map(definitions))
  checkPack("v2", new Map([["07", "五选其一"]]))
  process.stdout.write("扑克卡牌正式封面：61/61，目录、PNG、尺寸、唯一性和溯源均有效。\n")
} catch (error) {
  process.stderr.write(`扑克卡牌封面检查失败：${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
