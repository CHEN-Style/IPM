import { z } from 'zod';

export const ClassifyOutputSchema = z.object({
  targetRelPath: z.string().min(1),
  confidence: z.number().min(0).max(1),
  rationale: z.string().optional().default(''),
  classifiedBy: z.enum(['fast-path', 'agent', 'user-manual']).default('agent'),
  renameSuggestion: z.string().optional().default(''),
});
