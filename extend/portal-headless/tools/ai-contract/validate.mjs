/**
 * Zero-dependency validation of src/catalog/ai-contract.ts's JSON contract.
 * This checks structure and provable references, not correctness of business prose.
 * definitions: CapabilityDefinition[] or Map<id, CapabilityDefinition>.
 * contracts/bindings: Record or Map; binding values are SDK method path strings.
 * sdkPaths: an explicit, exhaustive list of callable facade paths (when supplied).
 * Mapping direction: target parameter -> result.path / args.path / user.path / context.path.
 * Bare paths mean result paths; input.path is an alias of args.path.
 * Constant sources use literal:<JSON>; no expressions are evaluated.
 */
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value))
const entries = value => value instanceof Map ? [...value] : Object.entries(value ?? {})
const registry = value => value === undefined ? undefined : new Map(Array.isArray(value) ? value.map(item => [item.id, item]) : entries(value))
const placeholder = /^(?:todo|tbd|unknown|未登记|待补充|待完善|待填写|待定|\.\.\.|…|示例说明)$/i

/** Canonical dotted/array paths; dynamic object keys use *, array items use []. */
export function normalizeAiPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const path = value.trim().replace(/^\$(?=\.|\[|$)\.?/, '').replace(/\[\*\]/g, '[]')
  if (!path) return '$'
  if (!/^(?:[\p{L}_$][\p{L}\p{N}_$-]*|\*|\[\])(?:\[\])*(?:\.(?:[\p{L}_$][\p{L}\p{N}_$-]*|\*)(?:\[\])*)*$/u.test(path)) return null
  return path
}

function pathMatches(pattern, actual) {
  if (pattern === actual) return true
  const a = pattern.split('.')
  const b = actual.split('.')
  return a.length === b.length && a.every((part, index) => {
    if (part === b[index]) return true
    const wildcard = /^\*((?:\[\])*)$/.exec(part)
    return wildcard !== null && wildcard[1] === /(?:\[\])*$/.exec(b[index])[0]
  })
}

// A documented descendant proves its containing object/array exists, not vice versa.
function hasPath(paths, path) {
  if (path === '$') return paths.length > 0
  return paths.some(candidate => {
    for (let ancestor = candidate; ancestor; ) {
      if (pathMatches(ancestor, path)) return true
      if (ancestor.endsWith('[]')) ancestor = ancestor.slice(0, -2)
      else ancestor = ancestor.includes('.') ? ancestor.slice(0, ancestor.lastIndexOf('.')) : ''
    }
    return false
  })
}

function contractPaths(contract) {
  return (Array.isArray(contract?.output?.fields) ? contract.output.fields : []).filter(object).map(field => normalizeAiPath(field.path)).filter(Boolean)
}

function inputPaths(definition, contract) {
  return [...(definition?.params ?? []).map(param => normalizeAiPath(param.name)), ...Object.keys(contract?.inputs ?? {}).map(normalizeAiPath)].filter(Boolean)
}

/**
 * @param {string} id
 * @param {unknown} contract
 * @param {{profile?: 'structural'|'complete', definitions?: Array<object>|Map<string, object>, contracts?: object|Map<string, object>, bindings?: object|Map<string, string>, sdkPaths?: string[]}} options
 * @returns {Array<{capabilityId:string,path:string,code:string,message:string}>}
 */
export function validateAiContract(id, contract, options = {}) {
  const issues = []
  const add = (path, code, message) => issues.push({ capabilityId: id, path, code, message })
  const complete = options.profile === 'complete'
  if (options.profile !== undefined && !['structural', 'complete'].includes(options.profile)) add('$', 'invalid-profile', 'profile 必须为 structural 或 complete。')
  const definitions = registry(options.definitions)
  const contracts = registry(options.contracts)
  const bindings = registry(options.bindings)
  const sdkPaths = options.sdkPaths === undefined ? undefined : new Set(options.sdkPaths)
  const definition = definitions?.get(id)

  function text(value, path, allowPlaceholder = false, allowEmpty = false) {
    if (typeof value !== 'string') { add(path, 'invalid-type', '必须是字符串。'); return false }
    if (allowEmpty !== true && !value.trim()) { add(path, 'empty-text', '说明不得为空或只有空白。'); return false }
    if (allowPlaceholder !== true && placeholder.test(value.trim())) { add(path, 'placeholder', '不得使用占位说明。'); return false }
    return true
  }
  // Literal identifiers/enum labels can legitimately equal "todo" or "unknown".
  const literalText = (value, path) => text(value, path, true)
  // Opaque types/shapes are valid migration structure; only complete rejects them.
  function typeText(value, path) {
    if (typeof value === 'string' && /^(?:unknown|any|未登记|未知)(?:\[\])?$/i.test(value.trim())) return true
    return text(value, path)
  }
  function bool(value, path) { if (typeof value !== 'boolean') add(path, 'invalid-type', '必须是 boolean。') }
  function shape(value, path, required, optional = []) {
    if (!object(value)) { add(path, 'invalid-type', '必须是普通 JSON 对象。'); return false }
    for (const key of required) if (!own(value, key)) add(`${path}.${key}`, 'missing-property', '缺少必填字段。')
    for (const key of Object.keys(value)) if (![...required, ...optional].includes(key)) add(`${path}.${key}`, 'unknown-property', '契约类型未定义该字段，请检查拼写或先更新权威类型与检查器。')
    return true
  }
  function list(value, path, visit, nonempty = false) {
    if (!Array.isArray(value)) { add(path, 'invalid-type', '必须是数组。'); return }
    if (nonempty && value.length === 0) add(path, 'empty-section', '完整说明要求至少一项。')
    value.forEach((item, index) => visit(item, `${path}[${index}]`))
  }
  function record(value, path, visit) {
    if (!object(value)) { add(path, 'invalid-type', '必须是 JSON 键值对象。'); return false }
    for (const [key, item] of Object.entries(value)) visit(item, `${path}.${key}`, key)
    return true
  }
  function pathValue(value, path) {
    if (!literalText(value, path)) return null
    const normalized = normalizeAiPath(value)
    if (normalized === null) add(path, 'invalid-path', '字段路径使用 $.id、id、list[].id 或动态键 *；转换步骤写入 instruction。')
    return normalized
  }
  function json(value, path, ancestors = new Set()) {
    if (value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value))) return
    if ((!object(value) && !Array.isArray(value)) || ancestors.has(value)) { add(path, 'not-json', '必须可无损表达为 JSON；禁止 undefined、非有限数、函数、实例和循环引用。'); return }
    const next = new Set(ancestors).add(value)
    for (const [key, item] of Object.entries(value)) json(item, `${path}.${key}`, next)
    if (Array.isArray(value) && Object.keys(value).length !== value.length) add(path, 'not-json', '数组不能包含空槽或额外属性。')
  }
  function target(capabilityId, sdkPath, path) {
    if (capabilityId !== undefined && literalText(capabilityId, `${path}.capabilityId`)) {
      if (definitions && !definitions.has(capabilityId)) add(`${path}.capabilityId`, 'unknown-capability', `未注册能力 ${capabilityId}。`)
      if (bindings && !bindings.has(capabilityId)) add(`${path}.capabilityId`, 'missing-binding', `能力 ${capabilityId} 没有执行绑定。`)
      if (sdkPath !== undefined && bindings?.has(capabilityId) && bindings.get(capabilityId) !== sdkPath) add(`${path}.sdkPath`, 'binding-mismatch', 'sdkPath 与能力执行绑定不同。')
    }
    if (sdkPath !== undefined && literalText(sdkPath, `${path}.sdkPath`) && sdkPaths && !sdkPaths.has(sdkPath)) add(`${path}.sdkPath`, 'unknown-sdk-path', `实际门面不存在可调用方法 ${sdkPath}。`)
    return capabilityId ?? (typeof sdkPath === 'string' ? [...(bindings ?? [])].find(([, value]) => value === sdkPath)?.[0] : undefined)
  }
  function targetArg(targetId, key, path) {
    const normalized = normalizeAiPath(key)
    if (!normalized) { if (complete) add(path, 'unresolved-mapping', '目标必须是输入参数路径；不要把自然语言或源字段放在映射键中。'); return }
    if (targetId !== undefined && normalized === '$') { add(path, 'invalid-target-input', 'invoke 参数映射必须指定参数名，不能用 $ 作为根参数。'); return }
    if (targetId === undefined || !definitions?.has(targetId)) return
    const allowed = inputPaths(definitions.get(targetId), contracts?.get(targetId))
    if (!hasPath(allowed, normalized)) add(path, 'unknown-target-input', `${targetId} 没有登记输入 ${key}。`)
  }
  function nullability(value, path) {
    if (complete && value.nullable === false && typeof value.type === 'string' && value.type.split('|').some(part => /^\(*\s*null\s*\)*$/.test(part.trim()))) add(`${path}.nullable`, 'nullable-mismatch', 'nullable=false 与类型中允许 null 的声明矛盾。')
  }
  function sourcePath(value, path) {
    if (value.trim().startsWith('literal:')) {
      try { json(JSON.parse(value.trim().slice('literal:'.length)), path) }
      catch { add(path, 'invalid-literal', 'literal: 后必须是合法 JSON 常量；不执行 JavaScript 表达式。') }
      return
    }
    const match = /^(result|args|input|user|context)\.(.+)$/.exec(value)
    const scope = match?.[1] ?? 'result'
    const raw = match?.[2] ?? value
    const normalized = normalizeAiPath(raw)
    if (!normalized) { if (complete) add(path, 'unresolved-mapping', '映射来源必须是 result/args/user/context 字段路径或 literal:<JSON> 常量；转换与筛选规则写在 instruction 中。'); return }
    if (scope === 'user' || scope === 'context') return // External data has no SDK output schema to verify.
    const paths = scope === 'result' ? contractPaths(contract) : inputPaths(definition, contract)
    if (!hasPath(paths, normalized)) add(path, 'unknown-source-field', `${scope} 中未登记字段 ${raw}。`)
  }

  if (!shape(contract, '$', ['purpose', 'whenToUse', 'boundaries', 'effect', 'prerequisites', 'inputs', 'output', 'consume', 'steps', 'completion', 'failures', 'idempotency', 'evidence'], ['gaps', 'examples'])) return issues
  json(contract, '$')
  for (const key of ['purpose', 'whenToUse', 'completion']) if (own(contract, key)) text(contract[key], `$.${key}`)
  for (const key of ['boundaries', 'prerequisites', 'consume', 'failures']) if (own(contract, key)) list(contract[key], `$.${key}`, text, complete && ['consume', 'failures'].includes(key))
  if (own(contract, 'effect') && !['read', 'prepare', 'write', 'local'].includes(contract.effect)) add('$.effect', 'invalid-enum', 'effect 必须为 read / prepare / write / local。')
  if (own(contract, 'idempotency') && contract.idempotency !== null) text(contract.idempotency, '$.idempotency')
  if (complete && contract.effect === 'write' && contract.idempotency === null) add('$.idempotency', 'missing-idempotency', '写入必须解释防重与不确定结果处理。')
  if (complete && definition && ((definition.write && contract.effect !== 'write') || (!definition.write && contract.effect === 'write'))) add('$.effect', 'effect-mismatch', 'effect 与能力定义 write 不一致；prepare 应保持只读。')

  if (own(contract, 'inputs')) record(contract.inputs, '$.inputs', (parameter, path, name) => {
    pathValue(name, `${path}#path`)
    if (!shape(parameter, path, ['meaning', 'source'], ['type', 'required', 'requiredWhen', 'nullable', 'omitted', 'unit', 'nullMeaning', 'format', 'default', 'constraints', 'lookup', 'options'])) return
    for (const key of ['meaning', 'source', 'requiredWhen', 'omitted', 'unit', 'nullMeaning', 'format']) if (own(parameter, key)) text(parameter[key], `${path}.${key}`)
    if (own(parameter, 'default')) text(parameter.default, `${path}.default`, true, true)
    if (own(parameter, 'type')) typeText(parameter.type, `${path}.type`)
    for (const key of ['required', 'nullable']) if (own(parameter, key)) bool(parameter[key], `${path}.${key}`)
    nullability(parameter, path)
    if (complete && definition) {
      const registered = definition.params?.find(item => normalizeAiPath(item.name) === normalizeAiPath(name))
      if (registered && typeof parameter.required === 'boolean' && parameter.required !== registered.required) add(`${path}.required`, 'input-required-mismatch', 'AI 说明的 required 与真实能力参数定义不一致。')
      if (registered?.lookup && object(parameter.lookup) && typeof parameter.lookup.capabilityId === 'string' && parameter.lookup.capabilityId !== registered.lookup.capabilityId) add(`${path}.lookup.capabilityId`, 'input-lookup-mismatch', 'AI 说明的候选来源与真实参数定义的 lookup 不一致。')
    }
    if (own(parameter, 'constraints')) list(parameter.constraints, `${path}.constraints`, text)
    if (own(parameter, 'options')) {
      const seenValues = new Set()
      const types = typeof parameter.type === 'string' ? parameter.type.split('|').map(value => value.trim()) : []
      const knownTypes = types.length > 0 && types.every(value => ['string', 'number', 'integer', 'boolean', 'null', 'undefined', 'object', 'array'].includes(value))
      list(parameter.options, `${path}.options`, (option, optionPath) => {
        if (!shape(option, optionPath, ['value', 'label'])) return
        literalText(option.label, `${optionPath}.label`)
        if (own(option, 'value')) {
          const valid = typeof option.value === 'string' || (typeof option.value === 'number' && Number.isFinite(option.value))
          if (!valid) { add(`${optionPath}.value`, 'invalid-option-value', '枚举值必须是字符串或有限数字，不自动转换布尔、null或对象。'); return }
          if (seenValues.has(option.value)) add(`${optionPath}.value`, 'duplicate-option-value', '同类型枚举值重复；不同标签不能消除重复。')
          seenValues.add(option.value)
          if (complete && knownTypes && !types.some(type =>
            (type === 'string' && typeof option.value === 'string') ||
            (type === 'number' && typeof option.value === 'number') ||
            (type === 'integer' && typeof option.value === 'number' && Number.isInteger(option.value)))) {
            add(`${optionPath}.value`, 'option-type-mismatch', '枚举值与参数声明的类型矛盾；不按标签或字符串外观猜测转换。')
          }
        }
      }, complete)
    }
    if (own(parameter, 'lookup') && shape(parameter.lookup, `${path}.lookup`, ['capabilityId', 'args', 'valueField', 'labelField'])) {
      const lookup = parameter.lookup
      const targetId = target(lookup.capabilityId, undefined, `${path}.lookup`)
      record(lookup.args, `${path}.lookup.args`, (_, argPath, key) => targetArg(targetId, key, argPath))
      for (const key of ['valueField', 'labelField']) {
        const normalized = pathValue(lookup[key], `${path}.lookup.${key}`)
        if (normalized && contracts?.has(targetId) && !hasPath(contractPaths(contracts.get(targetId)), normalized)) add(`${path}.lookup.${key}`, 'unknown-lookup-field', `${targetId} 的输出未登记 ${lookup[key]}。`)
      }
    }
  })
  if (complete && definition && object(contract.inputs)) {
    const described = Object.keys(contract.inputs).map(normalizeAiPath).filter(Boolean)
    for (const parameter of definition.params ?? []) {
      const name = normalizeAiPath(parameter.name)
      if (name && !hasPath(described, name)) add(`$.inputs.${parameter.name}`, 'undocumented-input', '真实能力参数缺少 AI 说明。')
    }
  }
  if (own(contract, 'output') && shape(contract.output, '$.output', ['shape', 'fields', 'empty'], ['dynamic'])) {
    if (own(contract.output, 'shape')) typeText(contract.output.shape, '$.output.shape')
    if (own(contract.output, 'empty')) text(contract.output.empty, '$.output.empty')
    if (complete && typeof contract.output.shape === 'string' && /^(?:unknown|any|未登记|未知)(?:\[\])?$/i.test(contract.output.shape.trim())) add('$.output.shape', 'unknown-output', '完整契约不能用未知结构代替真实 SDK 返回值。')
    const seen = new Set()
    const noData = /^(?:void|undefined|never)$/i.test(contract.output.shape)
    if (own(contract.output, 'fields')) list(contract.output.fields, '$.output.fields', (field, path) => {
      if (!shape(field, path, ['path', 'type', 'meaning'], ['optional', 'nullable', 'values', 'format', 'unit', 'constraints', 'nullMeaning', 'source'])) return
      const normalized = pathValue(field.path, `${path}.path`)
      if (normalized && seen.has(normalized)) add(`${path}.path`, 'duplicate-field', `重复字段路径 ${normalized}。`)
      if (normalized) seen.add(normalized)
      for (const key of ['meaning', 'format', 'unit', 'nullMeaning']) if (own(field, key)) text(field[key], `${path}.${key}`)
      if (own(field, 'source')) literalText(field.source, `${path}.source`)
      if (own(field, 'type')) typeText(field.type, `${path}.type`)
      if (complete && typeof field.type === 'string' && /^(?:unknown|any|未登记|未知)(?:\[\])?$/i.test(field.type.trim())) add(`${path}.type`, 'unknown-output-field', '完整契约不能用未知字段类型冒充已说明。')
      for (const key of ['optional', 'nullable']) if (own(field, key)) bool(field[key], `${path}.${key}`)
      nullability(field, path)
      if (own(field, 'constraints')) list(field.constraints, `${path}.constraints`, text)
      if (own(field, 'values')) record(field.values, `${path}.values`, literalText)
    }, complete && !noData)
    if (own(contract.output, 'dynamic') && shape(contract.output.dynamic, '$.output.dynamic', ['sdkPath', 'args', 'instructions'])) {
      const dynamic = contract.output.dynamic
      const targetId = target(undefined, dynamic.sdkPath, '$.output.dynamic')
      record(dynamic.args, '$.output.dynamic.args', (_, path, key) => targetArg(targetId, key, path))
      text(dynamic.instructions, '$.output.dynamic.instructions')
    }
  }
  if (own(contract, 'steps')) list(contract.steps, '$.steps', (step, path) => {
    if (!shape(step, path, ['role', 'when', 'instruction'], ['capabilityId', 'sdkPath', 'mapping'])) return
    if (!['required', 'optional', 'recovery', 'cancel'].includes(step.role)) add(`${path}.role`, 'invalid-enum', 'role 必须为 required / optional / recovery / cancel。')
    for (const key of ['when', 'instruction']) if (own(step, key)) text(step[key], `${path}.${key}`)
    if (step.capabilityId !== undefined && step.sdkPath !== undefined) add(path, 'ambiguous-step-target', 'capabilityId 与 sdkPath 二选一，步骤必须只有一个调用目标。')
    const targetId = target(step.capabilityId, step.sdkPath, path)
    if (own(step, 'mapping')) record(step.mapping, `${path}.mapping`, (value, mappingPath, key) => {
      if (step.capabilityId === undefined && step.sdkPath === undefined) add(mappingPath, 'missing-step-target', '有参数映射的步骤必须指明实际调用目标。')
      targetArg(targetId, key, mappingPath)
      if (literalText(value, mappingPath)) sourcePath(value, mappingPath)
    })
  })
  if (own(contract, 'evidence')) list(contract.evidence, '$.evidence', (evidence, path) => {
    if (!shape(evidence, path, ['source', 'kind', 'note'])) return
    literalText(evidence.source, `${path}.source`)
    text(evidence.note, `${path}.note`)
    if (!['implementation', 'browser', 'smoke', 'test', 'reference'].includes(evidence.kind)) add(`${path}.kind`, 'invalid-enum', '证据 kind 不属于权威类型词表。')
  }, complete)
  if (own(contract, 'gaps')) {
    list(contract.gaps, '$.gaps', text)
    if (complete && Array.isArray(contract.gaps) && contract.gaps.length) add('$.gaps', 'incomplete-evidence', '存在已声明缺口，不能标记为说明完整。')
  }
  if (own(contract, 'examples')) list(contract.examples, '$.examples', (example, path) => {
    if (!shape(example, path, ['scenario', 'args', 'result', 'interpretation'])) return
    text(example.scenario, `${path}.scenario`)
    text(example.interpretation, `${path}.interpretation`)
    record(example.args, `${path}.args`, (_, argPath, key) => targetArg(id, key, argPath))
  })
  return issues
}

/** Validate every registered capability, including definitions without a contract. */
export function validateAiContracts(contracts, options = {}) {
  if (!object(contracts) && !(contracts instanceof Map)) return [{ capabilityId: '*', path: '$', code: 'invalid-type', message: '契约注册表必须是 Record 或 Map。' }]
  const all = registry(contracts)
  const definitions = registry(options.definitions)
  const bindings = registry(options.bindings)
  const issues = []
  for (const [id, contract] of all ?? []) {
    issues.push(...validateAiContract(id, contract, { ...options, contracts }))
    if (definitions && !definitions.has(id)) issues.push({ capabilityId: id, path: '$', code: 'unregistered-contract', message: '契约没有对应的已注册能力。' })
  }
  for (const id of definitions?.keys() ?? []) {
    if (!all?.has(id)) issues.push({ capabilityId: id, path: '$', code: 'missing-contract', message: '已注册能力没有 AI 说明契约。' })
    if (bindings && !bindings.has(id)) issues.push({ capabilityId: id, path: '$.invoke', code: 'missing-binding', message: '已注册能力没有执行绑定。' })
  }
  return issues
}
