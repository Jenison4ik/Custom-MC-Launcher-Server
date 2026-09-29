# Custom MC Launcher Server

Сервер раздачи сборки и админка для [Custom MC Launcher](https://github.com/Jenison4ik/Custom-MC-Launcher-CML-). Игроки получают профиль, моды и обновления лаунчера отсюда. Сборку собирают в панели `/admin`.

Нужен [Node.js](https://nodejs.org/) 22+.

## Локально

```bash
git clone https://github.com/Jenison4ik/Custom-MC-Launcher-Server
cd Custom-MC-Launcher-Server
cp .env.example .env
npm install
npm run dev
```

В другом терминале:

```bash
cd admin
npm install
npm run dev
```

API: `http://localhost:8080`. Панель: `http://localhost:5173/admin`. Логин и пароль — `ADMIN_USERNAME` и `ADMIN_PASSWORD` из `.env`.

Docker без nginx:

```bash
docker compose -f docker-compose.local.yml up --build
```

## Продакшен

В `.env` задайте `DOMAIN`. Первый запуск и сертификат описаны в [nginx/SSL_SETUP.md](./nginx/SSL_SETUP.md) и [nginx/README.md](./nginx/README.md).

```bash
docker compose up -d nginx app
```

Контракт API — в [API.md](./API.md), список маршрутов — в [ROUTES.md](./ROUTES.md).

## Лицензия

MIT
