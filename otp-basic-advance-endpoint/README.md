# WhatsApp Flow OTP test endpoint

Local Node.js server that acts as a **WhatsApp Flow data endpoint** (`data_api_version` 3.0). Meta encrypts Flow requests to this URL. The server decrypts them, runs a simple OTP demo, and returns an encrypted response.

Use it with **GreenTick “With endpoint” Flows** (or WhatsApp Manager) while developing.

This is a **test** app. Do not use these keys or this process in production as-is.

## What it does

Meta POSTs encrypted JSON to `POST /flow`. The server:

1. Decrypts with `private.pem` (RSA-OAEP SHA-256 + AES-128-GCM).
2. Handles Flow actions: `ping`, `INIT`, `data_exchange`, `BACK`, and client error notifications.
3. Runs a three-screen OTP demo (see below).
4. Encrypts the response with the same AES key Meta sent.

OTP codes are **printed in the terminal**. Email send is disabled.

### Demo screens

| Step | Screen id (default) | What happens |
| --- | --- | --- |
| 1 | `FORM_SCREEN` | User submits name + email. Server stores a 6-digit OTP and opens the OTP screen. |
| 2 | `OTP_SCREEN` | User submits the code. Wrong/expired code stays on this screen with an error under the input. Correct code opens the verified screen. |
| 3 | `VERIFIED` | Shows `Hi {name}` and `the email {email} verified successfully`. Footer submit completes the Flow. |

Screen ids **must match** the ids in your Flow JSON (GreenTick screen ids). Set them in `.env`.

## Requirements

- Node.js 18+
- A public **HTTPS** URL Meta can reach (ngrok, Cloudflare Tunnel, or a deployed host)
- GreenTick (or WhatsApp Manager) with a WhatsApp Business phone number

## Setup

```bash
cd endpoint-test
npm install
cp .env.example .env
npm run dev
```

Default listen address: `http://localhost:3050`.

Expose HTTPS, for example:

```bash
ngrok http 3050
```

Meta **Endpoint URI** must be the public URL **plus `/flow`**:

```text
https://<your-tunnel-host>/flow
```

Keep this process and the tunnel running while you publish or send the Flow. Meta and GreenTick health-check this URL with an encrypted `ping`.

## Encryption keys

On first start, if no private key is configured, the server writes:

- `private.pem` — keep secret; used only on this server
- `public.pem` — 2048-bit RSA SPKI PEM to upload to Meta / GreenTick

Generate a new pair later:

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

Then restart the server.

### Upload the public key

1. Open `public.pem` and copy the full PEM (`BEGIN PUBLIC KEY` … `END PUBLIC KEY`).
2. In GreenTick: **Flows → Business public key → Add / Edit**.
3. Paste the PEM. To test before saving, enter this server’s public URL (`https://<tunnel-host>/flow`) and click **Test key with endpoint**. A successful ping means this PEM matches `private.pem` on this process.
4. Save until Meta stores the key for **this WhatsApp number**.

The public key on Meta and `private.pem` on this server must be the **same key pair**. Do not edit letters in the PEM to “test” rotation. That does not create a new key; generate a new pair instead.

After you replace keys, restart this server and upload the new `public.pem` again.

## GreenTick Flow

1. Create a Flow with **With endpoint**.
2. Set **Endpoint URI** to `https://<tunnel-host>/flow`.
3. Build three screens whose **ids** match `.env`:
   - First: name + email (or GreenTick defaults like `text_1`, `email_4`). Footer is `data_exchange`.
   - Second: OTP / number field. Footer is `data_exchange`.
   - Third: verified copy. Last-screen footer completes the Flow.
4. Save and **publish**. Publish pings this endpoint; it must be up.
5. Send from Live Chat, a template, or auto-send.

GreenTick compiles endpoint Flows so **every** screen footer uses `data_exchange` (not in-app navigate). Re-publish after changing the builder if WhatsApp still runs old JSON.

### Dynamic text (`${data…}`)

A beginner walkthrough (GreenTick screens, demo server, and the “whole field must be the placeholder” rule) is in [dynamictextdemo.md](./dynamictextdemo.md).

On a result screen, the **entire** Heading or Body must be the placeholder, for example `${data.name}` or `${data.email}`. Meta does not replace placeholders mixed with other words.

After a valid OTP this server returns full sentences in those keys:

```json
{
  "screen": "VERIFIED",
  "data": {
    "name": "Hi Riya",
    "email": "the email riya@example.com verified successfully"
  }
}
```

On screen 3 use Text fields that are only `${data.name}` and `${data.email}`.

### Field names

Preferred names: `name`, `email`, `otp`.

GreenTick auto names (`email_4`, `text_1`, `number_2`, …) are also accepted. Wrong OTP errors are attached to the **actual** field name Meta sent. If `error_messages` uses a name that is not on the screen, WhatsApp closes the Flow instead of showing the error.

### `.env` screen ids

```env
FIRST_SCREEN_ID=FORM_SCREEN
OTP_SCREEN_ID=OTP_SCREEN
VERIFIED_SCREEN_ID=VERIFIED
COMPLETE_ON_SUCCESS=false
OTP_TTL_MINUTES=10
```

If GreenTick uses different ids, copy them here and restart. A mismatch causes `invalid-screen-transition` and the Flow closes.

`COMPLETE_ON_SUCCESS=true` finishes the Flow right after a valid OTP (no third screen).

## HTTP routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Service info and configured screen ids |
| `GET` | `/health` | `{ "status": "active" }` (plain JSON; not what Meta uses) |
| `POST` | `/flow` | Meta Flow endpoint (encrypted ping, INIT, data_exchange, …) |

Meta health checks are **encrypted POSTs** to `/flow` with `"action": "ping"`. The server answers `{ "data": { "status": "active" } }` (encrypted). A browser GET to `/health` does not prove encryption works.

## Local files

| File | Role |
| --- | --- |
| `server.js` | Express app |
| `.env` | Port, screen ids, optional key path (gitignored) |
| `.env.example` | Template |
| `private.pem` / `public.pem` | Key pair (gitignored) |
| `otp-sessions.json` | OTP sessions by `flow_token` (gitignored) |

## Console

On each Flow request the server logs the decrypted payload. After screen 1 it prints:

```text
===== OTP CODE: 123456 =====
```

Use that code on screen 2.

## Troubleshooting

**Publish or Live Chat: check endpoint URL / public key**  
Tunnel or `npm run dev` is down, URI is not `…/flow`, or `private.pem` does not match the public key on that WhatsApp number.

**Flow closes on a wrong OTP**  
`.env` `OTP_SCREEN_ID` must match the OTP screen id. Field-level errors only work if the field exists on that screen.

**`invalid-screen-transition`**  
The screen id returned by this server is not in the Flow `routing_model`. Align `.env` with GreenTick ids and publish again.

**Decrypt 421**  
Wrong private key, or the process was not restarted after replacing `private.pem`.

**`${data.verified}` on the third screen**  
This server sends full sentences in `name` (`Hi …`) and `email` (`the email … verified successfully`), not a `verified` flag. Use `${data.name}` / `${data.email}` as the entire Text field. `verified` is still included when the last screen completes (`extension_message_response`).

## Scripts

```bash
npm run dev    # nodemon
npm start      # node server.js
```
