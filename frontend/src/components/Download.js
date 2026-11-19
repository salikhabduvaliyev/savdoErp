// Fayl yuklab olish (JWT bilan): xlsx / csv — serverdan blob sifatida
import api, { errorText } from '../api'
import { toast } from './ui'

export async function downloadFile(path, params, fallbackName) {
  try {
    const res = await api.get(path, { params, responseType: 'blob' })
    const cd = res.headers['content-disposition'] || ''
    const name = (cd.match(/filename="?([^";]+)"?/) || [])[1] || fallbackName
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  } catch (e) {
    let msg = errorText(e)
    if (e.response?.data instanceof Blob) {
      try { msg = JSON.parse(await e.response.data.text()).detail || msg } catch { /* matn emas */ }
    }
    toast(msg, true)
  }
}
