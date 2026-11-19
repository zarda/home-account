import { consoleLines, expectEveryHeldLineRead, quietConsole, unreadLines } from './console-quiet';

for (const method of ['warn', 'error'] as const) {
  describe(`quietConsole('${method}')`, () => {
    // Karma's own method, put back once the describe is done. Jasmine puts
    // the method the console had before the spy back only after the
    // afterEach hooks have run, so an afterEach could not restore it.
    let real: typeof console.warn;
    let passedOn: unknown[][];

    beforeAll(() => {
      real = console[method];
    });

    afterAll(() => {
      console[method] = real;
    });

    beforeEach(() => {
      // A plain recorder, not a jasmine spy, stands in for the console the
      // spy passes lines on to: spyOn would refuse a method already spied
      // upon, and a line passed on prints nothing into the run.
      passedOn = [];
      console[method] = (...args: unknown[]) => {
        passedOn.push(args);
      };
    });

    it('holds back a line that starts with a named prefix, for the case to read', () => {
      const spy = quietConsole(method, ['[Held]']);

      console[method]('[Held] a', 1);

      expect(consoleLines(spy, '[Held]')).toEqual([['[Held] a', 1]]);
      expect(passedOn).toEqual([]);
    });

    it('passes any other line on, whole, to the method the console had before the spy', () => {
      const spy = quietConsole(method, ['[Held]', '[Also held]']);

      console[method]('[Held] a', 1);
      console[method]('[Passed] b', 2);
      console[method]('[Also held] c');
      console[method]({ not: 'a string' });

      expect(passedOn).toEqual([['[Passed] b', 2], [{ not: 'a string' }]]);
      expect(consoleLines(spy, '[Held]')).toEqual([['[Held] a', 1]]);
      expect(consoleLines(spy, '[Also held]')).toEqual([['[Also held] c']]);
    });

    it('counts a held line as read once consoleLines has returned it, and none other', () => {
      const spy = quietConsole(method, ['[Held]', '[Also held]']);

      console[method]('[Held] a', 1);
      console[method]('[Passed] b');
      console[method]('[Also held] c');
      expect(unreadLines(spy)).toEqual([['[Held] a', 1], ['[Also held] c']]);

      consoleLines(spy, '[Held]');
      expect(unreadLines(spy)).withContext("the other prefix's line").toEqual([['[Also held] c']]);

      consoleLines(spy, '[Also held]');
      console[method]('[Held] d');
      expect(unreadLines(spy)).withContext('a line held after the read').toEqual([['[Held] d']]);

      consoleLines(spy, '[Held]');
      expect(unreadLines(spy)).toEqual([]);
      expectEveryHeldLineRead(spy);
    });
  });
}

describe('unreadLines', () => {
  it('refuses a spy quietConsole did not make, whose held lines it cannot tell', () => {
    expect(() => unreadLines(jasmine.createSpy('another spy'))).toThrowError(/quietConsole/);
  });
});
