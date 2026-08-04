// A hand-written mirror-kit spec, used as the Phase 3 fixture.
//
// This is what a model writes and LOOKS AT. Note what is absent: no hex values, no px font
// sizes, no style prop, no className, no desktop.* paths, no raw div. Appearance is
// emphasis/surface/role/density and nothing else, so switching --theme cannot change
// structure — only the resolved token values.
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

export default function AssetWorklist() {
  return (
    <Page archetype="table-worklist" entity="boxfusion.test.Domain.Domain.Astronauts.Astronaut">
      <PageHeader
        title="Astronauts"
        subtitle="Everyone currently assigned to a mission, with their specialisation and readiness."
      />

      <KeyInfoBar>
        <StatCard label="Total crew" value="128" caption="across 9 missions" />
        <StatCard label="Mission ready" value="94" caption="cleared in the last 30 days" emphasis="success" />
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

        <DataTable bind="astronauts" entity="boxfusion.test.Domain.Domain.Astronauts.Astronaut">
          <Column bind="astronautNumber" caption="Number" width="140px" />
          <Column bind="fullName" caption="Name" width="fill" />
          <Column bind="specialisationRole" caption="Specialisation" width="fill" />
          <Column bind="missionCount" caption="Missions" width="110px" align="right" numeric />
          <Column bind="status" caption="Status" width="130px">
            <StatusPill bind="status" />
          </Column>
        </DataTable>
      </Card>
    </Page>
  );
}
