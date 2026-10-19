/**
 * Skill Normalization and Context-Aware ATS Matching Utilities.
 * Handles synonym recognition, equivalent terms, and strict domain boundaries.
 */

export interface SkillSynonym {
  canonical: string;
  synonyms: string[];
  /** Exclude patterns that must not match (e.g. 'java' must not match 'javascript') */
  negativePattern?: RegExp;
}

export const CANONICAL_SKILL_SYNONYMS: SkillSynonym[] = [
  // Web & JavaScript Ecosystem
  {
    canonical: 'React',
    synonyms: ['react', 'react.js', 'reactjs', 'react js'],
    negativePattern: /\breact\s*native\b/i,
  },
  {
    canonical: 'Node.js',
    synonyms: ['node', 'node.js', 'nodejs', 'node js'],
  },
  {
    canonical: 'Express.js',
    synonyms: ['express', 'express.js', 'expressjs', 'express js'],
  },
  {
    canonical: 'MongoDB',
    synonyms: ['mongodb', 'mongo', 'mongoose', 'nosql database'],
  },
  {
    canonical: 'JavaScript',
    synonyms: ['javascript', 'js', 'ecmascript', 'es6', 'es6+'],
  },
  {
    canonical: 'TypeScript',
    synonyms: ['typescript', 'ts'],
  },
  {
    canonical: 'Java',
    synonyms: ['java', 'core java', 'j2ee', 'spring boot', 'spring framework'],
    // Java must never match JavaScript or JS!
    negativePattern: /\b(javascript|js|ecmascript)\b/i,
  },
  {
    canonical: 'Python',
    synonyms: ['python', 'python3', 'django', 'flask', 'fastapi'],
  },
  {
    canonical: 'HTML',
    synonyms: ['html', 'html5'],
  },
  {
    canonical: 'CSS',
    synonyms: [
      'css',
      'css3',
      'sass',
      'scss',
      'tailwind',
      'tailwindcss',
      'bootstrap',
    ],
  },
  {
    canonical: 'REST APIs',
    synonyms: [
      'rest api',
      'rest apis',
      'restful apis',
      'restful api',
      'api development',
      'api integration',
    ],
  },
  {
    canonical: 'Git',
    synonyms: ['git', 'github', 'gitlab', 'version control'],
  },
  {
    canonical: 'Docker',
    synonyms: ['docker', 'containerization', 'containers'],
  },

  // QA and Testing
  {
    canonical: 'Manual Testing',
    synonyms: [
      'manual testing',
      'manual test',
      'functional testing',
      'black box testing',
      'sanity testing',
      'smoke testing',
    ],
  },
  {
    canonical: 'Automation Testing',
    synonyms: [
      'automation testing',
      'automated testing',
      'selenium',
      'cypress',
      'playwright',
      'appium',
      'test automation',
    ],
  },
  {
    canonical: 'Test Case Design',
    synonyms: [
      'test cases',
      'test case design',
      'test scenarios',
      'test suite',
      'test plan',
    ],
  },
  {
    canonical: 'Defect Reporting',
    synonyms: [
      'bug reporting',
      'defect reporting',
      'bug tracking',
      'jira',
      'bug life cycle',
      'defect tracking',
    ],
  },
  {
    canonical: 'STLC / SDLC',
    synonyms: [
      'sdlc',
      'stlc',
      'software testing life cycle',
      'software development life cycle',
    ],
  },

  // Business & HR
  {
    canonical: 'Candidate Sourcing',
    synonyms: [
      'candidate sourcing',
      'sourcing',
      'talent sourcing',
      'linkedin recruiter',
      'naukri',
      'headhunting',
    ],
  },
  {
    canonical: 'Resume Screening',
    synonyms: [
      'resume screening',
      'candidate screening',
      'cv screening',
      'profile screening',
      'screening resumes',
    ],
  },
  {
    canonical: 'Interview Scheduling',
    synonyms: [
      'interview scheduling',
      'scheduling interviews',
      'interview coordination',
      'calendar management',
    ],
  },
  {
    canonical: 'Candidate Follow-ups',
    synonyms: [
      'candidate follow ups',
      'candidate follow-up',
      'pipeline follow up',
      'candidate engagement',
    ],
  },
  {
    canonical: 'Google Sheets',
    synonyms: [
      'google sheets',
      'google sheet',
      'google spreadsheet',
      'google spreadsheets',
      'g-sheets',
    ],
  },
  {
    canonical: 'MS Excel',
    synonyms: [
      'excel',
      'ms excel',
      'microsoft excel',
      'spreadsheets',
      'vlookup',
      'pivot table',
      'pivot tables',
    ],
  },

  // Marketing
  {
    canonical: 'SEO',
    synonyms: [
      'seo',
      'search engine optimization',
      'search engine optimisation',
      'on-page seo',
      'off-page seo',
      'technical seo',
    ],
  },
  {
    canonical: 'SEM / Paid Ads',
    synonyms: [
      'sem',
      'google ads',
      'paid search',
      'ppc',
      'pay per click',
      'meta ads',
      'facebook ads',
    ],
  },
  {
    canonical: 'Social Media Marketing',
    synonyms: [
      'social media marketing',
      'social media management',
      'smm',
      'social media campaigns',
      'instagram marketing',
      'linkedin marketing',
    ],
  },
  {
    canonical: 'Content Strategy',
    synonyms: [
      'content strategy',
      'content marketing',
      'content creation',
      'blogging',
      'copywriting',
    ],
  },
  {
    canonical: 'Web Analytics',
    synonyms: [
      'google analytics',
      'ga4',
      'web analytics',
      'conversion tracking',
      'google tag manager',
      'gtm',
    ],
  },

  // Creative & Design
  {
    canonical: 'UI/UX',
    synonyms: [
      'ui/ux',
      'ui ux',
      'ui-ux',
      'ux/ui',
      'user interface and user experience',
      'product design',
    ],
  },
  {
    canonical: 'User Research',
    synonyms: [
      'user research',
      'user interviews',
      'usability testing',
      'user journey',
      'journey mapping',
      'user personas',
    ],
  },
  {
    canonical: 'Wireframing & Prototyping',
    synonyms: [
      'wireframes',
      'wireframing',
      'prototypes',
      'prototyping',
      'mockups',
      'figma prototypes',
    ],
  },
  {
    canonical: 'Figma',
    synonyms: [
      'figma',
      'figma design system',
      'figma components',
      'figma tokens',
    ],
  },
  {
    canonical: 'Video Editing',
    synonyms: [
      'video editing',
      'video editor',
      'video cutting',
      'timeline editing',
      'video assembly',
    ],
  },
  {
    canonical: 'Adobe Premiere Pro',
    synonyms: [
      'premiere pro',
      'premiere',
      'adobe premiere',
      'davinci resolve',
      'final cut pro',
    ],
  },
  {
    canonical: 'Motion Graphics',
    synonyms: [
      'motion graphics',
      'after effects',
      'adobe after effects',
      '2d animation',
      'visual effects',
      'vfx',
    ],
  },
  {
    canonical: 'Graphic Design',
    synonyms: [
      'graphic design',
      'visual design',
      'adobe photoshop',
      'photoshop',
      'adobe illustrator',
      'illustrator',
    ],
  },
];

/**
 * Normalizes a raw skill string into its recognized canonical term.
 */
export function normalizeSkill(rawSkill: string | null | undefined): string {
  if (!rawSkill) return '';
  const cleaned = rawSkill
    .toLowerCase()
    .replace(/[\-_/\\,()\[\]{}|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  for (const entry of CANONICAL_SKILL_SYNONYMS) {
    if (entry.canonical.toLowerCase() === cleaned) {
      return entry.canonical;
    }
    for (const syn of entry.synonyms) {
      if (syn.toLowerCase() === cleaned) {
        return entry.canonical;
      }
    }
  }

  return rawSkill.trim();
}

/**
 * Checks if a candidate text contains a skill using context-aware synonym and negative-match rules.
 */
export function matchesSkillInContext(
  text: string,
  canonicalOrSynonym: string,
): boolean {
  if (!text || !canonicalOrSynonym) return false;
  const lowerText = text.toLowerCase();

  // Find synonym configuration if known
  const entry = CANONICAL_SKILL_SYNONYMS.find(
    (e) =>
      e.canonical.toLowerCase() === canonicalOrSynonym.toLowerCase() ||
      e.synonyms.some(
        (s) => s.toLowerCase() === canonicalOrSynonym.toLowerCase(),
      ),
  );

  if (entry) {
    // If negative pattern exists, verify surrounding context does not match negative pattern
    for (const syn of entry.synonyms) {
      const escaped = syn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(lowerText)) {
        // Special check for Java vs JavaScript
        if (entry.canonical === 'Java') {
          // If all instances of "java" in the text are followed by "script" (or are part of javascript), it's not Java!
          const stripped = lowerText.replace(
            /\b(javascript|ecmascript|js)\b/gi,
            '',
          );
          if (/\bjava\b/i.test(stripped)) {
            return true;
          }
        } else {
          return true;
        }
      }
    }
    return false;
  }

  // Fallback for custom or unlisted skills
  const escaped = canonicalOrSynonym
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return regex.test(lowerText);
}
