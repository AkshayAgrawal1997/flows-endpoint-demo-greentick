require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");

const app = express();
const port = Number(process.env.PORT || 3051);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const STORE_PATH = path.join(__dirname, "login-sessions.json");
const DEMO_DATA_PATH = path.join(__dirname, "demoData.js");

let cachedPrivateKey;

function firstScreenId() {
  return process.env.FIRST_SCREEN_ID || "LOGIN_SCREEN";
}

function middleScreenId() {
  return process.env.MIDDLE_SCREEN_ID || "STATUS_SCREEN";
}

function successScreenId() {
  return process.env.SUCCESS_SCREEN_ID || "WELCOME";
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

function loadStore() {
  return readStore();
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

function loadUsers() {
  try {
    delete require.cache[require.resolve(DEMO_DATA_PATH)];
    const users = require(DEMO_DATA_PATH);
    return Array.isArray(users) ? users : [];
  } catch (error) {
    console.error("[Flow endpoint] Failed to load demoData.js:", error.message);
    return [];
  }
}

function findUserByEmail(email) {
  const needle = String(email || "").trim().toLowerCase();
  if (!needle) return null;
  return (
    loadUsers().find(
      (user) => String(user?.email || "").trim().toLowerCase() === needle,
    ) || null
  );
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

function pickNamedKey(data, names) {
  if (!data || typeof data !== "object") return "";
  const keys = Object.keys(data);
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(data, name)) return name;
    const match = keys.find((key) => key.toLowerCase() === name.toLowerCase());
    if (match) return match;
  }
  for (const name of names) {
    const match = keys.find((key) =>
      new RegExp(`^${name}(_\\d+)?$`, "i").test(key),
    );
    if (match) return match;
  }
  return "";
}

function pickNameField(data) {
  const key = pickNamedKey(data, [
    "name",
    "full_name",
    "fullName",
    "user_name",
    "text",
  ]);
  if (key) {
    return { key, value: String(data[key] ?? "").trim() };
  }
  if (!data || typeof data !== "object") return { key: "", value: "" };
  for (const [field, value] of Object.entries(data)) {
    const text = String(value || "").trim();
    if (!text || isValidEmail(text)) continue;
    if (/password|pass|pwd|email|otp/i.test(field)) continue;
    if (/^text(_\d+)?$/i.test(field) || /name/i.test(field)) {
      return { key: field, value: text };
    }
  }
  return { key: "", value: "" };
}

function pickEmailField(data) {
  const key = pickNamedKey(data, [
    "email",
    "email_address",
    "user_email",
    "mail",
  ]);
  if (key) {
    return { key, value: String(data[key] ?? "").trim().toLowerCase() };
  }
  if (!data || typeof data !== "object") return { key: "", value: "" };
  for (const [field, value] of Object.entries(data)) {
    const text = String(value || "").trim().toLowerCase();
    if (/^email(_\d+)?$/i.test(field)) {
      return { key: field, value: text };
    }
    if (isValidEmail(text)) return { key: field, value: text };
  }
  return { key: "", value: "" };
}

function pickPasswordField(data) {
  const key = pickNamedKey(data, [
    "password",
    "pass",
    "pwd",
    "user_password",
    "passwd",
  ]);
  if (key) {
    return { key, value: String(data[key] ?? "") };
  }
  if (!data || typeof data !== "object") return { key: "", value: "" };
  const nameKey = pickNameField(data).key;
  const emailKey = pickEmailField(data).key;
  for (const [field, value] of Object.entries(data)) {
    if (field === nameKey || field === emailKey) continue;
    if (/name|email/i.test(field)) continue;
    if (/^(password|pass|pwd|text|number)(_\d+)?$/i.test(field)) {
      return { key: field, value: String(value ?? "") };
    }
  }
  return { key: "", value: "" };
}

function pickName(data) {
  return pickNameField(data).value;
}

function pickEmail(data) {
  return pickEmailField(data).value;
}

function pickPassword(data) {
  return pickPasswordField(data).value;
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
function stayOnLoginScreen(screen, data, errors) {
  const emailField = pickEmailField(data);
  const passwordField = pickPasswordField(data);
  const nameField = pickNameField(data);
  const errorMessages = {};

  if (errors.email) {
    errorMessages[emailField.key || "email"] = errors.email;
  }
  if (errors.password) {
    errorMessages[passwordField.key || "password"] = errors.password;
  }
  if (errors.name) {
    errorMessages[nameField.key || "name"] = errors.name;
  }

  if (Object.keys(errorMessages).length === 0) {
    const keys = formFieldKeys(data);
    const message =
      errors.email || errors.password || errors.name || "Login failed.";
    if (keys.length === 0) {
      return stayOnScreen(screen, { email: message }, { error_message: message });
    }
    keys.forEach((field) => {
      errorMessages[field] = message;
    });
  }

  return stayOnScreen(screen, errorMessages);
}

function welcomePayload(session) {
  const personName = session?.name || "there";
  const personEmail = session?.email || "";
  return {
    name: `Hi ${personName}`,
    email: `Welcome, you signed in as ${personEmail}`,
    status: "Login successful",
  };
}

function successComplete(payload, session) {
  return {
    screen: "SUCCESS",
    data: {
      extension_message_response: {
        params: {
          flow_token: String(payload?.flow_token || "test-flow-token"),
          verified: Boolean(session?.verified),
          name: session?.name || pickName(payload?.data),
          email: session?.email || pickEmail(payload?.data),
        },
      },
    },
  };
}

function handleLogin(payload) {
  const data = payload?.data || {};
  const screen = String(payload?.screen || firstScreenId());
  const flowToken = String(payload?.flow_token || "").trim() || "anonymous";
  const nameField = pickNameField(data);
  const emailField = pickEmailField(data);
  const passwordField = pickPasswordField(data);
  const name = nameField.value;
  const email = emailField.value;
  const password = passwordField.value;

  logFlow("LOGIN — incoming form data", data);
  logFlow("LOGIN — picked fields", {
    screen,
    flowToken,
    name: name || "(empty)",
    nameField: nameField.key || "(none)",
    email: email || "(empty)",
    emailField: emailField.key || "(none)",
    password: password ? "(submitted)" : "(empty)",
    passwordField: passwordField.key || "(none)",
  });

  if (!email) {
    logFlow("LOGIN — blocked: no email");
    return stayOnLoginScreen(screen, data, {
      email: "Enter your email.",
    });
  }

  if (!isValidEmail(email)) {
    logFlow("LOGIN — blocked: invalid email");
    return stayOnLoginScreen(screen, data, {
      email: "Enter a valid email.",
    });
  }

  if (!password) {
    logFlow("LOGIN — blocked: no password");
    return stayOnLoginScreen(screen, data, {
      password: "Enter your password.",
    });
  }

  const user = findUserByEmail(email);
  if (!user) {
    logFlow("LOGIN — blocked: user not found", { email });
    return stayOnLoginScreen(screen, data, {
      email: "user not exists please signup",
    });
  }

  if (String(user.password ?? "") !== password) {
    logFlow("LOGIN — blocked: wrong password", { email });
    return stayOnLoginScreen(screen, data, {
      password: "Wrong password. Try again.",
    });
  }

  const session = saveSession(flowToken, {
    name: String(user.name || name || "there").trim() || "there",
    email: String(user.email || email).trim().toLowerCase(),
    verified: true,
    loggedInAt: new Date().toISOString(),
  });

  logFlow("LOGIN — success", {
    name: session.name,
    email: session.email,
    completeOnSuccess: completeOnSuccess(),
    nextScreen: completeOnSuccess() ? "SUCCESS" : middleScreenId(),
  });

  if (completeOnSuccess()) {
    return successComplete(payload, session);
  }

  return {
    screen: middleScreenId(),
    data: welcomePayload(session),
  };
}

function handleContinueToWelcome(payload) {
  const flowToken = String(payload?.flow_token || "").trim() || "anonymous";
  const session = getSession(flowToken);

  if (!session?.verified) {
    logFlow("STATUS — no verified session, returning to login");
    return {
      screen: firstScreenId(),
      data: {},
    };
  }

  logFlow("STATUS — opening welcome screen", successScreenId());
  return {
    screen: successScreenId(),
    data: welcomePayload(session),
  };
}

/**
 * Login test Flow:
 *   Screen 1 (FIRST_SCREEN_ID): name, email, password — Footer = data_exchange
 *   Screen 2 (MIDDLE_SCREEN_ID): continue after a valid login
 *   Screen 3 (SUCCESS_SCREEN_ID): ${data.name} / ${data.email} from demoData.js
 */
async function buildFlowResponse(payload) {
  const action = String(payload?.action || "");
  const screen = String(payload?.screen || "");
  const data =
    payload?.data && typeof payload.data === "object" ? payload.data : {};

  if (action === "ping") {
    return { data: { status: "active" } };
  }

  if (data.error) {
    console.error("[Flow endpoint] Client error notification:", data);
    if (
      String(data.error_message || "").includes(
        "does not exist in Flow routing model",
      )
    ) {
      console.error(
        "[Flow endpoint] A screen id in .env does not match a Screen id in this Flow. Copy the ids from GreenTick and restart.",
      );
    }
    return { data: { acknowledged: true } };
  }

  if (action === "INIT") {
    logFlow("INIT — opening login screen", {
      firstScreen: firstScreenId(),
      middleScreen: middleScreenId(),
      successScreen: successScreenId(),
      flowToken: payload?.flow_token || "",
      users: loadUsers().map((user) => user.email),
    });
    return { screen: firstScreenId(), data: {} };
  }

  if (action === "BACK") {
    if (screen === middleScreenId() || screen === successScreenId()) {
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

    const session = getSession(
      String(payload?.flow_token || "").trim() || "anonymous",
    );

    if (screen === successScreenId()) {
      logFlow("data_exchange — WELCOME submitted, completing Flow", {
        verified: Boolean(session?.verified),
      });
      return successComplete(payload, session);
    }

    if (screen === middleScreenId()) {
      logFlow("data_exchange — routing to WELCOME");
      return handleContinueToWelcome(payload);
    }

    logFlow("data_exchange — routing to LOGIN verify");
    return handleLogin(payload);
  }

  throw new Error(`Unsupported Flow action: ${action || "(empty)"}`);
}

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "WhatsApp Flow login test endpoint",
    endpoint: "/flow",
    demoUsers: loadUsers().map((user) => ({
      name: user.name,
      email: user.email,
    })),
    screens: {
      first: firstScreenId(),
      middle: middleScreenId(),
      success: successScreenId(),
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
    `WhatsApp Flow login endpoint running on http://localhost:${port}`,
  );
  console.log(`Configure Meta endpoint URI as: https://<tunnel-host>/flow`);
  console.log(
    `Screens: ${firstScreenId()} -> ${middleScreenId()} -> ${successScreenId()}`,
  );
  console.log(
    `Demo users: ${loadUsers()
      .map((user) => user.email)
      .join(", ") || "(none — add rows in demoData.js)"}`,
  );
});
