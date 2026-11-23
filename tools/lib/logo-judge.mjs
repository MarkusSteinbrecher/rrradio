/**
 * The one model call in the logo-fill rule (ADR 002, rule 9): a yes / no /
 * unsure on icons the deterministic finder already vetted. Twenty small
 * tiles per request, each labelled in text, so a station costs a fraction of
 * a cent — against one browsing agent per station in the June sweeps.
 *
 * The judge never searches and never picks between candidates. It answers
 * one question — "is this picture this station's brand mark?" — and only a
 * `yes` is ever applied (tools/lib/health-policy.mjs, rule 9).
 */

import Anthropic from '@anthropic-ai/sdk';

export const JUDGE_MODEL = 'claude-haiku-5-5';
export const JUDGE_BATCH = 20;

const SYSTEM = `You check candidate logos for an internet-radio catalog. Each item is a radio station (name, country, website) followed by one image taken from that station's own website, shown on the dark background the app uses.

For every item decide whether the image is that station's logo or brand mark.

Answer "yes" when the image is a designed brand mark that fits the station: it shows the station's name, initials, frequency or call sign, or it is a distinctive emblem that a station of that name would plausibly use. The mark of the parent broadcaster or network also counts (a sub-channel often has no mark of its own).

Answer "no" when the image is something else: generic clip-art (a plain microphone, headphones, a play button, a musical note, a globe, a house), the default icon of a website builder, hosting panel, CMS or streaming provider, a photograph, a banner or advert, a screenshot, a blank or broken image, or the brand of a clearly different organisation.

Answer "unsure" when you cannot tell. A wrong logo in the catalog is worse than a missing one, so do not guess.

Shape and size do not matter: a wide wordmark that is the right brand is a "yes".`;

const SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer', description: 'The item number.' },
          verdict: { type: 'string', enum: ['yes', 'no', 'unsure'] },
          why: { type: 'string', description: 'At most ten words.' },
        },
        required: ['n', 'verdict', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
};

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);

/**
 * The user turn for one batch: a text label, then the tile, per item.
 * @param {Array<{name: string, country?: string, site?: string, tile: Buffer}>} items
 */
export function buildJudgeContent(items) {
  const content = [];
  items.forEach((item, i) => {
    content.push({ type: 'text', text: `Item ${i + 1}: "${clean(item.name)}" · ${clean(item.country) || 'country unknown'} · ${clean(item.site) || 'no website'}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: item.tile.toString('base64') } });
  });
  content.push({ type: 'text', text: `Give one verdict for each of the ${items.length} items, numbered as above.` });
  return content;
}

/**
 * Model text → one verdict per item. Anything missing, duplicated or
 * malformed is `null` (not judged), never a guess.
 * @param {string} text
 * @param {number} count
 * @returns {Array<{verdict: 'yes'|'no'|'unsure', why: string}|null>}
 */
export function parseVerdicts(text, count) {
  const out = new Array(count).fill(null);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return out;
  }
  const seen = new Set();
  for (const v of Array.isArray(data?.verdicts) ? data.verdicts : []) {
    const n = Number(v?.n);
    if (!Number.isInteger(n) || n < 1 || n > count || seen.has(n)) continue;
    if (v.verdict !== 'yes' && v.verdict !== 'no' && v.verdict !== 'unsure') continue;
    seen.add(n);
    out[n - 1] = { verdict: v.verdict, why: clean(v.why) };
  }
  return out;
}

/**
 * Judge a list of finds. Never throws: a failed batch leaves its items
 * unjudged (`null`), which the policy treats as "do nothing".
 *
 * @param {Array<{name: string, country?: string, site?: string, tile: Buffer}>} items
 * @param {{client?: {messages: {create: Function}}, model?: string, log?: (msg: string) => void}} [opts]
 * @returns {Promise<{verdicts: Array<{verdict: string, why: string}|null>, usage: {input: number, output: number}, failed: number}>}
 */
export async function judgeLogos(items, { client = new Anthropic(), model = JUDGE_MODEL, log = () => {} } = {}) {
  const verdicts = [];
  const usage = { input: 0, output: 0 };
  let failed = 0;
  for (let i = 0; i < items.length; i += JUDGE_BATCH) {
    const batch = items.slice(i, i + JUDGE_BATCH);
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 8000,
        system: SYSTEM,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: buildJudgeContent(batch) }],
      });
      usage.input += response.usage?.input_tokens ?? 0;
      usage.output += response.usage?.output_tokens ?? 0;
      if (response.stop_reason !== 'end_turn') throw new Error(`stop_reason ${response.stop_reason}`);
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      verdicts.push(...parseVerdicts(text, batch.length));
    } catch (err) {
      failed += 1;
      const what = err instanceof Anthropic.APIError ? `API ${err.status ?? '?'}` : String(err?.message ?? err).slice(0, 80);
      log(`judge batch ${i / JUDGE_BATCH + 1} failed (${what}) — ${batch.length} find(s) left unjudged`);
      verdicts.push(...new Array(batch.length).fill(null));
    }
  }
  return { verdicts, usage, failed };
}
