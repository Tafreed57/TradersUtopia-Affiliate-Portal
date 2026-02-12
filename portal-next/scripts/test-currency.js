/**
 * Test what Rewardful API returns for commission_stats currencies
 * to debug the double-counting issue.
 */

const fs = require('fs');
const path = require('path');

// Load .env
const envPath = path.resolve(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
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

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const apiKey = process.env.REWARDFUL_API_KEY;
  const baseUrl = process.env.REWARDFUL_API_BASE_URL || 'https://api.getrewardful.com/v1';
  const basicAuth = Buffer.from(`${apiKey}:`).toString('base64');
  const conversionRate = parseFloat(process.env.USD_TO_CAD_RATE || '1.39');

  // Get teacher mg.one4all@gmail.com's students
  const teacher = await prisma.user.findUnique({
    where: { aliasEmail: 'mg.one4all@gmail.com' },
  });

  if (!teacher) {
    console.log('Teacher not found');
    return;
  }

  const links = await prisma.teacherStudentLink.findMany({
    where: { teacherId: teacher.id, status: 'ACTIVE' },
    include: { student: true },
  });

  console.log(`Teacher: mg.one4all@gmail.com (internal: ${teacher.internalEmail})`);
  console.log(`Students: ${links.length}\n`);
  console.log(`Conversion rate: ${conversionRate}\n`);

  let totalOld = 0; // Old way (sum both)
  let totalNew = 0; // New way (CAD || USD)

  for (const link of links) {
    const studentEmail = link.student.internalEmail || link.student.aliasEmail;
    console.log(`--- Student: ${link.student.aliasEmail} (internal: ${studentEmail}) ---`);

    // Get affiliate
    const searchUrl = `${baseUrl}/affiliates?email=${encodeURIComponent(studentEmail)}`;
    const searchResp = await fetch(searchUrl, {
      headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/json' },
    });
    const searchData = await searchResp.json();
    
    let affiliate = null;
    const affiliates = Array.isArray(searchData) ? searchData : (searchData.data || []);
    for (const a of affiliates) {
      if (a.email && a.email.toLowerCase() === studentEmail.toLowerCase()) {
        affiliate = a;
        break;
      }
    }

    if (!affiliate) {
      console.log('  NOT FOUND in Rewardful\n');
      continue;
    }

    // Get expanded data with commission_stats
    const expandUrl = `${baseUrl}/affiliates/${affiliate.id}?expand=true`;
    const expandResp = await fetch(expandUrl, {
      headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/json' },
    });
    const expandData = await expandResp.json();

    const stats = expandData.commission_stats?.currencies;
    console.log(`  Affiliate ID: ${affiliate.id}`);
    console.log(`  commission_stats.currencies keys: ${stats ? Object.keys(stats).join(', ') : 'NONE'}`);

    if (stats) {
      for (const [curr, data] of Object.entries(stats)) {
        console.log(`  ${curr}: unpaid=${JSON.stringify(data.unpaid)}, due=${JSON.stringify(data.due)}, paid=${JSON.stringify(data.paid)}`);
      }

      // Calculate OLD way (sum both CAD + converted USD)
      const cad = stats.CAD || {};
      const usd = stats.USD || {};
      const oldUnpaid = ((cad.unpaid?.cents || 0) / 100) + (((usd.unpaid?.cents || 0) / 100) * conversionRate);

      // Calculate NEW way (CAD first, fall back to USD)
      const currData = stats.CAD || stats.USD;
      const isUsd = !stats.CAD && !!stats.USD;
      let newUnpaid = (currData?.unpaid?.cents || 0) / 100;
      if (isUsd) newUnpaid = newUnpaid * conversionRate;

      console.log(`  OLD (sum both): $${oldUnpaid.toFixed(2)}`);
      console.log(`  NEW (CAD||USD): $${newUnpaid.toFixed(2)}`);
      
      totalOld += oldUnpaid;
      totalNew += newUnpaid;
    }
    console.log('');
  }

  console.log('=== TOTALS ===');
  console.log(`OLD way (sum both): $${totalOld.toFixed(2)}`);
  console.log(`NEW way (CAD||USD): $${totalNew.toFixed(2)}`);
  console.log(`GAS shows:          $1,029.86`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
