# Dynamic text in WhatsApp Flows (beginner guide)

This guide explains how a WhatsApp form can **show text that comes from your server** — for example “Hi Meow” after the person types their name. You do not need to be a developer to follow the GreenTick steps. The server part is a ready-made demo you run on your computer.

Use this with the **endpoint-test** demo in this folder.

---

## What you will build

A 3-step form inside WhatsApp:

1. Person types **name** and **email**.
2. Person types a **one-time code** (OTP). The code appears in your computer’s terminal, not by email.
3. WhatsApp shows:
   - `Hi Meow` (their name)
   - `the email meow@gmail.com verified successfully` (their email)

The sentences are **built by the demo server**. WhatsApp only displays them.

---

## Who does what (three pieces)

Think of three workers:

| Who | Role in plain language |
| --- | --- |
| **WhatsApp (Meta)** | Shows the form on the phone. Encrypts answers. Fills in special placeholders. |
| **GreenTick** | You design the screens here and publish them to Meta. |
| **Your endpoint (this demo server)** | A small program Meta calls after each Continue. It decides the next screen and the exact sentences to show. |

**Endpoint** means: “the web address of your program.” For this demo it is usually:

`https://something.ngrok-free.app/flow`

Meta will not talk to `http://localhost`. The form on a real phone needs a **public https** address. Tools like **ngrok** make a public https link that forwards to your laptop.

---

## The one rule that trips everyone

On a GreenTick **Text** / **Heading** / **Body** field, WhatsApp only replaces a placeholder if **the whole field is the placeholder**.

**Works**

```text
${data.name}
```

```text
${data.email}
```

**Does not work** (WhatsApp prints this exactly, including the `${}`):

```text
Hi ${data.name}
```

```text
Your email ${data.email} verified successfully
```

Meta does not mix ordinary words and `${data.…}` in the **same** box.

That is why this demo server puts the words **inside** the values it sends:

- `name` = `Hi Meow`
- `email` = `the email meow@gmail.com verified successfully`

You still type only `${data.name}` and `${data.email}` in GreenTick. WhatsApp then shows the full sentences.

`${data.name}` means: “show the value named `name` that the server sent for this screen.” The word after `data.` must match the server’s key (`name`, `email`).

---

## What the demo server does

File: `server.js` in this folder. Default port: **3050**.

### Start it

```bash
cd endpoint-test
npm install
cp .env.example .env
npm run dev
```

Then expose it, for example:

```bash
ngrok http 3050
```

Keep **both** windows open (server + ngrok) while you publish or send the Flow.

### Encryption keys (simple picture)

Meta encrypts every request so only **your** server can read it.

- `private.pem` — secret lock pick. Stays on this computer. Never paste it into GreenTick.
- `public.pem` — the matching public lock. You upload this in GreenTick (**Flows → With endpoint → public key**).

On first start, the demo can create both files. In GreenTick you can **Test key with endpoint** using `https://<ngrok-host>/flow` before saving.

If the public key on Meta and `private.pem` do not match, Meta cannot talk to the server (decrypt error).

### What happens on each tap

Meta sends an encrypted POST to `/flow`. The server decrypts it, then:

| Person’s action | Server answer (idea) |
| --- | --- |
| Flow opens | Open screen `FORM_SCREEN` |
| Continue on screen 1 | Save name + email, print a 6-digit OTP in the **terminal**, open `OTP_SCREEN` |
| Wrong OTP | Stay on `OTP_SCREEN` and show an error under the OTP box |
| Correct OTP | Open `VERIFIED` and send the two sentences in `name` and `email` |
| Done on screen 3 | Finish the Flow |

OTP is **only printed in the terminal**, like:

```text
===== OTP CODE: 918040 =====
```

It is not emailed.

Screen ids in `.env` must match GreenTick:

- `FIRST_SCREEN_ID=FORM_SCREEN`
- `OTP_SCREEN_ID=OTP_SCREEN`
- `VERIFIED_SCREEN_ID=VERIFIED`

If the ids differ, WhatsApp may close the Flow (`invalid-screen-transition`).

---

## Create the Flow in GreenTick

Do this after the server, ngrok, and public key are ready.

### 1. Open the right list

**Flows → With endpoint** (not Without endpoint).

### 2. Create Flow

- Choose **With endpoint**.
- **Endpoint URI:** `https://<your-ngrok-host>/flow`  
  Must end with `/flow`, not `/` and not `/health`.

### 3. Screen 1 — id must be `FORM_SCREEN`

- Title: anything, e.g. `Your details`
- Add a text field. **Field name:** `name`. Label: `Name`
- Add an email field. **Field name:** `email` (GreenTick may name it `email_4`; the demo still finds it)
- Footer: `Continue`

### 4. Screen 2 — id must be `OTP_SCREEN`

- Title: e.g. `Enter code`
- Number (or text) field. **Field name:** `otp`. Label: `OTP`
- Footer: `Verify`

### 5. Screen 3 — id must be `VERIFIED` (dynamic text)

- Title: e.g. `Verified successfully`
- Optional heading with normal words only, e.g. `Verified successfully`
- **Text field 1 — entire contents:** `${data.name}`
- **Text field 2 — entire contents:** `${data.email}`
- Footer: `Done`

Do not write `Hi` in the same box as `${data.name}`.

### 6. Save, then Publish

Publishing checks that the endpoint is up (encrypted ping). If publish fails, start the server and ngrok again.

If you already **published** this Flow earlier, **Save then Publish again** after changing screen 3. Then send a **new** Flow from Live Chat. An old WhatsApp message keeps the old form.

---

## How to test (as a customer would)

1. GreenTick Live Chat → send this Flow.
2. On the phone, open it, enter a name and email, Continue.
3. Look at the **endpoint-test** terminal for `===== OTP CODE: … =====`.
4. Type that code, Verify.
5. Screen 3 should show **Hi {that name}** and **the email {that email} verified successfully**.

If you still see the characters `${data.name}` on the phone:

- The Text box is not **only** `${data.name}` (extra words or backticks).
- You opened an **old** Flow message — send a new one after publish.
- Screen 3 id is not `VERIFIED`.
- The server was restarted in the middle of the form (session lost) — start again from screen 1.

---

## How GreenTick and Meta connect the dots

1. You type `${data.name}` in GreenTick.
2. On save, GreenTick tells Meta: “this screen expects a piece of data called `name`.”
3. After a correct OTP, the demo server replies with that screen plus `name` and `email` already filled as full sentences.
4. WhatsApp copies those values into the two Text fields.

GreenTick never shows the live “Hi Meow” on the phone. **WhatsApp** does. The GreenTick preview may show example words like `Name` instead of the real person.

---

## Mini glossary

| Word | Meaning |
| --- | --- |
| **Flow** | A multi-step form inside WhatsApp |
| **With endpoint** | Each Continue is sent to your server |
| **Without endpoint** | Screens only move inside WhatsApp; no live lookup |
| **Endpoint URI** | Public https address of your server’s Flow route |
| **OTP** | One-time password / short code |
| **PEM / public key** | Text file Meta uses to encrypt data for your server |
| **`${data.name}`** | Placeholder: show the server’s `name` value for this screen |

---

## Related file

`README.md` in this folder has install, keys, routes, and troubleshooting in more technical detail.
