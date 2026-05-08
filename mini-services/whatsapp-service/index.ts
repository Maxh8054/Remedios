import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { mkdir, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { createServer } from "http";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// ESM __dirname shim
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = 3040;
const AUTH_FOLDER = join(__dirname, "auth");
const QR_DATA_PATH = join(__dirname, "..", "..", "public", "whatsapp-qr-data.txt");

const DEFAULT_PHONES = [
  "5562981206800",
  "5562982093453",
  "5562983068941",
];

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------
let sock: WASocket | null = null;
let connectionStatus: "connecting" | "connected" | "disconnected" = "disconnected";
let lastQR: string | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 50;

const logger = pino({
  level: "silent", // set to "info" for debugging
});

// ---------------------------------------------------------------------------
// Helper: ensure a JID from a phone number
// ---------------------------------------------------------------------------
function phoneToJID(phone: string): string {
  const cleaned = phone.replace(/[^\d]/g, "");
  return `${cleaned}@s.whatsapp.net`;
}

// ---------------------------------------------------------------------------
// JSON response helper
// ---------------------------------------------------------------------------
function jsonResponse(data: unknown, statusCode = 200) {
  const body = JSON.stringify(data);
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body,
  };
}

// ---------------------------------------------------------------------------
// WhatsApp connection wrapper
// ---------------------------------------------------------------------------
async function connectWhatsApp(): Promise<void> {
  try {
    const { version } = await fetchLatestBaileysVersion();
    logger.info(`Using Baileys version: ${version.join(".")}`);

    // Ensure auth folder exists
    await mkdir(AUTH_FOLDER, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

    sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: true,
      browser: ["pos-operatorio", "Chrome", "1.0.0"],
    });

    connectionStatus = "connecting";

    // Save credentials whenever they update
    sock.ev.on("creds.update", saveCreds);

    // Handle connection events
    sock.ev.on("connection.update", async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        lastQR = qr;
        console.log("\n📱 Novo QR code gerado! Escaneie com o WhatsApp:\n");
        qrcode.generate(qr, { small: true }, (qrStr: string) => {
          console.log(qrStr);
        });
        // Save QR data to file for the web app to generate image
        try {
          await writeFile(QR_DATA_PATH, qr, "utf-8");
          console.log("📸 QR data saved to public/whatsapp-qr-data.txt");
        } catch (err) {
          console.error("Failed to save QR data:", err);
        }
      }

      if (connection === "close") {
        connectionStatus = "disconnected";
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect =
          statusCode !== DisconnectReason.loggedOut &&
          reconnectAttempts < MAX_RECONNECT_ATTEMPTS;

        console.log(
          `❌ Conexão fechada. Status: ${statusCode}. Reconectando: ${shouldReconnect}`
        );

        if (shouldReconnect) {
          reconnectAttempts++;
          const delay = Math.min(reconnectAttempts * 2000, 30000);
          console.log(`⏳ Reconectando em ${delay / 1000}s (tentativa ${reconnectAttempts})...`);
          setTimeout(() => connectWhatsApp(), delay);
        } else {
          console.log("🚫 Máximo de tentativas atingido ou desconectado. Reinicie manualmente.");
          lastQR = null;
        }
      } else if (connection === "open") {
        connectionStatus = "connected";
        reconnectAttempts = 0;
        lastQR = null;
        console.log("✅ WhatsApp conectado com sucesso!");
      } else if (connection === "connecting") {
        connectionStatus = "connecting";
        console.log("🔄 Conectando ao WhatsApp...");
      }
    });

    sock.ev.on("messages.upsert", () => {
      // We don't process incoming messages
    });
  } catch (error) {
    console.error("Failed to connect:", error);
    connectionStatus = "disconnected";
    reconnectAttempts++;
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(reconnectAttempts * 2000, 30000);
      setTimeout(() => connectWhatsApp(), delay);
    }
  }
}

// ---------------------------------------------------------------------------
// Message sending helpers
// ---------------------------------------------------------------------------
async function sendMessage(phone: string, message: string) {
  if (!sock || connectionStatus !== "connected") {
    throw new Error("WhatsApp not connected. Please scan QR code first.");
  }

  const jid = phoneToJID(phone);
  const sent = await sock.sendMessage(jid, { text: message });
  return { phone, jid, messageId: sent.key.id, timestamp: sent.messageTimestamp };
}

async function sendBatchMessage(phones: string[], message: string) {
  const results = [];
  const errors = [];

  for (const phone of phones) {
    try {
      const result = await sendMessage(phone, message);
      results.push(result);
    } catch (err: any) {
      errors.push({ phone, error: err.message });
    }
  }

  return { total: phones.length, sent: results.length, failed: errors.length, results, errors };
}

// ---------------------------------------------------------------------------
// HTTP Server (Node.js native)
// ---------------------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // Helper to read request body
  const readBody = (): Promise<string> =>
    new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => { data += chunk; });
      req.on("end", () => resolve(data));
    });

  try {
    // ---- GET /status ----
    if (url.pathname === "/status" && req.method === "GET") {
      const resp = jsonResponse({
        status: connectionStatus,
        reconnectAttempts,
        defaultPhones: DEFAULT_PHONES,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
      res.writeHead(resp.statusCode, resp.headers);
      res.end(resp.body);
      return;
    }

    // ---- GET /qr ----
    if (url.pathname === "/qr" && req.method === "GET") {
      if (connectionStatus === "connected") {
        const resp = jsonResponse({ connected: true, message: "Already connected. No QR code needed." });
        res.writeHead(resp.statusCode, resp.headers);
        res.end(resp.body);
        return;
      }

      if (!lastQR) {
        const resp = jsonResponse(
          { connected: false, qr: null, message: "QR code not yet available. Wait a moment and try again." },
          503
        );
        res.writeHead(resp.statusCode, resp.headers);
        res.end(resp.body);
        return;
      }

      const resp = jsonResponse({
        connected: false,
        qr: lastQR,
        message: "Scan this QR code with WhatsApp to connect.",
      });
      res.writeHead(resp.statusCode, resp.headers);
      res.end(resp.body);
      return;
    }

    // ---- GET /health ----
    if (url.pathname === "/health" && req.method === "GET") {
      const healthy = connectionStatus === "connected";
      const resp = jsonResponse(
        { healthy, status: connectionStatus, service: "whatsapp-service", port: PORT, timestamp: new Date().toISOString() },
        healthy ? 200 : 503
      );
      res.writeHead(resp.statusCode, resp.headers);
      res.end(resp.body);
      return;
    }

    // ---- POST /send ----
    if (url.pathname === "/send" && req.method === "POST") {
      const body = JSON.parse(await readBody()) as { phone?: string; message?: string };
      if (!body.phone || !body.message) {
        const resp = jsonResponse({ error: "Missing required fields: phone, message" }, 400);
        res.writeHead(resp.statusCode, resp.headers);
        res.end(resp.body);
        return;
      }
      const result = await sendMessage(body.phone, body.message);
      const resp = jsonResponse({ success: true, data: result });
      res.writeHead(resp.statusCode, resp.headers);
      res.end(resp.body);
      return;
    }

    // ---- POST /send-batch ----
    if (url.pathname === "/send-batch" && req.method === "POST") {
      const body = JSON.parse(await readBody()) as { phones?: string[]; message?: string };
      if (!body.phones || !Array.isArray(body.phones) || body.phones.length === 0) {
        const resp = jsonResponse({ error: "Missing or invalid field: phones (string[])" }, 400);
        res.writeHead(resp.statusCode, resp.headers);
        res.end(resp.body);
        return;
      }
      if (!body.message) {
        const resp = jsonResponse({ error: "Missing required field: message" }, 400);
        res.writeHead(resp.statusCode, resp.headers);
        res.end(resp.body);
        return;
      }
      const result = await sendBatchMessage(body.phones, body.message);
      const resp = jsonResponse({ success: true, data: result });
      res.writeHead(resp.statusCode, resp.headers);
      res.end(resp.body);
      return;
    }

    // ---- POST /send-defaults ----
    if (url.pathname === "/send-defaults" && req.method === "POST") {
      const body = JSON.parse(await readBody()) as { message?: string };
      if (!body.message) {
        const resp = jsonResponse({ error: "Missing required field: message" }, 400);
        res.writeHead(resp.statusCode, resp.headers);
        res.end(resp.body);
        return;
      }
      const result = await sendBatchMessage(DEFAULT_PHONES, body.message);
      const resp = jsonResponse({ success: true, data: result });
      res.writeHead(resp.statusCode, resp.headers);
      res.end(resp.body);
      return;
    }

    // ---- 404 fallback ----
    const resp = jsonResponse(
      {
        error: "Not found",
        endpoints: [
          "POST /send           - { phone, message }",
          "POST /send-batch     - { phones: string[], message }",
          "POST /send-defaults  - { message } (sends to default phones)",
          "GET  /status         - Connection status info",
          "GET  /qr             - QR code data for pairing",
          "GET  /health         - Health check endpoint",
        ],
      },
      404
    );
    res.writeHead(resp.statusCode, resp.headers);
    res.end(resp.body);
  } catch (err: any) {
    const resp = jsonResponse({ success: false, error: err.message }, 500);
    res.writeHead(resp.statusCode, resp.headers);
    res.end(resp.body);
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`\n🚀 WhatsApp Service rodando na porta ${PORT}`);
  console.log(`📋 Endpoints:`);
  console.log(`   POST /send           - Enviar mensagem para um número`);
  console.log(`   POST /send-batch     - Enviar para múltiplos números`);
  console.log(`   POST /send-defaults  - Enviar para números padrão`);
  console.log(`   GET  /status         - Status da conexão`);
  console.log(`   GET  /qr             - QR code para pareamento`);
  console.log(`   GET  /health         - Health check`);
  console.log(`\n📞 Números padrão: ${DEFAULT_PHONES.join(", ")}`);
  console.log(`📁 Auth folder: ${AUTH_FOLDER}\n`);

  connectWhatsApp();
});

process.on("SIGINT", () => {
  console.log("\n🛑 Encerrando WhatsApp Service...");
  server.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
