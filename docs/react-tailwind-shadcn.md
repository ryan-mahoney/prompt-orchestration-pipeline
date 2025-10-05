# React + Tailwind CSS + Radix UI Implementation Plan

## Overview

This document outlines the plan to enable the React dashboard (`src/pages/PromptPipelineDashboard.jsx`) to run from `src/ui/server.js` with Tailwind CSS styling and Radix UI components.

## Current State Analysis

The project has:

- **React components** already created (`PromptPipelineDashboard.jsx`, `JobCard.jsx`, `JobDetail.jsx`, `JobList.jsx`)
- **Radix UI imports** using `@/components/ui/*` path aliases (tabs, badge, button, card, progress)
- **Utility functions** for time formatting and UI helpers
- **Demo data** in `src/data/demoData.js`
- **Node.js server** (`src/ui/server.js`) serving static files from `src/ui/public/`
- **No React build tooling** - currently serving vanilla JS from public folder
- **No Tailwind CSS** or Radix UI installed

## Implementation Plan

### Phase 1: Build Tooling Setup

1. **Install Vite** as the React build tool (fast, modern, great DX)

   ```bash
   npm install --save-dev vite @vitejs/plugin-react
   ```

2. **Configure Vite** with React plugin and path aliases for `@/` imports
   - Create `vite.config.js` in project root
   - Configure path alias `@` → `./src`
   - Set build output to `src/ui/dist`

3. **Create entry point** (`src/ui/client/main.jsx`) to mount the React app
   - Import React and ReactDOM
   - Mount `PromptPipelineDashboard` component
   - Import Tailwind CSS

### Phase 2: Styling Infrastructure

4. **Install Tailwind CSS** with PostCSS and Autoprefixer

   ```bash
   npm install --save-dev tailwindcss postcss autoprefixer
   npx tailwindcss init -p
   ```

5. **Configure Tailwind** with content paths for React components
   - Update `tailwind.config.js` with content paths
   - Configure theme extensions if needed
   - Set up dark mode support

6. **Create Tailwind CSS file** with base, components, and utilities layers
   - Create `src/ui/client/index.css`
   - Add Tailwind directives
   - Add custom CSS variables for Radix UI

### Phase 3: Radix UI Components ✅ COMPLETED

7. **Install Radix UI dependencies** ✅

   ```bash
   npm install lucide-react class-variance-authority clsx tailwind-merge
   npm install react react-dom
   ```

8. **Set up Radix UI configuration** ✅
   - Create `components.json` for component configuration ✅
   - Create `src/lib/utils.js` with `cn()` utility ✅
   - Configure component paths ✅

9. **Install Radix UI components** needed by the dashboard: ✅
   ```bash
   # Components using Radix UI primitives
   npm install @radix-ui/react-tabs
   npm install @radix-ui/react-badge
   npm install @radix-ui/react-button
   npm install @radix-ui/react-card
   npm install @radix-ui/react-progress
   ```

**Additional components installed:**

- `select` - For dropdown selection
- `separator` - For visual separation between elements

### Phase 4: Integration ✅ COMPLETED

10. **Update server.js** to serve built React app from `dist/` folder ✅
    - Modified static file serving to use `src/ui/dist` ✅
    - Updated routes to serve `index.html` for root path ✅
    - Added support for assets and client-side routing ✅
    - Kept existing API and SSE endpoints ✅

11. **Add build scripts** to package.json for development and production ✅

    ```json
    {
      "scripts": {
        "ui:dev": "vite",
        "ui:build": "vite build",
        "ui:preview": "vite preview",
        "ui:prod": "node src/ui/server.js"
      }
    }
    ```

12. **Configure path resolution** for imports in both Vite and Node.js ✅
    - Vite: Using `resolve.alias` in vite.config.js ✅
    - All `@/` imports resolve correctly ✅

### Phase 5: Testing & Verification ✅ COMPLETED

13. **Build the React app** and verify all components render ✅
    - Run `npm run ui:build` ✅
    - Check `src/ui/dist` for built files ✅

14. **Test the server** serves the dashboard correctly ✅
    - Start server with `npm run ui:prod` ✅
    - Verify dashboard loads at `http://localhost:4000` ✅
    - Confirm API endpoints respond correctly ✅

15. **Verify Tailwind styles** and Radix UI components work properly ✅
    - Check component styling ✅
    - Test responsive design ✅
    - Verify build process includes all styles ✅

## Key Technical Decisions

- **Vite over Webpack**: Faster builds, better DX, simpler configuration
- **Keep server.js separate**: Maintain existing API/SSE functionality
- **Build to dist/**: Standard convention, keeps source separate from build
- **Path alias @/**: Maps to `src/` for clean imports

## Dependencies to Install

```json
{
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "lucide-react": "^0.344.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "vite": "^5.1.4",
    "tailwindcss": "^3.4.1",
    "postcss": "^8.4.35",
    "autoprefixer": "^10.4.17"
  }
}
```

## File Structure After Implementation

```
src/ui/
├── client/              # React app source
│   ├── main.jsx        # Entry point
│   ├── App.jsx         # Root component (optional wrapper)
│   └── index.css       # Tailwind imports
├── components/         # Radix UI components
│   └── ui/
│       ├── tabs.jsx
│       ├── badge.jsx
│       ├── button.jsx
│       ├── card.jsx
│       └── progress.jsx
├── lib/
│   └── utils.js        # cn() utility for class merging
├── server.js           # Node.js server (updated)
├── public/             # Static assets (favicon, etc.)
└── dist/               # Built React app (gitignored)
    ├── index.html
    ├── assets/
    │   ├── index-[hash].js
    │   └── index-[hash].css
    └── ...
```

## Configuration Files

### vite.config.js

```javascript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: "src/ui/client",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

### tailwind.config.js

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      // Radix UI theme extensions
    },
  },
  plugins: [require("tailwindcss-animate")],
};
```

### components.json

```json
{
  "$schema": "./schema.json",
  "style": "default",
  "rsc": false,
  "tsx": false,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/ui/client/index.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

## Development Workflow

### Development Mode

```bash
# Terminal 1: Run Vite dev server with HMR
npm run ui:dev

# Terminal 2: Run Node.js server for API/SSE
npm run ui:prod
```

### Production Build

```bash
# Build React app
npm run ui:build

# Start production server
npm run ui:prod
```

## Benefits

1. **Modern React Development**: Hot module replacement, fast refresh
2. **Type-safe Styling**: Tailwind CSS with IntelliSense
3. **Component Library**: Pre-built, accessible Radix UI components
4. **Fast Builds**: Vite's lightning-fast build times
5. **Maintainable**: Clear separation of concerns
6. **Production Ready**: Optimized builds with code splitting

## Next Steps

After implementation:

1. Add more Radix UI components as needed
2. Implement dark mode toggle
3. Add loading states and error boundaries
4. Connect to real API endpoints
5. Add unit tests for React components
6. Set up E2E tests with Playwright/Cypress

## Notes

- The existing `src/ui/public/` files can be kept for backward compatibility or removed
- Consider adding a reverse proxy (nginx) in production for better performance
- May want to add environment variables for API endpoints
- Consider adding React Router if multiple pages are needed
