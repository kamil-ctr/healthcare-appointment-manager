/**
 * Orchestrates one pre-visit summary generation: call the model, validate
 * strictly, and on a validation failure make exactly one repair attempt
 * before giving up. Giving up is a normal outcome - callers (jobs/ai-
 * summaries.js) catch whatever this throws and mark the row 'failed'.
 */
import { callModel } from './client.js';
import { PROMPT_VERSION, buildPreVisitPrompt, buildRepairPrompt } from './prompts.js';
import { parseSummaryText, SummaryValidationError } from './parse.js';
import { config } from '../config.js';

export async function generatePreVisitSummary(symptomForm) {
  const { system, user } = buildPreVisitPrompt(symptomForm);
  // The configured model may spend tokens on hidden reasoning before the
  // JSON answer (observed ~100-150 reasoning tokens on Groq's
  // openai/gpt-oss-120b). Was 1024 when the schema had 3 fields; raised to
  // 1536 (matching post-visit's budget) now that the schema has 6 fields,
  // including two synthesised strings and a 2-4 item array, so a real
  // answer never gets cut off mid-response.
  const callOpts = { system, maxTokens: 1536, timeoutMs: config.llm.timeoutMs };

  const first = await callModel({ ...callOpts, user });

  try {
    const content = parseSummaryText(first.text, symptomForm);
    return { content, raw: first.text, model: first.model, promptVersion: PROMPT_VERSION };
  } catch (err) {
    if (!(err instanceof SummaryValidationError)) throw err;

    const repairUser = buildRepairPrompt(user, first.text, err.message);
    const second = await callModel({ ...callOpts, user: repairUser });
    // No catch here by design: a second validation failure is the give-up
    // case, and SummaryValidationError propagates to the caller unchanged.
    const content = parseSummaryText(second.text, symptomForm);
    return { content, raw: second.text, model: second.model, promptVersion: PROMPT_VERSION };
  }
}
