import { Test, TestingModule } from '@nestjs/testing';
import { GeminiService } from './gemini.service';
import { RedisService } from '../redis';
import { geminiConfigFactory } from '@Config';
import { validateApplicationAnalysis } from './gemini.types';

describe('Codes for Tomorrow HR Resume Screening Logic', () => {
  let service: GeminiService;

  const mockRedisService = {
    client: {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
    },
  };

  const mockGeminiConfig = {
    apiKey: '', // Exercises built-in deterministic evaluation engine
    model: 'gemini-2.5-flash',
    maxRetries: 1,
    timeoutMs: 5000,
    temperature: 0.2,
    maxOutputTokens: 2048,
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: geminiConfigFactory.KEY,
          useValue: mockGeminiConfig,
        },
      ],
    }).compile();

    service = module.get<GeminiService>(GeminiService);
  });

  describe('1. Fresher / No Professional Experience Candidate', () => {
    const fresherResume = `
      Aman Sharma
      Email: aman.sharma@example.com
      Phone: 9876543210
      Education:
      - BBA (Human Resources), Devi Ahilya University, Indore (2024 graduate)
      - Relevant Coursework: Principles of Talent Acquisition, Human Resource Management, Organizational Behavior
      
      Academic Projects & Leadership:
      - Campus Recruitment Project: Researched IT hiring trends, talent acquisition workflows, and candidate interview processes.
      - Placement Committee Student Coordinator: Coordinated with college recruiters, managed candidate interview schedules, handled candidate queries, and demonstrated strong written and verbal communication.
      
      Skills:
      - HR Concepts & Talent Acquisition Fundamentals
      - MS Excel & Google Sheets (VLOOKUP, Pivot Tables, candidate trackers)
      - Interview Coordination & Candidate Engagement
      - Team Coordination & Interpersonal Communication
    `;

    it('should classify experience as "Fresher / no professional experience"', () => {
      const result = service.evaluateHrResumeEvidence(fresherResume, {
        name: 'Aman Sharma',
        email: 'aman.sharma@example.com',
      });

      expect(result.experienceCategory).toBe(
        'Fresher / no professional experience',
      );
    });

    it('should NOT award relevant practical experience points for freshers', () => {
      const result = service.evaluateHrResumeEvidence(fresherResume);
      expect(result.scoreEvidence.practicalInternshipOrWork).toBe(0);
    });

    it('should award points for HR knowledge, communication, scheduling concepts, and Excel', () => {
      const result = service.evaluateHrResumeEvidence(fresherResume);
      expect(
        result.scoreEvidence.recruitmentAndTalentAcquisition,
      ).toBeGreaterThan(0);
      expect(
        result.scoreEvidence.communicationAndCoordination,
      ).toBeGreaterThanOrEqual(7);
      expect(result.scoreEvidence.excelOrGoogleSheets).toBeGreaterThanOrEqual(
        7,
      );
      expect(result.matchScore).toBeGreaterThanOrEqual(40);
      expect(result.matchScore).toBeLessThan(65);
    });

    it('should suggest HR Intern profile and route to HR Review (MANUAL_REVIEW) - NOT auto-rejected', () => {
      const result = service.evaluateHrResumeEvidence(fresherResume);

      expect(result.suggestedProfile).toBe('HR Intern');
      expect(result.recommendedStatus).toBe('HR Review');
      expect(result.screeningStatus).toBe('MANUAL_REVIEW');
      expect(result.screeningStatus).not.toBe('REJECT');
      expect(result.hrReviewRequired).toBe(true);
      expect(result.strengthsAgainstJd.length).toBeGreaterThan(0);
    });
  });

  describe('2. Relevant HR Intern Candidate', () => {
    const hrInternResume = `
      Priya Patel
      Email: priya.patel@example.com | Phone: +91 9123456780
      Professional Experience:
      - HR Intern | TechSolutions Pvt Ltd (6 Months: Jan 2024 - Jun 2024)
        * Sourced active candidate profiles using LinkedIn and job portals like Naukri and Internshala.
        * Conducted initial resume screening and telephonic screening for 80+ candidates.
        * Managed interview scheduling on Google Meet and coordinated with hiring managers.
        * Maintained daily candidate tracking pipeline in Google Sheets using filters and status tags.
        * Handled candidate follow-ups, interview reminders, and assisted in onboarding documentation.
      
      Education:
      - MBA in Human Resource Management (2024)
      
      Skills:
      - Talent Acquisition & Sourcing (LinkedIn, Naukri, Portals)
      - Resume Screening & Telephonic Rounds
      - Interview Scheduling & Calendar Management
      - Google Sheets / Excel (Candidate Trackers, VLOOKUP)
      - Strong Communication & Candidate Follow-up
    `;

    it('should classify as "Relevant HR or recruitment internship"', () => {
      const result = service.evaluateHrResumeEvidence(hrInternResume);
      expect(result.experienceCategory).toBe(
        'Relevant HR or recruitment internship',
      );
    });

    it('should score 65+ across recruitment, screening, sourcing, communication, and Excel rubrics', () => {
      const result = service.evaluateHrResumeEvidence(hrInternResume);

      expect(
        result.scoreEvidence.recruitmentAndTalentAcquisition,
      ).toBeGreaterThanOrEqual(18);
      expect(
        result.scoreEvidence.practicalInternshipOrWork,
      ).toBeGreaterThanOrEqual(14);
      expect(
        result.scoreEvidence.screeningSchedulingAndFollowups,
      ).toBeGreaterThanOrEqual(10);
      expect(result.scoreEvidence.sourcingChannels).toBeGreaterThanOrEqual(6);
      expect(result.scoreEvidence.excelOrGoogleSheets).toBeGreaterThanOrEqual(
        7,
      );
      expect(result.matchScore).toBeGreaterThanOrEqual(65);
    });

    it('should route to Shortlist for HR consideration', () => {
      const result = service.evaluateHrResumeEvidence(hrInternResume);

      expect(result.suggestedProfile).toBe('HR Intern');
      expect(result.recommendedStatus).toBe('Shortlist');
      expect(result.screeningStatus).toBe('SHORTLIST');
      expect(result.hrReviewRequired).toBe(false);
      expect(result.relevantExperienceResponsibilities.length).toBeGreaterThan(
        0,
      );
    });
  });

  describe('3. Candidate with Recruitment Work Experience', () => {
    const recruiterResume = `
      Rohit Verma
      Email: rohit.verma@example.com | Phone: +91 9811223344
      Professional Experience:
      - Talent Acquisition Specialist | CloudHire Technologies (1.5 Years: 2023 - Present)
        * Managed full cycle recruitment and end-to-end recruitment lifecycle for technical and business roles.
        * Sourced candidates using LinkedIn Recruiter, Naukri, Indeed, and employee referrals.
        * Conducted preliminary resume screening, HR interviews, and salary discussions.
        * Scheduled technical rounds, coordinated with department heads, and tracked status updates.
        * Built advanced candidate tracking pipelines in MS Excel with pivot tables and weekly reports.
        * Administered offer letters, onboarding documentation, background verification, and HR policies.
      
      Education:
      - Bachelor of Technology + Diploma in HR Management
      
      Key Competencies:
      - Full-cycle recruitment & talent acquisition
      - LinkedIn Recruiter, Naukri, Indeed, Job boards
      - Candidate screening & interview scheduling
      - Advanced Excel & Google Sheets (reporting, dashboards)
      - Onboarding, HR documentation, and stakeholder coordination
    `;

    it('should classify as "Relevant recruitment work experience"', () => {
      const result = service.evaluateHrResumeEvidence(recruiterResume);
      expect(result.experienceCategory).toBe(
        'Relevant recruitment work experience',
      );
    });

    it('should suggest "HR Associate / HR Executive" profile', () => {
      const result = service.evaluateHrResumeEvidence(recruiterResume);
      expect(result.suggestedProfile).toBe('HR Associate / HR Executive');
    });

    it('should score high (>= 65) and route to Shortlist', () => {
      const result = service.evaluateHrResumeEvidence(recruiterResume);

      expect(result.matchScore).toBeGreaterThanOrEqual(75);
      expect(result.recommendedStatus).toBe('Shortlist');
      expect(result.screeningStatus).toBe('SHORTLIST');
      expect(result.hrReviewRequired).toBe(false);
      expect(
        result.scoreEvidence.recruitmentAndTalentAcquisition,
      ).toBeGreaterThanOrEqual(25);
      expect(
        result.scoreEvidence.practicalInternshipOrWork,
      ).toBeGreaterThanOrEqual(18);
    });
  });

  describe('4. Unrelated Intern (Non-HR Background)', () => {
    const developerResume = `
      Neha Gupta
      Email: neha.gupta@example.com | Phone: +91 9776655443
      Experience:
      - Frontend Developer Intern | WebStudio Labs (4 Months)
        * Developed responsive landing pages using React, HTML5, CSS3, and JavaScript.
        * Designed UI wireframes and banners in Figma and Adobe Photoshop.
        * Collaborated with team members on GitHub repositories.
      
      Education:
      - B.Tech in Computer Science (2024)
      
      Skills:
      - React.js, JavaScript, HTML, CSS, Figma, Git
      - Basic communication and computer operations
    `;

    it('should classify as "Other or unrelated experience"', () => {
      const result = service.evaluateHrResumeEvidence(developerResume);
      expect(result.experienceCategory).toBe('Other or unrelated experience');
    });

    it('should award 0 points for practical recruitment experience', () => {
      const result = service.evaluateHrResumeEvidence(developerResume);
      expect(result.scoreEvidence.practicalInternshipOrWork).toBe(0);
      expect(result.scoreEvidence.recruitmentAndTalentAcquisition).toBe(0);
      expect(result.scoreEvidence.screeningSchedulingAndFollowups).toBe(0);
    });

    it('should score below 40 and route to "HR Review before rejection" - NOT auto-rejected', () => {
      const result = service.evaluateHrResumeEvidence(developerResume);

      expect(result.matchScore).toBeLessThan(40);
      expect(result.recommendedStatus).toBe('Not Shortlisted');
      expect(result.screeningStatus).toBe('MANUAL_REVIEW');
      expect(result.screeningStatus).not.toBe('REJECT'); // Must NOT automatically reject!
      expect(result.hrReviewRequired).toBe(true);
      expect(result.gapsAgainstJd.length).toBeGreaterThan(0);
    });
  });

  describe('5. Resume with Insufficient / Unclear Information', () => {
    const sparseResume = `
      Vikas Kumar
      Phone: 9988776655
      Email: vikas.kumar@example.com
      Looking for an HR job opportunity.
    `;

    it('should classify as "Unclear / insufficient information"', () => {
      const result = service.evaluateHrResumeEvidence(sparseResume);
      expect(result.experienceCategory).toBe(
        'Unclear / insufficient information',
      );
    });

    it('should score below 40 and flag missing information', () => {
      const result = service.evaluateHrResumeEvidence(sparseResume);

      expect(result.matchScore).toBeLessThan(40);
      expect(result.missingOrUnclearInformation.length).toBeGreaterThan(0);
      expect(result.recommendedStatus).toBe('Not Shortlisted');
    });

    it('should route to HR Review (MANUAL_REVIEW) before rejection - NOT auto-rejected', () => {
      const result = service.evaluateHrResumeEvidence(sparseResume);

      expect(result.screeningStatus).toBe('MANUAL_REVIEW');
      expect(result.screeningStatus).not.toBe('REJECT');
      expect(result.hrReviewRequired).toBe(true);
      expect(result.screeningExplanation).toContain('HR Review');
    });
  });

  describe('6. Initial Routing Thresholds and Business Rules Validation', () => {
    it('should route 65-100 to Shortlist', () => {
      const validated = validateApplicationAnalysis({
        candidate: { name: 'Test', email: 'test@example.com', phone: '123' },
        application: {
          jobRole: 'HR Intern',
          skills: ['Recruitment'],
          projects: [],
          education: [],
          experience: [],
        },
        summary: 'Good candidate',
        matchScore: 70,
        matchedRequirements: ['Recruitment'],
        missingOrUnclearRequirements: [],
        screeningExplanation: 'Strong candidate',
        screeningStatus: 'SHORTLIST',
        hrReviewRequired: false,
      });

      expect(validated.valid).toBe(true);
      expect(validated.analysis?.screeningStatus).toBe('SHORTLIST');
      expect(validated.analysis?.recommendedStatus).toBe('Shortlist');
      expect(validated.analysis?.hrReviewRequired).toBe(false);
    });

    it('should route 40-64 to HR Review (MANUAL_REVIEW)', () => {
      const validated = validateApplicationAnalysis({
        candidate: { name: 'Test', email: 'test@example.com', phone: '123' },
        application: {
          jobRole: 'HR Intern',
          skills: [],
          projects: [],
          education: [],
          experience: [],
        },
        summary: 'Borderline candidate',
        matchScore: 50,
        matchedRequirements: [],
        missingOrUnclearRequirements: ['Practical work'],
        screeningExplanation: 'Borderline candidate needing review',
        screeningStatus: 'MANUAL_REVIEW',
        hrReviewRequired: true,
      });

      expect(validated.valid).toBe(true);
      expect(validated.analysis?.screeningStatus).toBe('MANUAL_REVIEW');
      expect(validated.analysis?.recommendedStatus).toBe('HR Review');
      expect(validated.analysis?.hrReviewRequired).toBe(true);
    });

    it('should route below 40 to HR Review before rejection (MANUAL_REVIEW, hrReviewRequired: true)', () => {
      const validated = validateApplicationAnalysis({
        candidate: { name: 'Test', email: 'test@example.com', phone: '123' },
        application: {
          jobRole: 'HR Intern',
          skills: [],
          projects: [],
          education: [],
          experience: [],
        },
        summary: 'Low scoring candidate',
        matchScore: 25,
        matchedRequirements: [],
        missingOrUnclearRequirements: ['Core skills'],
        screeningExplanation: 'Proposed rejection requires HR review',
        screeningStatus: 'REJECT', // Model might return REJECT, but business rules enforce HR review!
        hrReviewRequired: false,
      });

      expect(validated.valid).toBe(true);
      // Strict Business Rule check: A low score alone must NEVER automatically reject!
      expect(validated.analysis?.screeningStatus).toBe('MANUAL_REVIEW');
      expect(validated.analysis?.recommendedStatus).toBe('Not Shortlisted');
      expect(validated.analysis?.hrReviewRequired).toBe(true);
    });
  });

  describe('7. Integration through analyzeApplication', () => {
    it('should execute end-to-end analysis and return structured result', async () => {
      const result = await service.analyzeApplication({
        messageId: 'test-msg-101',
        subject: 'Application for Codes for Tomorrow HR Intern',
        sender: { email: 'applicant@example.com', name: 'Divya Rao' },
        resumeText: `
          Divya Rao
          Email: applicant@example.com | Phone: 9988112233
          Experience:
          - HR Intern (3 Months) at Startup Hub
            * Assisted in candidate sourcing on LinkedIn and Naukri.
            * Conducted resume screening and interview scheduling on Google Meet.
            * Maintained candidate tracker in Google Sheets.
          Education:
          - B.Com (2024 graduate)
          Skills:
          - Candidate sourcing, interview coordination, Google Sheets, communication
        `,
        filename: 'divya_resume.pdf',
        attachmentId: 'att-101',
      });

      expect(result.status).toBe('success');
      expect(result.analysis).toBeDefined();
      expect(result.analysis?.candidate.email).toBe('applicant@example.com');
      expect(result.analysis?.experienceCategory).toBe(
        'Relevant HR or recruitment internship',
      );
      expect(result.analysis?.suggestedProfile).toBe('HR Intern');
      expect(result.analysis?.matchScore).toBeGreaterThanOrEqual(65);
      expect(result.analysis?.screeningStatus).toBe('SHORTLIST');
      expect(result.analysis?.recommendedStatus).toBe('Shortlist');
    });
  });
});
