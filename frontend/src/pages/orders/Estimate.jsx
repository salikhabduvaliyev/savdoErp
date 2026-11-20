import { useState } from 'react'
import api, { errorText } from '../../api'
import { Loading, MoneyBag, toast, useFetch } from '../../components/ui'
import { date, money, qty, shortDate } from '../../format'
import { t } from '../../i18n'
import { SearchSelect } from '../../components/Controls'
import { ProductPicker, ProductSearch } from '../../components/DocEditor'
import { NumInput } from '../../components/Inputs'
import Icon from '../../components/Icon'
import { IconBtn } from '../../components/Icon'
import { curLabel } from '../../currency'

/* A blok: qidiruv va ma'lumotnoma orqali material qo'shish (sotuvdagidek); narx — ombordagi o'rtacha tannarx */
function MaterialAdder({ estimateId, onAdded }) {
  const [picker, setPicker] = useState(false)
  const add = async (p, n = 1) => {
    try {
      await api.post('/orders/estimate-materials/', { estimate: estimateId, material: p.id, qty: n || 1, waste_pct: 0 })
      onAdded()
    } catch (e) { toast(errorText(e), true) }
  }
  return (
    <div className="positions-add est-add">
      <ProductSearch onPick={(p) => add(p, 1)} params={{ type: 'raw,goods,product' }} />
      <button type="button" className="btn" onClick={() => setPicker(true)}><Icon name="book" size={16} /> {t("Ma'lumotnomadan qo'shish")}</button>
      {picker && <ProductPicker onPick={add} onClose={() => setPicker(false)} params={{ type: 'raw,goods,product' }} />}
    </div>
  )
}

/* Qatordagi qiymatni o'zgartirish (blur/Enter da saqlanadi) */
function CellNum({ value, onSave, width = 100 }) {
  const [v, setV] = useState(String(Number(value)))
  const save = () => { if (String(Number(value)) !== String(Number(v || 0))) onSave(v || 0) }
  return <NumInput className="cell num" style={{ width }} value={v} onChange={(e) => setV(e.target.value)} onBlur={save}
    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
}

function AddServiceRow({ estimateId, operations, employees, onAdded }) {
  const [v, setV] = useState({ operation: '', employee: '', qty: '', rate: '' })
  const op = operations.find((o) => String(o.id) === String(v.operation))
  const add = async () => {
    try {
      const payload = { estimate: estimateId, operation: v.operation, qty: v.qty, employee: v.employee || null }
      if (v.rate) payload.rate = v.rate
      await api.post('/orders/estimate-services/', payload)
      setV({ operation: '', employee: '', qty: '', rate: '' })
      onAdded()
    } catch (e) { toast(errorText(e), true) }
  }
  const defRate = op ? Number(op.default_rate) || Number(op.piece_rate) : 0
  return (
    <tr className="est-add-row">
      <td>
        <SearchSelect value={v.operation} placeholder={t('Xizmat tanlang…')}
          onChange={(id) => { const o = operations.find((x) => String(x.id) === String(id)); setV({ ...v, operation: id, employee: o?.employee ? String(o.employee) : '' }) }}
          options={operations.map((o) => ({ value: o.id, label: o.name, sub: o.department_name }))} />
      </td>
      <td className="small">{op?.department_name || ''}</td>
      <td>
        <select className="cell" value={v.employee} onChange={(e) => setV({ ...v, employee: e.target.value })} disabled={!op}>
          <option value="">{t('— xodim —')}</option>
          {employees.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
        </select>
      </td>
      <td className="num"><NumInput className="cell num" style={{ width: 90 }} placeholder={t('miqdor')} value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} /></td>
      <td>{op ? t(op.unit_display) : ''}</td>
      <td className="num"><NumInput className="cell num" style={{ width: 110 }} placeholder={op ? String(defRate) : t('tarif')} value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} /></td>
      <td>{op ? curLabel(Number(op.default_rate) ? op.rate_currency : 'UZS') : ''}</td>
      <td className="num">{op && v.qty ? money(Number(v.qty) * Number(v.rate || defRate), Number(op.default_rate) ? op.rate_currency : 'UZS') : ''}</td>
      <td className="num"><button className="btn small primary" disabled={!v.operation || !Number(v.qty)} onClick={add}>{t("Qo'shish")}</button></td>
    </tr>
  )
}

const cur = curLabel

export default function Estimate({ order }) {
  const { data, error, reload } = useFetch(`/orders/${order.id}/costing/`)
  const operations = useFetch('/production/operations/')
  const employees = useFetch('/hr/employees/', { is_active: true })
  const empList = employees.data?.results || employees.data || []
  const [editing, setEditing] = useState(false)

  if (!data) return <Loading error={error} />
  const est = data.estimate
  const A = data.blocks.A, B = data.blocks.B, C = data.blocks.C, Dd = data.blocks.D
  const profit = Number(data.profit)

  const patch = async (kind, id, body) => {
    try { await api.patch(`/orders/estimate-${kind}/${id}/`, body); reload() } catch (e) { toast(errorText(e), true) }
  }
  const del = async (kind, id) => {
    try {
      await api.delete(`/orders/estimate-${kind}/${id}/`)
      reload()
    } catch (e) { toast(errorText(e), true) }
  }
  const blockTotal = (blk) => (
    <span className="small muted"> {t("Jami:")} <MoneyBag bag={blk.total} inline /> {Object.values(blk.total).some((x) => Number(x)) && `≈ ${money(blk.converted, data.currency)}`}</span>
  )

  return (
    <>
      <div className="est-head">
        <button className={'btn' + (editing ? ' primary' : '')} onClick={() => setEditing((e) => !e)}>
          <Icon name={editing ? 'check' : 'edit'} size={15} /> {editing ? t('Tayyor') : t('Tahrirlash')}
        </button>
        <div>
          <h2 style={{ display: 'inline', marginRight: 8 }}>{t('Smeta')}</h2>
          <span className="muted small">{t('Buyurtma valyutasi')}: {cur(data.currency)} · {t('Kurs')}: {data.rate ? `1 USD = ${qty(data.rate)} ${t("so'm")} (${date(order.date)})` : t('kiritilmagan')}</span>
          {est?.note && <div className="small muted">{t('Izoh')}: {est.note}</div>}
        </div>
      </div>
      {data.warnings.map((w) => <div key={w} className="error">{w}</div>)}

      <div className="card">
        <div className="card-head"><h3>{t("A. Materiallar (ombordan)")}</h3>{blockTotal(A)}</div>
        <table className="t">
          <thead><tr><th>{t("Material")}</th><th className="num">{t("Sarf")}</th><th className="num">{t("Chiqindi, %")}</th><th className="num">{t("Narx")}</th><th>{t("Valyuta")}</th><th className="num">{t("Summa")}</th><th /></tr></thead>
          <tbody>
            {A.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.material_name}</td>
                <td className="num">{editing ? <><CellNum value={r.qty} width={90} onSave={(x) => patch('materials', r.id, { qty: x })} /> {t(r.unit)}</> : <>{qty(r.qty)} {t(r.unit)}</>}</td>
                <td className="num">{editing ? <CellNum value={r.waste_pct} width={70} onSave={(x) => patch('materials', r.id, { waste_pct: x })} /> : `${qty(r.waste_pct)}%`}</td>
                <td className="num">{editing ? <CellNum value={r.price} width={120} onSave={(x) => patch('materials', r.id, { price: x })} /> : money(r.price, r.currency)}</td>
                <td>{cur(r.currency)}</td>
                <td className="num">{money(r.amount, r.currency)}</td>
                <td className="num">{editing && <IconBtn icon="delete" danger title="O'chirish" onClick={() => del('materials', r.id)} />}</td>
              </tr>
            ))}
            {!A.rows.length && <tr><td colSpan={7} className="muted small">{t("Materiallar yo'q")}{editing ? '' : ` — ${t("«Tahrirlash» bosib qo'shing")}`}</td></tr>}
          </tbody>
        </table>
        {editing && est && <MaterialAdder estimateId={est.id} onAdded={reload} />}
      </div>

      <div className="card">
        <div className="card-head"><h3>{t("B. Xizmatlar (operatsiyalar)")}</h3>{blockTotal(B)}</div>
        <table className="t">
          <thead><tr><th>{t("Xizmat")}</th><th>{t("Bo'lim")}</th><th>{t("Xodim")}</th><th className="num">{t("Miqdor")}</th><th>{t("Birlik")}</th><th className="num">{t("Tarif")}</th><th>{t("Valyuta")}</th><th className="num">{t("Summa")}</th><th /></tr></thead>
          <tbody>
            {B.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.operation_name}</td>
                <td className="small">{r.department}</td>
                <td>{editing ? (
                  <select className="cell" value={r.employee || ''} onChange={(e) => patch('services', r.id, { employee: e.target.value || null })}>
                    <option value="">{t('— xodim —')}</option>
                    {empList.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
                  </select>
                ) : (r.employee_name || <span className="muted">—</span>)}</td>
                <td className="num">{editing ? <CellNum value={r.qty} width={90} onSave={(x) => patch('services', r.id, { qty: x })} /> : qty(r.qty)}</td>
                <td>{t(r.unit)}</td>
                <td className="num">{editing ? <CellNum value={r.rate} width={110} onSave={(x) => patch('services', r.id, { rate: x })} /> : money(r.rate, r.currency)}</td>
                <td>{cur(r.currency)}</td>
                <td className="num">{money(r.amount, r.currency)}</td>
                <td className="num">{editing && <IconBtn icon="delete" danger title="O'chirish" onClick={() => del('services', r.id)} />}</td>
              </tr>
            ))}
            {editing && est && <AddServiceRow estimateId={est.id} operations={operations.data || []} employees={empList} onAdded={reload} />}
            {!B.rows.length && !editing && <tr><td colSpan={9} className="muted small">{t("Xizmatlar yo'q")}</td></tr>}
          </tbody>
        </table>
        <div className="hint" style={{ marginTop: 8 }}>{t("Xodim tanlansa, unga ishbay haq (bosqichning ishbay stavkasi × miqdor) oylik vedomost va KPI'ga yoziladi — D blokida ko'rinadi. Tarif — tannarxdagi xizmat narxi.")}</div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>{t("C. Biriktirilgan xarajatlar")} <span className="muted small">{t("(Moliyadan — sana va summa bitta manbadan)")}</span></h3>
          {blockTotal(C)}
        </div>
        <table className="t">
          <thead><tr><th>{t("Xarajat")}</th><th>{t("Sana")}</th><th>{t("Valyuta")}</th><th className="num">{t("Summa")}</th></tr></thead>
          <tbody>
            {C.rows.map((r) => (
              <tr key={r.id}><td>{r.name}</td><td>{shortDate(r.date)}</td><td>{cur(r.currency)}</td><td className="num">{money(r.amount, r.currency)}</td></tr>
            ))}
            {!C.rows.length && <tr><td colSpan={4} className="muted small">{t("Xarajat yo'q. Moliya → Chiqim/Xarajat kiritishda shu buyurtmani tanlang.")}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head"><h3>{t("D. Ish haqi ulushi (xizmatlar va topshiriqlar)")}</h3>{blockTotal(Dd)}</div>
        <table className="t">
          <thead><tr><th>{t('Xodim')}</th><th>{t('Ish')}</th><th>{t('Manba')}</th><th>{t('Sana')}</th><th className="num">{t('Miqdor')}</th><th className="num">{t('Stavka')}</th><th className="num">{t('Summa')}</th></tr></thead>
          <tbody>
            {Dd.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.employee}</td><td>{r.operation}</td>
                <td className="small muted">{r.source === 'estimate' ? t('smeta xizmati (tannarx B blokida)') : t('ishlab chiqarish topshirig\'i')}</td>
                <td>{shortDate(r.date)}</td><td className="num">{qty(r.qty)}</td>
                <td className="num">{money(r.rate, 'UZS')}</td><td className="num">{money(r.amount, 'UZS')}</td>
              </tr>
            ))}
            {!Dd.rows.length && <tr><td colSpan={7} className="muted small">{t("Ishbay yozuvlar hali yo'q")}</td></tr>}
          </tbody>
        </table>
      </div>

      {data.blocks.P?.rows.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>{t("P. Pozitsiyalar tannarxi (tovar va mahsulotlar)")}</h3>{blockTotal(data.blocks.P)}</div>
          <table className="t">
            <thead><tr><th>{t('Nomi')}</th><th className="num">{t('Miqdor')}</th><th className="num">{t("Jo'natilgan")}</th><th>{t('Asos')}</th><th className="num">{t('Tannarx')}</th></tr></thead>
            <tbody>
              {data.blocks.P.rows.map((r) => (
                <tr key={r.id}><td>{r.name}</td><td className="num">{qty(r.qty)} {t(r.unit)}</td><td className="num">{qty(r.shipped)}</td>
                  <td className="small muted">{t(r.basis)}</td><td className="num">{money(r.amount, r.currency)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ borderColor: profit < 0 ? 'var(--red)' : 'var(--border)' }}>
        <h3 style={{ marginBottom: 10 }}>{t("Jami tannarx va foyda")}</h3>
        <div className="stats" style={{ marginBottom: 0 }}>
          <div><div className="muted small">{t("Tannarx (valyuta bo'yicha)")}</div><div className="bold"><MoneyBag bag={data.total} /></div></div>
          <div><div className="muted small">Tannarx ({cur(data.currency)}ga keltirilgan)</div><div className="bold">{money(data.cost, data.currency)}</div></div>
          <div><div className="muted small">{t("Buyurtma summasi")}</div><div className="bold">{money(data.amount, data.currency)}</div></div>
          <div>
            <div className="muted small">{t("Foyda · rentabellik")}</div>
            <div className={'bold ' + (profit < 0 ? 'red' : 'green')}>{money(data.profit, data.currency)} · {data.margin_pct}%</div>
          </div>
        </div>
        <div className="hint">{t("A, B — buyurtma sanasidagi kurs; C — xarajat sanasidagi kurs; D — ishbay yozuvi sanasidagi kurs; P — jo'natilgani sotuvdagi haqiqiy tannarx, qolgani ombordagi o'rtacha tannarx. Rentabellik = foyda / buyurtma summasi.")}</div>
      </div>
    </>
  )
}
