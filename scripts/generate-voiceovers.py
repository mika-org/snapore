"""Generate prerecorded Indonesian female kiosk voice-over assets.

Install the generator dependency locally first:
  python -m pip install --target .tools/edge-tts edge-tts

Then run:
  python scripts/generate-voiceovers.py
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCAL_EDGE_TTS = ROOT / ".tools" / "edge-tts"
if LOCAL_EDGE_TTS.exists():
    sys.path.insert(0, str(LOCAL_EDGE_TTS))

try:
    import edge_tts
except ImportError as exc:  # pragma: no cover - actionable local setup guard
    raise SystemExit(
        "edge-tts belum tersedia. Jalankan: "
        "python -m pip install --target .tools/edge-tts edge-tts"
    ) from exc


VOICE = "id-ID-GadisNeural"
OUTPUT_DIR = ROOT / "public" / "voice" / "id-ID-gadis"

SCRIPTS: dict[str, str] = {
    "idle": "Hai! Selamat datang di Snapore. Yuk, bikin foto terbaikmu. Kalau sudah siap, sentuh tombol mulai, ya.",
    "payment": "Silakan pindai kode QRIS di layar, ya. Setelah pembayarannya berhasil, sesi fotomu akan langsung dimulai.",
    "layout": "Pembayarannya sudah berhasil. Sekarang, pilih jumlah foto yang kamu mau. Ada dua, empat, enam, atau delapan foto.",
    "frame": "Bagus! Sekarang pilih frame yang paling kamu suka.",
    "capture-2": "Oke, kamera sudah siap untuk dua foto. Lihat ke kamera, siapkan pose terbaikmu, lalu tekan tombol bulat.",
    "capture-4": "Oke, kamera sudah siap untuk empat foto. Lihat ke kamera, siapkan pose terbaikmu, lalu tekan tombol bulat.",
    "capture-6": "Oke, kamera sudah siap untuk enam foto. Lihat ke kamera, siapkan pose terbaikmu, lalu tekan tombol bulat.",
    "capture-8": "Oke, kamera sudah siap untuk delapan foto. Lihat ke kamera, siapkan pose terbaikmu, lalu tekan tombol bulat.",
    "review": "Keren! Coba periksa setiap fotonya. Kamu bisa mengedit, atau mengambil ulang satu foto sebelum lanjut.",
    "checkout": "Semua foto sudah siap. Kalau hasilnya sudah pas, tekan konfirmasi untuk mulai mencetak.",
    "printing": "Foto kamu sedang dicetak. Tunggu sebentar, ya.",
    "done": "Selesai! Silakan ambil hasil cetaknya. Jangan lupa pindai kode galeri untuk menyimpan dan membagikan fotomu.",
    "countdown-3": "Tiga.",
    "countdown-2": "Dua.",
    "countdown-1": "Satu.",
    "smile": "Senyum!",
    "photo-success": "Sip, fotonya berhasil. Bersiap untuk pose berikutnya, ya.",
    "retake-success": "Foto berhasil diambil ulang.",
    "capture-complete": "Pengambilan foto selesai. Silakan periksa hasilnya.",
    "voice-enabled": "Panduan suara perempuan Bahasa Indonesia sudah aktif.",
    "reset-code": "Masukkan kode reset enam digit yang diberikan oleh petugas.",
    **{
        f"retake-{number}": f"Silakan ambil ulang foto nomor {number}."
        for number in range(1, 9)
    },
}


async def generate() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for key, text in SCRIPTS.items():
        output = OUTPUT_DIR / f"{key}.mp3"
        print(f"Generating {output.relative_to(ROOT)}")
        communicate = edge_tts.Communicate(
            text,
            VOICE,
            rate="-4%",
            volume="+0%",
            pitch="+0Hz",
        )
        await communicate.save(str(output))

    manifest = {
        "voice": VOICE,
        "language": "id-ID",
        "gender": "female",
        "rate": "-4%",
        "format": "mp3",
        "assets": {key: {"file": f"{key}.mp3", "text": text} for key, text in SCRIPTS.items()},
    }
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Generated {len(SCRIPTS)} voice-over files with {VOICE}.")


if __name__ == "__main__":
    asyncio.run(generate())
