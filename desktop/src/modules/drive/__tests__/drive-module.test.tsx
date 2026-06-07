import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DriveModule } from "../index"

describe("DriveModule", () => {
  it("renders the cloud drive toolbar actions", () => {
    const html = renderToStaticMarkup(<DriveModule />)

    expect(html).toContain("云盘")
    expect(html).toContain("上传文件")
    expect(html).toContain("上传文件夹")
    expect(html).toContain("新建文件夹")
    expect(html).toContain("刷新")
  })
})
