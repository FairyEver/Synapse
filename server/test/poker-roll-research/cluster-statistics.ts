/** Cluster-robust mean SE, with G/(G-1) finite-cluster correction. */
export function clusterMoments(rows:readonly {key:string;value:number}[],z:number){
 const n=rows.length,groups=new Map<string,{sum:number;n:number}>();let total=0
 for(const row of rows){total+=row.value;const g=groups.get(row.key)??{sum:0,n:0};g.sum+=row.value;g.n++;groups.set(row.key,g)}
 const mean=n?total/n:0,G=groups.size
 const se=G>1?Math.sqrt(G/(G-1)*[...groups.values()].reduce((s,g)=>s+(g.sum-g.n*mean)**2,0))/n:Infinity
 const halfWidth=z*se
 return {n,clusters:G,mean,se,halfWidth,lower:mean-halfWidth,upper:mean+halfWidth}
}
