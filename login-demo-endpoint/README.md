# WhatsApp Flow login test endpoint

Local Node.js server for a **login** WhatsApp Flow (`data_api_version` 3.0). It decrypts Meta requests, checks email + password against `demoData.js`, and returns an encrypted response.

This folder is separate from `endpoint-test` (OTP demo). Do not change that server to run this one.

This is a **test** app. Passwords in `demoData.js` are plain text. Do not use this in production.

**How to run this server and build the three screens in GreenTick:** [loginflowdemo.md](./loginflowdemo.md).

## What it does

Meta POSTs encrypted JSON to `POST /flow`. The server:

1. Decrypts with `private.pem` (RSA-OAEP SHA-256 + AES-128-GCM).
2. Handles Flow actions: `ping`, `INIT`, `data_exchange`, `BACK`, and client error notifications.
3. Looks up the user in `demoData.js` and checks the password.
4. Encrypts the response with the same AES key Meta sent.

### Demo screens

| Step | Screen id (default) | What happens |
| --- | --- | --- |
| 1 | `LOGIN_SCREEN` | User submits name, email, password. Wrong password or unknown email stays here with `error_messages`. |
| 2 | `STATUS_SCREEN` | Opened only after a valid login. Continue goes to the welcome screen. |
| 3 | `WELCOME` | Shows `Hi {name}` and `Welcome, you signed in as {email}` from this server. Footer submit completes the Flow. |

Screen ids **must match** the ids in your Flow JSON (GreenTick screen ids). Set them in `.env`.

GreenTick routing is sequential (screen 1 can only open screen 2). After a valid login this server therefore opens screen 2, then screen 3 receives the welcome sentences.

## Demo users

Edit `demoData.js`. Each item is `{ name, email, password }` in plain text:

| Name | Email | Password |
| --- | --- | --- |
| Meow | meow@gmail.com | meow123 |
| Riya Sharma | riya@example.com | riya@123 |
| Amit Patel | amit@example.com | amit@123 |
| Meghsham | meghsham@example.com | pass123 |

The file is reloaded on every login attempt, so you can add a user and retry without restarting.

### Errors on screen 1

| Case | `error_messages` |
| --- | --- |
| Email empty / missing | `Enter your email.` on the email field |
| No user with that email | `user not exists please signup` on the email field |
| Wrong password | `Wrong password. Try again.` on the password field |

`error_messages` keys use the **actual** field names Meta sent (`email_4`, `password`, …). If the key is not on the screen, WhatsApp closes the Flow instead of showing the error.

## Requirements

- Node.js 18+
- A public **HTTPS** URL Meta can reach (ngrok, Cloudflare Tunnel, or a deployed host)
- GreenTick (or WhatsApp Manager) with a WhatsApp Business phone number

## Setup

```bash
cd login-demo-endpoint
npm install
cp .env.example .env
npm run dev
```

Default listen address: `http://localhost:3051` (OTP demo uses 3050).

Expose HTTPS, for example:

```bash
ngrok http 3051
```

Meta **Endpoint URI** must be the public URL **plus `/flow`**:

```text
https://<your-tunnel-host>/flow
```

Keep this process and the tunnel running while you publish or send the Flow.

## Encryption keys

On first start, if no private key is configured, the server writes `private.pem` and `public.pem`.

**One public key per WhatsApp number.** If this number already uses the OTP demo key, either:

- Copy `endpoint-test/private.pem` and `public.pem` into this folder, or
- Set `PRIVATE_KEY_PATH=../endpoint-test/private.pem` in `.env`

Otherwise upload **this** folder’s `public.pem` in GreenTick (**Flows → Business public key**) and use **Test key with endpoint** with `https://<tunnel-host>/flow`.

## GreenTick Flow

1. Create a Flow with **With endpoint**.
2. Set **Endpoint URI** to `https://<tunnel-host>/flow`.
3. Build three screens whose **ids** match `.env`:

### Screen 1 — `LOGIN_SCREEN`

- Text field, **Field name:** `name`
- Email field, **Field name:** `email` (GreenTick may name it `email_4`; this server still finds it)
- Text field, **Field name:** `password` (use this name so wrong-password errors land on the right box)
- Footer: `Continue` (`data_exchange`)

### Screen 2 — `STATUS_SCREEN`

- Optional heading: `Login successful`
- Optional Text field that is only `${data.status}`
- Footer: `Continue`

### Screen 3 — `WELCOME`

- Text field 1 — entire contents: `${data.name}`
- Text field 2 — entire contents: `${data.email}`
- Footer: `Done`

Do not write `Hi ${data.name}` in one box. The server already puts the sentence in the value.

4. Save and **publish**. Then send a **new** Flow from Live Chat.

After a valid login this server returns:

```json
{
  "screen": "WELCOME",
  "data": {
    "name": "Hi Meow",
    "email": "Welcome, you signed in as meow@gmail.com",
    "status": "Login successful"
  }
}
```

`name` / `email` on screen 3 come from `demoData.js`, not from whatever name the person typed.

## HTTP routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Service info, screen ids, demo user emails |
| `GET` | `/health` | `{ "status": "active" }` |
| `POST` | `/flow` | Meta Flow endpoint |

## Scripts

```bash
npm run dev    # nodemon
npm start      # node server.js
```
