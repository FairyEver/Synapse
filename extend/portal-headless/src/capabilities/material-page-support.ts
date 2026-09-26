/** Shared validation for the material pages that are exposed through the Portal menu. */
export type MaterialPageId = string | number
export type MaterialJsonObject = Record<string, unknown>

export function materialObjectOf (value: unknown, label: string): MaterialJsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as MaterialJsonObject
}

export function materialIdOf (value: unknown, label: string): MaterialPageId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
  return value
}

export function materialOptionalIdOf (value: unknown, label: string): MaterialPageId | null {
  if (value === undefined || value === null || value === '') return null
  return materialIdOf(value, label)
}

export function materialTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

export function materialNumberOf (value: unknown, label: string, options: { integer?: boolean; min?: number; max?: number } = {}): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(number) || (options.integer && !Number.isSafeInteger(number)) || (options.min !== undefined && number < options.min) || (options.max !== undefined && number > options.max)) {
    const range = options.min === undefined && options.max === undefined ? '' : `，范围${options.min ?? '-∞'}至${options.max ?? '∞'}`
    throw new Error(`${label}必须为有效数字${options.integer ? '整数' : ''}${range}`)
  }
  return number
}

export function materialNullableNumberOf (value: unknown, label: string, options: { integer?: boolean; min?: number; max?: number } = {}): number | null {
  if (value === undefined || value === null || value === '') return null
  return materialNumberOf(value, label, options)
}

export function materialPageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是页面支持的10、20、50、100、200或500')
  return resolved
}

export function materialTreeOf (value: unknown, label: string): MaterialJsonObject {
  const node = materialObjectOf(value, label)
  const children = node.children === undefined || node.children === null ? [] : node.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须是数组`)
  const name = node.name ?? node.catName
  return {
    ...node,
    id: materialIdOf(node.id, `${label}.id`),
    name: typeof name === 'string' ? name : '',
    children: children.map((item, index) => materialTreeOf(item, `${label}.children[${index}]`)),
  }
}

export function materialTrueResponse (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}
