export default function Tile({ label, valor, nota, tom }) {
  return (
    <div className="card tile">
      <div className="label">{label}</div>
      <div className="value">{valor}</div>
      {nota && <div className={`note${tom ? ' ' + tom : ''}`}>{nota}</div>}
    </div>
  )
}
