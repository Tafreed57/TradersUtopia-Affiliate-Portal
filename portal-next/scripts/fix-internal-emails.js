/**
 * Fix Internal Emails Script
 *
 * Re-syncs internalEmail (Rewardful email), firstName, lastName, and
 * rewardfulAffiliateId from legacy-export.json into the database.
 *
 * This ensures the teacher auto-detection chain works:
 *   aliasEmail -> DB user -> internalEmail -> Rewardful API -> first_name contains "teacher"
 *
 * Run with: node scripts/fix-internal-emails.js
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  console.log('=== FIX INTERNAL EMAILS FROM LEGACY EXPORT ===\n');

  // Load legacy-export.json
  const exportPath = path.resolve(__dirname, '..', 'data', 'legacy-export.json');
  if (!fs.existsSync(exportPath)) {
    console.error('ERROR: legacy-export.json not found at', exportPath);
    process.exit(1);
  }

  const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));

  // Collect all email mappings from authData
  const emailMappings = new Map();

  // Process authData (primary source - has internalEmail, rewardfulEmail, firstName, etc.)
  if (exportData.authData) {
    for (const [key, data] of Object.entries(exportData.authData)) {
      const aliasEmail = (data.aliasEmail || data.email || key).toLowerCase().trim();
      const internalEmail = (data.internalEmail || data.rewardfulEmail || '').toLowerCase().trim();
      const firstName = data.firstName || '';
      const lastName = data.lastName || '';
      const affiliateId = data.rewardfulAffiliateId || data.affiliateId || '';

      if (aliasEmail) {
        emailMappings.set(aliasEmail, {
          aliasEmail,
          internalEmail: internalEmail || null,
          firstName: firstName || null,
          lastName: lastName || null,
          rewardfulAffiliateId: affiliateId || null,
        });
      }
    }
  }

  // Also process affiliateAuth if present
  if (exportData.affiliateAuth) {
    for (const [key, data] of Object.entries(exportData.affiliateAuth)) {
      const aliasEmail = (data.aliasEmail || key).toLowerCase().trim();
      const internalEmail = (data.internalEmail || data.rewardfulEmail || '').toLowerCase().trim();
      const firstName = data.firstName || '';
      const lastName = data.lastName || '';
      const affiliateId = data.rewardfulAffiliateId || data.affiliateId || '';

      if (aliasEmail && !emailMappings.has(aliasEmail)) {
        emailMappings.set(aliasEmail, {
          aliasEmail,
          internalEmail: internalEmail || null,
          firstName: firstName || null,
          lastName: lastName || null,
          rewardfulAffiliateId: affiliateId || null,
        });
      }
    }
  }

  console.log(`Found ${emailMappings.size} users in legacy export\n`);

  // Stats
  let checked = 0;
  let updated = 0;
  let notFound = 0;
  let alreadyCorrect = 0;
  const issues = [];

  for (const [aliasEmail, mapping] of emailMappings) {
    checked++;

    // Find user in DB
    const user = await prisma.user.findUnique({
      where: { aliasEmail },
      select: {
        id: true,
        aliasEmail: true,
        internalEmail: true,
        firstName: true,
        lastName: true,
        rewardfulAffiliateId: true,
        isTeacher: true,
      },
    });

    if (!user) {
      notFound++;
      issues.push(`NOT IN DB: ${aliasEmail} (internalEmail should be: ${mapping.internalEmail})`);
      continue;
    }

    // Check what needs updating
    const updates = {};
    const changes = [];

    if (mapping.internalEmail && user.internalEmail !== mapping.internalEmail) {
      updates.internalEmail = mapping.internalEmail;
      changes.push(`internalEmail: "${user.internalEmail || 'NULL'}" -> "${mapping.internalEmail}"`);
    }

    if (mapping.firstName && !user.firstName) {
      updates.firstName = mapping.firstName;
      changes.push(`firstName: NULL -> "${mapping.firstName}"`);
    }

    if (mapping.lastName && !user.lastName) {
      updates.lastName = mapping.lastName;
      changes.push(`lastName: NULL -> "${mapping.lastName}"`);
    }

    if (mapping.rewardfulAffiliateId && !user.rewardfulAffiliateId) {
      updates.rewardfulAffiliateId = mapping.rewardfulAffiliateId;
      changes.push(`affiliateId: NULL -> "${mapping.rewardfulAffiliateId}"`);
    }

    if (Object.keys(updates).length > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: updates,
      });
      updated++;
      console.log(`UPDATED ${aliasEmail}:`);
      for (const c of changes) {
        console.log(`  ${c}`);
      }
    } else {
      alreadyCorrect++;
    }
  }

  console.log('\n=== RESULTS ===');
  console.log(`Checked: ${checked}`);
  console.log(`Updated: ${updated}`);
  console.log(`Already correct: ${alreadyCorrect}`);
  console.log(`Not in DB: ${notFound}`);

  if (issues.length > 0) {
    console.log('\nIssues:');
    for (const issue of issues) {
      console.log(`  - ${issue}`);
    }
  }

  // Now specifically verify teacher-related users
  console.log('\n=== TEACHER VERIFICATION ===');
  const teacherCandidates = await prisma.user.findMany({
    where: {
      OR: [
        { isTeacher: true },
        { firstName: { contains: 'teacher', mode: 'insensitive' } },
      ],
    },
    select: {
      aliasEmail: true,
      internalEmail: true,
      firstName: true,
      isTeacher: true,
    },
  });

  console.log(`\nUsers who are teachers or have "teacher" in firstName:`);
  for (const t of teacherCandidates) {
    console.log(`  ${t.aliasEmail} -> internal: ${t.internalEmail || 'NULL'} | firstName: "${t.firstName}" | isTeacher: ${t.isTeacher}`);
  }

  // Also check all users with internalEmail set
  console.log('\n=== ALL USERS WITH INTERNAL EMAIL ===');
  const usersWithInternal = await prisma.user.findMany({
    where: { internalEmail: { not: null } },
    select: {
      aliasEmail: true,
      internalEmail: true,
      firstName: true,
      isTeacher: true,
    },
    orderBy: { aliasEmail: 'asc' },
  });

  for (const u of usersWithInternal) {
    const marker = u.isTeacher ? ' [TEACHER]' : '';
    console.log(`  ${u.aliasEmail} -> ${u.internalEmail}${marker}`);
  }

  console.log(`\nTotal users with internalEmail: ${usersWithInternal.length}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('FATAL:', e);
  prisma.$disconnect();
  process.exit(1);
});
