# Sniper - Contesto applicazione

## Overview
App web per il controllo parcheggi condominiali. Gli utenti fotografano veicoli in sosta irregolare, attendono un tempo minimo, poi confermano con una seconda foto. Admin e consiglieri gestiscono utenti, inviti e infrazioni.

- **Stack**: Node.js + Express + SQLite (better-sqlite3) + vanilla JS frontend
- **Versione**: 0.1.0
- **Repo**: https://github.com/egidiocasati/sniper
- **Dominio**: sniper.vialeteodorico7.it
- **Hosting**: Oracle Cloud Infrastructure (OCI), eu-milan-1

## Struttura progetto

```
sniper/
├── server.js                    # Entry point Express, HTTPS, routes
├── package.json                 # Dependencies e scripts (start, dev)
├── src/
│   ├── config.js                # Env vars → config object
│   ├── db.js                    # Schema SQLite, migrazioni, WAL mode
│   ├── middleware/
│   │   ├── auth.js              # requireAuth()
│   │   ├── admin.js             # requireAdmin(), requireAdminOrCouncilor()
│   │   ├── csrf.js              # Token CSRF (header X-CSRF-Token)
│   │   ├── rateLimit.js         # 10 req/15min su login e forgot-password
│   │   └── upload.js            # Multer: JPEG/PNG/WebP, max 5MB, UUID filename
│   ├── routes/
│   │   ├── auth.js              # Login, register, forgot/reset password, /me
│   │   ├── admin.js             # Utenti, inviti, settings, foto admin, report PDF
│   │   ├── photos.js            # Upload, lista, dettaglio, conferma
│   │   └── pages.js             # Serve HTML statiche
│   └── services/
│       ├── email.js             # Nodemailer (SMTP Gmail), inviti e reset
│       └── scheduler.js         # Auto-scarto foto PENDING ogni 5 min
├── public/
│   ├── css/style.css            # Glassmorphism dark, font Inter
│   ├── js/
│   │   ├── app.js               # Init app, auth check, CSRF, settings
│   │   ├── camera.js            # getUserMedia, start/stop/capture/upload
│   │   ├── photos.js            # Lista foto, filtri, countdown, modal dettaglio
│   │   └── admin.js             # Panel admin: settings, utenti, inviti, foto
│   └── pages/
│       ├── app.html             # App principale (mobile-first)
│       ├── login.html           # Login + registrazione + forgot password
│       ├── admin.html           # Dashboard admin
│       ├── reset-password.html  # Reset password con token
│       ├── privacy.html         # Privacy policy GDPR
│       ├── terms.html           # Termini e condizioni
│       └── cookies.html         # Cookie policy
├── scripts/deploy/
│   ├── env.sh                   # Config OCI (region, shape, domain, port)
│   ├── state.env                # Stato deployment (VCN_ID, VM_IP, ecc.)
│   ├── cloud-init.sh            # Bootstrap VM: swap, Node.js 20, dirs
│   ├── 01_provision_network.sh  # VCN, IGW, route table, NSG, subnet
│   ├── 02_provision_vm.sh       # Launch VM OCI (E2.1.Micro)
│   ├── 03_bootstrap_vm.sh       # Rsync, npm install, .env, systemd, iptables
│   └── remote_setup.sh          # Setup alternativo (nginx, certbot)
├── data/                        # SQLite DB + sessions (git-ignored)
├── uploads/                     # Foto caricate (git-ignored)
├── ssl/                         # Certificati HTTPS (git-ignored)
└── security/                    # Chiavi SSH utenti (git-ignored)
```

## Database (SQLite WAL)

### Tabelle
- **users**: id, email (unique), password (bcrypt), name, role (admin|user|councilor), active, created_at
- **invites**: id, email, token (UUID), invited_by (FK users), used, created_at, expires_at (48h)
- **password_resets**: id, user_id (FK), token (UUID), used, created_at, expires_at (1h)
- **photos**: id, uuid, user_id (FK), filename, status (PENDING|INFRAZIONE|SCARTO), notes, server_ts, parent_id (FK self), confirmed_photo_id (FK self), confirmed_at, archived
- **settings**: key (PK), value — app_subtitle, confirmation_min_minutes (30), pending_timeout_minutes (240), countdown_enabled (true)

## API endpoints

### Auth (`/api/auth`)
- `POST /login` — email + password → session
- `POST /logout` — destroy session
- `GET /me` — user info + csrfToken + serverTime
- `POST /register` — token + name + password (invito)
- `POST /forgot-password` — email → link reset
- `POST /reset-password` — token + password

### Photos (`/api/photos`)
- `POST /upload` — multipart photo + notes → PENDING
- `GET /` — lista con ?status, ?page, ?limit
- `GET /confirmable` — foto pronte per conferma
- `GET /:uuid` — dettaglio foto
- `GET /:uuid/image` — file immagine
- `POST /:uuid/confirm` — conferma con seconda foto → INFRAZIONE

### Admin (`/api/admin`)
- `GET /users`, `POST /users/:id/toggle`, `POST /users/:id/role`
- `POST /invite`, `GET /invites`, `DELETE /invites/:id`, `POST /invites/:id/resend`
- `GET /settings`, `PUT /settings`
- `GET /photos`, `POST /photos/:uuid/archive|unarchive|discard`, `DELETE /photos/:uuid`
- `GET /photos/report` — PDF

### Altro
- `GET /api/health` — health check
- `GET /api/settings/public` — subtitle, countdown, min minutes

## Workflow foto
1. Utente scatta foto → status PENDING, server_ts registrato
2. Countdown visibile (se abilitato), minimo CONFIRMATION_MIN_MINUTES (default 30)
3. Utente torna, scatta seconda foto → entrambe diventano INFRAZIONE
4. Se non confermata entro PENDING_TIMEOUT_MINUTES (default 240) → auto-SCARTO via scheduler
5. Admin puo' archiviare, scartare, eliminare, generare report PDF

## Camera (mobile)
- Camera non si avvia automaticamente al login
- Bottone "Apri fotocamera" → getUserMedia (rear, 1920x1080)
- Dopo scatto: stream si ferma (stopCamera), preview con notes
- Bottone "Chiudi fotocamera" per spegnere senza scattare
- Video limitato a max-height 50vh per non nascondere i bottoni
- Conferma: camera si apre automaticamente con banner di riferimento

## Ruoli
- **admin**: accesso completo (settings, utenti, foto, inviti)
- **councilor**: come admin ma senza settings e senza modificare altri councilor
- **user**: upload e conferma foto

## Sicurezza
- Bcrypt salt 10 per password
- CSRF token 32 bytes su tutte le non-GET (escluse auth pubbliche)
- Rate limit login: 10/15min
- Session: httpOnly, sameSite strict, secure in production, 24h
- Upload: MIME validation, 5MB max, UUID filenames
- Timestamp server-side (non manipolabile dal client)

## Deploy OCI

### Infrastruttura
- **Tenancy**: sniper (OCI profile)
- **Region**: eu-milan-1
- **Compartment**: root (ocid1.tenancy.oc1..aaaaaaaaqqqzv2pgslp3e47jite6lmp7qxg5feg2iboqao2vuglnzj3q7orq)
- **VM**: VM.Standard.E2.1.Micro, Oracle Linux 9
- **IP pubblico**: 89.168.26.142
- **IP privato**: 10.0.1.222
- **Rete**: VCN 10.0.0.0/16, subnet 10.0.1.0/24, NSG (80/443/22)

### IDs risorse OCI (da state.env)
- VCN_ID: ocid1.vcn.oc1.eu-milan-1.amaaaaaaqhilyviadv5wdfhee45vtf6fcwlmh65yrn3wxufegouxhtoumfea
- SUBNET_ID: ocid1.subnet.oc1.eu-milan-1.aaaaaaaad4fh54xdliekjfr3etvn3oly2wzyxuae5zzpptipvixa3hcfjrza
- NSG_ID: ocid1.networksecuritygroup.oc1.eu-milan-1.aaaaaaaa6tcjikrawgletn32n2yvf25geblzae6urx54xxqe3eeifawrnm2a
- VM_INSTANCE_ID: ocid1.instance.oc1.eu-milan-1.anwgsljrqhilyviczvperbhqa466mzivcavjzisvuqnhr2zuoemiduopml2q

### Servizio
- **systemd unit**: /etc/systemd/system/sniper.service
- **User**: opc
- **WorkingDirectory**: /opt/sniper
- **ExecStart**: /usr/local/bin/node server.js
- **Porta**: 3001 (firewalld forward-port 80→3001 e 443→3001, persistente)
- **NOTA**: NON usare iptables su OL9 (usa nftables backend, regole non persistono). Usare firewalld.
- **Restart**: on-failure, 5s delay

### Deploy rapido (rsync + restart)
```bash
SSH_PRIVKEY="$HOME/.ssh/id_ed25519"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes -o ConnectTimeout=30 -i $SSH_PRIVKEY"
rsync -az --delete \
    --exclude node_modules --exclude uploads --exclude data \
    --exclude .env --exclude .git --exclude 'scripts/deploy/state.env' \
    --exclude security --exclude credentials.info --exclude ssl \
    -e "ssh $SSH_OPTS" \
    ./ "opc@89.168.26.142:/opt/sniper/"
ssh $SSH_OPTS opc@89.168.26.142 'sudo systemctl restart sniper'
```

## Variabili ambiente (.env in produzione)
PORT=3001, NODE_ENV=production, SESSION_SECRET, DB_PATH=./data/sniper.db,
UPLOAD_DIR=./uploads, ADMIN_PASSWORD, APP_URL=https://sniper.vialeteodorico7.it,
SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER, SMTP_PASS, SMTP_FROM,
PENDING_TIMEOUT_MINUTES=240, CONFIRMATION_MIN_MINUTES=30

## Dipendenze
bcrypt, better-sqlite3, connect-sqlite3, express, express-rate-limit,
express-session, multer, nodemailer, pdfkit, uuid

## CSS
Tema glassmorphism scuro, font Inter (Google Fonts), backdrop-filter blur,
card/modal/badge/alert traslucenti, scrollbar custom webkit,
fallback iOS per background fixed, responsive mobile-first.

## Lingua
Tutta l'interfaccia e le email sono in italiano (it-IT).
