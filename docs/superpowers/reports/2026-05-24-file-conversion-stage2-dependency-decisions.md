# File Conversion Stage 2 Dependency Decisions

Date: 2026-05-24

| Format | Dependency | Local-only | Native dependency | Fixture extraction result | Decision |
| --- | --- | --- | --- | --- | --- |
| PPTX | officeparser | Yes | No known native runtime dependency from this package itself. | Pass: real `basic.pptx` fixture converted as `pptx` / `presentation`; extracted `Quarterly Review Deck` and `Revenue expansion`; Markdown contained `# basic.pptx`. | Keep for now; revisit if extraction proves insufficient. |

## Notes

- The PPTX check only verifies text extraction from a generated local fixture.
- Slide boundaries remain limited by the parser output and are still represented by `presentation_structure_limited`.
- This report does not claim image extraction or OCR support.
