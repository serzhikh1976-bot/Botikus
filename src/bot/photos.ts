import type { InlineKeyboard, SceneContext } from 'ultra-telegram-framework';

/**
 * Показывает карточку мастера с фото.
 *
 * sendMediaGroup принимает только 2–10 элементов, поэтому для одного фото
 * используем sendPhoto — иначе запрос падал бы, и карточка с единственным
 * фото показывалась бы без снимка.
 *
 * - 1 фото: фото с подписью, кнопки сразу под ним.
 * - 2+ фото: альбом с подписью, кнопки отдельным сообщением (у альбома их быть не может).
 * - 0 фото или устаревший file_id: текстовая карточка с кнопками.
 */
export async function replyWithCard(
  ctx: SceneContext,
  photos: string[] | null | undefined,
  caption: string,
  keyboard?: InlineKeyboard,
  albumFollowUp = '👆 Контакт мастера:',
): Promise<void> {
  const ids = (photos ?? []).filter(Boolean).slice(0, 10);
  const markup = keyboard ? { reply_markup: keyboard.toJSON() } : {};

  let sent: 'none' | 'single' | 'album' = 'none';
  try {
    if (ids.length === 1) {
      await ctx.replyWithPhoto(ids[0], { caption, parse_mode: 'HTML', ...markup });
      sent = 'single';
    } else if (ids.length >= 2) {
      await ctx.replyWithMediaGroup(
        ids.map((fileId, i) => ({
          type: 'photo' as const,
          media: fileId,
          ...(i === 0 ? { caption, parse_mode: 'HTML' as const } : {}),
        })),
      );
      sent = 'album';
    }
  } catch {
    // file_id устарел или недоступен — покажем карточку без фото
  }

  if (sent === 'none') {
    await ctx.reply(caption, { parse_mode: 'HTML', ...markup });
    return;
  }
  if (sent === 'album' && keyboard) {
    await ctx.reply(albumFollowUp, markup);
  }
}
