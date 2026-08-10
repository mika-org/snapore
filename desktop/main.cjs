/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, Menu, dialog, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const APP_NAME = "Snapore Desktop";
const APP_ID = "id.snapore.photobooth";
const AGENT_PORT = 4545;

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);
if (process.env.SNAPORE_USER_DATA_DIR) {
  const userDataDirectory = path.resolve(process.env.SNAPORE_USER_DATA_DIR);
  mkdirSync(userDataDirectory, { recursive: true });
  app.setPath("userData", userDataDirectory);
}

let mainWindow = null;
let logFile = null;
let isShuttingDown = false;
const managedProcesses = new Map();

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  if (!logFile) return;
  try {
    appendFileSync(logFile, `${line}\n`, "utf8");
  } catch {
    // Logging must never prevent the kiosk from starting.
  }
}

function parseEnv(source) {
  const values = {};
  for (const originalLine of source.split(/\r?\n/)) {
    let line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    }
    values[key] = value;
  }
  return values;
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return parseEnv(readFileSync(filePath, "utf8"));
}

function secret() {
  return randomBytes(32).toString("base64url");
}

function ensureConfiguration() {
  const configDirectory = app.getPath("userData");
  const dataDirectory = path.join(configDirectory, "data");
  const logsDirectory = path.join(configDirectory, "logs");
  mkdirSync(dataDirectory, { recursive: true });
  mkdirSync(logsDirectory, { recursive: true });
  logFile = path.join(logsDirectory, "desktop.log");

  const bundledConfigPath = path.join(__dirname, "desktop.config.json");
  const userConfigPath = path.join(configDirectory, "desktop.config.json");
  if (!existsSync(userConfigPath)) {
    writeFileSync(userConfigPath, readFileSync(bundledConfigPath, "utf8"), { encoding: "utf8", mode: 0o600 });
  }

  const defaults = JSON.parse(readFileSync(bundledConfigPath, "utf8"));
  const userConfig = JSON.parse(readFileSync(userConfigPath, "utf8"));
  const config = {
    ...defaults,
    ...userConfig,
    window: { ...defaults.window, ...userConfig.window },
  };

  const templatePath = app.isPackaged
    ? path.join(process.resourcesPath, "config", "snapore.env.example")
    : path.join(__dirname, "snapore.env.example");
  const envPath = process.env.SNAPORE_ENV_FILE
    ? path.resolve(process.env.SNAPORE_ENV_FILE)
    : path.join(configDirectory, "snapore.env");
  if (!existsSync(envPath)) {
    if (process.env.SNAPORE_ENV_FILE) {
      throw new Error(`SNAPORE_ENV_FILE tidak ditemukan: ${envPath}`);
    }
    const initial = readFileSync(templatePath, "utf8")
      .replaceAll("__GENERATE_SESSION_SECRET__", secret())
      .replaceAll("__GENERATE_ENCRYPTION_KEY__", secret())
      .replaceAll("__GENERATE_DEVICE_TOKEN__", secret());
    writeFileSync(envPath, initial, { encoding: "utf8", mode: 0o600 });
  }

  let localEnv = readEnvFile(envPath);
  const generated = [];
  if (!localEnv.SESSION_SECRET) generated.push(`SESSION_SECRET="${secret()}"`);
  if (!localEnv.APP_ENCRYPTION_KEY) generated.push(`APP_ENCRYPTION_KEY="${secret()}"`);
  if (!localEnv.SNAPORE_DEVICE_TOKEN) generated.push(`SNAPORE_DEVICE_TOKEN="${secret()}"`);
  if (generated.length > 0) {
    appendFileSync(envPath, `\n# Dibuat otomatis oleh Snapore Desktop\n${generated.join("\n")}\n`, "utf8");
    localEnv = readEnvFile(envPath);
  }

  const developmentEnv = app.isPackaged
    ? {}
    : readEnvFile(path.join(__dirname, "..", ".env"));
  const runtimeEnv = { ...developmentEnv, ...localEnv, ...process.env };

  return {
    config: validateConfig(config),
    runtimeEnv,
    configDirectory,
    dataDirectory,
    envPath,
    logFile,
  };
}

function validateConfig(input) {
  const webPort = Number(input.webPort);
  if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535 || webPort === AGENT_PORT) {
    throw new Error(`webPort pada desktop.config.json harus 1024-65535 dan bukan ${AGENT_PORT}.`);
  }
  const startPath = typeof input.startPath === "string" && /^\/(?!\/)/.test(input.startPath)
    ? input.startPath
    : "/login";
  const width = Math.max(1024, Math.floor(Number(input.window?.width) || 1440));
  const height = Math.max(700, Math.floor(Number(input.window?.height) || 900));
  return {
    webPort,
    startPath,
    openDevTools: input.openDevTools === true,
    window: {
      width,
      height,
      minWidth: Math.max(800, Math.floor(Number(input.window?.minWidth) || 1024)),
      minHeight: Math.max(600, Math.floor(Number(input.window?.minHeight) || 700)),
      fullscreen: input.window?.fullscreen === true,
      kiosk: input.window?.kiosk === true,
    },
  };
}

function runtimePaths() {
  const runtimeRoot = app.isPackaged
    ? path.join(process.resourcesPath, "runtime")
    : path.join(__dirname, "..", "desktop-runtime");
  return {
    runtimeRoot,
    webRoot: path.join(runtimeRoot, "web"),
    webEntry: path.join(runtimeRoot, "web", "server.js"),
    agentRoot: path.join(runtimeRoot, "agent"),
    agentEntry: path.join(runtimeRoot, "agent", "server.cjs"),
  };
}

function ensureRuntimeExists(paths) {
  for (const [label, filePath] of [["server Next.js", paths.webEntry], ["device agent", paths.agentEntry]]) {
    if (!existsSync(filePath)) {
      throw new Error(`${label} tidak ditemukan di ${filePath}. Jalankan npm run desktop:prepare terlebih dahulu.`);
    }
  }
}

function portIsListening(port) {
  return new Promise((resolvePromise) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolvePromise(result);
    };
    socket.setTimeout(700);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function requestJson(url, timeout = 1500) {
  return new Promise((resolvePromise) => {
    const request = http.get(url, { timeout }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size <= 128 * 1024) chunks.push(chunk);
      });
      response.on("end", () => {
        try {
          resolvePromise({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch {
          resolvePromise({ status: response.statusCode ?? 0, body: null });
        }
      });
    });
    request.once("timeout", () => request.destroy());
    request.once("error", () => resolvePromise(null));
  });
}

async function waitForService(url, matches, label, child, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`${label} berhenti saat startup (exit code ${child.exitCode}). Periksa ${logFile}.`);
    }
    const response = await requestJson(url);
    if (response && matches(response)) return response;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
  }
  throw new Error(`${label} tidak siap dalam ${Math.round(timeout / 1000)} detik. Periksa ${logFile}.`);
}

function pipeServiceOutput(name, stream) {
  if (!stream) return;
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const value = String(chunk).trimEnd();
    if (value) log(`[${name}] ${value}`);
  });
}

function spawnService(name, entry, cwd, env, fatal) {
  const child = spawn(process.execPath, [entry], {
    cwd,
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
      ELECTRON_NO_ATTACH_CONSOLE: "1",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  managedProcesses.set(name, child);
  pipeServiceOutput(name, child.stdout);
  pipeServiceOutput(name, child.stderr);
  child.once("error", (error) => log(`[${name}] gagal dijalankan: ${error.message}`));
  child.once("exit", (code, signal) => {
    managedProcesses.delete(name);
    log(`[${name}] berhenti (code=${code ?? "-"}, signal=${signal ?? "-"})`);
    if (isShuttingDown || !mainWindow || mainWindow.isDestroyed()) return;
    const message = fatal
      ? "Server lokal Snapore berhenti. Aplikasi akan ditutup."
      : "Device agent berhenti. Kamera browser tetap dapat dipakai, tetapi printer lokal tidak tersedia sampai aplikasi dimulai ulang.";
    void dialog.showMessageBox(mainWindow, { type: fatal ? "error" : "warning", title: APP_NAME, message, detail: `Log: ${logFile}` })
      .finally(() => { if (fatal) app.quit(); });
  });
  return child;
}

function stopServices() {
  isShuttingDown = true;
  for (const child of managedProcesses.values()) {
    try {
      child.kill();
    } catch {
      // The process has already exited.
    }
  }
  managedProcesses.clear();
}

function sameOrigin(value, allowedOrigin) {
  try {
    return new URL(value).origin === allowedOrigin;
  } catch {
    return false;
  }
}

function installPermissionPolicy(allowedOrigin) {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => (
    permission === "media" && sameOrigin(requestingOrigin, allowedOrigin)
  ));
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    callback(permission === "media" && sameOrigin(requestingUrl, allowedOrigin));
  });
}

function installMenu(paths, config) {
  if (config.window.kiosk) {
    Menu.setApplicationMenu(null);
    return;
  }
  const menu = Menu.buildFromTemplate([
    {
      label: "Aplikasi",
      submenu: [
        { label: "Buka konfigurasi", click: () => void shell.openPath(paths.envPath) },
        { label: "Buka folder data", click: () => void shell.openPath(paths.dataDirectory) },
        { label: "Buka log", click: () => void shell.openPath(paths.logFile) },
        { type: "separator" },
        { role: "quit", label: "Keluar" },
      ],
    },
    {
      label: "Tampilan",
      submenu: [
        { role: "reload", label: "Muat ulang" },
        {
          label: "Layar penuh",
          accelerator: "F11",
          click: () => {
            if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
          },
        },
        { type: "separator" },
        { role: "resetZoom", label: "Reset zoom" },
        { role: "zoomIn", label: "Perbesar" },
        { role: "zoomOut", label: "Perkecil" },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

async function createMainWindow(origin, paths, config) {
  installPermissionPolicy(origin);
  installMenu(paths, config);
  const iconPath = path.join(__dirname, "assets", "icon.png");
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: config.window.width,
    height: config.window.height,
    minWidth: config.window.minWidth,
    minHeight: config.window.minHeight,
    show: false,
    backgroundColor: "#f6f1e8",
    autoHideMenuBar: true,
    fullscreen: config.window.fullscreen,
    kiosk: config.window.kiosk,
    icon: existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: config.openDevTools,
    },
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (sameOrigin(url, origin)) return;
    event.preventDefault();
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:") void shell.openExternal(url);
    } catch {
      // Invalid and non-local navigation is ignored.
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url, origin)) {
      void mainWindow.loadURL(url);
    } else {
      try {
        if (new URL(url).protocol === "https:") void shell.openExternal(url);
      } catch {
        // Invalid URLs are denied.
      }
    }
    return { action: "deny" };
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (config.openDevTools) mainWindow.webContents.openDevTools({ mode: "detach" });
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  await mainWindow.loadURL(`${origin}${config.startPath}`);
}

async function startDesktop() {
  const paths = ensureConfiguration();
  log(`Memulai ${APP_NAME} ${app.getVersion()} (${app.isPackaged ? "packaged" : "development"}).`);

  if (!paths.runtimeEnv.DATABASE_URL) {
    const result = await dialog.showMessageBox({
      type: "warning",
      title: `${APP_NAME} belum dikonfigurasi`,
      message: "DATABASE_URL belum diisi.",
      detail: `Isi koneksi PostgreSQL pada:\n${paths.envPath}\n\nLalu jalankan ulang aplikasi.`,
      buttons: ["Buka konfigurasi", "Keluar"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) await shell.openPath(paths.envPath);
    app.quit();
    return;
  }

  const runtime = runtimePaths();
  ensureRuntimeExists(runtime);
  const origin = `http://127.0.0.1:${paths.config.webPort}`;
  if (await portIsListening(paths.config.webPort)) {
    throw new Error(`Port web ${paths.config.webPort} sedang dipakai. Ubah webPort pada desktop.config.json.`);
  }

  const commonEnv = {
    ...paths.runtimeEnv,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    SNAPORE_AGENT_PORT: String(AGENT_PORT),
    SNAPORE_SERVER_URL: origin,
    SNAPORE_DATA_DIR: path.join(paths.dataDirectory, "agent"),
    SNAPORE_SERVER_UPLOAD_DIR: path.join(paths.dataDirectory, "server-uploads"),
    SNAPORE_FRAME_STORAGE_DIR: path.join(paths.dataDirectory, "frame-assets"),
  };

  let agentChild = null;
  const existingAgent = await requestJson(`http://127.0.0.1:${AGENT_PORT}/health`, 2000);
  if (existingAgent?.status === 200 && existingAgent.body?.version) {
    log(`Menggunakan device agent yang sudah aktif pada port ${AGENT_PORT}.`);
  } else {
    if (await portIsListening(AGENT_PORT)) {
      throw new Error(`Port device agent ${AGENT_PORT} sedang dipakai aplikasi lain.`);
    }
    agentChild = spawnService("agent", runtime.agentEntry, runtime.agentRoot, commonEnv, false);
  }

  const webChild = spawnService("web", runtime.webEntry, runtime.webRoot, {
    ...commonEnv,
    PORT: String(paths.config.webPort),
  }, true);

  await Promise.all([
    agentChild
      ? waitForService(
          `http://127.0.0.1:${AGENT_PORT}/health`,
          (response) => response.status === 200 && Boolean(response.body?.version),
          "Device agent",
          agentChild,
          35_000,
        )
      : Promise.resolve(),
    waitForService(
      `${origin}/api/health`,
      (response) => response.status === 200 && response.body?.service === "snapore-web",
      "Server Snapore",
      webChild,
      60_000,
    ),
  ]);

  log(`Server lokal siap di ${origin}.`);
  if (process.argv.includes("--smoke-test")) {
    log("Smoke test desktop lulus.");
    app.quit();
    return;
  }
  await createMainWindow(origin, paths, paths.config);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("before-quit", stopServices);
  app.on("window-all-closed", () => app.quit());
  app.whenReady()
    .then(startDesktop)
    .catch(async (error) => {
      process.exitCode = 1;
      log(`Startup gagal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      await dialog.showMessageBox({
        type: "error",
        title: `${APP_NAME} gagal dimulai`,
        message: error instanceof Error ? error.message : "Terjadi kesalahan startup.",
        detail: logFile ? `Log: ${logFile}` : undefined,
      });
      app.quit();
    });
}
