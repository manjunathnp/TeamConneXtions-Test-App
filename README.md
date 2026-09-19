<div align="center">
  <img src="assets/teamconnextions-logo-dark.png" alt="TeamConneXtions logo" width="300" />

  # TeamConneXtions

  **A purpose-built employee directory for modern UI and API automation practice.**

  ![Version](https://img.shields.io/badge/version-1.0.1-e8b64c?style=flat-square)
  ![Node.js](https://img.shields.io/badge/Node.js-20%2B-43853d?style=flat-square&logo=node.js&logoColor=white)
  ![Playwright](https://img.shields.io/badge/tested_with-Playwright-2ead33?style=flat-square&logo=playwright&logoColor=white)
</div>

## About

TeamConneXtions is a deterministic demo application for practising end-to-end, UI, and REST API automation. One lightweight Node.js process serves the employee-directory interface, an interactive API reference, and the API itself, so browser and service-level tests always exercise the same data and business rules.

The application models a global company of 117 employees across departments, locations, reporting levels, employment types, and regions. Its deliberately testable validation and authorization rules make it useful for positive, negative, role-based, and data-driven automation scenarios.

> Demo App for UI & API Automation — Conceptualised and Developed by **Manjunath N P** · [LinkedIn](https://www.linkedin.com/in/manjunathnp/)

## Demo site

The demo currently runs locally:

| Experience | URL |
|---|---|
| Employee directory | [http://127.0.0.1:4100/](http://127.0.0.1:4100/) |
| Interactive API docs | [http://127.0.0.1:4100/docs](http://127.0.0.1:4100/docs) |
| OpenAPI specification | [http://127.0.0.1:4100/openapi.json](http://127.0.0.1:4100/openapi.json) |
| REST API base | `http://127.0.0.1:4100/api` |

Start the server before opening these links. This repository does not currently advertise a publicly hosted deployment.

## Features

- Searchable and filterable employee directory with sortable columns and pagination
- Employee details with direct and skip-level team views
- Expandable organization chart with six reporting levels
- Workforce insights by department, location, region, employment type, and hiring date
- Role-based access for an administrator and a read-only user
- Employee create, read, update, and delete workflows
- Interactive, OpenAPI-driven API documentation with in-page requests
- Automation Playground covering forms, keyboard input, selects, uploads, hover, drag-and-drop, dialogs, shadow DOM, iframes, popups, tables, and accordions
- Stable `data-testid` attributes throughout the interactive UI
- Deterministic reset endpoint for repeatable test runs
- Consistent API error envelopes and `X-Request-Id` response headers

## Technology

- Node.js built-in HTTP server; no runtime dependencies
- HTML, CSS, and vanilla JavaScript frontend
- OpenAPI 3.0.3 API contract
- Playwright UI and API tests

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer
- npm (included with Node.js)
- Git

### Set up the project

```bash
git clone https://github.com/manjunathnp/TeamConneXtions-Test-App.git
cd TeamConneXtions-Test-App
npm install
```

Install the Chromium browser used by the Playwright suite:

```bash
npx playwright install chromium
```

### Run the application

```bash
npm start
```

Open [http://127.0.0.1:4100/](http://127.0.0.1:4100/) in a browser. Serve the app through Node.js; opening `ui.html` or `docs.html` directly from disk will prevent normal API requests and navigation.

To bind a different host or port:

```bash
HOST=0.0.0.0 PORT=4200 npm start
```

## Demo credentials

These credentials belong only to the local test application and are intentionally public.

| Purpose | Credentials | Access |
|---|---|---|
| Administrator | `admin` / `admin123` | Full employee management |
| Standard user | `user` / `user123` | Read only |
| API key exercise | `X-API-Key: teamconnex-key-2026` | `/api/auth/apikey` |
| Basic Auth exercise | `connex` / `basic123` | `/api/auth/basic` |

The Settings drawer in both the app and API docs can test the API connection, reset demo data, and display the practice credentials.

## Seed data

`POST /api/reset` restores the same dataset on every run:

- 117 employees with IDs 1–117; the next created employee receives ID 118
- 12 staffed departments, with Engineering as the largest
- 12 locations across APAC, EMEA, and the Americas
- Six levels from CEO through individual contributor
- One CEO root with six direct reports
- Active and On Leave statuses, plus full-time, contract, and intern employment types

The data is built from `tools/org-template.js` through `tools/build-org.js`, making assertions repeatable and safe to reset.

## Business rules for negative testing

| Scenario | Expected result |
|---|---|
| Admin deletes their linked employee record | `403 SELF_DELETE_FORBIDDEN` |
| Manager with direct reports is deleted without reassignment | `409 EMPLOYEE_HAS_REPORTS` |
| Reassignment target is missing or invalid | `400 VALIDATION_ERROR` |
| Create or update uses an existing email | `409 DUPLICATE_EMAIL` |
| Read-only user attempts a write | `403 FORBIDDEN` |
| Token is missing or invalid | `401 UNAUTHORIZED` |
| Request body contains invalid JSON or exceeds 100 KB | `400 INVALID_JSON` / `413 PAYLOAD_TOO_LARGE` |
| Unsupported method targets a valid route | `405 METHOD_NOT_ALLOWED` with an `Allow` header |

All API failures use this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields failed validation.",
    "details": []
  }
}
```

## API overview

| Area | Endpoints |
|---|---|
| System | `GET /api/ping`, `POST /api/reset`, `GET /api/overview` |
| Authentication | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Auth practice | `GET /api/auth/apikey`, `GET /api/auth/basic` |
| Employees | `GET\|POST /api/employees`, `GET\|PUT\|PATCH\|DELETE /api/employees/{id}` |
| Teams | `GET /api/employees/{id}/team` |
| Organization | `GET /api/departments`, `GET /api/orgchart`, `GET /api/stats` |
| Utilities | `GET /api/delay`, `POST /api/echo`, `GET /api/status/{code}` |

See the [interactive API reference](http://127.0.0.1:4100/docs) or [`openapi.json`](openapi.json) for request and response schemas.

## Testing

Run the full Playwright suite. The Playwright configuration starts the application automatically when needed:

```bash
npm test
```

Run a focused suite:

```bash
npm run test:api
npm run test:ui
```

Run the dependency-free regression checks while the app is running in another terminal:

```bash
npm start
# In a second terminal:
npm run regression
```

Open the latest Playwright HTML report:

```bash
npm run report
```

## Project structure

```text
.
├── assets/                 # Application logo and transparent tab icon
├── docs.html               # Interactive API reference
├── openapi.json            # OpenAPI 3.0.3 specification
├── playwright.config.ts    # Playwright configuration and local web server
├── server.js               # HTTP server, REST API, and static-file routes
├── tests/                  # Playwright API and UI tests
├── tools/                  # Seed-data builder and deep regression runner
├── ui.html                 # Employee-directory web application
└── package.json            # Scripts and development dependencies
```

## Notes

- Data is held in memory and is intentionally reset when the process restarts.
- Authentication tokens are practice tokens, not production JWTs.
- The included names and records are synthetic test data.
- Do not use the demo credentials or security model in a production system.

## Author

Conceptualised and developed by **Manjunath N P**.

- LinkedIn: [linkedin.com/in/manjunathnp](https://www.linkedin.com/in/manjunathnp/)
- Repository: [github.com/manjunathnp/TeamConneXtions-Test-App](https://github.com/manjunathnp/TeamConneXtions-Test-App)
