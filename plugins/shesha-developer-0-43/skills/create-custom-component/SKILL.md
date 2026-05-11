---
name: create-custom-component
description: Use this skill when creating new designer components in Shesha package projects (e.g., enterprise, reporting, workflow). This skill guides you through implementing custom form components with proper interfaces, settings forms, component definitions, and toolbox registration following Shesha package-level patterns.
---

# Shesha Package Designer Component Creator

You are an expert in the Shesha framework with deep expertise in creating custom designer components for package projects. You specialize in building reusable, well-architected form components that live in packages outside of the core `@shesha-io/reactjs` library (e.g., enterprise, reporting, workflow packages).

## When to Use This Skill

Use this skill when:
- Creating new custom form designer components **in a package project** (not in the core Shesha library)
- Building input, output, or container components for packages like enterprise, reporting, or workflow
- Implementing component configuration forms using the `SettingsFormMarkupFactory` pattern
- Registering components in the package's `formDesignerComponents` toolbox group
- Creating component migrations and type definitions in a package context

> **Note:** If you are creating a component in the **core** `@shesha-io/reactjs` library (using `@/` import aliases), use the `create-core-component` skill instead. This skill is for **package-level** components that import from `@shesha-io/reactjs`.

## Key Differences from Core Components

| Aspect | Core Component | Package Component (this skill) |
|---|---|---|
| Imports | `@/interfaces`, `@/providers/form/models` | `@shesha-io/reactjs` |
| Settings form | JSON-based (`settingsForm.json`) | Factory-based (`SettingsFormMarkupFactory`) |
| Props file | `interfaces.ts` | `model.ts` |
| Settings file | `settingsForm.json` or `settingsForm.ts` | `settings.ts` |
| Registration | `toolboxComponents.ts` in core | `designer-components/index.ts` in package |
| Settings builder | Manual JSON markup | Fluent `fbf()` builder API |

## Instructions

### Step 1: Gather Requirements

Ask the user for:
- **Package name** — which package does this belong to? (e.g., enterprise, reporting, workflow)
- **Component name** (camelCase, e.g., "customRating")
- **Display name** (e.g., "Custom Rating")
- **Component description/purpose**
- **Category/group name** (e.g., "Enterprise", "Reporting" — this is the toolbox group)
- **Is it an input component?** (can bind to form data)
- **Is it an output component?**
- **Does it support containers/child components?**
- **Custom properties** needed beyond base `IConfigurableFormComponent`
- **Icon name** (from `@ant-design/icons`, e.g., "StarOutlined")
- **Does it need a separate UI component?** (in `components/` folder, or inline in the designer component)

### Step 2: Locate the Package

Find the target package and verify the directory structure. The typical package layout is:

```
packages/{packageName}/src/
├── components/                    # Reusable UI components
│   └── {componentName}/
│       └── index.tsx
├── designer-components/           # Designer toolbox components
│   ├── index.ts                   # Registration file (formDesignerComponents)
│   └── {componentName}/
│       ├── index.tsx              # Component definition (IToolboxComponent)
│       ├── model.ts               # Props interface
│       └── settings.ts            # Settings form (SettingsFormMarkupFactory)
└── index.ts                       # Package exports
```

### Step 3: Create File Structure

Generate these files in `src/designer-components/{componentName}/`:

1. **model.ts** — TypeScript props interface
2. **settings.ts** — Configuration UI using `SettingsFormMarkupFactory`
3. **index.tsx** — Main component definition

Optionally, if the component needs a separate reusable UI control:
4. **`src/components/{componentName}/index.tsx`** — The actual UI component

### Step 4: File Templates

#### model.ts Template
```typescript
import { IConfigurableFormComponent } from '@shesha-io/reactjs';

/**
 * Props for {ComponentDisplayName} designer component
 */
export interface I{ComponentName}Props extends IConfigurableFormComponent {
  // Add custom properties here
  placeholder?: string;
  // ... other custom props
}
```

#### settings.ts Template (Simple — flat layout)
```typescript
import { SettingsFormMarkupFactory } from '@shesha-io/reactjs';
import { nanoid } from 'nanoid';

export const getSettings: SettingsFormMarkupFactory = ({ fbf }) => {
  return fbf()
    .addSectionSeparator({
      id: nanoid(),
      componentName: 'separator1',
      parentId: 'root',
      label: 'Display',
    })
    .addPropertyAutocomplete({
      id: nanoid(),
      propertyName: 'name',
      componentName: 'name',
      parentId: 'root',
      label: 'Name',
      validate: { required: true },
    })
    .addTextArea({
      id: nanoid(),
      propertyName: 'description',
      componentName: 'description',
      parentId: 'root',
      label: 'Description',
      autoSize: false,
      showCount: false,
      allowClear: false,
    })
    // Add custom property fields here
    .toJson();
};
```

#### settings.ts Template (Tabbed — use addSearchableTabs for new components)
```typescript
import { SettingsFormMarkupFactory } from '@shesha-io/reactjs';
import { nanoid } from 'nanoid';

export const getSettings: SettingsFormMarkupFactory = ({ fbf }) => {
  const searchableTabsId = nanoid();
  const commonTabId = nanoid();
  const dataTabId = nanoid();
  const securityTabId = nanoid();

  return {
    components: fbf()
      .addSearchableTabs({
        id: searchableTabsId,
        propertyName: 'settingsTabs',
        parentId: 'root',
        label: 'Settings',
        hideLabel: true,
        labelAlign: 'right',
        size: 'small',
        tabs: [
          {
            key: '1',
            title: 'Common',
            id: commonTabId,
            components: [
              ...fbf()
                .addContextPropertyAutocomplete({
                  id: nanoid(),
                  propertyName: 'propertyName',
                  parentId: commonTabId,
                  label: 'Property Name',
                  size: 'small',
                  styledLabel: true,
                  validate: { required: true },
                })
                .addSettingsInputRow({
                  id: nanoid(),
                  parentId: commonTabId,
                  propertyName: 'editMode',
                  label: 'Edit Mode',
                  inputs: [
                    {
                      type: 'editModeSelector',
                      id: nanoid(),
                      parentId: commonTabId,
                      propertyName: 'editMode',
                      label: 'Edit Mode',
                    },
                    {
                      type: 'switch',
                      id: nanoid(),
                      parentId: commonTabId,
                      propertyName: 'hidden',
                      label: 'Hide',
                      jsSetting: true,
                    },
                  ],
                })
                // Add more common fields here
                .toJson(),
            ],
          },
          {
            key: '2',
            title: 'Data',
            id: dataTabId,
            components: [
              ...fbf()
                // Add data-related settings here
                .toJson(),
            ],
          },
          {
            key: '3',
            title: 'Security',
            id: securityTabId,
            components: [
              ...fbf()
                .addSettingsInput({
                  id: nanoid(),
                  inputType: 'permissions',
                  propertyName: 'permissions',
                  label: 'Permissions',
                  size: 'small',
                  parentId: securityTabId,
                  jsSetting: true,
                })
                .toJson(),
            ],
          },
        ],
      })
      .toJson(),
    formSettings: {
      colon: false,
      layout: 'vertical',
      labelCol: { span: 24 },
      wrapperCol: { span: 24 },
    },
  };
};
```

#### index.tsx Template (with separate UI component)
```typescript
import React from 'react';
import { {IconName} } from '@ant-design/icons';
import {
  IToolboxComponent,
  validateConfigurableComponentSettings,
} from '@shesha-io/reactjs';
import { I{ComponentName}Props } from './model';
import { getSettings } from './settings';
import {ComponentControl} from '../../components/{componentName}';

const {ComponentName}: IToolboxComponent<I{ComponentName}Props> = {
  type: '{componentName}',
  isInput: {isInput},
  isOutput: {isOutput},
  name: '{ComponentDisplayName}',
  icon: <{IconName} />,
  Factory: ({ model }) => {
    if (model.hidden) return null;

    return <{ComponentControl} {...model} />;
  },
  settingsFormMarkup: getSettings,
  validateSettings: (model) => validateConfigurableComponentSettings(getSettings, model),
  migrator: (m) => m
    .add<I{ComponentName}Props>(0, (prev) => ({
      ...prev,
      // Set default values for initial migration
    })),
};

export default {ComponentName};
```

#### index.tsx Template (inline — no separate UI component)
```typescript
import React from 'react';
import { {IconName} } from '@ant-design/icons';
import {
  IConfigurableFormComponent,
  IToolboxComponent,
  validateConfigurableComponentSettings,
} from '@shesha-io/reactjs';
import { getSettings } from './settings';

export interface I{ComponentName}Props extends IConfigurableFormComponent {
  // Custom properties
}

const {ComponentName}: IToolboxComponent<I{ComponentName}Props> = {
  type: '{componentName}',
  isInput: {isInput},
  name: '{ComponentDisplayName}',
  icon: <{IconName} />,
  Factory: ({ model }) => {
    const { /* destructure custom props */ } = model;

    if (model.hidden) return null;

    return (
      <div>
        {/* Component implementation */}
      </div>
    );
  },
  settingsFormMarkup: getSettings,
  validateSettings: (model) => validateConfigurableComponentSettings(getSettings, model),
};

export default {ComponentName};
```

#### Optional: UI Component Template (src/components/{componentName}/index.tsx)
```typescript
import React, { FC } from 'react';
import { I{ComponentName}Props } from '../../designer-components/{componentName}/model';

export const {ComponentControl}: FC<I{ComponentName}Props> = (props) => {
  const { /* destructure props */ } = props;

  return (
    <div>
      {/* Component UI implementation */}
    </div>
  );
};

export default {ComponentControl};
```

### Step 5: Key Patterns

**Data Binding (input components):**
For input components, use `ConfigurableFormItem` from `@shesha-io/reactjs`:
```typescript
import { ConfigurableFormItem } from '@shesha-io/reactjs';

Factory: ({ model }) => {
  if (model.hidden) return null;

  return (
    <ConfigurableFormItem model={model}>
      {(value, onChange) => (
        <YourComponent value={value} onChange={onChange} />
      )}
    </ConfigurableFormItem>
  );
},
```

**Container Support (if needed):**
```typescript
import { nanoid } from 'nanoid';

// Add to component definition:
getContainers: (model) => [
  { id: model.content?.id, components: model.content?.components ?? [] }
],

initModel: (model) => ({
  ...model,
  content: { id: nanoid(), components: [] }
})
```

### Step 6: Register in Toolbox

Open the package's `src/designer-components/index.ts` and add the new component:

```typescript
import { IToolboxComponentBase, IToolboxComponentGroup } from '@shesha-io/reactjs';
// ... existing imports
import {ComponentName} from './{componentName}';

export const formDesignerComponents: IToolboxComponentGroup[] = [
  {
    name: '{GroupName}',  // e.g., 'Enterprise', 'Reporting'
    components: [
      // ... existing components
      {ComponentName},
    ],
    visible: true,
  },
];
```

> **Note:** If the component has complex generics, you may need a type assertion:
> ```typescript
> {ComponentName} as unknown as IToolboxComponentBase,
> ```

### Step 7: Testing Checklist

Provide this checklist after generation:
- [ ] Files created in `src/designer-components/{componentName}/`
- [ ] `model.ts` — interfaces properly typed, extends `IConfigurableFormComponent`
- [ ] `settings.ts` — uses `SettingsFormMarkupFactory` with `fbf()` builder
- [ ] `index.tsx` — exports `IToolboxComponent` with correct type, icon, Factory
- [ ] Component registered in `src/designer-components/index.ts` (`formDesignerComponents`)
- [ ] If separate UI component: created in `src/components/{componentName}/`
- [ ] Migrations implemented (if applicable)
- [ ] `model.hidden` check present in Factory
- [ ] Data binding works correctly (if input component)
- [ ] Test drag & drop in Form Designer
- [ ] Test configuration panel (settings form)
- [ ] Test data save/load

### Common Imports Reference

```typescript
// From @shesha-io/reactjs — Component definition
import {
  IToolboxComponent,
  IToolboxComponentBase,
  IToolboxComponentGroup,
  IConfigurableFormComponent,
  validateConfigurableComponentSettings,
  ConfigurableFormItem,
  ShaIcon,
} from '@shesha-io/reactjs';

// From @shesha-io/reactjs — Settings form
import { SettingsFormMarkupFactory } from '@shesha-io/reactjs';

// Utilities
import { nanoid } from 'nanoid';

// Icons
import { StarOutlined, EditOutlined /* etc */ } from '@ant-design/icons';

// React
import React, { FC, useState, useEffect, useMemo } from 'react';

// Ant Design UI (commonly used in components)
import { Button, Input, Select, Switch, Empty, Tag } from 'antd';
```

### Settings Form Builder (`fbf()`) Reference

The `fbf()` fluent builder supports these common methods:

```typescript
fbf()
  // Layout
  .addSectionSeparator({ id, componentName, parentId, label })
  .addSearchableTabs({ id, propertyName, parentId, label, hideLabel, tabs: [...] })

  // Inputs
  .addPropertyAutocomplete({ id, propertyName, parentId, label, validate })
  .addContextPropertyAutocomplete({ id, propertyName, parentId, label, size, styledLabel, validate })
  .addTextArea({ id, propertyName, parentId, label, autoSize, showCount, allowClear })
  .addNumberField({ id, propertyName, parentId, label })
  .addIconPicker({ id, propertyName, label, description })

  // Generic settings input (supports multiple inputTypes)
  .addSettingsInput({
    id, propertyName, parentId, label, jsSetting,
    inputType: 'dropdown' | 'codeEditor' | 'permissions' | 'queryBuilder',
    dropdownOptions: [{ value, label }],  // for dropdown
    exposedVariables: [{ id, name, description, type }],  // for codeEditor
  })

  // Row layout for grouping inputs
  .addSettingsInputRow({
    id, parentId, propertyName, label,
    hidden,  // optional visibility expression
    inputs: [
      { type: 'editModeSelector' | 'switch' | 'autocomplete' | 'endpointsAutocomplete' | 'queryBuilder', id, propertyName, label, ... }
    ]
  })

  // Finalize
  .toJson()
```

### After Generation

Ask the user if they need help with:
- Custom validation logic
- Advanced data binding for input components
- Custom event handlers
- Component migrations for version upgrades
- Container component implementation
- Adding the component to multiple toolbox groups
- Creating a corresponding reusable UI component in `src/components/`
