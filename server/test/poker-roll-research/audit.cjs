/* Check seed separation without interpreting shared candidate random numbers as independent data. */
const fs=require("node:fs"),path=require("node:path"),zlib=require("node:zlib"),crypto=require("node:crypto")
const out=process.argv[2];if(!out)throw new Error("Result directory required")
const read=name=>JSON.parse(fs.readFileSync(path.join(out,name),"utf8")),size=read("inference-design.json").fixedPerGroup
const sets={train:new Set(),fixed:new Set(),adaptive:new Set(),calibration:new Set(),refinement:new Set()},counts={train:0,fixed:0,adaptive:0}
const latent={train:new Set(),fixed:new Set(),calibration:new Set(),refinement:new Set()},globalSeeds={train:new Set(),fixed:new Set()}
for(const name of fs.readdirSync(out)){
 let split=name==="train-index.json"?"train":name==="final-index.json"?"adaptive":/^candidate-\d+-index\.json$/.test(name)?"calibration":/^refinement-\d+-index\.json$/.test(name)?"refinement":null
 if(!split)continue
 for(const record of Object.values(read(name))){
  const lines=zlib.gunzipSync(fs.readFileSync(path.join(out,record.file))).toString().trim().split("\n")
  for(const line of lines){const row=JSON.parse(line),key=row.group+":"+row.seed,handKey=`${row.variant}:${row.players+row.folded}:${row.seed}`;sets[split].add(key);if(split in counts)counts[split]++
   if(split in latent)latent[split].add(handKey)
   if(split==="train")globalSeeds.train.add(row.seed)
   if(split==="adaptive"&&Number(row.id.slice(row.id.lastIndexOf(":")+1))<size){sets.fixed.add(key);counts.fixed++;latent.fixed.add(handKey);globalSeeds.fixed.add(row.seed)}
  }
 }
}
const cross={};for(const a of ["train","calibration","refinement"])for(const b of ["calibration","refinement","fixed"])if(a!==b&&!(b+":"+a in cross))cross[a+":"+b]=[...sets[a]].filter(key=>sets[b].has(key)).length
const latentCross={};for(const key of Object.keys(cross)){const [a,b]=key.split(":");latentCross[key]=[...latent[a]].filter(hand=>latent[b].has(hand)).length}
const result={sourceSha256:crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex"),trainRows:counts.train,fixedRows:counts.fixed,trainDuplicateGroupSeeds:counts.train-sets.train.size,fixedDuplicateGroupSeeds:counts.fixed-sets.fixed.size,crossSplitGroupSeedIntersections:cross["train:fixed"],adaptiveRows:counts.adaptive,adaptiveDuplicateGroupSeeds:counts.adaptive-sets.adaptive.size,independentSplitIntersections:cross,underlyingHandIntersections:latentCross,trainDuplicateUnderlyingHands:counts.train-latent.train.size,fixedDuplicateUnderlyingHands:counts.fixed-latent.fixed.size,trainGlobalSeedReuses:counts.train-globalSeeds.train.size,fixedGlobalSeedReuses:counts.fixed-globalSeeds.fixed.size,scope:"Group + actual initial snapshot seed, additionally variant + original admitted player count + seed across stages. Candidate models intentionally share calibration/refinement seeds; sets are unions, not independent per-model samples. Identical 32-bit seeds across different player counts/variants are separately disclosed, not called identical hands."}
fs.writeFileSync(path.join(out,"seed-audit.json"),JSON.stringify(result,null,2)+"\n");process.stdout.write(JSON.stringify(result)+"\n")
