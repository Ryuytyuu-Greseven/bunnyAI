export interface Property {
  id: string;
  name: string;
  location: string;
  price: number;
  type: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  highlights: string[];
  shortPitch: string;       // 1-sentence spoken teaser for the listing overview
  fullDescription: string;  // full spoken description for the detail node
}

// Mock property catalogue — in production, replace with a CRM/database lookup
const MOCK_PROPERTIES: Property[] = [
  {
    id: 'prop_001',
    name: 'Sunrise Valley Residences',
    location: 'Whitefield, Bangalore',
    price: 8_500_000,
    type: '3BHK Apartment',
    bedrooms: 3,
    bathrooms: 2,
    sqft: 1850,
    highlights: ['Gated community', 'Swimming pool', 'Clubhouse', '24/7 security', 'Power backup'],
    shortPitch: 'A premium 3BHK in Whitefield at 85 lakhs — ready to move in, with a clubhouse and pool.',
    fullDescription:
      'Sunrise Valley is a gated community of 200 apartments in the heart of Whitefield, Bangalore\'s main IT hub. ' +
      'The 1850 sqft apartment has an open-plan living area, a modular kitchen, and two covered car parks. ' +
      'The project includes a 10,000 sqft clubhouse with a gym, swimming pool, and indoor games. ' +
      'It is walking distance from major tech parks and Phoenix Marketcity. Possession is immediate.',
  },
  {
    id: 'prop_002',
    name: 'Green Crest Villas',
    location: 'Sarjapur Road, Bangalore',
    price: 12_500_000,
    type: '4BHK Villa',
    bedrooms: 4,
    bathrooms: 4,
    sqft: 2800,
    highlights: ['Independent villa', 'Private garden', 'Vastu compliant', 'Solar panels', 'EV charging'],
    shortPitch: 'A spacious 4BHK independent villa in Sarjapur at 1.25 crore — private garden, solar power, and EV charging point included.',
    fullDescription:
      'Green Crest offers 60 independent villas on a 15-acre gated layout in Sarjapur. ' +
      'Each villa comes with a private garden of 600 sqft, a solar power system, and two EV charging points. ' +
      'The project is Vastu-compliant and RERA registered. ' +
      'It is 5 minutes from Infosys and Wipro campuses and has a dedicated school bus route to three CBSE schools.',
  },
  {
    id: 'prop_003',
    name: 'Metro Heights',
    location: 'Hebbal, Bangalore',
    price: 5_500_000,
    type: '2BHK Apartment',
    bedrooms: 2,
    bathrooms: 2,
    sqft: 1200,
    highlights: ['Metro connectivity', 'Zero stamp duty offer', 'Home loan assistance', 'Corner unit available'],
    shortPitch: 'A well-connected 2BHK in Hebbal at 55 lakhs — 200 metres from the metro, with zero stamp duty on this month.',
    fullDescription:
      'Metro Heights is a mid-rise development just 200 metres from Hebbal metro station. ' +
      'The 1200 sqft 2BHK features engineered wooden flooring, smart-home switches, and wide city views from the 8th floor. ' +
      'There is a zero stamp duty offer valid this month. ' +
      'Builder-tied home loans are available at 8.5% for pre-approved buyers.',
  },
  {
    id: 'prop_004',
    name: 'Meadow Park Township',
    location: 'Electronic City, Bangalore',
    price: 6_800_000,
    type: '3BHK Apartment',
    bedrooms: 3,
    bathrooms: 2,
    sqft: 1600,
    highlights: ['RERA certified', 'School and hospital inside complex', 'Free car park', 'Price locked 30 days'],
    shortPitch: 'A 3BHK township apartment in Electronic City at 68 lakhs — RERA certified, with a school and hospital right inside the complex.',
    fullDescription:
      'Meadow Park is a self-contained township spread over 50 acres in Electronic City Phase 2. ' +
      'The 3BHK has a 1600 sqft carpet area with large balconies on both sides. ' +
      'The township hosts a CBSE school, a multispeciality hospital, and a 2-km jogging track within the campus. ' +
      'Currently offering a 30-day price lock for any bookings made this month.',
  },
  {
    id: 'prop_005',
    name: 'The Loft Studios',
    location: 'Koramangala, Bangalore',
    price: 3_200_000,
    type: '1BHK Studio Apartment',
    bedrooms: 1,
    bathrooms: 1,
    sqft: 620,
    highlights: ['Prime location', 'Fully furnished option', 'High rental yield ~5%', 'Smart home features'],
    shortPitch: 'A modern 1BHK studio in Koramangala at 32 lakhs — fully furnished option available, with a rental yield of around 5 percent.',
    fullDescription:
      'The Loft Studios is a boutique 80-unit development in the heart of Koramangala. ' +
      'Studios come in both fully-furnished and shell options. ' +
      'Smart home features include app-controlled locks, AC, and lighting. ' +
      'Koramangala commands some of the highest rental yields in Bangalore at 4.5 to 5.5 percent annually. ' +
      'Ready for possession in Q1 next year.',
  },
];

export function listPropertiesByBudget(min: number, max: number): Property[] {
  const ceiling = max * 1.10; // allow 10% above max to avoid empty results for near-range budgets
  return MOCK_PROPERTIES.filter(p => p.price >= min && p.price <= ceiling);
}

export function getPropertyById(id: string): Property | undefined {
  return MOCK_PROPERTIES.find(p => p.id === id);
}

export function formatPrice(price: number): string {
  if (price >= 10_000_000) {
    const crores = price / 10_000_000;
    return `${parseFloat(crores.toFixed(2))} crore`;
  }
  if (price >= 100_000) {
    return `${Math.round(price / 100_000)} lakhs`;
  }
  return `₹${price.toLocaleString('en-IN')}`;
}
