/**
 * Reset Teacher Earnings
 *
 * Clears all locked teacher earnings so they can be recalculated
 * fresh with the corrected currency logic (no double-counting).
 *
 * Run with: node scripts/reset-teacher-earnings.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== RESET TEACHER EARNINGS ===\n');

  // Get all teacher earnings records
  const earnings = await prisma.teacherEarnings.findMany({
    include: { user: { select: { aliasEmail: true, firstName: true, lastName: true } } },
  });

  console.log(`Found ${earnings.length} teacher earnings records\n`);

  for (const e of earnings) {
    const name = [e.user.firstName, e.user.lastName].filter(Boolean).join(' ') || e.user.aliasEmail;
    console.log(`${name} (${e.user.aliasEmail}):`);
    console.log(`  Before: lockedEarnings=$${e.lockedEarnings}, totalEarned=$${e.totalEarnedAllTime}, totalPaid=$${e.totalPaidAllTime}`);

    // Reset locked earnings and total earned to 0
    // Keep totalPaidAllTime intact (actual payments that happened)
    await prisma.teacherEarnings.update({
      where: { id: e.id },
      data: {
        lockedEarnings: 0,
        totalEarnedAllTime: 0,
        lockedAt: null,
      },
    });

    console.log(`  After:  lockedEarnings=$0, totalEarned=$0, totalPaid=$${e.totalPaidAllTime} (preserved)`);
    console.log('');
  }

  // Also clear caches so fresh data is fetched
  const refDeleted = await prisma.referralCache.deleteMany();
  const apiDeleted = await prisma.apiCache.deleteMany();
  const trackingDeleted = await prisma.commissionTracking.deleteMany();

  console.log(`Cleared ${refDeleted.count} referral cache entries`);
  console.log(`Cleared ${apiDeleted.count} API cache entries`);
  console.log(`Cleared ${trackingDeleted.count} commission tracking entries`);

  console.log('\n=== DONE ===');
  console.log('All teacher earnings reset to $0. Teachers can click "Update My Earnings"');
  console.log('to recalculate with the corrected currency logic.');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e);
  prisma.$disconnect();
  process.exit(1);
});
