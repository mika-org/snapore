import { createHash, randomBytes } from "node:crypto";
import { publicAppUrl } from "@/domain/upload-destination";
import { prisma } from "@/lib/prisma";

function hashGalleryToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function createGalleryLink(galleryId: string, expiresAt: Date, requestOrigin: string) {
  const publicToken = randomBytes(24).toString("base64url");
  await prisma.galleryToken.create({
    data: { galleryId, tokenHash: hashGalleryToken(publicToken), expiresAt },
  });
  return publicAppUrl(process.env.SNAPORE_PUBLIC_APP_URL, `/g/${publicToken}`, requestOrigin);
}
