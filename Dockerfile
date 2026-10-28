# syntax=docker/dockerfile:1
# Wine нужен, чтобы electron-builder собрал NSIS на Linux. Тег с датой фиксирует набор инструментов.
FROM electronuserland/builder:22-wine-05.26

RUN if ! command -v git >/dev/null 2>&1; then apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; fi

ENTRYPOINT []

WORKDIR /app

# Зависимости API и панели ставятся отдельными слоями.
# Пока не меняются package.json и lock-файлы, npm не запускается заново.
COPY package.json package-lock.json ./
COPY admin/package.json admin/package-lock.json admin/

RUN --mount=type=cache,target=/root/.npm \
    npm ci

RUN --mount=type=cache,target=/root/.npm \
    npm --prefix admin ci

COPY . .

RUN npm run build && npm --prefix admin run build

ENV NODE_ENV=production

EXPOSE ${PORT:-8080}

CMD ["npm", "run", "start"]
