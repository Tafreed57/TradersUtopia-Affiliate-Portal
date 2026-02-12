const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const teacher = await p.user.findUnique({ where: { aliasEmail: 'mg.one4all@gmail.com' } });
  const links = await p.teacherStudentLink.findMany({
    where: { teacherId: teacher.id, status: 'ACTIVE' },
    include: { student: { select: { aliasEmail: true, internalEmail: true, isTeacher: true } } },
  });

  console.log(`Teacher: mg.one4all@gmail.com (ID: ${teacher.id})`);
  console.log(`Active students: ${links.length}\n`);
  for (const l of links) {
    const s = l.student;
    console.log(`  ${s.aliasEmail} (internal: ${s.internalEmail || 'null'}) isTeacher: ${s.isTeacher}`);
  }
  await p.$disconnect();
}
main().catch(e => { console.error(e); p.$disconnect(); });
