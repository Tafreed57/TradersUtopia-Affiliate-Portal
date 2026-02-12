const { PrismaClient } = require('@prisma/client');

async function checkTeachers() {
  const prisma = new PrismaClient();
  
  try {
    // Check teachers
    const teachers = await prisma.user.findMany({
      where: { isTeacher: true },
      select: { aliasEmail: true, isTeacher: true, isAdmin: true, firstName: true, lastName: true, internalEmail: true }
    });
    console.log('\n=== USERS WITH isTeacher=true ===');
    console.log(`Count: ${teachers.length}`);
    teachers.forEach(t => console.log(`  ${t.aliasEmail} | name: ${t.firstName} ${t.lastName} | internal: ${t.internalEmail || 'N/A'} | admin: ${t.isAdmin}`));
    
    // Check admins
    const admins = await prisma.user.findMany({
      where: { isAdmin: true },
      select: { aliasEmail: true, isAdmin: true, isTeacher: true }
    });
    console.log('\n=== USERS WITH isAdmin=true ===');
    console.log(`Count: ${admins.length}`);
    admins.forEach(a => console.log(`  ${a.aliasEmail} | teacher: ${a.isTeacher}`));
    
    // Check teacher-student links
    const links = await prisma.teacherStudentLink.findMany({
      include: {
        teacher: { select: { aliasEmail: true } },
        student: { select: { aliasEmail: true } }
      }
    });
    console.log('\n=== TEACHER-STUDENT LINKS ===');
    console.log(`Count: ${links.length}`);
    links.forEach(l => console.log(`  Teacher: ${l.teacher.aliasEmail} -> Student: ${l.student.aliasEmail} | status: ${l.status} | pct: ${l.percentageOverride || 'N/A'}`));
    
    // Check teacher earnings
    const earnings = await prisma.teacherEarnings.findMany({
      include: { user: { select: { aliasEmail: true } } }
    });
    console.log('\n=== TEACHER EARNINGS ===');
    console.log(`Count: ${earnings.length}`);
    earnings.forEach(e => console.log(`  ${e.user.aliasEmail} | locked: $${e.lockedEarnings} | total: $${e.totalEarnedAllTime} | paid: $${e.totalPaidAllTime}`));
    
    // Check attendance profiles
    const profiles = await prisma.attendanceProfile.findMany({
      include: { user: { select: { aliasEmail: true } } }
    });
    console.log('\n=== ATTENDANCE PROFILES ===');
    console.log(`Count: ${profiles.length}`);
    profiles.forEach(p => console.log(`  ${p.user.aliasEmail} | teacher: ${p.currentTeacherEmail || 'NONE'}`));
    
    // Check attendance records count
    const recordCount = await prisma.attendanceRecord.count();
    console.log(`\n=== ATTENDANCE RECORDS: ${recordCount} total ===`);
    
  } finally {
    await prisma.$disconnect();
  }
}

checkTeachers().catch(console.error);
