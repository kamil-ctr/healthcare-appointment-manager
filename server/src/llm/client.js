/**
 * Native-fetch client for the LLM provider's chat completions API
 * (Groq - OpenAI-compatible). No SDK - the dependency budget doesn't allow
 * one. A missing/failed call must never break booking or note submission:
 * callers are expected to catch LlmError and degrade gracefully (see
 * llm/pre-visit.js and jobs/ai-summaries.js).
 */
import { config } from '../config.js';

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/** kind: 'timeout' | 'rate_limit' | 'auth' | 'server' | 'malformed' */
export class LlmError extends Error {
  constructor(kind, message, cause) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
    this.cause = cause;
  }
}

function jitterMs(base) {
  return base + Math.floor(Math.random() * base);
}

async function postOnce({ system, user, maxTokens, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new LlmError('timeout', 'LLM request timed out.');
    throw new LlmError('server', `LLM request failed: ${err.message}`, err);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new LlmError('auth', `LLM authentication failed (HTTP ${res.status}).`);
  }
  if (res.status === 429) {
    throw new LlmError('rate_limit', 'LLM rate limit exceeded.');
  }
  if (res.status >= 500) {
    throw new LlmError('server', `LLM server error (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new LlmError('malformed', `LLM request rejected (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json().catch((err) => {
    throw new LlmError('malformed', `LLM response was not valid JSON: ${err.message}`);
  });

  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text === '') {
    throw new LlmError('malformed', 'LLM response had no message content.');
  }

  return { text, model: data.model, usage: data.usage };
}

/**
 * Single call to the model. Retries once on timeout/429/5xx with ~500ms
 * jitter; never retries 400/401/403 (those are not transient). Throws
 * LlmError('auth', ...) immediately, with no network call, if no API key is
 * configured - so a blank key degrades exactly like an auth failure would.
 */
export async function callModel({ system, user, maxTokens = 500, timeoutMs = config.llm.timeoutMs }) {
  if (!config.llm.apiKey) {
    throw new LlmError('auth', 'LLM_API_KEY is not configured.');
  }

  try {
    return await postOnce({ system, user, maxTokens, timeoutMs });
  } catch (err) {
    if (err instanceof LlmError && ['timeout', 'rate_limit', 'server'].includes(err.kind)) {
      await new Promise((resolve) => setTimeout(resolve, jitterMs(500)));
      return postOnce({ system, user, maxTokens, timeoutMs });
    }
    throw err;
  }
}
