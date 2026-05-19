import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { RangePicker } from "../shared/components/range-picker"

describe("RangePicker", () => {
  it("renders the usage range options", () => {
    const html = renderToStaticMarkup(<RangePicker value="30d" onChange={() => undefined} />)
    expect(html).toContain("7 天")
    expect(html).toContain("30 天")
    expect(html).toContain("90 天")
    expect(html).toContain("全部")
  })
})
