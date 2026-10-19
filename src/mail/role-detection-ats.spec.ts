import { RoleDetectionService } from './role-detection.service';
import { RoleScoringEngine } from './role-scoring-engine';
import { GeminiService } from './gemini.service';
import { HrAssignmentService } from '../candidate/hr-assignment.service';
import { getJobRoleByCanonical } from '../configs/job-roles.config';
import { RedisService } from '../redis';

describe('ATS Role Detection and Resume Matching Workflow (10 Core Scenarios)', () => {
  let roleDetectionService: RoleDetectionService;
  let hrAssignmentService: HrAssignmentService;
  let mockRedisService: jest.Mocked<RedisService>;
  let geminiService: GeminiService;

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
    );
  });

  // Scenario 1: Email subject identifies a MERN role
  it('Scenario 1: Email subject identifies a MERN role', () => {
    const result = roleDetectionService.resolveRole({
      subject: 'Application for MERN Stack Developer - Rahul Verma',
      emailBody: 'Dear Hiring Team, please find my resume attached.',
    });

    expect(result.status).toBe('RESOLVED');
    expect(result.canonicalRole).toBe('MERN_DEVELOPER');
    expect(result.role?.title).toBe('MERN Stack Developer');
    expect(result.source).toBe('SUBJECT');
  });

  // Scenario 2: Email body identifies a QA role
  it('Scenario 2: Email body identifies a QA role', () => {
    const result = roleDetectionService.resolveRole({
      subject: 'Job Application - Priya Sharma',
      emailBody:
        'Hello team, I am applying for QA Engineer role at Codes for Tomorrow. I have 1.5 years experience in manual and automation testing.',
    });

    expect(result.status).toBe('RESOLVED');
    expect(result.canonicalRole).toBe('QA_TESTER');
    expect(result.role?.title).toBe('QA Engineer');
    expect(result.source).toBe('BODY');
  });

  // Scenario 3: HR Intern applications use HR requirements
  it('Scenario 3: HR Intern applications use HR requirements', () => {
    const hrResume = `
      Simran Kaur
      Email: simran.k@example.com | Phone: 9876543210
      Summary: Enthusiastic MBA HR graduate looking for HR Internship.
      Experience:
      - HR Intern at ABC Corp (3 months)
        * Sourced profiles using LinkedIn and Naukri job portal.
        * Conducted initial screening of candidate resumes and scheduled technical rounds.
        * Followed up with candidates and maintained candidate pipeline trackers in Google Sheets.
      Skills: Candidate Screening, Interview Scheduling, LinkedIn Recruiter, MS Excel, Google Sheets, Communication.
    `;

    const hrRole = getJobRoleByCanonical('HR_INTERN');
    expect(hrRole).toBeDefined();

    const analysis = RoleScoringEngine.evaluateEvidence(hrResume, hrRole);

    expect(analysis.matchScore).toBeGreaterThanOrEqual(60);
    expect(analysis.suggestedProfile).toBe('HR Intern');
    expect(analysis.screeningStatus).toBe('SHORTLIST');
    expect(analysis.matchedRequirements.length).toBeGreaterThan(0);
    expect(
      analysis.matchedRequirements.some(
        (r) =>
          r.toLowerCase().includes('recruitment') ||
          r.toLowerCase().includes('sourcing') ||
          r.toLowerCase().includes('screening'),
      ),
    ).toBe(true);
  });

  // Scenario 4: A technical candidate is not scored against HR requirements
  it('Scenario 4: A technical candidate is not scored against HR requirements', () => {
    const mernResume = `
      Ankit Mehta
      Email: ankit.m@example.com | Phone: 9811223344
      Summary: Full Stack JavaScript Developer with strong expertise in MERN stack.
      Technical Skills: React.js, Node.js, Express.js, MongoDB, Redux, REST APIs, Git, JavaScript, TypeScript.
      Experience:
      - Full Stack Developer at TechVentures (1 Year)
        * Developed responsive frontend applications in React.js and Redux.
        * Built robust RESTful backend APIs with Node.js and Express.js.
        * Designed MongoDB schemas with Mongoose and optimized aggregation pipelines.
        * Implemented JWT authentication and role-based access control.
      Projects:
      - E-Commerce Web App (React, Node, Express, MongoDB)
      - Task Management Dashboard (MERN Stack)
    `;

    const mernRole = getJobRoleByCanonical('MERN_DEVELOPER');
    expect(mernRole).toBeDefined();

    // Score against MERN role
    const mernAnalysis = RoleScoringEngine.evaluateEvidence(
      mernResume,
      mernRole,
    );
    expect(mernAnalysis.matchScore).toBeGreaterThanOrEqual(65);
    expect(mernAnalysis.suggestedProfile).toBe('MERN Stack Developer');
    expect(mernAnalysis.screeningStatus).toBe('SHORTLIST');
    expect(
      mernAnalysis.matchedRequirements.some(
        (r) =>
          r.toLowerCase().includes('react') ||
          r.toLowerCase().includes('node') ||
          r.toLowerCase().includes('mongodb') ||
          r.toLowerCase().includes('express'),
      ),
    ).toBe(true);

    // If evaluated under old default (HR requirements), the same candidate would have scored poorly (< 40)
    const hrRole = getJobRoleByCanonical('HR_INTERN');
    const hrAnalysis = RoleScoringEngine.evaluateEvidence(mernResume, hrRole);
    expect(hrAnalysis.matchScore).toBeLessThan(40);
    expect(hrAnalysis.experienceCategory).toBe('Other or unrelated experience');
  });

  // Scenario 5: Subject and body conflict results in review when the role cannot be reliably resolved
  it('Scenario 5: Subject and body conflict results in review when the role cannot be reliably resolved', () => {
    const result = roleDetectionService.resolveRole({
      subject: 'Application for MERN Stack Developer',
      emailBody:
        'Respected Sir, I am writing to apply for the QA Engineer opening at your organization.',
    });

    expect(result.status).toBe('CONFLICT');
    expect(result.role).toBeNull();
    expect(result.canonicalRole).toBeNull();
    expect(result.reason).toBe('ROLE_CONFLICT');
    expect(result.explanation).toContain('ROLE_CONFLICT');

    // HR assignment routes conflict to manual review
    const hrAssignment = hrAssignmentService.assignHr(result.appliedRole, {
      matchScore: null,
      screeningStatus: 'MANUAL_REVIEW',
      hrReviewRequired: true,
      missingRequirements: ['ROLE_CONFLICT'],
    });

    expect(hrAssignment).toBeNull(); // routes to manual review fallback
  });

  // Scenario 6: Missing role information does not default to HR Intern
  it('Scenario 6: Missing role information does not default to HR Intern', () => {
    const result = roleDetectionService.resolveRole({
      subject: 'Job Application - CV Attached',
      emailBody: 'Please find attached my resume for your consideration.',
    });

    expect(result.status).toBe('UNRESOLVED');
    expect(result.role).toBeNull();
    expect(result.canonicalRole).toBeNull();
    expect(result.appliedRole).not.toBe('HR Intern');
    expect(result.reason).toBe('ROLE_UNDETECTED');

    // Verify it routes to manual review and does not assign HR2/Jayendra as HR Intern
    const hrAssignment = hrAssignmentService.assignHr(result.appliedRole, {
      matchScore: null,
      screeningStatus: 'MANUAL_REVIEW',
      hrReviewRequired: true,
    });
    expect(hrAssignment).toBeNull();
  });

  // Scenario 7: Empty or unreadable resume text does not receive a false zero score
  it('Scenario 7: Empty or unreadable resume text does not receive a false zero score', () => {
    const emptyAnalysis = RoleScoringEngine.evaluateEvidence(
      ' -- 1 of 1 -- ',
      getJobRoleByCanonical('MERN_DEVELOPER'),
    );

    expect(emptyAnalysis.matchScore).toBeNull();
    expect(emptyAnalysis.matchScore).not.toBe(0);
    expect(emptyAnalysis.rejectionReason).toBe(
      'RESUME_EXTRACTION_INSUFFICIENT',
    );
    expect(emptyAnalysis.screeningStatus).toBe('MANUAL_REVIEW');
    expect(emptyAnalysis.hrReviewRequired).toBe(true);
    expect(emptyAnalysis.screeningExplanation).toContain(
      'RESUME_EXTRACTION_INSUFFICIENT',
    );
  });

  // Scenario 8: The correct role-specific rubric is passed to ATS scoring
  it('Scenario 8: The correct role-specific rubric is passed to ATS scoring', () => {
    const mernRole = getJobRoleByCanonical('MERN_DEVELOPER');
    const qaRole = getJobRoleByCanonical('QA_TESTER');
    const hrRole = getJobRoleByCanonical('HR_INTERN');

    expect(mernRole?.scoringRubric.map((r) => r.name)).toEqual([
      'frontendReact',
      'backendNodeExpress',
      'databaseMongo',
      'practicalFullStackProjects',
      'architectureAndAuth',
      'codeQualityAndTesting',
    ]);

    expect(qaRole?.scoringRubric.map((r) => r.name)).toEqual([
      'testingMethodologies',
      'testCaseDesign',
      'defectReporting',
      'apiTesting',
      'automationBasics',
      'sqlVerification',
    ]);

    expect(hrRole?.scoringRubric.map((r) => r.name)).toEqual([
      'recruitmentAndTalentAcquisition',
      'practicalInternshipOrWork',
      'screeningSchedulingAndFollowups',
      'sourcingChannels',
      'communicationAndCoordination',
      'excelOrGoogleSheets',
      'otherHrOperations',
    ]);
  });

  // Scenario 9: The resolved role is persisted and the configured HR/team is assigned
  it('Scenario 9: The resolved role is persisted and the configured HR/team is assigned', () => {
    // 1. MERN Developer -> HR1 (Abhishek)
    const mernAssignment = hrAssignmentService.assignHr(
      'MERN Stack Developer',
      {
        matchScore: 80,
        screeningStatus: 'SHORTLIST',
      },
    );
    expect(mernAssignment).toBeDefined();
    expect(mernAssignment?.name).toBe('Abhishek');
    expect(mernAssignment?.email).toBe('abhishek.goud.mongoosetech@gmail.com');
    expect(mernAssignment?.canonicalRole).toBe('MERN_DEVELOPER');

    // 2. QA Engineer -> HR2 (Jayendra)
    const qaAssignment = hrAssignmentService.assignHr('QA Engineer', {
      matchScore: 85,
      screeningStatus: 'SHORTLIST',
    });
    expect(qaAssignment).toBeDefined();
    expect(qaAssignment?.name).toBe('Jayendra');
    expect(qaAssignment?.email).toBe('jayendrabamne.mongoosetech@gmail.com');
    expect(qaAssignment?.canonicalRole).toBe('QA_TESTER');

    // 3. HR Intern with score >= 60 -> HR2 (Jayendra)
    const hrShortlistAssignment = hrAssignmentService.assignHr('HR Intern', {
      matchScore: 70,
      screeningStatus: 'SHORTLIST',
    });
    expect(hrShortlistAssignment).toBeDefined();
    expect(hrShortlistAssignment?.name).toBe('Jayendra');

    // 4. HR Intern with score < 60 -> Manual Review
    const hrReviewAssignment = hrAssignmentService.assignHr('HR Intern', {
      matchScore: 45,
      screeningStatus: 'MANUAL_REVIEW',
    });
    expect(hrReviewAssignment?.name).toBe('Manual Review');
    expect(hrReviewAssignment?.id).toBe('hr-manual-review');
    expect(hrReviewAssignment?.email).toBe('hr-review@codesfortomorrow.com');
  });

  // Scenario 10: Existing duplicate and retry protections continue working
  it('Scenario 10: Existing duplicate and retry protections continue working', async () => {
    const mockAnalysisResult = {
      attachmentId: 'att-mern-1',
      filename: 'MERN_Dev_Resume.pdf',
      status: 'success' as const,
      analysis: {
        candidate: { name: 'Vikram', email: 'vikram@example.com', phone: null },
        application: {
          jobRole: 'MERN Stack Developer',
          skills: ['React', 'Node.js'],
          projects: [],
          education: [],
          experience: [],
        },
        summary: 'Solid MERN profile',
        matchScore: 80,
        matchedRequirements: ['React', 'Node.js', 'MongoDB'],
        missingOrUnclearRequirements: [],
        screeningStatus: 'SHORTLIST' as const,
        screeningExplanation: 'Passed MERN rubric',
        hrReviewRequired: false,
        experienceCategory: 'Relevant recruitment work experience' as const,
        relevantExperienceResponsibilities: [],
        scoreEvidence: {} as any,
        missingOrUnclearInformation: [],
        strengthsAgainstJd: ['React', 'Node.js'],
        gapsAgainstJd: [],
        suggestedProfile: 'MERN Stack Developer',
        recommendedStatus: 'Shortlist' as const,
      },
      analyzedAt: new Date().toISOString(),
      model: 'built-in-cft-engine',
    };

    // First call: returns analysis and caches in Redis
    const firstResult = await geminiService.analyzeApplication({
      messageId: 'msg-mern-001',
      subject: 'Application for MERN Stack Developer',
      sender: { name: 'Vikram', email: 'vikram@example.com' },
      resumeText:
        'Full Stack MERN Developer React Node.js Express MongoDB with 2 years experience.',
      filename: 'MERN_Dev_Resume.pdf',
      attachmentId: 'att-mern-1',
    });

    expect(firstResult.status).toBe('success');
    expect(firstResult.analysis?.suggestedProfile).toBe('MERN Stack Developer');

    // Second call with cached response: Redis hit returns cached result
    mockRedisService.client.get = jest
      .fn()
      .mockResolvedValue(JSON.stringify(mockAnalysisResult));

    const cachedResult = await geminiService.analyzeApplication({
      messageId: 'msg-mern-001',
      subject: 'Application for MERN Stack Developer',
      sender: { name: 'Vikram', email: 'vikram@example.com' },
      resumeText:
        'Full Stack MERN Developer React Node.js Express MongoDB with 2 years experience.',
      filename: 'MERN_Dev_Resume.pdf',
      attachmentId: 'att-mern-1',
    });

    expect(cachedResult.status).toBe('success');
    expect(cachedResult.analysis?.matchScore).toBe(80);
    expect(cachedResult.analysis?.suggestedProfile).toBe(
      'MERN Stack Developer',
    );
  });
});
