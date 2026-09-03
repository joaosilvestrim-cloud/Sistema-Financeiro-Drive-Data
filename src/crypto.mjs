import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'

// AES-256-GCM. A chave fica no ambiente do worker, nunca no banco. Quem tiver
// um dump do Postgres não consegue usar os tokens das empresas conectadas.
function key() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) throw new Error('Faltou TOKEN_ENCRYPTION_KEY. Gere com: npm run keygen')
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY precisa ter 32 bytes em base64')
  return buf
}

export function encrypt(plain) {
  if (plain == null) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.')
}

export function decrypt(payload) {
  if (payload == null) return null
  const [iv, tag, data] = String(payload).split('.')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}

// Hash estável de um objeto vindo da API. Chaves ordenadas para que a mesma
// informação sempre gere o mesmo hash, independente da ordem do JSON.
export function stableHash(value) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm)
    if (v && typeof v === 'object') {
      return Object.keys(v).sort().reduce((acc, k) => {
        acc[k] = norm(v[k])
        return acc
      }, {})
    }
    return v
  }
  return createHash('sha256').update(JSON.stringify(norm(value))).digest('hex')
}
