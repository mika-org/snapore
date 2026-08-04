import { Aperture, ShieldAlert } from "lucide-react";

export function KioskUnavailable({ boothName, boothCode, reason }: { boothName: string; boothCode: string; reason: string }) {
  return (
    <main className="kiosk-unavailable">
      <div className="kiosk-unavailable-brand"><span><Aperture size={22} strokeWidth={3} /></span> SNAPORE</div>
      <section>
        <span className="kiosk-unavailable-icon"><ShieldAlert size={34} /></span>
        <div className="kiosk-eyebrow">Booth maintenance · {boothCode}</div>
        <h1>SEGERA<br /><em>KEMBALI.</em></h1>
        <p>{boothName} belum dapat menerima sesi baru. {reason}</p>
        <small>Silakan hubungi petugas booth. Halaman akan aktif kembali setelah konfigurasi tersedia dan booth diaktifkan.</small>
      </section>
    </main>
  );
}
