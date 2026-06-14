import { addNote, searchNotes, getRecentNotes } from './db.js'
import { transcribeAudio, summarizeSearchResults } from './ai.js'

export async function handleNotas(bot, msg, session) {
  const chatId = msg.chat.id
  const keyboard = {
    inline_keyboard: [
      [{ text: '✏️ Nueva nota (texto)', callback_data: 'nota_texto' }],
      [{ text: '🎙️ Nueva nota (audio)', callback_data: 'nota_audio' }],
      [{ text: '🔍 Buscar notas', callback_data: 'nota_buscar' }],
      [{ text: '📋 Notas recientes', callback_data: 'nota_recientes' }],
    ]
  }
  await bot.sendMessage(chatId, '📝 *Notas*', { parse_mode: 'Markdown', reply_markup: keyboard })
}

export async function handleNotasCallback(bot, query, session) {
  const chatId = query.message.chat.id
  await bot.answerCallbackQuery(query.id)

  if (query.data === 'nota_texto') {
    session.state = 'awaiting_note_text'
    return bot.sendMessage(chatId, '✏️ Escribe tu nota:')
  }

  if (query.data === 'nota_audio') {
    session.state = 'awaiting_note_audio'
    return bot.sendMessage(chatId, '🎙️ Manda el audio de tu nota:')
  }

  if (query.data === 'nota_buscar') {
    session.state = 'awaiting_note_search'
    return bot.sendMessage(chatId, '🔍 ¿Qué quieres buscar en tus notas?')
  }

  if (query.data === 'nota_recientes') {
    const notes = await getRecentNotes(5)
    if (!notes.length) return bot.sendMessage(chatId, 'No hay notas todavía.')
    let text = '📋 *Notas recientes*\n\n'
    notes.forEach((n, i) => {
      const date = new Date(n.created_at).toLocaleDateString('es-MX')
      const preview = n.content.length > 100 ? n.content.slice(0, 100) + '...' : n.content
      text += `*${i + 1}.* [${date}]\n${preview}\n\n`
    })
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
  }
}

export async function handleNoteText(bot, msg, session) {
  const chatId = msg.chat.id
  const content = msg.text.trim()
  await addNote(content)
  session.state = null
  return bot.sendMessage(chatId, '📝 Nota guardada ✅')
}

export async function handleNoteAudio(bot, msg, session, fileUrl) {
  const chatId = msg.chat.id
  await bot.sendMessage(chatId, '🎙️ Transcribiendo...')
  try {
    const transcript = await transcribeAudio(fileUrl, process.env.TELEGRAM_TOKEN)
    await addNote(transcript, [], fileUrl, transcript)
    session.state = null
    return bot.sendMessage(chatId, `📝 *Nota guardada:*\n_${transcript}_`, { parse_mode: 'Markdown' })
  } catch (err) {
    session.state = null
    return bot.sendMessage(chatId, `Error al transcribir: ${err.message}`)
  }
}

export async function handleNoteSearch(bot, msg, session) {
  const chatId = msg.chat.id
  const query = msg.text.trim()
  await bot.sendMessage(chatId, '🔍 Buscando...')
  const notes = await searchNotes(query)
  const summary = await summarizeSearchResults(query, notes)
  session.state = null

  let text = `🔍 *"${query}"*\n\n${summary}`
  if (notes.length) {
    text += '\n\n*Notas encontradas:*\n'
    notes.slice(0, 4).forEach((n, i) => {
      const date = new Date(n.created_at).toLocaleDateString('es-MX')
      text += `${i + 1}. [${date}] ${n.content.slice(0, 80)}...\n`
    })
  }
  return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
}
