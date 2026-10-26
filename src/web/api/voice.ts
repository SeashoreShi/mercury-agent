import { Hono } from 'hono';
import { voiceFeed, VOICE_ACTIONS, type VoiceAction } from '../../plugins/voice-feed.js';

/**
 * Live voice (Optimus) for clients:
 *   GET  /api/voice          current session state and transcript
 *   GET  /api/voice/events   SSE: `state` and `turn` events (snapshot first)
 *   POST /api/voice/control  { action: mute | unmute | interrupt | stop }
 * Owner-authenticated like every /api route.
 */
const voice = new Hono();

voice.get('/api/voice', (c) => c.json(voiceFeed.snapshot()));

voice.get('/api/voice/events', (c) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* client gone */ }
      };
      send('state', voiceFeed.snapshot());
      const unsubscribe = voiceFeed.subscribe((ev) => {
        if (ev.type === 'turn' && ev.turn) send('turn', ev.turn);
        // Turns travel on their own; state events stay small.
        else send('state', { ...ev.state, turns: undefined });
      });
      const keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch { clearInterval(keepalive); }
      }, 15000);
      c.req.raw.signal?.addEventListener('abort', () => { clearInterval(keepalive); unsubscribe(); });
    },
    cancel() {},
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
});

voice.post('/api/voice/control', async (c) => {
  const body = await c.req.json<{ action?: unknown }>().catch(() => ({} as { action?: unknown }));
  const action = body.action as VoiceAction;
  if (!VOICE_ACTIONS.includes(action)) return c.json({ error: `action must be one of ${VOICE_ACTIONS.join(', ')}` }, 400);
  if (!voiceFeed.control(action)) return c.json({ error: 'No voice session is running' }, 409);
  return c.json({ ok: true });
});

export default voice;
