/**
 * Fix teacher-student links migration issue (v2).
 * 
 * The mangled emails use: @ -> _at_, . -> _, % -> __
 * So "mario30__at_gmail_com" = "mario30%@gmail.com"
 * And "tafreed57_at_gmail_com" = "tafreed57@gmail.com"
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function decodeMangledEmail(mangled) {
  // Step 1: _at_ -> @
  let decoded = mangled.replace(/_at_/g, '@');
  // Step 2: __ -> % (the remaining double underscores are % signs)
  decoded = decoded.replace(/__/g, '%');
  // Step 3: remaining _ -> . (single underscores are dots)
  decoded = decoded.replace(/_/g, '.');
  return decoded;
}

async function fixTeacherLinks() {
  console.log('\n=== FIXING TEACHER-STUDENT LINKS (v2) ===\n');
  
  const allUsers = await prisma.user.findMany({
    select: { id: true, aliasEmail: true, internalEmail: true, isTeacher: true, isAdmin: true }
  });
  
  // Build lookup maps
  const userByAlias = new Map();
  const userByInternal = new Map();
  const mangledUsers = [];
  const realUsers = [];
  
  for (const u of allUsers) {
    if (u.aliasEmail.includes('_at_')) {
      mangledUsers.push(u);
    } else {
      realUsers.push(u);
      userByAlias.set(u.aliasEmail.toLowerCase(), u);
      if (u.internalEmail) {
        userByInternal.set(u.internalEmail.toLowerCase(), u);
      }
    }
  }
  
  console.log(`Real users: ${realUsers.length}, Mangled users: ${mangledUsers.length}`);
  
  // Map mangled -> real user
  const mangledToReal = new Map();
  
  for (const mangled of mangledUsers) {
    const decoded = decodeMangledEmail(mangled.aliasEmail);
    console.log(`\n  Mangled: "${mangled.aliasEmail}" -> Decoded: "${decoded}"`);
    
    // Try to find real user by:
    // 1. aliasEmail = decoded
    // 2. internalEmail = decoded  
    let realUser = userByAlias.get(decoded.toLowerCase());
    if (!realUser) realUser = userByInternal.get(decoded.toLowerCase());
    
    // Also try without % for alias matching
    if (!realUser && decoded.includes('%')) {
      const noPct = decoded.replace(/%/g, '');
      realUser = userByAlias.get(noPct.toLowerCase());
    }
    
    if (realUser && realUser.id !== mangled.id) {
      console.log(`    -> MATCHED real user: "${realUser.aliasEmail}" (internal: ${realUser.internalEmail || 'N/A'})`);
      mangledToReal.set(mangled.id, realUser.id);
    } else {
      console.log(`    -> NO MATCH found. This user may need manual review.`);
    }
  }
  
  console.log(`\n\nMatched ${mangledToReal.size} of ${mangledUsers.length} mangled users`);
  
  // Fix teacher-student links
  const links = await prisma.teacherStudentLink.findMany();
  console.log(`\n=== FIXING ${links.length} LINKS ===\n`);
  
  let fixed = 0;
  let deleted = 0;
  
  for (const link of links) {
    const newTeacherId = mangledToReal.get(link.teacherId) || link.teacherId;
    const newStudentId = mangledToReal.get(link.studentId) || link.studentId;
    
    if (newTeacherId !== link.teacherId || newStudentId !== link.studentId) {
      // Check for duplicate
      const existing = await prisma.teacherStudentLink.findFirst({
        where: { teacherId: newTeacherId, studentId: newStudentId }
      });
      
      if (existing && existing.id !== link.id) {
        console.log(`  DELETE duplicate link ${link.id}`);
        await prisma.teacherStudentLink.delete({ where: { id: link.id } });
        deleted++;
      } else {
        try {
          await prisma.teacherStudentLink.update({
            where: { id: link.id },
            data: { teacherId: newTeacherId, studentId: newStudentId }
          });
          const teacher = allUsers.find(u => u.id === newTeacherId);
          const student = allUsers.find(u => u.id === newStudentId);
          console.log(`  FIXED: ${teacher?.aliasEmail} -> ${student?.aliasEmail}`);
          fixed++;
        } catch (err) {
          console.log(`  ERROR updating link ${link.id}: ${err.message}`);
          // Try deleting the duplicate
          try { await prisma.teacherStudentLink.delete({ where: { id: link.id } }); deleted++; } catch {}
        }
      }
    }
  }
  console.log(`\nFixed: ${fixed}, Deleted duplicates: ${deleted}`);
  
  // Set isTeacher on real users that have active links as teacher
  const finalLinks = await prisma.teacherStudentLink.findMany({ where: { status: 'ACTIVE' } });
  const teacherIds = new Set(finalLinks.map(l => l.teacherId));
  
  for (const tid of teacherIds) {
    await prisma.user.update({ where: { id: tid }, data: { isTeacher: true } });
  }
  console.log(`\nSet isTeacher=true on ${teacherIds.size} users`);
  
  // Set admin+teacher for tafreed57
  await prisma.user.updateMany({
    where: { aliasEmail: 'tafreed57@gmail.com' },
    data: { isTeacher: true, isAdmin: true }
  });
  
  // Delete mangled users that were remapped
  console.log('\n=== CLEANING UP MANGLED USERS ===\n');
  let cleaned = 0;
  for (const [mangledId] of mangledToReal) {
    // Check no remaining links
    const remaining = await prisma.teacherStudentLink.count({
      where: { OR: [{ teacherId: mangledId }, { studentId: mangledId }] }
    });
    if (remaining > 0) {
      const mu = mangledUsers.find(u => u.id === mangledId);
      console.log(`  KEEPING ${mu?.aliasEmail} - still has ${remaining} links`);
      continue;
    }
    
    const mu = mangledUsers.find(u => u.id === mangledId);
    console.log(`  DELETING ${mu?.aliasEmail}`);
    try {
      await prisma.attendanceProfile.deleteMany({ where: { userId: mangledId } });
      await prisma.attendanceRecord.deleteMany({ where: { profile: { userId: mangledId } } });
      await prisma.session.deleteMany({ where: { userId: mangledId } });
      await prisma.teacherEarnings.deleteMany({ where: { userId: mangledId } });
      await prisma.user.delete({ where: { id: mangledId } });
      cleaned++;
    } catch (err) {
      console.log(`    Error: ${err.message}`);
    }
  }
  console.log(`Cleaned ${cleaned} mangled users`);
  
  // Print final state
  console.log('\n=== FINAL STATE ===\n');
  const fl = await prisma.teacherStudentLink.findMany({
    include: { teacher: { select: { aliasEmail: true } }, student: { select: { aliasEmail: true } } }
  });
  console.log(`Links (${fl.length}):`);
  for (const l of fl) {
    console.log(`  ${l.teacher.aliasEmail} -> ${l.student.aliasEmail} [${l.status}]`);
  }
  
  const ft = await prisma.user.findMany({
    where: { isTeacher: true },
    select: { aliasEmail: true, internalEmail: true, isAdmin: true }
  });
  console.log(`\nTeachers (${ft.length}):`);
  for (const t of ft) {
    console.log(`  ${t.aliasEmail} (internal: ${t.internalEmail || 'N/A'}) admin: ${t.isAdmin}`);
  }
  
  const totalUsers = await prisma.user.count();
  console.log(`\nTotal users in DB: ${totalUsers}`);
}

fixTeacherLinks()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
