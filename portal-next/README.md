# TradersUtopia Portal (Next.js)

Modern rewrite of the TradersUtopia Portal, migrated from Google Apps Script to Next.js with Vercel deployment.

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Database:** PostgreSQL with Prisma ORM
- **Auth:** JWT sessions with bcrypt password hashing
- **Validation:** Zod schemas
- **Styling:** CSS with Tailwind-compatible utilities
- **Deployment:** Vercel

## Project Structure

```
portal-next/
├── prisma/
│   └── schema.prisma       # Database schema
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── (auth)/          # Auth pages (login, set-password)
│   │   ├── (portal)/        # Protected portal pages
│   │   ├── api/             # API routes
│   │   ├── layout.tsx       # Root layout
│   │   ├── page.tsx         # Root page (redirects to login)
│   │   └── globals.css      # Global styles
│   ├── components/          # React components
│   ├── lib/
│   │   ├── auth/            # Auth utilities (password, session)
│   │   ├── api/             # API client utilities
│   │   ├── db/              # Prisma client
│   │   ├── utils/           # Utility functions
│   │   └── config.ts        # Configuration
│   └── types/               # TypeScript types
├── .env.example             # Environment template
├── package.json
└── tsconfig.json
```

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Rewardful API key

### Setup

1. **Install dependencies:**
   ```bash
   cd portal-next
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your values
   ```

3. **Set up database:**
   ```bash
   npm run db:generate    # Generate Prisma client
   npm run db:push        # Push schema to database
   ```

4. **Start development server:**
   ```bash
   npm run dev
   ```

5. **Open browser:**
   ```
   http://localhost:3000
   ```

## Environment Variables

See `.env.example` for all available configuration options. Required variables:

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret for signing tokens (min 32 chars)
- `REWARDFUL_API_KEY` - Rewardful API key
- `ADMIN_EMAILS` - Comma-separated admin emails

## Database Schema

The Prisma schema maps legacy PropertiesService keys to relational tables:

| Legacy Key | Table |
|------------|-------|
| `AUTH_*` | `User` |
| `SESSION_*` | `Session` |
| `TEACHER_LINKS_*` | `TeacherStudentLink` |
| `ATTENDANCE_USER_*` | `AttendanceProfile` |
| `ATTENDANCE_RECORD_*` | `AttendanceRecord` |
| `REFERRAL_DATA_*` | `ReferralCache` |
| `ADMIN_OVERRIDE_*` | `CommissionOverride` |
| `TEACHER_EARNINGS_*` | `TeacherEarnings` |

## Deploy (Vercel)

1. **Apply DB changes** (new TeacherChangeRequest table), once:
   - With migrations: `npx prisma migrate deploy` (use production `DATABASE_URL`).
   - With push: `npx prisma db push`.
2. **Deploy:**
   ```bash
   cd portal-next
   npx vercel login   # if needed
   npx vercel --prod
   ```
   Ensure `DATABASE_URL` and `DIRECT_URL` are set in the Vercel project.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run format` | Format with Prettier |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:push` | Push schema to database |
| `npm run db:migrate` | Run migrations |
| `npm run db:studio` | Open Prisma Studio |
| `npm run typecheck` | Run TypeScript checks |
| `npm run test` | Run tests (Vitest) |

## Migration Notes

This project is Phase 2 of the migration from Google Apps Script. Key considerations:

1. **Dual Email System:** Preserved alias email vs internal email mapping
2. **Legacy Password Hashes:** Supports both legacy SHA-256 and new bcrypt
3. **Session Compatibility:** JWT tokens replace PropertiesService sessions
4. **API Compatibility:** `/api/gs-call` endpoint for gradual frontend migration

## License

Private - TradersUtopia
