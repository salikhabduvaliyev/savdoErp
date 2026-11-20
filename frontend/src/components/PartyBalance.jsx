// Kontragent balansi (o'zaro hisob-kitob).
//  * Har bir valyutadagi qoldiq alohida (qarz qaysi valyutada bo'lsa).
//  * Jami — bugungi kurs bo'yicha asosiy valyutada; hujjat/kassa valyutasi boshqa bo'lsa, o'sha valyutaga ham o'girib ("≈ $ 831,13").
//  Rang: kontragent bizga qarzdor — qizil, biz qarzdormiz — yashil.
import { baseCurrency } from '../currency'
import { money } from '../format'
import { t } from '../i18n'
import { useFetch } from './ui'

const tone = (n) => (n < 0 ? 'red' : n > 0 ? 'green' : 'muted')
const note = (n) => (n < 0 ? ` (${t('qarzi')})` : n > 0 ? ` (${t('bizning qarz')})` : '')

export default function PartyBalance({ counterparty, currency, stamp }) {
  const want = currency || baseCurrency()
  const { data, error } = useFetch(counterparty ? '/finance/settlements/balance/' : null, { counterparty, currency: want, _: stamp || 0 })
  if (!counterparty || error) return null
  if (!data) return <div className="party-bal muted small">{t('Balans')}: …</div>
  const bal = data.balance || {}
  const base = data.base || baseCurrency()
  const parts = Object.entries(bal).filter(([, v]) => Number(v) !== 0)
  const totals = data.totals || {}
  const totalBase = Number(totals[base] || 0)
  // bitta valyutada va hujjat ham shu valyutada bo'lsa — jami takrorlanmaydi
  const showTotal = parts.length > 1 || (parts.length === 1 && parts[0][0] !== want) || (parts.length === 1 && parts[0][0] !== base)
  return (
    <div className="party-bal small" title={t('Manfiy — kontragent bizga qarzdor, musbat — biz unga qarzdormiz')}>
      <span className="muted">{t('Balans')}:</span>
      {!parts.length && <span className="muted">{money(0, want)}</span>}
      {parts.map(([c, v]) => <span key={c} className={tone(Number(v))}>{money(v, c)}</span>)}
      {parts.length > 0 && !showTotal && <span className={tone(totalBase)}>{note(totalBase)}</span>}
      {parts.length > 0 && showTotal && (
        <span className={'party-total ' + tone(totalBase)}>
          = {[...new Set([base, want])].filter((c) => totals[c] !== undefined).map((c) => money(totals[c], c)).join(' ≈ ')}{note(totalBase)}
        </span>
      )}
    </div>
  )
}
