# SPEC — порт captureScreen на tinyjs

Источник: [mikhail-angelov/captureScreen](https://github.com/mikhail-angelov/captureScreen) (Go 1.26 + браузерный UI).
Цель репозитория: тот же продукт, но на tinyjs — нативное окно вместо вкладки браузера, бэкенд на JS.

## 1. Что перенесено

| Оригинал | Здесь | Статус |
|---|---|---|
| `server/watcher.go` (fsnotify, debounce 500 мс, stability 200 мс, дедуп, path guard) | `src/watcher.js` | 1:1, проверено тестами |
| `server/config.go` (`~`, env, проверка папки, симлинки) | `src/config.js` | 1:1, проверено тестами |
| `ui/*` (редактор, инструменты, экспорт) | `src/frontend/*` | перенесён; изменены только транспорт и сохранение/буфер |
| `GET /file/{slug}` | `tiny.fileURL(path)` + `api.readShot`; base64 — запасной путь | заменено |
| HTTP-сервер `127.0.0.1:8090` | `tiny.api` (сокет) | выброшен |
| `open http://…?file=` | окно приложения + `app.push('newShot')` | заменено |
| `server/os_integration.go` (OpenUrl) | `app.show()` / `app.shell.open` | заменено |
| LaunchAgent + `install.sh` | `app.launchAtLogin` | заменено |
| `navigator.clipboard` (браузер) | `app.clipboard.write({ image })` | нативно |
| скачивание браузером | `tiny.dialog.saveFile()` + `api.savePng` | нативно |

Добавлено (то, чего в оригинале не было): иконка в строке меню, глобальная клавиша
`Cmd+Alt+S`, уведомление о новом снимке, работа при закрытом окне, панель папки в окне.

## 2. API бэкенда

`getState`, `listShots`, `readShot`, `setFolder`, `savePng`, `copyImage`, `reveal`,
`openFolder`, `getLaunchAtLogin`, `setLaunchAtLogin`, `quit`.
События странице: `ready`, `newShot`, `openShot`, `newestShot`, `folderChanged`,
`folderInvalid`, `requestFolder`.

Трей: «Показать окно», «Выбрать папку…», «Последний снимок», «Выход».

## 3. Что проверено (и на чём)

Проведено на Linux (мини-ПК), рантайм txiki.js v26.6.0 из релиза tinyjs, бинарник сверен по `checksums.txt`.

- **Логика бэкенда — 31 проверка, 0 падений** (`tjs tests/backend.test.js`):
  фильтры расширений и имён; path guard (`../` наружу отклонён); base64 (векторы + round-trip 1024 байта);
  папка: существует/не существует/файл вместо папки/симлинк; watcher целиком: приём валидного PNG,
  отсутствие повторной обработки, отказ для `.txt` и скрытых файлов, второй файл принимается.
- **Страница в браузере (браузерный путь)** — живой Chromium: полоса папки, тулбар,
  загрузка снимка 1000×600 через `/file/`, пустое состояние.
- **Страница в режиме приложения** (заглушка `window.tiny`): старт по данным бэкенда,
  картинка пришла двумя путями — по `tiny.fileURL(path)` (основной, байты по сокету не идут)
  и через base64-фолбэк (`readShotBase64` → blob-url), в обоих случаях снимок 1000×600
  загружен в редактор; все 7 обработчиков событий зарегистрированы, событие `newShot`
  переключило снимок, кнопки Copy и Save вызвали `copyImage` и `savePng` с реальным PNG
  (префикс `iVBORw0KGgo`), ошибок в консоли нет.
- **Сборка штатным инструментом**: `tinyjs build` (v0.50.1, бинарники сверены по `checksums.txt`)
  собрал `dist/shotmark` (backend, 8,3 МБ) и `dist/launcher` (1,2 МБ) без ошибок.
- **Имена методов бэкенда** сверены по исходнику рантайма (`runtime/tiny.js`): `setHideOnClose`,
  `hotkey.register`, `tray.set`, `launchAtLogin`, `store`, `shell`, `clipboard`, `notify`,
  `show`, `quit`, `push` — все существуют.
- **Синтаксис** всех 22 модулей (`node --check`), валидность `tinyjs.json`.

## 4. Что НЕ проверено (честно)

Проверки требуют macOS с системным WebKit — на мини-ПК окно поднять нечем (нет дисплея и `libwebkit2gtk`):

- запуск окна `tinyjs dev` и сборка `tinyjs build`;
- нативные вызовы: `app.show()`, трей, глобальная клавиша, уведомление, `clipboard.write`,
  `dialog.pickFolder/saveFile`, `launchAtLogin`;
- что `"readAccess": true` действительно открывает вебвью доступ к снимкам из произвольной
  папки (на Linux окно не поднять) — если нет, сработает base64-фолбэк, но это дороже по трафику;
- поведение при закрытом окне (наблюдение должно продолжаться).

## 5. Найденные грабли рантайма

- `tjs.makeTempDir()` / `tjs.makeTempFile()` в этой сборке падают с `EINVAL` при любых
  аргументах — временный путь для буфера обмена строится вручную в `tjs.tmpDir`.
- `tjs.stat` отдаёт время изменения как `mtim` (строкой), а не `mtime` — учтено в `statMtime`.
- `tjs.readDir` возвращает асинхронный итератор, `tjs.readFile` — `Uint8Array`.
- `tjs.watch(dir, cb)`: callback получает имя файла; объект-хендл имеет `close()`.

## 6. Дальше

1. Прогнать `tinyjs dev` на маке: окно, трей, диалоги, автозапуск.
2. Замерить память приложения в состояниях «окно открыто / скрыто / закрыто».
3. Подпись и нотаризация: `signIdentity`/`notarize` в `tinyjs.json` или `TINYJS_SIGN_IDENTITY`.
4. Опционально: `captureScreen()` — снимать экран самим, не завися от папки Яндекс.Диска
   (потребует разрешения «Запись экрана»); `ocr(path)` — текст со снимка.
5. Отдельной веткой: лицензия репозитория (сейчас нет).
