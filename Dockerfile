# ---------- 1. Сборка TypeScript ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- 2. Боевой образ ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Только боевые зависимости, без typescript и tsx
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Не запускаем от root
USER node

EXPOSE 3000
CMD ["node", "dist/index.js"]