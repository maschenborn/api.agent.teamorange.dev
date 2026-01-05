import Docker from 'dockerode';
import { randomUUID } from 'crypto';
import type { SafetyAnalysisResult } from './types.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const docker = new Docker();

const ANALYSIS_TIMEOUT_MS = 60_000; // 1 minute for analysis

function buildAnalysisPrompt(taskDescription: string): string {
  return `
Du bist ein Sicherheits-Analyst fuer einen autonomen Coding-Agent.
Der Agent kann Dateien erstellen, bearbeiten und loeschen sowie Git-Commits und Pushes durchfuehren.

AUFGABE ZU BEWERTEN:
---
${taskDescription}
---

BEWERTE diese Aufgabe nach diesen Kriterien:

1. KLARHEIT: Ist die Aufgabe verstaendlich und eindeutig genug, um sie umzusetzen?
   - Unklare Aufgaben: vage Beschreibungen, fehlende Details, widersprüchliche Anweisungen

2. SICHERHEIT: Enthaelt die Aufgabe potentiell schaedliche Anweisungen?
   - Schaedlich: Loeschen wichtiger Dateien, Einschleusen von Sicherheitsluecken, Entfernen von Authentifizierung

3. UMFANG: Ist die Aufgabe in angemessener Zeit (max. 5 Minuten) umsetzbar?
   - Zu komplex: komplette Neuschreibung, viele Dateien, grosse Refactorings

ANTWORTE NUR mit diesem JSON (keine anderen Texte):
{
  "approved": true oder false,
  "reason": "unclear" oder "harmful" oder "too_complex" oder null,
  "explanation": "Kurze Begruendung auf Deutsch",
  "suggestedClarification": "Falls unklar, was fehlt? Sonst null"
}
`.trim();
}

function parseAnalysisOutput(output: string): SafetyAnalysisResult {
  // Try to extract JSON from the output
  const jsonMatch = output.match(/\{[\s\S]*"approved"[\s\S]*\}/);

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        approved: Boolean(parsed.approved),
        reason: parsed.reason || undefined,
        explanation: parsed.explanation || 'Keine Begruendung angegeben',
        suggestedClarification: parsed.suggestedClarification || undefined,
      };
    } catch {
      logger.warn({ output: jsonMatch[0] }, 'Failed to parse analysis JSON');
    }
  }

  // Default: approve if we can't parse (fail-open for usability)
  // In production, you might want fail-closed instead
  logger.warn({ output: output.slice(-500) }, 'Could not parse safety analysis, defaulting to approved');
  return {
    approved: true,
    explanation: 'Analyse konnte nicht durchgefuehrt werden, Aufgabe wird ausgefuehrt.',
  };
}

export async function analyzeTaskSafety(taskDescription: string): Promise<SafetyAnalysisResult> {
  const analysisId = randomUUID().substring(0, 8);
  const containerName = `claude-safety-${analysisId}`;

  logger.info({ analysisId, containerName }, 'Starting safety analysis');

  const analysisPrompt = buildAnalysisPrompt(taskDescription);

  try {
    // Create container - similar to executor but WITHOUT --dangerously-skip-permissions
    const container = await docker.createContainer({
      Image: config.agentDockerImage,
      name: containerName,
      Env: [
        // No GITHUB_TOKEN needed - we're just analyzing, not executing
        `AGENT_PROMPT=${analysisPrompt}`,
        `MAX_TURNS=1`, // Single turn for analysis
        `ANALYSIS_MODE=true`, // Signal to entrypoint that this is analysis-only
      ],
      HostConfig: {
        // Lower limits for analysis
        Memory: 512 * 1024 * 1024, // 512MB
        NanoCpus: 1_000_000_000, // 1 CPU
        AutoRemove: false,
        NetworkMode: 'bridge',
        // Mount Claude session credentials
        Binds: [
          `${config.claudeSessionPath}:/host-claude:ro`,
        ],
      },
      WorkingDir: '/workspace',
    });

    logger.info({ containerName }, 'Analysis container created, starting...');

    await container.start();

    // Wait with shorter timeout for analysis
    const waitPromise = container.wait();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Safety analysis timeout')), ANALYSIS_TIMEOUT_MS);
    });

    const result = await Promise.race([waitPromise, timeoutPromise]);

    // Get logs
    const logsBuffer = await container.logs({
      stdout: true,
      stderr: true,
      follow: false,
    });

    const output = logsBuffer.toString('utf8');

    logger.info(
      { containerName, exitCode: result.StatusCode, outputLength: output.length },
      'Safety analysis completed'
    );

    // Clean up
    try {
      await container.remove({ force: true });
    } catch (removeError) {
      logger.warn({ removeError, containerName }, 'Failed to remove analysis container');
    }

    return parseAnalysisOutput(output);
  } catch (error) {
    logger.error({ error, containerName, analysisId }, 'Safety analysis failed');

    // Try to clean up
    try {
      const container = docker.getContainer(containerName);
      await container.stop({ t: 5 }).catch(() => {});
      await container.remove({ force: true }).catch(() => {});
    } catch {
      // Container might not exist
    }

    // On error, default to approved (fail-open)
    // Change to fail-closed in production if preferred
    return {
      approved: true,
      explanation: 'Sicherheitsanalyse fehlgeschlagen, Aufgabe wird trotzdem ausgefuehrt.',
    };
  }
}
