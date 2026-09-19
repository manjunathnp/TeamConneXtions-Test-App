'use strict';

/*
 * Deterministic org builder.
 * Turns tools/org-template.js into a fixed list of employees and departments.
 * Same input -> identical output (ids, names, reporting lines) on every call,
 * so automated tests can assert on exact numbers.
 *
 * Distribution of locations, statuses, employment types and join dates is
 * driven by simple index arithmetic (not Math.random), keeping it repeatable.
 */

const { LOCATIONS, DEPARTMENTS, SHAPE, FIRST, LAST } = require('./org-template');

const EMPLOYMENT = ['Full-time', 'Full-time', 'Full-time', 'Full-time', 'Contract', 'Intern'];
// A fixed set of join dates spread across years; picked by index.
const JOIN_YEARS = ['2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'];

function buildOrg() {
  const departments = DEPARTMENTS.map((d) => ({ id: d.id, code: d.code, name: d.name }));
  const deptByCode = {};
  DEPARTMENTS.forEach((d) => { deptByCode[d.code] = d; });

  const employees = [];
  let id = 0;
  let nameIdx = 0;
  let locIdx = 0;
  let joinIdx = 0;
  let empIdx = 0;

  // Cyclers that never repeat a name pair until pools exhaust.
  function nextName() {
    const first = FIRST[nameIdx % FIRST.length];
    const last = LAST[Math.floor(nameIdx / FIRST.length + nameIdx) % LAST.length];
    nameIdx += 1;
    return { first, last };
  }
  function nextLocation() { const l = LOCATIONS[locIdx % LOCATIONS.length]; locIdx += 1; return l; }
  function nextEmployment() { const e = EMPLOYMENT[empIdx % EMPLOYMENT.length]; empIdx += 1; return e; }
  function nextJoin() {
    const y = JOIN_YEARS[joinIdx % JOIN_YEARS.length];
    const m = String((joinIdx * 7) % 12 + 1).padStart(2, '0');
    const d = String((joinIdx * 13) % 27 + 1).padStart(2, '0');
    joinIdx += 1;
    return `${y}-${m}-${d}`;
  }

  const emailSeen = new Set();
  function makeEmail(first, last) {
    let base = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '');
    let email = `${base}@teamconnextions.dev`;
    let n = 2;
    while (emailSeen.has(email)) { email = `${base}${n}@teamconnextions.dev`; n += 1; }
    emailSeen.add(email);
    return email;
  }

  // status: mostly Active, a deterministic ~1-in-9 On Leave.
  function statusFor(index) { return index % 9 === 4 ? 'On Leave' : 'Active'; }

  function add({ title, departmentId, managerId, forceLocation, forceEmployment }) {
    id += 1;
    const { first, last } = nextName();
    const loc = forceLocation || nextLocation();
    const emp = {
      id,
      firstname: first,
      lastname: last,
      title,
      departmentId,
      managerId: managerId === undefined ? null : managerId,
      email: makeEmail(first, last),
      phone: `+1 555 0${String(1000 + id).slice(-4)}`,
      location: loc.city,
      country: loc.country,
      region: loc.region,
      timezone: loc.timezone,
      employmentType: forceEmployment || nextEmployment(),
      status: statusFor(id),
      joinedOn: nextJoin(),
    };
    employees.push(emp);
    return emp;
  }

  // Level 0: CEO
  const exo = deptByCode['EXO'];
  const ceo = add({ title: exo.csuite, departmentId: exo.id, managerId: null, forceLocation: LOCATIONS[0], forceEmployment: 'Full-time' });
  ceo.status = 'Active';

  // Level 1: one C-suite leader per distinct csuite title (except CEO).
  const csuiteTitles = [];
  DEPARTMENTS.forEach((d) => {
    if (d.csuite !== exo.csuite && csuiteTitles.indexOf(d.csuite) === -1) csuiteTitles.push(d.csuite);
  });
  const csuiteByTitle = {};
  csuiteTitles.forEach((title) => {
    // A C-suite leader sits in the first department they own.
    const ownDept = DEPARTMENTS.find((d) => d.csuite === title);
    const leader = add({ title, departmentId: ownDept.id, managerId: ceo.id, forceEmployment: 'Full-time' });
    leader.status = 'Active';
    csuiteByTitle[title] = leader;
  });

  const TITLES = {
    vp: (dept) => `VP, ${dept.name}`,
    director: (dept) => `Director, ${dept.name}`,
    manager: (dept) => `${dept.name} Manager`,
    ic: (dept, i) => {
      const roles = icRoles(dept.code);
      return roles[i % roles.length];
    },
  };

  function icRoles(code) {
    switch (code) {
      case 'ENG': return ['Staff Engineer', 'Senior Software Engineer', 'Software Engineer', 'Backend Engineer', 'Frontend Engineer'];
      case 'PRD': return ['Senior Product Designer', 'Product Designer', 'Product Manager', 'UX Researcher'];
      case 'QAE': return ['SDET', 'Senior QA Engineer', 'Automation Engineer', 'QA Analyst'];
      case 'DAI': return ['Data Scientist', 'ML Engineer', 'Data Engineer', 'Analytics Engineer'];
      case 'INF': return ['Site Reliability Engineer', 'DevOps Engineer', 'Cloud Engineer', 'Platform Engineer'];
      case 'SEC': return ['Security Engineer', 'IT Administrator', 'Security Analyst'];
      case 'SAL': return ['Account Executive', 'Sales Development Rep', 'Solutions Engineer', 'Account Manager'];
      case 'MKT': return ['Marketing Specialist', 'Content Strategist', 'Growth Marketer', 'Brand Designer'];
      case 'CSM': return ['Customer Success Manager', 'Onboarding Specialist', 'Support Engineer', 'Renewals Manager'];
      case 'HRO': return ['People Partner', 'Recruiter', 'People Operations Specialist', 'L&D Specialist'];
      case 'FIN': return ['Financial Analyst', 'Accountant', 'Legal Counsel', 'FP&A Analyst'];
      default: return ['Specialist', 'Analyst', 'Associate'];
    }
  }

  // Levels 2..5, department by department.
  DEPARTMENTS.forEach((dept) => {
    if (dept.code === 'EXO') return; // executive office is just the CEO
    const shape = SHAPE[dept.code];
    if (!shape) return;
    const csuite = csuiteByTitle[dept.csuite];
    for (let v = 0; v < shape.vps; v += 1) {
      const vp = add({ title: TITLES.vp(dept), departmentId: dept.id, managerId: csuite.id });
      const directorCount = shape.directors || 0;
      if (directorCount === 0) {
        // VP -> Managers -> ICs
        for (let m = 0; m < (shape.managers || 0); m += 1) {
          const mgr = add({ title: TITLES.manager(dept), departmentId: dept.id, managerId: vp.id });
          for (let i = 0; i < (shape.ics || 0); i += 1) {
            add({ title: TITLES.ic(dept, i), departmentId: dept.id, managerId: mgr.id });
          }
        }
      } else {
        for (let dctr = 0; dctr < directorCount; dctr += 1) {
          const director = add({ title: TITLES.director(dept), departmentId: dept.id, managerId: vp.id });
          for (let m = 0; m < (shape.managers || 0); m += 1) {
            const mgr = add({ title: TITLES.manager(dept), departmentId: dept.id, managerId: director.id });
            for (let i = 0; i < (shape.ics || 0); i += 1) {
              add({ title: TITLES.ic(dept, i), departmentId: dept.id, managerId: mgr.id });
            }
          }
        }
      }
    }
  });

  return { departments, employees };
}

module.exports = { buildOrg };
