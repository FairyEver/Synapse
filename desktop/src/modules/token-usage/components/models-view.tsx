import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatTokens, formatCost, formatCacheRatio } from "../lib/format"
import { getProviderColor } from "../lib/colors"
import { useSort } from "../hooks/use-sort"
import { SortableHeader } from "./sortable-header"
import type { ModelRow } from "../hooks/use-token-usage"
import { useMemo } from "react"

interface ModelsViewProps {
  models: ModelRow[]
}

interface ModelSortRow extends ModelRow {
  total: number
  cacheHitRate: number
}

export function ModelsView({ models }: ModelsViewProps) {
  const rows = useMemo(() => models.map((m) => {
    const paid = m.input + m.cacheWrite
    return {
      ...m,
      total: m.input + m.output + m.cacheRead + m.cacheWrite + m.reasoning,
      cacheHitRate: paid > 0 ? m.cacheRead / paid : 0,
    }
  }), [models])

  const { sorted, sortKey, sortDir, toggleSort } = useSort<ModelSortRow>(rows, "cost", "desc")
  const hasReasoning = rows.some((r) => r.reasoning > 0)

  if (models.length === 0) {
    return (
      <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
        暂无模型数据
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHeader<ModelSortRow> label="#" sortKey="total" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="w-8" />
          <SortableHeader<ModelSortRow> label="模型" sortKey="model" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} />
          <SortableHeader<ModelSortRow> label="供应商" sortKey="provider" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} />
          <SortableHeader<ModelSortRow> label="来源" sortKey="client" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} />
          <SortableHeader<ModelSortRow> label="输入" sortKey="input" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<ModelSortRow> label="输出" sortKey="output" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<ModelSortRow> label="缓存读" sortKey="cacheRead" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<ModelSortRow> label="缓存写" sortKey="cacheWrite" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<ModelSortRow> label="缓存率" sortKey="cacheHitRate" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          {hasReasoning && <SortableHeader<ModelSortRow> label="推理" sortKey="reasoning" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />}
          <SortableHeader<ModelSortRow> label="合计" sortKey="total" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<ModelSortRow> label="费用" sortKey="cost" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((m, i) => (
          <TableRow key={`${m.client}-${m.model}-${m.provider}`}>
            <TableCell className="text-muted-foreground">{i + 1}</TableCell>
            <TableCell className="font-medium">{m.model}</TableCell>
            <TableCell>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getProviderColor(m.provider) }} />
                {m.provider}
              </span>
            </TableCell>
            <TableCell className="text-muted-foreground">{m.client}</TableCell>
            <TableCell className="text-right">{formatTokens(m.input)}</TableCell>
            <TableCell className="text-right">{formatTokens(m.output)}</TableCell>
            <TableCell className="text-right">{formatTokens(m.cacheRead)}</TableCell>
            <TableCell className="text-right">{formatTokens(m.cacheWrite)}</TableCell>
            <TableCell className="text-right">{formatCacheRatio(m.cacheRead, m.input, m.cacheWrite)}</TableCell>
            {hasReasoning && <TableCell className="text-right">{formatTokens(m.reasoning)}</TableCell>}
            <TableCell className="text-right font-medium">{formatTokens(m.total)}</TableCell>
            <TableCell className="text-right">{formatCost(m.cost)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
