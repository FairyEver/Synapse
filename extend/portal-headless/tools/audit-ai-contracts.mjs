#!/usr/bin/env node
/** Rebuild the full scope/evidence ledger and page reference from actual SDK output. No network calls. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createPortalHeadless } from '../dist/index.js'
import { CAPABILITY_BINDINGS } from '../dist/capabilities/invoke.js'
import { BATCH_CAPABILITIES, BATCH_ENDPOINTS } from '../dist/capabilities/generated/index.js'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const sdk=createPortalHeadless({baseUrl:'https://contract-audit.invalid',credential:{token:'offline-placeholder',tenantId:1}})
const baseline=JSON.parse(fs.readFileSync(path.join(root,'docs/ai-contract-audit/baseline.json'),'utf8'))
const bound=new Map(CAPABILITY_BINDINGS.map(b=>[b.capabilityId,b.sdkPath]))
const boundPaths=new Set(bound.values())
const ignored=['http','catalog','idempotency','capabilities']
const methods=[];const infrastructure=[]
function walk(value,prefix=''){
 for(const [name,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))){
  const v=descriptor.value,p=prefix?`${prefix}.${name}`:name
  if(!prefix&&ignored.includes(name)){infrastructure.push(p);continue}
  if(typeof v==='function'){if(!prefix){infrastructure.push(p);continue}if(!boundPaths.has(p))methods.push({sdkPath:p,description:sdk.catalog.describeMethod(p)})}
  else if(v&&typeof v==='object'&&!Array.isArray(v)&&p.split('.').length<3)walk(v,p)
 }
}
walk(sdk)
const records=sdk.capabilities.map(c=>{
 const d=sdk.catalog.describe(c.id); const ai=d.ok?d.ai:null
 return {id:c.id,page:c.pagePath,title:c.title,sdkPath:bound.get(c.id)??null,status:!ai?'missing':ai.gaps?.length?'blocked':'described',inputCount:ai?Object.keys(ai.inputs).length:0,fieldCount:ai?.output.fields.length??0,steps:ai?.steps??[],gaps:ai?.gaps??[],evidence:ai?.evidence??[]}
})
const pages=[...new Set(records.map(r=>r.page))].sort()
const nowIds=new Set(records.map(r=>r.id)),oldIds=new Set(baseline.capabilities.map(r=>r.id))
const generated=BATCH_CAPABILITIES.map(c=>({id:c.id,page:c.pagePath,registered:nowIds.has(c.id),bound:bound.has(c.id),status:nowIds.has(c.id)&&bound.has(c.id)?'callable':'generated-only',scope:BATCH_ENDPOINTS[c.id]?.scope}))
function sourcePaths(dir) { return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(entry => entry.isDirectory()?sourcePaths(`${dir}/${entry.name}`):entry.name.endsWith('.ts')?[`${dir}/${entry.name}`]:[]) }
const sourceFiles=[...sourcePaths('src'),'tools/audit-ai-contracts.mjs']
const ledger={sourceHashes:Object.fromEntries(sourceFiles.sort().map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')])),counts:{capabilities:records.length,pageContexts:pages.length,menuPages:pages.filter(p=>sdk.catalog.index.pageByPath.get(p)?.source!=='capability-only'&&sdk.catalog.index.pageByPath.get(p)?.menuPath).length,described:records.filter(r=>r.status==='described').length,blocked:records.filter(r=>r.status==='blocked').length,missing:records.filter(r=>r.status==='missing').length,unregisteredBusinessMethods:methods.length,missingMethods:methods.filter(m=>!m.description.ok).length,generatedOnly:generated.filter(g=>g.status==='generated-only').length},scopeChanges:{added:records.filter(r=>!oldIds.has(r.id)).map(r=>r.id),removed:baseline.capabilities.filter(r=>!nowIds.has(r.id)).map(r=>r.id),bindingCorrections:records.filter(r=>baseline.capabilities.find(b=>b.id===r.id)?.path!==r.sdkPath).map(r=>({id:r.id,before:baseline.capabilities.find(b=>b.id===r.id)?.path,after:r.sdkPath}))},infrastructure,capabilities:records,methods,generated}
fs.writeFileSync(path.join(root,'docs/ai-contract-audit/current.json'),JSON.stringify(ledger,null,2)+'\n')
const safe=v=>String(v??'').replaceAll('|','\\|').replaceAll('\n',' ')
const lines=['# SDK 页面与 AI 契约参考（生成）','','由 `pnpm build && node tools/audit-ai-contracts.mjs` 从 SDK 的真实 describe/describeMethod 输出生成。权威数据在 contracts-*.ts；不要手改本文件。','',`注册能力 ${records.length}；页面上下文 ${pages.length}；具体缺口与证据见 ../ai-contract-audit/current.json。描述有 gaps 的能力仍未完成验收。`,'']
for(const page of pages){
 const p=sdk.catalog.describePage(page);lines.push(`## ${p.ok?p.title:page}`,`页面上下文：\`${page}\``,'')
 for(const record of records.filter(r=>r.page===page)){
  const d=sdk.catalog.describe(record.id);if(!d.ok||!d.ai){lines.push(`### ${record.id}`,'缺少描述。','');continue}const ai=d.ai
  lines.push(`### ${record.title} · ${record.id}`,'',ai.purpose,'',`使用：${ai.whenToUse}`,`入口：\`sdk.capabilities.invoke('${record.id}', args)\`；直接方法 \`${d.invoke?.sdkPath}\`；效果 \`${ai.effect}\`。`,'',...ai.boundaries.map(v=>`- ${v}`),'','| 参数 | 类型/条件 | 含义、来源与约束 |','| --- | --- | --- |')
  for(const [name,input]of Object.entries(ai.inputs))lines.push(`| ${safe(name)} | ${safe([input.type,input.required?'必填':'可选',input.requiredWhen].filter(Boolean).join('；'))} | ${safe([input.meaning,input.source,input.format,input.default,...input.constraints??[],input.lookup?JSON.stringify(input.lookup):''].filter(Boolean).join('；'))} |`)
  lines.push('',`返回：${ai.output.shape}。${ai.output.empty}`,'','| 字段 | 类型 | 含义/状态 |','| --- | --- | --- |')
  for(const f of ai.output.fields)lines.push(`| ${safe(f.path)} | ${safe(f.type)} | ${safe([f.meaning,f.unit,f.format,f.values?JSON.stringify(f.values):'',f.optional?'可省略':'',f.nullMeaning].filter(Boolean).join('；'))} |`)
  if(ai.output.dynamic)lines.push('',`动态下钻：${JSON.stringify(ai.output.dynamic)}`)
  lines.push('',...ai.consume.map(v=>`- ${v}`),'',...ai.steps.map(s=>`- ${s.role} · ${s.when}：${s.capabilityId??s.sdkPath??''} ${s.mapping?JSON.stringify(s.mapping):''}；${s.instruction}`),'',`完成：${ai.completion}`,`防重：${ai.idempotency??'不适用（只读/准备）'}`,...ai.failures.map(v=>`- 失败处理：${v}`),...(ai.gaps??[]).map(v=>`- **未完成**：${v}`),'')
 }
}
lines.push('## 未注册公开业务方法','','这些方法只能按直接 SDK 路径调用；不能把方法名传给 capabilities.invoke。完整契约通过 catalog.describeMethod(sdkPath) 返回。','','| 直接方法 | 用途 | 状态 |','| --- | --- | --- |')
for(const m of methods)lines.push(`| ${m.sdkPath} | ${safe(m.description.ok?m.description.ai.purpose:'缺少描述')} | ${m.description.ok?m.description.ai.gaps?.length?'有证据缺口':'已描述':'未覆盖'} |`)
fs.writeFileSync(path.join(root,'docs/pages/ai-contract-reference.generated.md'),lines.join('\n')+'\n')
process.stdout.write(JSON.stringify(ledger.counts)+'\n')
if(ledger.counts.missing||ledger.counts.missingMethods)process.exitCode=1
