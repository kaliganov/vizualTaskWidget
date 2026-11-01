# Внедрение Visual Paths в портал

Файл для программиста портала. Виджет не ходит в базу и не логинится сам. Портал даёт ему уже выпущенный JWT.

Локальное демо (`NODE_ENV` не `production`) по-прежнему ходит от `founder@demo.local` без токена. На портале это выключено.

## Как встроить

Iframe на собранный `web/` (`npm run build --prefix web`, каталог `web/dist`).

Сборка виджета:

```
VITE_APP_MODE=widget
VITE_PORTAL_ORIGIN=https://<origin портала>
VITE_API_BASE_URL=https://<хост API>/api/v1
```

`VITE_PORTAL_ORIGIN` — точный origin родителя, со схемой и портом. Другие origin виджет игнорирует. Токен в `localStorage` не пишется.

Родитель после загрузки iframe:

```js
iframe.contentWindow.postMessage(
  { type: 'visual-paths:auth', accessToken },
  'https://<origin виджета>',
);
```

Виджет сначала шлёт родителю `{ type: 'visual-paths:ready' }` на `VITE_PORTAL_ORIGIN`. Новый токен (refresh) — тем же сообщением `visual-paths:auth`. Обновляет токен портал, не виджет.

Пока токена нет, запросы API получат `401`.

Переключатель «Кто смотрит» в режиме `widget` скрыт. Кто действует, решает токен, не заголовок страницы.

## JWT

Алгоритм только `HS256`. Секрет API — переменная `JWT_SECRET`, тот же, которым портал подписывает access token. Плейсхолдер `change-me-in-local-dev` в боевом режиме не принимается.

Обязательные поля payload:

| Поле | Смысл |
| --- | --- |
| `sub` | UUID пользователя |
| `email` | Почта, до 200 символов |
| `companyId` | Компания, до 64 символов. Берётся только отсюда, из тела запроса компанию передать нельзя |
| `name` | Имя, необязательно |

Первый принятый токен создаёт строку в `users` (без известного пароля). Повтор с тем же `sub`, но другой почтой или компанией — `401`. Роль из токена API не читает: любого пользователя компании пускает ко всем целям этой компании. Кто вообще открывает виджет — решает портал.

Заголовок каждого запроса, кроме health: `Authorization: Bearer <accessToken>`.

## Сервер на портале

`NODE_ENV=production`. Тогда:

- демо-основатель не подставляется, даже если в окружении остался `DEMO_ACTOR=true`;
- сид с паролем `demo123` не запускается;
- без `CORS_ORIGINS` браузер с чужого origin не пройдёт.

`CORS_ORIGINS` — origin виджета и, если портал ходит в API из браузера, origin портала. Через запятую, без пробелов по краям.

`HOST` по умолчанию `127.0.0.1`. Наружу API отдаёт только прокси. Базу Postgres наружу не публиковать, пароль `visualtask` из примера не использовать.

Ответы API: `nosniff`, `no-store`, без заголовка `X-Powered-By`. Виджет должен открываться во фрейме портала, поэтому `X-Frame-Options: DENY` на страницу виджета ставить нельзя. На хосте статики виджета: `Content-Security-Policy: frame-ancestors https://<origin портала>`.

## Ошибки

```json
{ "message": "текст", "alertCode": "КОД", "statusCode": 401 }
```

Свои коды входа: `UNAUTHORIZED`, `AUTH_NOT_CONFIGURED`. Чужая цель — `404` `GOAL_NOT_FOUND`. Чужой комментарий — `403` `COMMENT_FORBIDDEN`. Занятый id узла или стрелки — `409` `NODE_ID_TAKEN` / `EDGE_ID_TAKEN`.

## Зависимости

API (`server/`): NestJS 11, TypeORM, PostgreSQL (`pg`), `class-validator`, `@nestjs/jwt`, `bcryptjs` (только сид демо).

Интерфейс (`web/`): React 18, Vite 6, `@xyflow/react`, `@dnd-kit/core` и `@dnd-kit/sortable`.

База локально: `docker-compose.yml`, Postgres 16. На портале — свой экземпляр, не этот контейнер с открытым портом 5432.

## Что вызывает виджет

Префикс `/api/v1`. Health без префикса и без токена: `GET /health`, `GET /health/ping`.

| Метод | Путь | Зачем |
| --- | --- | --- |
| GET | `/users` | Люди компании для списков |
| GET, POST | `/visual-paths/goals` | Список и новая заявка или цель |
| GET, PATCH, DELETE | `/visual-paths/goals/:goalId` | Карточка цели. DELETE прячет в архив, строки не стирает |
| GET, PUT | `/visual-paths/goals/:goalId/graph` | Схема. PUT шлёт `version`; чужая версия — `409` |
| PATCH | `/visual-paths/goals/:goalId/nodes/:nodeId/manual-status` | Статус задачи без карточек |
| PATCH | `/visual-paths/goals/:goalId/nodes/:nodeId/taken` | Взял в работу |
| GET, POST | `/visual-paths/goals/:goalId/documents` | Документы заявки |
| GET, POST | `/deal-types` | Виды сделок |
| GET, POST | `/process-templates` | Шаблоны процессов. POST создаёт цель-шаблон |
| GET | `/visual-paths/nodes/:nodeId/board` | Канбан задачи |
| POST | `/visual-paths/nodes/:nodeId/cards` | Карточка в колонке «Задача» |
| GET, PATCH, DELETE | `/visual-paths/cards/:cardId` | Карточка |
| POST | `/visual-paths/cards/:cardId/move` | Перенос между колонками |
| PUT | `/visual-paths/cards/:cardId/checklist` | Чек-лист целиком |
| POST | `/visual-paths/cards/:cardId/comments` | Комментарий |
| PATCH, DELETE | `/visual-paths/cards/:cardId/comments/:commentId` | Только автор |
| POST | `/visual-paths/cards/:cardId/time-entries` | Минуты |
| POST | `/visual-paths/cards/:cardId/timer/start` и `/timer/stop` | Таймер |
| GET | `/visual-paths/cards/:cardId/history` | История карточки |

Колонки канбана: `todo`, `in_progress`, `testing`, `done`. Приоритет: `low`, `medium`, `high`, `critical`.

Оценка задачи — на узле (`estimateValue` + `hour` | `day` | `week`). На стрелке сервер сам пишет ту же оценку. Даты считаются от `scaleStart` и координаты `x` (48 px = 1 день). Процент узла — доля карточек в «Готово». Критический путь считает сервер, цветом на схеме он не выделяется.

## Чего виджету не делать

Не ходить в Postgres. Не подставлять `companyId` в JSON. Не слать токен в query. Не принимать `postMessage` не от портала. Не включать `DEMO_ACTOR` и не выкладывать демо-базу: пароль `demo123` записан в сиде и уже известен.
