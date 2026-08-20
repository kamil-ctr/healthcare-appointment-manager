/**
 * Strict validation of the model's raw text output. Never trust the model:
 * every field is checked before it can reach ai_summaries.content. Thrown
 * errors are caught by the one-repair-then-give-up loop in pre-visit.js.
 */

export class SummaryValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SummaryValidationError';
  }
}

const URGENCY_VALUES = ['Low', 'Medium', 'High'];
const CODE_FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

function stripCodeFences(text) {
  const trimmed = text.trim();
  const match = trimmed.match(CODE_FENCE_RE);
  return match ? match[1].trim() : trimmed;
}

export function parseSummaryText(text) {
  const stripped = stripCodeFences(String(text ?? ''));

  let json;
  try {
    json = JSON.parse(stripped);
  } catch (err) {
    throw new SummaryValidationError(`Response was not valid JSON: ${err.message}`);
  }

  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new SummaryValidationError('Response JSON was not an object.');
  }
  if (!URGENCY_VALUES.includes(json.urgency)) {
    throw new SummaryValidationError(`urgency must be one of ${URGENCY_VALUES.join('/')}.`);
  }
  if (typeof json.chiefComplaint !== 'string' || json.chiefComplaint.trim() === '') {
    throw new SummaryValidationError('chiefComplaint must be a non-empty string.');
  }
  if (
    !Array.isArray(json.suggestedQuestions) ||
    json.suggestedQuestions.length !== 3 ||
    json.suggestedQuestions.some((q) => typeof q !== 'string' || q.trim() === '')
  ) {
    throw new SummaryValidationError('suggestedQuestions must be an array of exactly 3 non-empty strings.');
  }

  return {
    urgency: json.urgency,
    chiefComplaint: json.chiefComplaint.trim().slice(0, 120),
    suggestedQuestions: json.suggestedQuestions.map((q) => q.trim()),
  };
}
