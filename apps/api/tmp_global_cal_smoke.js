const { NestFactory } = require('@nestjs/core');
const path = require('path');
process.chdir('/var/www/mw-track/apps/api');
const { AppModule } = require('/var/www/mw-track/apps/api/dist/app.module');
const { PrismaService } = require('/var/www/mw-track/apps/api/dist/prisma/prisma.service');
const { PushesService } = require('/var/www/mw-track/apps/api/dist/modules/pushes/pushes.service');
const { ProjectsService } = require('/var/www/mw-track/apps/api/dist/modules/projects/projects.service');

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const pushesService = app.get(PushesService);
  const projectsService = app.get(ProjectsService);

  // Найдём реальную компанию с >=2 проектами, чтобы проверить агрегацию через несколько проектов сразу
  const company = await prisma.company.findFirst({
    where: { projects: { some: {} } },
    include: { projects: { where: { deletedAt: null }, take: 3 } },
  });
  if (!company || company.projects.length === 0) { console.log('no company with projects found'); await app.close(); process.exit(0); }
  console.log('company', company.id, 'projects', company.projects.map(p => p.id));

  const owner = await prisma.user.findFirst({ where: { companyId: company.id, role: { in: ['OWNER','ADMIN','SUPER_ADMIN'] } } });
  console.log('owner user', owner && owner.id, owner && owner.role);

  const projA = company.projects[0];
  const projB = company.projects[1] || company.projects[0];

  const now = new Date();
  const in3days = new Date(now.getTime() + 3*24*60*60*1000);
  in3days.setHours(15, 30, 0, 0);

  const pushA = await prisma.push.create({ data: {
    projectId: projA.id, name: 'smoke-global-cal-A', status: 'SCHEDULED', scheduledAt: in3days,
    messageText: 'test', filter: {}, audienceTotal: 0, audienceReachable: 0,
  }});
  const pushB = await prisma.push.create({ data: {
    projectId: projB.id, name: 'smoke-global-cal-B', status: 'SCHEDULED', scheduledAt: in3days,
    messageText: 'test', filter: {}, audienceTotal: 0, audienceReachable: 0,
  }});
  console.log('created', pushA.id, pushB.id);

  const accessibleIds = await projectsService.getAccessibleProjectIds(company.id, owner.id, owner.role);
  console.log('accessible project ids count', accessibleIds.length, accessibleIds.includes(projA.id), accessibleIds.includes(projB.id));

  const month = `${in3days.getFullYear()}-${String(in3days.getMonth()+1).padStart(2,'0')}`;
  const summary = await pushesService.getGlobalScheduledSummary(accessibleIds, month);
  console.log('global summary', JSON.stringify(summary));

  const dateStr = `${in3days.getFullYear()}-${String(in3days.getMonth()+1).padStart(2,'0')}-${String(in3days.getDate()).padStart(2,'0')}`;
  const dayList = await pushesService.getScheduledForDay(accessibleIds, dateStr);
  console.log('day list (global)', JSON.stringify(dayList));

  const dayListProjectOnly = await pushesService.getScheduledForDay([projA.id], dateStr);
  console.log('day list (project A only)', JSON.stringify(dayListProjectOnly));

  // cleanup
  await prisma.push.deleteMany({ where: { id: { in: [pushA.id, pushB.id] } } });
  console.log('cleaned up');
  await app.close();
  process.exit(0);
})().catch(async (e) => { console.error('ERROR', e); process.exit(1); });
