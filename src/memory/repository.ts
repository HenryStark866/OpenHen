import admin from "firebase-admin";
import { LlmMessage } from "../llm/types.js";

export class MemoryRepository {
  private readonly db: admin.database.Database;

  constructor(app: admin.app.App) {
    this.db = app.database();
  }

  get firebaseRef(): admin.database.Database {
    return this.db;
  }

  async saveMessage(params: { 
    userId: number; 
    role: LlmMessage["role"]; 
    content: string; 
    images?: string[];
  }): Promise<void> {
    const { userId, role, content, images } = params;
    const ref = this.db.ref(`users/${userId}/messages`).push();
    
    // Map roles for compatibility
    let finalRole = role;
    if (role === "tool") {
      finalRole = "user" as any;
    }

    await ref.set({
      role: finalRole,
      content,
      images: images || [],
      createdAt: admin.database.ServerValue.TIMESTAMP,
    });
  }

  async getRecentMessages(userId: number, limit = 20): Promise<LlmMessage[]> {
    const snapshot = await this.db
      .ref(`users/${userId}/messages`)
      .orderByChild("createdAt")
      .limitToLast(limit)
      .once("value");

    const data = snapshot.val();
    if (!data) return [];

    const messages = Object.values(data) as Array<{
      role: LlmMessage["role"];
      content: string;
      images?: string[];
      createdAt: number;
    }>;

    return messages
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((m) => {
        let finalRole = m.role;
        if (finalRole === "tool") {
            finalRole = "user" as any;
        }
        return { 
          role: finalRole, 
          content: m.content,
          images: m.images && m.images.length > 0 ? m.images : undefined
        };
      });
  }

  async upsertNote(userId: number, key: string, value: string): Promise<void> {
    const safeKey = key.replace(/[.$#[\]/]/g, "_");
    await this.db.ref(`users/${userId}/notes/${safeKey}`).set({
      key,
      value,
      updatedAt: admin.database.ServerValue.TIMESTAMP,
    });
  }

  async getNote(userId: number, key: string): Promise<string | undefined> {
    const safeKey = key.replace(/[.$#[\]/]/g, "_");
    const snapshot = await this.db.ref(`users/${userId}/notes/${safeKey}`).once("value");
    const data = snapshot.val();
    return data?.value;
  }

  async listNotes(
    userId: number,
    limit = 20,
  ): Promise<Array<{ key: string; value: string; updatedAt: string }>> {
    const snapshot = await this.db
      .ref(`users/${userId}/notes`)
      .orderByChild("updatedAt")
      .limitToLast(limit)
      .once("value");

    const data = snapshot.val();
    if (!data) return [];

    const notes = Object.values(data) as Array<{
      key: string;
      value: string;
      updatedAt: number;
    }>;

    return notes
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((n) => ({
        key: n.key,
        value: n.value,
        updatedAt: new Date(n.updatedAt).toISOString(),
      }));
  }
}
