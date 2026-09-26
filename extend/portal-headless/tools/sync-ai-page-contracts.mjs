/** Refresh only the marked SDK section; preserve historical page observations above it. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createPortalHeadless } from '../dist/index.js'
const sdk = createPortalHeadless({ baseUrl: 'https://example.invalid', credential: { token: 'offline-description', tenantId: 1 } })
const marker = '## SDK AI 说明契约（2026-09-22）'
const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>')
for (const file of process.argv.slice(2)) {
  const old = readFileSync(file, 'utf8')
  const split = old.indexOf(marker)
  if (split < 0) throw new Error(`No owned SDK section: ${file}`)
  const section = old.slice(split)
  const headings = [...section.matchAll(/^### `([^`]+)`/gm)].map(m=>m[1])
  const ids = headings.length ? headings : sdk.capabilities.map(c=>c.id).filter(id=>section.includes(`- ${id}：`))
  if (!ids.length) throw new Error(`No capability IDs: ${file}`)
  const out = [marker, '', '以下由真实 SDK 描述生成；权威数据为 src/catalog/contracts-*.ts。前文浏览器/冒烟记录是历史证据，本节不将源码和离线验证称作新的部署实测。', '']
  for (const id of ids) {
    const d = sdk.catalog.describe(id)
    if (!d.ok || !d.ai) throw new Error(`No description: ${id}`)
    const a = d.ai
    out.push(`### \`${id}\``, '', a.purpose, '', `执行：\`sdk.${d.invoke.sdkPath}\`；性质：${a.effect}。${a.whenToUse}`, '', ...a.boundaries.map(x=>`- 边界：${x}`), '', '| 参数 | 意义与来源 |', '| --- | --- |', ...Object.entries(a.inputs).map(([name,p])=>`| ${escape(name)} | ${escape(p.meaning+'；来源：'+p.source+(p.lookup?'；候选：'+p.lookup.capabilityId+' '+p.lookup.valueField:'')+(p.unit?'；单位：'+p.unit:'')+(p.requiredWhen?'；条件：'+p.requiredWhen:''))} |`), '', `返回：\`${a.output.shape}\`。${a.output.empty}`, '', ...a.output.fields.filter(f=>f.values||f.unit).map(f=>`- ${f.path}：${f.meaning}${f.unit?'；单位：'+f.unit:''}${f.values?'；'+JSON.stringify(f.values):''}`), '', ...a.consume.map(x=>`- 消费：${x}`), ...a.steps.map(x=>`- ${x.role}：${x.when} → \`${x.capabilityId??x.sdkPath??'结果交付'}\`。${x.instruction}${x.mapping?' 映射：'+JSON.stringify(x.mapping):''}`), '', `完成条件：${a.completion}`, '', ...a.failures.map(x=>`- 失败处理：${x}`), ...(a.gaps?.length?['',...a.gaps.map(x=>`- **仍有缺口**：${x}`)]:[]), '', '逐字段嵌套结构、可空性、格式及证据由同一 describe 返回；完整生成参考见 ai-contract-reference.generated.md。', '')
  }
  writeFileSync(file, old.slice(0,split)+out.join('\n'))
  process.stdout.write(`synced ${file}: ${ids.length}\n`)
}
