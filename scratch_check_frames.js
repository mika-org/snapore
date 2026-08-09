require("dotenv").config();
const { prisma } = require("./src/lib/prisma");

async function main() {
  const frames = await prisma.frame.findMany({
    include: { versions: true }
  });
  console.log("TOTAL FRAMES IN DB:", frames.length);
  for (const f of frames) {
    console.log(`- Frame: "${f.name}" (id: ${f.id}, boothId: ${f.boothId}, active: ${f.active})`);
    for (const v of f.versions) {
      console.log(`   Version: layoutKind=${v.layoutKind}, version=${v.version}, assetPath=${v.assetPath}, published=${v.published}`);
    }
  }
}

main().finally(() => prisma.$disconnect());
