export interface ProbePreflightInput {
  credentials: Record<string, string | undefined>;
  payosEnabled: boolean;
  probeEmail?: string;
}

export function probePreflight({
  credentials,
  payosEnabled,
  probeEmail,
}: ProbePreflightInput): string[] {
  const reasons = ['PAYOS_CLIENT_ID', 'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY']
    .filter((key) => !credentials[key]?.trim())
    .map((key) => `${key} is missing`);
  if (payosEnabled)
    reasons.push('PAYOS_ENABLED=true: close public checkout before probing');
  if (!probeEmail?.trim()) reasons.push('PROBE_USER_EMAIL is missing');
  return reasons;
}

export function webhookUrlFor(appBaseUrl: string): string {
  return `${appBaseUrl.replace(/\/$/, '')}/api/economy/top-ups/payos/webhook`;
}
