const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const clientsService = app.get(require('./dist/modules/clients/clients.service').ClientsService);
  const prisma = app.get(require('./dist/prisma/prisma.service').PrismaService);

  const clientId = 'cmrulwnl80005v9ozfxoo9ee1';
  const projectId = 'cmrtrmch5002tqwjeclcmrmb2';

  const before = await prisma.client.findUnique({ where: { id: clientId }, select: { firstDialogueAt: true, lastDialogueAt: true, dialogueMessageCount: true } });
  console.log('BEFORE:', before);

  await clientsService.recordManualDialogue(clientId, projectId);

  const after = await prisma.client.findUnique({ where: { id: clientId }, select: { firstDialogueAt: true, lastDialogueAt: true, dialogueMessageCount: true } });
  console.log('AFTER 1st call:', after);

  // Повторный вызов — не должен слать второй раз Dialogue-событие (проверка isFirstMessage),
  // но lastDialogueAt/count обновятся
  await clientsService.recordManualDialogue(clientId, projectId);
  const after2 = await prisma.client.findUnique({ where: { id: clientId }, select: { firstDialogueAt: true, lastDialogueAt: true, dialogueMessageCount: true } });
  console.log('AFTER 2nd call:', after2);

  const events = await prisma.trackingEvent.findMany({ where: { clientId, eventName: 'Dialogue' } });
  console.log('Dialogue TrackingEvents count:', events.length, events.map(e => ({ id: e.id, createdAt: e.createdAt })));

  await app.close();
})();
