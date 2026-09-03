// Fase 0: completa o fluxo OAuth e guarda os tokens em .tokens.json.
// Sem banco no caminho, serve para medir a API antes de modelar qualquer coisa.
// Para conectar uma empresa de verdade no banco, use "npm run connect".

import { config } from '../src/config.mjs'
import { obtainTokensInteractive } from '../src/authFlow.mjs'
import { saveTokens } from '../src/tokens.mjs'

try {
  const tokens = await obtainTokensInteractive()
  await saveTokens(tokens)
  console.log('\nConectado. Tokens salvos em', config.tokenFile)
  console.log('access_token valido ate', tokens.expires_at)
  console.log('Proximo passo: npm run pull')
  process.exit(0)
} catch (e) {
  console.error('\n' + e.message)
  process.exit(1)
}
