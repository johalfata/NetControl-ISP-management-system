# Keamanan — NetControl

Dokumen ini menjelaskan mekanisme keamanan yang ada di kode NetControl dan
langkah-langkah yang **wajib** dilakukan saat men-deploy ke produksi. Semua
pernyataan di bawah merujuk pada kode nyata di `src/lib/`; tidak ada angka
yang dikarang.

> Pendamping: [`README.md`](../README.md) (instalasi, deployment, variabel
> environment) dan [`docs/n8n/`](./n8n/) (integrasi otomasi webhook).

---

## 1. Manajemen kunci & enkripsi

### Algoritma

Kredensial integrasi (RouterOS, Fonnte) disimpan dengan **AES-256-GCM**
(`aes-256-gcm`, lihat `src/lib/crypto.ts`).

| Bagian | Implementasi |
| --- | --- |
| Kunci | Variabel env `ENCRYPTION_KEY`, **harus tepat 32 byte setelah decode base64**. Diceg saat runtime: nilai lain panjangnya ditolak. |
| IV | 12 byte acak per enkripsi (`crypto.randomBytes(12)`). |
| Autentisitas | GCM auth tag disimpan terpisah (`authTag`). Dekripsi gagal bila data diubah. |
| Penyimpanan | Tiga kolom terpisah: `ciphertext`, `iv`, `authTag` (tabel `SecretSetting`, `Router`, `InfraNode`). |
| Kunci di DB? | **Tidak pernah.** `ENCRYPTION_KEY` hanya ada di environment proses. |

Fungsi pendukung di `src/lib/crypto.ts`:

- `hashToken(token)` — SHA-256 heksadesimal; dipakai untuk menyimpan token sesi.
- `generateToken(bytes = 32)` — token acak base64url untuk sesi.
- `hmacSha256Hex(secret, payload)` — HMAC-SHA256 untuk webhook n8n.
- `timingSafeEqualHex(a, b)` — perbandingan waktu-konstan, mencegah timing
  attack pada signature webhook.
- `secretFingerprint(plaintext)` — 16 karakter pertama SHA-256; sidik jari
  non-rahasia untuk audit log.

### Membuat kunci

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Kehilangan kunci

Tanpa `ENCRYPTION_KEY`, seluruh ciphertext di `SecretSetting`, `Router`, dan
`InfraNode` **tidak dapat didekripsi**. Aplikasi akan berjalan tetapi setiap
integrasi yang membutuhkan kredensial akan gagal. Backup kunci ini **wajib**
disimpan terpisah dari backup database (lihat §8 butir 4).

### Prosedur rotasi kunci

Belum ada perintah otomatis — rotasi dilakukan manual dengan pola
*decrypt lama → re-encrypt baru*:

1. Siapkan kunci baru: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
2. **Pakai kunci LAMA**: jalankan skrip yang membaca seluruh baris rahasia,
   mendekripsi dengan `openSecret()`, lalu menyimpan *plaintext* sementara di
   memori. Lokasi yang perlu diproses:
   - `SecretSetting` (`key`, `ciphertext`, `iv`, `authTag`)
   - `Router` (`secretCiphertext`, `secretIv`, `secretAuthTag`)
   - `InfraNode` (`apiSecretCiphertext`, `apiSecretIv`, `apiSecretAuthTag`)
3. **Ganti `ENCRYPTION_KEY` ke nilai baru** di seluruh instance, lalu mulai
   ulang aplikasi (env dibaca saat runtime melalui `getEnv()`, dan `getEnv`
   meng-cache hasil parse — restart diperlukan agar kunci baru dipakai).
4. Dengan kunci baru, enkripsi ulang plaintext tadi dengan `sealSecret()` dan
   tulis kembali ke DB (IV baru otomatis dibuat per baris).
5. Verifikasi: jalankan satu operasi baca kredensial (mis. koneksi router atau
   pengiriman WhatsApp uji coba) dan periksa `fingerprint` di audit log.
6. Hancurkan salinan kunci lama setelah diverifikasi.

Karena setiap baris memiliki IV sendiri, rotasi hanya mengubah `ciphertext`,
`iv`, dan `authTag` — nilai tidak pernah direstore dari ciphertext lama.

---

## 2. Autentikasi

### Sesi (cookie)

Sesi dibuat di `src/lib/auth/session.ts` dengan opsi berikut:

| Properti | Nilai |
| --- | --- |
| `httpOnly` | `true` — JavaScript sisi klien tidak dapat membaca token |
| `sameSite` | `"lax"` |
| `secure` | `true` hanya saat `NODE_ENV === "production"` |
| `path` | `"/"` |
| `maxAge` | mengikuti TTL setelan (lihat bawah) |

Nama cookie: staf `nc_session`, portal pelanggan `nc_portal_session`.

Token sesi **tidak pernah disimpan mentah** — hanya `hashToken(token)`
(SHA-256) yang disimpan di `Session.tokenHash` /
`CustomerPortalSession.tokenHash`. Token mentah hanya ada di cookie; cocok
dengan mencari hash-nya.

### Masa berlaku sesi (dari `src/lib/settings/registry.ts`)

| Setelan | Default | Batas |
| --- | --- | --- |
| `security.sessionTtlMinutes` (staf) | **720 menit (12 jam)** | min 15, maks 20 160 |
| `security.portalSessionTtlMinutes` (portal) | **1440 menit (24 jam)** | min 15, maks 20 160 |

Kedua nilai dapat diubah dari halaman Settings (kategori **Keamanan**) tanpa
menyentuh `.env`. Sesi kedaluwarsa ditolak otomatis dan dibersihkan oleh
`purgeExpiredSessions()`.

### Lockout akun

Setelah login gagal, `failedLoginCount` bertambah. Ketika jumlah percobaan
mencapai `security.loginMaxAttempts`, akun dikunci selama
`security.lockoutMinutes`:

| Setelan | Default | Batas |
| --- | --- | --- |
| `security.loginMaxAttempts` | **5** | min 3, maks 20 |
| `security.lockoutMinutes` | **15** | min 1, maks 1440 |

Mekanisme ini berlaku **sama** untuk login staf (`authenticateStaff`) dan
login portal pelanggan (`authenticatePortal`). Selama terkunci, kolom
`lockedUntil` di tabel `User` / `CustomerPortalUser` menjadi acuan;
login berhasil mengreset `failedLoginCount` dan `lockedUntil`.

### Rate limiting

Dilakukan **sebelum** pencarian akun, di `src/lib/auth/login.ts`:

| Lingkup | Batas | Jendela |
| --- | --- | --- |
| Per IP (`staff-login`) | 20 percobaan | 300 detik (5 menit) |
| Per identitas/email staf (`staff-login`) | 10 percobaan | 300 detik |
| Per IP (`portal-login`) | 20 percobaan | 300 detik |

Rate limiter berbasis memori proses (`src/lib/rate-limit.ts`) — **batas ini
berlaku per instance**. Deployment multi-instance membutuhkan penyimpanan
bersama (mis. Redis); lihat catatan di file tersebut.

### Pencegahan enumerasi & timing attack

- Login gagal selalu mengembalikan pesan seragam: `"Email atau password salah"`
  (`publicLoginError()`).
- Jika email tidak terdaftar, kode tetap menjalankan `verifyPassword` terhadap
  hash bcrypt dummy (`$2a$12$000…`) agar **waktu respons tidak membocorkan
  keberadaan akun**.
- Akun nonaktif dan akun terkunci mengembalikan pesan yang berbeda — hal ini
  disengaja agar staf/pelanggan tahu cara melanjutkan.
- Password di-hash dengan bcrypt, cost factor **12** (`src/lib/auth/password.ts`).
- Kebijakan password: panjang minimum `security.passwordMinLength`
  (**default 10**, rentang 8–72), maksimal 72 (batas bcrypt), tidak boleh
  salah satu dari daftar password umum, dan harus memuat minimal **3 dari 4**
  kelas karakter (huruf kecil, huruf besar, angka, simbol).

### Audit login

Setiap kejadian login dicatat ke `AuditLog`:

- `auth.login.success` (staf) / `portal.login.success` (portal)
- `auth.login.failed` — termasuk metadata `{ email, attempts }`
- `auth.login.locked` — saat akun terkunci

---

## 3. Otorisasi (RBAC)

Lima peran (`enum Role` di `prisma/schema.prisma`): `OWNER`, `ADMIN`,
`BILLING`, `TECHNICIAN`, `READONLY`. Pemetaan peran → permission ada di
`src/lib/permissions.ts` (`ROLE_PERMISSIONS`); `OWNER` mendapatkan **semua**
permission (`[...PERMISSIONS]`).

Penegakan dilakukan di server, bukan di UI:

```ts
// src/lib/auth/guard.ts
export async function requireActor(permission?: Permission): Promise<Actor>
```

Setiap route handler / server action yang dilindungi **wajib** memanggil
`requireActor("…")`. UI hanya menyembunyikan elemen untuk kenyamanan;
`assertPermission()` di server adalah gerbang sebenarnya. PermissionError
diterjemahkan ke HTTP 403 oleh `errorResponse()`.

> Tidak ada permission check yang hanya ada di sisi klien. Bila sebuah
> endpoint tidak memanggil `requireActor()`, itu adalah bug — bukan fitur.

### Lihat juga

Tabel ringkas peran × kategori permission ada di
[`README.md`](../README.md#peran--permission).

---

## 4. Audit log

Semua mutasi penting dicatat oleh `recordAudit()` (`src/lib/audit.ts`), yang
menulis ke tabel `AuditLog` dengan kolom: `actorType` (`USER`, `PORTAL`,
`SYSTEM`, `WEBHOOK`), `actorId`, `actorLabel`, `action`, `entityType`,
`entityId`, `metadata`, `ip`, `createdAt`.

**Redaksi otomatis.** Metadata melewati `redact()` sebelum ditulis:

- Kunci yang cocok pola `password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key`
  (case-insensitive) diganti dengan `[REDACTED]`.
- String bebas dengan panjang ≥ 24 yang berawalan `eyJ`, `sk-`, `ghp_`, `pk_`
  dianggap token → `[REDACTED]`; `Bearer …` → `Bearer [REDACTED]`.
- Kedalaman objek dibatasi 6 (`[REDACTED_DEPTH]`).

Dengan demikian **password maupun token tidak pernah masuk audit log**.

**Trade-off kegagalan audit.** `recordAudit()` membungkus penulisan dalam
`try/catch`; kegagalan hanya dicatat ke `stderr`:

```ts
} catch (error) {
  console.error("[audit] gagal menulis audit log:", error);
}
```

Alasannya: audit adalah sifatsekunder. Jika penulisan audit sampai
menggagalkan operasi bisnis, sebuah masalah pada database audit akan membuat
aplikasi tidak bisa menerima pembayaran atau memproses pelanggan. Konsekuensi
**yang harus disadari operator**: kerusakan DB tidak terlihat dari perilaku
aplikasi. Pantau log `[audit] gagal menulis audit log` pada infrastruktur
logging.

`recordAuditBatch()` digunakan untuk operasi massal (bulk action, import) —
satu `createMany`, semantik redaksi dan penanganan error identik.

### Retensi

`security.auditRetentionDays` — **default 365 hari** (rentang 30–3650), dapat
diubah dari Settings. Penghapusan dilakukan oleh job maintenance.

---

## 5. Proteksi input & respons

- **Validasi zod di setiap endpoint.** `readJson()` mem-parse body dan
  melempar `ValidationError` bila bukan JSON valid; setiap skema divalidasi
  dengan `safeParse`. `parseQuery()` memvalidasi query string dengan cara
  sama.
- **Respons error standar** (`src/lib/http.ts`, `errorResponse()`):

  | Error domain | HTTP | Code |
  | --- | --- | --- |
  | `ZodError` | 400 | `VALIDATION_ERROR` |
  | `ValidationError` | (dari error) | (dari error) |
  | `UnauthenticatedError` | 401 | (dari error) |
  | `PermissionError` | 403 | (dari error) |
  | `NotFoundError` | 404 | (dari error) |
  | `ConflictError` | 409 | (dari error) |
  | `ConfigurationError` | (dari error) | (dari error) |
  | Lainnya | 500 | `INTERNAL_ERROR` |

  Detail `ZodError` dikembalikan per-field (`path` + `message`). Error tak
  terduga tidak membocorkan stack — hanya pesan generik dan catatan di
  `stderr`.
- **Header keamanan** (`next.config.ts`), diterapkan pada seluruh path
  (`/:path*`):

  | Header | Nilai | Tujuan |
  | --- | --- | --- |
  | `X-Content-Type-Options` | `nosniff` | Mencegah MIME sniffing |
  | `X-Frame-Options` | `DENY` | Mencegah framing aplikasi (clickjacking) |
  | `Referrer-Policy` | `strict-origin-when-cross-origin` | Membatasi kebocoran referrer |
  | `X-DNS-Prefetch-Control` | `off` | Mematikan prasarana DNS prefetch |
  | `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Mencegah akses API perangkat |

  `next.config.ts` juga mematikan `poweredByHeader` (`X-Powered-By: Next.js`
  tidak dikirim).

---

## 6. Kredensial integrasi

Dikelola oleh `src/lib/secrets.ts`:

- `setSecret(actor, key, plaintext)` — menyimpan dengan `sealSecret()`.
  **Nilai plaintext tidak pernah dikembalikan ke pemanggil.**
- `requireSecret(key)` / `getSecret(key)` — membaca plaintext di sisi server
  saja; `requireSecret` melempar bila belum dikonfigurasi.
- `listSecretStatus()` — mengembalikan `{ key, isSet, fingerprint, updatedAt }`,
  tanpa nilai sensitif. Inilah satu-satunya yang tampil di UI.
- `deleteSecret(actor, key)` — menghapus kredensial.

Kunci rahasia yang dikenal (`SECRET_SETTING_DEFINITIONS`):

| Key | Keterangan |
| --- | --- |
| `integrations.fonnte.token` | Token API Fonnte untuk pengiriman WhatsApp |
| `integrations.fonnte.webhookToken` | Verifikasi callback status pengiriman |
| `integrations.routeros.defaultPassword` | Hanya untuk pengisian awal; password per router sebaiknya disimpan per router |

**Sidik jari di audit log.** Setiap kredensial disimpan beserta `fingerprint`
(16 karakter pertama SHA-256 plaintext). Ini memungkinkan Anda memverifikasi
kredensial mana yang aktif **tanpa** menyimpan nilainya — bandingkan
fingerprint dari provider dengan yang ada di audit log.

Rekomendasi user API MikroTik: buat user khusus least-privilege — read-only
untuk monitoring, dan write hanya pada scope `ppp secret`. Jangan gunakan akun
`admin` penuh.

---

## 7. Data PII

Data pribadi yang disimpan: nama, email, nomor telepon, alamat pelanggan
(tabel `Customer`), serta email portal pelanggan (`CustomerPortalUser`).

- **Nomor telepon** tersimpan apa adanya di `Customer.phone`, tetapi
  `redactPhone()` di `src/lib/crypto.ts` menyisakan 4 digit terakhir
  (`****6789`) untuk keperluan log/audit. Nomor ≤4 digit → `****`.
- **Email** dapat ditampilkan dengan `maskEmail()`: karakter pertama + `***@`
  + domain (`j***@example.com`); tanpa `@` → `[REDACTED]`.
- **Export** data pelanggan (CSV) dilindungi permission `customers.export`.
  Tanpa permission itu, endpoint menolak akses di sisi server.
- `csvResponse()` selalu mengirim `Cache-Control: no-store`.
- Pelanggan portal hanya dapat melihat data miliknya sendiri — sesi portal
  terikat `customerId` (`requirePortalActor()`), dan setiap query difilter
  sesuai.

---

## 8. Checklist hardening produksi

1. **Ganti seluruh secret `.env`.** `ENCRYPTION_KEY`, `WEBHOOK_HMAC_SECRET`,
   `JOB_RUNNER_TOKEN`, `SEED_OWNER_PASSWORD` — semua nilai dari `.env.example`
   adalah placeholder. Generate dengan `node -e` (lihat `README.md`).
   `WEBHOOK_HMAC_SECRET` dan `JOB_RUNNER_TOKEN` harus minimal 16 karakter
   (divalidasi di `src/lib/env.ts`).
2. **`NODE_ENV=production`.** Ini mengaktifkan cookie `secure` (lihat §2).
   Deployment Docker compose menyetelnya secara eksplisit.
3. **Reverse proxy TLS di depan port 4755.** Aplikasi sendiri tidak
   menyajikan HTTPS; gunakan Nginx/Caddy/Traefik dengan sertifikat valid.
   Teruskan `X-Forwarded-For` agar rate limit per IP bekerja
   (`requestContext()` membaca header ini).
4. **Backup terenkripsi + kunci terpisah.** Backup `pg_dump` dienkripsi
   *dan* `ENCRYPTION_KEY` disimpan di tempat lain (password manager / brankas
   fisik). Backup database tanpa kunci tidak dapat dipulihkan sepenuhnya.
5. **User API MikroTik least-privilege.** Read-only untuk monitoring; write
   hanya untuk `ppp secret`. Jangan akun `admin` penuh.
6. **Batasi akses Postgres.** Port 5443 (dev, embedded-postgres) dan port
   5432 produksi hanya boleh terjangkau dari localhost / jaringan internal.
   Pada `docker-compose.yml`, service `db` **tidak** menerbitkan portnya ke
   host — sengaja.
7. **Rotasi token berkala.** `WEBHOOK_HMAC_SECRET` (tanda tangan webhook n8n)
   dan `JOB_RUNNER_TOKEN` (pemicu job eksternal). Rotasi memerlukan sinkronisasi
   dengan n8n/cron yang memakai token lama — lakukan saat jendela maintenance.
   Bandingkan signature selalu dengan `timingSafeEqualHex()`.
8. **Pantau `AuditLog`** untuk aksi:
   - `auth.login.failed` — percobaan gagal; metadata memuat `{ email, attempts }`.
   - `auth.login.locked` — akun terkunci karena melewati
     `security.loginMaxAttempts` (default 5).
   - Pola berulang dari satu IP mengindikasikan serangan — blokir di reverse
     proxy/firewall.

---

## 9. Batasan yang harus diketahui

- **Rate limit per instance.** Lihat §2. Deployment lebih dari satu proses
  mengurangi efektivitas batas login.
- **Audit failure diremehkan dengan sengaja.** Lihat §4.
- **Tidak ada enkripsi at-rest pada level kolom.** Keamanan data teristirahat
  bergantung pada enkripsi disk host dan kontrol akses DB, selain enkripsi
  kredensial aplikasi (§1).
- **Tidak ada MFA.** Pertimbangkan VPN/batas jaringan untuk panel staf jika
  diperlukan faktor kedua.
- **Webhook n8n memerlukan validasi host.** Setelan
  `integrations.webhook.allowedHosts` (default kosong) membatasi host yang
  boleh dihubungi server untuk integrasi keluar; toleransi timestamp
  `integrations.webhook.toleranceSec` (default 300 detik) mencegah serangan
  replay.
