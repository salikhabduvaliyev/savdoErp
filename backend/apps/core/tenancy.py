"""Ko'p kompaniyali (multi-tenant) rejim.

Har bir so'rovda joriy kompaniya va filial `contextvars` da saqlanadi:
  * TenantMiddleware — so'rov boshida kontekstni tozalaydi;
  * ModulePermission (autentifikatsiyadan keyin) — foydalanuvchi kompaniyasini o'rnatadi;
  * TenantManager — kontekst bo'lsa so'rovlarni avtomatik `company` bo'yicha filtrlaydi;
  * TenantModel.save — `company` bo'sh bo'lsa kontekstdan oladi.

Kontekst yo'q bo'lsa (admin panel, migratsiya, buyruqlar) — filtr qo'llanmaydi.
"""
from contextlib import contextmanager
from contextvars import ContextVar

from django.db import models

_company: ContextVar = ContextVar("erp_company", default=None)
_branch: ContextVar = ContextVar("erp_branch", default=None)


def current_company_id():
    return _company.get()


def current_branch_id():
    return _branch.get()


def set_context(company_id=None, branch_id=None):
    _company.set(company_id)
    _branch.set(branch_id)


@contextmanager
def tenant_context(company, branch=None):
    """Buyruqlar va testlar uchun: with tenant_context(company): ..."""
    t1 = _company.set(getattr(company, "pk", company))
    t2 = _branch.set(getattr(branch, "pk", branch))
    try:
        yield
    finally:
        _company.reset(t1)
        _branch.reset(t2)


class TenantMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from .money import reset_rate_cache

        set_context(None, None)
        reset_rate_cache()
        try:
            return self.get_response(request)
        finally:
            set_context(None, None)
            reset_rate_cache(False)


class TenantManager(models.Manager):
    def get_queryset(self):
        qs = super().get_queryset()
        cid = _company.get()
        return qs.filter(company_id=cid) if cid else qs


class TenantModel(models.Model):
    company = models.ForeignKey("core.Company", on_delete=models.CASCADE, related_name="+", editable=False)

    objects = TenantManager()
    all_objects = models.Manager()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if not self.company_id:
            cid = _company.get()
            if not cid:
                raise RuntimeError(f"{type(self).__name__}: kompaniya konteksti o'rnatilmagan")
            self.company_id = cid
        super().save(*args, **kwargs)


def branch_filter(qs, field="branch"):
    """Tanlangan filial bo'yicha filtr (filial tanlanmagan bo'lsa — hammasi)."""
    bid = _branch.get()
    return qs.filter(**{f"{field}_id" if "__" not in field else field: bid}) if bid else qs
