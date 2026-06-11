export interface OrderItem {
  productName: string;
  quantity: number;
  price: number;
}

export interface Order {
  orderId: string;
  customerName: string;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'returned';
  placedDate: string;
  estimatedDelivery: string;
  items: OrderItem[];
  totalAmount: number;
  shippingAddress: string;
  trackingNumber?: string;
  carrier?: string;
  cancellationReason?: string;
}

export interface Product {
  productId: string;
  name: string;
  category: string;
  price: number;
  inStock: boolean;
  stockCount: number;
  description: string;
  specs: Record<string, string>;
  warranty: string;
  returnPolicy: string;
  rating: number;
  reviewCount: number;
}

// ─── Mock orders ─────────────────────────────────────────────────────────────

const MOCK_ORDERS: Order[] = [
  {
    orderId: 'ORD-78421',
    customerName: 'Rahul Sharma',
    status: 'delivered',
    placedDate: '2026-05-28',
    estimatedDelivery: '2026-06-02',
    items: [{ productName: 'iPhone 15 Pro 256GB – Natural Titanium', quantity: 1, price: 134900 }],
    totalAmount: 134900,
    shippingAddress: '42 MG Road, Bengaluru 560001',
    trackingNumber: 'BD4721983KA',
    carrier: 'BlueDart',
  },
  {
    orderId: 'ORD-81045',
    customerName: 'Priya Patel',
    status: 'shipped',
    placedDate: '2026-06-05',
    estimatedDelivery: '2026-06-14',
    items: [{ productName: 'Samsung QLED 55" 4K Smart TV', quantity: 1, price: 72990 }],
    totalAmount: 72990,
    shippingAddress: '7 Linking Road, Mumbai 400050',
    trackingNumber: 'DX3341872MH',
    carrier: 'Delhivery',
  },
  {
    orderId: 'ORD-73190',
    customerName: 'Arjun Kumar',
    status: 'processing',
    placedDate: '2026-06-10',
    estimatedDelivery: '2026-06-16',
    items: [
      { productName: 'Dell XPS 15 – Core i7, 16GB RAM, 512GB SSD', quantity: 1, price: 158900 },
      { productName: 'Dell USB-C Hub (7-in-1)', quantity: 1, price: 3499 },
    ],
    totalAmount: 162399,
    shippingAddress: '15 Sector 18, Noida 201301',
  },
  {
    orderId: 'ORD-69874',
    customerName: 'Meera Singh',
    status: 'cancelled',
    placedDate: '2026-06-01',
    estimatedDelivery: '2026-06-08',
    items: [{ productName: 'Nike Air Max 270 – Blue/White, Size 8', quantity: 1, price: 10995 }],
    totalAmount: 10995,
    shippingAddress: '3 Jodhpur Colony, Jaipur 302006',
    cancellationReason: 'Customer requested cancellation before dispatch.',
  },
  {
    orderId: 'ORD-82301',
    customerName: 'Vikram Rao',
    status: 'pending',
    placedDate: '2026-06-11',
    estimatedDelivery: '2026-06-17',
    items: [{ productName: 'Dyson Purifier Cool TP07 – White/Silver', quantity: 1, price: 52900 }],
    totalAmount: 52900,
    shippingAddress: '88 Jubilee Hills, Hyderabad 500033',
  },
];

// ─── Mock product catalogue ───────────────────────────────────────────────────

const MOCK_PRODUCTS: Product[] = [
  {
    productId: 'PROD-001',
    name: 'iPhone 15 Pro 256GB – Natural Titanium',
    category: 'Smartphones',
    price: 134900,
    inStock: true,
    stockCount: 12,
    description: 'Apple iPhone 15 Pro with A17 Pro chip, titanium design, 48 MP camera, and USB-C.',
    specs: {
      Processor: 'A17 Pro (3nm)',
      Display: '6.1-inch Super Retina XDR OLED, 120Hz ProMotion',
      Camera: '48MP main + 12MP ultrawide + 12MP 3x telephoto',
      Battery: '3274 mAh, up to 23 hrs video playback',
      Storage: '256GB',
      Connectivity: 'USB-C (USB 3), Wi-Fi 6E, 5G',
      OS: 'iOS 17',
    },
    warranty: '1-year Apple Limited Warranty. AppleCare+ available separately.',
    returnPolicy: '10-day return window if device is sealed and unused. 7-day replacement for defects.',
    rating: 4.8,
    reviewCount: 2341,
  },
  {
    productId: 'PROD-002',
    name: 'Samsung QLED 55" 4K Smart TV',
    category: 'Televisions',
    price: 72990,
    inStock: true,
    stockCount: 5,
    description: 'Samsung 55-inch QLED 4K Smart TV with Quantum Dot technology and Tizen OS.',
    specs: {
      Display: '55" QLED 4K (3840×2160)',
      HDR: 'Quantum HDR+, HDR10+',
      'Refresh Rate': '120Hz',
      'Smart Platform': 'Tizen OS 7.0',
      Audio: '40W Dolby Atmos',
      Ports: '4x HDMI 2.1, 2x USB, 1x eARC',
    },
    warranty: '1-year Samsung onsite warranty.',
    returnPolicy: '10-day return policy. Installation damage not covered.',
    rating: 4.6,
    reviewCount: 1087,
  },
  {
    productId: 'PROD-003',
    name: 'Dell XPS 15 – Core i7, 16GB RAM, 512GB SSD',
    category: 'Laptops',
    price: 158900,
    inStock: true,
    stockCount: 3,
    description: 'Dell XPS 15 with 13th Gen Core i7, 15.6" OLED display, and NVIDIA RTX 4060.',
    specs: {
      Processor: 'Intel Core i7-13700H (14-core)',
      Display: '15.6" 3.5K OLED Touch, 60Hz',
      RAM: '16GB DDR5',
      Storage: '512GB PCIe Gen 4 SSD',
      Graphics: 'NVIDIA RTX 4060 8GB',
      Battery: '86Wh, up to 10 hrs',
      Ports: '2x Thunderbolt 4, 1x USB-A, 1x SD Card',
    },
    warranty: '1-year Dell ProSupport (next business day onsite).',
    returnPolicy: '15-day return for unopened items. 7-day DOA replacement.',
    rating: 4.7,
    reviewCount: 598,
  },
  {
    productId: 'PROD-004',
    name: 'Nike Air Max 270 – Blue/White, Size 8',
    category: 'Footwear',
    price: 10995,
    inStock: true,
    stockCount: 18,
    description: 'Nike Air Max 270 lifestyle shoes with the largest Air heel unit for all-day comfort.',
    specs: {
      Upper: 'Engineered mesh with foam midfoot cage',
      Midsole: 'Max Air 270 heel unit + foam',
      Sole: 'Rubber waffle outsole',
      Fit: 'True to size',
      'Available sizes': '6 to 11 (UK)',
      Colorway: 'Blue/White/Black',
    },
    warranty: 'Manufacturing defects only, 30 days.',
    returnPolicy: '30-day return if unused and in original packaging.',
    rating: 4.4,
    reviewCount: 3210,
  },
  {
    productId: 'PROD-005',
    name: 'Dyson Purifier Cool TP07 – White/Silver',
    category: 'Home Appliances',
    price: 52900,
    inStock: false,
    stockCount: 0,
    description: 'Dyson TP07 air purifier and fan, captures 99.97% of particles ≥0.3 microns.',
    specs: {
      Coverage: 'Up to 400 sqft',
      'HEPA Filter': 'H13 grade, dual-sided',
      'Fan Speed': '10 settings',
      'Noise Level': 'As low as 43dB',
      'Smart Features': 'Wi-Fi, Dyson Link App, Alexa compatible',
      Modes: 'Auto, Night, Fan-only',
    },
    warranty: '2-year Dyson warranty.',
    returnPolicy: '10-day return if unused. Filter non-returnable once opened.',
    rating: 4.9,
    reviewCount: 421,
  },
];

// ─── Tool functions ───────────────────────────────────────────────────────────

export function getOrderById(orderId: string): Order | undefined {
  const normalized = orderId.toUpperCase().replace(/\s+/g, '');
  return MOCK_ORDERS.find(
    (o) => o.orderId.toUpperCase().replace(/\s+/g, '') === normalized,
  );
}

export function searchOrdersByCustomerName(name: string): Order[] {
  const q = name.toLowerCase();
  return MOCK_ORDERS.filter((o) => o.customerName.toLowerCase().includes(q));
}

export function getProductById(productId: string): Product | undefined {
  return MOCK_PRODUCTS.find(
    (p) => p.productId.toUpperCase() === productId.toUpperCase(),
  );
}

export function searchProducts(query: string): Product[] {
  const q = query.toLowerCase();
  return MOCK_PRODUCTS.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q),
  );
}

export function formatOrderStatus(order: Order): string {
  const map: Record<Order['status'], string> = {
    pending: 'Confirmed — awaiting dispatch',
    processing: 'Being packed at our warehouse',
    shipped: `Shipped and in transit via ${order.carrier || 'courier'} (Tracking: ${order.trackingNumber || 'N/A'})`,
    delivered: `Delivered on ${order.estimatedDelivery}`,
    cancelled: `Cancelled${order.cancellationReason ? ' — ' + order.cancellationReason : ''}`,
    returned: 'Return processed',
  };
  return map[order.status] || order.status;
}

export function formatCurrency(amount: number): string {
  if (amount >= 100_000) {
    return `₹${(amount / 100_000).toFixed(2)} lakh`;
  }
  return `₹${amount.toLocaleString('en-IN')}`;
}
