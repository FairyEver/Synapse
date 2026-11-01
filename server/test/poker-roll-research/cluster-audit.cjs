/* Post-study diagnosis only: preserve frozen gates and group repeated whole-hand seeds. */
const fs=require("node:fs"),path=require("node:path"),zlib=require("node:zlib"),crypto=require("node:crypto"),{load}=require("./loader.cjs")
const out=process.argv[2];if(!out)throw new Error("Result directory required")
const read=name=>JSON.parse(fs.readFileSync(path.join(out,name),"utf8")),summary=read("final-summary.json"),design=read("inference-design.json"),{clusterMoments}=load("cluster-statistics.ts"),hash=b=>crypto.createHash("sha256").update(b).digest("hex"),groups={},duplicates=[]
for(const [group,record] of Object.entries(read("final-index.json"))){
 const rows=zlib.gunzipSync(fs.readFileSync(path.join(out,record.file))).toString().trim().split("\n").map(JSON.parse),seeds=new Map(),stats={}
 for(const row of rows){if(!seeds.has(row.seed))seeds.set(row.seed,[]);seeds.get(row.seed).push({id:row.id,depth:row.depth,shape:row.shape,count:row.count,folded:row.folded})}
 for(const [seed,records] of seeds)if(records.length>1)duplicates.push({group,seed,records})
 for(const kind of ["normal","super"]){const available=rows.filter(r=>typeof r[kind]==="number"&&Number.isFinite(r[kind]));stats[kind]={...clusterMoments(available.map(r=>({key:String(r.seed),value:r[kind]})),design.diagnosticZ),target:summary.groups[group][kind==="normal"?"targetNormal":"targetSuper"]}}
 groups[group]={n:rows.length,uniqueWholeHandSeeds:seeds.size,...stats,precisionMet:stats.normal.halfWidth<=stats.normal.target&&stats.super.halfWidth<=stats.super.target,originalPrecisionMet:summary.groups[group].precisionMet}
}
const result={method:"Post-study cluster-robust mean SE by group + actual whole-hand seed, G/(G-1) correction, original Bonferroni z and fee targets. Does not overwrite frozen results, select prices or certify a revised model.",source:Object.fromEntries(["cluster-statistics.ts","cluster-audit.cjs"].map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))])),finalIndexSha256:hash(fs.readFileSync(path.join(out,"final-index.json"))),duplicates,precisionGroups:Object.values(groups).filter(g=>g.precisionMet).length,totalGroups:Object.keys(groups).length,groups}
fs.writeFileSync(path.join(out,"cluster-audit.json"),JSON.stringify(result,null,2)+"\n");process.stdout.write(JSON.stringify({duplicateSeedClusters:duplicates.length,clusteredPrecisionGroups:result.precisionGroups})+"\n")
