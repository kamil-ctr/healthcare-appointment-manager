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

// --- Information-loss gate: catches the model paraphrasing away the
// patient's own specifics (a duration, a severity number, a named
// symptom) even though the text passed schema validation cleanly. Only
// fires when the patient's own input actually contained something
// concrete to preserve - a genuinely vague complaint can't be faulted for
// producing a vague summary. See docs/llm-prompts.md for the rationale.
const GENERIC_MIN_LENGTH = 50;
const STOPWORDS = new Set([
  'the', 'and', 'with', 'from', 'this', 'that', 'have', 'has', 'been', 'were', 'was', 'for',
  'are', 'not', 'none', 'also', 'than', 'then', 'into', 'onto', 'over', 'under', 'about',
  'their', 'they', 'patient', 'reports', 'reported', 'presents', 'presenting',
]);

function extractConcreteWords(text) {
  return new Set(
    String(text ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
  );
}

function hasDigit(text) {
  return /\d/.test(String(text ?? ''));
}

function buildSourceText(symptomForm) {
  if (!symptomForm) return '';
  const severity = symptomForm.severity != null ? String(symptomForm.severity) : '';
  return [symptomForm.symptoms, symptomForm.duration, severity].filter(Boolean).join(' ');
}

function isSuspiciouslyGeneric(value, sourceText) {
  const sourceWords = extractConcreteWords(sourceText);
  const sourceHasDigit = hasDigit(sourceText);
  if (!sourceHasDigit && sourceWords.size === 0) return false; // nothing concrete in the source to lose

  const trimmed = String(value ?? '').trim();
  if (trimmed.length >= GENERIC_MIN_LENGTH) return false;
  if (hasDigit(trimmed)) return false;
  for (const w of extractConcreteWords(trimmed)) {
    if (sourceWords.has(w)) return false;
  }
  return true;
}

// --- Diagnosis guard: possibleConcernAreas must name general clinical
// attention categories ("musculoskeletal", "possible infection"), never a
// specific disease. This is a short, representative denylist, not an
// exhaustive medical taxonomy - it exists to catch the model naming an
// actual condition outright, not to be a clinical classifier.
const CONCERN_DENYLIST = [
  'appendicitis', 'pneumonia', 'bronchitis', 'asthma', 'copd', 'tuberculosis', 'covid',
  'influenza', 'diabetes', 'hypertension', 'stroke', 'heart attack', 'myocardial infarction',
  'migraine', 'epilepsy', 'meningitis', 'sepsis', 'cancer', 'tumor', 'tumour', 'fracture',
  'arthritis', 'osteoarthritis', 'gastritis', 'ulcer', 'hepatitis', 'kidney stone',
  'gallstone', 'urinary tract infection', 'pregnancy', 'depression', 'anxiety disorder',
  'hiv', 'aids',
];

function matchesDenylistedCondition(text) {
  const lower = String(text ?? '').toLowerCase();
  return CONCERN_DENYLIST.find((name) => lower.includes(name));
}

export function parseSummaryText(text, symptomForm) {
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
  if (typeof json.symptomTimeline !== 'string' || json.symptomTimeline.trim() === '') {
    throw new SummaryValidationError('symptomTimeline must be a non-empty string.');
  }
  if (typeof json.relevantHistory !== 'string' || json.relevantHistory.trim() === '') {
    throw new SummaryValidationError(
      'relevantHistory must be a non-empty string - state explicitly that nothing is relevant if that is the case.'
    );
  }
  if (
    !Array.isArray(json.possibleConcernAreas) ||
    json.possibleConcernAreas.length < 2 ||
    json.possibleConcernAreas.length > 4 ||
    json.possibleConcernAreas.some((a) => typeof a !== 'string' || a.trim() === '')
  ) {
    throw new SummaryValidationError('possibleConcernAreas must be an array of 2 to 4 non-empty strings.');
  }
  const denylisted = json.possibleConcernAreas.map(matchesDenylistedCondition).find(Boolean);
  if (denylisted) {
    throw new SummaryValidationError(
      `possibleConcernAreas must name general clinical attention categories, not a specific diagnosis - "${denylisted}" is a named condition. Use categories like "musculoskeletal" or "possible infection" instead.`
    );
  }
  if (
    !Array.isArray(json.suggestedQuestions) ||
    json.suggestedQuestions.length !== 3 ||
    json.suggestedQuestions.some((q) => typeof q !== 'string' || q.trim() === '')
  ) {
    throw new SummaryValidationError('suggestedQuestions must be an array of exactly 3 non-empty strings.');
  }

  const sourceText = buildSourceText(symptomForm);
  if (isSuspiciouslyGeneric(json.chiefComplaint, sourceText)) {
    throw new SummaryValidationError(
      "chiefComplaint is too generic - it dropped the patient's own specifics. Reflect at least one concrete detail from their words (a duration, a number, or a named symptom), not a vague paraphrase."
    );
  }
  if (isSuspiciouslyGeneric(json.symptomTimeline, sourceText)) {
    throw new SummaryValidationError(
      "symptomTimeline is too generic - it dropped the patient's own specifics. Reflect at least one concrete detail from their words (a duration, a number, or a named symptom), not a vague paraphrase."
    );
  }

  return {
    urgency: json.urgency,
    chiefComplaint: json.chiefComplaint.trim().slice(0, 120),
    symptomTimeline: json.symptomTimeline.trim(),
    relevantHistory: json.relevantHistory.trim(),
    possibleConcernAreas: json.possibleConcernAreas.map((a) => a.trim()),
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
