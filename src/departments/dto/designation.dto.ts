import { z } from 'zod';

export const createDesignationSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Designation title is required')
    .max(100, 'Designation title cannot exceed 100 characters'),
});

export type CreateDesignationDto = z.infer<typeof createDesignationSchema>;

export const updateDesignationSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Designation title is required')
    .max(100, 'Designation title cannot exceed 100 characters'),
});

export type UpdateDesignationDto = z.infer<typeof updateDesignationSchema>;

