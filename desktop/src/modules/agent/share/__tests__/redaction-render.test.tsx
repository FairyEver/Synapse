/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server"
import { Streamdown } from "streamdown"
import { expect, it } from "vitest"
import { redactShareText } from "../redaction"

it.each(["test&#64;example.com", "test&#x40;example&#46;com", "test\\@example.com", "test&plus;@example.com", "test&amp;@example.com"])("does not expose encoded email after the real Markdown renderer decodes %s", (email) => {
  const html = renderToStaticMarkup(<Streamdown mode="static">{redactShareText(`联系 ${email}`, true)}</Streamdown>)
  expect(html).not.toContain("@example.com"); expect(html).toContain("［邮箱已隐藏］")
})
