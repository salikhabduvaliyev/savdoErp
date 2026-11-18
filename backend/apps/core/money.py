"""Ko'p valyutali summalar bilan ishlash.

Asosiy qoida: so'm va USD hech qachon jim aylantirib qo'shilmaydi.
Jamilar har doim valyuta bo'yicha alohida (MoneyBag) qaytariladi.
Aylantirish faqat `convert()` orqali, aniq sana va kurs bilan.
"""
from collections import defaultdict
from contextvars import ContextVar
from datetime import date as date_cls
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Sum

from .models import BASE_CURRENCY, Currency, ExchangeRate
from .tenancy import current_company_id

ZERO = Decimal("0")
CENT = Decimal("0.01")


def q2(value) -> Decimal:
    return Decimal(value or 0).quantize(CENT, rounding=ROUND_HALF_UP)


class MoneyBag:
    """Valyuta → summa. Har doim ikkala valyuta kalitlari mavjud."""

    def __init__(self, data=None):
        self._d = defaultdict(lambda: ZERO)
        for cur in Currency.values:
            self._d[cur] = ZERO
        if data:
            for cur, amount in dict(data).items():
                self.add(amount, cur)

    def add(self, amount, currency):
        self._d[currency] += Decimal(amount or 0)
        return self

    def __add__(self, other):
        res = MoneyBag(self._d)
        for cur, amount in other._d.items():
            res.add(amount, cur)
        return res

    def __sub__(self, other):
        res = MoneyBag(self._d)
        for cur, amount in other._d.items():
            res.add(-amount, cur)
        return res

    def __getitem__(self, cur):
        return self._d[cur]

    def items(self):
        return self._d.items()

    def as_dict(self):
        return {cur: str(q2(v)) for cur, v in self._d.items()}

    def to_currency(self, target, on_date=None):
        """Bitta valyutaga keltirish (faqat hisobot uchun)."""
        total = ZERO
        for cur, amount in self._d.items():
            total += convert(amount, cur, target, on_date)
        return q2(total)


def sum_by_currency(qs, amount_field="amount", currency_field="currency") -> MoneyBag:
    bag = MoneyBag()
    for row in qs.values(currency_field).annotate(total=Sum(amount_field)):
        bag.add(row["total"], row[currency_field])
    return bag


class RateNotFound(Exception):
    pass


# So'rov ichidagi kurs keshi (TenantMiddleware har so'rovda yangilaydi). Kontekst yo'q bo'lsa — kesh yo'q.
_rate_cache: ContextVar = ContextVar("erp_rate_cache", default=None)


def reset_rate_cache(enabled=True):
    _rate_cache.set({} if enabled else None)


def get_rate(on_date=None, currency="USD") -> Decimal:
    """Berilgan sanadagi yoki undan oldingi eng yaqin kurs: 1 birlik valyuta = ? so'm."""
    if currency == BASE_CURRENCY:
        return Decimal("1")
    on_date = on_date or date_cls.today()
    cache = _rate_cache.get()
    key = (current_company_id(), currency, on_date)
    if cache is not None and key in cache:
        return cache[key]
    qs = ExchangeRate.objects.filter(currency=currency)
    rate = qs.filter(date__lte=on_date).order_by("-date").first()
    if rate is None:
        rate = qs.order_by("date").first()
    if rate is None:
        raise RateNotFound(f"{currency} kursi kiritilmagan (Sozlamalar → Valyutalar)")
    if cache is not None:
        cache[key] = rate.usd_uzs
    return rate.usd_uzs


def convert(amount, from_cur, to_cur, on_date=None) -> Decimal:
    amount = Decimal(amount or 0)
    if from_cur == to_cur or amount == 0:
        return amount
    # kross-kurs asosiy valyuta (so'm) orqali
    return amount * get_rate(on_date, from_cur) / get_rate(on_date, to_cur)
