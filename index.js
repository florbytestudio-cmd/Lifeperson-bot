import 'dotenv/config'
import express from 'express'
import TelegramBot from 'node-telegram-bot-api'
import { handleBanco, handleBancoCallback, handleTicketPhoto, handleTransactionText } from './banco.js'
import { handleFlorbyte, handleFlorbyteCallback, handleProspectAudio, handleProspectText, handleProjectText } from './florbyte.js'
import { handleMemberships, handleMembershipsCallback, handleMembershipText } from './memberships.js'
import { handleTareas, handleTareasCallback, handleTaskText } from './tareas.js'
import { handleNotas, handleNotasCallback, handleNoteText, handleNoteAudio, handleNoteSearch } from './notas.js'
import { addCategory, getCategories, addCard, getCards, supabase, getDashboardStats } from './db.js'
import { startScheduler } from './scheduler.js'
import { transcribeAudio, extractTransactions } from './ai.js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000

// ── Express ──────────────────────────────────────────────────────────────────
const app = express()
app.use(express.json())
app.use(express.static(__dirname))

app.get('/dashboard', (req, res) => res.sendFile(join(__dirname, 'dashboard.html')))
app.get('/', (req, res) => res.redirect('/dashboard'))

app.get('/api/dashboard', async (req, res) => {
  try { res.json(await getDashboardStats()) }
  catch(e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/cards', async (req, res) => {
  try {
    const { data } = await supabase.from('cards').select('*').eq('active', true).order('bank')
    res.json(data || [])
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/transactions', async (req, res) => {
  try {
    const start = new Date(); start.setDate(1); start.setHours(0,0,0,0)
    const { data } = await supabase.from('transactions').select('*, cards(bank,label)').gte('created_at', start.toISOString()).order('created_at', { ascending: false })
    res.json(data || [])
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/transactions', async (req, res) => {
  try {
    const { data, error } = await supabase.from('transactions').insert([req.body]).select('*, cards(bank,label)').single()
    if (error) throw new Error(error.message)
    res.json(data)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/transactions/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('transactions').update(req.body).eq('id', req.params.id).select('*, cards(bank,label)').single()
    if (error) throw new Error(error.message)
    res.json(data)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    await supabase.from('transactions').delete().eq('id', req.params.id)
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/prospects', async (req, res) => {
  try {
    const { data } = await supabase.from('prospects').select('*').order('created_at', { ascending: false })
    res.json(data || [])
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/prospects', async (req, res) => {
  try {
    const { data, error } = await supabase.from('prospects').insert([req.body]).select().single()
    if (error) throw new Error(error.message)
    res.json(data)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/prospects/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('prospects').update(req.body).eq('id', req.params.id).select().single()
    if (error) throw new Error(error.message)
    res.json(data)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/prospects/:id', async (req, res) => {
  try {
    await supabase.from('prospects').delete().eq('id', req.params.id)
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/projects', async (req, res) => {
  try {
    const { data } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
    res.json(data || [])
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/projects', async (req, res) => {
  try {
    const { data, error } = await supabase.from('projects').insert([req.body]).select().single()
    if (error) throw new Error(error.message)
    res.json(data)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/projects/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('projects').update(req.body).eq('id', req.params.id).select().single()
    if (error) throw new Error(error.message)
    res.json(data)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/projects/:id', async (req, res) => {
  try {
    await supabase.from('projects').delete().eq('id', req.params.id)
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.listen(PORT, () => console.log(`🌐 Dashboard en puerto ${PORT}`))

// ── Telegram Bot ─────────────────────────────────────────────────────────────
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
      [{ text: '📝 Notas', callback_data: 'cat_notas' }],
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

bot.onText(/\/reporte/, async (msg) => {
  if (!isAllowed(msg)) return
  const chatId = msg.chat.id
  await bot.sendMessage(chatId, '📊 Generando reporte...')
  try {
    const d = await getDashboardStats()
    const hoy = new Date().toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long' })
    let text = `📊 *Reporte diario — ${hoy}*\n\n`
    text += `🏦 *BANCO*\n💸 Gastos: $${Number(d.banco.totalGastos).toFixed(2)}\n💰 Ingresos: $${Number(d.banco.totalIngresos).toFixed(2)}\n`
    Object.entries(d.banco.porTarjeta).forEach(([k,v]) => { text += `  • ${k}: $${Number(v.gastos).toFixed(2)}\n` })
    text += `\n💼 *FLORBYTE*\n👥 Prospectos: ${d.florbyte.total} · ✅ Interesados: ${d.florbyte.interesados} · 🎉 Cerrados: ${d.florbyte.cerrados}\n`
    text += `📁 Proyectos activos: ${d.proyectos.total}\n`
    if (d.proyectos.lista.length) {
      d.proyectos.lista.forEach(p => {
        const bar = '█'.repeat(Math.round(p.progress/10)) + '░'.repeat(10-Math.round(p.progress/10))
        text += `  • ${p.client_name}: ${bar} ${p.progress}%\n`
      })
    }
    text += `\n📦 *MEMBRESÍAS* — $${Number(d.membresias.costoMensual).toFixed(2)}/mes\n`
    if (d.membresias.proximas.length) {
      d.membresias.proximas.forEach(m => { text += `  🔔 ${m.name} — $${m.amount} (en ${m.daysLeft}d)\n` })
    }
    text += `\n✅ *TAREAS* — 🔴 ${d.tareas.alta} · 🟡 ${d.tareas.media} · 🟢 ${d.tareas.baja}\n`
    if (d.tareas.alta > 0) {
      d.tareas.lista.filter(t => t.priority === 'alta').slice(0,3).forEach(t => { text += `  • ${t.title}\n` })
    }
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
  } catch (err) {
    await bot.sendMessage(chatId, `Error: ${err.message}`)
  }
})

bot.on('message', async (msg) => {
  if (!isAllowed(msg)) return
  if (!msg.text || msg.text.startsWith('/')) return
  const chatId = msg.chat.id
  const session = getSession(chatId)
  try {
    if (session.state === 'awaiting_transaction_amount') return handleTransactionText(bot, msg, session)
    if (session.state === 'awaiting_prospect_text') return handleProspectText(bot, msg, session)
    if (session.state === 'awaiting_membership' || session.state === 'awaiting_membership_edit') return handleMembershipText(bot, msg, session)
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

bot.on('voice', async (msg) => {
  if (!isAllowed(msg)) return
  const chatId = msg.chat.id
  const session = getSession(chatId)
  try {
    const file = await bot.getFile(msg.voice.file_id)
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`
    if (session.state === 'awaiting_prospect_audio') return handleProspectAudio(bot, msg, session, fileUrl)
    if (session.state === 'awaiting_note_audio') return handleNoteAudio(bot, msg, session, fileUrl)
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
    if (data === 'audio_banco') {
      const { fileUrl } = session.pendingAudio || {}
      session.pendingAudio = null
      if (!fileUrl) return bot.sendMessage(chatId, 'No encontré el audio.')
      await bot.sendMessage(chatId, '🎙️ Transcribiendo...')
      const transcript = await transcribeAudio(fileUrl)
      await bot.sendMessage(chatId, `📝 _"${transcript}"_\n\n🤖 Extrayendo transacciones...`, { parse_mode: 'Markdown' })

      const transactions = await extractTransactions(transcript)
      const cards = await getCards()

      if (!transactions.length) {
        return bot.sendMessage(chatId, `No detecté transacciones claras.\nEscríbelo manual: \`250 gasolina\``, { parse_mode: 'Markdown' })
      }

      if (transactions.length === 1) {
        // Una sola transacción — pedir tarjeta
        session.pendingTransaction = transactions[0]
        const keyboard = {
          inline_keyboard: [
            ...cards.map(c => [{ text: c.bank, callback_data: `ticket_card_${c.id}` }]),
            [{ text: '❌ Cancelar', callback_data: 'cancel' }]
          ]
        }
        const icon = transactions[0].type === 'ingreso' ? '💰' : '💸'
        return bot.sendMessage(chatId,
          `${icon} *$${transactions[0].amount}* — ${transactions[0].description}\n\n¿A qué tarjeta?`,
          { parse_mode: 'Markdown', reply_markup: keyboard }
        )
      }

      // Múltiples transacciones — mostrar resumen y pedir tarjeta
      let summary = `✅ Detecté *${transactions.length} transacciones*:\n\n`
      transactions.forEach((t, i) => {
        const icon = t.type === 'ingreso' ? '💰' : '💸'
        summary += `${icon} *$${t.amount}* — ${t.description}\n`
      })
      session.pendingMultiTransactions = transactions
      const keyboard = {
        inline_keyboard: [
          ...cards.map(c => [{ text: `Cargar todo a ${c.bank}`, callback_data: `multi_card_${c.id}` }]),
          [{ text: '❌ Cancelar', callback_data: 'cancel' }]
        ]
      }
      return bot.sendMessage(chatId, summary + '\n¿A qué tarjeta las cargo todas?', { parse_mode: 'Markdown', reply_markup: keyboard })
    }
    if (data === 'audio_prospecto') {
      const { fileUrl } = session.pendingAudio || {}
      session.pendingAudio = null
      if (!fileUrl) return bot.sendMessage(chatId, 'No encontré el audio.')
      session.state = 'awaiting_prospect_audio'
      return handleProspectAudio(bot, { chat: { id: chatId }, from: query.from }, session, fileUrl)
    }
    if (data === 'audio_nota') {
      const { fileUrl } = session.pendingAudio || {}
      session.pendingAudio = null
      if (!fileUrl) return bot.sendMessage(chatId, 'No encontré el audio.')
      session.state = 'awaiting_note_audio'
      return handleNoteAudio(bot, { chat: { id: chatId }, from: query.from }, session, fileUrl)
    }
    if (data === 'banco_editar') {
      const { data: txns } = await supabase.from('transactions').select('*, cards(bank)').order('created_at', { ascending: false }).limit(8)
      if (!txns?.length) return bot.sendMessage(chatId, 'No hay transacciones.')
      const keyboard = {
        inline_keyboard: [
          ...txns.map(t => ([{ text: `${t.type==='gasto'?'💸':'💰'} $${t.amount} ${(t.description||'').slice(0,20)} (${t.cards?.bank||'—'})`, callback_data: `txn_del_${t.id}` }])),
          [{ text: '❌ Cancelar', callback_data: 'cancel' }]
        ]
      }
      return bot.sendMessage(chatId, '¿Cuál registro eliminas?', { reply_markup: keyboard })
    }
    if (data.startsWith('txn_del_')) {
      await supabase.from('transactions').delete().eq('id', data.replace('txn_del_', ''))
      return bot.sendMessage(chatId, '✅ Registro eliminado.')
    }
    if (data.startsWith('multi_card_')) {
      const cardId = data.replace('multi_card_', '')
      const txns = session.pendingMultiTransactions || []
      session.pendingMultiTransactions = null
      if (!txns.length) return bot.sendMessage(chatId, 'No hay transacciones pendientes.')
      let saved = 0
      for (const t of txns) {
        await supabase.from('transactions').insert([{ card_id: cardId, amount: t.amount, description: t.description, type: t.type }])
        saved++
      }
      const cards = await getCards()
      const card = cards.find(c => c.id === cardId)
      return bot.sendMessage(chatId,
        `✅ *${saved} transacciones* registradas en *${card?.bank}*`,
        { parse_mode: 'Markdown' }
      )
    }
    if (data === 'banco_edit_cards') {
      const cards = await getCards()
      const keyboard = {
        inline_keyboard: [
          ...cards.map(c => ([{ text: `✏️ ${c.bank}`, callback_data: `card_rename_${c.id}` }])),
          [{ text: '➕ Nueva tarjeta', callback_data: 'banco_add_card' }],
          [{ text: '❌ Cancelar', callback_data: 'cancel' }]
        ]
      }
      return bot.sendMessage(chatId, '¿Qué tarjeta editas?', { reply_markup: keyboard })
    }
    if (data.startsWith('card_rename_')) {
      session.state = 'awaiting_card_rename'
      session.pendingCard = { cardId: data.replace('card_rename_', '') }
      return bot.sendMessage(chatId, '¿Cuál es el nuevo nombre?')
    }
    if (data === 'cat_banco') return handleBanco(bot, query.message, session)
    if (data === 'cat_florbyte') return handleFlorbyte(bot, query.message, session)
    if (data === 'cat_membresias') return handleMemberships(bot, query.message, session)
    if (data === 'cat_tareas') return handleTareas(bot, query.message, session)
    if (data === 'cat_notas') return handleNotas(bot, query.message, session)
    if (data === 'cat_nueva') {
      session.state = 'awaiting_category_name'
      return bot.sendMessage(chatId, '➕ ¿Nombre de la nueva categoría? Ej: `🏥 Salud`', { parse_mode: 'Markdown' })
    }
    if (data.startsWith('banco_') || data.startsWith('ticket_')) return handleBancoCallback(bot, query, session)
    if (data.startsWith('fb_')) return handleFlorbyteCallback(bot, query, session)
    if (data.startsWith('mem_')) return handleMembershipsCallback(bot, query, session)
    if (data.startsWith('tarea_')) return handleTareasCallback(bot, query, session)
    if (data.startsWith('nota_')) return handleNotasCallback(bot, query, session)
  } catch (err) {
    console.error('[bot] Error callback:', err.message)
    await bot.sendMessage(chatId, `Error: ${err.message}`)
  }
})

console.log('🤖 MyBot arriba y escuchando...')
