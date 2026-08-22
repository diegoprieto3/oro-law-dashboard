exports.handler = async function(event, context) {
  const VAPI_API_KEY = 'e19f3aaf-e171-4e14-80c4-57c4139328e7';
  const ASSISTANT_ID = '0a5a9bda-0fb1-4021-88ca-70beb1ccf4d8';
  const SUPABASE_URL = 'https://haxozjahcnktbliephdx.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhheG96amFoY25rdGJsaWVwaGR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMjgwMzIsImV4cCI6MjA5NzgwNDAzMn0.f5hw4q11wtPeTU6A21xaX9qJdCkFdMWZ1qCKOrwaeZE';
  try {
    // limit=1000, not 100 — a lower limit silently drops older calls from
    // ever being archived once monthly volume exceeds it.
    const res = await fetch(`https://api.vapi.ai/call?limit=1000&assistantId=${ASSISTANT_ID}`, {
      headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` }
    });
    if (!res.ok) throw new Error('Vapi fetch failed: ' + res.status);
    const data = await res.json();
    const calls = Array.isArray(data) ? data : (data.results || data.calls || []);
    for (const c of calls) {
      const detailRes = await fetch(`https://api.vapi.ai/call/${c.id}`, {
        headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` }
      });
      const detail = detailRes.ok ? await detailRes.json() : c;
      const msgs = detail.artifact?.messages || detail.messages || [];
      const transcript = detail.artifact?.transcript || '';
      const structuredOutputs = detail.artifact?.structuredOutputs || {};
      function getStructuredValue(name) {
        const entry = Object.values(structuredOutputs).find(o => o && o.name === name);
        return entry ? entry.result : null;
      }
      const callerName = getStructuredValue('caller_name');
      const callReason = getStructuredValue('reason_for_call');
      const summary = getStructuredValue('call_summary');
      const structuredCallerNumber = getStructuredValue('caller_number');
      let dur = detail.duration || detail.durationSeconds || 0;
      if (!dur && detail.startedAt && detail.endedAt) {
        dur = Math.round((new Date(detail.endedAt) - new Date(detail.startedAt)) / 1000);
      }
      // Every field below has an explicit fallback (never bare `undefined`) —
      // JSON.stringify silently drops undefined keys, which makes a batch
      // insert's objects have mismatched shapes and fails the WHOLE batch
      // with Supabase's "All object keys must match" error.
      const record = {
        id: detail.id || null,
        assistant_id: detail.assistantId || ASSISTANT_ID,
        caller_number: structuredCallerNumber || detail.customer?.number || detail.phoneNumber || null,
        caller_name: callerName || null,
        duration: Math.round(dur) || 0,
        started_at: detail.startedAt || detail.createdAt || null,
        ended_at: detail.endedAt || null,
        recording_url: detail.artifact?.recordingUrl || detail.recordingUrl || null,
        summary: summary || detail.artifact?.summary || detail.summary || null,
        end_reason: detail.endedReason || detail.status || null,
        transcript: typeof transcript === 'string' ? transcript : JSON.stringify(msgs),
        call_reason: callReason || null
      };
      await fetch(`${SUPABASE_URL}/rest/v1/calls`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(record)
      });
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, synced: calls.length })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
