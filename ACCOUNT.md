# Account & Access Credentials — Snapore Photobooth

Dokumen ini mencatat akun development yang terakhir diverifikasi terhadap PostgreSQL schema `snapore` pada **10 Agustus 2026**.

> Gunakan hanya untuk development/internal deployment. Jangan membagikan file ini bersama installer produksi dan ganti seluruh password sebelum go-live.

## Akun aktif

### 1. Super Admin

- **Nama**: `Snapore Super Admin`
- **Role**: `SUPER_ADMIN`
- **Status database**: `ACTIVE`
- **Email / Username**: `superadmin@snapore.local`
- **Password aktif terverifikasi**: `Snapore#Super73`
- **Akses web lokal**: [http://localhost:3000/super-admin](http://localhost:3000/super-admin)
- **Akses desktop**: [http://127.0.0.1:3765/super-admin](http://127.0.0.1:3765/super-admin)

Password telah di-reset pada **10 Agustus 2026**, diverifikasi terhadap hash database, dan reset tercatat pada `AuditLog` dengan action `USER_PASSWORD_RESET_RECOVERY`.

### 2. Tenant Admin — Snapore Default Tenant

- **Nama**: `Snapore Tenant Admin`
- **Role**: `ADMIN`
- **Status database**: `ACTIVE`
- **Email / Username**: `admin@snapore.local`
- **Password aktif terverifikasi**: `Snapore#Admin73`
- **Akses web lokal**: [http://localhost:3000/admin](http://localhost:3000/admin)
- **Akses desktop**: [http://127.0.0.1:3765/admin](http://127.0.0.1:3765/admin)

## Endpoint aplikasi

- **Login web lokal**: [http://localhost:3000/login](http://localhost:3000/login)
- **Login desktop**: [http://127.0.0.1:3765/login](http://127.0.0.1:3765/login)
- **Dashboard tenant**: [http://localhost:3000](http://localhost:3000)
- **CMS tenant**: [http://localhost:3000/admin](http://localhost:3000/admin)
- **Device agent health**: [http://127.0.0.1:4545/health](http://127.0.0.1:4545/health)

## Sumber konfigurasi

- Super Admin bootstrap: `SUPER_ADMIN_EMAIL` dan `SUPER_ADMIN_PASSWORD`.
- Tenant Admin bootstrap: `ADMIN_PASSWORD`; bila kosong, seed memakai `Snapore#Admin73`.
- Seed tidak mereset password akun lama kecuali `SNAPORE_RESET_SEED_PASSWORDS=true` digunakan secara sengaja.
- Installer desktop tidak menyertakan `ACCOUNT.md`, `.env`, atau password database.
