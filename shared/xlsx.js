/**
 * Dependency-free .xlsx writer.
 *
 * An .xlsx file is a ZIP archive of XML parts. This module implements:
 *   - CRC-32 (as required by the ZIP format)
 *   - a minimal ZIP writer using the STORE method (no compression) — Excel,
 *     LibreOffice and Numbers all open stored archives correctly
 *   - the SpreadsheetML parts: [Content_Types].xml, _rels, workbook, styles,
 *     worksheets (inline strings, so no sharedStrings part is needed).
 */

/* ------------------------------- CRC-32 ------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------ ZIP writer ---------------------------- */

const encoder = new TextEncoder();

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const day = (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

function u16(value) {
  return [value & 0xff, (value >>> 8) & 0xff];
}
function u32(value) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** Build a ZIP archive (STORE) from a list of { name, data: Uint8Array }. */
export function zipStore(files, date = new Date()) {
  const { time, day } = dosDateTime(date);
  const chunks = [];
  const central = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);

    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(time), ...u16(day), ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0),
    ];
    chunks.push(new Uint8Array(local), nameBytes, data);

    central.push({
      nameBytes, crc, size: data.length, offset,
    });
    offset += local.length + nameBytes.length + data.length;
  });

  const centralChunks = [];
  let centralSize = 0;
  central.forEach((entry) => {
    const header = [
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(time), ...u16(day), ...u32(entry.crc), ...u32(entry.size), ...u32(entry.size),
      ...u16(entry.nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(entry.offset),
    ];
    centralChunks.push(new Uint8Array(header), entry.nameBytes);
    centralSize += header.length + entry.nameBytes.length;
  });

  const end = [
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(central.length), ...u16(central.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ];

  return new Blob([...chunks, ...centralChunks, new Uint8Array(end)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/* ------------------------------- XML parts ---------------------------- */

function xesc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // strip control characters that are illegal in XML 1.0
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function colName(index) {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

const STYLE = {
  DEFAULT: 0,
  HEADER: 1,
  TEXT: 2,
  TITLE: 3,
  SUBTITLE: 4,
};

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="0"/>
<fonts count="4">
<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="11"/><color rgb="FF1A1614"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="16"/><color rgb="FF8C2F39"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF8C2F39"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF3EEE6"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFill="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellXml(ref, value, style) {
  const s = style ? ` s="${style}"` : '';
  if (value === null || value === undefined || value === '') return `<c r="${ref}"${s}/>`;
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xesc(value)}</t></is></c>`;
}

/**
 * Build a worksheet.
 * @param {{title?:string, subtitle?:string, columns:Array<{header:string,width:number,type?:string}>, rows:Array<Array<any>>}} spec
 */
function sheetXml(spec) {
  const columns = spec.columns || [];
  const rows = spec.rows || [];

  // The header row index depends on the optional title / subtitle rows.
  const headerRow = spec.title ? (spec.subtitle ? 3 : 2) : 1;

  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  parts.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
  // Freeze everything above the header row.
  parts.push(`<sheetViews><sheetView workbookViewId="0" showGridLines="0">`
    + `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>`
    + `</sheetView></sheetViews>`);
  parts.push('<sheetFormatPr defaultRowHeight="15"/>');
  if (columns.length) {
    parts.push('<cols>');
    columns.forEach((c, i) => {
      const width = Math.round((c.width || 14) * 1.05);
      parts.push(`<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`);
    });
    parts.push('</cols>');
  }
  parts.push('<sheetData>');

  let rowIndex = 1;
  if (spec.title) {
    parts.push(`<row r="1" ht="24" customHeight="1"><c r="A1" t="inlineStr" s="${STYLE.TITLE}"><is><t xml:space="preserve">${xesc(spec.title)}</t></is></c></row>`);
    rowIndex = 2;
    if (spec.subtitle) {
      parts.push(`<row r="2"><c r="A2" t="inlineStr" s="${STYLE.SUBTITLE}"><is><t xml:space="preserve">${xesc(spec.subtitle)}</t></is></c></row>`);
      rowIndex = 3;
    }
  }

  const headerCells = columns.map((c, i) => cellXml(`${colName(i)}${headerRow}`, c.header, STYLE.HEADER)).join('');
  parts.push(`<row r="${headerRow}" ht="22" customHeight="1">${headerCells}</row>`);

  rows.forEach((row, r) => {
    const rIdx = headerRow + 1 + r;
    const cells = row.map((value, i) => cellXml(`${colName(i)}${rIdx}`, value, STYLE.TEXT)).join('');
    parts.push(`<row r="${rIdx}">${cells}</row>`);
  });

  parts.push('</sheetData>');
  if (columns.length) {
    const lastCol = colName(columns.length - 1);
    parts.push(`<autoFilter ref="A${headerRow}:${lastCol}${headerRow + rows.length}"/>`);
  }
  parts.push('</worksheet>');
  return parts.join('');
}

function contentTypesXml(sheetCount) {
  const overrides = [];
  for (let i = 1; i <= sheetCount; i++) {
    overrides.push(`<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${overrides.join('\n')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function workbookXml(sheets) {
  const sheetTags = sheets.map((s, i) => `<sheet name="${xesc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<workbookPr/>
<sheets>${sheetTags}</sheets>
</workbook>`;
}

function workbookRelsXml(sheetCount) {
  const rels = [];
  for (let i = 1; i <= sheetCount; i++) {
    rels.push(`<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`);
  }
  rels.push(`<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('\n')}</Relationships>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

function corePropsXml(title) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xesc(title)}</dc:title>
<dc:creator>Bookish</dc:creator>
<cp:lastModifiedBy>Bookish</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function appPropsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>Bookish</Application></Properties>`;
}

/**
 * Build an .xlsx Blob from a list of sheet specs.
 * @param {Array<{name:string, columns:Array, rows:Array}>} sheets
 */
export function buildWorkbook(sheets, { title = 'Bookish inventory' } = {}) {
  const safe = sheets.map((s) => ({
    name: String(s.name || 'Sheet').replace(/[\\/*?:[\]]/g, ' ').slice(0, 31),
    columns: s.columns || [],
    rows: s.rows || [],
    title: s.title,
    subtitle: s.subtitle,
  }));
  const files = [
    { name: '[Content_Types].xml', data: encoder.encode(contentTypesXml(safe.length)) },
    { name: '_rels/.rels', data: encoder.encode(ROOT_RELS) },
    { name: 'docProps/core.xml', data: encoder.encode(corePropsXml(title)) },
    { name: 'docProps/app.xml', data: encoder.encode(appPropsXml()) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbookXml(safe)) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRelsXml(safe.length)) },
    { name: 'xl/styles.xml', data: encoder.encode(STYLES_XML) },
  ];
  safe.forEach((s, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: encoder.encode(sheetXml(s)) });
  });
  return zipStore(files);
}

/* --------------------------- domain workbook -------------------------- */

const BOOK_COLUMNS = [
  { header: 'Titre', width: 46 },
  { header: 'Sous-titre', width: 32 },
  { header: 'Auteurs', width: 32 },
  { header: 'ISBN-13', width: 16 },
  { header: 'ISBN-10', width: 14 },
  { header: 'Éditeur', width: 26 },
  { header: 'Année', width: 9 },
  { header: 'Langue', width: 9 },
  { header: 'Pages', width: 8 },
  { header: 'Collection', width: 26 },
  { header: 'Dewey', width: 10 },
  { header: 'Thèmes', width: 26 },
  { header: 'Pièce', width: 16 },
  { header: 'Zone', width: 14 },
  { header: 'Étagère', width: 16 },
  { header: 'Position', width: 16 },
  { header: 'Emplacement', width: 34 },
  { header: 'Note', width: 7 },
  { header: 'Étiquettes', width: 26 },
  { header: 'Emprunté', width: 10 },
  { header: 'Source', width: 14 },
  { header: 'Couverture', width: 40 },
  { header: 'Notice catalogue', width: 38 },
  { header: 'Résumé', width: 60 },
  { header: 'Notes', width: 36 },
  { header: 'Ajouté le', width: 12 },
  { header: 'Modifié le', width: 12 },
];

const iso = (v) => (v ? String(v).slice(0, 10) : '');

/**
 * Build the inventory workbook: Books / Locations / Tags / Statistics.
 * @param {{books:Array, locations:Array, tags:Array, stats:Object}} data
 */
export function buildInventoryWorkbook(data) {
  const { books = [], locations = [], tags = [], stats = {} } = data || {};
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const locById = new Map(locations.map((l) => [l.id, l]));

  const bookRows = books.map((b) => {
    const loc = locById.get(b.locationId) || {};
    return [
      b.title || '', b.subtitle || '', (b.authors || []).join(' ; '),
      b.isbn13 || '', b.isbn10 || '', b.publisher || '', b.year || '', b.language || '',
      b.pages || '', b.collection || '', b.dewey || '', (b.subjects || []).join(' ; '),
      loc.room || '', loc.zone || '', loc.shelf || '', loc.position || '',
      loc.label || '', b.rating || 0,
      (b.tagIds || []).map((id) => tagById.get(id)?.name || '').filter(Boolean).join(' ; '),
      b.borrowed ? 'oui' : 'non', b.source || '',
      b.coverUrl || '', b.catalogueUrl || '', b.description || '', b.notes || '',
      iso(b.addedAt), iso(b.updatedAt),
    ];
  });

  const locationRows = locations.map((l) => [l.room || '', l.zone || '', l.shelf || '', l.position || '', l.label || '', l.note || '', iso(l.createdAt)]);

  const tagRows = tags.map((t) => {
    const count = books.filter((b) => (b.tagIds || []).includes(t.id)).length;
    return [t.name || '', t.category || '', count];
  });

  const statRows = Object.entries(stats || {}).map(([k, v]) => [k, typeof v === 'number' ? v : String(v)]);

  return buildWorkbook([
    {
      name: 'Livres',
      title: 'Inventaire des livres',
      subtitle: `${books.length} livre(s) — export Bookish`,
      columns: BOOK_COLUMNS,
      rows: bookRows,
    },
    {
      name: 'Emplacements',
      title: 'Emplacements',
      columns: [
        { header: 'Pièce', width: 18 }, { header: 'Zone', width: 16 },
        { header: 'Étagère', width: 18 }, { header: 'Position', width: 18 },
        { header: 'Étiquette complète', width: 36 }, { header: 'Note', width: 30 },
        { header: 'Créé le', width: 12 },
      ],
      rows: locationRows,
    },
    {
      name: 'Étiquettes',
      title: 'Étiquettes',
      columns: [
        { header: 'Étiquette', width: 26 }, { header: 'Catégorie', width: 18 }, { header: 'Nombre de livres', width: 16 },
      ],
      rows: tagRows,
    },
    {
      name: 'Statistiques',
      title: 'Statistiques',
      columns: [{ header: 'Indicateur', width: 34 }, { header: 'Valeur', width: 18 }],
      rows: statRows,
    },
  ], { title: 'Bookish — Inventaire' });
}
