// Deterministic pseudo-random generator so the demo data is stable between reloads.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(36);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (min, max) => Math.round(min + rand() * (max - min));

const REGIONS = {
  'North America': ['United States', 'Canada', 'Mexico'],
  Europe: ['United Kingdom', 'Germany', 'France', 'Spain', 'Italy'],
  'Asia Pacific': ['Japan', 'Australia', 'Singapore', 'India'],
  'Latin America': ['Brazil', 'Argentina', 'Chile'],
};

const PRODUCTS = [
  { product: 'Aurora Laptop', category: 'Hardware', price: 1450, cost: 980 },
  { product: 'Nimbus Tablet', category: 'Hardware', price: 690, cost: 410 },
  { product: 'Pulse Headset', category: 'Accessories', price: 180, cost: 72 },
  { product: 'Vector Monitor', category: 'Hardware', price: 420, cost: 260 },
  { product: 'Orbit Dock', category: 'Accessories', price: 220, cost: 95 },
  { product: 'Cloud Suite', category: 'Software', price: 960, cost: 120 },
  { product: 'Shield Security', category: 'Software', price: 340, cost: 40 },
  { product: 'Insight Analytics', category: 'Software', price: 1800, cost: 300 },
];

const REPS = [
  'Ava Patel', 'Liam Chen', 'Sofia Rossi', 'Noah Müller', 'Mia Tanaka',
  'Lucas Silva', 'Emma Dubois', 'Ethan Brooks', 'Isla Novak', 'Mateo García',
];

const STATUSES = ['Won', 'Won', 'Won', 'Pending', 'Lost'];

export function getSalesData(count = 600) {
  const rows = [];
  const regions = Object.keys(REGIONS);
  for (let i = 0; i < count; i++) {
    const region = pick(regions);
    const p = pick(PRODUCTS);
    const units = between(1, 60);
    const price = Math.round(p.price * (0.85 + rand() * 0.3));
    const date = new Date(2026, between(0, 8), between(1, 28));
    rows.push({
      id: `D-${String(i + 1).padStart(4, '0')}`,
      region,
      country: pick(REGIONS[region]),
      product: p.product,
      category: p.category,
      rep: pick(REPS),
      date: date.toISOString().slice(0, 10),
      units,
      price,
      revenue: units * price,
      cost: units * p.cost,
      status: pick(STATUSES),
      // Weekly units for the last 12 weeks, rendered as a sparkline
      trend: Array.from({ length: 12 }, () => between(0, 20)),
    });
  }
  return rows;
}

export function getOrgData() {
  const rows = [];
  const add = (path, title, salary, location) =>
    rows.push({ path, name: path[path.length - 1], title, salary, location });

  add(['Erica Rogers'], 'CEO', 420000, 'New York');
  add(['Erica Rogers', 'Malcolm Barrett'], 'CTO', 310000, 'New York');
  add(['Erica Rogers', 'Malcolm Barrett', 'Esther Baker'], 'VP Engineering', 240000, 'Austin');
  add(['Erica Rogers', 'Malcolm Barrett', 'Esther Baker', 'Brittany Hanson'], 'Engineering Manager', 185000, 'Austin');
  add(['Erica Rogers', 'Malcolm Barrett', 'Esther Baker', 'Brittany Hanson', 'Leah Flowers'], 'Senior Engineer', 165000, 'Remote');
  add(['Erica Rogers', 'Malcolm Barrett', 'Esther Baker', 'Brittany Hanson', 'Tammy Sutton'], 'Engineer', 138000, 'Austin');
  add(['Erica Rogers', 'Malcolm Barrett', 'Esther Baker', 'Derek Paul'], 'Engineering Manager', 182000, 'London');
  add(['Erica Rogers', 'Malcolm Barrett', 'Esther Baker', 'Derek Paul', 'Kara Jennings'], 'Senior Engineer', 150000, 'London');
  add(['Erica Rogers', 'Malcolm Barrett', 'Esther Baker', 'Derek Paul', 'Omar Haddad'], 'Engineer', 121000, 'Remote');
  add(['Erica Rogers', 'Malcolm Barrett', 'Priya Raman'], 'Director of Data', 225000, 'San Francisco');
  add(['Erica Rogers', 'Malcolm Barrett', 'Priya Raman', 'Jonah Weiss'], 'Data Scientist', 158000, 'San Francisco');
  add(['Erica Rogers', 'Malcolm Barrett', 'Priya Raman', 'Hana Sato'], 'Data Engineer', 149000, 'Tokyo');
  add(['Erica Rogers', 'Jasmine Cole'], 'CFO', 295000, 'New York');
  add(['Erica Rogers', 'Jasmine Cole', 'Victor Huang'], 'Controller', 190000, 'New York');
  add(['Erica Rogers', 'Jasmine Cole', 'Victor Huang', 'Greta Olsen'], 'Accountant', 98000, 'Chicago');
  add(['Erica Rogers', 'Jasmine Cole', 'Victor Huang', 'Samuel Ade'], 'Accountant', 94000, 'Chicago');
  add(['Erica Rogers', 'Diego Ortiz'], 'CRO', 300000, 'Miami');
  add(['Erica Rogers', 'Diego Ortiz', 'Nora Fischer'], 'VP Sales EMEA', 230000, 'Berlin');
  add(['Erica Rogers', 'Diego Ortiz', 'Nora Fischer', 'Paul Lambert'], 'Account Executive', 132000, 'Paris');
  add(['Erica Rogers', 'Diego Ortiz', 'Nora Fischer', 'Ines Costa'], 'Account Executive', 128000, 'Lisbon');
  add(['Erica Rogers', 'Diego Ortiz', 'Ryan Walsh'], 'VP Sales Americas', 235000, 'Miami');
  add(['Erica Rogers', 'Diego Ortiz', 'Ryan Walsh', 'Chloe Martin'], 'Account Executive', 136000, 'Toronto');
  add(['Erica Rogers', 'Diego Ortiz', 'Ryan Walsh', 'Marcus Reed'], 'Sales Engineer', 142000, 'Remote');
  return rows;
}
