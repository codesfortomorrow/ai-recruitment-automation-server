import { CanonicalRole } from '../candidate/candidate.types';
import { JobRoleDefinition } from './roles/roles.types';
import { SOFTWARE_JOB_ROLES } from './roles/software-roles';
import { QA_JOB_ROLES } from './roles/qa-roles';
import { BUSINESS_HR_JOB_ROLES } from './roles/business-hr-roles';
import { MARKETING_JOB_ROLES } from './roles/marketing-roles';
import { DESIGN_JOB_ROLES } from './roles/design-roles';

export * from './roles/roles.types';
export * from './roles/skill-normalizer';

/**
 * Complete list of all configured job roles supported by the recruitment platform.
 */
export const CONFIGURED_JOB_ROLES: JobRoleDefinition[] = [
  ...SOFTWARE_JOB_ROLES,
  ...QA_JOB_ROLES,
  ...BUSINESS_HR_JOB_ROLES,
  ...MARKETING_JOB_ROLES,
  ...DESIGN_JOB_ROLES,
];

// Pre-compiled list of (alias, role) pairs sorted by length descending for priority matching
interface AliasRolePair {
  alias: string;
  role: JobRoleDefinition;
}

const SORTED_ALIAS_ROLE_PAIRS: AliasRolePair[] = (() => {
  const pairs: AliasRolePair[] = [];
  for (const role of CONFIGURED_JOB_ROLES) {
    // Add title as alias if not already included
    pairs.push({ alias: role.title.toLowerCase(), role });
    for (const alias of role.aliases) {
      pairs.push({ alias: alias.toLowerCase(), role });
    }
  }
  // Sort longest alias first to guarantee specific matches (e.g. "qa automation engineer" before "qa")
  return pairs.sort((a, b) => b.alias.length - a.alias.length);
})();

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds a configured job role definition by matching aliases against a raw role string.
 */
export function findJobRoleByAlias(
  rawRole: string | null | undefined,
): JobRoleDefinition | null {
  if (!rawRole) return null;

  // 1. Direct canonical enum match (e.g. "MERN_DEVELOPER", "JAVA_DEVELOPER")
  const upperTrimmed = rawRole.trim().toUpperCase();
  const directMatch = CONFIGURED_JOB_ROLES.find(
    (r) => r.canonicalRole === upperTrimmed,
  );
  if (directMatch) {
    return directMatch;
  }

  const normalized = rawRole
    .toLowerCase()
    .replace(/[\-_/\\,()\[\]{}|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  // 2. Exact title or exact alias match
  for (const pair of SORTED_ALIAS_ROLE_PAIRS) {
    if (pair.alias === normalized) {
      return pair.role;
    }
  }

  // 3. Substring with word boundaries (longest/most specific alias wins)
  for (const pair of SORTED_ALIAS_ROLE_PAIRS) {
    const regex = new RegExp(`\\b${escapeRegex(pair.alias)}\\b`, 'i');
    if (regex.test(normalized)) {
      // Strict guard: Java Developer must never match if text mentions JavaScript
      if (pair.role.canonicalRole === 'JAVA_DEVELOPER') {
        const withoutJs = normalized.replace(
          /\b(javascript|js|ecmascript)\b/gi,
          '',
        );
        if (!/\bjava\b/i.test(withoutJs)) {
          continue;
        }
      }

      // Strict guard: UI Designer or UX Designer must not match if the candidate applied for UI/UX Designer
      if (
        (pair.role.canonicalRole === 'UI_DESIGNER' ||
          pair.role.canonicalRole === 'UX_DESIGNER') &&
        /\b(ui\s*\/?\s*ux|ux\s*\/?\s*ui)\b/i.test(normalized)
      ) {
        continue;
      }

      return pair.role;
    }
  }

  return null;
}

/**
 * Retrieves a configured job role definition by its canonical role enum.
 */
export function getJobRoleByCanonical(
  canonical: CanonicalRole,
): JobRoleDefinition | null {
  return (
    CONFIGURED_JOB_ROLES.find((r) => r.canonicalRole === canonical) || null
  );
}
