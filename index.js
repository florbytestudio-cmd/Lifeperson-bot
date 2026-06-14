import 'dotenv/config'
import TelegramBot from 'node-telegram-bot-api'
import { handleBanco, handleBancoCallback, handleTicketPhoto, handleTransactionText } from './banco.js'
import { handleFlorbyte, handleFlorbyteCallback, handleProspectAudio, handleProspectText } from './florbyte.js'
import { handleMemberships, handleMembershipsCallback, handleMembershipText } from './memberships.js'
import { handleTareas, handleTareasCallback, handleTaskText } from './tareas.js'
import { handleProyectos, handleProyectosCallback, handleProjectText } from './proyectos.js'
import { handleNotas, handleNotasCallback, handleNoteText, handleNoteAudio, handleNoteSearch } from './notas.js'
import { handleProspectAudio as handleProspectAudioDirect } from './florbyte.js'
import { addCategory, getCategories, addCard, getCards, supabase } from './db.js'
import { startScheduler } from './scheduler.js'
import { transcribeAudio } from './ai.js'

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true })
const ALLOWED_USER = process.env.TELEGRAM_USER_ID
const sessions = {}
function getSession(chatId) {
  if (!sessions[chatId]) sessions[chatId] = {}
  return sessions[chatId]
}

async function sendMainMenu(chatId) {
  const categories = await getCategories()
  const customCats = categories.filter(c => !c.is_default)
  const keyboard = {
    inline_keyboard: [
      [{ text: '🏦 Banco', callback_data: 'cat_banco' }, { text: '💼 FlorByte', callback_data: 'cat_florbyte' }],
      [{ text: '📦 Membresías', callback_data: 'cat_membresias' }, { text: '✅ Tareas', callback_data: 'cat_tareas' }],
      [{ text: '📁 Proyectos', callback_data: 'cat_proyectos' }, { text: '📝 Notas', callback_data: 'cat_notas' }],
      ...customCats.map(c => ([{ text: `${c.icon} ${c.name}`, callback_data: `cat_custom_${c.id}` }])),
      [{ text: '➕ Nueva categoría', callback_data: 'cat_nueva' }],
    ]
  }
  await bot.sendMessage(chatId, '👋 *¿Qué necesitas?*', { parse_mode: 'Markdown', reply_markup: keyboard })
}

function isAllowed(msg) {
  if (!ALLOWED_USER) return true
  return String(msg.from?.id) === String(ALLOWED_USER)
}

bot.onText(/\/start/, async (msg) => {
  if (!isAllowed(msg)) return
  startScheduler(bot, msg.chat.id)
  await bot.sendMessage(msg.chat.id, '¡Hola! Soy tu asistente personal de FlorByte 🚀')
  await sendMainMenu(msg.chat.id)
})

bot.onText(/\/menu/, async (msg) => {
  if (!isAllowed(msg)) return
  await sendMainMenu(msg.chat.id)
})

bot.on('message', async (msg) => {
  if (!isAllowed(msg)) return
  if (!msg.text || msg.text.startsWith('/')) return
  const chatId = msg.chat.id
  const session = getSession(chatId)
  try {
    if (session.state === 'awaiting_transaction_amount') return handleTransactionText(bot, msg, session)
    if (session.state === 'awaiting_prospect_text') return handleProspectText(bot, msg, session)
    if (session.state === 'awaiting_membership') return handleMembershipText(bot, msg, session)
    if (session.state === 'awaiting_task_title') return handleTaskText(bot, msg, session)
    if (['awaiting_project_name','awaiting_project_desc','awaiting_project_budget','awaiting_project_deadline'].includes(session.state))
      return handleProjectText(bot, msg, session)
    if (session.state === 'awaiting_note_text') return handleNoteText(bot, msg, session)
    if (session.state === 'awaiting_note_search') return handleNoteSearch(bot, msg, session)
    if (session.state === 'awaiting_new_card') {
      const parts = msg.text.trim().split(' ')
      await addCard(parts[0], parts[0], parts[1] || 'credito')
      session.state = null
      return bot.sendMessage(chatId, `✅ Tarjeta *${parts[0]}* agregada`, { parse_mode: 'Markdown' })
    }
    if (session.state === 'awaiting_card_rename') {
      const { cardId } = session.pendingCard || {}
      await supabase.from('cards').update({ label: msg.text.trim(), bank: msg.text.trim() }).eq('id', cardId)
      session.state = null; session.pendingCard = null
      return bot.sendMessage(chatId, `✅ Tarjeta renombrada a *${msg.text.trim()}*`, { parse_mode: 'Markdown' })
    }
    if (session.state === 'awaiting_category_name') {
      const parts = msg.text.trim().split(' ')
      const icon = parts[0].length <= 2 ? parts[0] : '📁'
      const name = parts[0].length <= 2 ? parts.slice(1).join(' ') : parts.join(' ')
      await addCategory(name, icon)
      session.state = null
      return bot.sendMessage(chatId, `✅ Categoría *${icon} ${name}* creada`, { parse_mode: 'Markdown' })
    }
    await sendMainMenu(chatId)
  } catch (err) {
    console.error('[bot] Error:', err.message)
    await bot.sendMessage(chatId, `Error: ${err.message}`)
  }
})

// ── Audios ───────────────────────────────────────────────────────────────────
bot.on('voice', async (msg) => {
  if (!isAllowed(msg)) return
  const chatId = msg.chat.id
  const session = getSession(chatId)
  try {
    const file = await bot.getFile(msg.voice.file_id)
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`

    if (session.state === 'awaiting_prospect_audio') return handleProspectAudio(bot, msg, session, fileUrl)
    if (session.state === 'awaiting_note_audio') return handleNoteAudio(bot, msg, session, fileUrl)

    // Audio sin contexto → preguntar qué es
    session.pendingAudio = { fileUrl }
    const keyboard = {
      inline_keyboard: [
        [{ text: '🏦 Gasto bancario', callback_data: 'audio_banco' }],
        [{ text: '💼 Prospecto FlorByte', callback_data: 'audio_prospecto' }],
        [{ text: '📝 Nota', callback_data: 'audio_nota' }],
      ]
    }
    return bot.sendMessage(chatId, '🎙️ ¿Qué es este audio?', { reply_markup: keyboard })
  } catch (err) {
    await bot.sendMessage(chatId, `Error con el audio: ${err.message}`)
  }
})

// ── Fotos ────────────────────────────────────────────────────────────────────
bot.on('photo', async (msg) => {
  if (!isAllowed(msg)) return
  const chatId = msg.chat.id
  const session = getSession(chatId)
  try {
    const photo = msg.photo[msg.photo.length - 1]
    const file = await bot.getFile(photo.file_id)
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`
    return handleTicketPhoto(bot, msg, session, fileUrl)
  } catch (err) {
    await bot.sendMessage(chatId, `Error con la foto: ${err.message}`)
  }
})

// ── Callbacks ────────────────────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  if (!isAllowed(query)) return
  const chatId = query.message.chat.id
  const session = getSession(chatId)
  const data = query.data
  try {
    await bot.answerCallbackQuery(query.id)

    if (data === 'cancel') {
      session.state = null; session.pendingAudio = null
      return bot.sendMessage(chatId, 'Cancelado.')
    }

    // ── Audio sin contexto ──────────────────────────────────────────────────
    if (data === 'audio_banco') {
      const { fileUrl } = session.pendingAudio || {}
      session.pendingAudio = null
      if (!fileUrl) return bot.sendMessage(chatId, 'No encontré el audio.')
      await bot.sendMessage(chatId, '🎙️ Transcribiendo...')
      const transcript = await transcribeAudio(fileUrl)

      // Parsear monto del texto
      const match = transcript.match(/(\d+(?:\.\d+)?)/);
      const amount = match ? parseFloat(match[1]) : null
      const cards = await getCards()

      if (amount) {
        session.pendingTransaction = { type: 'gasto', amount, description: transcript }
        const keyboard = {
          inline_keyboard: [
            ...cards.map(c => [{ text: c.bank, callback_data: `ticket_card_${c.id}` }]),
            [{ text: '❌ Cancelar', callback_data: 'cancel' }]
          ]
        }
        return bot.sendMessage(chatId,
          `📝 Entendí: *$${amount}*\n"${transcript}"\n\n¿A qué tarjeta lo cargo?`,
          { parse_mode: 'Markdown', reply_markup: keyboard }
        )
      } else {
        return bot.sendMessage(chatId, `No detecté un monto en el audio: "${transcript}"\n\nEscríbelo manualmente: ej. \`250 gasolina\``, { parse_mode: 'Markdown' })
      }
    }

    if (data === 'audio_prospecto') {
      const { fileUrl } = session.pendingAudio || {}
      session.pendingAudio = null
      if (!fileUrl) return bot.sendMessage(chatId, 'No encontré el audio.')
      const fakeMsg = { chat: { id: chatId }, from: query.from }
      session.state = 'awaiting_prospect_audio'
      return handleProspectAudio(bot, fakeMsg, session, fileUrl)
    }

    if (data === 'audio_nota') {
      const { fileUrl } = session.pendingAudio || {}
      session.pendingAudio = null
      if (!fileUrl) return bot.sendMessage(chatId, 'No encontré el audio.')
      const fakeMsg = { chat: { id: chatId }, from: query.from }
      session.state = 'awaiting_note_audio'
      return handleNoteAudio(bot, fakeMsg, session, fileUrl)
    }

    // ── Editar/borrar transacciones ─────────────────────────────────────────
    if (data === 'banco_editar') {
      const { data: txns } = await supabase.from('transactions')
        .select('*, cards(bank)').order('created_at', { ascending: false }).limit(8)
      if (!txns?.length) return bot.sendMessage(chatId, 'No hay transacciones.')
      const keyboard = {
        inline_keyboard: [
          ...txns.map(t => ([{
            text: `${t.type === 'gasto' ? '💸' : '💰'} $${t.amount} ${t.description?.slice(0,20) || ''} (${t.cards?.bank})`,
            callback_data: `txn_del_${t.id}`
          }])),
          [{ text: '❌ Cancelar', callback_data: 'cancel' }]
        ]
      }
      return bot.sendMessage(chatId, '¿Cuál registro quieres eliminar?', { reply_markup: keyboard })
    }

    if (data.startsWith('txn_del_')) {
      const id = data.replace('txn_del_', '')
      await supabase.from('transactions').delete().eq('id', id)
      return bot.sendMessage(chatId, '✅ Registro eliminado.')
    }

    // ── Editar tarjetas ─────────────────────────────────────────────────────
    if (data === 'banco_edit_cards') {
      const cards = await getCards()
      const keyboard = {
        inline_keyboard: [
          ...cards.map(c => ([{ text: `✏️ ${c.bank}`, callback_data: `card_rename_${c.id}` }])),
          [{ text: '➕ Nueva tarjeta', callback_data: 'banco_add_card' }],
          [{ text: '❌ Cancelar', callback_data: 'cancel' }]
        ]
      }
      return bot.sendMessage(chatId, '¿Qué tarjeta quieres editar?', { reply_markup: keyboard })
    }

    if (data.startsWith('card_rename_')) {
      const cardId = data.replace('card_rename_', '')
      session.state = 'awaiting_card_rename'
      session.pendingCard = { cardId }
      return bot.sendMessage(chatId, '¿Cuál es el nuevo nombre para esta tarjeta?')
    }

    // ── Categorías ──────────────────────────────────────────────────────────
    if (data === 'cat_banco') return handleBanco(bot, query.message, session)
    if (data === 'cat_florbyte') return handleFlorbyte(bot, query.message, session)
    if (data === 'cat_membresias') return handleMemberships(bot, query.message, session)
    if (data === 'cat_tareas') return handleTareas(bot, query.message, session)
    if (data === 'cat_proyectos') return handleProyectos(bot, query.message, session)
    if (data === 'cat_notas') return handleNotas(bot, query.message, session)

    if (data === 'cat_nueva') {
      session.state = 'awaiting_category_name'
      return bot.sendMessage(chatId, '➕ ¿Nombre de la nueva categoría? Ej: `🏥 Salud`', { parse_mode: 'Markdown' })
    }

    // ── Módulos ─────────────────────────────────────────────────────────────
    if (data.startsWith('banco_') || data.startsWith('ticket_')) return handleBancoCallback(bot, query, session)
    if (data.startsWith('fb_')) return handleFlorbyteCallback(bot, query, session)
    if (data.startsWith('mem_')) return handleMembershipsCallback(bot, query, session)
    if (data.startsWith('tarea_')) return handleTareasCallback(bot, query, session)
    if (data.startsWith('proy_')) return handleProyectosCallback(bot, query, session)
    if (data.startsWith('nota_')) return handleNotasCallback(bot, query, session)

  } catch (err) {
    console.error('[bot] Error callback:', err.message)
    await bot.sendMessage(chatId, `Error: ${err.message}`)
  }
})

console.log('🤖 MyBot arriba y escuchando...')
