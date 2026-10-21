// The fake model of the end-to-end tests: one local HTTP server that speaks a tool's own protocol and plays one scripted
// session. It keeps no state: a request's step is the number of actions the assistant already took in it, so retries, restarts
// and parallel side requests cannot put it out of step. Every request is kept, decoded, for the assertions.
import http from 'node:http';

// Every string in a request body, so a text is found whatever the channel (system, tool result, reminder) or the escaping.
export const strings = v => (typeof v === 'string' ? v : v && typeof v === 'object' ? Object.values(v).map(strings).join('\n') : '');

// A tool's required arguments, filled by name from its own schema; `values` names them by role.
const ROLES = { path: /^(file_path|path|filePath|Path|TargetFile)$/, content: /^(content|file_text|file_content|new_text|Content)$/, old: /^(old_string|oldString|old_str|old_text|before|Target)$/, new: /^(new_string|newString|new_str|after|Replacement)$/, command: /^(command|cmd|CommandLine)$/, prompt: /^(prompt|message|task)$/, description: /^description$/ };
export function args(schema, values) {
  const out = {};
  for (const [k, p] of Object.entries(schema?.properties || {})) {
    const role = Object.keys(ROLES).find(r => ROLES[r].test(k));
    if (role && values[role] != null) out[k] = values[role];
    else if (values[k] != null) out[k] = values[k];
    else if (schema.required?.includes(k)) out[k] = p.enum ? p.enum.find(e => /^low$/i.test(e)) ?? p.enum[0] : { boolean: false, number: 0, integer: 0 }[p.type] ?? '';
  }
  return out;
}

// One protocol: `decode(body)` gives the tools offered, the assistant's actions so far, the first user message and each tool
// result; `answer(res, act, body)` sends one step, a tool call or a text reply, streamed when the request asks for it.
const PROTOCOLS = {
  anthropic: {
    route: /\/v1\/messages$/,
    decode(b) {
      const msgs = b.messages || [], blocks = m => (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content || []);
      return {
        offered: (b.tools || []).map(t => ({ name: t.name, schema: t.input_schema })),
        actions: msgs.filter(m => m.role === 'assistant').reduce((n, m) => n + Math.max(1, blocks(m).filter(c => c.type === 'tool_use').length), 0),
        firstUser: strings(msgs.find(m => m.role === 'user')?.content),
        results: msgs.flatMap(blocks).filter(c => c.type === 'tool_result').map(c => ({ id: c.tool_use_id, text: strings(c.content) })),
      };
    },
    answer(res, act, b) {
      const block = act.call ? { type: 'tool_use', id: act.id, name: act.call, input: act.args } : { type: 'text', text: act.reply };
      const stop = act.call ? 'tool_use' : 'end_turn', usage = { input_tokens: 10, output_tokens: 5 }, message = { id: `msg_${act.id}`, type: 'message', role: 'assistant', model: b.model || 'fake', stop_sequence: null };
      if (!b.stream) return send(res, 'application/json', JSON.stringify({ ...message, content: [block], stop_reason: stop, usage }));
      const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
      send(res, 'text/event-stream', [
        ev('message_start', { message: { ...message, content: [], stop_reason: null, usage } }),
        ev('content_block_start', { index: 0, content_block: act.call ? { ...block, input: {} } : { ...block, text: '' } }),
        ev('content_block_delta', { index: 0, delta: act.call ? { type: 'input_json_delta', partial_json: JSON.stringify(act.args) } : { type: 'text_delta', text: act.reply } }),
        ev('content_block_stop', { index: 0 }),
        ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage }),
        ev('message_stop', {}),
      ].join(''));
    },
  },
};
const send = (res, type, body) => (res.writeHead(200, { 'content-type': type }), res.end(body));

// What one request gets. A subagent's request starts with the marker; one that does not offer the write tool is a side request
// (a title, a summary). The main conversation plays `steps`, then gets the last reply again.
function plan(adapter, steps, d) {
  if (/SUBTASK:/.test(d.firstUser)) return { reply: 'done' };
  if (!d.offered.some(t => t.name === adapter.tools.write)) return { reply: 'ok' };
  const step = steps[d.actions] ?? steps.findLast(s => s.reply), id = `call_${d.actions}`;
  if (step.reply) return { reply: step.reply, id, main: true };
  const tool = d.offered.find(t => t.name === adapter.tools[step.tool]);
  if (!tool) throw new Error(`${adapter.tools[step.tool]} not offered; offered: ${d.offered.map(t => t.name).join(', ')}`);
  return { call: tool.name, args: args(tool.schema, { ...step, ...adapter.args?.[step.tool] }), id, main: true };
}

export function start(adapter, steps) {
  const p = PROTOCOLS[adapter.protocol], requests = [], connects = [], unknown = [], errors = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c)).on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8'), at = new URL(req.url, 'http://fake').pathname;
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* not JSON: an unknown route */ }
      try {
        if (req.method === 'POST' && /\/count_tokens$/.test(at)) return send(res, 'application/json', '{"input_tokens":100}');
        if (req.method === 'POST' && p.route.test(at)) {
          const d = p.decode(body), act = plan(adapter, steps, d);
          requests.push({ ...d, main: !!act.main, step: d.actions, act, text: strings(body) });
          return p.answer(res, act, body);
        }
      } catch (e) {
        errors.push(String(e.message || e));
        return (res.writeHead(500), res.end());
      }
      unknown.push(`${req.method} ${at}`);
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":{"type":"not_found"}}');
    });
  });
  // Any CONNECT is a try to reach the internet: refused and kept.
  server.on('connect', (req, socket) => (connects.push(req.url), socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')));
  server.on('clientError', (e, socket) => socket.destroy());
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, requests, connects, unknown, errors,
    close: () => new Promise(r => (server.closeAllConnections(), server.close(r))),
  })));
}
