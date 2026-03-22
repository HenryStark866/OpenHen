import { MemoryRepository } from "../memory/repository.js";
import { LlmMessage } from "../llm/types.js";

export interface LearningPattern {
  id: string;
  userQueryPattern: string;
  successfulResponsePattern: string;
  confidence: number;
  usageCount: number;
  lastUsed: number;
}

export class PatternAnalyzer {
  private readonly memory: MemoryRepository;

  constructor(memory: MemoryRepository) {
    this.memory = memory;
  }

  async analyzeConversation(userId: number): Promise<void> {
    try {
      const messages = await this.memory.getRecentMessages(userId, 50);
      
      // Analyze successful conversation patterns
      for (let i = 0; i < messages.length - 2; i++) {
        const userMsg = messages[i];
        const assistantMsg = messages[i + 1];
        
        if (userMsg && userMsg.role === "user" && assistantMsg && assistantMsg.role === "assistant") {
          // Extract patterns from successful exchanges
          await this.learnFromExchange(userId, userMsg.content, assistantMsg.content);
        }
      }
    } catch (error) {
      console.error("Error analyzing conversation patterns:", error);
    }
  }

  async learnFromExchange(userId: number, userQuery: string, assistantResponse: string): Promise<void> {
    // Simple pattern extraction - in a real implementation, this would use NLP
    const queryKeywords = this.extractKeywords(userQuery);
    const responsePatterns = this.extractResponsePatterns(assistantResponse);
    
    // Store learned pattern
    const patternId = `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await this.memory.upsertNote(userId, `learned_pattern_${patternId}`, JSON.stringify({
      queryKeywords,
      responsePatterns,
      timestamp: Date.now(),
      confidence: 0.5 // Initial confidence
    }));
  }

  extractKeywords(text: string): string[] {
    // Simple keyword extraction - remove common words and extract meaningful terms
    const commonWords = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'y', 'o', 'pero', 'porque', 'para', 'con', 'sin', 'sobre', 'under', 'the', 'and', 'or', 'but', 'because', 'for', 'with', 'without', 'about', 'en', 'de', 'del', 'al']);
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !commonWords.has(word));
    
    return [...new Set(words)]; // Remove duplicates
  }

  extractResponsePatterns(text: string): string[] {
    // Extract structural patterns from responses
    const patterns: string[] = [];
    
    // Look for common response structures
    if (text.includes('Primero')) patterns.push('sequential_explanation');
    if (text.includes('En resumen')) patterns.push('summary_conclusion');
    if (text.includes('Ejemplo:')) patterns.includes('example_based');
    if (text.match(/[\d]+\./)) patterns.push('numbered_list');
    if (text.includes('- ') || text.includes('* ')) patterns.push('bullet_points');
    
    return patterns;
  }

  async getRelevantPatterns(userId: number, userQuery: string): Promise<LearningPattern[]> {
    try {
      const notes = await this.memory.listNotes(userId, 100);
      const queryKeywords = this.extractKeywords(userQuery);
      const relevantPatterns: LearningPattern[] = [];
      
      for (const note of notes) {
        try {
          const patternData = JSON.parse(note.value);
          const patternKeywords = patternData.queryKeywords || [];
          
          // Calculate similarity based on keyword overlap
          const overlap = queryKeywords.filter(kw => patternKeywords.includes(kw)).length;
          const similarity = overlap > 0 ? overlap / Math.max(queryKeywords.length, patternKeywords.length) : 0;
          
          if (similarity > 0.3) { // Threshold for relevance
            relevantPatterns.push({
              id: note.key,
              userQueryPattern: patternKeywords.join(' '),
              successfulResponsePattern: patternData.responsePatterns?.join(' ') || '',
              confidence: patternData.confidence || 0.5,
              usageCount: patternData.usageCount || 0,
              lastUsed: patternData.timestamp || 0
            });
          }
        } catch (e) {
          // Skip invalid pattern data
          continue;
        }
      }
      
      // Sort by confidence and usage
      return relevantPatterns.sort((a, b) => 
        (b.confidence * Math.log(b.usageCount + 1)) - (a.confidence * Math.log(a.usageCount + 1))
      );
    } catch (error) {
      console.error("Error getting relevant patterns:", error);
      return [];
    }
  }

  async updatePatternUsage(userId: number, patternId: string, success: boolean): Promise<void> {
    try {
      const note = await this.memory.getNote(userId, patternId);
      if (!note) return;
      
      const patternData = JSON.parse(note);
      let newConfidence = patternData.confidence || 0.5;
      
      // Adjust confidence based on success
      if (success) {
        newConfidence = Math.min(0.95, newConfidence + 0.05);
      } else {
        newConfidence = Math.max(0.1, newConfidence - 0.03);
      }
      
      patternData.confidence = newConfidence;
      patternData.usageCount = (patternData.usageCount || 0) + 1;
      patternData.lastUsed = Date.now();
      
      await this.memory.upsertNote(userId, patternId, JSON.stringify(patternData));
    } catch (error) {
      console.error("Error updating pattern usage:", error);
    }
  }
}