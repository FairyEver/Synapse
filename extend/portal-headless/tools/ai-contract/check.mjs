#!/usr/bin/env node
/** Run with `pnpm build && node tools/ai-contract/check.mjs [--complete]`. */
import { validateAiContract, validateAiContracts } from './validate.mjs'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  process.stdout.write(`用法：pnpm build && node tools/ai-contract/check.mjs [--complete]

默认检查 dist 中的 AI 契约结构、已注册能力与公开方法说明、可证明的引用。
--complete 另检查说明缺口、主要章节、输入覆盖、返回字段和写入效果。
检查器只读刚构建的 dist，不会构建、访问网络或按时间戳认定源码新鲜。
必须使用上面的连续命令；单独运行不能证明 dist 与当前源码一致。
结构通过 ≠ 说明完整 ≠ 业务正确；业务语义仍需基准、契约测试和人工审阅。
`)
  process.exit(0)
}
if (args.some(arg => arg !== '--complete')) {
  process.stderr.write('未知选项；使用 --help 查看用法。\n')
  process.exit(1)
}

try {
  const [{ ALL_CAPABILITY_DEFINITIONS: definitions }, { AI_CONTRACTS: contracts, METHOD_CONTRACTS: methods }, { CAPABILITY_BINDINGS: bindingList }, { createPortalHeadless }] = await Promise.all([
    import('../../dist/capabilities/index.js'),
    import('../../dist/catalog/ai-contracts.js'),
    import('../../dist/capabilities/invoke.js'),
    import('../../dist/index.js'),
  ])
  if (!Array.isArray(definitions) || !contracts || !methods || !Array.isArray(bindingList) || typeof createPortalHeadless !== 'function') throw new Error('dist 缺少当前检查器所需的导出（含 METHOD_CONTRACTS）。请重新 pnpm build。')
  const bindings = new Map(bindingList.map(binding => [binding.capabilityId, binding.sdkPath]))
  // Construction is local; no method is invoked, credentials are inert placeholders.
  const sdk = createPortalHeadless({ baseUrl: 'https://sdk-contract-check.invalid', credential: { token: 'local-contract-check', tenantId: 1 } })
  const referencedPaths = new Set([...bindingList.map(binding => binding.sdkPath), ...Object.keys(methods)])
  for (const contract of [...Object.values(contracts), ...Object.values(methods)]) {
    if (contract?.output?.dynamic?.sdkPath) referencedPaths.add(contract.output.dynamic.sdkPath)
    for (const step of Array.isArray(contract?.steps) ? contract.steps : []) if (step?.sdkPath) referencedPaths.add(step.sdkPath)
  }
  const sdkPaths = [...referencedPaths].filter(path => {
    if (typeof path !== 'string') return false
    let value = sdk
    for (const segment of path.split('.')) {
      if (value === null || !['object', 'function'].includes(typeof value)) return false
      // Inspect own data properties only; never invoke getters while validating.
      value = Object.getOwnPropertyDescriptor(value, segment)?.value
    }
    return typeof value === 'function'
  })
  const profile = args.includes('--complete') ? 'complete' : 'structural'
  const issues = validateAiContracts(contracts, { profile, definitions, bindings, sdkPaths })
  for (const [sdkPath, contract] of Object.entries(methods)) {
    issues.push(...validateAiContract(sdkPath, contract, { profile, definitions, contracts, bindings, sdkPaths }))
    if (!sdkPaths.includes(sdkPath)) issues.push({ capabilityId: sdkPath, path: '$.sdkPath', code: 'unknown-sdk-path', message: `方法契约指向不存在的方法 ${sdkPath}。` })
  }
  for (const binding of bindingList) if (!sdkPaths.includes(binding.sdkPath)) issues.push({ capabilityId: binding.capabilityId, path: '$.invoke.sdkPath', code: 'unknown-sdk-path', message: `执行绑定指向不存在的方法 ${binding.sdkPath}。` })
  const covered = definitions.filter(definition => Object.hasOwn(contracts, definition.id)).length
  const withGaps = Object.values(contracts).filter(contract => Array.isArray(contract?.gaps) && contract.gaps.length > 0).length
  const methodGaps = Object.values(methods).filter(contract => Array.isArray(contract?.gaps) && contract.gaps.length > 0).length
  process.stdout.write(`AI 契约检查（${profile}；读取 dist，请先 pnpm build）\n已登记能力 ${covered}/${definitions.length}；已登记方法 ${Object.keys(methods).length}；能力声明缺口 ${withGaps}；方法声明缺口 ${methodGaps}；问题 ${issues.length}。\n`)
  for (const issue of issues) process.stdout.write(`${issue.capabilityId} ${issue.path} [${issue.code}] ${issue.message}\n`)
  process.stdout.write('已核对能力注册、执行绑定及引用的真实 SDK 方法；未自动枚举全部未注册公开方法。自由文本类型/业务含义、转换逻辑、证据真实性、用户/上下文输入路径和线上行为仍需独立验证。\n结构通过 ≠ 说明完整 ≠ 业务正确。\n')
  process.exitCode = issues.length ? 1 : 0
} catch (error) {
  process.stderr.write(`检查失败：${error instanceof Error ? error.message : String(error)}\n请先成功执行 pnpm build；不会回退到旧协议或猜测缺失数据。\n`)
  process.exitCode = 1
}
