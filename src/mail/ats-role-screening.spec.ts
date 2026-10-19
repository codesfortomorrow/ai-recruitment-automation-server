import { RoleDetectionService } from './role-detection.service';
import { RoleScoringEngine } from './role-scoring-engine';
import { GeminiService } from './gemini.service';
import {
  getJobRoleByCanonical,
  matchesSkillInContext,
} from '../configs/job-roles.config';
import { validateApplicationAnalysis } from './gemini.types';
import { RedisService } from '../redis';

describe('Role-Based ATS Screening and Shortlisting (10 Core Scenarios)', () => {
  let roleDetectionService: RoleDetectionService;
  let mockRedisService: jest.Mocked<RedisService>;
  let geminiService: GeminiService;

  beforeEach(() => {
    roleDetectionService = new RoleDetectionService();

    mockRedisService = {
      client: {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(1),
        sadd: jest.fn().mockResolvedValue(1),
        smembers: jest.fn().mockResolvedValue([]),
      },
    } as any;

    const mockGeminiConfig = {
      apiKey: '',
      model: 'gemini-1.5-flash',
      maxRetries: 3,
      timeoutMs: 5000,
    };

    geminiService = new GeminiService(
      mockGeminiConfig as any,
      mockRedisService,
      roleDetectionService,
    );
  });

  // 1. A React/MERN resume is evaluated against a developer vacancy, not HR requirements
  it('1. A React/MERN resume is evaluated against a developer vacancy, not HR requirements', async () => {
    const mernResume = `
      Aman Verma
      Email: aman.verma@example.com | Phone: +91 9876543210
      Professional Full Stack Developer
      Skills: React.js, Node.js, Express.js, MongoDB, JavaScript, TypeScript, REST APIs, Git, Redux.
      Projects:
      - E-Commerce Web App: Built responsive frontend in React with Redux Toolkit and TailwindCSS.
      - RESTful Backend API: Designed Node.js and Express REST API with MongoDB/Mongoose database models.
      Experience:
      - Full Stack Developer (1 year): Developed full stack web applications, implemented JWT auth, and managed Git version control.
    `;

    const mernRole = getJobRoleByCanonical('MERN_DEVELOPER');
    expect(mernRole).toBeDefined();

    const analysis = RoleScoringEngine.evaluateEvidence(mernResume, mernRole);

    expect(analysis.matchScore).toBeGreaterThanOrEqual(60);
    expect(analysis.screeningStatus).toBe('SHORTLIST');
    expect(analysis.recommendedStatus).toBe('Shortlist');
    expect(analysis.application.jobRole).toBe('MERN Stack Developer');
    expect(analysis.appliedRole).toBe('MERN Stack Developer');
    expect(analysis.resolvedRole).toBe('MERN Stack Developer');
    // Ensure it did not apply HR criteria
    expect(
      analysis.matchedRequirements.some((r) =>
        r.toLowerCase().includes('react'),
      ),
    ).toBe(true);
    expect(
      analysis.matchedRequirements.some((r) =>
        r.toLowerCase().includes('node'),
      ),
    ).toBe(true);
  });

  // 2. An HR resume is evaluated against HR requirements
  it('2. An HR resume is evaluated against HR requirements', async () => {
    const hrResume = `
      Pooja Sharma
      Email: pooja.sharma@example.com | Phone: +91 9876543211
      HR Intern / Talent Acquisition Trainee
      Experience:
      - HR Intern at ABC Corp (4 months)
        * Handled end-to-end candidate sourcing on LinkedIn and job portals.
        * Conducted initial resume screening and scheduled interviews.
        * Coordinated candidate follow-ups and maintained recruitment trackers in Google Sheets.
      Skills: Candidate Sourcing, Interview Scheduling, LinkedIn Recruiter, Google Sheets, MS Excel, Candidate Screening.
    `;

    const hrRole = getJobRoleByCanonical('HR_INTERN');
    expect(hrRole).toBeDefined();

    const analysis = RoleScoringEngine.evaluateEvidence(hrResume, hrRole);

    expect(analysis.matchScore).toBeGreaterThanOrEqual(60);
    expect(analysis.screeningStatus).toBe('SHORTLIST');
    expect(analysis.recommendedStatus).toBe('Shortlist');
    expect(analysis.suggestedProfile).toBe('HR Intern');
    expect(
      analysis.scoreEvidence.recruitmentAndTalentAcquisition,
    ).toBeGreaterThan(0);
    expect(
      analysis.scoreEvidence.screeningSchedulingAndFollowups,
    ).toBeGreaterThan(0);
  });

  // 3. QA, digital marketing, video editing, and UI/UX applications use their correct rubrics
  it('3. QA, digital marketing, video editing, and UI/UX applications use their correct rubrics', () => {
    // QA Application
    const qaResume = `
      Rohan Mehta | rohan@example.com | 9876543212
      QA Automation Engineer
      Skills: Manual Testing, Automation Testing, Selenium, Test Cases, Defect Reporting, Jira, STLC, SDLC, Postman API Testing.
      Experience:
      - QA Tester (1.5 years): Created test scenarios, executed test suites, reported bugs in Jira, and verified API endpoints.
    `;
    const qaRole = getJobRoleByCanonical('QA_TESTER');
    const qaAnalysis = RoleScoringEngine.evaluateEvidence(qaResume, qaRole);
    expect(qaAnalysis.matchScore).toBeGreaterThanOrEqual(60);
    expect(qaAnalysis.appliedRole).toBe('QA Engineer');

    // Digital Marketing Application
    const mktResume = `
      Sneha Patel | sneha@example.com | 9876543213
      Digital Marketing Specialist
      Skills: SEO, Search Engine Optimization, SEM, Google Ads, Meta Ads, Social Media Marketing, Content Strategy, Google Analytics, GA4.
      Experience: Managed paid PPC campaigns, optimized on-page SEO, and grew social media engagement.
    `;
    const mktRole = getJobRoleByCanonical('DIGITAL_MARKETER');
    const mktAnalysis = RoleScoringEngine.evaluateEvidence(mktResume, mktRole);
    expect(mktAnalysis.matchScore).toBeGreaterThanOrEqual(60);
    expect(mktAnalysis.appliedRole).toBe('Digital Marketer');

    // Video Editing Application
    const videoResume = `
      Karan Johar | karan@example.com | 9876543214
      Video Editor & Motion Designer
      Skills: Adobe Premiere Pro, After Effects, Motion Graphics, Timeline Editing, Color Grading, Storytelling, Portfolio, YouTube Editing.
      Projects: Edited short films, corporate videos, and 2D animated explainers with high-retention pacing.
    `;
    const videoRole = getJobRoleByCanonical('VIDEO_EDITOR');
    const videoAnalysis = RoleScoringEngine.evaluateEvidence(
      videoResume,
      videoRole,
    );
    expect(videoAnalysis.matchScore).toBeGreaterThanOrEqual(60);
    expect(videoAnalysis.appliedRole).toBe('Video Editor');

    // UI/UX Application
    const designResume = `
      Ananya Sen | ananya@example.com | 9876543215
      UI/UX Designer
      Skills: Figma, Wireframing, Prototyping, User Research, Usability Testing, Design Systems, Mobile App UI, Responsive Web Design.
      Projects: Designed end-to-end FinTech mobile app in Figma with user journey flows and interactive prototypes.
    `;
    const designRole = getJobRoleByCanonical('UI_UX_DESIGNER');
    const designAnalysis = RoleScoringEngine.evaluateEvidence(
      designResume,
      designRole,
    );
    expect(designAnalysis.matchScore).toBeGreaterThanOrEqual(60);
    expect(designAnalysis.appliedRole).toBe('UI/UX Designer');
  });

  // 4. Technology aliases match correctly without confusing Java and JavaScript
  it('4. Technology aliases match correctly without confusing Java and JavaScript', () => {
    // Aliases normalization
    expect(
      matchesSkillInContext('Proficient in React.js and ReactJS', 'React'),
    ).toBe(true);
    expect(
      matchesSkillInContext(
        'Experienced with Node.js and NodeJS runtime',
        'Node.js',
      ),
    ).toBe(true);
    expect(
      matchesSkillInContext(
        'Solid knowledge of JS and modern ECMAScript',
        'JavaScript',
      ),
    ).toBe(true);

    // Strict boundary: Java must NEVER match JavaScript or JS
    const jsOnlyText = 'Experienced in JavaScript, React.js, Node.js, and ES6.';
    expect(matchesSkillInContext(jsOnlyText, 'Java')).toBe(false);
    expect(matchesSkillInContext(jsOnlyText, 'JavaScript')).toBe(true);

    const javaOnlyText =
      'Core Java developer with Spring Boot and Hibernate experience.';
    expect(matchesSkillInContext(javaOnlyText, 'Java')).toBe(true);
    expect(matchesSkillInContext(javaOnlyText, 'JavaScript')).toBe(false);
  });

  // 5. Missing or conflicting vacancy information triggers manual review
  it('5. Missing or conflicting vacancy information triggers manual review', async () => {
    // Conflicting vacancy (Subject = MERN, Body = QA)
    const conflictResult = await geminiService.analyzeApplication({
      messageId: 'msg-conflict-1',
      subject: 'Application for MERN Stack Developer - Amit Roy',
      sender: { email: 'amit@example.com', name: 'Amit Roy' },
      emailBody:
        'Dear Hiring Manager, I am applying for the QA Engineer opening at your company.',
      resumeText: 'Resume text with various skills.',
    });

    expect(conflictResult.status).toBe('success');
    expect(conflictResult.analysis).toBeDefined();
    expect(conflictResult.analysis?.matchScore).toBeNull();
    expect(conflictResult.analysis?.screeningStatus).toBe('MANUAL_REVIEW');
    expect(conflictResult.analysis?.recommendedStatus).toBe(
      'Requires Human Review',
    );
    expect(conflictResult.analysis?.hrReviewRequired).toBe(true);
    expect(conflictResult.analysis?.rejectionReason).toBe('ROLE_CONFLICT');

    // Missing vacancy (Subject gives no clue, body is generic)
    const missingResult = await geminiService.analyzeApplication({
      messageId: 'msg-missing-1',
      subject: 'My CV',
      sender: { email: 'unknown@example.com', name: 'Unknown' },
      emailBody: 'Please find attached my CV for consideration.',
      resumeText: 'General resume content.',
    });

    expect(missingResult.status).toBe('success');
    expect(missingResult.analysis?.matchScore).toBeNull();
    expect(missingResult.analysis?.screeningStatus).toBe('MANUAL_REVIEW');
    expect(missingResult.analysis?.recommendedStatus).toBe(
      'Requires Human Review',
    );
    expect(missingResult.analysis?.hrReviewRequired).toBe(true);
    expect(missingResult.analysis?.rejectionReason).toBe('ROLE_UNDETECTED');
  });

  // 6. An unreadable resume receives a null score, not zero
  it('6. An unreadable resume receives a null score, not zero', async () => {
    const unreadableResult = await geminiService.analyzeApplication({
      messageId: 'msg-unreadable-1',
      subject: 'Application for React Developer',
      sender: { email: 'candidate@example.com', name: 'Test Candidate' },
      jobRole: 'React Developer',
      resumeText: '-- 1 of 1 --', // Footer only / empty extraction
    });

    expect(unreadableResult.status).toBe('success');
    expect(unreadableResult.analysis).toBeDefined();
    expect(unreadableResult.analysis?.matchScore).toBeNull();
    expect(unreadableResult.analysis?.matchScore).not.toBe(0);
    expect(unreadableResult.analysis?.screeningStatus).toBe('MANUAL_REVIEW');
    expect(unreadableResult.analysis?.recommendedStatus).toBe(
      'Requires Human Review',
    );
    expect(unreadableResult.analysis?.hrReviewRequired).toBe(true);
    expect(unreadableResult.analysis?.rejectionReason).toBe(
      'RESUME_EXTRACTION_INSUFFICIENT',
    );
  });

  // 7. A fresher is not automatically penalized for having no professional experience
  it('7. A fresher is not automatically penalized for having no professional experience', () => {
    const fresherResume = `
      Kavita Jain
      Email: kavita@example.com | Phone: 9876543299
      Fresh Computer Science Graduate (2026 Batch)
      Summary: Enthusiastic fresher with strong foundational skills in React, JavaScript, and Node.js.
      Technical Skills: React.js, JavaScript, HTML, CSS, REST APIs, Git, GitHub.
      Academic Projects:
      - Social Media Dashboard: Designed component hierarchy, state management using React hooks, and integrated mock REST APIs.
      - Portfolio Website: Deployed personal portfolio on GitHub Pages using modern responsive CSS.
    `;

    const reactRole = getJobRoleByCanonical('REACT_DEVELOPER');
    expect(reactRole).toBeDefined();

    const analysis = RoleScoringEngine.evaluateEvidence(
      fresherResume,
      reactRole,
    );

    expect(analysis.matchScore).toBeGreaterThanOrEqual(60);
    expect(analysis.screeningStatus).toBe('SHORTLIST');
    expect(analysis.recommendedStatus).toBe('Shortlist');
    expect(analysis.experienceCategory).toBe(
      'Fresher / no professional experience',
    );
    expect(analysis.rejectionReason).toBeFalsy();
  });

  // 8. Scores below 60 do not automatically reject candidates
  it('8. Scores below 60 do not automatically reject candidates', () => {
    const lowMatchResume = `
      Deepak Kumar
      Email: deepak@example.com | Phone: 9876543288
      Basic computer knowledge and some interest in web design.
      Skills: HTML, Microsoft Office, Typing.
    `;

    const mernRole = getJobRoleByCanonical('MERN_DEVELOPER');
    const analysis = RoleScoringEngine.evaluateEvidence(
      lowMatchResume,
      mernRole,
    );

    expect(analysis.matchScore).toBeLessThan(60);
    expect(analysis.screeningStatus).toBe('MANUAL_REVIEW'); // Never automatically REJECT!
    expect(analysis.hrReviewRequired).toBe(true);
  });

  // 9. Gemini-unavailable fallback uses the correct role or safely requests manual review
  it('9. Gemini-unavailable fallback uses the correct role or safely requests manual review', async () => {
    // When API key is empty, geminiService uses fallback
    expect(geminiService.isConfigured()).toBe(false);

    // Resolved role fallback
    const resolvedResult = await geminiService.analyzeApplication({
      messageId: 'msg-fallback-dev',
      subject: 'Application for Node.js Developer - Ritesh Shah',
      sender: { email: 'ritesh@example.com', name: 'Ritesh Shah' },
      resumeText: `
        Ritesh Shah | ritesh@example.com | 9876543277
        Node.js Backend Developer
        Skills: Node.js, Express.js, REST APIs, PostgreSQL, MongoDB, Docker, Git.
        Experience: 2 years building backend microservices and RESTful APIs in Node.js.
      `,
    });

    expect(resolvedResult.status).toBe('success');
    expect(resolvedResult.model).toBe('built-in-cft-engine');
    expect(resolvedResult.analysis?.appliedRole).toBe('Node.js Developer');
    expect(resolvedResult.analysis?.resolvedRole).toBe('Node.js Developer');
    expect(resolvedResult.analysis?.matchScore).toBeGreaterThanOrEqual(60);

    // Unresolved role fallback
    const unknownResult = await geminiService.analyzeApplication({
      messageId: 'msg-fallback-unknown',
      subject: 'Inquiry',
      sender: { email: 'random@example.com' },
      resumeText: 'Some resume with ambiguous contents.',
    });

    expect(unknownResult.status).toBe('success');
    expect(unknownResult.model).toBe('built-in-cft-engine');
    expect(unknownResult.analysis?.matchScore).toBeNull();
    expect(unknownResult.analysis?.screeningStatus).toBe('MANUAL_REVIEW');
    expect(unknownResult.analysis?.recommendedStatus).toBe(
      'Requires Human Review',
    );
    expect(unknownResult.analysis?.rejectionReason).toBe('ROLE_UNDETECTED');
  });

  // 10. Existing API contracts, notifications, caching, and legacy records remain compatible
  it('10. Existing API contracts, notifications, caching, and legacy records remain compatible', async () => {
    // Validation of role-neutral output
    const mockOutput = {
      candidate: {
        name: 'Legacy Test',
        email: 'legacy@example.com',
        phone: '9876543210',
      },
      application: {
        jobRole: 'MERN Stack Developer',
        skills: ['React', 'Node.js'],
        projects: [],
        education: [],
        experience: [],
      },
      summary: 'Candidate demonstrates solid MERN skills.',
      matchScore: 75,
      matchedRequirements: ['React', 'Node.js'],
      missingOrUnclearRequirements: [],
      screeningStatus: 'SHORTLIST',
      screeningExplanation: 'Strong fit for MERN Stack Developer role.',
      hrReviewRequired: false,
      experienceCategory: 'Fresher / no professional experience',
      relevantExperienceResponsibilities: ['React frontend development'],
      scoreEvidence: {
        evidenceNotes: 'Evaluated against MERN rubric',
      },
      missingOrUnclearInformation: [],
      strengthsAgainstJd: ['React', 'Node.js'],
      gapsAgainstJd: [],
      suggestedProfile: 'MERN Stack Developer',
      recommendedStatus: 'Shortlist',
      appliedRole: 'MERN Stack Developer',
      resolvedRole: 'MERN Stack Developer',
    };

    const validation = validateApplicationAnalysis(mockOutput);
    expect(validation.valid).toBe(true);
    expect(validation.analysis?.matchScore).toBe(75);
    expect(validation.analysis?.appliedRole).toBe('MERN Stack Developer');
    expect(validation.analysis?.resolvedRole).toBe('MERN Stack Developer');
    expect(validation.analysis?.screeningStatus).toBe('SHORTLIST');

    // Validation when matchScore is null
    const nullScoreOutput = {
      ...mockOutput,
      matchScore: null,
      screeningStatus: 'MANUAL_REVIEW',
      recommendedStatus: 'Requires Human Review',
      hrReviewRequired: true,
      rejectionReason: 'RESUME_EXTRACTION_INSUFFICIENT',
    };
    const nullValidation = validateApplicationAnalysis(nullScoreOutput);
    expect(nullValidation.valid).toBe(true);
    expect(nullValidation.analysis?.matchScore).toBeNull();
    expect(nullValidation.analysis?.screeningStatus).toBe('MANUAL_REVIEW');
    expect(nullValidation.analysis?.recommendedStatus).toBe(
      'Requires Human Review',
    );

    // Redis caching compatibility
    const input = {
      messageId: 'msg-cache-compat-1',
      attachmentId: 'att-compat-1',
      subject: 'Application for React Developer',
      sender: { email: 'react@example.com', name: 'React Dev' },
      resumeText: 'React.js Developer with hooks and Redux experience.',
    };

    const run1 = await geminiService.analyzeApplication(input);
    expect(mockRedisService.client.set).toHaveBeenCalled();

    // Mock cache hit for subsequent call
    (mockRedisService.client.get as jest.Mock).mockResolvedValueOnce(
      JSON.stringify(run1),
    );
    const run2 = await geminiService.analyzeApplication(input);
    expect(run2.analysis?.matchScore).toEqual(run1.analysis?.matchScore);
  });
});
