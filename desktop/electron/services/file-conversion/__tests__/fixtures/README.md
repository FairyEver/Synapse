# File Conversion Fixtures

Stage 2 tests generate small synthetic binary files at runtime instead of storing user-like documents in the repository.

The generator lives in `build-fixtures.ts` and creates:

- DOCX files with headings, paragraphs, bullets, and a table.
- XLSX files with multiple sheets and wide-table data.
- A text PDF with two pages.
- A PPTX deck with two slides.
- Malformed files with Office/PDF extensions.

These fixtures are synthetic and contain no user data.
The generator dependencies are dev-only and must not be imported by production extractors.
