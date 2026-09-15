require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");

const app = express();
const port = Number(process.env.PORT || 3050);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const STORE_PATH = path.join(__dirname, "otp-sessions.json");
const OTP_TTL_MS =
  Number(process.env.OTP_TTL_MINUTES || 10) * 60 * 1000;

let cachedPrivateKey;

function firstScreenId() {
  return process.env.FIRST_SCREEN_ID || "FORM_SCREEN";
}

function otpScreenId() {
  return process.env.OTP_SCREEN_ID || "OTP_SCREEN";
}

function verifiedScreenId() {
  return process.env.VERIFIED_SCREEN_ID || "VERIFIED";
}

function completeOnSuccess() {
  return (
    String(process.env.COMPLETE_ON_SUCCESS || "false").toLowerCase() ===
    "true"
  );
}

/**
 * For this test project only, create a key pair on first startup when no key
 * was configured. Upload public.pem to Meta and keep private.pem secret.
 */
function ensureTestKeyPair() {
  if (process.env.PRIVATE_KEY || process.env.PRIVATE_KEY_PATH) return;

  const privatePath = path.join(__dirname, "private.pem");
  const publicPath = path.join(__dirname, "public.pem");
  if (fs.existsSync(privatePath)) return;

  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  fs.writeFileSync(privatePath, privateKey, { mode: 0o600 });
  fs.writeFileSync(publicPath, publicKey);
  console.log("[Flow endpoint] Generated private.pem and public.pem.");
  console.log("[Flow endpoint] Upload public.pem to your Meta app.");
}

/**
 * Load the RSA private key that corresponds to the public key uploaded to Meta.
 *
 * Supported configuration:
 *   PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
 *   PRIVATE_KEY_PATH="./private.pem" (default)
 *   PRIVATE_KEY_PASSPHRASE="..." (optional)
 */
function getPrivateKey() {
  if (cachedPrivateKey) return cachedPrivateKey;

  const inlineKey = String(process.env.PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const privateKeyPath = path.resolve(
    process.env.PRIVATE_KEY_PATH || path.join(__dirname, "private.pem"),
  );
  const pem =
    inlineKey ||
    (fs.existsSync(privateKeyPath)
      ? fs.readFileSync(privateKeyPath, "utf8")
      : "");

  if (!pem) {
    throw new Error(
      `RSA private key not found. Set PRIVATE_KEY or create ${privateKeyPath}.`,
    );
  }

  cachedPrivateKey = crypto.createPrivateKey({
    key: pem,
    passphrase: process.env.PRIVATE_KEY_PASSPHRASE || undefined,
  });
  return cachedPrivateKey;
}

function requiredBase64(body, key) {
  const value = body?.[key];
  if (!value || typeof value !== "string") {
    throw new Error(`Missing required request field: ${key}`);
  }
  return Buffer.from(value, "base64");
}

/**
 * Decrypt a WhatsApp Flow data endpoint request (data_api_version 3.0).
 * - RSA-OAEP/SHA-256 decrypts the per-request AES key.
 * - AES-128-GCM decrypts the request; its final 16 bytes are the auth tag.
 */
function decryptRequest(body) {
  const encryptedAesKey = requiredBase64(body, "encrypted_aes_key");
  const encryptedFlowData = requiredBase64(body, "encrypted_flow_data");
  const initialVector = requiredBase64(body, "initial_vector");

  const aesKey = crypto.privateDecrypt(
    {
      key: getPrivateKey(),
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    encryptedAesKey,
  );

  if (aesKey.length !== 16) {
    throw new Error(`Expected a 16-byte AES key, received ${aesKey.length}.`);
  }
  if (encryptedFlowData.length <= 16) {
    throw new Error("Encrypted Flow payload is too short.");
  }

  const authTag = encryptedFlowData.subarray(-16);
  const ciphertext = encryptedFlowData.subarray(0, -16);
  const decipher = crypto.createDecipheriv(
    "aes-128-gcm",
    aesKey,
    initialVector,
  );
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");

  return {
    payload: JSON.parse(plaintext),
    aesKey,
    initialVector,
  };
}

/**
 * Encrypt a response using the request AES key and a bitwise-inverted IV.
 * Meta expects ciphertext + the 16-byte GCM auth tag as one base64 string.
 */
function encryptResponse(response, aesKey, requestIv) {
  const responseIv = Buffer.from(requestIv.map((byte) => byte ^ 0xff));
  const cipher = crypto.createCipheriv("aes-128-gcm", aesKey, responseIv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(response), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([ciphertext, cipher.getAuthTag()]).toString("base64");
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function pruneExpired(store, now = Date.now()) {
  let changed = false;
  for (const [token, session] of Object.entries(store)) {
    const expiresAt = Date.parse(session?.expiresAt || "");
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      delete store[token];
      changed = true;
    }
  }
  return changed;
}

function loadStore() {
  const store = readStore();
  if (pruneExpired(store)) writeStore(store);
  return store;
}

function saveSession(flowToken, session) {
  const store = loadStore();
  store[flowToken] = session;
  writeStore(store);
  return session;
}

function getSession(flowToken) {
  if (!flowToken) return null;
  const store = loadStore();
  return store[flowToken] || null;
}

function pickField(data, names) {
  if (!data || typeof data !== "object") return "";
  for (const name of names) {
    const value = data[name];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  const keys = Object.keys(data);
  for (const name of names) {
    const match = keys.find(
      (key) => key.toLowerCase() === name.toLowerCase(),
    );
    if (!match) continue;
    const text = String(data[match] ?? "").trim();
    if (text) return text;
  }
  return "";
}

function pickName(data) {
  const direct = pickField(data, ["name", "full_name", "fullName", "user_name"]);
  if (direct) return direct;
  if (!data || typeof data !== "object") return "";
  const entries = Object.entries(data);
  for (const [key, value] of entries) {
    const text = String(value || "").trim();
    if (!text || isValidEmail(text)) continue;
    if (/otp|passcode|verification/i.test(key)) continue;
    if (/^text(_\d+)?$/i.test(key) || /name/i.test(key)) return text;
  }
  for (const [key, value] of entries) {
    const text = String(value || "").trim();
    if (!text || isValidEmail(text)) continue;
    if (/otp|code|passcode|verification/i.test(key)) continue;
    return text;
  }
  return "";
}

function pickEmail(data) {
  const direct = pickField(data, [
    "email",
    "email_address",
    "user_email",
    "mail",
  ]);
  if (direct) return direct.toLowerCase();
  if (!data || typeof data !== "object") return "";
  for (const [key, value] of Object.entries(data)) {
    const text = String(value || "").trim().toLowerCase();
    if (/^email(_\d+)?$/i.test(key) && text) return text;
    if (isValidEmail(text)) return text;
  }
  return "";
}

function formFieldKeys(data) {
  if (!data || typeof data !== "object") return [];
  return Object.keys(data).filter(
    (key) =>
      key !== "error_message" &&
      key !== "error_messages" &&
      key !== "trigger",
  );
}

function pickOtpField(data) {
  const preferred = [
    "otp",
    "otp_code",
    "code",
    "verification_code",
    "passcode",
  ];
  for (const name of preferred) {
    const text = String(data?.[name] ?? "").trim().replace(/\s+/g, "");
    if (text) return { key: name, value: text };
  }
  for (const [key, value] of Object.entries(data || {})) {
    const text = String(value ?? "").trim().replace(/\s+/g, "");
    if (
      /^(otp|code|passcode|number|text)(_\d+)?$/i.test(key) &&
      /^\d{4,8}$/.test(text)
    ) {
      return { key, value: text };
    }
  }
  for (const [key, value] of Object.entries(data || {})) {
    const text = String(value ?? "").trim().replace(/\s+/g, "");
    if (/^\d{4,8}$/.test(text)) return { key, value: text };
  }
  const keys = formFieldKeys(data);
  if (keys.length === 1) {
    return {
      key: keys[0],
      value: String(data[keys[0]] ?? "").trim().replace(/\s+/g, ""),
    };
  }
  return { key: keys[0] || "", value: "" };
}

function pickOtp(data) {
  return pickOtpField(data).value;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function logFlow(label, value) {
  if (value === undefined) {
    console.log(`[Flow endpoint] ${label}`);
    return;
  }
  console.log(
    `[Flow endpoint] ${label}:`,
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  );
}

function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function stayOnScreen(screen, errorMessages, extraData = {}) {
  const data = { ...extraData };
  if (errorMessages && Object.keys(errorMessages).length > 0) {
    data.error_messages = errorMessages;
  }
  if (!data.error_message) {
    const first = Object.values(errorMessages || {}).find(Boolean);
    if (first) data.error_message = first;
  }
  return { screen, data };
}

/** error_messages keys must match the Flow field `name` or Meta closes the Flow. */
function stayOnOtpScreen(screen, data, message) {
  const { key } = pickOtpField(data);
  const errorMessages = {};
  const keys = key ? [key] : formFieldKeys(data);
  if (keys.length === 0) {
    return stayOnScreen(screen, { otp: message }, { error_message: message });
  }
  keys.forEach((field) => {
    errorMessages[field] = message;
  });
  return stayOnScreen(screen, errorMessages, { error_message: message });
}

function successComplete(payload, session, verified) {
  return {
    screen: "SUCCESS",
    data: {
      extension_message_response: {
        params: {
          flow_token: String(payload?.flow_token || "test-flow-token"),
          verified,
          name: session?.name || pickName(payload?.data),
          email: session?.email || pickEmail(payload?.data),
        },
      },
    },
  };
}

async function handleSendOtp(payload) {
  const data = payload?.data || {};
  const screen = String(payload?.screen || firstScreenId());
  const flowToken = String(payload?.flow_token || "").trim() || "anonymous";
  const name = pickName(data) || "user";
  const email = pickEmail(data);

  logFlow("SEND OTP — incoming form data", data);
  logFlow("SEND OTP — picked fields", {
    screen,
    flowToken,
    name,
    email: email || "(empty)",
  });

  const otp = generateOtp();
  const now = new Date();
  saveSession(flowToken, {
    name,
    email,
    otp,
    verified: false,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OTP_TTL_MS).toISOString(),
  });

  console.log(`[Flow endpoint] ===== OTP CODE: ${otp} =====`);
  logFlow("SEND OTP — stored", {
    otp,
    name,
    email: email || "(empty)",
    nextScreen: otpScreenId(),
    storedIn: STORE_PATH,
  });

  const nextScreen = otpScreenId() || firstScreenId();
  logFlow("SEND OTP — continue to next screen", nextScreen);
  return {
    screen: nextScreen,
    data: {},
  };
}

function handleVerifyOtp(payload) {
  const data = payload?.data || {};
  const screen = String(payload?.screen || otpScreenId());
  const flowToken = String(payload?.flow_token || "").trim() || "anonymous";
  const otpField = pickOtpField(data);
  const submitted = otpField.value;
  const session = getSession(flowToken);

  logFlow("VERIFY OTP — incoming form data", data);
  logFlow("VERIFY OTP — picked fields", {
    screen,
    flowToken,
    otpField: otpField.key || "(none)",
    submittedOtp: submitted || "(empty)",
    storedOtp: session?.otp || "(no session)",
    storedEmail: session?.email || "(no session)",
    storedName: session?.name || "(no session)",
  });

  if (!session) {
    logFlow("VERIFY OTP — blocked: no stored session for this flow_token");
    return stayOnOtpScreen(
      screen,
      data,
      "Session expired. Go back and submit your email again.",
    );
  }

  if (!submitted) {
    logFlow("VERIFY OTP — blocked: otp field empty");
    return stayOnOtpScreen(
      screen,
      data,
      "Enter the 6-digit code and try again.",
    );
  }

  const expired = Date.parse(session.expiresAt) <= Date.now();
  const matches = submitted === String(session.otp);
  const verified = !expired && matches;

  saveSession(flowToken, {
    ...session,
    verified,
    lastAttemptAt: new Date().toISOString(),
  });

  logFlow("VERIFY OTP — result", {
    verified,
    expired,
    matches,
    submitted,
    expected: session.otp,
    email: session.email,
  });

  if (!verified) {
    return stayOnOtpScreen(
      screen,
      data,
      expired
        ? "This code has expired. Go back and request a new one."
        : "Invalid OTP. Check the OTP and try again.",
    );
  }

  logFlow("VERIFY OTP — success, opening VERIFIED screen", verifiedScreenId());
  const personName = session.name || "there";
  const personEmail = session.email || "";
  return {
    screen: verifiedScreenId(),
    data: {
      name: `Hi ${personName}`,
      email: `the email ${personEmail} verified successfully`,
    },
  };
}

/**
 * OTP test Flow:
 *   Screen 1 (FIRST_SCREEN_ID): fields `name`, `email` — Footer = data_exchange
 *   Screen 2 (OTP_SCREEN_ID): field `otp` — Footer = data_exchange
 *   Screen 3 (VERIFIED_SCREEN_ID): static "Verified" copy — Footer can complete
 *
 * Intermediate screens must use data_exchange (not navigate) so this endpoint
 * can send mail after screen 1 and validate after screen 2.
 */
async function buildFlowResponse(payload) {
  const action = String(payload?.action || "");
  const screen = String(payload?.screen || "");
  const data = payload?.data && typeof payload.data === "object"
    ? payload.data
    : {};

  if (action === "ping") {
    return { data: { status: "active" } };
  }

  if (data.error) {
    console.error("[Flow endpoint] Client error notification:", data);
    if (String(data.error_message || "").includes("does not exist in Flow routing model")) {
      console.error(
        "[Flow endpoint] FIRST_SCREEN_ID in .env does not match a Screen id in this Flow. Set it to the Screen id from GreenTick (e.g. OTPVERIFY) and restart.",
      );
    }
    return { data: { acknowledged: true } };
  }

  if (action === "INIT") {
    logFlow("INIT — opening first screen (OTP is sent later on Submit)", {
      firstScreen: firstScreenId(),
      otpScreen: otpScreenId(),
      flowToken: payload?.flow_token || "",
    });
    return { screen: firstScreenId(), data: {} };
  }

  if (action === "BACK") {
    if (screen === otpScreenId()) {
      return { screen: firstScreenId(), data: {} };
    }
    return { screen: screen || firstScreenId(), data: {} };
  }

  if (action === "data_exchange") {
    console.log("[Flow endpoint] ===== SCREEN BUTTON CLICK =====");
    console.log(
      "[Flow endpoint] Button payload:",
      JSON.stringify(
        {
          screen: screen || "(empty)",
          flow_token: payload?.flow_token || "",
          data,
        },
        null,
        2,
      ),
    );
    const name = pickName(data);
    const email = pickEmail(data);
    const otpValue = pickOtp(data);
    logFlow("data_exchange — raw payload data", data);
    logFlow("data_exchange — routing", {
      screen: screen || "(empty)",
      firstScreen: firstScreenId(),
      otpScreen: otpScreenId(),
      verifiedScreen: verifiedScreenId(),
      name: name || "(empty)",
      email: email || "(empty)",
      otp: otpValue || "(empty)",
    });

    const session = getSession(
      String(payload?.flow_token || "").trim() || "anonymous",
    );
    const shouldSend = Boolean(email) && (!session || !otpValue);
    const shouldVerify = Boolean(otpValue) && Boolean(session);

    if (screen === verifiedScreenId()) {
      logFlow("data_exchange — VERIFIED screen submitted, completing Flow", {
        verified: Boolean(session?.verified),
      });
      return successComplete(payload, session, Boolean(session?.verified));
    }

    if (screen === otpScreenId() || (shouldVerify && !shouldSend)) {
      logFlow("data_exchange — routing to VERIFY OTP");
      return handleVerifyOtp(payload);
    }

    logFlow("data_exchange — routing to SEND OTP");
    return handleSendOtp(payload);
  }

  throw new Error(`Unsupported Flow action: ${action || "(empty)"}`);
}

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "WhatsApp Flow OTP test endpoint",
    endpoint: "/flow",
    screens: {
      first: firstScreenId(),
      otp: otpScreenId(),
      verified: verifiedScreenId(),
    },
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "active" });
});

app.post("/flow", async (req, res) => {
  console.log("Request received:", req.body);
  let decrypted;
  try {
    decrypted = decryptRequest(req.body);
  } catch (error) {
    console.error("[Flow endpoint] Decryption failed:", error.message);
    return res.status(421).json({ error: "Unable to decrypt Flow request." });
  }

  try {
    console.log(
      "[Flow endpoint] Decrypted request:",
      JSON.stringify(decrypted.payload, null, 2),
    );

    const response = await buildFlowResponse(decrypted.payload);

    const encryptedResponse = encryptResponse(
      response,
      decrypted.aesKey,
      decrypted.initialVector,
    );

    console.log(
      "[Flow endpoint] Plain response:",
      JSON.stringify(response, null, 2),
    );
    return res.type("text/plain").send(encryptedResponse);
  } catch (error) {
    console.error("[Flow endpoint] Request failed:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

ensureTestKeyPair();

app.listen(port, () => {
  console.log(
    `WhatsApp Flow OTP endpoint running on http://localhost:${port}`,
  );
  console.log(`Configure Meta endpoint URI as: https://<tunnel-host>/flow`);
  console.log(
    `Screens: ${firstScreenId()} -> ${otpScreenId()} -> ${verifiedScreenId()}`,
  );
  console.log("OTP is printed in this console only (email send is disabled).");
});
