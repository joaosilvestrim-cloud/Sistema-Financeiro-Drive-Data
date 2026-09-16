import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/session'
import { comAviso } from '@/lib/acao'
import { cadastrarEmitente, emitentes } from '@/lib/fiscal'
import AtivarEmitente from '@/components/AtivarEmitente'
import Aviso from '@/components/Aviso'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ativar emissão · DriveAzul' }

// Ativação do emitente fiscal pelo próprio cliente.
//
// Antes disto o emitente nascia por um script rodado na nossa máquina, o que
// funciona para a primeira empresa e não funciona para um produto vendido.
// Requisito fixado em 14/09: nada pode depender de cadastro manual nosso.
//
// A lib já fazia tudo (simula na Focus antes de gravar, guarda os tokens
// cifrados, registra os gatilhos). Esta tela é só a porta que faltava.
//
// Sobre o certificado A1: o arquivo atravessa a memória (FormData, base64,
// requisição à Focus) e não é escrito em disco, banco nem log. A política
// está em docs/FISCAL.md e o texto da tela promete isso ao cliente; qualquer
// mudança aqui precisa manter a promessa.

export default async function Ativar({ searchParams }) {
  const sessao = await requireSession()
  const busca = await searchParams
  const erro = busca?.erro ?? null

  async function ativar(formData) {
    'use server'
    await comAviso('/notas/ativar', async () => {
      const s = await requireSession()
      const v = (nome) => {
        const x = formData.get(nome)
        return typeof x === 'string' && x.trim() ? x.trim() : null
      }

      // O arquivo vira base64 aqui e o buffer morre com a requisição.
      let certificadoBase64 = null
      const arquivo = formData.get('certificado')
      if (arquivo && typeof arquivo === 'object' && arquivo.size > 0) {
        certificadoBase64 = Buffer.from(await arquivo.arrayBuffer()).toString('base64')
      }

      const regime = v('regime_tributario')
      const nacional = formData.get('tipo_nfse') === 'nacional'

      await cadastrarEmitente(s, {
        razao_social: v('razao_social'),
        nome_fantasia: v('nome_fantasia'),
        cnpj: v('cnpj') ?? '',
        inscricao_municipal: v('inscricao_municipal'),
        inscricao_estadual: v('inscricao_estadual'),
        regime_tributario: regime,
        optante_simples: regime !== '3',
        logradouro: v('logradouro'),
        numero: v('numero'),
        complemento: v('complemento'),
        bairro: v('bairro'),
        municipio: v('municipio'),
        uf: v('uf')?.toUpperCase(),
        cep: v('cep') ?? '',
        codigo_municipio: v('codigo_municipio'),
        email: v('email'),
        telefone: v('telefone'),
        habilita_nfse: !nacional,
        habilita_nfse_nacional: nacional,
        habilita_recebidas_nfe: formData.get('habilita_recebidas_nfe') === '1',
        item_lista_servico: v('item_lista_servico'),
        aliquota_iss: v('aliquota_iss')?.replace(',', '.'),
        discriminacao_padrao: v('discriminacao_padrao'),
      }, certificadoBase64 ? { certificadoBase64, senha: v('senha_certificado') } : {})

      redirect('/notas?ok=ativado')
    })
  }

  // Quem já ativou cai na tela de notas, que é onde a vida acontece.
  const lista = await emitentes(sessao)
  if (lista.length && !busca?.outra) redirect('/notas')

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ativar emissão de notas</h1>
          <p>
            Uma vez só. O cadastro vai para o emissor, os gatilhos de retorno
            ficam armados e a tela de Notas passa a funcionar.
          </p>
        </div>
      </div>

      <Aviso erro={erro} titulo="O cadastro não foi concluído" />

      <AtivarEmitente acao={ativar} />
    </>
  )
}
