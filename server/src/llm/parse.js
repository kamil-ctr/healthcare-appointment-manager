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

const REQUIRED_SCHEDULE_FIELDS = ['medication', 'dose', 'when', 'duration'];

/**
 * Strict validation of the post-visit summary, PLUS a hard hallucination
 * gate: every medicationSchedule entry must correspond 1:1 (by normalised
 * name) to a row actually prescribed for this appointment, and every
 * prescribed medication must appear. A summary that invents a drug the
 * patient was never given, silently drops one they ARE on, or renames one,
 * is actively dangerous - a patient reading it might take it as
 * authoritative. That failure mode is worse than no summary at all, so it
 * is treated exactly like a schema violation: one repair attempt, named
 * with the specific discrepancy, then the row is marked 'failed' and the
 * UI falls back to the doctor's raw notes + the real prescription list.
 */
export function parsePostVisitSummaryText(text, prescriptions) {
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
  if (typeof json.summary !== 'string' || json.summary.trim() === '') {
    throw new SummaryValidationError('summary must be a non-empty string.');
  }
  if (!Array.isArray(json.medicationSchedule)) {
    throw new SummaryValidationError('medicationSchedule must be an array.');
  }
  json.medicationSchedule.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new SummaryValidationError(`medicationSchedule[${i}] must be an object.`);
    }
    for (const field of REQUIRED_SCHEDULE_FIELDS) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
        throw new SummaryValidationError(`medicationSchedule[${i}].${field} must be a non-empty string.`);
      }
    }
  });
  if (
    !Array.isArray(json.followUpSteps) ||
    json.followUpSteps.some((s) => typeof s !== 'string' || s.trim() === '')
  ) {
    throw new SummaryValidationError('followUpSteps must be an array of non-empty strings (may be empty array).');
  }
  if (
    !Array.isArray(json.whenToSeekHelp) ||
    json.whenToSeekHelp.some((s) => typeof s !== 'string' || s.trim() === '')
  ) {
    throw new SummaryValidationError('whenToSeekHelp must be an array of non-empty strings (may be empty array).');
  }

  // --- Hallucination check: hard gate, not a warning ---
  const normalise = (s) => String(s ?? '').trim().toLowerCase();
  const prescribedNames = new Set((prescriptions ?? []).map((p) => normalise(p.medicationName)));
  const returnedNames = new Set(json.medicationSchedule.map((e) => normalise(e.medication)));

  const invented = [...returnedNames].filter((n) => !prescribedNames.has(n));
  const missing = [...prescribedNames].filter((n) => !returnedNames.has(n));

  if (invented.length > 0 || missing.length > 0) {
    const parts = [];
    if (invented.length > 0) parts.push(`medication(s) not actually prescribed: ${invented.join(', ')}`);
    if (missing.length > 0) parts.push(`prescribed medication(s) missing from medicationSchedule: ${missing.join(', ')}`);
    throw new SummaryValidationError(
      `medicationSchedule does not match the prescriptions for this appointment exactly - ${parts.join('; ')}. ` +
        `Use the EXACT medication names from <prescriptions>, one entry per prescribed medication, no others.`
    );
  }

  return {
    summary: json.summary.trim(),
    medicationSchedule: json.medicationSchedule.map((e) => ({
      medication: e.medication.trim(),
      dose: e.dose.trim(),
      when: e.when.trim(),
      duration: e.duration.trim(),
    })),
    followUpSteps: json.followUpSteps.map((s) => s.trim()),
    whenToSeekHelp: json.whenToSeekHelp.map((s) => s.trim()),
  };
}
