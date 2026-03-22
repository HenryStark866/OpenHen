import admin from "firebase-admin";

export function initializeFirebase(databaseUrl: string): admin.app.App {
  if (!admin.apps.length) {
    let credential;
    try {
      const fs = require("node:fs");
      const path = require("node:path");
      const localPath = path.join(process.cwd(), "service-account.json");
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
      
      if (fs.existsSync(localPath)) {
        console.log(`[Firebase] Cargando credenciales desde archivo: ${localPath}`);
        credential = admin.credential.cert(JSON.parse(fs.readFileSync(localPath, "utf8")));
      } else if (serviceAccountJson) {
        console.log("[Firebase] Cargando desde ENV VAR FIREBASE_SERVICE_ACCOUNT");
        credential = admin.credential.cert(JSON.parse(serviceAccountJson));
      } else {
        console.log("[Firebase] Buscando credenciales por defecto (ADC)...");
        credential = admin.credential.applicationDefault();
      }
    } catch (e) {
      console.error("[Firebase] Error cargando credenciales:", e);
      credential = admin.credential.applicationDefault();
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
