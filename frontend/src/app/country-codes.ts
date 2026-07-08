export interface CountryCode {
  name: string;
  flag: string;
  code: string;
}

export const COUNTRY_CODES: CountryCode[] = [
  { name: 'United States', flag: '🇺🇸', code: '+1' },
  { name: 'India', flag: '🇮🇳', code: '+91' },
  { name: 'United Kingdom', flag: '🇬🇧', code: '+44' },
  { name: 'Canada', flag: '🇨🇦', code: '+1' },
  { name: 'United Arab Emirates', flag: '🇦🇪', code: '+971' },
  { name: 'Singapore', flag: '🇸🇬', code: '+65' },
  { name: 'Malaysia', flag: '🇲🇾', code: '+60' },
  { name: 'Thailand', flag: '🇹🇭', code: '+66' },
  { name: 'Japan', flag: '🇯🇵', code: '+81' },
  { name: 'Vietnam', flag: '🇻🇳', code: '+84' },
  { name: 'Indonesia', flag: '🇮🇩', code: '+62' },
  { name: 'Ireland', flag: '🇮🇪', code: '+353' },
  { name: 'Scotland', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', code: '+44' },
  { name: 'Taiwan', flag: '🇹🇼', code: '+886' },
];
