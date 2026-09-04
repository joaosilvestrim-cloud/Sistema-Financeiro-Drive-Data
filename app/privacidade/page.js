import Link from 'next/link'
import Legal from '@/components/Legal'

export const metadata = { title: 'Política de Privacidade · DriveAzul' }

const ATUALIZADO = '4 de setembro de 2026'

export default function Privacidade() {
  return (
    <Legal titulo="Política de Privacidade" atualizado={ATUALIZADO}>
      <p>
        O DriveAzul é operado pela DriveData, e esta política explica que dado a
        gente recebe, para que usa, com quem compartilha e por quanto tempo
        guarda. Ela vale para quem usa o produto e para a empresa cujos dados
        financeiros são analisados.
      </p>

      <h2>Que dados a gente trata</h2>
      <p>
        <strong>Da sua conta:</strong> nome da empresa, e-mail e senha. A senha é
        guardada pelo Supabase Auth, cifrada, e a DriveData não tem acesso a ela.
      </p>
      <p>
        <strong>Do seu ERP:</strong> quando você autoriza a conexão com o Conta
        Azul, recebemos contas financeiras e saldos, categorias e centros de
        custo, cadastro de clientes e fornecedores, contas a pagar e a receber,
        parcelas e baixas. Não recebemos, nem pedimos, a sua senha do Conta Azul.
        A autorização é feita pelo próprio Conta Azul e você a revoga lá, quando
        quiser.
      </p>
      <p>
        <strong>Do que você digita ou envia:</strong> séries auxiliares, metas,
        orçamento e arquivos que você suba, como a fatura do cartão.
      </p>
      <p>
        <strong>De operação:</strong> registro de sincronização, erros e acessos,
        para suporte e segurança.
      </p>

      <h2>Para que usamos</h2>
      <p>
        Para entregar o produto que você contratou: montar os painéis, calcular
        os indicadores, gerar as análises e manter a sincronização funcionando.
        Também usamos dado agregado e sem identificação para entender uso e
        melhorar o serviço.
      </p>
      <p>
        Não vendemos seus dados. Não usamos seus dados financeiros para treinar
        modelo de inteligência artificial nosso nem de terceiros.
      </p>

      <h2>Com quem compartilhamos</h2>
      <p>Só com quem é necessário para o produto funcionar.</p>
      <ul>
        <li>
          <strong>Supabase</strong>, banco de dados e autenticação, com os dados
          hospedados na Amazon Web Services na região de São Paulo.
        </li>
        <li>
          <strong>Vercel</strong>, hospedagem da aplicação, com execução na
          região de São Paulo.
        </li>
        <li>
          <strong>Conta Azul</strong>, de onde vêm os dados financeiros, mediante
          a sua autorização.
        </li>
        <li>
          <strong>Groq</strong>, processamento das análises de inteligência
          artificial, com servidores nos Estados Unidos. Enviamos indicadores
          já calculados e agregados, e não a sua base de lançamentos. Você pode
          desligar as análises de IA na sua conta, e nesse caso nada é enviado
          para lá.
        </li>
      </ul>
      <p>
        O envio para os Estados Unidos é uma transferência internacional de
        dados. Ela acontece porque é necessária para executar o serviço que você
        contratou, e você pode evitá-la desligando as análises de IA.
      </p>

      <h2>Por quanto tempo guardamos</h2>
      <p>
        Enquanto a sua conta existir. Se você cancelar, os dados financeiros
        ficam disponíveis por 30 dias para exportação e depois são apagados. O
        registro de operação e o que a lei obrigar a manter ficam pelo prazo
        legal.
      </p>
      <p>
        Você pode pedir a exclusão a qualquer momento, sem esperar os 30 dias,
        escrevendo para o contato abaixo.
      </p>

      <h2>Seus direitos</h2>
      <p>
        A Lei Geral de Proteção de Dados garante a você confirmar o tratamento,
        acessar, corrigir, anonimizar, portar e eliminar os seus dados, além de
        revogar o consentimento. Para exercer qualquer um, escreva para{' '}
        <a href="mailto:privacidade@drivedata.com.br">privacidade@drivedata.com.br</a>.
        Respondemos em até 15 dias.
      </p>

      <h2>Segurança</h2>
      <p>
        Os tokens de acesso ao seu ERP são guardados cifrados. O acesso ao banco
        é isolado por cliente, e uma tela nunca consulta dado sem o filtro da
        empresa de quem está logado. O tráfego é todo em HTTPS.
      </p>
      <p>
        Se acontecer um incidente de segurança que possa causar risco relevante a
        você, avisamos você e a Autoridade Nacional de Proteção de Dados.
      </p>

      <h2>Contato</h2>
      <p>
        DriveData ·{' '}
        <a href="mailto:privacidade@drivedata.com.br">privacidade@drivedata.com.br</a>
      </p>

      <p style={{ marginTop: 32 }}>
        <Link href="/termos">Termos de uso</Link> ·{' '}
        <Link href="/comecar">Começar</Link>
      </p>
    </Legal>
  )
}
