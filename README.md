# TradeX Terminal

## Architecture

Project is split into backend and frontend responsibilities.

- `backend/request`: low-level HTTP clients for external APIs.
- `backend/repositories`: external API access adapters.
- `backend/services`: business/data shaping layer.
- `backend/server.js`: API routes only, always returns JSON.
- `js/request`: frontend API client.
- `js/services`: frontend service wrappers for backend endpoints.
- `js/*`: UI/render modules. They call frontend services and render data.

Backend API responses follow:

```json
{
  "ok": true,
  "data": {}
}
```

Errors follow:

```json
{
  "ok": false,
  "error": {
    "message": "..."
  }
}
```

## Run

Requires Node.js 18+.

```bash
npm start
```

Open:

```text
http://localhost:3000/login.html
```

The backend also serves the static frontend, so use port `3000` for login/register/API together.

## Environment

AI chat is handled by the backend. Set the API key before running:

PowerShell:

```powershell
$env:ANTHROPIC_API_KEY="your_key_here"
npm start
```

Optional variables:

- `PORT`, default `3000`
- `BINANCE_BASE_URL`, default `https://api.binance.com`
- `ANTHROPIC_BASE_URL`, default `https://api.anthropic.com`
- `ANTHROPIC_MODEL`, default `claude-sonnet-4-20250514`
- `RESEND_API_KEY`, enables real OTP email sending
- `EMAIL_FROM`, sender address, for example `XCapital AI <no-reply@yourdomain.com>`

## Public Auth / OTP

Registration and password reset now use backend APIs.

Local development without email credentials:

- OTP is printed in the backend terminal.
- API also returns `devOtp` so the frontend can show it for testing.
- Registered users are stored in `data/auth-store.json`.

Gmail SMTP without a domain:

1. Enable 2-Step Verification on your Google account.
2. Create an App Password at `https://myaccount.google.com/apppasswords`.
3. Put the 16-character app password in `.env`:

```env
EMAIL_PROVIDER=gmail
GMAIL_USER=xcapital.verify@gmail.com
GMAIL_APP_PASSWORD=your_google_app_password
EMAIL_FROM=XCapital AI <xcapital.verify@gmail.com>
```

Production:

1. Create a Resend account.
2. Verify your sending domain in Resend.
3. Set environment variables on your host:

```env
RESEND_API_KEY=re_xxxxxxxxx
EMAIL_FROM=XCapital AI <no-reply@yourdomain.com>
ANTHROPIC_API_KEY=your_ai_key
```

4. Deploy with `npm start`.
5. Open `https://yourdomain.com/login.html`.

Current storage is file-based (`data/auth-store.json`) so it is simple to run now. For a larger public site, replace `backend/repositories/authRepository.js` with Supabase/Postgres storage so customer accounts survive server rebuilds and can be managed in an admin dashboard.

## Supabase Storage

The auth repository automatically uses Supabase when these env variables are set:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Setup:

1. Create a Supabase project.
2. Open SQL Editor.
3. Run `backend/supabase-schema.sql`.
4. Copy Project URL into `SUPABASE_URL`.
5. Copy the service role key into `SUPABASE_SERVICE_ROLE_KEY`.
6. Restart the backend with `npm start`.

If Supabase variables are empty, the app falls back to `data/auth-store.json`.

## API

- `GET /api/health`
- `GET /api/market/klines?symbol=BTCUSDT&interval=1h`
- `GET /api/market/ticker24h?symbol=BTCUSDT`
- `GET /api/market/tickers24h?symbols=BTCUSDT,ETHUSDT`
- `POST /api/ai/chat`
- `POST /api/auth/send-otp`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/reset-password`

Example AI body:

```json
{
  "question": "Phân tích BTC hôm nay",
  "symbol": "BTCUSDT",
  "timeframe": "1h"
}
```
