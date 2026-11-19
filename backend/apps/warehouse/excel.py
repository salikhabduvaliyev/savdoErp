"""Excel (xlsx) / CSV: qoldiqlarni yuklab olish va hujjat pozitsiyalarini import qilish (MoySklad "Импорт")."""
import csv
import io
from decimal import Decimal, InvalidOperation

from django.http import HttpResponse

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _book():
    from openpyxl import Workbook

    return Workbook()


def _style_header(ws, ncols):
    from openpyxl.styles import Alignment, Font, PatternFill

    fill = PatternFill("solid", fgColor="E8EEF8")
    for c in range(1, ncols + 1):
        cell = ws.cell(row=1, column=c)
        cell.font = Font(bold=True)
        cell.fill = fill
        cell.alignment = Alignment(vertical="center", wrap_text=True)
    ws.freeze_panes = "A2"


def _autowidth(ws):
    for col in ws.columns:
        width = max((len(str(c.value)) for c in col if c.value is not None), default=8)
        ws.column_dimensions[col[0].column_letter].width = min(max(width + 2, 8), 60)


def xlsx_response(sheets, filename):
    """sheets: [(title, headers, rows, totals_row|None)]"""
    wb = _book()
    wb.remove(wb.active)
    for title, headers, rows, total in sheets:
        ws = wb.create_sheet(title[:31])
        ws.append(headers)
        for r in rows:
            ws.append(r)
        if total:
            from openpyxl.styles import Font

            ws.append(total)
            for c in ws[ws.max_row]:
                c.font = Font(bold=True)
        _style_header(ws, len(headers))
        _autowidth(ws)
    buf = io.BytesIO()
    wb.save(buf)
    resp = HttpResponse(buf.getvalue(), content_type=XLSX)
    resp["Content-Disposition"] = f'attachment; filename="{filename}.xlsx"'
    return resp


def csv_response(headers, rows, filename):
    buf = io.StringIO()
    buf.write("﻿")  # Excel UTF-8 ni to'g'ri ochishi uchun
    w = csv.writer(buf, delimiter=";")
    w.writerow(headers)
    for r in rows:
        w.writerow(["" if v is None else str(v).replace(".", ",") if isinstance(v, (Decimal, float)) else v for v in r])
    resp = HttpResponse(buf.getvalue(), content_type="text/csv; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="{filename}.csv"'
    return resp


# ---------------------------------------------------------------- import
HEADER_ALIASES = {
    "code": {"kod", "код", "code"},
    "sku": {"artikul", "артикул", "sku"},
    "barcode": {"shtrix-kod", "shtrix kod", "shtrixkod", "штрихкод", "штрих-код", "barcode"},
    "name": {"nomi", "nom", "tovar", "наименование", "название", "name", "товар"},
    "qty": {"miqdor", "miqdori", "количество", "кол-во", "qty", "quantity", "soni"},
    "price": {"narx", "narxi", "цена", "price"},
}


def _num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float, Decimal)):
        return Decimal(str(v))
    s = str(v).strip().replace("\xa0", "").replace(" ", "").replace(",", ".")
    try:
        return Decimal(s)
    except InvalidOperation:
        raise ValueError(f"'{v}' — son emas")


def read_table(upload):
    """Faylni o'qiydi: [[cell, ...], ...] (birinchi qator — sarlavha)."""
    name = (upload.name or "").lower()
    data = upload.read()
    if name.endswith(".csv"):
        text = data.decode("utf-8-sig", errors="replace")
        delim = ";" if text.count(";") >= text.count(",") else ","
        return [row for row in csv.reader(io.StringIO(text), delimiter=delim)]
    if name.endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook

        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        ws = wb.worksheets[0]
        return [list(r) for r in ws.iter_rows(values_only=True)]
    raise ValueError("Faqat .xlsx yoki .csv fayl qabul qilinadi")


def parse_items(upload, materials_qs, with_price=True):
    """Pozitsiyalarni o'qib, tovarlarni kod → artikul → shtrix-kod → nom bo'yicha topadi.
    Qaytaradi: (lines, errors)."""
    rows = read_table(upload)
    rows = [r for r in rows if any(c not in (None, "") for c in r)]
    if not rows:
        return [], ["Fayl bo'sh"]
    head = [str(c or "").strip().lower() for c in rows[0]]
    col = {}
    for key, names in HEADER_ALIASES.items():
        for i, h in enumerate(head):
            if h in names or h.rstrip("*").strip() in names:
                col[key] = i
                break
    if "qty" not in col or not ({"code", "sku", "barcode", "name"} & set(col)):
        return [], ["Sarlavha topilmadi: kamida \"Kod\" yoki \"Nomi\" va \"Miqdor\" ustunlari kerak (shablonni yuklab oling)"]

    mats = list(materials_qs.only("id", "name", "code", "sku", "barcode", "unit", "currency", "purchase_price"))
    idx = {k: {} for k in ("code", "sku", "barcode", "name")}
    for m in mats:
        for k in idx:
            v = (getattr(m, k) or "").strip().lower()
            if v:
                idx[k].setdefault(v, m)

    def cell(r, k):
        i = col.get(k)
        return r[i] if i is not None and i < len(r) else None

    lines, errors = {}, []
    for n, r in enumerate(rows[1:], start=2):
        m = None
        for k in ("code", "sku", "barcode", "name"):
            v = cell(r, k)
            if v not in (None, ""):
                key = str(v).strip().lower()
                if k == "code" and isinstance(v, (int, float)):
                    key = str(int(v)).zfill(5)
                m = idx[k].get(key) or (idx[k].get(key.lstrip("0")) if k == "code" else None)
                if m:
                    break
        label = cell(r, "name") or cell(r, "code") or cell(r, "sku") or ""
        if not m:
            errors.append(f"{n}-qator: tovar topilmadi — {label}")
            continue
        try:
            qty = _num(cell(r, "qty"))
            price = _num(cell(r, "price")) if with_price else None
        except ValueError as e:
            errors.append(f"{n}-qator: {e}")
            continue
        if qty is None or qty == 0:
            errors.append(f"{n}-qator: miqdor ko'rsatilmagan — {label}")
            continue
        if qty < 0:
            errors.append(f"{n}-qator: miqdor manfiy — {label}")
            continue
        if m.id in lines:  # bir xil tovar takrorlansa — miqdor qo'shiladi
            lines[m.id]["qty"] = str(Decimal(lines[m.id]["qty"]) + qty)
            if price is not None:
                lines[m.id]["price"] = str(price)
            continue
        lines[m.id] = {"material": m.id, "name": m.name, "code": m.code, "unit": m.get_unit_display(),
                       "qty": str(qty), "price": str(price) if price is not None else None, "currency": m.currency,
                       "purchase_price": str(m.purchase_price)}
    return list(lines.values()), errors


def template_response(doc_type, materials, with_price=True):
    headers = ["Kod", "Artikul", "Nomi", "Miqdor"] + (["Narx"] if with_price else [])
    sample = []
    for m in materials[:3]:
        sample.append([m.code, m.sku, m.name, 1] + ([float(m.purchase_price)] if with_price else []))
    ref = [[m.code, m.sku, m.barcode, m.name, m.get_unit_display(), float(m.purchase_price), m.currency] for m in materials]
    return xlsx_response([
        ("Import", headers, sample, None),
        ("Tovarlar (ma'lumotnoma)", ["Kod", "Artikul", "Shtrix-kod", "Nomi", "Birlik", "Xarid narxi", "Valyuta"], ref, None),
    ], f"shablon-{doc_type}")
