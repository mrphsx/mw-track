FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY apps/api/package*.json ./apps/api/

RUN npm ci

COPY apps/web ./apps/web

ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* запекаются в JS-бандл во время сборки, а не читаются заново
# при старте контейнера — поэтому это build arg, а не просто env_file для
# рантайма (если передать только через env_file, фронтенд продолжит стучаться
# по адресу, с которым собрался образ).
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN npm run build --workspace=apps/web

FROM node:20-alpine AS production

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
