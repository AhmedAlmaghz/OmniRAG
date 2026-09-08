#!/usr/bin/env bash
# ============================================================================
# OmniRAG — one-command automated deployment for the self-hosted stack.
#
#   npm run docker:deploy          (or: bash scripts/docker-deploy.sh)
#
# What it does, in order:
#   1. Sanity-checks the environment (docker daemon, .env presence as a hint).
#   2. docker compose build  — multi-stage production image (non-root).
#   3. docker compose up -d  — postgres + qdrant + app, with:
#        • first-boot postgres init (omnirag_app runtime role + password)
#        • first-boot app migration (tables, RLS policies, definers, seeds)
#      driven by healthchecks + depends_on, so the app never boots before its
#      databases are ready.
#   4. Waits for /api/health to return 200 (start-period aware).
#   5. Prints a smoke summary: endpoints, container states, and the RLS
#      verification hint.
#
# Idempotent: safe to re-run on an existing deployment — compose rebuilds only
# what changed and data lives in named volumes.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
step() { printf "\n${BLUE}── %s ──${NC}\n" "$1"; }
ok()   { printf "${GREEN}✓ %s${NC}\n" "$1"; }
warn() { printf "${YELLOW}⚠ %s${NC}\n" "$1"; }
fail() { printf "${RED}✗ %s${NC}\n" "$1"; exit 1; }

APP_PORT="${APP_PORT:-3000}"
HEALTH_URL="http://localhost:${APP_PORT}/api/health"
WAIT_SECONDS="${DEPLOY_WAIT_SECONDS:-180}"

step "1/6 — بيئة النشر"
docker info >/dev/null 2>&1 || fail "Docker daemon غير شغّال — افتح Docker Desktop أولاً."
ok "Docker daemon جاهز"
if [ ! -f .env ]; then
  warn "لا يوجد .env — سيشتغل الطابق بمفاتيح AI فارغة (التسجيل والاسترجاع يعملان، الاستدلال لا). انسخ .env.example وأضف GEMINI_API_KEY لاحقاً."
else
  ok ".env موجود — سيُحقن في حاوية التطبيق"
fi

step "2/6 — بناء الحزمة على المضيف (ترجمة + فحص نمطي صارم، بذاكرة كاملة)"
# Prebuilt pattern (v0.12.21): the Next bundle is compiled on the HOST —
# building it inside a constrained Docker VM OOM-killed the engine twice.
# The host build runs the strict typecheck; the image only packs artifacts.
npm run build

step "3/6 — تجميع صورة الإنتاج (pack-only: node_modules + .next + runtime)"
docker compose build

step "4/6 — إقلاع الطابق (postgres + qdrant + app)"
docker compose up -d

step "5/6 — انتظار صحة التطبيق (حتى ${WAIT_SECONDS} ثانية)"
elapsed=0
until curl -sf -o /dev/null "$HEALTH_URL"; do
  sleep 3
  elapsed=$((elapsed + 3))
  if [ "$elapsed" -ge "$WAIT_SECONDS" ]; then
    fail "لم يصبح /api/health سليماً خلال ${WAIT_SECONDS}s — افحص: docker compose logs app"
  fi
  printf "."
done
echo ""
ok "التطبيق سليم على http://localhost:${APP_PORT} (بعد ~${elapsed}s)"

step "6/6 — ملخص النشر"
docker compose ps --format "table {{.Name}}\t{{.Status}}"
echo ""
ok "قاعدة البيانات: جداول + سياسات RLS + دور omnirag_app + بذرة تجريبية — كلها أُنشئت آلياً عند الإقلاع."
echo "  • التطبيق:        http://localhost:${APP_PORT}"
echo "  • فحص الحياة:     ${HEALTH_URL}"
echo "  • سجلات مباشرة:   docker compose logs -f app"
echo "  • إثبات عقد RLS:  DATABASE_URL=postgresql://omnirag:omnirag@localhost:${POSTGRES_PORT:-5432}/omnirag npm run db:verify-rls"
echo "  • إيقاف:          docker compose down   (البيانات تبقى في المجلدات المسماة)"
