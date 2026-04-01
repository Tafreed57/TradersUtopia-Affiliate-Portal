/**
 * Database Seed Script
 *
 * Creates test data for development and testing.
 *
 * Run with: npm run db:seed
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...\n');

  // Clear existing data
  console.log('Clearing existing data...');
  await prisma.auditLog.deleteMany();
  await prisma.apiCache.deleteMany();
  await prisma.referralCache.deleteMany();
  await prisma.teacherLedgerEntry.deleteMany();
  await prisma.teacherEarnings.deleteMany();
  await prisma.rewardfulWebhookLog.deleteMany();
  await prisma.commissionTracking.deleteMany();
  await prisma.commissionOverride.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.attendanceProfile.deleteMany();
  await prisma.teacherStudentLink.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();

  // Create test password hash
  const testPassword = await bcrypt.hash('password123', 10);

  // Create admin user
  console.log('Creating admin user...');
  const admin = await prisma.user.create({
    data: {
      aliasEmail: 'admin@tradersutopia.test',
      email: 'admin@tradersutopia.test',
      firstName: 'Admin',
      lastName: 'User',
      passwordHash: testPassword,
      passwordSetAt: new Date(),
      accountStatus: 'ACTIVE',
      isAdmin: true,
      isTeacher: true,
    },
  });

  // Create teacher user
  console.log('Creating teacher user...');
  const teacher = await prisma.user.create({
    data: {
      aliasEmail: 'teacher@tradersutopia.test',
      email: 'teacher@tradersutopia.test',
      internalEmail: 'teacher-internal@tradersutopia.test',
      firstName: 'Teacher',
      lastName: 'Demo',
      passwordHash: testPassword,
      passwordSetAt: new Date(),
      accountStatus: 'ACTIVE',
      isAdmin: false,
      isTeacher: true,
      rewardfulAffiliateId: 'test-teacher-affiliate-id',
    },
  });

  // Create teacher earnings
  await prisma.teacherEarnings.create({
    data: {
      userId: teacher.id,
      totalOwed: 250.00,
      totalCredited: 1500.00,
      totalPaid: 1250.00,
      lastUpdatedAt: new Date(),
    },
  });

  // Create regular affiliate users
  console.log('Creating affiliate users...');
  const affiliates = [];
  for (let i = 1; i <= 5; i++) {
    const affiliate = await prisma.user.create({
      data: {
        aliasEmail: `affiliate${i}@tradersutopia.test`,
        email: `affiliate${i}@tradersutopia.test`,
        internalEmail: `affiliate${i}-internal@tradersutopia.test`,
        firstName: `Affiliate`,
        lastName: `User ${i}`,
        passwordHash: testPassword,
        passwordSetAt: new Date(),
        accountStatus: 'ACTIVE',
        isAdmin: false,
        isTeacher: false,
        rewardfulAffiliateId: `test-affiliate-${i}-id`,
      },
    });
    affiliates.push(affiliate);
  }

  // Create teacher-student links
  console.log('Creating teacher-student links...');
  for (const affiliate of affiliates) {
    await prisma.teacherStudentLink.create({
      data: {
        teacherId: teacher.id,
        studentId: affiliate.id,
        percentageOverride: 10,
        status: 'ACTIVE',
        createdBy: 'seed',
      },
    });
  }

  // Create attendance profiles and records
  console.log('Creating attendance data...');
  for (const affiliate of affiliates) {
    const profile = await prisma.attendanceProfile.create({
      data: {
        userId: affiliate.id,
        currentTeacherEmail: teacher.aliasEmail,
      },
    });

    // Create some attendance records (last 30 days)
    const today = new Date();
    for (let d = 0; d < 30; d++) {
      const date = new Date(today);
      date.setDate(date.getDate() - d);

      // Skip weekends
      if (date.getDay() === 0 || date.getDay() === 6) continue;

      // Random attendance (80% show up)
      if (Math.random() > 0.2) {
        await prisma.attendanceRecord.create({
          data: {
            profileId: profile.id,
            date: date.toISOString().split('T')[0],
            confirmedAt: date,
            teacherEmail: teacher.aliasEmail,
          },
        });
      }
    }
  }

  // Create pending account
  console.log('Creating pending account...');
  await prisma.user.create({
    data: {
      aliasEmail: 'pending@tradersutopia.test',
      email: 'pending@tradersutopia.test',
      firstName: 'Pending',
      lastName: 'User',
      accountStatus: 'PENDING',
      requestedAt: new Date(),
      requestedPortalType: 'affiliate',
    },
  });

  // Create approved (needs password) account
  console.log('Creating approved account...');
  await prisma.user.create({
    data: {
      aliasEmail: 'approved@tradersutopia.test',
      email: 'approved@tradersutopia.test',
      internalEmail: 'approved-internal@tradersutopia.test',
      firstName: 'Approved',
      lastName: 'User',
      accountStatus: 'APPROVED',
      approvedAt: new Date(),
      approvedBy: admin.aliasEmail,
    },
  });

  // Create commission override
  console.log('Creating commission override...');
  await prisma.commissionOverride.create({
    data: {
      userId: affiliates[0].id,
      unpaidAmount: 100.00,
      dueNowAmount: 50.00,
      note: 'Test override for demo',
      setBy: admin.aliasEmail,
      setAt: new Date(),
    },
  });

  // Create referral cache
  console.log('Creating referral cache...');
  for (const affiliate of affiliates) {
    await prisma.referralCache.create({
      data: {
        email: affiliate.aliasEmail,
        affiliateId: affiliate.rewardfulAffiliateId || '',
        lastKnownLeadCount: Math.floor(Math.random() * 20) + 1,
        previousLeadCount: Math.floor(Math.random() * 15),
        lastFetchedAt: new Date(),
        lastSuccessfulFetchAt: new Date(),
      },
    });
  }

  // Summary
  console.log('\n=== SEED COMPLETE ===\n');
  console.log('Test accounts created:');
  console.log('---------------------');
  console.log('Admin:    admin@tradersutopia.test / password123');
  console.log('Teacher:  teacher@tradersutopia.test / password123');
  console.log('Student:  affiliate1@tradersutopia.test / password123');
  console.log('          affiliate2@tradersutopia.test / password123');
  console.log('          affiliate3@tradersutopia.test / password123');
  console.log('          affiliate4@tradersutopia.test / password123');
  console.log('          affiliate5@tradersutopia.test / password123');
  console.log('');
  console.log('Pending:  pending@tradersutopia.test (no password)');
  console.log('Approved: approved@tradersutopia.test (no password)');
  console.log('');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
