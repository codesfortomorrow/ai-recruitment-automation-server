import {
  CandidateApplicationAnalysis,
  ExperienceCategory,
  RecommendedStatus,
  ScoreEvidenceDetails,
  ScreeningStatus,
  SuggestedProfile,
} from './gemini.types';
import {
  JobRoleDefinition,
  matchesSkillInContext,
  normalizeSkill,
} from '../configs/job-roles.config';

export class RoleScoringEngine {
  /**
   * Evaluates resume evidence against a specific target job role.
   */
  public static evaluateEvidence(
    rawText: string,
    targetRole?: JobRoleDefinition | null,
    metadata?: {
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      subject?: string | null;
    },
  ): CandidateApplicationAnalysis {
    if (!targetRole) {
      return this.createManualReviewAnalysis({
        roleTitle: 'Undetected Vacancy',
        reason: 'ROLE_UNDETECTED',
        explanation:
          'ROLE_UNDETECTED: Target vacancy could not be resolved from application metadata or email context. Routed to manual HR review.',
        metadata,
      });
    }

    // If recruitment role, delegate to HR scoring engine
    if (
      targetRole.canonicalRole === 'HR_INTERN' ||
      targetRole.canonicalRole === 'HR_EXECUTIVE' ||
      targetRole.canonicalRole === 'RECRUITER' ||
      targetRole.canonicalRole === 'TALENT_ACQUISITION'
    ) {
      return this.evaluateHrResumeEvidence(rawText, metadata, targetRole);
    }

    return this.evaluateTechnicalOrFunctionalEvidence(
      rawText,
      targetRole,
      metadata,
    );
  }

  /**
   * Constructs an explicit manual review analysis when a role is undetected, conflicting,
   * or when Gemini is unavailable and no role-specific deterministic fallback is possible.
   */
  public static createManualReviewAnalysis(params: {
    roleTitle?: string;
    reason?: string;
    explanation?: string;
    metadata?: {
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      subject?: string | null;
    };
    appliedRole?: string;
    resolvedRole?: string;
    suggestedAlternativeRole?: string;
  }): CandidateApplicationAnalysis {
    const roleTitle = params.roleTitle || 'Undetected Vacancy';
    const reason = params.reason || 'ROLE_UNDETECTED';
    const explanation =
      params.explanation ||
      `Application routed to HR Review for manual evaluation: ${reason}.`;

    return {
      candidate: {
        name: params.metadata?.name || null,
        email: params.metadata?.email || null,
        phone: params.metadata?.phone || null,
      },
      application: {
        jobRole: roleTitle,
        skills: [],
        projects: [],
        education: [],
        experience: [],
      },
      summary: `Candidate screening requires manual review: ${explanation}`,
      matchScore: null,
      matchedRequirements: [],
      missingOrUnclearRequirements: [reason],
      screeningStatus: 'MANUAL_REVIEW',
      screeningExplanation: explanation,
      hrReviewRequired: true,
      rejectionReason: reason,
      appliedRole: params.appliedRole || roleTitle,
      resolvedRole: params.resolvedRole,
      suggestedAlternativeRole: params.suggestedAlternativeRole,
      experienceCategory: 'Unclear / insufficient information',
      relevantExperienceResponsibilities: [],
      scoreEvidence: {
        evidenceNotes: explanation,
      },
      missingOrUnclearInformation: [
        'Confirmed job vacancy',
        'Detailed candidate evaluation against target role',
      ],
      strengthsAgainstJd: [],
      gapsAgainstJd: [reason],
      suggestedProfile: roleTitle as any,
      recommendedStatus: 'Requires Human Review',
    };
  }

  /**
   * Evaluates evidence for technical and functional roles (MERN, React, Node, QA, BA, Software Dev).
   */
  private static evaluateTechnicalOrFunctionalEvidence(
    rawText: string,
    role: JobRoleDefinition,
    metadata?: {
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      subject?: string | null;
    },
  ): CandidateApplicationAnalysis {
    const trimmed = (rawText || '').trim();
    const lowerText = trimmed.toLowerCase();
    const wordCount = trimmed.split(/\s+/).filter((w) => w.length > 0).length;

    // Contact extraction
    const emailMatch = trimmed.match(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    );
    const phoneMatch = trimmed.match(
      /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+?91[-.\s]?\d{10}/,
    );

    let extractedName: string | null = metadata?.name || null;
    if (!extractedName && trimmed.length > 0) {
      const firstLine = trimmed.split('\n')[0].trim();
      if (
        firstLine.length > 2 &&
        firstLine.length < 50 &&
        !firstLine.includes('@') &&
        !/\d/.test(firstLine)
      ) {
        extractedName = firstLine;
      }
    }

    const email = metadata?.email || (emailMatch ? emailMatch[0] : null);
    const phone = metadata?.phone || (phoneMatch ? phoneMatch[0] : null);

    // Extraction failure detection (footer-only, empty, unreadable)
    const isFooterOnly =
      /^(--\s*\d+\s*of\s*\d+\s*--|page\s*\d+(\s*of\s*\d+)?|\d+\s*\/\s*\d+)$/i.test(
        trimmed,
      );
    if (
      !trimmed ||
      isFooterOnly ||
      (wordCount < 10 && !emailMatch && !phoneMatch)
    ) {
      return {
        candidate: { name: extractedName, email, phone },
        application: {
          jobRole: role.title,
          skills: [],
          projects: [],
          education: [],
          experience: [],
        },
        summary: `Resume document contains no readable text or insufficient text for automated scoring against ${role.title}.`,
        matchScore: null,
        matchedRequirements: [],
        missingOrUnclearRequirements: [
          'RESUME_EXTRACTION_INSUFFICIENT: Resume text could not be extracted or contains insufficient data for automated scoring',
        ],
        screeningStatus: 'MANUAL_REVIEW',
        screeningExplanation: `RESUME_EXTRACTION_INSUFFICIENT: Resume document contains no readable text or insufficient text for automated scoring. Routed to HR Review for manual evaluation.`,
        hrReviewRequired: true,
        experienceCategory: 'Unclear / insufficient information',
        relevantExperienceResponsibilities: [],
        scoreEvidence: {
          recruitmentAndTalentAcquisition: 0,
          practicalInternshipOrWork: 0,
          screeningSchedulingAndFollowups: 0,
          sourcingChannels: 0,
          communicationAndCoordination: 0,
          excelOrGoogleSheets: 0,
          otherHrOperations: 0,
          evidenceNotes: `RESUME_EXTRACTION_INSUFFICIENT: Extraction failed for ${role.title}`,
        },
        missingOrUnclearInformation: [
          'Readable resume text with detailed technical experience / qualifications',
        ],
        strengthsAgainstJd: [],
        gapsAgainstJd: [
          'Resume content was unreadable or insufficient for automated scoring',
        ],
        suggestedProfile: role.title as any,
        recommendedStatus: 'Requires Human Review',
        rejectionReason: 'RESUME_EXTRACTION_INSUFFICIENT',
        appliedRole: role.title,
        resolvedRole: role.title,
      };
    }

    // Role-specific rubric evaluation
    let totalScore = 0;
    const strengths: string[] = [];
    const gaps: string[] = [];
    const matchedSkills: string[] = [];
    const sectionEvidence: Record<string, number> = {};

    for (const section of role.scoringRubric) {
      let matchedCount = 0;
      for (const keyword of section.keywords) {
        if (matchesSkillInContext(lowerText, keyword)) {
          matchedCount++;
          const canonical = normalizeSkill(keyword) || keyword;
          if (!matchedSkills.includes(canonical)) {
            matchedSkills.push(canonical);
          }
        }
      }

      // Proportional scoring based on keyword match density and section max
      const ratio = Math.min(
        1,
        matchedCount / Math.max(2, Math.floor(section.keywords.length * 0.4)),
      );
      const sectionScore = Math.round(ratio * section.maxScore);
      totalScore += sectionScore;
      sectionEvidence[section.name] = sectionScore;

      if (sectionScore >= Math.round(section.maxScore * 0.6)) {
        strengths.push(
          `${section.description} (${sectionScore}/${section.maxScore} pts)`,
        );
      } else {
        gaps.push(
          `Limited evidence for ${section.description} (${sectionScore}/${section.maxScore} pts)`,
        );
      }
    }

    const matchScore = Math.min(100, Math.max(0, totalScore));

    // Experience categorization
    let experienceCategory: ExperienceCategory;
    const isExplicitFresher =
      /\b(fresher|fresh|graduate|entry level|college|student|no professional experience)\b/i.test(
        lowerText,
      );
    const hasWorkExp =
      /\b(experience|work history|employment|developer at|engineer at|specialist at)\b/i.test(
        lowerText,
      );
    const hasInternship = /\b(intern|internship|trainee)\b/i.test(lowerText);

    if (isExplicitFresher && !hasWorkExp) {
      experienceCategory = 'Fresher / no professional experience';
    } else if (hasWorkExp && matchScore >= 50) {
      experienceCategory = 'Relevant recruitment work experience'; // Used by existing types
    } else if (hasInternship) {
      experienceCategory = 'Relevant HR or recruitment internship';
    } else if (hasWorkExp) {
      experienceCategory = 'Other or unrelated experience';
    } else if (
      wordCount < 40 &&
      !lowerText.includes('experience') &&
      !lowerText.includes('skills')
    ) {
      experienceCategory = 'Unclear / insufficient information';
    } else {
      experienceCategory = 'Fresher / no professional experience';
    }

    // Thresholds:
    // 60–100: Shortlist
    // 40–59: HR Review
    // Below 40: HR Review before rejection
    let recommendedStatus: RecommendedStatus;
    let screeningStatus: ScreeningStatus;
    let hrReviewRequired: boolean;

    if (matchScore >= 60) {
      recommendedStatus = 'Shortlist';
      screeningStatus = 'SHORTLIST';
      hrReviewRequired = false;
    } else if (matchScore >= 40) {
      recommendedStatus = 'HR Review';
      screeningStatus = 'MANUAL_REVIEW';
      hrReviewRequired = true;
    } else {
      recommendedStatus = 'Not Shortlisted';
      screeningStatus = 'MANUAL_REVIEW';
      hrReviewRequired = true;
    }

    const explanation =
      matchScore >= 60
        ? `Candidate scored ${matchScore}/100 based on verified skills and project evidence against the Codes for Tomorrow ${role.title} requirements. Meets threshold for shortlist.`
        : matchScore >= 40
          ? `Candidate scored ${matchScore}/100 against Codes for Tomorrow ${role.title} requirements. Shows relevant foundational skills. Routed to HR Review for human consideration.`
          : `Candidate scored ${matchScore}/100. Evidence for core requirements against Codes for Tomorrow ${role.title} is limited. Routed to HR Review before rejection for manual verification.`;

    return {
      candidate: { name: extractedName, email, phone },
      application: {
        jobRole: role.title,
        skills: matchedSkills,
        projects: [],
        education: [],
        experience: [],
      },
      summary: `Candidate evaluated for Codes for Tomorrow ${role.title}. Score: ${matchScore}/100. Status: ${recommendedStatus}.`,
      matchScore,
      matchedRequirements: strengths,
      missingOrUnclearRequirements: gaps,
      screeningStatus,
      screeningExplanation: explanation,
      hrReviewRequired,
      experienceCategory,
      relevantExperienceResponsibilities: strengths,
      scoreEvidence: {
        recruitmentAndTalentAcquisition:
          sectionEvidence.frontendReact ||
          sectionEvidence.testingMethodologies ||
          0,
        practicalInternshipOrWork:
          sectionEvidence.backendNodeExpress ||
          sectionEvidence.testCaseDesign ||
          0,
        screeningSchedulingAndFollowups:
          sectionEvidence.databaseMongo || sectionEvidence.defectReporting || 0,
        sourcingChannels:
          sectionEvidence.practicalFullStackProjects ||
          sectionEvidence.apiTesting ||
          0,
        communicationAndCoordination:
          sectionEvidence.architectureAndAuth ||
          sectionEvidence.automationBasics ||
          0,
        excelOrGoogleSheets:
          sectionEvidence.codeQualityAndTesting ||
          sectionEvidence.sqlVerification ||
          0,
        otherHrOperations: 0,
        evidenceNotes: `Score breakdown for ${role.title}: Total ${matchScore}/100. Evidence: ${strengths.slice(0, 3).join(', ')}`,
      },
      missingOrUnclearInformation:
        gaps.length > 0 ? gaps : ['None flagged as critical'],
      strengthsAgainstJd: strengths,
      gapsAgainstJd: gaps,
      suggestedProfile: role.title as any,
      recommendedStatus,
      appliedRole: role.title,
      resolvedRole: role.title,
    };
  }

  /**
   * Evaluates resume evidence specifically for HR Intern and HR Executive roles.
   * Preserves full backward-compatibility with all existing HR screening tests.
   */
  public static evaluateHrResumeEvidence(
    rawText: string,
    metadata?: {
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      subject?: string | null;
    },
    explicitRole?: JobRoleDefinition,
  ): CandidateApplicationAnalysis {
    const trimmed = (rawText || '').trim();
    const lowerText = trimmed.toLowerCase();
    const wordCount = trimmed.split(/\s+/).filter((w) => w.length > 0).length;

    const emailMatch = trimmed.match(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    );
    const phoneMatch = trimmed.match(
      /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+?91[-.\s]?\d{10}/,
    );

    let extractedName: string | null = metadata?.name || null;
    if (!extractedName && trimmed.length > 0) {
      const firstLine = trimmed.split('\n')[0].trim();
      if (
        firstLine.length > 2 &&
        firstLine.length < 50 &&
        !firstLine.includes('@') &&
        !/\d/.test(firstLine)
      ) {
        extractedName = firstLine;
      }
    }

    const email = metadata?.email || (emailMatch ? emailMatch[0] : null);
    const phone = metadata?.phone || (phoneMatch ? phoneMatch[0] : null);

    // Extraction failure detection: footer-only or empty/unreadable text without contact info
    const isFooterOnly =
      /^(--\s*\d+\s*of\s*\d+\s*--|page\s*\d+(\s*of\s*\d+)?|\d+\s*\/\s*\d+)$/i.test(
        trimmed,
      );
    const isExtractionFailure =
      !trimmed ||
      isFooterOnly ||
      (wordCount < 10 && !emailMatch && !phoneMatch);

    if (isExtractionFailure) {
      const scoreEvidence: ScoreEvidenceDetails = {
        recruitmentAndTalentAcquisition: 0,
        practicalInternshipOrWork: 0,
        screeningSchedulingAndFollowups: 0,
        sourcingChannels: 0,
        communicationAndCoordination: 0,
        excelOrGoogleSheets: 0,
        otherHrOperations: 0,
        evidenceNotes:
          'RESUME_EXTRACTION_INSUFFICIENT: Resume text contains insufficient details or could not be extracted for automated scoring.',
      };

      return {
        candidate: { name: extractedName, email, phone },
        application: {
          jobRole: explicitRole?.title || 'Codes for Tomorrow HR Profile',
          skills: [],
          projects: [],
          education: [],
          experience: [],
        },
        summary:
          'Resume contains insufficient details or lacks verifiable text to evaluate against JD. Flagged for manual review.',
        matchScore: null,
        matchedRequirements: [],
        missingOrUnclearRequirements: [
          'RESUME_EXTRACTION_INSUFFICIENT: Resume text could not be extracted or contains insufficient data for automated scoring',
        ],
        screeningStatus: 'MANUAL_REVIEW',
        screeningExplanation:
          'RESUME_EXTRACTION_INSUFFICIENT: Resume document contains no readable text or insufficient text for automated scoring. Routed to HR Review for manual evaluation.',
        hrReviewRequired: true,
        experienceCategory: 'Unclear / insufficient information',
        relevantExperienceResponsibilities: [],
        scoreEvidence,
        missingOrUnclearInformation: [
          'Readable resume text with detailed work history / qualifications',
        ],
        strengthsAgainstJd: [],
        gapsAgainstJd: [
          'Resume content was unreadable or insufficient for automated scoring',
        ],
        suggestedProfile: 'HR Intern',
        recommendedStatus: 'Requires Human Review',
        rejectionReason: 'RESUME_EXTRACTION_INSUFFICIENT',
        appliedRole: explicitRole?.title || 'Codes for Tomorrow HR Profile',
        resolvedRole: explicitRole?.title || 'HR Intern',
      };
    }

    // 1. Recruitment & Talent Acquisition (30 pts)
    const hasFullCycleRecruitment =
      /\b(full\s*cycle recruitment|end\s*to\s*end recruitment|talent acquisition specialist|recruitment lifecycle|hiring process|technical hiring)\b/.test(
        lowerText,
      );
    const hasPracticalRecruiting =
      /\b(sourcing|recruiting|recruiter|talent acquisition|candidate pipeline|hiring|job postings|job descriptions?|intake meetings?)\b/.test(
        lowerText,
      );
    const hasConceptualHr =
      /\b(human resources?|hr concepts|talent management|hrm|manpower planning|recruitment methods)\b/.test(
        lowerText,
      );

    let recruitmentScore = 0;
    if (hasFullCycleRecruitment) {
      recruitmentScore = 28;
    } else if (hasPracticalRecruiting) {
      recruitmentScore = 22;
    } else if (hasConceptualHr) {
      recruitmentScore = 12;
    } else if (lowerText.includes('hr')) {
      recruitmentScore = 4;
    }

    // 2. Practical Internship or Work (20 pts)
    const hasHrInternship =
      /\b(hr intern|human resources intern|talent acquisition intern|recruitment intern|hr internship|intern - hr)\b/.test(
        lowerText,
      );
    const hasRecruitmentWorkExp =
      /\b(recruitment executive|hr executive|talent acquisition specialist|hr associate|recruiter at|talent partner)\b/.test(
        lowerText,
      );
    const hasUnrelatedExp =
      /\b(developer|software engineer|frontend developer|backend developer|graphic designer|content writer|marketing intern|sales executive|web developer|qa engineer|tester)\b/.test(
        lowerText,
      ) &&
      !hasHrInternship &&
      !hasRecruitmentWorkExp;

    let practicalScore = 0;
    if (hasRecruitmentWorkExp) {
      practicalScore = 20;
    } else if (hasHrInternship) {
      practicalScore = 16;
    } else if (hasUnrelatedExp) {
      practicalScore = 0;
    }

    // 3. Screening, Scheduling, and Follow-ups (15 pts)
    const hasScreening =
      /\b(resume screening|cv screening|profile screening|phone screening|screening resumes?)\b/.test(
        lowerText,
      );
    const hasScheduling =
      /\b(interview scheduling|calendar management|coordinating interviews|scheduling rounds|google meet)\b/.test(
        lowerText,
      );
    const hasFollowups =
      /\b(candidate follow\s*ups?|status updates?|pipeline updates?|feedback coordination)\b/.test(
        lowerText,
      );

    let screeningScore = 0;
    if (hasScreening) screeningScore += 6;
    if (hasScheduling) screeningScore += 5;
    if (hasFollowups) screeningScore += 4;

    // 4. Sourcing Channels (10 pts)
    const hasLinkedIn = /\b(linkedin|linkedin recruiter)\b/.test(lowerText);
    const hasPortals =
      /\b(naukri|indeed|internshala|foundit|monster|hirist)\b/.test(lowerText);
    const hasReferrals =
      /\b(referrals|cold outreach|campus recruitment|talent mapping)\b/.test(
        lowerText,
      );

    let sourcingScore = 0;
    if (hasLinkedIn) sourcingScore += 5;
    if (hasPortals) sourcingScore += 4;
    if (hasReferrals) sourcingScore += 1;

    // 5. Communication and Coordination (10 pts)
    const hasCoordinationEvidence =
      /\b(candidate coordination|stakeholder management|hiring managers?|verbal communication|written communication|email etiquette)\b/.test(
        lowerText,
      );
    let communicationScore = 0;
    if (hasCoordinationEvidence) {
      communicationScore = 9;
    } else if (
      lowerText.includes('communication') ||
      lowerText.includes('coordination')
    ) {
      communicationScore = 6;
    }

    // 6. Excel or Google Sheets (10 pts)
    const hasExcelOrSheets =
      /\b(excel|google sheets?|candidate trackers?|spreadsheets?|pivot tables?|vlookup|reporting)\b/.test(
        lowerText,
      );
    let excelScore = 0;
    if (hasExcelOrSheets) {
      excelScore = 8;
    }

    // 7. Other HR Operations (5 pts)
    const hasOperations =
      /\b(onboarding|documentation|hr policies|employee engagement|attendance|offer letters?)\b/.test(
        lowerText,
      );
    let otherOpsScore = 0;
    if (hasOperations) {
      otherOpsScore = 4;
    }

    // Experience Classification
    let experienceCategory: ExperienceCategory;
    if (
      !lowerText.includes('experience') &&
      !lowerText.includes('education') &&
      !lowerText.includes('skills') &&
      !lowerText.includes('project') &&
      !hasRecruitmentWorkExp &&
      !hasHrInternship &&
      !hasUnrelatedExp
    ) {
      experienceCategory = 'Unclear / insufficient information';
    } else if (hasRecruitmentWorkExp) {
      experienceCategory = 'Relevant recruitment work experience';
    } else if (hasHrInternship) {
      experienceCategory = 'Relevant HR or recruitment internship';
    } else if (hasUnrelatedExp) {
      experienceCategory = 'Other or unrelated experience';
    } else {
      experienceCategory = 'Fresher / no professional experience';
    }

    // Total Match Score
    const matchScore = Math.min(
      100,
      recruitmentScore +
        practicalScore +
        screeningScore +
        sourcingScore +
        communicationScore +
        excelScore +
        otherOpsScore,
    );

    const scoreEvidence: ScoreEvidenceDetails = {
      recruitmentAndTalentAcquisition: recruitmentScore,
      practicalInternshipOrWork: practicalScore,
      screeningSchedulingAndFollowups: screeningScore,
      sourcingChannels: sourcingScore,
      communicationAndCoordination: communicationScore,
      excelOrGoogleSheets: excelScore,
      otherHrOperations: otherOpsScore,
      evidenceNotes: `Score breakdown: Recruitment(${recruitmentScore}/30), PracticalExp(${practicalScore}/20), Screening(${screeningScore}/15), Sourcing(${sourcingScore}/10), Comm(${communicationScore}/10), Excel(${excelScore}/10), Operations(${otherOpsScore}/5). Total: ${matchScore}/100.`,
    };

    let suggestedProfile: SuggestedProfile;
    if (experienceCategory === 'Relevant recruitment work experience') {
      suggestedProfile = 'HR Associate / HR Executive';
    } else {
      suggestedProfile = 'HR Intern';
    }

    // Routing Thresholds
    let recommendedStatus: RecommendedStatus;
    let screeningStatus: ScreeningStatus;
    let hrReviewRequired: boolean;

    if (matchScore >= 60) {
      recommendedStatus = 'Shortlist';
      screeningStatus = 'SHORTLIST';
      hrReviewRequired = false;
    } else if (matchScore >= 40) {
      recommendedStatus = 'HR Review';
      screeningStatus = 'MANUAL_REVIEW';
      hrReviewRequired = true;
    } else {
      recommendedStatus = 'Not Shortlisted';
      screeningStatus = 'MANUAL_REVIEW';
      hrReviewRequired = true;
    }

    const strengths: string[] = [];
    const gaps: string[] = [];
    const relevantResponsibilities: string[] = [];

    if (recruitmentScore >= 18) {
      strengths.push(
        'Demonstrated practical knowledge of recruitment lifecycle and talent acquisition',
      );
      relevantResponsibilities.push(
        'Talent acquisition, candidate sourcing and pipeline generation',
      );
    } else if (recruitmentScore > 0) {
      strengths.push(
        'Familiar with HR and recruitment concepts from coursework or academic training',
      );
    } else {
      gaps.push('Lacks documented recruitment and hiring experience');
    }

    if (practicalScore >= 14) {
      strengths.push(
        `Documented hands-on ${experienceCategory.toLowerCase()} responsibilities`,
      );
    } else {
      gaps.push(
        'Hands-on talent acquisition work experience is limited or not stated',
      );
    }

    if (screeningScore >= 8) {
      strengths.push(
        'Hands-on experience screening resumes, coordinating interviews, and candidate follow-ups',
      );
      relevantResponsibilities.push(
        'Candidate screening, interview scheduling on Google Meet, and candidate follow-ups',
      );
    } else {
      gaps.push(
        'Interview coordination and active candidate screening experience is minimal',
      );
    }

    if (sourcingScore >= 6) {
      strengths.push(
        'Proficient with sourcing channels including LinkedIn and recruitment portals',
      );
      relevantResponsibilities.push(
        'Candidate sourcing across LinkedIn and job boards',
      );
    } else {
      gaps.push(
        'Hands-on sourcing on active portals (LinkedIn/Naukri) is limited or not highlighted',
      );
    }

    if (excelScore >= 7) {
      strengths.push(
        'Proficient in Excel/Google Sheets for tracker and recruitment data management',
      );
      relevantResponsibilities.push(
        'Maintaining recruitment trackers and candidate data in spreadsheets',
      );
    } else {
      gaps.push(
        'Advanced spreadsheet / tracker management skills not explicitly detailed',
      );
    }

    if (communicationScore >= 7) {
      strengths.push(
        'Strong communication and interpersonal skills suitable for candidate engagement',
      );
    }

    let explanation = '';
    if (matchScore >= 60) {
      explanation = `Candidate scored ${matchScore}/100 based on verified recruitment evidence across sourcing, screening, coordination, and spreadsheets. Meets threshold for ${suggestedProfile} shortlist.`;
    } else if (matchScore >= 40) {
      explanation = `Candidate scored ${matchScore}/100. Demonstrates promising potential/transferable skills (${experienceCategory}) suitable for ${suggestedProfile}. Routed to HR Review for human consideration.`;
    } else {
      explanation = `Candidate scored ${matchScore}/100. Evidence for core recruitment responsibilities against the Codes for Tomorrow JD is limited (${experienceCategory}). Routed to HR Review before rejection for HR verification.`;
    }

    return {
      candidate: { name: extractedName, email, phone },
      application: {
        jobRole: suggestedProfile,
        skills: strengths,
        projects: [],
        education: [],
        experience: relevantResponsibilities.map((r) => ({
          role: r,
          company: experienceCategory,
        })),
      },
      summary: `Candidate evaluated for Codes for Tomorrow ${suggestedProfile}. Category: ${experienceCategory}. Score: ${matchScore}/100. Status: ${recommendedStatus}.`,
      matchScore,
      matchedRequirements: strengths,
      missingOrUnclearRequirements: gaps,
      screeningStatus,
      screeningExplanation: explanation,
      hrReviewRequired,
      experienceCategory,
      relevantExperienceResponsibilities: relevantResponsibilities,
      scoreEvidence,
      missingOrUnclearInformation:
        gaps.length > 0 ? gaps : ['None flagged as critical'],
      strengthsAgainstJd: strengths,
      gapsAgainstJd: gaps,
      suggestedProfile,
      recommendedStatus,
      appliedRole: explicitRole?.title || suggestedProfile,
      resolvedRole: explicitRole?.title || suggestedProfile,
    };
  }
}
