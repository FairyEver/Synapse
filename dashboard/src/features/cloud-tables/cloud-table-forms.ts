import type { CloudField, CloudFieldType, CloudTableDto, CloudRecordDto } from '@synapse/shared'
export function canChangeRecord(table: CloudTableDto, record: CloudRecordDto, action: 'update' | 'delete'): boolean {
  return table.permissions[action] === 'all' || (table.permissions[action] === 'own' && Boolean(table.viewerId) && record.creatorUserId === table.viewerId)
}
export const fieldTypes: { key: CloudFieldType; name: string }[] = [
  { key: 'text', name: '文本' }, { key: 'integer', name: '整数' }, { key: 'number', name: '小数' }, { key: 'boolean', name: '布尔' }, { key: 'date', name: '日期' }, { key: 'datetime', name: '日期时间' }, { key: 'singleSelect', name: '单选' }, { key: 'multiSelect', name: '多选' }, { key: 'url', name: '链接' }, { key: 'json', name: 'JSON' },
]
export function filterOperators(type?: CloudFieldType): { key: string; name: string }[] {
  return [{ key: 'eq', name: '等于' }, { key: 'ne', name: '不等于' },
    ...(['text', 'url'].includes(type ?? '') ? [{ key: 'contains', name: '包含' }] : []),
    ...(!['boolean', 'singleSelect', 'json', 'multiSelect'].includes(type ?? '') ? [{ key: 'gt', name: '大于' }, { key: 'lt', name: '小于' }] : []),
  ]
}
export function parseFieldInput(type: CloudFieldType, text: string): unknown {
  if (!text.length) return null
  if (type === 'integer' || type === 'number') {
    const number = Number(text)
    if (!Number.isFinite(number) || (type === 'integer' && !Number.isSafeInteger(number))) throw new Error('请输入有效数字')
    return number
  }
  if (type === 'boolean') { if (text !== 'true' && text !== 'false') throw new Error('请选择是或否'); return text === 'true' }
  if (type === 'json' || type === 'multiSelect') return JSON.parse(text)
  return text
}
export function fieldInput(value: unknown, type?: CloudFieldType): string { return value === null || value === undefined ? '' : type === 'json' ? JSON.stringify(value) : typeof value === 'string' ? value : JSON.stringify(value) }
export function recordValues(fields: CloudField[], draft: Record<string, string>, existing?: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(fields.filter(f => !f.archivedAt).flatMap(f => {
    const input = draft[f.key] ?? ''
    if (existing && input === fieldInput(existing[f.key], f.type)) return []
    const value = !existing && f.defaultValue !== undefined && input === fieldInput(f.defaultValue, f.type) ? f.defaultValue : parseFieldInput(f.type, input)
    return [[f.key, value]]
  }))
}
export function parseOptions(text: string): { key: string; name: string }[] {
  if (text.trimStart().startsWith('[')) {
    const value: unknown = JSON.parse(text)
    if (!Array.isArray(value) || value.some(option => !option || typeof option !== 'object' || typeof option.key !== 'string' || typeof option.name !== 'string' || !option.key.length || !option.name.length || Object.keys(option).some(key => key !== 'key' && key !== 'name'))) throw new Error('选项需要包含 key 和 name 的 JSON 数组')
    return value
  }
  return text.split('\n').filter(s => s.trim()).map(line => { const i = line.indexOf(':'); if (i <= 0 || !line.slice(i + 1).trim()) throw new Error('选项格式为 标识:名称'); return { key: line.slice(0, i).trim(), name: line.slice(i + 1).trim() } })
}
export function exportCsv(fields: CloudField[], records: Record<string, unknown>[]): string {
  const cell = (v: unknown) => {
    let text = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    if (/^[\s]*[=+\-@\t\r]/u.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  return [fields.map(f => cell(f.name)).join(','), ...records.map(r => fields.map(f => cell(r[f.key])).join(','))].join('\r\n')
}
export function downloadData(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime })), link = document.createElement('a')
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
