"""Qo'shimcha maydonlar (extra JSON) qiymatlarini tekshirish."""
from datetime import date
from decimal import Decimal, InvalidOperation

from rest_framework import serializers

from .models import CustomField


def clean_extra(entity, value, partial=False, existing=None):
    value = value or {}
    if not isinstance(value, dict):
        raise serializers.ValidationError({"extra": "Noto'g'ri format"})
    out = dict(existing or {}) if partial else {}
    errors = {}
    for f in CustomField.objects.filter(entity=entity):
        if f.key not in value:
            if f.required and not partial and out.get(f.key) in (None, ""):
                errors[f.key] = f"\"{f.name}\" majburiy"
            continue
        v = value.get(f.key)
        if v in (None, ""):
            if f.required:
                errors[f.key] = f"\"{f.name}\" majburiy"
            out.pop(f.key, None)
            continue
        try:
            if f.type == CustomField.Type.NUMBER:
                v = str(Decimal(str(v)))
            elif f.type == CustomField.Type.DATE:
                v = date.fromisoformat(str(v)[:10]).isoformat()
            elif f.type == CustomField.Type.BOOL:
                v = v in (True, "true", "1", 1, "on")
            elif f.type == CustomField.Type.SELECT:
                if f.options and str(v) not in [str(o) for o in f.options]:
                    raise ValueError
                v = str(v)
            elif f.type == CustomField.Type.USER:
                v = int(v)
            else:
                v = str(v)[:1000]
        except (ValueError, InvalidOperation, TypeError):
            errors[f.key] = f"\"{f.name}\": noto'g'ri qiymat"
            continue
        out[f.key] = v
    if errors:
        raise serializers.ValidationError(errors)
    return out


def filter_by_extra(qs, params):
    """?x_<key>=qiymat — qo'shimcha maydon bo'yicha filtr (matn — qisman moslik)."""
    for k, v in params.items():
        if not k.startswith("x_") or v == "":
            continue
        key = k[2:]
        if not key.replace("_", "").isalnum():
            continue
        if v in ("true", "false"):
            qs = qs.filter(**{f"extra__{key}": v == "true"})
        elif v.lstrip("-").isdigit():
            qs = qs.filter(**{f"extra__{key}__in": [v, int(v)]})
        else:
            qs = qs.filter(**{f"extra__{key}__icontains": v})
    return qs
