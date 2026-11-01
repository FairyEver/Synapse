const fs=require("node:fs"),path=require("node:path"),zlib=require("node:zlib"),crypto=require("node:crypto")
const out=process.argv[2];if(!out)throw new Error("Result directory required")
const hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex")
if(fs.existsSync(path.join(out,"artifacts.json"))){
 const artifacts=JSON.parse(fs.readFileSync(path.join(out,"artifacts.json"),"utf8"))
 for(const [file,expected] of Object.entries(artifacts))if(hash(fs.readFileSync(path.join(out,file)))!==expected)throw new Error("Artifact fingerprint mismatch: "+file)
}
const manifest=JSON.parse(fs.readFileSync(path.join(out,"manifest.json"),"utf8"))
for(const [file,expected] of Object.entries(manifest.source))if(hash(fs.readFileSync(path.join(__dirname,file)))!==expected)throw new Error("Research source fingerprint mismatch: "+file)
const engine=require("./engine.cjs").manifest
if(engine.ref!==manifest.engine.ref||JSON.stringify(engine.hashes)!==JSON.stringify(manifest.engine.hashes))throw new Error("Pinned engine fingerprint mismatch")
const acceleration=fs.existsSync(path.join(out,"acceleration-manifest.json"))?JSON.parse(fs.readFileSync(path.join(out,"acceleration-manifest.json"),"utf8")):null
if(acceleration){
 for(const [file,expected] of Object.entries(acceleration.source))if(hash(fs.readFileSync(path.join(__dirname,file)))!==expected)throw new Error("Acceleration source fingerprint mismatch: "+file)
 if(JSON.stringify(acceleration.frozenSource)!==JSON.stringify(manifest.source))throw new Error("Acceleration frozen source mismatch")
 if(hash(fs.readFileSync(path.join(out,"recommended-model.json")))!==acceleration.modelSha256)throw new Error("Acceleration model fingerprint mismatch")
 if(hash(fs.readFileSync(path.join(out,"fitted.json")))!==acceleration.fitSha256)throw new Error("Acceleration policy fit fingerprint mismatch")
}
for(const [name,label] of [["valuation-manifest.json","Valuation"],["multi-history-manifest.json","Multi-history"],["personal-sequence-manifest.json","Personal-sequence"]])if(fs.existsSync(path.join(out,name))){
 const supplement=JSON.parse(fs.readFileSync(path.join(out,name),"utf8"))
 for(const [file,expected] of Object.entries(supplement.source))if(hash(fs.readFileSync(path.join(__dirname,file)))!==expected)throw new Error(label+" source fingerprint mismatch: "+file)
 if(hash(fs.readFileSync(path.join(out,"recommended-model.json")))!==supplement.modelSha256)throw new Error(label+" model fingerprint mismatch")
 if(hash(fs.readFileSync(path.join(out,"fitted.json")))!==supplement.fitSha256)throw new Error(label+" policy fit fingerprint mismatch")
}
let files=0,rows=0;const checkedPrefixes=new Set()
for(const [metadata,source] of [["independent-stats.json","independent-check.py"],["seed-audit.json","audit.cjs"]])if(fs.existsSync(path.join(out,metadata))){
 const record=JSON.parse(fs.readFileSync(path.join(out,metadata),"utf8"))
 if(record.sourceSha256&&hash(fs.readFileSync(path.join(__dirname,source)))!==record.sourceSha256)throw new Error("Diagnostic source fingerprint mismatch: "+source)
}
if(fs.existsSync(path.join(out,"replay-verification.json"))){const replay=JSON.parse(fs.readFileSync(path.join(out,"replay-verification.json"),"utf8"));for(const [file,expected] of Object.entries(replay.source))if(hash(fs.readFileSync(path.join(__dirname,file)))!==expected)throw new Error("Replay source fingerprint mismatch: "+file)}
if(fs.existsSync(path.join(out,"revision-candidate.json"))){
 const revision=JSON.parse(fs.readFileSync(path.join(out,"revision-candidate.json"),"utf8")),p=revision.provenance
 if(hash(fs.readFileSync(path.join(__dirname,"revision.cjs")))!==p.sourceSha256)throw new Error("Revision source fingerprint mismatch")
 for(const [file,key] of [["break-even-index.json","breakEvenIndexSha256"],["valuation-manifest.json","valuationManifestSha256"],["recommended-model.json","oldModelSha256"]])if(hash(fs.readFileSync(path.join(out,file)))!==p[key])throw new Error("Revision input fingerprint mismatch: "+file)
}
if(fs.existsSync(path.join(out,"cluster-audit.json"))){const cluster=JSON.parse(fs.readFileSync(path.join(out,"cluster-audit.json"),"utf8"));for(const [file,expected] of Object.entries(cluster.source))if(hash(fs.readFileSync(path.join(__dirname,file)))!==expected)throw new Error("Cluster audit source fingerprint mismatch: "+file);if(hash(fs.readFileSync(path.join(out,"final-index.json")))!==cluster.finalIndexSha256)throw new Error("Cluster audit input fingerprint mismatch")}
for(const name of fs.readdirSync(out))if(name.endsWith("-index.json")){
 const index=JSON.parse(fs.readFileSync(path.join(out,name),"utf8")),prefix=name.slice(0,-"-index.json".length)
 for(const [group,record] of Object.entries(index)){
  const bytes=fs.readFileSync(path.join(out,record.file??path.join(prefix,group.replaceAll(":","_")+".jsonl.gz")))
  if(hash(bytes)!==record.sha256)throw new Error("Raw data fingerprint mismatch: "+group)
  const lines=zlib.gunzipSync(bytes).toString().trim().split("\n"),count=lines.length
  if(count!==record.rows)throw new Error("Raw row count mismatch: "+group)
  if(acceleration&&name==="final-index.json"){
   const prior=acceleration.checkpointPrefix[group]
   if(!prior||count<prior.rows||hash(lines.slice(0,prior.rows).map(line=>JSON.stringify(JSON.parse(line))).join("\n")+"\n")!==prior.plainSha256)throw new Error("Pre-acceleration data prefix mismatch: "+group)
   checkedPrefixes.add(group)
  }
  files++;rows+=count
 }
}
if(acceleration&&checkedPrefixes.size!==Object.keys(acceleration.checkpointPrefix).length)throw new Error("Missing pre-acceleration data prefixes")
process.stdout.write(JSON.stringify({verified:true,engineRef:engine.ref,indexedRawFiles:files,indexedRows:rows})+"\n")
