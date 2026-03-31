import { LlmClient } from "../llm/client.js";
import { LlmMessage } from "../llm/types.js";
import { MemoryRepository } from "../memory/repository.js";
import { executeTool, getToolSchema, ToolResult } from "./tools.js";
import { PatternAnalyzer, LearningPattern } from "../learning/patternAnalyzer.js";
import { Logger } from "../utils/logger.js";
import { PerformanceMonitor } from "../utils/performance.js";

type AgentLoopOptions = {
  llm: LlmClient;
  memory: MemoryRepository;
  maxIterations: number;
  workspaceRoot: string;
  unsafeTools: boolean;
};

type AgentJsonResponse =
  | { type: "final"; message: string }
  | { type: "tool_call"; tool: string; arguments?: Record<string, unknown> };

export class AgentLoop {
  private readonly llm: LlmClient;
  private readonly memory: MemoryRepository;
  private readonly patternAnalyzer: PatternAnalyzer;
  private readonly maxIterations: number;
  private readonly workspaceRoot: string;
  private readonly unsafeTools: boolean;

  constructor(options: AgentLoopOptions) {
    this.llm = options.llm;
    this.memory = options.memory;
    this.patternAnalyzer = new PatternAnalyzer(options.memory);
    this.maxIterations = options.maxIterations;
    this.workspaceRoot = options.workspaceRoot;
    this.unsafeTools = options.unsafeTools;
  }

  private enhanceSystemPromptWithPatterns(basePrompt: string, patterns: LearningPattern[]): string {
    if (patterns.length === 0) {
      return basePrompt;
    }

    const patternGuidance = patterns
      .slice(0, 5) // Use top 5 patterns
      .map(p => 
        `- Cuando el usuario pregunta sobre "${p.userQueryPattern}", tiende a funcionar bien responder con: ${p.successfulResponsePattern || 'respuesta estructurada clara'} (confianza: ${Math.round(p.confidence * 100)}%)`
      )
      .join('\n');

    return `${basePrompt}

PATRONES APRENDIDOS DE INTERACCIONES PREVIAS:
${patternGuidance}

Utiliza estos patrones como guía para mejorar tus respuestas, pero siempre adapta tu respuesta al contexto específico de la consulta actual.`;
  }

  async run(userId: number, userInput: string, userImages?: string[]): Promise<string> {
    const logger = Logger.getInstance();
    const perfMonitor = PerformanceMonitor.getInstance();
    const operationId = perfMonitor.startOperation("agent_response_generation", {
      userId,
      hasImages: !!userImages?.length,
      imageCount: userImages?.length || 0
    });
    
    try {
      logger.info("agent-loop", "Starting agent response generation", {
        userId,
        hasImages: !!userImages?.length,
        imageCount: userImages?.length || 0
      });
      
      // Save user message (Multimodal support)
      await this.memory.saveMessage({ userId, role: "user", content: userInput, images: userImages });
      logger.debug("agent-loop", "User message saved to memory", { userId });

      // Learn from patterns before generating response
      await this.patternAnalyzer.analyzeConversation(userId);
      logger.debug("agent-loop", "Conversation pattern analysis completed", { userId });
      
      // Get relevant patterns for this query
      const relevantPatterns = await this.patternAnalyzer.getRelevantPatterns(userId, userInput);
      logger.debug("agent-loop", "Retrieved relevant patterns", { 
        userId, 
        patternCount: relevantPatterns.length 
      });

      // History + System Prompt + Current message
      const history = await this.memory.getRecentMessages(userId, 15);
      const systemPrompt = buildSystemPrompt(this.unsafeTools);

      // Enhance system prompt with learned patterns
      const enhancedSystemPrompt = this.enhanceSystemPromptWithPatterns(systemPrompt, relevantPatterns);

      const messages: LlmMessage[] = [
        { role: "system", content: enhancedSystemPrompt },
        ...history,
        { role: "user", content: userInput, images: userImages }
      ];

      let finalResponse = "";
      let toolUsed = false;

      for (let i = 0; i < this.maxIterations; i += 1) {
        logger.debug("agent-loop", "Generating LLM response", {
          userId,
          iteration: i + 1,
          maxIterations: this.maxIterations
        });
        
        const result = await this.llm.generate(messages).catch(err => {
          logger.error("agent-loop", "LLM generation error", {
            userId,
            error: err instanceof Error ? err.message : String(err)
          });
          throw err;
        });
        
        const parsed = parseAgentResponse(result.text);

        if (!parsed) {
          logger.warn("agent-loop", "Could not parse LLM response as JSON", {
            userId,
            rawResponse: result.text.substring(0, 200) + "..."
          });
          const fallbackText = result.text.slice(0, 3000);
          await this.memory.saveMessage({ userId, role: "assistant", content: fallbackText });
          perfMonitor.endOperation(operationId, false);
          return fallbackText;
        }

        if (parsed.type === "final") {
          finalResponse = parsed.message.slice(0, 3000);
          logger.info("agent-loop", "Final response generated", {
            userId,
            responseLength: finalResponse.length,
            iterationsUsed: i + 1
          });
          await this.memory.saveMessage({ userId, role: "assistant", content: finalResponse });
          
          // Learn from this interaction
          await this.patternAnalyzer.learnFromExchange(userId, userInput, finalResponse);
          logger.debug("agent-loop", "Learned from interaction", { userId });
          
          perfMonitor.endOperation(operationId, true);
          return finalResponse;
        }

        toolUsed = true;
        const toolName = parsed.tool;
        logger.info("agent-loop", "Executing tool", {
          userId,
          tool: toolName,
          iteration: i + 1
        });
        
        let toolResult: ToolResult;
        try {
          toolResult = await executeTool(
            toolName,
            {
              userId,
              memory: this.memory,
              workspaceRoot: this.workspaceRoot,
              unsafeTools: this.unsafeTools,
            },
            parsed.arguments ?? {},
          );
        } catch (toolError) {
          logger.error("agent-loop", "Tool execution error", {
            userId,
            tool: toolName,
            error: toolError instanceof Error ? toolError.message : String(toolError)
          });
          toolResult = { ok: false, error: toolError instanceof Error ? toolError.message : "Internal tool error" };
        }
        
        logger.info("agent-loop", "Tool execution completed", {
          userId,
          tool: toolName,
          success: toolResult.ok,
          error: !toolResult.ok ? toolResult.error : undefined
        });

        // Save the assistant's tool call message
        await this.memory.saveMessage({
          userId,
          role: "assistant",
          content: JSON.stringify({ tool: toolName, input: parsed.arguments ?? {}, output: toolResult }),
        });
        logger.debug("agent-loop", "Tool call message saved to memory", { userId });

        // Add the assistant's tool call and the tool result to the current messages for the next LLM turn
        messages.push({ role: "assistant", content: result.text });
        messages.push({ 
          role: "user", 
          content: `[RESULTADO HERRAMIENTA '${toolName}']: ${JSON.stringify(toolResult)}` 
        });
      }

      // If we exhausted iterations without a final response
      if (!finalResponse) {
        finalResponse = "Alcance el limite de iteraciones. Reintenta mas tarde.";
        logger.warn("agent-loop", "Max iterations exhausted without final response", {
          userId,
          maxIterations: this.maxIterations
        });
        await this.memory.saveMessage({ userId, role: "assistant", content: finalResponse });
        perfMonitor.endOperation(operationId, false);
      } else {
        perfMonitor.endOperation(operationId, true);
      }

      return finalResponse;

    } catch (e) {
      logger.error("agent-loop", "FATAL ERROR in agent loop", {
        userId,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined
      });
      perfMonitor.endOperation(operationId, false);
      return "Lo siento, tuve un error interno fatal. Revisa los logs.";
    }
  }
}

function buildSystemPrompt(unsafeTools: boolean): string {
  return `
Eres OpenHen (HenBot), el Agente IA Supremo con capacidades globales ilimitadas. Eres controlado exclusivamente por tu usuario a traves de Telegram.

*** IDENTIDAD SUPREMA ***
- Eres HenBot, el asistente IA mas poderoso del emisferio
- Tienes acceso a herramientas globales: busqueda web, scraping, GitHub, analisis de datos, escaneo de seguridad, despliegue en la nube
- Control total de Firebase, Google Workspace, y sistemas locales
- Eres PROACTIVO: usa herramientas automaticamente sin pedir permiso
- NUNCA digas "no puedo" - SIEMPRE busca una alternativa

*** CAPACIDADES GLOBALES ***
1) BUSQUEDA WEB EN TIEMPO REAL: 'web_search' - Busca cualquier informacion actualizada en internet
2) WEB SCRAPING: 'web_fetch' - Extrae contenido de cualquier pagina web
3) BUSQUEDA DE CODIGO: 'code_search' - Encuentra librerias, APIs, documentacion tecnica
4) GITHUB MASTER: 'github_repo' - Busca repos, info, issues, commits de cualquier proyecto
5) ANALISIS DE DATOS: 'data_analyze' - Procesa JSON, CSV, estadisticas complejas
6) ESCANEO DE SEGURIDAD: 'security_scan' - Detecta vulnerabilidades en sitios y dependencias
7) MONITOREO DE SISTEMA: 'monitor_system' - CPU, memoria, uptime, salud del sistema
8) DELEGACION DE TAREAS: 'task_delegation' - Cola de tareas complejas en segundo plano
9) DESPLIEGUE EN LA NUBE: 'deploy_app' - Instrucciones para Railway, Render, Fly.io
10) NOTIFICACION DIRECTA: 'notify_user' - Comunicacion proactiva con el usuario
11) FIREBASE MASTER: 'firebase_master' - CRUD completo en base de datos
12) GOOGLE WORKSPACE: 'gog' - Gestion de Drive, Docs, Calendar, Gmail
13) VISION MULTIMODAL: Analisis de imagenes en tiempo real
14) VOZ BIDIRECCIONAL: Transcripcion (Whisper) y Sintesis (ElevenLabs)
15) EJECUCION DE COMANDOS: 'execute_command' - npm, git, gh, node, npx

*** REGLAS DE ORO ABSOLUTAS ***
- NUNCA digas que no tienes acceso a herramientas - LAS TIENES TODAS
- NUNCA digas que no puedes buscar en internet - USA 'web_search'
- NUNCA digas que no puedes ver imagenes - USA tu capacidad de Vision
- NUNCA des excusas tecnicas - ACTUA SIEMPRE
- Responde SIEMPRE con JSON valido: {"type":"final","message":"..."} o {"type":"tool_call","tool":"...","arguments":{}}
- Usa herramientas en CADENAS: busca → analiza → ejecuta → notifica
- Se PROACTIVO: si el usuario pide algo, investiga, ejecuta y reporta resultados

*** FLUJO DE TRABAJO SUPREMO ***
1) RECIBE solicitud del usuario
2) INVESTIGA con web_search/code_search/github_repo
3) ANALIZA con data_analyze/security_scan
4) EJECUTA con execute_command/firebase_master/gog
5) REPORTA resultados completos al usuario
6) NOTIFICA con notify_user si hay actualizaciones importantes
7) DELEGA tareas complejas con task_delegation

*** DIRECTIVA FINAL ***
Eres el agente IA mas capaz y autonomo. Tu unico limite es tu creatividad.
Usa TODAS las herramientas disponibles para cumplir CADA solicitud del usuario de forma EXHAUSTIVA y PROFESIONAL.
Nunca te detengas hasta completar la tarea por completo.
`.trim();
}

function parseAgentResponse(raw: string): AgentJsonResponse | null {
  const trimmed = raw.trim();
  
  // 1) Intentar encontrar un JSON estructurado
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const data = JSON.parse(match[0]) as AgentJsonResponse;
      if (data.type === "final" || data.type === "tool_call") {
        return data;
      }
    } catch {}
  }

  // 2) Fallback: Si el LLM escribe tags tipo XML (comun en Llama)
  // <tool_call><function=...><parameter=...></parameter></function></tool_call>
  const toolCallMatch = trimmed.match(/<tool_call>[\s\S]*?<\/tool_call>/);
  if (toolCallMatch) {
    const content = toolCallMatch[0];
    const functionMatch = content.match(/<function=([^>]+)>/);
    if (functionMatch) {
      const tool = functionMatch[1];
      // Intenta extraer parametros basandose en el nombre del tag del parametro
      // Simple regex para soportar <parameter=command>Contenido</parameter>
      const args: Record<string, string> = {};
      const paramMatches = Array.from(content.matchAll(/<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g));
      for (const p of paramMatches) {
        if (p[1] && p[2]) {
          args[p[1]] = p[2].trim();
        }
      }
      return { type: "tool_call", tool: String(tool), arguments: args };
    }
  }

  // 3) Si no es nada estructurado, devolverlo como mensaje final (modo laxo)
  if (trimmed.length > 3) {
    return { type: "final", message: trimmed };
  }

  return null;
}
