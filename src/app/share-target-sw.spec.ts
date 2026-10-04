import { safeAppRoute } from './core/utils/notification-route.utils';

/**
 * The share-target worker is a plain script served straight from `public/`,
 * so it is fetched as Karma serves it and run against a fake `self`: the
 * listeners it registers are captured and called the way the browser would
 * call them. Nothing here registers a real worker.
 */

type Listener = (event: unknown) => void;

interface FakeClient {
  focus: jasmine.Spy<() => Promise<FakeClient>>;
  postMessage: jasmine.Spy<(message: unknown) => void>;
}

interface FakeClients {
  matchAll: jasmine.Spy<(options: unknown) => Promise<FakeClient[]>>;
  openWindow: jasmine.Spy<(url: string) => Promise<null>>;
  claim: jasmine.Spy<() => Promise<void>>;
}

interface FakeSelf {
  addEventListener(type: string, listener: Listener): void;
  skipWaiting: jasmine.Spy<() => Promise<void>>;
  clients: FakeClients;
}

interface WorkerRun {
  listeners: Map<string, Listener>;
  clients: FakeClients;
}

let workerSource: string;

function runWorker(windowClients: FakeClient[]): WorkerRun {
  const listeners = new Map<string, Listener>();
  const clients: FakeClients = {
    matchAll: jasmine.createSpy('matchAll').and.resolveTo(windowClients),
    openWindow: jasmine.createSpy('openWindow').and.resolveTo(null),
    claim: jasmine.createSpy('claim').and.resolveTo(),
  };
  const self: FakeSelf = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    skipWaiting: jasmine.createSpy('skipWaiting').and.resolveTo(),
    clients,
  };
  // The worker reads `self` as a free variable; a function parameter of that
  // name shadows the page's own `self` for the whole script.
  const evaluate = new Function('self', workerSource) as (self: FakeSelf) => void;
  evaluate(self);
  return { listeners, clients };
}

function listener(worker: WorkerRun, type: string): Listener {
  const found = worker.listeners.get(type);
  if (!found) throw new Error(`the worker registers no ${type} listener`);
  return found;
}

/**
 * A rejected promise that already has a handler. The evaluated worker awaits
 * natively, which attaches its own handler a microtask after zone.js has
 * looked for unhandled rejections, so a bare `Promise.reject` is logged as
 * unhandled even though the worker catches it.
 */
function rejection(error: Error): Promise<never> {
  const rejected = Promise.reject(error);
  rejected.catch(() => undefined);
  return rejected;
}

/** A tab that records the order its methods are called in. */
function openTab(calls: string[], refuseFocus?: () => Promise<never>): FakeClient {
  const tab: FakeClient = {
    focus: jasmine.createSpy('focus').and.callFake(() => {
      calls.push('focus');
      return refuseFocus ? refuseFocus() : Promise.resolve(tab);
    }),
    postMessage: jasmine.createSpy('postMessage').and.callFake(() => {
      calls.push('postMessage');
    }),
  };
  return tab;
}

/** Click a notification carrying `data`, resolving once the worker's work settles. */
async function tap(worker: WorkerRun, data: unknown): Promise<jasmine.Spy> {
  const close = jasmine.createSpy('close');
  const held: { work?: Promise<unknown> } = {};
  listener(worker, 'notificationclick')({
    notification: { data, close },
    waitUntil: (promise: Promise<unknown>) => {
      held.work = promise;
    },
  });
  if (!held.work) throw new Error('the click handler never called waitUntil');
  await held.work;
  return close;
}

describe('share-target-sw.js', () => {
  beforeAll(async () => {
    const response = await fetch('/share-target-sw.js');
    expect(response.ok).withContext('Karma serves public/share-target-sw.js').toBeTrue();
    workerSource = await response.text();
  });

  describe('a tap on a notification', () => {
    it('focuses the open tab, then tells it the route', async () => {
      const calls: string[] = [];
      const tab = openTab(calls);
      const worker = runWorker([tab]);

      const close = await tap(worker, { route: '/dashboard?bill=rule-1' });

      expect(close).toHaveBeenCalledTimes(1);
      expect(calls).toEqual(['focus', 'postMessage']);
      expect(tab.postMessage).toHaveBeenCalledOnceWith({
        type: 'notification-route',
        route: '/dashboard?bill=rule-1',
      });
      expect(worker.clients.openWindow).not.toHaveBeenCalled();
      expect(worker.clients.matchAll).toHaveBeenCalledOnceWith({ type: 'window', includeUncontrolled: true });
    });

    it('opens the route when no tab is open', async () => {
      const worker = runWorker([]);

      await tap(worker, { route: '/budgets?tab=budgets' });

      expect(worker.clients.openWindow).toHaveBeenCalledOnceWith('/budgets?tab=budgets');
    });

    it('opens the route instead when the open tab refuses focus', async () => {
      // Chrome rejects focus() with InvalidAccessError when the click's user
      // activation is not attributed to it.
      const calls: string[] = [];
      const tab = openTab(calls, () => rejection(new DOMException('no activation', 'InvalidAccessError')));
      const worker = runWorker([tab]);

      await tap(worker, { route: '/dashboard?recap=2026-08-31' });

      expect(tab.focus).toHaveBeenCalledTimes(1);
      expect(tab.postMessage).not.toHaveBeenCalled();
      expect(worker.clients.openWindow).toHaveBeenCalledOnceWith('/dashboard?recap=2026-08-31');
    });

    it('falls back to / when the notification names no route', async () => {
      // A notification raised before routes were carried has no data at all.
      for (const data of [undefined, null, {}, { route: undefined }]) {
        const label = JSON.stringify(data) ?? 'undefined';
        const closed = runWorker([]);
        await tap(closed, data);
        expect(closed.clients.openWindow).withContext(label).toHaveBeenCalledOnceWith('/');

        const tab = openTab([]);
        await tap(runWorker([tab]), data);
        expect(tab.postMessage).withContext(label).toHaveBeenCalledOnceWith({ type: 'notification-route', route: '/' });
      }
    });

    it('opens exactly what safeAppRoute accepts and / for everything it refuses', async () => {
      // The worker cannot import the app's validator and carries a copy; this
      // table holds the two to the same answers.
      const accepted = ['/', '/dashboard?bill=rule-1', '/budgets?tab=budgets', '/dashboard?recap=2026-08-31'];
      const refused: unknown[] = [
        '',
        'dashboard',
        '//evil.example',
        '///evil.example',
        'https://evil.example',
        'javascript:alert(1)',
        'data:text/html,hi',
        '/\\evil.example',
        '/\t/evil.example',
        '/\n/evil.example',
        '/a\rb',
        '/a\u0000b',
        '/a\u007fb',
        '/a\u0085b',
        42,
        ['/dashboard'],
        { toString: () => '/dashboard' },
      ];

      for (const route of accepted) {
        expect(safeAppRoute(route)).withContext(route).toBe(route);
        const worker = runWorker([]);
        await tap(worker, { route });
        expect(worker.clients.openWindow).withContext(route).toHaveBeenCalledOnceWith(route);
      }
      for (const route of refused) {
        const label = JSON.stringify(route) ?? String(route);
        expect(safeAppRoute(route)).withContext(label).toBeNull();
        const worker = runWorker([]);
        await tap(worker, { route });
        expect(worker.clients.openWindow).withContext(label).toHaveBeenCalledOnceWith('/');

        // The open tab is the other branch; a refused route must not reach it either.
        const tab = openTab([]);
        const withTab = runWorker([tab]);
        await tap(withTab, { route });
        expect(tab.postMessage).withContext(label).toHaveBeenCalledOnceWith({ type: 'notification-route', route: '/' });
        expect(withTab.clients.openWindow).withContext(label).not.toHaveBeenCalled();
      }
    });
  });

  describe('a share', () => {
    it('pin: sends a share whose form cannot be read to the wizard with error=1', async () => {
      const worker = runWorker([]);
      const held: { answer?: Promise<Response> } = {};

      listener(worker, 'fetch')({
        request: {
          url: `${location.origin}/share-target`,
          method: 'POST',
          formData: () => rejection(new TypeError('the body is not form data')),
        },
        respondWith: (response: Promise<Response>) => {
          held.answer = response;
        },
      });

      expect(held.answer).withContext('the share POST is answered by the worker').toBeDefined();
      const response = await held.answer;
      expect(response?.status).toBe(303);
      const redirect = new URL(response?.headers.get('Location') ?? '', location.origin);
      expect(redirect.pathname + redirect.search).toBe('/import/file?source=share&error=1');
    });
  });
});
