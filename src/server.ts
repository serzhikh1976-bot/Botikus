import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { Update } from 'ultra-telegram-framework';
import { getBot, cacheSize } from './bot/index.js';
import { getAdminBot, getAdminBotUuid } from './admin/bot.js';
import { registerAdminWeb } from './admin/web.js';
import { runCheckOnce } from './jobs/auto-close-chats.js';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export async function buildServer() {
  const app = Fastify({ logger: false });

  await registerAdminWeb(app);

  // Health check — для хостинга и проверки что сервер жив
  app.get('/', async () => ({
    ok: true,
    bots_in_cache: cacheSize()
  }));

  // Внешний крон (UptimeRobot / cron-job.org): будит сервис на бесплатном хостинге
  // и запускает проверку чатов. Включается только если задан CRON_SECRET.
  // Вызов: GET /cron/check-chats?key=<CRON_SECRET> или заголовок x-cron-key
  app.get('/cron/check-chats', async (request, reply) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) return reply.code(404).send({ ok: false });

    const q = request.query as { key?: string };
    const header = request.headers['x-cron-key'];
    const provided = q.key ?? (Array.isArray(header) ? header[0] : header) ?? '';
    if (!safeEqual(provided, secret)) return reply.code(401).send({ ok: false });

    // Проверка идёт в фоне — отвечаем сразу, чтобы не упереться в таймаут крон-сервиса
    void runCheckOnce();
    return { ok: true, started: true };
  });

  // Единственная точка входа для всех ботов
  // uuid = поле number из таблицы bots, либо ADMIN_BOT_UUID для админ-бота
  app.post('/webhook/:uuid', async (request, reply) => {
    const { uuid } = request.params as { uuid: string };

    // Всегда 200 — Telegram не должен делать ретраи
    try {
      // Админ-бот не лежит в таблице bots — отдельная точка входа
      if (uuid === getAdminBotUuid()) {
        const adminBot = getAdminBot();
        if (adminBot) {
          await adminBot.handleUpdate(request.body as Update);
        }
        return reply.code(200).send({ ok: true });
      }

      const bot = await getBot(uuid);

      if (!bot) {
        // Неизвестный uuid или бот деактивирован — тихо игнорируем
        return reply.code(200).send({ ok: true });
      }

      await bot.handleUpdate(request.body as Update);
    } catch (err) {
      // Страховка: даже если что-то сломалось — всегда 200
      console.error(`[Webhook] Необработанная ошибка uuid=${uuid}:`, err);
    }

    return reply.code(200).send({ ok: true });
  });

  return app;
}