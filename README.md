# Visual Paths

Демо: одна цель как схема на шкале дней и канбан из четырёх колонок внутри каждой задачи.

Оценка задачи пишется на исходящей стрелке. Даты узла и критический путь считает сервер. Перенос карточки меняет прогресс узла и не двигает даты.

Поведение приложения — [docs/TZ.md](docs/TZ.md) (версия 2.0). Остальные документы в `docs/` — история решений, не источник требований.

## Стек

- API: Nest.js, TypeORM, PostgreSQL
- Интерфейс: React, Vite, TypeScript, `@xyflow/react`, `@dnd-kit`

## Запуск

Нужны Node.js, npm и Docker Desktop.

```bash
npm install --prefix server
npm install --prefix web
copy server\.env.example server\.env
copy web\.env.example web\.env
npm run db:up
```

На macOS и Linux вместо `copy` используйте `cp`.

Два терминала из корня репозитория:

```bash
npm run dev:server
npm run dev:web
```

- Интерфейс: http://127.0.0.1:5173/
- API: http://127.0.0.1:3001/api/v1

При первом старте API создаёт компанию `demo-company` и трёх пользователей. Готовую схему в базу не кладёт.

## Вход

Пароль у всех учёток: `demo123`.

| Почта | Имя |
| --- | --- |
| `founder@demo.local` | Основатель |
| `worker1@demo.local` | Иван Петров |
| `worker2@demo.local` | Мария Сидорова |

## Проверки

Postgres должен быть запущен (`npm run db:up`).

```bash
npm test --prefix server
npm run test:e2e --prefix server
npm run build --prefix web
```

## Документация

| Файл | Зачем |
| --- | --- |
| [docs/TZ.md](docs/TZ.md) | Как должно работать демо |
| [docs/resheniya-zakazchik.md](docs/resheniya-zakazchik.md) | История решений |
| [docs/TZ-visual-paths-widget.md](docs/TZ-visual-paths-widget.md) | Старое ТЗ, по нему не реализовывать |
