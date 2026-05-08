import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type BufferJSON,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { readdir, writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = 3040;
const AUTH_FOLDER = join(import.meta.dir, "auth");

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
// WhatsApp connection wrapper
// ---------------------------------------------------------------------------
async function connectWhatsApp(): Promise<void> {
  try {
    const { version } = await fetchLatestBaileysVersion();
    logger.info(`Using Baileys version: ${version.join(".")}`);

    // Ensure auth folder exists
    await mkdir(AUTH_FOLDER, { recursive: true });

    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

    sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: true,
      browser: ["whatsapp-service", "Chrome", "1.0.0"],
    });

    connectionStatus = "connecting";

    // Save credentials whenever they update
    sock.ev.on("creds.update", saveCreds);

    // Handle connection events
    sock.ev.on("connection.update", async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        lastQR = qr;
        qrcode.generate(qr, { small: true }, (qrStr: string) => {
          console.log("\n📱 Scan this QR code with WhatsApp:\n");
          console.log(qrStr);
        });
      }

      if (connection === "close") {
        connectionStatus = "disconnected";
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect =
          statusCode !== DisconnectReason.loggedOut &&
          reconnectAttempts < MAX_RECONNECT_ATTEMPTS;

        console.log(
          `❌ Connection closed. Status: ${statusCode}. Reconnecting: ${shouldReconnect}`
        );

        if (shouldReconnect) {
          reconnectAttempts++;
          const delay = Math.min(reconnectAttempts * 2000, 30000);
          console.log(`⏳ Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})...`);
          setTimeout(() => connectWhatsApp(), delay);
        } else {
          console.log("🚫 Max reconnect attempts reached or logged out. Manual restart required.");
          lastQR = null;
        }
      } else if (connection === "open") {
        connectionStatus = "connected";
        reconnectAttempts = 0;
        lastQR = null;
        console.log("✅ WhatsApp connected successfully!");
      } else if (connection === "connecting") {
        connectionStatus = "connecting";
        console.log("🔄 Connecting to WhatsApp...");
      }
    });

    sock.ev.on("messages.upsert", (msg) => {
      // We don't process incoming messages in this service
      // but you could add handling here
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
// HTTP Server (Bun native)
// ---------------------------------------------------------------------------
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // ---- POST /send ----
    if (url.pathname === "/send" && req.method === "POST") {
      try {
        const body = (await req.json()) as { phone?: string; message?: string };

        if (!body.phone || !body.message) {
          return Response.json(
            { error: "Missing required fields: phone, message" },
            { status: 400 }
          );
        }

        const result = await sendMessage(body.phone, body.message);
        return Response.json({ success: true, data: result });
      } catch (err: any) {
        return Response.json(
          { success: false, error: err.message },
          { status: 500 }
        );
      }
    }

    // ---- POST /send-batch ----
    if (url.pathname === "/send-batch" && req.method === "POST") {
      try {
        const body = (await req.json()) as {
          phones?: string[];
          message?: string;
        };

        if (!body.phones || !Array.isArray(body.phones) || body.phones.length === 0) {
          return Response.json(
            { error: "Missing or invalid required field: phones (string[])" },
            { status: 400 }
          );
        }

        if (!body.message) {
          return Response.json(
            { error: "Missing required field: message" },
            { status: 400 }
          );
        }

        const result = await sendBatchMessage(body.phones, body.message);
        return Response.json({ success: true, data: result });
      } catch (err: any) {
        return Response.json(
          { success: false, error: err.message },
          { status: 500 }
        );
      }
    }

    // ---- GET /status ----
    if (url.pathname === "/status" && req.method === "GET") {
      return Response.json({
        status: connectionStatus,
        reconnectAttempts,
        defaultPhones: DEFAULT_PHONES,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    }

    // ---- GET /qr ----
    if (url.pathname === "/qr" && req.method === "GET") {
      if (connectionStatus === "connected") {
        return Response.json({
          connected: true,
          message: "Already connected. No QR code needed.",
        });
      }

      if (!lastQR) {
        return Response.json(
          {
            connected: false,
            qr: null,
            message: "QR code not yet available. Wait a moment and try again.",
          },
          { status: 503 }
        );
      }

      return Response.json({
        connected: false,
        qr: lastQR,
        message: "Scan this QR code with WhatsApp to connect.",
      });
    }

    // ---- GET /health ----
    if (url.pathname === "/health" && req.method === "GET") {
      const healthy = connectionStatus === "connected";
      return Response.json(
        {
          healthy,
          status: connectionStatus,
          service: "whatsapp-service",
          port: PORT,
          timestamp: new Date().toISOString(),
        },
        { status: healthy ? 200 : 503 }
      );
    }

    // ---- POST /send-defaults ----
    if (url.pathname === "/send-defaults" && req.method === "POST") {
      try {
        const body = (await req.json()) as { message?: string };

        if (!body.message) {
          return Response.json(
            { error: "Missing required field: message" },
            { status: 400 }
          );
        }

        const result = await sendBatchMessage(DEFAULT_PHONES, body.message);
        return Response.json({ success: true, data: result });
      } catch (err: any) {
        return Response.json(
          { success: false, error: err.message },
          { status: 500 }
        );
      }
    }

    // ---- 404 fallback ----
    return Response.json(
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
      { status: 404 }
    );
  },
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
console.log(`\n🚀 WhatsApp Service running on port ${PORT}`);
console.log(`📋 Endpoints:`);
console.log(`   POST /send           - Send message to a phone number`);
console.log(`   POST /send-batch     - Send message to multiple numbers`);
console.log(`   POST /send-defaults  - Send message to default phone numbers`);
console.log(`   GET  /status         - Get connection status`);
console.log(`   GET  /qr             - Get QR code for pairing`);
console.log(`   GET  /health         - Health check`);
console.log(`\n📞 Default phones: ${DEFAULT_PHONES.join(", ")}`);
console.log(`📁 Auth folder: ${AUTH_FOLDER}\n`);

// Start WhatsApp connection
connectWhatsApp();
