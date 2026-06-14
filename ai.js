import OpenAI from 'openai'
import fs from 'fs'
import axios from 'axios'
import path from 'path'
import os from 'os'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function transcribeAudio(fileUrl) {
  const tmpPath = path.join(os.tmpdir(), `audio_${Date.now()}.ogg`)
  const writer = fs.createWriteStream(tmpPath)
  const response = await axios({ url: fileUrl, method: 'GET', responseType: 'stream' })
  await new Promise((res, rej) => { response.data.pipe(writer); writer.on('finish', res); writer.on('error', rej) })
  const transcript = await openai.audio.transcriptions.create({ file: fs.createReadStream(tmpPath), model: 'whisper-1', language: 'es' })
  fs.unlinkSync(tmpPath)
  return transcript.text
}

export async function extractProspectData(transcript) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: `Del siguiente texto extrae info de un prospecto. Responde SOLO en JSON:\n{"name":"","business":"","platform":"instagram|facebook|otro","profile_url":null,"industry":"restaurante|ropa|belleza|inmobiliaria|otro","notes":""}\n\nTexto: "${transcript}"` }],
    max_tokens: 300, response_format: { type: 'json_object' },
  })
  return JSON.parse(res.choices[0].message.content)
}

export async function extractTicketData(imageUrl) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
      { type: 'text', text: 'Analiza este ticket. Responde SOLO en JSON:\n{"amount":0.0,"description":"","bank":null,"card_last4":null,"date":null}' }
    ]}],
    max_tokens: 200, response_format: { type: 'json_object' },
  })
  return JSON.parse(res.choices[0].message.content)
}

export async function summarizeSearchResults(query, notes) {
  if (!notes.length) return `No encontré notas sobre "${query}".`
  const notesText = notes.map((n,i) => `${i+1}. ${n.content}`).join('\n')
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: `Busco: "${query}"\n\nNotas:\n${notesText}\n\nResume en 2-3 líneas en español mexicano.` }],
    max_tokens: 150,
  })
  return res.choices[0].message.content.trim()
}
