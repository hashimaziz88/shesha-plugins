// A hand-written mirror-kit spec, used as the Phase 3/4 fixture and golden-snapshot source.
//
// This is what a model writes and LOOKS AT. Note what is absent: no hex values, no px font
// sizes, no style prop, no className, no desktop.* paths, no raw div. Appearance is
// emphasis/surface/role/density and nothing else, so switching --theme cannot change
// structure — only the resolved token values.
//
// Every `bind` is a REAL property of boxfusion.test...Astronaut. Metadata returns them
// PascalCase (FullName, SpecialisationRole); the compiler camelCases them, because Shesha
// camelCases the query but the cell accessor reads the literal propertyName — so a
// PascalCase column fetches rows with a correct pager count and renders every cell blank
// [R-004].
import {
  Page,
  PageHeader,
  KeyInfoBar,
  StatCard,
  Card,
  Row,
  ButtonGroup,
  Button,
  DataTable,
  Column,
  StatusPill,
  MicroLabel,
} from '@shesha-mirror/kit';

export default function AstronautWorklist() {
  return (
    <Page archetype="table-worklist" entity="boxfusion.test.Domain.Domain.Astronauts.Astronaut">
      <PageHeader
        title="Astronauts"
        subtitle="Everyone currently on the roster, with their specialisation and flight experience."
      />

      <KeyInfoBar>
        <StatCard label="Total crew" value="128" caption="across 9 missions" />
        <StatCard label="Zero-g cleared" value="94" caption="training complete" emphasis="success" />
        <StatCard label="In training" value="26" caption="not yet cleared" emphasis="warning" />
        <StatCard label="Grounded" value="8" caption="medical or disciplinary" emphasis="danger" />
      </KeyInfoBar>

      <Card title="Crew register" meta="128 records">
        <Row justify="end">
          <ButtonGroup>
            <Button action="refresh">Refresh</Button>
            <Button action="add" variant="primary">
              New astronaut
            </Button>
          </ButtonGroup>
        </Row>

        <MicroLabel>Active roster</MicroLabel>

        <DataTable bind="astronauts">
          <Column bind="FullName" caption="Name" width="fill" />
          <Column bind="Nationality" caption="Nationality" width="160px" />
          <Column bind="YearsOfSpaceExperience" caption="Experience" width="130px" align="right" numeric />
          <Column bind="DateOfBirth" caption="Date of birth" width="150px" />
          <Column bind="SpecialisationRole" caption="Specialisation" width="180px">
            <StatusPill bind="SpecialisationRole" />
          </Column>
        </DataTable>
      </Card>
    </Page>
  );
}
