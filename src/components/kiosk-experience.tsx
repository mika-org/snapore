"use client";

/* eslint-disable @next/next/no-img-element -- capture previews use ephemeral blob/data URLs */

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import {
  Aperture,
  Camera,
  Check,
  ChevronRight,
  Clock3,
  CloudOff,
  FlipHorizontal2,
  KeyRound,
  LoaderCircle,
  Pencil,
  Printer,
  QrCode,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SunMedium,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import type { FrameCatalogResponse } from "@/domain/frame-catalog";
import { calculateSaleFinance } from "@/domain/finance";
import { kioskStepVoiceAsset, kioskVoiceAsset, retakeVoiceAsset } from "@/domain/kiosk-voice";
import { paymentAllowsSessionStart } from "@/domain/payment-flow";
import { composePrint } from "@/lib/compose";
import { clearLocalSessionProgress, createPrintAndUploadJobs, getAgentHealth, getAgentJobs, getServerSyncStatus, persistCaptureLocally, syncSessionFromBrowser } from "@/lib/device-agent-client";
import { calculateOrder, framePresets, getFrameAsset, layoutPresets, transitionSession, type FramePreset, type KioskStep, type LayoutPreset } from "@/domain/session";
import { formatSessionTimer, PAYMENT_WINDOW_SECONDS, remainingSeconds, SESSION_WINDOW_SECONDS } from "@/domain/session-timers";
import { clampGestureValue, getGestureMetrics, normalizeGestureAngle, type GesturePoint } from "@/domain/photo-gestures";
import { formatCurrency } from "@/lib/format";

type CapturedImage = {
  id: string;
  url: string;
  blob: Blob;
  storage: "directory" | "indexeddb";
  revision: number;
  edited?: boolean;
};

type PhotoFilter = "normal" | "mono" | "warm";
type EditorSettings = {
  rotation: number;
  flipped: boolean;
  zoom: number;
  brightness: number;
  filter: PhotoFilter;
  offsetX: number;
  offsetY: number;
};

const defaultEditorSettings: EditorSettings = {
  rotation: 0,
  flipped: false,
  zoom: 1,
  brightness: 1,
  filter: "normal",
  offsetX: 0,
  offsetY: 0,
};

type GestureState = {
  pointers: Map<number, GesturePoint>;
  center: GesturePoint | null;
  distance: number;
  angle: number;
};

type SyncStatus = "IDLE" | "SYNCING" | "RETRYING" | "SYNCED";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createDemoCapture(index: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 960;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas tidak tersedia");
  const colors = ["#ff604e", "#b9f76b", "#4b62ff", "#ffd95a", "#ee9dca", "#6ce1d2"];
  ctx.fillStyle = colors[index % colors.length];
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#171717";
  ctx.beginPath();
  ctx.arc(640, 360, 170, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f4f1e9";
  ctx.beginPath();
  ctx.arc(585, 325, 15, 0, Math.PI * 2);
  ctx.arc(695, 325, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f4f1e9";
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.arc(640, 375, 80, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = "#171717";
  ctx.font = "900 54px Arial";
  ctx.textAlign = "center";
  ctx.fillText(`SNAP ${index + 1}`, 640, 760);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Capture gagal")), "image/jpeg", .92));
  return blob;
}

function editorFilter(settings: EditorSettings) {
  const look = settings.filter === "mono"
    ? "grayscale(1) contrast(1.08)"
    : settings.filter === "warm"
      ? "sepia(.2) saturate(1.18)"
      : "saturate(1)";
  return `brightness(${settings.brightness}) ${look}`;
}

async function renderEditedPhoto(source: string, settings: EditorSettings) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = reject;
    element.src = source;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 960;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas tidak tersedia");
  const quarterTurn = settings.rotation === 90 || settings.rotation === 270;
  const rotatedWidth = quarterTurn ? image.height : image.width;
  const rotatedHeight = quarterTurn ? image.width : image.height;
  const cover = Math.max(canvas.width / rotatedWidth, canvas.height / rotatedHeight) * settings.zoom;
  ctx.fillStyle = "#171717";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.filter = editorFilter(settings);
  ctx.translate(canvas.width / 2 + settings.offsetX * canvas.width, canvas.height / 2 + settings.offsetY * canvas.height);
  ctx.rotate((settings.rotation * Math.PI) / 180);
  ctx.scale(settings.flipped ? -cover : cover, cover);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Gagal menyimpan edit")), "image/jpeg", .94),
  );
}

export type KioskBooth = {
  id: string;
  code: string;
  name: string;
  tenantName: string;
  basePrice: number;
  additionalCopyPrice: number;
  paymentEnabled: boolean;
  taxRate: number;
  pricesIncludeTax: boolean;
  printCostPerCopy: number;
  paymentFeeRate: number;
  paymentFeeFixed: number;
};

export function KioskExperience({ booth }: { booth: KioskBooth }) {
  const [step, setStep] = useState<KioskStep>("IDLE");
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [layout, setLayout] = useState<LayoutPreset>(layoutPresets[1]);
  const [availableFrames, setAvailableFrames] = useState<FramePreset[]>([]);
  const [availableLayoutCounts, setAvailableLayoutCounts] = useState<LayoutPreset["count"][]>([]);
  const [frameCatalogStatus, setFrameCatalogStatus] = useState<"loading" | "ready" | "maintenance">("loading");
  const [frameCatalogMessage, setFrameCatalogMessage] = useState("Menyiapkan layout dan frame booth...");
  const [frame, setFrame] = useState<FramePreset>(framePresets[0]);
  const [photos, setPhotos] = useState<CapturedImage[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [retakeIndex, setRetakeIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(defaultEditorSettings);
  const [editSaving, setEditSaving] = useState(false);
  const [agentOnline, setAgentOnline] = useState(false);
  const [copies, setCopies] = useState(1);
  const [composite, setComposite] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [jobMode, setJobMode] = useState<"agent" | "browser-fallback" | null>(null);
  const [galleryUrl, setGalleryUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("IDLE");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [jobIds, setJobIds] = useState<{ printJobId: string; uploadJobId: string } | null>(null);
  const [paymentQrDataUrl, setPaymentQrDataUrl] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"IDLE" | "PENDING" | "PAID" | "EXPIRED">("IDLE");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentExpiresAt, setPaymentExpiresAt] = useState<number | null>(null);
  const [paymentRemaining, setPaymentRemaining] = useState(PAYMENT_WINDOW_SECONDS);
  const [sessionDeadline, setSessionDeadline] = useState<number | null>(null);
  const [sessionRemaining, setSessionRemaining] = useState(SESSION_WINDOW_SECONDS);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [resetCodeBusy, setResetCodeBusy] = useState(false);
  const [resetCodeError, setResetCodeError] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceAvailability, setVoiceAvailability] = useState<"ready" | "blocked" | "missing">("ready");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const gestureRef = useRef<GestureState>({ pointers: new Map(), center: null, distance: 0, angle: 0 });
  const printingTriggeredRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const syncRetryCountRef = useRef(0);
  const paymentStartedRef = useRef(false);
  const sessionStartedRef = useRef(false);
  const forceBrowserFallbackRef = useRef(false);
  const voiceRequestRef = useRef(0);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastVoiceRef = useRef<{ source: string; playedAt: number } | null>(null);

  const stopVoice = useCallback(() => {
    voiceRequestRef.current += 1;
    const audio = voiceAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      voiceAudioRef.current = null;
    }
  }, []);

  const playVoice = useCallback(async (source: string, dedupe = true, force = false) => {
    if ((!voiceEnabled && !force) || typeof window === "undefined") return;
    const now = Date.now();
    if (dedupe && lastVoiceRef.current?.source === source && now - lastVoiceRef.current.playedAt < 650) return;
    lastVoiceRef.current = { source, playedAt: now };
    stopVoice();
    const requestId = voiceRequestRef.current;
    const audio = new Audio(source);
    audio.preload = "auto";
    audio.volume = 1;
    voiceAudioRef.current = audio;
    try {
      await audio.play();
      if (requestId !== voiceRequestRef.current) return;
      setVoiceAvailability("ready");
      await new Promise<void>((resolve) => {
        const finish = () => resolve();
        audio.addEventListener("ended", finish, { once: true });
        audio.addEventListener("error", finish, { once: true });
      });
    } catch (error) {
      if (requestId !== voiceRequestRef.current) return;
      const blocked = error instanceof DOMException && error.name === "NotAllowedError";
      setVoiceAvailability(blocked ? "blocked" : "missing");
    }
  }, [stopVoice, voiceEnabled]);

  useEffect(() => {
    if (!voiceEnabled) {
      stopVoice();
      return;
    }
    const timer = window.setTimeout(() => void playVoice(kioskStepVoiceAsset(step, layout.count)), 180);
    return () => window.clearTimeout(timer);
  }, [layout.count, playVoice, step, stopVoice, voiceEnabled]);

  useEffect(() => () => stopVoice(), [stopVoice]);

  const order = useMemo(() => {
    const base = calculateOrder(booth.basePrice, booth.additionalCopyPrice, copies);
    return { ...base, ...calculateSaleFinance(base.subtotal, copies, { taxRate: booth.taxRate, pricesIncludeTax: booth.pricesIncludeTax, printCostPerCopy: booth.printCostPerCopy, paymentFeeRate: booth.paymentFeeRate, paymentFeeFixed: booth.paymentFeeFixed }) };
  }, [booth.additionalCopyPrice, booth.basePrice, booth.paymentFeeFixed, booth.paymentFeeRate, booth.pricesIncludeTax, booth.printCostPerCopy, booth.taxRate, copies]);
  const framesForLayout = useMemo(
    () => availableFrames.filter((item) => Boolean(item.assets[layout.count])),
    [availableFrames, layout.count],
  );
  const availableLayouts = useMemo(
    () => layoutPresets.filter((item) => availableLayoutCounts.includes(item.count)),
    [availableLayoutCounts],
  );

  useEffect(() => {
    if (step !== "IDLE" && step !== "FRAME") return;
    let active = true;
    fetch(`/api/frames?boothId=${encodeURIComponent(booth.id)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Frame library tidak tersedia");
        return response.json() as Promise<FrameCatalogResponse>;
      })
      .then((payload) => {
        if (!active) return;
        const tones: FramePreset["tone"][] = ["coral", "mint", "blue", "custom"];
        const accents = ["#ff614f", "#baf867", "#4d63ff", "#ffd95a"];
        const databaseFrames = payload.frames.map((item, index): FramePreset => ({
          ...item,
          tone: tones[index % tones.length],
          accent: accents[index % accents.length],
        }));
        if (!payload.operational || databaseFrames.length === 0 || payload.layoutCounts.length === 0) {
          setAvailableFrames([]);
          setAvailableLayoutCounts([]);
          setFrameCatalogStatus("maintenance");
          setFrameCatalogMessage(payload.maintenanceReason ?? "Layout atau frame booth belum tersedia.");
          return;
        }
        const selectedLayout = layoutPresets.find((item) => payload.layoutCounts.includes(item.count) && item.count === layout.count)
          ?? layoutPresets.find((item) => payload.layoutCounts.includes(item.count));
        if (!selectedLayout) {
          setFrameCatalogStatus("maintenance");
          setFrameCatalogMessage("Layout booth belum tersedia.");
          return;
        }
        setAvailableFrames(databaseFrames);
        setAvailableLayoutCounts(payload.layoutCounts);
        setLayout(selectedLayout);
        setFrame(databaseFrames.find((item) => Boolean(item.assets[selectedLayout.count])) ?? databaseFrames[0]);
        setFrameCatalogStatus("ready");
        setFrameCatalogMessage("Layout dan frame siap digunakan.");
      })
      .catch(() => {
        if (!active) return;
        setAvailableFrames([]);
        setAvailableLayoutCounts([]);
        setFrameCatalogStatus("maintenance");
        setFrameCatalogMessage("Frame booth gagal dimuat. Hubungi petugas.");
      });
    return () => { active = false; };
  }, [booth.id, layout.count, step]);

  useEffect(() => {
    let active = true;
    const check = async () => {
      const health = await getAgentHealth();
      if (active) setAgentOnline(health.online);
    };
    void check();
    const timer = window.setInterval(check, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (step !== "CAPTURE") return;
    let cancelled = false;
    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("MediaDevices tidak tersedia");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraReady(true);
      } catch {
        setCameraError("Kamera tidak tersedia. Mode demo capture aktif.");
        setCameraReady(false);
      }
    };
    void startCamera();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraReady(false);
    };
  }, [step]);

  const runBrowserSync = useCallback(async () => {
    if (!composite || !jobIds || syncInFlightRef.current) return false;
    syncInFlightRef.current = true;
    setSyncBusy(true);
    setSyncStatus(syncRetryCountRef.current > 0 ? "RETRYING" : "SYNCING");
    setSyncError(null);
    try {
      const result = await syncSessionFromBrowser({
        sessionId,
        composite: composite.blob,
        captures: photos.map((photo) => ({ id: photo.id, blob: photo.blob })),
        copies,
        layoutId: layout.id,
        frameId: frame.id,
        boothId: booth.id,
        boothCode: booth.code,
        printJobId: jobIds.printJobId,
        uploadJobId: jobIds.uploadJobId,
      });
      if (result.galleryUrl) {
        setGalleryUrl(result.galleryUrl);
        setSyncStatus("SYNCED");
        syncRetryCountRef.current = 0;
        return true;
      }
      throw new Error("Server belum mengirim URL galeri");
    } catch (error) {
      syncRetryCountRef.current += 1;
      setSyncStatus("RETRYING");
      setSyncError(error instanceof Error ? error.message : "Sinkronisasi gagal");
      return false;
    } finally {
      syncInFlightRef.current = false;
      setSyncBusy(false);
    }
  }, [booth.code, booth.id, composite, copies, frame.id, jobIds, layout.id, photos, sessionId]);

  useEffect(() => {
    if (step !== "DONE" || galleryUrl) return;
    let active = true;
    let timer: number | undefined;
    const schedule = () => {
      if (!active) return;
      const delay = jobMode === "browser-fallback"
        ? Math.min(30_000, 3_000 * 2 ** Math.min(syncRetryCountRef.current, 3))
        : 2_500;
      timer = window.setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (!active) return;
      if (jobMode === "agent") {
        const jobs = await getAgentJobs(sessionId);
        if (!active) return;
        if (jobs?.upload?.status === "SYNCED" && jobs.upload.galleryUrl) {
          setGalleryUrl(jobs.upload.galleryUrl);
          setSyncStatus("SYNCED");
          return;
        }
        if (jobs?.upload?.status === "RETRYING") {
          setSyncStatus("RETRYING");
          setSyncError("Device agent sedang mencoba mengirim ulang file.");
        }
      }

      const server = await getServerSyncStatus(booth.id, sessionId);
      if (!active) return;
      if (server?.galleryUrl) {
        setGalleryUrl(server.galleryUrl);
        setSyncStatus("SYNCED");
        return;
      }
      if (server?.lastError) setSyncError(server.lastError);

      if (jobMode === "browser-fallback") await runBrowserSync();
      schedule();
    };
    void poll();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [booth.id, galleryUrl, jobMode, runBrowserSync, sessionId, step]);

  useEffect(() => {
    if (!galleryUrl) return;
    const absolute = new URL(galleryUrl, window.location.origin).toString();
    QRCode.toDataURL(absolute, { width: 420, margin: 1, color: { dark: "#171717", light: "#ffffff" } }).then(setQrDataUrl);
  }, [galleryUrl]);

  const advance = useCallback((event: Parameters<typeof transitionSession>[1]) => {
    setStep((current) => transitionSession(current, event));
  }, []);

  const takePhoto = async () => {
    let blob: Blob;
    const video = videoRef.current;
    if (cameraReady && video && video.videoWidth > 0) {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 960;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas tidak tersedia");
      const ratio = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const width = canvas.width / ratio;
      const height = canvas.height / ratio;
      const x = (video.videoWidth - width) / 2;
      const y = (video.videoHeight - height) / 2;
      ctx.drawImage(video, x, y, width, height, 0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Capture gagal")), "image/jpeg", .94));
    } else {
      blob = await createDemoCapture(retakeIndex ?? photos.length);
    }

    const slotIndex = retakeIndex ?? photos.length;
    const id = crypto.randomUUID();
    const persisted = await persistCaptureLocally({ id, sessionId, slotIndex, blob });
    const previous = photos[slotIndex];
    const replacement: CapturedImage = {
      id,
      blob,
      url: URL.createObjectURL(blob),
      storage: persisted.storage,
      revision: (previous?.revision ?? 0) + 1,
    };
    const next = retakeIndex === null
      ? [...photos, replacement]
      : photos.map((photo, index) => index === retakeIndex ? replacement : photo);
    setPhotos(next);
    if (previous && retakeIndex !== null) window.setTimeout(() => URL.revokeObjectURL(previous.url), 0);
    return { count: next.length, wasRetake: retakeIndex !== null };
  };

  const runCountdown = async () => {
    if (captureBusy) return;
    setCaptureBusy(true);
    for (let value = 3; value >= 1; value -= 1) {
      setCountdown(value);
      void playVoice(kioskVoiceAsset(`COUNTDOWN_${value}` as "COUNTDOWN_3" | "COUNTDOWN_2" | "COUNTDOWN_1"), false);
      await wait(1000);
    }
    void playVoice(kioskVoiceAsset("SMILE"), false);
    await wait(450);
    setCountdown(null);
    const captured = await takePhoto();
    if (captured.wasRetake) {
      void playVoice(kioskVoiceAsset("RETAKE_SUCCESS"), false);
      await wait(420);
      setRetakeIndex(null);
      setCaptureBusy(false);
      advance("RETAKE_COMPLETE");
    } else if (captured.count >= layout.count) {
      void playVoice(kioskVoiceAsset("CAPTURE_COMPLETE"), false);
      await wait(420);
      advance("CAPTURE_COMPLETE");
    } else {
      void playVoice(kioskVoiceAsset("PHOTO_SUCCESS"), false);
      setCaptureBusy(false);
    }
  };

  const startRetake = (index: number) => {
    void playVoice(retakeVoiceAsset(index + 1), false);
    setRetakeIndex(index);
    setCaptureBusy(false);
    setCameraError(null);
    advance("RETAKE_PHOTO");
  };

  const cancelRetake = () => {
    setRetakeIndex(null);
    setCaptureBusy(false);
    advance("RETAKE_COMPLETE");
  };

  const openEditor = (index: number) => {
    gestureRef.current = { pointers: new Map(), center: null, distance: 0, angle: 0 };
    setEditingIndex(index);
    setEditorSettings(defaultEditorSettings);
  };

  const beginEditorGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const metrics = getGestureMetrics(gestureRef.current.pointers.values());
    gestureRef.current.center = metrics.center;
    gestureRef.current.distance = metrics.distance;
    gestureRef.current.angle = metrics.angle;
  };

  const moveEditorGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture.pointers.has(event.pointerId)) return;
    gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const next = getGestureMetrics(gesture.pointers.values());
    const bounds = event.currentTarget.getBoundingClientRect();
    if (gesture.center && next.center) {
      const moveX = (next.center.x - gesture.center.x) / Math.max(1, bounds.width);
      const moveY = (next.center.y - gesture.center.y) / Math.max(1, bounds.height);
      setEditorSettings((value) => ({
        ...value,
        offsetX: clampGestureValue(value.offsetX + moveX, -.4, .4),
        offsetY: clampGestureValue(value.offsetY + moveY, -.4, .4),
        zoom: gesture.pointers.size >= 2 && gesture.distance > 0
          ? clampGestureValue(value.zoom * (next.distance / gesture.distance), 1, 2.25)
          : value.zoom,
        rotation: gesture.pointers.size >= 2
          ? value.rotation + normalizeGestureAngle(next.angle - gesture.angle)
          : value.rotation,
      }));
    }
    gesture.center = next.center;
    gesture.distance = next.distance;
    gesture.angle = next.angle;
  };

  const endEditorGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    gesture.pointers.delete(event.pointerId);
    const next = getGestureMetrics(gesture.pointers.values());
    gesture.center = next.center;
    gesture.distance = next.distance;
    gesture.angle = next.angle;
  };

  const handleEditorWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setEditorSettings((value) => event.shiftKey
      ? { ...value, rotation: value.rotation - event.deltaY * .12 }
      : { ...value, zoom: clampGestureValue(value.zoom - event.deltaY * .0015, 1, 2.25) });
  };

  const savePhotoEdit = async () => {
    if (editingIndex === null) return;
    const current = photos[editingIndex];
    if (!current) return;
    setEditSaving(true);
    try {
      const blob = await renderEditedPhoto(current.url, editorSettings);
      const id = crypto.randomUUID();
      const persisted = await persistCaptureLocally({ id, sessionId, slotIndex: editingIndex, blob });
      const replacement: CapturedImage = {
        id,
        blob,
        url: URL.createObjectURL(blob),
        storage: persisted.storage,
        revision: current.revision + 1,
        edited: true,
      };
      setPhotos((items) => items.map((photo, index) => index === editingIndex ? replacement : photo));
      window.setTimeout(() => URL.revokeObjectURL(current.url), 0);
      setEditingIndex(null);
      setEditorSettings(defaultEditorSettings);
    } finally {
      setEditSaving(false);
    }
  };

  const approvePhotos = async () => {
    const result = await composePrint({ photos: photos.map((photo) => photo.url), count: layout.count, frameTone: frame.tone, frameAsset: getFrameAsset(frame, layout.count) });
    setComposite(result);
    advance("APPROVE_PHOTOS");
  };

  const registerFinalSelection = useCallback(async () => {
    const response = await fetch("/api/payments/qris", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boothId: booth.id, sessionId, frameId: frame.id, layoutCount: layout.count, copies }),
    });
    const payload = await response.json() as { error?: string; status?: string };
    if (!response.ok) throw new Error(payload.error ?? "Data cetak gagal disiapkan.");
    if (!paymentAllowsSessionStart(payload.status)) throw new Error("Pembayaran QRIS belum terkonfirmasi.");
  }, [booth.id, copies, frame.id, layout.count, sessionId]);

  const confirmPrint = useCallback(async () => {
    if (!composite || printingTriggeredRef.current) return;
    setPaymentBusy(true);
    setPaymentError(null);
    try {
      await registerFinalSelection();
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Data cetak gagal disiapkan.");
      setPaymentBusy(false);
      return;
    }
    printingTriggeredRef.current = true;
    advance("CONFIRM_PRINT");
    const result = await createPrintAndUploadJobs({
      sessionId,
      composite: composite.blob,
      captures: photos.map((photo) => ({ id: photo.id, blob: photo.blob })),
      copies,
      layoutId: layout.id,
      frameId: frame.id,
      boothId: booth.id,
      boothCode: booth.code,
      forceBrowserFallback: forceBrowserFallbackRef.current,
    });
    setJobMode(result.mode);
    setJobIds({ printJobId: result.printJobId, uploadJobId: result.uploadJobId });
    if (result.galleryUrl) {
      setGalleryUrl(result.galleryUrl);
      setSyncStatus("SYNCED");
    } else {
      setSyncStatus(result.syncStatus === "RETRYING" ? "RETRYING" : "SYNCING");
      setSyncError(result.syncError ?? null);
    }
    await wait(2700);
    advance("PRINT_COMPLETE");
    setPaymentBusy(false);
  }, [advance, booth.code, booth.id, composite, copies, frame.id, layout.id, photos, registerFinalSelection, sessionId]);

  const startPaidSession = useCallback(() => {
    if (sessionStartedRef.current) return;
    sessionStartedRef.current = true;
    const deadline = Date.now() + SESSION_WINDOW_SECONDS * 1000;
    setSessionDeadline(deadline);
    setSessionRemaining(SESSION_WINDOW_SECONDS);
    setPaymentStatus("PAID");
    advance("PAYMENT_COMPLETE");
  }, [advance]);

  const bypassPaymentToFrame = useCallback(() => {
    if (!sessionStartedRef.current) {
      sessionStartedRef.current = true;
      const deadline = Date.now() + SESSION_WINDOW_SECONDS * 1000;
      setSessionDeadline(deadline);
      setSessionRemaining(SESSION_WINDOW_SECONDS);
      setPaymentStatus("PAID");
    }
    advance("BYPASS_TO_FRAME");
  }, [advance]);

  const beginPayment = async (fromIdle = true) => {
    if (paymentBusy || paymentStartedRef.current || frameCatalogStatus !== "ready") return;
    if (fromIdle) {
      void playVoice(kioskStepVoiceAsset("PAYMENT", layout.count));
      advance("START");
    }
    paymentStartedRef.current = true;
    setPaymentBusy(true);
    setPaymentError(null);
    setPaymentQrDataUrl(null);
    setPaymentStatus("IDLE");
    setPaymentRemaining(PAYMENT_WINDOW_SECONDS);
    try {
      const response = await fetch("/api/payments/qris", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ boothId: booth.id, sessionId, copies: 1 }),
      });
      const payload = await response.json() as { error?: string; status?: string; qrString?: string; expiresAt?: string | null };
      if (!response.ok) throw new Error(payload.error ?? "Pembayaran gagal disiapkan.");
      if (paymentAllowsSessionStart(payload.status)) {
        startPaidSession();
        return;
      }
      if (!payload.qrString) throw new Error("QRIS belum tersedia.");
      setPaymentQrDataUrl(await QRCode.toDataURL(payload.qrString, { width: 420, margin: 1 }));
      const expiry = payload.expiresAt ? new Date(payload.expiresAt).getTime() : Date.now() + PAYMENT_WINDOW_SECONDS * 1000;
      setPaymentExpiresAt(expiry);
      setPaymentRemaining(remainingSeconds(expiry));
      setPaymentStatus("PENDING");
    } catch (checkoutError) {
      paymentStartedRef.current = false;
      setPaymentError(checkoutError instanceof Error ? checkoutError.message : "Pembayaran gagal disiapkan.");
    } finally {
      setPaymentBusy(false);
    }
  };

  useEffect(() => {
    if (paymentStatus !== "PENDING") return;
    let active = true;
    const poll = async () => {
      const response = await fetch(`/api/payments/qris?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" }).catch(() => null);
      if (!active || !response?.ok) return;
      const payload = await response.json() as { status?: string; expiresAt?: string | null };
      if (paymentAllowsSessionStart(payload.status)) {
        startPaidSession();
      } else if (payload.status === "EXPIRED") {
        paymentStartedRef.current = false;
        setPaymentStatus("EXPIRED");
        setPaymentRemaining(0);
      }
    };
    const timer = window.setInterval(() => void poll(), 2500);
    void poll();
    return () => { active = false; window.clearInterval(timer); };
  }, [paymentStatus, sessionId, startPaidSession]);

  useEffect(() => {
    if (step !== "PAYMENT" || paymentStatus !== "PENDING" || !paymentExpiresAt) return;
    const update = () => {
      const remaining = remainingSeconds(paymentExpiresAt);
      setPaymentRemaining(remaining);
      if (remaining === 0) {
        paymentStartedRef.current = false;
        setPaymentStatus("EXPIRED");
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [paymentExpiresAt, paymentStatus, step]);

  const reset = useCallback(() => {
    photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    setPhotos([]);
    setComposite(null);
    setCopies(1);
    setSessionId(crypto.randomUUID());
    setGalleryUrl(null);
    setQrDataUrl(null);
    setSyncStatus("IDLE");
    setSyncError(null);
    setSyncBusy(false);
    setJobIds(null);
    syncInFlightRef.current = false;
    syncRetryCountRef.current = 0;
    setPaymentQrDataUrl(null);
    setPaymentStatus("IDLE");
    setPaymentBusy(false);
    setPaymentError(null);
    setPaymentExpiresAt(null);
    setPaymentRemaining(PAYMENT_WINDOW_SECONDS);
    setSessionDeadline(null);
    setSessionRemaining(SESSION_WINDOW_SECONDS);
    paymentStartedRef.current = false;
    sessionStartedRef.current = false;
    printingTriggeredRef.current = false;
    setCameraError(null);
    setCaptureBusy(false);
    setRetakeIndex(null);
    setEditingIndex(null);
    setEditorSettings(defaultEditorSettings);
    setJobMode(null);
    forceBrowserFallbackRef.current = false;
    setStep("IDLE");
  }, [photos]);

  const redeemResetCode = async () => {
    if (!/^\d{6}$/.test(resetCode) || resetCodeBusy) return;
    setResetCodeBusy(true);
    setResetCodeError(null);
    try {
      const response = await fetch("/api/session-reset/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ boothId: booth.id, code: resetCode }),
      });
      const payload = await response.json() as { sessionId?: string; sessionWindowSeconds?: number; error?: string };
      if (!response.ok || !payload.sessionId) throw new Error(payload.error ?? "Kode reset tidak dapat digunakan.");

      const localAgentReset = await clearLocalSessionProgress(payload.sessionId);
      forceBrowserFallbackRef.current = !localAgentReset;
      photos.forEach((photo) => URL.revokeObjectURL(photo.url));
      setPhotos([]);
      setComposite(null);
      setCopies(1);
      setSessionId(payload.sessionId);
      setLayout(layoutPresets[1]);
      setGalleryUrl(null);
      setQrDataUrl(null);
      setSyncStatus("IDLE");
      setSyncError(null);
      setSyncBusy(false);
      setJobIds(null);
      syncInFlightRef.current = false;
      syncRetryCountRef.current = 0;
      setPaymentQrDataUrl(null);
      setPaymentStatus("PAID");
      setPaymentBusy(false);
      setPaymentError(null);
      setPaymentExpiresAt(null);
      setPaymentRemaining(PAYMENT_WINDOW_SECONDS);
      const windowSeconds = payload.sessionWindowSeconds ?? SESSION_WINDOW_SECONDS;
      const deadline = Date.now() + windowSeconds * 1000;
      setSessionDeadline(deadline);
      setSessionRemaining(windowSeconds);
      paymentStartedRef.current = true;
      sessionStartedRef.current = true;
      printingTriggeredRef.current = false;
      setCameraError(null);
      setCaptureBusy(false);
      setCountdown(null);
      setRetakeIndex(null);
      setEditingIndex(null);
      setEditorSettings(defaultEditorSettings);
      setJobMode(null);
      setResetCode("");
      setResetDialogOpen(false);
      setStep("LAYOUT");
    } catch (error) {
      setResetCodeError(error instanceof Error ? error.message : "Kode reset tidak dapat digunakan.");
    } finally {
      setResetCodeBusy(false);
    }
  };

  useEffect(() => {
    if (!sessionDeadline || step === "IDLE" || step === "PAYMENT") return;
    const update = () => {
      const remaining = remainingSeconds(sessionDeadline);
      setSessionRemaining(remaining);
      if (remaining === 0) reset();
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [reset, sessionDeadline, step]);

  return (
    <div className="kiosk">
      <header className="kiosk-topbar">
        <div className="kiosk-brand"><span><Aperture size={20} strokeWidth={3} /></span> SNAPORE</div>
        <div className="kiosk-status">
          <button className={`kiosk-voice-toggle ${voiceEnabled ? "active" : ""} ${voiceAvailability === "missing" ? "unavailable" : ""}`} type="button" aria-pressed={voiceEnabled && voiceAvailability === "ready"} aria-label={voiceAvailability === "missing" ? "Rekaman voice perempuan Indonesia tidak tersedia" : voiceEnabled ? "Matikan panduan suara" : "Aktifkan panduan suara"} title={voiceAvailability === "missing" ? "Aset voice lokal tidak ditemukan" : voiceEnabled ? "Rekaman perempuan Indonesia aktif" : "Panduan suara mati"} onClick={() => {
            if (voiceAvailability === "blocked") {
              setVoiceAvailability("ready");
              void playVoice(kioskStepVoiceAsset(step, layout.count), false, true);
              return;
            }
            if (voiceEnabled) {
              stopVoice();
              setVoiceEnabled(false);
            } else {
              setVoiceEnabled(true);
              void playVoice(kioskVoiceAsset("VOICE_ENABLED"), false, true);
            }
          }}>{voiceEnabled && voiceAvailability !== "missing" ? <Volume2 size={14} /> : <VolumeX size={14} />}<span>{!voiceEnabled ? "Voice off" : voiceAvailability === "missing" ? "Rekaman tidak tersedia" : voiceAvailability === "blocked" ? "Sentuh untuk suara" : "Voice perempuan"}</span></button>
          <button className="kiosk-reset-access" type="button" onClick={() => { setResetCodeError(null); setResetDialogOpen(true); void playVoice(kioskVoiceAsset("RESET_CODE"), false); }}><KeyRound size={14} /> Reset take</button>
          {step !== "IDLE" && <span className={`kiosk-timer ${step === "PAYMENT" && paymentRemaining <= 60 ? "urgent" : sessionRemaining <= 120 ? "urgent" : ""}`}><Clock3 size={14} /> {step === "PAYMENT" ? `Bayar ${formatSessionTimer(paymentRemaining)}` : `Sesi ${formatSessionTimer(sessionRemaining)}`}</span>}
          <span className="agent-status">{agentOnline ? <Wifi size={14} /> : <WifiOff size={14} />} {agentOnline ? "Local agent connected" : "Browser offline mode"}</span>
          <span className="booth-status"><span className={agentOnline ? "status-dot online" : "status-dot warn"} /> {booth.code}</span>
        </div>
      </header>

      <main className="kiosk-main">
        {step === "IDLE" && (
          <section className="kiosk-step idle-stage">
            <div className="idle-copy">
              <div className="kiosk-eyebrow"><Sparkles size={14} /> Your moment starts here</div>
              <h1><span>POSE.</span><em>SNAP.</em><span>KEEP.</span></h1>
              <p>Buat satu strip foto yang sepenuhnya kamu. Pilih layout, ambil pose terbaik, lalu bawa pulang hasil cetaknya.</p>
              <button className="start-button" onClick={() => void beginPayment()} disabled={frameCatalogStatus !== "ready"}>{frameCatalogStatus === "loading" ? "Menyiapkan booth..." : frameCatalogStatus === "maintenance" ? "Booth maintenance" : "Touch to start & pay"} <span>{frameCatalogStatus === "loading" ? <LoaderCircle className="is-spinning" size={21} /> : <ChevronRight size={23} />}</span></button>
              <button className="kiosk-secondary" type="button" onClick={bypassPaymentToFrame} disabled={frameCatalogStatus !== "ready"} style={{ marginTop: "1rem", width: "100%", justifyContent: "center" }}><ShieldCheck size={15} /> Bypass Pembayaran (Langsung Pilih Frame)</button>
              {frameCatalogStatus !== "ready" && <div className="kiosk-catalog-notice" role="status">{frameCatalogMessage}</div>}
            </div>
            <div className="strip-art" aria-hidden="true">
              <span className="idle-motion-chip idle-motion-chip-smile">SMILE!</span>
              <span className="idle-motion-chip idle-motion-chip-countdown">3 · 2 · 1</span>
              <span className="idle-camera-flash" />
              <div className="strip-art-grid"><span className="strip-photo" /><span className="strip-photo" /><span className="strip-photo" /><span className="strip-photo" /></div>
            </div>
          </section>
        )}

        {step === "PAYMENT" && (
          <section className="kiosk-step payment-stage">
            <div className="payment-intro">
              <div className="kiosk-eyebrow"><QrCode size={14} /> Pembayaran sebelum sesi</div>
              <h1>SCAN.<br /><em>PAY.</em><br />POSE.</h1>
              <p>QRIS berlaku selama 5 menit. Setelah pembayaran diterima, timer sesi 15 menit dimulai dan tetap terlihat sampai proses selesai.</p>
              <div className="payment-summary"><span>1 photo print · {booth.name}</span><strong>{formatCurrency(order.total)}</strong></div>
              <button className="kiosk-secondary" onClick={reset}><RotateCcw size={15} /> Cancel</button>
              <button className="kiosk-secondary" type="button" onClick={bypassPaymentToFrame} style={{ marginTop: "0.5rem" }}><ShieldCheck size={15} /> Bypass Pembayaran (Pilih Frame)</button>
            </div>
            <div className="payment-qr-panel">
              <div className={`payment-countdown ${paymentRemaining <= 60 ? "urgent" : ""}`}><Clock3 size={18} /><div><span>Waktu pembayaran</span><strong>{formatSessionTimer(paymentRemaining)}</strong></div></div>
              <div className="payment-qr-code">
                {paymentQrDataUrl ? <img src={paymentQrDataUrl} alt="Kode bayar QRIS" /> : <div className="payment-qr-loading"><QrCode size={58} /><span>{paymentBusy ? "Membuat kode QRIS..." : "QRIS belum tersedia"}</span></div>}
              </div>
              {paymentStatus === "PENDING" && <div className="payment-waiting"><RefreshCw className="is-spinning" size={15} /><div><strong>Menunggu pembayaran</strong><span>Status diperiksa otomatis setiap 2,5 detik</span></div></div>}
              {paymentStatus === "EXPIRED" && <div className="payment-expired"><strong>Waktu pembayaran habis</strong><span>Buat QR baru untuk memulai sesi.</span></div>}
              {paymentError && <div className="login-error" role="alert">{paymentError}</div>}
              {(paymentStatus === "EXPIRED" || (paymentError && !paymentQrDataUrl)) && <button className="kiosk-primary" onClick={() => void beginPayment(false)} disabled={paymentBusy}><RefreshCw size={16} /> Buat QRIS baru</button>}
              <small>Jangan tutup layar sampai pembayaran terkonfirmasi.</small>
            </div>
          </section>
        )}

        {step === "LAYOUT" && (
          <section className="kiosk-step">
            <header className="step-header"><div><div className="kiosk-eyebrow">01 · Layout</div><h1>How many moments?</h1></div><span className="step-count">Step 1 of 5</span></header>
            <div className="selection-grid">
              {availableLayouts.map((item) => (
                <button className={`selection-card ${layout.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => {
                  setLayout(item);
                  const compatibleFrame = availableFrames.find((candidate) => Boolean(candidate.assets[item.count]));
                  if (compatibleFrame) setFrame(compatibleFrame);
                  advance("SELECT_LAYOUT");
                }}>
                  <span className="selection-number">{item.count}</span>
                  <div className={`layout-mini grid-${item.count}`}>{Array.from({ length: item.count }, (_, index) => <span key={index} />)}</div>
                  <div><h2>{item.name}</h2><p>{item.tagline}</p></div>
                  {item.count === 4 && <span className="selection-tag">Most loved</span>}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === "FRAME" && (
          <section className="kiosk-step">
            <header className="step-header"><div><div className="kiosk-eyebrow">02 · Frame</div><h1>Pick your energy.</h1></div><span className="step-count">Step 2 of 5</span></header>
            <div className="selection-grid">
              {framesForLayout.map((item) => (
                <button className={`selection-card frame-choice ${frame.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => { setFrame(item); advance("SELECT_FRAME"); }}>
                  <div className={`frame-large ${item.tone}`}><img src={getFrameAsset(item, layout.count)} alt={`${item.name} grid ${layout.count}`} /></div>
                  <h2>{item.name}</h2><p>Exclusive Snapore frame · 4×6</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === "CAPTURE" && (
          <section className="kiosk-step capture-layout">
            <div className="camera-stage">
              {retakeIndex !== null && <button className="retake-back" onClick={cancelRetake}><X size={15} /> Cancel retake</button>}
              <video className="camera-video" ref={videoRef} playsInline muted />
              {!cameraReady && <div className="camera-placeholder"><div><Camera size={44} /><strong>{cameraError ?? "Menyiapkan kamera..."}</strong><p>Jika izin kamera ditolak, Snapore menggunakan gambar demo agar flow tetap dapat diuji.</p></div></div>}
              {countdown !== null && <div className="countdown">{countdown}</div>}
              <div className="capture-controls"><button className="shutter-button" onClick={runCountdown} disabled={captureBusy} aria-label="Ambil foto"><Aperture size={37} strokeWidth={3} /></button></div>
            </div>
            <aside className="capture-rail">
              <h3>{retakeIndex === null ? `Capture ${photos.length} / ${layout.count}` : `Retake pose ${retakeIndex + 1}`}</h3>
              <div className="capture-progress"><span style={{ width: `${retakeIndex === null ? (photos.length / layout.count) * 100 : 100}%` }} /></div>
              {Array.from({ length: layout.count }, (_, index) => (
                <div className={`capture-thumb ${photos[index] ? "done" : ""} ${retakeIndex === index ? "retake-target" : ""}`} key={index}>{photos[index] ? <img src={photos[index].url} alt={`Capture ${index + 1}`} /> : <span>Pose {index + 1}</span>}{retakeIndex === index && <strong>RETAKE</strong>}</div>
              ))}
              <div className="capture-note"><ShieldCheck size={14} style={{ marginBottom: 6 }} /><br />{retakeIndex === null ? `Setiap foto disimpan lokal. Tekan shutter untuk ${photos.length === 0 ? "memulai countdown" : "pose berikutnya"}.` : `Hanya pose ${retakeIndex + 1} yang akan diganti. Foto lain di grid ${layout.count} tetap sama.`}</div>
            </aside>
          </section>
        )}

        {step === "REVIEW" && (
          <section className="kiosk-step">
            <header className="step-header"><div><div className="kiosk-eyebrow">04 · Edit & retake</div><h1>Make every slot yours.</h1></div><span className="step-count">Grid {layout.count} · Step 4 of 5</span></header>
            <div className="review-layout">
              <div>
                <div className="review-help"><SlidersHorizontal size={16} /><span>Pilih <strong>Edit</strong> untuk memperbaiki tampilan, atau <strong>Retake</strong> untuk mengambil ulang satu pose tanpa mengulang frame.</span></div>
                <div className={`review-photos review-grid-${layout.count}`}>{photos.map((photo, index) => <div className="review-photo" key={photo.id}><img src={photo.url} alt={`Hasil foto ${index + 1}`} /><span className="photo-number">{index + 1}</span>{photo.revision > 1 && <em className="revision-badge">v{photo.revision}{photo.edited ? " · edited" : " · retake"}</em>}<div className="photo-actions"><button onClick={() => openEditor(index)}><Pencil size={14} /> Edit</button><button onClick={() => startRetake(index)}><RefreshCw size={14} /> Retake</button></div></div>)}</div>
                <div className="review-actions"><button className="kiosk-secondary" onClick={reset}><RotateCcw size={15} /> Start over</button><button className="kiosk-primary" onClick={approvePhotos}>Use these photos <ChevronRight size={16} /></button></div>
              </div>
              <PrintSheet photos={photos.map((photo) => photo.url)} layout={layout} frame={frame} />
            </div>
          </section>
        )}

        {step === "CHECKOUT" && composite && (
          <section className="kiosk-step">
            <header className="step-header"><div><div className="kiosk-eyebrow">05 · Print</div><h1>Make it tangible.</h1></div><span className="step-count">Final step</span></header>
            <div className="checkout-grid">
              <div className="print-preview"><img src={composite.dataUrl} alt="Preview final siap cetak" style={{ width: "100%", display: "block", borderRadius: 8 }} /></div>
              <div className="checkout-panel">
                <div className="payment-confirmed"><Check size={19} /><div><strong>Pembayaran diterima</strong><span>1 copy siap dikirim ke printer.</span></div></div>
                <h2>Ready to print?</h2>
                <div className="price-lines"><div className="price-row"><span>Photo package</span><strong>{formatCurrency(booth.basePrice)}</strong></div><div className="price-row"><span>Pajak {booth.taxRate}%{booth.pricesIncludeTax ? " (included)" : ""}</span><strong>{formatCurrency(order.tax)}</strong></div><div className="price-row total"><span>Sudah dibayar</span><span>{formatCurrency(order.total)}</span></div></div>
                {paymentError && <div className="login-error" role="alert">{paymentError}</div>}
                <button className="kiosk-primary" onClick={() => void confirmPrint()} disabled={paymentBusy}><Printer size={17} /> {paymentBusy ? "Preparing print..." : "Confirm & print"}</button>
                <div className="offline-assurance"><CloudOff size={17} /><span><strong>Offline-safe printing.</strong><br />File dicetak dari directory lokal. Upload ke server mulai bersamaan dan akan retry jika internet putus.</span></div>
              </div>
            </div>
          </section>
        )}

        {step === "PRINTING" && (
          <section className="kiosk-step printing-stage"><div><div className="print-animation"><div className="ejecting-sheet"><div /><div /></div></div><div className="kiosk-eyebrow">Print job accepted</div><h1>Making it real.</h1><p>Hasilmu sedang dikirim ke printer. Upload server berjalan sebagai antrean terpisah.</p></div></section>
        )}

        {step === "DONE" && (
          <section className="kiosk-step done-stage">
            <div>
              <div className="kiosk-eyebrow"><Check size={14} /> Session complete</div>
              <h1>That&apos;s a keeper.</h1>
              <p>Ambil hasil cetakmu di tray printer. Foto lokal tetap aman sampai server mengonfirmasi sinkronisasi.</p>
              <div className="done-card">
                <div className="qr-box">
                  {qrDataUrl
                    ? <img src={qrDataUrl} alt="QR galeri hasil" />
                    : <div className="qr-pending"><RefreshCw className={syncBusy ? "is-spinning" : ""} size={24} />{syncStatus === "RETRYING" ? <>Mencoba ulang<br />sinkronisasi</> : <>Menyiapkan QR<br />galeri</>}</div>}
                </div>
                <div>
                  <div className={`sync-indicator ${syncStatus.toLowerCase()}`}><span />{syncStatus === "SYNCED" ? "Tersinkronisasi" : syncStatus === "RETRYING" ? "Retry otomatis aktif" : "Sinkronisasi berlangsung"}</div>
                  <h2>{qrDataUrl ? "Scan. Save. Share." : "Print selesai."}</h2>
                  <p>{qrDataUrl ? "Pindai QR untuk membuka galeri hasil. Link akan kedaluwarsa otomatis." : jobMode === "browser-fallback" ? "Device agent tidak aktif, jadi browser mengirim hasil langsung ke server. Antrean cetak lokal tetap tersimpan." : "Upload diproses di background. QR tampil otomatis setelah server menerima file."}</p>
                  {syncError && !qrDataUrl && <small className="sync-error">{syncError}</small>}
                  {!qrDataUrl && jobMode === "browser-fallback" && <button className="sync-retry" onClick={() => void runBrowserSync()} disabled={syncBusy}><RefreshCw size={14} /> {syncBusy ? "Menyinkronkan..." : "Sinkronkan sekarang"}</button>}
                  <small>Session {sessionId.slice(0, 8).toUpperCase()}</small>
                </div>
              </div>
              <button className="start-button" onClick={reset} style={{ marginTop: 34 }}>Finish <span><Check size={20} /></span></button>
            </div>
          </section>
        )}
      </main>

      {resetDialogOpen && (
        <div className="reset-code-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !resetCodeBusy) setResetDialogOpen(false); }}>
          <section className="reset-code-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-code-title">
            <header><div><span className="kiosk-eyebrow"><KeyRound size={14} /> Session recovery</span><h2 id="reset-code-title">Masukkan kode reset</h2><p>Minta kode 6 digit dari petugas. Pembayaran tetap berlaku, tetapi seluruh progres foto sesi ini akan dimulai ulang.</p></div><button type="button" onClick={() => setResetDialogOpen(false)} disabled={resetCodeBusy} aria-label="Tutup kode reset"><X size={19} /></button></header>
            <form onSubmit={(event) => { event.preventDefault(); void redeemResetCode(); }}>
              <input autoFocus aria-label="Kode reset 6 digit" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={resetCode} onChange={(event) => setResetCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" />
              {resetCodeError ? <div className="login-error" role="alert">{resetCodeError}</div> : null}
              <button className="kiosk-primary" type="submit" disabled={resetCode.length !== 6 || resetCodeBusy}>{resetCodeBusy ? <LoaderCircle className="spin" size={16} /> : <RotateCcw size={16} />} {resetCodeBusy ? "Memeriksa..." : "Reset dan mulai ulang"}</button>
            </form>
          </section>
        </div>
      )}

      {editingIndex !== null && photos[editingIndex] && (
        <div className="editor-backdrop" role="dialog" aria-modal="true" aria-label={`Edit foto ${editingIndex + 1}`}>
          <section className="photo-editor">
            <header className="editor-header"><div><div className="kiosk-eyebrow">Edit pose {editingIndex + 1} · Grid {layout.count}</div><h2>Fine-tune this shot.</h2></div><button className="editor-close" onClick={() => setEditingIndex(null)} aria-label="Tutup editor"><X size={20} /></button></header>
            <div className="editor-body">
              <div className="editor-canvas" onPointerDown={beginEditorGesture} onPointerMove={moveEditorGesture} onPointerUp={endEditorGesture} onPointerCancel={endEditorGesture} onWheel={handleEditorWheel}>
                <img src={photos[editingIndex].url} draggable={false} alt={`Edit preview foto ${editingIndex + 1}`} style={{ filter: editorFilter(editorSettings), transform: `translate(${editorSettings.offsetX * 100}%, ${editorSettings.offsetY * 100}%) rotate(${editorSettings.rotation}deg) scale(${editorSettings.zoom}) scaleX(${editorSettings.flipped ? -1 : 1})` }} />
                <div className="gesture-hint">Drag to move · Pinch to zoom · Twist to rotate</div><div className="editor-safe-area" />
              </div>
              <aside className="editor-controls">
                <div className="control-group"><span className="control-label">Transform</span><div className="tool-row"><button className={editorSettings.rotation !== 0 ? "active" : ""} onClick={() => setEditorSettings((value) => ({ ...value, rotation: value.rotation + 90 }))}><RotateCw size={17} /> Rotate</button><button className={editorSettings.flipped ? "active" : ""} onClick={() => setEditorSettings((value) => ({ ...value, flipped: !value.flipped }))}><FlipHorizontal2 size={17} /> Mirror</button></div><small className="transform-readout">X {Math.round(editorSettings.offsetX * 100)} · Y {Math.round(editorSettings.offsetY * 100)} · {Math.round(editorSettings.rotation)}°</small></div>
                <label className="range-control"><span><strong>Zoom / pinch</strong><em>{Math.round(editorSettings.zoom * 100)}%</em></span><input type="range" min="1" max="2.25" step="0.01" value={editorSettings.zoom} onChange={(event) => setEditorSettings((value) => ({ ...value, zoom: Number(event.target.value) }))} /></label>
                <label className="range-control"><span><strong><SunMedium size={14} /> Brightness</strong><em>{Math.round(editorSettings.brightness * 100)}%</em></span><input type="range" min="0.7" max="1.3" step="0.01" value={editorSettings.brightness} onChange={(event) => setEditorSettings((value) => ({ ...value, brightness: Number(event.target.value) }))} /></label>
                <div className="control-group"><span className="control-label">Look</span><div className="filter-row">{(["normal", "warm", "mono"] as PhotoFilter[]).map((filter) => <button className={editorSettings.filter === filter ? "active" : ""} key={filter} onClick={() => setEditorSettings((value) => ({ ...value, filter }))}><span className={`filter-swatch ${filter}`} />{filter}</button>)}</div></div>
                <button className="reset-edit" onClick={() => setEditorSettings(defaultEditorSettings)}><RotateCcw size={14} /> Reset edit</button>
              </aside>
            </div>
            <footer className="editor-footer"><p>Hasil edit disimpan sebagai revisi baru di slot {editingIndex + 1}. Original sebelumnya tetap tercatat lokal.</p><div><button className="kiosk-secondary" onClick={() => setEditingIndex(null)}>Cancel</button><button className="kiosk-primary" disabled={editSaving} onClick={savePhotoEdit}>{editSaving ? "Saving..." : "Save edit"}<Check size={16} /></button></div></footer>
          </section>
        </div>
      )}
    </div>
  );
}

function PrintSheet({ photos, layout, frame }: { photos: string[]; layout: LayoutPreset; frame: (typeof framePresets)[number] }) {
  return (
    <aside className="print-preview">
      <div className={`print-sheet ${frame.tone}`}>
        <div className={`print-sheet-grid ${layout.count === 2 ? "two" : ""}`}>{photos.slice(0, layout.count).map((photo, index) => <img src={photo} alt="" key={index} />)}</div>
        <img className="print-sheet-overlay" src={getFrameAsset(frame, layout.count)} alt={`${frame.name} frame`} />
      </div>
    </aside>
  );
}
