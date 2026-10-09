// pin-form.js: pins (or unpins) one survey to the top of the Marketplace.
//
// Run inside the backend container:
//   docker cp deploy/pin-form.js rescom-backend-1:/app/apps/backend/
//   docker exec -w /app/apps/backend -e FORM_ID=<uuid> rescom-backend-1 node pin-form.js
//   docker exec -w /app/apps/backend -e FORM_ID=<uuid> -e UNPIN=1 rescom-backend-1 node pin-form.js
require("reflect-metadata");
const { NestFactory } = require("@nestjs/core");

const D = "./dist/apps/backend/src";
const { AppModule } = require(`${D}/app.module`);
const { PrismaService } = require(`${D}/common/database/prisma.service`);

async function main() {
  const id = process.env.FORM_ID;
  if (!id) throw new Error("Set FORM_ID (survey uuid).");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const prisma = app.get(PrismaService);
    const form = await prisma.form.update({
      where: { id },
      data: { isPinned: process.env.UNPIN !== "1" },
      select: { id: true, title: true, status: true, isPinned: true },
    });
    console.log(JSON.stringify(form));
    if (form.status !== "PUBLISHED") console.warn("warning: survey is not PUBLISHED, it will not be listed.");
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
