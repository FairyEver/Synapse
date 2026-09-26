/**
 * 判分逻辑（纯函数，不依赖 SDK，不起网络）。
 *
 * 输入：一个任务定义 + 一个「作答」+ 已注册能力清单
 * 输出：逐条检查结果 + 是否全过
 *
 * 把判分独立出来的原因：将来接入模型的作答时，作答从「人填的 JSON」变成
 * 「模型吐的 JSON」，判分这一层完全不用动，也才能拿坏答案反证它真的会红。
 */

/**
 * @typedef {object} ArgSpec
 * @property {*} value 参数值
 * @property {string} from 这个值从哪来（用户原话 / 哪次调用的哪个字段 / 假设）
 * @property {boolean} [deferred] true = 必须真调一次才能拿到
 *
 * @typedef {object} Decision
 * @property {string} taskId
 * @property {'call'|'clarify'|'unsupported'} outcome
 * @property {string} [capabilityId] outcome=call 时的落点
 * @property {string[]} [chain] 路上经过的能力 id
 * @property {Record<string, ArgSpec>} [args]
 * @property {string[]} [missing] outcome=clarify 时要回来问用户的字段
 * @property {string} [pageRef] outcome=unsupported 时命中的页面
 * @property {string} [notes]
 */

const TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/

function parseTime(raw) {
  const s = String(raw)
  const m = TIME_RE.exec(s)
  if (!m) return null
  return {
    raw: s,
    minute: m[5],
    second: m[6],
    // 字典序对 `YYYY-MM-DD HH:mm:ss` 就是时间序，直接比字符串更稳。
    sortable: s.replace('T', ' '),
  }
}

function check(rule, args) {
  const spec = args?.[rule.arg]
  const name = `${rule.kind}:${rule.arg}`
  if (spec === undefined) {
    return { name, ok: false, detail: `参数 ${rule.arg} 缺失` }
  }
  const value = spec.value

  switch (rule.kind) {
    case 'nonEmpty':
      return { name, ok: value !== undefined && value !== null && value !== '', detail: `值=${JSON.stringify(value)}` }

    case 'range': {
      const n = Number(value)
      const ok = Number.isFinite(n) && n >= rule.min && n <= rule.max
      return { name, ok, detail: `值=${JSON.stringify(value)}，要求 ${rule.min}~${rule.max}` }
    }

    case 'maxLength': {
      const ok = typeof value === 'string' && value.length > 0 && value.length <= rule.max
      return { name, ok, detail: `长度=${typeof value === 'string' ? value.length : 'N/A'}，要求 ≤${rule.max}` }
    }

    case 'minuteIn': {
      const t = parseTime(value)
      const ok = t !== null && rule.allow.includes(t.minute)
      return { name, ok, detail: `值=${JSON.stringify(value)}，分钟须为 ${rule.allow.join('/')}` }
    }

    case 'secondsZero': {
      const t = parseTime(value)
      const ok = t !== null && t.second === '00'
      return { name, ok, detail: `值=${JSON.stringify(value)}，秒须为 00` }
    }

    case 'before': {
      const a = parseTime(value)
      const b = parseTime(args?.[rule.other]?.value)
      const ok = a !== null && b !== null && a.sortable < b.sortable
      return { name, ok, detail: `${value} 应早于 ${args?.[rule.other]?.value}` }
    }

    default:
      return { name, ok: false, detail: `未知规则 ${rule.kind}` }
  }
}

/**
 * 判分一个作答。
 *
 * @param {import('./tasks.mjs').TASKS[number]} task
 * @param {Decision} decision
 * @param {{ registeredCapabilityIds: string[] }} ctx
 */
export function scoreDecision(task, decision, ctx) {
  const checks = []
  const expect = task.expect
  const registered = new Set(ctx.registeredCapabilityIds ?? [])

  // 1. 落点类型对不对
  checks.push({
    name: 'outcome',
    ok: decision.outcome === expect.outcome,
    detail: `作答=${decision.outcome}，期望=${expect.outcome}`,
  })

  // 2. 编没编能力 —— 出现过的每一个能力 id 都必须是目录里真实存在的
  const mentioned = new Set([decision.capabilityId, ...(decision.chain ?? [])].filter(Boolean))
  const fabricated = [...mentioned].filter((id) => !registered.has(id))
  checks.push({
    name: 'no-fabricated-capability',
    ok: fabricated.length === 0,
    detail: fabricated.length ? `编造了：${fabricated.join('、')}` : `提到的 ${mentioned.size} 个能力都存在`,
  })

  // 3. 落点是否可接受
  if (expect.outcome === 'call') {
    const ok = expect.acceptableCapabilityIds.includes(decision.capabilityId)
    checks.push({
      name: 'landing',
      ok,
      detail: `落点=${decision.capabilityId}，可接受=${expect.acceptableCapabilityIds.join('、')}`,
    })
  }

  // 4. 该走的中间步骤走没走（drilldown 专用）
  if (expect.requiredChain) {
    const seen = new Set([...(decision.chain ?? []), decision.capabilityId].filter(Boolean))
    const missed = expect.requiredChain.filter((id) => !seen.has(id))
    checks.push({
      name: 'required-chain',
      ok: missed.length === 0,
      detail: missed.length ? `链上漏了：${missed.join('、')}` : `链路完整（${expect.requiredChain.join(' → ')}）`,
    })
  }

  // 5. 必填参数齐不齐
  if (expect.outcome === 'call') {
    const provided = Object.keys(decision.args ?? {})
    checks.push({
      name: 'args-present',
      ok: provided.length > 0,
      detail: provided.length ? `给了 ${provided.join('、')}` : '一个参数都没给',
    })
  }

  // 6. 每个参数都要交代出处 —— 这是「能不能构造出那次调用」的核心
  const args = decision.args ?? {}
  const noProvenance = Object.entries(args)
    .filter(([, spec]) => !spec || typeof spec.from !== 'string' || spec.from.trim() === '')
    .map(([k]) => k)
  checks.push({
    name: 'arg-provenance',
    ok: noProvenance.length === 0,
    detail: noProvenance.length ? `没交代出处：${noProvenance.join('、')}` : `${Object.keys(args).length} 个参数都有出处`,
  })

  // 7. 参数取值合不合契约
  for (const rule of expect.argRules ?? []) {
    checks.push(check(rule, args))
  }

  // 8. 该问的问了没（missing 专用）
  if (expect.missingAnyOf) {
    const asked = new Set(decision.missing ?? [])
    const missed = expect.missingAnyOf.filter((f) => !asked.has(f))
    checks.push({
      name: 'clarification-covers',
      ok: missed.length === 0,
      detail: missed.length ? `没问到：${missed.join('、')}` : `问到了：${[...asked].join('、')}`,
    })
  }

  // 9. 不许在信息不足 / 不支持时硬调
  const forbidden = (expect.forbiddenCapabilityIds ?? []).filter((id) => mentioned.has(id))
  checks.push({
    name: 'no-forbidden-call',
    ok: forbidden.length === 0,
    detail: forbidden.length ? `不该调却调了：${forbidden.join('、')}` : '没有越界调用',
  })

  // 10. 不支持时，命中的页面该不该给出
  if (expect.outcome === 'unsupported') {
    const refs = expect.acceptablePageRefs ?? []
    if (refs.length === 0) {
      checks.push({
        name: 'no-page-claimed',
        ok: !decision.pageRef,
        detail: decision.pageRef ? `零命中却给了页面：${decision.pageRef}` : '没有虚构页面',
      })
    } else {
      const ok = Boolean(decision.pageRef) && refs.some((r) => String(decision.pageRef).includes(r))
      checks.push({
        name: 'page-identified',
        ok,
        detail: `pageRef=${decision.pageRef ?? '(空)'}，可接受=${refs.join(' / ')}`,
      })
    }
  }

  return {
    taskId: task.id,
    kind: task.kind,
    passed: checks.every((c) => c.ok),
    checks,
  }
}

/**
 * 判分一整轮。
 *
 * @param {Array} tasks
 * @param {Record<string, Decision>} decisions 按 taskId 索引的作答
 * @param {{ registeredCapabilityIds: string[] }} ctx
 */
export function scoreRun(tasks, decisions, ctx) {
  const results = tasks.map((task) => {
    const decision = decisions[task.id]
    if (!decision) {
      return {
        taskId: task.id,
        kind: task.kind,
        passed: false,
        checks: [{ name: 'answer-present', ok: false, detail: '这一题没有作答' }],
      }
    }
    return scoreDecision(task, decision, ctx)
  })
  const passed = results.filter((r) => r.passed).length
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  }
}
