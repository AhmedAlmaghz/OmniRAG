#
# OmniRAG — production image.
# Runs the custom Next.js server (server.ts) on Node 24 (native TS
# type-stripping). Bind address is always 0.0.0.0 and the port comes from
# $PORT (default 3000), so the same image works on any hosting provider
# (Cloud Run, Fly.io, Railway, Render, ECS, Kubernetes, plain VPS…).

ARG NODE_IMAGE=node:24-alpine

# ── Stage 1: full dependency tree (dev + prod) for the build ─────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── Stage 2: compile the Next.js production bundle ───────────────────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# Stage the Tesseract OCR language models for the final image. They are
# git-ignored, so they exist only when the app ran OCR on the build machine —
# when absent, fall back to downloading the public "fast" models so a fresh
# clone can still build a self-contained image.
RUN mkdir -p /tessdata \
  && (cp -f /app/*.traineddata /tessdata/ 2>/dev/null || true) \
  && if [ ! -f /tessdata/ara.traineddata ]; then \
       wget -q -O /tessdata/ara.traineddata \
         https://tessdata.projectnaptha.com/4.0.0_fast/ara.traineddata || true; \
     fi \
  && if [ ! -f /tessdata/eng.traineddata ]; then \
       wget -q -O /tessdata/eng.traineddata \
         https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata || true; \
     fi

# ── Stage 3: production-only dependencies ────────────────────────────────────
# Pruned from the full tree instead of a second `npm ci`: the root package.json
# declares a `prepare: husky` script, and husky (a devDependency) is missing in
# an --omit=dev install, which makes `npm ci` fail with exit 127.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
RUN npm prune --omit=dev --no-audit --no-fund

# ── Stage 4: minimal runtime image ───────────────────────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

# Plain COPYs (no --chown): rewriting ownership per file on huge trees is
# pathologically slow on some builders. Everything lands root-owned but
# world-readable/executable, so the unprivileged `node` user below can run it;
# only the directories the app writes to get chowned.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /tessdata ./
COPY package.json next.config.ts server.ts ./

# Next.js writes its fetch/ISR cache under .next/cache at runtime. Hand just
# that subtree (and the cwd itself, non-recursively) to the unprivileged user.
RUN mkdir -p .next/cache \
  && chown -R node:node .next/cache \
  && chown node:node /app

USER node
EXPOSE 3000

# /api/health is a lightweight liveness probe (no DB round-trip).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.ts"]
