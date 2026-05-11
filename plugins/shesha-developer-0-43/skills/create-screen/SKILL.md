---
name: create-screen
description: Scaffolds and registers a new custom screen in a Shesha application. Creates the screen component in src/screens/, registers it in the screen registry, and wires up the Next.js route under /dynamic/ so it renders within the Shesha app layout. Supports both authenticated (default) and public screens.
---

# Shesha Custom Screen Creator

You are an expert in the Shesha framework and Next.js App Router. You scaffold custom screens that render as regular React components within the Shesha application layout, accessible via `/dynamic/<route-path>`.

## When to Use This Skill

Use this skill when:
- The user wants to create a new custom page/screen in their Shesha application
- The screen should be accessible at `/dynamic/<route-path>`
- The screen renders regular React components (not Shesha form designer configurations)
- The screen should appear within the standard Shesha app layout (sidebar, header, etc.)

## Architecture Overview

Custom screens follow this architecture:

```
src/screens/
├── index.tsx                    # Screen registry — exports all ScreenDefinitions
├── interfaces.ts                # Shared interfaces (IScreenProps, ScreenDefinition)
├── my-screen/
│   └── index.tsx                # Screen component (React + Ant Design)
└── another-screen/
    └── index.tsx                # Another screen component

src/app/(main)/dynamic/
├── [...path]/page.tsx           # Existing catch-all (Shesha form configs)
└── reports/monthly/page.tsx     # Route entry point for a custom screen
```

- **Screen components** live in `src/screens/<screen-name>/index.tsx`
- **Route entry points** live in `src/app/(main)/dynamic/<route-path>/page.tsx`
- **Screen registry** at `src/screens/index.tsx` tracks all screen definitions
- Screens render at `{base_url}/dynamic/<route-path>`
- The `(main)` layout group provides the app shell (sidebar, header)
- **Auth is handled by the `(main)` layout group** — there is NO `withAuth` HOC in Shesha applications. Pages under `src/app/(main)/` are automatically authenticated. Public screens go under `src/app/no-auth/`.

## Step-by-Step Instructions

### 1. Gather Required Inputs

Prompt the user for these inputs:

| Input | Format | Example | Required |
|---|---|---|---|
| Screen name | kebab-case | `monthly-report` | Yes |
| Route path | slash-separated | `reports/monthly` | Yes |
| Display title | Free text | `Monthly Report` | Yes |
| Public access | boolean | `false` (default) | Yes |
| Screen description | Free text | What the screen should display and do | Yes |

### 2. Validate Before Writing

Before creating any files, perform these checks:

**Check 1: Screen directory does not already exist**
```
src/screens/<screen-name>/
```
If it exists, STOP and inform the user: "A screen with the name `<screen-name>` already exists at `src/screens/<screen-name>/`. Choose a different name or delete the existing screen first."

**Check 2: Route path is not already taken**
```
src/app/(main)/dynamic/<route-path>/page.tsx
```
If it exists, STOP and inform the user: "The route path `/dynamic/<route-path>` is already registered. Choose a different path."

**Check 3: No duplicate in screen registry**
Read `src/screens/index.tsx` and verify neither the screen name nor the route path is already registered. If duplicates exist, STOP and inform the user.

### 3. Bootstrap the Screens Infrastructure (First Time Only)
REMEMBER: By default /dynamic/ expects to render a Shesha form, make sure you 'whitelist' the path to the custom screen so the user does not get a 404.

If `src/screens/index.tsx` and `src/screens/interfaces.ts` do not yet exist, create them.

**`src/screens/interfaces.ts`**
```tsx
import { FC } from 'react';

export interface IScreenProps {
  title: string;
}

export interface ScreenDefinition {
  /** Unique kebab-case screen name */
  name: string;
  /** URL route path (relative to /dynamic/) */
  path: string;
  /** Human-readable display title */
  title: string;
  /** If true, the screen is publicly accessible without authentication. Default: false */
  isPublic?: boolean;
  /** The screen component */
  component: FC<IScreenProps>;
}
```

**`src/screens/index.tsx`**
```tsx
import { ScreenDefinition } from './interfaces';

export type { IScreenProps, ScreenDefinition } from './interfaces';

export const screens: ScreenDefinition[] = [];
```

### 4. Create the Screen Component

Create `src/screens/<screen-name>/index.tsx`.

The component must:
- Be typed as `FC<IScreenProps>`
- Import `IScreenProps` from `../interfaces`
- Use Ant Design components for UI
- Include `"use client"` directive
- Wrap content in a container with `padding: 24px`

**Template:**
```tsx
"use client";

import React from 'react';
import { Typography } from 'antd';
import { IScreenProps } from '../interfaces';

const { Title } = Typography;

const ScreenNameComponent: React.FC<IScreenProps> = ({ title }) => {
  return (
    <div style={{ padding: '24px' }}>
      <Title level={2}>{title}</Title>
      {/* Screen content here — build per user's description */}
    </div>
  );
};

export default ScreenNameComponent;
```

Build out the component based on the user's description. You have access to:

#### Shesha Application Hook (CRITICAL — read carefully)

The primary Shesha hook is `useSheshaApplication` from `@shesha-io/reactjs`. It returns an `ISheshaApplicationInstance` with the following key properties:

```tsx
import { useSheshaApplication } from '@shesha-io/reactjs';

const { backendUrl, httpHeaders } = useSheshaApplication();
```

**Available properties on `useSheshaApplication()`:**
- `backendUrl: string` — The backend API base URL (e.g., `http://localhost:21021`)
- `httpHeaders: Record<string, string>` — Auth headers (includes auth tokens automatically)
- `applicationName?: string`
- `applicationKey?: string`
- `globalVariables: Record<string, any>`
- `setGlobalVariables?: (values: Record<string, any>) => void`
- `anyOfPermissionsGranted: (permissions: string[]) => boolean`

**CRITICAL: There is NO `httpClient` property.** Do NOT destructure `httpClient` from `useSheshaApplication()` — it does not exist and will be `undefined`, causing a runtime `TypeError`.

#### Data Fetching Pattern (CORRECT)

Use the native `fetch` API with `backendUrl` and `httpHeaders` from `useSheshaApplication()`:

```tsx
"use client";

import React, { useEffect, useState } from 'react';
import { Spin, message } from 'antd';
import { useSheshaApplication } from '@shesha-io/reactjs';
import { IScreenProps } from '../interfaces';

const MyScreen: React.FC<IScreenProps> = ({ title }) => {
  const { backendUrl, httpHeaders } = useSheshaApplication();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${backendUrl}/api/services/app/MyEntity/GetAll`, {
      headers: { ...httpHeaders, 'Content-Type': 'application/json' },
    })
      .then((res) => res.json())
      .then((json) => setData(json?.result))
      .catch(() => message.error('Failed to load data'))
      .finally(() => setLoading(false));
  }, [backendUrl, httpHeaders]);

  return (
    <div style={{ padding: '24px' }}>
      <Spin spinning={loading}>{/* render data */}</Spin>
    </div>
  );
};

export default MyScreen;
```

**WRONG — do NOT use these patterns:**
```tsx
// WRONG: httpClient does not exist on useSheshaApplication()
const { httpClient } = useSheshaApplication();
httpClient.get('/api/...'); // TypeError: Cannot read properties of undefined

// WRONG: useHttpClient does not exist in @/providers
import { useHttpClient } from '@/providers';

// WRONG: useAuth does not exist in @/providers
import { useAuth } from '@/providers';
```

#### UI Components (Ant Design)
```tsx
import { Button, Table, Card, Form, Input, Space, Typography, Row, Col, Spin, message } from 'antd';
```

#### Styling
Prefer Ant Design's layout components (`Row`, `Col`, `Space`, `Card`, `Flex`). For custom styles, use CSS Modules (`styles.module.css` alongside the component) or inline styles.

### 5. Register the Screen

Update `src/screens/index.tsx` to import and register the new screen.

**Add the import** at the top:
```tsx
import ScreenNameComponent from './<screen-name>';
```

**Add the entry** to the `screens` array:
```tsx
export const screens: ScreenDefinition[] = [
  // ... existing entries
  {
    name: '<screen-name>',
    path: '<route-path>',
    title: '<Display Title>',
    isPublic: false, // or true if public
    component: ScreenNameComponent,
  },
];
```

### 6. Create the Route Entry Point

Create the Next.js page at `src/app/(main)/dynamic/<route-path>/page.tsx`.

**For authenticated screens** (default, `isPublic: false`):
```tsx
"use client";

import React, { FC } from 'react';
import ScreenNameComponent from '@/screens/<screen-name>';

const Page: FC = () => {
  return <ScreenNameComponent title="<Display Title>" />;
};

export default Page;
```

**For public screens** (`isPublic: true`), place the route under `src/app/no-auth/` instead:
```tsx
"use client";

import React, { FC } from 'react';
import ScreenNameComponent from '@/screens/<screen-name>';

const Page: FC = () => {
  return <ScreenNameComponent title="<Display Title>" />;
};

export default Page;
```

Key rules:
- MUST include `"use client"` directive
- MUST type the component as `FC` from React
- Do NOT import `PageWithLayout` from `@/interfaces` — it does not exist in Shesha apps
- Do NOT import `withAuth` from `@/hocs` — it does not exist in Shesha apps. Auth is handled by the `(main)` layout group automatically
- Authenticated screens go under `src/app/(main)/dynamic/` — the `(main)` layout handles auth
- Public screens go under `src/app/no-auth/`
- More specific Next.js routes take precedence over the `[...path]` catch-all, so the custom screen renders instead of the Shesha form loader

### 7. Verify and Report

After creating all files:

1. List all files created/modified:
   - `src/screens/interfaces.ts` (if bootstrapped)
   - `src/screens/index.tsx` (created or updated)
   - `src/screens/<screen-name>/index.tsx`
   - `src/app/(main)/dynamic/<route-path>/page.tsx`

2. Confirm the screen URL:
   ```
   {base_url}/dynamic/<route-path>
   ```

3. State whether the screen requires authentication or is public

## Important Rules

- Screen components MUST live in `src/screens/<screen-name>/` — not in the `app/` directory
- Route entry points MUST live under `src/app/(main)/dynamic/` to render at `/dynamic/<route-path>`
- ALWAYS validate for duplicates before writing any files
- ALWAYS use kebab-case for screen directory names
- ALWAYS use Ant Design for UI components — do not add other UI libraries
- ALWAYS use `@/` import alias for project source imports
- ALWAYS import Shesha hooks from `@shesha-io/reactjs` (e.g., `useSheshaApplication`)
- NEVER import `useHttpClient`, `useAuth`, or `useGlobalState` from `@/providers` — these do not exist
- NEVER destructure `httpClient` from `useSheshaApplication()` — it does not exist and will cause a runtime TypeError
- NEVER import `withAuth` from `@/hocs` — it does not exist; auth is automatic via the `(main)` layout
- NEVER import `PageWithLayout` from `@/interfaces` — it does not exist; use `FC` from React
- NEVER use Shesha form designer JSON markup — build screens with plain React + Ant Design
- For data fetching, use `fetch()` with `backendUrl` and `httpHeaders` from `useSheshaApplication()`
- Include `backendUrl` and `httpHeaders` in `useEffect` dependency arrays for data fetching
- Add reasonable loading states and error handling for async operations
- Keep the route `page.tsx` thin — all component logic belongs in `src/screens/<screen-name>/index.tsx`
