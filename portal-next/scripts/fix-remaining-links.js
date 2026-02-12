/**
 * Fix the 4 remaining mangled teacher users.
 * These have % in the original email which was encoded as single _
 * The decode needs to try % for _ in the local part.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
  // The 4 remaining mangled teachers and their real decoded emails:
  // momo50__at_gmail_com -> momo50%@gmail.com (% encoded as single _)
  // sarah40__at_gmail_com -> sarah40%@gmail.com
  // tafreeddddd100__at_gmail_com -> tafreeddddd100%@gmail.com
  // mario30__at_gmail_com -> mario30%@gmail.com
  
  const mappings = [
    { mangled: 'momo50__at_gmail_com', decoded: 'momo50%@gmail.com' },
    { mangled: 'sarah40__at_gmail_com', decoded: 'sarah40%@gmail.com' },
    { mangled: 'tafreeddddd100__at_gmail_com', decoded: 'tafreeddddd100%@gmail.com' },
    { mangled: 'mario30__at_gmail_com', decoded: 'mario30%@gmail.com' },
  ];
  
  for (const { mangled, decoded } of mappings) {
    console.log(`\nProcessing: ${mangled} -> ${decoded}`);
    
    // Find the mangled user
    const mangledUser = await prisma.user.findUnique({ where: { aliasEmail: mangled } });
    if (!mangledUser) {
      console.log(`  Mangled user not found, skipping`);
      continue;
    }
    
    // Find real user by aliasEmail OR internalEmail
    let realUser = await prisma.user.findUnique({ where: { aliasEmail: decoded } });
    if (!realUser) {
      realUser = await prisma.user.findFirst({ where: { internalEmail: decoded } });
    }
    
    if (!realUser) {
      console.log(`  No real user found for ${decoded}`);
      console.log(`  This teacher exists only as a mangled record. Will keep it but fix the email.`);
      // Just fix the email on the mangled record itself
      try {
        await prisma.user.update({
          where: { id: mangledUser.id },
          data: { aliasEmail: decoded, isTeacher: true }
        });
        console.log(`  Updated aliasEmail to ${decoded}`);
      } catch (err) {
        // If aliasEmail already taken, the user with that email IS the real user
        console.log(`  Email ${decoded} already taken - finding that user...`);
        realUser = await prisma.user.findUnique({ where: { aliasEmail: decoded } });
      }
    }
    
    if (realUser && realUser.id !== mangledUser.id) {
      console.log(`  Found real user: ${realUser.aliasEmail} (id: ${realUser.id})`);
      
      // Re-point all links from mangled to real
      const links = await prisma.teacherStudentLink.findMany({
        where: { OR: [{ teacherId: mangledUser.id }, { studentId: mangledUser.id }] }
      });
      
      for (const link of links) {
        const newTeacherId = link.teacherId === mangledUser.id ? realUser.id : link.teacherId;
        const newStudentId = link.studentId === mangledUser.id ? realUser.id : link.studentId;
        
        // Check for existing duplicate
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
            console.log(`  Re-pointed link to real user`);
          } catch (err) {
            console.log(`  Error: ${err.message} - deleting duplicate`);
            await prisma.teacherStudentLink.delete({ where: { id: link.id } }).catch(() => {});
          }
        }
      }
      
      // Mark real user as teacher
      await prisma.user.update({
        where: { id: realUser.id },
        data: { isTeacher: true }
      });
      
      // Delete mangled user
      const remainingLinks = await prisma.teacherStudentLink.count({
        where: { OR: [{ teacherId: mangledUser.id }, { studentId: mangledUser.id }] }
      });
      
      if (remainingLinks === 0) {
        try {
          await prisma.attendanceProfile.deleteMany({ where: { userId: mangledUser.id } });
          await prisma.session.deleteMany({ where: { userId: mangledUser.id } });
          await prisma.teacherEarnings.deleteMany({ where: { userId: mangledUser.id } });
          await prisma.user.delete({ where: { id: mangledUser.id } });
          console.log(`  Deleted mangled user ${mangled}`);
        } catch (err) {
          console.log(`  Could not delete: ${err.message}`);
        }
      }
    }
  }
  
  // Final state
  console.log('\n\n=== FINAL STATE ===\n');
  const links = await prisma.teacherStudentLink.findMany({
    include: { teacher: { select: { aliasEmail: true, internalEmail: true } }, student: { select: { aliasEmail: true } } }
  });
  console.log(`Links (${links.length}):`);
  for (const l of links) {
    console.log(`  ${l.teacher.aliasEmail} (${l.teacher.internalEmail || 'no internal'}) -> ${l.student.aliasEmail} [${l.status}]`);
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
  console.log(`Total mangled users remaining: ${await prisma.user.count({ where: { aliasEmail: { contains: '_at_' } } })}`);
}

fix().catch(console.error).finally(() => prisma.$disconnect());
