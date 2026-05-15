import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { TaskCardGrid } from "../task-card-grid"

const noopTaskHandler = vi.fn()

describe("TaskCardGrid", () => {
  it("disables the empty-state create action while scheduler UI is busy", () => {
    const html = renderToStaticMarkup(
      <TaskCardGrid
        tasks={[]}
        projects={[]}
        providers={[]}
        busy
        onRun={noopTaskHandler}
        onStop={noopTaskHandler}
        onToggleEnabled={noopTaskHandler}
        onEdit={noopTaskHandler}
        onHistory={noopTaskHandler}
        onDelete={noopTaskHandler}
        onCreateNew={noopTaskHandler}
      />,
    )

    expect(html).toContain(">新建任务</button>")
    expect(html).toContain("disabled=\"\"")
  })
})
