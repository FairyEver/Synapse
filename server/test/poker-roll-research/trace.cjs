/* Optional synthetic audit observer; never passed to a player policy. */
const fs=require("node:fs")
module.exports.install=(sim,file)=>{
 const ids=new WeakMap(),records=[];let serial=0
 const sum=xs=>xs.reduce((a,b)=>a+b,0)
 function capture(g,event,detail={}){
  if(!ids.has(g))ids.set(g,++serial)
  const initial=[...g.original],stack=g.hand.seats.map(s=>s.stack),contributions=g.hand.seats.map(s=>s.total),escrow=[...g.credits]
  const available=sum(stack),committed=g.hand.street==="settled"?0:sum(contributions),frozen=g.released?0:sum(escrow),initialCapital=sum(initial)
  if(available+committed+frozen!==initialCapital)throw new Error("Audit observer found original-capital mismatch")
  records.push({branch:ids.get(g),event,steps:g.steps,street:g.hand.street,released:g.released,initialCapital,available,committed,frozen,initialBySeat:initial,availableBySeat:stack,contributionsBySeat:contributions,creditsBySeat:escrow,paidBySeat:[...g.paid],engineCapitalBySeat:g.hand.seats.map(s=>s.startingStack),counts:[...g.counts],...detail})
 }
 const create=sim.createGame
 sim.createGame=(...args)=>{const g=create(...args);capture(g,"created");return g}
 for(const name of ["bet","roll","finish"]){const original=sim[name];sim[name]=(...args)=>{
  const g=args[0];if(!ids.has(g))capture(g,"branch-start")
  const value=original(...args)
  capture(g,name,name==="roll"?{kind:args[1],fee:args[3]}:name==="bet"?{decision:args[1]}:{})
  return value
 }}
 return ()=>{fs.writeFileSync(file,records.map(r=>JSON.stringify(r)).join("\n")+"\n",{flag:"wx"});return records.length}
}
