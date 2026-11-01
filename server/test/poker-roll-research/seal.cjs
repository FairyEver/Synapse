const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto")
function seal(root){
 const index={}
 function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  const file=path.join(directory,entry.name)
  if(entry.isDirectory())walk(file)
  else if(entry.name!=="artifacts.json")index[path.relative(root,file)]=crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
 }}
 walk(root);fs.writeFileSync(path.join(root,"artifacts.json"),JSON.stringify(index,null,2)+"\n");return index
}
module.exports={seal}
