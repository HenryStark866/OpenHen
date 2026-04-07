/**
 * MoneyCoach - Motor de Coaching Financiero Adaptativo
 * ====================================================
 * Aprende de las preferencias del usuario y le envía proactivamente
 * consejos y guías para generar ingresos en internet de forma legal y sin inversión.
 */

import admin from "firebase-admin";
import { LlmClient } from "../llm/client.js";
import { Logger } from "../utils/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CoachProfile = {
  userId: number;
  skills: string[];
  availableHours: number;         // Hours/day available
  location: string;               // Country for opportunity filtering
  engagedTopics: Record<string, number>; // topic → engagement score
  rejectedTopics: string[];
  sessionCount: number;
  lastCoachingAt: number;
  totalEarningsTips: number;
  level: "beginner" | "intermediate" | "advanced";
};

export type CoachingTip = {
  id: string;
  topic: string;
  category: CoachingCategory;
  title: string;
  body: string;
  actionStep: string;
  platform?: string;
  estimatedEarnings?: string;
  timeRequired?: string;
  difficulty: "easy" | "medium" | "hard";
  requiresInvestment: false;       // Always false — no investment required
};

export type CoachingCategory =
  | "freelancing"
  | "content_creation"
  | "micro_tasks"
  | "digital_products"
  | "affiliate"
  | "tutoring"
  | "virtual_assistant"
  | "social_media"
  | "reselling"
  | "writing";

// ─── Opportunity Database ─────────────────────────────────────────────────────

const OPPORTUNITIES: CoachingTip[] = [
  {
    id: "upwork_profile",
    topic: "Perfil de Freelancer",
    category: "freelancing",
    title: "🚀 Crea tu perfil en Upwork hoy",
    body: "Upwork es la plataforma freelance #1 del mundo. Con habilidades básicas como redacción, traducción, manejo de datos o diseño puedes ganar entre $5 y $50/hora.",
    actionStep: "Ve a upwork.com → Crea perfil → Completa el 100% con foto, bio en inglés y 3 habilidades → Aplica a 10 trabajos de menor tarifa para conseguir tus primeras reseñas.",
    platform: "Upwork",
    estimatedEarnings: "$200-$2000/mes",
    timeRequired: "2-4 horas/día",
    difficulty: "medium",
    requiresInvestment: false,
  },
  {
    id: "fiverr_gigs",
    topic: "Gigs en Fiverr",
    category: "freelancing",
    title: "💼 Vende servicios en Fiverr desde $5",
    body: "En Fiverr puedes vender cualquier habilidad: logos, voiceovers, traducciones, plantillas de redes sociales, edición de video, manejo de correos. No necesitas experiencia previa.",
    actionStep: "Crea cuenta en fiverr.com → Publica 3 gigs con título llamativo, descripción clara y precio inicial bajo ($5-$10) → Comparte tus gigs en LinkedIn y Facebook.",
    platform: "Fiverr",
    estimatedEarnings: "$100-$1500/mes",
    timeRequired: "1-3 horas/día",
    difficulty: "easy",
    requiresInvestment: false,
  },
  {
    id: "youtube_shorts",
    topic: "YouTube Shorts",
    category: "content_creation",
    title: "📱 Gana con YouTube Shorts sin aparecer en cámara",
    body: "Los Shorts faceless (sin mostrar tu cara) están explotando. Puedes hacer videos de curiosidades, motivación, tutoriales o resúmenes de libros usando solo tu voz y el editor de YouTube.",
    actionStep: "Elige un nicho (curiosidades, dinero, motivación) → Graba 30 Shorts en 30 días → Aplica al Programa de Monetización de YouTube (requiere 1000 subs y 4000 horas).",
    platform: "YouTube",
    estimatedEarnings: "$50-$500/mes con 10K vistas",
    timeRequired: "1-2 horas/día",
    difficulty: "easy",
    requiresInvestment: false,
  },
  {
    id: "amazon_mturk",
    topic: "Micro-tareas",
    category: "micro_tasks",
    title: "⚡ Micro-tareas en Amazon MTurk (desde hoy)",
    body: "Amazon Mechanical Turk paga por tareas pequeñas: clasificar imágenes, transcribir audio, moderar contenido. No necesitas habilidades especiales.",
    actionStep: "Ve a mturk.com → Crea cuenta como Worker → Filtra tareas por mejor pago → Trabaja en horarios libres.",
    platform: "Amazon MTurk",
    estimatedEarnings: "$50-$300/mes",
    timeRequired: "1-4 horas/día",
    difficulty: "easy",
    requiresInvestment: false,
  },
  {
    id: "notion_templates",
    topic: "Plantillas Digitales",
    category: "digital_products",
    title: "📊 Vende plantillas de Notion en Gumroad",
    body: "Las plantillas de Notion para productividad, gestión de proyectos o finanzas personales se venden de $5 a $50 cada una. Créalas una vez y gana para siempre (ingresos pasivos).",
    actionStep: "Crea una plantilla útil en Notion (tracker de hábitos, gestor de proyectos) → Publica en gumroad.com → Promociona en Reddit (r/Notion) y Twitter.",
    platform: "Gumroad + Notion",
    estimatedEarnings: "$100-$2000/mes (pasivo)",
    timeRequired: "5 horas inicio, luego pasivo",
    difficulty: "medium",
    requiresInvestment: false,
  },
  {
    id: "affiliate_amazon",
    topic: "Marketing de Afiliados",
    category: "affiliate",
    title: "🔗 Gana comisiones con Amazon Associates",
    body: "Puedes ganar entre 1% y 10% de comisión por cada venta referida desde tu enlace. Funciona con un blog, canal de YouTube o cuenta de Instagram.",
    actionStep: "Aplica en affiliate-program.amazon.com → Elige un nicho específico → Crea contenido de reseñas en YouTube/Blog → Incluye tus enlaces de afiliado.",
    platform: "Amazon Associates",
    estimatedEarnings: "$50-$5000/mes",
    timeRequired: "Varía — más contenido = más ganancias",
    difficulty: "medium",
    requiresInvestment: false,
  },
  {
    id: "preply_tutoring",
    topic: "Tutoría Online",
    category: "tutoring",
    title: "🎓 Da clases de idiomas en Preply",
    body: "Si hablas español e inglés puedes ganar $10-$40/hora dando clases en Preply. También puedes enseñar matemáticas, programación, música o cualquier habilidad que tengas.",
    actionStep: "Regístrate en preply.com como tutor → Crea un perfil con video de presentación → Fija tu precio inicial bajo para conseguir primeras reseñas → Sube precios gradualmente.",
    platform: "Preply / iTalki",
    estimatedEarnings: "$200-$2000/mes",
    timeRequired: "Depende de clases agendadas",
    difficulty: "easy",
    requiresInvestment: false,
  },
  {
    id: "linkedin_va",
    topic: "Asistente Virtual",
    category: "virtual_assistant",
    title: "💻 Trabaja como Asistente Virtual en LinkedIn",
    body: "Muchos empresarios buscan asistentes virtuales para gestionar correos, agendar reuniones, hacer investigación y manejo de redes sociales. Pagas entre $10 y $30/hora.",
    actionStep: "Optimiza tu perfil de LinkedIn con 'Virtual Assistant' en el título → Publica contenido de valor diariamente → Contacta directamente a coaches, consultores y pequeñas empresas.",
    platform: "LinkedIn / Remote.co",
    estimatedEarnings: "$400-$2500/mes",
    timeRequired: "4-8 horas/día",
    difficulty: "medium",
    requiresInvestment: false,
  },
  {
    id: "tiktok_creativity",
    topic: "TikTok Creator Fund",
    category: "social_media",
    title: "🎵 Monetiza TikTok con el Creativity Program",
    body: "TikTok paga entre $0.02 y $0.04 por cada 1000 vistas en videos de +1 minuto. Con 500K vistas/mes puedes ganar $10-$20, pero el verdadero dinero es en colaboraciones con marcas.",
    actionStep: "Crea cuenta TikTok → Elige nicho de alto volumen (finanzas, salud, humor) → Publica 1 video diario por 30 días → Aplica al Creativity Program cuando tengas 10K seguidores.",
    platform: "TikTok",
    estimatedEarnings: "$50-$500+/mes (depende de seguidores)",
    timeRequired: "1-2 horas/día",
    difficulty: "easy",
    requiresInvestment: false,
  },
  {
    id: "medium_partner",
    topic: "Escritura Online",
    category: "writing",
    title: "✍️ Escribe en Medium y genera ingresos pasivos",
    body: "Medium te paga basado en el tiempo de lectura de sus miembros. Escribe artículos sobre temas que te apasionen — tecnología, productividad, finanzas, viajes — y acumula lectores.",
    actionStep: "Crea cuenta en medium.com → Únete al Partner Program → Escribe 1 artículo a la semana → Distribuye en Twitter y LinkedIn para atraer tráfico.",
    platform: "Medium",
    estimatedEarnings: "$10-$500/mes",
    timeRequired: "2-3 horas/semana",
    difficulty: "easy",
    requiresInvestment: false,
  },
  {
    id: "canva_designs",
    topic: "Diseño Gráfico",
    category: "digital_products",
    title: "🎨 Vende diseños de Canva en Etsy",
    body: "Crea plantillas para Instagram, presentaciones, invitaciones, tarjetas de visita en Canva y véndelas como archivos descargables en Etsy. Una vez creadas, generan ingresos pasivos.",
    actionStep: "Diseña 10 plantillas en Canva → Crea tienda en etsy.com → Publica con fotos atractivas → Optimiza títulos con palabras clave de búsqueda.",
    platform: "Canva + Etsy",
    estimatedEarnings: "$100-$3000/mes (pasivo)",
    timeRequired: "10 horas inicio, luego 1 hora/semana",
    difficulty: "easy",
    requiresInvestment: false,
  },
  {
    id: "dropservicing",
    topic: "Drop-servicing",
    category: "freelancing",
    title: "🔄 Drop-servicing: vende servicios sin hacerlos tú",
    body: "El drop-servicing consiste en vender un servicio (diseño web, SEO, videos) a un precio mayor, y contratar a alguien en Fiverr para que lo ejecute. Tú ganas la diferencia.",
    actionStep: "Encuentra servicios populares en Fiverr por $5-$20 → Crea un perfil en Upwork ofreciendo lo mismo por $50-$100 → Cuando consigas clientes, subcontrata en Fiverr → Gana la diferencia.",
    platform: "Upwork + Fiverr",
    estimatedEarnings: "$300-$3000/mes",
    timeRequired: "2-4 horas/día",
    difficulty: "medium",
    requiresInvestment: false,
  },
  {
    id: "survey_sites",
    topic: "Encuestas Pagadas",
    category: "micro_tasks",
    title: "📋 Gana respondiendo encuestas (sin inversión)",
    body: "Sitios como Swagbucks, Survey Junkie y Prolific pagan por completar encuestas de investigación de mercado. No es riqueza rápida, pero es dinero real sin hacer nada especial.",
    actionStep: "Regístrate en prolific.com (el más confiable) → Completa tu perfil → Responde encuestas disponibles → Retira ganancias a PayPal desde $5.",
    platform: "Prolific / Swagbucks",
    estimatedEarnings: "$20-$150/mes",
    timeRequired: "30 min - 2 horas/día",
    difficulty: "easy",
    requiresInvestment: false,
  },
  {
    id: "podcast_transcription",
    topic: "Transcripción",
    category: "micro_tasks",
    title: "🎧 Transcribe audio y gana dinero",
    body: "Servicios como Rev.com, Scribie y TranscribeMe pagan por minuto de audio transcrito. Un transcriptor promedio gana $0.45-$1.10 por minuto de audio.",
    actionStep: "Regístrate en rev.com → Pasa el examen de calificación → Acepta trabajos de transcripción → Trabaja a tu propio ritmo desde cualquier lugar.",
    platform: "Rev.com / Scribie",
    estimatedEarnings: "$100-$500/mes",
    timeRequired: "2-5 horas/día",
    difficulty: "easy",
    requiresInvestment: false,
  },
  {
    id: "github_copilot_tasks",
    topic: "Programación",
    category: "freelancing",
    title: "💻 Vende scripts y automatizaciones en Fiverr",
    body: "Si sabes programar (Python, JavaScript, o incluso usar herramientas no-code como Make/Zapier), puedes vender automatizaciones, bots y scripts a pequeñas empresas.",
    actionStep: "Crea un gig en Fiverr de 'Python automation script' o 'Zapier/Make automation setup' → Ofrece 3 revisiones → Empieza con precio bajo para conseguir reseñas.",
    platform: "Fiverr",
    estimatedEarnings: "$200-$5000/mes",
    timeRequired: "Varía por proyecto",
    difficulty: "hard",
    requiresInvestment: false,
  },
];

// ─── MoneyCoach Engine ────────────────────────────────────────────────────────

export class MoneyCoach {
  private readonly db: admin.database.Database;
  private readonly llm: LlmClient;
  private readonly botToken: string;
  private readonly userIds: Set<number>;
  private readonly logger: Logger;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  // Send a tip every 4 hours
  private readonly INTERVAL_MS = 4 * 60 * 60 * 1000;

  // On startup, send first tip after 2 minutes
  private readonly STARTUP_DELAY_MS = 2 * 60 * 1000;

  constructor(options: {
    db: admin.database.Database;
    llm: LlmClient;
    botToken: string;
    userIds: Set<number>;
  }) {
    this.db = options.db;
    this.llm = options.llm;
    this.botToken = options.botToken;
    this.userIds = options.userIds;
    this.logger = Logger.getInstance();
  }

  // ── Start the coaching loop ────────────────────────────────────────────────

  start(): void {
    this.logger.info("money-coach", "🧠 Motor de Coaching Financiero iniciado");

    // First tip: 2 minutes after startup
    setTimeout(() => {
      this.runCoachingCycle().catch((e) =>
        this.logger.error("money-coach", "Error en ciclo inicial", { error: String(e) })
      );
    }, this.STARTUP_DELAY_MS);

    // Recurring tips every 4 hours
    this.intervalHandle = setInterval(() => {
      this.runCoachingCycle().catch((e) =>
        this.logger.error("money-coach", "Error en ciclo recurrente", { error: String(e) })
      );
    }, this.INTERVAL_MS);

    this.logger.info("money-coach", "Coaching programado cada 4 horas");
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  // ── Main coaching cycle ───────────────────────────────────────────────────

  private async runCoachingCycle(): Promise<void> {
    for (const userId of this.userIds) {
      try {
        await this.coachUser(userId);
      } catch (e) {
        this.logger.error("money-coach", "Error coacheando usuario", {
          userId,
          error: String(e),
        });
      }
    }
  }

  private async coachUser(userId: number): Promise<void> {
    const profile = await this.getOrCreateProfile(userId);
    const tip = this.selectBestTip(profile);

    if (!tip) {
      this.logger.warn("money-coach", "No hay tips disponibles para el usuario", { userId });
      return;
    }

    // Use LLM to personalize the tip based on user profile
    const personalizedMessage = await this.personalizeTip(tip, profile);

    await this.sendTelegramMessage(userId, personalizedMessage);
    await this.recordTipSent(userId, tip, profile);

    this.logger.info("money-coach", "Tip de coaching enviado", {
      userId,
      tipId: tip.id,
      category: tip.category,
    });
  }

  // ── Adaptive tip selection (neural weighting) ─────────────────────────────

  private selectBestTip(profile: CoachProfile): CoachingTip | null {
    const sentTipIds = new Set(
      Object.keys(profile.engagedTopics).filter((k) => k.startsWith("sent_"))
        .map((k) => k.replace("sent_", ""))
    );

    const rejected = new Set(profile.rejectedTopics);

    // Filter out rejected and recently sent tips
    const available = OPPORTUNITIES.filter(
      (t) => !rejected.has(t.id) && !sentTipIds.has(t.id)
    );

    // If all tips have been sent, reset and start over
    if (available.length === 0) {
      return OPPORTUNITIES[Math.floor(Math.random() * OPPORTUNITIES.length)] ?? null;
    }

    // Score each tip based on user's engagement history
    const scored = available.map((tip) => {
      let score = 1;

      // Boost score for categories the user engaged with
      const categoryScore = profile.engagedTopics[`cat_${tip.category}`] ?? 0;
      score += categoryScore * 2;

      // Prefer easier tips for beginners
      if (profile.level === "beginner" && tip.difficulty === "easy") score += 3;
      if (profile.level === "intermediate" && tip.difficulty === "medium") score += 2;
      if (profile.level === "advanced" && tip.difficulty === "hard") score += 2;

      // Add small random factor to keep things fresh
      score += Math.random() * 0.5;

      return { tip, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.tip ?? null;
  }

  // ── LLM tip personalization ───────────────────────────────────────────────

  private async personalizeTip(tip: CoachingTip, profile: CoachProfile): Promise<string> {
    const now = new Date();
    const hour = now.getHours();
    const greeting =
      hour < 12 ? "Buenos días" : hour < 18 ? "Buenas tardes" : "Buenas noches";

    const sessionEmoji = ["💡", "🔥", "⚡", "🎯", "🚀", "💰", "🌟"][
      profile.sessionCount % 7
    ];

    try {
      const llmPrompt = `Eres un coach financiero motivador. Personaliza este consejo para enviar por Telegram.

CONSEJO BASE:
Título: ${tip.title}
Cuerpo: ${tip.body}
Paso de acción: ${tip.actionStep}
Plataforma: ${tip.platform ?? "Varias"}
Ganancias estimadas: ${tip.estimatedEarnings ?? "Variable"}
Tiempo requerido: ${tip.timeRequired ?? "Flexible"}
Nivel de dificultad: ${tip.difficulty}
Categoría: ${tip.category}

PERFIL DEL USUARIO:
- Sesión de coaching #${profile.sessionCount + 1}
- Nivel: ${profile.level}
- Horas disponibles/día: ${profile.availableHours}
- País: ${profile.location}

INSTRUCCIONES:
- Saluda con "${greeting}" y el emoji ${sessionEmoji}
- Hazlo motivador, personal y accionable
- Máximo 3 párrafos + el paso de acción
- Usa emojis con moderación
- Termina con "💬 Respóndeme con 'más info', 'siguiente consejo' o '¿cómo empiezo?'"
- Solo responde con el mensaje, sin explicaciones adicionales
- NO incluyas JSON ni formato de código`;

      const result = await this.llm.generate([
        { role: "system", content: "Eres un coach financiero motivador que ayuda a personas a generar ingresos online de forma legal y sin inversión. Tus mensajes son concisos, motivadores y accionables." },
        { role: "user", content: llmPrompt },
      ]);

      return result.text;
    } catch (e) {
      // Fallback: use the tip directly without LLM personalization
      this.logger.warn("money-coach", "LLM personalization failed, using base tip", { error: String(e) });
      return `${greeting} ${sessionEmoji}\n\n${tip.title}\n\n${tip.body}\n\n🎯 **Acción inmediata:**\n${tip.actionStep}\n\n💰 Ganancias estimadas: ${tip.estimatedEarnings ?? "Variable"}\n⏱ Tiempo: ${tip.timeRequired ?? "Flexible"}\n\n💬 Respóndeme con 'más info', 'siguiente consejo' o '¿cómo empiezo?'`;
    }
  }

  // ── Firebase profile management ───────────────────────────────────────────

  private async getOrCreateProfile(userId: number): Promise<CoachProfile> {
    const snapshot = await this.db.ref(`users/${userId}/coachProfile`).once("value");
    const existing = snapshot.val() as CoachProfile | null;

    if (existing) return existing;

    const defaultProfile: CoachProfile = {
      userId,
      skills: [],
      availableHours: 3,
      location: "Latinoamérica",
      engagedTopics: {},
      rejectedTopics: [],
      sessionCount: 0,
      lastCoachingAt: 0,
      totalEarningsTips: 0,
      level: "beginner",
    };

    await this.db.ref(`users/${userId}/coachProfile`).set(defaultProfile);
    return defaultProfile;
  }

  private async recordTipSent(
    userId: number,
    tip: CoachingTip,
    profile: CoachProfile
  ): Promise<void> {
    const updates: Record<string, unknown> = {
      [`users/${userId}/coachProfile/sessionCount`]: profile.sessionCount + 1,
      [`users/${userId}/coachProfile/lastCoachingAt`]: Date.now(),
      [`users/${userId}/coachProfile/totalEarningsTips`]: profile.totalEarningsTips + 1,
      [`users/${userId}/coachProfile/engagedTopics/sent_${tip.id}`]: Date.now(),
    };

    await this.db.ref().update(updates);
  }

  // ── Record user engagement (call this when user replies to a tip) ─────────

  async recordEngagement(userId: number, topicSignal: string, positive: boolean): Promise<void> {
    const profile = await this.getOrCreateProfile(userId);
    const key = `cat_${topicSignal}`;
    const current = profile.engagedTopics[key] ?? 0;
    const delta = positive ? 1 : -0.5;
    const newScore = Math.max(0, Math.min(10, current + delta));

    await this.db.ref(`users/${userId}/coachProfile/engagedTopics/${key}`).set(newScore);

    if (!positive) {
      const rejected = [...(profile.rejectedTopics ?? []), topicSignal];
      await this.db.ref(`users/${userId}/coachProfile/rejectedTopics`).set(rejected);
    }

    this.logger.info("money-coach", "Engagement registrado", { userId, topicSignal, positive });
  }

  // ── Update user profile from conversation ─────────────────────────────────

  async updateProfile(userId: number, updates: Partial<CoachProfile>): Promise<void> {
    await this.db.ref(`users/${userId}/coachProfile`).update(updates);
    this.logger.info("money-coach", "Perfil de coaching actualizado", { userId, updates });
  }

  // ── Send a telegram message ───────────────────────────────────────────────

  private async sendTelegramMessage(userId: number, text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: userId,
        text,
        parse_mode: "Markdown",
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Telegram sendMessage failed: ${err}`);
    }
  }

  // ── Send an immediate tip on demand ──────────────────────────────────────

  async sendImmediateTip(userId: number): Promise<void> {
    const profile = await this.getOrCreateProfile(userId);
    const tip = this.selectBestTip(profile);
    if (!tip) return;
    const msg = await this.personalizeTip(tip, profile);
    await this.sendTelegramMessage(userId, msg);
    await this.recordTipSent(userId, tip, profile);
  }
}
