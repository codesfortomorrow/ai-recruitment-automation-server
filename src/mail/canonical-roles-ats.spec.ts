import { RoleDetectionService } from './role-detection.service';
import { RoleScoringEngine } from './role-scoring-engine';
import { HrAssignmentService } from '../candidate/hr-assignment.service';
import {
  CONFIGURED_JOB_ROLES,
  findJobRoleByAlias,
  getJobRoleByCanonical,
  matchesSkillInContext,
  normalizeSkill,
} from '../configs/job-roles.config';
import { CanonicalRole } from '../candidate/candidate.types';

describe('Comprehensive ATS Canonical Roles, Skill Normalization, and Scoring Suite', () => {
  let roleDetectionService: RoleDetectionService;
  let hrAssignmentService: HrAssignmentService;

  beforeEach(() => {
    roleDetectionService = new RoleDetectionService();
    const mockHrConfig = {
      hr1: {
        id: 'hr-1',
        name: 'Abhishek',
        email: 'abhishek.goud.mongoosetech@gmail.com',
      },
      hr2: {
        id: 'hr-2',
        name: 'Jayendra',
        email: 'jayendrabamne.mongoosetech@gmail.com',
      },
      manualReviewEmail: 'hr-review@codesfortomorrow.com',
    };
    hrAssignmentService = new HrAssignmentService(mockHrConfig as any);
  });

  describe('1. Canonical Roles Coverage & Aliases', () => {
    const allCanonicalRoles: CanonicalRole[] = [
      // Software Development (11)
      'MERN_DEVELOPER',
      'FULL_STACK_DEVELOPER',
      'REACT_DEVELOPER',
      'NODE_DEVELOPER',
      'SOFTWARE_DEVELOPER',
      'FRONTEND_DEVELOPER',
      'BACKEND_DEVELOPER',
      'JAVASCRIPT_DEVELOPER',
      'TYPESCRIPT_DEVELOPER',
      'JAVA_DEVELOPER',
      'PYTHON_DEVELOPER',

      // QA and Testing (3)
      'QA_TESTER',
      'QA_AUTOMATION_ENGINEER',
      'MANUAL_TESTER',

      // Business and HR (5)
      'BUSINESS_ANALYST',
      'HR_INTERN',
      'HR_EXECUTIVE',
      'RECRUITER',
      'TALENT_ACQUISITION',

      // Marketing (6)
      'DIGITAL_MARKETER',
      'DIGITAL_MARKETING_EXECUTIVE',
      'SEO_SPECIALIST',
      'SOCIAL_MEDIA_MANAGER',
      'CONTENT_MARKETER',
      'PERFORMANCE_MARKETER',

      // Creative and Design (6)
      'VIDEO_EDITOR',
      'MOTION_GRAPHICS_DESIGNER',
      'GRAPHIC_DESIGNER',
      'UI_UX_DESIGNER',
      'UI_DESIGNER',
      'UX_DESIGNER',
    ];

    it('should have all 31 canonical roles configured in CONFIGURED_JOB_ROLES', () => {
      const configuredCanonicals = CONFIGURED_JOB_ROLES.map(
        (r) => r.canonicalRole,
      );
      for (const role of allCanonicalRoles) {
        expect(configuredCanonicals).toContain(role);
        const def = getJobRoleByCanonical(role);
        expect(def).not.toBeNull();
        expect(def?.scoringRubric.length).toBeGreaterThanOrEqual(4);
        expect(def?.requiredSkills.length).toBeGreaterThanOrEqual(3);
      }
      expect(CONFIGURED_JOB_ROLES.length).toBe(31);
    });

    it('should resolve every canonical role from its primary title', () => {
      for (const role of allCanonicalRoles) {
        const def = getJobRoleByCanonical(role)!;
        const matched = findJobRoleByAlias(def.title);
        expect(matched).not.toBeNull();
        expect(matched?.canonicalRole).toBe(role);
      }
    });

    it('should resolve aliases correctly without duplicate or fuzzy conflicts', () => {
      const testCases: Array<{ alias: string; expectedRole: CanonicalRole }> = [
        // Software
        { alias: 'mern stack developer', expectedRole: 'MERN_DEVELOPER' },
        { alias: 'mern developer', expectedRole: 'MERN_DEVELOPER' },
        { alias: 'full stack developer', expectedRole: 'FULL_STACK_DEVELOPER' },
        {
          alias: 'fullstack web developer',
          expectedRole: 'FULL_STACK_DEVELOPER',
        },
        { alias: 'react.js developer', expectedRole: 'REACT_DEVELOPER' },
        { alias: 'node.js developer', expectedRole: 'NODE_DEVELOPER' },
        { alias: 'frontend engineer', expectedRole: 'FRONTEND_DEVELOPER' },
        { alias: 'backend developer', expectedRole: 'BACKEND_DEVELOPER' },
        { alias: 'javascript developer', expectedRole: 'JAVASCRIPT_DEVELOPER' },
        { alias: 'typescript developer', expectedRole: 'TYPESCRIPT_DEVELOPER' },
        { alias: 'java developer', expectedRole: 'JAVA_DEVELOPER' },
        { alias: 'python developer', expectedRole: 'PYTHON_DEVELOPER' },

        // QA
        { alias: 'qa engineer', expectedRole: 'QA_TESTER' },
        {
          alias: 'qa automation engineer',
          expectedRole: 'QA_AUTOMATION_ENGINEER',
        },
        { alias: 'manual tester', expectedRole: 'MANUAL_TESTER' },

        // Business & HR
        { alias: 'business analyst', expectedRole: 'BUSINESS_ANALYST' },
        { alias: 'hr intern', expectedRole: 'HR_INTERN' },
        { alias: 'hr executive', expectedRole: 'HR_EXECUTIVE' },
        { alias: 'technical recruiter', expectedRole: 'RECRUITER' },
        {
          alias: 'talent acquisition specialist',
          expectedRole: 'TALENT_ACQUISITION',
        },

        // Marketing
        { alias: 'digital marketer', expectedRole: 'DIGITAL_MARKETER' },
        {
          alias: 'digital marketing executive',
          expectedRole: 'DIGITAL_MARKETING_EXECUTIVE',
        },
        { alias: 'seo specialist', expectedRole: 'SEO_SPECIALIST' },
        { alias: 'social media manager', expectedRole: 'SOCIAL_MEDIA_MANAGER' },
        { alias: 'content marketer', expectedRole: 'CONTENT_MARKETER' },
        { alias: 'performance marketer', expectedRole: 'PERFORMANCE_MARKETER' },

        // Design
        { alias: 'video editor', expectedRole: 'VIDEO_EDITOR' },
        {
          alias: 'motion graphics designer',
          expectedRole: 'MOTION_GRAPHICS_DESIGNER',
        },
        { alias: 'graphic designer', expectedRole: 'GRAPHIC_DESIGNER' },
        { alias: 'ui/ux designer', expectedRole: 'UI_UX_DESIGNER' },
        { alias: 'ui designer', expectedRole: 'UI_DESIGNER' },
        { alias: 'ux designer', expectedRole: 'UX_DESIGNER' },
      ];

      for (const tc of testCases) {
        const res = findJobRoleByAlias(tc.alias);
        expect(res).not.toBeNull();
        expect(res?.canonicalRole).toBe(tc.expectedRole);
      }
    });
  });

  describe('2. Strict Distinctions: Java vs JavaScript and MERN vs Full Stack', () => {
    it('should strictly distinguish Java Developer from JavaScript Developer', () => {
      // Role detection
      const javaResult = roleDetectionService.resolveRole({
        subject: 'Application for Java Developer - Rajesh',
        emailBody: 'I am applying for the Java Developer position.',
      });
      expect(javaResult.canonicalRole).toBe('JAVA_DEVELOPER');

      const jsResult = roleDetectionService.resolveRole({
        subject: 'Application for JavaScript Developer - Karan',
        emailBody: 'Applying for JavaScript Developer role.',
      });
      expect(jsResult.canonicalRole).toBe('JAVASCRIPT_DEVELOPER');

      // Skill context matching
      const javaResume =
        'Proficient in Java 17, Spring Boot, Hibernate, microservices, and MySQL.';
      const jsResume =
        'Experienced in JavaScript ES6+, DOM manipulation, React, Node.js, and CSS3.';

      expect(matchesSkillInContext(javaResume, 'Java')).toBe(true);
      expect(matchesSkillInContext(javaResume, 'JavaScript')).toBe(false);

      expect(matchesSkillInContext(jsResume, 'JavaScript')).toBe(true);
      expect(matchesSkillInContext(jsResume, 'Java')).toBe(false);

      // Verify a JavaScript candidate scored against Java role receives low score
      const javaRole = getJobRoleByCanonical('JAVA_DEVELOPER')!;
      const jsScoreOnJava = RoleScoringEngine.evaluateEvidence(
        jsResume,
        javaRole,
      );
      expect(jsScoreOnJava.matchScore).toBeLessThan(35);
    });

    it('should strictly distinguish MERN Developer from Full Stack Developer', () => {
      const mernResult = roleDetectionService.resolveRole({
        subject: 'Applying for MERN Developer',
      });
      expect(mernResult.canonicalRole).toBe('MERN_DEVELOPER');

      const fullStackResult = roleDetectionService.resolveRole({
        subject: 'Applying for Full Stack Developer',
      });
      expect(fullStackResult.canonicalRole).toBe('FULL_STACK_DEVELOPER');

      expect(mernResult.canonicalRole).not.toBe(fullStackResult.canonicalRole);
    });
  });

  describe('3. Skill Normalization for Equivalent Terms', () => {
    it('should normalize equivalent terms correctly', () => {
      expect(normalizeSkill('React.js')).toBe('React');
      expect(normalizeSkill('reactjs')).toBe('React');
      expect(normalizeSkill('Node.js')).toBe('Node.js');
      expect(normalizeSkill('nodejs')).toBe('Node.js');
      expect(normalizeSkill('JS')).toBe('JavaScript');
      expect(normalizeSkill('UI/UX')).toBe('UI/UX');
      expect(normalizeSkill('ui ux')).toBe('UI/UX');
      expect(normalizeSkill('Search Engine Optimization')).toBe('SEO');
      expect(normalizeSkill('Google Sheets')).toBe('Google Sheets');
      expect(normalizeSkill('google spreadsheet')).toBe('Google Sheets');
    });

    it('should recognize skills in resume text using synonyms', () => {
      const text =
        'Built web applications using ReactJS, NodeJS, and ExpressJS. Managed database on MongoDB.';
      expect(matchesSkillInContext(text, 'React')).toBe(true);
      expect(matchesSkillInContext(text, 'Node.js')).toBe(true);
      expect(matchesSkillInContext(text, 'Express.js')).toBe(true);
      expect(matchesSkillInContext(text, 'MongoDB')).toBe(true);
    });
  });

  describe('4. Marketing, Video Editing, and UI/UX Matching and HR Routing', () => {
    it('should score and assign Digital Marketing Executive to HR2 (Jayendra)', () => {
      const marketingResume = `
        Neha Sharma
        Email: neha.marketing@example.com | Phone: 9811223344
        Summary: Digital Marketing Executive with 2 years experience driving growth through SEO, Google Ads, and Meta Ads.
        Skills: SEO, Search Engine Optimization, Google Ads, PPC, Social Media Marketing, Google Analytics GA4, Meta Ads Manager.
        Experience:
        - Digital Marketing Executive at GrowthAgency (2 years)
          * Managed Google Ads PPC campaigns with ROAS of 350%.
          * Increased organic website traffic by 65% via on-page and technical SEO.
          * Ran Meta Ads and managed social media channels.
      `;

      const role = getJobRoleByCanonical('DIGITAL_MARKETING_EXECUTIVE')!;
      const analysis = RoleScoringEngine.evaluateEvidence(
        marketingResume,
        role,
      );

      expect(analysis.matchScore).toBeGreaterThanOrEqual(60);
      expect(analysis.screeningStatus).toBe('SHORTLIST');

      const assignment = hrAssignmentService.assignHr(
        'Digital Marketing Executive',
        {
          matchScore: analysis.matchScore,
          screeningStatus: analysis.screeningStatus,
        },
      );

      expect(assignment).not.toBeNull();
      expect(assignment?.canonicalRole).toBe('DIGITAL_MARKETING_EXECUTIVE');
      expect(assignment?.id).toBe('hr-2');
      expect(assignment?.name).toBe('Jayendra');
    });

    it('should score and assign Video Editor to HR1 (Abhishek)', () => {
      const videoResume = `
        Aman Verma
        Email: aman.video@example.com | Phone: 9876543210
        Summary: Professional Video Editor skilled in Adobe Premiere Pro, DaVinci Resolve, and storytelling.
        Skills: Adobe Premiere Pro, DaVinci Resolve, Color Grading, Sound Design, Audio Mixing, After Effects, Transitions.
        Experience:
        - Video Editor at MediaHouse (1.5 years)
          * Edited engaging YouTube videos and short-form reels with dynamic pacing.
          * Performed color correction using Lumetri Color and sound mastering.
          * Created motion titles and lower thirds in After Effects.
      `;

      const role = getJobRoleByCanonical('VIDEO_EDITOR')!;
      const analysis = RoleScoringEngine.evaluateEvidence(videoResume, role);

      expect(analysis.matchScore).toBeGreaterThanOrEqual(60);
      expect(analysis.screeningStatus).toBe('SHORTLIST');

      const assignment = hrAssignmentService.assignHr('Video Editor', {
        matchScore: analysis.matchScore,
        screeningStatus: analysis.screeningStatus,
      });

      expect(assignment).not.toBeNull();
      expect(assignment?.canonicalRole).toBe('VIDEO_EDITOR');
      expect(assignment?.id).toBe('hr-1');
      expect(assignment?.name).toBe('Abhishek');
    });

    it('should score and assign UI/UX Designer to HR1 (Abhishek)', () => {
      const designResume = `
        Riya Sen
        Email: riya.ux@example.com | Phone: 9898989898
        Summary: UI/UX Designer passionate about crafting user-centered interfaces and design systems.
        Skills: Figma, User Research, Wireframing, Prototyping, Usability Testing, Information Architecture, Design Systems.
        Experience:
        - UI/UX Designer at ProductCraft (2 years)
          * Led end-to-end user research, persona creation, and user journey mapping.
          * Designed comprehensive design systems in Figma using auto layout and component variants.
          * Conducted usability testing sessions and iterated on interactive prototypes.
      `;

      const role = getJobRoleByCanonical('UI_UX_DESIGNER')!;
      const analysis = RoleScoringEngine.evaluateEvidence(designResume, role);

      expect(analysis.matchScore).toBeGreaterThanOrEqual(60);
      expect(analysis.screeningStatus).toBe('SHORTLIST');

      const assignment = hrAssignmentService.assignHr('UI/UX Designer', {
        matchScore: analysis.matchScore,
        screeningStatus: analysis.screeningStatus,
      });

      expect(assignment).not.toBeNull();
      expect(assignment?.canonicalRole).toBe('UI_UX_DESIGNER');
      expect(assignment?.id).toBe('hr-1');
      expect(assignment?.name).toBe('Abhishek');
    });
  });

  describe('5. Missing, Conflicting, and Insufficient Application Scenarios', () => {
    it('should flag conflict when subject specifies MERN and body specifies QA', () => {
      const res = roleDetectionService.resolveRole({
        subject: 'Application for MERN Stack Developer',
        emailBody: 'Dear HR, I am applying for the QA Engineer opening.',
      });

      expect(res.status).toBe('CONFLICT');
      expect(res.canonicalRole).toBeNull();
      expect(res.reason).toBe('ROLE_CONFLICT');

      // Conflict resolves to Manual Review in HR assignment
      const assignment = hrAssignmentService.assignHr(res.appliedRole);
      expect(assignment).toBeNull();
    });

    it('should handle unreadable/empty resumes without false zero scores', () => {
      const role = getJobRoleByCanonical('MERN_DEVELOPER')!;
      const analysis = RoleScoringEngine.evaluateEvidence(
        '   -- 1 of 1 --   ',
        role,
      );

      expect(analysis.matchScore).toBeNull();
      expect(analysis.screeningStatus).toBe('MANUAL_REVIEW');
      expect(analysis.hrReviewRequired).toBe(true);
      expect(analysis.rejectionReason).toBe('RESUME_EXTRACTION_INSUFFICIENT');
    });

    it('should route recruitment candidates scoring < 60 to Manual Review', () => {
      const assignment = hrAssignmentService.assignHr('HR Intern', {
        matchScore: 45,
        screeningStatus: 'MANUAL_REVIEW',
      });

      expect(assignment).not.toBeNull();
      expect(assignment?.id).toBe('hr-manual-review');
      expect(assignment?.name).toBe('Manual Review');
      expect(assignment?.canonicalRole).toBe('HR_INTERN');
    });
  });
});
