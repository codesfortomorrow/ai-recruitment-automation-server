import { JobRoleDefinition } from './roles.types';

export const QA_JOB_ROLES: JobRoleDefinition[] = [
  {
    id: 'qa-tester',
    title: 'QA Engineer',
    canonicalRole: 'QA_TESTER',
    aliases: [
      'qa engineer',
      'qa tester',
      'quality assurance engineer',
      'quality assurance tester',
      'software tester',
      'qa analyst',
      'test engineer',
      'quality engineer',
      'qa',
    ],
    description:
      'Codes for Tomorrow QA Engineer: Evaluates functional/manual testing proficiency, test case documentation, defect lifecycle tracking (Jira), API testing (Postman), SDLC/STLC processes, and automation awareness.',
    requiredSkills: [
      'Manual Testing',
      'Test Cases',
      'Bug Reporting',
      'SDLC and STLC',
      'API Testing',
    ],
    optionalSkills: [
      'Postman',
      'Jira',
      'SQL Verification',
      'Selenium Basics',
      'Regression Testing',
    ],
    assignedHrTeam: 'HR2',
    scoringRubric: [
      {
        name: 'testingMethodologies',
        maxScore: 25,
        description:
          'Manual testing fundamentals, SDLC, STLC, functional, regression, and smoke testing',
        keywords: [
          'manual testing',
          'functional testing',
          'regression testing',
          'smoke testing',
          'stlc',
          'sdlc',
          'black box',
        ],
      },
      {
        name: 'testCaseDesign',
        maxScore: 25,
        description:
          'Writing clear test cases, test scenarios, test execution, and traceability',
        keywords: [
          'test cases',
          'test scenarios',
          'test execution',
          'boundary value',
          'equivalence partitioning',
          'test plan',
        ],
      },
      {
        name: 'defectReporting',
        maxScore: 20,
        description:
          'Bug logging, defect lifecycle management, Jira, severity, and priority definition',
        keywords: [
          'jira',
          'bug reporting',
          'defect life cycle',
          'bug lifecycle',
          'severity',
          'priority',
          'retesting',
        ],
      },
      {
        name: 'apiTesting',
        maxScore: 15,
        description:
          'API testing using Postman, HTTP status code validation, JSON payload inspection',
        keywords: [
          'postman',
          'api testing',
          'rest api',
          'http status',
          'json',
          'endpoints',
        ],
      },
      {
        name: 'automationBasics',
        maxScore: 10,
        description:
          'Exposure to test automation tools like Selenium, Cypress, or scripting basics',
        keywords: [
          'selenium',
          'automation',
          'cypress',
          'playwright',
          'webdriver',
          'automation testing',
        ],
      },
      {
        name: 'sqlVerification',
        maxScore: 5,
        description:
          'Database testing, SQL queries, and backend data validation',
        keywords: ['sql', 'database testing', 'queries', 'data validation'],
      },
    ],
  },
  {
    id: 'qa-automation-engineer',
    title: 'QA Automation Engineer',
    canonicalRole: 'QA_AUTOMATION_ENGINEER',
    aliases: [
      'qa automation engineer',
      'automation test engineer',
      'automation tester',
      'sdet',
      'software development engineer in test',
      'automation qa',
      'test automation engineer',
    ],
    description:
      'Codes for Tomorrow QA Automation Engineer: Focuses on automated test architecture, designing maintainable test suites with Selenium/Cypress/Playwright, API automation, CI/CD pipeline integration, and scripting in JS/Python/Java.',
    requiredSkills: [
      'Test Automation Frameworks',
      'Selenium / Cypress / Playwright',
      'Scripting (JavaScript/Python/Java)',
      'API Automation',
      'CI/CD Integration',
      'Test Case Design',
    ],
    optionalSkills: [
      'Cucumber / BDD',
      'Appium',
      'Postman / Newman',
      'Git',
      'Jira',
    ],
    assignedHrTeam: 'HR2',
    scoringRubric: [
      {
        name: 'automationFrameworks',
        maxScore: 35,
        description:
          'Test automation design, Page Object Model (POM), Selenium, Cypress, Playwright',
        keywords: [
          'selenium',
          'cypress',
          'playwright',
          'automation framework',
          'page object model',
          'pom',
          'test automation',
          'webdriver',
        ],
      },
      {
        name: 'scriptingLanguage',
        maxScore: 25,
        description:
          'Scripting proficiency in JavaScript, TypeScript, Python, or Java for automated tests',
        keywords: [
          'javascript',
          'typescript',
          'python',
          'java',
          'scripting',
          'programming',
          'oop',
        ],
      },
      {
        name: 'apiAutomation',
        maxScore: 20,
        description:
          'Automated API testing, RestAssured, Supertest, Postman Newman, JSON assertions',
        keywords: [
          'api automation',
          'rest assured',
          'supertest',
          'postman',
          'newman',
          'api testing',
          'rest',
        ],
      },
      {
        name: 'ciCdAndGit',
        maxScore: 10,
        description:
          'CI/CD execution (Jenkins/GitHub Actions), Git version control, test reports',
        keywords: [
          'ci/cd',
          'jenkins',
          'github actions',
          'git',
          'allure',
          'reporting',
        ],
      },
      {
        name: 'testStrategyAndBdd',
        maxScore: 10,
        description: 'BDD / Cucumber, test planning, defect tracking with Jira',
        keywords: ['bdd', 'cucumber', 'gherkin', 'jira', 'test strategy'],
      },
    ],
  },
  {
    id: 'manual-tester',
    title: 'Manual Tester',
    canonicalRole: 'MANUAL_TESTER',
    aliases: [
      'manual tester',
      'manual test engineer',
      'manual qa',
      'manual software tester',
      'functional tester',
      'qa manual tester',
    ],
    description:
      'Codes for Tomorrow Manual Tester: Dedicated manual quality assurance testing role focusing on user scenarios, comprehensive test case writing, exploratory testing, regression cycles, and Jira bug tracking.',
    requiredSkills: [
      'Manual Testing',
      'Test Case Creation & Execution',
      'Defect Life Cycle & Bug Reporting',
      'STLC & SDLC',
      'Functional & Regression Testing',
    ],
    optionalSkills: [
      'Jira',
      'Bugzilla',
      'Smoke Testing',
      'Cross-Browser Testing',
      'API Testing Basics',
    ],
    assignedHrTeam: 'HR2',
    scoringRubric: [
      {
        name: 'manualTestingConcepts',
        maxScore: 35,
        description:
          'Manual testing principles, SDLC, STLC, functional, sanity, smoke, and regression testing',
        keywords: [
          'manual testing',
          'functional testing',
          'regression testing',
          'smoke testing',
          'sanity testing',
          'stlc',
          'sdlc',
        ],
      },
      {
        name: 'testCaseExecutionAndDesign',
        maxScore: 30,
        description:
          'Test case drafting, test scenarios, test data preparation, execution tracking',
        keywords: [
          'test cases',
          'test scenarios',
          'test execution',
          'boundary value',
          'equivalence partitioning',
          'test steps',
        ],
      },
      {
        name: 'bugReportingAndJira',
        maxScore: 20,
        description:
          'Bug logging, Jira, severity and priority classification, reproducing issues',
        keywords: [
          'jira',
          'bug reporting',
          'defect tracking',
          'severity',
          'priority',
          'retest',
          'bug life cycle',
        ],
      },
      {
        name: 'crossBrowserAndUsability',
        maxScore: 10,
        description:
          'Cross-browser testing, mobile responsive testing, usability evaluation',
        keywords: [
          'cross browser',
          'browser testing',
          'mobile testing',
          'usability testing',
        ],
      },
      {
        name: 'apiBasicsAndDatabase',
        maxScore: 5,
        description: 'Basic Postman API testing and SQL verification checks',
        keywords: ['postman', 'api', 'sql', 'queries'],
      },
    ],
  },
];
