const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
async function main() {
  const prisma = new PrismaClient();
  const newPassword = process.argv[2];
  const hash = await bcrypt.hash(newPassword, 10);
  const user = await prisma.user.update({
    where: { email: 'admin@trafficcrm.io' },
    data: { passwordHash: hash },
    select: { id: true, email: true },
  });
  console.log('Updated password for', user.email);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
