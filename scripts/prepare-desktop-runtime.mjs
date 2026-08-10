import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const standaloneRoot = join(projectRoot, ".next", "standalone");
const standaloneEntry = join(standaloneRoot, "server.js");
const agentBundle = join(projectRoot, "dist-desktop-agent", "server.cjs");
const runtimeRoot = join(projectRoot, "desktop-runtime");
const webRuntime = join(runtimeRoot, "web");
const agentRuntime = join(runtimeRoot, "agent");
const iconPath = join(projectRoot, "desktop", "assets", "icon.png");

async function requireFile(filePath, hint) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("bukan file");
  } catch {
    throw new Error(`${hint} tidak ditemukan: ${filePath}`);
  }
}

function isEnvironmentFile(sourcePath) {
  const name = basename(sourcePath).toLowerCase();
  return name === ".env" || name.startsWith(".env.");
}

async function copyDirectory(source, destination, filter = () => true) {
  await cp(source, destination, {
    recursive: true,
    force: true,
    filter: (sourcePath) => !isEnvironmentFile(sourcePath) && filter(sourcePath),
  });
}

async function assertNoEnvironmentFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (isEnvironmentFile(entryPath)) {
      throw new Error(`File environment tidak boleh masuk runtime desktop: ${entryPath}`);
    }
    if (entry.isDirectory()) await assertNoEnvironmentFiles(entryPath);
  }
}

async function directorySize(directory) {
  let bytes = 0;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) bytes += await directorySize(entryPath);
    else if (entry.isFile()) bytes += (await stat(entryPath)).size;
  }
  return bytes;
}

await requireFile(standaloneEntry, "Output Next.js standalone");
await requireFile(agentBundle, "Bundle device agent");

await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });

await copyDirectory(standaloneRoot, webRuntime);
await mkdir(agentRuntime, { recursive: true });

// Next standalone may contain a traced public folder. Replace it with a clean,
// deterministic copy and never package development uploads.
await rm(join(webRuntime, "public"), { recursive: true, force: true });
const publicRoot = join(projectRoot, "public");
await copyDirectory(publicRoot, join(webRuntime, "public"), (sourcePath) => {
  const relativePath = relative(publicRoot, sourcePath);
  return relativePath !== "uploads" && !relativePath.startsWith(`uploads${sep}`);
});

await copyDirectory(join(projectRoot, ".next", "static"), join(webRuntime, ".next", "static"));
await cp(agentBundle, join(agentRuntime, "server.cjs"), { force: true });
await cp(`${agentBundle}.map`, join(agentRuntime, "server.cjs.map"), { force: true });
await mkdir(join(agentRuntime, "device-agent"), { recursive: true });
await cp(
  join(projectRoot, "device-agent", "windows-printer.ps1"),
  join(agentRuntime, "device-agent", "windows-printer.ps1"),
  { force: true },
);

await mkdir(dirname(iconPath), { recursive: true });
await sharp(join(projectRoot, "public", "og.png"))
  .resize(512, 512, { fit: "contain", background: { r: 246, g: 241, b: 232, alpha: 1 } })
  .png({ compressionLevel: 9 })
  .toFile(iconPath);

await assertNoEnvironmentFiles(runtimeRoot);

const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const manifest = {
  name: packageJson.name,
  version: packageJson.version,
  preparedAt: new Date().toISOString(),
  webEntry: "web/server.js",
  agentEntry: "agent/server.cjs",
  agentPort: 4545,
};
await writeFile(join(runtimeRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const bytes = await directorySize(runtimeRoot);
console.log(`Desktop runtime siap: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`Tidak ada file .env yang disertakan di ${runtimeRoot}`);
