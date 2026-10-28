# Server API

Базовый URL лаунчера: `https://<домен>/minecraft/api`.

Старые клиенты читают манифест и скачивают сборку одним ZIP. Новая пофайловая отдача и админка живут на `/minecraft/api/v1`. Панель открывается по `/admin`.

## Локально без SSL

Скопируйте `.env.example` в `.env`. `DOMAIN` и сертификаты не нужны.

```bash
npm install
npm run dev
```

В другом терминале:

```bash
cd admin
npm install
npm run dev
```

API: `http://localhost:8080`. Панель: `http://localhost:5173/admin`. Vite проксирует `/minecraft/api` на API.

Docker без nginx:

```bash
docker compose -f docker-compose.local.yml up --build
```

Продакшен с HTTPS по-прежнему поднимается через `docker-compose.yml` и nginx.

## Каталоги

| Путь | Назначение |
|------|------------|
| `game/` | Распакованная сборка |
| `data/` | `manifest.json`, `minecraft_files.zip`, `version.json`, `latest.yml` |
| `launcher/` | Файлы установщика лаунчера |
| `builds/` | Клон исходников лаунчера и кэш сборки |
| `uploads/` | Временные загрузки |

## Авторизация

Админские маршруты `v1` требуют `Authorization: Bearer <token>`.

```bash
curl -X POST http://localhost:8080/minecraft/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"change-me\"}"
```

Ответ: `{ "token": "...", "expiresIn": "12h" }`. Логин и пароль берутся из `ADMIN_USERNAME` и `ADMIN_PASSWORD`, подпись — `JWT_SECRET`.

`x-secret-key` больше не используется. Старые `POST /upload` и `POST /uploadGame` сняты.

## Legacy

Без токена, контракт прежний.

### `GET /minecraft/api/manifest`

```json
{ "files": { "mods/example.jar": { "sha1": "...", "size": 123 } } }
```

### `GET /minecraft/api/download`

`data/minecraft_files.zip`. Если архив старше манифеста, он пересобирается перед отдачей.

### `GET /minecraft/api/latest`

`{ "version": "1.6.5", "url": "https://jenison.ru/download" }`

### `GET /minecraft/api/latest.yml`

Файл для electron-updater.

### `GET /minecraft/api/downloadGame.exe`

Первый файл из `launcher/`.

### `GET /minecraft/api/launcher-setup-<версия>.exe`

Конкретный установщик из `launcher/`. Этот адрес electron-updater берёт из `latest.yml`. Отдаются только имена вида `launcher-setup-*.exe`.

## v1, публично

### `GET /minecraft/api/v1/profile`

Профиль сборки из `data/profile.json`. Без файла сервер отвечает `404` и ничего не создаёт.

```json
{
  "mcVersion": "1.21.1",
  "loader": "fabric",
  "loaderVersion": "0.16.14",
  "servers": [{ "ip": "jenison.ru", "lable": "Chikadrilo Online" }]
}
```

`loader`: `vanilla`, `fabric`, `forge`, `quilt`, `neoforge`. У `vanilla` поле `loaderVersion` пустое. У остальных это уже зафиксированный номер, а не «последняя на момент запуска».

### `GET /minecraft/api/v1/manifest`

Тот же JSON, что и legacy-манифест.

### `GET /minecraft/api/v1/files/<путь>`

Один файл из `game/`. Путь как в манифесте, например `mods/example.jar`. Выход из каталога (`..`) отвечает `400`.

## v1, админ

### `GET /minecraft/api/v1/admin/profile`

Тот же JSON, что у публичного профиля. `404`, если файл ещё не сохранён.

### `PUT /minecraft/api/v1/admin/profile`

JSON того же вида. Пустой `loaderVersion` значит «рекомендуемая»: сервер записывает конкретный номер из списка загрузчика. Если список версий недоступен, файл не меняется и ответ `502`. Неизвестная версия Minecraft или загрузчика — `400`. Для `vanilla` сохраняется пустая версия загрузчика. Файлы в `game/` этот запрос не трогает.

### `GET /minecraft/api/v1/admin/game/versions`

`{ "versions": ["1.21.1"] }` — только релизы Mojang.

### `GET /minecraft/api/v1/admin/game/loaders?mcVersion=&loader=`

`{ "versions": ["0.16.14"], "recommended": "0.16.14" }`. Для `vanilla` оба поля пустые. Списки кэшируются в памяти сервера около 10 минут.

### `GET /minecraft/api/v1/admin/files?q=&limit=&offset=`

Страница списка: `{ total, limit, offset, files: [{ path, sha1, size }] }`.

### `PUT /minecraft/api/v1/admin/files`

Multipart: поле `file` и текстовое поле `path`. Путь должен заканчиваться на `.jar`. Файл пишется в `game/` рядом с остальными, в манифесте обновляется одна запись. Несколько модов отправляются отдельными запросами. Legacy-ZIP пересобирается при следующем `GET /download`, если он старше манифеста.

### `DELETE /minecraft/api/v1/admin/files`

JSON `{ "path": "mods/example.jar" }`.

### `GET /minecraft/api/v1/admin/mods/search?source=&q=&gameVersion=&loader=&offset=`

`source`: `modrinth` или `curseforge`. `loader`: `fabric`, `forge`, `neoforge`, `quilt`. Версия и загрузчик обязательны.

Ответ: `{ total, hits: [{ id, title, description, iconUrl }] }`.

Modrinth вызывается без ключа. CurseForge использует `CURSEFORGE_API_KEY` на сервере. Если ключ пустой, маршрут отвечает `503`.

### `POST /minecraft/api/v1/admin/mods/install`

JSON `{ "source", "projectId", "gameVersion", "loader" }`. Сервер скачивает последний релизный `.jar` под эти фильтры и сохраняет его как `mods/<имя файла>.jar`. Манифест обновляется сразу. Legacy-ZIP пересобирается при следующем `GET /download`. Зависимости мода не ставятся.

### `GET /minecraft/api/v1/admin/launcher`

`{ "version": "1.6.5", "yml": "..." }`

### `POST /minecraft/api/v1/admin/launcher`

Заголовок `version`, multipart-поле `file` (ZIP установщика) и текстовое поле `yml` (содержимое `latest.yml`).

### `GET /minecraft/api/v1/admin/launcher/settings`

Настройки сборки лаунчера. Если файл ещё не сохраняли, адрес API берётся из `PUBLIC_API_URL` или `https://<DOMAIN>/minecraft/api`.

```json
{
  "apiUrl": "https://example.com/minecraft/api",
  "productName": "Custom Minecraft Launcher",
  "appId": "ru.jenison.cml",
  "version": "",
  "theme": { "--color-bg": "#0c0d10" },
  "hasIcon": false,
  "iconDataUrl": null
}
```

Пустая `version` значит: взять версию из `package.json` репозитория.

### `PUT /minecraft/api/v1/admin/launcher/settings`

Те же поля, кроме `hasIcon` и `iconDataUrl`. `appId` — reverse-domain. `version` пустая или `X.Y.Z`. В `theme` только токены `--color-*` и значения hex, `rgb`, `hsl` или `color-mix`.

### `PUT /minecraft/api/v1/admin/launcher/icon`

Multipart-поле `file`: PNG не меньше 256×256.

### `POST /minecraft/api/v1/admin/launcher/build`

Запускает сборку и сразу отвечает `202 { "status": "running" }`. Сервер клонирует `LAUNCHER_REPO_URL` (`LAUNCHER_REPO_REF`, по умолчанию `main`), подставляет настройки и собирает Windows NSIS. Повторный запрос, пока сборка идёт, отвечает `409`.

### `GET /minecraft/api/v1/admin/launcher/build`

```json
{
  "status": "idle",
  "startedAt": null,
  "finishedAt": null,
  "commit": null,
  "version": null,
  "error": null,
  "log": ""
}
```

`status`: `idle`, `running`, `success`, `failed`. `log` — хвост `builds/build.log`.
