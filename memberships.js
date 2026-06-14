import { getMemberships, addMembership, supabase } from './db.js'
import dayjs from 'dayjs'

export async function handleMemberships(bot, msg, session) {
  const chatId = msg.chat.id
  const mems = await getMemberships()
  const keyboard = {
    inline_keyboard: [
      [{ text: '➕ Agregar membresía', callback_data: 'mem_add' }],
      [{ text: '📋 Ver todas', callback_data: 'mem_ver' }],
      [{ text: '📅 Próximos cobros', callback_data: 'mem_proximos' }],
      [{ text: '✏️ Editar membresía', callback_data: 'mem_editar' }],
      [{ text: '🗑️ Eliminar membresía', callback_data: 'mem_eliminar' }],
    ]
  }
  await bot.sendMessage(chatId, `📦 *Membresías* (${mems.length} activas)`, {
    parse_mode: 'Markdown', reply_markup: keyboard
  })
}

export async function handleMembershipsCallback(bot, query, session) {
  const chatId = query.message.chat.id
  const data = query.data

  if (data === 'mem_ver') {
    const mems = await getMemberships()
    if (!mems.length) return bot.sendMessage(chatId, 'No hay membresías registradas.')
    let text = '📦 *Tus membresías*\n\n'
    mems.forEach(m => {
      text += `• *${m.name}* — $${m.amount} ${m.currency}\n`
      text += `  📅 Cobro: día ${m.billing_day} · 🔔 Aviso ${m.reminder_days}d antes\n\n`
    })
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
  }

  if (data === 'mem_proximos') {
    const mems = await getMemberships()
    const today = dayjs()
    const upcoming = mems.map(m => {
      let next = dayjs().date(m.billing_day)
      if (next.isBefore(today)) next = next.add(1, 'month')
      return { ...m, nextDate: next, daysLeft: next.diff(today, 'day') }
    }).sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 5)

    let text = '📅 *Próximos cobros*\n\n'
    upcoming.forEach(m => {
      const urgency = m.daysLeft <= 3 ? '🔴' : m.daysLeft <= 7 ? '🟡' : '🟢'
      text += `${urgency} *${m.name}* — $${m.amount} ${m.currency}\n`
      text += `  ${m.daysLeft === 0 ? 'Hoy' : `En ${m.daysLeft} día(s)`} (${m.nextDate.format('DD/MM')})\n\n`
    })
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
  }

  if (data === 'mem_add') {
    session.state = 'awaiting_membership'
    return bot.sendMessage(chatId,
      '➕ Escribe la membresía:\n`YouTube Music 99 MXN dia15`\n`Netflix 219 MXN dia3`',
      { parse_mode: 'Markdown' }
    )
  }

  if (data === 'mem_eliminar') {
    const mems = await getMemberships()
    if (!mems.length) return bot.sendMessage(chatId, 'No hay membresías.')
    const keyboard = {
      inline_keyboard: [
        ...mems.map(m => ([{
          text: `🗑️ ${m.name} — $${m.amount} día ${m.billing_day}`,
          callback_data: `mem_del_${m.id}`
        }])),
        [{ text: '❌ Cancelar', callback_data: 'cancel' }]
      ]
    }
    return bot.sendMessage(chatId, '¿Cuál membresía eliminas?', { reply_markup: keyboard })
  }

  if (data.startsWith('mem_del_')) {
    const id = data.replace('mem_del_', '')
    await supabase.from('memberships').delete().eq('id', id)
    return bot.sendMessage(chatId, '✅ Membresía eliminada.')
  }

  if (data === 'mem_editar') {
    const mems = await getMemberships()
    if (!mems.length) return bot.sendMessage(chatId, 'No hay membresías.')
    const keyboard = {
      inline_keyboard: [
        ...mems.map(m => ([{
          text: `✏️ ${m.name} — $${m.amount}`,
          callback_data: `mem_edit_${m.id}`
        }])),
        [{ text: '❌ Cancelar', callback_data: 'cancel' }]
      ]
    }
    return bot.sendMessage(chatId, '¿Cuál quieres editar?', { reply_markup: keyboard })
  }

  if (data.startsWith('mem_edit_')) {
    const id = data.replace('mem_edit_', '')
    session.pendingMembership = { id }
    session.state = 'awaiting_membership_edit'
    return bot.sendMessage(chatId,
      '✏️ Escribe los nuevos datos:\n`YouTube Music 129 MXN dia15`',
      { parse_mode: 'Markdown' }
    )
  }
}

export async function handleMembershipText(bot, msg, session) {
  const chatId = msg.chat.id
  const text = msg.text.trim()
  const match = text.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*(MXN|USD|mxn|usd)?\s*dia(\d+)$/i)

  if (!match) {
    return bot.sendMessage(chatId,
      'No entendí. Usa el formato:\n`YouTube Music 99 MXN dia15`',
      { parse_mode: 'Markdown' }
    )
  }

  const [, name, amount, currency = 'MXN', billingDay] = match

  if (session.state === 'awaiting_membership_edit' && session.pendingMembership?.id) {
    await supabase.from('memberships').update({
      name: name.trim(),
      amount: parseFloat(amount),
      currency: currency.toUpperCase(),
      billing_day: parseInt(billingDay),
    }).eq('id', session.pendingMembership.id)
    session.state = null; session.pendingMembership = null
    return bot.sendMessage(chatId,
      `✅ *${name.trim()}* actualizada\n💰 $${amount} ${currency.toUpperCase()} — día ${billingDay}`,
      { parse_mode: 'Markdown' }
    )
  }

  const mem = await addMembership({
    name: name.trim(),
    amount: parseFloat(amount),
    currency: currency.toUpperCase(),
    billing_day: parseInt(billingDay),
    reminder_days: 3,
  })
  session.state = null
  return bot.sendMessage(chatId,
    `✅ *${mem.name}* agregada\n💰 $${mem.amount} ${mem.currency} — día ${mem.billing_day}\n🔔 Aviso 3 días antes`,
    { parse_mode: 'Markdown' }
  )
}
