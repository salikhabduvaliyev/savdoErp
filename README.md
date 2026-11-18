# Akfa ERP

Buyurtmadan tannarxgacha — bitta tizimda: buyurtmalar, smeta (tannarx), ishlab chiqarish, ombor, moliya, KPI va oylik.
Qarzdorlik va summalar **so'm va USD'da alohida** yuritiladi.

| Qatlam | Texnologiya |
|---|---|
| Backend | Python 3.14, Django 5.2, Django REST Framework, SimpleJWT |
| Frontend | React 19, Vite 6, React Router 7, Axios |
| Baza | PostgreSQL 17 |

## Ishga tushirish

### 1. Baza

```bash
# psql yoki pgAdmin orqali
CREATE DATABASE akfa_erp;
```

`backend/.env` faylida `DB_PASSWORD` (va kerak bo'lsa `DB_USER`) ni to'ldiring.

### 2. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_demo        # demo ma'lumotlar (ixtiyoriy)
python manage.py runserver
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                       # http://localhost:5173
```

Vite `/api` va `/admin` so'rovlarini `127.0.0.1:8000` ga proksi qiladi.

### Demo foydalanuvchilar (`seed_demo` dan keyin)

| Login | Parol | Kim |
|---|---|---|
| platform | platform12345 | **Platforma admini** — kompaniyalar, obuna muddatlari (biznes ma'lumotlarini ko'rmaydi) |
| admin | admin12345 | "Akfa Demo" kompaniyasi egasi (barcha huquqlar) |
| menejer, operator1, ishlab, omborchi, hisobchi, kesish | demo12345 | Bosh ofis xodimlari |
| operator2, kassir | demo12345 | Samarqand filiali (faqat shu filial) |

Yangi kompaniya: login sahifasida **"14 kun bepul sinab ko'ring"** → ro'yxatdan o'tish.

### Testlar

```bash
cd backend
python manage.py test apps         # PostgreSQL'da
# yoki tezkor: DB_ENGINE=sqlite python manage.py test apps
```

## Tuzilma

```
backend/
  config/            sozlamalar, URL'lar
  apps/core/         valyuta, kurs, MoneyBag (ko'p valyutali summa), seed_demo, testlar
  apps/core/         + Kompaniya rekvizitlari, Umumiy sozlamalar (singleton)
  apps/accounts/     foydalanuvchi, sozlanadigan rollar (modul × none/view/edit), JWT
  apps/crm/          kontragentlar: mijozlar, yetkazuvchilar (rekvizitlar, karta, qarz)
  apps/orders/       buyurtma, smeta (versiyalar, A/B bloklar), tannarx hisobi
  apps/production/   bo'limlar, operatsiyalar, topshiriqlar, material zayavkalari
  apps/warehouse/    materiallar, qoldiq, rezerv, kirim/chiqim/o'tkazma/inventarizatsiya
  apps/finance/      kassa/bank, pul harakatlari, debitor/kreditor, foyda-zarar, pul oqimi
  apps/hr/           xodimlar, tabel, ishbay, KPI, oylik vedomost
  apps/dashboard/    direktor va ishlab chiqarish dashboardlari
frontend/src/
  components/Layout  sidebar (rol huquqlariga qarab), yig'iladi, mobil menyu
  pages/counterparties/  Kontragentlar: mijozlar / yetkazuvchilar, karta (buyurtmalar, to'lovlar, qarz)
  pages/company/     Kompaniya: rekvizitlar, xodimlar (+login berish), bo'limlar va operatsiyalar, omborlar, kassa/bank
  pages/settings/    Sozlamalar: foydalanuvchilar, rollar va huquqlar, umumiy sozlamalar, valyuta kursi, ma'lumotnomalar
  pages/orders/      Ro'yxat, Ustunlar (kanban), Kalendar, buyurtma kartasi, smeta
  pages/production/  Bo'lim boshlig'i ekrani, dashboard, zayavkalar
  pages/warehouse/   Qoldiqlar, harakatlar
  pages/finance/     To'lovlar, qarzlar, foyda-zarar, pul oqimi, kurslar
  pages/hr/          KPI, shablonlar, vedomost, tabel
  pages/dashboard/   Direktor dashboardi
```

## Ko'p kompaniya (SaaS), filiallar, obuna

- Har bir kompaniya alohida (bitta baza, har jadvalda `company`; `apps/core/tenancy.py` so'rovlarni avtomatik filtrlaydi).
- Ro'yxatdan o'tgan kompaniya **14 kun** bepul ishlaydi; muddatni **platforma admini** uzaytiradi yoki bloklaydi (`/platform`). Muddat tugasa — API 402 qaytaradi, ekranda bloklash oynasi.
- **Filiallar**: buyurtma, sotuv, ombor, kassa, xodim filialga bog'lanadi. Yuqori panelda filial tanlanadi (`X-Branch` sarlavhasi). Foydalanuvchiga ruxsat etilgan filiallar Sozlamalar → Foydalanuvchilar'da beriladi.

## Savdo va tovarlar

- **Tovarlar** — yagona nomenklatura: xomashyo, tayyor mahsulot, tovar, xizmat. Narx turlari (Chakana, Ulgurji…) bo'yicha narxlar; tannarx — ombordagi o'rtacha narx.
- **Sotuvlar** — qoralama → yakunlash (ombordan chiqim, tannarx yoziladi) → to'lov qabul qilish. Bekor qilinsa tovar omborga qaytadi.
- **Buyurtmadan sotuv** — tayyor buyurtmada "Sotuv qilish": buyurtma sotuvga aylanadi, oldingi avanslar sotuv to'loviga o'tadi, qarz ikki marta hisoblanmaydi, buyurtma "Topshirildi" bo'ladi.
- **Kontragent** bitta jadval: "Mijoz" va/yoki "Yetkazuvchi" belgilari.

## Ishlab chiqarish (MoySklad tuzilmasi)

| Tab | Vazifasi |
|---|---|
| Bosqichlar | Этапы — bo'lim (ijrochi), birlik, ishbay stavka |
| Texjarayonlar | Техпроцессы — bosqichlar ketma-ketligi |
| Texkartalar | Техкарты — mahsulot, materiallar me'yori (bosqichga bog'lanadi), rejaviy tannarx |
| Ishlab chiqarish buyurtmalari | Заказы на производство → topshiriqlar yaratish |
| Topshiriqlar | Производственные задания — texkarta × miqdor yoki mijoz buyurtmasi (smeta) |
| Bosqichlarni bajarish | Выполнение этапов — material chiqimi, ishbay haq, oxirgi bosqichda mahsulot kirimi (haqiqiy tannarx) |
| Mehnatga haq / Holat | Оплата труда / Статус производства |

## Interfeys

- **Mavzu**: yorug' / qorong'i / tizim; **til**: o'zbekcha (lotin), ўзбекча (kirill — avtomatik transliteratsiya), русский (`frontend/src/locales/ru.json`). Foydalanuvchi menyusida, serverda saqlanadi.
- **⚙ Sahifa sozlamalari**: ustunlar, bo'limlar (kartochkalar, filtr), qator o'lchami — har foydalanuvchiga alohida.
- **Qo'shimcha maydonlar** (Sozlamalar yoki ⚙ orqali): buyurtma, kontragent, sotuv — formada, ro'yxat ustunida va filtrda.
- **Kontragent** to'liq sahifada: holat, guruhlar, rekvizitlar, hodisalar (izohlar), hujjatlar, ko'rsatkichlar.
- Yangi matn qo'shganda: `t("Matn")` bilan o'rang va `ru.json` ga tarjima qo'shing.

## Rollar va huquqlar

- **Xodim** (Kompaniya → Xodimlar) — kompaniya tuzilmasi: lavozim, bo'lim, ish haqi. Har bir xodim ham tizimga kirmaydi.
- **Foydalanuvchi** — tizimga kira oladigan xodim. Login, parol va rol **Sozlamalar → Foydalanuvchilar**da (yoki xodim formasining "Tizimga kirish" qismida) beriladi.
- **Rol** (Sozlamalar → Rollar va huquqlar) — har bir bo'limga `Ko'rish / Yaratish / Tahrirlash / O'chirish` + "Ko'radi: hammasini / o'zinikini" (buyurtma, sotuv). Tezkor: Hammasi / Faqat ko'rish / Hech narsa. Yangi rol qo'shish mumkin; tizim rollari o'chirilmaydi. Kompaniya egasi har doim barcha huquqlarga ega.
- "Faqat o'z bo'limi" belgisi — bo'lim boshlig'i faqat o'z bo'limi topshiriqlarini ko'radi.
- Maosh maydonlari faqat "KPI va oylik" huquqi borlarga ko'rinadi.
- Backend'da har bir API `module = "..."` bilan himoyalangan (`apps/accounts/permissions.py`); tanlash ro'yxatlari (bo'limlar, materiallar, kontragentlar) hamma kirganlarga o'qish uchun ochiq.

## Maketlardagi muammolar va qabul qilingan yechimlar

| # | Muammo (UI/UX maketida) | Yechim (kodda) |
|---|---|---|
| 1 | Kanban "Yangi" ustunida so'm va USD qo'shib yuborilgan ("22 000 000 so'm") | Barcha jamilar `MoneyBag` orqali valyuta bo'yicha alohida — `apps/core/money.py` |
| 2 | Status ustunida bo'lim nomlari (Kesish, Montaj) aralashgan | `Order.status` (biznes holat) va `Order.stage` (hozirgi bo'lim, topshiriqlardan hisoblanadi) alohida |
| 3 | Kalendar va ro'yxatdagi sanalar mos emas | `plan_date` — mijozga topshirish muddati; `production_date` — kalendar kuni (sudrab o'zgartiriladi) |
| 4 | Kechikish "5 kun" va "7 kun" deb har xil | Yagona formula `Order.overdue_days` = bugun − reja sana |
| 5 | Qizil qator qoidasi yo'q | Qizil qator = reja sana o'tgan va topshirilmagan |
| 6 | Oylik: kartochkada 13 000 000, jadvalda 13 400 000 | Kartochka va jadval jami bitta `payroll()` funksiyasidan |
| 7 | Smeta C bloki va moliyada sanalar farq qiladi | C blok to'g'ridan-to'g'ri `finance.Transaction` dan olinadi (yagona manba) |
| 8 | Ombor holati "Kam" / "Minimalga yaqin" chalkash | mavjud ≤ minimal → Kam; ≤ minimal×1,2 → Minimalga yaqin (`settings.ERP`) |
| 9 | Profil kesish "m²" da | O'lchov birligi operatsiyaga bog'langan |
| 10 | "Material yo'q", lekin omborda bor | Rezerv + bo'sh qoldiq hisobga olinadi, aniq yetishmaydigan miqdor ko'rsatiladi va zayavka avtomatik yaratiladi |
| 11 | Navigatsiya har ekranda har xil | Bitta `Layout`, rolga qarab bo'limlar |
| 12 | Valyuta kursi yo'q | `ExchangeRate` jadvali; aylantirish faqat aniq sana kursi bilan |
| 13 | Smetada jami va foyda yo'q | Smeta pastida: valyuta bo'yicha tannarx, buyurtma valyutasiga keltirilgan tannarx, foyda, rentabellik |
| 14 | KPI formulalari aniqlanmagan | `direction` (ko'p/kam — yaxshi), `cap_pct` (yuqori chegara), koeffitsiyentlar shkalasi |
| 16 | Biznes qoidalari kodda qotib qolgan | Sig'im, brak me'yori, "minimalga yaqin" koeffitsiyenti, buyurtma raqami — Sozlamalar → Umumiy sozlamalar |
| 15 | Ustama xarajatlar | `ExpenseCategory.is_overhead` — buyurtmaga biriktirilmaydi, Foyda va zararda alohida qator |

### Valyuta qoidalari

- Har bir pul summasi `(summa, valyuta)` juftligi bilan saqlanadi. Pul uchun `numeric`, float hech qachon ishlatilmaydi.
- Kassa/bank operatsiyasining valyutasi = hisob valyutasi. Operatsiya buyurtmaga biriktirilsa, `order_amount` — buyurtma valyutasidagi ekvivalent (operatsiya sanasidagi kurs bo'yicha yoki qo'lda kiritilgan).
- Buyurtma foydasi buyurtma valyutasida hisoblanadi: A, B bloklar buyurtma sanasidagi kurs bilan, C xarajat sanasidagi kurs bilan, D ishbay yozuvi sanasidagi kurs bilan aylantiriladi.
- Dashboard'da "so'm" ustuni — so'mdagi buyurtmalar, "USD" ustuni — dollardagi buyurtmalar.

## Keyingi bosqichlar

- Jo'natmalar (yetkazib berish) moduli
- Hisoblar orasida o'tkazma va valyuta ayirboshlash (kassa USD → bank so'm)
- Xarid buyurtmalari (zayavka → yetkazuvchiga buyurtma → kirim)
- Oyni yopish (vedomostni muzlatish) va oylikni moliyaga o'tkazish
- Audit log, bildirishnomalar (Telegram), chizma fayllarini yuklash UI
- Mobil/planshet uchun bo'lim boshlig'i ekranini optimallashtirish
- CBU'dan kursni avtomatik olish

## Serverga joylash

PythonAnywhere uchun qadamma-qadam qo'llanma: [DEPLOY.md](DEPLOY.md)
