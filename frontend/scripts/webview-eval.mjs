const port = process.env.QUEUER_DEBUG_PORT ?? '9222';
const args = process.argv.slice(2);
const reload = args.includes('--reload');
const expression = args.filter((arg) => arg !== '--reload').join(' ') || 'document.title';

let targets;
try {
  targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
} catch {
  console.error(`No WebView on port ${port}. Start the app with: npm run desktop:debug`);
  process.exit(1);
}
const page = targets.find((target) => target.type === 'page');
if (!page) {
  console.error('The window has no page yet.');
  process.exit(1);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 0;
const waiting = new Map();
socket.onmessage = (message) => {
  const data = JSON.parse(message.data);
  if (data.id && waiting.has(data.id)) {
    waiting.get(data.id)(data.result);
    waiting.delete(data.id);
  }
};
const call = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    waiting.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
await new Promise((resolve) => (socket.onopen = resolve));

if (reload) {
  await call('Page.reload', { ignoreCache: true });
  await new Promise((resolve) => setTimeout(resolve, 6000));
}
const result = await call('Runtime.evaluate', {
  expression,
  awaitPromise: true,
  returnByValue: true,
});
if (result.exceptionDetails) {
  console.error(result.exceptionDetails.exception?.description ?? 'Expression threw');
  process.exit(1);
}
const value = result.result?.value;
console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
process.exit(0);
