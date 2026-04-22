/**
 * Tip Portal
 * Public-facing tip submission and case status system for families and communities.
 * @module tip-portal
 * @license GPL-3.0
 * @author OliWoods Foundation
 */
import { z } from 'zod';

export const TipSubmissionSchema = z.object({
  id: z.string().uuid(),
  caseId: z.string().optional(),
  submittedAt: z.string().datetime(),
  anonymous: z.boolean().default(true),
  contactInfo: z.object({ name: z.string(), phone: z.string().optional(), email: z.string().email().optional() }).optional(),
  sighting: z.object({
    date: z.string(),
    location: z.string(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    description: z.string(),
    confidence: z.enum(['certain', 'likely', 'possible', 'unsure']),
  }).optional(),
  information: z.string(),
  mediaAttachments: z.array(z.object({ type: z.enum(['photo', 'video', 'document']), filename: z.string() })).default([]),
  priority: z.enum(['routine', 'urgent', 'critical']),
  status: z.enum(['received', 'reviewing', 'forwarded-to-le', 'investigated', 'closed']),
});

export const PublicCaseViewSchema = z.object({
  caseNumber: z.string(),
  name: z.string(),
  age: z.number().int().positive(),
  sex: z.string(),
  lastSeenDate: z.string(),
  lastSeenLocation: z.string(),
  description: z.string(),
  photoUrl: z.string().optional(),
  status: z.enum(['active', 'cold', 'resolved']),
  contactAgency: z.string(),
  contactPhone: z.string(),
  tipCount: z.number().int().nonnegative(),
  shareable: z.boolean().default(true),
});

export const SearchAlertSchema = z.object({
  id: z.string().uuid(),
  subscriberEmail: z.string().email(),
  criteria: z.object({
    location: z.string().optional(),
    ageRange: z.object({ min: z.number(), max: z.number() }).optional(),
    sex: z.string().optional(),
    keyword: z.string().optional(),
  }),
  frequency: z.enum(['immediate', 'daily', 'weekly']),
  active: z.boolean().default(true),
});

export type TipSubmission = z.infer<typeof TipSubmissionSchema>;
export type PublicCaseView = z.infer<typeof PublicCaseViewSchema>;
export type SearchAlert = z.infer<typeof SearchAlertSchema>;

export function submitTip(
  caseId: string | undefined,
  information: string,
  options: { anonymous?: boolean; contactName?: string; sightingDate?: string; sightingLocation?: string; confidence?: string } = {},
): TipSubmission {
  const priority: TipSubmission['priority'] = options.confidence === 'certain' ? 'critical' : options.sightingDate ? 'urgent' : 'routine';
  return TipSubmissionSchema.parse({
    id: crypto.randomUUID(),
    caseId,
    submittedAt: new Date().toISOString(),
    anonymous: options.anonymous !== false,
    contactInfo: options.contactName ? { name: options.contactName } : undefined,
    sighting: options.sightingDate ? {
      date: options.sightingDate,
      location: options.sightingLocation || 'Not specified',
      description: information,
      confidence: (options.confidence as any) || 'possible',
    } : undefined,
    information,
    priority,
    status: 'received',
  });
}

export function prioritizeTips(tips: TipSubmission[]): TipSubmission[] {
  const priorityOrder = { critical: 0, urgent: 1, routine: 2 };
  return [...tips].sort((a, b) => {
    const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pDiff !== 0) return pDiff;
    return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
  });
}

export function generateShareableFlyer(caseView: PublicCaseView): string {
  return [
    `MISSING: ${caseView.name}`,
    `Age: ${caseView.age} | ${caseView.sex}`,
    `Last Seen: ${caseView.lastSeenDate} in ${caseView.lastSeenLocation}`,
    `Description: ${caseView.description}`,
    '',
    `If you have information, contact: ${caseView.contactAgency} at ${caseView.contactPhone}`,
    `Case #: ${caseView.caseNumber}`,
    `Tips received: ${caseView.tipCount}`,
    '',
    'Submit tips anonymously at foundation-found.oliwoods.ai',
  ].join('\n');
}
