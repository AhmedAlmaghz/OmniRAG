#!/bin/bash
# ============================================================================
# OmniRAG — Postgres first-boot initialization (docker-entrypoint-initdb.d).
#
# Runs ONCE, on the FIRST start of a fresh postgres data volume, as the
# postgres superuser — BEFORE the app ever boots. It provisions the
# least-privilege runtime role the app connects as via DATABASE_APP_URL:
#
#   omnirag_app  WITH LOGIN, password from $APP_DB_PASSWORD
#
# Everything else (tables, RLS policies, grants, SECURITY DEFINER escapes,
# seeding) is owned by the app's own boot migration (migrateAndSeedDrizzle),
# which runs as the OWNER and re-asserts grants idempotently on every boot —
# so this script only needs to exist for the password, before anything
# connects as the app role.
#
# Idempotent by construction: entrypoint init scripts run once per volume,
# and the DO block guards the role against pre-existence anyway.
# ============================================================================
set -e

: "${APP_DB_PASSWORD:-omnirag_app_local}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnirag_app') THEN
      CREATE ROLE omnirag_app NOLOGIN;
    END IF;
  END
  \$\$;
  ALTER ROLE omnirag_app WITH LOGIN PASSWORD '${APP_DB_PASSWORD}';
EOSQL

echo "[omnirag-init] omnirag_app role ready (LOGIN, password from APP_DB_PASSWORD)."
