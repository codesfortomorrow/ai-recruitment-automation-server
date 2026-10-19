import { JobRoleDefinition } from './roles.types';

export const DESIGN_JOB_ROLES: JobRoleDefinition[] = [
  {
    id: 'video-editor',
    title: 'Video Editor',
    canonicalRole: 'VIDEO_EDITOR',
    aliases: [
      'video editor',
      'video editing specialist',
      'video producer',
      'video content creator',
      'video editing',
      'lead video editor',
    ],
    description:
      'Codes for Tomorrow Video Editor: Crafts high-retention video content, product demos, social reels, and promotional videos. Evaluates proficiency in Adobe Premiere Pro/DaVinci Resolve, pacing, color grading, sound design, transitions, and storytelling.',
    requiredSkills: [
      'Video Editing Software (Premiere Pro, DaVinci Resolve, or Final Cut)',
      'Color Correction & Grading',
      'Audio Editing & Sound Design',
      'Pacing, Transitions & Storytelling',
      'Short-form & Long-form Video Production',
      'Rendering & Codecs',
    ],
    optionalSkills: [
      'After Effects Basics',
      'Motion Graphics',
      'Thumbnail Design',
      'Subtitles / Captions',
      'Camera & Lighting Basics',
    ],
    assignedHrTeam: 'HR1',
    scoringRubric: [
      {
        name: 'videoEditingSoftware',
        maxScore: 30,
        description:
          'Timeline editing in Adobe Premiere Pro, DaVinci Resolve, or Final Cut Pro',
        keywords: [
          'premiere pro',
          'premiere',
          'davinci resolve',
          'final cut',
          'timeline editing',
          'cutting',
          'video editing software',
        ],
      },
      {
        name: 'storytellingAndPacing',
        maxScore: 25,
        description:
          'Narrative structure, transitions, cuts (J-cut/L-cut), hook retention, and rhythm',
        keywords: [
          'storytelling',
          'pacing',
          'transitions',
          'cuts',
          'hook',
          'retention',
          'editing',
        ],
      },
      {
        name: 'audioDesignAndMixing',
        maxScore: 20,
        description:
          'Dialogue cleanup, audio mastering, sound effects (SFX), background score synchronization',
        keywords: [
          'audio editing',
          'sound design',
          'sfx',
          'foley',
          'audio mixing',
          'noise reduction',
        ],
      },
      {
        name: 'colorGradingAndVisualEffects',
        maxScore: 15,
        description:
          'Color correction, LUTs, color grading, visual consistency, and basic VFX',
        keywords: [
          'color grading',
          'color correction',
          'luts',
          'lumetri',
          'visual effects',
          'vfx',
        ],
      },
      {
        name: 'motionAndCaptions',
        maxScore: 10,
        description:
          'Basic After Effects motion graphics, title cards, animated subtitles, export optimization',
        keywords: [
          'after effects',
          'motion graphics',
          'captions',
          'subtitles',
          'rendering',
          'codecs',
        ],
      },
    ],
  },
  {
    id: 'motion-graphics-designer',
    title: 'Motion Graphics Designer',
    canonicalRole: 'MOTION_GRAPHICS_DESIGNER',
    aliases: [
      'motion graphics designer',
      'motion designer',
      'motion graphics artist',
      'animator',
      '2d animator',
      'motion graphics',
    ],
    description:
      'Codes for Tomorrow Motion Graphics Designer: Brings static graphics to life with fluid animation, kinetic typography, 2D/3D visual effects, and animated brand identity using Adobe After Effects and supporting motion tools.',
    requiredSkills: [
      'Adobe After Effects',
      'Animation Principles & Timing',
      'Typography & Title Animation',
      'Visual Effects (VFX) & Compositing',
      'Illustrator / Photoshop for Motion',
      'Storyboarding',
    ],
    optionalSkills: [
      'Cinema 4D / Blender / 3D Motion',
      'Lottie / JSON Animations',
      'Premiere Pro',
      'Character Animation',
    ],
    assignedHrTeam: 'HR1',
    scoringRubric: [
      {
        name: 'afterEffectsProficiency',
        maxScore: 35,
        description:
          'Mastery of Adobe After Effects, keyframe graph editor, expressions, masks, and shape layers',
        keywords: [
          'after effects',
          'adobe after effects',
          'keyframing',
          'graph editor',
          'expressions',
          'shape layers',
          'motion graphics',
        ],
      },
      {
        name: 'animationPrinciplesAndTiming',
        maxScore: 25,
        description:
          '12 principles of animation, anticipation, follow-through, easing, weight, and visual dynamics',
        keywords: [
          'animation principles',
          'easing',
          'timing',
          'kinetic typography',
          'anticipation',
          'visual dynamics',
        ],
      },
      {
        name: 'assetPreparationAndCompositing',
        maxScore: 20,
        description:
          'Vector asset preparation from Illustrator/Photoshop, layer organization, compositing',
        keywords: [
          'illustrator',
          'photoshop',
          'compositing',
          'vector',
          'storyboard',
          'assets',
        ],
      },
      {
        name: 'threeDAndAdvancedTools',
        maxScore: 10,
        description:
          'Cinema 4D, Blender, 3D element rendering, or Lottie web animations',
        keywords: ['3d animation', 'cinema 4d', 'blender', 'lottie', 'render'],
      },
      {
        name: 'projectPortfolioAndBranding',
        maxScore: 10,
        description:
          'Motion branding, title reveals, explainer video animations, and showreel quality',
        keywords: [
          'showreel',
          'portfolio',
          'explainer video',
          'branding',
          'logo animation',
        ],
      },
    ],
  },
  {
    id: 'graphic-designer',
    title: 'Graphic Designer',
    canonicalRole: 'GRAPHIC_DESIGNER',
    aliases: [
      'graphic designer',
      'visual designer',
      'creative designer',
      'brand designer',
      'graphic artist',
    ],
    description:
      'Codes for Tomorrow Graphic Designer: Conceptualizes and creates stunning visual assets, social media banners, marketing collateral, brand guidelines, typography systems, and digital promotional graphics using Photoshop and Illustrator.',
    requiredSkills: [
      'Adobe Photoshop',
      'Adobe Illustrator',
      'Visual Design & Layout',
      'Typography & Color Theory',
      'Branding & Social Media Creatives',
      'Print & Digital Asset Creation',
    ],
    optionalSkills: [
      'Figma',
      'InDesign',
      'Banner / Poster Design',
      'Vector Illustration',
      'Photo Retouching',
    ],
    assignedHrTeam: 'HR1',
    scoringRubric: [
      {
        name: 'photoshopAndIllustrator',
        maxScore: 35,
        description:
          'Advanced proficiency in Adobe Photoshop and Adobe Illustrator for vector and raster graphics',
        keywords: [
          'photoshop',
          'adobe photoshop',
          'illustrator',
          'adobe illustrator',
          'vector graphics',
          'raster',
        ],
      },
      {
        name: 'visualCompositionAndColor',
        maxScore: 25,
        description:
          'Visual balance, layout composition, typography pairing, contrast, and color psychology',
        keywords: [
          'visual design',
          'typography',
          'color theory',
          'layout',
          'composition',
          'visual balance',
        ],
      },
      {
        name: 'brandingAndMarketingCreatives',
        maxScore: 20,
        description:
          'Brand identity design, logos, social media posters, ad creatives, brochures, banners',
        keywords: [
          'branding',
          'logo design',
          'social media creatives',
          'posters',
          'banners',
          'marketing collateral',
        ],
      },
      {
        name: 'figmaAndDigitalTools',
        maxScore: 10,
        description:
          'Figma layout creation, InDesign publishing, Canva, and digital prototyping tools',
        keywords: ['figma', 'indesign', 'digital assets', 'ui mockups'],
      },
      {
        name: 'portfolioAndAttentionToDetail',
        maxScore: 10,
        description:
          'Creative portfolio presentation, photo manipulation, attention to detail, and export formats',
        keywords: [
          'portfolio',
          'photo retouching',
          'manipulation',
          'print ready',
          'exports',
        ],
      },
    ],
  },
  {
    id: 'ui-ux-designer',
    title: 'UI/UX Designer',
    canonicalRole: 'UI_UX_DESIGNER',
    aliases: [
      'ui ux designer',
      'ui/ux designer',
      'ui-ux designer',
      'product designer',
      'ux/ui designer',
      'ui ux',
      'ux ui designer',
      'ui and ux designer',
    ],
    description:
      'Codes for Tomorrow UI/UX Designer: End-to-end digital product design role encompassing user research, journey mapping, wireframing, high-fidelity UI mockups, interactive prototyping in Figma, and usability testing.',
    requiredSkills: [
      'User Research & Personas',
      'Wireframing & Information Architecture',
      'Interactive Prototyping',
      'User Flows & Journey Maps',
      'Usability Testing',
      'Figma or Design Systems',
    ],
    optionalSkills: [
      'Adobe XD',
      'Micro-interactions',
      'Responsive Web & Mobile Design',
      'Design Thinking',
      'Visual Hierarchy',
    ],
    assignedHrTeam: 'HR1',
    scoringRubric: [
      {
        name: 'figmaAndUiDesign',
        maxScore: 30,
        description:
          'High-fidelity UI design in Figma, design systems, autolayout, components, and design tokens',
        keywords: [
          'figma',
          'ui design',
          'design system',
          'components',
          'auto layout',
          'tokens',
          'high fidelity',
        ],
      },
      {
        name: 'userResearchAndUsability',
        maxScore: 25,
        description:
          'User interviews, persona building, user research methodologies, usability testing, and feedback loops',
        keywords: [
          'user research',
          'usability testing',
          'user interviews',
          'personas',
          'heuristic evaluation',
          'ux research',
        ],
      },
      {
        name: 'wireframingAndInformationArch',
        maxScore: 20,
        description:
          'Low/mid-fidelity wireframing, information architecture (IA), site maps, and user journey mapping',
        keywords: [
          'wireframes',
          'wireframing',
          'information architecture',
          'user journey',
          'user flows',
          'sitemap',
        ],
      },
      {
        name: 'prototypingAndMicroInteractions',
        maxScore: 15,
        description:
          'Interactive clickable prototypes in Figma, micro-interactions, responsive web/mobile layouts',
        keywords: [
          'prototyping',
          'interactive prototype',
          'micro interactions',
          'responsive',
          'mobile app design',
        ],
      },
      {
        name: 'developerHandoffAndCollaboration',
        maxScore: 10,
        description:
          'Design handoff specifications, collaboration with engineers, design critiques, and accessibility',
        keywords: [
          'developer handoff',
          'handoff',
          'accessibility',
          'a11y',
          'design review',
        ],
      },
    ],
  },
  {
    id: 'ui-designer',
    title: 'UI Designer',
    canonicalRole: 'UI_DESIGNER',
    aliases: [
      'ui designer',
      'user interface designer',
      'visual ui designer',
      'ui specialist',
      'ui visual designer',
    ],
    description:
      'Codes for Tomorrow UI Designer: Focuses on aesthetics, layout, visual hierarchy, iconography, design systems, responsive UI components, and pixel-perfect high-fidelity interface screens in Figma.',
    requiredSkills: [
      'Visual UI Design',
      'Design Systems & Component Libraries',
      'Figma / Sketch',
      'Typography & Color Palettes',
      'Responsive Web & App Layouts',
      'High-Fidelity Mockups',
    ],
    optionalSkills: [
      'Prototyping',
      'Iconography',
      'Micro-interactions',
      'Design Handoff to Developers',
    ],
    assignedHrTeam: 'HR1',
    scoringRubric: [
      {
        name: 'visualUiAndFigma',
        maxScore: 35,
        description:
          'Figma proficiency, visual UI screens, components, auto layout, and responsive layouts',
        keywords: [
          'figma',
          'ui design',
          'visual design',
          'auto layout',
          'components',
          'mockups',
          'screens',
        ],
      },
      {
        name: 'designSystemsAndLibraries',
        maxScore: 25,
        description:
          'Building and maintaining design systems, style guides, color palettes, and typography scales',
        keywords: [
          'design system',
          'style guide',
          'color palette',
          'typography',
          'tokens',
          'component library',
        ],
      },
      {
        name: 'iconographyAndVisualAssets',
        maxScore: 20,
        description:
          'Custom icons, visual hierarchy, illustration integration, spacing, and grid systems',
        keywords: [
          'iconography',
          'visual hierarchy',
          'grid system',
          'spacing',
          'illustrations',
        ],
      },
      {
        name: 'responsiveAppDesign',
        maxScore: 10,
        description:
          'Designing adaptive interfaces across mobile, tablet, and desktop viewports',
        keywords: ['responsive design', 'mobile ui', 'web ui', 'viewports'],
      },
      {
        name: 'developerHandoff',
        maxScore: 10,
        description:
          'Exporting assets, specs, and collaborating closely with frontend engineers',
        keywords: [
          'developer handoff',
          'specs',
          'export',
          'frontend collaboration',
        ],
      },
    ],
  },
  {
    id: 'ux-designer',
    title: 'UX Designer',
    canonicalRole: 'UX_DESIGNER',
    aliases: [
      'ux designer',
      'user experience designer',
      'ux researcher',
      'interaction designer',
      'ux architect',
    ],
    description:
      'Codes for Tomorrow UX Designer: Specializes in deep user empathy, heuristic analysis, user journeys, wireframing complex workflows, conducting usability tests, and solving user pain points with data-informed UX decisions.',
    requiredSkills: [
      'User Research & Interviewing',
      'Information Architecture & Wireframing',
      'User Journey Mapping & User Flows',
      'Usability Testing & Heuristic Evaluation',
      'Prototyping',
      'Problem Definition',
    ],
    optionalSkills: [
      'Figma',
      'Miro / FigJam',
      'Accessibility (a11y) Standards',
      'Data & Metric-Driven UX',
      'Design Thinking Workshops',
    ],
    assignedHrTeam: 'HR1',
    scoringRubric: [
      {
        name: 'userResearchAndAnalysis',
        maxScore: 35,
        description:
          'Conducting user interviews, surveys, empathy mapping, user personas, and synthesizing insights',
        keywords: [
          'user research',
          'user interviews',
          'personas',
          'empathy map',
          'user testing',
          'insights',
        ],
      },
      {
        name: 'informationArchAndFlows',
        maxScore: 25,
        description:
          'User journey mapping, task flows, information architecture, site navigation hierarchies',
        keywords: [
          'information architecture',
          'user journey',
          'user flows',
          'task flow',
          'sitemap',
          'navigation',
        ],
      },
      {
        name: 'wireframingAndTesting',
        maxScore: 20,
        description:
          'Low/mid-fidelity wireframing, rapid paper/digital prototyping, usability testing sessions',
        keywords: [
          'wireframes',
          'wireframing',
          'usability testing',
          'heuristic evaluation',
          'paper prototyping',
        ],
      },
      {
        name: 'accessibilityAndDesignThinking',
        maxScore: 10,
        description:
          'WCAG accessibility standards, inclusive design, design thinking frameworks',
        keywords: [
          'accessibility',
          'a11y',
          'wcag',
          'inclusive design',
          'design thinking',
        ],
      },
      {
        name: 'dataDrivenUxAndMetrics',
        maxScore: 10,
        description:
          'Tracking UX metrics (SUS, completion rate, error rate), collaborating with product managers',
        keywords: [
          'ux metrics',
          'sus',
          'product management',
          'analytics',
          'conversion funnel',
        ],
      },
    ],
  },
];
