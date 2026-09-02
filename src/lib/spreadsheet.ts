// Dependency-free CSV + XLSX readers (string[][] out, header row included).
// The XLSX reader parses just enough of the zip + OOXML XML by hand to read
// the first sheet — no zip64/encryption/streaming support, which covers
// what Excel, Google Sheets and LibreOffice actually produce.

export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r") {
      // swallow; the paired \n (or a lone \r on old Mac exports) ends the row
      if (text[i + 1] !== "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      }
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return match?.[1];
}

// --- Minimal zip reader -----------------------------------------------

interface ZipEntry {
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function readZipCentralDirectory(buf: ArrayBuffer): Map<string, ZipEntry> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const EOCD_SIG = 0x06054b50;

  let eocdOffset = -1;
  const searchStart = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= searchStart; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Not a valid .xlsx file (no zip end-of-directory record)");

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  const entries = new Map<string, ZipEntry>();
  let ptr = centralDirOffset;
  const CENTRAL_SIG = 0x02014b50;

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(ptr, true) !== CENTRAL_SIG) break;
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(bytes.slice(ptr + 46, ptr + 46 + nameLen));
    entries.set(name, { method, compressedSize, localHeaderOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  const out = await new Response(stream).arrayBuffer();
  return new Uint8Array(out);
}

async function readZipEntry(buf: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const LOCAL_SIG = 0x04034b50;

  if (view.getUint32(entry.localHeaderOffset, true) !== LOCAL_SIG) {
    throw new Error("Corrupt .xlsx file (bad local file header)");
  }
  const nameLen = view.getUint16(entry.localHeaderOffset + 26, true);
  const extraLen = view.getUint16(entry.localHeaderOffset + 28, true);
  const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
  const compressed = bytes.slice(dataStart, dataStart + entry.compressedSize);

  const raw = entry.method === 0 ? compressed : await inflateRaw(compressed);
  return new TextDecoder().decode(raw);
}

// --- Minimal OOXML spreadsheet extraction ------------------------------

function columnLetterToIndex(letters: string): number {
  let index = 0;
  for (const ch of letters) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siRe = /<si[^>]*>([\s\S]*?)<\/si>|<si[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    const body = m[1] ?? "";
    const parts: string[] = [];
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>|<t[^>]*\/>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(body))) parts.push(unescapeXml(tm[1] ?? ""));
    strings.push(parts.join(""));
  }
  return strings;
}

function parseWorksheet(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(xml))) {
    const rowBody = rowMatch[1] ?? "";
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRe.exec(rowBody))) {
      const cellAttrs = cellMatch[1] ?? cellMatch[2] ?? "";
      const cellBody = cellMatch[3] ?? "";
      const ref = attr(`<c ${cellAttrs}`, "r");
      const type = attr(`<c ${cellAttrs}`, "t");
      const colIndex = ref ? columnLetterToIndex(ref.replace(/\d+$/, "")) : cells.length;

      let value = "";
      if (type === "inlineStr") {
        const tMatch = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cellBody);
        value = tMatch ? unescapeXml(tMatch[1] ?? "") : "";
      } else {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(cellBody);
        const raw = vMatch ? unescapeXml(vMatch[1] ?? "") : "";
        if (type === "s") {
          const idx = Number(raw);
          value = Number.isFinite(idx) ? (sharedStrings[idx] ?? "") : "";
        } else if (type === "b") {
          value = raw === "1" ? "TRUE" : "FALSE";
        } else {
          value = raw;
        }
      }

      while (cells.length < colIndex) cells.push("");
      cells[colIndex] = value;
    }

    rows.push(cells);
  }

  return rows;
}

export async function parseXlsxFirstSheet(buf: ArrayBuffer): Promise<string[][]> {
  const zip = readZipCentralDirectory(buf);

  const workbookEntry = zip.get("xl/workbook.xml");
  if (!workbookEntry) throw new Error("Not a valid .xlsx file (missing workbook.xml)");
  const workbookXml = await readZipEntry(buf, workbookEntry);

  const sheetTag = /<sheet\b[^>]*\/>/.exec(workbookXml)?.[0];
  if (!sheetTag) throw new Error("The workbook has no worksheets");
  const relId = attr(sheetTag, "r:id");

  let sheetPath = "xl/worksheets/sheet1.xml";
  const relsEntry = zip.get("xl/_rels/workbook.xml.rels");
  if (relId && relsEntry) {
    const relsXml = await readZipEntry(buf, relsEntry);
    const relRe = /<Relationship\b[^>]*\/>/g;
    let relMatch: RegExpExecArray | null;
    while ((relMatch = relRe.exec(relsXml))) {
      if (attr(relMatch[0], "Id") === relId) {
        const target = attr(relMatch[0], "Target");
        if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
        break;
      }
    }
  }

  const sheetEntry = zip.get(sheetPath);
  if (!sheetEntry) throw new Error(`Could not find worksheet part "${sheetPath}" in the file`);
  const sheetXml = await readZipEntry(buf, sheetEntry);

  const sharedStringsEntry = zip.get("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsEntry
    ? parseSharedStrings(await readZipEntry(buf, sharedStringsEntry))
    : [];

  return parseWorksheet(sheetXml, sharedStrings).filter((r) => r.some((c) => c.trim() !== ""));
}

export async function parseSpreadsheetFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) {
    return parseXlsxFirstSheet(await file.arrayBuffer());
  }
  if (name.endsWith(".csv") || file.type === "text/csv") {
    return parseCsv(await file.text());
  }
  throw new Error("Unsupported file type — upload a .csv or .xlsx file");
}
