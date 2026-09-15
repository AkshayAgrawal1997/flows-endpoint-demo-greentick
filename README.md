# flows-endpoint-demo-greentick

Demo WhatsApp Flow endpoints for GreenTick. Each folder is a small test server you can run locally and use with a **With endpoint** Flow.

---

## `otp-basic-advance-endpoint`

OTP demo. The user enters name and email. The server creates a 6-digit OTP (printed in the terminal) and checks the code the user types.

This folder has **two** examples:

- **Basic OTP**
  - Two screens only: form, then OTP
  - After a valid code the Flow ends
  - No third screen
  - No success message is shown

- **Advance OTP**
  - Three screens: form, OTP, then verified
  - After a valid code, a third screen shows a **dynamic** message with the user's **name** and **email**
  - Example: `Hi Riya` and `the email riya@example.com verified successfully`

See [otp-basic-advance-endpoint/README.md](./otp-basic-advance-endpoint/README.md) for setup.

---

## `login-demo-endpoint`

Login demo. The user enters name, email, and password. The server checks them against demo users in `demoData.js`.

- Screen 1: login form (wrong email or password stays here with an error)
- Screen 2: short “login successful” status
- Screen 3: welcome text from the server (`Hi {name}` and `Welcome, you signed in as {email}`)

See [login-demo-endpoint/README.md](./login-demo-endpoint/README.md) for setup.
