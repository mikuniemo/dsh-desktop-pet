/**
 * 生成柔和的提示音（16-bit PCM WAV，无第三方素材）。
 *
 *  · oops.wav —— 报错：两个下行的软音（784→587Hz），慢起慢落，低音量，不刺耳
 *  · ding.wav —— 完成：两个上行的软音（880→1175Hz），带一点泛音
 *
 * 用法： node scripts/make-sounds.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const SAMPLE_RATE = 44100
const OUT_DIR = path.resolve('src/renderer/public/sounds')

function envelope(t, duration, attack = 0.012, release = 0.18) {
  const attackGain = t < attack ? t / attack : 1
  const releaseStart = duration - release
  const releaseGain = t > releaseStart ? Math.max(0, (duration - t) / release) : 1
  return attackGain * releaseGain
}

/** 一个柔和的音符：基频 + 一点二次谐波 + 轻微颤音 */
function tone(frequency, duration, { amplitude = 0.2, vibrato = 2.2, delay = 0 } = {}) {
  const samples = []
  const total = Math.round(duration * SAMPLE_RATE)
  const delaySamples = Math.round(delay * SAMPLE_RATE)
  for (let i = 0; i < delaySamples; i += 1) samples.push(0)
  for (let i = 0; i < total; i += 1) {
    const t = i / SAMPLE_RATE
    const wobble = 1 + 0.004 * Math.sin(2 * Math.PI * vibrato * t)
    const value =
      Math.sin(2 * Math.PI * frequency * wobble * t) * 0.82 +
      Math.sin(2 * Math.PI * frequency * 2 * wobble * t) * 0.14 +
      Math.sin(2 * Math.PI * frequency * 0.5 * wobble * t) * 0.04
    samples.push(value * amplitude * envelope(t, duration))
  }
  return samples
}

function mix(...tracks) {
  const length = Math.max(...tracks.map((track) => track.length))
  const out = new Float32Array(length)
  for (const track of tracks) {
    for (let i = 0; i < track.length; i += 1) out[i] += track[i]
  }
  return out
}

function writeWav(filename, samples) {
  const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0) || 1
  const normalise = peak > 0.85 ? 0.85 / peak : 1
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i] * normalise))
    data.writeInt16LE(Math.round(value * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  const target = path.join(OUT_DIR, filename)
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(target, Buffer.concat([header, data]))
  console.log(`${filename}: ${(samples.length / SAMPLE_RATE).toFixed(2)}s, ${(header.length + data.length) / 1024 | 0}KB`)
}

// 报错：下行软音，慢起慢落
writeWav(
  'oops.wav',
  mix(
    tone(784, 0.34, { amplitude: 0.18, delay: 0 }),
    tone(587, 0.42, { amplitude: 0.16, delay: 0.12 }),
    tone(196, 0.5, { amplitude: 0.05, delay: 0 })
  )
)

// 完成：上行软音
writeWav(
  'ding.wav',
  mix(
    tone(880, 0.26, { amplitude: 0.15 }),
    tone(1174, 0.4, { amplitude: 0.13, delay: 0.1 }),
    tone(1470, 0.3, { amplitude: 0.05, delay: 0.1 })
  )
)

// 等你回答：轻轻的"叮—咚"，音高更高但不尖
writeWav(
  'ask.wav',
  mix(tone(1046, 0.22, { amplitude: 0.12 }), tone(1318, 0.34, { amplitude: 0.1, delay: 0.16 }))
)
