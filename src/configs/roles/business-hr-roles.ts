import { JobRoleDefinition } from './roles.types';

export const BUSINESS_HR_JOB_ROLES: JobRoleDefinition[] = [
  {
    id: 'business-analyst',
    title: 'Business Analyst',
    canonicalRole: 'BUSINESS_ANALYST',
    aliases: [
      'business analyst',
      'it business analyst',
      'business data analyst',
      'technical business analyst',
      'ba',
    ],
    description:
      'Codes for Tomorrow Business Analyst: Gathers and bridges business requirements with technical execution. Evaluates BRD/FRD documentation, user stories, process flowcharts (UML/BPMN), stakeholder management, and data-driven analytical thinking.',
    requiredSkills: [
      'Business Requirements Gathering',
      'BRD & FRD Documentation',
      'Use Cases & User Stories',
      'Stakeholder Management',
      'Process Modeling (BPMN / Flowcharts)',
      'Agile / Scrum',
    ],
    optionalSkills: [
      'SQL',
      'Jira',
      'Confluence',
      'UML',
      'Data Analysis',
      'Tableau / PowerBI',
    ],
    assignedHrTeam: 'HR2',
    scoringRubric: [
      {
        name: 'requirementsGatheringAndDocs',
        maxScore: 30,
        description:
          'Requirements elicitation, writing BRDs, FRDs, user stories, and acceptance criteria',
        keywords: [
          'brd',
          'frd',
          'requirements',
          'user stories',
          'acceptance criteria',
          'elicitation',
          'documentation',
        ],
      },
      {
        name: 'processModelingAndUml',
        maxScore: 25,
        description:
          'Process flow diagrams, BPMN, UML diagrams, wireframing, and workflow mapping',
        keywords: [
          'bpmn',
          'uml',
          'flowcharts',
          'wireframes',
          'process mapping',
          'workflows',
          'visio',
        ],
      },
      {
        name: 'agileAndProductTools',
        maxScore: 20,
        description:
          'Agile/Scrum ceremonies, backlog grooming, sprint planning, Jira, and Confluence',
        keywords: [
          'agile',
          'scrum',
          'jira',
          'confluence',
          'backlog',
          'sprint',
          'product owner',
        ],
      },
      {
        name: 'stakeholderManagement',
        maxScore: 15,
        description:
          'Client interaction, stakeholder alignment, gap analysis, and cross-functional communication',
        keywords: [
          'stakeholder',
          'gap analysis',
          'communication',
          'client management',
          'presentations',
        ],
      },
      {
        name: 'dataAnalysisAndSql',
        maxScore: 10,
        description:
          'Data validation, SQL queries, Excel analysis, and basic business intelligence',
        keywords: [
          'sql',
          'excel',
          'data analysis',
          'power bi',
          'tableau',
          'metrics',
        ],
      },
    ],
  },
  {
    id: 'hr-intern',
    title: 'HR Intern',
    canonicalRole: 'HR_INTERN',
    aliases: [
      'hr intern',
      'human resources intern',
      'recruitment intern',
      'hr trainee',
      'talent acquisition intern',
      'hr internship',
      'human resources trainee',
    ],
    description:
      'Codes for Tomorrow HR Intern: Evaluates foundational talent acquisition knowledge, candidate sourcing (LinkedIn/Naukri), screening resumes, scheduling interviews, candidate follow-ups, and pipeline tracking via Google Sheets/Excel.',
    requiredSkills: [
      'Recruitment & Sourcing',
      'Candidate Screening',
      'Interview Scheduling',
      'Candidate Follow-ups',
      'Communication & Coordination',
      'Google Sheets / MS Excel',
    ],
    optionalSkills: [
      'LinkedIn Recruiter',
      'Naukri Portal',
      'HR Documentation',
      'Onboarding Support',
      'ATS Management',
    ],
    assignedHrTeam: 'RECRUITMENT',
    scoringRubric: [
      {
        name: 'recruitmentAndTalentAcquisition',
        maxScore: 30,
        description:
          'Understanding talent acquisition, sourcing, recruitment lifecycle, and candidate pipeline',
        keywords: [
          'recruitment',
          'sourcing',
          'talent acquisition',
          'hiring',
          'talent search',
        ],
      },
      {
        name: 'practicalInternshipOrWork',
        maxScore: 25,
        description:
          'Practical recruitment internship, live sourcing projects, or hands-on HR experience',
        keywords: [
          'internship',
          'hr intern',
          'practical experience',
          'projects',
          'intern',
        ],
      },
      {
        name: 'screeningSchedulingAndFollowups',
        maxScore: 15,
        description:
          'Resume screening, interview scheduling, coordination, and follow-ups',
        keywords: [
          'screening',
          'scheduling',
          'follow ups',
          'coordination',
          'candidate communication',
        ],
      },
      {
        name: 'sourcingChannels',
        maxScore: 10,
        description:
          'Using hiring platforms like LinkedIn, Naukri, job portals, or social media',
        keywords: [
          'linkedin',
          'naukri',
          'job portals',
          'portals',
          'boolean search',
        ],
      },
      {
        name: 'communicationAndCoordination',
        maxScore: 10,
        description:
          'Written and verbal communication, stakeholder interaction, and professional conduct',
        keywords: [
          'communication',
          'interpersonal',
          'verbal',
          'written',
          'coordination',
        ],
      },
      {
        name: 'excelOrGoogleSheets',
        maxScore: 5,
        description:
          'Maintaining trackers and documentation in Google Sheets or MS Excel',
        keywords: [
          'excel',
          'google sheets',
          'spreadsheets',
          'tracker',
          'reporting',
        ],
      },
      {
        name: 'otherHrOperations',
        maxScore: 5,
        description:
          'General HR knowledge, onboarding support, and policy awareness',
        keywords: ['onboarding', 'hr operations', 'documentation', 'policies'],
      },
    ],
  },
  {
    id: 'hr-executive',
    title: 'HR Executive',
    canonicalRole: 'HR_EXECUTIVE',
    aliases: [
      'hr executive',
      'human resources executive',
      'hr associate',
      'human resources associate',
      'hr generalist',
      'hr officer',
      'hr coordinator',
      'human resources coordinator',
      'recruitment executive',
      'hr specialist',
      'recruitment associate',
      'hr operations executive',
    ],
    description:
      'Codes for Tomorrow HR Executive: Oversees end-to-end recruitment, active candidate sourcing, hiring manager alignment, offer rollout, onboarding, and structured HR tracker maintenance.',
    requiredSkills: [
      'End-to-End Recruitment',
      'Candidate Sourcing & Screening',
      'Interview Pipeline Management',
      'HR Operations & Onboarding',
      'Stakeholder Communication',
      'HR Metrics & Excel Tracking',
    ],
    optionalSkills: [
      'Employee Engagement',
      'Payroll / Attendance',
      'Offer Letter Preparation',
      'Performance Management',
    ],
    assignedHrTeam: 'RECRUITMENT',
    scoringRubric: [
      {
        name: 'recruitmentAndTalentAcquisition',
        maxScore: 35,
        description:
          'End-to-end recruitment cycle, technical & non-technical sourcing, and offer negotiation',
        keywords: [
          'end to end recruitment',
          'talent acquisition',
          'sourcing',
          'headhunting',
          'offer negotiation',
          'recruitment lifecycle',
        ],
      },
      {
        name: 'screeningSchedulingAndFollowups',
        maxScore: 20,
        description:
          'Structured candidate evaluation, interview pipeline coordination, and candidate experience',
        keywords: [
          'screening',
          'interview scheduling',
          'pipeline',
          'candidate engagement',
        ],
      },
      {
        name: 'sourcingChannels',
        maxScore: 10,
        description:
          'Advanced sourcing via LinkedIn Recruiter, job boards, and headhunting',
        keywords: [
          'linkedin recruiter',
          'naukri',
          'sourcing channels',
          'headhunting',
        ],
      },
      {
        name: 'communicationAndCoordination',
        maxScore: 10,
        description:
          'Stakeholder management, hiring manager alignment, communication',
        keywords: [
          'hiring manager',
          'coordination',
          'communication',
          'negotiation',
        ],
      },
      {
        name: 'excelOrGoogleSheets',
        maxScore: 10,
        description:
          'Advanced tracker maintenance, recruitment metrics, and reporting',
        keywords: [
          'excel',
          'google sheets',
          'tracker',
          'metrics',
          'pivot tables',
        ],
      },
      {
        name: 'otherHrOperations',
        maxScore: 15,
        description: 'Onboarding, HR documentation, and offer rollout',
        keywords: [
          'onboarding',
          'documentation',
          'offer letter',
          'hr operations',
        ],
      },
    ],
  },
  {
    id: 'recruiter',
    title: 'Recruiter',
    canonicalRole: 'RECRUITER',
    aliases: [
      'recruiter',
      'technical recruiter',
      'it recruiter',
      'recruitment specialist',
      'recruitment consultant',
      'talent recruiter',
      'staffing specialist',
    ],
    description:
      'Codes for Tomorrow Recruiter: Focused specialist in IT/technical candidate sourcing, cold outreach, screening for tech stack alignment, candidate pipeline management, and closing offers.',
    requiredSkills: [
      'Talent Sourcing',
      'Technical / IT Screening',
      'Pipeline Management',
      'Headhunting & Boolean Search',
      'Interview Coordination',
      'Offer Negotiation',
    ],
    optionalSkills: [
      'LinkedIn Recruiter',
      'Naukri / Monster',
      'ATS Tools',
      'Stakeholder Management',
      'Salary Benchmarking',
    ],
    assignedHrTeam: 'RECRUITMENT',
    scoringRubric: [
      {
        name: 'sourcingAndHeadhunting',
        maxScore: 35,
        description:
          'Technical sourcing, headhunting, Boolean search strings, LinkedIn Recruiter, job portals',
        keywords: [
          'sourcing',
          'boolean search',
          'linkedin recruiter',
          'naukri',
          'headhunting',
          'cold outreach',
          'it recruitment',
        ],
      },
      {
        name: 'candidateScreeningAndEvaluation',
        maxScore: 30,
        description:
          'Screening tech stack fit, evaluating CTC/notice periods, resume assessment',
        keywords: [
          'screening',
          'technical screening',
          'notice period',
          'salary negotiation',
          'ctc',
          'candidate evaluation',
        ],
      },
      {
        name: 'pipelineAndInterviewCoordination',
        maxScore: 15,
        description:
          'Managing interview pipelines, coordinating with tech interviewers, candidate follow-ups',
        keywords: [
          'interview coordination',
          'pipeline',
          'scheduling',
          'follow up',
          'candidate engagement',
        ],
      },
      {
        name: 'stakeholderManagement',
        maxScore: 10,
        description:
          'Hiring manager alignment, requirement gathering for open job requisitions',
        keywords: [
          'hiring manager',
          'job description',
          'stakeholder',
          'client coordination',
        ],
      },
      {
        name: 'atsAndMetrics',
        maxScore: 10,
        description:
          'ATS management, maintaining applicant trackers in Excel/Google Sheets, recruitment KPIs',
        keywords: [
          'ats',
          'excel',
          'google sheets',
          'tracker',
          'metrics',
          'time to hire',
        ],
      },
    ],
  },
  {
    id: 'talent-acquisition',
    title: 'Talent Acquisition Specialist',
    canonicalRole: 'TALENT_ACQUISITION',
    aliases: [
      'talent acquisition',
      'talent acquisition specialist',
      'talent acquisition associate',
      'ta specialist',
      'talent acquisition executive',
      'talent acquisition partner',
      'talent acquisition manager',
    ],
    description:
      'Codes for Tomorrow Talent Acquisition Specialist: Strategic hiring role responsible for full-lifecycle talent acquisition, employer branding, proactive talent pipelines, structured stakeholder engagement, and recruitment data analytics.',
    requiredSkills: [
      'Full Lifecycle Talent Acquisition',
      'Employer Branding',
      'Strategic Candidate Sourcing',
      'Stakeholder Alignment & Hiring Strategy',
      'Recruitment Analytics & Reporting',
      'Negotiation & Closing',
    ],
    optionalSkills: [
      'Campus Hiring',
      'Diversity Hiring',
      'LinkedIn Recruiter',
      'Workday / Greenhouse / ATS',
      'Market Mapping',
    ],
    assignedHrTeam: 'RECRUITMENT',
    scoringRubric: [
      {
        name: 'strategicTalentAcquisition',
        maxScore: 35,
        description:
          'End-to-end talent acquisition, strategic workforce planning, talent mapping, proactive pipelining',
        keywords: [
          'talent acquisition',
          'workforce planning',
          'talent mapping',
          'strategic hiring',
          'sourcing',
          'headhunting',
        ],
      },
      {
        name: 'stakeholderAndHiringStrategy',
        maxScore: 25,
        description:
          'Partnering with department heads, hiring strategy development, interview panels alignment',
        keywords: [
          'stakeholder',
          'hiring manager',
          'hiring strategy',
          'consulting',
          'business partner',
        ],
      },
      {
        name: 'candidateExperienceAndBranding',
        maxScore: 20,
        description:
          'Candidate journey, employer branding, offer rollout, closing candidates',
        keywords: [
          'employer branding',
          'candidate experience',
          'offer rollout',
          'closing',
          'negotiation',
        ],
      },
      {
        name: 'recruitmentAnalytics',
        maxScore: 10,
        description:
          'Talent metrics (time-to-hire, cost-per-hire), data reporting in Google Sheets/Excel/ATS',
        keywords: [
          'recruitment analytics',
          'kpis',
          'time to hire',
          'excel',
          'google sheets',
          'ats',
        ],
      },
      {
        name: 'diversityAndCampus',
        maxScore: 10,
        description:
          'Campus hiring drives, diversity initiatives, employee referrals',
        keywords: [
          'campus hiring',
          'diversity',
          'referrals',
          'recruitment drives',
        ],
      },
    ],
  },
];
