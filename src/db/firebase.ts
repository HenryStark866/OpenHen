import admin from "firebase-admin";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Normalizes a Firebase service account object.
 * Fixes the most common copy-paste corruption: literal "\\n" in private_key
 * instead of actual newline characters.
 */
function normalizeServiceAccount(raw: string): admin.ServiceAccount {
  const parsed = JSON.parse(raw) as admin.ServiceAccount & { private_key?: string };

  // Fix corrupted private key: replace escaped newlines with real newlines
  if (parsed.private_key && typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }

  return parsed;
}

export function initializeFirebase(databaseUrl: string): admin.app.App {
  if (!admin.apps.length) {
    let credential;
    try {
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
      const localPath = join(process.cwd(), "service-account.json");

      // Priority: ENV VAR first (works in cloud), then local file
      if (serviceAccountJson) {
        console.log("[Firebase] Cargando desde ENV VAR FIREBASE_SERVICE_ACCOUNT");
        const account = normalizeServiceAccount(serviceAccountJson);
        credential = admin.credential.cert(account);
      } else if (existsSync(localPath)) {
        console.log(`[Firebase] Cargando credenciales desde archivo: ${localPath}`);
        const account = normalizeServiceAccount(readFileSync(localPath, "utf8"));
        credential = admin.credential.cert(account);
      } else {
        throw new Error(
          "No se encontraron credenciales de Firebase. " +
          "Configura la variable de entorno FIREBASE_SERVICE_ACCOUNT."
        );
      }
    } catch (e) {
      console.error("[Firebase] Error FATAL cargando credenciales:", e);
      throw e;
    }

    console.log(`[Firebase] Inicializando con databaseURL: ${databaseUrl}`);
    admin.initializeApp({
      credential,
      databaseURL: databaseUrl,
    });
    console.log("[Firebase] OK.");
  }
  return admin.app();
}
