#!/usr/bin/env bash
# toolshop.sh
#
# Starts, reseeds, and stops the self-hosted Toolshop defined in
# docker/toolshop/docker-compose.yml. Tests then run with ENVIRONMENT=local
# (env/.env.local -- see README "Running against Docker").
#
# Usage:
#   bash scripts/toolshop.sh up       # pull, start, wait for DB, seed, wait for API + UI
#   bash scripts/toolshop.sh reset    # wipe and reseed the database (stack must be up)
#   bash scripts/toolshop.sh down     # stop and remove containers and volumes
#
# Exits non-zero if any service fails to become ready, printing its logs.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker/toolshop/docker-compose.yml"

API_URL="http://localhost:8091"
APP_URL="http://localhost:4200"

compose() { docker compose -f "${COMPOSE_FILE}" "$@"; }

fail() {
    echo "ERROR: $1" >&2
    compose logs --tail=50 "${2:-}" >&2 || true
    exit 1
}

# wait_for <description> <attempts> <interval-seconds> <command...>
wait_for() {
    local what="$1" attempts="$2" interval="$3"
    shift 3
    for i in $(seq 1 "${attempts}"); do
        if "$@" >/dev/null 2>&1; then
            echo "OK    ${what} ready"
            return 0
        fi
        echo "WAIT  ${what} (${i}/${attempts})"
        sleep "${interval}"
    done
    return 1
}

db_ready() { compose exec -T mariadb mysqladmin ping -h localhost -u root -proot --silent; }
api_ready() { curl -sf "${API_URL}/status"; }
ui_ready() { curl -sf -o /dev/null "${APP_URL}"; }

# Seeding mints new ULIDs, but the API caches lookups such as
# /categories/tree in Laravel's file cache -- without the cache:clear the UI
# keeps filtering by the previous seed's ids and finds nothing.
seed() {
    echo "SEED  migrate:fresh --seed"
    compose exec -T laravel-api php artisan migrate:fresh --seed --force
    compose exec -T laravel-api php artisan cache:clear
}

case "${1:-}" in
    up)
        compose up -d --pull missing
        wait_for "database" 30 2 db_ready || fail "database did not start" mariadb
        seed
        wait_for "API (${API_URL})" 30 2 api_ready || fail "API did not start" laravel-api
        wait_for "UI (${APP_URL})" 60 5 ui_ready || fail "UI did not start" angular-ui
        ;;
    reset)
        seed
        ;;
    down)
        compose down -v
        ;;
    *)
        echo "Usage: bash scripts/toolshop.sh {up|reset|down}" >&2
        exit 2
        ;;
esac
