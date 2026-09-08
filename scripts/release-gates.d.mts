export type ParsedLaunchCliArguments = {
  staticOnly: boolean;
  requestedEnvironment: "preview" | "staging" | "production" | undefined;
  rawBaseUrl: string | undefined;
  rawExpectedGitSha: string | undefined;
};

export function parseLaunchCliArguments(
  argv: string[],
  environment?: Record<string, string | undefined>,
): ParsedLaunchCliArguments;
export function requireExpectedGitSha(value: string | undefined): string;
export function verifyDeployedGitSha(actualValue: unknown, expectedSha: string): void;
export type ReleaseContract = {
  profile: "feedback_beta";
  checkoutMode: "off";
};
export function releaseContractFor(
  environment: "preview" | "staging" | "production",
): ReleaseContract;
export function verifyTargetCapabilities(capabilities: unknown): void;
export function verifyTargetProductProfile(profile: unknown, contract: ReleaseContract): void;
export function targetReadinessFailures(checks: unknown): string[];
export function requireSyntheticStagingEmail(value: string | undefined): string;
export function verifySyntheticSessionEmail(actualValue: unknown, expectedEmail: string): void;
