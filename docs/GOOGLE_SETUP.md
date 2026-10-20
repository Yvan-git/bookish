# Google setup — Books API key and Drive synchronisation

Two independent things are configured in Google Cloud:

| What | Needed for | Required? |
|---|---|---|
| **Google Books API key** | faster, unthrottled metadata lookups | optional — the app works without it, manual entry always works |
| **OAuth client ID (Web application)** | Google Drive synchronisation between the phone and the laptop | required only for Drive sync |

---

## 1. Create the project

1. Open <https://console.cloud.google.com/>.
2. Click the project picker (top left) → **New project**.
3. Name it `Bookish` (anything) → **Create**.
4. Make sure the new project is selected in the picker.

---

## 2. Google Books API key (optional but recommended)

1. In the console, go to **APIs & Services → Library**.
2. Search for **Google Books API** → open it → **Enable**.
3. **APIs & Services → Credentials** → **Create credentials → API key**.
4. Copy the key (it looks like `AIza…`).
5. *(Recommended)* Click the key → **Edit**:
   * **Application restrictions → HTTP referrers (web sites)**:
     `http://localhost:8080/*`, and the address you will use for the phone
     (`https://your-host/*`).
   * **API restrictions → Restrict key → Google Books API**.

**Without a key** the Books API still answers, but from a shared quota:
expect `HTTP 429` after a few dozen lookups. When that happens the app falls
back to the BnF catalogue and, failing that, leaves the form in manual mode —
nothing is lost.

### Where to paste it

**Réglages (Settings) → Clés API → Google Books API** in the phone app. The key
is stored in the app's local database (IndexedDB, collection *settings*, field
`googleBooksApiKey`) — never sent anywhere else. Use the *Tester* button next
to the field to check the key immediately.

---

## 3. OAuth client ID for Google Drive

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. **Application type: _Web application_**.
   *This matters*: the app uses the *Google Identity Services* token client
   (`gapi.auth.initTokenClient`), which only works with a client ID of type
   "Web application". "Android" or "Desktop app" client IDs are rejected with
   `invalid_client`.
3. **Name**: `Bookish`.
4. **Authorized JavaScript origins** — add every origin where the app or the
   laptop workspace will run:

   ```
   http://localhost:8080
   https://your-host.example
   ```

   * No trailing slash.
   * The origin only — no path, no `/*`.
   * If you will use a Cloudflare tunnel, add the tunnel hostname too
     (it changes every time you restart the tunnel, unless you use a named
     tunnel).
5. **Create** → copy the **Client ID** (`…apps.googleusercontent.com`).
   The client secret is **not** needed and is not used by the app.
6. Press **Download JSON** if you want a backup of the credentials.

### Where to paste it

* **Phone** — *Réglages → Synchronisation Drive → Client ID OAuth*.
* **Laptop** — the *Client ID* field at the top of
  <http://localhost:8080/laptop/index.html>.

> **Use the same client ID on both sides.** The phone uploads the file, the
> laptop downloads it; they must live in the same OAuth project, otherwise the
> `drive.file` scope granted on one side will not expose the files created by
> the other. The laptop page keeps the client ID in `localStorage`
> (`bookish.clientId`), so you only type it once.

---

## 4. Drive scope

The app requests exactly one scope:

```
https://www.googleapis.com/auth/drive.file
```

It is **not** `.../auth/drive` — the app can only see and modify the files it
created itself. It cannot read your other Drive files, and it cannot delete
anything it did not upload.

The access token is held **in memory only** (never written to disk) and expires
after about one hour. The app asks for a new one automatically when needed, and
the *Synchroniser* button can always request a fresh interactive authorisation.
Only the *client ID* is remembered, in `localStorage` under `bookish.clientId`
(laptop page) and in the app's local database (phone).

---

## 5. Drive folder (optional)

By default the files are created in the root of your Drive. To put them in a
dedicated folder:

1. Create the folder in Drive (e.g. `Livres`).
2. Copy the folder ID from its URL:
   `https://drive.google.com/drive/folders/`**`1AbC…xYz`**
3. Paste it into *Réglages → Synchronisation Drive → ID de dossier Drive*.

---

## 6. What is synchronised

Each sync uploads two files to your Drive:

| File | Content |
|---|---|
| `books-inventory.xlsx` | the workbook: **Livres**, **Emplacements**, **Étiquettes**, **Statistiques** |
| `books-inventory.json` | the full-fidelity snapshot (used by the laptop workspace and for re-import) |

The file IDs are stored in the app settings, so subsequent syncs **update the
same files** instead of creating new ones. The file name is configurable
(*Réglages → Synchronisation Drive → Nom du fichier*).

Auto-sync is enabled by default: any change is pushed 4 seconds after you stop
typing, and a manual *Synchroniser maintenant* is always available.

---

## 7. End-to-end check

1. On the phone (or in the simulator), open *Réglages → Synchronisation Drive*.
2. Paste the client ID, press **Connecter / Synchroniser**, and accept the
   Google consent screen.
3. You should see *Dernière synchronisation : …*.
4. Open <http://localhost:8080/laptop/index.html>, paste the **same** client
   ID, press **Connecter**, then **Télécharger**.
5. The table fills with your books; the *Qualité des données* panel shows what
   is still missing.

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `Error 400: invalid_request` / `origin_mismatch` | The origin used by the page is not in *Authorized JavaScript origins*. Add it exactly (scheme + host + optional port, no path). |
| `Error 401: invalid_client` | The client ID is not of type **Web application**, or it was copied with surrounding spaces. |
| `Popup closed by user` | The consent window was dismissed. Press the button again and accept. |
| `access_denied` | The account has no Drive, or the consent was refused. Check <https://myaccount.google.com/permissions>. |
| `HTTP 429` on metadata lookups | No API key, or the quota is exhausted. Add a Books API key (§2) and check the restrictions. |
| `HTTP 403 insufficientPermissions` on Drive | The token was granted to a *different* client ID. Use the same client ID on both sides, and make sure the Drive API is enabled in the project. |
| The files are not in my Drive | Check *Drive → Shared with me / Bin*; the app creates them in the account used for the consent. |
| The laptop sees no file | The phone must have synced at least once, and both sides must use the same client ID. |
| `Failed to fetch` in the console | The page is not served over `http(s)://`, or a browser extension blocks the request to `drive.google.com`. |
