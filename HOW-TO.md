# HOW TO — Snapore

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
