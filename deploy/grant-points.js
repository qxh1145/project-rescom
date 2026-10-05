// grant-points.js: credits AMOUNT points to the USER_AVAILABLE balance of every
// ACTIVE user, one journal per user (SYSTEM_ISSUANCE -> USER_AVAILABLE) keyed
// `admin-grant:{BATCH}:{userId}`, so re-running the same BATCH posts nothing new.
//
// Run inside the backend container (dry run unless APPLY=1):
//   docker cp deploy/grant-points.js rescom-backend-1:/app/apps/backend/
//   docker exec -w /app/apps/backend -e AMOUNT=10000 -e BATCH=2026-10-05 rescom-backend-1 node grant-points.js
//   docker exec -w /app/apps/backend -e AMOUNT=10000 -e BATCH=2026-10-05 -e APPLY=1 rescom-backend-1 node grant-points.js
require("reflect-metadata");
const { NestFactory } = require("@nestjs/core");

const D = "./dist/apps/backend/src";
const { AppModule } = require(`${D}/app.module`);
const { PrismaService } = require(`${D}/common/database/prisma.service`);
const { LedgerService } = require(`${D}/modules/economy/application/ledger.service`);

const APPLY = process.env.APPLY === "1";
const AMOUNT = Number(process.env.AMOUNT);
const BATCH = process.env.BATCH;

async function main() {
  if (!Number.isInteger(AMOUNT) || AMOUNT <= 0 || !BATCH) {
    throw new Error("Set AMOUNT (positive integer) and BATCH (e.g. 2026-10-05).");
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const prisma = app.get(PrismaService);
    const ledger = app.get(LedgerService, { strict: false });
    const users = await prisma.user.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, email: true },
      orderBy: { email: "asc" },
    });
    console.log(`${APPLY ? "APPLY" : "DRY RUN"}: +${AMOUNT} to ${users.length} active users (batch ${BATCH})`);

    const system = APPLY ? await ledger.getOrCreateAccount(null, "SYSTEM_ISSUANCE") : null;
    let granted = 0, skipped = 0, failures = 0;
    for (const user of users) {
      const key = `admin-grant:${BATCH}:${user.id}`;
      try {
        if (await prisma.ledgerJournal.findUnique({ where: { idempotencyKey: key } })) {
          skipped++;
          continue;
        }
        if (APPLY) {
          const account = await ledger.getOrCreateAccount(user.id, "USER_AVAILABLE");
          await ledger.postJournal({
            idempotencyKey: key,
            description: `Admin grant ${BATCH}: ${AMOUNT} points`,
            entries: [
              { accountId: system.id, amount: -AMOUNT },
              { accountId: account.id, amount: AMOUNT },
            ],
          });
        }
        granted++;
      } catch (error) {
        failures++;
        console.error(`${user.email}: FAILED ${error.name} ${error.message}`);
      }
    }
    console.log(`${APPLY ? "granted" : "would grant"} ${granted}, already granted ${skipped}, failed ${failures}`);
    process.exitCode = failures ? 1 : 0;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
