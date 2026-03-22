import * as admin from "firebase-admin";
import { ToolResult, ToolExecutionContext } from "./tools.js";

// Acepta tanto "op" como "operation" para mayor compatibilidad
export async function firebase_master_tool(
  _context: ToolExecutionContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const op = (typeof args.operation === "string" ? args.operation : typeof args.op === "string" ? args.op : "").toLowerCase().trim();
  const path = typeof args.path === "string" ? args.path.trim() : "";
  const data = args.data ?? args.value ?? null;

  if (!op) {
    return { ok: false, error: "Debes enviar 'operation' (get, set, push, delete, update)." };
  }
  if (!path) {
    return { ok: false, error: "Debes enviar 'path' (ej: /users/perfil)." };
  }

  try {
    const db = admin.database();
    const ref = db.ref(path);

    switch (op) {
      case "get": {
        const snap = await ref.once("value");
        return { ok: true, data: snap.val() };
      }
      case "set": {
        await ref.set(data);
        return { ok: true, data: { message: "Set OK", path } };
      }
      case "update": {
        if (typeof data !== "object" || !data) {
          return { ok: false, error: "Para 'update' debes enviar un objeto en 'data'." };
        }
        await ref.update(data as object);
        return { ok: true, data: { message: "Update OK", path } };
      }
      case "push": {
        const newRef = await ref.push(data);
        return { ok: true, data: { message: "Push OK", key: newRef.key, path } };
      }
      case "delete": {
        await ref.remove();
        return { ok: true, data: { message: "Delete OK", path } };
      }
      default:
        return { ok: false, error: `Operación no soportada: '${op}'. Usa: get, set, push, update, delete.` };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido en Firebase";
    console.error("[firebase_master_tool] Error:", msg);
    return { ok: false, error: msg };
  }
}
