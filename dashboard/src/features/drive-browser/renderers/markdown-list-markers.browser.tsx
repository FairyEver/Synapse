import '@/styles/index.css'
import 'github-markdown-css/github-markdown-light.css'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DRIVE_HIERARCHICAL_LIST_MARKER_CLASSNAME,
  syncDriveHierarchicalListMarkers,
} from './drive-hierarchical-list-markers'

let root: HTMLElement | null = null

afterEach(() => {
  root?.remove()
  root = null
})

describe('drive markdown list markers in Chromium', () => {
  it('renders hierarchical ordered markers at every nesting level', () => {
    root = document.createElement('main')
    root.className = `markdown-body [&_ol]:list-decimal! ${DRIVE_HIERARCHICAL_LIST_MARKER_CLASSNAME}`
    root.innerHTML = '<ol><li>一级一</li><li>一级二<ol><li>二级一</li><li>二级二<ol><li>三级一</li></ol></li></ol></li><li>一级三</li></ol>'
    document.body.append(root)
    syncDriveHierarchicalListMarkers(root)

    const items = Array.from(root.querySelectorAll('ol > li'))
    expect(items.map((item) => item.getAttribute('data-drive-list-marker'))).toEqual([
      '1.',
      '2.',
      '2.1',
      '2.2',
      '2.2.1',
      '3.',
    ])
    expect(items.map((item) => getComputedStyle(item, '::marker').content)).toEqual([
      '"1. "',
      '"2. "',
      '"2.1 "',
      '"2.2 "',
      '"2.2.1 "',
      '"3. "',
    ])
  })
})
