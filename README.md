# NetControl

Sistem manajemen untuk ISP kecil hingga menengah (FTTH/PPPoE) di Indonesia.
NetControl memadukan operasi komersial dan operasi jaringan dalam satu aplikasi:
data pelanggan dan paket, langganan, tagihan bulanan, pembayaran, pengeluaran,
manajemen router MikroTik (PPPoE secret & session), inventaris FTTH (OLT/ODC/ODP),
monitoring link WAN (Starlink & dedicated), notifikasi WhatsApp, helpdesk tiket,
portal pelanggan, serta integrasi otomasi lewat webhook n8n.

> **Status:** repo privat, perangkat lunak internal. Belum ada rilis publik.

---

## Daftar isi

- [Fitur utama](#fitur-utama)
- [Prasyarat](#prasyarat)
- [Instalasi & menjalankan dev](#instalasi--menjalankan-dev)
- [Skrip tersedia](#skrip-tersedia)
- [Variabel environment](#variabel-environment)
- [Peran & permission](#peran--permission)
- [Struktur direktori](#struktur-direktori)
- [Deployment produksi](#deployment-produksi)
- [Integrasi eksternal](#integrasi-eksternal)
- [Testing](#testing)
- [Backup & pemulihan](#backup--pemulihan)
- [Keamanan](#keamanan)
- [Kontribusi & lisensi](#kontribusi--lisensi)

---

## Fitur utama

Di bawah ini sesuai model yang ada di `prisma/schema.prisma`.

**Pelanggan & layanan**

- Data pelanggan: kode unik, kontak (email/telepon), alamat lengkap dengan
  koordinat, status (`ACTIVE`, `SUSPENDED`, `ARCHIVED`), tanggal pemasangan.
- Paket layanan (`ServicePlan`) dengan harga dalam satuan rupiah penuh
  (tidak ada float), kecepatan up/down, masa tagihan, dan riwayat harga
  (`ServicePlanPrice`).
- Langganan (`Subscription`) dengan jejak perubahan: baru, upgrade, downgrade,
  reaktivasi, pembatalan — bisa langsung (`IMMEDIATE`) atau siklus berikutnya
  (`NEXT_CYCLE`).
- Kode pelanggan & nomor invoice terformat dan dapat dikustomisasi dari
  pengaturan (token `{prefix}`, `{YYYY}`, `{MM}`, `{SEQ:n}`).

**Tagihan & keuangan**

- Invoice dengan baris (`InvoiceLine`) berjenis langganan, add-on, denda,
  penyesuaian; status `DRAFT` → `ISSUED` → `PARTIALLY_PAID` → `PAID` / `VOID`.
- Pembayaran dengan metode tunai/transfer/e-wallet, alokasi otomatis ke
  invoice (`PaymentAllocation`), pembatalan dengan alasan, dan kunci
  idempotensi untuk integrasi eksternal.
- Pengeluaran operasional (`Expense`) dengan kategori dan vendor.
- Penomoran invoice, pembayaran, dan kode pelangan memakai counter atomik
  (`Counter`) di dalam transaksi berisolasi Serializable — aman untuk
  beberapa proses yang berjalan bersamaan.
- Denda keterlambatan (tetap atau persen), pajak (mis. PPN 11% dengan opsi
  inclusive/exclusive), dan prorata saat ganti paket — semuanya dikendalikan
  dari pengaturan, bukan kode.

**Jaringan**

- Router MikroTik: inventaris dengan kredensial tersimpan terenkripsi,
  interval polling per router, status terakhir, identitas, versi, uptime.
- PPPoE: sinkronisasi `secret` dan `session` aktif per router.
- Inventaris FTTH/topologi hierarkis (`InfraNode`): OLT, ODC, ODP, splitter,
  ONT, router, switch, radio — dengan tautan (`InfraLink`) bertipe feeder,
  distribution, drop, ethernet, uplink.
- Pelanggan terhubung ke ONT dan ODP; kapasitas dan port terpakai terlacak.
- Link WAN (`WanLink`) dengan tipe `STARLINK`, `DEDICATED`, `OTHER`,
  kapasitas, dan target pemantauan latensi.

**Monitoring & insiden**

- Metrik router (CPU, memori, sesi aktif, throughput) dan metrik per interface
  (rx/tx, rate, link up, latensi, packet loss).
- Metrik infrastruktur FTTH (`InfraMetric`): rx/tx power dBm, suhu, ringkasan
  port.
- Aturan alert (`AlertRule`) dengan pembanding, ambang, severity, dan cooldown;
  insiden (`Incident`) dengan dedupe key, status `OPEN` → `ACKNOWLEDGED` →
  `RESOLVED`, dan opsi membuat tiket otomatis untuk insiden kritis.
- Retensi data telemetri dijaga oleh job maintenance
  (`monitoring.metricsRetentionDays`, default 90 hari).

**Notifikasi**

- Template pesan WhatsApp (`NotificationTemplate`) dengan kode kanal
  (`WHATSAPP`) dan body template.
- Antrian pesan (`NotificationMessage`) berisi status
  (`QUEUED`, `SENT`, `ACCEPTED`, `DELIVERED`, `FAILED`, `UNKNOWN`, `SKIPPED`),
  jumlah percobaan, backoff, dan log percobaan per kirim (`NotificationAttempt`).
- Pengingat sebelum jatuh tempo dan setelah jatuh tempo dapat dijadwalkan
  per hari dari pengaturan; ada batas kirim per menit agar tidak diblokir
  provider.
- Pengaturan persetujuan pelanggan (opt-in) dan kata kunci berhenti (opt-out).

**Helpdesk**

- Tiket dengan kategori, prioritas (`LOW`/`NORMAL`/`HIGH`/`URGENT`), status
  (`OPEN`/`IN_PROGRESS`/`PENDING`/`RESOLVED`/`CLOSED`), sumber
  (`STAFF`/`PORTAL`/`WEBHOOK`), penanggung jawab, target SLA, dan keterkaitan
  dengan router, node infrastruktur, atau insiden.
- Komentar dengan penanda komentar internal (hanya staf) dan riwayat event
  tiket (`TicketEvent`) untuk setiap perubahan status.

**Portal pelanggan**

- Akun portal per pelanggan (`CustomerPortalUser`) dengan sesi terpisah dari
  sesi staf, kebijakan lockout yang sama, dan wajib ganti password.
- Pengumuman layanan (`ServiceNotice`) untuk semua pelanggan atau pelanggan
  tertentu.

**Audit & keamanan**

- Setiap mutasi penting tercatat di `AuditLog` beserta tipe pelaku
  (`USER`, `PORTAL`, `SYSTEM`, `WEBHOOK`), IP, dan waktu.
- Kredensial integrasi (RouterOS, Fonnte) disimpan terenkripsi AES-256-GCM;
  kunci enkripsi hanya ada di variabel environment.
- Lima peran dengan permission per kategori; pengecekan dilakukan di setiap
  route handler, bukan hanya di UI. Selengkapnya lihat
  [`docs/KEAMANAN.md`](docs/KEAMANAN.md).

---

## Prasyarat

| Kebutuhan | Versi | Catatan |
| --- | --- | --- |
| Node.js | **>= 20.9** (diuji di Node 24) | Lihat `engines` di `package.json` |
| PostgreSQL | **14+** | Atau `embedded-postgres` untuk dev (lihat bawah) |
| npm | terbaru yang kompatibel dengan Node | Dipakai untuk seluruh skrip |

Untuk pengembangan, database tidak perlu dipasang manual: skrip `npm run dev:db`
memakai `embedded-postgres` (biner Postgres bawaan paket npm) yang berjalan di
**port 5443** dan menyimpan data di `./.pgdata`. Untuk produksi, gunakan
instance PostgreSQL tersendiri lewat `DATABASE_URL`.

---

## Instalasi & menjalankan dev

```bash
# 1. Dapatkan kode
git clone <repo-url> netcontrol
cd netcontrol

# 2. Pasang dependency
npm install

# 3. Jalankan database PostgreSQL lokal (port 5443, data di ./.pgdata)
npm run dev:db
# => postgresql://netcontrol:***@127.0.0.1:5443/netcontrol?schema=public
```

`npm run dev:db` memblokir terminal — biarkan berjalan, dan **buka terminal
kedua** untuk langkah berikutnya. Kredensial default dev: user `netcontrol`,
password `netcontrol`, database `netcontrol`; bisa diubah dengan variabel
`DEV_DB_PORT`, `DEV_DB_USER`, `DEV_DB_PASSWORD`, `DEV_DB_NAME`.

```bash
# 4. Siapkan konfigurasi
cp .env.example .env
#   Edit .env — setidaknya empat nilai WAJIB (lihat tabel di bawah).
#   Untuk dev, DATABASE_URL yang cocok dengan dev:db sudah ada di .env.example.

# 5. Terapkan skema database
npm run db:migrate:dev      # dev: membuat & menjalankan migrasi baru

# 6. Isi data awal — WAJIB untuk membuat akun owner pertama
npm run db:seed
#   Seed hanya berjalan bila SEED_OWNER_EMAIL, SEED_OWNER_PASSWORD,
#   dan SEED_OWNER_NAME terisi. Tanpa itu, seed menolak jalan dan TIDAK ada
#   password default di produksi.

# 7. Jalankan aplikasi
npm run dev
# => http://localhost:4755
```

Login pertama memakai `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` yang Anda
tentukan di `.env`. Setelah login sebagai OWNER, buat akun untuk tiap staf
melalui menu pengguna.

---

## Skrip tersedia

Semua skrip di `package.json`:

| Skrip | Perintah | Kapan dipakai |
| --- | --- | --- |
| `npm run dev` | `next dev -p 4755 -H 0.0.0.0` | Pengembangan sehari-hari; hot reload |
| `npm run build` | `prisma generate && next build` | Sebelum produksi; generate ulang Prisma client + build |
| `npm start` | `next start -p 4755 -H 0.0.0.0` | Menjalankan hasil build produksi |
| `npm run lint` | `next lint` | Memeriksa gaya kode (ESLint) |
| `npm run typecheck` | `tsc --noEmit` | Memeriksa tipe tanpa build |
| `npm test` | `vitest run` | Menjalankan seluruh test unit/integrasi |
| `npm run test:watch` | `vitest` | Test dengan watch mode saat coding |
| `npm run db:generate` | `prisma generate` | Setiap kali `prisma/schema.prisma` berubah |
| `npm run db:migrate` | `prisma migrate deploy` | **Produksi**; hanya menjalankan migrasi yang belum diterapkan |
| `npm run db:migrate:dev` | `prisma migrate dev` | **Dev**; membuat migrasi baru dari perubahan skema |
| `npm run db:push` | `prisma db push` | Eksperimen cepat di dev; *tanpa* migrasi (bahaya di produksi) |
| `npm run db:studio` | `prisma studio` | Menjelajah/mengedit data lewat UI (dev) |
| `npm run db:seed` | `tsx prisma/seed.ts` | Membuat akun owner pertama + setelan default |
| `npm run dev:db` | `node scripts/dev-postgres.mjs` | Menjalankan PostgreSQL embedded untuk dev |
| `npm run verify` | typecheck + lint + test + build | Pemeriksaan lengkap sebelum pull request |

---

## Variabel environment

Divalidasi dengan zod di `src/lib/env.ts`. Validasi **tidak** dijalankan saat
import modul (agar build tidak gagal), melainkan saat `getEnv()` dipanggil di
runtime. Aplikasi menolak berjalan jika nilai WAJIB hilang atau tidak valid.

| Variabel | Wajib? | Contoh / default | Catatan |
| --- | --- | --- | --- |
| `DATABASE_URL` | **WAJIB** | `postgresql://netcontrol:netcontrol@127.0.0.1:5443/netcontrol?schema=public` | Format Prisma. Dev memakai port **5443**, produksi biasanya 5432 |
| `ENCRYPTION_KEY` | **WAJIB** | base64 32 byte | Kunci AES-256-GCM untuk kredensial integrasi. **Wajib** tepat 32 byte setelah decode; nilai lain panjangnya ditolak saat runtime |
| `WEBHOOK_HMAC_SECRET` | **WAJIB** | hex 32 byte | Verifikasi signature webhook n8n. Minimal 16 karakter |
| `JOB_RUNNER_TOKEN` | **WAJIB** | hex 32 byte | Memicu endpoint job terjadwal dari n8n/cron. Minimal 16 karakter |
| `NODE_ENV` | opsional | `production` | `production`, `development`, atau `test`. Default `development`; `production` mengaktifkan cookie `secure` |
| `APP_URL` | opsional | `http://localhost:4755` | URL publik untuk link di notifikasi & webhook |
| `PORT` | opsional | `4755` | Skrip `dev` dan `start` memakai port ini |
| `SEED_OWNER_EMAIL` | seed | `owner@example.com` | Hanya dipakai `npm run db:seed`; harus format email |
| `SEED_OWNER_PASSWORD` | seed | password kuat | Minimal 8 karakter; seed menolak jalan tanpa ini |
| `SEED_OWNER_NAME` | seed | `Owner` | Nama tampilan owner pertama; minimal 1 karakter |
| `AUTH_LOCKOUT_MINUTES` | opsional | `15` | Override env untuk durasi kunci akun; default setting DB 15 menit |
| `METRICS_RETENTION_DAYS` | opsional | `90` | Override retensi telemetri; bisa diubah dari Settings |

> **Penting:** file `.env` ada di `.gitignore` dan **tidak ikut masuk ke dalam
> image Docker** (lihat `.dockerignore`). Nilainya disuntikkan ke container
> lewat `env_file` di `docker-compose.yml`, jadi rahasia tetap berada di host.

### Generate nilai rahasia

```bash
# ENCRYPTION_KEY — WAJIB 32 byte, output base64
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# WEBHOOK_HMAC_SECRET — output hex
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# JOB_RUNNER_TOKEN — output hex
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Jangan pernah commit `.env`. Backup `ENCRYPTION_KEY` di tempat terpisah —
lihat [Backup & pemulihan](#backup--pemulihan).

---

## Peran & permission

Lima peran (`Role` di skema Prisma): **OWNER**, **ADMIN**, **BILLING**,
**TECHNICIAN**, **READONLY**. Daftar permission lengkap ada di
`src/lib/permissions.ts`; pemetaan di bawah adalah ringkasan dari file itu.
`OWNER` mendapatkan **semua** permission. Permission diperiksa dengan
`requireActor("…")` di setiap route handler — UI hanya menyembunyikan elemen,
bukan gerbang keamanan.

| Kategori | READONLY | TECHNICIAN | BILLING | ADMIN | OWNER |
| --- | :---: | :---: | :---: | :---: | :---: |
| Dashboard (`dashboard.view`) | ✔ | ✔ | ✔ | ✔ | ✔ |
| Pelanggan lihat (`customers.view`) | ✔ | ✔ | ✔ | ✔ | ✔ |
| Pelanggan kelola (`customers.manage`) | ✘ | ✔ | ✔ | ✔ | ✔ |
| Pelanggan impor (`customers.import`) | ✘ | ✘ | ✔ | ✔ | ✔ |
| Pelanggan ekspor (`customers.export`) | ✘ | ✘ | ✔ | ✔ | ✔ |
| Pelanggan arsipkan (`customers.archive`) | ✘ | ✘ | ✘ | ✔ | ✔ |
| Paket lihat / kelola | ✔ / ✘ | ✔ / ✘ | ✔ / ✘ | ✔ / ✔ | ✔ / ✔ |
| Langganan lihat / kelola | ✔ / ✘ | ✔ / ✘ | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ |
| Tagihan lihat / kelola | ✔ / ✘ | ✔ / ✘ | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ |
| Tagihan batal (`billing.void`) | ✘ | ✘ | ✘ | ✔ | ✔ |
| Pembayaran lihat / kelola | ✔ / ✘ | ✔ / ✘ | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ |
| Pembayaran batal (`payments.void`) | ✘ | ✘ | ✘ | ✔ | ✔ |
| Keuangan lihat / kelola (`finance.*`) | ✔ / ✘ | ✔ / ✘ | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ |
| Router lihat / kelola | ✔ / ✘ | ✔ / ✘ | ✔ / ✘ | ✔ / ✔ | ✔ / ✔ |
| Router kontrol (`routers.control`) | ✘ | ✔ | ✘ | ✔ | ✔ |
| Jaringan lihat / kelola (`network.*`) | ✔ / ✘ | ✔ / ✔ | ✔ / ✘ | ✔ / ✔ | ✔ / ✔ |
| Topologi lihat / kelola (`topology.*`) | ✔ / ✘ | ✔ / ✔ | ✔ / ✘ | ✔ / ✔ | ✔ / ✔ |
| Tiket lihat / kelola | ✔ / ✘ | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ |
| Notifikasi lihat | ✔ | ✔ | ✔ | ✔ | ✔ |
| Notifikasi kelola (`notifications.manage`) | ✘ | ✘ | ✘ | ✔ | ✔ |
| Notifikasi kirim (`notifications.send`) | ✘ | ✘ | ✔ | ✔ | ✔ |
| Laporan lihat / ekspor | ✔ / ✘ | ✔ / ✘ | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ |
| Audit lihat (`audit.view`) | ✘ | ✘ | ✘ | ✔ | ✔ |
| Job lihat (`jobs.view`) | ✘ | ✘ | ✘ | ✔ | ✔ |
| Job jalankan (`jobs.run`) | ✘ | ✔ | ✘ | ✔ | ✔ |
| Setelan lihat (`settings.view`) | ✔ | ✔ | ✔ | ✔ | ✔ |
| Setelan kelola (`settings.manage`) | ✘ | ✘ | ✘ | ✔ | ✔ |
| Pengguna lihat / kelola | ✘ / ✘ | ✘ / ✘ | ✘ / ✘ | ✔ / ✔ | ✔ / ✔ |
| Portal kelola (`portal.manage`) | ✘ | ✘ | ✘ | ✔ | ✔ |

> **Catatan:** ADMIN = gabungan BILLING + TECHNICIAN + beberapa permission
> tambahan (arsip pelanggan, kelola paket, void tagihan/pembayaran, kelola
> router, notifikasi, audit, job, setelan, pengguna, portal).

---

## Struktur direktori

```
netcontrol/
├── docs/                # Dokumentasi (KEAMANAN.md, n8n/)
├── prisma/
│   ├── schema.prisma    # Skema database (semua model & enum)
│   ├── migrations/      # Migrasi Prisma (di-commit)
│   └── seed.ts          # Seed: owner pertama + setelan default
├── scripts/
│   └── dev-postgres.mjs # PostgreSQL embedded untuk dev (port 5443)
├── src/
│   ├── app/             # Route handler + halaman Next.js (App Router)
│   ├── components/      # Komponen React (UI)
│   └── lib/
│       ├── auth/        # Sesi, guard, login, kebijakan password
│       ├── services/    # Logika domain (penomoran, dll.)
│       ├── settings/    # Registry setelan + baca/tulis DB
│       ├── crypto.ts    # AES-256-GCM, hashing token, redaksi
│       ├── secrets.ts   # Penyimpanan kredensial terenkripsi
│       ├── audit.ts     # Audit log
│       ├── permissions.ts # RBAC: 5 peran, 40 permission
│       ├── rate-limit.ts  # Pembatas laju in-memory
│       ├── http.ts      # errorResponse, parseQuery, csvResponse
│       ├── env.ts       # Validasi variabel environment
│       ├── money.ts     # Format mata uang (satuan minor)
│       ├── datetime.ts  # Zona waktu & format tanggal
│       └── db.ts        # Prisma client + transaksi Serializable
├── tests/               # Test Vitest
├── .env.example         # Template environment
├── Dockerfile           # Image produksi multi-stage
└── docker-compose.yml   # Orkestrasi app + PostgreSQL
```

Konvensi penting dari `prisma/schema.prisma`:

- **Uang** selalu `BigInt` dalam **satuan minor** (untuk IDR: rupiah penuh,
  tanpa desimal). Tidak pernah `float`.
- **Waktu** disimpan UTC (`timestamptz`), ditampilkan sesuai setelan
  `locale.timezone`.

---

## Deployment produksi

### Cara termudah: Docker Compose

Lihat [`docker-compose.yml`](docker-compose.yml) — sudah menyertakan database
PostgreSQL dan aplikasi terhubung otomatis.

```bash
# 1. Siapkan .env (lihat tabel di atas). Untuk database bawaan, gunakan host `db`:
#    DATABASE_URL="postgresql://netcontrol:netcontrol@db:5432/netcontrol?schema=public"

# 2. Bangun & jalankan
docker compose up -d --build

# 3. Terapkan skema database (tunggu sampai service `db` sehat)
docker compose exec app npm run db:migrate

# 4. Buat akun owner pertama (membutuhkan SEED_OWNER_* di .env)
docker compose exec app npm run db:seed

# 5. Periksa log
docker compose logs -f app
```

Aplikasi mendengarkan **port 4755**. Letakkan reverse proxy TLS (Nginx,
Caddy, atau Traefik) di depannya — aplikasi sendiri tidak menyajikan HTTPS.
Teruskan header `X-Forwarded-For` agar pembatas laju per IP bekerja.

Catatan arsitektur: `next.config.ts` **tidak** memakai `output: "standalone"`,
jadi server produksi adalah `next start -p 4755` (bukan `node server.js`
standalone). `Dockerfile` memakai multi-stage (`deps` → `build` → `runner`)
dengan base image `node:24-bookworm-slim` dan menjalankan aplikasi sebagai
user non-root (`node`). Image runtime hanya memasang dependency produksi,
ditambah `prisma` CLI agar `db:migrate` dapat dijalankan di dalam container.

### Cara manual (tanpa Docker)

```bash
# Di server dengan PostgreSQL tersendiri (atur DATABASE_URL di .env)
npm ci --omit=dev
npx prisma generate
npm run build
npm run db:migrate          # prisma migrate deploy
npm run db:seed             # sekali saja, untuk owner pertama

# Jalankan
npm start                   # next start -p 4755 -H 0.0.0.0
```

Untuk ketahanan proses, gunakan PM2 atau systemd. Contoh PM2:

```bash
npx pm2 start npm --name netcontrol -- start
npx pm2 save
npx pm2 startup             # agar otomatis jalan saat server boot
```

Atau unit systemd sederhana:

```ini
[Unit]
Description=NetControl
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/netcontrol
EnvironmentFile=/opt/netcontrol/.env
ExecStart=/usr/bin/npm start
Restart=always
User=netcontrol

[Install]
WantedBy=multi-user.target
```

Atur ulang beberapa nilai setelah deploy pertama:

- Generate semua secret baru (lihat [Variabel environment](#variabel-environment)).
- Pastikan `NODE_ENV=production`.
- Ubah kredensial database `netcontrol` bawaan jika memakai Compose.
- Sesuaikan setelan aplikasi dari menu Settings (nama ISP, mata uang, zona
  waktu, format nomor invoice, ambang monitoring, dll.) — semuanya disimpan
  di database, tidak perlu restart.

---

## Integrasi eksternal

### MikroTik RouterOS API

Aplikasi berkomunikasi dengan router melalui API RouterOS (library
`node-routeros`), dikonfigurasi per-router: host, port API (default 8728),
opsi TLS, username, dan password. Kredensial disimpan **terenkripsi**
(AES-256-GCM) di kolom `Router.secretCiphertext`.

**Rekomendasi user API least-privilege** — buat user khusus di MikroTik:

- Untuk **monitoring** (status router, interface, sesi PPPoE aktif): cukup
  hak **baca** (`read`) — mis. group dengan policy `read`, atau user dengan
  `read` saja.
- Untuk **provisioning PPPoE secret** (sinkronisasi secret untuk
  isolir/aktifasi pelanggan): tambahkan hak **tulis** terbatas hanya pada
  scope `ppp secret`. Jangan beri hak `write` penuh apalagi `full`.
- Jangan pernah memakai akun `admin` penuh untuk integrasi.
- Aktifkan API TLS (`useTls` + `authMethod` `TLS`) bila router mendukungnya.

### Fonnte (WhatsApp)

Token API Fonnte disimpan **terenkripsi** di `SecretSetting` dan **tidak
pernah** dikembalikan ke UI — halaman pengaturan hanya menampilkan sidik jari
(fingerprint). Cara konfigurasi:

1. Dapatkan token API dari [Fonnte](https://md.fonnte.com/).
2. Buka menu Settings → Integrasi, masukkan token Fonnte. Simpan — nilai
   langsung dienkripsi di server.
3. Jika ingin menerima callback status pengiriman, isi juga *token verifikasi
   webhook* Fonnte dan arahkan callback ke aplikasi (verifikasi memakai
   HMAC, bukan token polos).
4. Aktifkan pengiriman dari Settings → Notifikasi.

### n8n

NetControl dapat menerima dan mengirim webhook ke n8n untuk otomasi. Detail
endpoint, format payload, dan signature HMAC ada di
[`docs/n8n/`](docs/n8n/).

- Signature webhook diverifikasi dengan `WEBHOOK_HMAC_SECRET` memakai
  perbandingan waktu-konstan (`timingSafeEqualHex`), jadi nilai yang
  dikirim/diterima harus cocok di kedua sisi.
- Job terjadwal dapat dipicu dari luar memakai `JOB_RUNNER_TOKEN`.

---

## Testing

```bash
npm test              # vitest run — seluruh test
npm run test:watch    # mode interaktif saat mengembangkan
```

Sebelum pull request, jalankan pemeriksaan lengkap:

```bash
npm run verify        # typecheck + lint + test + build
```

---

## Backup & pemulihan

Cadangkan database dan kunci enkripsi secara terpisah.

### Backup

```bash
# Backup database (dijalankan di host yang bisa mengakses PostgreSQL)
pg_dump "$DATABASE_URL" -F c -f backups/netcontrol-$(date +%Y%m%d).dump

# Jika perlu export SQL polos
pg_dump "$DATABASE_URL" -f backups/netcontrol-$(date +%Y%m%d).sql
```

Bila aplikasi berjalan di Docker Compose:

```bash
docker compose exec -T db pg_dump -U netcontrol -F c netcontrol > backups/netcontrol-$(date +%Y%m%d).dump
```

### Pemulihan

```bash
# Hentikan aplikasi dulu
docker compose stop app

# Restore (di host dengan akses PostgreSQL)
pg_restore --clean --if-exists -d "$DATABASE_URL" backups/netcontrol-20260101.dump

# Contoh dari dump SQL polos
psql "$DATABASE_URL" -f backups/netcontrol-20260101.sql

# Terapkan ulang migrasi untuk memastikan skema konsisten
npm run db:migrate          # prisma migrate deploy

# Jalankan kembali aplikasi
docker compose start app
```

### Peringatan penting

**`ENCRYPTION_KEY` harus di-backup terpisah** dari backup database. Kredensial
integrasi (RouterOS, Fonnte) disimpan sebagai ciphertext AES-256-GCM; tanpa
kunci, data tersebut **tidak dapat didekripsi**. Backup database tanpa
`ENCRYPTION_KEY` tidak dapat dipulihkan sepenuhnya — simpan kunci di brankas
password manager atau penyimpanan terenkripsi terpisah, bukan di repo atau
volume yang sama dengan database.

Lihat juga [`docs/KEAMANAN.md`](docs/KEAMANAN.md) untuk prosedur rotasi kunci.

---

## Keamanan

Ringkasan poin penting (penjelasan lengkap dengan referensi kode ada di
[`docs/KEAMANAN.md`](docs/KEAMANAN.md)):

1. **Kredensial integrasi dienkripsi** dengan AES-256-GCM; kunci
   (`ENCRYPTION_KEY`) hanya di variabel environment, **tidak pernah** di
   database.
2. **Sesi aman**: cookie `httpOnly` + `sameSite: lax`, `secure` di produksi;
   token sesi hanya disimpan sebagai hash SHA-256. Masa berlaku default:
   sesi staf **12 jam**, sesi portal **24 jam**.
3. **Perlindungan brute-force**: akun terkunci setelah **5** percobaan gagal
   selama **15 menit**; pembatas laju per IP (20/5 menit) dan per identitas
   (10/5 menit) untuk login staf.
4. **Otorisasi dijalankan di server**: `requireActor(permission)` di setiap
   route handler — pemeriksaan permission tidak pernah hanya di UI.
5. **Audit menyeluruh**: semua mutasi penting tercatat; metadata otomatis
   diredaksi sehingga password/token tidak pernah tersimpan di audit log.
6. **Validasi input ketat**: skema zod di setiap endpoint dan query string;
   respons error standar yang tidak membocorkan detail internal.
7. **Header keamanan** diterapkan di `next.config.ts`: `X-Content-Type-Options:
   nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `X-DNS-Prefetch-Control`,
   dan `Permissions-Policy` untuk kamera/mikrofon/lokasi.

---

## Kontribusi & lisensi

**Repo privat — perangkat lunak internal.** Tidak ada lisensi sumber terbuka
yang berlaku; semua hak cipta dipegang oleh organisasi pemilik repo. Jangan
mendistribusikan kode atau dokumentasi ini di luar organisasi.

Alur kontribusi internal:

1. Buat branch dari `main` untuk setiap perubahan.
2. Jalankan `npm run verify` (typecheck + lint + test + build) sebelum pull
   request.
3. Setiap endpoint baru **wajib** memanggil `requireActor("…")` dengan
   permission yang sesuai, memvalidasi input dengan zod, dan mencatat
   `recordAudit()` untuk mutasi.
4. Setiap model baru di `prisma/schema.prisma` membutuhkan migrasi
   (`npm run db:migrate:dev`) yang di-commit.
5. Update dokumentasi yang terdampak (`README.md`, `docs/`).
