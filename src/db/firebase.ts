import admin from "firebase-admin";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function initializeFirebase(databaseUrl: string): admin.app.App {
  if (!admin.apps.length) {
    let credential;
    try {
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
      const localPath = join(process.cwd(), "service-account.json");

      // Priority: ENV VAR first (works in cloud), then local file
      if (serviceAccountJson) {
        console.log("[Firebase] Cargando desde ENV VAR FIREBASE_SERVICE_ACCOUNT");
        credential = admin.credential.cert(JSON.parse(serviceAccountJson));
      } else if (existsSync(localPath)) {
        console.log(`[Firebase] Cargando credenciales desde archivo: ${localPath}`);
        credential = admin.credential.cert(JSON.parse(readFileSync(localPath, "utf8")));
      } else {
        throw new Error("No se encontraron credenciales de Firebase. Configura FIREBASE_SERVICE_ACCOUNT en las variables de entorno.");
      }
    } catch (e) {
      console.error("[Firebase] Error FATAL cargando credenciales:", e);
      throw e; // Let it crash loudly so we see the real error
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
