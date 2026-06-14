/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest"

import { isContentImagePasteTarget } from "../content-appearance-fields"

describe("content appearance image paste scope", () => {
  it("only handles paste events that originate inside the image field", () => {
    const imageField = document.createElement("div")
    const imageButton = document.createElement("button")
    const bodyEditor = document.createElement("textarea")
    imageField.appendChild(imageButton)
    document.body.append(imageField, bodyEditor)

    expect(isContentImagePasteTarget(imageButton, imageField)).toBe(true)
    expect(isContentImagePasteTarget(bodyEditor, imageField)).toBe(false)
    expect(isContentImagePasteTarget(null, imageField)).toBe(false)
  })
})
