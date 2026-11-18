# PythonAnywhere'ga joylash

Ilova bitta domenda ishlaydi: Django API (`/api/`), admin (`/admin/`) va React build (`frontend/dist`) ni Django o'zi beradi.
Quyida `USERNAME` — PythonAnywhere foydalanuvchi nomingiz.

## 1. Ma'lumotlar bazasi

| Tarif | Baza | `.env` |
|---|---|---|
| Bepul (Beginner) | MySQL | `DB_ENGINE=mysql` |
| Pullik (Hacker va yuqori) | PostgreSQL (qo'shimcha xizmat) | `DB_ENGINE=postgres` |

**MySQL:** Databases → MySQL → parol o'rnating → `akfa` nomli baza yarating. Baza to'liq nomi: `USERNAME$akfa`, host: `USERNAME.mysql.pythonanywhere-services.com`.

## 2. Kodni yuklash (Bash console)

```bash
git clone https://github.com/salikhabduvaliyev/savdoErp.git
cd savdoErp/backend
mkvirtualenv akfa --python=python3.11
pip install -r requirements.txt
pip install mysqlclient          # faqat MySQL uchun
cp .env.example .env
nano .env                        # quyidagi qiymatlarni yozing
```

`.env` (MySQL misolida):

```
DJANGO_SECRET_KEY=<uzun tasodifiy qator>
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=USERNAME.pythonanywhere.com
CSRF_TRUSTED_ORIGINS=https://USERNAME.pythonanywhere.com
DB_ENGINE=mysql
DB_NAME=USERNAME$akfa
DB_USER=USERNAME
DB_PASSWORD=<MySQL paroli>
DB_HOST=USERNAME.mysql.pythonanywhere-services.com
CORS_ALLOWED_ORIGINS=https://USERNAME.pythonanywhere.com
```

Maxfiy kalit yaratish: `python -c "import secrets; print(secrets.token_urlsafe(50))"`

```bash
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py createsuperuser      # platforma admini (kompaniyalarga muddat beradi)
```

Demo ma'lumot kerak bo'lsa (ixtiyoriy): `python manage.py seed_demo`

## 3. Web ilova (Web tab)

1. **Add a new web app** → *Manual configuration* → Python 3.11.
2. **Virtualenv:** `/home/USERNAME/.virtualenvs/akfa`
3. **WSGI configuration file** — ichini to'liq almashtiring:

```python
import os
import sys

path = "/home/USERNAME/savdoErp/backend"
if path not in sys.path:
    sys.path.insert(0, path)
os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings"

from django.core.wsgi import get_wsgi_application  # noqa: E402

application = get_wsgi_application()
```

4. **Static files** (tezroq ishlashi uchun):

| URL | Directory |
|---|---|
| `/static/` | `/home/USERNAME/savdoErp/backend/staticfiles` |
| `/assets/` | `/home/USERNAME/savdoErp/frontend/dist/assets` |

5. **Force HTTPS** — yoqing. **Reload** tugmasini bosing.

Ochish: `https://USERNAME.pythonanywhere.com`

## 4. Yangilash (keyingi o'zgarishlar)

Frontend build (`frontend/dist`) repoga qo'shib yuboriladi, PythonAnywhere'da Node.js kerak emas.
Lokal kompyuterda: `cd frontend && npm run build`, keyin commit va push.

```bash
cd ~/savdoErp && git pull
cd backend && workon akfa
pip install -r requirements.txt
python manage.py migrate
python manage.py collectstatic --noinput
```

So'ng Web tab → **Reload**.

## Eslatmalar

- **CBU kurslari:** bepul tarifda tashqi saytlarga kirish cheklangan (faqat ruxsat etilganlar ro'yxati). `cbu.uz` ro'yxatda bo'lmasa, kurslar avtomatik olinmaydi. Ularni Sozlamalar → Valyutalar'da qo'lda kiritasiz yoki pullik tarifga o'tasiz.
- **Kurslarni har kuni yangilash** (pullik tarif): Tasks → Scheduled task, kuniga bir marta:
  `/home/USERNAME/.virtualenvs/akfa/bin/python /home/USERNAME/savdoErp/backend/manage.py update_rates`
- **Lokal ma'lumotlarni ko'chirish** (PostgreSQL → MySQL): lokalda
  `python manage.py dumpdata --natural-foreign --exclude contenttypes --exclude auth.permission --exclude sessions -o data.json`,
  serverda migratsiyadan keyin `python manage.py loaddata data.json`.
