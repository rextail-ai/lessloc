// The fake model of the end-to-end tests: one local HTTP server that speaks a tool's own protocol and plays one scripted
// session. It keeps no state: a request's step is the number of actions the assistant already took in it, so retries, restarts
// and parallel side requests cannot put it out of step. Every request is kept, decoded, for the assertions.
import http from 'node:http';

// Every string in a request body, so a text is found whatever the channel (system, tool result, reminder) or the escaping.
export const strings = v => (typeof v === 'string' ? v : v && typeof v === 'object' ? Object.values(v).map(strings).join('\n') : '');

// A tool's required arguments, filled by name from its own schema; `values` names them by role. A name may have two roles
// (Cline's new_text is a new file's content and an edit's new text): it takes the one the step gives. A list takes the value as
// its one item, and a list of objects (Pi's `edits`) gets one, filled the same way.
const ROLES = { path: /^(file_path|path|filePath|Path|TargetFile|filename)$/, content: /^(content|file_text|file_content|new_text|Content)$/, old: /^(old_string|oldString|old_str|old_text|oldText|before|Target|search)$/, new: /^(new_string|newString|new_str|new_text|newText|after|Replacement|replace)$/, command: /^(commands?|cmd|CommandLine)$/, prompt: /^(prompt|message|task)$/, description: /^description$/, reply: /^solution_summary$/ };
export function args(schema, values) {
  const out = {};
  for (const [k, p] of Object.entries(schema?.properties || {})) {
    const role = Object.keys(ROLES).find(r => ROLES[r].test(k) && values[r] != null);
    if (role) out[k] = p.type === 'array' ? [values[role]] : values[role];
    else if (values[k] != null) out[k] = values[k];
    else if (schema.required?.includes(k)) out[k] = p.items?.properties ? [args(p.items, values)] : p.enum ? p.enum.find(e => /^low$/i.test(e)) ?? p.enum[0] : { boolean: false, number: 0, integer: 0 }[p.type] ?? '';
  }
  return out;
}

// One protocol: `decode(body)` gives the tools offered, the assistant's actions so far, the first user message and each tool
// result; `answer(res, act, body, path)` sends one step, a tool call or a text reply, streamed when the request asks for it.
const sse = events => events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`).join('');
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
      send(res, 'text/event-stream', sse([
        ['message_start', { message: { ...message, content: [], stop_reason: null, usage } }],
        ['content_block_start', { index: 0, content_block: act.call ? { ...block, input: {} } : { ...block, text: '' } }],
        ['content_block_delta', { index: 0, delta: act.call ? { type: 'input_json_delta', partial_json: JSON.stringify(act.args) } : { type: 'text_delta', text: act.reply } }],
        ['content_block_stop', { index: 0 }],
        ['message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage }],
        ['message_stop', {}],
      ]));
    },
  },
  // OpenAI Responses (Codex). A tool of type `custom` takes free text, Codex's apply_patch among them.
  responses: {
    route: /\/responses$/,
    decode(b) {
      const items = Array.isArray(b.input) ? b.input : [];
      return {
        offered: (b.tools || []).map(t => ({ name: t.name ?? t.type, schema: t.parameters, custom: t.type === 'custom' })),
        actions: items.filter(i => /^(function_call|custom_tool_call|local_shell_call)$/.test(i.type) || (i.type === 'message' && i.role === 'assistant')).length,
        firstUser: strings(items.find(i => i.role === 'user')?.content),
        results: items.filter(i => /_call_output$/.test(i.type)).map(i => ({ id: i.call_id, text: strings(i.output) })),
      };
    },
    answer(res, act, b) {
      const item = !act.call ? { type: 'message', id: `msg_${act.id}`, role: 'assistant', content: [{ type: 'output_text', text: act.reply, annotations: [] }] }
        : typeof act.args === 'string' ? { type: 'custom_tool_call', id: `ctc_${act.id}`, call_id: act.id, name: act.call, input: act.args, status: 'completed' }
          : { type: 'function_call', id: `fc_${act.id}`, call_id: act.id, name: act.call, arguments: JSON.stringify(act.args) };
      const usage = { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 15 };
      const response = { id: `resp_${act.id}`, object: 'response', created_at: 0, model: b.model || 'fake', status: 'in_progress', output: [] }, done = { ...response, status: 'completed', output: [item], usage };
      if (!b.stream) return send(res, 'application/json', JSON.stringify(done));
      send(res, 'text/event-stream', sse([
        ['response.created', { response }],
        ['response.output_item.added', { output_index: 0, item: act.call ? item : { ...item, content: [] } }],
        ...(act.call ? [] : [['response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: act.reply }]]),
        ['response.output_item.done', { output_index: 0, item }],
        ['response.completed', { response: done }],
      ]));
    },
  },
  // OpenAI Chat Completions, the protocol most tools speak to a provider of the user's own. `info` is a LiteLLM proxy's model
  // list, which a tool's LiteLLM provider reads first (Junie's runs only a model it names).
  chat: {
    route: /\/chat\/completions$/,
    info: model => ({ data: [{ model_name: model, litellm_params: { model: `openai/${model}` }, model_info: { mode: 'chat', supports_function_calling: true } }] }),
    decode(b) {
      const msgs = b.messages || [];
      return {
        offered: (b.tools || []).map(t => ({ name: t.function?.name, schema: t.function?.parameters })),
        actions: msgs.filter(m => m.role === 'assistant').reduce((n, m) => n + Math.max(1, m.tool_calls?.length || 0), 0),
        firstUser: strings(msgs.find(m => m.role === 'user')?.content),
        results: msgs.filter(m => m.role === 'tool').map(m => ({ id: m.tool_call_id, text: strings(m.content) })),
        stream: !!b.stream, said: msgs.filter(m => m.role === 'assistant').map(m => strings(m.content)),
      };
    },
    answer(res, act, b) {
      const call = act.call && [{ index: 0, id: act.id, type: 'function', function: { name: act.call, arguments: JSON.stringify(act.args) } }];
      const head = { id: `chatcmpl_${act.id}`, created: 0, model: b.model || 'fake' }, finish = act.call ? 'tool_calls' : 'stop', usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
      if (!b.stream) return send(res, 'application/json', JSON.stringify({ ...head, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: act.reply ?? null, ...(call && { tool_calls: call }) }, finish_reason: finish }], usage }));
      const chunk = o => `data: ${JSON.stringify({ ...head, object: 'chat.completion.chunk', ...o })}\n\n`;
      send(res, 'text/event-stream', [
        chunk({ choices: [{ index: 0, delta: { role: 'assistant', ...(call ? { tool_calls: call } : { content: act.reply }) }, finish_reason: null }] }),
        chunk({ choices: [{ index: 0, delta: {}, finish_reason: finish }] }),
        b.stream_options?.include_usage ? chunk({ choices: [], usage }) : '',
        'data: [DONE]\n\n',
      ].join(''));
    },
  },
  // Gemini generateContent (Gemini CLI): `functionCall` parts out, `functionResponse` parts back with the call's id; streamed
  // when the route says so.
  gemini: {
    route: /\/models\/[^/:]+:(stream)?[gG]enerateContent$/,
    decode(b) {
      const contents = b.contents || [], parts = c => c.parts || [];
      return {
        offered: (b.tools || []).flatMap(t => t.functionDeclarations || []).map(f => ({ name: f.name, schema: f.parametersJsonSchema ?? f.parameters })),
        // Antigravity sends the function responses back as the model's own content: they are no action of the model.
        actions: contents.filter(c => c.role === 'model' && !parts(c).some(p => p.functionResponse)).reduce((n, c) => n + Math.max(1, parts(c).filter(p => p.functionCall).length), 0),
        firstUser: strings(contents.find(c => c.role === 'user')?.parts),
        results: contents.flatMap(parts).filter(p => p.functionResponse).map(p => ({ id: p.functionResponse.id, text: strings(p.functionResponse.response) })),
      };
    },
    answer(res, act, b, at) {
      const part = act.call ? { functionCall: { id: act.id, name: act.call, args: act.args } } : { text: act.reply };
      const done = JSON.stringify({ candidates: [{ content: { role: 'model', parts: [part] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }, modelVersion: 'fake' });
      if (!at.endsWith(':streamGenerateContent')) return send(res, 'application/json', done);
      send(res, 'text/event-stream', `data: ${done}\n\n`);
    },
  },
};
const send = (res, type, body) => (res.writeHead(200, { 'content-type': type }), res.end(body));

// What one request gets. A subagent's request starts with the marker; one that does not offer the write tool is a side request
// (a title, a summary). The main conversation plays `steps`, then gets the last reply again. A tool whose turn ends only with a
// tool call (Junie's submit) names it as its `reply` tool, and each reply is a call of it. A tool whose model is offered no tools
// (Aider) takes each step as a reply's text (adapter.text): its main requests are the streamed ones (its commit messages are
// not), and its actions are the script's own replies among what the assistant said.
const replies = (adapter, steps, d) => (adapter.tools.write ? d : { ...d, actions: d.said.filter(x => steps.some(s => x === (s.reply ?? adapter.text(s)))).length });
function plan(adapter, steps, d) {
  if (/SUBTASK:/.test(d.firstUser)) return { reply: 'done' };
  if (adapter.tools.write ? !d.offered.some(t => t.name === adapter.tools.write) : !d.stream) return { reply: 'ok' };
  const step = steps[d.actions] ?? steps.findLast(s => s.reply), id = `call_${d.actions}`, kind = step.tool ?? 'reply';
  if (!adapter.tools.write) return { reply: step.reply ?? adapter.text(step), id, main: true };
  if (step.reply && !adapter.tools.reply) return { reply: step.reply, id, main: true };
  const tool = d.offered.find(t => t.name === adapter.tools[kind]);
  if (!tool) throw new Error(`${adapter.tools[kind]} not offered; offered: ${d.offered.map(t => t.name).join(', ')}`);
  return { call: tool.name, args: tool.custom ? adapter.text(step) : args(tool.schema, { ...step, ...adapter.args?.[kind] }), id, main: true };
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
        // The model list a tool reads at start (goose).
        if (req.method === 'GET' && /\/v1\/models$/.test(at)) return send(res, 'application/json', '{"object":"list","data":[{"id":"fake-model","object":"model","owned_by":"fake"}]}');
        if (req.method === 'GET' && p.info && /\/model\/info$/.test(at)) return send(res, 'application/json', JSON.stringify(p.info(adapter.model)));
        if (req.method === 'POST' && p.route.test(at)) {
          const d = replies(adapter, steps, p.decode(body)), act = plan(adapter, steps, d);
          requests.push({ ...d, main: !!act.main, step: d.actions, act, text: strings(body) });
          return p.answer(res, act, body, at);
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
  server.on('connect', (req, socket) => (connects.push(req.url), socket.on('error', () => {}).end('HTTP/1.1 403 Forbidden\r\n\r\n')));
  server.on('clientError', (e, socket) => socket.destroy());
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, requests, connects, unknown, errors,
    close: () => new Promise(r => (server.closeAllConnections(), server.close(r))),
  })));
}
