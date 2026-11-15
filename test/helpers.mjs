// A fetch mock: queue responses, record requests. No network.
export function mockFetch(...responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: new URL(url), init, headers: new Headers(init.headers) });
    const next = responses.shift();
    if (!next) throw new Error('mockFetch: no more responses queued');
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(url, init);
    const { status = 200, body = {}, headers = {} } = next;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  };
  fn.calls = calls;
  return fn;
}
