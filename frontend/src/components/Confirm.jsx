// Brauzer confirm()/prompt() o'rniga ilova uslubidagi modal (Ha / Yo'q).
// Foydalanish: if (!(await confirmDialog("O'chirilsinmi?", { danger: true }))) return
//              const name = await promptDialog('Yangi mijoz nomi')   // bekor qilinsa — null
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { t } from '../i18n'

function Dialog({ message, input, initial, okText, cancelText, danger, done }) {
  const [val, setVal] = useState(initial ?? '')
  const okRef = useRef(null)
  const inRef = useRef(null)
  useEffect(() => {
    (input ? inRef : okRef).current?.focus()
    const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(input ? null : false) } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [])
  const ok = () => done(input ? val : true)
  return (
    <div className="modal-back confirm-back" onMouseDown={(e) => e.target === e.currentTarget && done(input ? null : false)}>
      <div className="modal confirm-box" role="alertdialog" aria-modal="true">
        <div className="confirm-msg">{String(message).split('\n').map((l, i) => <p key={i}>{l}</p>)}</div>
        {input && (
          <input ref={inRef} className="confirm-input" value={val} onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ok() } }} />
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => done(input ? null : false)}>{cancelText || t(input ? 'Bekor' : "Yo'q")}</button>
          <button type="button" ref={okRef} className={'btn ' + (danger ? 'danger' : 'primary')} onClick={ok}>{okText || t(input ? 'OK' : 'Ha')}</button>
        </div>
      </div>
    </div>
  )
}

function open(props) {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const done = (v) => { root.unmount(); host.remove(); resolve(v) }
    root.render(<Dialog {...props} done={done} />)
  })
}

/** Ha/Yo'q modal → Promise<boolean>. opts: { okText, cancelText, danger } */
const DANGER = /o'chiril|удал|bekor qilin|отмен/i
export const confirmDialog = (message, opts = {}) => open({ message, danger: DANGER.test(String(message)), ...opts })

/** Matn kiritish modali → Promise<string|null> */
export const promptDialog = (message, initial = '', opts = {}) => open({ message, input: true, initial, ...opts })
