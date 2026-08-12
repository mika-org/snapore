const permanentClientErrors = [
  "Booth agent belum terdaftar pada tenant",
  "Otorisasi sinkronisasi tidak valid",
  "Origin kiosk tidak diizinkan",
  "Identifier tidak valid",
  "Ukuran asset tidak valid",
  "Tidak ada asset untuk disinkronkan",
];

export function isPermanentUploadFailure(status: number, message: string) {
  if ([401, 403, 404].includes(status)) return true;
  return status === 400 && permanentClientErrors.some((error) => message.includes(error));
}
