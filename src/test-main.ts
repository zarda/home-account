// Copies the virtual test-bed init in node_modules/@angular/build/src/builders/karma/application_builder.js.
// Naming a test `main` replaces that init, so a gate holds this copy to it: `npm run test-main:check`
// (scripts/check-test-main.mjs) compares the two statement by statement and fails when an upgrade changes
// the builder's side. Its `import '@angular/localize/init'` is left out while the test polyfills load it;
// the gate allows that and the jasmine configuration below, and nothing else.
import { NgModule, provideZoneChangeDetection } from '@angular/core';
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

// A spec that sets no expectation fails. This file loads after jasmine-core, and karma-jasmine's start merges its
// own configuration over this one without naming the flag, so it holds for every run.
jasmine.getEnv().configure({ failSpecWithNoExpectations: true });

@NgModule({ providers: [provideZoneChangeDetection()] })
export class TestModule {}

getTestBed().initTestEnvironment([BrowserTestingModule, TestModule], platformBrowserTesting(), {
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});
