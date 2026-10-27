import { describe, expect, it } from 'vitest';
import { capKnown, cardinalityOf, exclusiveGroup, normalizeRelationship, standingOf, type PersonEvidence } from './person-standing.js';

const base: PersonEvidence = { mentions: 0, socialMentions: 0, distinctDays: 0, relationship: null, personLinks: 0, kind: 'unverified', verifiedBy: null, ownerEdited: false };
const s = (e: Partial<PersonEvidence>) => standingOf({ ...base, ...e });

describe('person standing', () => {
  it('a single mention is never known', () => {
    expect(s({ mentions: 1, socialMentions: 1, relationship: 'wife' }).tier).toBe('shadow');
    expect(s({ mentions: 1 }).tier).toBe('faint');
  });

  it('recurrence plus a relationship makes someone known', () => {
    const st = s({ mentions: 3, socialMentions: 2, relationship: 'wife', distinctDays: 2 });
    expect(st.tier).toBe('known');
    expect(st.reasons).toContain('your wife');
  });

  it('frequent mentions without any relationship stay a shadow (a city, a product)', () => {
    const st = s({ mentions: 12, socialMentions: 3, distinctDays: 5 });
    expect(st.score).toBeGreaterThanOrEqual(55);
    expect(st.tier).toBe('shadow');
    expect(st.reasons).toContain('no relationship yet');
  });

  it('a link to another person counts as a tie', () => {
    expect(s({ mentions: 4, socialMentions: 2, personLinks: 1 }).tier).toBe('known');
  });

  it('owner decisions win; model rejections lose', () => {
    expect(s({ ownerEdited: true }).score).toBe(100);
    expect(s({ mentions: 9, relationship: 'friend', verifiedBy: 'model-rejected' }).score).toBe(0);
  });

  it('caps the known list, weakest first, never the owner-confirmed', () => {
    const people = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, ownerEdited: i === 0, standing: { score: 60 + i, tier: 'known' as const, reasons: [] } }));
    people[0].standing = { score: 100, tier: 'known', reasons: [] };
    capKnown(people, 3);
    expect(people.filter((p) => p.standing.tier === 'known').map((p) => p.id).sort()).toEqual(['p0', 'p3', 'p4']);
  });
});

describe('relationships and cardinality', () => {
  it('normalises words and keeps specific family roles', () => {
    expect(normalizeRelationship('Mom')).toBe('mother');
    expect(normalizeRelationship('co-workers')).toBe('colleague');
    expect(normalizeRelationship('sons')).toBe('son');
  });

  it('knows one-to-one from one-to-many', () => {
    expect(cardinalityOf('wife')).toBe('one');
    expect(cardinalityOf('mother')).toBe('one');
    expect(cardinalityOf('friend')).toBe('many');
    expect(cardinalityOf('son')).toBe('many');
    expect(exclusiveGroup('husband')).toBe('spouse');
    expect(exclusiveGroup('partner')).toBe('spouse');
    expect(exclusiveGroup('friend')).toBeNull();
  });
});
