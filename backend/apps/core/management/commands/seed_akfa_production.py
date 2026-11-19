"""Akfa (alyumin/PVX rom) ishlab chiqarishi uchun namunaviy ma'lumotlar va to'liq jarayon sinovi.

Ishlatish:  python manage.py seed_akfa_production --company Romax
Hamma amallar haqiqiy API orqali (kompaniya egasi nomidan) bajariladi — validatsiyalar ham sinaladi.
Takroriy ishga tushirilsa — mavjud ma'lumotnomalar qayta yaratilmaydi.
"""
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.models import Company


class Command(BaseCommand):
    help = "Akfa ishlab chiqarishi: ma'lumotnomalar, xarid, ishlab chiqarish, sotuv va foyda-zarar sinovi"

    def add_arguments(self, parser):
        parser.add_argument("--company", required=True)

    # ------------------------------------------------------------ yordamchilar
    def call(self, method, url, data=None, ok=(200, 201)):
        r = getattr(self.api, method)(f"/api/{url}", data, format="json")
        if r.status_code not in ok:
            raise CommandError(f"{method.upper()} {url} → {r.status_code}: {r.content.decode()[:400]}")
        return r.json() if r.content else None

    def rows(self, url, **params):
        r = self.api.get(f"/api/{url}", params)
        d = r.json()
        return d.get("results", d) if isinstance(d, dict) else d

    def get_or_create(self, url, key, value, payload):
        for row in self.rows(url):
            if row.get(key) == value:
                return row
        return self.call("post", url, payload)

    def ok(self, msg):
        self.stdout.write(self.style.SUCCESS("✓ ") + msg)

    # ------------------------------------------------------------ asosiy
    def handle(self, *args, **opts):
        company = Company.objects.filter(name=opts["company"]).first()
        if not company:
            raise CommandError("Kompaniya topilmadi")
        owner = User.objects.filter(company=company, is_owner=True).first() or User.objects.filter(company=company).first()
        self.api = APIClient(SERVER_NAME="localhost")
        self.api.force_authenticate(owner)
        today = timezone.localdate().isoformat()
        wh = self.rows("warehouse/warehouses/")[0]["id"]

        # 1. Kontragentlar
        akfa = self.get_or_create("crm/counterparties/", "name", "Akfa Aluminium MChJ", {"name": "Akfa Aluminium MChJ", "inn": "", "phone": "+998 71 200 00 00"})
        glass = self.get_or_create("crm/counterparties/", "name", "Shisha Savdo", {"name": "Shisha Savdo", "phone": "+998 90 111 22 33"})
        furn = self.get_or_create("crm/counterparties/", "name", "Furnitura Markaz (Roto)", {"name": "Furnitura Markaz (Roto)"})
        client = self.get_or_create("crm/counterparties/", "name", "Anvar aka (qurilish)", {"name": "Anvar aka (qurilish)", "phone": "+998 93 555 44 33"})
        self.ok("Kontragentlar: Akfa Aluminium, Shisha Savdo, Furnitura Markaz, mijoz Anvar aka")

        # 2. Tovar guruhlari va materiallar
        g = {n: self.get_or_create("warehouse/groups/", "name", n, {"name": n})["id"]
             for n in ["Akfa profillar", "Oyna", "Furnitura va aksessuar", "Tayyor mahsulot"]}
        mats_spec = [
            # nom, guruh, birlik, valyuta, xarid narxi, yetkazuvchi
            ("Akfa rom profili 6063 (oq)", "Akfa profillar", "m", "UZS", "46000", akfa),
            ("Akfa stvorka profili (oq)", "Akfa profillar", "m", "UZS", "43000", akfa),
            ("Akfa impost profili", "Akfa profillar", "m", "UZS", "38000", akfa),
            ("Armatura (temir kuchaytirgich)", "Akfa profillar", "m", "UZS", "12000", akfa),
            ("Oyna 4 mm (stekolpaket)", "Oyna", "m2", "UZS", "165000", glass),
            ("Rezina uplotnitel", "Furnitura va aksessuar", "m", "UZS", "3500", furn),
            ("Furnitura to'plami Roto", "Furnitura va aksessuar", "set", "USD", "14.50", furn),
            ("Shurup / vint", "Furnitura va aksessuar", "pcs", "UZS", "250", furn),
        ]
        m = {}
        for name, grp, unit, cur, price, sup in mats_spec:
            m[name] = self.get_or_create("warehouse/products/", "name", name, {
                "name": name, "type": "raw", "group": g[grp], "unit": unit, "currency": cur, "purchase_price": price,
                "supplier": sup["id"], "min_qty": "0"})["id"]
        pts = self.rows("warehouse/price-types/")
        retail = next((p for p in pts if p["is_default"]), pts[0])
        products = {}
        for name, price in [("Deraza 1200×1500 (2 stvorkali, oq)", "2450000"), ("Balkon eshigi 800×2100 (oq)", "2900000")]:
            products[name] = self.get_or_create("warehouse/products/", "name", name, {
                "name": name, "type": "product", "group": g["Tayyor mahsulot"], "unit": "pcs", "currency": "UZS",
                "purchase_price": "0", "prices": {str(retail["id"]): price}})["id"]
        self.ok(f"Materiallar: {len(m)} ta (1 tasi USD'da), tayyor mahsulot: {len(products)} ta")

        # 3. Bo'limlar, bosqichlar (ishbay tarif bilan) va xodimlar
        deps = {}
        for seq, (name, cap) in enumerate([("Kesish", 40), ("Payvandlash", 30), ("Yig'ish (furnitura)", 25), ("Oynalash", 30), ("Qadoqlash", 50)], 1):
            deps[name] = self.get_or_create("production/departments/", "name", name, {"name": name, "sequence": seq, "daily_capacity": cap})["id"]
        ops = {}
        for name, dep, rate in [("Profil kesish", "Kesish", "15000"), ("Burchak payvandlash", "Payvandlash", "20000"),
                                ("Furnitura o'rnatish", "Yig'ish (furnitura)", "25000"), ("Oyna o'rnatish", "Oynalash", "15000"),
                                ("Qadoqlash", "Qadoqlash", "5000")]:
            ops[name] = self.get_or_create("production/operations/", "name", name, {
                "name": name, "department": deps[dep], "unit": "pcs", "default_rate": "0", "rate_currency": "UZS", "piece_rate": rate})["id"]
        emps = {}
        for name, dep in [("Bekzod (kesuvchi)", "Kesish"), ("Jasur (payvandchi)", "Payvandlash"), ("Sardor (yig'uvchi)", "Yig'ish (furnitura)"),
                          ("Otabek (oynachi)", "Oynalash"), ("Diyor (qadoqlovchi)", "Qadoqlash")]:
            emps[dep] = self.get_or_create("hr/employees/", "full_name", name, {"full_name": name, "department": deps[dep], "pay_system": "piece"})["id"]
        self.ok("Bo'limlar: 5 ta, bosqichlar ishbay tarif bilan, 5 ta xodim")

        # 4. Texjarayon va texkartalar
        proc = self.get_or_create("production/processes/", "name", "Akfa deraza / eshik", {
            "name": "Akfa deraza / eshik", "stages": [{"operation": ops[o]} for o in ops]})["id"]
        tc_deraza = self.get_or_create("production/techcards/", "name", "Deraza 1200×1500", {
            "name": "Deraza 1200×1500", "product": products["Deraza 1200×1500 (2 stvorkali, oq)"], "output_qty": "1", "process": proc,
            "materials": [
                {"material": m["Akfa rom profili 6063 (oq)"], "qty": "5.6", "operation": ops["Profil kesish"]},
                {"material": m["Akfa stvorka profili (oq)"], "qty": "5.2", "operation": ops["Profil kesish"]},
                {"material": m["Akfa impost profili"], "qty": "1.5", "operation": ops["Profil kesish"]},
                {"material": m["Armatura (temir kuchaytirgich)"], "qty": "10", "operation": ops["Burchak payvandlash"]},
                {"material": m["Rezina uplotnitel"], "qty": "16", "operation": ops["Furnitura o'rnatish"]},
                {"material": m["Furnitura to'plami Roto"], "qty": "2", "operation": ops["Furnitura o'rnatish"]},
                {"material": m["Shurup / vint"], "qty": "40", "operation": ops["Furnitura o'rnatish"]},
                {"material": m["Oyna 4 mm (stekolpaket)"], "qty": "1.5", "operation": ops["Oyna o'rnatish"]},
            ]})
        self.get_or_create("production/techcards/", "name", "Balkon eshigi 800×2100", {
            "name": "Balkon eshigi 800×2100", "product": products["Balkon eshigi 800×2100 (oq)"], "output_qty": "1", "process": proc,
            "materials": [
                {"material": m["Akfa rom profili 6063 (oq)"], "qty": "5.8", "operation": ops["Profil kesish"]},
                {"material": m["Akfa stvorka profili (oq)"], "qty": "5.4", "operation": ops["Profil kesish"]},
                {"material": m["Armatura (temir kuchaytirgich)"], "qty": "11", "operation": ops["Burchak payvandlash"]},
                {"material": m["Rezina uplotnitel"], "qty": "15", "operation": ops["Furnitura o'rnatish"]},
                {"material": m["Furnitura to'plami Roto"], "qty": "1", "operation": ops["Furnitura o'rnatish"]},
                {"material": m["Oyna 4 mm (stekolpaket)"], "qty": "1.3", "operation": ops["Oyna o'rnatish"]},
            ]})
        self.ok(f"Texjarayon (5 bosqich) va 2 ta texkarta; deraza rejaviy tannarxi: {tc_deraza.get('cost')}")

        if self.rows("warehouse/docs/", type="supply"):
            self.stdout.write(self.style.WARNING("Xarid hujjatlari allaqachon bor — jarayon sinovi o'tkazib yuborildi"))
            return

        # 5. Xarid: buyurtma → qisman qabul qilish → qolganini qabul qilish
        po = self.call("post", "warehouse/docs/?type=purchase_order", {
            "type": "purchase_order", "warehouse": wh, "counterparty": akfa["id"], "currency": "UZS", "date": today, "items": [
                {"material": m["Akfa rom profili 6063 (oq)"], "qty": "120", "price": "46000"},
                {"material": m["Akfa stvorka profili (oq)"], "qty": "110", "price": "43000"},
                {"material": m["Akfa impost profili"], "qty": "30", "price": "38000"},
                {"material": m["Armatura (temir kuchaytirgich)"], "qty": "220", "price": "12000"}]})
        s1 = self.call("post", f"warehouse/docs/{po['id']}/derive/?type=purchase_order", {"type": "supply"})
        items = [{"material": i["material"], "qty": str((Decimal(i["qty"]) * Decimal("0.6")).quantize(Decimal("0.001"))), "price": i["price"]} for i in s1["items"]]
        self.call("patch", f"warehouse/docs/{s1['id']}/?type=supply", {"items": items, "posted": True})
        s2 = self.call("post", f"warehouse/docs/{po['id']}/derive/?type=purchase_order", {"type": "supply"})
        self.call("patch", f"warehouse/docs/{s2['id']}/?type=supply", {"posted": True})
        self.ok(f"Akfa'ga buyurtma №{po['number']} → qabul qilish №{s1['number']} (60%) va №{s2['number']} (qolgani 40%)")
        self.call("post", "warehouse/docs/?type=supply", {
            "type": "supply", "warehouse": wh, "counterparty": glass["id"], "currency": "UZS", "date": today,
            "items": [{"material": m["Oyna 4 mm (stekolpaket)"], "qty": "30", "price": "165000"}]})
        self.call("post", "warehouse/docs/?type=supply", {
            "type": "supply", "warehouse": wh, "counterparty": furn["id"], "currency": "USD", "date": today,
            "items": [{"material": m["Furnitura to'plami Roto"], "qty": "40", "price": "14.50"}]})
        self.call("post", "warehouse/docs/?type=supply", {
            "type": "supply", "warehouse": wh, "counterparty": furn["id"], "currency": "UZS", "date": today,
            "items": [{"material": m["Rezina uplotnitel"], "qty": "400", "price": "3500"},
                      {"material": m["Shurup / vint"], "qty": "1000", "price": "250"}]})
        self.ok("Oyna (so'm), furnitura (USD — kurs bo'yicha so'mga) va aksessuarlar qabul qilindi")

        # 6. Ishlab chiqarish topshirig'i: 10 ta deraza, bosqichma-bosqich
        job = self.call("post", "production/jobs/", {"techcard": tc_deraza["id"], "qty": "10", "materials_warehouse": wh,
                                                     "products_warehouse": wh, "plan_start": today, "plan_end": today})
        tasks = sorted(self.rows("production/tasks/", job=job["id"]), key=lambda t: t["id"])
        # ketma-ketlik qoidasi: 2-bosqichni 1-sidan oldin bajarib bo'lmaydi
        r = self.api.post(f"/api/production/tasks/{tasks[1]['id']}/complete/", {"qty": "1"}, format="json")
        assert r.status_code == 400, "Ketma-ketlik qoidasi ishlamadi"
        self.ok("Ketma-ketlik qoidasi: oldingi bosqichsiz keyingisi bajarilmadi (to'g'ri)")
        for tk in tasks:
            dep = next(d for d, i in deps.items() if i == tk["department"])
            self.call("post", f"production/tasks/{tk['id']}/start/", {}, ok=(200, 201, 400))
            self.call("post", f"production/tasks/{tk['id']}/complete/", {"qty": "10", "employee": emps[dep]})
        job = self.call("get", f"production/jobs/{job['id']}/")
        unit_cost = Decimal(job["capitalized"]) / Decimal(job["produced_qty"])
        self.ok(f"Topshiriq №{job['number']}: {job['produced_qty']} ta deraza omborga kirdi, haqiqiy tannarx {unit_cost:,.0f} so'm/dona")

        # 7. Hisobdan chiqarish: singan oyna
        self.call("post", "warehouse/docs/?type=loss", {"type": "loss", "warehouse": wh, "date": today, "note": "Tashishda singan oyna",
                                                         "items": [{"material": m["Oyna 4 mm (stekolpaket)"], "qty": "1"}]})
        self.ok("Hisobdan chiqarish: 1 m² singan oyna")

        # 8. Mijoz buyurtmasi (pozitsiyalar bilan) va ombordan sotuv + to'lov
        order = self.call("post", "orders/", {"client": client["id"], "currency": "UZS", "date": today, "plan_date": today,
                                              "items": [{"product": products["Deraza 1200×1500 (2 stvorkali, oq)"], "qty": "6", "price": "2450000"},
                                                        {"name": "O'rnatish xizmati", "qty": "6", "price": "150000"}]})
        sale = self.call("post", "sales/", {"client": client["id"], "warehouse": wh, "currency": "UZS", "date": today, "price_type": retail["id"],
                                            "items": [{"product": products["Deraza 1200×1500 (2 stvorkali, oq)"], "qty": "4", "price": "2450000", "discount_pct": "5"}]})
        self.call("post", f"sales/{sale['id']}/complete/", {})
        acc = next(a for a in self.rows("finance/accounts/") if a["currency"] == "UZS")
        self.call("post", f"sales/{sale['id']}/pay/", {"account": acc["id"], "amount": "5000000", "date": today})
        self.ok(f"Buyurtma №{order['number']} (6 deraza + o'rnatish, {Decimal(order['amount']):,.0f} so'm); "
                f"sotuv №{sale['number']}: 4 deraza ombordan, 5 mln to'landi")
        cost_before = Decimal(self.call("get", f"orders/{order['id']}/costing/")["cost"])
        # buyurtma tayyor → buyurtmadan sotuv (pozitsiyalar ombordan chiqadi)
        self.call("post", f"orders/{order['id']}/set_status/", {"status": "ready"})
        osale = self.call("post", "sales/from_order/", {"order": order["id"]})
        self.call("post", f"sales/{osale['id']}/complete/", {})
        costing = self.call("get", f"orders/{order['id']}/costing/")
        self.ok(f"Buyurtmadan sotuv №{osale['number']}: {len(osale['items'])} qator; buyurtma tannarxi "
                f"{cost_before:,.0f} → {Decimal(costing['cost']):,.0f} so'm (jo'natilgani bo'yicha), foyda {Decimal(costing['profit']):,.0f}")

        # 9. Natijalar
        stock = {s["material_name"]: s["qty"] for s in self.rows("warehouse/stock/", warehouse=wh)}
        pnl = self.call("get", f"finance/pnl/?currency=UZS&date_from={today}&date_to={today}")
        self.stdout.write("\nQoldiqlar:")
        for k, v in sorted(stock.items()):
            self.stdout.write(f"  {k}: {Decimal(v):,.3f}".rstrip("0").rstrip("."))
        self.stdout.write("\nFoyda va zarar (bugun, so'm):")
        for row in pnl["rows"]:
            self.stdout.write(f"  {'   ' * row['level']}{row['label']}: {Decimal(row['amount']):,.0f}")
        sup = self.call("get", "finance/supplier-debts/")
        self.stdout.write(f"\nYetkazuvchilarga qarz: {sup['total']}")
        self.ok("Jarayon to'liq o'tdi")
