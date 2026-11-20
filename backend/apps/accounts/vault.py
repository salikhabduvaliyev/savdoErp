"""Joriy parollarni platforma admini ko'rishi uchun shifrlangan saqlash (egasining qarori bilan).

Parol bazada ochiq matnda emas: Fernet (AES-128 + HMAC) bilan shifrlanadi. Kalit — PASSWORD_VAULT_KEY
muhit o'zgaruvchisi, bo'lmasa DJANGO SECRET_KEY'dan olinadi. Kirish uchun Django hash ishlatiladi (bu faqat ko'rsatish uchun).
"""
import base64
import hashlib
import os

from django.conf import settings


def _fernet():
    from cryptography.fernet import Fernet

    secret = os.environ.get("PASSWORD_VAULT_KEY") or settings.SECRET_KEY
    key = base64.urlsafe_b64encode(hashlib.sha256(("vault:" + secret).encode()).digest())
    return Fernet(key)


def seal(raw):
    if not raw:
        return ""
    try:
        return _fernet().encrypt(raw.encode()).decode()
    except Exception:  # noqa: BLE001 — kutubxona yo'q bo'lsa kirishga xalaqit bermasin
        return ""


def unseal(token):
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except Exception:  # noqa: BLE001 — kalit almashgan bo'lsa
        return None
