import { describe, expect, it } from 'vitest';
import { buildJudgeContent, judgeLogos, JUDGE_BATCH, parseVerdicts } from './logo-judge.mjs';

const item = (name) => ({ name, country: 'DE', site: 'radio.example', tile: Buffer.from('png') });
const reply = (verdicts, extra = {}) => ({
  stop_reason: 'end_turn',
  usage: { input_tokens: 100, output_tokens: 20 },
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify({ verdicts }) }],
  ...extra,
});

describe('buildJudgeContent', () => {
  it('labels every tile in text, in order, and ends with the ask', () => {
    const content = buildJudgeContent([item('Radio\tOne'), item('Zwei')]);
    expect(content.map((b) => b.type)).toEqual(['text', 'image', 'text', 'image', 'text']);
    expect(content[0].text).toBe('Item 1: "Radio One" · DE · radio.example');
    expect(content[1].source).toEqual({ type: 'base64', media_type: 'image/png', data: Buffer.from('png').toString('base64') });
    expect(content[4].text).toContain('2 items');
  });
});

describe('parseVerdicts', () => {
  it('maps by item number and leaves gaps unjudged', () => {
    const text = JSON.stringify({ verdicts: [{ n: 2, verdict: 'no', why: 'generic  microphone' }, { n: 1, verdict: 'yes', why: 'name in mark' }, { n: 9, verdict: 'yes', why: '' }, { n: 1, verdict: 'no', why: 'dup' }] });
    expect(parseVerdicts(text, 3)).toEqual([{ verdict: 'yes', why: 'name in mark' }, { verdict: 'no', why: 'generic microphone' }, null]);
  });
  it('never guesses from malformed output', () => {
    expect(parseVerdicts('not json', 2)).toEqual([null, null]);
    expect(parseVerdicts('{"verdicts":[{"n":1,"verdict":"maybe","why":""}]}', 1)).toEqual([null]);
  });
});

describe('judgeLogos', () => {
  it('batches, sums usage, and asks the cheap model for JSON', async () => {
    const calls = [];
    const client = { messages: { create: async (req) => {
      calls.push(req);
      const n = req.messages[0].content.filter((b) => b.type === 'image').length;
      return reply(Array.from({ length: n }, (_, i) => ({ n: i + 1, verdict: 'yes', why: 'ok' })));
    } } };
    const items = Array.from({ length: JUDGE_BATCH + 3 }, (_, i) => item(`S${i}`));
    const out = await judgeLogos(items, { client });
    expect(calls).toHaveLength(2);
    expect(calls[0].model).toBe('claude-haiku-5-5');
    expect(calls[0].output_config.format.type).toBe('json_schema');
    expect(out.verdicts).toHaveLength(items.length);
    expect(out.verdicts.every((v) => v?.verdict === 'yes')).toBe(true);
    expect(out.usage).toEqual({ input: 200, output: 40 });
    expect(out.failed).toBe(0);
  });

  it('leaves a batch unjudged when the call fails or is cut short', async () => {
    let n = 0;
    const client = { messages: { create: async () => {
      n += 1;
      if (n === 1) throw new Error('boom');
      return reply([], { stop_reason: 'max_tokens' });
    } } };
    const logs = [];
    const out = await judgeLogos(Array.from({ length: JUDGE_BATCH + 1 }, (_, i) => item(`S${i}`)), { client, log: (m) => logs.push(m) });
    expect(out.verdicts.every((v) => v === null)).toBe(true);
    expect(out.failed).toBe(2);
    expect(logs).toHaveLength(2);
  });
});
