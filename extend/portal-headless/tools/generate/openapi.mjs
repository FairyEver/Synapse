#!/usr/bin/env node
/**
 * 从能力目录生成 OpenAPI 3.1 规格。
 *
 * 为什么值得做：
 * - 能力定义本来就带参数契约（name / kind / required / description），这是 OpenAPI 需要的全部信息；
 * - 生成之后 Swagger UI、Redoc、Postman、各种 SDK 生成器立刻可用，不用为每个页面手写文档；
 * - 阶段 ④ 要给 SY 后端设计路由前缀——这份规格就是那个契约的草稿。
 *
 * 输入：构建产物 dist/index.js（因为能力定义写在 TypeScript 里）。
 * 所以要先 `pnpm build`。
 *
 * 用法：
 *   pnpm build && pnpm openapi
 *   pnpm build && node tools/generate/openapi.mjs --out /tmp/openapi.json
 *
 * 说明：SDK 不是 HTTP 服务，"路径"是按能力 ID 造的（/portal-headless/{capabilityId}）。
 * 真正要调 Portal 的哪个接口，写在每个 operation 的 `x-portal-endpoint` 扩展字段里。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '../..')
const DIST_ENTRY = path.join(PKG_ROOT, 'dist/index.js')

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const OUT = outIndex === -1 ? path.join(PKG_ROOT, 'generated/openapi.json') : path.resolve(args[outIndex + 1])

if (!fs.existsSync(DIST_ENTRY)) {
  process.stderr.write('[openapi] 找不到 dist/index.js，请先跑 `pnpm build`\n')
  process.exit(1)
}

/** 一个枚举取值的 JSON Schema 类型。`enum` 的 `type` 必须与取值相容，否则 lint 报 no-enum-type-mismatch */
function jsonTypeOf (value) {
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'string'
}

function schemaForContractType (type) {
  if (typeof type !== 'string') return null
  const normalized = type.trim()
  if (normalized.endsWith('[]')) {
    const itemType = normalized.slice(0, -2).trim().replace(/^\((.*)\)$/, '$1').trim()
    const itemTypes = itemType.split('|').map(value => value.trim()).filter(Boolean)
    const items = itemTypes.length > 1
      ? { oneOf: itemTypes.map(value => ({ type: value === 'number' ? 'number' : value === 'integer' ? 'integer' : 'string' })) }
      : { type: itemTypes[0] === 'number' ? 'number' : itemTypes[0] === 'integer' ? 'integer' : 'string' }
    return { type: 'array', items }
  }
  if (normalized === 'string' || normalized === 'number' || normalized === 'integer' || normalized === 'boolean' || normalized === 'object' || normalized === 'null') {
    return { type: normalized }
  }
  return null
}

/** 参数类型 kind → JSON Schema。与设计 D6 的"参数分类型"一致。 */
function schemaFor (param) {
  const base = (() => {
    switch (param.kind) {
      case 'number':
        return { type: 'integer' }
      case 'boolean':
        return { type: 'boolean' }
      case 'date':
        return { type: 'string', format: 'date-time' }
      case 'enum': {
        if (!param.options?.length) return { type: 'string' }
        const values = param.options.map((o) => o.value)
        // 类型从**取值**推，不是从 kind 推：kind 只说明"是小枚举"，
        // 而枚举值可能是数字（如组织类型 1/2、发布状态 0/1）。
        // 类型不齐时（同一个枚举里既有字符串又有数字）不钉 `type`——
        // 只要 `enum` 在，OpenAPI 就仍然表达了取值集合。
        const types = [...new Set(values.map(jsonTypeOf))]
        return types.length === 1 ? { type: types[0], enum: values } : { enum: values }
      }
      // search / tree 都是字符串，但语义不同，靠 description 与 x-param-kind 表达
      case 'search':
      case 'tree':
      case 'text':
        return { type: 'string' }
      case 'array':
        return { type: 'array', items: {} }
      default:
        return { type: 'string' }
    }
  })()

  // Legacy kind describes the picker, not necessarily the SDK value (IDs may be arrays/objects).
  const explicitSchema = schemaForContractType(param.contract?.type) ?? {}
  return {
    ...(param.contract ? explicitSchema : base),
    ...(param.options?.length ? { enum: param.options.map(option => option.value) } : {}),
    ...(param.contract ? { 'x-sdk-parameter': param.contract } : {}),
    ...(param.description ? { description: param.description } : {}),
    // 保留原始类型，供调用方（尤其是 AI）区分"小枚举"与"长选项"
    'x-param-kind': param.kind,
    ...(param.lookup ? { 'x-lookup': param.lookup } : {}),
  }
}

/** 长选项参数的统一说明，来自设计 D6 / H35 */
const LONG_OPTION_NOTE =
  '长选项参数：候选可达上千条。**必须先由用户给出关键字**，不要无条件全量拉取——' +
  '那会把调用方的上下文冲掉。用户不知道有什么可选时，用 deptId 之类的维度先缩小范围。'

function buildSpec (portal) {
  const { capabilities } = portal
  const catalog = portal.catalog
  const domains = catalog.listDomains()

  const paths = {}
  const tags = domains.domains.map((d) => ({ name: d.domain, description: d.label }))

  for (const cap of capabilities) {
    const isWrite = cap.write === true
    const description = catalog.describe(cap.id)
    const longOptionNames = cap.params.filter((p) => p.kind === 'search' || p.kind === 'tree').map((p) => p.name)

    const params = description.ok ? description.params : cap.params
    const parameters = params.map((param) => ({
      name: param.name,
      in: 'query',
      required: param.required === true,
      schema: schemaFor(param),
      ...(param.kind === 'search' || param.kind === 'tree' ? { description: `${param.description ?? ''}\n\n${LONG_OPTION_NOTE}`.trim() } : {}),
    }))

    const domain = domains.domains.find((d) =>
      d.capabilityIds?.includes(cap.id),
    )?.domain ?? 'other'

    paths[`/portal-headless/${cap.id}`] = {
      [isWrite ? 'post' : 'get']: {
        tags: [domain],
        summary: cap.title,
        operationId: cap.id,
        description: [
          cap.pagePath ? `页面上下文：\`${cap.pagePath}\`` : '',
          description.ok && description.ai ? `${description.ai.purpose}\n效果：${description.ai.effect}。${description.ai.whenToUse}` : isWrite ? '**写操作**：会改动 Portal 数据。' : '只读。',
          longOptionNames.length ? `含长选项参数：${longOptionNames.join('、')}。` : '',
          description.ok ? `\n${description.consume?.notes?.join('\n') ?? ''}` : '',
        ].filter(Boolean).join('\n'),
        parameters,
        ...(isWrite
          ? {
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: params.filter((p) => p.required).map((p) => p.name),
                      properties: Object.fromEntries(params.map((p) => [p.name, schemaFor(p)])),
                    },
                  },
                },
              },
            }
          : {}),
        responses: {
          200: {
            description: description.ok ? `SDK 已解包的最终返回：${description.returns.shape}。${description.ai?.output.empty ?? ''}。业务失败由 SDK 抛出异常。` : 'SDK 最终返回；业务失败抛出异常。',
            content: {
              'application/json': {
                schema: description.ok && description.ai ? { 'x-sdk-shape': description.ai.output.shape, 'x-fields': description.ai.output.fields } : {},
              },
            },
          },
          // 复用 components 里的响应定义，避免每个 operation 抄一遍
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
        'x-portal-page': cap.pagePath ?? null,
        'x-portal-permission': cap.permission ?? null,
        'x-write': isWrite,
        ...(description.ok && description.ai ? { 'x-ai-contract': description.ai, 'x-sdk-invoke': description.invoke } : {}),
        'x-llm-tool': `${cap.id}-llm`,
        ...(description.ok && description.next?.length
          ? { 'x-next-steps': description.next.map((n) => ({ tool: n.tool, args: n.args, why: n.why })) }
          : {}),
      },
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Portal Headless SDK —— 能力目录',
      version: '0.0.1',
      description: [
        '这份规格是**从能力目录自动生成**的（`tools/generate/openapi.mjs`），不是手写的。',
        '',
        '**注意这里描述的不是一个 HTTP 服务**，而是 SDK 的能力面。路径 `/portal-headless/{能力ID}` 是按能力 ID 造的占位路径，',
        '不是真实路由；真正打给 Portal 的接口绑定在 `src/capabilities/*.ts` 的实现里（能力定义本身不携带 URL）。',
        '',
        '设计文档：`docs/usage.md`（调用方式与用例）、`docs/design.md`（决策与实测）。',
      ].join('\n'),
    },
    servers: [{ url: 'https://biz-api-test.wodecorp.cn', description: '测试环境（正式环境用 https://biz-api.wodecorp.cn）' }],
    // 显式声明凭据模型。这不只是为了让 lint 过——它把 D1 选的凭据形态写进了契约。
    security: [{ PortalSessionToken: [], PortalTenantId: [] }],
    components: {
      // 每个 operation 都复用的响应。描述里写的是踩过的坑，不是泛泛而谈。
      responses: {
        Unauthorized: {
          description:
            '凭据不可用。**无头下没有登录页可跳**：唯一恢复路径是让用户重新走一次授权回调。' +
            '注意后端把所有令牌类失败都塌缩成同一个 401「账号未登录」，区分不出「过期 / 未登记 / 无 scope」。',
        },
        Forbidden: {
          description:
            '没有该操作权限。注意菜单树**不能**当作权限裁决——存在能调、但不在用户菜单里的能力（如会议室的流程表单）。',
        },
      },
      securitySchemes: {
        PortalSessionToken: {
          type: 'apiKey',
          in: 'header',
          name: 'token',
          description:
            'Portal 会话 token（设计 D1：由浏览器回调取得，不是私人令牌——后者是白名单，调不了这些接口）。' +
            '注意：改密码不会撤销已签发的 token；用户被停用后最坏仍可用到 JWT 过期（7 天）。',
        },
        PortalTenantId: {
          type: 'apiKey',
          in: 'header',
          name: 'tenant-id',
          description:
            '当前租户，必须显式指定。省略时后端在部分路径会静默选错租户（设计 F26）。',
        },
      },
    },
    tags,
    paths,
  }
}

const mod = await import(DIST_ENTRY)
const portal = mod.createPortalHeadless({
  baseUrl: 'https://biz-api-test.wodecorp.cn',
  credential: { token: 'placeholder', tenantId: 1 },
})

const spec = buildSpec(portal)

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n')

const opCount = Object.values(spec.paths).reduce((n, p) => n + Object.keys(p).length, 0)
process.stdout.write(
  `[openapi] 能力 ${portal.capabilities.length} 个 → operation ${opCount} 个，tag ${spec.tags.length} 个\n` +
    `[openapi] 已写入 ${path.relative(PKG_ROOT, OUT)}\n` +
    `[openapi] 渲染：npx @redocly/cli preview-docs ${path.relative(PKG_ROOT, OUT)}  或  npx swagger-ui-watcher ${path.relative(PKG_ROOT, OUT)}\n`,
)
