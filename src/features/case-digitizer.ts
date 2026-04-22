/**
 * Case Digitizer
 * OCR and structure decades of paper case files into searchable database.
 * Cross-reference remains vs missing persons by dental, physical, timeline.
 * @module case-digitizer
 * @license GPL-3.0
 * @author OliWoods Foundation
 */
import { z } from 'zod';

export const CaseFileSchema = z.object({
  id: z.string().uuid(),
  caseNumber: z.string(),
  jurisdiction: z.string(),
  reportingAgency: z.string(),
  status: z.enum(['active', 'cold', 'resolved', 'unidentified-remains']),
  missingPerson: z.object({
    firstName: z.string(),
    lastName: z.string(),
    aliases: z.array(z.string()).default([]),
    dateOfBirth: z.string().optional(),
    sex: z.enum(['male', 'female', 'unknown']),
    race: z.string().optional(),
    height: z.object({ min: z.number(), max: z.number(), unit: z.enum(['inches', 'cm']) }).optional(),
    weight: z.object({ min: z.number(), max: z.number(), unit: z.enum(['lbs', 'kg']) }).optional(),
    hairColor: z.string().optional(),
    eyeColor: z.string().optional(),
    distinguishingMarks: z.array(z.string()).default([]),
    dentalRecords: z.boolean().default(false),
    dnaOnFile: z.boolean().default(false),
  }),
  lastSeen: z.object({
    date: z.string(),
    location: z.string(),
    circumstances: z.string(),
    lat: z.number().optional(),
    lng: z.number().optional(),
  }),
  dateReported: z.string(),
  lastUpdated: z.string().datetime(),
  documents: z.array(z.object({ type: z.string(), filename: z.string(), ocrText: z.string().optional() })).default([]),
  tips: z.array(z.object({ date: z.string(), summary: z.string(), credibility: z.enum(['unverified', 'plausible', 'corroborated']) })).default([]),
});

export const UnidentifiedRemainsSchema = z.object({
  id: z.string().uuid(),
  caseNumber: z.string(),
  jurisdiction: z.string(),
  discoveryDate: z.string(),
  discoveryLocation: z.string(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  estimatedAge: z.object({ min: z.number(), max: z.number() }).optional(),
  sex: z.enum(['male', 'female', 'unknown']),
  race: z.string().optional(),
  height: z.object({ min: z.number(), max: z.number(), unit: z.enum(['inches', 'cm']) }).optional(),
  causeOfDeath: z.string().optional(),
  mannerOfDeath: z.enum(['homicide', 'suicide', 'accident', 'natural', 'undetermined', 'pending']).optional(),
  dentalRecords: z.boolean().default(false),
  dnaProfile: z.boolean().default(false),
  distinguishingFeatures: z.array(z.string()).default([]),
  clothing: z.array(z.string()).default([]),
  personalEffects: z.array(z.string()).default([]),
});

export const CrossReferenceMatchSchema = z.object({
  missingPersonId: z.string().uuid(),
  remainsId: z.string().uuid(),
  matchScore: z.number().min(0).max(100),
  matchingCriteria: z.array(z.object({ criterion: z.string(), score: z.number(), details: z.string() })),
  recommendation: z.enum(['investigate', 'possible', 'unlikely']),
});

export type CaseFile = z.infer<typeof CaseFileSchema>;
export type UnidentifiedRemains = z.infer<typeof UnidentifiedRemainsSchema>;
export type CrossReferenceMatch = z.infer<typeof CrossReferenceMatchSchema>;

export function crossReferenceCases(
  missingPersons: CaseFile[],
  unidentifiedRemains: UnidentifiedRemains[],
  maxResults = 10,
): CrossReferenceMatch[] {
  const matches: CrossReferenceMatch[] = [];
  for (const mp of missingPersons) {
    for (const ur of unidentifiedRemains) {
      const criteria: CrossReferenceMatch['matchingCriteria'] = [];
      let totalScore = 0;
      // Sex match
      if (mp.missingPerson.sex === ur.sex && ur.sex !== 'unknown') {
        criteria.push({ criterion: 'Sex', score: 20, details: `Both ${mp.missingPerson.sex}` });
        totalScore += 20;
      } else if (mp.missingPerson.sex !== ur.sex && ur.sex !== 'unknown') continue;
      // Race match
      if (mp.missingPerson.race && ur.race && mp.missingPerson.race.toLowerCase() === ur.race.toLowerCase()) {
        criteria.push({ criterion: 'Race', score: 15, details: `Both ${mp.missingPerson.race}` });
        totalScore += 15;
      }
      // Age/height range overlap
      if (mp.missingPerson.height && ur.height) {
        const mpH = mp.missingPerson.height;
        const urH = ur.height;
        if (mpH.unit === urH.unit && mpH.min <= urH.max && mpH.max >= urH.min) {
          criteria.push({ criterion: 'Height Range', score: 15, details: 'Height ranges overlap' });
          totalScore += 15;
        }
      }
      // DNA availability
      if (mp.missingPerson.dnaOnFile && ur.dnaProfile) {
        criteria.push({ criterion: 'DNA Available', score: 10, details: 'Both have DNA profiles — request comparison' });
        totalScore += 10;
      }
      // Dental records
      if (mp.missingPerson.dentalRecords && ur.dentalRecords) {
        criteria.push({ criterion: 'Dental Records', score: 10, details: 'Both have dental records — request comparison' });
        totalScore += 10;
      }
      // Geographic proximity
      if (mp.lastSeen.lat && mp.lastSeen.lng && ur.lat && ur.lng) {
        const dist = haversineDistance(mp.lastSeen.lat, mp.lastSeen.lng, ur.lat, ur.lng);
        if (dist < 100) { criteria.push({ criterion: 'Geographic Proximity', score: 20, details: `${Math.round(dist)} miles apart` }); totalScore += 20; }
        else if (dist < 500) { criteria.push({ criterion: 'Geographic Proximity', score: 10, details: `${Math.round(dist)} miles apart` }); totalScore += 10; }
      }
      // Distinguishing marks
      const markOverlap = mp.missingPerson.distinguishingMarks.filter(m =>
        ur.distinguishingFeatures.some(f => f.toLowerCase().includes(m.toLowerCase()) || m.toLowerCase().includes(f.toLowerCase()))
      );
      if (markOverlap.length > 0) {
        criteria.push({ criterion: 'Distinguishing Marks', score: 25, details: `Matching features: ${markOverlap.join(', ')}` });
        totalScore += 25;
      }

      if (totalScore >= 30) {
        matches.push(CrossReferenceMatchSchema.parse({
          missingPersonId: mp.id,
          remainsId: ur.id,
          matchScore: Math.min(100, totalScore),
          matchingCriteria: criteria,
          recommendation: totalScore >= 60 ? 'investigate' : totalScore >= 40 ? 'possible' : 'unlikely',
        }));
      }
    }
  }
  return matches.sort((a, b) => b.matchScore - a.matchScore).slice(0, maxResults);
}

export function extractCaseDataFromOCR(ocrText: string): Partial<CaseFile['missingPerson']> {
  const data: Partial<CaseFile['missingPerson']> = {};
  // Name extraction
  const nameMatch = ocrText.match(/(?:name|subject|missing)[:\s]+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i);
  if (nameMatch) { data.firstName = nameMatch[1]; data.lastName = nameMatch[2]; }
  // DOB extraction
  const dobMatch = ocrText.match(/(?:DOB|date of birth|born)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (dobMatch) data.dateOfBirth = dobMatch[1];
  // Sex
  if (/\bmale\b/i.test(ocrText) && !/\bfemale\b/i.test(ocrText)) data.sex = 'male';
  else if (/\bfemale\b/i.test(ocrText)) data.sex = 'female';
  // Height
  const heightMatch = ocrText.match(/(\d)'(\d{1,2})"/);
  if (heightMatch) {
    const inches = parseInt(heightMatch[1]) * 12 + parseInt(heightMatch[2]);
    data.height = { min: inches - 1, max: inches + 1, unit: 'inches' };
  }
  return data;
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
