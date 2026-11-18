"""Valyutalar: ma'lumotnoma va CBU (O'zbekiston Markaziy banki) kurslarini avtomatik olish."""
import json
import logging
import urllib.request
from datetime import date as date_cls
from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.core.cache import cache

from .models import BASE_CURRENCY, CurrencyDef, ExchangeRate
from .tenancy import current_company_id

log = logging.getLogger(__name__)

CBU_URL = "https://cbu.uz/uz/arkhiv-kursov-valyut/json/"
CBU_DATE_URL = "https://cbu.uz/uz/arkhiv-kursov-valyut/json/all/{d}/"
DEFAULTS = [
    ("UZS", "O'zbek so'mi", "so'm", True),
    ("USD", "AQSh dollari", "$", False),
]


def ensure_default_currencies(company=None):
    """Kompaniya uchun asosiy valyutalar (so'm — asosiy, USD)."""
    kw = {"company": company} if company else {}
    for i, (code, name, symbol, is_base) in enumerate(DEFAULTS):
        CurrencyDef.objects.get_or_create(code=code, defaults={
            "name": name, "symbol": symbol, "is_base": is_base, "auto_update": not is_base, "position": i, **kw})


def fetch_cbu(on_date=None):
    """CBU JSON: [{Ccy, CcyNm_UZ, Rate, Nominal, Date}, ...]. Kesh — 1 soat."""
    key = f"cbu:{on_date or 'today'}"
    data = cache.get(key)
    if data is not None:
        return data
    url = CBU_DATE_URL.format(d=on_date.isoformat()) if on_date else CBU_URL
    req = urllib.request.Request(url, headers={"User-Agent": "erp-client/1.0"})
    with urllib.request.urlopen(req, timeout=8) as resp:  # noqa: S310 — faqat CBU manzili
        data = json.loads(resp.read().decode("utf-8"))
    cache.set(key, data, 3600)
    return data


def cbu_currencies():
    """CBU ro'yxati: [{code, name, rate, date}] — yangi valyuta qo'shishda tanlash uchun."""
    rows = []
    for r in fetch_cbu():
        rows.append({"code": r.get("Ccy"), "name": r.get("CcyNm_UZ") or r.get("CcyNm_RU"), "rate": r.get("Rate"),
                     "nominal": r.get("Nominal"), "date": r.get("Date")})
    return rows


def _parse(r):
    rate = Decimal(str(r["Rate"]))
    nominal = Decimal(str(r.get("Nominal") or "1"))
    day = datetime.strptime(r["Date"], "%d.%m.%Y").date()
    return (rate / nominal).quantize(Decimal("0.0001")), day


def update_rates(codes=None, force=False):
    """Joriy kompaniyaning auto_update valyutalari uchun CBU kursini yozadi.

    Qaytaradi: {"updated": [...], "errors": [...]}. Tarmoq xatosi bo'lsa — jim (qo'lda kiritish mumkin).
    """
    qs = CurrencyDef.objects.filter(is_active=True).exclude(code=BASE_CURRENCY)
    qs = qs.filter(code__in=codes) if codes else qs.filter(auto_update=True)
    wanted = {c.code for c in qs}
    result = {"updated": [], "errors": []}
    if not wanted:
        return result
    if not force:
        today = date_cls.today()
        have = set(ExchangeRate.objects.filter(date=today, currency__in=wanted).values_list("currency", flat=True))
        wanted -= have
        if not wanted:
            return result
    try:
        data = fetch_cbu()
    except Exception as e:  # tarmoq yo'q — qo'lda kiritiladi
        log.warning("CBU kurslarini olishda xato: %s", e)
        result["errors"].append(f"CBU bilan aloqa yo'q: {e}")
        return result
    for r in data:
        code = r.get("Ccy")
        if code not in wanted:
            continue
        try:
            rate, day = _parse(r)
        except (KeyError, ValueError, InvalidOperation):
            result["errors"].append(f"{code}: noto'g'ri ma'lumot")
            continue
        obj, created = ExchangeRate.objects.get_or_create(currency=code, date=day, defaults={"usd_uzs": rate, "source": "CBU"})
        if not created and obj.source == "CBU" and obj.usd_uzs != rate:
            obj.usd_uzs = rate
            obj.save()
        # bugungi sana uchun ham yozamiz (CBU kursi ertangi sanadan amal qilishi mumkin)
        today = date_cls.today()
        if day != today and not ExchangeRate.objects.filter(currency=code, date=today).exists() and day < today:
            ExchangeRate.objects.create(currency=code, date=today, usd_uzs=rate, source="CBU")
        result["updated"].append({"code": code, "rate": str(rate), "date": day.isoformat()})
    return result


def auto_update_once_a_day():
    """Kuniga bir marta (kompaniya bo'yicha) avtomatik yangilash — valyutalar ro'yxati ochilganda."""
    cid = current_company_id()
    key = f"cbu:auto:{cid}:{date_cls.today()}"
    if cache.get(key):
        return None
    cache.set(key, 1, 6 * 3600)
    return update_rates()
