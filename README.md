# 🥒 PickleChat

A tiny ChatGPT-style chat app you can run yourself — and put online for friends.
No frameworks, no `npm install` — just Node.js.

## Features

- 🌊 **Real streaming** — replies appear word by word, live
- 🎨 **4 themes** — Pickle (green), Ocean (blue), Sunset (purple), Daylight (light)
- 🗂️ **Chat management** — rename ✏️ and delete 🗑️ chats from the sidebar
- 📎 **Attachments** — send images (with vision models) or text files
- 🧠 **Personality & knowledge** — tell the bot who it is, and paste notes it should know
- 💾 Chats saved in the browser (localStorage)
- 🔒 Optional password gate + rate limiting for public deployments

## Run it

1. Open a terminal in this folder
2. Run: `node server.js`
3. Open **http://localhost:3000**

You start in **demo mode** (canned replies), so it works with zero setup.

## Give it a real AI brain (optional)

**Option A — inside the app:** ⚙️ Settings → paste an API key → Save.

**Option B — in the terminal** (PowerShell):

```powershell
$env:OPENAI_API_KEY = "sk-..."
node server.js
```

**Option C — with a `.env` file** (Node 20.6+):

```powershell
Copy-Item .env.example .env
# edit .env, then:
node --env-file=.env server.js
```

Works with any **OpenAI-compatible** API:

| Provider   | Base URL                       | Notes            |
| ---------- | ------------------------------ | ---------------- |
| OpenAI     | https://api.openai.com/v1      | paid             |
| Groq       | https://api.groq.com/openai/v1 | has a free tier  |
| OpenRouter | https://openrouter.ai/api/v1   | some free models |

> API keys cost money per use, like a prepaid phone card.

## Put it online 🌐

The app is already deployment-ready (works with `PORT` env vars and includes a `Dockerfile`).

### Render / Railway (easiest)

1. Push this folder to GitHub
2. Create a new **Web Service** and connect the repo
3. Start command: `node server.js`
4. Add environment variables:
   - `OPENAI_API_KEY` — your key (kept secret on the server)
   - `OPENAI_MODEL` — e.g. `gpt-4o-mini`
   - `APP_PASSWORD` — a password so only people you trust can use it
5. Deploy — you get a public URL to share

### Docker (any host)

```bash
docker build -t picklechat .
docker run -p 3000:3000 -e OPENAI_API_KEY=sk-... -e APP_PASSWORD=letmein picklechat
```

### ⚠️ Important safety rules for public hosting

- **Never** put your API key in the frontend code. It stays in server env vars.
- Set `APP_PASSWORD` so random visitors can't burn your credits.
- The server already rate-limits to 40 messages / 10 min per IP. Adjust in `server.js` if needed.

## 💰 About "users pay for the limit"

An API key is **yours** — if your server uses your key, **you pay for every message**.
Users don't automatically pay you. To flip that around you need, in order:

1. **User accounts** (sign up / log in) — so you know who is who
2. **Usage tracking** — count messages/tokens per user
3. **Payments** — e.g. Stripe subscriptions (users pay you monthly)
4. **Limits & plans** — free tier, paid tier, daily caps

That's a bigger project ("Phase 2"). Phase 1 (this app + password + rate limit) is perfect
for hosting for friends and testing the idea.

## Files

| File                 | What it does                                       |
| -------------------- | -------------------------------------------------- |
| `server.js`          | Web server + streaming AI proxy + safety features  |
| `public/index.html`  | Page structure                                     |
| `public/style.css`   | Themes and styling                                 |
| `public/app.js`      | Chat logic: streaming, attachments, sidebar, settings |
| `.env.example`       | Copy to `.env` for settings                        |
| `Dockerfile`         | For container hosting                              |

## How it works (short version)

1. You type a message → the browser sends it to our server (`/api/chat`)
2. The server asks the AI provider to **stream** a reply
3. Each word arrives and the browser shows it immediately
4. Your personality + knowledge notes are sent as a **system prompt** with every request

Your chats and settings live in your browser's `localStorage`.
On a shared computer, don't leave a real API key saved in the app.
