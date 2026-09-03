import { randomBytes } from 'node:crypto'

console.log('\nCole no .env:\n')
console.log('TOKEN_ENCRYPTION_KEY=' + randomBytes(32).toString('base64'))
console.log('OAUTH_STATE_SECRET=' + randomBytes(32).toString('hex'))
console.log('\nGuarde a TOKEN_ENCRYPTION_KEY. Se perder, todas as conexoes precisam ser refeitas.\n')
