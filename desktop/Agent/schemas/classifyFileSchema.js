import { z } from 'zod';

export const FolderCandidateSchema = z.object({
  relPath: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(''),
});

export const ClassifyFileInputSchema = z.object({
  // projects/cases: non-empty name; study: may be empty (fixed root)
  projectName: z.string().optional().default(''),
  sourceRelPath: z.string().min(1),
  fileName: z.string().min(1),
  ext: z.string().optional().default(''),
  // Optional hint from temp-source-record.json (absolute dir path on user machine)
  sourceDir: z.string().optional().default(''),
  folders: z.array(FolderCandidateSchema).min(1),
});

export const ClassifyFileOutputSchema = z.object({
  targetRelPath: z.string().min(1),
  rationale: z.string().optional().default(''),
});


