/* eslint-disable @next/next/no-img-element -- protected asset route handles authorization and delivery */
import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { Aperture, Clock3, Download, Images, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export default async function GalleryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const galleryToken = await prisma.galleryToken.findUnique({
    where: { tokenHash: hash(token) },
    include: {
      gallery: {
        include: {
          session: { include: { assets: { where: { kind: { in: ["ORIGINAL", "COMPOSITE", "PREVIEW"] } }, orderBy: [{ kind: "desc" }, { createdAt: "asc" }] } } },
        },
      },
    },
  }).catch(() => null);

  if (!galleryToken || galleryToken.revokedAt || galleryToken.expiresAt < new Date() || !galleryToken.gallery.active) notFound();
  const { session } = galleryToken.gallery;
  const framedAssets = session.assets.filter((asset) => asset.kind !== "ORIGINAL");
  const rawAssets = session.assets.filter((asset) => asset.kind === "ORIGINAL");

  return (
    <main className="gallery-page">
      <nav className="gallery-nav"><div className="kiosk-brand"><span><Aperture size={20} /></span> SNAPORE</div><span className="gallery-secure"><ShieldCheck size={14} /> Secure gallery</span></nav>
      <section className="gallery-hero">
        <div className="kiosk-eyebrow"><Images size={14} /> Your photobooth moment</div>
        <h1>Here&apos;s your<br /><em>keeper.</em></h1>
        <p>Session {session.publicCode} · Hasil tersedia sementara untuk menjaga privasimu.</p>
      </section>
      <section className="gallery-assets">
        {session.assets.length ? <>
          <div className="gallery-group-heading"><span>01</span><div><h2>Hasil dengan frame</h2><p>File siap dibagikan dan dicetak.</p></div></div>
          <div className="gallery-framed-list">
            {framedAssets.map((asset) => <article className="gallery-photo" key={asset.id}><img src={`/api/gallery/${token}/assets/${asset.id}`} alt="Hasil foto dengan frame" /><a className="start-button" href={`/api/gallery/${token}/assets/${asset.id}?download=1`}><Download size={18} /> Download hasil</a></article>)}
            {framedAssets.length === 0 ? <div className="gallery-empty"><Images size={30} /><h2>Hasil frame sedang diproses</h2></div> : null}
          </div>
          <div className="gallery-group-heading raw"><span>02</span><div><h2>Foto raw tanpa frame</h2><p>Capture asli yang disimpan ketika cetak dikonfirmasi.</p></div></div>
          <div className="gallery-raw-grid">
            {rawAssets.map((asset, index) => <article key={asset.id}><img src={`/api/gallery/${token}/assets/${asset.id}`} alt={`Foto raw ${index + 1}`} /><div><strong>RAW {String(index + 1).padStart(2, "0")}</strong><a href={`/api/gallery/${token}/assets/${asset.id}?download=1`}><Download size={15} /> Download</a></div></article>)}
            {rawAssets.length === 0 ? <div className="gallery-empty"><Images size={30} /><h2>Foto raw belum tersinkronisasi</h2></div> : null}
          </div>
        </> : <div className="gallery-empty"><Images size={34} /><h2>Foto sedang diproses</h2><p>Refresh halaman ini beberapa saat lagi.</p></div>}
      </section>
      <footer className="gallery-footer"><span><Clock3 size={14} /> Link expires {galleryToken.expiresAt.toLocaleDateString("id-ID")}</span><strong>KEEP THE MOMENT LOUD.</strong></footer>
    </main>
  );
}
