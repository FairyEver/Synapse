import { Buffer } from 'node:buffer'

import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 组织管理 → 组织架构」页面。 */
export const HR_ORGANIZATION_CHART_PAGE_PATH = '/dashboard/org/org-setting/chart'
export const HR_ORGANIZATION_CHART_PERMISSION = '/dashboard/org/org-setting/chart'
export const HR_ORGANIZATION_CHART_MODULE_TYPE = 11

const ROOT = '/org/organization'
const EDIT_PATH = '/dashboard/org/org-setting/edit'

export type HrOrganizationChartId = string | number
export type HrOrganizationChartDirection = 'vertical' | 'horizontal'

export type HrOrganizationChartNode = Record<string, unknown> & {
  id: HrOrganizationChartId
  pid?: HrOrganizationChartId | 0 | '0' | null
  name?: string | null
  code?: string | null
  director?: string | null
  children: HrOrganizationChartNode[]
}

export type HrOrganizationChartFile = {
  fileName: string
  contentType: string
  base64: string
  byteLength: number
}

export type HrOrganizationChartEditRoute = {
  path: string
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): HrOrganizationChartId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或正整数字符串`)
  return value
}

function parentIdOf (value: unknown, label: string): HrOrganizationChartNode['pid'] {
  if (value === undefined || value === null || value === '') return null
  if (value === 0 || value === '0') return value
  return idOf(value, label)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function chartNodeOf (value: unknown, label: string): HrOrganizationChartNode {
  const node = objectOf(value, label)
  const children = node.children === undefined || node.children === null
    ? []
    : Array.isArray(node.children)
      ? node.children.map((child, index) => chartNodeOf(child, `${label}.children[${index}]`))
      : (() => { throw new Error(`${label}.children必须为数组或null`) })()
  const result: HrOrganizationChartNode = {
    ...node,
    id: idOf(node.id, `${label}.id`),
    children,
  }
  if (node.pid !== undefined) result.pid = parentIdOf(node.pid, `${label}.pid`)
  if (node.name !== undefined) result.name = nullableTextOf(node.name, `${label}.name`)
  if (node.code !== undefined) result.code = nullableTextOf(node.code, `${label}.code`)
  if (node.director !== undefined) result.director = nullableTextOf(node.director, `${label}.director`)
  return result
}

function chartTreeOf (value: unknown): HrOrganizationChartNode[] {
  if (!Array.isArray(value)) throw new Error('组织架构树响应必须是数组')
  return value.map((node, index) => chartNodeOf(node, `组织架构树[${index}]`))
}

function rootOf (value: unknown): HrOrganizationChartNode {
  return chartNodeOf(value, 'root')
}

function sanitizeFilename (value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  return value.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50)
}

function formatDateTime (date = new Date()): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`
}

function fileOf (content: string, fileName: string, contentType: string): HrOrganizationChartFile {
  const bytes = Buffer.from(content, 'utf8')
  if (bytes.byteLength === 0) throw new Error('组织架构导出内容为空')
  return {
    fileName,
    contentType,
    base64: bytes.toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function nodeName (node: HrOrganizationChartNode): string {
  return node.name || '未命名'
}

function sortedChildren (node: HrOrganizationChartNode): HrOrganizationChartNode[] {
  return [...node.children].sort((left, right) => nodeName(left).localeCompare(nodeName(right)))
}

function countNodes (node: HrOrganizationChartNode): number {
  return 1 + node.children.reduce((total, child) => total + countNodes(child), 0)
}

function maxDepth (node: HrOrganizationChartNode, depth = 0): number {
  return node.children.reduce((max, child) => Math.max(max, maxDepth(child, depth + 1)), depth)
}

function textContentOf (root: HrOrganizationChartNode): string {
  const lines = ['组织架构树', '='.repeat(50), '']
  function visit (node: HrOrganizationChartNode, level: number): void {
    let line = `${'  '.repeat(level)}${nodeName(node)}`
    if (node.director) line += ` (负责人: ${node.director})`
    if (node.code) line += ` [${node.code}]`
    lines.push(line)
    for (const child of sortedChildren(node)) visit(child, level + 1)
  }
  visit(root, 0)
  const now = new Date()
  lines.push('', '-'.repeat(50), '统计信息:', `  总节点数: ${countNodes(root)}`, `  最大层级: ${maxDepth(root) + 1}`, `  导出时间: ${now.toLocaleString('zh-CN')}`)
  return lines.join('\n')
}

type DrawNode = {
  data: HrOrganizationChartNode
  level: number
  parent: DrawNode | null
  children: DrawNode[]
  id: number
  x: number
  y: number
}

const DRAW_NODE_WIDTH = 180
const DRAW_NODE_HEIGHT = 100
const DRAW_LEVEL_GAP = 250
const DRAW_SIBLING_GAP = 300

function escapeXml (value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function drawLabelOf (node: HrOrganizationChartNode): string {
  let label = nodeName(node)
  if (node.director) label += `\n负责人：${node.director}`
  if (node.code) label += `\n编码：${node.code}`
  return label
}

function drawStyleOf (level: number): string {
  // These are the same semantic root/first-level/normal-level colors used by
  // Portal's Draw.io exporter; they are serialized into the file, not UI CSS.
  if (level === 0) return 'rounded=1;whiteSpace=wrap;html=1;fillColor=#FFF1F0;strokeColor=#FF4D4F;fontStyle=1;fontSize=14;fontColor=rgba(0, 0, 0, 0.85);'
  if (level === 1) return 'rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFBE6;strokeColor=#FFD666;fontSize=12;fontColor=rgba(0, 0, 0, 0.85);'
  return 'rounded=1;whiteSpace=wrap;html=1;fillColor=#E6F4FF;strokeColor=#4096FF;fontSize=12;fontColor=rgba(0, 0, 0, 0.85);'
}

function layoutDrawTree (root: HrOrganizationChartNode, direction: HrOrganizationChartDirection): DrawNode[] {
  let nextId = 1
  function make (data: HrOrganizationChartNode, level: number, parent: DrawNode | null): DrawNode {
    const current: DrawNode = { data, level, parent, children: [], id: nextId++, x: 0, y: 0 }
    current.children = data.children.map(child => make(child, level + 1, current))
    return current
  }
  const rootNode = make(root, 0, null)

  function extent (node: DrawNode): number {
    if (node.children.length === 0) return DRAW_SIBLING_GAP
    return Math.max(DRAW_SIBLING_GAP, node.children.reduce((total, child) => total + extent(child), 0))
  }
  function place (node: DrawNode, start: number): void {
    const size = extent(node)
    if (direction === 'vertical') {
      node.x = start + size / 2 - DRAW_NODE_WIDTH / 2
      node.y = 100 + node.level * DRAW_LEVEL_GAP
      let cursor = start
      for (const child of node.children) {
        const childSize = extent(child)
        place(child, cursor)
        cursor += childSize
      }
    } else {
      node.x = 100 + node.level * DRAW_LEVEL_GAP
      node.y = start + size / 2 - DRAW_NODE_HEIGHT / 2
      let cursor = start
      for (const child of node.children) {
        const childSize = extent(child)
        place(child, cursor)
        cursor += childSize
      }
    }
  }
  place(rootNode, 0)
  const nodes: DrawNode[] = []
  function flatten (node: DrawNode): void {
    nodes.push(node)
    node.children.forEach(flatten)
  }
  flatten(rootNode)
  return nodes
}

function drawXmlOf (root: HrOrganizationChartNode, direction: HrOrganizationChartDirection): string {
  const nodes = layoutDrawTree(root, direction)
  const edges = nodes.filter(node => node.parent).map((node, index) => ({ id: 1000 + index, source: node.parent!.id, target: node.id }))
  const maxX = Math.max(...nodes.map(node => node.x + DRAW_NODE_WIDTH)) + 200
  const maxY = Math.max(...nodes.map(node => node.y + DRAW_NODE_HEIGHT)) + 200
  const modified = new Date().toISOString()
  const etag = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  const diagramId = `org-chart-${Date.now()}`
  const body = nodes.map(node => `
        <mxCell id="node_${node.id}" value="${escapeXml(drawLabelOf(node.data))}" style="${drawStyleOf(node.level)}" vertex="1" parent="1">
          <mxGeometry x="${node.x}" y="${node.y}" width="${DRAW_NODE_WIDTH}" height="${DRAW_NODE_HEIGHT}" as="geometry" />
        </mxCell>`).join('')
  const edgeStyle = direction === 'horizontal'
    ? 'endArrow=classic;html=1;rounded=1;strokeWidth=2;strokeColor=#91CAFF;entryX=0;entryY=0.5;exitX=1;exitY=0.5;'
    : 'endArrow=classic;html=1;rounded=1;strokeWidth=2;strokeColor=#91CAFF;entryX=0.5;entryY=0;exitX=0.5;exitY=1;'
  const edgeXml = edges.map(edge => `
        <mxCell id="edge_${edge.id}" style="${edgeStyle}" edge="1" parent="1" source="node_${edge.source}" target="node_${edge.target}">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" modified="${modified}" agent="Organization Chart Exporter" version="24.7.17" etag="${etag}" type="device">
  <diagram name="组织架构图" id="${diagramId}">
    <mxGraphModel dx="${maxX}" dy="${maxY}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${maxX}" pageHeight="${maxY}" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />${body}${edgeXml}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`
}

function directionOf (value: unknown): HrOrganizationChartDirection {
  if (value === undefined || value === null || value === '') return 'vertical'
  if (value !== 'vertical' && value !== 'horizontal') throw new Error('direction只能是vertical或horizontal')
  return value
}

function exportTextFile (root: HrOrganizationChartNode): HrOrganizationChartFile {
  const date = new Date()
  return fileOf(textContentOf(root), `组织架构树_${sanitizeFilename(root.name, '组织架构树')}_${formatDateTime(date)}.txt`, 'text/plain;charset=utf-8')
}

function exportDrawIoFile (root: HrOrganizationChartNode, direction: HrOrganizationChartDirection): HrOrganizationChartFile {
  const date = new Date()
  const totalNodes = countNodes(root)
  const sizeText = totalNodes >= 500 ? '巨型' : totalNodes >= 100 ? '大型' : '标准'
  const directionText = direction === 'horizontal' ? '横向' : '纵向'
  return fileOf(drawXmlOf(root, direction), `组织架构图_${directionText}_${sizeText}(${totalNodes}节点)_紧凑型_${sanitizeFilename(root.name, '组织架构图')}_${formatDateTime(date)}.drawio`, 'application/xml;charset=utf-8')
}

export function createHrOrganizationChartCapability (request: PortalRequest) {
  return {
    async tree (): Promise<HrOrganizationChartNode[]> {
      return chartTreeOf(await request({ url: `${ROOT}/getRoleEnableOrganizationTree`, method: 'get' }))
    },

    exportText (input: { root: HrOrganizationChartNode }): HrOrganizationChartFile {
      return exportTextFile(rootOf(input?.root))
    },

    exportDrawIo (input: { root: HrOrganizationChartNode; direction?: HrOrganizationChartDirection }): HrOrganizationChartFile {
      const root = rootOf(input?.root)
      return exportDrawIoFile(root, directionOf(input?.direction))
    },

    prepareEdit (input: { id: HrOrganizationChartId }): HrOrganizationChartEditRoute {
      return { path: `${EDIT_PATH}/${idOf(input?.id, 'id')}` }
    },
  }
}

export type HrOrganizationChartCapability = ReturnType<typeof createHrOrganizationChartCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }) })

export const HR_ORGANIZATION_CHART_METHODS = {
  'hr-organization-chart-tree': 'tree',
  'hr-organization-chart-export-text': 'exportText',
  'hr-organization-chart-export-drawio': 'exportDrawIo',
  'hr-organization-chart-prepare-edit': 'prepareEdit',
} as const

export const hrOrganizationChartCapabilities: CapabilityDefinition[] = [
  { id: 'hr-organization-chart-tree', title: '查询有权限的启用组织架构树', write: false, params: [] },
  { id: 'hr-organization-chart-export-text', title: '导出组织架构纯文字树形文件', write: false, params: [p('root', 'tree', true, 'tree 返回的当前选中组织根节点；不要把组织名称代替节点对象')] },
  { id: 'hr-organization-chart-export-drawio', title: '导出组织架构 Draw.io 文件', write: false, params: [p('root', 'tree', true, 'tree 返回的当前选中组织根节点；不要把组织名称代替节点对象'), p('direction', 'enum', false, 'Draw.io 方向；vertical=纵向，horizontal=横向')] },
  { id: 'hr-organization-chart-prepare-edit', title: '准备打开组织编辑页', write: false, params: [p('id', 'search', true, '来自当前组织架构节点的组织 ID')] },
].map(definition => ({
  ...definition,
  pagePath: HR_ORGANIZATION_CHART_PAGE_PATH,
  permission: HR_ORGANIZATION_CHART_PERMISSION,
  moduleType: HR_ORGANIZATION_CHART_MODULE_TYPE,
  httpInstance: 'platform' as const,
}))
