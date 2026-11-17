from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from rest_framework.response import Response
from rest_framework.views import exception_handler

from .money import RateNotFound


def erp_exception_handler(exc, context):
    """Model darajasidagi ValidationError'larni ham 400 javobga aylantiradi."""
    if isinstance(exc, DjangoValidationError):
        detail = exc.message_dict if hasattr(exc, "error_dict") else {"detail": exc.messages}
        return Response(detail, status=400)
    if isinstance(exc, IntegrityError):
        msg = str(exc).lower()
        if "unique" in msg or "duplicate" in msg:
            return Response({"detail": "Bunday yozuv allaqachon mavjud (nom yoki raqam takrorlanmasligi kerak)"}, status=400)
        return Response({"detail": "Ma'lumotlar yaxlitligi buzildi"}, status=400)
    if isinstance(exc, RateNotFound):
        return Response({"detail": str(exc)}, status=400)
    return exception_handler(exc, context)
