# Account & Access Credentials — Snapore Photobooth

Dokumen ini berisi informasi kredensial dan akun default yang digunakan untuk pengembangan lokal (development environment).

---

## 🔑 Akun Default Development

### 1. Super Admin
Digunakan untuk mengakses Control Plane global, mengelola tenant, user, booth, pajak, dan secret terenkripsi.

- **URL Login**: [http://localhost:3000/login](http://localhost:3000/login) atau [http://localhost:3000/super-admin](http://localhost:3000/super-admin)
- **Role**: `SUPER_ADMIN`
- **Email / Username**: `superadmin@snapore.local`
- **Password**: `Snapore@2026!`

---

### 2. Tenant Admin (Snapore Default Tenant)
Digunakan untuk mengelola CMS booth, upload frame, dan pengaturan tenant.

- **URL Login**: [http://localhost:3000/login](http://localhost:3000/login) atau [http://localhost:3000/admin](http://localhost:3000/admin)
- **Role**: `ADMIN`
- **Email / Username**: `admin@snapore.local`
- **Password**: `Snapore@2026!`

---

## 📌 Endpoint & Akses Aplikasi

- **Web Dashboard Tenant**: [http://localhost:3000](http://localhost:3000)
- **Super Admin Console**: [http://localhost:3000/super-admin](http://localhost:3000/super-admin)
- **CMS / Admin Tenant**: [http://localhost:3000/admin](http://localhost:3000/admin)
- **Local Device Agent Health**: [http://127.0.0.1:4545/health](http://127.0.0.1:4545/health)

---

> ⚠️ **PENTING**: Kredensial di atas diambil dari seed awal (`prisma/seed.ts` & `.env`). Selalu ganti seluruh password dan secret sebelum melakukan deployment ke lingkungan produksi!
