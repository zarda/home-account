// The environment variables the model probe keeps from its SDK clients and
// from the processes it starts. probe.mjs and render.mjs read this one list,
// so the fixture render filters by the same names whether the probe starts it
// or it runs on its own.

/** The variables a live run reads its key from, and that nothing else may read. */
export const KEY_VARIABLES = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

/**
 * The variables an SDK reads whatever its constructor is given, by the provider
 * whose SDK reads them. Every other variable either SDK reads has an option,
 * and probe.mjs's makeSender passes it. These two have none. The offline modes
 * hide them from the SDKs without counting the lookup as a key read, and a live
 * run refuses to start while its SDK's one is set.
 */
export const UNOVERRIDABLE_VARIABLES = {
  ANTHROPIC_CUSTOM_HEADERS: { provider: 'claude', effect: 'the Claude client adds each of its lines to every request as a header' },
  DEBUG: { provider: 'openai', effect: 'while it is "true", the OpenAI client prints every request and answer past the redactor' },
};

export const isKeyVariable = name => KEY_VARIABLES.includes(name);
export const isHiddenVariable = name => isKeyVariable(name) || Object.hasOwn(UNOVERRIDABLE_VARIABLES, name);

/**
 * The environment for a child process: everything in `env` but the key
 * variables and the unoverridable ones, which it never needs. It filters by
 * name, so it holds in a live run too, where no tripwire hides them.
 */
export function childEnv(env = process.env) {
  return Object.fromEntries(
    Object.keys(env)
      .filter(name => !isHiddenVariable(name))
      .map(name => [name, env[name]])
  );
}
