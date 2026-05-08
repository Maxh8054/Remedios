#!/usr/bin/env bash
set -euo pipefail

echo "==> Initializing SQLite database..."
npx prisma db push

echo "==> Starting notification scheduler in background..."
node -e "
  const http = require('http');
  const PORT = process.env.PORT || 10000;
  const check = () => {
    http.get('http://localhost:' + PORT + '/api/check-notifications', (res) => {
      console.log('[NotifScheduler] Check completed:', res.statusCode);
    }).on('error', (e) => {
      console.log('[NotifScheduler] Check failed:', e.message);
    });
  };
  // Wait 15s for Next.js to be ready, then check every 30s
  setTimeout(() => {
    check();
    setInterval(check, 30000);
  }, 15000);
" &

echo "==> Starting Next.js production server on port ${PORT:-10000}..."
exec npx next start -p "${PORT:-10000}"
