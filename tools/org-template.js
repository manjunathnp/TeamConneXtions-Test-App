'use strict';

/*
 * TeamConneXtions — Org Template
 * ------------------------------
 * This is the single, editable source of truth for the seeded organisation.
 * server.js consumes it through buildOrg() (see tools/build-org.js) to produce
 * a deterministic company every time /api/reset runs.
 *
 * To grow or shrink the company, edit the numbers here. Nothing is random:
 * the same template always yields the same people, ids and reporting lines,
 * so automated assertions never flake.
 *
 * Levels (depth in the tree):
 *   0 CEO         1 per company
 *   1 C-suite     reports to CEO
 *   2 VP / Head   reports to a C-suite leader in the same function
 *   3 Director    reports to a VP in the same department
 *   4 Manager     reports to a Director in the same department
 *   5 IC          reports to a Manager in the same department
 */

// 12 worldwide locations, each with a region and IANA-ish timezone label.
const LOCATIONS = [
  { city: 'Bengaluru',    country: 'India',       region: 'APAC',     timezone: 'IST (UTC+5:30)' },
  { city: 'Hyderabad',    country: 'India',       region: 'APAC',     timezone: 'IST (UTC+5:30)' },
  { city: 'Pune',         country: 'India',       region: 'APAC',     timezone: 'IST (UTC+5:30)' },
  { city: 'Singapore',    country: 'Singapore',   region: 'APAC',     timezone: 'SGT (UTC+8)' },
  { city: 'Sydney',       country: 'Australia',   region: 'APAC',     timezone: 'AEST (UTC+10)' },
  { city: 'London',       country: 'UK',          region: 'EMEA',     timezone: 'GMT (UTC+0)' },
  { city: 'Berlin',       country: 'Germany',     region: 'EMEA',     timezone: 'CET (UTC+1)' },
  { city: 'Amsterdam',    country: 'Netherlands', region: 'EMEA',     timezone: 'CET (UTC+1)' },
  { city: 'San Francisco',country: 'USA',         region: 'Americas', timezone: 'PT (UTC-8)' },
  { city: 'New York',     country: 'USA',         region: 'Americas', timezone: 'ET (UTC-5)' },
  { city: 'Austin',       country: 'USA',         region: 'Americas', timezone: 'CT (UTC-6)' },
  { city: 'Toronto',      country: 'Canada',      region: 'Americas', timezone: 'ET (UTC-5)' },
];

// 12 departments. `csuite` is the C-level title that owns the function.
const DEPARTMENTS = [
  { id: 1,  code: 'EXO', name: 'Executive Office',   csuite: 'Chief Executive Officer' },
  { id: 2,  code: 'ENG', name: 'Engineering',        csuite: 'Chief Technology Officer' },
  { id: 3,  code: 'PRD', name: 'Product & Design',   csuite: 'Chief Product Officer' },
  { id: 4,  code: 'QAE', name: 'Quality Engineering',csuite: 'Chief Technology Officer' },
  { id: 5,  code: 'DAI', name: 'Data & AI',          csuite: 'Chief Technology Officer' },
  { id: 6,  code: 'INF', name: 'DevOps & Infrastructure', csuite: 'Chief Technology Officer' },
  { id: 7,  code: 'SEC', name: 'IT & Security',      csuite: 'Chief Technology Officer' },
  { id: 8,  code: 'SAL', name: 'Sales',              csuite: 'Chief Revenue Officer' },
  { id: 9,  code: 'MKT', name: 'Marketing',          csuite: 'Chief Marketing Officer' },
  { id: 10, code: 'CSM', name: 'Customer Success',   csuite: 'Chief Revenue Officer' },
  { id: 11, code: 'HRO', name: 'People & Culture',   csuite: 'Chief People Officer' },
  { id: 12, code: 'FIN', name: 'Finance & Legal',    csuite: 'Chief Financial Officer' },
];

/*
 * Shape per department below the C-suite:
 *   vps       - number of VP/Head roles under the C-suite owner
 *   perVP     - { directors, perDirector: { managers, perManager: ics } }
 * Total department headcount = vps * (1 + directors * (1 + managers * (1 + ics)))
 * These numbers are tuned to total ~120 including the CEO and C-suite.
 */
const SHAPE = {
  ENG: { vps: 2, directors: 2, managers: 2, ics: 3 }, // 38
  PRD: { vps: 1, directors: 2, managers: 2, ics: 2 }, // 1+2*(1+2*3)=1+14=15
  QAE: { vps: 1, directors: 1, managers: 2, ics: 3 }, // 1+1*(1+2*4)=1+9=10
  DAI: { vps: 1, directors: 1, managers: 1, ics: 3 }, // 1+1*(1+4)=6
  INF: { vps: 1, directors: 1, managers: 1, ics: 3 }, // 6
  SEC: { vps: 1, directors: 0, managers: 1, ics: 3 }, // vp + 1*(1+3)=5
  SAL: { vps: 1, directors: 1, managers: 2, ics: 3 }, // 1+1*(1+2*4)=10
  MKT: { vps: 1, directors: 1, managers: 1, ics: 2 }, // 5
  CSM: { vps: 1, directors: 1, managers: 1, ics: 3 }, // 6
  HRO: { vps: 1, directors: 0, managers: 1, ics: 3 }, // 5
  FIN: { vps: 1, directors: 0, managers: 1, ics: 2 }, // 4
};

// Deterministic name pools (no randomness). Long enough to avoid collisions.
const FIRST = [
  'Vikram','Meera','Arjun','Priya','Rahul','Sneha','Karthik','Ananya','Rohan','Divya',
  'Aditya','Ishita','Nikhil','Kavya','Sanjay','Lakshmi','Aisha','Daniel','Wei','Sofia',
  'Liam','Emma','Noah','Olivia','Mateo','Chloe','Hiroshi','Yuki','Omar','Fatima',
  'Lucas','Mia','Ethan','Zara','Ravi','Nisha','Tara','Vivaan','Ayaan','Anika',
  'Ben','Grace','Marcus','Nina','Felix','Clara','Diego','Elena','Kenji','Amara',
  'Sara','Tom','Ivan','Petra','Hugo','Leah','Sam','Ruby','Max','Ada',
  'Jonas','Freya','Pablo','Lena','Andre','Maya','Dev','Isla','Cole','Vera',
  'Rex','Nora','Kai','Lia','Otto','Remy','Enzo','Juno','Theo','Zoe',
  'Neel','Riya','Aryan','Diya','Kabir','Myra','Reyansh','Saanvi','Vihaan','Kiara',
  'Ayan','Aadhya','Shaurya','Pari','Krish','Anvi','Atharv','Navya','Dhruv','Ira',
  'Yara','Idris','Nadia','Karim','Leila','Samir','Dalia','Tariq','Rania','Bilal',
  'Ingrid','Lars','Astrid','Bjorn','Sigrid','Erik','Solveig','Nils','Karin','Anders',
  'Mateus','Camila','Rafael','Beatriz','Gustavo','Larissa','Bruno','Helena','Thiago','Julia',
];
const LAST = [
  'Rao','Krishnan','Sharma','Nair','Verma','Reddy','Gowda','Iyer','Mehta','Pillai',
  'Kulkarni','Banerjee','Joshi','Hegde','Patil','Menon','Khan','Fischer','Chen','Alvarez',
  'Murphy','Wilson','Brown','Taylor','Garcia','Dubois','Tanaka','Sato','Hassan','Ali',
  'Anderson','Moore','Clark','Ahmed','Kapoor','Bhat','Shetty','Desai','Malhotra','Chauhan',
  'Schmidt','Meyer','Weber','Wagner','Becker','Hoffmann','Silva','Santos','Costa','Pereira',
  'Nguyen','Tran','Park','Kim','Lee','Wang','Zhang','Liu','Yamamoto','Kobayashi',
  'Andersson','Johansson','Karlsson','Nilsson','Larsson','Olsen','Hansen','Berg','Lind','Holm',
  'Rossi','Ferrari','Russo','Romano','Marino','Greco','Bruno','Gallo','Conti','Costa',
];

module.exports = { LOCATIONS, DEPARTMENTS, SHAPE, FIRST, LAST };
