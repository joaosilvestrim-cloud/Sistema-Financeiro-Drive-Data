import Image from 'next/image'
import marca from '@/public/driveazul-marca.png'

// A marca da DriveData com o nome do produto ao lado.
//
// O símbolo é o mesmo do logotipo oficial, recortado do arquivo da marca em vez
// de redesenhado, então cor e forma continuam idênticas ao site. Ele tem fundo
// transparente e contraste próprio, o que faz ele funcionar igual no tema claro
// e no escuro sem precisar de duas versões.
export default function Marca({ tamanho = 30, subtitulo = 'Inteligência financeira' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Image
        src={marca}
        alt=""
        width={tamanho}
        height={tamanho}
        priority
        style={{ flexShrink: 0 }}
      />
      <div className="brand">
        DriveAzul
        {subtitulo && <span>{subtitulo}</span>}
      </div>
    </div>
  )
}
