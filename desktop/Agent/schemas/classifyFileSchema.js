import { z } from 'zod';

export const FolderCandidateSchema = z.object({
  relPath: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(''),
});

export const ClassifyFileInputSchema = z.object({
  projectName: z.string().min(1),
  sourceRelPath: z.string().min(1),
  fileName: z.string().min(1),
  ext: z.string().optional().default(''),
  folders: z.array(FolderCandidateSchema).min(1),
});

export const ClassifyFileOutputSchema = z.object({
  targetRelPath: z.string().min(1),
  rationale: z.string().optional().default(''),
});


