import { AgentLoop } from "./src/agent/loop.js";
import { loadConfig } from "./src/config/env.js";
import { initializeFirebase } from "./src/db/firebase.js";
import { LlmClient } from "./src/llm/client.js";
import { GroqProvider } from "./src/llm/providers/groq.js";
import { MemoryRepository } from "./src/memory/repository.js";
import dotenv from "dotenv";
dotenv.config();

async function test() {
  const config = loadConfig();
  const app = initializeFirebase(config.firebaseDatabaseUrl);
  const memory = new MemoryRepository(app);
  const primary = new GroqProvider({ apiKey: config.groqApiKey, model: config.groqModel });
  const llm = new LlmClient({ primary });
  const agent = new AgentLoop({
    llm, memory, maxIterations: 6, workspaceRoot: process.cwd(), unsafeTools: true 
  });

  try {
    console.log("Iniciando prueba de agente para Google...");
    const reply = await agent.run(7540137539, "Hola, hazme una lista de los documentos que tengo en mi drive");
    console.log("Respuesta:", reply);
  } catch (e) {
    console.error("Agent Run Error:", e);
  }
}
test();
