import type { EvidencePermissionScope, FlexiEvidencePermissions, ResolvedProfile } from "./types.js";

function normalizeEvidenceName(evidence: string): string {
  return evidence.trim().toLowerCase();
}

function getScopePermissions(
  permissions: FlexiEvidencePermissions | undefined,
  scope: EvidencePermissionScope
): string[] | undefined {
  return permissions?.[scope];
}

export function hasEvidencePermission(
  profile: Pick<ResolvedProfile, "permissions">,
  scope: EvidencePermissionScope,
  evidence: string
): boolean {
  const allowedEvidence = getScopePermissions(profile.permissions, scope);
  if (allowedEvidence === undefined) {
    return true;
  }

  const normalizedEvidence = normalizeEvidenceName(evidence);
  return allowedEvidence.some((candidate) => {
    const normalizedCandidate = normalizeEvidenceName(candidate);
    return normalizedCandidate === "*" || normalizedCandidate === normalizedEvidence;
  });
}

export function ensureEvidencePermission(
  profile: Pick<ResolvedProfile, "name" | "permissions">,
  scope: EvidencePermissionScope,
  evidence: string
): void {
  if (hasEvidencePermission(profile, scope, evidence)) {
    return;
  }

  const scopeLabel =
    scope === "dryRun"
      ? "dry-run validation"
      : scope === "write"
        ? "write"
        : "read";

  throw new Error(`Evidence '${evidence}' is not allowed for ${scopeLabel} on profile '${profile.name}'.`);
}
