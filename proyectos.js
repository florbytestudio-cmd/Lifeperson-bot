import { getProjects, addProject, updateProject } from './db.js'
import dayjs from 'dayjs'

const STATUS_ICON = { activo: '🟢', pausado: '🟡', terminado: '✅' }

export async function handleProyectos(bot, msg, session) {
  const chatId = msg.chat.id
  const activos = await getProjects('activo')
  const keyboard = {
    inline_keyboard: [
      [{ text: `📋 Ver clientes activos (${activos.length})`, callback_data: 'proy_ver' }],
      [{ text: '➕ Nuevo cliente/proyecto', callback_data: 'proy_add' }],
      [{ text: '📊 Actualizar avance', callback_data: 'proy_update' }],
      [{ text: '🏁 Ver terminados', callback_data: 'proy_terminados' }],
    ]
  }
  await bot.sendMessage(chatId, `📁 *Proyectos FlorByte*\n${activos.length} cliente(s) activo(s)`, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  })
}

export async function handleProyectosCallback(bot, query, session) {
  const chatId = query.message.chat.id
  await bot.answerCallbackQuery(query.id)

  if (query.data === 'proy_ver') {
    const projects = await getProjects('activo')
    if (!projects.length) return bot.sendMessage(chatId, 'No hay proyectos activos.')

    let text = '📁 *Clientes activos*\n\n'
    projects.forEach((p, i) => {
      const bar = buildProgressBar(p.progress)
      text += `*${i + 1}. ${p.client_name}*\n`
      if (p.description) text += `   ${p.description}\n`
      text += `   ${bar} ${p.progress}%\n`
      if (p.deadline) {
        const days = dayjs(p.deadline).diff(dayjs(), 'day')
        const urgency = days < 3 ? '🔴' : days < 7 ? '🟡' : '🟢'
        text += `   ${urgency} Entrega: ${dayjs(p.deadline).format('DD/MM/YY')} (${days}d)\n`
      }
      if (p.budget) text += `   💰 $${Number(p.budget).toLocaleString()}\n`
      text += '\n'
    })
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
  }

  if (query.data === 'proy_add') {
    session.state = 'awaiting_project_name'
    return bot.sendMessage(chatId, '➕ ¿Cómo se llama el cliente o proyecto?')
  }

  if (query.data === 'proy_update') {
    const projects = await getProjects('activo')
    if (!projects.length) return bot.sendMessage(chatId, 'No hay proyectos activos.')
    const keyboard = {
      inline_keyboard: projects.slice(0, 8).map(p => ([{
        text: `${p.client_name} (${p.progress}%)`,
        callback_data: `proy_sel_${p.id}`
      }]))
    }
    return bot.sendMessage(chatId, '¿Qué proyecto actualizas?', { reply_markup: keyboard })
  }

  if (query.data.startsWith('proy_sel_')) {
    const id = query.data.replace('proy_sel_', '')
    session.pendingProject = { id }
    session.state = 'awaiting_project_progress'
    const keyboard = {
      inline_keyboard: [
        [10, 25, 50].map(n => ({ text: `${n}%`, callback_data: `proy_prog_${id}_${n}` })),
        [75, 90, 100].map(n => ({ text: `${n}%`, callback_data: `proy_prog_${id}_${n}` })),
      ]
    }
    return bot.sendMessage(chatId, '¿Cuánto va de avance?', { reply_markup: keyboard })
  }

  if (query.data.startsWith('proy_prog_')) {
    const parts = query.data.split('_')
    const id = parts[2]
    const progress = parseInt(parts[3])
    const status = progress === 100 ? 'terminado' : 'activo'
    await updateProject(id, { progress, status })
    const msg2 = progress === 100
      ? `🎉 ¡Proyecto terminado al 100%!`
      : `✅ Avance actualizado a *${progress}%*`
    return bot.sendMessage(chatId, msg2, { parse_mode: 'Markdown' })
  }

  if (query.data === 'proy_terminados') {
    const projects = await getProjects('terminado')
    if (!projects.length) return bot.sendMessage(chatId, 'No hay proyectos terminados aún.')
    let text = '🏁 *Proyectos terminados*\n\n'
    projects.slice(0, 8).forEach(p => {
      text += `✅ *${p.client_name}*`
      if (p.budget) text += ` — $${Number(p.budget).toLocaleString()}`
      text += '\n'
    })
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
  }
}

export async function handleProjectText(bot, msg, session) {
  const chatId = msg.chat.id

  if (session.state === 'awaiting_project_name') {
    session.pendingProject = { client_name: msg.text.trim() }
    session.state = 'awaiting_project_desc'
    return bot.sendMessage(chatId, '¿Qué es el proyecto? (breve descripción, o escribe "skip")')
  }

  if (session.state === 'awaiting_project_desc') {
    const desc = msg.text.trim().toLowerCase() === 'skip' ? null : msg.text.trim()
    session.pendingProject.description = desc
    session.state = 'awaiting_project_budget'
    return bot.sendMessage(chatId, '¿Cuál es el presupuesto en pesos? (o "skip")')
  }

  if (session.state === 'awaiting_project_budget') {
    const raw = msg.text.trim()
    const budget = raw.toLowerCase() === 'skip' ? null : parseFloat(raw.replace(/[,$]/g, ''))
    session.pendingProject.budget = budget
    session.state = 'awaiting_project_deadline'
    return bot.sendMessage(chatId, '¿Cuál es la fecha de entrega? (ej: 2024-12-31 o "skip")')
  }

  if (session.state === 'awaiting_project_deadline') {
    const raw = msg.text.trim()
    const deadline = raw.toLowerCase() === 'skip' ? null : raw
    const project = await addProject({ ...session.pendingProject, deadline })
    session.state = null
    session.pendingProject = null
    return bot.sendMessage(chatId,
      `✅ *${project.client_name}* agregado\n📊 Avance: 0%${project.budget ? `\n💰 $${Number(project.budget).toLocaleString()}` : ''}`,
      { parse_mode: 'Markdown' }
    )
  }
}

function buildProgressBar(progress) {
  const filled = Math.round(progress / 10)
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}
