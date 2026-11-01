import { describe, expect, it } from 'vitest'
import { parseFieldInput, exportCsv, parseOptions, canChangeRecord, fieldInput } from './cloud-table-forms'
describe('cloud table form values and export', () => {
  it.each(['true', '123', 'abc', '', 'null', '"quoted"', false, 42, null, ['a'], { a: 1 }])('round-trips JSON values without changing their types: %j', value => {
    expect(parseFieldInput('json', fieldInput(value, 'json'))).toEqual(value)
  })
  it('preserves nulls, strict booleans, numbers and JSON', () => {
    expect(parseFieldInput('number', '0')).toBe(0)
    expect(parseFieldInput('boolean', 'false')).toBe(false)
    expect(parseFieldInput('text', '')).toBeNull()
    expect(parseFieldInput('json', '{"a":1}')).toEqual({ a: 1 })
    expect(() => parseFieldInput('integer', '3.1')).toThrow()
  })
  it('quotes CSV data and neutralizes spreadsheet formulas', () => {
    expect(exportCsv([{ key: 'a', name: '=标题', type: 'text' }], [{ a: '=HYPERLINK("x")' }, { a: 'a,b' }])).toBe('"\'=标题"\r\n"\'=HYPERLINK(""x"")"\r\n"a,b"')
    expect(parseOptions('one:选项一\ntwo:选项二')).toEqual([{ key: 'one', name: '选项一' }, { key: 'two', name: '选项二' }])
  })
  it('hides own-only actions for another creator and anonymous rows', () => {
    const table = { viewerId: 'me', permissions: { update: 'own', delete: 'none' } } as import('@synapse/shared').CloudTableDto
    expect(canChangeRecord(table, { creatorUserId: 'me' } as never, 'update')).toBe(true)
    expect(canChangeRecord(table, { creatorUserId: 'other' } as never, 'update')).toBe(false)
    expect(canChangeRecord(table, { creatorUserId: null } as never, 'update')).toBe(false)
    expect(canChangeRecord(table, { creatorUserId: 'me' } as never, 'delete')).toBe(false)
  })
})
