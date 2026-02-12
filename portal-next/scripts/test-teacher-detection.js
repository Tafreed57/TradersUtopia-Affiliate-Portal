/**
 * Test Teacher Detection Chain
 *
 * Verifies the full chain: aliasEmail -> DB user -> internalEmail -> Rewardful API -> first_name
 *
 * Run with: node scripts/test-teacher-detection.js
 */

const { PrismaClient } = require('@prisma/client');
// Load .env manually
const envPath = require('path').resolve(__dirname, '..', '.env');
const envContent = require('fs').readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.substring(0, eqIdx).trim();
  let val = trimmed.substring(eqIdx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (!process.env[key]) process.env[key] = val;
}

const prisma = new PrismaClient();

async function main() {
  const apiKey = process.env.REWARDFUL_API_KEY;
  const baseUrl = process.env.REWARDFUL_API_BASE_URL || 'https://api.getrewardful.com/v1';

  if (!apiKey) {
    console.error('ERROR: REWARDFUL_API_KEY not set in .env');
    process.exit(1);
  }

  console.log('=== TEST TEACHER DETECTION CHAIN ===\n');
  console.log(`API Base URL: ${baseUrl}`);
  console.log(`API Key: ${apiKey.substring(0, 8)}...`);

  // Get all users who should be teachers (have "teacher" in firstName from legacy)
  // or who have internalEmail set
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { firstName: { contains: 'teacher', mode: 'insensitive' } },
        { isTeacher: true },
        { internalEmail: { not: null } },
      ],
    },
    select: {
      aliasEmail: true,
      internalEmail: true,
      firstName: true,
      lastName: true,
      isTeacher: true,
      isAdmin: true,
    },
    orderBy: { aliasEmail: 'asc' },
  });

  console.log(`\nFound ${users.length} relevant users to check\n`);

  // HTTP Basic Auth (Rewardful uses api_key:empty_password)
  const basicAuth = Buffer.from(`${apiKey}:`).toString('base64');

  for (const user of users) {
    const lookupEmail = user.internalEmail || user.aliasEmail;
    console.log(`--- ${user.aliasEmail} ---`);
    console.log(`  DB: internalEmail=${user.internalEmail || 'NULL'}, firstName="${user.firstName}", isTeacher=${user.isTeacher}`);
    console.log(`  Lookup email: ${lookupEmail}`);

    try {
      const url = `${baseUrl}/affiliates?email=${encodeURIComponent(lookupEmail)}`;
      const resp = await fetch(url, {
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/json',
        },
      });

      if (!resp.ok) {
        console.log(`  API ERROR: ${resp.status} ${resp.statusText}`);
        const body = await resp.text();
        console.log(`  Body: ${body.substring(0, 200)}`);
        continue;
      }

      const data = await resp.json();

      // Find affiliate matching the lookup email
      let affiliate = null;
      const affiliates = Array.isArray(data) ? data : (data.data || []);

      for (const a of affiliates) {
        if (a.email && a.email.toLowerCase() === lookupEmail.toLowerCase()) {
          affiliate = a;
          break;
        }
      }

      if (!affiliate) {
        console.log(`  NOT FOUND in Rewardful for: ${lookupEmail}`);
        console.log(`  Affiliates returned: ${affiliates.length}`);
        if (affiliates.length > 0) {
          console.log(`  Emails in response: ${affiliates.map(a => a.email).join(', ')}`);
        }
      } else {
        const firstName = affiliate.first_name || '';
        const hasTeacher = firstName.toLowerCase().includes('teacher');
        console.log(`  FOUND: first_name="${firstName}", last_name="${affiliate.last_name || ''}", state="${affiliate.state}"`);
        console.log(`  Contains "teacher": ${hasTeacher ? '✓ YES' : '✗ NO'}`);
        console.log(`  Auto-detection would: ${hasTeacher ? 'GRANT teacher access' : 'DENY teacher access'}`);

        if (hasTeacher && !user.isTeacher) {
          console.log(`  ⚠️  DB says isTeacher=false but Rewardful says teacher!`);
        }
        if (!hasTeacher && user.isTeacher && !user.isAdmin) {
          console.log(`  ⚠️  DB says isTeacher=true but Rewardful doesn't say teacher!`);
        }
      }
    } catch (err) {
      console.log(`  FETCH ERROR: ${err.message}`);
    }

    console.log('');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('FATAL:', e);
  prisma.$disconnect();
  process.exit(1);
});
