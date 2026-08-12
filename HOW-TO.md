# HOW TO — Snapore

## Canon EOS R100 tanpa EDSDK (gPhoto2/PTP)

Snapore memakai **Picture Transfer Protocol (PTP)** melalui gPhoto2. Alurnya adalah Electron/Next.js → HTTP device agent → gPhoto2/PTP → Canon R100 melalui USB. EDSDK, `EDSDK.dll`, dan bridge Canon tidak digunakan.

### Persiapan Windows 11

1. Pasang WSL 2 + Ubuntu, lalu dari Ubuntu jalankan:

   ```bash
   sudo apt update
   sudo apt install -y gphoto2 libgphoto2-6
   gphoto2 --version
   ```

   Jika instalasi Ubuntu gagal dengan `0x80370102` walaupun virtualisasi BIOS sudah aktif, buka PowerShell sebagai Administrator lalu jalankan:

   ```powershell
   wsl --install --no-distribution
   bcdedit /set hypervisorlaunchtype auto
   ```

   Restart Windows, kemudian ulangi `wsl --install --distribution Ubuntu`.

2. Pasang `usbipd-win` dari PowerShell:

   ```powershell
   winget install usbipd
   usbipd list
   ```

3. Cari `BUSID` Canon EOS R100. Satu kali saja, jalankan PowerShell sebagai Administrator:

   ```powershell
   usbipd bind --busid <BUSID>
   ```

4. Setiap kamera dipasang kembali atau komputer restart, buka Ubuntu agar WSL aktif lalu jalankan PowerShell biasa:

   ```powershell
   usbipd attach --wsl --busid <BUSID>
   wsl --exec gphoto2 --auto-detect
   ```

   Selama R100 attached ke WSL, kamera tidak bisa digunakan bersamaan oleh aplikasi Windows lain. Tutup EOS Utility/EOS Webcam Utility sebelum attach.

### Konfigurasi Snapore

Isi `%APPDATA%\Snapore Desktop\snapore.env`:

```env
SNAPORE_CAMERA_PTP_MODE="wsl"
SNAPORE_GPHOTO2_PATH="gphoto2"
SNAPORE_GPHOTO2_WSL_DISTRO=""
SNAPORE_GPHOTO2_IMAGE_FORMAT=""
SNAPORE_CAMERA_USBIPD_AUTO_ATTACH="true"
SNAPORE_CAMERA_PREFERRED_MODEL="EOS R100"
SNAPORE_CAMERA_AUTO_SWITCH="true"
SNAPORE_CAMERA_CAPTURE_TIMEOUT_MS="45000"
SNAPORE_CAMERA_PREVIEW_TIMEOUT_MS="15000"
SNAPORE_CAMERA_PREVIEW_STREAM="true"
SNAPORE_CAMERA_PREVIEW_IDLE_MS="1500"
```

Jika ada lebih dari satu distro, isi `SNAPORE_GPHOTO2_WSL_DISTRO`, misalnya `Ubuntu-24.04`. Untuk Linux native atau build gPhoto2 Windows yang kompatibel, gunakan `SNAPORE_CAMERA_PTP_MODE="native"` dan arahkan `SNAPORE_GPHOTO2_PATH` ke executable.

Atur mode kamera ke foto (P/Av/Tv/M), matikan Wi-Fi/Bluetooth kamera jika koneksi USB tidak stabil, dan pilih kualitas JPEG atau RAW+JPEG. Jika kamera hanya menghasilkan RAW, isi `SNAPORE_GPHOTO2_IMAGE_FORMAT` sesuai pilihan yang tampil dari `gphoto2 --get-config imageformat`, atau ubah kualitas langsung pada kamera.

Perilaku otomatis:

- Device agent mendeteksi model dan port R100 setiap lima detik.
- Jika R100 berstatus `Shared`, device agent otomatis menjalankan `usbipd attach --wsl`; `bind` Administrator hanya perlu dilakukan sekali.
- R100 yang tersambung dipilih otomatis, shutter dipicu, lalu foto langsung diunduh dalam panggilan yang sama.
- Saat masuk ke langkah pengambilan foto, device agent membuka satu stream movie JPEG dan hanya mengirim frame terbaru ke kiosk. Stream berhenti otomatis setelah idle atau sebelum shutter, sehingga preview lancar tanpa menahan capture resolusi penuh.
- Jika R100 dilepas atau capture gagal, kiosk beralih ke kamera bawaan laptop.
- Saat R100 kembali, device agent mengaktifkannya lagi tanpa restart aplikasi.

Setelah mengubah `snapore.env`, tutup lalu buka kembali Snapore Desktop.

## Upload online setelah print

Saat tombol **Confirm & print** ditekan, Snapore membuat print job dan upload job secara bersamaan. Jika internet tersedia, seluruh foto raw serta composite hasil print dikirim ke API server online dan disimpan berdasarkan pola:

`https://photobooth.elevore.web.id/uploads/{boothCode}/{sessionId}/{fileName}`

Jika koneksi terputus, job tetap berada di antrean lokal dengan status **RETRYING** dan device agent akan mengunggahnya otomatis ketika server kembali dapat dijangkau.

Konfigurasi yang digunakan:

| Environment | Fungsi |
| --- | --- |
| `NEXT_PUBLIC_SNAPORE_SERVER_URL` | Tujuan API upload untuk browser fallback/desktop kiosk. |
| `SNAPORE_SERVER_URL` | Tujuan API upload untuk device agent. |
| `SNAPORE_SERVER_UPLOAD_DIR` | Folder fisik pada server tempat file ditulis. Folder ini harus dipetakan web server ke `/uploads/`. |
| `SNAPORE_PUBLIC_UPLOAD_BASE_URL` | Base URL publik file hasil upload. |
| `SNAPORE_PUBLIC_APP_URL` | Domain publik untuk link galeri QR. |
| `SNAPORE_UPLOAD_ALLOWED_ORIGINS` | Daftar origin kiosk yang boleh melakukan upload lintas domain; pisahkan dengan koma atau gunakan `*`. |
| `SNAPORE_SERVER_ORIGINAL_MAX_EDGE` | Batas sisi terpanjang foto raw tanpa frame yang disimpan server; default `2400`. |
| `SNAPORE_SERVER_ORIGINAL_JPEG_QUALITY` | Kualitas JPEG foto raw server; default `78`. |
| `SNAPORE_SERVER_COMPOSITE_MAX_EDGE` | Batas sisi terpanjang hasil dengan frame pada server; default `1800`. |
| `SNAPORE_SERVER_COMPOSITE_JPEG_QUALITY` | Kualitas JPEG hasil dengan frame pada server; default `86`. |

Untuk production, pastikan proses Next.js memiliki izin tulis pada `SNAPORE_SERVER_UPLOAD_DIR`. URL `/uploads/` adalah lokasi publik file, sedangkan pengiriman file dilakukan melalui endpoint `POST /api/sync/sessions` pada domain server. API mengubah seluruh asset server menjadi JPEG progresif teroptimasi dan mencatat byte sumber versus byte tersimpan. Composite lokal yang dibaca printer tidak diubah, sehingga optimasi storage tidak menurunkan kualitas cetak.

## Melanjutkan sesi setelah refresh

Kiosk menyimpan langkah aktif dan foto sesi secara lokal. Jika halaman direfresh, aplikasi akan menampilkan **Memulihkan sesi photobooth...** lalu kembali ke langkah terakhir—bukan ke layar **Touch to start**.

State yang dipulihkan mencakup pilihan layout/frame, foto dan urutannya, edit per foto, retake, pembayaran yang masih berjalan, timer sesi, checkout, dan status sinkronisasi. Jika refresh terjadi tepat saat countdown/capture, capture yang sudah selesai akan dimuat dan proses dilanjutkan dari pose berikutnya.

- Gunakan **Start over**, **Finish**, atau reset resmi untuk menghapus sesi aktif dan kembali ke awal.
- Jangan membersihkan site data/IndexedDB browser selama sesi berlangsung karena foto pemulihan disimpan di perangkat kiosk.
- Sesi yang waktunya sudah habis tetap dipulihkan dan menampilkan pilihan untuk melanjutkan atau mengakhiri sesi.

## Navigasi keyboard foto kiosk

Shortcut berikut aktif pada langkah **04 · Edit & retake**. Klik area kosong pada halaman kiosk terlebih dahulu jika fokus keyboard sedang berada pada tombol, input, atau slider.

### Memilih dan menukar foto di halaman review

| Tombol | Fungsi |
| --- | --- |
| `←` / `→` | Memilih foto sebelumnya atau berikutnya. Foto aktif ditandai dengan label **Dipilih** dan garis biru. |
| `Shift + ←` / `Shift + →` | Menukar foto aktif dengan posisi sebelumnya atau berikutnya. Urutan akan berputar dari foto pertama ke terakhir, dan sebaliknya. |
| `Enter` atau `E` | Membuka editor untuk foto yang sedang dipilih. |
| `R` | Melakukan retake pada foto yang dipilih jika kuota retake masih tersedia. |

Foto juga dapat dipilih menggunakan mouse atau layar sentuh. Drag-and-drop tetap tersedia untuk menukar posisi foto.

### Mengedit foto menggunakan keyboard

| Tombol | Fungsi |
| --- | --- |
| `←` / `→` / `↑` / `↓` | Menggeser posisi foto sebesar 1%. |
| `Shift + tombol panah` | Menggeser posisi foto sebesar 5% untuk penyesuaian lebih cepat. |
| `+` / `-` | Zoom in atau zoom out. |
| `Q` / `E` | Memutar foto 1° ke kiri atau kanan. Gunakan `Shift + Q/E` untuk rotasi 15°. |
| `M` | Mengaktifkan atau menonaktifkan mirror. |
| `0` | Mengembalikan pengaturan edit foto aktif ke kondisi awal. |
| `Page Up` atau `[` | Menyimpan edit foto aktif lalu membuka foto sebelumnya. |
| `Page Down` atau `]` | Menyimpan edit foto aktif lalu membuka foto berikutnya. |
| `Ctrl + Enter` | Menyimpan edit dan menutup editor. Pada macOS dapat menggunakan `Command + Enter`. |
| `Esc` | Menutup editor tanpa menyimpan perubahan foto yang sedang aktif. |

Tombol panah tetap bekerja berulang saat ditahan. Shortcut editor tidak mengambil alih keyboard ketika fokus berada pada input, slider, tombol, tautan, atau elemen teks yang sedang diedit.

### Catatan pergantian foto

- Tombol navigasi kiri/kanan di bagian atas editor memiliki fungsi yang sama dengan `Page Up` dan `Page Down`.
- Saat berpindah ke foto lain dari editor, edit foto aktif disimpan sebagai revisi baru terlebih dahulu.
- Kuota retake mengikuti konfigurasi masing-masing kiosk; tombol `R` tidak akan mengganti foto jika kuota sudah habis.
- Shortcut rahasia kiosk seperti `Ctrl + Z + X` tetap dapat digunakan dan tidak bentrok dengan shortcut editor.
