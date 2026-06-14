import 'dotenv/config'
import express from 'express'
import { getDashboardStats } from './db.js'

const app = express()
const PORT = process.env.DASHBOARD_PORT || 4000

app.use(express.static('.'))

app.get('/api/dashboard', async (req, res) => {
  try {
    const stats = await getDashboardStats()
    res.json(stats)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/dashboard', (req, res) => {
  res.sendFile('dashboard.html', { root: '.' })
})

app.listen(PORT, () => console.log(`Dashboard en puerto ${PORT}`))
