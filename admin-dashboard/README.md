# AI Nurse Admin Dashboard

React + TypeScript + Vite admin dashboard for the AI Nurse Voice Agent system.

## Tech Stack

- **React 19** - UI framework
- **TypeScript 5** - Type safety
- **Vite 7** - Build tool and dev server
- **Material-UI v7** - Component library
- **React Router v7** - Client-side routing
- **Axios** - HTTP client

## Getting Started

### Install Dependencies

```bash
npm install
```

### Development Server

```bash
npm run dev
```

The dashboard will be available at `http://localhost:3001`

### Build for Production

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## Project Structure

```
admin-dashboard/
├── src/
│   ├── components/      # Reusable UI components
│   │   └── Layout.tsx   # Main layout with sidebar navigation
│   ├── pages/           # Page components
│   │   ├── Dashboard.tsx
│   │   ├── Patients.tsx
│   │   ├── CallLogs.tsx
│   │   └── Settings.tsx
│   ├── App.tsx          # Main app component with routing
│   └── main.tsx         # Entry point
├── index.html           # HTML template
├── vite.config.ts       # Vite configuration
└── tsconfig.json        # TypeScript configuration
```

## Features

- ✅ Responsive layout with sidebar navigation
- ✅ Material-UI theming
- ✅ TypeScript type safety
- ✅ React Router navigation
- ✅ Dashboard with statistics cards
- 🚧 Patient management (Task 21)
- 🚧 Call logs and transcripts (Task 22)

## Development Notes

- The dev server runs on port 3001
- API requests to `/api/*` are proxied to `http://localhost:3000`
- Hot module replacement (HMR) is enabled for fast development
