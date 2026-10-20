# =============================================================================
# NetControl — image produksi
#
# Multi-stage: deps -> build -> runner. Karena next.config.ts TIDAK memakai
# `output: "standalone"`, server produksi dijalankan dengan `next start`.
# =============================================================================

# --- Stage 1: instal seluruh dependency (termasuk devDependency) --------------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# --- Stage 2: build aplikasi + generate Prisma client -------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Stage 3: image runtime ramping -------------------------------------------
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4755

# Hanya dependency produksi. `prisma` CLI (sebuah devDependency) dipasang secara
# eksplisit agar `npm run db:migrate` (prisma migrate deploy) dapat dijalankan
# di dalam container setelah database siap.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev \
 && npm install --no-save --omit=dev prisma@6.19.3 tsx@4.20.0 \
 && npx prisma generate \
 && rm -rf /root/.npm

COPY --from=build /app/.next ./.next
COPY --from=build /app/src ./src
COPY --from=build /app/next.config.ts ./next.config.ts

# Jalankan sebagai user non-root bawaan image Node.
USER node
EXPOSE 4755

CMD ["sh", "-c", "npm run db:migrate && npm run db:seed && npm start"]
