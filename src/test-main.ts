// Copies the virtual test-bed init in node_modules/@angular/build/src/builders/karma/application_builder.js.
// Naming a test `main` replaces that init, so this copy is re-read against it on every Angular upgrade. Its
// `import '@angular/localize/init'` is left out: the test polyfills already load it.
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
