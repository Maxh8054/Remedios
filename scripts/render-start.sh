#!/usr/bin/env bash
set -euo pipefail

echo "==> Running Prisma migrations..."
npx prisma migrate deploy

echo "==> Starting Next.js production server..."
exec npm run start
