#
# OmniRAG — production runtime image (prebuilt pattern, v0.12.21).
#
# WHY PACK-ONLY: building the Next bundle INSIDE the Docker VM exhausted the
# constrained builder (two OOM engine deaths: the tsc pass, then the export
# under Turbopack) on memory-limited Docker Desktop hosts. The robust flow is:
#
#   1. `npm run build` on the HOST (full RAM, strict typecheck) — orchestrated
#      by scripts/docker-deploy.sh before compose runs.
#   2. THIS image only PACKS: production node_modules + the prebuilt .next +
#      runtime config. No compiler, no tsc, no turbopack inside — the image
#      assembles in 1–3 minutes even on slow filesystems.
#
# Type-safety ownership is unchanged: local `npm run typecheck`, the husky
# pre-commit, and CI all run the strict pass; the pack step ships artifacts
# that were already type-checked.

ARG NODE_IMAGE=node:24-alpine

# ── Stage 1: production-only dependencies ────────────────────────────────────
# --ignore-scripts skips the root prepare:husky script (husky is a
# devDependency and absent in --omit=dev — it previously forced a full ci +
# prune two-step). Native modules used at runtime (@node-rs/argon2) ship
# prebuilt binaries via optionalDependencies, not install scripts, so this
# is safe; the live e2e (login) exercises argon2 to prove it.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
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
COPY .next ./.next
COPY public ./public
COPY package.json next.config.ts server.ts ./

# Tesseract OCR language models: shipped in the build context when present
# (the .dockerignore allows *.traineddata), otherwise downloaded here so a
# fresh clone still produces a self-contained image. Bounded by wget timeouts.
RUN mkdir -p ./tessdata \
  && (cp -f ./*.traineddata ./tessdata/ 2>/dev/null || true) \
  && if [ ! -f ./tessdata/ara.traineddata ]; then \
       wget -q --timeout=30 --tries=2 -O ./tessdata/ara.traineddata \
         https://tessdata.projectnaptha.com/4.0.0_fast/ara.traineddata || true; \
     fi \
  && if [ ! -f ./tessdata/eng.traineddata ]; then \
       wget -q --timeout=30 --tries=2 -O ./tessdata/eng.traineddata \
         https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata || true; \
     fi \
  && rm -f ./*.traineddata

# Next.js writes its fetch/ISR cache under .next/cache at runtime. Hand just
# that subtree (and the cwd itself, non-recursively) to the unprivileged
# `node` user below.
RUN mkdir -p .next/cache \
  && chown -R node:node .next/cache \
  && chown node:node /app

USER node
EXPOSE 3000

# /api/health is a lightweight liveness probe (no DB round-trip).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.ts"]
