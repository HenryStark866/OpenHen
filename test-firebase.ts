import { initializeFirebase } from "./src/db/firebase.js";
import admin from "firebase-admin";
import dotenv from "dotenv";
dotenv.config();

async function testFirebase() {
  try {
    const dbUrl = process.env.FIREBASE_DATABASE_URL;
    console.log("Conectando a:", dbUrl);
    const app = initializeFirebase(dbUrl || "");
    const db = app.database();
    const ref = db.ref("test_connection");
    console.log("Escribiendo...");
    await ref.set({ time: Date.now() });
    console.log("Lectura...");
    const snap = await ref.once("value");
    console.log("Exito! Valor:", snap.val());
  } catch (e) {
    console.error("Firebase error detailed:", e);
  }
}
testFirebase();
