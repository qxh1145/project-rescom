// admin-completion-code.js: sets the fixed Admin completion code (`abc123`)
// on the current version of every external survey an Admin owns that is not
// closed. Surveys created or rotated after the 2026-10-10 deploy already have
// it; this backfills the older ones. Idempotent.
//
// The Google Form confirmation text of each listed survey must show `abc123`.
//
// Run inside the backend container (DRY_RUN=1 lists without writing):
//   docker cp deploy/admin-completion-code.js rescom-backend-1:/app/apps/backend/
//   docker exec -w /app/apps/backend -e DRY_RUN=1 rescom-backend-1 node admin-completion-code.js
//   docker exec -w /app/apps/backend rescom-backend-1 node admin-completion-code.js
require("reflect-metadata");
const { NestFactory } = require("@nestjs/core");

const D = "./dist/apps/backend/src";
const { AppModule } = require(`${D}/app.module`);
const { PrismaService } = require(`${D}/common/database/prisma.service`);
const { COMPLETION_CODE_PORT, ADMIN_COMPLETION_CODE } = require(
  `${D}/modules/forms/application/ports/completion-code.port`,
);

async function main() {
  const dryRun = process.env.DRY_RUN === "1";
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const prisma = app.get(PrismaService);
    const codes = app.get(COMPLETION_CODE_PORT, { strict: false });
    const forms = await prisma.form.findMany({
      where: { type: "EXTERNAL", status: { not: "CLOSED" }, publisher: { role: "ADMIN" } },
      select: {
        id: true,
        title: true,
        status: true,
        versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true, completionCode: true } },
      },
    });
    let updated = 0;
    for (const form of forms) {
      const version = form.versions[0];
      if (!version) continue;
      const verifier = codes.computeVerifier(version.id, ADMIN_COMPLETION_CODE);
      const done = version.completionCode === verifier;
      console.log(JSON.stringify({ id: form.id, title: form.title, status: form.status, alreadySet: done }));
      if (done || dryRun) continue;
      await prisma.formVersion.update({ where: { id: version.id }, data: { completionCode: verifier } });
      updated += 1;
    }
    console.log(`${forms.length} admin external survey(s), ${updated} updated${dryRun ? " (dry run)" : ""}.`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
