import { addProspect, updateProspect, getProspects, addProject, getProjects, updateProject, supabase } from './db.js'
import { transcribeAudio, extractProspectData } from './ai.js'

const STATUS_LABELS = {
  pendiente: '⏳ Pendiente',
  interesado: '✅ Interesado',
  no_interesado: '❌ No interesado',
  negociacion: '🤝 Negociación',
  cerrado: '🎉 Cerrado',
}
const STATUS_COLORS = {
  pendiente:'badge-gray', interesado:'badge-green',
  no_interesado:'badge-red', negociacion:'badge-amber', cerrado:'badge-violet'
}

export async function handleFlorbyte(bot, msg, session) {
  const chatId = msg.chat.id
  const prospects = await getProspects()
  const projects = await getProjects('activo')
  const interesados = prospects.filter(p => p.status === 'interesado').length
  const pendientes = prospects.filter(p => p.status === 'pendiente').length

  const keyboard = {
    inline_keyboard: [
      [{ text: '🎙️ Agregar prospecto (audio)', callback_data: 'fb_audio' }],
      [{ text: '✏️ Agregar prospecto (texto)', callback_data: 'fb_texto' }],
      [{ text: `📋 Ver prospectos (${prospects.length})`, callback_data: 'fb_ver' }],
      [{ text: `🔥 Interesados (${interesados})`, callback_data: 'fb_interesados' }],
      [{ text: `📁 Proyectos activos (${projects.length})`, callback_data: 'fb_proyectos' }],
      [{ text: '➕ Nuevo proyecto directo', callback_data: 'fb_nuevo_proyecto' }],
    ]
  }
  await bot.sendMessage(chatId,
    `💼 *FlorByte Studio*\n${pendientes} pendientes · ${interesados} interesados · ${projects.length} proyectos activos`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  )
}

export async function handleFlorbyteCallback(bot, query, session) {
  const chatId = query.message.chat.id
  const data = query.data
  await bot.answerCallbackQuery(query.id)

  if (data === 'fb_audio') {
    session.state = 'awaiting_prospect_audio'
    return bot.sendMessage(chatId, '🎙️ Mándame el audio del prospecto. Cuéntame nombre, negocio, red social y lo que sepas.')
  }

  if (data === 'fb_texto') {
    session.state = 'awaiting_prospect_text'
    return bot.sendMessage(chatId, '✏️ Escríbeme los datos del prospecto:\nNombre, negocio, Instagram/Facebook, industria y notas.')
  }

  if (data === 'fb_ver' || data === 'fb_interesados') {
    const status = data === 'fb_interesados' ? 'interesado' : null
    const prospects = await getProspects(status)
    if (!prospects.length) return bot.sendMessage(chatId, 'No hay prospectos todavía.')
    let text = `💼 *${status ? 'Interesados' : 'Todos los prospectos'}* (${prospects.length})\n\n`
    prospects.slice(0, 8).forEach((p, i) => {
      text += `*${i+1}. ${p.name || p.business || 'Sin nombre'}*\n`
      if (p.business) text += `   🏢 ${p.business}\n`
      if (p.platform) text += `   📱 ${p.platform}\n`
      text += `   ${STATUS_LABELS[p.status] || p.status}\n\n`
    })
    if (prospects.length > 8) text += `_...y ${prospects.length - 8} más_`

    const keyboard = {
      inline_keyboard: [
        [{ text: '✏️ Cambiar estado de prospecto', callback_data: 'fb_cambiar_estado' }],
        [{ text: '🗑️ Eliminar prospecto', callback_data: 'fb_eliminar_prospecto' }],
      ]
    }
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard })
  }

  if (data === 'fb_proyectos') {
    const projects = await getProjects('activo')
    if (!projects.length) return bot.sendMessage(chatId, 'No hay proyectos activos.')
    let text = '📁 *Proyectos activos*\n\n'
    projects.forEach((p, i) => {
      const bar = '█'.repeat(Math.round(p.progress/10)) + '░'.repeat(10-Math.round(p.progress/10))
      text += `*${i+1}. ${p.client_name}*\n`
      if (p.description) text += `   ${p.description}\n`
      text += `   ${bar} ${p.progress}%\n`
      if (p.budget) text += `   💰 $${Number(p.budget).toLocaleString()}\n`
      if (p.deadline) text += `   📅 Entrega: ${p.deadline}\n`
      text += '\n'
    })
    const keyboard = {
      inline_keyboard: [
        [{ text: '📊 Actualizar avance', callback_data: 'fb_update_progress' }],
        [{ text: '✏️ Editar proyecto', callback_data: 'fb_editar_proyecto' }],
        [{ text: '🗑️ Eliminar proyecto', callback_data: 'fb_eliminar_proyecto' }],
      ]
    }
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard })
  }

  if (data === 'fb_nuevo_proyecto') {
    session.state = 'awaiting_project_name'
    session.pendingProject = {}
    return bot.sendMessage(chatId, '➕ ¿Cómo se llama el cliente?')
  }

  // Cambiar estado de prospecto
  if (data === 'fb_cambiar_estado') {
    const prospects = await getProspects()
    if (!prospects.length) return bot.sendMessage(chatId, 'No hay prospectos.')
    const keyboard = {
      inline_keyboard: [
        ...prospects.slice(0,8).map(p => ([{
          text: `${p.name || p.business || 'Sin nombre'} — ${STATUS_LABELS[p.status]}`,
          callback_data: `fb_sel_prospect_${p.id}`
        }])),
        [{ text: '❌ Cancelar', callback_data: 'cancel' }]
      ]
    }
    return bot.sendMessage(chatId, '¿A qué prospecto le cambias el estado?', { reply_markup: keyboard })
  }

  if (data.startsWith('fb_sel_prospect_')) {
    const id = data.replace('fb_sel_prospect_', '')
    session.pendingProspect = { id }
    const keyboard = {
      inline_keyboard: [
        [{ text: '⏳ Pendiente', callback_data: `fb_setstatus_${id}_pendiente` }],
        [{ text: '✅ Interesado', callback_data: `fb_setstatus_${id}_interesado` }],
        [{ text: '🤝 En negociación', callback_data: `fb_setstatus_${id}_negociacion` }],
        [{ text: '🎉 Cerrado', callback_data: `fb_setstatus_${id}_cerrado` }],
        [{ text: '❌ No interesado', callback_data: `fb_setstatus_${id}_no_interesado` }],
      ]
    }
    return bot.sendMessage(chatId, '¿Cuál es el nuevo estado?', { reply_markup: keyboard })
  }

  if (data.startsWith('fb_setstatus_')) {
    const parts = data.split('_')
    const newStatus = parts[parts.length - 1]
    const id = parts.slice(2, parts.length - 1).join('_')
    await updateProspect(id, { status: newStatus })

    if (newStatus === 'cerrado') {
      session.pendingConvert = { prospectId: id }
      const keyboard = {
        inline_keyboard: [
          [{ text: '✅ Sí, convertir a proyecto', callback_data: `fb_convert_${id}` }],
          [{ text: '❌ No por ahora', callback_data: 'cancel' }],
        ]
      }
      return bot.sendMessage(chatId,
        `🎉 ¡Marcado como cerrado!\n\n¿Quieres convertir este prospecto en un proyecto activo?`,
        { reply_markup: keyboard }
      )
    }
    return bot.sendMessage(chatId, `✅ Estado actualizado: ${STATUS_LABELS[newStatus]}`)
  }

  // Convertir prospecto a proyecto
  if (data.startsWith('fb_convert_')) {
    const prospectId = data.replace('fb_convert_', '')
    const { data: prospect } = await supabase.from('prospects').select('*').eq('id', prospectId).single()
    session.pendingProject = {
      client_name: prospect?.business || prospect?.name || 'Nuevo cliente',
      notes: prospect?.notes,
    }
    session.state = 'awaiting_project_budget'
    return bot.sendMessage(chatId,
      `📁 Convirtiendo *${session.pendingProject.client_name}* a proyecto\n\n¿Cuál es el presupuesto en pesos? (o "skip")`,
      { parse_mode: 'Markdown' }
    )
  }

  // Eliminar prospecto
  if (data === 'fb_eliminar_prospecto') {
    const prospects = await getProspects()
    const keyboard = {
      inline_keyboard: [
        ...prospects.slice(0,8).map(p => ([{
          text: `🗑️ ${p.name || p.business || 'Sin nombre'}`,
          callback_data: `fb_del_prospect_${p.id}`
        }])),
        [{ text: '❌ Cancelar', callback_data: 'cancel' }]
      ]
    }
    return bot.sendMessage(chatId, '¿Cuál prospecto eliminas?', { reply_markup: keyboard })
  }

  if (data.startsWith('fb_del_prospect_')) {
    const id = data.replace('fb_del_prospect_', '')
    await supabase.from('prospects').delete().eq('id', id)
    return bot.sendMessage(chatId, '✅ Prospecto eliminado.')
  }

  // Actualizar avance de proyecto
  if (data === 'fb_update_progress') {
    const projects = await getProjects('activo')
    if (!projects.length) return bot.sendMessage(chatId, 'No hay proyectos activos.')
    const keyboard = {
      inline_keyboard: projects.slice(0,8).map(p => ([{
        text: `${p.client_name} (${p.progress}%)`,
        callback_data: `fb_proy_sel_${p.id}`
      }]))
    }
    return bot.sendMessage(chatId, '¿Qué proyecto actualizas?', { reply_markup: keyboard })
  }

  if (data.startsWith('fb_proy_sel_')) {
    const id = data.replace('fb_proy_sel_', '')
    const keyboard = {
      inline_keyboard: [
        [10,25,50].map(n => ({ text: `${n}%`, callback_data: `fb_prog_${id}_${n}` })),
        [75,90,100].map(n => ({ text: `${n}%`, callback_data: `fb_prog_${id}_${n}` })),
      ]
    }
    return bot.sendMessage(chatId, '¿Cuánto va de avance?', { reply_markup: keyboard })
  }

  if (data.startsWith('fb_prog_')) {
    const parts = data.split('_')
    const id = parts[2]
    const progress = parseInt(parts[3])
    const status = progress === 100 ? 'terminado' : 'activo'
    await updateProject(id, { progress, status })
    return bot.sendMessage(chatId,
      progress === 100 ? '🎉 ¡Proyecto terminado al 100%!' : `✅ Avance actualizado a *${progress}%*`,
      { parse_mode: 'Markdown' }
    )
  }

  // Editar proyecto
  if (data === 'fb_editar_proyecto') {
    const projects = await getProjects('activo')
    const keyboard = {
      inline_keyboard: [
        ...projects.slice(0,8).map(p => ([{
          text: `✏️ ${p.client_name}`,
          callback_data: `fb_edit_proy_${p.id}`
        }])),
        [{ text: '❌ Cancelar', callback_data: 'cancel' }]
      ]
    }
    return bot.sendMessage(chatId, '¿Cuál proyecto editas?', { reply_markup: keyboard })
  }

  if (data.startsWith('fb_edit_proy_')) {
    const id = data.replace('fb_edit_proy_', '')
    const { data: p } = await supabase.from('projects').select('*').eq('id', id).single()
    session.pendingProject = { id, client_name: p.client_name }
    session.state = 'awaiting_project_budget'
    return bot.sendMessage(chatId,
      `✏️ Editando *${p.client_name}*\n\nNuevo presupuesto en pesos (actual: $${p.budget || 0}) o "skip"`,
      { parse_mode: 'Markdown' }
    )
  }

  // Eliminar proyecto
  if (data === 'fb_eliminar_proyecto') {
    const projects = await getProjects('activo')
    const keyboard = {
      inline_keyboard: [
        ...projects.slice(0,8).map(p => ([{
          text: `🗑️ ${p.client_name}`,
          callback_data: `fb_del_proy_${p.id}`
        }])),
        [{ text: '❌ Cancelar', callback_data: 'cancel' }]
      ]
    }
    return bot.sendMessage(chatId, '¿Cuál proyecto eliminas?', { reply_markup: keyboard })
  }

  if (data.startsWith('fb_del_proy_')) {
    const id = data.replace('fb_del_proy_', '')
    await supabase.from('projects').delete().eq('id', id)
    return bot.sendMessage(chatId, '✅ Proyecto eliminado.')
  }

  // Status legacy
  if (data.startsWith('fb_status_')) {
    const parts = data.split('_')
    const newStatus = parts[parts.length - 1]
    const id = parts.slice(2, parts.length - 1).join('_')
    await updateProspect(id, { status: newStatus })
    return bot.sendMessage(chatId, `✅ Estado actualizado: ${STATUS_LABELS[newStatus]}`)
  }
}

export async function handleProspectAudio(bot, msg, session, fileUrl) {
  const chatId = msg.chat.id
  await bot.sendMessage(chatId, '🎙️ Transcribiendo audio...')
  try {
    const transcript = await transcribeAudio(fileUrl, process.env.TELEGRAM_TOKEN)
    await bot.sendMessage(chatId, `📝 *Transcripción:*\n_${transcript}_`, { parse_mode: 'Markdown' })
    await bot.sendMessage(chatId, '🤖 Extrayendo datos...')
    const data = await extractProspectData(transcript)
    const prospect = await addProspect({ ...data, transcript, audio_url: fileUrl, status: 'pendiente' })

    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Interesado', callback_data: `fb_status_${prospect.id}_interesado` },
          { text: '⏳ Pendiente', callback_data: `fb_status_${prospect.id}_pendiente` },
        ],
        [{ text: '🤝 En negociación', callback_data: `fb_status_${prospect.id}_negociacion` }],
        [{ text: '❌ No interesado', callback_data: `fb_status_${prospect.id}_no_interesado` }],
      ]
    }

    session.state = null
    return bot.sendMessage(chatId,
      `✅ *Prospecto guardado*\n\n👤 ${data.name || '—'}\n🏢 ${data.business || '—'}\n📱 ${data.platform || '—'}\n🏭 ${data.industry || '—'}\n\n¿Estado inicial?`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    )
  } catch (err) {
    session.state = null
    return bot.sendMessage(chatId, `Error al procesar el audio: ${err.message}`)
  }
}

export async function handleProspectText(bot, msg, session) {
  const chatId = msg.chat.id
  try {
    const data = await extractProspectData(msg.text.trim())
    const prospect = await addProspect({ ...data, notes: msg.text.trim(), status: 'pendiente' })
    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Interesado', callback_data: `fb_status_${prospect.id}_interesado` },
          { text: '⏳ Pendiente', callback_data: `fb_status_${prospect.id}_pendiente` },
        ],
        [{ text: '🤝 En negociación', callback_data: `fb_status_${prospect.id}_negociacion` }],
        [{ text: '❌ No interesado', callback_data: `fb_status_${prospect.id}_no_interesado` }],
      ]
    }
    session.state = null
    return bot.sendMessage(chatId,
      `✅ *Prospecto guardado*\n👤 ${data.name || '—'} · 🏢 ${data.business || '—'}\n\n¿Estado?`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    )
  } catch (err) {
    session.state = null
    return bot.sendMessage(chatId, `Error: ${err.message}`)
  }
}

export async function handleProjectText(bot, msg, session) {
  const chatId = msg.chat.id

  if (session.state === 'awaiting_project_name') {
    session.pendingProject = { ...session.pendingProject, client_name: msg.text.trim() }
    session.state = 'awaiting_project_desc'
    return bot.sendMessage(chatId, '¿Descripción del proyecto? (o "skip")')
  }

  if (session.state === 'awaiting_project_desc') {
    const desc = msg.text.trim().toLowerCase() === 'skip' ? null : msg.text.trim()
    session.pendingProject.description = desc
    session.state = 'awaiting_project_budget'
    return bot.sendMessage(chatId, '¿Presupuesto en pesos? (o "skip")')
  }

  if (session.state === 'awaiting_project_budget') {
    const raw = msg.text.trim()
    const budget = raw.toLowerCase() === 'skip' ? null : parseFloat(raw.replace(/[,$]/g, ''))
    session.pendingProject.budget = budget
    session.state = 'awaiting_project_deadline'
    return bot.sendMessage(chatId,
      '¿Fecha de entrega?\nEj: `20 junio`, `15 agosto 2025`, `2025-12-31` o "skip"',
      { parse_mode: 'Markdown' }
    )
  }

  if (session.state === 'awaiting_project_deadline') {
    const raw = msg.text.trim()
    let deadline = null
    if (raw.toLowerCase() !== 'skip') {
      const meses = { enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,octubre:10,noviembre:11,diciembre:12 }
      const match = raw.match(/(\d{1,2})\s+(?:de\s+)?(\w+)(?:\s+(\d{4}))?/i)
      if (match && meses[match[2].toLowerCase()]) {
        const dia = match[1].padStart(2,'0')
        const mes = String(meses[match[2].toLowerCase()]).padStart(2,'0')
        const anio = match[3] || new Date().getFullYear()
        deadline = `${anio}-${mes}-${dia}`
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        deadline = raw
      } else {
        return bot.sendMessage(chatId, '⚠️ No entendí la fecha. Intenta: `20 junio` o `2025-12-31` o "skip"', { parse_mode: 'Markdown' })
      }
    }

    const isEdit = !!session.pendingProject?.id
    let project
    if (isEdit) {
      project = await updateProject(session.pendingProject.id, {
        budget: session.pendingProject.budget,
        deadline,
      })
    } else {
      project = await addProject({ ...session.pendingProject, deadline })
    }

    session.state = null
    session.pendingProject = null
    return bot.sendMessage(chatId,
      `✅ *${project.client_name}* ${isEdit ? 'actualizado' : 'agregado como proyecto'}\n📊 Avance: ${project.progress || 0}%${project.budget ? `\n💰 $${Number(project.budget).toLocaleString()}` : ''}${deadline ? `\n📅 Entrega: ${deadline}` : ''}`,
      { parse_mode: 'Markdown' }
    )
  }
}
