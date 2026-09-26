import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const generatorUrl = new URL('../tools/generate/generate.mjs', import.meta.url).href
const { readMenuEntries } = await import(generatorUrl) as {
  readMenuEntries: (source: string) => Array<{ text: string; lineIndex: number }>
}

describe('页面清单的菜单对象解析', () => {
  it('跨行字段属于同一个菜单，父菜单不会读到子菜单字段', () => {
    const entries = readMenuEntries(`[
      { title: '父组', children: [
        {
          title: '待办事项',
          path: '/dashboard/backlog/task-examine/list',
          permission: '/dashboard/backlog/task-examine'
        },
        { path: '/dashboard/other/list', title: '另一页' }
      ] }
    ]`)
    expect(entries).toHaveLength(2)
    expect(entries[0]?.text).toContain("title: '待办事项'")
    expect(entries[0]?.text).toContain("permission: '/dashboard/backlog/task-examine'")
    expect(entries[0]?.text).not.toContain('父组')
    expect(entries[0]?.text).not.toContain('另一页')
  })

  it('import、辅助函数和注释不是页面；字符串中的括号与 URL 不截断对象', () => {
    const entries = readMenuEntries(`import { iframeLinkGeneratorNormal } from 'menu.js'
      function wrap(path) { return iframeLinkGeneratorNormal(path) }
      // { path: '/commented/list', title: '已删除' }
      /* { path: '/block-comment/list' } */
      const menus = [
        { path: iframeLinkGeneratorNormal('https://example.com/{id}'), title: '内嵌', permission: '/frame' },
        { path: '/real/list', title: '包含 } 和 \\' 的标题' }
      ]`)
    expect(entries).toHaveLength(2)
    expect(entries[0]?.lineIndex).toBe(5)
    expect(entries[0]?.text).toContain("permission: '/frame'")
    expect(entries[1]?.text).toContain("path: '/real/list'")
  })

  it('入库清单保留真实多行菜单的标题和权限，不包含伪 iframe', () => {
    const catalog = JSON.parse(readFileSync(new URL('../generated/page-catalog.json', import.meta.url), 'utf8')) as {
      items: Array<{ menuPath: string | null; title: string; permission: string }>
    }
    for (const [menuPath, title, permission] of [
      ['/dashboard/backlog/task-examine/list', '待办事项', '/dashboard/backlog/task-examine'],
      ['/dashboard/model-usage/list', '个人用量', '/dashboard/model-usage'],
      ['/dashboard/technology/setting/project-type/list', '项目类型', '/dashboard/technology/setting/project-type'],
      ['/dashboard/technology/setting/template/list', '模板中心', '/dashboard/technology/setting/template'],
    ]) {
      expect(catalog.items.find((item) => item.menuPath === menuPath)).toMatchObject({ title, permission })
    }
    expect(catalog.items.filter((item) => item.title === '(未命名 iframe)')).toEqual([])
  })
})
