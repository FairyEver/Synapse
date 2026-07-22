import PizZip from "pizzip"

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const PACKAGE_RELATIONSHIPS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

export function createDocxFixture(
  bodyXml: string,
  options: { readonly includeMainDocument?: boolean } = {},
): Buffer {
  const zip = new PizZip()
  zip.file("[Content_Types].xml", CONTENT_TYPES_XML)
  zip.folder("_rels")?.file(".rels", PACKAGE_RELATIONSHIPS_XML)
  if (options.includeMainDocument !== false) {
    zip.folder("word")?.file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:v="urn:schemas-microsoft-com:vml"
>
  <w:body>
    ${bodyXml}
    <w:sectPr/>
  </w:body>
</w:document>`)
  }
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" })
}

export function textParagraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
}
