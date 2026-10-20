/**
 * Metadata providers.
 *  - BnF catalogue (SRU, catalogue.bnf.fr) — primary source for French books.
 *  - Google Books API — fallback / English books / covers.
 * Both are CORS-enabled and work without any API key (Google Books simply has
 * a lower quota without one).
 */

const BNF_SRU = 'https://catalogue.bnf.fr/api/SRU';
const GOOGLE_BOOKS = 'https://www.googleapis.com/books/v1/volumes';

/* ----------------------------- ISBN utils ----------------------------- */

export function normalizeIsbn(raw) {
  return String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function isValidIsbn13(s) {
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(s[12]);
}

export function isValidIsbn10(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(s[i]) * (10 - i);
  // The check digit carries weight 1 (X counts as 11).
  sum += s[9] === 'X' ? 10 : Number(s[9]);
  return sum % 11 === 0;
}

export function isbn10to13(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return '';
  const core = '978' + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return core + check;
}

export function isbn13to10(s) {
  if (!/^978\d{10}$/.test(s)) return '';
  const core = s.slice(3, 12); // 9 digits + check digit
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
  const r = (11 - (sum % 11)) % 11;
  return core + (r === 10 ? 'X' : String(r));
}

/** Normalise any scanned/typed code into a validated ISBN-13 (or ''). */
export function toIsbn13(raw) {
  const s = normalizeIsbn(raw);
  if (!s) return '';
  if (s.length === 13 && isValidIsbn13(s)) return s;
  if (s.length === 10 && isValidIsbn10(s)) return isbn10to13(s);
  // A scanned EAN-13 that is not a book ISBN (prefix 290/294/380...) is still
  // returned so the user can fix it manually.
  if (s.length === 13) return s;
  if (s.length === 10) return isbn10to13(s);
  return '';
}

/** Human friendly ISBN display: 978-2-07-036251-6 */
export function prettyIsbn(s) {
  if (!s) return '';
  if (s.length === 13) return `${s.slice(0, 3)}-${s.slice(3, 4)}-${s.slice(4, 6)}-${s.slice(6, 12)}-${s.slice(12)}`;
  return s;
}

/* ------------------------------ fetching ------------------------------ */

async function fetchWithTimeout(url, { timeout = 12000, ...opts } = {}) {
  // Simulator hooks: the desktop simulator can force an outage or a slow
  // network to exercise the offline / error paths of the app.
  if (globalThis.__bookishOffline) throw new Error('offline-simulated');
  const latency = Number(globalThis.__bookishLatency || 0);
  if (latency) await new Promise((r) => setTimeout(r, latency));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------- BnF parsing ---------------------------- */

const LANG_MAP = {
  fre: 'fr', eng: 'en', fra: 'fr', ger: 'de', deu: 'de', spa: 'es', spa2: 'es',
  ita: 'it', rus: 'ru', por: 'pt', ned: 'nl', nld: 'nl', jpn: 'ja', chi: 'zh',
  ara: 'ar', heb: 'he', pol: 'pl', swe: 'sv', nor: 'no', dan: 'da', fin: 'fi',
  gre: 'el', ell: 'el', tur: 'tr', rum: 'ro', ron: 'ro', hun: 'hu', cze: 'cs',
  ces: 'cs', ukr: 'uk', vie: 'vi', ind: 'id', may: 'ms', tha: 'th', cat: 'ca',
  epo: 'eo', lat: 'la', gla: 'gd', bre: 'br', cor: 'kw', arm: 'hy', geo: 'ka',
};

/** Strip UNIMARC role suffixes: "Hemingway, Ernest (1899-1961). Auteur du texte" */
function cleanName(raw) {
  return String(raw || '')
    .replace(/\s*\([^)]*\)\.?/g, ' ')
    .replace(/\.\s*(Auteur|Ecrivain|Traducteur|Illustrateur|Photographe|Éditeur|Compilateur|Préface|Collaborateur)([^.]*)\.?\s*$/i, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[,;]\s*$/, '')
    .trim();
}

function firstTagElements(xmlDoc, tag) {
  const out = [];
  const byNs = xmlDoc.getElementsByTagNameNS('*', 'datafield');
  for (const df of byNs) {
    if (df.getAttribute('tag') === tag) out.push(df);
  }
  return out;
}

/** Collect subfield values of a datafield. */
function subfields(xmlDoc, tag, code) {
  const values = [];
  firstTagElements(xmlDoc, tag).forEach((df) => {
    const subs = df.getElementsByTagNameNS('*', 'subfield');
    for (const sf of subs) {
      if (sf.getAttribute('code') === code) {
        const v = (sf.textContent || '').trim();
        if (v) values.push(v);
      }
    }
  });
  return values;
}

const MARC_NS = 'http://www.loc.gov/MARC21/slim';

/**
 * The SRU payload declares the `mxc:` prefix on the response root, so the
 * isolated <recordData> fragment is not namespace-valid on its own. Re-declare
 * the namespace when it is missing, otherwise the XML parser fails.
 */
function ensureMarcNamespace(xmlText) {
  const text = String(xmlText || '');
  if (!text.includes(':')) return text;
  if (/xmlns:mxc\s*=/.test(text)) return text;
  return text.replace(/<(\w+:record)(\s|>)/, `<$1 xmlns:mxc="${MARC_NS}"$2`);
}

/**
 * Compose a personal name from UNIMARC 70x fields.
 * 700$a = surname, 700$b = first name (sometimes already merged in $a).
 */
function personNames(doc, tags, acceptedRoles) {
  const out = [];
  tags.forEach((tag) => {
    firstTagElements(doc, tag).forEach((df) => {
      const subs = df.getElementsByTagNameNS('*', 'subfield');
      let a = '';
      let b = '';
      let role = '';
      for (const sf of subs) {
        const code = sf.getAttribute('code');
        const value = (sf.textContent || '').trim();
        if (code === 'a') a = value;
        if (code === 'b') b = value;
        if (code === '4') role = value;
      }
      if (acceptedRoles && role && !acceptedRoles.includes(role)) return;
      if (!a && !b) return;
      let name = a;
      if (b && !a.includes(',')) name = `${a}, ${b}`;
      name = cleanName(name);
      if (name) out.push(name);
    });
  });
  return out;
}

/** Parse a BnF UNIMARC (marcxchange) record. */
export function parseBnfUnimarc(xmlText) {
  const doc = new DOMParser().parseFromString(ensureMarcNamespace(xmlText), 'application/xml');
  if (doc.querySelector('parsererror')) return null;

  // 200 — title / statement of responsibility
  const title = subfields(doc, '200', 'a')[0] || '';
  const statement = subfields(doc, '200', 'f')[0] || '';
  const translatorStatement = subfields(doc, '200', 'g')[0] || '';
  const medium = subfields(doc, '200', 'b')[0] || '';

  // 210 / 020 — publication
  const publisher = subfields(doc, '210', 'c')[0] || '';
  const place = subfields(doc, '210', 'a')[0] || '';
  const dateRaw = subfields(doc, '210', 'd')[0] || subfields(doc, '020', 'b')[0] || '';
  const year = (dateRaw.match(/(1[5-9]\d{2}|20\d{2})/) || [])[0] || '';
  const country = subfields(doc, '020', 'a')[0] || '';

  // 215 (or 300) — physical description
  const pagesRaw = subfields(doc, '215', 'a')[0] || subfields(doc, '300', 'a')[0] || '';
  const pages = (pagesRaw.match(/(\d+)\s*p/) || [])[1] || '';
  const illustration = subfields(doc, '215', 'c')[0] || subfields(doc, '300', 'c')[0] || '';
  const sizeRaw = subfields(doc, '215', 'd')[0] || subfields(doc, '300', 'd')[0] || '';

  // 225 / 330 — collection
  const collection = subfields(doc, '225', 'a')[0] || subfields(doc, '330', 'a')[0] || '';
  const collectionNumber = subfields(doc, '225', 'v')[0] || '';

  // 103 (Dewey) / 686 (cadre de classement BnF) / 606 (Dewey sujet)
  const dewey = subfields(doc, '103', 'a')[0] || '';
  const bnfClass = subfields(doc, '686', 'a')[0] || '';
  const deweySubject = subfields(doc, '606', 'a')[0] || '';
  const subjects = [
    ...subfields(doc, '610', 'a'),
    ...(deweySubject ? [deweySubject.split('/').slice(1).join('/').trim()] : []),
  ].map((s) => s.trim()).filter(Boolean);

  // 700 / 701 — authors (role 070) ; 702 — translators (role 730)
  const authors = personNames(doc, ['700', '701'], ['070', '070 ', '']);
  const translators = personNames(doc, ['702'], ['730', '730 ', '']);
  if (!authors.length && statement) {
    const cleaned = cleanName(statement);
    if (cleaned) authors.push(cleaned);
  }

  // 010 — ISBN (BnF stores the ISBN-10 form for most French books)
  const isbn = (subfields(doc, '010', 'a')[0] || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  const isbn10 = isbn.length === 10 ? isbn : '';
  const isbn13 = isbn.length === 13 ? isbn : (isbn10 ? isbn10to13(isbn10) : '');

  // 101 — language of the text / original language
  const languageCode = (subfields(doc, '101', 'a')[0] || '').toLowerCase();
  const originalLanguage = LANG_MAP[(subfields(doc, '101', 'c')[0] || '').toLowerCase()] || '';
  const language = LANG_MAP[languageCode] || languageCode.slice(0, 2);

  // Persistent identifier: controlfield 003 or the record id.
  const arkRaw = Array.from(doc.getElementsByTagNameNS('*', 'controlfield'))
    .find((c) => c.getAttribute('tag') === '003')?.textContent?.trim() || '';
  const recordId = doc.documentElement.getAttribute('id') || '';
  const identifier = ((arkRaw || recordId).match(/([A-Za-z0-9]+)\s*$/) || [])[1] || '';

  if (!title && !isbn) return null;

  return {
    source: 'bnf',
    title,
    subtitle: '',
    authors,
    translators,
    publisher,
    publicationPlace: place,
    year,
    pages,
    size: sizeRaw,
    illustration,
    collection: collectionNumber ? `${collection} n° ${collectionNumber}` : collection,
    dewey: dewey || bnfClass,
    classificationSystem: dewey ? 'Dewey' : (bnfClass ? 'BnF' : ''),
    subjects,
    language,
    originalLanguage,
    country,
    medium,
    isbn13,
    isbn10,
    catalogueUrl: identifier ? `https://catalogue.bnf.fr/ark:/12148/${identifier}` : '',
    coverUrl: identifier ? `https://images.bnf.fr/ark:/12148/${identifier}/f1.medres` : '',
    sourceId: identifier,
  };
}

/** Parse a BnF Dublin Core record (fallback when UNIMARC is unavailable). */
export function parseBnfDublinCore(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const values = (name) => Array.from(doc.getElementsByTagNameNS('*', name)).map((n) => (n.textContent || '').trim());
  const title = values('title')[0] || '';
  if (!title) return null;
  const creator = values('creator')[0] || '';
  const date = values('date')[0] || '';
  const format = values('format')[0] || '';
  const isbnRaw = values('identifier').find((v) => /ISBN/i.test(v)) || '';
  const isbn = isbnRaw.replace(/[^0-9Xx]/g, '').toUpperCase();
  const identifier = values('identifier').find((v) => /^http/.test(v)) || '';
  const arkId = (identifier.match(/([A-Za-z0-9]+)\s*$/) || [])[1] || '';
  return {
    source: 'bnf',
    title,
    subtitle: '',
    authors: creator ? [cleanName(creator)] : [],
    publisher: values('publisher')[0] || '',
    publicationPlace: '',
    year: (date.match(/(1[5-9]\d{2}|20\d{2})/) || [])[0] || '',
    pages: (format.match(/(\d+)\s*p/) || [])[1] || '',
    size: (format.match(/;\s*([^;]+cm)/) || [])[1]?.trim() || '',
    collection: values('description')[0] || '',
    dewey: '',
    subjects: [],
    language: LANG_MAP[(values('language')[0] || '').toLowerCase()] || '',
    isbn13: isbn.length === 13 ? isbn : (isbn.length === 10 ? isbn10to13(isbn) : ''),
    isbn10: isbn.length === 10 ? isbn : '',
    catalogueUrl: identifier || (arkId ? `https://catalogue.bnf.fr/ark:/12148/${arkId}` : ''),
    coverUrl: arkId ? `https://images.bnf.fr/ark:/12148/${arkId}/f1.medres` : '',
    sourceId: arkId,
  };
}

/** Query the BnF SRU endpoint. */
export async function bnfSearch({ isbn, title, author, limit = 10 } = {}) {
  const queries = [];
  if (isbn) {
    // "fuzzyIsbn" matches both the ISBN-10 and the EAN-13 form.
    queries.push(`bib.fuzzyIsbn all "${isbn}"`);
  }
  if (title) {
    const q = `bib.title all "${title.replace(/"/g, '')}"`;
    queries.push(author ? `${q} and bib.author all "${author.replace(/"/g, '')}"` : q);
  }
  if (!queries.length) return [];

  const items = [];
  for (const query of queries) {
    const url = `${BNF_SRU}?version=1.2&operation=searchRetrieve&query=${encodeURIComponent(query)}`
      + `&maximumRecords=${limit}&recordSchema=unimarcxchange`;
    let res;
    try {
      res = await fetchWithTimeout(url, { timeout: 15000, headers: { Accept: 'application/xml' } });
    } catch (err) {
      throw new Error(`bnf-network:${err.name}`);
    }
    if (!res.ok) throw new Error(`bnf-http:${res.status}`);
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const total = Number(
      (text.match(/<srw:numberOfRecords>(\d+)<\/srw:numberOfRecords>/) || [])[1] || 0,
    );
    const records = doc.getElementsByTagNameNS('*', 'record');
    const parsed = [];
    const serializer = new XMLSerializer();
    for (const rec of records) {
      const data = Array.from(rec.getElementsByTagNameNS('*', 'recordData'))[0];
      if (!data) continue;
      // Serialise the element (not textContent) so the namespace declaration
      // and the record id are preserved.
      const p = parseBnfUnimarc(serializer.serializeToString(data));
      if (p) parsed.push({ ...p, _schema: 'unimarc' });
    }
    if (!parsed.length) {
      // Fallback: Dublin Core (fewer fields, but always available).
      const dc = await fetchDublinCore(query, limit);
      dc.forEach((b) => parsed.push({ ...b, _schema: 'dublincore' }));
    }
    items.push(...parsed);
    if (parsed.length) break; // first successful query wins
  }
  return items;
}

/** Same query, Dublin Core schema — used as a safety net. */
async function fetchDublinCore(query, limit) {
  try {
    const url = `${BNF_SRU}?version=1.2&operation=searchRetrieve&query=${encodeURIComponent(query)}`
      + `&maximumRecords=${limit}&recordSchema=dublincore`;
    const res = await fetchWithTimeout(url, { timeout: 12000, headers: { Accept: 'application/xml' } });
    if (!res.ok) return [];
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const out = [];
    Array.from(doc.getElementsByTagNameNS('*', 'recordData')).forEach((node) => {
      const p = parseBnfDublinCore(new XMLSerializer().serializeToString(node));
      if (p) out.push(p);
    });
    return out;
  } catch (_) {
    return [];
  }
}

/* -------------------------- Google Books API -------------------------- */

function googleCover(item) {
  const id = item.id;
  if (!id) return '';
  const links = item.volumeInfo?.imageLinks || {};
  const thumb = links.thumbnail || links.smallThumbnail || links.medium || '';
  if (thumb) {
    return thumb
      .replace(/^http:/, 'https:')
      .replace(/&zoom=\d+/, '&zoom=1')
      .replace(/&edge=curl/, '')
      .replace(/^([^?]+)$/, '$1&fife=w400');
  }
  return `https://books.google.com/books/content?id=${encodeURIComponent(id)}&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api`;
}

export function parseGoogleVolume(item) {
  const vi = item.volumeInfo || {};
  const identifiers = vi.identifiers || [];
  const isbn13 = identifiers.find((i) => (i.type || '').toLowerCase() === 'isbn_13')?.identifier || '';
  const isbn10 = identifiers.find((i) => (i.type || '').toLowerCase() === 'isbn_10')?.identifier || '';
  return {
    source: 'google',
    title: vi.title || '',
    subtitle: vi.subtitle || '',
    authors: vi.authors || [],
    publisher: vi.publisher || '',
    publicationPlace: '',
    year: (String(vi.publishedDate || '').match(/\d{4}/) || [])[0] || '',
    pages: vi.pageCount ? String(vi.pageCount) : '',
    size: '',
    collection: vi.seriesInfo?.title || '',
    dewey: '',
    subjects: vi.categories || [],
    description: vi.description || '',
    language: (vi.language || '').slice(0, 2),
    isbn13: isbn13.replace(/[^0-9]/g, ''),
    isbn10: isbn10.replace(/[^0-9Xx]/g, '').toUpperCase(),
    catalogueUrl: vi.infoLink || '',
    coverUrl: googleCover(item),
    sourceId: item.id || '',
    googleId: item.id || '',
  };
}

/** Query Google Books. */
export async function googleBooksSearch({ isbn, title, author, apiKey, limit = 10 } = {}) {
  let q = '';
  if (isbn) q = `isbn:${isbn}`;
  else if (title) q = `intitle:${JSON.stringify(title)}${author ? ` inauthor:${JSON.stringify(author)}` : ''}`;
  else if (author) q = `inauthor:${JSON.stringify(author)}`;
  if (!q) return [];

  const url = `${GOOGLE_BOOKS}?q=${encodeURIComponent(q)}&maxResults=${limit}`
    + `&printType=books&fields=items(id,volumeInfo,accessInfo)`;
  const res = await fetchWithTimeout(apiKey ? `${url}&key=${encodeURIComponent(apiKey)}` : url, { timeout: 15000 });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`google-http:${res.status}${body ? ':' + body.slice(0, 120) : ''}`);
  }
  const json = await res.json();
  return (json.items || []).map(parseGoogleVolume).filter((b) => b.title);
}

/* --------------------------- combined lookup -------------------------- */

/**
 * Look up a book by ISBN: BnF first, then Google Books.
 * Returns { status: 'found' | 'notfound' | 'error', source, book, error }.
 */
export async function lookupIsbn(isbnRaw, { apiKey = '', timeout = 18000 } = {}) {
  const isbn13 = toIsbn13(isbnRaw);
  const clean = normalizeIsbn(isbnRaw);
  if (!clean) return { status: 'error', error: 'invalid-isbn' };

  // 1. BnF (primary for French books)
  try {
    const bnf = await bnfSearch({ isbn: clean, limit: 5 });
    if (bnf.length) {
      const best = pickBest(bnf, isbn13);
      return { status: 'found', source: 'bnf', book: best };
    }
  } catch (err) {
    console.warn('[bookish] BnF lookup failed', err);
  }

  // 2. Google Books (fallback)
  try {
    const gb = await googleBooksSearch({ isbn: clean, apiKey, limit: 5 });
    if (gb.length) {
      const best = pickBest(gb, isbn13);
      return { status: 'found', source: 'google', book: best };
    }
  } catch (err) {
    console.warn('[bookish] Google Books lookup failed', err);
    // A failing fallback API must not block manual entry.
    return { status: 'notfound', isbn13, warning: String(err.message || err) };
  }

  return { status: 'notfound', isbn13 };
}

/** Prefer the record whose ISBN matches exactly. */
function pickBest(list, isbn13) {
  if (!isbn13) return list[0];
  const exact = list.find((b) => b.isbn13 === isbn13 || b.isbn10 === isbn13 || isbn13to10(isbn13) === b.isbn10);
  return exact || list[0];
}

/**
 * Search the catalogue by title/author (used to complete a manual entry).
 * BnF is queried first, Google Books second.
 */
export async function searchCatalog({ title, author, apiKey = '' } = {}) {
  const out = [];
  try {
    const bnf = await bnfSearch({ title, author, limit: 8 });
    bnf.forEach((b) => out.push({ ...b, _provider: 'bnf' }));
  } catch (err) {
    console.warn('[bookish] BnF search failed', err);
  }
  if (out.length < 3) {
    try {
      const gb = await googleBooksSearch({ title, author, apiKey, limit: 8 });
      gb.forEach((b) => out.push({ ...b, _provider: 'google' }));
    } catch (err) {
      console.warn('[bookish] Google Books search failed', err);
    }
  }
  return out;
}

/** Verify a Google Books API key with a tiny query. */
export async function testGoogleApiKey(apiKey) {
  if (!apiKey) return { ok: false, message: 'empty' };
  try {
    const url = `${GOOGLE_BOOKS}?q=isbn:9782070362518&key=${encodeURIComponent(apiKey)}`;
    const res = await fetchWithTimeout(url, { timeout: 12000 });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let msg = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(body);
        msg = j?.error?.message || msg;
      } catch (_) { /* keep default */ }
      return { ok: false, message: msg };
    }
    const json = await res.json();
    return { ok: true, count: (json.items || []).length };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
}

/** Test the BnF endpoint reachability. */
export async function testBnf() {
  try {
    const res = await fetchWithTimeout(`${BNF_SRU}?version=1.2&operation=searchRetrieve&query=${encodeURIComponent('bib.fuzzyIsbn all "9782070362518"')}&maximumRecords=1&recordSchema=unimarcxchange`, { timeout: 12000 });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, message: String(err.message || err) };
  }
}

/** Small delay helper exported for the simulator. */
export { sleep };
