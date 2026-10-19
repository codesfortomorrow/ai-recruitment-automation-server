import { JobRoleDefinition } from './roles.types';

export const MARKETING_JOB_ROLES: JobRoleDefinition[] = [
  {
    id: 'digital-marketer',
    title: 'Digital Marketer',
    canonicalRole: 'DIGITAL_MARKETER',
    aliases: [
      'digital marketer',
      'digital marketing specialist',
      'digital marketing strategist',
      'online marketing specialist',
      'internet marketer',
      'digital marketing',
    ],
    description:
      'Codes for Tomorrow Digital Marketer: Generalist digital marketing role covering multi-channel digital campaigns, organic search optimization (SEO), social media engagement, content strategy, email marketing, and web traffic analytics.',
    requiredSkills: [
      'Digital Marketing Campaigns',
      'SEO / Search Engine Optimization',
      'Social Media Marketing',
      'Google Analytics',
      'Content Strategy',
      'Paid Ads Basics',
    ],
    optionalSkills: [
      'Email Marketing',
      'Copywriting',
      'Canva / Design Basics',
      'WordPress',
      'Conversion Rate Optimization',
    ],
    assignedHrTeam: 'HR2',
    scoringRubric: [
      {
        name: 'digitalMarketingCampaigns',
        maxScore: 30,
        description:
          'Multi-channel digital marketing campaigns, lead generation, branding, and marketing funnels',
        keywords: [
          'digital marketing',
          'campaigns',
          'lead generation',
          'marketing funnel',
          'inbound marketing',
          'outbound marketing',
        ],
      },
      {
        name: 'seoAndOrganicTraffic',
        maxScore: 25,
        description:
          'SEO fundamentals, keyword research, on-page optimization, and organic growth',
        keywords: [
          'seo',
          'search engine optimization',
          'keywords',
          'organic traffic',
          'on-page',
          'backlinks',
        ],
      },
      {
        name: 'socialMediaAndContent',
        maxScore: 20,
        description:
          'Social media marketing, content marketing, copywriting, and brand awareness',
        keywords: [
          'social media',
          'smm',
          'content strategy',
          'copywriting',
          'instagram',
          'linkedin',
          'facebook',
        ],
      },
      {
        name: 'analyticsAndReporting',
        maxScore: 15,
        description:
          'Web analytics, Google Analytics (GA4), KPI tracking, and ROI reporting',
        keywords: [
          'google analytics',
          'ga4',
          'analytics',
          'kpis',
          'reporting',
          'conversion rate',
        ],
      },
      {
        name: 'paidAdvertisingBasics',
        maxScore: 10,
        description: 'Paid ads, Google Ads, Meta Ads, and basic PPC knowledge',
        keywords: ['google ads', 'paid ads', 'ppc', 'meta ads', 'facebook ads'],
      },
    ],
  },
  {
    id: 'digital-marketing-executive',
    title: 'Digital Marketing Executive',
    canonicalRole: 'DIGITAL_MARKETING_EXECUTIVE',
    aliases: [
      'digital marketing executive',
      'sr digital marketing executive',
      'senior digital marketing executive',
      'digital marketing associate',
      'digital marketing officer',
    ],
    description:
      'Codes for Tomorrow Digital Marketing Executive: Hands-on marketing execution role focused on running paid search and social campaigns, optimizing search engine presence, driving inbound leads, email automation, and performance reporting.',
    requiredSkills: [
      'Digital Marketing Campaign Execution',
      'SEO & Organic Growth',
      'Social Media Management',
      'Google Ads & Paid Search',
      'Performance Tracking & Analytics',
      'Lead Generation',
    ],
    optionalSkills: [
      'Meta Ads / Facebook Ads',
      'Email Automation',
      'A/B Testing',
      'Content Marketing',
      'HubSpot',
    ],
    assignedHrTeam: 'HR2',
    scoringRubric: [
      {
        name: 'campaignExecutionAndLeads',
        maxScore: 30,
        description:
          'End-to-end execution of digital marketing campaigns, lead nurturing, and conversion funnels',
        keywords: [
          'campaign execution',
          'lead generation',
          'digital marketing',
          'conversion funnel',
          'email marketing',
        ],
      },
      {
        name: 'seoAndSearchOptimization',
        maxScore: 25,
        description:
          'Keyword research, on-page SEO, technical SEO, link building, and SERP rankings',
        keywords: [
          'seo',
          'search engine optimization',
          'keyword research',
          'on-page seo',
          'backlinks',
          'ranking',
        ],
      },
      {
        name: 'paidMediaAndPpc',
        maxScore: 20,
        description:
          'Google Ads, Search Ads, Display Ads, Meta Ads, budget allocation, and ad copy',
        keywords: [
          'google ads',
          'meta ads',
          'ppc',
          'paid search',
          'ad campaigns',
          'facebook ads',
        ],
      },
      {
        name: 'analyticsAndConversion',
        maxScore: 15,
        description:
          'Google Analytics (GA4), Search Console, conversion tracking, and monthly performance reviews',
        keywords: [
          'google analytics',
          'ga4',
          'search console',
          'conversion rate',
          'roas',
          'metrics',
        ],
      },
      {
        name: 'socialMediaAndCreatives',
        maxScore: 10,
        description:
          'Social media channel growth, creative brief coordination, and engagement tactics',
        keywords: [
          'social media',
          'linkedin',
          'instagram',
          'creatives',
          'engagement',
        ],
      },
    ],
  },
  {
    id: 'seo-specialist',
    title: 'SEO Specialist',
    canonicalRole: 'SEO_SPECIALIST',
    aliases: [
      'seo specialist',
      'seo executive',
      'seo analyst',
      'search engine optimization specialist',
      'seo expert',
      'search engine optimizer',
      'seo consultant',
      'seo',
    ],
    description:
      'Codes for Tomorrow SEO Specialist: Dedicated search engine optimization expert responsible for technical SEO audits, comprehensive keyword research, on-page content optimization, high-authority backlink strategies, and organic SERP growth.',
    requiredSkills: [
      'On-Page SEO',
      'Off-Page SEO & Link Building',
      'Technical SEO',
      'Keyword Research',
      'Google Search Console & Google Analytics',
      'SEO Audit Tools (Ahrefs / SEMrush)',
    ],
    optionalSkills: [
      'Content Optimization',
      'Site Speed / Core Web Vitals',
      'Local SEO',
      'Schema Markup',
    ],
    assignedHrTeam: 'HR2',
    scoringRubric: [
      {
        name: 'onPageAndKeywordResearch',
        maxScore: 30,
        description:
          'Keyword research, search intent, title tags, meta descriptions, heading structure, and content optimization',
        keywords: [
          'keyword research',
          'on page seo',
          'meta tags',
          'search intent',
          'content optimization',
          'h1',
          'seo',
        ],
      },
      {
        name: 'technicalSeoAndAudits',
        maxScore: 25,
        description:
          'Site architecture, XML sitemaps, robots.txt, canonicalization, Core Web Vitals, and crawlability',
        keywords: [
          'technical seo',
          'xml sitemap',
          'robots.txt',
          'canonical',
          'crawlability',
          'core web vitals',
          'site speed',
        ],
      },
      {
        name: 'offPageAndLinkBuilding',
        maxScore: 20,
        description:
          'White-hat backlink outreach, guest posting, link profiles, and domain authority enhancement',
        keywords: [
          'backlinks',
          'link building',
          'off page seo',
          'domain authority',
          'guest post',
          'outreach',
        ],
      },
      {
        name: 'toolsAndSearchConsole',
        maxScore: 15,
        description:
          'Google Search Console, Google Analytics, Ahrefs, SEMrush, Screaming Frog audits',
        keywords: [
          'search console',
          'google analytics',
          'ahrefs',
          'semrush',
          'screaming frog',
          'seo audit',
        ],
      },
      {
        name: 'serpTrackingAndReporting',
        maxScore: 10,
        description:
          'Keyword ranking reports, organic traffic trends, competitor analysis, and algorithm updates',
        keywords: [
          'serp',
          'ranking report',
          'organic traffic',
          'competitor analysis',
          'algorithm',
        ],
      },
    ],
  },
  {
    id: 'social-media-manager',
    title: 'Social Media Manager',
    canonicalRole: 'SOCIAL_MEDIA_MANAGER',
    aliases: [
      'social media manager',
      'social media executive',
      'social media specialist',
      'smm',
      'social media strategist',
      'social media marketer',
    ],
    description:
      'Codes for Tomorrow Social Media Manager: Builds brand awareness, creates captivating social media content calendars, drives community engagement, and executes cross-platform social growth strategies across LinkedIn, Instagram, Facebook, and Twitter/X.',
    requiredSkills: [
      'Social Media Strategy & Planning',
      'Content Creation & Scheduling',
      'Community Management & Engagement',
      'Analytics & Social Metrics',
      'Platform Expertise (LinkedIn, Instagram, Twitter, Facebook)',
      'Copywriting',
    ],
    optionalSkills: [
      'Canva / Adobe Photoshop',
      'Influencer Marketing',
      'Paid Social Campaigns',
      'Video / Reels Production',
    ],
    assignedHrTeam: 'HR2',
    scoringRubric: [
      {
        name: 'socialMediaStrategyAndCalendar',
        maxScore: 35,
        description:
          'Platform strategy, editorial content calendar, publishing schedules, brand voice',
        keywords: [
          'social media strategy',
          'content calendar',
          'brand voice',
          'social media',
          'publishing',
          'planning',
        ],
      },
      {
        name: 'contentCreationAndCopywriting',
        maxScore: 25,
        description:
          'Compelling social copywriting, captions, storytelling, Canva/visual design coordination',
        keywords: [
          'copywriting',
          'captions',
          'content creation',
          'canva',
          'reels',
          'storytelling',
          'creatives',
        ],
      },
      {
        name: 'platformExpertise',
        maxScore: 20,
        description:
          'In-depth expertise in LinkedIn company pages, Instagram growth, Facebook, Twitter/X, and YouTube',
        keywords: [
          'linkedin',
          'instagram',
          'facebook',
          'twitter',
          'youtube',
          'hashtags',
          'trends',
        ],
      },
      {
        name: 'communityManagementAndEngagement',
        maxScore: 10,
        description:
          'Replying to comments/DMs, audience engagement, customer sentiment, brand reputation',
        keywords: [
          'community management',
          'engagement',
          'comments',
          'moderation',
          'sentiment',
        ],
      },
      {
        name: 'socialMetricsAndReporting',
        maxScore: 10,
        description:
          'Tracking reach, impressions, engagement rates, click-through rates, and monthly growth',
        keywords: [
          'engagement rate',
          'reach',
          'impressions',
          'social analytics',
          'reporting',
        ],
      },
    ],
  },
  {
    id: 'content-marketer',
    title: 'Content Marketer',
    canonicalRole: 'CONTENT_MARKETER',
    aliases: [
      'content marketer',
      'content marketing specialist',
      'content strategist',
      'content writer and marketer',
      'content creator',
    ],
    description:
      'Codes for Tomorrow Content Marketer: Plans, crafts, and distributes high-value content (articles, case studies, whitepapers, email newsletters) that educates prospects, enhances SEO, and drives inbound conversions.',
    requiredSkills: [
      'Content Writing & Copywriting',
      'Content Strategy & Editorial Calendar',
      'SEO-Optimized Content',
      'Blog Posts & Articles',
      'Brand Storytelling & Messaging',
      'Audience Research',
    ],
    optionalSkills: [
      'Email Newsletters',
      'Case Studies & Whitepapers',
      'WordPress / CMS',
      'Social Media Copy',
      'Content Analytics',
    ],
    assignedHrTeam: 'HR2',
    scoringRubric: [
      {
        name: 'contentWritingAndStorytelling',
        maxScore: 35,
        description:
          'High quality long-form articles, case studies, blogs, storytelling, and brand voice adherence',
        keywords: [
          'content writing',
          'copywriting',
          'blog posts',
          'case studies',
          'articles',
          'storytelling',
          'editing',
        ],
      },
      {
        name: 'contentStrategyAndEditorial',
        maxScore: 25,
        description:
          'Content roadmap, editorial calendar, buyer personas, content lifecycle management',
        keywords: [
          'content strategy',
          'editorial calendar',
          'buyer persona',
          'content planning',
          'inbound marketing',
        ],
      },
      {
        name: 'seoContentOptimization',
        maxScore: 20,
        description:
          'Keyword integration, search intent mapping, readable headings, on-page optimization',
        keywords: [
          'seo content',
          'keyword integration',
          'search intent',
          'readability',
          'meta description',
        ],
      },
      {
        name: 'distributionAndCms',
        maxScore: 10,
        description:
          'CMS publishing (WordPress), email newsletters, lead magnets, social content repurposing',
        keywords: [
          'wordpress',
          'cms',
          'newsletters',
          'distribution',
          'lead magnets',
        ],
      },
      {
        name: 'performanceTracking',
        maxScore: 10,
        description:
          'Content performance analysis (time on page, bounce rate, leads generated)',
        keywords: [
          'content performance',
          'google analytics',
          'time on page',
          'conversions',
        ],
      },
    ],
  },
  {
    id: 'performance-marketer',
    title: 'Performance Marketer',
    canonicalRole: 'PERFORMANCE_MARKETER',
    aliases: [
      'performance marketer',
      'performance marketing specialist',
      'performance marketing manager',
      'ppc specialist',
      'paid media specialist',
      'growth marketer',
      'performance marketing executive',
    ],
    description:
      'Codes for Tomorrow Performance Marketer: Quantitative growth marketer responsible for paid search (Google Ads), paid social (Meta Ads, LinkedIn), conversion tracking, ROAS optimization, CAC reduction, and data-driven ad testing.',
    requiredSkills: [
      'Google Ads (Search, Display, YouTube)',
      'Meta Ads (Facebook & Instagram Ads)',
      'PPC Campaign Optimization',
      'ROAS / CAC / Conversion Tracking',
      'A/B Testing & Ad Creatives',
      'Analytics & Data-Driven Budgeting',
    ],
    optionalSkills: [
      'LinkedIn Ads',
      'Google Tag Manager',
      'Landing Page Optimization',
      'Remarketing / Retargeting',
    ],
    assignedHrTeam: 'HR2',
    scoringRubric: [
      {
        name: 'googleAdsAndPpc',
        maxScore: 30,
        description:
          'Google Search Ads, Display, YouTube Ads, bidding strategies, keyword match types, Quality Score',
        keywords: [
          'google ads',
          'ppc',
          'search ads',
          'display ads',
          'bidding strategy',
          'quality score',
          'adwords',
        ],
      },
      {
        name: 'paidSocialAndMetaAds',
        maxScore: 25,
        description:
          'Meta Ads Manager (Facebook/Instagram), custom audiences, lookalike audiences, ad creatives',
        keywords: [
          'meta ads',
          'facebook ads',
          'instagram ads',
          'ads manager',
          'lookalike audience',
          'custom audience',
        ],
      },
      {
        name: 'roasCacAndBudgeting',
        maxScore: 20,
        description:
          'Maximizing Return on Ad Spend (ROAS), Customer Acquisition Cost (CAC), budget scaling',
        keywords: [
          'roas',
          'cac',
          'cpa',
          'roi',
          'budgeting',
          'scaling',
          'ad spend',
          'cpc',
        ],
      },
      {
        name: 'conversionTrackingAndGtm',
        maxScore: 15,
        description:
          'Google Tag Manager, conversion pixels, event tracking, GA4 attribution modeling',
        keywords: [
          'google tag manager',
          'gtm',
          'pixel',
          'conversion tracking',
          'attribution',
          'ga4',
        ],
      },
      {
        name: 'abTestingAndLandingPages',
        maxScore: 10,
        description:
          'Split testing ad headlines, creative variations, landing page conversion optimization',
        keywords: [
          'a/b testing',
          'split testing',
          'landing page',
          'cro',
          'ad copy',
        ],
      },
    ],
  },
];
