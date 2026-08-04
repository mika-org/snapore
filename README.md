# Snapore Photobooth — Master Prompt dan Spesifikasi Sistem

> Status dokumen: **implementasi MVP dimulai pada 4 Agustus 2026** setelah pemilik project memberikan perintah **"mulai implementasi"**. Bagian spesifikasi di bawah tetap menjadi source of truth untuk fase lanjutan.

## Implementasi yang tersedia

Repository sekarang berisi vertical slice Snapore yang mencakup:

- Next.js App Router, React, TypeScript, dan responsive PWA shell;
- Prisma ORM 7 dengan schema PostgreSQL, initial migration, dan seed data;
- command center dashboard, session archive, CMS/frame settings, dan kiosk flow;
- capture camera melalui `getUserMedia()` dengan simulator fallback;
- penyimpanan capture ke local directory melalui device agent;
- fallback IndexedDB ketika device agent tidak tersedia;
- browser image composition untuk layout grid 2, 4, 6, dan 8;
- editor per-slot untuk drag positioning, pinch zoom, two-finger twist rotation, rotate button, mirror, brightness, filter, serta retake individual pada grid 2/4/6/8;
- dua belas frame PNG transparan bawaan untuk kombinasi Sunset Punch, Electric Mint, dan Blue Hour × grid 2/4/6/8;
- admin tenant dapat menambahkan satu set frame baru melalui upload PNG Grid 2/4/6/8 untuk booth tertentu; metadata versi, path, checksum, dan status publikasi disimpan ke PostgreSQL;
- multi-tenant persistence dengan UUID untuk seluruh primary ID, user berbasis role, booth UUID URL, dan isolasi frame per tenant/booth;
- super admin console untuk membuat tenant, user, booth, mengatur pajak/biaya, menyimpan secret Xendit terenkripsi, serta melihat penjualan dan laba bersih per booth/device;
- integrasi Xendit Payments API untuk QRIS one-time-use, polling status, webhook terverifikasi, dan idempotensi webhook;
- print job dan upload job terpisah yang dipicu saat konfirmasi cetak;
- local persistent agent queue, atomic file write, SHA-256 checksum, dan background retry;
- mock DNP printer untuk development serta kontrak adapter DSLR/printer nyata;
- server sync endpoint, protected gallery token, dan QR result setelah sinkronisasi;
- fallback sinkronisasi langsung dari browser dengan retry otomatis ketika device agent tidak aktif, sehingga QR galeri tetap muncul setelah server menerima file;
- Docker Compose PostgreSQL, unit tests, lint, typecheck, dan production build scripts.

Integrasi printer/DSLR fisik masih membutuhkan model perangkat, driver vendor, dan hardware acceptance test. `OS_SPOOLER` sengaja gagal secara aman sampai printer nyata dikonfigurasi; development memakai mode `mock`.

## Menjalankan aplikasi lokal

Prasyarat: Node.js 20.19+, npm, dan PostgreSQL. Konfigurasi lokal saat ini menargetkan `jdbc:postgresql://localhost:5432/postgres` dengan user `postgres`; Prisma memakai connection string ekuivalen dari `.env`. Cara alternatif menyiapkan PostgreSQL adalah Docker Desktop.

```bash
npm install
docker compose up -d
npm run db:generate
npm run db:migrate
npm run db:seed
```

Jalankan web app dan local device agent di dua terminal:

```bash
npm run dev
```

```bash
npm run agent:dev
```

Buka:

- `http://localhost:3000/login` untuk login admin;
- `http://localhost:3000/super-admin` untuk control plane global;
- `http://localhost:3000` untuk dashboard tenant;
- `http://localhost:3000/kiosk/<booth-uuid>` untuk flow pelanggan per booth;
- `http://localhost:3000/admin` untuk CMS tenant dan upload frame per booth;
- `http://127.0.0.1:4545/health` untuk status local device agent.

Akun development awal dibuat oleh seed menggunakan `SUPER_ADMIN_EMAIL` dan `SUPER_ADMIN_PASSWORD` dari `.env`. Akun tenant awal memakai `admin@snapore.local` dengan password awal yang sama. Ganti seluruh credential sebelum deployment.

### Multi-tenant, payment, dan laba bersih

- `Tenant` memiliki user, booth, frame, pricing, pajak, biaya per cetak, dan konfigurasi payment sendiri.
- Super Admin memakai sidebar untuk overview, tambah/daftar tenant, user, booth, payment & pajak, sales, dan shortcut workspace masing-masing tenant.
- User dapat diedit oleh Super Admin, termasuk nama, email, tenant, role, status aktif, dan reset password opsional. Workspace tenant memuat Xendit/pajak serta upload frame yang hanya dapat diarahkan ke booth tenant tersebut.
- API key dan webhook token Xendit dienkripsi AES-256-GCM menggunakan `APP_ENCRYPTION_KEY`; UI hanya mengembalikan empat karakter terakhir.
- QRIS dibuat melalui `POST /api/payments/qris` menggunakan Xendit Payment Requests API. Webhook ditangani di `/api/payments/xendit/webhook` dengan verifikasi `x-callback-token` dan deduplikasi `webhook-id`.
- QRIS muncul setelah layar idle disentuh dengan window pembayaran 5 menit. Setelah pembayaran berhasil, timer sesi 15 menit terus berjalan dari pemilihan layout sampai hasil selesai.
- Untuk harga termasuk pajak: `pajak = gross - gross / (1 + taxRate)`. Laba bersih per order: `gross - pajak - biaya cetak - fee payment`.
- Device agent untuk setiap booth harus memakai `SNAPORE_BOOTH_CODE` yang sama dengan kode booth di database agar hasil cetak tercatat pada perangkat dan booth yang benar.

Foto development tersimpan di `snapore-data/`, sedangkan hasil sinkronisasi server lokal tersimpan di `server-uploads/`. Kedua directory tidak masuk version control.

### Validasi

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Cara menggunakan dokumen ini

Gunakan seluruh isi README ini sebagai master prompt untuk AI coding agent yang nantinya membangun Snapore. AI wajib membaca semua bagian, mencatat asumsi, mengusulkan rencana implementasi, lalu menunggu persetujuan sebelum menulis kode.

## Peran AI saat implementasi dimulai

Anda adalah software architect dan senior full-stack engineer yang berpengalaman membangun aplikasi kiosk, sistem offline-first, integrasi kamera, image composition, payment flow, device discovery, dan printer automation.

Tugas Anda kelak adalah membangun sistem photobooth bernama **Snapore** dengan Next.js, TypeScript, Prisma, database server, penyimpanan lokal yang tahan gangguan internet, serta local device agent untuk mengendalikan kamera dan printer. Jangan menyederhanakan kebutuhan perangkat keras menjadi API browser biasa.

Sebelum menulis kode, wajib:

1. Audit repository dan dokumen ini.
2. Tampilkan arsitektur, struktur folder, ERD, state machine, kontrak API, dan rencana fase implementasi.
3. Tandai integrasi yang membutuhkan driver/SDK vendor.
4. Ajukan hanya pertanyaan yang benar-benar mengubah arsitektur atau alur bisnis.
5. Tunggu persetujuan pemilik project.

---

## 1. Tujuan produk

Snapore adalah platform photobooth kiosk yang:

- dapat melakukan sesi foto menggunakan kamera laptop, kamera tablet, webcam USB, atau DSLR;
- dapat mencetak secara otomatis melalui printer thermal, DNP photo printer, atau Epson inkjet;
- otomatis menemukan, menghubungkan kembali, dan memantau perangkat yang sudah dipasangkan;
- tetap dapat mengambil foto dan mencetak ketika internet terputus;
- selalu menyimpan hasil pengambilan foto ke directory lokal terlebih dahulu;
- baru membuat antrean upload ke server ketika pengguna mengonfirmasi proses cetak;
- memiliki kiosk UI untuk pelanggan, operator tools, dan CMS/dashboard admin;
- mendukung banyak booth di masa depan, walaupun versi awal boleh berfokus pada satu booth.

## 2. Prinsip wajib

1. **Offline-first:** capture, composition, payment state lokal yang diperlukan, dan print tidak boleh bergantung pada koneksi server.
2. **Local-first storage:** file foto tidak langsung di-upload pada saat tombol capture ditekan.
3. **Upload on print:** upload dipicu ketika print job dikonfirmasi/dibuat, bukan saat capture.
4. **Print tidak diblokir internet:** jika server tidak tersedia, print lokal tetap berjalan dan upload masuk retry queue.
5. **Tidak ada kehilangan data:** gunakan status persisten, checksum, retry dengan backoff, dan operasi idempotent.
6. **Hardware abstraction:** setiap kamera dan printer menggunakan adapter/driver interface yang konsisten.
7. **Automatic reconnect:** perangkat yang sudah dipasangkan harus dicoba sambungkan kembali setelah restart, kabel terlepas, atau perangkat hidup kembali.
8. **Kiosk-safe:** antarmuka sederhana, touch-friendly, fullscreen, ada timeout, dan selalu dapat pulih ke halaman idle.
9. **Configurable:** layout, frame, harga, jumlah foto, durasi countdown, printer profile, dan idle media tidak boleh di-hardcode.
10. **Secure by default:** local device agent tidak boleh menjadi endpoint publik tanpa autentikasi dan pairing.

## 3. Aktor sistem

- **Pelanggan:** menjalankan sesi foto, memilih layout/frame/foto, melihat preview, menentukan jumlah cetak, membayar jika fitur pembayaran aktif, lalu mencetak.
- **Operator booth:** memilih perangkat, memeriksa status kamera/printer, mengatur paper counter, menangani antrean gagal, dan melakukan reprint sesuai izin.
- **Admin:** mengelola booth, template, frame, harga, idle media, transaksi, data sesi, user, dan laporan.
- **Local device agent:** menjembatani aplikasi web dengan filesystem, DSLR, webcam tertentu, OS print spooler, serta printer USB/LAN.
- **Server:** menyimpan metadata, hasil yang memang harus disinkronkan, konfigurasi terpusat, audit, dan galeri/QR hasil.

## 4. Arsitektur tingkat tinggi

Gunakan arsitektur hybrid, bukan browser-only.

```mermaid
flowchart LR
    K["Kiosk UI / PWA<br/>Next.js"] <-->|"HTTPS / WebSocket terautentikasi"| A["Local Device Agent<br/>Node.js + TypeScript"]
    A --> C["Camera adapters"]
    A --> P["Printer adapters"]
    A --> F["Local photo directory"]
    A --> Q["Persistent local queue"]
    K <-->|"API"| S["Next.js Server"]
    A <-->|"Sync API"| S
    S --> DB["Prisma + PostgreSQL"]
    S --> O["Object storage"]
    S --> CMS["Admin CMS / Dashboard"]
```

### Komponen yang diminta

1. **Next.js App Router + TypeScript**
   - kiosk/customer UI;
   - operator UI;
   - CMS/dashboard admin;
   - server API dan autentikasi;
   - PWA/offline shell bila sesuai.

2. **Prisma**
   - PostgreSQL untuk data server/production;
   - local SQLite melalui Prisma atau persistent embedded store setara untuk queue dan state pada device agent;
   - jika memakai dua datasource, pisahkan schema/generated client agar tidak rancu.

3. **Local Device Agent**
   - service lokal berbasis Node.js + TypeScript;
   - berjalan otomatis saat komputer kiosk menyala;
   - menyediakan API localhost/LAN yang terautentikasi;
   - mengelola local directory, device discovery, capture DSLR bila diperlukan, print spool, health check, retry queue, dan heartbeat;
   - mendukung Windows sebagai target awal, tetapi interface driver harus siap dikembangkan untuk macOS/Linux.

4. **Object storage server**
   - gunakan adapter S3-compatible agar dapat memakai S3, Cloudflare R2, MinIO, atau provider lain;
   - database hanya menyimpan metadata/path/checksum, bukan binary foto besar.

### Batasan platform yang tidak boleh diabaikan

- `getUserMedia()` dapat digunakan untuk kamera laptop, tablet, dan mayoritas webcam.
- Browser tidak dapat mengendalikan semua DSLR, DNP, Epson, atau thermal printer secara langsung.
- DSLR memerlukan adapter vendor, `gphoto2`, digiCamControl, remote tethering, atau SDK resmi sesuai OS/model.
- DNP dan Epson umumnya membutuhkan driver OS/vendor yang sudah terpasang.
- Printer thermal dapat membutuhkan ESC/POS melalui USB/LAN/serial atau OS spooler.
- Pada tablet, browser/PWA menyimpan file di OPFS/IndexedDB jika tidak memiliki akses ke directory biasa. Untuk print, tablet berkomunikasi dengan print host/local agent di jaringan lokal.
- Istilah **otomatis connect** berarti auto-discovery, pairing awal, penyimpanan preferred device, health check, dan auto-reconnect. Ini tidak berarti sistem dapat melewati instalasi driver vendor atau izin OS.

## 5. Alur pelanggan/kiosk

Alur dari sketsa harus diterapkan sebagai state machine yang eksplisit, bukan kumpulan boolean UI.

```mermaid
flowchart TD
    I["Home / idle video"] -->|"Sentuh untuk mulai"| L["Pilih layout / grid 2, 4, atau 6"]
    L --> R["Pilih frame aktif"]
    R --> C["Countdown"]
    C --> T["Ambil foto ke storage lokal"]
    T -->|"Slot belum lengkap"| C
    T -->|"Semua slot lengkap"| S["Pilih foto / retake sesuai aturan"]
    S --> D["Compose desain + frame secara lokal"]
    D --> V["Preview hasil final"]
    V --> X["Pilih jumlah cetak / tambah cetak"]
    X --> M{"Payment aktif?"}
    M -->|"Ya"| Y["Proses dan verifikasi pembayaran"]
    M -->|"Tidak"| J["Buat print job"]
    Y -->|"Berhasil"| J
    Y -->|"Gagal/timeout"| X
    J --> U["Enqueue upload ke server"]
    J --> P["Cetak dari file lokal"]
    U -->|"Server online"| Q["Tampilkan QR galeri/download"]
    U -->|"Server offline"| W["Retry di background; QR pending"]
    P --> H["Halaman selesai"]
    Q --> H
    W --> H
    H -->|"Timeout / selesai"| I
```

### Detail setiap tahap

#### A. Home / idle

- Menampilkan image/video idle dari CMS.
- Tombol atau seluruh layar dapat disentuh untuk mulai.
- Menampilkan indikator ringkas jika kamera/printer bermasalah sebelum sesi dimulai.
- Maintenance mode mengunci kiosk dan menampilkan pesan yang diatur admin.

#### B. Pilih layout dan frame

- Minimal mendukung grid 2, grid 4, dan grid 6.
- Layout menentukan jumlah slot, ukuran canvas, posisi slot, aspect ratio, rotation, crop mode, z-index, dan safe area.
- Frame adalah PNG/WebP transparan beresolusi sama dengan canvas output.
- Asset bawaan tersedia sebagai PNG transparan 1200×1800 untuk setiap tema dan grid di `public/frames/`; nama frame dicetak langsung pada overlay.
- Admin dapat mengaktifkan/menonaktifkan dan mengurutkan layout/frame.
- Filter daftar frame berdasarkan ukuran kertas, orientasi, booth, campaign, dan masa aktif.

#### C. Countdown dan capture

- Countdown dapat diatur, default 3 detik per foto.
- Berikan flash/sound cue yang dapat diaktifkan/nonaktifkan.
- Live preview mendukung mirror untuk kamera depan tanpa salah membalik file output.
- Setelah capture, simpan file original ke local directory terlebih dahulu.
- Capture berikutnya tidak boleh menunggu upload.
- Retake dapat dibatasi jumlahnya dari CMS.
- Jika kamera terputus, pause state dengan opsi reconnect; jangan menghapus sesi.

#### D. Pilih foto dan compose

- Pengguna memilih hasil foto untuk setiap slot jika jumlah capture melebihi jumlah slot.
- Setiap slot pada grid 2, 4, atau 6 dapat diedit atau di-retake secara individual tanpa mengulang seluruh sesi.
- Edit mendukung drag satu jari/mouse, pinch zoom dua jari, twist dua jari untuk rotasi bebas, rotate button, mirror, brightness, dan look/filter; hasil disimpan sebagai revisi lokal baru.
- Retake menjalankan countdown untuk slot terpilih, mengganti hanya foto aktif pada slot tersebut, dan mempertahankan revisi lama secara lokal sampai retention policy membersihkannya.
- Composer melakukan crop/fit/rotate sesuai layout, lalu menambahkan overlay frame.
- Hasil composite final beresolusi siap cetak dan dibuat secara lokal.
- Simpan original, thumbnail, preview, composite print-ready, serta metadata/checksum.
- Rendering server boleh dibuat ulang untuk validasi, tetapi hasil cetak lokal tidak boleh bergantung pada server.

#### E. Preview, jumlah cetak, dan pembayaran

- Tampilkan preview final sebelum cetak.
- Pelanggan dapat menambah jumlah copy sesuai batas konfigurasi.
- Total = harga dasar paket + harga tambahan copy, mengikuti pricing rule aktif.
- Payment bersifat configurable dan memakai provider interface; jangan mengunci implementasi hanya ke satu gateway.
- Sediakan mode `disabled`, `cash/manual confirmation`, dan `online provider`.
- Print job hanya boleh dibuat setelah status pembayaran valid, kecuali payment dinonaktifkan.

#### F. Upload, print, QR, dan selesai

- Saat print job dibuat, lakukan dua proses independen: enqueue upload dan enqueue print.
- Print membaca composite dari local directory, bukan men-download ulang dari server.
- Kegagalan upload tidak membatalkan print yang sudah sah.
- Upload session harus idempotent berdasarkan `sessionId`, `assetId`, dan checksum.
- QR galeri/download baru aktif setelah server menyimpan asset dan mengembalikan token/link publik.
- Jika offline, UI boleh menampilkan `QR sedang diproses`; queue tetap retry setelah sesi selesai.
- Setelah selesai atau timeout, reset UI ke idle tanpa menghapus queue/background job.

## 6. State machine sesi dan job

Pisahkan status sesi, pembayaran, upload, dan print supaya error pada satu proses tidak merusak proses lain.

### Session status

`CREATED -> LAYOUT_SELECTED -> CAPTURING -> REVIEWING -> COMPOSED -> CHECKOUT -> COMPLETED`

Terminal tambahan: `CANCELLED`, `EXPIRED`, `FAILED`. Session terminal tidak otomatis berarti file boleh dihapus.

### Payment status

`NOT_REQUIRED | PENDING | PAID | FAILED | EXPIRED | REFUNDED`

### Upload job status

`WAITING_FOR_PRINT_TRIGGER | QUEUED | UPLOADING | SYNCED | RETRYING | FAILED_PERMANENT`

### Print job status

`QUEUED | SPOOLING | PRINTING | PRINTED | RETRYING | FAILED | CANCELLED`

Catat setiap transisi penting dalam event/audit log dengan timestamp, booth, device, actor, error code, dan correlation ID.

## 7. Penyimpanan lokal dan kebijakan sinkronisasi

### Struktur directory yang diharapkan

Gunakan root directory yang dapat dikonfigurasi. Contoh:

```text
snapore-data/
  {boothId}/
    2026-08-04/
      {sessionId}/
        originals/
          {photoId}.jpg
        thumbnails/
          {photoId}.webp
        composites/
          print-{compositionId}.jpg
          preview-{compositionId}.webp
        metadata.json
        manifest.json
```

### Aturan penyimpanan

- Gunakan UUID/ULID; jangan memakai nama file dari input pengguna.
- Penulisan file harus atomic: tulis ke temporary file dalam directory yang sama, validasi, lalu rename.
- Hitung checksum SHA-256 untuk setiap asset.
- `manifest.json` menyimpan versi schema, daftar asset, checksum, capture source, layout, frame, dan status sync.
- Jangan tandai asset `SYNCED` sebelum server mengonfirmasi checksum/object key.
- Queue harus tetap ada setelah browser ditutup, service restart, atau listrik mati mendadak.
- Upload mendukung resume/multipart untuk file besar jika provider mendukung.
- Retry memakai exponential backoff + jitter dan dapat dipicu manual oleh operator.
- Cleanup hanya untuk asset yang memenuhi retention policy dan tidak memiliki job aktif/gagal.
- Foto dari sesi batal/tidak dicetak tetap lokal dan tidak dikirim ke server secara default; hapus otomatis sesuai retention policy.

### Default retention yang boleh dipakai sampai admin mengubahnya

- sesi batal/tidak dicetak: 24 jam;
- sesi dicetak tetapi belum sinkron: jangan dihapus;
- sesi sudah sinkron: simpan lokal 7 hari;
- semua nilai harus dapat dikonfigurasi per booth.

## 8. Dukungan kamera

Buat kontrak `CameraAdapter` konseptual dengan operasi minimal:

- `discover()`;
- `connect(deviceId)`;
- `disconnect()`;
- `getCapabilities()`;
- `startPreview()` / `stopPreview()`;
- `capture()`;
- `setConfig()` bila device mendukung;
- `getHealth()`;
- event `connected`, `disconnected`, `captureReady`, dan `error`.

### Adapter minimum

1. **Laptop/tablet camera:** MediaDevices/getUserMedia.
2. **USB webcam:** MediaDevices; native adapter opsional untuk kontrol lanjutan.
3. **DSLR tethered:** adapter terpisah berdasarkan driver/SDK yang tersedia.
4. **Remote tablet camera:** browser tablet melakukan capture lokal dan mengirim hasil ke session host melalui koneksi LAN yang terautentikasi bila tablet bukan layar kiosk utama.

### Konfigurasi kamera

- preferred camera per booth;
- resolution dan aspect ratio;
- front/rear lens pada tablet;
- mirror preview versus mirror output;
- orientation/rotation;
- autofocus/manual focus jika SDK mendukung;
- ISO, aperture, shutter, white balance jika DSLR adapter mendukung;
- capture timeout dan retry;
- fallback camera dan pesan operator.

## 9. Dukungan printer

Buat kontrak `PrinterAdapter` konseptual dengan operasi minimal:

- `discover()`;
- `connect(printerId)`;
- `getCapabilities()`;
- `getStatus()`;
- `print(file, profile, copies)`;
- `cancel(jobId)` jika didukung;
- `getQueue()`;
- event `connected`, `disconnected`, `paperLow`, `paperOut`, `jobUpdated`, dan `error`.

### Adapter minimum

1. **Generic OS spooler:** jalur utama untuk printer dengan driver terpasang.
2. **DNP photo printer:** gunakan driver/vendor support, media size, status, dan finishing yang tersedia.
3. **Epson inkjet:** gunakan OS spooler atau SDK resmi untuk paper size, borderless, quality, dan color profile.
4. **Thermal/ESC-POS:** USB/LAN/serial untuk receipt atau raster image monokrom sesuai kemampuan printer.

### Printer profile

Setiap profile menyimpan:

- printer adapter dan OS device ID;
- ukuran media, orientasi, DPI, margin/bleed;
- mode borderless;
- color profile/ICC bila tersedia;
- crop/fit strategy;
- jenis output: `PHOTO`, `RECEIPT`, atau `BOTH`;
- max copies;
- default printer dan fallback printer;
- estimated media capacity dan software paper counter.

Paper counter dari dashboard harus dianggap estimasi kecuali printer memang menyediakan sensor/status akurat. Operator dapat melakukan reset setelah mengganti media dan semua perubahan harus diaudit.

### Perilaku automatic connection

- scan USB/LAN/OS spooler saat agent start dan secara periodik;
- simpan device fingerprint, bukan hanya display name;
- prioritaskan preferred device;
- lakukan reconnect dengan backoff;
- jangan berpindah diam-diam ke printer lain jika ukuran media/profile tidak kompatibel;
- tampilkan alasan perangkat tidak siap: driver hilang, offline, paper out, media mismatch, permission denied, atau job stuck.

## 10. CMS dan dashboard

### Dashboard utama

- status online/offline semua booth;
- last heartbeat;
- kamera aktif dan statusnya;
- printer aktif, antrean, error, serta paper counter;
- jumlah sesi, hasil cetak, upload tertunda/gagal, omzet, dan payment status;
- maintenance toggle per booth;
- notifikasi device disconnected, storage hampir penuh, upload backlog, paper low/out, dan print gagal.

### Manajemen layout dan frame

- upload PNG/WebP transparan;
- buat layout grid 2/4/6 atau layout custom;
- editor slot foto dengan posisi `x`, `y`, `width`, `height`, rotation, crop mode, mask, border radius, dan z-index;
- preview berdasarkan ukuran output sebenarnya;
- sort drag-and-drop;
- active/inactive;
- schedule `activeFrom` dan `activeUntil`;
- versioning agar sesi lama tetap merujuk versi frame yang benar;
- validasi dimensi/resolusi sebelum publish.

### Pricing dan payment settings

- harga dasar per layout/package/media size;
- harga tambahan per copy;
- tax/service fee opsional;
- payment on/off;
- provider configuration disimpan terenkripsi;
- aturan promo/campaign dapat ditambahkan kemudian tanpa mengubah core print flow.

### Idle media dan gamification

- upload/sort image atau video idle;
- duration, mute, schedule, dan target booth;
- opsi game/high score sesuai sketsa sebagai modul yang dapat dinonaktifkan;
- game tidak boleh mengganggu core photo flow.

### Data pelanggan, sesi, dan reprint

- pencarian berdasarkan session code, tanggal, booth, dan payment reference;
- galeri thumbnail dengan akses sesuai role;
- detail timeline sesi, selected photos, composition, upload, payment, dan print jobs;
- tombol reprint harus membuat print job baru, mencatat actor/alasan, dan mengikuti kebijakan pembayaran/izin;
- popup preview foto tidak boleh otomatis memuat original penuh jika thumbnail cukup;
- export laporan tanpa mengekspos public asset URL permanen.

### User dan role

Minimal role: `SUPER_ADMIN`, `ADMIN`, `OPERATOR`, dan `VIEWER`. Terapkan authorization di server, bukan hanya menyembunyikan tombol di UI.

## 11. Model data konseptual Prisma

Jangan langsung menyalin daftar ini menjadi schema tanpa normalisasi dan review. Siapkan ERD untuk entitas minimum:

- `User`, `Role`, `UserRole`, `AuditLog`;
- `Booth`, `BoothSetting`, `Device`, `DeviceHeartbeat`;
- `CameraProfile`, `PrinterProfile`, `PaperCounter`;
- `Layout`, `LayoutVersion`, `LayoutSlot`;
- `Frame`, `FrameVersion`, `IdleMedia`;
- `PhotoSession`, `CapturedPhoto`, `Composition`, `Asset`;
- `PricingRule`, `Order`, `OrderItem`;
- `Payment`, `PaymentEvent`;
- `PrintJob`, `PrintAttempt`;
- `UploadJob`, `UploadAttempt`;
- `Gallery`, `GalleryToken`;
- `SystemEvent` atau domain event setara.

Semua record penting menggunakan timezone-aware timestamp, unique constraint yang jelas, soft delete bila relevan, optimistic concurrency/version, dan idempotency key untuk mutation dari perangkat.

## 12. API dan komunikasi realtime

Rancang kontrak API versioned dan typed. Minimum domain endpoint/event:

- booth registration, pairing, config pull, dan heartbeat;
- device discovery/status/capability;
- create/resume/cancel/complete session;
- frame/layout catalog dan version sync;
- payment create/status/webhook/manual confirmation;
- create/update/retry print job;
- initiate upload, presigned part upload, finalize, dan checksum confirmation;
- issue/revoke/expire gallery token;
- dashboard metrics dan session search;
- CMS CRUD dengan audit trail.

Gunakan WebSocket atau Server-Sent Events untuk device/job status jika berguna, tetapi core state tetap harus dapat dipulihkan dari database. Event realtime bukan source of truth.

## 13. Keamanan dan privasi

- Gunakan authentication yang aman untuk admin/operator dan short-lived device credentials untuk booth.
- Pairing perangkat membutuhkan kode/approval admin dan dapat dicabut.
- Batasi local agent ke `localhost` secara default; mode LAN harus memakai pairing, allowlist origin, token, dan idealnya TLS.
- Validasi MIME, magic bytes, dimensi, ukuran, dan nama asset upload.
- Public gallery memakai random short-lived token; jangan mengekspos object storage key langsung.
- Enkripsi secret provider dan jangan kirim secret admin ke kiosk.
- Terapkan rate limit untuk auth, payment, gallery, dan sync API.
- Simpan consent/retention setting sesuai kebijakan bisnis.
- Sediakan delete/anonymize workflow yang juga menghapus object storage dan mencatat audit tanpa menyimpan data foto yang dihapus.
- Log tidak boleh menyimpan binary, access token, payment secret, atau data pribadi yang tidak diperlukan.

## 14. Ketahanan dan penanganan error

Sistem wajib memiliki perilaku jelas untuk:

- internet mati sebelum/sesudah pembayaran;
- server restart ketika upload berjalan;
- browser refresh atau kiosk app crash;
- local agent restart;
- listrik mati setelah payment tetapi sebelum print;
- kamera terlepas saat countdown/capture;
- printer offline, paper out, media mismatch, atau job stuck;
- file local rusak/checksum berbeda;
- storage hampir penuh;
- duplicate webhook/payment callback;
- tombol print ditekan berkali-kali;
- server menerima upload/session yang sama lebih dari sekali.

Gunakan outbox/queue persisten, idempotency key, transactional updates, bounded retry, dead-letter/manual intervention state, dan recovery saat startup.

## 15. UX dan tampilan

- Prioritaskan resolusi kiosk portrait dan landscape; responsive untuk tablet.
- Touch target besar, teks mudah dibaca, dan langkah maksimal terlihat jelas.
- Jangan tampilkan kontrol browser/OS kepada pelanggan.
- Gunakan visual countdown, capture cue, progress slot, serta status print yang jujur.
- Timeout tiap halaman configurable dan memberi peringatan sebelum reset.
- Admin editor harus memiliki preview canvas yang merepresentasikan output print secara akurat.
- UI minimal tersedia dalam Bahasa Indonesia; siapkan struktur i18n untuk bahasa lain.
- Penuhi aksesibilitas dasar: contrast, focus state, label, reduced motion, dan alternatif visual/suara.

## 16. Observability dan operasi

- Structured logs dengan correlation ID/session ID/job ID.
- Metrics: capture success, compose duration, payment conversion, print success/failure, upload latency/backlog, device uptime, dan disk usage.
- Health endpoint untuk server dan local agent.
- Dashboard menampilkan versi app/agent/config terakhir.
- Audit setiap maintenance toggle, paper reset, manual payment, reprint, frame publish, serta perubahan harga.
- Siapkan update strategy local agent yang aman; jangan auto-update ketika ada sesi atau print job aktif.

## 17. Testing wajib saat implementasi

- Unit test untuk state machine, pricing, layout composition math, retry, dan idempotency.
- Integration test untuk Prisma, API, local queue, file manifest, dan payment webhook.
- Contract test untuk camera/printer adapters menggunakan fake devices.
- Visual/golden test untuk hasil layout grid 2/4/6.
- End-to-end test kiosk dari idle sampai selesai.
- Offline/recovery test dengan server mati, agent restart, dan koneksi putus.
- Hardware smoke test matrix untuk setiap model kamera/printer yang benar-benar digunakan.
- Jangan menyatakan semua perangkat didukung hanya karena fake adapter lulus.

## 18. Kriteria penerimaan minimum

Implementasi kelak dianggap memenuhi versi awal jika:

1. Kiosk dapat menyelesaikan flow idle sampai print dengan camera laptop/webcam dan satu printer melalui OS spooler.
2. Foto original dan composite terbukti tersimpan lokal sebelum ada upload.
3. Tidak ada request upload asset pada tahap capture/review.
4. Print confirmation membuat upload job dan print job terpisah dengan idempotency key.
5. Internet dapat dimatikan saat print dan hasil tetap tercetak dari file lokal.
6. Setelah internet kembali, queue otomatis menyinkronkan asset tanpa duplikasi.
7. Browser/agent restart tidak menghilangkan sesi sah, upload queue, atau print job.
8. Admin dapat mengelola grid 2/4/6, frame, harga, idle media, dan maintenance mode.
9. Operator dapat melihat status kamera, printer, paper counter, disk, dan retry job gagal.
10. Preferred device otomatis tersambung kembali jika driver/perangkat tersedia.
11. Reprint menghasilkan job dan audit record baru, bukan mengubah histori print lama.
12. QR galeri hanya muncul setelah upload/finalize berhasil dan token memiliki expiry.
13. Integrasi DSLR, DNP, Epson, dan thermal mengikuti capability adapter serta hardware test matrix.

## 19. Default keputusan untuk proposal awal

Jika belum ada keputusan lain dari pemilik project, gunakan asumsi awal berikut hanya untuk membuat rencana:

- target kiosk desktop pertama: Windows;
- database server: PostgreSQL melalui Prisma;
- local agent store: SQLite/persistent embedded database;
- server assets: S3-compatible object storage;
- output foto awal: 4x6 inch, 300 DPI, tetap configurable;
- grid awal: 2, 4, dan 6;
- payment awal: disabled/manual dengan provider interface sudah disiapkan;
- upload berjalan asynchronous ketika print job dibuat dan tidak memblokir print lokal;
- QR hanya aktif setelah sinkronisasi server berhasil;
- satu booth untuk pilot, tetapi semua data utama memiliki `boothId`;
- thermal printer diperlakukan terutama sebagai receipt printer kecuali model yang dipilih memang mendukung kualitas photo raster yang dibutuhkan.

Asumsi ini bukan pengganti konfirmasi model kamera, model printer, ukuran media, payment provider, target OS, lokasi server, dan kebijakan retensi sebelum integrasi hardware dimulai.

## 20. Tahapan implementasi yang nanti harus diusulkan AI

AI harus membuat estimasi dan breakdown sebelum coding, sekurang-kurangnya:

1. discovery hardware dan proof of concept adapter;
2. monorepo/foundation, auth, Prisma, booth pairing;
3. local agent, filesystem, persistent state, dan fake devices;
4. kiosk flow dan camera MediaDevices;
5. layout/frame composer dan visual tests;
6. print spooler dan printer profile;
7. upload sync, object storage, gallery, dan QR;
8. order/payment abstraction;
9. CMS/dashboard/operator tools;
10. DSLR/DNP/Epson/thermal adapters berdasarkan model nyata;
11. recovery, security hardening, observability, dan deployment;
12. hardware acceptance test di booth.

Setiap fase harus memiliki demo, test, migration/rollback plan, serta definition of done. Dahulukan vertical slice yang dapat mengambil foto lokal, membuat composite, dan mencetak melalui fake/OS devices sebelum memperluas semua vendor adapter.

## 21. Voice-over kiosk lokal

- Kiosk memakai rekaman perempuan Bahasa Indonesia `id-ID-GadisNeural`, bukan voice bawaan sistem operasi.
- Sebanyak 29 cue MP3 disimpan di `public/voice/id-ID-gadis`, mencakup semua tahap, countdown, feedback foto, reset, dan retake foto 1-8.
- Audio diputar dari file lokal sehingga suara konsisten dan tidak berubah menjadi voice laki-laki ketika kiosk berpindah perangkat.
- Untuk membuat ulang aset: pasang `edge-tts` ke `.tools/edge-tts`, lalu jalankan `npm run voice:generate`. Script sumber berada di `scripts/generate-voiceovers.py`.
- Jika autoplay browser diblokir, tombol voice menampilkan `Sentuh untuk suara`; satu sentuhan mengaktifkan rekaman tanpa mengganti voice.

---

## Instruksi penutup untuk AI coding agent

Jangan mulai membuat aplikasi hanya berdasarkan kata-kata "buat sistem" yang ada di dalam dokumen ini. README ini adalah spesifikasi target. Pada respons pertama setelah menerima prompt ini, keluarkan hanya:

1. ringkasan pemahaman;
2. risiko dan batasan hardware;
3. proposal arsitektur dan struktur repository;
4. ERD konseptual;
5. state machine dan kontrak adapter;
6. fase pengerjaan beserta acceptance test;
7. daftar singkat keputusan pemilik project yang masih diperlukan.

Setelah itu berhenti dan tunggu perintah eksplisit **"mulai implementasi"**.
