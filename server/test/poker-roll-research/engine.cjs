/* Offline-only loader: pin existing engine source without a checkout or writes. */
const fs = require("node:fs")
const path = require("node:path")
const { execFileSync } = require("node:child_process")
const { createHash } = require("node:crypto")
const ts = require("typescript")
const root = path.resolve(__dirname, "../../..")
const ref = execFileSync("git", ["rev-parse", "ea48b82ce^{commit}"], { cwd: root, encoding: "utf8" }).trim()
const cache = new Map(), hashes = {}
function load(relative) {
  const file = path.posix.normalize(relative.endsWith(".ts") ? relative : relative + ".ts")
  if (!file.startsWith("server/src/game/poker/")) throw new Error("Research engine import outside pinned pure poker modules")
  if (cache.has(file)) return cache.get(file).exports
  const source = execFileSync("git", ["show", `${ref}:${file}`], {cwd:root,encoding:"utf8"})
  hashes[file] = createHash("sha256").update(source).digest("hex")
  const mod = {exports:{}}; cache.set(file, mod)
  const output = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  new Function("require","module","exports",output)(id => {
    if (!id.startsWith(".")) throw new Error("Pinned poker engine must remain dependency-free")
    return load(path.posix.join(path.posix.dirname(file),id))
  },mod,mod.exports)
  return mod.exports
}
module.exports = {
  hand: load("server/src/game/poker/engine/hand-runner"),
  cards: load("server/src/game/poker/engine/deck"),
  ranks: load("server/src/game/poker/engine/hand"),
  conservative: load("server/src/game/poker/bot-policy"),
  manifest: {ref, hashes},
}

let enabled=false
module.exports.enableRankCache=()=>{
  if(enabled)return;enabled=true
  const ranks=module.exports.ranks,cache=new Map()
  function rank(cards,variant){
    const key=variant+":"+[...cards].sort().join("")
    if(cache.has(key))return cache.get(key)
    const result=ranks.evaluate(cards,variant)
    if(cache.size>=60000)cache.clear()
    cache.set(key,result);return result
  }
  ranks.compareHands=(a,b,variant="standard52")=>{
    const x=rank(a,variant),y=rank(b,variant)
    return Math.sign(x.category-y.category||x.kickers.reduce((r,k,i)=>r||k-(y.kickers[i]??0),0))
  }
}
