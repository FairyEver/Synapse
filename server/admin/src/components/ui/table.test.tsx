import * as React from "react"
import { describe, expect, it } from "vitest"

import { render } from "@/test/render"
import {
  Table,
  TableActionCell,
  TableActionHead,
  TableBody,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

describe("Table action column", () => {
  it("keeps action cells fixed to the right edge", async () => {
    const result = await render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableActionHead>操作</TableActionHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableActionCell>编辑</TableActionCell>
          </TableRow>
        </TableBody>
      </Table>,
    )

    expect(result.container.querySelector('[data-slot="table-head"]')?.className)
      .toContain("sticky right-0")
    expect(result.container.querySelector('[data-slot="table-cell"]')?.className)
      .toContain("sticky right-0")

    result.unmount()
  })
})
