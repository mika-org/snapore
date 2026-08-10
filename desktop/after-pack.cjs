/* eslint-disable @typescript-eslint/no-require-imports */
const { cp, readdir, rm } = require("node:fs/promises");
const path = require("node:path");

async function assertNoEnvironmentFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const name = entry.name.toLowerCase();
    if (entry.isFile() && (name === ".env" || name.startsWith(".env."))) {
      throw new Error(`File environment tidak boleh masuk aplikasi desktop: ${entryPath}`);
    }
    if (entry.isDirectory()) await assertNoEnvironmentFiles(entryPath);
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const source = path.join(context.packager.projectDir, "desktop-runtime");
  const resourcesDirectory = path.join(context.appOutDir, "resources");
  const destination = path.join(resourcesDirectory, "runtime");

  await assertNoEnvironmentFiles(source);
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true, force: true });
  console.log(`  • copied complete desktop runtime  destination=${destination}`);
};
