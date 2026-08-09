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
  GripVertical,
  KeyRound,
  LoaderCircle,
  Move,
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
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import QRCode from "qrcode";
import { selectPreferredBrowserCamera } from "@/domain/camera-selection";
import type { FrameCatalogResponse } from "@/domain/frame-catalog";
import { calculateSaleFinance } from "@/domain/finance";
import { kioskStepVoiceAsset, kioskVoiceAsset, retakeVoiceAsset } from "@/domain/kiosk-voice";
import { paymentAllowsSessionStart, paymentRequiresBypass } from "@/domain/payment-flow";
import { composePrint } from "@/lib/compose";
import { captureWithAgentCamera, clearLocalSessionProgress, createPrintAndUploadJobs, getAgentHealth, getAgentJobs, getServerSyncStatus, persistCaptureLocally, syncSessionFromBrowser } from "@/lib/device-agent-client";
import { calculateOrder, framePresets, getFrameAsset, getFrameGeometry, layoutPresets, transitionSession, type FramePreset, type KioskStep, type LayoutPreset } from "@/domain/session";
import { formatSessionTimer, PAYMENT_WINDOW_SECONDS, remainingSeconds, renewSessionDeadline, SESSION_WINDOW_SECONDS } from "@/domain/session-timers";
import { clampGestureValue, getGestureMetrics, getPhotoTransformGeometry, normalizeGestureAngle, type GesturePoint } from "@/domain/photo-gestures";
import { getSlotBleed } from "@/domain/layout-geometry";
import { formatCurrency } from "@/lib/format";

type CapturedImage = {
  id: string;
  url: string;
  blob: Blob;
  storage: "directory" | "indexeddb";
  revision: number;
  edited?: boolean;
};

type PhotoFilter = "normal" | "mono" | "warm" | "cool" | "vintage" | "vivid";
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

async function captureBrowserFrame(video: HTMLVideoElement | null, cameraReady: boolean, fallbackIndex: number) {
  if (!cameraReady || !video || video.videoWidth <= 0) return createDemoCapture(fallbackIndex);
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
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Capture gagal")), "image/jpeg", .94));
}

function editorFilter(settings: EditorSettings) {
  const look = settings.filter === "mono"
    ? "grayscale(1) contrast(1.1)"
    : settings.filter === "warm"
      ? "sepia(0.35) saturate(1.25)"
      : settings.filter === "cool"
        ? "hue-rotate(180deg) saturate(1.15)"
        : settings.filter === "vintage"
          ? "sepia(0.5) contrast(0.9) brightness(1.05)"
          : settings.filter === "vivid"
            ? "saturate(1.8) contrast(1.15)"
            : "saturate(1)";
  return `brightness(${settings.brightness}) ${look}`;
}

function PhotoLayer({
  src,
  alt,
  settings,
  slotWidth,
  slotHeight,
  className,
}: {
  src: string;
  alt: string;
  settings: EditorSettings;
  slotWidth: number;
  slotHeight: number;
  className?: string;
}) {
  const [dimensions, setDimensions] = useState({ width: 1280, height: 960 });
  const transform = useMemo(() => getPhotoTransformGeometry({
    imageWidth: dimensions.width,
    imageHeight: dimensions.height,
    slotWidth,
    slotHeight,
    rotation: settings.rotation,
    zoom: settings.zoom,
    offsetX: settings.offsetX,
    offsetY: settings.offsetY,
  }), [dimensions.height, dimensions.width, settings.offsetX, settings.offsetY, settings.rotation, settings.zoom, slotHeight, slotWidth]);

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      draggable={false}
      onLoad={(event) => {
        const image = event.currentTarget;
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          setDimensions((current) => current.width === image.naturalWidth && current.height === image.naturalHeight
            ? current
            : { width: image.naturalWidth, height: image.naturalHeight });
        }
      }}
      style={{
        position: "absolute",
        left: `${50 + transform.offsetX * 100}%`,
        top: `${50 + transform.offsetY * 100}%`,
        width: `${transform.widthPercent}%`,
        height: `${transform.heightPercent}%`,
        maxWidth: "none",
        maxHeight: "none",
        objectFit: "fill",
        filter: editorFilter(settings),
        transform: `translate(-50%, -50%) rotate(${settings.rotation}deg) scaleX(${settings.flipped ? -1 : 1})`,
        transformOrigin: "center center",
      }}
    />
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
  voiceEnabled: boolean;
  maxRetakes: number;
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
  const [cameraLabel, setCameraLabel] = useState("Auto camera");
  const [agentCamera, setAgentCamera] = useState<{ id: string; name: string; kind?: string } | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [retakeIndex, setRetakeIndex] = useState<number | null>(null);
  const [retakesUsed, setRetakesUsed] = useState(0);
  const [maxRetakes, setMaxRetakes] = useState(booth.maxRetakes);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(defaultEditorSettings);
  const [draggedPhotoIndex, setDraggedPhotoIndex] = useState<number | null>(null);
  const [dragOverSlotIndex, setDragOverSlotIndex] = useState<number | null>(null);
  const [photoSettingsMap, setPhotoSettingsMap] = useState<Record<number, EditorSettings>>({});
  const [editSaving, setEditSaving] = useState(false);

  const updateSlotSettings = useCallback((index: number, updater: (prev: EditorSettings) => EditorSettings) => {
    setPhotoSettingsMap((current) => {
      const prev = current[index] ?? defaultEditorSettings;
      return { ...current, [index]: updater(prev) };
    });
  }, []);

  const swapPhotos = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    setPhotos((current) => {
      if (fromIndex >= current.length || toIndex >= current.length) return current;
      const next = [...current];
      const temp = next[fromIndex];
      next[fromIndex] = next[toIndex];
      next[toIndex] = temp;
      return next;
    });
    setPhotoSettingsMap((current) => {
      const next = { ...current };
      const temp = next[fromIndex] ?? defaultEditorSettings;
      next[fromIndex] = next[toIndex] ?? defaultEditorSettings;
      next[toIndex] = temp;
      return next;
    });
    setDraggedPhotoIndex(null);
    setDragOverSlotIndex(null);
  }, []);
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
  const [paymentBypassRequired, setPaymentBypassRequired] = useState(false);
  const [paymentExpiresAt, setPaymentExpiresAt] = useState<number | null>(null);
  const [paymentRemaining, setPaymentRemaining] = useState(PAYMENT_WINDOW_SECONDS);
  const [sessionDeadline, setSessionDeadline] = useState<number | null>(null);
  const [sessionRemaining, setSessionRemaining] = useState(SESSION_WINDOW_SECONDS);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [resetCodeBusy, setResetCodeBusy] = useState(false);
  const [resetCodeError, setResetCodeError] = useState<string | null>(null);
  const [bypassDialogOpen, setBypassDialogOpen] = useState(false);
  const [bypassPasscode, setBypassPasscode] = useState("");
  const [bypassOperatorId, setBypassOperatorId] = useState("");
  const [bypassReason, setBypassReason] = useState("");
  const [bypassBusy, setBypassBusy] = useState(false);
  const [bypassError, setBypassError] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(booth.voiceEnabled);
  const [voiceAvailability, setVoiceAvailability] = useState<"ready" | "blocked" | "missing">("ready");

  useEffect(() => {
    const activeKeys = new Set<string>();

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      activeKeys.add(key);

      const isCtrl = event.ctrlKey || event.metaKey;
      const hasZ = activeKeys.has("z");
      const hasX = activeKeys.has("x");

      if (isCtrl && hasZ && hasX) {
        event.preventDefault();
        setBypassDialogOpen(true);
        setBypassError(null);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      activeKeys.delete(event.key.toLowerCase());
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);
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
  const remoteVoiceEnabledRef = useRef(booth.voiceEnabled);

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
    let active = true;
    const syncVoiceSetting = async () => {
      try {
        const response = await fetch(`/api/kiosk/${encodeURIComponent(booth.id)}/settings`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { kioskEnabled?: boolean; maintenanceMode?: boolean; voiceEnabled?: boolean; maxRetakes?: number };
        if (!active) return;
        if (payload.kioskEnabled === false || payload.maintenanceMode === true) {
          streamRef.current?.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          stopVoice();
          window.location.reload();
          return;
        }
        if (typeof payload.maxRetakes === "number") setMaxRetakes(Math.max(0, Math.min(20, payload.maxRetakes)));
        if (typeof payload.voiceEnabled === "boolean" && payload.voiceEnabled !== remoteVoiceEnabledRef.current) {
          remoteVoiceEnabledRef.current = payload.voiceEnabled;
          setVoiceEnabled(payload.voiceEnabled);
          if (!payload.voiceEnabled) {
            stopVoice();
          } else {
            setVoiceAvailability("ready");
            void playVoice(kioskVoiceAsset("VOICE_ENABLED"), false, true);
          }
        }
      } catch {
        // Keep the last known setting while the kiosk is temporarily offline.
      }
    };
    void syncVoiceSetting();
    const timer = window.setInterval(() => void syncVoiceSetting(), 1_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [booth.id, playVoice, stopVoice]);

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
        if (!payload.operational) {
          setAvailableFrames([]);
          setAvailableLayoutCounts([]);
          setFrameCatalogStatus("maintenance");
          setFrameCatalogMessage(payload.maintenanceReason ?? "Booth belum memiliki layout dan frame yang cocok.");
          return;
        }
        const tones: FramePreset["tone"][] = ["coral", "mint", "blue", "custom"];
        const accents = ["#ff614f", "#baf867", "#4d63ff", "#ffd95a"];
        const databaseFrames = payload.frames.map((item, index): FramePreset => ({
          ...item,
          tone: tones[index % tones.length],
          accent: accents[index % accents.length],
        }));
        const mergedFrames = [
          ...databaseFrames,
          ...framePresets.filter((preset) => !databaseFrames.some((dbFrame) => dbFrame.id === preset.id || dbFrame.slug === preset.slug)),
        ];
        const effectiveFrames = mergedFrames.length > 0 ? mergedFrames : framePresets;
        const availableCounts = payload.layoutCounts;
        const selectedLayout = layoutPresets.find((item) => availableCounts.includes(item.count) && item.count === layout.count)
          ?? layoutPresets.find((item) => availableCounts.includes(item.count))
          ?? layoutPresets[1];

        setAvailableFrames(effectiveFrames);
        setAvailableLayoutCounts(availableCounts);
        setLayout(selectedLayout);
        setFrame(effectiveFrames.find((item) => Boolean(item.assets[selectedLayout.count])) ?? effectiveFrames[0]);
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
      if (active) {
        setAgentOnline(health.online);
        const sdkCamera = health.devices?.find((device) => device.type === "CAMERA" && device.id !== "browser-camera" && device.status === "ONLINE");
        setAgentCamera(sdkCamera ? { id: sdkCamera.id, name: sdkCamera.name, kind: sdkCamera.kind } : null);
      }
    };
    void check();
    const timer = window.setInterval(check, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (step !== "CAPTURE") return;
    let cancelled = false;
    let generation = 0;
    const startCamera = async () => {
      const currentGeneration = ++generation;
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("MediaDevices tidak tersedia");
        streamRef.current?.getTracks().forEach((track) => track.stop());
        let stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "user" },
          audio: false,
        });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const preferred = selectPreferredBrowserCamera(devices, navigator.userAgent);
        const activeDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId;
        if (preferred?.deviceId && preferred.deviceId !== activeDeviceId) {
          stream.getTracks().forEach((track) => track.stop());
          stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: preferred.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
          });
        }
        if (cancelled || currentGeneration !== generation) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraLabel(stream.getVideoTracks()[0]?.label || preferred?.label || "Kamera perangkat");
        setCameraError(null);
        setCameraReady(true);
      } catch {
        setCameraError("Kamera tidak tersedia. Mode demo capture aktif.");
        setCameraReady(false);
      }
    };
    void startCamera();
    navigator.mediaDevices?.addEventListener?.("devicechange", startCamera);
    return () => {
      cancelled = true;
      generation += 1;
      navigator.mediaDevices?.removeEventListener?.("devicechange", startCamera);
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
        captures: photos.map((photo, slotIndex) => ({ id: photo.id, blob: photo.blob, slotIndex, revision: photo.revision })),
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
    if (agentCamera) {
      try {
        blob = await captureWithAgentCamera(agentCamera.id);
      } catch {
        blob = await captureBrowserFrame(video, cameraReady, retakeIndex ?? photos.length);
      }
    } else {
      blob = await captureBrowserFrame(video, cameraReady, retakeIndex ?? photos.length);
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
    if (retakeIndex !== null) {
      setPhotoSettingsMap((current) => ({ ...current, [retakeIndex]: defaultEditorSettings }));
    }
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
      setRetakesUsed((current) => current + 1);
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
    if (retakesUsed >= maxRetakes) return;
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
    setEditorSettings(photoSettingsMap[index] ?? defaultEditorSettings);
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
          ? clampGestureValue(value.zoom * (next.distance / gesture.distance), 1, 4)
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
      : { ...value, zoom: clampGestureValue(value.zoom - event.deltaY * .0015, 1, 4) });
  };

  const savePhotoEdit = () => {
    if (editingIndex === null) return;
    const current = photos[editingIndex];
    if (!current) return;
    setEditSaving(true);
    setPhotos((items) => items.map((photo, index) => index === editingIndex
      ? { ...photo, revision: photo.revision + 1, edited: true }
      : photo));
    setPhotoSettingsMap((prev) => ({ ...prev, [editingIndex]: editorSettings }));
    setEditingIndex(null);
    setEditorSettings(defaultEditorSettings);
    setEditSaving(false);
  };

  const approvePhotos = async () => {
    const result = await composePrint({
      photos: photos.map((photo) => photo.url),
      photoSettings: photoSettingsMap,
      count: layout.count,
      frameTone: frame.tone,
      frameAsset: getFrameAsset(frame, layout.count),
      frameGeometry: getFrameGeometry(frame, layout.count),
    });
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
      captures: photos.map((photo, slotIndex) => ({ id: photo.id, blob: photo.blob, slotIndex, revision: photo.revision })),
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

  const submitBypass = useCallback(async () => {
    if (!bypassPasscode || !bypassOperatorId) {
      setBypassError("Masukkan Kode Bypass dan ID / Kode Petugas.");
      return;
    }

    setBypassBusy(true);
    setBypassError(null);
    try {
      const response = await fetch("/api/payments/bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boothId: booth.id,
          sessionId,
          passCode: bypassPasscode,
          operatorId: bypassOperatorId,
          reason: bypassReason || "Otorisasi Petugas Kiosk",
        }),
      });

      const payload = await response.json() as { error?: string; success?: boolean };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Kode otorisasi bypass salah.");
      }

      if (!sessionStartedRef.current) {
        sessionStartedRef.current = true;
        const deadline = Date.now() + SESSION_WINDOW_SECONDS * 1000;
        setSessionDeadline(deadline);
        setSessionRemaining(SESSION_WINDOW_SECONDS);
        setPaymentStatus("PAID");
      }

      setBypassDialogOpen(false);
      setPaymentBypassRequired(false);
      setBypassPasscode("");
      setBypassReason("");
      advance("BYPASS_TO_FRAME");
    } catch (err) {
      setBypassError(err instanceof Error ? err.message : "Proses bypass gagal.");
    } finally {
      setBypassBusy(false);
    }
  }, [advance, booth.id, bypassOperatorId, bypassPasscode, bypassReason, sessionId]);

  const beginPayment = async (fromIdle = true) => {
    if (paymentBusy || paymentStartedRef.current || frameCatalogStatus !== "ready") return;
    if (fromIdle) {
      void playVoice(kioskStepVoiceAsset("PAYMENT", layout.count));
      advance("START");
    }
    paymentStartedRef.current = true;
    setPaymentBusy(true);
    setPaymentError(null);
    setPaymentBypassRequired(false);
    setPaymentQrDataUrl(null);
    setPaymentStatus("IDLE");
    setPaymentRemaining(PAYMENT_WINDOW_SECONDS);
    try {
      const response = await fetch("/api/payments/qris", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ boothId: booth.id, sessionId, copies: 1 }),
      });
      const payload = await response.json() as { error?: string; status?: string; qrString?: string; expiresAt?: string | null; bypassAvailable?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "Pembayaran gagal disiapkan.");
      if (paymentRequiresBypass(payload.status, payload.bypassAvailable)) {
        paymentStartedRef.current = false;
        setPaymentBypassRequired(true);
        setBypassError(null);
        setBypassDialogOpen(true);
        return;
      }
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
    setPaymentBypassRequired(false);
    setPaymentExpiresAt(null);
    setPaymentRemaining(PAYMENT_WINDOW_SECONDS);
    setSessionDeadline(null);
    setSessionRemaining(SESSION_WINDOW_SECONDS);
    setSessionExpired(false);
    paymentStartedRef.current = false;
    sessionStartedRef.current = false;
    printingTriggeredRef.current = false;
    setCameraError(null);
    setCaptureBusy(false);
    setRetakeIndex(null);
    setRetakesUsed(0);
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
      setSessionExpired(false);
      paymentStartedRef.current = true;
      sessionStartedRef.current = true;
      printingTriggeredRef.current = false;
      setCameraError(null);
      setCaptureBusy(false);
      setCountdown(null);
      setRetakeIndex(null);
      setRetakesUsed(0);
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
    if (!sessionDeadline || sessionExpired || step === "IDLE" || step === "PAYMENT") return;
    const update = () => {
      const remaining = remainingSeconds(sessionDeadline);
      setSessionRemaining(remaining);
      if (remaining === 0) {
        setSessionDeadline(null);
        setSessionExpired(true);
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [sessionDeadline, sessionExpired, step]);

  const continueExpiredSession = () => {
    const deadline = renewSessionDeadline(Date.now());
    setSessionDeadline(deadline);
    setSessionRemaining(SESSION_WINDOW_SECONDS);
    setSessionExpired(false);
  };

  const activeFrameGeometry = getFrameGeometry(frame, layout.count);
  const activeEditorSlot = editingIndex === null
    ? activeFrameGeometry.slots[0]
    : activeFrameGeometry.slots[editingIndex] ?? activeFrameGeometry.slots[0];
  const retakesRemaining = Math.max(0, maxRetakes - retakesUsed);

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
            </div>
            <div className="payment-qr-panel">
              <div className={`payment-countdown ${paymentRemaining <= 60 ? "urgent" : ""}`}><Clock3 size={18} /><div><span>Waktu pembayaran</span><strong>{formatSessionTimer(paymentRemaining)}</strong></div></div>
              <div className="payment-qr-code">
                {paymentQrDataUrl ? <img src={paymentQrDataUrl} alt="Kode bayar QRIS" /> : <div className="payment-qr-loading">{paymentBypassRequired ? <ShieldCheck size={58} /> : <QrCode size={58} />}<span>{paymentBusy ? "Membuat kode QRIS..." : paymentBypassRequired ? "Menunggu otorisasi petugas" : "QRIS belum tersedia"}</span></div>}
              </div>
              {paymentStatus === "PENDING" && <div className="payment-waiting"><RefreshCw className="is-spinning" size={15} /><div><strong>Menunggu pembayaran</strong><span>Status diperiksa otomatis setiap 2,5 detik</span></div></div>}
              {paymentStatus === "EXPIRED" && <div className="payment-expired"><strong>Waktu pembayaran habis</strong><span>Buat QR baru untuk memulai sesi.</span></div>}
              {paymentError && <div className="login-error" role="alert">{paymentError}</div>}
              {paymentBypassRequired && <button className="kiosk-primary" onClick={() => { setBypassError(null); setBypassDialogOpen(true); }}><ShieldCheck size={16} /> Otorisasi pembayaran</button>}
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
              <div className="capture-headsup" aria-live="polite">
                <span><Camera size={14} /> {retakeIndex === null ? `Pose ${Math.min(photos.length + 1, layout.count)} dari ${layout.count}` : `Ulang pose ${retakeIndex + 1}`}</span>
                <span className="camera-source-chip" title={agentCamera ? `${agentCamera.kind ?? "SDK"} · ${agentCamera.name}` : cameraLabel}><Camera size={13} /> {agentCamera ? `${agentCamera.kind ?? "SDK"} · ${agentCamera.name}` : cameraLabel}</span>
                <span className={retakesRemaining === 0 ? "empty" : ""}><RefreshCw size={13} /> Retake {retakesRemaining}/{maxRetakes}</span>
              </div>
              <video className="camera-video" ref={videoRef} playsInline muted />
              {!cameraReady && <div className="camera-placeholder"><div><Camera size={44} /><strong>{agentCamera ? `${agentCamera.name} siap` : cameraError ?? "Mendeteksi kamera..."}</strong><p>{agentCamera ? "Capture memakai SDK camera melalui local agent. Preview browser tidak tersedia untuk perangkat ini." : "Kamera laptop, tablet, atau handphone akan dipilih otomatis. Mode demo hanya digunakan jika tidak ada kamera."}</p></div></div>}
              {countdown !== null && <div className="countdown">{countdown}</div>}
              <div className="capture-controls"><button className="shutter-button" onClick={runCountdown} disabled={captureBusy} aria-label={retakeIndex === null ? `Ambil pose ${photos.length + 1}` : `Ulang pose ${retakeIndex + 1}`}><Aperture size={37} strokeWidth={3} /></button><span>{captureBusy ? "Bersiap..." : retakeIndex === null ? "Tekan untuk ambil foto" : "Tekan untuk mengganti pose"}</span></div>
            </div>
            <aside className="capture-rail">
              <div className="capture-rail-header"><div><span>PHOTO SESSION</span><h3>{retakeIndex === null ? `${photos.length} dari ${layout.count} pose selesai` : `Mengulang pose ${retakeIndex + 1}`}</h3></div><strong>{Math.round((photos.length / layout.count) * 100)}%</strong></div>
              <div className="capture-progress"><span style={{ width: `${retakeIndex === null ? (photos.length / layout.count) * 100 : 100}%` }} /></div>
              <div className={`retake-budget ${retakesRemaining === 0 ? "empty" : ""}`}><RefreshCw size={15} /><div><strong>{retakesRemaining} retake tersisa</strong><span>Batas booth: {maxRetakes} kali per sesi</span></div></div>
              <div className="capture-thumbs-box">
                {Array.from({ length: layout.count }, (_, index) => (
                  <div className={`capture-thumb ${photos[index] ? "done" : ""} ${retakeIndex === index ? "retake-target" : ""}`} key={index}>{photos[index] ? <img src={photos[index].url} alt={`Capture ${index + 1}`} /> : <span>Pose {index + 1}</span>}<em>{index + 1}</em>{retakeIndex === index && <strong>RETAKE</strong>}</div>
                ))}
              </div>
              <div className="capture-note"><ShieldCheck size={14} style={{ marginBottom: 6 }} /><br />{retakeIndex === null ? `Setiap foto disimpan lokal. Tekan shutter untuk ${photos.length === 0 ? "memulai countdown" : "pose berikutnya"}.` : `Hanya pose ${retakeIndex + 1} yang akan diganti. Foto lain di grid ${layout.count} tetap sama.`}</div>
            </aside>
          </section>
        )}

        {step === "REVIEW" && (
          <section className="kiosk-step">
            <header className="step-header"><div><div className="kiosk-eyebrow">04 · Edit & retake</div><h1>Make every slot yours.</h1></div><span className="step-count">Grid {layout.count} · Step 4 of 5</span></header>
            <div className="review-layout">
              <div>
                <div className="review-help"><SlidersHorizontal size={16} /><span>Pilih <strong>Edit</strong> untuk menggeser & zoom foto, atau <strong>drag & drop</strong> foto ke slot frame. Retake tersisa: <strong>{retakesRemaining} dari {maxRetakes}</strong>.</span></div>
                <div className="review-photos-box">
                  <div className="review-box-header">
                    <div className="box-title">
                      <GripVertical size={15} />
                      <strong>{photos.length} Pose Foto</strong>
                      <span>Tarik foto ke slot frame untuk ubah tata letak</span>
                    </div>
                    <span className={`box-badge ${retakesRemaining === 0 ? "quota-empty" : ""}`}>{retakesRemaining === 0 ? "Retake habis" : `${retakesRemaining} retake tersisa`}</span>
                  </div>
                  <div className={`review-photos review-grid-${layout.count}`}>
                    {photos.map((photo, index) => {
                      const isDragging = draggedPhotoIndex === index;
                      const isTarget = dragOverSlotIndex === index;
                      return (
                        <div
                          className={`review-photo ${isDragging ? "is-dragging" : ""} ${isTarget ? "drop-target-active" : ""}`}
                          key={photo.id}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData("text/plain", String(index));
                            setDraggedPhotoIndex(index);
                          }}
                          onDragEnd={() => {
                            setDraggedPhotoIndex(null);
                            setDragOverSlotIndex(null);
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            setDragOverSlotIndex(index);
                          }}
                          onDragLeave={() => {
                            if (dragOverSlotIndex === index) setDragOverSlotIndex(null);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const raw = event.dataTransfer.getData("text/plain");
                            const from = raw !== "" ? Number(raw) : draggedPhotoIndex;
                            if (from !== null && !isNaN(from)) swapPhotos(from, index);
                          }}
                        >
                          <img src={photo.url} alt={`Hasil foto ${index + 1}`} />
                          <span className="photo-number">{index + 1}</span>
                          <span className="drag-handle" title="Drag foto ini"><GripVertical size={14} /></span>
                          {photo.revision > 1 && <em className="revision-badge">v{photo.revision}{photo.edited ? " · edited" : " · retake"}</em>}
                          <div className="photo-actions">
                            <button onClick={() => openEditor(index)}><Pencil size={14} /> Edit</button>
                            <button onClick={() => startRetake(index)} disabled={retakesRemaining === 0} title={retakesRemaining === 0 ? "Kuota retake booth sudah habis" : `Retake pose ${index + 1}`}><RefreshCw size={14} /> {retakesRemaining === 0 ? "Habis" : "Retake"}</button>
                          </div>
                          {isTarget && <div className="slot-drop-overlay"><Move size={18} /> Tukar dengan Pose {index + 1}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="review-actions"><button className="kiosk-secondary" onClick={reset}><RotateCcw size={15} /> Start over</button><button className="kiosk-primary" onClick={approvePhotos}>Use these photos <ChevronRight size={16} /></button></div>
              </div>
              <PrintSheet
                photos={photos.map((photo) => photo.url)}
                photoSettings={photoSettingsMap}
                layout={layout}
                frame={frame}
                draggedIndex={draggedPhotoIndex}
                dragOverIndex={dragOverSlotIndex}
                onSwapPhotos={swapPhotos}
                onSlotDragStart={(index) => setDraggedPhotoIndex(index)}
                onSlotDragOver={(index) => setDragOverSlotIndex(index)}
                onSlotDragLeave={() => setDragOverSlotIndex(null)}
                onSlotDragEnd={() => {
                  setDraggedPhotoIndex(null);
                  setDragOverSlotIndex(null);
                }}
                onOpenEditor={(index) => openEditor(index)}
                onUpdateSlotSettings={updateSlotSettings}
              />
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
              <button className="start-button done-finish-button" onClick={reset}>Finish <span><Check size={20} /></span></button>
            </div>
          </section>
        )}
      </main>

      {sessionExpired && (
        <div className="session-expired-backdrop" role="presentation">
          <section className="session-expired-dialog" role="dialog" aria-modal="true" aria-labelledby="session-expired-title">
            <div className="session-expired-icon"><Clock3 size={34} /></div>
            <span className="kiosk-eyebrow">Waktu sesi selesai</span>
            <h2 id="session-expired-title">Mau lanjut dari sini?</h2>
            <p>Foto dan semua editanmu masih aman. Lanjutkan untuk kembali ke step <strong>{step}</strong> dengan tambahan waktu 15 menit.</p>
            <div className="session-expired-actions">
              <button className="kiosk-secondary" type="button" onClick={reset}><RotateCcw size={16} /> Akhiri sesi</button>
              <button className="kiosk-primary" type="button" onClick={continueExpiredSession}><ChevronRight size={17} /> Lanjutkan sesi</button>
            </div>
          </section>
        </div>
      )}

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

      {bypassDialogOpen && (
        <div className="reset-code-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !bypassBusy) setBypassDialogOpen(false); }}>
          <section className="reset-code-dialog" style={{ width: "min(520px, 100%)" }} role="dialog" aria-modal="true" aria-labelledby="bypass-dialog-title">
            <header>
              <div>
                <span className="kiosk-eyebrow" style={{ color: "var(--kiosk-coral)" }}><ShieldCheck size={14} /> Otorisasi Petugas</span>
                <h2 id="bypass-dialog-title">Bypass Pembayaran</h2>
                <p>Kombinasi <code>Ctrl + Z + X</code> terdeteksi. Masukkan Kode Bypass dan ID / Kode Petugas untuk memverifikasi otorisasi manual.</p>
              </div>
              <button type="button" onClick={() => setBypassDialogOpen(false)} disabled={bypassBusy} aria-label="Tutup modal bypass"><X size={19} /></button>
            </header>
            <form onSubmit={(event) => { event.preventDefault(); void submitBypass(); }}>
              <div className="bypass-fields">
                <label className="bypass-field-label">
                  <span>ID / Kode Petugas (Wajib Identifikasi)</span>
                  <input
                    className="bypass-field-input"
                    autoFocus
                    required
                    placeholder="Contoh: OP-001 / Budi"
                    value={bypassOperatorId}
                    onChange={(e) => setBypassOperatorId(e.target.value)}
                  />
                </label>
                <label className="bypass-field-label">
                  <span>Kode Otorisasi Bypass Petugas</span>
                  <input
                    className="bypass-field-input"
                    type="password"
                    required
                    placeholder="Masukkan kode otorisasi bypass"
                    value={bypassPasscode}
                    onChange={(e) => setBypassPasscode(e.target.value)}
                  />
                </label>
                <label className="bypass-field-label">
                  <span>Alasan / Catatan Bypass (Opsional)</span>
                  <input
                    className="bypass-field-input"
                    placeholder="Contoh: Testing Booth / Voucher Promo"
                    value={bypassReason}
                    onChange={(e) => setBypassReason(e.target.value)}
                  />
                </label>
              </div>
              {bypassError ? <div className="login-error" role="alert" style={{ marginBottom: 12 }}>{bypassError}</div> : null}
              <button className="kiosk-primary" type="submit" disabled={!bypassPasscode || !bypassOperatorId || bypassBusy} style={{ width: "100%", justifyContent: "center" }}>
                {bypassBusy ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}
                {bypassBusy ? "Memverifikasi..." : "Otorisasi & Bypass Pembayaran"}
              </button>
            </form>
          </section>
        </div>
      )}

      {editingIndex !== null && photos[editingIndex] && (
        <div className="editor-backdrop" role="dialog" aria-modal="true" aria-label={`Edit foto ${editingIndex + 1}`}>
          <section className="photo-editor">
            <header className="editor-header">
              <div>
                <div className="kiosk-eyebrow">Edit pose {editingIndex + 1} · Grid {layout.count}</div>
                <h2>Fine-tune this slot.</h2>
              </div>
              <button className="editor-close" onClick={() => setEditingIndex(null)} aria-label="Tutup editor"><X size={20} /></button>
            </header>
            <div className="editor-body">
              <div
                className="editor-canvas"
                style={{ aspectRatio: `${activeEditorSlot?.width ?? 4} / ${activeEditorSlot?.height ?? 3}` }}
                onPointerDown={beginEditorGesture}
                onPointerMove={moveEditorGesture}
                onPointerUp={endEditorGesture}
                onPointerCancel={endEditorGesture}
                onWheel={handleEditorWheel}
              >
                <PhotoLayer
                  src={photos[editingIndex].url}
                  alt={`Edit preview foto ${editingIndex + 1}`}
                  settings={editorSettings}
                  slotWidth={activeEditorSlot?.width ?? 4}
                  slotHeight={activeEditorSlot?.height ?? 3}
                  className="editor-photo-layer"
                />
                <div className="gesture-hint"><Move size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />Geser foto: Drag mouse / 1 jari · Zoom: Scroll mouse wheel / Pinch 2 jari</div>
                <div className="editor-safe-area" />
              </div>
              <aside className="editor-controls">
                <div className="control-group">
                  <span className="control-label">Transform & Orientation</span>
                  <div className="tool-row">
                    <button className={editorSettings.flipped ? "active" : ""} onClick={() => setEditorSettings((value) => ({ ...value, flipped: !value.flipped }))}>
                      <FlipHorizontal2 size={17} /> Mirror
                    </button>
                    <button className={editorSettings.rotation % 360 !== 0 ? "active" : ""} onClick={() => setEditorSettings((value) => ({ ...value, rotation: (value.rotation + 90) % 360 }))}>
                      <RotateCw size={17} /> +90°
                    </button>
                  </div>
                  <div className="preset-row" style={{ marginTop: 6, display: "flex", gap: 6 }}>
                    {[0, 90, 180, 270].map((deg) => (
                      <button
                        key={deg}
                        type="button"
                        className={`chip-button ${Math.round(editorSettings.rotation % 360) === deg ? "active" : ""}`}
                        onClick={() => setEditorSettings((value) => ({ ...value, rotation: deg }))}
                      >
                        {deg}°
                      </button>
                    ))}
                  </div>
                  <small className="transform-readout">Position X: {Math.round(editorSettings.offsetX * 100)}% · Y: {Math.round(editorSettings.offsetY * 100)}% · {Math.round(editorSettings.rotation)}°</small>
                </div>

                <div className="control-group">
                  <span className="control-label">Zoom Scale (Scroll / Slider)</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button type="button" className="step-btn" title="Zoom Out" onClick={() => setEditorSettings((v) => ({ ...v, zoom: clampGestureValue(v.zoom - 0.1, 1, 4) }))}><ZoomOut size={14} /></button>
                    <input
                      type="range"
                      min="1"
                      max="4"
                      step="0.01"
                      value={editorSettings.zoom}
                      onChange={(event) => setEditorSettings((value) => ({ ...value, zoom: Number(event.target.value) }))}
                      style={{ flex: 1 }}
                    />
                    <button type="button" className="step-btn" title="Zoom In" onClick={() => setEditorSettings((v) => ({ ...v, zoom: clampGestureValue(v.zoom + 0.1, 1, 4) }))}><ZoomIn size={14} /></button>
                    <strong style={{ minWidth: 42, textAlign: "right" }}>{Math.round(editorSettings.zoom * 100)}%</strong>
                  </div>
                </div>

                <div className="control-group">
                  <span className="control-label"><SunMedium size={14} style={{ verticalAlign: "middle", marginRight: 4 }} /> Brightness</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="range"
                      min="0.7"
                      max="1.3"
                      step="0.01"
                      value={editorSettings.brightness}
                      onChange={(event) => setEditorSettings((value) => ({ ...value, brightness: Number(event.target.value) }))}
                      style={{ flex: 1 }}
                    />
                    <strong style={{ minWidth: 42, textAlign: "right" }}>{Math.round(editorSettings.brightness * 100)}%</strong>
                  </div>
                </div>
              <div className="control-group">
                  <span className="control-label">Color Filters & Style</span>
                  <div className="filter-row" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                    {(["normal", "mono", "warm", "cool", "vintage", "vivid"] as PhotoFilter[]).map((filter) => (
                      <button
                        className={editorSettings.filter === filter ? "active" : ""}
                        key={filter}
                        onClick={() => setEditorSettings((value) => ({ ...value, filter }))}
                      >
                        <span className={`filter-swatch ${filter}`} />
                        {filter}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="reset-edit" style={{ flex: 1 }} onClick={() => setEditorSettings(defaultEditorSettings)}>
                    <RotateCcw size={14} /> Reset edit
                  </button>
                  <button
                    className="reset-edit danger"
                    style={{ flex: 1 }}
                    disabled={retakesRemaining === 0}
                    title={retakesRemaining === 0 ? "Kuota retake booth sudah habis" : "Ambil ulang pose ini"}
                    onClick={() => {
                      const idx = editingIndex;
                      setEditingIndex(null);
                      startRetake(idx);
                    }}
                  >
                    <RefreshCw size={14} /> {retakesRemaining === 0 ? "Retake habis" : `Retake pose (${retakesRemaining})`}
                  </button>
                </div>
              </aside>
            </div>
            <footer className="editor-footer">
              <p>Hasil edit disimpan sebagai revisi baru di slot {editingIndex + 1}. Original foto tersimpan lokal.</p>
              <div>
                <button className="kiosk-secondary" onClick={() => setEditingIndex(null)}>Cancel</button>
                <button className="kiosk-primary" disabled={editSaving} onClick={savePhotoEdit}>
                  {editSaving ? "Saving..." : "Save edit"}<Check size={16} />
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function PrintSheet({
  photos,
  photoSettings = {},
  layout,
  frame,
  draggedIndex,
  dragOverIndex,
  onSwapPhotos,
  onSlotDragStart,
  onSlotDragOver,
  onSlotDragLeave,
  onSlotDragEnd,
  onOpenEditor,
  onUpdateSlotSettings,
}: {
  photos: string[];
  photoSettings?: Record<number, EditorSettings>;
  layout: LayoutPreset;
  frame: (typeof framePresets)[number];
  draggedIndex?: number | null;
  dragOverIndex?: number | null;
  onSwapPhotos?: (from: number, to: number) => void;
  onSlotDragStart?: (index: number) => void;
  onSlotDragOver?: (index: number) => void;
  onSlotDragLeave?: () => void;
  onSlotDragEnd?: () => void;
  onOpenEditor?: (index: number) => void;
  onUpdateSlotSettings?: (index: number, updater: (prev: EditorSettings) => EditorSettings) => void;
}) {
  const geometry = getFrameGeometry(frame, layout.count);
  const slots = geometry.slots;
  const activeGestureRef = useRef<(GestureState & { slotIndex: number }) | null>(null);

  const finishSlotGesture = (event: ReactPointerEvent<HTMLDivElement>, index: number) => {
    const gesture = activeGestureRef.current;
    if (!gesture || gesture.slotIndex !== index) return;
    gesture.pointers.delete(event.pointerId);
    const next = getGestureMetrics(gesture.pointers.values());
    gesture.center = next.center;
    gesture.distance = next.distance;
    gesture.angle = next.angle;
    if (gesture.pointers.size === 0) activeGestureRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
  };

  return (
    <aside className="print-preview">
      <div className={`print-sheet ${frame.tone}`} style={{ aspectRatio: `${geometry.width} / ${geometry.height}` }}>
        <div className="print-sheet-canvas">
          {photos.slice(0, layout.count).map((photo, index) => {
            const geom = slots[index] ?? { x: 0, y: 0, width: geometry.width, height: geometry.height };
            const settings = photoSettings[index] ?? defaultEditorSettings;
            const bleed = getSlotBleed(geom);
            const photoSlot = {
              x: Math.max(0, geom.x - bleed),
              y: Math.max(0, geom.y - bleed),
              width: Math.min(geometry.width, geom.x + geom.width + bleed) - Math.max(0, geom.x - bleed),
              height: Math.min(geometry.height, geom.y + geom.height + bleed) - Math.max(0, geom.y - bleed),
            };

            return (
              <div
                key={index}
                className="print-sheet-slot"
                style={{
                  left: `${(photoSlot.x / geometry.width) * 100}%`,
                  top: `${(photoSlot.y / geometry.height) * 100}%`,
                  width: `${(photoSlot.width / geometry.width) * 100}%`,
                  height: `${(photoSlot.height / geometry.height) * 100}%`,
                }}
              >
                <PhotoLayer
                  src={photo}
                  alt={`Pose ${index + 1}`}
                  settings={settings}
                  slotWidth={photoSlot.width}
                  slotHeight={photoSlot.height}
                  className="print-sheet-photo-layer"
                />
              </div>
            );
          })}
        </div>

        <img
          className="print-sheet-overlay"
          src={getFrameAsset(frame, layout.count)}
          alt={`${frame.name} frame`}
        />

        <div className="print-sheet-controls">
          {photos.slice(0, layout.count).map((_, index) => {
            const isDragging = draggedIndex === index;
            const isTarget = dragOverIndex === index;
            const geom = slots[index] ?? { x: 0, y: 0, width: geometry.width, height: geometry.height };

            return (
              <div
                key={index}
                className={`print-sheet-control-slot ${isDragging ? "is-dragging" : ""} ${isTarget ? "drop-target-active" : ""}`}
                style={{
                  left: `${(geom.x / geometry.width) * 100}%`,
                  top: `${(geom.y / geometry.height) * 100}%`,
                  width: `${(geom.width / geometry.width) * 100}%`,
                  height: `${(geom.height / geometry.height) * 100}%`,
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  onSlotDragOver?.(index);
                }}
                onDragLeave={() => onSlotDragLeave?.()}
                onDrop={(event) => {
                  event.preventDefault();
                  const raw = event.dataTransfer.getData("text/plain");
                  const from = raw !== "" ? Number(raw) : (draggedIndex ?? -1);
                  if (from >= 0) onSwapPhotos?.(from, index);
                }}
                onWheel={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const zoomDelta = event.deltaY < 0 ? 0.1 : -0.1;
                  onUpdateSlotSettings?.(index, (prev) => ({
                    ...prev,
                    zoom: clampGestureValue(prev.zoom + zoomDelta, 1, 4),
                  }));
                }}
                onPointerDown={(event) => {
                  if ((event.target as HTMLElement).closest("button, [draggable='true']")) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const existing = activeGestureRef.current?.slotIndex === index
                    ? activeGestureRef.current
                    : { slotIndex: index, pointers: new Map<number, GesturePoint>(), center: null, distance: 0, angle: 0 };
                  existing.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
                  const metrics = getGestureMetrics(existing.pointers.values());
                  existing.center = metrics.center;
                  existing.distance = metrics.distance;
                  existing.angle = metrics.angle;
                  activeGestureRef.current = existing;
                }}
                onPointerMove={(event) => {
                  const gesture = activeGestureRef.current;
                  if (!gesture || gesture.slotIndex !== index || !gesture.pointers.has(event.pointerId)) return;
                  event.preventDefault();
                  gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
                  const next = getGestureMetrics(gesture.pointers.values());
                  const bounds = event.currentTarget.getBoundingClientRect();
                  if (gesture.center && next.center) {
                    const dx = (next.center.x - gesture.center.x) / Math.max(1, bounds.width);
                    const dy = (next.center.y - gesture.center.y) / Math.max(1, bounds.height);
                    onUpdateSlotSettings?.(index, (prev) => ({
                      ...prev,
                      offsetX: clampGestureValue(prev.offsetX + dx, -0.75, 0.75),
                      offsetY: clampGestureValue(prev.offsetY + dy, -0.75, 0.75),
                      zoom: gesture.pointers.size >= 2 && gesture.distance > 0
                        ? clampGestureValue(prev.zoom * (next.distance / gesture.distance), 1, 4)
                        : prev.zoom,
                      rotation: gesture.pointers.size >= 2
                        ? prev.rotation + normalizeGestureAngle(next.angle - gesture.angle)
                        : prev.rotation,
                    }));
                  }
                  gesture.center = next.center;
                  gesture.distance = next.distance;
                  gesture.angle = next.angle;
                }}
                onPointerUp={(event) => finishSlotGesture(event, index)}
                onPointerCancel={(event) => finishSlotGesture(event, index)}
                onDoubleClick={() => onOpenEditor?.(index)}
              >
                <span className="slot-badge">{index + 1}</span>
                <span
                  className="slot-swap-handle"
                  draggable
                  title="Tarik untuk menukar posisi foto"
                  onPointerDown={(event) => event.stopPropagation()}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(index));
                    onSlotDragStart?.(index);
                  }}
                  onDragEnd={() => onSlotDragEnd?.()}
                >
                  <GripVertical size={12} /> Swap
                </span>
                <button
                  type="button"
                  className="slot-edit-trigger"
                  title="Geser / Zoom foto ini"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenEditor?.(index);
                  }}
                >
                  <Pencil size={11} /> Edit
                </button>
                {isTarget && <div className="slot-drop-overlay"><Move size={18} /> Swap Slot {index + 1}</div>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="print-sheet-hint">
        <Move size={13} style={{ verticalAlign: "middle", marginRight: 4, color: "var(--kiosk-lime)" }} />
        <span>Geser langsung di dalam frame · Scroll/pinch untuk zoom · Putar dengan dua jari · Tarik handle Swap untuk pindah slot.</span>
      </div>
    </aside>
  );
}
