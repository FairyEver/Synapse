/* Exact memoization of a numeric pure feature. Frozen source files stay untouched. */
const fs=require("node:fs"),path=require("node:path"),ts=require("typescript")
const cache=new Map()
function load(file){
 file=path.resolve(__dirname,file);if(!path.extname(file))file+=".ts"
 if(!file.startsWith(__dirname+path.sep))throw new Error("Only research source may be loaded")
 if(file.endsWith(".cjs"))return require(file)
 if(cache.has(file))return cache.get(file).exports
 let source=fs.readFileSync(file,"utf8")
 if(file===path.join(__dirname,"policies.ts")){
  const marker="export function visibleStrength(",boundary="export function candidateWeights("
  if(source.split(marker).length!==2||source.split(boundary).length!==2)throw new Error("Frozen feature structure changed; refuse transformation")
  source=source.replace(marker,"function uncachedVisibleStrength(").replace(boundary,`
const strengthMemo = new Map<string,number>()
export const researchMemoStats={hits:0,misses:0}
export function visibleStrength(hole:readonly string[],board:readonly string[],variant:string):number {
 const key=variant+":"+hole.join("")+":"+board.join("")
 const value=strengthMemo.get(key)
 if(value!==undefined){researchMemoStats.hits++;return value}
 researchMemoStats.misses++
 const result=uncachedVisibleStrength(hole,board,variant)
 if(strengthMemo.size>=100000)strengthMemo.clear()
 strengthMemo.set(key,result);return result
}
`+boundary)
 }
 const mod={exports:{}};cache.set(file,mod)
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
 new Function("require","module","exports",output)(id=>id.startsWith(".")?load(path.resolve(path.dirname(file),id)):require(id),mod,mod.exports)
 return mod.exports
}
module.exports={load,statistics:()=>load("policies.ts").researchMemoStats}
