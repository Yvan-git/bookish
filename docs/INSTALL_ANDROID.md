# Installing Bookish on an Android phone

Bookish is a **Progressive Web App**: it is a web application that Chrome can
install on the home screen and then run full-screen, offline, like a native
app. There is no APK to build and no store to publish to.

> **Short version — it is already online.**
> Open **<https://yvan-git.github.io/bookish/app/index.html>** in Chrome on the
> phone, then menu ⋮ → **Add to Home screen** → **Install**. That is the whole
> installation, and the camera works because the address is `https://`.
>
> Full publication procedure, verification and troubleshooting:
> [GITHUB_DEPLOY.md](GITHUB_DEPLOY.md).

---

## 0. What you need

* An Android phone with **Chrome** (Chrome 90+ for the install prompt).
* The `bookish/` folder on the computer.
* A way to publish the folder behind an **https** address (see below) — or
  just use the GitHub Pages address above.

---

## 1. Why https and not the local Wi-Fi address?

The camera (`navigator.mediaDevices.getUserMedia`) and the service worker are
only allowed in a **secure context**: `https://…` or `http://localhost`.

`http://192.168.1.67:8080` is *not* a secure context, so over the plain local
network the app works (saisie manuelle, douchette, API, statistiques, Drive)
but **the camera stays disabled**.

Therefore, for the full experience, publish the folder behind https.

---

## 2. Publish the folder

### Option A — Cloudflare quick tunnel (recommended, free, no account)

```powershell
winget install --id Cloudflare.cloudflared
powershell -ExecutionPolicy Bypass -File tools\tunnel.ps1
```

The script starts the local server, opens the tunnel and prints something like:

```
  ADRESSE PUBLIQUE : https://some-random-words.trycloudflare.com
```

Open that address on the phone. The URL changes each time you restart the
tunnel, which is fine for testing. Keep the window open while you use the app.

### Option B — ngrok

```powershell
winget install --id ngrok.ngrok
ngrok config add-authtoken <votre-token>
powershell -ExecutionPolicy Bypass -File tools\tunnel.ps1
```

### Option C — static hosting (the folder is 100 % static)

Drag the `bookish/` folder onto <https://app.netlify.com/drop>, or push it to
a GitHub repository and enable **Pages**, or use Vercel:

```powershell
npx vercel --prod
```

This is the most durable option: the address never changes, the app stays
available offline, and you can update it by re-uploading.

> If you use a host that serves the folder at the **root** of a domain, the
> paths are `<domaine>/app/index.html`. If you deploy the *contents* of
> `app/` at the root instead, use `<domaine>/index.html` and
> `<domaine>/simulator.html` — but then the service worker (rooted at
> `bookish/`) and the shared modules need the whole `bookish/` tree, so
> **deploy the `bookish/` folder as-is**.

### Option D — local Wi-Fi (no camera)

```powershell
powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Lan
```

The server prints the reachable addresses (`http://192.168.x.x:8080`). The
phone must be on the same Wi-Fi network. Everything works except the camera.

---

## 3. Install on the phone

1. Open Chrome on the phone.
2. Go to **`<your https address>/app/index.html`**.
3. Chrome shows an *install* banner, or use the menu **⋮**:
   * **⋮ → "Add to Home screen"** (older Chrome)
   * **⋮ → "Install app"** (newer Chrome)
4. Confirm. The **Bookish** icon (burgundy, open book) appears on the home
   screen.
5. Open it: the app starts full-screen, without the browser toolbar, and
   works offline from then on.
6. The first time you scan, Chrome asks for the **camera** permission —
   answer **Allow**. (In the settings menu of the app, you can also enter an
   ISBN by hand or with a Bluetooth "douchette".)

### Verify the installation

* The window has **no address bar** → it is running as an installed app.
* Turn on airplane mode: the app still opens and shows your library (the
  service worker caches the shell).
* Metadata lookups obviously need a network; manual entry does not.

---

## 4. Scanning on the phone

* **Camera** — on Android, Chrome implements the native `BarcodeDetector`
  API, so the app uses it: scanning is fast and works in low light.
  *(On a Windows or Linux computer the native API does not exist, so the app
  falls back to the bundled **jsQR** decoder — slower but fully functional.
  The banner in the scanner says which one is running.)*
* **Bluetooth / USB keyboard scanner ("douchette")** — tap the numeric field
  in the Scanner tab; the scanner types the digits and presses Enter.
* **Manual** — type the title and author, then optionally complete the record
  with the BnF/Google lookup.

---

## 5. Google Drive on the phone

Follow **[GOOGLE_SETUP.md](GOOGLE_SETUP.md)**, then in the app:
*Réglages → Synchronisation Drive → Client ID OAuth → Connecter*.

Use **the same client ID** on the phone and on the laptop.

The first authorisation opens the Google consent screen in a popup; accept it.
After that, the app pushes a new `.xlsx` + `.json` to your Drive a few
seconds after each change.

---

## 6. Keeping the app up to date

The service worker caches the application shell. When you update the files on
the server, the new version is picked up the next time the app is opened
(usually after one restart). To force it:

* in the app: **⋮ → Settings → Clear site data**? — not needed, simply close
  and reopen the app twice, or
* on the phone: Chrome → the app's own settings → **Clear storage** (this also
  deletes the local inventory, so export a JSON first if you care).

To be safe when redeploying, bump the `VERSION` constant at the top of
`sw.js` (`bookish-v2` → `bookish-v3`): the service worker then replaces the
cached files instead of keeping the old ones.

---

## 7. Common problems

| Symptom | Cause | Fix |
|---|---|---|
| "Add to Home screen" is not offered | the address is not https, or the page was opened in a private tab | use the https tunnel / static host, and a normal tab |
| The install prompt does not appear | Chrome needs a visit to the page first | open the URL, wait a few seconds, then use the ⋮ menu |
| The camera does not start | the page is not a secure context, or the permission was denied | use https; then Chrome → site settings → Camera → Allow |
| The app shows the old version | the service worker still holds the previous cache | reopen the app twice, or bump `VERSION` in `sw.js` |
| The app is not offline-capable | the service worker could not register | the app must be served over https (or localhost) |
| A blank screen after installing | the folder was deployed without its `app/` sub-folder | deploy the whole `bookish/` tree |
