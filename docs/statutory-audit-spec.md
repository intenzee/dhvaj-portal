<!--
  VERBATIM source specification, extracted from
  DHVAJ_Statutory_Audit_Service_Workflow_Web_Developer_Specification_v1.0.docx
  (Version 1.0, 18 September 2026). This is the reference contract for the SA-*
  build phases. Do not edit the requirements here; capture build decisions in
  ADRs and the README status blocks instead.
-->

# DHVAJ — Statutory Audit Service Workflow (Web Developer + UX/UI Spec v1.0)

DHVAJ & ASSOCIATES
STATUTORY AUDIT SERVICE WORKFLOW
Web Developer + UX/UI Functional Specification
Version 1.0 | 18 September 2026
Build blueprint for the experience that begins when Statutory Audit is added to an engagement and continues through framework, planning, risk, fieldwork, review, completion, reporting, sign-off and archive.

1. Purpose and Design Philosophy
The existing DHVAJ Portal shell is retained. This specification defines the professional Statutory Audit service experience that sits inside it. The product must feel like a digital audit file and professional practice management system, not a generic task manager.
Framework determines WHAT applies; Planning determines HOW DHVAJ will audit it.
Work is the digital audit file.
Audit Area, Workpaper, Procedure and Evidence are separate objects.
Do the work once; use the evidence many times.
Financial Statements are generally one integrated Excel workbook.
PBC is the client information-request layer, not the audit workpaper.
Detailed work is generated progressively after applicability and planning.
Historical professional records must never be silently overwritten.
2. Existing Portal Shell – Keep and Improve
Existing element
Decision
Dark global left navigation
Retain
Top search/header
Retain
Engagement header/status bar
Retain; make actions context-sensitive
Overview
Retain; convert to engagement-health dashboard
Services
Retain; make service/workflow control centre
Work
Major redesign into digital audit file
Compliance
Retain for statutory and material internal deadlines
Documents
Remove as separate engagement tab; documents live in Work
Team
Retain; combine team, responsibility, workload and time
Time
Remove as separate engagement tab
Activity
Retain as immutable engagement history
Invoices
Retain
Notes
Retain for engagement notes; formal review notes stay in Review/Work
Review
Add as engagement tab
3. Global Application Layout
┌───────────────────────────────────────────────────────────────────────┐│ DHVAJ | Global Search | Notifications | Help | User / Role           │├──────────────────┬────────────────────────────────────────────────────┤│ GLOBAL LEFT NAV  │ ENGAGEMENT HEADER                                 ││ Home             │ ENG00008 · Coastal Exports Pvt Ltd                ││ My Work          │ Statutory Audit · FY 2025-26 · NORTH             ││ Notifications    │ Status + context-sensitive actions                ││ Engagements      ├────────────────────────────────────────────────────┤│ Entities         │ Overview | Services | Work | Compliance | Team    ││ Services         │ Review | Activity | Invoices | Notes              ││ Client Depend.   ├────────────────────────────────────────────────────┤│ Tasks            │                    MAIN CONTENT                     ││ Reviews          │                                                    ││ Compliance       │                                                    ││ ...              │                                                    │├──────────────────┴────────────────────────────────────────────────────┤│ SHORTCUTS                                                             │└───────────────────────────────────────────────────────────────────────┘
Global navigation and engagement audit-file navigation are different layers.
The Work tab owns the audit-file tree.
Role-based visibility is enforced server-side, not merely by hiding menu items.
4. Final Engagement Tab Layout
Tab
What user sees
Overview
Health, progress, key dates, framework, materiality, risks, PBC, review and needs-attention
Services
Service configuration, workflow readiness, applicability/readiness
Work
Audit file phases, areas, workpapers, procedures, evidence, exceptions, conclusions
Compliance
Statutory obligations and material internal milestones
Team
EP, Manager, team, assignments, planned/actual hours, workload
Review
Pending reviews, review notes, exceptions, Partner review
Activity
Immutable event history
Invoices
Commercial information
Notes
General engagement notes
5. What Happens When Statutory Audit Is Added
Engagement   ↓Add Service   ↓Statutory Audit Service Configuration   ↓Create versioned Workflow Shell   ↓Audit Framework Shell   ↓Applicability Assessment   ↓Approved Framework   ↓Planning   ↓Risk Assessment   ↓Dynamic Work Generation   ↓Fieldwork → Review → Completion → Reporting → Sign-off → Archive
At service selection, create the workflow shell but do not create hundreds of detailed procedures. Detailed work is activated only when framework, planning and risk information supports it.
6. Add Statutory Audit – Screen
ADD SERVICE────────────────────────────────────────Service Line       [ Audit & Assurance ▼ ]Service             [ Statutory Audit     ]Service Period      [ 01-Apr-2025 ] → [ 31-Mar-2026 ]Entities            [ Coastal Exports Pvt Ltd ]Engagement Partner  [ Managing Partner ▼ ]Manager             [ Manager X ▼ ][ Cancel ]                         [ Add Service ]
Field
Control
Rule
Service Line
Dropdown
Configuration-driven
Service
Dropdown/search
Statutory Audit
Service Period
Date range
Must fit engagement period
Entities
Entity/group picker
Group-aware
EP
People picker
Partner role only
Manager
People picker
Manager/Senior according to configuration
On Add Service: create service instance, workflow shell, Phase 02 shell, readiness records and audit event. Show 'Start Audit Framework' as the next action.
7. Services Tab – Service Control Centre
SERVICES                                      [ + Add Service ]SERVICE         OFFICE      LEAD             STATUS      WORKFLOWStatutory Audit NORTH       Managing Partner Active      Framework RequiredSTATUTORY AUDITStatus: Active | Workflow: Statutory Audit v1.xREADINESSAcceptance ✓ | Framework ● | Planning ○ | Risk 🔒 | Work 🔒 | Sign-off 🔒SCOPE & CONFIGURATIONEntities | Period | Reporting | Review Model | First-year / Continuing[ Open Workflow ] [ Edit Configuration ] [ View Methodology ]
Cancelled/retired historical components remain visible only where appropriate for history; they must not behave as active work.
Workflow/template version must be stored with the service instance.
8. Statutory Audit Workflow – Left Panel
STATUTORY AUDITCoastal Exports Pvt LtdFY 2025-2601  Engagement & Acceptance02  Audit Framework03  Planning04  Risk Assessment05  Internal Controls / IFC06  Audit Areas              ▸07  Completion08  Reporting09  Partner Sign-off10  Archiving✓ Complete   ● In Progress   ○ Not Started⚠ Needs Attention   🔒 Locked
The left panel is an expandable professional-file navigation tree. It is not a flat task list.
9. Audit Areas – Dynamic Navigation
06 Audit Areas ▾   Cash & Cash Equivalents   Bank & Reconciliation   Trade Receivables   Inventory   PPE   Intangibles   Investments   Loans & Advances   Trade Payables   Borrowings   Provisions   Revenue   Other Income   Employee Benefits   Expenses   Finance Costs   Taxation   Equity   Leases   Related Parties   Foreign Exchange   Estimates   Presentation & Disclosures
The system may activate, deactivate or add areas based on the approved framework, planning and risk assessment. A Manager may add a work area where authorised, with reason and audit trail.
10. Work Tab – Main Screen
WORK┌───────────────────────┬──────────────────────────────────────────────┐│ AUDIT FILE             │ AUDIT WORK                                  ││                       │ Progress  ████████░░ 72%                    ││ 01 Acceptance         │ Work items | Review | Overdue | Blocked     ││ 02 Framework          │                                              ││ 03 Planning           │ NEEDS ATTENTION                              ││ 04 Risk               │ • Review notes                              ││ 05 Controls           │ • PBC overdue                               ││ 06 Audit Areas ▾      │ • Missing evidence                          ││   Cash                │ • Unresolved exceptions                     ││   Receivables         │                                              ││   Inventory           │ AUDIT AREAS                                 ││   Revenue             │ Cash & Bank             80%                 ││   Payables            │ Receivables             65%                 ││   Borrowings          │ Inventory               40%                 ││ 07 Completion         │ Revenue                 90%                 ││ 08 Reporting          │ Borrowings              75%                 ││ 09 Sign-off           │                                              ││ 10 Archive            │                                              │└───────────────────────┴──────────────────────────────────────────────┘
Metric
Meaning
Work items
Material generated/activated work
Completed
Work completed
In Progress
Currently being worked
Awaiting Review
Ready for reviewer
Blocked
Dependency/evidence/decision blocking
Overdue
Internal due date passed
Needs Attention
Actionable professional issue
11. Audit Area Screen – Example: Trade Receivables
TRADE RECEIVABLESStatus In Progress | Risk High | Owner Senior A | Reviewer Manager XMateriality ₹ XX | Due 15-Oct-2026FINANCIAL DATATrade Receivables ₹ XX | Prior Year ₹ XX | Movement XX%Source: Financial Statements.xlsxPROCEDURES✓ Lead Schedule✓ Ageing Analysis● External Confirmations● Substantive Testing○ Cut-off Testing○ Provision / ECLEVIDENCE[Ageing.xlsx] [Confirmation responses] [Bank statements]REVIEW2 Review Notes | 1 ExceptionCONCLUSION[ Structured conclusion ........................................ ][ Save Draft ] [ Submit for Review ]
A single audit area contains multiple professional procedures/workpapers. It is not itself a task.
12. Workpaper and Procedure Model
AUDIT AREA   ↓OBJECTIVE / ASSERTION   ↓PROCEDURE   ↓EVIDENCE   ↓RESULT / EXCEPTION   ↓REVIEW   ↓CONCLUSION
Object
Purpose
Audit Area
Financial statement/business area being audited
Workpaper
Professional documentation of a material workstream
Procedure
Specific audit test/analysis performed
Evidence
Source supporting procedure/result
Exception
Deviation, error, unresolved matter or finding
Review Note
Reviewer comment requiring response/clearance
Conclusion
Documented professional result
13. Procedure Screen – Required Parameters
Field
UI
Required
Behaviour
Procedure ID
System read-only
Yes
Unique within engagement
Title
Text
Yes
Clear human-readable name
Objective
Long text
Yes
Why the procedure is performed
Audit area
Reference/multi-link
Yes
May support connected areas
Assertion
Multi-select
Yes
Existence, completeness, rights, valuation, cut-off, classification, presentation/disclosure, occurrence
Risk
Reference
Conditional
Required where risk response
Population
Structured/text
Conditional
For testing procedures
Sampling method
Configuration
Conditional
No universal sample size
Sample size
Numeric
Conditional
Methodology/professional judgement
Owner
People picker
Yes
Preparer
Reviewer
People picker
Yes
Detailed reviewer
Due date
Date
Yes
Internal deadline
Expected evidence
Long text
Yes
Evidence expected
Conclusion
Long text
Before completion
Required for completion
Actions: Open, Edit, Assign, Change Due Date, Link Existing Procedure, Add Procedure, Link Evidence, Record Exception, Submit Review, Return, Complete.
14. Cross-Referencing and Reuse
LOAN INTEREST RECALCULATIONLinked areas:  → Borrowings  → Finance Costs  → Related Parties (where applicable)[ Link Existing Procedure ] [ Add Additional Procedure ]
The linked procedure remains one source record. Evidence is not duplicated merely because it supports multiple areas. The UI must clearly show all linked areas.
15. Financial Statements – Master Workbook
Financial Statements.xlsx├── Trial Balance├── Balance Sheet├── Profit & Loss├── Cash Flow├── Notes├── Accounting Policies├── Supporting Schedules└── Linked sheets
Open the workbook through Microsoft 365/SharePoint integration.
Do not build a custom Excel editor.
Store provider item ID, current version/reference, status and links in DHVAJ metadata.
Allow workpapers to reference selected financial statement information without duplicating the source workbook.
Preserve historical versions.
16. PBC – Master Client Information Tracker
PBC MASTERID       REQUIREMENT        CLIENT OWNER   STATUS       DUE       LINKED WORKPBC-001  Trial Balance      Finance        Received     10-Sep    Financial StatementsPBC-002  Debtor Ageing      Finance        Received     12-Sep    Trade ReceivablesPBC-003  Creditor Ageing    Finance        Pending      12-Sep    Trade PayablesPBC-004  Bank Statements    Finance        Partial      12-Sep    Cash & BankPBC-005  Loan Schedule      Treasury       Received     15-Sep    Borrowings
Status
Meaning
Requested
Request issued
Received
Client supplied information
Under Review
Team assessing
Accepted
Evidence accepted
Rejected
Not usable; reason required
Clarification Required
Further response required
Closed
Request resolved/dispositioned
When a PBC file is received, DHVAJ should automatically surface it in the linked work area. The same file must not be uploaded again simply to make it visible there.
17. Microsoft Document Layer
DHVAJ owns
Microsoft layer
Professional metadata
File storage
Workflow/status
Office editing
Review process
AutoSave
Evidence linkage
Version history
PBC metadata
Co-authoring
Permissions mapping
Document collaboration
Portal audit events
Provider file-change events
Map engagement authorization to document permissions.
Use Graph/webhook events where configured to detect document changes.
Do not build custom Word/Excel collaboration.
Do not create a duplicate local copy silently if provider access fails.
18. Audit Framework – Phase 02
02 AUDIT FRAMEWORK├── Entity & Regulatory Profile├── Applicable Financial Reporting Framework├── Ind AS / AS Assessment├── Schedule III Assessment├── CARO Applicability├── IFC Applicability├── Consolidation / CFS Applicability├── Internal Audit Applicability├── Cost Records / Cost Audit├── Secretarial Audit├── CSR / Governance Matters├── Rule 11 Reporting├── Section 143 Reporting├── SA Applicability / Consideration Matrix├── Other Regulatory / Industry Requirements├── Audit Reporting Framework└── Audit Framework Memo
The Framework screen should show Facts → System Assessment → Evidence → Professional Decision → Basis → Impact → Review → History.
19. Applicability State Model
State
Meaning
Not Assessed
No conclusion
Pending Information
Facts/evidence missing
System Suggested Applicable
Rule engine suggestion awaiting professional decision
System Suggested Not Applicable
Rule engine suggestion awaiting professional decision
Professional Judgement Required
System cannot safely decide
Applicable
Approved conclusion
Not Applicable
Approved conclusion
Overridden
Professional conclusion differs from configured result; reason required
Reassessment Required
Trigger changed
Approved
Assessment approved
20. Framework → Dynamic Work Generation
APPROVED FRAMEWORK      +APPROVED PLAN      +RISK ASSESSMENT      +METHODOLOGY VERSION      ↓APPLICABLE WORK AREAS      ↓WORKPAPERS      ↓PROCEDURES      ↓PBC / EVIDENCE LINKS      ↓REVIEW ASSIGNMENTS      ↓CALENDAR / MILESTONES
Framework result/trigger
Activation
CARO applicable
CARO 21-clause workstream
IFC applicable
Process understanding, RCM, walkthroughs, design/OE, deficiencies, conclusion
CFS applicable
Group structure, components, consolidation and CFS work
Ind AS applicable
Ind AS financial statement/disclosure review
AS framework
Applicable AS/Schedule III work
SA 600 relevant
Component planning/work
SA 510 relevant
Opening balances/initial audit
SA 402 relevant
Service organisation
SA 540 relevant
Estimates
SA 550 relevant
Related parties
SA 610 relevant
Internal auditor use
SA 620 relevant
Expert planning
SA 701 relevant
KAM workstream where applicable
Generation must be idempotent. Existing completed work is never silently deleted.
21. Planning – Phase 03
03 PLANNING├── Audit Strategy├── Preliminary Engagement Understanding├── Materiality├── Overall Audit Plan├── Audit Approach├── Audit Areas & Assertions├── Risk-to-Response Planning├── Audit Procedures / Audit Programme├── Team & Responsibility Allocation├── Specialist / Expert Planning├── Component / Branch Planning├── Use of Internal Audit Work├── PBC Strategy├── Timeline & Milestones├── Communication & Review Plan├── Significant Matters / Consultation Plan└── Planning Completion & Approval
Planning consumes approved framework outputs and determines audit strategy, materiality, risks, areas, responses, resources, PBC and timing. Approval unlocks detailed execution.
22. Risk Assessment – Phase 04
RISKRisk ID | Description | Source | FS Area | AssertionRisk Rating | Significant Risk? | Fraud Risk?Response | Linked Procedures | Owner | Reviewer | Status | Conclusion
Risk and procedure screens must provide two-way navigation: Risk → Response/Procedure and Procedure → Risk.
23. Overview Tab – Engagement Health
ENG00008 · Coastal Exports Pvt LtdStatutory Audit · FY 2025-26 · NORTHEP: Managing Partner | Manager: Manager XSTATUS: ActiveENGAGEMENT HEALTHFramework       APPROVEDPlanning        85%Risk            60%Fieldwork       42%Review          18%Completion      NOT STARTEDNEEDS ATTENTION⚠ 3 PBC overdue⚠ 2 review notes pending⚠ Revenue testing incomplete⚠ Partner consultation requiredKEY DATESPlanning | Interim | Final PBC | Manager Review | Partner Review | ReportKEY FRAMEWORKInd AS | Schedule III | CARO | IFC | CFS | SA 701
Each metric must link to its underlying screen.
Do not show 'On Track' where mandatory framework, planning or review requirements remain unresolved.
24. Team Tab – People + Workload + Time
TEAMEP        Managing PartnerManager   Manager XMEMBERSPerson       Role       Work Items   Planned Hrs   Actual Hrs   ReviewManager X    Manager       18            80           42        YesSenior A     Senior        12            65           38        YesArticle B    Article        8             45           29        NoClick a person → assigned areas, workpapers, procedures, reviews and time.
Actual time is aggregated from the time-entry mechanism. No separate engagement Time tab is required.
25. Review Tab – First-Class Review Control
REVIEWPending Manager Review   8Pending Partner Review   3Open Review Notes        5Overdue Reviews          1REVIEW QUEUEWorkpaper            Preparer    Reviewer     Status    DueRevenue Testing      Article B   Manager X    Ready     15-OctBank Confirmation    Senior A    Manager X    Ready     16-OctMateriality          Manager X   EP           Pending   10-Sep[ Open Review ] [ Record Note ] [ Return ] [ Clear ]
Review notes must retain author, timestamp, status, response and clearance history and link to the underlying workpaper/procedure/evidence.
26. Compliance Tab
Compliance is the deadline layer, not a duplicate task list.
Category
Examples
Statutory
Applicable filing/reporting dates
Internal milestone
Planning, Manager review, Partner review
Client commitment
PBC agreed date
Task deadline
Material work deadline
Review deadline
Detailed/secondary/Partner review
Event SLA
Time-bound response
Statutory dates are calculated by the versioned compliance engine. Internal deadlines remain separate.
27. Completion / Reporting / Sign-off / Archive
07 COMPLETIONSubsequent Events | Going Concern | Misstatements | Final AnalyticsFS Final Review | Disclosure Review | Completion Memo08 REPORTINGAuditor's Report | CARO | IFC | Rule 11 / Section 143Other Reports / Certificates09 PARTNER SIGN-OFFOpen Matters | Review Notes | Significant Matters | ConsultationFinal FS | Reports | Sign-off | Release10 ARCHIVINGFile Completeness | Evidence | Review CompletionFinal Versions | Archive Approval | Locked Archive
28. Context-Sensitive Header Actions
Action
When enabled
Record Review
When a review action is permitted
Sign Off
When configured Partner sign-off prerequisites are met
Complete
Only when completion criteria are satisfied
Put on Hold
Authorised role; reason required
Resume
Authorised role; controlled transition
The UI must not permit an action merely because a button is visible. Server-side state machine validation is mandatory.
29. Intelligence Requirements
Trigger
Expected behaviour
Prior-year engagement exists
Offer controlled roll-forward and highlight changes
Potential duplicate
Warn before creation
Group client
Offer group/entity scope
Listed/NBFC/regulated
Surface relevant questions
First-year audit
Surface opening-balance/initial-audit considerations
Framework changes
Mark impacted downstream work Reassessment Required
New subsidiary
Trigger CFS/component reassessment
New significant transaction
Trigger planning/risk impact review
PBC received
Update request and surface evidence in linked work
Existing evidence/procedure found
Offer link instead of duplicate
Significant risk
Require explicit response/procedure
No owner/reviewer
Prevent Ready for Review
Open blocking review note
Prevent configured completion
Materiality revised
Flag affected sampling/testing/evaluation
30. Change Impact Rules
Change
Required impact
Materiality revised
Flag affected sampling/testing/evaluation
Risk changed
Reassess response/procedures
Audit approach changed
Reassess controls/substantive work
New subsidiary
Reassess CFS/component work
CARO/IFC applicability changed
Controlled activation/reassessment
Reporting date changed
Recalculate internal milestones; preserve original
Specialist required
Create dependency
New significant transaction
Reassess affected areas/risks
Framework rule version changed
Flag affected assessments; do not rewrite history
Never automatically delete completed downstream work. Use controlled retire/revise/regenerate actions and retain the audit trail.
31. UI Component Rules
Status badges and applicability badges must have different meanings.
Progress bars are informational and do not replace professional completion controls.
Needs Attention cards must be clickable and actionable.
People pickers are role-aware.
Entity pickers understand groups.
Date fields distinguish statutory, internal and client dates.
Evidence cards show source, version, status and linked work.
Dependencies show what is blocking work.
Side drawers/modals should preserve the current audit-file context.
All important forms support Save Draft.
Avoid duplicate data entry by pre-filling known engagement/entity information.
32. Empty / Loading / Error States
State
UI requirement
No audit work
Explain why work has not generated and show next required action
No PBC
Show no requests and action to create PBC plan
No team
Show missing assignment as attention where required
Loading
Skeleton matching final layout; never misleading zero counts
API failure
Actionable message + retry; preserve draft where possible
Microsoft provider failure
Explain provider issue; never silently duplicate file
Permission denied
Generic restricted-access message without protected data
Concurrent change
Require refresh/reconciliation; never silent overwrite
33. Minimum Data Objects
Object
Purpose
engagement
Core engagement
engagement_entities
Entities covered
engagement_services
Service instance
service_workflow_instance
Workflow template/version
audit_framework_assessment
Framework decision
audit_framework_evidence
Evidence supporting decision
audit_framework_approval
Approval/version history
audit_strategy
Strategy
audit_understanding
Preliminary understanding
audit_materiality
Materiality versions
audit_plan
Overall plan
audit_risk
Risk
audit_plan_procedure
Planned procedure relationship
audit_area
Audit area
workpaper
Professional workpaper
audit_procedure
Procedure
evidence
Evidence/link metadata
pbc_item
Client information request
review_note
Review note
exception
Exception/matter
audit_conclusion
Conclusion/version
team_allocation
Assignment
audit_milestone
Internal milestone
compliance_instance
Deadline
audit_consultation
Consultation
audit_event
Immutable event
document_mapping
Microsoft provider mapping
34. API Capability Expectations
GET/POST engagement service and workflowGET/POST framework assessmentsPOST framework approvalGET/POST planning and materialityGET/POST risks and risk responsesGET/POST work / audit areas / workpapers / proceduresPOST link existing procedureGET/POST PBCGET/POST review notesGET team / workload / time aggregationGET complianceGET immutable activityDocument provider integration endpointsWorkflow transition endpoints
Actual route names should follow the existing NestJS conventions. Do not bypass existing RLS/security services.
35. Security
Runtime application access remains assignment-scoped unless an authorised business-firmwide role applies.
Platform Admin does not automatically receive professional engagement data.
Authorization is enforced server-side.
Professional approvals and material changes create immutable audit events.
Microsoft document permissions follow DHVAJ engagement authorization.
Restricted consultation/significant matter data must have appropriate access controls.
Global search must respect the same authorization scope.
36. Automated Tests / Acceptance Criteria
Test
Expected result
Add Statutory Audit
One service + one workflow shell
Run generation twice
No duplicate objects
Framework incomplete
Execution does not incorrectly unlock
CARO applicable
CARO workstream activated
CARO not applicable
No active CARO work; reason retained
Evidence supports 2 areas
One evidence object, multiple links
Loan interest procedure
Can link Borrowings + Finance Costs
PBC received
Linked work updated
Financial workbook version changes
Provider version reflected
Risk without response
Cannot be treated complete
Procedure without reviewer
Cannot become Ready for Review where reviewer required
Blocking review note open
Completion blocked
Materiality revised
Affected work flagged
Unauthorized user
Cannot retrieve protected data
Historical event
Immutable
Archive
Final evidence/workpapers recoverable and locked
37. Definition of Done
Statutory Audit can be selected during engagement setup.
Service creation creates a versioned workflow shell.
Services shows workflow readiness.
Framework is a structured applicability/assessment layer.
Planning consumes framework outputs.
Work is a hierarchical digital audit file.
Audit areas contain professional work, not generic tasks.
Procedures and evidence can be reused across connected areas.
Financial Statements are managed as an integrated master workbook.
PBC is a client-request layer linked to work.
Review is first-class.
Team combines responsibility, workload and time.
Documents are contextual to Work.
Compliance remains a deadline layer.
Change-impact/reassessment is controlled.
Role-based access is server-enforced.
Professional history is immutable.
Microsoft Office collaboration is integrated without building a custom Office editor.
38. Developer Build Sequence
Retain global portal shell and engagement header.
Finalise engagement tabs.
Build Statutory Audit service configuration.
Build workflow shell and left audit-file navigation.
Build Framework dashboard, assessment and approval.
Connect rules, evidence and prior-year roll-forward.
Build Planning.
Build Risk and risk-to-response relationships.
Build Work dashboard and audit-area navigation.
Build Workpaper / Procedure / Evidence screens.
Build PBC tracker and evidence linking.
Integrate Microsoft document workspace.
Build Team/workload/time aggregation.
Build Review queue and review notes.
Build Compliance integration.
Build Completion, Reporting, Sign-off and Archive.
Implement change-impact/reassessment.
Complete security, concurrency and end-to-end tests.
39. Final Product Behaviour
When a Manager opens a Statutory Audit engagement, the portal should immediately communicate: what the engagement is, what framework applies, what stage it is in, what is outstanding, who owns the work, what evidence is available, what is blocked, what requires review, what significant matters remain and whether the file is ready for Partner action.
The portal should reduce administrative work by generating structure from service methodology and by reusing data/evidence. It should never make the audit team manually create dozens of repetitive tasks merely to demonstrate that an audit process exists.
The final experience is: Service → Framework → Planning → Risk → Audit File → Evidence → Review → Conclusion → Reporting → Sign-off → Archive.
Appendix – Example End-to-End Journey
1. Manager opens ENG00008.2. Services shows Statutory Audit = Active.3. Manager opens Statutory Audit workflow.4. Framework left panel displays assessment areas.5. Known entity/client data is pre-filled.6. Rule engine provides suggestions.7. Professional conclusions are recorded.8. Framework Memo is approved.9. Planning unlocks.10. Strategy/materiality/risks/areas/team/PBC are planned.11. Planning is approved.12. Applicable work areas/workpapers/procedures are generated.13. PBC Master is populated.14. Client evidence is received and linked.15. Team performs procedures.16. Existing procedures/evidence are reused across connected areas.17. Work moves to review.18. Review notes are cleared.19. Partner reviews significant matters and final file.20. Completion/reporting are completed.21. Partner signs off.22. File is archived and locked with full history.
