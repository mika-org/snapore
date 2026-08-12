# Build Snapore Desktop untuk Windows

Snapore Desktop memakai Electron sebagai window native. Saat aplikasi dibuka, launcher menjalankan dua service hanya pada loopback:

- Next.js standalone pada `http://127.0.0.1:3765`;
- device agent kamera/printer pada `http://127.0.0.1:4545`.

Renderer Electron tidak mendapat akses Node.js. Permission kamera hanya diberikan ke origin web lokal Snapore, navigasi non-lokal diblokir, dan link HTTPS dibuka di browser sistem.

## Prasyarat build

- Windows 10/11 x64;
- Node.js yang kompatibel dengan versi Next.js di repository;
- npm;
- PostgreSQL yang sudah menjalankan migration Prisma;
- driver Windows resmi untuk printer DNP/Epson yang dipakai.

Install dependency lalu verifikasi aplikasi web terlebih dahulu:

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Command desktop

| Command | Hasil |
| --- | --- |
| `npm run desktop:prepare` | Build Next standalone, bundle device agent, salin public/static assets, buat icon, dan audit agar `.env` tidak masuk runtime. |
| `npm run desktop:start` | Siapkan runtime lalu buka aplikasi Electron dari source. |
| `npm run desktop:pack` | Buat folder unpacked untuk smoke test cepat tanpa installer. |
| `npm run desktop:dist:installer` | Buat installer NSIS Windows x64. |
| `npm run desktop:dist:portable` | Buat satu executable portable Windows x64. |
| `npm run desktop:dist` | Buat installer dan portable sekaligus. |

Artifact akhir berada di `release/`:

- `Snapore-Desktop-Setup-<version>-x64.exe`;
- `Snapore-Desktop-Portable-<version>-x64.exe`;
- folder `win-unpacked/` ketika memakai `desktop:pack`.

## Konfigurasi runtime

Pada pembukaan pertama, aplikasi membuat file berikut:

```text
%APPDATA%\Snapore Desktop\
├── desktop.config.json
├── snapore.env
├── data\
│   ├── agent\
│   ├── frame-assets\
│   └── server-uploads\
└── logs\desktop.log
```

`snapore.env` wajib memiliki `DATABASE_URL`. `SESSION_SECRET`, `APP_ENCRYPTION_KEY`, dan `SNAPORE_DEVICE_TOKEN` dibuat acak secara lokal pada pembukaan pertama. Jangan membagikan file ini atau memasukkannya ke installer.

Contoh minimum:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB?schema=SCHEMA"
SNAPORE_BOOTH_CODE="BKK-001"
SNAPORE_PRINTER_MODE="os-spooler"
```

Canon EOS R100 memakai gPhoto2/PTP melalui WSL. Untuk bridge SDK printer atau kamera vendor lain, gunakan path absolut yang tersedia pada PC kiosk:

```dotenv
SNAPORE_DNP_SDK_BRIDGE="C:\\SnaporeBridges\\dnp-bridge.exe"
SNAPORE_EPSON_SDK_BRIDGE="C:\\SnaporeBridges\\epson-bridge.exe"
SNAPORE_CAMERA_SDK_BRIDGE="C:\\SnaporeBridges\\camera-vendor-bridge.exe"
SNAPORE_CAMERA_SDK_KIND="VENDOR_SDK"
SNAPORE_CAMERA_PREVIEW_TIMEOUT_MS="15000"
```

Lihat [HOW-TO.md](../HOW-TO.md) untuk pemasangan WSL, gPhoto2, `usbipd`, dan konfigurasi Canon EOS R100.

Perubahan `snapore.env` diterapkan setelah aplikasi dimulai ulang.
Untuk deployment/CI, path file environment dapat dioverride sementara melalui environment variable `SNAPORE_ENV_FILE` tanpa menyalin rahasianya ke installer. Direktori profil juga dapat diisolasi melalui `SNAPORE_USER_DATA_DIR`.

## Pengaturan window

`desktop.config.json` menerima pengaturan berikut:

```json
{
  "webPort": 3765,
  "startPath": "/login",
  "openDevTools": false,
  "window": {
    "width": 1440,
    "height": 900,
    "minWidth": 1024,
    "minHeight": 700,
    "fullscreen": false,
    "kiosk": false
  }
}
```

Untuk satu booth khusus, ubah `startPath` menjadi `/kiosk/<booth-uuid>`. Gunakan `fullscreen: true` untuk tampilan penuh yang masih dapat keluar dengan F11, atau `kiosk: true` untuk mode kiosk terkunci tanpa menu aplikasi.

## Konfigurasi installer

`electron-builder.yml` mengatur:

- App ID `id.snapore.photobooth`;
- target NSIS dan portable Windows x64;
- instalasi per-user tanpa hak Administrator;
- shortcut Desktop dan Start Menu;
- runtime Next/agent sebagai `extraResources` di luar ASAR;
- nama executable `Snapore.exe`.

Build saat ini belum ditandatangani dengan sertifikat code-signing. Windows SmartScreen dapat menampilkan peringatan pada PC lain. Untuk distribusi produksi, tambahkan sertifikat code-signing melalui environment electron-builder/CI dan jangan menyimpan file sertifikat atau password-nya di repository.

## Migration database

Launcher desktop tidak menjalankan migration otomatis agar satu instalasi kiosk tidak mengubah database produksi tanpa kontrol. Jalankan dari workstation deployment sebelum membagikan versi baru:

```bash
npm run db:deploy
```

## Troubleshooting

- Buka menu **Aplikasi → Buka log** untuk melihat startup server/agent.
- Jika port 3765 dipakai, ubah `webPort` lalu restart.
- Port agent 4545 sengaja tetap agar URL agent yang dibundel di frontend konsisten.
- Jika kamera tidak tampil, periksa izin Camera untuk Snapore/Desktop apps di Windows Settings.
- Untuk Canon EOS R100, pastikan `usbipd list` menunjukkan kamera `Attached` dan `wsl --exec gphoto2 --auto-detect` menampilkan kamera PTP.
- Jika printer tidak terdeteksi, pastikan queue printer fisik terlihat di Windows dan drivernya tidak offline.
- DNP 2-inch cut tetap memerlukan bridge SDK vendor atau queue Windows khusus yang driver-nya sudah mengaktifkan mode potong tersebut.
