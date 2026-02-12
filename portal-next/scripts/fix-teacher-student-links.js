/**
 * Fix teacher-student links by cross-referencing with legacy attendance data.
 * Removes links where the student selected "none" as teacher (they're a teacher themselves)
 * or where the student's teacherEmail doesn't match this teacher.
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  console.log('=== FIX TEACHER-STUDENT LINKS ===\n');

  // Load legacy data to check actual teacher assignments
  const exportPath = path.resolve(__dirname, '..', 'data', 'legacy-export.json');
  const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
  const attendanceUsers = exportData.attendanceUsers || {};

  // Build map of student email -> their assigned teacher email
  const studentTeacherMap = {};
  for (const [key, data] of Object.entries(attendanceUsers)) {
    const email = (data.email || '').toLowerCase();
    const teacherEmail = (data.teacherEmail || '').toLowerCase();
    if (email) {
      studentTeacherMap[email] = teacherEmail || null;
    }
  }

  console.log(`Loaded ${Object.keys(studentTeacherMap).length} student-teacher assignments from legacy\n`);

  // Get all active teacher-student links
  const links = await prisma.teacherStudentLink.findMany({
    where: { status: 'ACTIVE' },
    include: {
      teacher: { select: { aliasEmail: true, internalEmail: true } },
      student: { select: { aliasEmail: true, internalEmail: true, isTeacher: true } },
    },
  });

  console.log(`Found ${links.length} active teacher-student links\n`);

  let fixed = 0;
  let correct = 0;

  for (const link of links) {
    const teacherAlias = link.teacher.aliasEmail;
    const teacherInternal = link.teacher.internalEmail || teacherAlias;
    const studentAlias = link.student.aliasEmail;
    const studentInternal = link.student.internalEmail || studentAlias;

    // Check legacy data for this student's assigned teacher
    const legacyTeacher = studentTeacherMap[studentAlias] || studentTeacherMap[studentInternal];

    // Determine if this link is valid
    let shouldRemove = false;
    let reason = '';

    if (legacyTeacher === 'none') {
      // Student selected "none" — they're a teacher, shouldn't be linked as student
      shouldRemove = true;
      reason = `student selected "none" (is teacher: ${link.student.isTeacher})`;
    } else if (legacyTeacher === null || legacyTeacher === '') {
      // No teacher assigned or removed
      shouldRemove = true;
      reason = 'no teacher assigned in legacy';
    } else if (legacyTeacher !== teacherInternal && legacyTeacher !== teacherAlias) {
      // Student is assigned to a DIFFERENT teacher
      shouldRemove = true;
      reason = `assigned to different teacher: ${legacyTeacher} (not ${teacherAlias}/${teacherInternal})`;
    }

    if (shouldRemove) {
      console.log(`REMOVE: ${studentAlias} from ${teacherAlias}`);
      console.log(`  Reason: ${reason}`);

      await prisma.teacherStudentLink.update({
        where: { id: link.id },
        data: { status: 'REMOVED', removedAt: new Date(), removedBy: 'legacy_sync' },
      });
      fixed++;
    } else {
      correct++;
    }
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Correct links: ${correct}`);
  console.log(`Fixed (removed): ${fixed}`);

  // Show final state for mario teacher
  const mario = await prisma.user.findUnique({ where: { aliasEmail: 'mg.one4all@gmail.com' } });
  if (mario) {
    const marioLinks = await prisma.teacherStudentLink.findMany({
      where: { teacherId: mario.id, status: 'ACTIVE' },
      include: { student: { select: { aliasEmail: true } } },
    });
    console.log(`\nMario (mg.one4all@gmail.com) now has ${marioLinks.length} active students:`);
    for (const l of marioLinks) {
      console.log(`  ${l.student.aliasEmail}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
