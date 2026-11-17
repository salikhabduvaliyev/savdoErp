"""Demo ma'lumotlar: platforma admini + "Akfa Demo" kompaniyasi (2 filial).

    python manage.py seed_demo          # bo'sh bazaga
    python manage.py seed_demo --flush  # avval hamma ma'lumotni o'chiradi

Kirish:  platform / platform12345  — platforma admini (kompaniyalar, obuna)
         admin / admin12345        — "Akfa Demo" egasi
"""
from datetime import timedelta
from decimal import Decimal as D

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Role, User
from apps.accounts.services import register_company
from apps.core.models import Branch, ExchangeRate
from apps.core.tenancy import tenant_context
from apps.crm.models import Counterparty
from apps.finance.models import Account, ExpenseCategory, Transaction
from apps.hr.models import Employee, KpiResult, KpiScale, KpiTemplate, PayrollAdjustment, PieceworkEntry, Timesheet
from apps.orders.models import Estimate, EstimateMaterial, EstimateService, Order
from apps.production.models import Department, Operation, ProductionTask
from apps.sales.models import Sale, SaleItem
from apps.sales import services as sale_services
from apps.warehouse.models import Material, MaterialGroup, PriceType, ProductPrice, StockMove, Warehouse
from apps.warehouse.services import post_move, reserve_for_order


class Command(BaseCommand):
    help = "Demo ma'lumotlarni yuklaydi"

    def add_arguments(self, parser):
        parser.add_argument("--flush", action="store_true")

    def handle(self, *args, **opts):
        if opts["flush"]:
            call_command("flush", interactive=False)
        if Order.all_objects.exists():
            self.stdout.write(self.style.WARNING("Bazada buyurtmalar bor — o'tkazib yuborildi (--flush ishlating)"))
            return
        with transaction.atomic():
            if not User.objects.filter(username="platform").exists():
                User.objects.create_superuser("platform", "", "platform12345", first_name="Platforma admini")
            company, owner = register_company(company_name="Akfa Demo", full_name="Direktor", phone="+998 71 000 00 00",
                                              username="admin", password="admin12345")
            company.legal_name = '"Namuna Profil" MChJ'
            company.inn = "300000000"
            company.address = "Toshkent sh."
            company.bank_name = "Namuna bank"
            company.bank_mfo = "00000"
            company.status = company.Status.ACTIVE
            company.paid_until = timezone.localdate() + timedelta(days=365)
            company.save()
            self.company, self.owner = company, owner
            with tenant_context(company):
                self.seed()
        self.stdout.write(self.style.SUCCESS(
            "Demo yuklandi. Kirish: admin / admin12345 (kompaniya), platform / platform12345 (platforma)"))

    def seed(self):
        T = timezone.localdate()
        day = lambda n: T + timedelta(days=n)  # noqa: E731
        self.T = T
        main = Branch.objects.get(is_main=True)
        sam = Branch.objects.create(name="Samarqand filiali", address="Samarqand sh.", phone="+998 66 000 00 00")
        self.main = main

        # --- kurslar ---
        ExchangeRate.objects.all().delete()
        for i in range(200, -1, -1):
            ExchangeRate.objects.create(date=day(-i), usd_uzs=D("12600") + D(i % 7) * 10)

        # --- bo'limlar va operatsiyalar ---
        deps = {}
        for seq, name, cap in [(10, "Kesish", 40), (20, "Bo'yash", 40), (30, "Yig'ish", 30), (40, "Montaj", 10), (50, "Qadoqlash", 20)]:
            deps[name] = Department.objects.create(name=name, sequence=seq, daily_capacity=cap)
        ops = {
            "profil": Operation.objects.create(name="Profil kesish", department=deps["Kesish"], unit="pcs", default_rate=8000, rate_currency="UZS", piece_rate=3000),
            "oyna": Operation.objects.create(name="Oyna kesish", department=deps["Kesish"], unit="m2", default_rate=35000, rate_currency="UZS", piece_rate=12000),
            "boyash": Operation.objects.create(name="Bo'yash", department=deps["Bo'yash"], unit="m2", default_rate=25000, rate_currency="UZS", piece_rate=9000),
            "yigish": Operation.objects.create(name="Yig'ish", department=deps["Yig'ish"], unit="pcs", default_rate=60000, rate_currency="UZS", piece_rate=20000),
            "montaj": Operation.objects.create(name="Montaj", department=deps["Montaj"], unit="pcs", default_rate=120, rate_currency="USD", piece_rate=150000),
            "qadoq": Operation.objects.create(name="Qadoqlash", department=deps["Qadoqlash"], unit="pcs", default_rate=15000, rate_currency="UZS", piece_rate=5000),
        }

        # --- foydalanuvchilar ---
        roles = {r.code: r for r in Role.objects.all()}
        staff = []
        admin = self.owner

        def user(username, first, role, dep=None, pw="demo12345", position="", branch=None):
            u = User.objects.create_user(username=username, password=pw, first_name=first, role=roles[role],
                                         department=dep, company=self.company)
            if branch:
                u.branches.set([branch])
            staff.append((u, first, position or roles[role].name, dep, branch))
            return u

        manager = user("menejer", "Menejer", "manager")
        op1 = user("operator1", "Operator 1", "operator")
        op2 = user("operator2", "Operator 2", "operator", branch=sam)
        user("kesish", "Kesish boshlig'i", "dept_head", deps["Kesish"])
        user("ishlab", "Ishlab chiqarish menejeri", "production_manager")
        user("omborchi", "Omborchi", "storekeeper")
        user("hisobchi", "Hisobchi", "accountant")
        user("kassir", "Kassir", "cashier", branch=sam)

        # --- ombor ---
        wh_main = Warehouse.objects.get(name="Asosiy ombor")
        wh_prod = Warehouse.objects.create(name="Ishlab chiqarish", branch=main)
        wh_cut = Warehouse.objects.create(name="Kesish ombori", branch=main)
        wh_sam = Warehouse.objects.create(name="Samarqand ombori", branch=sam)
        self.wh_main, self.wh_sam = wh_main, wh_sam
        g_prof = MaterialGroup.objects.create(name="Profil")
        g_glass = MaterialGroup.objects.create(name="Oyna")
        g_acc = MaterialGroup.objects.create(name="Aksessuar")
        mats = {
            "profil": Material.objects.create(name="Profil 6063, 6 m", sku="PR-6063", group=g_prof, unit="pcs", currency="USD", min_qty=100),
            "oyna": Material.objects.create(name="Oyna 6 mm", sku="OY-6", group=g_glass, unit="m2", currency="UZS", min_qty=60),
            "furn": Material.objects.create(name="Furnitura to'plami", sku="FR-01", type="goods", group=g_acc, unit="set", currency="USD", min_qty=80),
            "tomchi": Material.objects.create(name="Tomchi ushlagich", group=g_acc, unit="kg", currency="UZS", min_qty=20),
            "boyoq": Material.objects.create(name="Bo'yoq RAL 9016", group=g_acc, unit="kg", currency="USD", min_qty=30),
        }
        sup = {
            "profil": Counterparty.objects.create(name="Profil Trade MChJ", kind="legal", is_client=False, is_supplier=True,
                                                  phone="+998 90 000 00 01", inn="301111111", supplies="Alyumin profil"),
            "oyna": Counterparty.objects.create(name="Shisha Market", kind="legal", is_client=False, is_supplier=True,
                                                phone="+998 90 000 00 02", supplies="Oyna, shisha paket"),
            "kimyo": Counterparty.objects.create(name="Kimyo Snab", kind="legal", is_client=False, is_supplier=True,
                                                 phone="+998 90 000 00 03", supplies="Bo'yoq, kimyoviy moddalar"),
        }
        for key, wh, qty, price, s in [
            ("profil", wh_main, 420, 18, "profil"), ("oyna", wh_main, 95, 210000, "oyna"),
            ("furn", wh_prod, 210, D("6.5"), "profil"), ("tomchi", wh_cut, 15, 38000, "kimyo"),
            ("boyoq", wh_main, 88, D("9.2"), "kimyo"),
        ]:
            post_move(StockMove(date=day(-60), type="in", material=mats[key], warehouse=wh, qty=qty, price=price, supplier=sup[s], created_by=admin))

        # --- moliya ---
        kassa_uzs = Account.objects.get(name="Kassa (so'm)")
        kassa_usd = Account.objects.get(name="Kassa (USD)")
        kassa_uzs.opening_balance = 3_000_000
        kassa_uzs.save()
        kassa_usd.opening_balance = 500
        kassa_usd.save()
        acc = {
            "kassa_uzs": kassa_uzs,
            "bank_uzs": Account.objects.create(name="Bank (so'm)", kind="bank", currency="UZS", opening_balance=60_000_000),
            "kassa_usd": kassa_usd,
            "bank_usd": Account.objects.create(name="Bank (USD)", kind="bank", currency="USD", opening_balance=1000),
            "sam_uzs": Account.objects.create(name="Samarqand kassa", kind="cash", currency="UZS", branch=sam, opening_balance=1_000_000),
        }
        self.acc = acc
        cat = {c.name: c for c in ExpenseCategory.objects.all()}

        # --- mijozlar (Mijoz K — ham mijoz, ham yetkazuvchi) ---
        clients = {c: Counterparty.objects.create(name=f"Mijoz {c}", phone=f"+998 9{i} 123 45 67", is_client=True,
                                                  is_supplier=(c == "K"), supplies="Montaj xizmati" if c == "K" else "")
                   for i, c in enumerate("ABCDEFGHIJKL")}
        self.clients = clients

        # --- o'tgan oylar (grafik uchun) ---
        hist = []
        for back in range(5, 0, -1):
            for j in range(3):
                odate = day(-30 * back - j * 5)
                cur = "USD" if j == 2 else "UZS"
                amount = D(1800 + back * 150) if cur == "USD" else D((28 + back * 3 + j * 5) * 1_000_000)
                vol = D(12 + j * 4)
                o = self.order(clients["ABCDEFGHI"[(back + j) % 9]], cur, amount, vol, "delivered", odate, odate + timedelta(days=14), odate + timedelta(days=7), manager, op1 if j % 2 else op2)
                o.delivered_at = odate + timedelta(days=12 + (j == 1) * 5)
                o.save()
                self.estimate(o, mats, ops, vol, rate_mult=D("0.55") if cur == "UZS" else D("0.5"))
                hist.append(o)
                acc_pay = acc["bank_usd"] if cur == "USD" else acc["bank_uzs"]
                Transaction.objects.create(date=odate + timedelta(days=3), account=acc_pay, kind="client_payment", amount=amount, order=o)
                self.issue_materials(o, admin)

        # --- joriy buyurtmalar (maketdagilarga mos) ---
        spec = [
            # mijoz, valyuta, summa, hajm m², status, sana, reja sana, kalendar kuni, to'langan
            ("F", "UZS", 56_500_000, 30, "in_production", -53, -7, -2, [("bank_uzs", 20_000_000, -50)]),
            ("L", "USD", 1500, 6, "delivered", -45, -30, -35, [("bank_usd", 1500, -40)]),
            ("E", "USD", 1850, 7, "delivered", -49, -36, -40, [("kassa_usd", 1850, -45)]),
            ("I", "UZS", 16_220_000, 10, "confirmed", -20, 10, 3, [("kassa_uzs", 5_000_000, -18)]),
            ("H", "UZS", 20_700_000, 15, "in_production", -30, 5, 2, [("bank_uzs", 10_000_000, -28)]),
            ("G", "UZS", 23_200_000, 18, "confirmed", -25, 10, 1, [("bank_uzs", 8_000_000, -24)]),
            ("D", "UZS", 36_600_000, 24, "in_production", -46, -2, 0, [("kassa_uzs", 10_000_000, -1)]),
            ("K", "USD", 2400, 9, "confirmed", -40, 12, 4, [("bank_usd", 600, -38)]),
            ("B", "USD", 4200, D("8.4"), "in_production", -40, 8, 3, [("bank_usd", 1000, 0), ("kassa_usd", 1000, -30)]),
            ("C", "UZS", 9_000_000, 6, "ready", -42, 1, -1, [("kassa_uzs", 9_000_000, -20)]),
            ("A", "UZS", 13_000_000, 9, "new", -40, 3, 3, [("kassa_uzs", 5_000_000, -39)]),
            ("J", "USD", 900, 4, "new", -5, 11, None, []),
        ]
        orders = {}
        for c, cur, amount, vol, st, d0, dp, dprod, pays in spec:
            o = self.order(clients[c], cur, D(amount), D(vol), st, day(d0), day(dp), day(dprod) if dprod is not None else None,
                           manager, op1 if c in "ABCDEF" else op2, branch=sam if c in "JK" else None)
            if st == "delivered":
                o.delivered_at = day(dp + (3 if c == "L" else -2))
                o.save()
            orders[c] = o
            for acc_key, sum_, d in pays:
                Transaction.objects.create(date=day(d), account=acc[acc_key], kind="client_payment", amount=sum_, order=o,
                                           description=f"Mijoz {c} — to'lov")

        # Buyurtma B smetasi — maketdagi "3209 Smeta v2" bilan aynan bir xil
        b = orders["B"]
        Estimate.objects.create(order=b, version=1, is_active=False, note="Dastlabki")
        est = Estimate.objects.create(order=b, version=2, is_active=True, note="Oyna qalinligi o'zgardi")
        EstimateMaterial.objects.create(estimate=est, material=mats["profil"], qty=24, waste_pct=3, price=18)
        EstimateMaterial.objects.create(estimate=est, material=mats["oyna"], qty=D("8.4"), waste_pct=5, price=210000)
        EstimateService.objects.create(estimate=est, operation=ops["oyna"], qty=D("8.4"), rate=35000, currency="UZS")
        EstimateService.objects.create(estimate=est, operation=ops["montaj"], qty=1, rate=120, currency="USD")
        Transaction.objects.create(date=day(-6), account=acc["kassa_uzs"], kind="expense", category=cat["Transport"], amount=450_000, order=b, description="Transport (yetkazish)")
        Transaction.objects.create(date=day(-4), account=acc["kassa_usd"], kind="expense", category=cat["Subpodryad"], amount=90, order=b, description="Subpodryad — bo'yash")

        for c, o in orders.items():
            if c == "B":
                continue
            # G — oyna ko'p kerak, omborda yetmaydi → "Material yo'q"
            self.estimate(o, mats, ops, o.volume, glass_mult=D("4") if c == "G" else D("0.5"),
                          rate_mult=D("0.5") if o.currency == "USD" else D("0.6"))
        # D — zararli: katta subpodryad xarajati
        Transaction.objects.create(date=day(-10), account=acc["bank_uzs"], kind="expense", category=cat["Subpodryad"], amount=24_000_000, order=orders["D"], description="Subpodryad — montaj brigadasi")
        Transaction.objects.create(date=day(-30), account=acc["kassa_usd"], kind="expense", category=cat["Subpodryad"], amount=700, order=orders["L"], description="Subpodryad — qayta ishlash")
        Transaction.objects.create(date=day(-3), account=acc["bank_uzs"], kind="expense", category=cat["Ijara"], amount=8_000_000, description="Ijara (ustama)")
        Transaction.objects.create(date=day(-12), account=acc["bank_uzs"], kind="supplier_payment", supplier=sup["oyna"], amount=10_000_000, description="Oyna uchun to'lov")
        Transaction.objects.create(date=day(-12), account=acc["bank_usd"], kind="supplier_payment", supplier=sup["profil"], amount=4000, description="Profil uchun to'lov")

        for c in ("E", "L"):
            self.issue_materials(orders[c], admin)

        # --- ishlab chiqarish: buyurtmalardan topshiriqlar (smeta bosqichlari) ---
        from apps.production.services import complete_stage, create_job_from_order

        for c in ("D", "B", "F", "H", "C", "I", "K", "G"):
            create_job_from_order(orders[c], user=admin)

        def progress(o, upto_pos, partial=None):
            for t in ProductionTask.objects.filter(order=o).order_by("position", "id"):
                if t.position < upto_pos:
                    complete_stage(t, t.remaining, user=admin)
                elif partial and t.position == upto_pos:
                    complete_stage(t, (t.plan_qty * D(partial)).quantize(D("0.001")), user=admin)

        progress(orders["C"], 99)
        progress(orders["F"], 2, "0.5")
        progress(orders["H"], 2, "0.3")
        progress(orders["D"], 0, "0.65")
        # G: material yetishmaydi
        ProductionTask.objects.filter(order=orders["G"]).order_by("position").first().start()

        # D buyurtmasi uchun ombordan profil olindi
        # brak
        t = ProductionTask.objects.filter(order=orders["C"], department=deps["Kesish"]).first()
        t.defect_qty = t.done_qty * D("0.036")
        t.save()

        # --- HR ---
        month = T.replace(day=1)
        emps = {
            "x1": Employee.objects.create(full_name="Xodim 1", department=deps["Kesish"], position="Kesuvchi", pay_system="piece", kpi_bonus_base=420000),
            "x2": Employee.objects.create(full_name="Xodim 2", department=deps["Montaj"], position="Montajchi", pay_system="piece", kpi_bonus_base=300000),
            "x3": Employee.objects.create(full_name="Xodim 3", position="Omborchi", pay_system="salary", base_salary=3_000_000, kpi_bonus_base=300000),
        }
        for u, name, position, dep, br in staff:
            emp = Employee.objects.create(full_name=name, user=u, position=position, department=dep, phone="+998 90 111 22 33",
                                          branch=br or self.main,
                                          pay_system="salary_plan" if u in (op1, op2) else "salary",
                                          base_salary=2_500_000 if u in (op1, op2) else 5_000_000,
                                          kpi_bonus_base=500000 if u in (op1, op2) else 0, hired_at=day(-400))
            if u == op1:
                emps["o1"] = emp
            elif u == op2:
                emps["o2"] = emp
        for k, days in [("x1", 12), ("x2", 11), ("x3", 12), ("o1", 12), ("o2", 12)]:
            Timesheet.objects.create(employee=emps[k], month=month, days_worked=days, working_days=21)
        for emp in Employee.objects.exclude(timesheets__month=month):
            Timesheet.objects.create(employee=emp, month=month, days_worked=12, working_days=21)
        for o in (orders["C"], orders["F"], orders["H"], orders["D"]):
            for t in ProductionTask.objects.filter(order=o, department=deps["Kesish"]):
                if t.done_qty:
                    PieceworkEntry.objects.create(employee=emps["x1"], task=t, date=max(month, day(-2)), qty=t.done_qty)
        for t in ProductionTask.objects.filter(order=orders["C"], department=deps["Montaj"]):
            PieceworkEntry.objects.create(employee=emps["x2"], task=t, date=max(month, day(-1)), qty=t.done_qty)
        PayrollAdjustment.objects.create(employee=emps["x1"], month=month, kind="advance", amount=1_000_000)
        PayrollAdjustment.objects.create(employee=emps["x3"], month=month, kind="advance", amount=800_000)
        PayrollAdjustment.objects.create(employee=emps["o1"], month=month, kind="advance", amount=500_000)

        for min_pct, coef in [(110, D("1.1")), (90, D("1.0")), (80, D("0.9")), (0, D("0"))]:
            KpiScale.objects.create(template=None, min_pct=min_pct, coefficient=coef)
        tpl = {
            "sales": KpiTemplate.objects.create(name="Sotuv summasi", unit="mln so'm", direction="higher", cap_pct=150),
            "ontime": KpiTemplate.objects.create(name="Muddatida topshirish", unit="%", direction="higher", cap_pct=120),
            "defect": KpiTemplate.objects.create(name="Brak", unit="%", direction="lower", cap_pct=120),
            "inv": KpiTemplate.objects.create(name="Inventarizatsiya aniqligi", unit="%", direction="higher", cap_pct=100),
        }
        KpiResult.objects.create(template=tpl["sales"], month=month, employee=emps["o1"], plan=600, fact=540)
        KpiResult.objects.create(template=tpl["sales"], month=month, employee=emps["o2"], plan=600, fact=690)
        KpiResult.objects.create(template=tpl["ontime"], month=month, department=deps["Kesish"], plan=90, fact=84)
        KpiResult.objects.create(template=tpl["defect"], month=month, department=deps["Kesish"], plan=3, fact=D("3.6"))
        KpiResult.objects.create(template=tpl["inv"], month=month, employee=emps["x3"], plan=99, fact=D("99.4"))

        self.seed_sales(orders, mats, g_acc, admin, op1, op2)

    # ------------------------------------------------------------------
    def seed_sales(self, orders, mats, g_acc, admin, op1, op2):
        T = self.T
        pt = {p.name: p for p in PriceType.objects.all()}
        g_ready = MaterialGroup.objects.create(name="Tayyor mahsulot")
        prods = {
            "deraza": Material.objects.create(name="Deraza 1200×1500 (2 tabaqali)", sku="DR-1215", type="product", group=g_ready,
                                              unit="pcs", currency="UZS", purchase_price=1_150_000, min_qty=5),
            "eshik": Material.objects.create(name="Eshik bloki 900×2100", sku="ES-0921", type="product", group=g_ready,
                                             unit="pcs", currency="UZS", purchase_price=2_300_000, min_qty=3),
            "moskit": Material.objects.create(name="Moskit to'r", sku="MS-01", type="goods", group=g_acc,
                                              unit="pcs", currency="UZS", purchase_price=95_000, min_qty=20),
            "ornatish": Material.objects.create(name="O'rnatish xizmati", type="service", unit="pcs", currency="UZS"),
        }
        price_list = {
            "deraza": (1_650_000, 1_500_000), "eshik": (3_200_000, 2_950_000), "moskit": (150_000, 125_000),
            "ornatish": (250_000, 200_000),
        }
        for k, (retail, whole) in price_list.items():
            ProductPrice.objects.create(product=prods[k], price_type=pt["Chakana"], price=retail)
            ProductPrice.objects.create(product=prods[k], price_type=pt["Ulgurji"], price=whole)
        ProductPrice.objects.create(product=mats["furn"], price_type=pt["Chakana"], price=130_000)
        ProductPrice.objects.create(product=mats["furn"], price_type=pt["Ulgurji"], price=110_000)
        for k, wh, qty in [("deraza", self.wh_main, 24), ("eshik", self.wh_main, 10), ("moskit", self.wh_main, 60),
                           ("deraza", self.wh_sam, 8), ("moskit", self.wh_sam, 15)]:
            post_move(StockMove(date=T - timedelta(days=20), type="in", material=prods[k], warehouse=wh, qty=qty,
                                price=prods[k].purchase_price, created_by=admin, note="Ishlab chiqarishdan"))
        self.clients["L"].price_type = pt["Ulgurji"]
        self.clients["L"].save()

        def sale(client, wh, items, user, days_ago, branch=None, price_type="Chakana", discount=0):
            s = Sale.objects.create(client=client, warehouse=wh, currency="UZS", price_type=pt[price_type],
                                    date=T - timedelta(days=days_ago), seller=user, created_by=user,
                                    branch=branch or self.main, discount=discount)
            for pos, (k, qty) in enumerate(items):
                p = prods.get(k) or mats[k]
                SaleItem.objects.create(sale=s, product=p, qty=qty, price=p.price_for(pt[price_type]), position=pos)
            return s

        s1 = sale(self.clients["A"], self.wh_main, [("deraza", 4), ("moskit", 4), ("ornatish", 4)], op1, 9)
        sale_services.complete_sale(s1)
        sale_services.register_payment(s1, account=self.acc["kassa_uzs"], amount=s1.total, user=op1)
        s2 = sale(self.clients["L"], self.wh_main, [("eshik", 3), ("deraza", 6), ("moskit", 10)], op1, 5,
                  price_type="Ulgurji", discount=500_000)
        sale_services.complete_sale(s2)
        sale_services.register_payment(s2, account=self.acc["bank_uzs"], amount=10_000_000, user=admin)
        s3 = sale(self.clients["J"], self.wh_sam, [("deraza", 2), ("moskit", 2)], op2, 2, branch=self.wh_sam.branch)
        sale_services.complete_sale(s3)
        sale_services.register_payment(s3, account=self.acc["sam_uzs"], amount=1_000_000, user=op2)
        sale(self.clients["B"], self.wh_main, [("eshik", 1), ("ornatish", 1)], op1, 0)  # qoralama
        # buyurtmadan sotuv: E (topshirilgan, USD) — yakunlangan; C (tayyor) — qoralama
        se, _ = sale_services.sale_from_order(orders["E"], admin)
        sale_services.complete_sale(se)
        sale_services.sale_from_order(orders["C"], admin)

        # --- MoySklad uslubida: texjarayon + texkarta + ishlab chiqarish buyurtmasi ---
        from apps.production.models import Operation, ProductionOrder, ProductionOrderItem, TechCard, TechCardMaterial, TechProcess, TechProcessStage
        from apps.production.services import complete_stage, create_jobs_for_production_order

        ops = {o.name: o for o in Operation.objects.all()}
        proc = TechProcess.objects.create(name="Deraza (standart)", description="Kesish → Yig'ish → Qadoqlash")
        for pos, name in enumerate(["Profil kesish", "Yig'ish", "Qadoqlash"]):
            TechProcessStage.objects.create(process=proc, operation=ops[name], position=pos)
        tc = TechCard.objects.create(name="Deraza 1200×1500", product=prods["deraza"], output_qty=1, process=proc)
        TechCardMaterial.objects.create(techcard=tc, material=mats["profil"], qty=D("1.5"), operation=ops["Profil kesish"])
        TechCardMaterial.objects.create(techcard=tc, material=mats["oyna"], qty=D("1.8"))
        TechCardMaterial.objects.create(techcard=tc, material=mats["furn"], qty=1, operation=ops["Yig'ish"])
        post_move(StockMove(date=T - timedelta(days=3), type="in", material=mats["oyna"], warehouse=self.wh_main, qty=40,
                            price=205000, created_by=admin, note="Texkarta uchun xarid"))
        po = ProductionOrder.objects.create(plan_date=T + timedelta(days=7), branch=self.main, note="Ombor zaxirasi uchun")
        ProductionOrderItem.objects.create(production_order=po, techcard=tc, qty=10)
        job = create_jobs_for_production_order(po, materials_warehouse=None, products_warehouse=self.wh_main, user=admin)[0]
        t1, t2, _ = list(job.tasks.order_by("position"))
        complete_stage(t1, 6, user=admin)
        complete_stage(t2, 4, user=admin)

    # ------------------------------------------------------------------
    def order(self, client, cur, amount, vol, status, d, plan, prod, manager, operator, branch=None):
        return Order.objects.create(client=client, currency=cur, amount=amount, volume=vol, status=status, date=d,
                                    plan_date=plan, production_date=prod, manager=manager, operator=operator,
                                    branch=branch or self.main, created_by=manager)

    def estimate(self, o, mats, ops, vol, glass_mult=D("0.5"), rate_mult=D("0.6")):
        est = o.active_estimate or Estimate.objects.create(order=o, version=1)
        EstimateMaterial.objects.create(estimate=est, material=mats["profil"], qty=(vol * D("1.0")).quantize(D("1")), waste_pct=3, price=18)
        EstimateMaterial.objects.create(estimate=est, material=mats["oyna"], qty=vol * glass_mult, waste_pct=5, price=210000)
        EstimateMaterial.objects.create(estimate=est, material=mats["furn"], qty=max(1, int(vol / 4)), waste_pct=0, price=D("6.5"))
        EstimateService.objects.create(estimate=est, operation=ops["oyna"], qty=vol * glass_mult, rate=35000, currency="UZS")
        EstimateService.objects.create(estimate=est, operation=ops["yigish"], qty=max(1, int(vol / 3)), rate=60000, currency="UZS")
        EstimateService.objects.create(estimate=est, operation=ops["montaj"], qty=max(1, int(vol / 6)), rate=120, currency="USD")
        return est

    def issue_materials(self, o, user):
        for m in o.active_estimate.materials.select_related("material"):
            # tarixiy buyurtma: avval xarid (kirim), so'ng chiqim — joriy qoldiq o'zgarmaydi
            stock = m.material.stocks.order_by("-qty").first()
            qty = (m.qty_with_waste * D("1.02")).quantize(D("0.001"))
            post_move(StockMove(date=o.date + timedelta(days=2), type="in", material=m.material, warehouse=stock.warehouse, qty=qty, price=m.price, created_by=user, note="Buyurtma uchun xarid"))
            post_move(StockMove(date=o.date + timedelta(days=5), type="out", material=m.material, warehouse=stock.warehouse, qty=qty, order=o, created_by=user))
