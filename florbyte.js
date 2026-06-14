import { addProspect, updateProspect, getProspects } from '../db/index.js'
import { transcribeAudio, extractProspectData } from '../ai/index.js'

const STATUS_LABELS = {
  pendiente: '⏳ Pendiente',
  interesado: '✅ Interesado',
  no_interesado: '❌ No interesado',
  cerrado: '🎉 Cerrado',
}

export async function handleFlorbyte(bot, msg, session) {
  const chatId = msg.chat.id
  const keyboard = {
    inline_keyboard: [
      [{ text: '🎙️ Agregar prospecto por audio', callback_data: 'fb_audio' }],
      [{ text: '✏️ Agregar prospecto por texto', callback_data: 'fb_texto' }],
      [{ text: '📋 Ver prospectos', callback_data: 'fb_ver' }],
      [{ text: '🔥 Ver interesados', callback_data: 'fb_interesados' }],
    ]
  }
  await bot.sendMessage(chatId, '💼 *FlorByte Studio*\n¿Qué necesitas?', {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  })
}

export async function handleFlorbyteCallback(bot, query, session) {
  const chatId = query.message.chat.id
  const data = query.data
  await bot.answerCallbackQuery(query.id)

  if (data === 'fb_audio') {
    session.state = 'awaiting_prospect_audio'
    return bot.sendMessage(chatId, '🎙️ Mándame el audio del prospecto. Cuéntame lo que sepas: nombre, negocio, red social, y cualquier detalle.')
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
    prospects.slice(0, 10).forEach((p, i) => {
      text += `*${i + 1}. ${p.name || p.business || 'Sin nombre'}*\n`
      if (p.business) text += `   🏢 ${p.business}\n`
      if (p.platform) text += `   📱 ${p.platform}${p.profile_url ? ` — ${p.profile_url}` : ''}\n`
      text += `   ${STATUS_LABELS[p.status] || p.status}\n\n`
    })
    if (prospects.length > 10) text += `_...y ${prospects.length - 10} más_`

    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
  }

  if (data.startsWith('fb_status_')) {
    const [, , prospectId, newStatus] = data.split('_')
    await updateProspect(prospectId, { status: newStatus })
    return bot.sendMessage(chatId, `✅ Estado actualizado: ${STATUS_LABELS[newStatus]}`)
  }
}

export async function handleProspectAudio(bot, msg, session, fileUrl) {
  const chatId = msg.chat.id
  await bot.sendMessage(chatId, '🎙️ Transcribiendo audio...')

  try {
    const transcript = await transcribeAudio(fileUrl, process.env.TELEGRAM_TOKEN)
    await bot.sendMessage(chatId, `📝 *Transcripción:*\n_${transcript}_`, { parse_mode: 'Markdown' })
    await bot.sendMessage(chatId, '🤖 Extrayendo datos del prospecto...')

    const data = await extractProspectData(transcript)
    const prospect = await addProspect({ ...data, transcript, audio_url: fileUrl, status: 'pendiente' })

    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Interesado', callback_data: `fb_status_${prospect.id}_interesado` },
          { text: '⏳ Pendiente', callback_data: `fb_status_${prospect.id}_pendiente` },
        ],
        [{ text: '❌ No interesado', callback_data: `fb_status_${prospect.id}_no_interesado` }],
      ]
    }

    const text = `✅ *Prospecto guardado*\n\n` +
      `👤 *Nombre:* ${data.name || '—'}\n` +
      `🏢 *Negocio:* ${data.business || '—'}\n` +
      `📱 *Plataforma:* ${data.platform || '—'}\n` +
      `🏭 *Industria:* ${data.industry || '—'}\n` +
      `📋 *Notas:* ${data.notes || '—'}\n\n` +
      `¿Cuál es el estado?`

    session.state = null
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard })
  } catch (err) {
    session.state = null
    return bot.sendMessage(chatId, `No pude procesar el audio: ${err.message}`)
  }
}

export async function handleProspectText(bot, msg, session) {
  const chatId = msg.chat.id
  const text = msg.text.trim()

  try {
    const data = await extractProspectData(text)
    const prospect = await addProspect({ ...data, notes: text, status: 'pendiente' })

    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Interesado', callback_data: `fb_status_${prospect.id}_interesado` },
          { text: '⏳ Pendiente', callback_data: `fb_status_${prospect.id}_pendiente` },
        ],
        [{ text: '❌ No interesado', callback_data: `fb_status_${prospect.id}_no_interesado` }],
      ]
    }

    const reply = `✅ *Prospecto guardado*\n\n` +
      `👤 ${data.name || '—'} · 🏢 ${data.business || '—'}\n` +
      `📱 ${data.platform || '—'} · 🏭 ${data.industry || '—'}\n\n¿Estado?`

    session.state = null
    return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown', reply_markup: keyboard })
  } catch (err) {
    session.state = null
    return bot.sendMessage(chatId, `Error al guardar: ${err.message}`)
  }
}
