/**
 * Fix teachers whose aliasEmail is actually an internalEmail (contains %).
 * These should map to the real user who has that as their internalEmail.
 * e.g., teacher "mario30%@gmail.com" should map to "mg.one4all@gmail.com" 
 * (who has internalEmail "mario30%@gmail.com")
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
  // Find all users whose aliasEmail contains % 
  const pctUsers = await prisma.user.findMany({
    where: { aliasEmail: { contains: '%' } },
    select: { id: true, aliasEmail: true, internalEmail: true, isTeacher: true }
  });
  
  console.log(`Users with % in aliasEmail: ${pctUsers.length}`);
  
  for (const pctUser of pctUsers) {
    // Find a "real" user who has this as their internalEmail
    const realUser = await prisma.user.findFirst({
      where: { 
        internalEmail: pctUser.aliasEmail,
        id: { not: pctUser.id }
      }
    });
    
    if (realUser) {
      console.log(`\n${pctUser.aliasEmail} -> maps to ${realUser.aliasEmail} (who has internalEmail=${realUser.internalEmail})`);
      
      // Re-point all links from pctUser to realUser
      const links = await prisma.teacherStudentLink.findMany({
        where: { OR: [{ teacherId: pctUser.id }, { studentId: pctUser.id }] },
        include: { teacher: { select: { aliasEmail: true } }, student: { select: { aliasEmail: true } } }
      });
      
      for (const link of links) {
        const newTeacherId = link.teacherId === pctUser.id ? realUser.id : link.teacherId;
        const newStudentId = link.studentId === pctUser.id ? realUser.id : link.studentId;
        
        const existing = await prisma.teacherStudentLink.findFirst({
          where: { teacherId: newTeacherId, studentId: newStudentId }
        });
        
        if (existing && existing.id !== link.id) {
          await prisma.teacherStudentLink.delete({ where: { id: link.id } });
          console.log(`  Deleted duplicate link`);
        } else {
          try {
            await prisma.teacherStudentLink.update({
              where: { id: link.id },
              data: { teacherId: newTeacherId, studentId: newStudentId }
            });
            console.log(`  Re-pointed link`);
          } catch (err) {
            await prisma.teacherStudentLink.delete({ where: { id: link.id } }).catch(() => {});
            console.log(`  Deleted conflicting link`);
          }
        }
      }
      
      // Mark real user as teacher
      await prisma.user.update({ where: { id: realUser.id }, data: { isTeacher: true } });
      
      // Delete the pctUser if no remaining links
      const remaining = await prisma.teacherStudentLink.count({
        where: { OR: [{ teacherId: pctUser.id }, { studentId: pctUser.id }] }
      });
      
      if (remaining === 0) {
        try {
          await prisma.attendanceProfile.deleteMany({ where: { userId: pctUser.id } });
          await prisma.session.deleteMany({ where: { userId: pctUser.id } });
          await prisma.teacherEarnings.deleteMany({ where: { userId: pctUser.id } });
          await prisma.commissionOverride.deleteMany({ where: { userId: pctUser.id } });
          await prisma.commissionTracking.deleteMany({ where: { email: pctUser.aliasEmail } });
          await prisma.referralCache.deleteMany({ where: { email: pctUser.aliasEmail } });
          await prisma.user.delete({ where: { id: pctUser.id } });
          console.log(`  Deleted duplicate user: ${pctUser.aliasEmail}`);
        } catch (err) {
          console.log(`  Could not delete: ${err.message}`);
        }
      }
    } else {
      console.log(`\n${pctUser.aliasEmail} -> NO real user found with this as internalEmail (keeping as-is)`);
    }
  }
  
  // Final state
  console.log('\n\n=== FINAL STATE ===\n');
  const links = await prisma.teacherStudentLink.findMany({
    include: { teacher: { select: { aliasEmail: true, internalEmail: true } }, student: { select: { aliasEmail: true } } }
  });
  console.log(`Links (${links.length}):`);
  for (const l of links) {
    console.log(`  ${l.teacher.aliasEmail} -> ${l.student.aliasEmail} [${l.status}]`);
  }
  
  const teachers = await prisma.user.findMany({
    where: { isTeacher: true },
    select: { aliasEmail: true, internalEmail: true, isAdmin: true }
  });
  console.log(`\nTeachers (${teachers.length}):`);
  for (const t of teachers) {
    console.log(`  ${t.aliasEmail} (internal: ${t.internalEmail || 'N/A'}) admin: ${t.isAdmin}`);
  }
  
  console.log(`\nTotal users: ${await prisma.user.count()}`);
  console.log(`% alias users remaining: ${await prisma.user.count({ where: { aliasEmail: { contains: '%' } } })}`);
}

fix().catch(console.error).finally(() => prisma.$disconnect());
