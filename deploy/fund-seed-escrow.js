// fund-seed-escrow.js: repairs the ledger of the seed-50.js publishers so their
// surveys can pay rewards (prod incident 2026-10-05: InsufficientEscrowBalance).
//
// For every @rescom.vn publisher:
//   1. Backs the seeded 5000 USER_AVAILABLE with a journal `seed-grant:{userId}`
//      (SYSTEM_ISSUANCE -> USER_AVAILABLE). A balance written without journal
//      entries is reset to the entries' sum first.
//   2. Reserves Escrow for each PUBLISHED form exactly like a real first
//      publish (expectedCompletions × draw, key `publish:{versionId}`).
// Idempotent: re-running posts nothing new. Failed InternalRewardRequested
// Outbox events then settle on their next retry.
//
// Run inside the backend container (dry run unless APPLY=1):
//   docker cp deploy/fund-seed-escrow.js rescom-backend-1:/app/apps/backend/
//   docker exec -w /app/apps/backend rescom-backend-1 node fund-seed-escrow.js
//   docker exec -w /app/apps/backend -e APPLY=1 rescom-backend-1 node fund-seed-escrow.js
require("reflect-metadata");
const { NestFactory } = require("@nestjs/core");

const D = "./dist/apps/backend/src";
const { AppModule } = require(`${D}/app.module`);
const { PrismaService } = require(`${D}/common/database/prisma.service`);
const { LedgerService } = require(`${D}/modules/economy/application/ledger.service`);
const { FormsEscrowCoordinator } = require(`${D}/modules/forms/application/forms-escrow.coordinator`);
const { FORM_REPOSITORY_PORT } = require(`${D}/modules/forms/application/ports/form-repository.port`);

const APPLY = process.env.APPLY === "1";
const SEED_DOMAIN = "@rescom.vn";
const SEED_GRANT = 5000;

async function backSeedBalance(prisma, ledger, user) {
  const key = `seed-grant:${user.id}`;
  if (await prisma.ledgerJournal.findUnique({ where: { idempotencyKey: key } })) {
    return "grant already posted";
  }
  const account = await ledger.getOrCreateAccount(user.id, "USER_AVAILABLE");
  const { _sum } = await prisma.ledgerEntry.aggregate({
    where: { accountId: account.id },
    _sum: { amount: true },
  });
  const fromEntries = _sum.amount ?? 0;
  const drift = account.balance - fromEntries;
  // Only the seed's own unbacked write is repaired; anything else is left to a human.
  if (drift !== 0 && drift !== SEED_GRANT) {
    throw new Error(`unexpected drift ${drift} on USER_AVAILABLE (balance ${account.balance}, entries ${fromEntries})`);
  }
  if (!APPLY) return `would post ${SEED_GRANT} (drift ${drift})`;
  if (drift !== 0) {
    await prisma.ledgerAccount.update({ where: { id: account.id }, data: { balance: fromEntries } });
  }
  const system = await ledger.getOrCreateAccount(null, "SYSTEM_ISSUANCE");
  await ledger.postJournal({
    idempotencyKey: key,
    description: `Seed publisher grant: ${user.email}`,
    entries: [
      { accountId: system.id, amount: -SEED_GRANT },
      { accountId: account.id, amount: SEED_GRANT },
    ],
  });
  return `posted ${SEED_GRANT}`;
}

// The lock a real first publish posts: expectedCompletions × draw under
// `publish:{versionId}`. Not `coordinatePublish`: its shortfall floors the
// position at 0, so the rewards already owed to submitted responses would
// stay unfunded.
async function fundForm(prisma, ledger, escrow, forms, formId, publisherId) {
  const loaded = await forms.findById(formId);
  if (!loaded) return "form not found";
  const versions = await prisma.formVersion.findMany({ where: { formId }, select: { id: true } });
  const reserved = await prisma.ledgerJournal.count({
    where: { idempotencyKey: { in: versions.map((v) => `publish:${v.id}`) } },
  });
  if (reserved > 0) return "already reserved";
  const amount = escrow.getEscrowQuote(loaded.form).effectiveCost;
  if (amount <= 0) return "no reward";
  if (!APPLY) return `would reserve ${amount}`;
  await ledger.reserveEscrow({
    userId: publisherId,
    formVersionId: loaded.currentVersion.id,
    amount,
    formTitle: loaded.form.title,
  });
  return `reserved ${amount}`;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const prisma = app.get(PrismaService);
    const ledger = app.get(LedgerService, { strict: false });
    const escrow = app.get(FormsEscrowCoordinator, { strict: false });
    const forms = app.get(FORM_REPOSITORY_PORT, { strict: false });

    const users = await prisma.user.findMany({
      where: { email: { endsWith: SEED_DOMAIN } },
      select: { id: true, email: true },
      orderBy: { email: "asc" },
    });
    console.log(`${APPLY ? "APPLY" : "DRY RUN"}: ${users.length} seed publishers`);

    let failures = 0;
    for (const user of users) {
      try {
        console.log(`${user.email}: ${await backSeedBalance(prisma, ledger, user)}`);
      } catch (error) {
        failures++;
        console.error(`${user.email}: grant FAILED ${error.message}`);
        continue; // never reserve Escrow from an unbacked balance
      }
      const owned = await prisma.form.findMany({
        where: { publisherId: user.id, status: "PUBLISHED" },
        select: { id: true, title: true },
      });
      for (const form of owned) {
        try {
          console.log(`  ${form.title.slice(0, 60)}: ${await fundForm(prisma, ledger, escrow, forms, form.id, user.id)}`);
        } catch (error) {
          failures++;
          console.error(`  ${form.title.slice(0, 60)}: FAILED ${error.name} ${error.message}`);
        }
      }
    }
    console.log(failures ? `${failures} failure(s)` : "done");
    process.exitCode = failures ? 1 : 0;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
