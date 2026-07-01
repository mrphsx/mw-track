# Монорепо с npm workspaces: общий node_modules лежит в корне, поэтому
# собираем из контекста корня репозитория (build context = ".", не "apps/api"),
# а не пытаемся изолированно собрать одно приложение.
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json tsconfig.json tsconfig.base.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY prisma ./prisma

RUN npm ci

COPY apps/api ./apps/api

# Генерировать клиент нужно именно в alpine-окружении — Prisma подбирает
# нужный (musl) бинарник query-engine по платформе, на которой выполняется generate.
RUN npx prisma generate
RUN npm run build --workspace=apps/api

FROM node:20-alpine AS production

RUN apk add --no-cache openssl curl

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/prisma ./prisma

EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
