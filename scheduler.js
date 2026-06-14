import cron from 'node-cron'
import { getUpcomingMemberships, getTasks } from './db.js'

export function startScheduler(bot, chatId) {
  cron.schedule('0 15 * * *', async () => {
    try {
      const upcoming = await getUpcomingMemberships(3)
      for (const m of upcoming) {
        await bot.sendMessage(chatId, `🔔 *${m.name}* se cobra en 3 días — $${m.amount} ${m.currency}`, { parse_mode: 'Markdown' })
      }
      const tasks = await getTasks(false)
      const altas = tasks.filter(t => t.priority === 'alta')
      if (altas.length) {
        let text = `☀️ *Tareas de alta prioridad hoy:*\n\n`
        altas.slice(0,5).forEach((t,i) => { text += `🔴 ${i+1}. ${t.title}\n` })
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
      }
    } catch (err) { console.error('[scheduler]', err.message) }
  }, { timezone: 'UTC' })
  console.log('[scheduler] Activo')
}
