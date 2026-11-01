const fs=require("node:fs"),path=require("node:path")
const ts=require("typescript")
const cache=new Map()
function load(file){
  file=path.resolve(__dirname,file);if(!path.extname(file))file+=".ts"
  if(!file.startsWith(__dirname+path.sep))throw new Error("Only research source may be loaded")
  if(file.endsWith(".cjs"))return require(file)
  if(cache.has(file))return cache.get(file).exports
  const mod={exports:{}};cache.set(file,mod)
  const output=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
  new Function("require","module","exports",output)(id=>id.startsWith(".")?load(path.resolve(path.dirname(file),id)):require(id),mod,mod.exports)
  return mod.exports
}

module.exports={load}
