# Visual Paths

Standalone-приложение: схема путей на временной шкале + канбан внутри узлов.

## Документация

| Документ | Описание |
|----------|----------|
| [docs/plan.md](docs/plan.md) | План работ |
| [docs/resheniya-zakazchik.md](docs/resheniya-zakazchik.md) | Решения заказчика |
| [docs/TZ-visual-paths-widget.md](docs/TZ-visual-paths-widget.md) | ТЗ |

## Запуск локально

1. Включить Docker Desktop и поднять Postgres:

```
cd C:\Users\kalig\Project\visualTask
docker compose up -d
```

2. API (терминал 1):

```
cd C:\Users\kalig\Project\visualTask\server
copy .env.example .env
npm run start:dev
```

3. UI (терминал 2):

```
cd C:\Users\kalig\Project\visualTask\web
copy .env.example .env
npm run dev
```

Открыть http://127.0.0.1:5173

**Вход:** `founder@demo.local` / `demo123`

## Стек

Nest.js + PostgreSQL · React + Vite · @xyflow/react
