import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { cleanOffice, inspectOffice, resolveTarget, type OfficeCleanOptions } from "../office-inspect";
import { parseXml, serializeXml, transform } from "../xml-tree";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (list: string[]) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.join("")}</Relationships>`;
const pkg = (parts: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])));
const read = (bytes: Uint8Array, path: string) => {
  const part = unzipSync(bytes)[path];
  return part ? strFromU8(part) : null;
};

function docx() {
  return pkg({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="x"/><Override PartName="/word/comments.xml" ContentType="y"/><Override PartName="/docProps/core.xml" ContentType="z"/><Override PartName="/docProps/custom.xml" ContentType="c"/></Types>`,
    "_rels/.rels": rels([`<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>`, `<Relationship Id="rId2" Type="${REL}/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/>`]),
    "docProps/core.xml": `<?xml version="1.0"?><cp:coreProperties xmlns:cp="c" xmlns:dc="d" xmlns:dcterms="t"><dc:creator>Jane Doe</dc:creator><cp:lastModifiedBy>John Roe</cp:lastModifiedBy><dc:title>Offer &amp; terms</dc:title></cp:coreProperties>`,
    "docProps/app.xml": `<?xml version="1.0"?><Properties><Application>Microsoft Office Word</Application><Company>Acme Ltd</Company><TotalTime>42</TotalTime></Properties>`,
    "docProps/custom.xml": `<?xml version="1.0"?><Properties><property name="Client"><vt:lpwstr>Globex</vt:lpwstr></property></Properties>`,
    "docProps/thumbnail.jpeg": new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    "word/_rels/document.xml.rels": rels([`<Relationship Id="rId5" Type="${REL}/comments" Target="comments.xml"/>`, `<Relationship Id="rId6" Type="${REL}/hyperlink" Target="https://example.com/" TargetMode="External"/>`]),
    "word/_rels/settings.xml.rels": rels([`<Relationship Id="rId1" Type="${REL}/attachedTemplate" Target="file:///C:\\Users\\jdoe\\Templates\\Offer.dotm" TargetMode="External"/>`]),
    "word/settings.xml": `<?xml version="1.0"?><w:settings ${W}><w:attachedTemplate r:id="rId1"/><w:rsids><w:rsidRoot w:val="00A1"/></w:rsids><w:docVars><w:docVar w:name="Case" w:val="2026-17"/></w:docVars></w:settings>`,
    "word/comments.xml": `<?xml version="1.0"?><w:comments ${W}><w:comment w:id="0" w:author="Reviewer Ray"><w:p><w:r><w:t>Can we lower the price?</w:t></w:r></w:p></w:comment></w:comments>`,
    "word/document.xml": `<?xml version="1.0"?><w:document ${W}><w:body><w:p w:rsidR="00A1"><w:commentRangeStart w:id="0"/><w:r><w:t>Price: </w:t></w:r><w:del w:author="John Roe"><w:r><w:delText>900</w:delText></w:r></w:del><w:ins w:author="John Roe"><w:r><w:t>950</w:t></w:r></w:ins><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>internal floor 800</w:t></w:r></w:p></w:body></w:document>`,
  });
}

const ALL: OfficeCleanOptions = { properties: true, comments: true, trackedChanges: true, hiddenText: true, notes: true, extras: true };

describe("xml tree", () => {
  it("round-trips untouched and drops or unwraps elements", () => {
    const xml = '<?xml version="1.0"?><a x="1"><!-- c --><b>t &amp; u</b><c/><d><e>keep</e></d></a>';
    expect(serializeXml(parseXml(xml))).toBe(xml);
    expect(serializeXml(transform(parseXml(xml), (el) => (el.name === "b" ? "drop" : el.name === "d" ? "unwrap" : "keep")))).toBe('<?xml version="1.0"?><a x="1"><!-- c --><c/><e>keep</e></a>');
    expect(resolveTarget("word/", "../customXml/item1.xml")).toBe("customXml/item1.xml");
    expect(resolveTarget("xl/worksheets/", "/xl/comments1.xml")).toBe("xl/comments1.xml");
  });
});

describe("Word files", () => {
  it("finds people, comments, tracked changes, hidden text and a local template path", () => {
    const { kind, findings, removable } = inspectOffice(docx());
    expect(kind).toBe("word");
    const byId = Object.fromEntries(findings.map((f) => [f.id, f]));
    expect(byId.people.items).toEqual(["Jane Doe", "John Roe", "Reviewer Ray"]);
    expect(byId.properties.items).toEqual(expect.arrayContaining(["Author: Jane Doe", "Title: Offer & terms", "Company: Acme Ltd", "Editing time (minutes): 42", "Client: Globex"]));
    expect(byId.comments.items).toEqual(["Reviewer Ray: Can we lower the price?"]);
    expect(byId.tracked.items).toEqual(["Deleted: “900”"]);
    expect(byId["hidden-text"].items).toEqual(["internal floor 800"]);
    expect(byId.external.severity).toBe("high");
    expect(byId.external.items![0]).toContain("jdoe");
    expect(byId.hyperlinks.items).toEqual(["https://example.com/"]);
    expect(Object.keys(byId)).toEqual(expect.arrayContaining(["docvars", "rsids", "thumbnail"]));
    expect(Object.values(removable).every(Boolean) || removable.notes === false).toBe(true);
  });

  it("cleans them out and keeps the document's current text", () => {
    const clean = cleanOffice(docx(), ALL);
    const document = read(clean, "word/document.xml")!;
    expect(document).toContain("<w:t>Price: </w:t>");
    expect(document).toContain("<w:t>950</w:t>");
    expect(document).not.toMatch(/900|800|w:ins|w:del|comment|rsid/);
    expect(read(clean, "word/comments.xml")).toBeNull();
    expect(read(clean, "docProps/custom.xml")).toBeNull();
    expect(read(clean, "docProps/thumbnail.jpeg")).toBeNull();
    expect(read(clean, "word/_rels/document.xml.rels")).not.toContain("comments.xml");
    expect(read(clean, "word/_rels/document.xml.rels")).toContain("https://example.com/");
    expect(read(clean, "_rels/.rels")).not.toContain("thumbnail");
    expect(read(clean, "[Content_Types].xml")).not.toMatch(/comments|custom/);
    expect(read(clean, "word/settings.xml")).not.toMatch(/rsid|docVar|attachedTemplate/);
    expect(read(clean, "word/_rels/settings.xml.rels")).not.toContain("jdoe");
    expect(read(clean, "docProps/app.xml")).toBe("<?xml version=\"1.0\"?><Properties><Application>Microsoft Office Word</Application></Properties>");
    const after = inspectOffice(clean);
    expect(after.findings.map((f) => f.id)).toEqual(["hyperlinks", "app"]);
  });
});

describe("Excel and PowerPoint files", () => {
  it("finds hidden sheets, rows and comments; removes the comments", () => {
    const xlsx = pkg({
      "[Content_Types].xml": `<Types><Override PartName="/xl/comments1.xml" ContentType="c"/></Types>`,
      "xl/workbook.xml": `<workbook><sheets><sheet name="Summary" sheetId="1"/><sheet name="Salaries" sheetId="2" state="veryHidden"/></sheets></workbook>`,
      "xl/worksheets/sheet1.xml": `<worksheet><cols><col min="2" max="3" hidden="1"/></cols><sheetData><row r="4" hidden="1"/></sheetData><legacyDrawing r:id="rId2"/></worksheet>`,
      "xl/worksheets/_rels/sheet1.xml.rels": rels([`<Relationship Id="rId1" Type="${REL}/comments" Target="../comments1.xml"/>`, `<Relationship Id="rId2" Type="${REL}/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/>`]),
      "xl/comments1.xml": `<comments><authors><author>Ann Auditor</author></authors><commentList><comment ref="A1" authorId="0"><text><t>Check this total</t></text></comment></commentList></comments>`,
      "xl/drawings/vmlDrawing1.vml": "<xml/>",
    });
    const byId = Object.fromEntries(inspectOffice(xlsx).findings.map((f) => [f.id, f]));
    expect(byId["hidden-sheets"].items).toEqual(["Salaries (very hidden)"]);
    expect(byId["hidden-cells"].title).toBe("Hidden 1 row and 2 columns");
    expect(byId.people.items).toEqual(["Ann Auditor"]);
    expect(byId.comments.items).toEqual(["Check this total"]);
    const clean = cleanOffice(xlsx, ALL);
    expect(read(clean, "xl/comments1.xml")).toBeNull();
    expect(read(clean, "xl/drawings/vmlDrawing1.vml")).toBeNull();
    expect(read(clean, "xl/worksheets/sheet1.xml")).not.toContain("legacyDrawing");
    expect(read(clean, "xl/worksheets/_rels/sheet1.xml.rels")).not.toMatch(/comments|vml/);
  });

  it("finds speaker notes and hidden slides; removes the notes", () => {
    const pptx = pkg({
      "[Content_Types].xml": "<Types/>",
      "ppt/presentation.xml": "<p:presentation/>",
      "ppt/slides/slide1.xml": '<p:sld show="0"><p:cSld/></p:sld>',
      "ppt/slides/_rels/slide1.xml.rels": rels([`<Relationship Id="rId2" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide1.xml"/>`]),
      "ppt/notesSlides/notesSlide1.xml": "<p:notes><a:t>Don't mention the layoffs</a:t><a:t>1</a:t></p:notes>",
    });
    const byId = Object.fromEntries(inspectOffice(pptx).findings.map((f) => [f.id, f]));
    expect(byId.notes.items).toEqual(["Don't mention the layoffs 1"]);
    expect(byId["hidden-slides"].items).toEqual(["Slide 1"]);
    const clean = cleanOffice(pptx, ALL);
    expect(read(clean, "ppt/notesSlides/notesSlide1.xml")).toBeNull();
    expect(read(clean, "ppt/slides/_rels/slide1.xml.rels")).not.toContain("notesSlide");
  });

  it("refuses files that aren't Office Open XML", () => {
    expect(() => inspectOffice(new TextEncoder().encode("a,b\n1,2"))).toThrow(/\.docx, \.xlsx or \.pptx/);
    expect(() => inspectOffice(pkg({ "content.xml": "<x/>" }))).toThrow(/Only \.docx/);
  });
});
