# Sniper

Web app per il controllo parcheggi condominiali. Permette agli utenti autorizzati di documentare veicoli in sosta irregolare con un sistema a doppia foto: scatto iniziale, attesa di un tempo minimo, poi conferma con seconda foto.

## Funzionalita

- **Cattura foto** da mobile (camera posteriore, on-demand)
- **Workflow a doppio scatto** con countdown configurabile
- **Ruoli**: admin, consigliere, utente
- **Inviti via email** per nuovi utenti
- **Auto-scarto** foto non confermate (timeout configurabile)
- **Report PDF** delle infrazioni
- **Pannello admin** per gestione utenti, inviti, impostazioni e foto
- **Privacy-first**: GDPR compliant, solo cookie tecnico

## Stack

| Componente | Tecnologia |
|------------|------------|
| Backend | Node.js + Express |
| Database | SQLite (better-sqlite3, WAL mode) |
| Frontend | Vanilla JS, HTML, CSS (glassmorphism) |
| Email | Nodemailer (SMTP) |
| PDF | PDFKit |
| Deploy | OCI (Oracle Cloud), systemd |

## Requisiti

- Node.js 20+
- npm

## Setup locale

```bash
git clone https://github.com/egidiocasati/sniper.git
cd sniper
npm install
npm run dev
```

L'app parte su `http://localhost:3001`. Al primo avvio viene creato un utente admin con password stampata in console.

## Variabili ambiente

Crea un file `.env` nella root:

```env
PORT=3001
NODE_ENV=development
SESSION_SECRET=your-secret-here
DB_PATH=./data/sniper.db
UPLOAD_DIR=./uploads
APP_URL=http://localhost:3001
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
PENDING_TIMEOUT_MINUTES=240
CONFIRMATION_MIN_MINUTES=30
```

## Deploy (OCI)

Gli script in `scripts/deploy/` automatizzano il provisioning su Oracle Cloud:

```bash
# 1. Configura env.sh con i tuoi parametri OCI
# 2. Provisioning rete
./scripts/deploy/01_provision_network.sh

# 3. Provisioning VM
./scripts/deploy/02_provision_vm.sh

# 4. Bootstrap e deploy app
./scripts/deploy/03_bootstrap_vm.sh
```

Per aggiornamenti successivi (solo sync + restart):

```bash
rsync -az --delete \
    --exclude node_modules --exclude uploads --exclude data \
    --exclude .env --exclude .git --exclude 'scripts/deploy/state.env' \
    --exclude security --exclude ssl \
    -e "ssh -i ~/.ssh/id_ed25519" \
    ./ opc@<VM_IP>:/opt/sniper/
ssh -i ~/.ssh/id_ed25519 opc@<VM_IP> 'sudo systemctl restart sniper'
```

## Licenza

Copyright 2026 Egidio Casati. Licensed under the [Apache License 2.0](LICENSE).
