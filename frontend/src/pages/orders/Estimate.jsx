import { useState } from 'react'
import api, { errorText } from '../../api'
import { Loading, MoneyBag, toast, useFetch } from '../../components/ui'
import { date, money, qty, shortDate } from '../../format'
import { t } from '../../i18n'
import Icon from '../../components/Icon'
import { IconBtn } from '../../components/Icon'
import { curLabel } from '../../currency'

function AddMaterialRow({ estimateId, materials, onAdded }) {
  const [v, setV] = useState({ material: '', qty: '', waste_pct: '0', price: '' })
  const mat = materials.find((m) => String(m.id) === String(v.material))
  const add = async () => {
    try {
      const payload = { estimate: estimateId, material: v.material, qty: v.qty, waste_pct: v.waste_pct || 0 }
      if (v.price) payload.price = v.price
      await api.post('/orders/estimate-materials/', payload)
      setV({ material: '', qty: '', waste_pct: '0', price: '' })
      onAdded()
    } catch (e) { toast(errorText(e), true) }
  }
  return (
    <tr>
      <td>
        <select value={v.material} onChange={(e) => setV({ ...v, material: e.target.value })} className="chip" style={{ width: '100%' }}>
          <option value="">{t("Material tanlang…")}</option>
          {materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({t(m.unit_display)}, {curLabel(m.currency)})</option>)}
        </select>
      </td>
      <td className="num"><input className="cell" placeholder={t("sarf")} value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} /></td>
      <td className="num"><input className="cell" style={{ width: 60 }} value={v.waste_pct} onChange={(e) => setV({ ...v, waste_pct: e.target.value })} /></td>
      <td className="num"><input className="cell" placeholder={t("o'rtacha")} value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} /></td>
      <td>{mat ? curLabel(mat.currency) : ''}</td>
      <td className="num"><button className="btn small primary" disabled={!v.material || !v.qty} onClick={add}>{t("Qo'shish")}</button></td>
      <td />
    </tr>
  )
}

function AddServiceRow({ estimateId, operations, onAdded }) {
  const [v, setV] = useState({ operation: '', qty: '', rate: '' })
  const op = operations.find((o) => String(o.id) === String(v.operation))
  const add = async () => {
    try {
      const payload = { estimate: estimateId, operation: v.operation, qty: v.qty }
      if (v.rate) payload.rate = v.rate
      await api.post('/orders/estimate-services/', payload)
      setV({ operation: '', qty: '', rate: '' })
      onAdded()
    } catch (e) { toast(errorText(e), true) }
  }
  return (
    <tr>
      <td>
        <select value={v.operation} onChange={(e) => setV({ ...v, operation: e.target.value })} className="chip" style={{ width: '100%' }}>
          <option value="">{t("Operatsiya tanlang…")}</option>
          {operations.map((o) => <option key={o.id} value={o.id}>{o.name} / {o.department_name}</option>)}
        </select>
      </td>
      <td className="num"><input className="cell" placeholder={t("miqdor")} value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} /></td>
      <td className="num">{op?.unit_display || ''}</td>
      <td className="num"><input className="cell" placeholder={op ? String(Number(op.default_rate)) : 'tarif'} value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} /></td>
      <td>{op ? curLabel(op.rate_currency) : ''}</td>
      <td className="num"><button className="btn small primary" disabled={!v.operation || !v.qty} onClick={add}>{t("Qo'shish")}</button></td>
      <td />
    </tr>
  )
}

const cur = curLabel

export default function Estimate({ order, onChanged }) {
  const { data, error, reload } = useFetch(`/orders/${order.id}/costing/`)
  const materials = useFetch('/warehouse/materials/')
  const operations = useFetch('/production/operations/')
  const [editing, setEditing] = useState(false)

  if (!data) return <Loading error={error} />
  const est = data.estimate
  const A = data.blocks.A, B = data.blocks.B, C = data.blocks.C, Dd = data.blocks.D
  const profit = Number(data.profit)

  const del = async (kind, id) => {
    try {
      await api.delete(`/orders/estimate-${kind}/${id}/`)
      reload()
    } catch (e) { toast(errorText(e), true) }
  }
  const newVersion = async () => {
    const note = window.prompt("Yangi versiya izohi (nima o'zgardi?)", '') ?? null
    if (note === null) return
    try {
      await api.post(`/orders/${order.id}/new_estimate/`, { note })
      toast('Yangi smeta versiyasi yaratildi')
      setEditing(true)
      reload()
      onChanged?.()
    } catch (e) { toast(errorText(e), true) }
  }
  const activate = async (id) => {
    await api.post(`/orders/estimates/${id}/activate/`)
    reload()
  }

  const blockTotal = (blk) => (
    <span className="small muted"> {t("Jami:")} <MoneyBag bag={blk.total} inline /> {Object.values(blk.total).some((x) => Number(x)) && `≈ ${money(blk.converted, data.currency)}`}</span>
  )

  return (
    <>
      <div className="card-head" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ display: 'inline', marginRight: 8 }}>Smeta {est ? `v${est.version}` : ''}</h2>
          <span className="muted small">{t('Buyurtma valyutasi')}: {cur(data.currency)} · {t('Kurs')}: {data.rate ? `1 USD = ${qty(data.rate)} ${t("so'm")} (${date(order.date)})` : t('kiritilmagan')}</span>
          {est?.note && <div className="small muted">Izoh: {est.note}</div>}
        </div>
        <div className="filters">
          {data.versions.length > 1 && (
            <select className="chip" value={est?.id || ''} onChange={(e) => activate(e.target.value)}>
              {data.versions.map((v) => <option key={v.id} value={v.id}>v{v.version}{v.is_active ? ' (faol)' : ''}</option>)}
            </select>
          )}
          <button className={'btn small' + (editing ? ' active' : '')} onClick={() => setEditing((e) => !e)} title={t(editing ? 'Tahrirni yopish' : 'Tahrirlash')}><Icon name={editing ? 'check' : 'edit'} size={15} />{editing ? ' ' + t('Tayyor') : ''}</button>
          <button className="btn small" onClick={newVersion}>{t("+ Yangi versiya")}</button>
        </div>
      </div>
      {data.warnings.map((w) => <div key={w} className="error">{w}</div>)}

      <div className="card">
        <div className="card-head"><h3>{t("A. Materiallar (ombordan)")}</h3>{blockTotal(A)}</div>
        <table className="t">
          <thead><tr><th>{t("Material")}</th><th className="num">{t("Sarf")}</th><th className="num">{t("Chiqindi")}</th><th className="num">{t("Narx")}</th><th>{t("Valyuta")}</th><th className="num">{t("Summa")}</th><th /></tr></thead>
          <tbody>
            {A.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.material_name}</td>
                <td className="num">{qty(r.qty)} {r.unit}</td>
                <td className="num">{qty(r.waste_pct)}%</td>
                <td className="num">{money(r.price, r.currency)}</td>
                <td>{cur(r.currency)}</td>
                <td className="num">{money(r.amount, r.currency)}</td>
                <td className="num">{editing && <IconBtn icon="delete" danger title="O\'chirish" onClick={() => del('materials', r.id)} />}</td>
              </tr>
            ))}
            {editing && est && <AddMaterialRow estimateId={est.id} materials={materials.data || []} onAdded={reload} />}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head"><h3>{t("B. Xizmatlar (operatsiyalar)")}</h3>{blockTotal(B)}</div>
        <table className="t">
          <thead><tr><th>{t("Operatsiya / bo'lim")}</th><th className="num">{t("Miqdor")}</th><th className="num">{t("Birlik")}</th><th className="num">{t("Tarif")}</th><th>{t("Valyuta")}</th><th className="num">{t("Summa")}</th><th /></tr></thead>
          <tbody>
            {B.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.operation_name} / {r.department}</td>
                <td className="num">{qty(r.qty)}</td>
                <td className="num">{r.unit}</td>
                <td className="num">{money(r.rate, r.currency)}</td>
                <td>{cur(r.currency)}</td>
                <td className="num">{money(r.amount, r.currency)}</td>
                <td className="num">{editing && <IconBtn icon="delete" danger title="O\'chirish" onClick={() => del('services', r.id)} />}</td>
              </tr>
            ))}
            {editing && est && <AddServiceRow estimateId={est.id} operations={operations.data || []} onAdded={reload} />}
          </tbody>
        </table>
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
        <div className="card-head"><h3>{t("D. Ish haqi ulushi (ishbay topshiriqlardan)")}</h3>{blockTotal(Dd)}</div>
        <table className="t">
          <tbody>
            {Dd.rows.map((r) => (
              <tr key={r.id}><td>{r.employee} · {r.operation}</td><td>{shortDate(r.date)}</td><td className="num">{qty(r.qty)}</td><td>{t("so'm")}</td><td className="num">{money(r.amount, 'UZS')}</td></tr>
            ))}
            {!Dd.rows.length && <tr><td className="muted small">{t("Ishbay yozuvlar hali yo'q")}</td></tr>}
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
