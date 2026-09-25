import angularJson from '../../angular.json';
import firebaseJson from '../../firebase.json';
import packageJson from '../../package.json';
import { EMULATOR_HOSTS } from '../environments/emulators';
import { EMULATOR_HOSTS as EMULATOR_BUILD_HOSTS } from '../environments/emulators.on';
import { environment as emulatorEnvironment } from '../environments/environment.emulators';
import { isConfiguredMeasurementId } from './core/config/analytics.config';

/**
 * The emulator serve is one configuration away from the production build: the
 * `emulators` configuration swaps two files, and nothing else may. A
 * production or iOS build that picked up either swap would point the shipped
 * app at the demo project and at 127.0.0.1, and nothing in a green build
 * would say so — every file involved type-checks in every configuration.
 */

interface FileReplacement {
  replace: string;
  with: string;
}

interface BuildOptions {
  fileReplacements?: FileReplacement[];
  optimization?: boolean;
  sourceMap?: boolean;
  namedChunks?: boolean;
  outputPath?: OutputPath;
  serviceWorker?: unknown;
}

/** angular.json takes the output path as a string or as its parts. */
type OutputPath = string | { base: string; browser?: string };

interface Target {
  options?: BuildOptions;
  configurations?: Record<string, BuildOptions & { buildTarget?: string }>;
  defaultConfiguration?: string;
}

const architect = (angularJson as unknown as {
  projects: Record<string, { architect: Record<string, Target> }>;
}).projects['home-account'].architect;
const buildConfigurations = architect['build'].configurations ?? {};
const serveConfigurations = architect['serve'].configurations ?? {};

const ENVIRONMENT_FILE = 'src/environments/environment.ts';
const EMULATOR_BUILD_ENVIRONMENT_FILE = 'src/environments/environment.emulators.ts';
const HOSTS_FILE = 'src/environments/emulators.ts';
const EMULATOR_BUILD_HOSTS_FILE = 'src/environments/emulators.on.ts';
const EMULATOR_FILES = [EMULATOR_BUILD_ENVIRONMENT_FILE, HOSTS_FILE, EMULATOR_BUILD_HOSTS_FILE];

/**
 * A workspace-relative path in one spelling. The builder resolves
 * fileReplacements and outputPath against the workspace root, so './a', 'a/',
 * 'a//b' and 'a/./b' all name the same file or directory as the plain form;
 * a backslash is read as a separator, as a Windows build reads it. A leading
 * '../' or an absolute path is left as written: this spec runs in the
 * browser, with no workspace root to resolve against.
 */
function normalizePath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/(?:\.\/)+/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/\.?$/, '');
}

// Hosting publishes this directory; the build writes its browser files to
// `<outputPath>/browser`, so the production output path is its parent.
const HOSTING_PUBLIC = normalizePath((firebaseJson as { hosting: { public: string } }).hosting.public);
const HOSTING_ROOT = HOSTING_PUBLIC.replace(/\/browser$/, '');

function touchesEmulatorFiles(options: BuildOptions | undefined): FileReplacement[] {
  const emulatorFiles = EMULATOR_FILES.map(normalizePath);
  return (options?.fileReplacements ?? []).filter(
    r => emulatorFiles.includes(normalizePath(r.replace)) || emulatorFiles.includes(normalizePath(r.with))
  );
}

const within = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`);

/** The directory the build empties and writes into. */
function outputBase(outputPath: OutputPath): string {
  return normalizePath(typeof outputPath === 'string' ? outputPath : outputPath.base);
}

/** Where the build writes its browser files: `<base>/browser` unless `browser` renames it. */
function browserOutputDir(outputPath: OutputPath): string {
  const base = outputBase(outputPath);
  const browser = normalizePath(typeof outputPath === 'string' ? 'browser' : outputPath.browser ?? 'browser');
  return browser ? `${base}/${browser}` : base;
}

describe('angular.json build configurations', () => {
  it('builds production by default', () => {
    expect(architect['build'].defaultConfiguration).toBe('production');
  });

  for (const name of ['production', 'production-local', 'development']) {
    it(`keeps the emulator files out of '${name}'`, () => {
      // Named rather than only looped over, so a renamed configuration
      // fails here instead of dropping out of the check.
      expect(buildConfigurations[name]).withContext(name).toBeDefined();
      expect(touchesEmulatorFiles(buildConfigurations[name])).toEqual([]);
    });
  }

  it('keeps the emulator files out of every configuration but emulators, and out of the base build and test options', () => {
    const offenders = Object.entries(buildConfigurations)
      .filter(([name, options]) => name !== 'emulators' && touchesEmulatorFiles(options).length > 0)
      .map(([name]) => name);

    expect(offenders).toEqual([]);
    expect(touchesEmulatorFiles(architect['build'].options)).toEqual([]);
    expect(touchesEmulatorFiles(architect['test'].options)).toEqual([]);
  });

  it('swaps both the environment and the hosts in the emulators configuration', () => {
    const replacements = buildConfigurations['emulators']?.fileReplacements ?? [];

    expect(replacements).toContain({ replace: ENVIRONMENT_FILE, with: EMULATOR_BUILD_ENVIRONMENT_FILE });
    expect(replacements).toContain({ replace: HOSTS_FILE, with: EMULATOR_BUILD_HOSTS_FILE });
    expect(replacements.length).toBe(2);
  });

  it('builds the emulators configuration for development, never as a deployable', () => {
    const emulators = buildConfigurations['emulators'];

    expect(emulators?.optimization).toBeFalse();
    expect(emulators?.sourceMap).toBeTrue();
    expect(emulators?.namedChunks).toBeTrue();
    expect(emulators?.serviceWorker).toBeUndefined();

    // Browser files written under the hosting directory would be one
    // `firebase deploy` away from the live site; a base at or under the
    // production output would also empty it, since the builder deletes its
    // output path before writing.
    expect(emulators?.outputPath).toBeDefined();
    const outputPath = emulators?.outputPath ?? '';
    expect(within(outputBase(outputPath), HOSTING_ROOT)).withContext(outputBase(outputPath)).toBeFalse();
    expect(within(browserOutputDir(outputPath), HOSTING_PUBLIC)).withContext(browserOutputDir(outputPath)).toBeFalse();
  });

  it('serves the emulators build through its own serve configuration on port 4300', () => {
    expect(serveConfigurations['emulators']?.buildTarget).toBe('home-account:build:emulators');
    const scripts = (packageJson as { scripts: Record<string, string> }).scripts;
    expect(scripts['start:emulators']).toBe('ng serve --configuration emulators --port 4300');
  });
});

describe('the path checks the guards rely on', () => {
  const HOSTS_FILE_SPELLINGS = [
    'src/environments/emulators.ts',
    './src/environments/emulators.ts',
    'src//environments/emulators.ts',
    'src/./environments/./emulators.ts',
    'src\\environments\\emulators.ts',
  ];

  it('finds an emulator file however angular.json spells its path', () => {
    for (const spelling of HOSTS_FILE_SPELLINGS) {
      const replaced = { fileReplacements: [{ replace: spelling, with: 'src/environments/other.ts' }] };
      const swappedIn = { fileReplacements: [{ replace: 'src/environments/other.ts', with: spelling }] };

      expect(touchesEmulatorFiles(replaced).length).withContext(`replace: ${spelling}`).toBe(1);
      expect(touchesEmulatorFiles(swappedIn).length).withContext(`with: ${spelling}`).toBe(1);
    }
  });

  it('reads the output path in either form, however it is spelled', () => {
    expect(outputBase('./dist/home-account/')).toBe('dist/home-account');
    expect(outputBase({ base: 'dist//home-account' })).toBe('dist/home-account');
    expect(browserOutputDir('dist/home-account/')).toBe('dist/home-account/browser');
    expect(browserOutputDir({ base: 'dist', browser: './home-account/browser/' })).toBe('dist/home-account/browser');
    expect(browserOutputDir({ base: './dist/home-account', browser: '' })).toBe('dist/home-account');
  });

  it('counts a directory as inside itself and its subdirectories, never its siblings', () => {
    expect(within('dist/home-account', 'dist/home-account')).toBeTrue();
    expect(within('dist/home-account/browser', 'dist/home-account')).toBeTrue();
    expect(within('dist/home-account-emulators', 'dist/home-account')).toBeFalse();
  });
});

describe('emulator hosts', () => {
  it('names no emulator in the committed file, which every other build compiles', () => {
    expect(EMULATOR_HOSTS).toBeNull();
  });

  it('matches the ports firebase.json starts the emulators on', () => {
    const ports = (firebaseJson as unknown as { emulators: Record<string, { port?: number }> }).emulators;

    expect(EMULATOR_BUILD_HOSTS).not.toBeNull();
    expect(EMULATOR_BUILD_HOSTS?.auth.url).toBe(`http://127.0.0.1:${ports['auth'].port}`);
    expect(EMULATOR_BUILD_HOSTS?.firestore).toEqual({ host: '127.0.0.1', port: ports['firestore'].port as number });
    expect(EMULATOR_BUILD_HOSTS?.storage).toEqual({ host: '127.0.0.1', port: ports['storage'].port as number });
    expect(EMULATOR_BUILD_HOSTS?.functions).toEqual({ host: '127.0.0.1', port: ports['functions'].port as number });
  });

  it('points the emulator build at a demo project, which the emulators never forward', () => {
    // A demo- project has no live counterpart, so a missed connect fails
    // loudly instead of reaching real data; the session records the seed
    // writes are keyed by this api key.
    expect(emulatorEnvironment.firebase.projectId).toBe('demo-home-account');
    expect(emulatorEnvironment.firebase.apiKey).toBe('demo-api-key');
    expect(emulatorEnvironment.production).toBeFalse();
  });

  it('leaves analytics unconfigured in the emulator build', () => {
    // A GA4 id would register the Analytics providers, and an opted-in demo
    // account would then report to the live property.
    expect(isConfiguredMeasurementId(emulatorEnvironment.firebase.measurementId)).toBeFalse();
  });
});
