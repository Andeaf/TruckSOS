import { describe, expect, it } from 'vitest';

import { normalizeHref, phoneNumberOf, tokenize } from '@/lib/linkify';
import { mentionQueryAt, rankMentionCandidates } from '@/lib/mention-search';
import { matchesSearch, normalizeSearch } from '@/lib/search';
import { USER_PALETTE, stableHash, userColor } from '@/lib/user-color';

describe('search', () => {
  it('normalizeSearch scoate diacriticele și face lowercase', () => {
    expect(normalizeSearch('Brașov ȘTEFĂNEȘTI Târgu Mureș')).toBe('brasov stefanesti targu mures');
  });

  it('matchesSearch: fiecare cuvânt trebuie găsit în cel puțin un câmp', () => {
    expect(matchesSearch('volvo brasov', ['Camion Volvo FH', 'Brașov'])).toBe(true);
    expect(matchesSearch('volvo cluj', ['Camion Volvo FH', 'Brașov'])).toBe(false);
  });

  it('interogarea goală potrivește orice; câmpurile goale se ignoră', () => {
    expect(matchesSearch('   ', [])).toBe(true);
    expect(matchesSearch('x', [null, undefined, ''])).toBe(false);
    expect(matchesSearch('ARAD', [null, 'Arad'])).toBe(true);
  });
});

describe('linkify', () => {
  it('normalizeHref adaugă https:// doar unde lipsește schema', () => {
    expect(normalizeHref('trucksos.net/p/1')).toBe('https://trucksos.net/p/1');
    expect(normalizeHref('www.x.ro')).toBe('https://www.x.ro');
    expect(normalizeHref('http://x.ro')).toBe('http://x.ro');
  });

  it.each([
    ['+40 722 123 456', '+40722123456'],
    ['0040 722 123 456', '+40722123456'],
    ['0722 123 456', '0722123456'],
    ['(0722) 123 456', '0722123456'],
    ['40722123456', '40722123456'],
  ])('phoneNumberOf(%j) → %j', (raw, expected) => {
    expect(phoneNumberOf(raw)).toBe(expected);
  });

  it.each([
    ['07.09.2026'], // dată
    ['1.500.000'], // preț
    ['0722.123-456'], // separatori amestecați
    ['0722.123 456'], // punct amestecat cu spații
    ['+1234567'], // prea scurt pentru E.164
  ])('phoneNumberOf(%j) → null', (raw) => {
    expect(phoneNumberOf(raw)).toBeNull();
  });

  it('tokenize: text, link și telefon, în ordinea din mesaj; punctuația de final rămâne text', () => {
    expect(tokenize('Vezi trucksos.net/p/1. Sună 0722 123 456!')).toEqual([
      { type: 'text', value: 'Vezi ' },
      { type: 'url', value: 'trucksos.net/p/1', href: 'https://trucksos.net/p/1' },
      { type: 'text', value: '. Sună ' },
      { type: 'phone', value: '0722 123 456', number: '0722123456' },
      { type: 'text', value: '!' },
    ]);
  });

  it('tokenize: cifrele dintr-un URL nu devin telefon; un e-mail nu devine link', () => {
    expect(tokenize('https://x.ro/0722123456')).toEqual([
      { type: 'url', value: 'https://x.ro/0722123456', href: 'https://x.ro/0722123456' },
    ]);
    expect(tokenize('ion@firma.ro')).toEqual([{ type: 'text', value: 'ion@firma.ro' }]);
  });

  it('tokenize: un IBAN sau un număr de comandă „#…” rămâne text', () => {
    const iban = 'RO49AAAA1B31007593840000';
    expect(tokenize(iban)).toEqual([{ type: 'text', value: iban }]);
    expect(tokenize('comanda #0722123456')).toEqual([{ type: 'text', value: 'comanda #0722123456' }]);
  });

  it('tokenize: mențiunile se decupează întâi, fără majuscule, și nu se aprind în mijlocul unui nume mai lung', () => {
    const mentions = [{ id: 'u1', name: 'Ion' }];
    expect(tokenize('salut @ion, vezi', mentions)).toEqual([
      { type: 'text', value: 'salut ' },
      { type: 'mention', value: '@ion', userId: 'u1' },
      { type: 'text', value: ', vezi' },
    ]);
    expect(tokenize('salut @Ionel', mentions)).toEqual([{ type: 'text', value: 'salut @Ionel' }]);
    expect(tokenize('a@Ion', mentions)).toEqual([{ type: 'text', value: 'a@Ion' }]);
  });

  it('tokenize: la mențiuni suprapuse câștigă numele cel mai lung', () => {
    const mentions = [
      { id: 'u1', name: 'Ion' },
      { id: 'u2', name: 'Ion Pop' },
    ];
    expect(tokenize('@Ion Pop salut', mentions)).toEqual([
      { type: 'mention', value: '@Ion Pop', userId: 'u2' },
      { type: 'text', value: ' salut' },
    ]);
  });

  it('tokenize: textul gol → nicio bucată', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('mention-search', () => {
  it('mentionQueryAt: „@” la început sau după spațiu deschide o interogare până la cursor', () => {
    expect(mentionQueryAt('@io', 3)).toEqual({ start: 0, query: 'io' });
    expect(mentionQueryAt('salut @ion po', 13)).toEqual({ start: 6, query: 'ion po' });
    expect(mentionQueryAt('salut @', 7)).toEqual({ start: 6, query: '' });
    // cursorul în afara textului e adus în limite
    expect(mentionQueryAt('@ab', 99)).toEqual({ start: 0, query: 'ab' });
  });

  it('mentionQueryAt: nu e menționare la e-mail, „@ ”, linie nouă, text prea lung sau prea multe spații', () => {
    expect(mentionQueryAt('ion@firma', 9)).toBeNull();
    expect(mentionQueryAt('@ ion', 5)).toBeNull();
    expect(mentionQueryAt('@ion\npop', 8)).toBeNull();
    expect(mentionQueryAt('@' + 'a'.repeat(41), 42)).toBeNull();
    expect(mentionQueryAt('@a b c d', 8)).toBeNull();
    expect(mentionQueryAt('fără arond', 5)).toBeNull();
  });

  const people = [
    { id: '1', full_name: 'Maria Ionescu' },
    { id: '2', full_name: 'Ion Popescu' },
    { id: '3', full_name: 'Ionuț Brașoveanu' },
    { id: '4', full_name: 'Gheorghe Strauß' },
  ];

  it('rankMentionCandidates: prefixul primului cuvânt înaintea substring-ului; fără diacritice; ß = ss', () => {
    expect(rankMentionCandidates('ion', people).map((p) => p.id)).toEqual(['2', '3', '1']);
    expect(rankMentionCandidates('brasov', people).map((p) => p.id)).toEqual(['3']);
    expect(rankMentionCandidates('strauss', people).map((p) => p.id)).toEqual(['4']);
  });

  it('rankMentionCandidates: toate cuvintele interogării trebuie să se potrivească; subșir de la 3 litere', () => {
    expect(rankMentionCandidates('io po', people).map((p) => p.id)).toEqual(['2']);
    expect(rankMentionCandidates('ppc', people).map((p) => p.id)).toEqual(['2']);
    expect(rankMentionCandidates('pp', people)).toEqual([]);
  });

  it('rankMentionCandidates: interogarea goală păstrează ordinea primită, plafonată', () => {
    expect(rankMentionCandidates('', people, 2).map((p) => p.id)).toEqual(['1', '2']);
  });
});

describe('user-color', () => {
  it('stableHash e FNV-1a pe 32 de biți (valori de referință)', () => {
    expect(stableHash('')).toBe(0x811c9dc5);
    expect(stableHash('a')).toBe(0xe40c292c);
  });

  it('aceeași culoare pentru același utilizator, pe tema potrivită', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const entry = USER_PALETTE[stableHash(id) % USER_PALETTE.length];
    expect(userColor(id, 'light')).toBe(entry.light);
    expect(userColor(id, 'dark')).toBe(entry.dark);
    expect(userColor(id, 'light')).toBe(userColor(id, 'light'));
  });

  it('id-uri diferite se împart pe mai multe culori ale paletei', () => {
    const colors = new Set(Array.from({ length: 50 }, (_, i) => userColor(`user-${i}`, 'light')));
    expect(colors.size).toBeGreaterThan(5);
    colors.forEach((c) => expect(USER_PALETTE.map((p) => p.light)).toContain(c));
  });
});
