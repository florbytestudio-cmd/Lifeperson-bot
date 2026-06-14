import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

export async function getCards() {
  const { data } = await supabase.from('cards').select('*').eq('active', true).order('bank')
  return data || []
}
export async function addCard(bank, label, type = 'credito') {
  const { data, error } = await supabase.from('cards').insert([{ bank, label, type }]).select().single()
  if (error) throw new Error(error.message)
  return data
}
export async function addTransaction(cardId, amount, description, type = 'gasto', ticketUrl = null, rawOcr = null) {
  const { data, error } = await supabase.from('transactions')
    .insert([{ card_id: cardId, amount, description, type, ticket_url: ticketUrl, raw_ocr: rawOcr }])
    .select().single()
  if (error) throw new Error(error.message)
  return data
}
export async function getMonthTransactions(cardId = null) {
  const start = new Date(); start.setDate(1); start.setHours(0,0,0,0)
  let q = supabase.from('transactions').select('*, cards(bank,label)')
    .gte('created_at', start.toISOString()).order('created_at', { ascending: false })
  if (cardId) q = q.eq('card_id', cardId)
  const { data } = await q
  return data || []
}
export async function getAllTransactions() {
  const { data } = await supabase.from('transactions')
    .select('*, cards(bank,label)').order('created_at', { ascending: false }).limit(100)
  return data || []
}
export async function addProspect(fields) {
  const { data, error } = await supabase.from('prospects').insert([fields]).select().single()
  if (error) throw new Error(error.message)
  return data
}
export async function updateProspect(id, fields) {
  const { data, error } = await supabase.from('prospects').update(fields).eq('id', id).select().single()
  if (error) throw new Error(error.message)
  return data
}
export async function getProspects(status = null) {
  let q = supabase.from('prospects').select('*').order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  const { data } = await q
  return data || []
}
export async function getMemberships() {
  const { data } = await supabase.from('memberships').select('*').eq('active', true).order('billing_day')
  return data || []
}
export async function addMembership(fields) {
  const { data, error } = await supabase.from('memberships').insert([fields]).select().single()
  if (error) throw new Error(error.message)
  return data
}
export async function getUpcomingMemberships(daysAhead = 3) {
  const today = new Date()
  const targetDay = new Date(today); targetDay.setDate(today.getDate() + daysAhead)
  const { data } = await supabase.from('memberships')
    .select('*').eq('active', true).eq('billing_day', targetDay.getDate())
  return data || []
}
export async function addTask(title, priority = 'media', dueDate = null, notes = null) {
  const { data, error } = await supabase.from('tasks')
    .insert([{ title, priority, due_date: dueDate, notes }]).select().single()
  if (error) throw new Error(error.message)
  return data
}
export async function getTasks(done = false) {
  const { data } = await supabase.from('tasks').select('*')
    .eq('done', done).order('priority').order('created_at', { ascending: false })
  return data || []
}
export async function completeTask(id) {
  const { data, error } = await supabase.from('tasks')
    .update({ done: true, completed_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw new Error(error.message)
  return data
}
export async function getProjects(status = 'activo') {
  let q = supabase.from('projects').select('*').order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  const { data } = await q
  return data || []
}
export async function addProject(fields) {
  const { data, error } = await supabase.from('projects').insert([fields]).select().single()
  if (error) throw new Error(error.message)
  return data
}
export async function updateProject(id, fields) {
  const { data, error } = await supabase.from('projects').update(fields).eq('id', id).select().single()
  if (error) throw new Error(error.message)
  return data
}
export async function addNote(content, tags = [], audioUrl = null, transcript = null) {
  const { data, error } = await supabase.from('notes')
    .insert([{ content, tags, audio_url: audioUrl, transcript }]).select().single()
  if (error) throw new Error(error.message)
  return data
}
export async function searchNotes(query) {
  const { data } = await supabase.from('notes').select('*')
    .textSearch('content', query, { type: 'websearch', config: 'spanish' })
    .order('created_at', { ascending: false }).limit(10)
  return data || []
}
export async function getRecentNotes(limit = 5) {
  const { data } = await supabase.from('notes').select('*')
    .order('created_at', { ascending: false }).limit(limit)
  return data || []
}
export async function getCategories() {
  const { data } = await supabase.from('categories').select('*')
    .order('is_default', { ascending: false }).order('name')
  return data || []
}
export async function addCategory(name, icon = '📁') {
  const { data, error } = await supabase.from('categories').insert([{ name, icon }]).select().single()
  if (error) throw new Error(error.message)
  return data
}

// ── Dashboard stats ──────────────────────────────────────────────────────────
export async function getDashboardStats() {
  const today = new Date()
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()

  const [
    { data: transactions },
    { data: prospects },
    { data: memberships },
    { data: tasks },
    { data: projects },
    { data: notes },
  ] = await Promise.all([
    supabase.from('transactions').select('*, cards(bank,label)').gte('created_at', startOfMonth).order('created_at', { ascending: false }),
    supabase.from('prospects').select('*').order('created_at', { ascending: false }),
    supabase.from('memberships').select('*').eq('active', true),
    supabase.from('tasks').select('*').eq('done', false).order('priority'),
    supabase.from('projects').select('*').eq('status', 'activo'),
    supabase.from('notes').select('*').order('created_at', { ascending: false }).limit(10),
  ])

  // Gastos por tarjeta este mes
  const gastosPorTarjeta = {}
  transactions?.forEach(t => {
    const key = t.cards?.bank || 'Sin tarjeta'
    if (!gastosPorTarjeta[key]) gastosPorTarjeta[key] = { gastos: 0, ingresos: 0 }
    if (t.type === 'gasto') gastosPorTarjeta[key].gastos += Number(t.amount)
    else gastosPorTarjeta[key].ingresos += Number(t.amount)
  })

  // Membresías con próximo cobro
  const memConFecha = memberships?.map(m => {
    let next = new Date(today)
    next.setDate(m.billing_day)
    if (next <= today) { next.setMonth(next.getMonth() + 1) }
    return { ...m, nextDate: next, daysLeft: Math.ceil((next - today) / 86400000) }
  }).sort((a, b) => a.daysLeft - b.daysLeft) || []

  return {
    banco: {
      porTarjeta: gastosPorTarjeta,
      transacciones: transactions || [],
      totalGastos: transactions?.filter(t => t.type === 'gasto').reduce((s, t) => s + Number(t.amount), 0) || 0,
      totalIngresos: transactions?.filter(t => t.type === 'ingreso').reduce((s, t) => s + Number(t.amount), 0) || 0,
    },
    florbyte: {
      total: prospects?.length || 0,
      interesados: prospects?.filter(p => p.status === 'interesado').length || 0,
      pendientes: prospects?.filter(p => p.status === 'pendiente').length || 0,
      cerrados: prospects?.filter(p => p.status === 'cerrado').length || 0,
      recientes: prospects?.slice(0, 5) || [],
    },
    membresias: {
      total: memberships?.length || 0,
      costoMensual: memberships?.reduce((s, m) => s + Number(m.amount || 0), 0) || 0,
      proximas: memConFecha.slice(0, 3),
    },
    tareas: {
      total: tasks?.length || 0,
      alta: tasks?.filter(t => t.priority === 'alta').length || 0,
      media: tasks?.filter(t => t.priority === 'media').length || 0,
      baja: tasks?.filter(t => t.priority === 'baja').length || 0,
      lista: tasks?.slice(0, 8) || [],
    },
    proyectos: {
      total: projects?.length || 0,
      lista: projects || [],
    },
    notas: {
      recientes: notes || [],
    },
  }
}
