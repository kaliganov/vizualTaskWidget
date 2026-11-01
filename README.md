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

## Кто действует

Локально своего входа нет: запросы идут от `founder@demo.local`. На портале так нельзя — нужен JWT, см. [docs/vnedrenie-v-portal.md](docs/vnedrenie-v-portal.md). Иван Петров и Мария Сидорова остаются в списке ответственных демо.

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
| [docs/vnedrenie-v-portal.md](docs/vnedrenie-v-portal.md) | Как встроить виджет в портал |
| [docs/resheniya-zakazchik.md](docs/resheniya-zakazchik.md) | История решений |
| [docs/TZ-visual-paths-widget.md](docs/TZ-visual-paths-widget.md) | Старое ТЗ, по нему не реализовывать |
