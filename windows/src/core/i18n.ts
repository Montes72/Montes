// The user-facing language of both windows.
//
// English is the source language and the string itself is the key, so there is
// one copy of every sentence: it stays readable in the code, and a language that
// is missing a line falls back to English instead of showing a key. `t()` is
// called from `views/dom.ts` — the one place text reaches the DOM — so a new
// sentence is translated by adding it to the dictionary, not by hunting for the
// view that says it.
//
// Strings that arrive already composed (`t("Asking {url}…", { url })`) use named
// holes. Anything that is *data* — a project name, a model's answer, an error
// from the back end — goes through `t()` unchanged, because it is not a key.

export type Lang = "en" | "ru";

export const LANGUAGES: { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ru", label: "Русский" },
];

/**
 * Russian, keyed by the English that ships today.
 *
 * Grouped by where the sentence shows up rather than sorted, because the next
 * person to add a line already knows which section they are in. A line the app
 * no longer says is worse than a missing one: it makes the table look fuller
 * than the interface is, and the sentence it names gets rewritten with no
 * translation and nobody notices.
 */
const RU: Record<string, string> = {
  // ── The island ────────────────────────────────────────────────────────────
  "Nothing running right now.": "Сейчас ничего не запущено.",
  "Drop a file or window, or ask me anything.": "Перетащите файл или окно — или спросите о чём угодно.",
  "Ask Claude": "Спросить Claude",
  "Overview": "Обзор",
  "Ask": "Спросить",
  "Drop": "Перетащить",
  "Mute": "Звук",
  "Settings": "Настройки",
  "Open": "Открыть",
  "Allow": "Разрешить",
  "Deny": "Запретить",
  "needs permission": "нужно разрешение",
  "Claude Code is asking a question": "Claude Code задаёт вопрос",
  "Claude needs an answer.": "Claude ждёт ответа.",
  "Answer in your terminal — Montes can't reply for you yet.":
    "Ответьте в терминале — Montes пока не умеет отвечать за вас.",
  "Retry": "Ещё раз",
  "Result": "Результат",
  "Sending by email isn't in this version.": "Отправка почтой в этой версии не поддерживается.",
  "Claude is searching…": "Claude ищет…",
  "Workflow stopped.": "Сценарий остановлен.",
  "Session stopped on an error.": "Сессия остановилась с ошибкой.",
  "No detail available.": "Подробностей нет.",
  "Claude Code finished": "Claude Code закончил",
  "Session finished": "Сессия завершена",
  "Open terminal": "Открыть терминал",
  "Open Visual Studio Code": "Открыть Visual Studio Code",
  "Give me a sec — back to work in three seconds.": "Секунду — через три секунды снова в работе.",
  "Too many hits at once.": "Слишком много запросов сразу.",
  "Sound": "Звук",
  "Auto-close · {n}s": "Скрывать через {n} с",
  "Ask me anything…": "Спросите о чём угодно…",
  "Continue…": "Продолжайте…",
  "Ask a question": "Задать вопрос",
  "What do you want to do with it?": "Что с ним сделать?",
  "Drop your files here": "Перетащите файлы сюда",
  "Cancel": "Отмена",
  "Ask about this": "Спросить об этом",
  "Close": "Закрыть",
  "Connected · loading…": "Подключено · загружаю…",
  "Details": "Подробности",
  "Success": "Успешно",
  "Failed": "Ошибка",
  "Completed successfully.": "Выполнено без ошибок.",
  "No error details available.": "Подробностей об ошибке нет.",
  "No calls scheduled": "Запланированных вызовов нет",
  "Refresh": "Обновить",
  "Settings…": "Настройки…",
  "Open n8n": "Открыть n8n",
  "Open in n8n": "Открыть в n8n",
  "Open {name}": "Открыть {name}",
  "{t} ago": "{t} назад",

  // Tool names as the ticker shows them. They arrived in French with the macOS
  // app and are left alone in English — a sentence the macOS app shows in
  // French is not something to "fix" here — but Russian is the first language
  // these have been in, and they are what the ticker line is mostly made of.
  Exécute: "Выполнить",
  Lit: "Прочитать",
  Écrit: "Записать",
  Modifie: "Изменить",
  Cherche: "Найти",
  Recherche: "Поиск",
  "Recherche web": "Поиск в сети",
  Récupère: "Загрузить",
  Tâches: "Задачи",
  Agent: "Агент",
  Liste: "Список",
  Notebook: "Блокнот",
  "+ subagent": "+ подагент",
  "• subagent done": "• подагент закончил",
  "⚠ failed": "⚠ ошибка",

  // ── Settings ──────────────────────────────────────────────────────────────
  General: "Основные",
  Language: "Язык",
  "Launch at startup": "Запускать при старте Windows",
  "Display under the cursor": "Показывать у курсора",
  "Main display": "Основной экран",
  "Island lives on": "Остров живёт на",
  "seconds after you leave the island": "секунды после того, как вы отошли от острова",
  Integrations: "Интеграции",
  Agents: "Агенты",
  Assistant: "Ассистент",
  Relay: "Релей",
  API: "API",
  Claude: "Claude",
  Model: "Модель",
  "API key": "Ключ API",
  Answers: "Отвечает",
  Automatic: "Автоматически",
  Pinned: "Закреплён",
  "Nothing to answer right now.": "Сейчас отвечать нечем.",
  "Claude Code": "Claude Code",
  opencode: "opencode",

  "This is exactly what will change in your settings.json. Your own hooks are left untouched.":
    "Именно это изменится в вашем settings.json. Ваши собственные хуки не затрагиваются.",
  "This removes Montes's entries only. Your own hooks are left untouched.":
    "Удаляются только записи Montes. Ваши собственные хуки не затрагиваются.",

  // The confirm screens for the two configs Montes does not own. A sentence that
  // quotes the file it is about to touch has to be composed from a hole, not from
  // the finished string, or the path would arrive already glued to English.
  "This is exactly what will be written to {path}. It is the whole plugin — read it, because it runs inside opencode.":
    "Именно это будет записано в {path}. Это весь плагин — прочитайте его, он работает внутри opencode.",
  "This removes {path} and nothing else.": "Удаляется {path} и ничего больше.",
  "This is exactly what will change in {path}. Other hooks in that file are left untouched.":
    "Именно это изменится в {path}. Другие хуки в этом файле не затрагиваются.",
  "This removes {name}'s entries only. Other hooks are left untouched.":
    "Удаляются только записи {name}. Другие хуки не затрагиваются.",
  "Done. Previous file saved as {backup}. Start a new opencode session — it loads plugins at startup.":
    "Готово. Прежний файл сохранён как {backup}. Запустите новую сессию opencode — плагины загружаются при старте.",
  "Done. Previous file saved as {backup}.": "Готово. Прежний файл сохранён как {backup}.",
  "Done. Previous settings saved as {backup}. Start a new {name} session to pick the hooks up.":
    "Готово. Прежние настройки сохранены как {backup}. Запустите новую сессию {name}, чтобы хуки подхватились.",
  "Done. Previous settings saved as {backup}.": "Готово. Прежние настройки сохранены как {backup}.",
  "Hooks not installed": "Хуки не установлены",
  "Key not configured": "Ключ не настроен",
  // The card headers and stat labels on the integration pills. The names are
  // brands and stay as they are; the word that says what kind of card it is,
  // and the stat labels, are the app's own words.
  Integration: "Интеграция",
  Deployments: "Деплои",
  Emails: "Письма",
  Repositories: "Репозитории",
  Payments: "Платежи",
  Recent: "Недавние",
  Schedule: "Расписание",
  Workflow: "Сценарий",
  "Total stars": "Всего звёзд",
  "Ask a question about it": "Спросить об этом",
  Images: "Картинки",
  Code: "Код",
  Docs: "Документы",
  "{name} is ready.": "{name} готов.",
  "Montes is hooked into your Claude Code sessions. Tool calls, questions and permission requests show up in the island, and you can answer them there.":
    "Montes подключён к вашим сессиям Claude Code. Вызовы инструментов, вопросы и запросы на разрешение появляются на острове, и там же на них можно ответить.",
  "Install the hooks to see your Claude Code sessions in the island and approve permissions without leaving what you are doing.":
    "Установите хуки, чтобы видеть сессии Claude Code на острове и разрешать запросы, не отвлекаясь от того, чем вы заняты.",
  "Automatic — Claude with a key, Ollama without":
    "Автоматически — Claude с ключом, Ollama без него",
  "Claude (Anthropic API)": "Claude (Anthropic API)",
  "Ollama (on this machine)": "Ollama (на этой машине)",
  "Secret key": "Секретный ключ",
  Token: "Токен",
  "Instance URL": "URL инстанса",
  "Install hooks…": "Установить хуки…",
  "Reinstall hooks…": "Переустановить хуки…",
  "Uninstall hooks…": "Удалить хуки…",
  Install: "Установить",
  "Install…": "Установить…",
  "Reinstall…": "Переустановить…",
  Uninstall: "Удалить",
  "Uninstall…": "Удалить…",
  Back: "Назад",
  Save: "Сохранить",
  Delete: "Удалить",
  Remove: "Убрать",
  "Add agent": "Добавить агента",
  "Add an agent": "Добавить агента",
  Name: "Имя",
  Config: "Конфиг",
  Events: "События",
  "Save key": "Сохранить ключ",
  "Key saved in the Windows Credential Manager.": "Ключ сохранён в диспетчере учётных данных Windows.",
  "Key removed.": "Ключ удалён.",
  "No key yet — the chat needs one.": "Ключа пока нет — для чата он нужен.",
  "Saved. It never touches disk.": "Сохранено. На диск он не попадает.",
  "Could not save: {err}": "Не удалось сохранить: {err}",
  "Could not remove: {err}": "Не удалось убрать: {err}",
  "Could not write: {err}": "Не удалось записать: {err}",
  "Checking…": "Проверяю…",
  "Give the full path to the tool's JSON hook config.":
    "Укажите полный путь к JSON-конфигу хуков инструмента.",
  "That name is already used.": "Это имя уже занято.",
  "“claude” is reserved for the Claude Code pill.": "Имя «claude» занято пилюлей Claude Code.",
  "Use 1–24 lowercase letters, digits or hyphens.":
    "1–24 строчных буквы, цифры или дефисы.",
  "No hooks installed for this agent yet.": "Для этого агента хуки ещё не установлены.",
  "Backup → {path}": "Резервная копия → {path}",
  "Back up and write": "Сделать копию и записать",
  "Back up and remove": "Сделать копию и удалить",
  "Done. Previous settings saved as {backup}. Open a new Claude Code session to pick the hooks up.":
    "Готово. Прежние настройки сохранены как {backup}. Откройте новую сессию Claude Code, чтобы хуки заработали.",
  "Points any tool that can run a hook command at the montes-hook relay. Each agent gets its own pill: Montes writes “montes-hook.exe --agent <name> <Event>” into the tool's own JSON hook config, with the same backup and diff as the Claude Code hooks.":
    "Наводит любой инструмент, умеющий запускать команду хука, на релей montes-hook. У каждого агента своя пилюля: Montes дописывает «montes-hook.exe --agent <имя> <Событие>» в собственный JSON-конфиг инструмента — с той же копией и diff, что и для хуков Claude Code.",
  "The relay isn't in place yet. Restart Montes; if it still fails, build it with `cargo build -p montes-hook`.":
    "Релей ещё не на месте. Перезапустите Montes; если не помогло, соберите его командой `cargo build -p montes-hook`.",
  "The relay isn't installed yet.": "Релей ещё не установлен.",
  "Could not ask the app about it.": "Не удалось спросить приложение.",
  "Plugin in place at {path}.": "Плагин на месте: {path}.",
  "There is a file at {path} that Montes did not write. It is left alone — move it aside if you want ours there.":
    "По пути {path} лежит файл, который Montes не писал. Мы его не трогаем — уберите его в сторону, если хотите поставить наш.",
  "Hooked into {path}.": "Хуки прописаны в {path}.",
  "Not installed. It goes to {path}.": "Не установлен. Плагин будет в {path}.",
  "The relay is missing, so nothing would reach Montes. Reinstall Montes first.":
    "Релей отсутствует, поэтому до Montes ничего не дойдёт. Сначала переустановите Montes.",
  "{model} · not installed": "{model} · не установлена",
  "{mode}: {note}": "{mode}: {note}",
  "{n} model(s) installed. A text-only model cannot read a window you drop on the island.":
    "Установлено моделей: {n}. Модель только с текстом не прочитает окно, которое вы бросили на остров.",
  "Ollama is answering, but nothing is installed. Pull one with `ollama pull qwen3:14b`.":
    "Ollama отвечает, но моделей не установлено. Загрузите одну командой `ollama pull qwen3:14b`.",
  "Asking {url}…": "Спрашиваю {url}…",
  "Ollama at": "Ollama на",
  "just now": "только что",
  "{n} min": "{n} мин",
  "{n} h": "{n} ч",
  "{n} d": "{n} д",
  "Auto-close": "Скрывать",
  File: "Файл",
  file: "файл",
  "Uploading {name}": "Отправка: {name}",
  Send: "Отправить",
  "••••••••••••  (stored)": "••••••••••••  (сохранён)",
  "••••••••  (stored)": "••••••••  (сохранён)",
  "montes-hook.exe is not in place yet. Restart Montes; if it still fails, build it with `cargo build -p montes-hook`.":
    "montes-hook.exe ещё не на месте. Перезапустите Montes; если не помогло, соберите его командой `cargo build -p montes-hook`.",
  "Find models": "Найти модели",
  " · sees pictures": " · видит картинки",
  " · text only": " · только текст",
  "Could not reach Ollama: {err}": "Не удалось достучаться до Ollama: {err}",
  "With no choice made, a saved API key means Claude and no key means the model on this machine — so the chat works on a fresh install instead of asking for money.":
    "Пока выбор не сделан, сохранённый ключ API означает Claude, а отсутствие ключа — модель на этой машине: так чат работает сразу после установки, без требования денег.",
  "Writes a small plugin into opencode's plugins directory, so an opencode session gets its own pill: thinking, working, finished. Its permission asks arrive as a badge rather than an Allow / Deny card — opencode's plugin API can see a request but cannot answer one, so a card would never reach the tool.":
    "Пишет небольшой плагин в каталог плагинов opencode, и сессия opencode получает свою пилюлю: думает, работает, закончила. Его запросы на разрешение приходят как значок, а не как карточка «Разрешить / Запретить»: API плагинов opencode видит запрос, но не может на него ответить, так что карточка никуда бы не дошла.",
  "Pick up to {max} pills to show next to Montes — {used}/{max} in use. Keys are stored in the Windows Credential Manager, never on disk.":
    "Выберите до {max} пилюль рядом с Montes — занято {used}/{max}. Ключи хранятся в диспетчере учётных данных Windows, а не на диске.",
  "Integration token": "Токен интеграции",
  "No telemetry. Network requests only go to the services you configure yourself.":
    "Никакой телеметрии. В сеть идут только те запросы, которые вы сами настроили.",
  "Settings — Montes": "Настройки — Montes",
};

let current: Lang = "en";

/**
 * The translation, or the string itself. Called on everything that reaches the
 * screen, so anything that is not a key — a project name, a chat answer, an
 * error from Rust — comes back untouched.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  const hit = current === "en" ? text : RU[text];
  if (hit === undefined) return fill(text, vars);
  return fill(hit, vars);
}

function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** Switches language. Anything already on screen is redrawn by the caller. */
export function applyLanguage(lang: string | undefined) {
  current = lang === "ru" ? "ru" : "en";
}

export function language(): Lang {
  return current;
}

/** What Windows and the browser say, used the first time Montes runs. */
export function systemLanguage(): Lang {
  const tag = (typeof navigator !== "undefined" && navigator.language) || "";
  return tag.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export const RUSSIAN_KEYS = Object.keys(RU);
