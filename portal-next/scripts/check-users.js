const { PrismaClient } = require('@prisma/client');

async function checkUsers() {
  const prisma = new PrismaClient();
  
  try {
    const users = await prisma.user.findMany({
      select: {
        aliasEmail: true,
        internalEmail: true,
        passwordHash: true,
        passwordSalt: true,
        accountStatus: true,
        firstName: true,
        lastName: true,
      },
      take: 10
    });
    
    console.log('\n=== SAMPLE USERS FROM DATABASE ===\n');
    users.forEach((u, i) => {
      console.log(`User ${i + 1}:`);
      console.log(`  Alias Email: ${u.aliasEmail}`);
      console.log(`  Internal Email: ${u.internalEmail || 'N/A'}`);
      console.log(`  Name: ${u.firstName || ''} ${u.lastName || ''}`);
      console.log(`  Status: ${u.accountStatus}`);
      console.log(`  Has Password Hash: ${u.passwordHash ? 'YES (' + u.passwordHash.substring(0, 15) + '...)' : 'NO'}`);
      console.log(`  Has Password Salt: ${u.passwordSalt ? 'YES (' + u.passwordSalt.substring(0, 10) + '...)' : 'NO'}`);
      console.log('');
    });
    
    // Count stats
    const totalUsers = await prisma.user.count();
    const usersWithPassword = await prisma.user.count({ where: { passwordHash: { not: null } } });
    const activeUsers = await prisma.user.count({ where: { accountStatus: 'ACTIVE' } });
    const completedUsers = await prisma.user.count({ where: { accountStatus: 'COMPLETED' } });
    
    console.log('=== SUMMARY ===');
    console.log(`Total users: ${totalUsers}`);
    console.log(`Users with password hash: ${usersWithPassword}`);
    console.log(`Active status: ${activeUsers}`);
    console.log(`Completed status: ${completedUsers}`);
    
  } finally {
    await prisma.$disconnect();
  }
}

checkUsers().catch(console.error);
