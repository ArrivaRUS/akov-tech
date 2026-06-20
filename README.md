# akov.tech — placeholder

Заглушка личного сайта `akov.tech`. Без внешних зависимостей: крошечный Node-сервер отдаёт `index.html`.

## Деплой на Railway
Railway сам определит Node-проект и:
1. поставит зависимости (их нет — мгновенно),
2. запустит `npm start` → `node server.js`,
3. сервер слушает `0.0.0.0:$PORT` (порт задаёт Railway).

После деплоя: **Generate Domain** → проверить `*.up.railway.app`, затем привязать домен `akov.tech` (DNS через Selectel — ALIAS на адрес Railway).

## Файлы
- `index.html` — страница-заглушка.
- `server.js` — сервер (трогать не нужно).
- `package.json` — `start` для Railway.

## Локально
```sh
npm start   # http://localhost:3000
```
