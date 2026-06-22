export interface Currency {
  code: string;
  symbol: string;
  label: string;
}

export const SUPPORTED_CURRENCIES: Currency[] = [
  { code: 'EUR', symbol: '€', label: 'Euro' },
  // { code: 'RON', symbol: 'lei', label: 'Leu românesc' },
  // { code: 'USD', symbol: '$', label: 'US Dollar' },
];

export const DEFAULT_CURRENCY = SUPPORTED_CURRENCIES[0];
