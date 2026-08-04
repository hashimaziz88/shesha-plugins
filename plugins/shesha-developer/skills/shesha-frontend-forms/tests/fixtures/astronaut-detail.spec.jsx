// The record-detail archetype fixture (Phase 10).
//
// The anatomy's shape for this archetype is PageHeader -> KeyFactsStrip -> Tabs>Card: "band with
// back-link, H1 plus up to three pills, mono identifier, key-facts strip, then tabs over
// two-column label|value rows".
//
// NOT IMPLEMENTED, deliberately and recorded: the band-level BACK-LINK. It needs a Navigate action
// wired from a header affordance, and the exit path is already served by the `back` button in the
// ActionRow. Half-implementing it would have meant a prop that looks like navigation and is not.
//
// Every `bind` is a REAL property of boxfusion.test...Astronaut, camelCased for the reason R-004
// exists: Shesha camelCases the query while the cell accessor reads the literal propertyName, so a
// PascalCase binding renders blank with a correct-looking record count.
//
// As with the worklist spec: no hex, no px, no style prop, no className, no desktop.* paths. Note
// also what the KIT refuses — writing <Button label="save"> or <Tab label="Profile"> fails at
// preview with the allowed list, which is how the vocabulary stays honest.
import {
  Page,
  PageHeader,
  KeyFactsStrip,
  Fact,
  Tabs,
  Tab,
  Card,
  Field,
  DatePicker,
  NumberField,
  SectionLabel,
  StatusPill,
  Select,
  ActionRow,
  ButtonGroup,
  Button,
  ValidationSummary,
} from '@shesha-mirror/kit';

export default function AstronautDetail() {
  return (
    <Page archetype="record-detail" entity="boxfusion.test.Domain.Domain.Astronauts.Astronaut">
      <PageHeader
        title="Neil Harrow"
        subtitle="Mission specialist, cleared for extra-vehicular activity"
        identifier="AST-000481"
      >
        <StatusPill bind="specialisationRole" />
      </PageHeader>

      <KeyFactsStrip>
        <Fact label="Specialisation" bind="specialisationRole" />
        <Fact label="Nationality" bind="nationality" />
        <Fact label="Experience" bind="yearsOfSpaceExperience" />
        <Fact label="Date of birth" bind="dateOfBirth" />
      </KeyFactsStrip>

      <ValidationSummary />

      <Tabs>
        <Tab title="Profile">
          <Card title="Identity">
            <SectionLabel>Personal</SectionLabel>
            <Field bind="fullName" label="Full name" />
            <DatePicker bind="dateOfBirth" label="Date of birth" />
            <Field bind="nationality" label="Nationality" />
          </Card>
          <Card title="Flight record">
            <NumberField bind="yearsOfSpaceExperience" label="Years of experience" />
            <Select bind="specialisationRole" label="Specialisation" />
          </Card>
        </Tab>
        <Tab title="Notes">
          <Card title="Remarks">
            <Field bind="fullName" label="Recorded by" readOnly />
          </Card>
        </Tab>
      </Tabs>

      <ActionRow justify="end">
        <ButtonGroup>
          <Button action="back">Back</Button>
          <Button action="save" variant="primary">
            Save
          </Button>
        </ButtonGroup>
      </ActionRow>
    </Page>
  );
}
