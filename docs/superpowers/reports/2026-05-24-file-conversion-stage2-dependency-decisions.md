# File Conversion Stage 2 Dependency Decisions

Date: 2026-05-24

| Format | Dependency | Local-only | Native dependency | Fixture extraction result | Decision |
| --- | --- | --- | --- | --- | --- |
| PPTX | officeparser | Yes | Packaging risk to track: `officeparser 7.0.3` pulls `pdfjs-dist 5.6.205`, which pulls `@napi-rs/canvas 0.1.100`. | Pass: real `basic.pptx` fixture converted as `pptx` / `presentation`; extracted first-slide text `Quarterly Review Deck` and `Revenue expansion`, second-slide text `Renewal delay in APAC.`, and Markdown contained `# basic.pptx`. | Keep for now; revisit if extraction proves insufficient or packaging/native verification fails. |

## Notes

- The PPTX check only verifies text extraction from a generated local fixture.
- Slide boundaries remain limited by the parser output and are still represented by `presentation_structure_limited`.
- `officeparser` runs locally, but its dependency graph includes native package risk that must stay in Stage 2 packaging verification.
- This report does not claim image extraction or OCR support.
