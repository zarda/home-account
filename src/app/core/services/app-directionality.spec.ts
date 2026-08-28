import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { DIR_DOCUMENT, type Direction } from '@angular/cdk/bidi';
import { AppDirectionality } from './app-directionality';

describe('AppDirectionality', () => {
  let service: AppDirectionality;
  let fakeDocument: Document;
  let dirWrites: string[];
  let changes: Direction[];

  beforeEach(() => {
    dirWrites = [];
    let dir = '';

    // Records every write so a no-op call can be told apart from a call that
    // rewrites the same value.
    const documentElement = {
      get dir(): string {
        return dir;
      },
      set dir(value: string) {
        dirWrites.push(value);
        dir = value;
      },
    };

    fakeDocument = {
      // CDK's Directionality constructor reads `body.dir` first and falls back
      // to `documentElement.dir` when it is empty, so both have to answer.
      body: { dir: '' },
      documentElement,
      // Nothing under test queries the document, but TestBed teardown does
      // (see accessibility.service.spec.ts for the same fallback).
      querySelectorAll: jasmine.createSpy('querySelectorAll').and.returnValue([]),
    } as unknown as Document;

    TestBed.configureTestingModule({
      providers: [
        AppDirectionality,
        // DIR_DOCUMENT is what the CDK constructor reads; DOCUMENT is what the
        // subclass writes. Faking both keeps the real page's `dir` untouched —
        // flipping it makes geometry-based tests fail in some browsers, which
        // is why the CDK owns a separate document token in the first place.
        { provide: DIR_DOCUMENT, useValue: fakeDocument },
        { provide: DOCUMENT, useValue: fakeDocument },
      ],
    });

    service = TestBed.inject(AppDirectionality);

    changes = [];
    service.change.subscribe((value: Direction) => changes.push(value));
  });

  it('starts from the direction the document already declares', () => {
    expect(service.value).toBe('ltr');
    expect(dirWrites).toEqual([]);
  });

  it('moves the attribute, the signal and the change stream to rtl together', () => {
    service.setDirection('rtl');

    expect(fakeDocument.documentElement.dir).toBe('rtl');
    expect(service.value).toBe('rtl');
    expect(service.valueSignal()).toBe('rtl');
    expect(changes).toEqual(['rtl']);
    expect(dirWrites).toEqual(['rtl']);
  });

  it('moves back to ltr the same way', () => {
    service.setDirection('rtl');
    service.setDirection('ltr');

    expect(fakeDocument.documentElement.dir).toBe('ltr');
    expect(service.value).toBe('ltr');
    expect(service.valueSignal()).toBe('ltr');
    expect(changes).toEqual(['rtl', 'ltr']);
    expect(dirWrites).toEqual(['rtl', 'ltr']);
  });

  it('does nothing when asked for the direction already in force', () => {
    service.setDirection('ltr');

    expect(dirWrites).toEqual([]);
    expect(changes).toEqual([]);
    expect(service.value).toBe('ltr');
  });

  it('does not re-announce a direction it is already holding', () => {
    service.setDirection('rtl');
    service.setDirection('rtl');

    expect(dirWrites).toEqual(['rtl']);
    expect(changes).toEqual(['rtl']);
  });
});
