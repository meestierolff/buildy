const FULL_GIT_SHA = /^[a-f0-9]{40}$/i;
const SYNTHETIC_STAGING_EMAIL = /^buildy-staging-e2e(?:-[a-z0-9]{1,32})?@[a-z0-9](?:[a-z0-9.-]{0,61}[a-z0-9])?\.[a-z]{2,63}$/i;

const LAUNCH_FLAG_OPTIONS = new Set(["--static", "--staging", "--production"]);
const LAUNCH_VALUE_OPTIONS = new Set(["--environment", "--base-url", "--expected-sha"]);

function launchUsageError(message) {
  return new Error(`${message}. Gebruik: check:launch -- --static | --staging|--production --base-url=https://... --expected-sha=<40-teken-sha>`);
}

export function parseLaunchCliArguments(argv, environment = {}) {
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== "string")) {
    throw launchUsageError("Launchargumenten zijn ongeldig");
  }

  const flags = new Map();
  const values = new Map();
  for (const argument of argv) {
    if (LAUNCH_FLAG_OPTIONS.has(argument)) {
      if (flags.has(argument)) throw launchUsageError("Een launchoptie is dubbel opgegeven");
      flags.set(argument, true);
      continue;
    }

    const separator = argument.indexOf("=");
    const name = separator === -1 ? argument : argument.slice(0, separator);
    if (!LAUNCH_VALUE_OPTIONS.has(name)) throw launchUsageError("Onbekende launchoptie");
    if (separator === -1 || separator === argument.length - 1) {
      throw launchUsageError("Een launchoptie mist een waarde");
    }
    if (values.has(name)) throw launchUsageError("Een launchoptie is dubbel opgegeven");
    values.set(name, argument.slice(separator + 1));
  }

  const staticOnly = flags.has("--static");
  const explicitTargets = [
    ...(flags.has("--staging") ? ["staging"] : []),
    ...(flags.has("--production") ? ["production"] : []),
    ...(values.has("--environment") ? [values.get("--environment")] : []),
  ];

  if (staticOnly) {
    if (argv.length !== 1) throw launchUsageError("--static mag niet met live-opties worden gecombineerd");
    return {
      staticOnly: true,
      requestedEnvironment: undefined,
      rawBaseUrl: undefined,
      rawExpectedGitSha: undefined,
    };
  }

  if (explicitTargets.length !== 1 || !["staging", "production"].includes(explicitTargets[0])) {
    throw launchUsageError("Kies exact één expliciet live-doel");
  }

  return {
    staticOnly: false,
    requestedEnvironment: explicitTargets[0],
    rawBaseUrl: values.get("--base-url")
      || environment.LAUNCH_BASE_URL
      || environment.PRIMARY_DOMAIN
      || environment.APP_ORIGIN,
    rawExpectedGitSha: values.get("--expected-sha") || environment.LAUNCH_EXPECTED_GIT_SHA,
  };
}

export function requireExpectedGitSha(value) {
  const sha = value?.trim();
  if (!sha || !FULL_GIT_SHA.test(sha)) {
    throw new Error("geef de volledige verwachte 40-teken git-SHA op");
  }
  return sha.toLowerCase();
}

export function verifyDeployedGitSha(actualValue, expectedSha) {
  const actual = typeof actualValue === "string" ? actualValue.trim().toLowerCase() : "";
  if (!FULL_GIT_SHA.test(actual)) throw new Error("deployment geeft geen volledige geldige git-SHA terug");
  if (actual !== expectedSha) throw new Error("deployment-SHA komt niet overeen met de vastgezette release");
}

export function verifyCheckoutCapability(environment, capability) {
  if (capability !== "ready") {
    const mode = environment === "production" ? "live" : "test";
    throw new Error(`${environment} vereist ${mode} checkout`);
  }
}

export function requireSyntheticStagingEmail(value) {
  const email = value?.trim().toLowerCase();
  if (!email || value !== value.trim() || !SYNTHETIC_STAGING_EMAIL.test(email)) {
    throw new Error("staging vereist een niet-persoonlijk buildy-staging-e2e account");
  }
  return email;
}

export function verifySyntheticSessionEmail(actualValue, expectedEmail) {
  const actual = typeof actualValue === "string" ? actualValue.trim().toLowerCase() : "";
  if (actual !== expectedEmail) throw new Error("de staging-sessie hoort niet bij het vastgezette synthetische account");
}
