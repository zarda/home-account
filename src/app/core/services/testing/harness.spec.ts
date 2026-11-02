import { ChangeDetectionStrategy, Component, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';

@Component({
  selector: 'app-harness-unknown-element',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<app-harness-no-such-element></app-harness-no-such-element>',
})
class UnknownElementComponent {}

@Component({
  selector: 'app-harness-unknown-property',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<span [noSuchProperty]="true"></span>',
})
class UnknownPropertyComponent {}

describe('the test harness', () => {
  // Set by src/test-main.ts, which every Karma run loads after jasmine-core.
  it('fails a spec that sets no expectation', () => {
    expect(jasmine.getEnv().configuration().failSpecWithNoExpectations).toBe(true);
  });

  // The rest is the Karma builder's test-bed init, which src/test-main.ts
  // copies: an upgrade that changes the builder leaves the copy as it was, so
  // these hold it to what the specs rely on. TestBed applies the two unknown
  // options when a spec configures its module, as the specs here do, and puts
  // the previous mode back when it resets that module after every spec, which
  // also takes each fixture with it.
  it('fails a template that uses an element nothing imports', () => {
    TestBed.configureTestingModule({ imports: [UnknownElementComponent] });

    expect(() => TestBed.createComponent(UnknownElementComponent)).toThrowError(
      /NG0304: 'app-harness-no-such-element' is not a known element/
    );
  });

  it('fails a template that binds a property its element does not have', () => {
    TestBed.configureTestingModule({ imports: [UnknownPropertyComponent] });
    const fixture = TestBed.createComponent(UnknownPropertyComponent);

    expect(() => fixture.detectChanges()).toThrowError(
      /NG0303: Can't bind to 'noSuchProperty' since it isn't a known property of 'span'/
    );
  });

  it('runs change detection in zone.js', () => {
    const zone = TestBed.inject(NgZone);

    // The zoneless default's zone is a NoopNgZone, which only implements
    // NgZone, and its run() enters no Angular zone.
    expect(zone).toBeInstanceOf(NgZone);
    expect(zone.run(() => NgZone.isInAngularZone())).toBeTrue();
  });
});
