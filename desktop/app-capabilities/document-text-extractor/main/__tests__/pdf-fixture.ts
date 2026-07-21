export function createPdfFixture(pageTexts: readonly string[]): Buffer {
  if (pageTexts.length === 0) throw new Error("A PDF fixture needs at least one page")

  const fontObjectNumber = 3 + pageTexts.length * 2
  const pageObjectNumbers = pageTexts.map((_text, index) => 3 + index * 2)
  const objects = new Map<number, Buffer>()
  objects.set(1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"))
  objects.set(2, Buffer.from(
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pageTexts.length} >>`,
    "ascii",
  ))

  pageTexts.forEach((text, index) => {
    const pageObjectNumber = pageObjectNumbers[index]!
    const contentObjectNumber = pageObjectNumber + 1
    const lines = text.split("\n")
    const textOperations = lines
      .map((line, lineIndex) => `${lineIndex === 0 ? "" : "0 -14 Td "}(${escapePdfString(line)}) Tj`)
      .join(" ")
    const content = Buffer.from(
      text.length === 0 ? "BT ET" : `BT /F1 12 Tf 72 720 Td ${textOperations} ET`,
      "utf8",
    )
    objects.set(pageObjectNumber, Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
      "ascii",
    ))
    objects.set(contentObjectNumber, Buffer.concat([
      Buffer.from(`<< /Length ${content.byteLength} >>\nstream\n`, "ascii"),
      content,
      Buffer.from("\nendstream", "ascii"),
    ]))
  })
  objects.set(fontObjectNumber, Buffer.from(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "ascii",
  ))

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "ascii")]
  const offsets: number[] = [0]
  let offset = chunks[0]!.byteLength
  for (let objectNumber = 1; objectNumber <= fontObjectNumber; objectNumber++) {
    const object = objects.get(objectNumber)
    if (!object) throw new Error(`Missing PDF fixture object ${objectNumber}`)
    offsets[objectNumber] = offset
    const chunk = Buffer.concat([
      Buffer.from(`${objectNumber} 0 obj\n`, "ascii"),
      object,
      Buffer.from("\nendobj\n", "ascii"),
    ])
    chunks.push(chunk)
    offset += chunk.byteLength
  }

  const xrefOffset = offset
  const xref = [
    `xref\n0 ${fontObjectNumber + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n `),
    `trailer\n<< /Size ${fontObjectNumber + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}`,
    "%%EOF",
    "",
  ].join("\n")
  chunks.push(Buffer.from(xref, "ascii"))
  return Buffer.concat(chunks)
}

function escapePdfString(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll("\0", "\\000")
}
