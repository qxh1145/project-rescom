// Run before enabling PayOS:
//   docker cp deploy/check-manual-topups.js rescom-backend-1:/app/apps/backend/
//   docker exec -w /app/apps/backend rescom-backend-1 node check-manual-topups.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  try {
    const [{ n }] = await prisma.$queryRaw`SELECT count(*)::int AS n FROM top_up_requests WHERE status = 'PENDING'`;
    console.log(`Manual PENDING top-ups: ${n}`);
    process.exitCode = n > 0 ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 2;
});
