/* eslint-disable @next/next/no-img-element -- QR code is generated as a client-side data URL */
"use client";

import { Copy, ExternalLink, LoaderCircle, QrCode, X } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

type GalleryLinkResponse = {
  galleryUrl?: string;
  expiresAt?: string;
  error?: string;
};

export function SessionGalleryPreview({ sessionId, publicCode, available }: { sessionId: string; publicCode: string; available: boolean }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [galleryUrl, setGalleryUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!dialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialogOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [dialogOpen]);

  const loadGalleryLink = async () => {
    setDialogOpen(true);
    setCopied(false);
    if (galleryUrl && qrDataUrl) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/gallery-link`, { method: "POST" });
      const payload = await response.json().catch(() => null) as GalleryLinkResponse | null;
      if (!response.ok || !payload?.galleryUrl || !payload.expiresAt) {
        throw new Error(payload?.error ?? "Link gallery gagal dibuat.");
      }
      const qr = await QRCode.toDataURL(payload.galleryUrl, {
        width: 360,
        margin: 1,
        color: { dark: "#171717", light: "#ffffff" },
      });
      setGalleryUrl(payload.galleryUrl);
      setExpiresAt(payload.expiresAt);
      setQrDataUrl(qr);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Link gallery gagal dibuat.");
    } finally {
      setLoading(false);
    }
  };

  const copyGalleryLink = async () => {
    if (!galleryUrl) return;
    try {
      await navigator.clipboard.writeText(galleryUrl);
      setCopied(true);
    } catch {
      setError("Link tidak dapat disalin otomatis. Pilih dan salin URL secara manual.");
    }
  };

  return (
    <>
      <button
        className="secondary-button session-gallery-preview-trigger"
        type="button"
        disabled={!available || loading}
        onClick={() => void loadGalleryLink()}
        title={available ? `Lihat QR dan link gallery ${publicCode}` : "Gallery belum tersedia atau sudah kedaluwarsa"}
      >
        {loading ? <LoaderCircle className="spin" size={14} /> : <QrCode size={14} />}
        {available ? "QR & link" : "Belum tersedia"}
      </button>

      {dialogOpen && (
        <div className="session-gallery-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}>
          <section className="session-gallery-preview-dialog" role="dialog" aria-modal="true" aria-labelledby={`gallery-preview-title-${sessionId}`}>
            <header>
              <div><span>Gallery customer</span><h2 id={`gallery-preview-title-${sessionId}`}>Session {publicCode}</h2><p>Tunjukkan QR kepada customer atau bagikan link gallery.</p></div>
              <button type="button" onClick={() => setDialogOpen(false)} aria-label="Tutup preview gallery"><X size={18} /></button>
            </header>

            {loading ? <div className="session-gallery-preview-loading"><LoaderCircle className="spin" size={26} /><span>Membuat link gallery aman...</span></div> : null}
            {!loading && error && !galleryUrl ? <div className="session-gallery-preview-error"><p>{error}</p><button className="secondary-button" type="button" onClick={() => void loadGalleryLink()}>Coba lagi</button></div> : null}
            {!loading && galleryUrl && qrDataUrl ? (
              <div className="session-gallery-preview-content">
                <div className="session-gallery-preview-qr"><img src={qrDataUrl} alt={`QR gallery session ${publicCode}`} /><span>Scan untuk membuka hasil foto</span></div>
                <div className="session-gallery-preview-link">
                  <span className="eyebrow"><ExternalLink size={13} /> Link preview</span>
                  <h3>Gallery siap dibuka</h3>
                  <p>Link bersifat publik sampai masa berlakunya habis. Bagikan hanya kepada customer terkait.</p>
                  <label>URL gallery<input value={galleryUrl} readOnly onFocus={(event) => event.currentTarget.select()} /></label>
                  <small>Berlaku sampai {expiresAt ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(expiresAt)) : "—"}</small>
                  {error ? <em>{error}</em> : null}
                  <div>
                    <button className="secondary-button" type="button" onClick={() => void copyGalleryLink()}><Copy size={14} /> {copied ? "Tersalin" : "Salin link"}</button>
                    <a className="primary-button" href={galleryUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Buka tab baru</a>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      )}
    </>
  );
}
