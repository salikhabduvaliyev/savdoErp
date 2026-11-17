import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { t } from '../i18n'
import Icon from './Icon'

/**
 * Sahifa sozlamalari (MoySklad ⚙): qaysi ustun va bo'limlar ko'rinadi, jadval zichligi.
 * const view = usePageSettings('orders', { columns: [...], sections: [...] })
 * view.show('amount') — ustun/bo'lim ko'rinadimi
 */
// eslint-disable-next-line react-refresh/only-export-components
export function usePageSettings(id, { columns = [], sections = [] } = {}) {
  const { prefs, setPref } = useAuth()
  const key = `page.${id}`
  const cfg = prefs[key] || {}
  const hidden = new Set(cfg.hidden || defaultsHidden(columns, sections))
  const show = (k) => !hidden.has(k)
  const toggle = (k) => {
    const next = new Set(hidden)
    next.has(k) ? next.delete(k) : next.add(k)
    setPref(key, { ...cfg, hidden: [...next] })
  }
  const reset = () => setPref(key, null)
  const density = cfg.density || 'comfort'
  const setDensity = (d) => setPref(key, { ...cfg, hidden: [...hidden], density: d })
  return { show, toggle, reset, density, setDensity, columns, sections, tableClass: density === 'compact' ? 't compact' : 't' }
}

function defaultsHidden(columns, sections) {
  return [...columns, ...sections].filter((c) => c.hidden).map((c) => c.key)
}

export default function PageSettings({ view, extra }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div className="gear-wrap" ref={ref}>
      <button className="icon-btn" title={t('Sahifa sozlamalari')} onClick={() => setOpen((o) => !o)} style={{ border: '1px solid var(--border)' }}>
        <Icon name="settings" size={17} />
      </button>
      {open && (
        <div className="gear-panel">
          <h4>{t('Qator o\'lchami')}</h4>
          <div className="segmented" style={{ width: '100%' }}>
            <button className={view.density === 'compact' ? 'active' : ''} onClick={() => view.setDensity('compact')} style={{ flex: 1 }}>{t('Ixcham')}</button>
            <button className={view.density !== 'compact' ? 'active' : ''} onClick={() => view.setDensity('comfort')} style={{ flex: 1 }}>{t('Qulay')}</button>
          </div>
          {view.sections.length > 0 && (
            <>
              <hr />
              <h4>{t("Bo'limlar")}</h4>
              {view.sections.map((c) => (
                <label key={c.key} className="check"><input type="checkbox" checked={view.show(c.key)} onChange={() => view.toggle(c.key)} /> {t(c.label)}</label>
              ))}
            </>
          )}
          {view.columns.length > 0 && (
            <>
              <hr />
              <h4>{t("Ustunlar")}</h4>
              {view.columns.map((c) => (
                <label key={c.key} className="check">
                  <input type="checkbox" checked={view.show(c.key)} disabled={c.fixed} onChange={() => view.toggle(c.key)} /> {t(c.label)}
                </label>
              ))}
            </>
          )}
          {extra && <><hr />{extra}</>}
          <hr />
          <button className="link-btn small" onClick={view.reset}>{t('Standart holatga qaytarish')}</button>
        </div>
      )}
    </div>
  )
}
