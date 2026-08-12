export type OfflineCapture = {
  id: string;
  sessionId: string;
  slotIndex: number;
  blob: Blob;
  createdAt: string;
  synced: boolean;
};

export type OfflineJob = {
  id: string;
  sessionId: string;
  type: "PRINT" | "UPLOAD";
  status: "QUEUED" | "RUNNING" | "DONE" | "RETRYING";
  payload: Record<string, unknown>;
  createdAt: string;
};

export type OfflineKioskSession<T> = {
  boothId: string;
  sessionId: string;
  savedAt: string;
  state: T;
};

const DB_NAME = "snapore-offline";
const DB_VERSION = 2;

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Penyimpanan lokal sedang digunakan tab kiosk lain."));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("captures")) {
        const captures = db.createObjectStore("captures", { keyPath: "id" });
        captures.createIndex("sessionId", "sessionId");
      }
      if (!db.objectStoreNames.contains("jobs")) {
        const jobs = db.createObjectStore("jobs", { keyPath: "id" });
        jobs.createIndex("sessionId", "sessionId");
        jobs.createIndex("status", "status");
      }
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "boothId" });
      }
    };
  });
}

async function put<T>(storeName: "captures" | "jobs" | "sessions", value: T) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function saveOfflineCapture(capture: OfflineCapture) {
  return put("captures", capture);
}

export async function saveOfflineJob(job: OfflineJob) {
  return put("jobs", job);
}

export async function getSessionJobs(sessionId: string): Promise<OfflineJob[]> {
  const db = await openDatabase();
  const jobs = await new Promise<OfflineJob[]>((resolve, reject) => {
    const transaction = db.transaction("jobs", "readonly");
    const request = transaction.objectStore("jobs").index("sessionId").getAll(sessionId);
    request.onsuccess = () => resolve(request.result as OfflineJob[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return jobs;
}

export async function saveOfflineKioskSession<T>(session: OfflineKioskSession<T>) {
  return put("sessions", session);
}

export async function getOfflineKioskSession<T>(boothId: string): Promise<OfflineKioskSession<T> | null> {
  const db = await openDatabase();
  const session = await new Promise<OfflineKioskSession<T> | null>((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const request = transaction.objectStore("sessions").get(boothId);
    request.onsuccess = () => resolve((request.result as OfflineKioskSession<T> | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return session;
}

export async function clearOfflineKioskSession(boothId: string) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("sessions", "readwrite");
    transaction.objectStore("sessions").delete(boothId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function getSessionCaptures(sessionId: string): Promise<OfflineCapture[]> {
  const db = await openDatabase();
  const captures = await new Promise<OfflineCapture[]>((resolve, reject) => {
    const transaction = db.transaction("captures", "readonly");
    const request = transaction.objectStore("captures").index("sessionId").getAll(sessionId);
    request.onsuccess = () => resolve(request.result as OfflineCapture[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return captures;
}

export async function clearSessionCaptures(sessionId: string) {
  const captures = await getSessionCaptures(sessionId);
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("captures", "readwrite");
    const store = transaction.objectStore("captures");
    captures.forEach((capture) => store.delete(capture.id));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}
