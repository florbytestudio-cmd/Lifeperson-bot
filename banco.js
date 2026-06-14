import { getCards, addTransaction, getMonthTransactions, addCard, supabase } from './db.js'
import { extractTicketData } from './ai.js'
import dayjs from 'dayjs'

export async function handleBanco(bot, msg, session) {
  const chatId = msg.chat.id
  const cards = await getCards()
  const keyboard = {
    inline_keyboard: [
      [{ text: '💸 Registrar gasto', callback_data: 'banco_gasto' }],
      [{ text: '💰 Registrar ingreso', callback_data: 'banco_ingreso' }],
      [{ text: '📊 Resumen del mes', callback_data: 'banco_resumen' }],
      [{ text: '✏️ Editar tarjetas', callback_data: 'banco_edit_cards' }],
      [{ text: '🗑️ Eliminar registro', callback_data: 'banco_editar' }],
    ]
  }
  await bot.sendMessage(chatId,
    `🏦 *Banco*\nTarjetas activas: ${cards.map(c => c.bank).join(', ')}`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  )
}

export async function handleBancoCallback(bot, query, session) {
  const chatId = query.message.chat.id
  const data = query.data

  if (data === 'banco_resumen') {
    const txns = await getMonthTransactions()
    if (!txns.length) return bot.sendMessage(chatId, '📊 Sin transacciones este mes.')

    const byCard = {}
    txns.forEach(t => {
      const key = t.cards?.label || t.cards?.bank || 'Sin tarjeta'
      if (!byCard[key]) byCard[key] = { gastos: 0, ingresos: 0 }
      if (t.type === 'gasto') byCard[key].gastos += Number(t.amount)
      else byCard[key].ingresos += Number(t.amount)
    })

    let text = `📊 *Resumen ${dayjs().format('MMMM YYYY')}*\n\n`
    Object.entries(byCard).forEach(([card, totals]) => {
      text += `*${card}*\n`
      text += `  💸 Gastos: $${totals.gastos.toFixed(2)}\n`
      if (totals.ingresos > 0) text += `  💰 Ingresos: $${totals.ingresos.toFixed(2)}\n`
      text += '\n'
    })

    const recent = txns.slice(0, 5)
    text += `*Últimos 5 movimientos:*\n`
    recent.forEach(t => {
      const icon = t.type === 'gasto' ? '💸' : '💰'
      text += `${icon} $${Number(t.amount).toFixed(2)} — ${t.description || '—'} _(${t.cards?.bank || '—'})_\n`
    })
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
  }

  if (data === 'banco_gasto' || data === 'banco_ingreso') {
    const type = data === 'banco_gasto' ? 'gasto' : 'ingreso'
    session.pendingTransaction = { type }
    const cards = await getCards()
    const keyboard = {
      inline_keyboard: [
        ...cards.map(c => [{ text: c.bank, callback_data: `banco_card_${c.id}` }]),
        [{ text: '❌ Cancelar', callback_data: 'cancel' }]
      ]
    }
    return bot.sendMessage(chatId, '¿A qué tarjeta lo cargo?', { reply_markup: keyboard })
  }

  if (data.startsWith('banco_card_')) {
    const cardId = data.replace('banco_card_', '')
    session.pendingTransaction = { ...session.pendingTransaction, cardId }
    session.state = 'awaiting_transaction_amount'
    return bot.sendMessage(chatId, '¿De cuánto? Escribe el monto y descripción:\n`250 gasolina`', { parse_mode: 'Markdown' })
  }

  if (data === 'banco_add_card') {
    session.state = 'awaiting_new_card'
    return bot.sendMessage(chatId, 'Escribe el banco y tipo:\n`HSBC credito` o `Nu debito`', { parse_mode: 'Markdown' })
  }

  // Callback de ticket — selección de tarjeta
  if (data.startsWith('ticket_card_')) {
    const cardId = data.replace('ticket_card_', '')
    const { amount, description, ticketUrl, rawOcr } = session.pendingTransaction || {}
    await addTransaction(cardId, amount, description, 'gasto', ticketUrl, rawOcr)
    const cards = await getCards()
    const card = cards.find(c => c.id === cardId)
    session.pendingTransaction = null
    return bot.sendMessage(chatId,
      `✅ Registrado en *${card?.bank}*\n💸 $${Number(amount).toFixed(2)} — ${description}`,
      { parse_mode: 'Markdown' }
    )
  }
}

export async function handleTicketPhoto(bot, msg, session, fileUrl) {
  const chatId = msg.chat.id
  await bot.sendMessage(chatId, '🔍 Analizando el ticket...')
  try {
    const ticketData = await extractTicketData(fileUrl)
    session.pendingTransaction = {
      type: 'gasto',
      amount: ticketData.amount,
      description: ticketData.description,
      ticketUrl: fileUrl,
      rawOcr: JSON.stringify(ticketData),
    }

    if (ticketData.bank) {
      const cards = await getCards()
      const match = cards.find(c => c.bank.toLowerCase().includes(ticketData.bank.toLowerCase()))
      if (match) {
        await addTransaction(match.id, ticketData.amount, ticketData.description, 'gasto', fileUrl, JSON.stringify(ticketData))
        session.pendingTransaction = null
        return bot.sendMessage(chatId,
          `✅ Registrado en *${match.bank}*\n💸 $${ticketData.amount} — ${ticketData.description}`,
          { parse_mode: 'Markdown' }
        )
      }
    }

    const cards = await getCards()
    const keyboard = {
      inline_keyboard: [
        ...cards.map(c => [{ text: c.bank, callback_data: `ticket_card_${c.id}` }]),
        [{ text: '❌ Cancelar', callback_data: 'cancel' }]
      ]
    }
    return bot.sendMessage(chatId,
      `📄 Ticket: *$${ticketData.amount}* — ${ticketData.description}\n\n¿A qué tarjeta lo cargo?`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    )
  } catch (err) {
    return bot.sendMessage(chatId, `No pude leer el ticket. Escríbelo manual:\n\`250 gasolina Santander\``, { parse_mode: 'Markdown' })
  }
}

export async function handleTransactionText(bot, msg, session) {
  const chatId = msg.chat.id
  const text = msg.text.trim()
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(.*)$/)
  if (!match) return bot.sendMessage(chatId, 'No entendí. Ej: `250 gasolina`', { parse_mode: 'Markdown' })

  const amount = parseFloat(match[1])
  const description = match[2].trim() || 'Sin descripción'
  const { cardId, type } = session.pendingTransaction || {}
  if (!cardId) return bot.sendMessage(chatId, 'Error: selecciona una tarjeta primero.')

  await addTransaction(cardId, amount, description, type || 'gasto')
  session.pendingTransaction = null
  session.state = null

  const icon = type === 'ingreso' ? '💰' : '💸'
  return bot.sendMessage(chatId, `${icon} *$${amount.toFixed(2)}* — ${description}\n✅ Registrado`, { parse_mode: 'Markdown' })
}
