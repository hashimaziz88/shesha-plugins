# Defect register (0.46 vs phase2)

Status: **fixed** (rule rolled out, verified), **pilot** (rule on named forms, awaiting owner check), **open** (confirmed,
no rule yet), **verify** (seen in a sweep, not yet confirmed on a healthy backend), **data** (record differs between
databases, not a defect), **legacy** (the same on phase2: configuration or code that predates the upgrade, no 0.46
rule), **framework** (needs a core fix; workaround noted). Rule names refer to
[rules.md](rules.md); `H<n>` to the plugin's render hazards.

## Layout and spacing

| Defect | Where | Cause | Rule | Status |
|---|---|---|---|---|
| Blank 32px bands (hidden/empty containers) | fleet | container default min height (H22) | `layout` | fixed |
| Fields inset by gutter/2, columns misaligned | fleet | columns row margin forced to 0 (H16) | `layout` (left margin) | fixed |
| Field rows 35px, long columns drift | fleet | label column padding-bottom 3px (H21) | `layout` (margin -3) | fixed |
| Multi-line labels overlap the next row | Client Info + every form with long questions | label height fixed at 32px (H20) | `split_labels.py` | pilot (Client Info); fleet needs the measured label list |
| Multi-line required label overflows its single-line label | electronic-approval-config-details ("Approval Request Expiry Period In Hrs") | label height fixed at 32px (H20); `split_labels.py` skips required fields (the red mark would be lost) | - | open (2026-10-03): shorter label text (BA decision) or a core fix |
| Empty-label buttons push a column down | Client Info | legacy buttons with code label `null` (H26) | `hide_empty_buttons.py` | pilot; no other form has them |
| "This field is required" blocks step columns 6px | opportunity-loan-application | text ignores visibility (H19) | `hints` | fixed |
| Legal tab "Not captured" boxes collapsed, headings overlap, inner scrollbars | opportunity-loan-legal-review (and 37 other forms) | the activated `legalReviewStyle` carrier's 0.43-era form-item rules hit the read boxes (0.46 wraps htmlRender in a form item) | one-off CSS scoping (rules.md) | fixed 2026-10-03, verified 74px |
| No gap under the tab bar (p2 16px) | details pages with tabs | 0.46 tabs nav margin 0 (H24) | `tabgap` | fixed (fleet) |
| Panel headers 52-56px, 8px padding (p2 50px, padding 5/0/0/10, transparent, weight 500) | panels still on the default padding | panel migration default `headerStyles` (H30) | `panels` | applied to the 2 forms that had the default; check |

## Status tags and reference-list values

| Defect | Where | Cause | Rule | Status |
|---|---|---|---|---|
| Status tag next to the opportunity name shows, then disappears | LBOpportunity-details (+ chevron) `loanApplication.status` | the loan-application subform (api, explicit properties without `status`) overwrites the host's `loanApplication` (H28) | `subfetch` | fixed 2026-10-02 (stays visible) |
| Ref-list tag columns render grey skeleton chips | lbService-requests, LbCrm-task-table (Priority), Accounts (Industry), table pages (Lead Source, Type, Contact; 2026-10-03) | null values render a skeleton box - the same on phase2 (Accounts Industry); lists load fine | - | data / legacy (no fix) - spot-check per page |
| Ref-list text cells blank | LBTerritory-table (Territory Type), excel-model-config Cell Mappings (Direction) | as above or binding | - | verify |
| Hidden refListStatus inside hosted forms throws | hosted forms | framework bug (H13) | `rlshidden` | fixed |
| Empty grey chip beside a name | LBContact-details `leadSource`, LBAccount-details (2 boxes) | 0.46 renders a box for a status tag with no value | `tagnull` | fixed (fleet, 65 forms) |
| Solid grey tag in table cells where p2 was outlined (WEBINAR) | LBCampaign | 0.46 solid badge falls back to grey for colourless items | - | open (low) |

## Tables

| Defect | Where | Cause | Rule | Status |
|---|---|---|---|---|
| Toolbar crammed: icons and count touch | table pages | partial device blocks give the toolbar row gap 0 (H29) | `rowgap` | pilot (LBAccount-table) |
| `VIEW: <name>` chip replaces the plain table title | table pages | 0.46 tableViewSelector always renders the chip; no setting; hiding it risks dropping the view filter | - | 0.46 design (accepted) |
| Title overlaps the search row (farming-type-table, LBTerritory-table) | 7 table pages | `sha-index-table-control` class forces a nowrap flex row on 0.46 | `tablectl` | pilot |
| Nested tab tables: pager stacked, full-width page-size select, "1-10 of 100" on an empty list, `+` missing | Tasks tabs (Account, Lead, Contact, Campaign) | pager defaults / list not loaded | - | verify then open |
| Rows 44-56px (p2 38-45), bolder headers, truncated captions | tables | datatable migrations v12-v31 (H17) | datatable migrated model (version 31, striped/hover off, row 39) | open (proven by interception, not rolled out) |
| Header white + 600 | all tables | theme | Default UI theme setting | fixed |
| Opportunity > Client verification consent approvals table empty (`Entities/GetAll` 400 "The binary operator AndAlso is not defined for the types 'System.Boolean' and 'System.Object'"; phase2 shows 1 row) | opportunity-loan-application, send-back-opportunity-loan-application | `and` filter `{"and":[{...},null]}`: the optional fallback item (`partOf == {{data.model.x.id}}`) is kept as `undefined` -> `null` when it does not resolve (H34) | `optfilter` | fixed 2026-10-03 (2 forms, 50 conditions; local request = phase2 request, 200, 1 row) |
| Opportunity table rows faded "Loading..." for ~20-40 s, then correct | Opportunity table | local dev server speed only | - | not a defect |

## Other

| Defect | Where | Cause | Status |
|---|---|---|---|
| Lead Owner card shows nothing (p2 "unknown") | LBLead-details | value/fallback expression | open |
| Excel Workbook field empty, console "Failed to fetch file info: Cannot read properties of null (reading 'id')" | excel-model-config-details | file component on 0.46 | open (functional) |
| Page title small / Name required mark missing | excel-model-config-details | text preset / required mark | open |
| Case request details renders a different form from p2 (no tabs or action buttons); CaseAutomation 404, CaseType 400 | Boxfusion.ServiceManagement case-request-details | module form/version difference | open (functional, module) |
| Contact > linked applications 500: `dbo.Frwk_GetRefListItem` dropped by the 0.46 framework | LBContact-details | stored procedure `LB_GetContactLinkedApplications` | fixed (migration M20261002213000, verified after the backend restart: texts filled) |
| Sidebar entries Users / Create Questionnaire / Credit Committee present on p2 menu, absent on some local pages | navigation | menu items / permissions | verify |
| Pages showing "500 Network Error", stuck loading, blank body | many | captured while the local backend or dev server restarted | recapture |
| Credit Committee pages fail: `Metadata/Get` 404, `Entities/GetAll` 500 "Entity ... CreditCommitteeMeeting not found" | Credit Committee pages (local 0.46 backend) | not a form defect: the backend branch was cut from sprint/iteration-7 earlier and is 99 commits behind it (Credit Committee, DE scorecard, participant dialog / OTP fixes); being merged locally on `users/hashim/fixes/shesha-046-iteration-7-merge` (not pushed) | open (2026-10-03; release blocker for the backend deploy) |
| loan-application-table-mvp: 400 "Cannot query field 'signatory' on type 'LBOrganization'" | loan-application-table-mvp | the table asks for a field `LBOrganization` no longer has; same on phase2 | legacy |
| lbTerritory-details: 404 for reference list `Shesha.Crm/Boxfusion.Dep.ContactFlags` | lbTerritory-details | the referenced list does not resolve; same on phase2 | legacy |
| electronic-approval-set-details: lookup of a loan application that does not exist (404/400) | electronic-approval-set-details | the record points at a missing loan application; same on phase2 | data |
| Save 400 "Entity ... not found for owner/target" | LBTask-details, record c9aa8150... | the task's owner opportunity no longer resolves (the record also fails to load on phase2); Save works on a task with a valid owner (11efdc94...) | data |
| Tasks tab subform missing | LBOpportunity-details | the subForm points at `Shesha.Enterprise/dynamic-task-subform`, which exists on neither local nor phase2 | legacy |
| Tasks tab subform missing - **SUPERSEDED 2026-10-04** | LBOpportunity-details, LBOpportunity-details-chevron, loan-application-wf-send-back | the 'neither local nor phase2' finding above was WRONG: phase2 has `Shesha.Enterprise/dynamic-task-subform` v2 (read via `FormConfiguration/GetByName`; the earlier check used the 0.46-only `GetCurrent`). 0.46 does not ship it (absent locally and on the deployed 0.46 env): UPGRADE, H45 | `formref` | fixed (tab renders); the list does not fetch - H46 |
| Script error "Cannot read properties of undefined (reading 'formMode')" | electronic-approval-config-details | script reads `formMode` of an undefined object; same on phase2 | legacy |


## Found by the BA test-plan run on localhost (2026-10-03)

| Defect | Where | Cause | Rule | Status |
|---|---|---|---|---|
| Add New Lead Save stays enabled with an upload switch on (phase2 disables it until Upload); same for compliance Send Back / De-escalate / Sign-off and Add Loan Purpose(s) | LBLead-table and 4 dialogs | H35 custom footer button scripts never evaluated | `dialogfooter` (moved into the dialog form) | fixed, proven |
| Save Director / Save Loan Purpose look enabled before their conditions are met | participant (59 dialogs) and loan-purpose (4) shared dialog forms | H35 | `dialogfooter` guard (blocks the save with a warning) | partly fixed: visual state needs a framework fix |
| Documents tab: Document column shows numbers | loan-application-documents-subform, opportunity-loan-legal-documents, credit-committee-send-to-committee | H36 | `url_reflist_columns` | fixed |
| Searchable dropdowns (country lists) find nothing when typing | every reference-list dropdown with numeric values | H37 framework: filter by value | - | open: framework fix (no configuration lever) |
| Province / entity autocomplete options unsorted | 21 forms, 47 autocompletes | H38 | `acsort` | fixed |
| Opportunity Edit left Client Info disabled; Initiate enabled in edit | opportunity forms + 26 more | H15 | `editmode` | fixed (supersedes the earlier 'same on phase2' note) |
| Lead conversion 500 (Excel templates missing) | merged backend file store | environment | blobs copied | fixed (local) |
| Credit Committee status chips blank (statuses 21-23) | reference list LoanApplicationStatus | DATA: soft-deleted on phase2 2026-09-30, restored there after the local DB copy | rows restored locally (batch29) | fixed (local data) |

## Functional checks (2026-10-03, local backend on a copy of the phase2 database)

| Check | Result |
|---|---|
| Lead details: Edit -> change Description -> Save -> API | saved (`LBLead/Crud/Update`), restored exactly |
| Opportunity details: Edit makes the page form editable (Opportunity Owner) | works |
| Opportunity details: Edit does not make the Client Info subform editable (inputs render disabled) | **SUPERSEDED 2026-10-03** - the earlier note here ("same outcome on phase2, not a 0.46 regression") was WRONG. Re-checked side by side on a DRAFT entity opportunity: phase2 makes Client Info editable after Edit and disables Initiate Loan Application; 0.46 left every field disabled and Initiate enabled. Cause H15 (tab `editMode` script returns `'edit'`, which 0.46 renders disabled; a read-only button is not disabled on 0.46). Fixed by rule `editmode` (27 forms + ServiceManagement case-request-details); verified both states. This was the whiteboard item "Edit not pushing subform to edit mode". |
| Contact > linked applications (`LBContact/GetLinkedApplications`) | fixed by migration M20261002213000 (texts filled) |
| Term limits GetAll, approval configs GetAll | 200 after the two backend fixes |
| Lead Owner card on a lead owned by "System Administrator" | blank on 0.46, "unknown" on phase2 - lookup edge case on both |
| Electronic approval config: Module / Approval Initiation Form blank | approval config details + create, file-template-configuration-table | 0.43 framework entity type names | `types` | fixed, values shown |
| Opportunity Save -> 400 "`Opportunity` is not allowed to be updated" | LBOpportunity-details | subform write-back carries `loanApplication.opportunity` | one-off `onPrepareSubmitData` strip | fixed, Save 200 |
| Contact / Account edit + save | LBContact-details, LBAccount-details | - | - | work (Crud/Update 200; Account value round-trip verified and restored) |
| Functional suite F01-F12 (local) | all pass. F06 (task Save) re-run on a task with a valid owner (11efdc94...); F05 and F08 first failed only because the test matched the wrong entity name (test error, not a defect) |

## Open after the final assessment (2026-10-03)

- Panel headers still 52px / 8px on panels stored below v9 (the migration rewrites their headerStyles at load; a fix needs the full migrated model): Opportunity, approval config, lb-user-details, Contact.
- Required asterisks missing on lb-user-details and electronic-approval-config-details.
- Due Diligence property tables: captions truncated mid-word; lbService-requests cells truncated (datatable column widths, H17).
- Opportunity table Amount blank where phase2 shows 0; filter icon raised.
- Release blocker: the local 0.46 backend branch is 99 commits behind sprint/iteration-7 (Credit Committee pages fail, see Other); merge before the backend deploy.
- electronic-approval-config-details: required label "Approval Request Expiry Period In Hrs" overflows (H20); needs a BA label decision or a core fix.
- 19 forms had their legacy htmlRender CSS carriers activated by the `carriers` rule, so their 0.43-era CSS now applies (H31). Legal was the one that broke; check the others' pages when touched.
| Add Loan Purpose saved nothing ('requestedAmount not found') | opportunity-loan-application and 27 action scripts | H39 | `payload` | fixed |
| Opportunity > Documents tables empty (empty id on first fetch) | 45 URL contexts | H40 | `urlwait` | fixed |
| Save rejected: read-only property (totalInsurance, grantToLoanRatio) | 102 forms | H42 | `readonly_strip.py` | fixed |
| Related Party Documents never fetch; initiation blocked for entities with parties | loan-application-documents-subform, opportunity-loan-legal-documents | H43 | `urlfilter.py` | fixed |
| Loan Info 'Total loan Amount' R 0 | LBOpportunity-details (+28 forms with the same after-load pattern) | H44 | `afterload` | fixed |
| Opportunity / Lead / Account Tasks list never fetches (empty text, pager '1-10 of 100') | `LandBank.Crm/dynamic-task-subform` hosted by 12 forms | H46: subform filter expressions cannot see the host record. Phase2 shows ALL tasks unfiltered (LEGACY) | proven design: place the task list in the host (fetch fires with the host id) | open: owner decision (shared subform -> copies) or framework fix |
| Entity initiation 500 'Could not find file ...docx' | merged backend file store | ENV: approval document templates never copied | 15 template versions downloaded from phase2 (`fetch_approval_templates.py`) | fixed (local) |
| Initiated entity applications skip Upload Resolution / Consent / Verification user tasks | loan-application-workflow | TEST SETUP: the team collection comes from the opportunity owner (LBEmployee RM/CBA); test records are owned by System Administrator (not an LBEmployee) | set Opportunity Owner to an RM before initiating | not a defect; Inbox steps need an RM login |
| Participant type-8 Save script syntax error (`participantType: 8 partOf: partOf`) | application-participant-panels-revised | still in phase2 Live v7 | - | legacy |
| Phase2 forms changed after the local DB copy (10 forms) | LBLead-create/details, lead director/signatory create, LBApplication-director-create, opportunity-loan-application, financialAnalysis, risk assessment, securities-properties, de-scorecard | DATA drift | 3-way merge (`drift_merge.py`, verified `drift_verify.py`) | merged locally |
| Document row stays 'Not Uploaded' after Manage File Versions > OK (refresh through globalState is dead) | loan-application-documents-subform, participant-document-card, securities-properties-subform | H41 | `gsrefresh` | fixed (verified with a real upload); host-form refreshes in 5 verification/signatory lists open |
