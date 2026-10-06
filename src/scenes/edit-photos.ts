import { WizardScene } from 'ultra-telegram-framework';
import type { SceneContext } from 'ultra-telegram-framework';
import { db } from '../db.js';
import { masterKeyboard } from '../bot/keyboards.js';
import { handlePhotoInput, getUserId, photoKeyboard } from './photo-input.js';

export function createEditPhotosScene(botId: number) {
  return new WizardScene<SceneContext>(
    'edit_photos',

    // Step 0: собираем новые фото; кнопки «Сохранить» / «Удалить все фото» / «Отмена»
    async (ctx) => {
      if (!ctx.message && !ctx.callbackQuery) return;

      const telegramId = getUserId(ctx);
      if (!telegramId) return ctx.scene.leave();

      const action = await handlePhotoInput(ctx, { botId, mode: 'edit' });
      if (action === 'wait') return;

      if (action === 'cancel') {
        await ctx.replyWithKeyboard('↩️ Отменено, фото не изменились.', masterKeyboard);
        return ctx.scene.leave();
      }

      // «Удалить все фото»
      if (action === 'skip') {
        await savePhotos(telegramId, botId, []);
        await ctx.replyWithKeyboard('✅ Все фото удалены.', masterKeyboard);
        return ctx.scene.leave();
      }

      // «Сохранить»
      const photos = (ctx.scene.state.photos as string[] | undefined) ?? [];
      if (photos.length === 0) {
        return ctx.reply(
          'Сначала отправьте хотя бы одно фото или нажмите «Удалить все фото».',
          { reply_markup: photoKeyboard('edit', false).toJSON() }
        );
      }

      await savePhotos(telegramId, botId, photos);
      await ctx.replyWithKeyboard(`✅ Фото обновлены (${photos.length} шт.)`, masterKeyboard);
      return ctx.scene.leave();
    }
  );
}

async function savePhotos(
  telegramId: number,
  botId: number,
  photos: string[]
): Promise<void> {
  const { error } = await db
    .from('masters_profiles')
    .update({ photos })
    .eq('master_id', telegramId)
    .eq('bot_id', botId);

  if (error) console.error('[editPhotos] Ошибка:', error.message);
}
