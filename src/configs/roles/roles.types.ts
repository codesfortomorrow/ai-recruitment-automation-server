import { CanonicalRole } from '../../candidate/candidate.types';

export interface JobRoleRubricSection {
  name: string;
  maxScore: number;
  description: string;
  keywords: string[];
}

export interface JobRoleDefinition {
  id: string;
  title: string;
  canonicalRole: CanonicalRole;
  aliases: string[];
  description: string;
  requiredSkills: string[];
  optionalSkills: string[];
  assignedHrTeam: 'HR1' | 'HR2' | 'RECRUITMENT';
  scoringRubric: JobRoleRubricSection[];
}
