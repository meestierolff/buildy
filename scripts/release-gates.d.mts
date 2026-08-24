export type ParsedLaunchCliArguments = {
  staticOnly: boolean;
  requestedEnvironment: "staging" | "production" | undefined;
  rawBaseUrl: string | undefined;
  rawExpectedGitSha: string | undefined;
};

export function parseLaunchCliArguments(
  argv: string[],
  environment?: Record<string, string | undefined>,
): ParsedLaunchCliArguments;
export function requireExpectedGitSha(value: string | undefined): string;
export function verifyDeployedGitSha(actualValue: unknown, expectedSha: string): void;
export function verifyCheckoutCapability(environment: unknown, capability: unknown): void;
export function requireSyntheticStagingEmail(value: string | undefined): string;
export function verifySyntheticSessionEmail(actualValue: unknown, expectedEmail: string): void;
