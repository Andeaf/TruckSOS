/**
 * Înlocuitorul lui `@/i18n` (export implicit = instanța i18next): `t` întoarce cheia, deci testul
 * vede CE cheie a ales codul, nu textul tradus.
 */
export const i18nMock = {
  language: 'ro',
  t: (key: string): string => key,
};

export const i18nModule = { default: i18nMock };
