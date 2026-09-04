import Link from 'next/link'
import Legal from '@/components/Legal'

export const metadata = { title: 'Termos de Uso · DriveAzul' }

const ATUALIZADO = '4 de setembro de 2026'

export default function Termos() {
  return (
    <Legal titulo="Termos de Uso" atualizado={ATUALIZADO}>
      <p>
        Estes termos regem o uso do DriveAzul, produto de inteligência financeira
        operado pela DriveData. Ao criar uma conta, você concorda com eles.
      </p>

      <h2>1. O que o DriveAzul faz</h2>
      <p>
        O DriveAzul lê os dados financeiros do seu ERP, com a sua autorização, e
        os transforma em painéis, indicadores, projeções e análises. Ele não
        substitui o seu ERP, não substitui a sua contabilidade e não é
        aconselhamento financeiro, contábil, jurídico ou de investimento. As
        decisões continuam sendo suas.
      </p>

      <h2>2. Requisitos</h2>
      <p>
        É necessário um plano do Conta Azul que ofereça acesso à API, hoje o
        plano Pro. Sem isso a conexão não funciona, e não há como o DriveAzul
        suprir essa limitação.
      </p>

      <h2>3. Sua conta</h2>
      <p>
        Você é responsável por manter a senha em segredo e pelo que acontece na
        sua conta. Avise a gente se suspeitar de acesso indevido. Você garante
        que tem autorização para conectar o ERP da empresa que conectar.
      </p>

      <h2>4. Teste e pagamento</h2>
      <p>
        O teste dura 14 dias, não pede cartão e dá acesso ao produto. Terminado o
        teste sem assinatura, o acesso ao painel é pausado, e os seus dados
        continuam guardados e disponíveis para exportação.
      </p>
      <p>
        A assinatura é mensal e renova sozinha até você cancelar. O preço de cada
        plano é o que estiver na página de planos no momento da contratação.
        Mudança de preço é avisada com pelo menos 30 dias e nunca vale para o
        ciclo já pago.
      </p>

      <h2>5. Cancelamento</h2>
      <p>
        Você cancela quando quiser, sem multa. O acesso continua até o fim do
        ciclo já pago. Não devolvemos valor proporcional de ciclo iniciado,
        exceto quando a lei exigir.
      </p>

      <h2>6. Escrita no seu ERP</h2>
      <p>
        Algumas funções criam lançamentos dentro do seu ERP, como a importação de
        fatura de cartão. Elas só rodam quando você confirma, item por item, numa
        tela de revisão. A API do Conta Azul não oferece exclusão de lançamento
        financeiro, então um lançamento criado só pode ser corrigido dentro do
        próprio Conta Azul. Isso está escrito na tela antes da confirmação, e ao
        confirmar você assume essa responsabilidade.
      </p>

      <h2>7. Disponibilidade e dependência de terceiros</h2>
      <p>
        O DriveAzul depende da API do Conta Azul. Quando ela fica fora do ar,
        muda ou revoga autorização, a sincronização para e os números passam a
        refletir a última atualização bem sucedida. A idade do dado aparece na
        tela justamente para isso. Não prometemos disponibilidade
        ininterrupta e não respondemos por indisponibilidade causada por
        terceiros.
      </p>

      <h2>8. Precisão dos números</h2>
      <p>
        Os números vêm do seu ERP. Se o ERP estiver com lançamento errado, em
        atraso ou mal categorizado, o painel vai refletir isso. Conferimos os
        cálculos com cuidado, mas a fonte da verdade é o seu ERP, e cabe a você
        validar antes de decidir com base neles.
      </p>

      <h2>9. Limitação de responsabilidade</h2>
      <p>
        Na medida permitida pela lei, a responsabilidade da DriveData em qualquer
        situação relacionada ao serviço fica limitada ao valor pago por você nos
        12 meses anteriores ao fato. Não respondemos por lucro cessante ou perda
        indireta.
      </p>

      <h2>10. Encerramento pela DriveData</h2>
      <p>
        Podemos suspender ou encerrar uma conta em caso de falta de pagamento, uso
        que viole a lei ou tentativa de comprometer o serviço. Havendo
        encerramento, você tem 30 dias para exportar os seus dados.
      </p>

      <h2>11. Mudanças nestes termos</h2>
      <p>
        Podemos atualizar estes termos. Mudança relevante é avisada por e-mail
        com pelo menos 30 dias de antecedência, e continuar usando depois disso
        significa aceitar a nova versão.
      </p>

      <h2>12. Lei e foro</h2>
      <p>
        Estes termos são regidos pela lei brasileira. Fica eleito o foro da
        comarca de Sorocaba, São Paulo, para resolver qualquer questão.
      </p>

      <h2>Contato</h2>
      <p>
        DriveData ·{' '}
        <a href="mailto:contato@drivedata.com.br">contato@drivedata.com.br</a>
      </p>

      <p style={{ marginTop: 32 }}>
        <Link href="/privacidade">Política de privacidade</Link> ·{' '}
        <Link href="/comecar">Começar</Link>
      </p>
    </Legal>
  )
}
