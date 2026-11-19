"""Biznes-qoidalar, huquqlar, ko'p kompaniyalik va savdo testlari."""
from datetime import timedelta
from decimal import Decimal as D

from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.accounts.services import register_company
from apps.core.models import Branch, Company, ExchangeRate
from apps.core.money import MoneyBag, convert
from apps.core.tenancy import set_context, tenant_context
from apps.crm.models import Counterparty
from apps.finance.models import Account, ExpenseCategory, Transaction
from apps.hr.models import KpiResult, KpiScale, KpiTemplate
from apps.orders.models import Estimate, EstimateMaterial, EstimateService, Order
from apps.orders.services import order_costing
from apps.production.models import Department, Operation, ProductionTask
from apps.sales import services as sales
from apps.sales.models import Sale, SaleItem
from apps.warehouse.models import Material, StockMove, Warehouse
from apps.warehouse.services import post_move, reserve_for_order

T = timezone.localdate()


class Base(TestCase):
    def setUp(self):
        self.company, self.owner = register_company(company_name="Test MChJ", full_name="Ega", phone="1",
                                                    username="owner", password="Parol12345!")
        self._ctx = tenant_context(self.company)
        self._ctx.__enter__()
        ExchangeRate.objects.create(date=T - timedelta(days=30), usd_uzs=12500)
        self.client_obj = Counterparty.objects.create(name="Mijoz B")
        self.wh = Warehouse.objects.get(name="Asosiy ombor")
        self.profil = Material.objects.create(name="Profil", unit="pcs", currency="USD", min_qty=100)
        self.oyna = Material.objects.create(name="Oyna", unit="m2", currency="UZS", min_qty=60)
        self.dep = Department.objects.create(name="Kesish", sequence=10)
        self.op_cut = Operation.objects.create(name="Oyna kesish", department=self.dep, unit="m2", default_rate=35000, rate_currency="UZS")
        self.op_mount = Operation.objects.create(name="Montaj", department=self.dep, unit="pcs", default_rate=120, rate_currency="USD")
        self.order = Order.objects.create(client=self.client_obj, currency="USD", amount=4200, plan_date=T + timedelta(days=5),
                                          date=T - timedelta(days=1))

    def tearDown(self):
        self._ctx.__exit__(None, None, None)
        set_context(None, None)


class MoneyTests(Base):
    def test_bag_keeps_currencies_apart(self):
        bag = MoneyBag().add(13_000_000, "UZS").add(900, "USD")
        self.assertEqual(bag.as_dict(), {"UZS": "13000000.00", "USD": "900.00"})

    def test_convert_uses_previous_rate(self):
        self.assertEqual(convert(10, "USD", "UZS", T), D("125000"))


class CostingTests(Base):
    def test_smeta_3209_matches_mockup(self):
        est = Estimate.objects.create(order=self.order, version=1)
        EstimateMaterial.objects.create(estimate=est, material=self.profil, qty=24, waste_pct=3, price=18)
        EstimateMaterial.objects.create(estimate=est, material=self.oyna, qty=D("8.4"), waste_pct=5, price=210000)
        EstimateService.objects.create(estimate=est, operation=self.op_cut, qty=D("8.4"), rate=35000, currency="UZS")
        EstimateService.objects.create(estimate=est, operation=self.op_mount, qty=1, rate=120, currency="USD")
        c = order_costing(self.order)
        self.assertEqual(c["blocks"]["A"]["total"], {"UZS": "1852200.00", "USD": "444.96"})
        self.assertEqual(c["blocks"]["B"]["total"], {"UZS": "294000.00", "USD": "120.00"})
        expected_cost = D("444.96") + D("120") + (D("1852200") + D("294000")) / 12500
        self.assertAlmostEqual(D(c["cost"]), expected_cost, places=2)

    def test_expense_in_other_currency_goes_to_block_c(self):
        Estimate.objects.create(order=self.order, version=1)
        acc = Account.objects.get(name="Kassa (so'm)")
        cat = ExpenseCategory.objects.get(name="Transport")
        Transaction.objects.create(account=acc, kind="expense", category=cat, amount=450000, order=self.order, date=T)
        c = order_costing(self.order)
        self.assertEqual(c["blocks"]["C"]["converted"], "36.00")

    def test_non_profit_expense_excluded(self):
        from apps.finance.services import profit_and_loss

        Estimate.objects.create(order=self.order, version=1)
        acc = Account.objects.get(name="Kassa (so'm)")
        loan = ExpenseCategory.objects.get(name="Qarz qaytarish")
        Transaction.objects.create(account=acc, kind="expense", category=loan, amount=1_000_000, order=self.order, date=T)
        Transaction.objects.create(account=acc, kind="expense", category=loan, amount=2_000_000, date=T)
        Transaction.objects.create(account=acc, kind="expense", category=ExpenseCategory.objects.get(name="Ijara"), amount=500_000, date=T)
        self.assertEqual(order_costing(self.order)["blocks"]["C"]["converted"], "0.00")
        self.assertEqual(profit_and_loss(T - timedelta(days=5), T)["overhead"]["UZS"], "500000.00")


class ProductionRules(Base):
    def test_techcard_job_full_cycle(self):
        from apps.hr.models import Employee, PieceworkEntry
        from apps.production.models import TechCard, TechCardMaterial, TechProcess, TechProcessStage
        from apps.production.services import complete_stage, create_job_from_techcard

        deraza = Material.objects.create(name="Deraza", type="product", currency="UZS")
        post_move(StockMove(type="in", material=self.oyna, warehouse=self.wh, qty=100, price=200000))
        op2 = Operation.objects.create(name="Yig'ish", department=self.dep, unit="pcs", piece_rate=20000)
        self.op_cut.piece_rate = 10000
        self.op_cut.save()
        proc = TechProcess.objects.create(name="P")
        TechProcessStage.objects.create(process=proc, operation=self.op_cut, position=0)
        TechProcessStage.objects.create(process=proc, operation=op2, position=1)
        tc = TechCard.objects.create(name="Deraza", product=deraza, output_qty=1, process=proc)
        TechCardMaterial.objects.create(techcard=tc, material=self.oyna, qty=2)
        job = create_job_from_techcard(tc, 5, materials_warehouse=self.wh, products_warehouse=self.wh)
        t1, t2 = list(job.tasks.order_by("position"))
        emp = Employee.objects.create(full_name="Usta")
        with self.assertRaises(ValidationError):  # oldingi bosqich bajarilmagan
            complete_stage(t2, 1, employee=emp)
        complete_stage(t1, 5, employee=emp)
        self.assertEqual(self.oyna.stocks.get().qty, D("90"))  # 5 × 2 m² chiqim
        complete_stage(t2, 3, employee=emp)
        job.refresh_from_db()
        self.assertEqual(job.produced_qty, D("3"))
        self.assertEqual(job.status, "in_progress")
        # tannarx: material 10×200000 + ishbay 5×10000 + 3×20000 = 2 110 000 (3 dona kirim qilindi)
        self.assertEqual(deraza.stocks.get().qty, D("3"))
        self.assertEqual(PieceworkEntry.objects.filter(task__job=job).count(), 2)
        complete_stage(t2, 2, employee=emp)
        job.refresh_from_db()
        self.assertEqual(job.status, "done")
        self.assertEqual(job.capitalized, D("2150000.00"))
        self.assertEqual(deraza.stocks.get().qty * deraza.stocks.get().avg_cost, D("2150000"))


class OrderRules(Base):
    def test_payment_in_uzs_reduces_usd_debt(self):
        Transaction.objects.create(account=Account.objects.get(name="Kassa (so'm)"), kind="client_payment",
                                   amount=12_500_000, order=self.order, date=T)
        self.assertEqual(self.order.paid, D("1000.00"))
        self.assertEqual(self.order.debt, D("3200.00"))

    def test_overdue_days_single_formula(self):
        self.order.plan_date = T - timedelta(days=5)
        self.order.save()
        self.assertEqual(self.order.overdue_days, 5)

    def test_numbers_are_per_company(self):
        self.assertEqual(self.order.number, 3201)


class WarehouseRules(Base):
    def test_avg_cost_and_state(self):
        post_move(StockMove(type="in", material=self.oyna, warehouse=self.wh, qty=40, price=200000))
        post_move(StockMove(type="in", material=self.oyna, warehouse=self.wh, qty=40, price=220000))
        stock = self.oyna.stocks.get()
        self.assertEqual(stock.avg_cost, D("210000"))
        post_move(StockMove(type="out", material=self.oyna, warehouse=self.wh, qty=25))
        stock.refresh_from_db()
        self.assertEqual(stock.state, "low")

    def test_shortage_blocks_task_with_exact_qty(self):
        post_move(StockMove(type="in", material=self.oyna, warehouse=self.wh, qty=5, price=1))
        est = Estimate.objects.create(order=self.order, version=1)
        EstimateMaterial.objects.create(estimate=est, material=self.oyna, qty=10, waste_pct=0, price=1)
        rows = reserve_for_order(self.order)
        self.assertEqual(rows[0]["shortage"], D("5.000"))
        task = ProductionTask.objects.create(order=self.order, operation=self.op_cut, plan_qty=10)
        self.assertFalse(task.start())
        self.assertEqual(task.status, "blocked")


class SalesRules(Base):
    def test_goods_sale_moves_stock_and_debt(self):
        deraza = Material.objects.create(name="Deraza", type="product", currency="UZS")
        post_move(StockMove(type="in", material=deraza, warehouse=self.wh, qty=10, price=1_000_000))
        s = Sale.objects.create(client=self.client_obj, warehouse=self.wh, currency="UZS")
        SaleItem.objects.create(sale=s, product=deraza, qty=3, price=1_500_000)
        self.assertEqual(s.debt, 0)  # qoralama — qarz yo'q
        sales.complete_sale(s)
        s.refresh_from_db()
        self.assertEqual(deraza.stocks.get().qty, D("7"))
        self.assertEqual(s.cost, D("3000000"))
        sales.register_payment(s, account=Account.objects.get(name="Kassa (so'm)"), amount=D("1000000"))
        self.assertEqual(s.debt, D("3500000"))
        with self.assertRaises(ValidationError):  # USD kassaga so'mdagi summa — valyuta xatosi
            sales.register_payment(s, account=Account.objects.get(name="Kassa (USD)"), amount=D("3500000"))
        with self.assertRaises(ValidationError):  # to'lov bor — bekor qilib bo'lmaydi
            sales.cancel_sale(s)

    def test_sale_from_order_moves_debt_without_double_counting(self):
        from apps.finance.services import client_debts

        Transaction.objects.create(account=Account.objects.get(name="Kassa (USD)"), kind="client_payment",
                                   amount=1000, order=self.order, date=T)  # avans
        with self.assertRaises(ValidationError):
            sales.sale_from_order(self.order, self.owner)  # hali tayyor emas
        self.order.status = Order.Status.READY
        self.order.save()
        s, created = sales.sale_from_order(self.order, self.owner)
        self.assertTrue(created)
        self.assertEqual(s.paid, D("1000"))  # avans sotuvga o'tdi
        sales.complete_sale(s)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.Status.DELIVERED)
        self.assertEqual(self.order.debt, 0)
        self.assertEqual(client_debts()["total"]["USD"], "3200.00")  # faqat bir marta


class KpiRules(Base):
    def test_lower_is_better_and_cap(self):
        for min_pct, coef in [(110, "1.1"), (90, "1.0"), (80, "0.9"), (0, "0")]:
            KpiScale.objects.create(min_pct=min_pct, coefficient=D(coef))
        brak = KpiTemplate.objects.create(name="Brak", direction="lower", cap_pct=120)
        r = KpiResult.objects.create(template=brak, month=T.replace(day=1), department=self.dep, plan=3, fact=D("3.6"))
        self.assertEqual(r.achievement_pct, D("83.3"))
        self.assertEqual(r.coefficient, D("0.9"))


class ApiTests(TestCase):
    """HTTP orqali: huquqlar, kompaniyalar izolyatsiyasi, obuna."""

    def setUp(self):
        self.c1, self.owner1 = register_company(company_name="Birinchi", full_name="A", phone="1", username="o1", password="Parol12345!")
        self.c2, self.owner2 = register_company(company_name="Ikkinchi", full_name="B", phone="2", username="o2", password="Parol12345!")
        with tenant_context(self.c1):
            Counterparty.objects.create(name="C1 mijozi")
            self.op = User.objects.create_user("op", password="x", company=self.c1, role=Role.objects.get(code="operator"))
        with tenant_context(self.c2):
            Counterparty.objects.create(name="C2 mijozi")
        set_context(None, None)
        self.api = APIClient()

    def test_tenant_isolation(self):
        self.api.force_authenticate(self.owner1)
        names = [r["name"] for r in self.api.get("/api/crm/counterparties/").json()]
        self.assertEqual(names, ["C1 mijozi"])
        with tenant_context(self.c2):
            other = Counterparty.objects.get().id
        self.assertEqual(self.api.get(f"/api/crm/counterparties/{other}/").status_code, 404)

    def test_operator_permissions(self):
        self.api.force_authenticate(self.op)
        self.assertEqual(self.api.get("/api/finance/transactions/").status_code, 403)
        self.assertEqual(self.api.get("/api/auth/roles/").status_code, 403)
        self.assertEqual(self.api.get("/api/orders/").status_code, 200)
        self.assertEqual(self.api.post("/api/production/departments/", {"name": "X"}).status_code, 403)

    def test_granular_actions(self):
        with tenant_context(self.c1):
            role = Role.objects.get(code="operator")
            role.permissions["counterparties"] = {"view": True, "create": True, "edit": False, "delete": False, "scope": "all"}
            role.save()
            cp = Counterparty.objects.get()
        set_context(None, None)
        self.op.refresh_from_db()
        self.api.force_authenticate(self.op)
        self.assertEqual(self.api.post("/api/crm/counterparties/", {"name": "Yangi"}, format="json").status_code, 201)
        self.assertEqual(self.api.patch(f"/api/crm/counterparties/{cp.id}/", {"name": "X"}).status_code, 403)
        self.assertEqual(self.api.delete(f"/api/crm/counterparties/{cp.id}/").status_code, 403)

    def test_order_positions(self):
        """Buyurtma pozitsiyalari: summa = pozitsiyalar yig'indisi (chegirma bilan)."""
        from apps.warehouse.models import Material

        with tenant_context(self.c1):
            cp = Counterparty.objects.get()
            prod = Material.objects.create(name="Rom 1200x1400", type="product", unit="pcs")
        set_context(None, None)
        self.api.force_authenticate(self.owner1)
        payload = {"client": cp.id, "currency": "UZS", "plan_date": "2026-12-01", "items": [
            {"product": prod.id, "qty": "2", "price": "1000000", "discount_pct": "10"},
            {"name": "O'rnatish", "qty": "1", "price": "200000"},
        ]}
        r = self.api.post("/api/orders/", payload, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        o = r.json()
        self.assertEqual(D(o["amount"]), D("2000000"))
        self.assertEqual(o["items"][0]["name"], "Rom 1200x1400")
        r = self.api.patch(f"/api/orders/{o['id']}/", {"items": [{"name": "X", "qty": "3", "price": "5"}]}, format="json")
        self.assertEqual(D(r.json()["amount"]), D("15"))
        # pozitsiyasiz va summasiz — xato
        bad = self.api.post("/api/orders/", {"client": cp.id, "currency": "UZS", "plan_date": "2026-12-01"}, format="json")
        self.assertEqual(bad.status_code, 400)

    def test_expired_subscription_blocks(self):
        Company.objects.filter(pk=self.c1.pk).update(trial_ends=T - timedelta(days=1))
        self.owner1.refresh_from_db()
        self.api.force_authenticate(self.owner1)
        self.assertEqual(self.api.get("/api/orders/").status_code, 402)
        me = self.api.get("/api/auth/me/").json()
        self.assertFalse(me["company"]["is_accessible"])

    def test_register_and_platform(self):
        r = self.api.post("/api/auth/register/", {"company_name": "Uchinchi", "full_name": "C D", "phone": "3",
                                                  "username": "owner3", "password": "Parol12345!"}, format="json")
        self.assertEqual(r.status_code, 201)
        c3 = Company.objects.get(name="Uchinchi")
        self.assertEqual(c3.days_left, 14)
        self.assertTrue(Branch.all_objects.filter(company=c3, is_main=True).exists())
        admin = User.objects.create_superuser("plat", "", "x")
        self.api.force_authenticate(admin)
        self.assertEqual(self.api.get("/api/orders/").status_code, 403)  # biznes ma'lumotlari yopiq
        r = self.api.post(f"/api/auth/platform/companies/{c3.id}/extend/", {"days": 30}, format="json")
        self.assertEqual(r.json()["status"], "active")
        self.assertEqual(r.json()["days_left"], 30)


class StockDocTests(TestCase):
    """MoySklad uslubidagi hujjatlar: qabul qilish, qaytarish, kirim, chiqim, ko'chirish, inventarizatsiya."""

    def setUp(self):
        self.c, self.owner = register_company(company_name="Ombor", full_name="A", phone="9", username="wh", password="Parol12345!")
        with tenant_context(self.c):
            from apps.core.models import CurrencyDef

            self.sup = Counterparty.objects.create(name="Yetkazuvchi")
            self.cli = Counterparty.objects.create(name="Mijoz")
            self.m = Material.objects.create(name="Profil", type="raw", unit="m", currency="UZS")
            self.w1 = Warehouse.objects.order_by("id").first()
            self.w2 = Warehouse.objects.create(name="Ikkinchi")
            CurrencyDef.objects.create(code="EUR", name="Evro", auto_update=False)
            ExchangeRate.objects.create(currency="USD", date=T, usd_uzs=D("12000"))
            ExchangeRate.objects.create(currency="EUR", date=T, usd_uzs=D("13000"))
        set_context(None, None)
        self.api = APIClient()
        self.api.force_authenticate(self.owner)

    def stock(self, w=None):
        from apps.warehouse.models import Stock

        with tenant_context(self.c):
            s = Stock.objects.filter(material=self.m, warehouse=w or self.w1).first()
            return (s.qty, s.avg_cost) if s else (D("0"), D("0"))

    def doc(self, type_, items, **kw):
        body = {"type": type_, "warehouse": self.w1.id, "currency": "UZS", "date": str(T), "items": items, **kw}
        r = self.api.post(f"/api/warehouse/docs/?type={type_}", body, format="json")
        self.assertIn(r.status_code, (200, 201), r.content)
        return r.json()

    def test_stock_as_of_date_export_and_excel_import(self):
        import io
        from datetime import timedelta

        from openpyxl import Workbook, load_workbook

        past = T - timedelta(days=10)
        self.doc("enter", [{"material": self.m.id, "qty": "10", "price": "100"}], date=str(past))
        self.doc("enter", [{"material": self.m.id, "qty": "10", "price": "200"}])
        self.doc("loss", [{"material": self.m.id, "qty": "5"}])
        r = self.api.get("/api/warehouse/stock/", {"material": self.m.id}).json()["results"]
        self.assertEqual(D(r[0]["qty"]), D("15"))
        # o'tgan sanaga qoldiq: faqat birinchi kirim
        r = self.api.get("/api/warehouse/stock/", {"material": self.m.id, "date": str(T - timedelta(days=1))}).json()["results"]
        self.assertEqual(D(r[0]["qty"]), D("10"))
        self.assertEqual(D(r[0]["avg_cost"]), D("100"))
        self.assertEqual(self.api.get("/api/warehouse/stock/", {"stock": "negative"}).json()["count"], 0)
        # yuklab olish
        x = self.api.get("/api/warehouse/stock/export/", {"fmt": "xlsx"})
        self.assertEqual(x.status_code, 200)
        ws = load_workbook(io.BytesIO(x.content)).active
        self.assertEqual(ws.cell(2, 3).value, "Profil")
        self.assertIn("Profil", self.api.get("/api/warehouse/stock/export/", {"fmt": "csv"}).content.decode("utf-8-sig"))
        # shablon va import
        tpl = self.api.get("/api/warehouse/docs/import_template/", {"type": "enter"})
        self.assertEqual(tpl.status_code, 200)
        self.assertEqual([c.value for c in load_workbook(io.BytesIO(tpl.content)).active[1]], ["Kod", "Artikul", "Nomi", "Miqdor", "Narx"])
        wb = Workbook()
        wb.active.append(["Kod", "Nomi", "Miqdor", "Narx"])
        wb.active.append([None, "profil", 3, "1 500,5"])
        wb.active.append([None, "Yo'q tovar", 1, 1])
        wb.active.append([None, "Profil", 2, None])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        buf.name = "import.xlsx"
        r = self.api.post("/api/warehouse/docs/import_items/?type=enter", {"file": buf}, format="multipart")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(len(body["lines"]), 1)
        self.assertEqual(D(body["lines"][0]["qty"]), D("5"))
        self.assertEqual(D(body["lines"][0]["price"]), D("1500.5"))
        self.assertEqual(len(body["errors"]), 1)

    def test_supply_edit_unpost_and_debt(self):
        d = self.doc("supply", [{"material": self.m.id, "qty": "10", "price": "1000"}], counterparty=self.sup.id)
        self.assertEqual(d["number"], 1)
        self.assertEqual(self.stock()[0], D("10"))
        # tahrirlash — qayta o'tkaziladi
        r = self.api.patch(f"/api/warehouse/docs/{d['id']}/?type=supply", {"items": [{"material": self.m.id, "qty": "4", "price": "1000"}]}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.stock()[0], D("4"))
        with tenant_context(self.c):
            from apps.finance.services import supplier_debts

            self.assertEqual(D(supplier_debts()["total"]["UZS"]), D("4000"))
        # bekor qilish
        self.api.post(f"/api/warehouse/docs/{d['id']}/unpost/?type=supply")
        self.assertEqual(self.stock()[0], D("0"))
        with tenant_context(self.c):
            self.assertEqual(D(supplier_debts()["total"]["UZS"]), D("0"))

    def test_purchase_order_to_supply_and_eur_price(self):
        po = self.doc("purchase_order", [{"material": self.m.id, "qty": "10", "price": "2"}], counterparty=self.sup.id, currency="EUR")
        self.assertEqual(self.stock()[0], D("0"))  # buyurtma qoldiqqa ta'sir qilmaydi
        r = self.api.post(f"/api/warehouse/docs/{po['id']}/derive/?type=purchase_order", {"type": "supply"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        sup = r.json()
        self.assertFalse(sup["posted"])
        self.assertEqual(D(sup["items"][0]["qty"]), D("10"))
        self.api.patch(f"/api/warehouse/docs/{sup['id']}/?type=supply", {"items": [{"material": self.m.id, "qty": "6", "price": "2"}], "posted": True}, format="json")
        qty, avg = self.stock()
        self.assertEqual(qty, D("6"))
        self.assertEqual(avg, D("26000"))  # 2 EUR × 13000
        # qolgan 4 ta uchun ikkinchi qabul qilish
        r = self.api.post(f"/api/warehouse/docs/{po['id']}/derive/?type=purchase_order", {"type": "supply"}, format="json")
        self.assertEqual(D(r.json()["items"][0]["qty"]), D("4"))

    def test_loss_move_inventory(self):
        self.doc("enter", [{"material": self.m.id, "qty": "10", "price": "500"}])
        self.doc("loss", [{"material": self.m.id, "qty": "3"}])
        self.assertEqual(self.stock()[0], D("7"))
        self.doc("move", [{"material": self.m.id, "qty": "2"}], to_warehouse=self.w2.id)
        self.assertEqual(self.stock()[0], D("5"))
        self.assertEqual(self.stock(self.w2)[0], D("2"))
        inv = self.doc("inventory", [{"material": self.m.id, "qty": "4"}])
        self.assertEqual(self.stock()[0], D("4"))
        self.assertEqual(D(inv["items"][0]["book_qty"]), D("5"))
        # ortiqcha hisobdan chiqarish — xato
        r = self.api.post("/api/warehouse/docs/?type=loss", {"type": "loss", "warehouse": self.w1.id, "items": [{"material": self.m.id, "qty": "100"}]}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.stock()[0], D("4"))
        # aylanma
        t = self.api.get("/api/warehouse/turnover/", {"warehouse": self.w1.id}).json()["rows"][0]
        self.assertEqual((D(t["income"]), D(t["outcome"]), D(t["closing"])), (D("10"), D("6"), D("4")))

    def test_order_positions_shipment_and_pnl(self):
        """Pozitsiyali buyurtma → buyurtmadan sotuv: tovar ombordan chiqadi, tannarx va P&L to'g'ri."""
        with tenant_context(self.c):
            prod = Material.objects.create(name="Deraza", type="product", unit="pcs", currency="UZS")
        set_context(None, None)
        self.doc("enter", [{"material": prod.id, "qty": "5", "price": "1000000"}])
        r = self.api.post("/api/orders/", {"client": self.cli.id, "currency": "UZS", "plan_date": str(T), "date": str(T),
                                           "items": [{"product": prod.id, "qty": "3", "price": "2000000"}]}, format="json")
        order = r.json()
        costing = self.api.get(f"/api/orders/{order['id']}/costing/").json()
        self.assertEqual(D(costing["cost"]), D("3000000"))  # o'rtacha tannarx bo'yicha
        self.api.post(f"/api/orders/{order['id']}/set_status/", {"status": "ready"}, format="json")
        sale = self.api.post("/api/sales/from_order/", {"order": order["id"]}, format="json").json()
        self.assertEqual(sale["items"][0]["product"], prod.id)
        r = self.api.post(f"/api/sales/{sale['id']}/complete/")
        self.assertEqual(r.status_code, 200, r.content)
        from apps.warehouse.models import Stock

        with tenant_context(self.c):
            self.assertEqual(Stock.objects.get(material=prod).qty, D("2"))
            from apps.finance.services import pnl_report

            rows = {x["key"]: D(x["amount"]) for x in pnl_report(T, T, "UZS")["rows"]}
        self.assertEqual(rows["revenue"], D("6000000"))  # ikki marta hisoblanmaydi
        self.assertEqual(rows["cogs"], D("3000000"))
        self.assertEqual(rows["gross"], D("3000000"))

    def test_order_to_production_flow_audit_bulk(self):
        """Buyurtma → ishlab chiqarishga yuborish → boshlash (minusga ruxsat) → bosqichlar → buyurtma tayyor; tarix va ommaviy amallar."""
        from apps.production.models import Department, Operation, TechCard, TechCardMaterial, TechProcess, TechProcessStage

        with tenant_context(self.c):
            prod = Material.objects.create(name="Rom", type="product", unit="pcs", currency="UZS")
            d1 = Department.objects.create(name="Kesish", sequence=1)
            d2 = Department.objects.create(name="Yig'ish", sequence=2)
            o1 = Operation.objects.create(name="Kesish", department=d1, unit="pcs")
            o2 = Operation.objects.create(name="Yig'ish", department=d2, unit="pcs")
            proc = TechProcess.objects.create(name="P")
            TechProcessStage.objects.create(process=proc, operation=o1, position=0)
            TechProcessStage.objects.create(process=proc, operation=o2, position=1)
            tc = TechCard.objects.create(name="Rom", product=prod, output_qty=1, process=proc)
            TechCardMaterial.objects.create(techcard=tc, material=self.m, qty=D("3"), operation=o1)
        set_context(None, None)
        self.doc("enter", [{"material": self.m.id, "qty": "4", "price": "100"}])  # 2 ta uchun 6 kerak — yetmaydi
        order = self.api.post("/api/orders/", {"client": self.cli.id, "currency": "UZS", "plan_date": str(T), "date": str(T),
                                               "items": [{"product": prod.id, "qty": "2", "price": "500"}]}, format="json").json()
        r = self.api.post(f"/api/orders/{order['id']}/send_to_production/").json()
        po = r["production_order"]
        req = self.api.get(f"/api/production/orders/{po}/requirements/", {"warehouse": self.w1.id}).json()
        self.assertEqual(D(req[0]["shortage"]), D("2"))
        body = {"materials_warehouse": self.w1.id, "products_warehouse": self.w1.id}
        self.assertEqual(self.api.post(f"/api/production/orders/{po}/create_jobs/", body, format="json").status_code, 409)
        r = self.api.post(f"/api/production/orders/{po}/create_jobs/", {**body, "allow_negative": True}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        o = self.api.get(f"/api/orders/{order['id']}/").json()
        self.assertEqual(o["stage"], "Kesish")
        tasks = sorted(self.api.get("/api/production/tasks/", {"job": r.json()["jobs"][0]}).json(), key=lambda x: x["id"])
        for tk in tasks:
            self.assertEqual(self.api.post(f"/api/production/tasks/{tk['id']}/complete/", {"qty": "2"}, format="json").status_code, 200)
        o = self.api.get(f"/api/orders/{order['id']}/").json()
        self.assertEqual(o["status"], "ready")
        self.assertEqual(self.stock()[0], D("-2"))  # minusga ketdi
        # tarix
        with tenant_context(self.c):
            from apps.core.models import AuditLog

            self.assertTrue(AuditLog.objects.filter(entity="production_order", action="start").exists())
            self.assertTrue(AuditLog.objects.filter(entity="order", action="create").exists())
        # ommaviy: nusxa va o'chirish
        r = self.api.post("/api/orders/bulk/", {"ids": [order["id"]], "action": "copy"}, format="json").json()
        self.assertEqual(len(r["created"]), 1)
        r = self.api.post("/api/orders/bulk/", {"ids": r["created"], "action": "delete"}, format="json").json()
        self.assertEqual(r["done"], 1)
        with tenant_context(self.c):
            self.assertTrue(AuditLog.objects.filter(entity="order", action="delete").exists())

    def test_payments_transfer_and_open_documents(self):
        """MoySklad to'lovlar: raqam, hisoblar orasida ko'chirish (kurs bilan), to'lanmagan hujjatlar va qabul qilishga bog'lash."""
        with tenant_context(self.c):
            uzs = Account.objects.get(currency="UZS")
            usd = Account.objects.get(currency="USD")
        set_context(None, None)
        r = self.api.post("/api/finance/transactions/", {"kind": "other_income", "account": uzs.id, "amount": "1200000"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["number"], 1)
        r = self.api.post("/api/finance/transactions/transfer/", {"from_account": uzs.id, "to_account": usd.id, "amount": "1200000"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        bal = {a["currency"]: D(a["balance"]) for a in self.api.get("/api/finance/accounts/").json()}
        self.assertEqual(bal["UZS"], D("0"))
        self.assertEqual(bal["USD"], D("100"))  # 1 200 000 / 12 000
        # ko'chirish o'chirilsa — ikkala yozuv ham o'chadi
        self.api.delete(f"/api/finance/transactions/{r.json()['id']}/")
        bal = {a["currency"]: D(a["balance"]) for a in self.api.get("/api/finance/accounts/").json()}
        self.assertEqual((bal["UZS"], bal["USD"]), (D("1200000"), D("0")))
        # qabul qilish → yetkazuvchiga to'lov bilan bog'lash
        sup = self.doc("supply", [{"material": self.m.id, "qty": "10", "price": "50000"}], counterparty=self.sup.id)
        docs = self.api.get("/api/finance/transactions/open_documents/", {"counterparty": self.sup.id, "direction": "out"}).json()
        self.assertEqual(D(docs[0]["debt"]), D("500000"))
        r = self.api.post("/api/finance/transactions/", {"kind": "supplier_payment", "account": uzs.id, "amount": "500000",
                                                         "supplier": self.sup.id, "stock_doc": sup["id"]}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        docs = self.api.get("/api/finance/transactions/open_documents/", {"counterparty": self.sup.id, "direction": "out"}).json()
        self.assertEqual(docs, [])

    def test_doc_level_permissions_and_post(self):
        """MoySklad huquqlari: hujjat turi bo'yicha; "O'tkazish" huquqisiz — qoralama; eski "purchases" kaliti meros."""
        from apps.accounts.models import normalize_permissions

        with tenant_context(self.c):
            role = Role.objects.create(code="sklad2", name="Omborchi 2", permissions={
                "supplies": {"view": True, "create": True, "edit": True, "delete": False, "post": False, "scope": "all"}})
            u = User.objects.create_user("sk2", password="x", company=self.c, role=role)
        set_context(None, None)
        api = APIClient()
        api.force_authenticate(u)
        r = api.post("/api/warehouse/docs/?type=supply", {"type": "supply", "warehouse": self.w1.id, "counterparty": self.sup.id,
                                                          "items": [{"material": self.m.id, "qty": "2", "price": "10"}]}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertFalse(r.json()["posted"])  # o'tkazish huquqi yo'q → qoralama
        self.assertEqual(api.post(f"/api/warehouse/docs/{r.json()['id']}/post/?type=supply").status_code, 403)
        # boshqa hujjat turi (hisobdan chiqarish) — umuman ko'rinmaydi
        self.assertEqual(api.get("/api/warehouse/docs/?type=loss").status_code, 403)
        # eski format: "purchases" → yangi kalitlarga meros, post = edit
        p = normalize_permissions({"purchases": {"view": True, "create": True, "edit": True, "delete": False}})
        self.assertTrue(p["supplies"]["post"] and p["purchase_returns"]["view"])

    def test_sale_unpost_edit_delete_and_profitability(self):
        """Sotuv: o'tkazilgan sotuvni tahrirlash (qayta o'tkaziladi), qoralamaga qaytarish, o'chirish (to'lov avans bo'lib qoladi),
        foydalilik hisoboti (tovar bo'yicha, qaytarish bilan)."""
        with tenant_context(self.c):
            prod = Material.objects.create(name="Deraza", type="goods", unit="pcs", currency="UZS")
            uzs = Account.objects.get(currency="UZS")
        set_context(None, None)
        self.doc("enter", [{"material": prod.id, "qty": "10", "price": "1000"}])
        stock = lambda: D(self.api.get("/api/warehouse/stock/", {"material": prod.id}).json()["results"][0]["qty"])  # noqa: E731
        s = self.api.post("/api/sales/", {"client": self.cli.id, "warehouse": self.w1.id, "currency": "UZS",
                                          "items": [{"product": prod.id, "qty": "4", "price": "2500"}]}, format="json").json()
        self.api.post(f"/api/sales/{s['id']}/complete/")
        self.assertEqual(stock(), D("6"))
        # o'tkazilgan sotuvni tahrirlash: 4 → 3
        r = self.api.patch(f"/api/sales/{s['id']}/", {"items": [{"product": prod.id, "qty": "3", "price": "2500"}]}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"], "completed")
        self.assertEqual(stock(), D("7"))
        # foydalilik: 3 × 2500 = 7500 tushum, tannarx 3000, 1 ta qaytarish (500 tannarx 1000)
        ret = self.api.post("/api/warehouse/docs/from_sale/?type=sales_return", {"sale": s["id"]}, format="json").json()
        self.api.patch(f"/api/warehouse/docs/{ret['id']}/?type=sales_return", {"items": [{"material": prod.id, "qty": "1", "price": "2500"}], "posted": True}, format="json")
        rep = self.api.get("/api/sales/profitability/", {"by": "product", "date_from": str(T), "date_to": str(T)}).json()
        row = rep["rows"][0]
        self.assertEqual((D(row["revenue"]), D(row["cost"]), D(row["ret_amount"]), D(row["ret_cost"])), (D("7500"), D("3000"), D("2500"), D("1000")))
        self.assertEqual(D(row["profit"]), D("3000"))  # (7500-2500) - (3000-1000)
        # qaytarish bor — o'chirib bo'lmaydi; qaytarishni o'chirgach — o'chadi, to'lov avans bo'lib qoladi
        self.api.post(f"/api/sales/{s['id']}/pay/", {"account": uzs.id, "amount": "1000"}, format="json")
        self.assertEqual(self.api.delete(f"/api/sales/{s['id']}/").status_code, 400)
        self.api.delete(f"/api/warehouse/docs/{ret['id']}/?type=sales_return")
        self.assertEqual(self.api.delete(f"/api/sales/{s['id']}/").status_code, 204)
        self.assertEqual(stock(), D("10"))
        with tenant_context(self.c):
            t = Transaction.objects.get(kind="client_payment", client=self.cli)
            self.assertIsNone(t.sale_id)
