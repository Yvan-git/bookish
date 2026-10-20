# Bookish — personal book inventory

A complete, dependency-free system to inventory a private book collection:

| Piece | What it is | Where it runs |
|---|---|---|
| **`app/`** | The Android application (PWA) — scan, catalogue, locations, tags, statistics, settings | phone (installed) **and** desktop browser |
| **`app/simulator.html`** | A desktop "device lab" that runs the real app in a phone frame, with scan simulation, offline/latency switches and demo data | this machine, in a browser |
| **`laptop/`** | The "laptop workspace" — pull the inventory from Google Drive, filter, classify, audit the data, export XLSX/CSV | this machine, in a browser |
| **`shared/`** | Code used by both sides: the pure-JS XLSX writer and the SVG chart library | — |
| **`tools/`** | Static server, icon generator, test suites | — |

No build step, no npm, no framework, no server-side code. Open the files over
HTTP and they work.

> **Live now:** <https://yvan-git.github.io/bookish/app/index.html>
> (GitHub Pages — open it in Chrome on the phone and use ⋮ → *Add to Home
> screen* to install it. Deployment details: [docs/GITHUB_DEPLOY.md](docs/GITHUB_DEPLOY.md).)

---

## 1. Quick start

```powershell
# from the bookish/ folder
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

The server prints three URLs:

| URL | Purpose |
|---|---|
| <http://localhost:8080/app/index.html> | the application itself |
| <http://localhost:8080/app/simulator.html> | **the simulator** — the app in a phone frame, with fake scans |
| <http://localhost:8080/laptop/index.html> | the laptop workspace |
| <http://localhost:8080/tools/uitest.html> | the automated UI test page (open it in a browser to read the report) |

> The app **must** be served over `http://` or `https://` — `file://` blocks
> ES modules, the service worker and the camera API.

---

## 2. The simulator (test before installing on Android)

Open <http://localhost:8080/app/simulator.html>. You get a 390×844 phone frame
with the real application inside, and a control panel on the right:

* **ISBN samples** — six real books (Hemingway, Tournier, Szabó, Dahl…) plus a
  *"not found"* case. `Simuler un scan` navigates the app to the scan view and
  injects the ISBN exactly as a barcode reader would.
* **Custom ISBN** — test any code.
* **Hors ligne / Réseau lent** — force the app into offline mode (the API calls
  fail) or add a 1.5 s latency, to check that the manual entry path stays usable.
* **Zoom** — 75 % / 85 % / 100 % to check the responsive layout.
* **Jeu de démonstration** — injects 6 books, 4 locations and 6 tags.
* **Réinitialiser / Recharger / Exporter JSON** — wipe, reload, or dump the
  current inventory as JSON.

Everything the simulator does, the phone does too — the simulator only adds
the ability to *pretend* a barcode was scanned.

---

## 3. The three capture flows

### Flow 1 — barcode → ISBN → metadata (the main path)

1. Tap **Scanner** and either point the camera at the barcode or type the code
   into the numeric field (USB "douchette" scanners work as a keyboard).
2. The app normalises the code (ISBN-10 ⇄ ISBN-13, hyphenation).
3. It queries the **BnF catalogue** (`catalogue.bnf.fr/api/SRU`, index
   `bib.fuzzyIsbn`, UNIMARC records). If the BnF has nothing, it falls back to
   the **Google Books API**.
4. The metadata is shown as a **proposal** the user can edit before saving:
   title, subtitle, authors, publisher, year, pages, language, collection,
   Dewey number, ISBN.
5. The **location** is pre-filled with the last one used (or the default one
   set in the settings) and can be changed or created on the spot.
6. Optional **5-star rating**, **custom tags** and a free-text note.
7. Save.

If neither API answers, the app still opens the same form in manual mode —
the manual path never depends on a network or an API key.

#### Which barcode engine is used?

The scanner picks the best available decoder and shows it in a small badge at the
top of the camera overlay:

| Badge | Engine | Where |
|---|---|---|
| **Scan natif** | `BarcodeDetector` (built into the browser) | Android/Chrome, iOS 17+ Safari, macOS |
| **jsQR** | pure-JS decoder, vendored in `app/vendor/jsQR.js` | Windows / Linux desktops, any browser without `BarcodeDetector` |

The fallback is a full decoder, not a degraded mode: it reads the same
EAN-13 / EAN-8 / UPC-A / UPC-E / Code 128 codes, and it works **offline** since
the library is bundled rather than fetched from a CDN.

### Flow 2 — no barcode

Type the title (and optionally the author) in the *Manual* panel, then press
**Compléter via l'API** to enrich the record with the same BnF/Google lookup.
`Chercher` also does a title + author search on the BnF catalogue and proposes
the matching records.

### Flow 3 — full metadata

Every datapoint the APIs expose is stored: cover image (BnF `images.bnf.fr` or
Google Books), catalogue permalink, UNIMARC subjects, collection and volume,
Dewey classification, language, page count, publication place, series, etc.

---

## 4. Locations, tags, ratings

A location is a four-part path: **room → zone → shelf → position**, displayed
as `"Garage gauche, 1ère étagère droite"`.

* Created inline while saving a book ("+ Nouveau"), or managed in
  **Réglages → Emplacements**.
* The chip row in the proposal shows the most recent locations first, with a
  "more" chip that opens the full list.
* Tags have a free name and a category (*style*, *public*, or anything you
  like) — e.g. `Classique`, `Prix Goncourt`, `Jeunesse`, `Voyage`.
* Ratings are 0–5 stars, usable in the library filters and in the statistics.

---

## 5. Statistics

**Statistiques** shows:

* 6 key figures — total books, rooms, tags, average rating, unassigned books,
  books without a cover;
* books per room (bar chart);
* **Pareto of books per tag** — bars plus the cumulative-percentage curve;
* rating distribution (donut + legend);
* books per publication year;
* books per language;
* origin of the records (BnF / Google / manual);
* books per shelf.

All charts are hand-drawn SVG (no chart library) and re-draw on resize.

---

## 6. Search

The search bar in **Bibliothèque** filters on title, subtitle, authors,
publisher, ISBN, collection, Dewey, subjects, notes, year, tags and location.
It is **diacritic-insensitive**: `garcia` and `garcía` find *García Márquez*.
Filter chips narrow by room, tag, source, rating and "not yet located";
the sort dropdown orders by title, author, year, rating or date added.

---

## 7. Google Drive synchronisation

See **[docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md)** for the full procedure.

Short version:

1. Create a Google Cloud project, enable the **Google Books API** and create an
   API key (optional but removes the rate limits).
2. Create an **OAuth client ID of type "Web application"** — the same ID is
   used on the phone *and* on the laptop.
3. In **Réglages → Synchronisation Drive**, paste the client ID, enable
   auto-sync, optionally paste a Drive folder ID, then press **Synchroniser**.

Each sync uploads two files to your Drive:

* `<name>.xlsx` — the workbook (4 sheets: Livres, Emplacements, Étiquettes,
  Statistiques);
* `<name>.json` — a full-fidelity snapshot (used to re-import).

The file IDs are remembered, so later syncs update the same files instead of
creating new ones. Only files this app created are touched (`drive.file`
scope).

---

## 8. Laptop workspace

<http://localhost:8080/laptop/index.html> is where the inventory is *used*:

* **Connexion** — paste the same client ID, connect to Drive, list the
  inventory files and pull the latest one.
* **Tableau** — sortable, filterable table (10 columns) with room / tag /
  rating / source filters and full-text search.
* **Classification** — regroup the books by room, shelf, tag, author,
  publisher, year, language, rating or source; click a group to filter.
* **Qualité des données** — an audit that lists missing covers, missing
  ratings, unassigned locations, missing ISBN / publisher / year / tags, and
  duplicate ISBNs.
* **Statistiques** — the same charts, plus the pareto.
* **Exporter** — XLSX (same format as the phone) and CSV (UTF-8 with BOM,
  `;` separator — opens directly in a French Excel).

A JSON file exported from the phone can also be loaded directly
(*Charger un fichier .json*) without any Google account.

---

## 9. Install on Android

**Full guide: [docs/INSTALL_ANDROID.md](docs/INSTALL_ANDROID.md).**

### Already published

The app is live on GitHub Pages:

> **https://yvan-git.github.io/bookish/app/index.html**

Open that URL in Chrome on the phone → ⋮ menu → **Add to Home screen** /
**Install app**. That is the whole installation: no APK, no app store, no build
step. The camera works because the URL is `https://`.

Other pages on the same site:

| Page | URL |
|---|---|
| Application | `https://yvan-git.github.io/bookish/app/index.html` |
| Desktop simulator | `https://yvan-git.github.io/bookish/app/simulator.html` |
| Laptop workspace | `https://yvan-git.github.io/bookish/laptop/index.html` |
| Deployment guide | [docs/GITHUB_DEPLOY.md](docs/GITHUB_DEPLOY.md) |

### Publishing your own copy

```powershell
cd bookish
git add -A
git commit -m "Update"
git push                       # GitHub Pages rebuilds within ~1 minute
```

The repo is served "from a branch", so every push to `main` is a new deploy —
no build action, no workflow file.

### Short version without a repository

```powershell
# expose the folder over https (camera + service worker need a secure context)
winget install --id Cloudflare.cloudflared
powershell -ExecutionPolicy Bypass -File tools\tunnel.ps1
#    -> ADRESSE PUBLIQUE : https://xxxx.trycloudflare.com

# 2. on the phone: open  https://xxxx.trycloudflare.com/app/index.html
# 3. Chrome menu ⋮ -> "Add to Home screen" / "Install app"
# 4. allow the camera when it asks
```

Alternatives: any static host (Netlify Drop, Vercel, Cloudflare Pages — the
folder is 100 % static), ngrok, or `tools\serve.ps1 -Lan` for the local Wi-Fi
(everything works but the camera, which needs https).

> Installing the same URL as a bookmark is enough for daily use; "Add to home
> screen" is only needed for the standalone window and the offline cache.

---

## 10. Project layout

```
bookish/
├─ app/                     the Android application (PWA)
│  ├─ index.html            application shell
│  ├─ manifest.webmanifest  PWA manifest (standalone, icons, shortcuts)
│  ├─ simulator.html         desktop simulator / device lab
│  ├─ css/app.css            design system ("paper & spine" theme, light+dark)
│  ├─ icons/                 generated icons
│  └─ js/
│     ├─ app.js              bootstrap, hash router, theme, navigation
│     ├─ store.js            IndexedDB + in-memory mirror, locations, tags, books
│     ├─ apis.js             BnF SRU / UNIMARC, Google Books, ISBN helpers
│     ├─ drive.js            Google Identity Services + Drive upload/download
│     ├─ sync.js             auto-sync debounce, sync status
│     ├─ scanner.js          BarcodeDetector + jsQR fallback + camera
│     ├─ stats.js            statistics computation
│     ├─ strings.js          FR/EN dictionaries (215 keys each)
│     ├─ util.js             DOM helpers, icons, sheets, toasts
│     └─ views/              scan, library, stats, settings + shared widgets
├─ laptop/                  laptop workspace (table, classification, audit)
├─ shared/                  xlsx.js (XLSX writer) and charts.js (SVG charts)
├─ sw.js                    service worker (offline shell)
├─ tools/
│  ├─ serve.ps1             static server (no dependency, -Lan for the phone)
│  ├─ tunnel.ps1            https tunnel (Cloudflare / ngrok) for the phone
│  ├─ make-icons.ps1        icon generator (System.Drawing)
│  ├─ run-tests.ps1         runs the 5 test suites + i18n + responsive checks
│  ├─ cdp-run.ps1           DevTools-protocol driver used by the tests
│  ├─ i18n-check.ps1        translation coverage check
│  ├─ responsive-check.ps1  horizontal-overflow / navigation check
│  ├─ shots.ps1             screenshots of the main pages
│  ├─ selftest.html         unit & integration tests
│  ├─ uitest.html           end-to-end UI tests of the app
│  ├─ simtest.html          tests of the simulator
│  ├─ laptest.html          tests of the laptop workspace
│  └─ camtest.html          tests of the real camera scanner
├─ docs/
│  ├─ GOOGLE_SETUP.md       Google Cloud / Drive configuration
│  ├─ GITHUB_DEPLOY.md      publish on GitHub Pages, then install on Android
│  └─ INSTALL_ANDROID.md    how to put the app on an Android phone
└─ app/vendor/jsQR.js       offline barcode decoder (fallback for desktops)
```

---

## 11. Tests

```powershell
powershell -ExecutionPolicy Bypass -File tools\run-tests.ps1
```

The runner starts the static server if needed, then drives five pages in
headless Edge through the DevTools protocol:

| Suite | Coverage |
|---|---|
| `selftest` | ISBN conversions, XLSX bytes, live BnF UNIMARC parsing, full `lookupIsbn` pipeline, store initialisation |
| `uitest` | app boot, seeding, library rows, search (case/accent/ISBN/tag), statistics KPIs and charts, settings, scan view, simulated scan → BnF proposal, XLSX export, JSON snapshot |
| `simtest` | simulator boot, offline/latency switches, demo seeding, simulated scan, reset |
| `laptest` | table rendering, room/tag filters, search, sorting, classification, data-quality audit, charts, exports |
| `camtest` | the **real** camera: overlay opens, live video stream, decoding engine badge, local jsQR fallback, overlay closes |

The runner also checks the **translation coverage** and the **responsive layout**
(no horizontal overflow at 320 / 390 / 768 / 1024 / 1440 px, bottom bar on
phones and sidebar from 900 px).

Individual checks:

```powershell
powershell -ExecutionPolicy Bypass -File tools\i18n-check.ps1
powershell -ExecutionPolicy Bypass -File tools\responsive-check.ps1
powershell -ExecutionPolicy Bypass -File tools\shots.ps1        # PNG captures in _shots\
```

> The tests drive a real browser in real time. `--virtual-time-budget` is
> deliberately avoided: it advances virtual time instantly and starves the
> IndexedDB callbacks, which makes runs non-deterministic.

---

## 12. Design notes

* **"Paper & spine"** — warm paper background `#FAF7F2`, ink `#1A1614`, burgundy
  `#8C2F39` for actions, brass `#B98A44` for accents. Fraunces for titles,
  Inter for the interface. A full dark theme is included.
* Bottom navigation on phones, left sidebar from 900 px.
* No emoji in the interface — all icons are inline SVG drawn on a 24×24 grid.
* Every interactive element has a visible focus ring, a `cursor: pointer` and a
  150–250 ms colour transition.
* `prefers-reduced-motion` is honoured.

---

## 13. Privacy and what leaves the device

* The inventory lives in **IndexedDB** on the device. Nothing is sent anywhere
  unless you press *Synchroniser*.
* Metadata lookups send the **ISBN** to `catalogue.bnf.fr` and
  `www.googleapis.com` — that is all.
* Drive synchronisation uploads the workbook and the JSON snapshot to **your**
  Drive, with the `drive.file` scope: the app can only see and modify the files
  it created.
* No analytics, no telemetry, no third-party script. The only external
  resources are the Google Fonts stylesheet and the two catalogue APIs.

---

## 14. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| The app opens but the views are empty | The page was opened from `file://`. Use the local server. |
| "La caméra n'est pas disponible" | `https://` is required (or `localhost`). Also check the camera permission. |
| The scanner does not detect anything | The `BarcodeDetector` API is used when available and jsQR otherwise; jsQR is vendored in `app/vendor/jsQR.js`, so it works offline. |
| "Pas de lecteur natif sur ce navigateur" appears | Expected on a **Windows/Linux desktop**: Chrome does not implement `BarcodeDetector` there. Nothing is missing — the app has already switched to the bundled **jsQR** decoder and the camera keeps working. The badge at the top of the scanner shows which engine is active (`jsQR` here, `Scan natif` on Android). On Android, Chrome *does* implement the native API. |
| "Aucun résultat" for a French book | The BnF index is `bib.fuzzyIsbn`; some very recent or niche editions are not indexed yet. Google Books is used as a fallback, and manual entry always works. |
| Google Books returns 429 | No API key configured (or quota exhausted). Add one in **Réglages → Clés API**. Manual entry still works. |
| Drive sync fails | The OAuth client ID must be of type *Web application*, and the same ID must be used on the phone and on the laptop. See `docs/GOOGLE_SETUP.md`. |
| The camera works but the barcode is not read | Try the ISBN field with a "douchette", or type the code manually. |
| Changes are not visible in the app after a sync | The laptop workspace is read-only; the phone is the source of truth. |
