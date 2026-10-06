import { InlineKeyboard } from 'ultra-telegram-framework';
import type { SceneContext } from 'ultra-telegram-framework';

/**
 * Общая логика приёма фото для сцен регистрации и редактирования портфолио.
 *
 * - Управление кнопками (Готово / Пропустить / Заново / Отмена). Команды
 *   /done и /skip по-прежнему работают.
 * - Альбом (несколько фото за раз) приходит от Telegram отдельными сообщениями.
 *   Чтобы не отвечать на каждое, итоговое сообщение с числом фото отправляется
 *   один раз, когда альбом дошёл целиком.
 * - Лимит фото не закрывает сцену сам: лишние снимки альбома молча пропускаются,
 *   иначе они приходили бы уже после выхода из сцены и попадали в чужой обработчик.
 */

export const MAX_PHOTOS = 5;
const ALBUM_WAIT_MS = 800;

export type PhotoMode = 'register' | 'edit';
export type PhotoAction = 'wait' | 'done' | 'skip' | 'cancel';

export function getUserId(ctx: SceneContext): number | undefined {
  return (
    ctx.callbackQuery?.from.id ??
    (ctx.message && 'from' in ctx.message ? ctx.message.from?.id : undefined)
  );
}

/** Клавиатура под сообщением: зависит от режима и от того, есть ли уже фото. */
export function photoKeyboard(mode: PhotoMode, hasPhotos: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (mode === 'register') {
    if (hasPhotos) kb.text('✅ Готово', 'photos:done').text('🗑 Заново', 'photos:reset');
    else kb.text('⏭ Пропустить', 'photos:skip');
  } else {
    if (hasPhotos) {
      kb.text('✅ Сохранить', 'photos:done').text('🗑 Заново', 'photos:reset').row();
      kb.text('↩️ Отмена', 'photos:cancel');
    } else {
      kb.text('🗑 Удалить все фото', 'photos:skip').row();
      kb.text('↩️ Отмена', 'photos:cancel');
    }
  }
  return kb;
}

function markup(mode: PhotoMode, hasPhotos: boolean) {
  return { reply_markup: photoKeyboard(mode, hasPhotos).toJSON() };
}

async function dropButtons(ctx: SceneContext): Promise<void> {
  try {
    await ctx.editReplyMarkup({ inline_keyboard: [] } as Parameters<typeof ctx.editReplyMarkup>[0]);
  } catch {
    // сообщение уже изменено или удалено — не критично
  }
}

type Pending = { timer?: ReturnType<typeof setTimeout>; count: number; overflow: number };
const pending = new Map<string, Pending>();

async function sendSummary(
  ctx: SceneContext,
  mode: PhotoMode,
  count: number,
  overflow: number,
): Promise<void> {
  const doneWord = mode === 'edit' ? '«Сохранить»' : '«Готово»';
  const text = overflow > 0 || count >= MAX_PHOTOS
    ? `📸 Принято ${count} фото — это максимум${overflow > 0 ? ' (остальные пропущены)' : ''}.\nНажмите ${doneWord}.`
    : `📸 Получено фото: ${count}/${MAX_PHOTOS}.\nМожно отправить ещё или нажать ${doneWord}.`;
  try {
    await ctx.reply(text, markup(mode, true));
  } catch (err) {
    console.error('[photo-input] Не удалось отправить итог:', err);
  }
}

export async function handlePhotoInput(
  ctx: SceneContext,
  opts: { botId: number; mode: PhotoMode },
): Promise<PhotoAction> {
  const { botId, mode } = opts;
  const state = ctx.scene.state;
  const photos = (state.photos as string[] | undefined) ?? [];
  const userId = getUserId(ctx);
  const key = `${botId}:${ctx.chatId}:${userId}`;

  // ── Кнопки ──
  if (ctx.callbackQuery) {
    const data = ctx.callbackQuery.data ?? '';
    try { await ctx.answerCallbackQuery(); } catch { /* уже отвечено */ }

    if (!data.startsWith('photos:')) return 'wait'; // кнопка от другого шага

    const action = data.slice('photos:'.length);
    if (action === 'reset') {
      state.photos = [];
      const p = pending.get(key);
      if (p?.timer) clearTimeout(p.timer);
      pending.delete(key);
      await dropButtons(ctx);
      await ctx.reply('🗑 Фото сброшены. Отправьте новые (до 5 штук).', markup(mode, false));
      return 'wait';
    }
    if (action === 'done' || action === 'skip' || action === 'cancel') {
      const p = pending.get(key);
      if (p?.timer) clearTimeout(p.timer);
      pending.delete(key);
      await dropButtons(ctx);
      return action;
    }
    return 'wait';
  }

  // ── Команды (совместимость со старым поведением) ──
  if (ctx.text === '/done') return 'done';
  if (ctx.text === '/skip') return 'skip';

  // ── Фото ──
  const msg = ctx.message;
  const sizes = msg && 'photo' in msg ? msg.photo : undefined;

  if (sizes && sizes.length > 0) {
    const entry: Pending = pending.get(key) ?? { count: 0, overflow: 0 };

    if (photos.length >= MAX_PHOTOS) {
      entry.overflow += 1; // лишнее — молча пропускаем
    } else {
      const fileId = sizes[sizes.length - 1].file_id;
      if (!photos.includes(fileId)) photos.push(fileId);
      state.photos = photos;
    }
    entry.count = Math.max(entry.count, photos.length);

    const isAlbum = !!(msg && 'media_group_id' in msg && msg.media_group_id);
    if (entry.timer) clearTimeout(entry.timer);

    if (!isAlbum && entry.overflow === 0) {
      pending.delete(key);
      await sendSummary(ctx, mode, entry.count, 0);
    } else {
      entry.timer = setTimeout(() => {
        pending.delete(key);
        void sendSummary(ctx, mode, entry.count, entry.overflow);
      }, ALBUM_WAIT_MS);
      pending.set(key, entry);
    }
    return 'wait';
  }

  // ── Картинка, присланная как файл ──
  const doc = msg && 'document' in msg ? msg.document : undefined;
  if (doc?.mime_type?.startsWith('image/')) {
    await ctx.reply(
      '⚠️ Эту картинку я не смог принять: она отправлена как файл.\nОтправьте её как обычное фото (без галочки «Без сжатия» / «Как файл»).',
      markup(mode, photos.length > 0),
    );
    return 'wait';
  }

  // ── Что-то другое ──
  await ctx.reply('Отправьте фото или воспользуйтесь кнопками ниже.', markup(mode, photos.length > 0));
  return 'wait';
}
