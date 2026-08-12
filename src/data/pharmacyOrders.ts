import type { Order } from '../types';

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function img(label: string, bg = 'EAF1EE', fg = '17332B'): string {
  return `https://placehold.co/320x400/${bg}/${fg}?text=${encodeURIComponent(label)}`;
}

/**
 * ~10 realistic WellNest Pharmacy orders — second brand config, deliberately
 * NOT a fashion reskin: real pharmacy return policy is genuinely stricter
 * (see the requiresPrescription/sealedOnly rules in policy.ts), so this
 * catalog encodes that difference in the data, not just item names.
 *  - WN2004: delivered 6 days ago -> outside the 2-day window
 *  - WN2002: prescription medicine -> hard-refused, not just "final sale"
 *  - WN2001: multi-item order
 *  - WN2006: COD order
 *  - WN2005, WN2010: sealed-only hygiene consumables — a "changed mind"
 *    return only holds if still sealed (see scenarios.ts's paired
 *    "sealed → OK" / "opened → refused" scenarios)
 */
export const pharmacyOrders: Order[] = [
  {
    orderId: 'WN2001',
    customerName: 'Suresh Kumar',
    phone: '9845066011',
    city: 'Bengaluru',
    deliveryDate: daysAgo(1),
    paymentMethod: 'Prepaid',
    returnWindowDays: 2,
    items: [
      {
        itemId: 'WN2001-1',
        name: 'Digital BP Monitor',
        size: 'Standard',
        colour: 'White',
        price: 1899,
        imageUrl: img('BP Monitor'),
        finalSale: false,
        availableSizes: [],
      },
      {
        itemId: 'WN2001-2',
        name: 'Vitamin D3 Tablets (60ct)',
        size: '60 tablets',
        colour: '-',
        price: 349,
        imageUrl: img('Vitamin D3'),
        finalSale: false,
        sealedOnly: true,
        availableSizes: [],
      },
    ],
  },
  {
    orderId: 'WN2002',
    customerName: 'Lakshmi Venkatesh',
    phone: '9986011223',
    city: 'Chennai',
    deliveryDate: daysAgo(1),
    paymentMethod: 'Prepaid',
    returnWindowDays: 2,
    items: [
      {
        itemId: 'WN2002-1',
        name: 'Amoxicillin 500mg Strip',
        size: '10 tablets',
        colour: '-',
        price: 89,
        imageUrl: img('Amoxicillin'),
        finalSale: true,
        requiresPrescription: true,
        availableSizes: [],
      },
    ],
  },
  {
    orderId: 'WN2003',
    customerName: 'Rahul Bhatia',
    phone: '9911022334',
    city: 'Delhi',
    deliveryDate: daysAgo(1),
    paymentMethod: 'Prepaid',
    returnWindowDays: 2,
    items: [
      {
        itemId: 'WN2003-1',
        name: 'Whey Protein Powder 1kg',
        size: '1 kg',
        colour: 'Chocolate',
        price: 2499,
        imageUrl: img('Whey Protein'),
        finalSale: false,
        availableSizes: ['500 g', '2 kg'],
      },
    ],
  },
  {
    orderId: 'WN2004',
    customerName: 'Neha Joshi',
    phone: '9822033445',
    city: 'Pune',
    deliveryDate: daysAgo(6),
    paymentMethod: 'Prepaid',
    returnWindowDays: 2,
    items: [
      {
        itemId: 'WN2004-1',
        name: 'Weighing Scale (Digital)',
        size: 'Standard',
        colour: 'Black',
        price: 999,
        imageUrl: img('Weighing Scale'),
        finalSale: false,
        availableSizes: [],
      },
    ],
  },
  {
    orderId: 'WN2005',
    customerName: 'Farhan Ahmed',
    phone: '9733011224',
    city: 'Hyderabad',
    deliveryDate: daysAgo(1),
    paymentMethod: 'Prepaid',
    returnWindowDays: 2,
    items: [
      {
        itemId: 'WN2005-1',
        name: 'N95 Masks (Box of 20)',
        size: 'Box of 20',
        colour: 'White',
        price: 499,
        imageUrl: img('N95 Masks'),
        finalSale: false,
        sealedOnly: true,
        availableSizes: ['Box of 10', 'Box of 50'],
      },
    ],
  },
  {
    orderId: 'WN2006',
    customerName: 'Geeta Reddy',
    phone: '9640011225',
    city: 'Vijayawada',
    deliveryDate: daysAgo(1),
    paymentMethod: 'COD',
    returnWindowDays: 2,
    items: [
      {
        itemId: 'WN2006-1',
        name: 'Glucometer Strips (50ct)',
        size: '50 strips',
        colour: '-',
        price: 799,
        imageUrl: img('Glucometer Strips'),
        finalSale: false,
        availableSizes: [],
      },
    ],
  },
  {
    orderId: 'WN2007',
    customerName: 'Vivek Nair',
    phone: '9744055667',
    city: 'Kochi',
    deliveryDate: daysAgo(2),
    paymentMethod: 'Prepaid',
    returnWindowDays: 2,
    items: [
      {
        itemId: 'WN2007-1',
        name: 'Orthopedic Knee Support',
        size: 'L',
        colour: 'Black',
        price: 649,
        imageUrl: img('Knee Support'),
        finalSale: false,
        availableSizes: ['M', 'XL'],
      },
    ],
  },
  {
    orderId: 'WN2008',
    customerName: 'Anjali Deshpande',
    phone: '9922011334',
    city: 'Nagpur',
    deliveryDate: daysAgo(1),
    paymentMethod: 'Prepaid',
    returnWindowDays: 2,
    items: [
      {
        itemId: 'WN2008-1',
        name: 'Multivitamin Gummies (60ct)',
        size: '60 gummies',
        colour: '-',
        price: 599,
        imageUrl: img('Multivitamin'),
        finalSale: false,
        availableSizes: [],
      },
    ],
  },
  {
    orderId: 'WN2009',
    customerName: 'Imran Sheikh',
    phone: '9811223355',
    city: 'Lucknow',
    deliveryDate: daysAgo(1),
    paymentMethod: 'Prepaid',
    returnWindowDays: 2,
    items: [
      {
        itemId: 'WN2009-1',
        name: 'Nebulizer Machine',
        size: 'Standard',
        colour: 'White/Blue',
        price: 1699,
        imageUrl: img('Nebulizer'),
        finalSale: false,
        availableSizes: [],
      },
    ],
  },
  {
    orderId: 'WN2010',
    customerName: 'Sonal Kapoor',
    phone: '9871099887',
    city: 'Mumbai',
    deliveryDate: daysAgo(2),
    paymentMethod: 'Prepaid',
    returnWindowDays: 2,
    items: [
      {
        itemId: 'WN2010-1',
        name: 'Sunscreen SPF 50 (Pack of 2)',
        size: '100 ml x2',
        colour: '-',
        price: 899,
        imageUrl: img('Sunscreen'),
        finalSale: false,
        sealedOnly: true,
        availableSizes: [],
      },
    ],
  },
];
