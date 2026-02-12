const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const r1 = await p.user.updateMany({
    where: { aliasEmail: 'adamghouj@gmail.con' },
    data: { isTeacher: true },
  });
  console.log('adamghouj@gmail.con -> isTeacher=true:', r1.count, 'updated');

  const r2 = await p.user.updateMany({
    where: { aliasEmail: 'janedoe@gmail.com' },
    data: { isTeacher: true },
  });
  console.log('janedoe@gmail.com -> isTeacher=true:', r2.count, 'updated');

  await p.$disconnect();
}

main().catch(e => { console.error(e); p.$disconnect(); });
