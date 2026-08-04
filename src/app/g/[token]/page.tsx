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
          session: { include: { assets: { where: { kind: { in: ["COMPOSITE", "PREVIEW"] } }, orderBy: { createdAt: "desc" } } } },
        },
      },
    },
  }).catch(() => null);

  if (!galleryToken || galleryToken.revokedAt || galleryToken.expiresAt < new Date() || !galleryToken.gallery.active) notFound();
  const { session } = galleryToken.gallery;

  return (
    <main className="gallery-page">
      <nav className="gallery-nav"><div className="kiosk-brand"><span><Aperture size={20} /></span> SNAPORE</div><span className="gallery-secure"><ShieldCheck size={14} /> Secure gallery</span></nav>
      <section className="gallery-hero">
        <div className="kiosk-eyebrow"><Images size={14} /> Your photobooth moment</div>
        <h1>Here&apos;s your<br /><em>keeper.</em></h1>
        <p>Session {session.publicCode} · Hasil tersedia sementara untuk menjaga privasimu.</p>
      </section>
      <section className="gallery-assets">
        {session.assets.length ? session.assets.map((asset) => (
          <article className="gallery-photo" key={asset.id}>
            <img src={`/api/gallery/${token}/assets/${asset.id}`} alt="Hasil Snapore" />
            <a className="start-button" href={`/api/gallery/${token}/assets/${asset.id}?download=1`}><Download size={18} /> Download original</a>
          </article>
        )) : <div className="gallery-empty"><Images size={34} /><h2>Composite sedang diproses</h2><p>Refresh halaman ini beberapa saat lagi.</p></div>}
      </section>
      <footer className="gallery-footer"><span><Clock3 size={14} /> Link expires {galleryToken.expiresAt.toLocaleDateString("id-ID")}</span><strong>KEEP THE MOMENT LOUD.</strong></footer>
    </main>
  );
}
