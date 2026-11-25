<div align="center">

# BisTech EMS Server

**Enterprise-grade Employee Management System REST API**

Built with **NestJS 12**, **TypeScript**, **Prisma 7**, **PostgreSQL**, and **Zod** — powering authentication, RBAC governance, employee directories, timezone-aware attendance, task workflows, and role-scoped analytics dashboards.

[![NestJS](https://img.shields.io/badge/NestJS-12.x-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7.x-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Zod](https://img.shields.io/badge/Zod-4.x-3E67B1?style=for-the-badge&logo=zod&logoColor=white)](https://zod.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.x-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/)

</div>

---

## Key Capabilities

- **Authentication & Session Security**: HttpOnly cookie + Bearer JWT (`jose`) authentication, `argon2id` password hashing, refresh token rotation, account lockout protection, and 6-digit OTP password reset & change-password flows.
- **Role-Based Access Control (RBAC)**: Scoped permissions across `super_admin`, `hr_manager`, `department_head`, and `employee` roles, with fail-closed out-of-scope (`404`) protection on sensitive records.
- **Employee Directory & Personal Profiles**: Full employee onboarding, department/designation transfers with employment history & audit logs, plus self-service and HR-managed sensitive personal profile endpoints (`/employees/me/profile`).
- **Timezone-Aware Attendance**: Daily web check-in, late-minute calculation against organization shift settings (`workStart`, `workEnd`, `graceMinutes`, `weekendDays`), holiday-aware absence derivation, and monthly attendance boards.
- **Task Management & Review Workflow**: Self, individual, and team task assignments; department & team boards; submission versioning; approval/changes-requested reviews; comments & suggestions; and review notifications.
- **Role-Scoped Dashboards**: Dedicated overview endpoints for Employees (`/dashboard/me`), HR Managers (`/dashboard/hr`), Super Admins (`/dashboard/company`), and unified multi-role summaries (`/dashboard/summary`).
- **Consistent API Envelopes**: Standardized `{ success, message, data, meta }` success payloads and `{ success: false, error: { code, message, details? }, requestId }` error responses via a global `HttpExceptionFilter`.

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Framework** | NestJS 12 (`@nestjs/core`, `@nestjs/platform-express`, Express 5) |
| **Language** | TypeScript 6 (ESM / `nodenext`) |
| **Database & ORM** | PostgreSQL 15+ with Prisma 7 (`@prisma/client`, `@prisma/adapter-pg`, `pg`) |
| **Validation** | Zod 4 |
| **Auth & Security** | `jose` (JWT), `argon2` (Argon2id), `cookie-parser` |
| **Testing** | Vitest 4 & Supertest |
| **Linting & Formatting** | Oxlint (`--type-aware`) & Prettier 3 |
| **Hosting** | Vercel Serverless (`api/index.js` + `vercel.json`) |

---

## Project Structure

```text
bistech_ems_server/
├── api/                    # Vercel serverless entrypoint
├── docs/                   # Product & architecture specs (PRD, FSD, FTL, SAD, TAD)
├── prisma/
│   └── schema.prisma       # PostgreSQL schema & models
├── src/
│   ├── attendance/         # Check-in, attendance boards, absence computation
│   ├── auth/               # Login, refresh, logout, OTP reset & change password
│   ├── common/             # Global HttpExceptionFilter & shared utilities
│   ├── dashboard/          # Employee, HR, Company & Summary dashboard metrics
│   ├── database/           # PrismaService & bootstrap/seed utilities
│   ├── departments/        # Departments, department heads & designations
│   ├── employees/          # Employee CRUD, employment history & sensitive profiles
│   ├── feedback/           # Issues and suggestions (submit, list, review)
│   ├── organization/       # Organization profile & shift/weekend settings
│   ├── tasks/              # Tasks, boards, assignments, submissions & comments
│   ├── teams/              # Teams & team membership management
│   ├── users/              # User accounts & role assignments
│   ├── app.module.ts       # Root NestJS module
│   └── main.ts             # App bootstrap, CORS, cookie-parser & /api/v1 prefix
└── test/                   # End-to-end Vitest suites
```

---

## API Modules (`/api/v1`)

All endpoints (except `/` and `/api/v1/health/db` or public auth routes) are served under `/api/v1` with cookie/JWT authentication via `AuthGuard`.

| Module | Base Path | Highlights |
| :--- | :--- | :--- |
| **Health** | `/`, `/api/v1/health/db` | Service status & PostgreSQL connectivity check |
| **Auth** | `/api/v1/auth` | `login`, `refresh`, `logout`, `me`, `forgot-password`, `verify-otp`, `reset-password`, `change-password` |
| **Organization** | `/api/v1/organization` | Get/update organization details & shift/weekend settings (`/settings`) |
| **Users & Roles** | `/api/v1/users`, `/api/v1/roles` | List users/roles and assign user roles (`PUT /users/:id/roles`) |
| **Departments** | `/api/v1/departments`, `/api/v1/designations` | Department & designation CRUD, assign department head (`PUT /departments/:id/head`) |
| **Teams** | `/api/v1/teams` | Team CRUD & member management (`POST/DELETE /teams/:id/members`) |
| **Employees** | `/api/v1/employees` | Directory listing, onboarding, work-record updates, & sensitive profiles (`/me/profile`, `/:id/profile`) |
| **Attendance** | `/api/v1/attendance` | Daily check-in (`POST /check-in`), personal board (`/me`), summary (`/summary`), org logs |
| **Tasks** | `/api/v1/tasks`, `/api/v1/task-assignments`, `/api/v1/task-submissions` | Task CRUD, `/me`, `/board/department`, `/board/team`, status transitions, submissions, reviews & comments |
| **Feedback (Issues & Suggestions)** | `/api/v1/feedback` | Submit (`POST`), list company-wide items with author details (`GET`), view (`GET /:id`), triage (`PATCH /:id`), delete (`DELETE /:id`), & comments (`GET/POST /:id/comments`, `PATCH/DELETE /:id/comments/:commentId`) |
| **Dashboard** | `/api/v1/dashboard` | Role-scoped analytics (`/me`, `/hr`, `/company`, `/summary`) |

---

## Getting Started

### Prerequisites

- **Node.js** `>= 22`
- **PostgreSQL** `>= 15`

### 1. Install Dependencies

```bash
git clone https://github.com/Bistech-io/bistech_ems_server.git
cd bistech_ems_server
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your database and auth configuration:

```bash
cp .env.example .env
```

```env
DATABASE_URL="postgresql://user:password@localhost:5432/bistech_ems"
CLOUDINARY_URL="cloudinary://<api_key>:<api_secret>@<cloud_name>"
JWT_SECRET="your-32-byte-minimum-secret"
PORT=4000
```

### 3. Generate Prisma Client & Run Migrations

```bash
npm run prisma:generate
npm run prisma:migrate
```

### 4. Start the Server

```bash
# Development (watch mode)
npm run start:dev

# Production build & start
npm run build
npm run start:prod
```

The API will be available at `http://localhost:4000/api/v1`.

---

## Available Scripts

| Script | Description |
| :--- | :--- |
| `npm run start:dev` | Start NestJS in watch mode |
| `npm run build` | Generate Prisma client & compile NestJS build |
| `npm run start:prod` | Run compiled production build (`node dist/main`) |
| `npm run lint` | Run type-aware `oxlint` across `src/` and `test/` |
| `npm run format` | Format TypeScript files with Prettier |
| `npm test` | Run Vitest unit test suite |
| `npm run test:cov` | Run Vitest with V8 coverage report |
| `npm run test:e2e` | Run end-to-end Vitest suite |
| `npm run prisma:generate` | Regenerate Prisma Client |
| `npm run prisma:migrate` | Run Prisma database migrations (`migrate dev`) |
| `npm run prisma:studio` | Open Prisma Studio |

---

## Architecture & Docs

Detailed product and engineering specifications live in the [`docs/`](./docs) directory:

- [`PRD.md`](./docs/PRD.md) — Product Requirements Document
- [`FSD.md`](./docs/FSD.md) — Functional Specification Document
- [`FTL.md`](./docs/FTL.md) — Feature Traceability List
- [`SAD.md`](./docs/SAD.md) — Software Architecture Document
- [`TAD.md`](./docs/TAD.md) — Technical Architecture Document

---

<div align="center">
  <sub>Maintained by the BisTech Engineering Team</sub>
</div>
