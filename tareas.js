import { addTask, getTasks, completeTask } from '../db/index.js'

const PRIORITY_ICON = { alta: '🔴', media: '🟡', baja: '🟢' }
const PRIORITY_ORDER = { alta: 0, media: 1, baja: 2 }

export async function handleTareas(bot, msg, session) {
  const chatId = msg.chat.id
  const pending = await getTasks(false)
  const alta = pending.filter(t => t.priority === 'alta').length

  const keyboard = {
    inline_keyboard: [
      [{ text: '➕ Nueva tarea', callback_data: 'tarea_add' }],
      [{ text: `📋 Ver pendientes (${pending.length})`, callback_data: 'tarea_ver' }],
      [{ text: '✅ Marcar completada', callback_data: 'tarea_done' }],
      [{ text: '📦 Ver completadas', callback_data: 'tarea_completadas' }],
    ]
  }

  const status = alta > 0 ? `\n⚠️ Tienes ${alta} tarea(s) de alta prioridad` : ''
  await bot.sendMessage(chatId, `✅ *Tareas*${status}`, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  })
}

export async function handleTareasCallback(bot, query, session) {
  const chatId = query.message.chat.id
  await bot.answerCallbackQuery(query.id)

  if (query.data === 'tarea_add') {
    session.state = 'awaiting_task'
    const keyboard = {
      inline_keyboard: [
        [
          { text: '🔴 Alta', callback_data: 'tarea_priority_alta' },
          { text: '🟡 Media', callback_data: 'tarea_priority_media' },
          { text: '🟢 Baja', callback_data: 'tarea_priority_baja' },
        ]
      ]
    }
    return bot.sendMessage(chatId, '¿Qué prioridad tiene?', { reply_markup: keyboard })
  }

  if (query.data.startsWith('tarea_priority_')) {
    const priority = query.data.replace('tarea_priority_', '')
    session.pendingTask = { priority }
    session.state = 'awaiting_task_title'
    return bot.sendMessage(chatId, `${PRIORITY_ICON[priority]} Prioridad *${priority}*. ¿Cuál es la tarea?`, { parse_mode: 'Markdown' })
  }

  if (query.data === 'tarea_ver') {
    const tasks = await getTasks(false)
    if (!tasks.length) return bot.sendMessage(chatId, '🎉 No tienes tareas pendientes.')

    const sorted = tasks.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    let text = `📋 *Tareas pendientes (${tasks.length})*\n\n`
    sorted.forEach((t, i) => {
      text += `${PRIORITY_ICON[t.priority]} *${i + 1}.* ${t.title}\n`
      if (t.due_date) text += `   📅 Vence: ${t.due_date}\n`
      if (t.notes) text += `   💬 ${t.notes}\n`
    })
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
  }

  if (query.data === 'tarea_done') {
    const tasks = await getTasks(false)
    if (!tasks.length) return bot.sendMessage(chatId, 'No hay tareas pendientes.')

    const sorted = tasks.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    const keyboard = {
      inline_keyboard: [
        ...sorted.slice(0, 8).map(t => ([{
          text: `${PRIORITY_ICON[t.priority]} ${t.title.slice(0, 35)}`,
          callback_data: `tarea_complete_${t.id}`
        }])),
        [{ text: '❌ Cancelar', callback_data: 'cancel' }]
      ]
    }
    return bot.sendMessage(chatId, '¿Cuál completaste?', { reply_markup: keyboard })
  }

  if (query.data.startsWith('tarea_complete_')) {
    const id = query.data.replace('tarea_complete_', '')
    const task = await completeTask(id)
    return bot.sendMessage(chatId, `✅ *"${task.title}"* — ¡completada! 🎉`, { parse_mode: 'Markdown' })
  }

  if (query.data === 'tarea_completadas') {
    const tasks = await getTasks(true)
    if (!tasks.length) return bot.sendMessage(chatId, 'No hay tareas completadas.')
    let text = `✅ *Completadas (${tasks.length})*\n\n`
    tasks.slice(0, 10).forEach(t => {
      text += `✓ ${t.title}\n`
    })
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
  }
}

export async function handleTaskText(bot, msg, session) {
  const chatId = msg.chat.id
  const { priority = 'media' } = session.pendingTask || {}
  const title = msg.text.trim()

  const task = await addTask(title, priority)
  session.state = null
  session.pendingTask = null

  return bot.sendMessage(chatId,
    `${PRIORITY_ICON[priority]} Tarea agregada:\n*${task.title}*`,
    { parse_mode: 'Markdown' }
  )
}
