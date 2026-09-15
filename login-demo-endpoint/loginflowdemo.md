# Login Flow demo (GreenTick setup guide)

This guide explains how to run the **login-demo-endpoint** server and how to build the matching **three-screen login Flow** in GreenTick.

You do not need to change `endpoint-test` (the OTP demo). This folder is a separate server on port **3051**.

This is a **test** app. Passwords in `demoData.js` are plain text. Do not use this in production.

---

## What you will build

A 3-step form inside WhatsApp:

1. Person types **name**, **email**, and **password**.
2. If login succeeds, WhatsApp opens a short “signed in” screen.
3. WhatsApp shows text **from this server**:
   - `Hi Meow`
   - `Welcome, you signed in as meow@gmail.com`

If the email is unknown, WhatsApp stays on screen 1 and shows **user not exists please signup**.  
If the password is wrong, it stays on screen 1 and shows **Wrong password. Try again.**

The welcome sentences are built by the server from `demoData.js`. WhatsApp only displays them.

---

## Who does what

| Who | Role |
| --- | --- |
| **WhatsApp (Meta)** | Shows the form on the phone. Encrypts answers. Fills in `${data…}` placeholders. |
| **GreenTick** | You design the screens here and publish them to Meta. |
| **This endpoint** | Program Meta calls after each Continue. It checks email + password and returns the next screen plus the welcome sentences. |

**Endpoint URI** means the public HTTPS address of this program. For this demo it looks like:

```text
https://something.ngrok-free.app/flow
```

Meta will not talk to `http://localhost`. A real phone needs a **public https** URL. Tools like **ngrok** forward that URL to your laptop.

---

## The one rule that trips everyone

On a GreenTick **Heading** / **Body text** / other display field, WhatsApp only replaces a placeholder if **the whole field is the placeholder**.

**Works**

```text
${data.name}
```

```text
${data.email}
```

```text
${data.status}
```

**Does not work** (WhatsApp prints this exactly, including `${}`):

```text
Hi ${data.name}
```

```text
Welcome, you signed in as ${data.email}
```

That is why this server puts the words **inside** the values it sends:

- `name` = `Hi Meow`
- `email` = `Welcome, you signed in as meow@gmail.com`
- `status` = `Login successful`

In GreenTick you still type only `${data.name}` and `${data.email}`.

`${data.name}` means: show the value named `name` that the server sent for this screen. The word after `data.` must match the server’s key (`name`, `email`, `status`).

Screen 3 uses the **name and email from `demoData.js`**, not whatever name the person typed on screen 1.

---

## 1. Run the login server

### Requirements

- Node.js 18+
- A public HTTPS URL (ngrok, Cloudflare Tunnel, or a deployed host)
- GreenTick with a WhatsApp Business phone number

### Start

```bash
cd login-demo-endpoint
npm install
cp .env.example .env
npm run dev
```

Default address: `http://localhost:3051`  
(`endpoint-test` OTP demo uses **3050**. Do not point this Flow at 3050.)

Leave this window open. You should see:

```text
WhatsApp Flow login endpoint running on http://localhost:3051
Screens: LOGIN_SCREEN -> STATUS_SCREEN -> WELCOME
Demo users: meow@gmail.com, riya@example.com, ...
```

### Expose HTTPS

In a **second** terminal:

```bash
ngrok http 3051
```

Copy the `https://…` host. Meta **Endpoint URI** must be that host **plus `/flow`**:

```text
https://<your-tunnel-host>/flow
```

Keep **both** windows open (server + tunnel) while you publish or send the Flow.

### Check it is up

Open `http://localhost:3051/` in a browser. You should see JSON with `"service": "WhatsApp Flow login test endpoint"` and the demo user emails (passwords are not listed).

---

## 2. Encryption keys (public / private)

Meta encrypts every request so only **your** server can read it.

- `private.pem` — secret. Stays on this computer. Never paste it into GreenTick.
- `public.pem` — matching public key. Upload this in GreenTick.

On first start, this demo creates both files if they are missing.

**One public key per WhatsApp number.** If this number already uses the OTP demo (`endpoint-test`):

- Copy `endpoint-test/private.pem` and `public.pem` into this folder, **or**
- In `.env` set `PRIVATE_KEY_PATH=../endpoint-test/private.pem`

Otherwise:

1. Open `public.pem` and copy everything from `BEGIN PUBLIC KEY` to `END PUBLIC KEY`.
2. GreenTick: **Flows → With endpoint → Business public key → Add / Edit**.
3. Paste the PEM. For **Test key with endpoint**, use `https://<tunnel-host>/flow`.
4. Save until Meta stores the key for **this WhatsApp number**.

If the public key on Meta and `private.pem` do not match, publish fails (decrypt 421).

---

## 3. Demo users

File: `demoData.js` in this folder. Each row is `{ name, email, password }` in plain text.

| Name | Email | Password |
| --- | --- | --- |
| Meow | meow@gmail.com | meow123 |
| Riya Sharma | riya@example.com | riya@123 |
| Amit Patel | amit@example.com | amit@123 |
| Meghsham | meghsham@example.com | pass123 |

The server reloads this file on every login, so you can add a user and retry without restarting.

Email match is case-insensitive (`Meow@gmail.com` still finds `meow@gmail.com`). Password must match exactly.

---

## 4. Create the Flow in GreenTick

Do this after the server, tunnel, and public key are ready.

### Open Create Flow

1. GreenTick → **Flows → With endpoint** (not Without endpoint).
2. Click **Create Flow**.
3. Keep the tab **With endpoint**.
4. **Flow name:** e.g. `Login demo`.
5. Select at least one **category**.
6. **Endpoint URI:** `https://<your-tunnel-host>/flow`  
   Must end with `/flow`, not `/` and not `/health`.

Screen **ids** must match `.env` exactly (letters and underscores only):

| `.env` key | Value you type in **Screen id** |
| --- | --- |
| `FIRST_SCREEN_ID` | `LOGIN_SCREEN` |
| `MIDDLE_SCREEN_ID` | `STATUS_SCREEN` |
| `SUCCESS_SCREEN_ID` | `WELCOME` |

The first screen defaults to `FORM_SCREEN`. Change it. If ids do not match, WhatsApp may close the Flow (`invalid-screen-transition`).

GreenTick routing is **sequential**: screen 1 can only open screen 2, screen 2 can only open screen 3. After a valid login this server opens screen 2; screen 3 then gets the welcome sentences.

---

### Screen 1 — `LOGIN_SCREEN`

Select screen 1.

| Setting | Value |
| --- | --- |
| **Screen id** | `LOGIN_SCREEN` |
| **Screen title** | `Login` |
| **Continue button label** | `Continue` |

Click **Add field** three times. Change **Type** on each field.

**Field A — name**

| Setting | Value |
| --- | --- |
| Type | Short text |
| Field name | `name` |
| Label | `Name` |
| Required | on |

**Field B — email**

| Setting | Value |
| --- | --- |
| Type | Email |
| Field name | `email` |
| Label | `Email` |
| Required | on |

If GreenTick names it `email_4`, you can leave it — the server still finds it. Prefer `email` if the name is editable.

**Field C — password**

| Setting | Value |
| --- | --- |
| Type | Short text |
| Field name | `password` |
| Label | `Password` |
| Required | on |

Use the field name **`password`**. Wrong-password errors are attached to that name. If the name does not exist on the screen, WhatsApp closes the Flow instead of showing the error.

---

### Screen 2 — `STATUS_SCREEN`

Click **Add screen**. Select screen 2.

| Setting | Value |
| --- | --- |
| **Screen id** | `STATUS_SCREEN` |
| **Screen title** | `Signed in` |
| **Continue button label** | `Continue` |

Add one **Body text** (or Heading):

| Setting | Value |
| --- | --- |
| Type | Body text |
| **Text** (entire field) | `${data.status}` |

No extra words. After a valid login the server sends `status` = `Login successful`.

You may use a static heading such as `Login successful` instead of `${data.status}`. The **Continue** footer is required so the Flow can move to screen 3.

---

### Screen 3 — `WELCOME`

Click **Add screen**. Select screen 3.

| Setting | Value |
| --- | --- |
| **Screen id** | `WELCOME` |
| **Screen title** | `Welcome` |
| **Submit button label** | `Done` |

Add two **Body text** fields (or Heading):

**First line**

| Setting | Value |
| --- | --- |
| Type | Body text |
| **Text** | `${data.name}` |

**Second line**

| Setting | Value |
| --- | --- |
| Type | Body text |
| **Text** | `${data.email}` |

Each box must be **only** that placeholder.

After a valid login, when this screen opens the server sends:

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

---

### Save and publish

1. Click **Save**.
2. Click **Publish**.

Publish sends an encrypted **ping** to your endpoint. The login server and tunnel must be running. If publish fails with a decrypt / endpoint error, check the URI (`…/flow`), port **3051**, and that the public key matches `private.pem`.

If you already published this Flow earlier, **Save then Publish again** after changing screens. Then send a **new** Flow from Live Chat. An old WhatsApp message keeps the old form.

---

## 5. How to test (as a customer)

1. GreenTick **Live Chat** → send this Flow.
2. On the phone, open it.

| What you type | What should happen |
| --- | --- |
| Email `meow@gmail.com`, password `meow123` | Screen 2 (`Login successful`), then screen 3: **Hi Meow** and **Welcome, you signed in as meow@gmail.com** |
| Email `nobody@gmail.com`, any password | Stay on screen 1: **user not exists please signup** under email |
| Email `meow@gmail.com`, password `wrong` | Stay on screen 1: **Wrong password. Try again.** under password |
| Empty email | Stay on screen 1: **Enter your email.** |

3. On screen 2 tap **Continue**. On screen 3 tap **Done** to finish.

Watch the login server terminal. Each Continue logs the decrypted payload and whether login succeeded.

---

## 6. Errors this server returns

These appear on **screen 1** as field `error_messages` (keys = the real field names Meta sent).

| Case | Message | Field |
| --- | --- | --- |
| Email empty / missing | `Enter your email.` | email |
| Email not a valid address | `Enter a valid email.` | email |
| No user with that email | `user not exists please signup` | email |
| Password empty | `Enter your password.` | password |
| Password does not match `demoData.js` | `Wrong password. Try again.` | password |

---

## 7. Troubleshooting

**Publish or Live Chat: endpoint could not decrypt / check public key**  
Tunnel or `npm run dev` is down, URI is not `…/flow`, you tunneled **3050** instead of **3051**, or `private.pem` does not match the public key on that WhatsApp number.

**Flow closes on a wrong password**  
Screen 1 id is not `LOGIN_SCREEN`, or the password field is not named `password` (and the server could not map the error to a field that exists on the screen).

**`invalid-screen-transition`**  
A screen id returned by this server is not in the Flow. Copy **Screen id** values from GreenTick into `.env` and restart:

```env
FIRST_SCREEN_ID=LOGIN_SCREEN
MIDDLE_SCREEN_ID=STATUS_SCREEN
SUCCESS_SCREEN_ID=WELCOME
```

Then Save + Publish again.

**You still see `${data.name}` on the phone**

- The Body/Heading is not **only** `${data.name}` (extra words or backticks).
- You opened an **old** Flow message — send a new one after publish.
- Screen 3 id is not `WELCOME`.
- The server was restarted in the middle of the form (session lost) — start again from screen 1.

**Welcome shows a different name than I typed**  
That is expected. Screen 3 uses the `name` stored in `demoData.js` for that email.

**OTP demo and login demo at the same time**  
They are different ports (3050 vs 3051) and different `/flow` tunnels. Each Flow’s Endpoint URI must point at the matching tunnel. They cannot share one ngrok URL unless you only run one server.

---

## 8. What happens on each tap

Meta sends an encrypted POST to `/flow`. This server decrypts it, then:

| Person’s action | Server answer |
| --- | --- |
| Flow opens | Open `LOGIN_SCREEN` |
| Continue on screen 1, unknown email | Stay on `LOGIN_SCREEN` with `user not exists please signup` |
| Continue on screen 1, wrong password | Stay on `LOGIN_SCREEN` with `Wrong password. Try again.` |
| Continue on screen 1, valid user | Open `STATUS_SCREEN` and send `status`, `name`, `email` |
| Continue on screen 2 | Open `WELCOME` with the same welcome sentences |
| Done on screen 3 | Finish the Flow |

---

## Mini glossary

| Word | Meaning |
| --- | --- |
| **Flow** | A multi-step form inside WhatsApp |
| **With endpoint** | Each Continue is sent to your server |
| **Without endpoint** | Screens only move inside WhatsApp; no live login check |
| **Endpoint URI** | Public https address of this server’s `/flow` route |
| **PEM / public key** | Text file Meta uses to encrypt data for your server |
| **`${data.name}`** | Placeholder: show the server’s `name` value for this screen |
| **`error_messages`** | Field-level errors so WhatsApp can keep the person on the same screen |

---

## Files in this folder

| File | Role |
| --- | --- |
| `server.js` | Express app (decrypt, login check, encrypt) |
| `demoData.js` | Demo users (name, email, password) |
| `.env` | Port and screen ids (gitignored) |
| `.env.example` | Template |
| `private.pem` / `public.pem` | Key pair (gitignored) |
| `login-sessions.json` | Login sessions by `flow_token` (gitignored) |
| [README.md](./README.md) | Shorter technical reference (routes, scripts) |

## Scripts

```bash
npm run dev    # nodemon
npm start      # node server.js
```
