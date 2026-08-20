/**
 * Orchestrates one post-visit summary generation: call the model, validate
 * strictly (schema + hallucination gate), and on failure make exactly one
 * repair attempt before giving up. Mirrors llm/pre-visit.js's shape - same
 * retry policy, same "giving up is a normal outcome" contract.
 */
import { callModel } from './client.js';
import { POST_VISIT_PROMPT_VERSION, buildPostVisitPrompt, buildRepairPrompt } from './prompts.js';
import { parsePostVisitSummaryText, SummaryValidationError } from './parse.js';
import { config } from '../config.js';

export async function generatePostVisitSummary({ clinicalNotes, diagnosis, prescriptions }) {
  const { system, user } = buildPostVisitPrompt({ clinicalNotes, diagnosis, prescriptions });
  // Larger schema than pre-visit (a medicationSchedule array plus two more
  // string-array fields), so the budget is higher - same reasoning-model
  // headroom logic as pre-visit.js.
  const callOpts = { system, maxTokens: 1536, timeoutMs: config.llm.timeoutMs };

  const first = await callModel({ ...callOpts, user });

  try {
    const content = parsePostVisitSummaryText(first.text, prescriptions);
    return { content, raw: first.text, model: first.model, promptVersion: POST_VISIT_PROMPT_VERSION };
  } catch (err) {
    if (!(err instanceof SummaryValidationError)) throw err;

    const repairUser = buildRepairPrompt(user, first.text, err.message);
    const second = await callModel({ ...callOpts, user: repairUser });
    // No catch here by design: a second validation failure (including a
    // second hallucination) is the give-up case.
    const content = parsePostVisitSummaryText(second.text, prescriptions);
    return { content, raw: second.text, model: second.model, promptVersion: POST_VISIT_PROMPT_VERSION };
  }
}
