# Déployer sur GitHub Pages puis installer sur Android

Ce document décrit la procédure complète, de la machine Windows jusqu'à l'écran
d'accueil du téléphone.

> Version courte : le code est **déjà en ligne** sur
> **https://yvan-git.github.io/bookish/app/index.html**
> Ouvrir cette adresse dans Chrome sur le téléphone, puis menu ⋮ → **Ajouter à
> l'écran d'accueil**. Rien d'autre à faire.

---

## 1. Pourquoi GitHub Pages

Deux contraintes régissent le déploiement :

| Contrainte | Conséquence |
|---|---|
| La caméra (`getUserMedia`) exige un **contexte sécurisé** | l'URL doit être en `https://` (ou `localhost`) |
| Le **service worker** exige `https://` ou `localhost` | pas de cache hors ligne ni de mode hors ligne en `http://` |

Un téléphone qui ouvre `http://192.168.x.x:8080` chargerait l'application mais
**sans caméra ni mode hors ligne** — donc inutilisable pour scanner. GitHub
Pages fournit un `https://` gratuit, permanent et stable.

Le dossier est 100 % statique (HTML, CSS, JS, PNG). Aucun build, aucun bundler,
aucune dépendance : GitHub sert les fichiers tels quels.

---

## 2. Préparer le dépôt local

Le dépôt Git est déjà initialisé dans le dossier `bookish/`.

```powershell
cd bookish

# identité de commit (déjà configurée pour ce dépôt)
git config user.name  "Yvan-git"
git config user.email "ymdavoust@gmail.com"

# branche principale (GitHub Pages utilise `main`)
git branch -m master main      # une seule fois

# vérifier l'état
git status
git log --oneline -3
```

### Ce qui est versionné, et ce qui ne l'est pas

`.gitignore` exclut les artefacts de travail :

```
_shots/          captures d'écran des tests
*.xlsx           classeurs exportés
*.log / *.err    journaux du serveur local
tools/_*         fichiers de travail temporaires
```

**Aucun secret n'est versionné.** Les clés API ne sont jamais écrites dans le
code : elles sont saisies dans l'écran *Réglages* et stockées dans le
`localStorage` du navigateur, sur l'appareil uniquement. Le dépôt ne contient
que du code source (47 fichiers).

---

## 3. Créer le dépôt et pousser

Deux méthodes : l'interface web de GitHub, ou la ligne de commande.

### 3.a — Ligne de commande (GitHub CLI)

`gh` est installé et déjà authentifié sur cette machine.

```powershell
# créer le dépôt et pousser en une commande
gh repo create bookish --public `
    --description "Personal book inventory PWA" `
    --source . --remote origin --push

# vérifier
git remote -v
gh repo view --web
```

### 3.b — Interface web

1. <https://github.com/new> → nom `bookish` → **Public** (obligatoire pour
   GitHub Pages sur un compte gratuit) → *Create repository*.
2. Dans le dossier local :

```powershell
git remote add origin git@github.com:Yvan-git/bookish.git
git push -u origin main
```

> SSH est déjà configuré (clé `id_ed25519` présente, `gh` authenticate en
> mode SSH). Pour passer en HTTPS :
> `git remote set-url origin https://github.com/Yvan-git/bookish.git`

### 3.c — Pousser une mise à jour plus tard

```powershell
cd bookish
git add -A
git commit -m "Ajout de la page statistiques"
git push
```

GitHub Pages redéploie automatiquement (~30 à 60 s). Rien à configurer.

---

## 4. Activer GitHub Pages

**Par l'interface web :**

1. `https://github.com/Yvan-git/bookish` → onglet **Settings** → **Pages**
2. *Build and deployment* → Source : **Deploy from a branch**
3. Branch : **main**, Folder : **/ (root)** → **Save**

**Par la ligne de commande :**

```powershell
gh api -X POST repos/Yvan-git/bookish/pages `
    -f 'source[branch]=main' -f 'source[path]=/'
```

**Suivre le déploiement :**

```powershell
gh api repos/Yvan-git/bookish/pages/builds/latest
```

Statut `built` = en ligne.

---

## 5. Vérifier la mise en ligne

```powershell
# la page d'accueil répond
curl -s -o NUL -w "%{http_code}`n" https://yvan-git.github.io/bookish/app/index.html

# le manifeste est servi
curl -s -o NUL -w "%{http_code}`n" https://yvan-git.github.io/bookish/app/manifest.webmanifest

# le décodeur jsQR est bien embarqué
curl -s -o NUL -w "%{http_code}`n" https://yvan-git.github.io/bookish/app/vendor/jsQR.js
```

Tous doivent répondre `200`.

---

## 6. Installer sur le téléphone Android

### 6.1 — Ouvrir l'application

Sur le téléphone, ouvrir **Chrome** et aller sur :

```
https://yvan-git.github.io/bookish/app/index.html
```

### 6.2 — Installer comme application

| Étape | Action | Résultat |
|---|---|---|
| 1 | Menu **⋮** (en haut à droite) | menu Chrome |
| 2 | **Ajouter à l'écran d'accueil** (ou *Installer l'application*) | dialogue de confirmation |
| 3 | **Installer** | icône « Bookish » ajoutée |
| 4 | Lancer l'icône | l'application s'ouvre **en plein écran**, sans barre d'adresse |

> Sur les versions récentes de Chrome, le menu peut proposer directement
> **« Installer l'application »** (avec une icône de téléchargement) au lieu de
> « Ajouter à l'écran d'accueil ». Les deux font la même chose.

### 6.3 — Autoriser la caméra

À la première ouverture du scanner, Android demande l'autorisation :

> **« Bookish souhaite utiliser l'appareil photo »** → **Autoriser**

Si la demande a été refusée :

```
Chrome ⋮ → Paramètres → Paramètres du site → Appareil photo → Autoriser
```

ou

```
Android → Paramètres → Applications → Bookish → Autorisations → Appareil photo → Autoriser
```

### 6.4 — Vérifier le moteur de scan

Ouvrir **Scanner** et regarder la pastille en haut à gauche de l'aperçu :

| Pastille | Signification |
|---|---|
| **Scan natif** | `BarcodeDetector` de Chrome Android — le plus rapide |
| **jsQR** | décodeur de secours en JavaScript — fonctionne aussi |

Les deux décodent les mêmes codes (EAN-13, EAN-8, UPC-A, UPC-E, Code 128).
Sur un Android récent, attendez-vous à **Scan natif**.

### 6.5 — Premier lancement

1. L'application démarre sur l'écran *Bibliothèque*, vide.
2. Aller dans **Réglages** et renseigner :
   - la **clé API Google Books** (facultative — l'application fonctionne sans),
   - le **client ID OAuth** de type *Application Web* (requis uniquement pour la
     synchronisation Google Drive, cf. `GOOGLE_SETUP.md`).
3. Revenir dans **Scanner** et scanner un code-barres.

---

## 7. Après l'installation

| Ce que vous voulez | Comment |
|---|---|
| **Mettre à jour l'app** | `git push` → attendre ~1 min → rouvrir l'app |
| **Forcer la mise à jour** | Chrome ⋮ → *Paramètres* → *Effacer les données du site* |
| **Travailler hors ligne** | automatique : le service worker a mis l'application en cache au premier lancement |
| **Réinstaller proprement** | Android → *Paramètres* → *Applications* → *Bookish* → *Désinstaller* |

> Les données (livres, emplacements, étiquettes) sont dans l'`IndexedDB` du
> navigateur : elles restent sur le téléphone. Effacer les données du site les
> supprime — synchronizez vers Drive avant, si vous utilisez cette option.

---

## 8. Si vous préférez garder le dépôt privé

GitHub Pages exige un dépôt **public** sur un compte gratuit. Deux solutions :

1. **Déployer le dépôt privé ailleurs** — Netlify, Vercel ou Cloudflare Pages
   acceptent un dépôt privé et donnent une URL `https://` :

   ```powershell
   # Netlify
   npx netlify deploy --dir . --prod

   # Cloudflare Pages (via le dashboard, en connectant le dépôt GitHub)
   # Vercel
   npx vercel --prod
   ```

2. **Conserver un dépôt public "site" séparé** contenant uniquement le front,
   si le code doit rester secret.

Aucun changement de code n'est nécessaire : le projet fonctionne à l'identique
sous n'importe quel préfixe d'URL, car **tous les chemins sont relatifs**
(`./js/app.js`, `../sw.js`, `new URL(..., import.meta.url)`).

---

## 9. Récapitulatif

```powershell
cd bookish
git add -A
git commit -m "Update"
git push
```

Puis, sur le téléphone : ouvrir
`https://yvan-git.github.io/bookish/app/index.html` → ⋮ → **Ajouter à l'écran
d'accueil** → **Installer** → autoriser la caméra.
