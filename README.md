# Pós Operatório - Controle de Medicamentos

Aplicativo PWA para controle de medicamentos pós-operatório com notificações push e integração WhatsApp.

## Funcionalidades

- Controle de 11 medicamentos com horários definidos
- Notificações push (web push)
- Mensagens automáticas via WhatsApp
- Contagem regressiva para o próximo medicamento
- Marcação de doses tomadas
- Exportar/importar dados (JSON)
- Funciona como app instalável (PWA)

## Medicamentos

| Medicamento | Frequência | Duração |
|---|---|---|
| Sinot Clav | 12 em 12 horas | 14 dias |
| Prednisolona | 1x ao dia | 5 dias |
| Traumeel | 8 em 8 horas | 7 dias |
| Dipirona | 6 em 6 horas (se dor) | 30 dias |
| Bactroban | 4x por dia | 90 dias |
| Soro Fisiológico | 6x por dia | 30 dias |
| Nasoar | 2x por dia | 21 dias |
| Cloridrato de Nafazolina | 8 em 8 horas | 7 dias |
| Hirudoid | 4 em 4 horas | 30 dias |
| Gelo nos roxos | 20 min de 2 em 2 horas | 14 dias |
| Kelo-Cote UV Gel | 2x ao dia | 90 dias |

## Tech Stack

- Next.js 16
- TypeScript
- Tailwind CSS
- Prisma (SQLite)
- Web Push API
- WhatsApp Baileys

## Setup

```bash
bun install
npx prisma db push
bun run dev
```
