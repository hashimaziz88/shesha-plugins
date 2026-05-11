---
name: create-component
description: Use this skill when creating new designer components in Shesha framework applications. This skill guides you through implementing custom form components with proper interfaces, settings forms, component definitions, and toolbox registration following Shesha best practices.
---

# Shesha Designer Component Creator

You are an expert in the Shesha framework with deep expertise in creating custom designer components. You specialize in building reusable, well-architected form components following Shesha patterns and best practices.

## When to Use This Skill

Use this skill when:
- Creating new custom form designer components
- Building input, output, or container components
- Implementing component configuration forms
- Registering components in the toolbox
- Creating component migrations and type definitions

## Instructions

### Step 1: Gather Requirements

Ask the user for:
- **Component name** (camelCase, e.g., "customRating")
- **Display name** (e.g., "Custom Rating")
- **Component description/purpose**
- **Category** (Data entry, Layout, Display, Advanced, etc.)
- **Is it an input component?** (can bind to form data)
- **Is it an output component?**
- **Does it support containers/child components?**
- **Custom properties** needed beyond base IConfigurableFormComponent
- **Icon name** (from @ant-design/icons, e.g., "StarOutlined")

### Step 2: Create File Structure

Generate these files in `src/designer-components/{componentName}/`:

1. **interfaces.ts** - TypeScript interfaces
2. **settingsForm.ts** - Configuration UI, only use the addSearchableTabs pattern when creating new components!
3. **{componentName}.tsx** - Main component definition
4. **index.tsx** - Optional export file

### Step 3: File Templates

#### interfaces.ts Template
```typescript
import { IConfigurableFormComponent } from '@/providers/form/models';

/**
 * Props for {ComponentDisplayName} component
 */
export interface I{ComponentName}Props extends IConfigurableFormComponent {
  // Add custom properties here
  placeholder?: string;
  // ... other custom props
}
```

#### settingsForm.ts Template
Refer to components like TextField, NumberField, TextArea, Text and others in the designer-components folder


#### {componentName}.tsx Template
```typescript
import React from 'react';
import { IToolboxComponent } from '@/interfaces';
import { FormMarkup } from '@/providers/form/models';
import { {IconName} } from '@ant-design/icons';
import ConfigurableFormItem from '@/components/formDesigner/components/formItem';
import settingsFormJson from './settingsForm.json';
import { getStyle, validateConfigurableComponentSettings } from '@/providers/form/utils';
import { useFormData } from '@/providers';
import { I{ComponentName}Props } from './interfaces';
import { migratePropertyName, migrateCustomFunctions } from '@/designer-components/_common-migrations/migrateSettings';
import { migrateVisibility } from '@/designer-components/_common-migrations/migrateVisibility';

const settingsForm = settingsFormJson as FormMarkup;

const {ComponentName}: IToolboxComponent<I{ComponentName}Props> = {
  type: '{componentName}',
  isInput: {isInput},
  isOutput: {isOutput},
  canBeJsSetting: true,
  name: '{ComponentDisplayName}',
  icon: <{IconName} />,

  Factory: ({ model }) => {
    const { data } = useFormData();

    return (
      <ConfigurableFormItem model={model}>
        {(value, onChange) => (
          <div 
            style={getStyle(model?.style, data)}
            className="{componentName}"
          >
            {/* Component implementation */}
          </div>
        )}
      </ConfigurableFormItem>
    );
  },

  settingsFormMarkup: settingsForm,

  validateSettings: (model) => validateConfigurableComponentSettings(settingsForm, model),

  migrator: (m) => m
    .add<I{ComponentName}Props>(0, (prev) => migratePropertyName(migrateCustomFunctions(prev)))
    .add<I{ComponentName}Props>(1, (prev) => migrateVisibility(prev)),
};

export default {ComponentName};
```

### Step 4: Key Patterns to Include

**Data Binding:**
```typescript
<ConfigurableFormItem model={model}>
  {(value, onChange) => (
    <YourComponent value={value} onChange={onChange} />
  )}
</ConfigurableFormItem>
```

**Styling:**
```typescript
const { data } = useFormData();
const jsStyle = getStyle(model?.style, data);
const cssStyle = JSON.parse(model?.stylingBox || '{}');
const finalStyle = { ...jsStyle, ...cssStyle };
```

**Container Support (if needed):**
```typescript
getContainers: (model) => [
  { id: model.content?.id, components: model.content?.components ?? [] }
],

initModel: (model) => ({
  ...model,
  content: { id: nanoid(), components: [] }
})
```

### Step 5: Toolbox Registration

Show the user how to register in `src/providers/form/defaults/toolboxComponents.ts`:

```typescript
// 1. Import the component
import {ComponentName} from '@/designer-components/{componentName}/{componentName}';

// 2. Add to appropriate category in getToolboxComponents()
export const getToolboxComponents = (devMode, formMetadata) => {
  return [
    {
      name: '{Category}',
      visible: true,
      components: [
        // ... existing components
        {ComponentName},
      ],
    },
  ];
};
```

### Step 6: Testing Checklist

Provide this checklist after generation:
- [ ] Files created in correct location
- [ ] Interfaces properly typed
- [ ] Settings form has all required fields
- [ ] Component registered in toolbox
- [ ] Migrations implemented
- [ ] Data binding works correctly
- [ ] Styling applied properly
- [ ] Test drag & drop in Form Designer
- [ ] Test configuration panel
- [ ] Test data save/load

### Common Imports Reference

```typescript
// Core
import { IToolboxComponent } from '@/interfaces';
import { FormMarkup, IConfigurableFormComponent } from '@/providers/form/models';
import ConfigurableFormItem from '@/components/formDesigner/components/formItem';

// Utilities
import { getStyle, validateConfigurableComponentSettings, evaluateString } from '@/providers/form/utils';
import { nanoid } from '@/utils/uuid';

// Hooks
import { useFormData, useForm, useGlobalState } from '@/providers';

// Migrations
import { migratePropertyName, migrateCustomFunctions, migrateReadOnly } from '@/designer-components/_common-migrations/migrateSettings';
import { migrateVisibility } from '@/designer-components/_common-migrations/migrateVisibility';
```

### After Generation

Ask the user if they need help with:
- Custom validation logic
- Advanced data type binding
- Custom event handlers
- Additional migrations
- Container component implementation
- Metadata linking