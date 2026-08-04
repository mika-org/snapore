import { decryptSecret } from "@/lib/security";

const XENDIT_API = "https://api.xendit.co";

type XenditPaymentRequest = {
  id: string;
  reference_id: string;
  status: string;
  amount: number;
  payment_method?: {
    id?: string;
    qr_code?: { channel_properties?: { qr_string?: string; expires_at?: string } };
  };
  failure_code?: string | null;
};

function authorization(encryptedApiKey: string) {
  const apiKey = decryptSecret(encryptedApiKey);
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

async function xenditRequest(url: string, encryptedApiKey: string, init?: RequestInit) {
  const response = await fetch(`${XENDIT_API}${url}`, {
    ...init,
    headers: {
      authorization: authorization(encryptedApiKey),
      "content-type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as XenditPaymentRequest & { message?: string; error_code?: string };
  if (!response.ok) throw new Error(payload.message ?? payload.error_code ?? `Xendit merespons ${response.status}`);
  return payload;
}

export async function createQrisPayment(input: { encryptedApiKey: string; amount: number; referenceId: string; description: string }) {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const payment = await xenditRequest("/payment_requests", input.encryptedApiKey, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      reference_id: input.referenceId,
      amount: Math.round(input.amount),
      currency: "IDR",
      country: "ID",
      description: input.description,
      payment_method: {
        type: "QR_CODE",
        reusability: "ONE_TIME_USE",
        qr_code: { channel_properties: { expires_at: expiresAt } },
      },
      metadata: { product: "SNAPORE_PHOTOBOOTH", reference_id: input.referenceId },
    }),
  });
  const qrString = payment.payment_method?.qr_code?.channel_properties?.qr_string;
  if (!qrString) throw new Error("Xendit tidak mengembalikan QR string.");
  return { id: payment.id, status: payment.status, qrString, expiresAt: payment.payment_method?.qr_code?.channel_properties?.expires_at ?? expiresAt };
}

export async function getPaymentRequest(encryptedApiKey: string, paymentRequestId: string) {
  return xenditRequest(`/payment_requests/${encodeURIComponent(paymentRequestId)}`, encryptedApiKey);
}
