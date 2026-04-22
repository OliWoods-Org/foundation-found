/**
 * Pattern Analyzer
 * Find overlooked connections across jurisdictions in missing persons cases.
 * @module pattern-analyzer
 * @license GPL-3.0
 * @author OliWoods Foundation
 */
import { z } from 'zod';

export const PatternClusterSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['geographic', 'temporal', 'demographic', 'circumstantial', 'route']),
  caseIds: z.array(z.string()),
  description: z.string(),
  confidence: z.number().min(0).max(100),
  centroid: z.object({ lat: z.number(), lng: z.number() }).optional(),
  dateRange: z.object({ start: z.string(), end: z.string() }).optional(),
  commonFactors: z.array(z.string()),
  riskAssessment: z.string(),
});

export const JurisdictionGapSchema = z.object({
  caseId: z.string(),
  reportingJurisdiction: z.string(),
  lastSeenJurisdiction: z.string(),
  additionalJurisdictions: z.array(z.string()),
  gapType: z.enum(['cross-state', 'cross-county', 'tribal-federal', 'international']),
  recommendation: z.string(),
});

export const TimelineEventSchema = z.object({
  caseId: z.string(),
  date: z.string(),
  type: z.enum(['last-seen', 'reported-missing', 'sighting', 'tip', 'evidence-found', 'remains-found', 'resolved']),
  location: z.string(),
  description: z.string(),
  verified: z.boolean(),
});

export type PatternCluster = z.infer<typeof PatternClusterSchema>;
export type JurisdictionGap = z.infer<typeof JurisdictionGapSchema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export function detectGeographicClusters(
  cases: Array<{ id: string; lat: number; lng: number; date: string; demographics: Record<string, string> }>,
  radiusMiles: number = 50,
  minClusterSize: number = 3,
): PatternCluster[] {
  const clusters: PatternCluster[] = [];
  const assigned = new Set<string>();

  for (const center of cases) {
    if (assigned.has(center.id)) continue;
    const nearby = cases.filter(c => {
      if (c.id === center.id || assigned.has(c.id)) return false;
      const dist = haversine(center.lat, center.lng, c.lat, c.lng);
      return dist <= radiusMiles;
    });
    if (nearby.length + 1 >= minClusterSize) {
      const clusterCases = [center, ...nearby];
      clusterCases.forEach(c => assigned.add(c.id));
      const dates = clusterCases.map(c => c.date).sort();
      const commonDemos = findCommonFactors(clusterCases.map(c => c.demographics));
      clusters.push(PatternClusterSchema.parse({
        id: crypto.randomUUID(),
        type: 'geographic',
        caseIds: clusterCases.map(c => c.id),
        description: `${clusterCases.length} cases within ${radiusMiles} miles`,
        confidence: Math.min(90, 40 + clusterCases.length * 10),
        centroid: { lat: avg(clusterCases.map(c => c.lat)), lng: avg(clusterCases.map(c => c.lng)) },
        dateRange: { start: dates[0], end: dates[dates.length - 1] },
        commonFactors: commonDemos,
        riskAssessment: clusterCases.length >= 5 ? 'HIGH: Significant cluster requiring multi-agency review' : 'MODERATE: Pattern warrants further investigation',
      }));
    }
  }
  return clusters;
}

export function identifyJurisdictionGaps(
  cases: Array<{ id: string; reportingJurisdiction: string; lastSeenLocation: string; otherLocations: string[] }>,
): JurisdictionGap[] {
  return cases.filter(c => c.reportingJurisdiction !== c.lastSeenLocation || c.otherLocations.length > 0).map(c => {
    const allJurisdictions = [c.reportingJurisdiction, c.lastSeenLocation, ...c.otherLocations];
    const states = new Set(allJurisdictions.map(j => j.split(',').pop()?.trim()).filter(Boolean));
    const isTribal = allJurisdictions.some(j => /tribal|reservation|nation/i.test(j));
    const gapType: JurisdictionGap['gapType'] = isTribal ? 'tribal-federal' : states.size > 1 ? 'cross-state' : 'cross-county';
    return JurisdictionGapSchema.parse({
      caseId: c.id,
      reportingJurisdiction: c.reportingJurisdiction,
      lastSeenJurisdiction: c.lastSeenLocation,
      additionalJurisdictions: c.otherLocations,
      gapType,
      recommendation: gapType === 'tribal-federal'
        ? 'CRITICAL: Tribal-federal jurisdiction gap. Contact FBI Indian Country Crimes Unit and tribal law enforcement.'
        : gapType === 'cross-state'
        ? 'Contact all state law enforcement agencies. Verify NamUs and NCIC entries in each jurisdiction.'
        : 'Ensure all county agencies have current case information.',
    });
  });
}

export function buildCaseTimeline(events: TimelineEvent[]): { timeline: TimelineEvent[]; gaps: string[]; insights: string[] } {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const gaps: string[] = [];
  const insights: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const daysBetween = (new Date(sorted[i].date).getTime() - new Date(sorted[i - 1].date).getTime()) / 86400000;
    if (daysBetween > 365) gaps.push(`${Math.round(daysBetween / 365)} year gap between ${sorted[i - 1].type} and ${sorted[i].type}`);
  }
  const sightings = sorted.filter(e => e.type === 'sighting');
  if (sightings.length > 1) insights.push(`${sightings.length} sightings reported — verify for geographic pattern`);
  if (sorted[0]?.type === 'last-seen' && sorted[1]?.type === 'reported-missing') {
    const delay = (new Date(sorted[1].date).getTime() - new Date(sorted[0].date).getTime()) / 86400000;
    if (delay > 30) insights.push(`${Math.round(delay)} day delay between last seen and reported missing — critical investigative time lost`);
  }
  return { timeline: sorted, gaps, insights };
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function avg(nums: number[]): number { return nums.reduce((s, n) => s + n, 0) / nums.length; }

function findCommonFactors(demographics: Record<string, string>[]): string[] {
  if (demographics.length === 0) return [];
  const factors: string[] = [];
  const keys = Object.keys(demographics[0]);
  for (const key of keys) {
    const values = demographics.map(d => d[key]).filter(Boolean);
    const mode = values.sort((a, b) => values.filter(v => v === a).length - values.filter(v => v === b).length).pop();
    if (mode && values.filter(v => v === mode).length >= demographics.length * 0.6) {
      factors.push(`${key}: ${mode}`);
    }
  }
  return factors;
}
