#!/usr/bin/env bash
set -euo pipefail

echo "==> Running Prisma migrations..."
npx prisma migrate deploy

echo "==> Starting Next.js production server on port ${PORT:-10000}..."
exec npx next start -p "${PORT:-10000}"
