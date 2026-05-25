import { describe, expect, it } from "vitest"

import { insertTextAtComposerSelection } from "../composer-insert"

describe("insertTextAtComposerSelection", () => {
  it("adds one separator when inserting after non-whitespace text", () => {
    expect(insertTextAtComposerSelection({
      draft: "foo",
      selectionStart: 3,
      selectionEnd: 3,
      text: "bar",
    })).toEqual({
      value: "foo bar",
      cursor: 7,
    })
  })

  it("does not duplicate leading whitespace from inserted text", () => {
    expect(insertTextAtComposerSelection({
      draft: "foo",
      selectionStart: 3,
      selectionEnd: 3,
      text: " bar",
    })).toEqual({
      value: "foo bar",
      cursor: 7,
    })
  })

  it("replaces the selected range", () => {
    expect(insertTextAtComposerSelection({
      draft: "foo baz",
      selectionStart: 4,
      selectionEnd: 7,
      text: "bar",
    })).toEqual({
      value: "foo bar",
      cursor: 7,
    })
  })
})
