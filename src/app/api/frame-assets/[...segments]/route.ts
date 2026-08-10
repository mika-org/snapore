import { readFile } from "node:fs/promises";
import { resolveFrameAssetSegments } from "@/lib/frame-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ segments: string[] }> }) {
  try {
    const { segments } = await context.params;
    const filePath = resolveFrameAssetSegments(segments);
    if (!filePath.toLowerCase().endsWith(".png")) {
      return Response.json({ error: "Format aset frame tidak didukung." }, { status: 415 });
    }
    const bytes = await readFile(filePath);
    return new Response(bytes, {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Aset frame tidak ditemukan." }, { status: 404 });
  }
}
