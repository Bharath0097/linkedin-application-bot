<?php
declare(strict_types=1);
/*
 * v34 governance content: the written security policies (starting templates tailored to StratEdge, editable under
 * Admin > Governance & SOC 2 > Policies), the SOC 2 readiness controls, starter risks, the vendor catalog and the
 * breach-notification quick reference. Policy text uses the lesson markdown ("## " headings, "- " bullets, **bold**)
 * and these placeholders, filled from the settings when shown: {company} {officer} {secEmail} {site} {idleStaff}
 * {pwMin} {pwMinSolo} {retention} {backupKeep}. Templates, not legal advice: have counsel review before relying on them.
 */

function govPolicyTemplates(): array
{
    $P = fn(string $id, string $t, string $sum, array $aud, string $body) => ['id' => $id, 't' => $t, 'sum' => $sum, 'aud' => $aud, 'body' => $body];
    return [
        $P('infosec', 'Information Security Policy', 'Why and how {company} protects information, who is responsible, and how the other policies fit together.', ['staff', 'consultants'], <<<'MD'
## Purpose
{company} handles information that people trust us with: candidates' resumes and contact details, consultants' immigration and payroll records, client requirements and rates, and our own finances. This policy sets the rules that keep that information confidential, accurate and available, and it is the umbrella for every other security policy.

## Scope
Everyone who works for or with {company} - employees, internal recruiters, consultants on assignment, contractors and outside bookkeepers - and every system that holds company information: the StratEdge portal at {site}, company email, laptops and phones used for work, and the cloud services listed in the vendor register.

## Principles
- **Least privilege**: people get the portals and records their job needs, nothing more.
- **Defence in depth**: two-step sign-in, encryption, the firewall, monitoring and backups each cover for the others.
- **Need to know**: candidate and consultant data is shared with a client or vendor only for a specific submission the person agreed to.
- **Report early**: anyone who suspects a problem reports it at once; nobody is blamed for an honest report.

## Roles
- **Security officer** ({officer}): owns this policy set, runs the quarterly access review, the annual risk assessment and incident response, and reports to management.
- **Management**: approves the policies, the risk treatment and the budget for security.
- **HR**: background checks where required, onboarding and offboarding, security training records.
- **Everyone**: follows these policies, completes the security awareness course every year and reports concerns.

## The policy set
Acceptable Use; Access Control; Passwords and Two-Step Sign-in; Data Classification and Handling; Encryption and Keys; Incident Response; Backup and Business Continuity; Vendor Management; Change Management; Data Retention and Disposal; Privacy and Candidate Data; Remote Work and Devices; Security Awareness Training; Risk Management; Logging and Monitoring; Vulnerability Management.

## Exceptions
An exception must be requested in writing from the security officer, state the business reason and the extra safeguards, and have an end date. Approved exceptions are recorded in the risk register.

## Enforcement
Breaking these policies can lead to loss of access and disciplinary action up to ending employment or the engagement, and may be reported to the authorities when the law requires it.

## Review
The security officer reviews every policy at least once a year and after any significant incident or change; changes are published in the portal and everyone acknowledges the new version.
MD),
        $P('aup', 'Acceptable Use Policy', 'What you may and may not do with company systems, email, the portal and client systems.', ['staff', 'consultants'], <<<'MD'
## Purpose
Clear rules for using {company} systems and information, so work stays secure and nobody is put at legal risk.

## You may
- Use the portal, company email and company files for StratEdge work.
- Use them for occasional personal tasks that do not interfere with work, cost the company money or break any other rule here.

## You must
- Keep your sign-in to yourself: never share a password, a sign-in code or a passkey device, and never sign in as someone else.
- Lock your screen when you step away (Windows+L, Ctrl+Cmd+Q) and sign out of the portal on shared computers.
- Use only the portal and approved services to store or share candidate, consultant and client information.
- Follow the client's own policies when you work on a client's systems; their rules apply on top of ours.

## You must not
- Download candidate, consultant or client data to personal email, personal cloud storage, USB drives or messaging apps.
- Send SSNs, bank account numbers, passport or visa copies by email or chat; use the portal's document upload instead.
- Install unlicensed or unknown software on work devices, or try to get around security controls (the firewall, two-step sign-in, encryption).
- Use company systems for harassment, discrimination, illegal content, crypto-mining, personal businesses or bulk email that recipients did not ask for.
- Copy client code, documents or data out of a client environment unless the client allows it in writing.

## Monitoring
{company} logs sign-ins, changes to records and administrative actions in the portal's audit log, and may review company email and systems for security and legal reasons, within the law.

## Reporting
Report a lost device, a suspicious email or a possible leak at once with the portal's Help > Report a security concern, or email {secEmail}.
MD),
        $P('access', 'Access Control Policy', 'How access to the portal and company systems is granted, reviewed and removed.', ['staff'], <<<'MD'
## Purpose
Make sure the right people - and only them - can reach company information, for only as long as they need it.

## Granting access
- Access is requested by the person's manager or HR and granted by an administrator in Admin > Roles & access.
- Each person gets their own account. Shared or generic accounts are not allowed.
- Staff portals (Admin, HR, Accounting, Manager) and features are granted by role; anything extra needs the security officer's approval and a reason.
- Outside bookkeepers and accountants get the accounting portal only, at the books level they need.
- Client and vendor contacts see only their own workspace or the redacted marketplace.

## Strong sign-in
- Two-step sign-in (authenticator app or passkey) is required for administrators, HR and accounting, and recommended for everyone.
- Passwords follow the Passwords and Two-Step Sign-in standard.
- Sessions end after {idleStaff} minutes without activity for staff portals and after a fixed number of hours in any case.

## Reviews
- The security officer runs an access review every quarter in Admin > Governance & SOC 2 > Access reviews: every account, role and portal is confirmed, changed or removed, and the result is kept as evidence.
- Accounts unused for 90 days are paused unless their manager confirms they are still needed.

## Changes and removal
- When someone changes role, their old access is removed the same day.
- When someone leaves, HR tells an administrator before their last day; the account is paused on the last day, all sessions are ended and company devices and data are returned.
- Every grant, change and removal is recorded in the audit log.
MD),
        $P('passwords', 'Passwords and Two-Step Sign-in Standard', 'Password length, breached-password checks, two-step sign-in methods and recovery.', ['staff', 'consultants'], <<<'MD'
## Passwords (NIST SP 800-63B-4)
- At least {pwMinSolo} characters for an account without two-step sign-in, at least {pwMin} with it. Long passphrases - several unrelated words - are encouraged.
- No forced character mixes and no scheduled password changes; a password is changed when there is any sign it was exposed.
- New passwords are checked against lists of common and breached passwords and cannot contain your name, email or the company name.
- Never reuse a work password anywhere else. Use a password manager.

## Two-step sign-in
- Required for administrators, HR and accounting; available to everyone.
- Approved methods: a passkey (Face ID, Touch ID, Windows Hello, a security key) or an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password). Emailed codes are a fallback for member accounts only.
- Keep the ten backup codes somewhere safe and offline. Each works once.
- "Remember this device" may be used only on your own, locked, up-to-date device.

## Lockout and recovery
- Repeated wrong passwords or codes lock the account for a while; the owner and administrators are told.
- Forgotten password: use "Forgot your password?" on the sign-in page; the link works once, for 30 minutes.
- Lost second step: an administrator resets it after confirming your identity by a separate channel (a call to a known number, or in person); you set it up again at your next sign-in.

## Never
Share codes, approve a sign-in you did not start, or read a code to anyone - StratEdge staff will never ask for one.
MD),
        $P('classification', 'Data Classification and Handling Policy', 'The four classes of information and how each may be stored, shared and destroyed.', ['staff', 'consultants'], <<<'MD'
## Classes
- **Restricted**: SSNs and tax IDs, bank account and routing numbers, passport, visa, EAD, I-94, I-797 and I-9 documents, background check results, health information, salaries and pay rates of individuals, passwords and keys.
- **Confidential**: resumes and candidate contact details, interview notes, client requirements and bill rates, contracts and SOWs, timesheets, invoices, internal financials.
- **Internal**: procedures, templates, internal announcements, general project information.
- **Public**: the website, published job postings, marketing material.

## Handling rules
- Restricted data lives only in the portal (encrypted documents, encrypted bank details) or the payroll provider. It is never emailed, put in chat, printed without need or stored on personal devices. Shared with a third party only when the law or an agreed process requires it (for example payroll or an immigration attorney), through an encrypted channel.
- Confidential data stays in the portal and company email. A candidate's resume goes to a client or vendor only for a submission the candidate agreed to (right to represent), and only what the role needs.
- Internal data may be shared inside the company; not outside without approval.
- Public data may be shared freely.

## Labelling and disposal
- When in doubt, treat information as the higher class.
- Paper with Confidential or Restricted data is shredded; files are deleted from the portal (and from downloads, email and recycle bins) when no longer needed, following the Retention policy.
MD),
        $P('encryption', 'Encryption and Key Management Standard', 'Where encryption is used and how the keys are protected.', ['admins'], <<<'MD'
## In transit
- The portal is served over HTTPS only (TLS 1.2 or newer), with HSTS so browsers never fall back to plain HTTP.
- Email is sent through a provider that uses TLS; SPF, DKIM and DMARC protect the company's sending domain.
- Integrations (banking, payroll, accounting, AI, job boards, storage) are called over HTTPS only.

## At rest
- Every file uploaded to the portal is encrypted with AES-256-GCM.
- Bank account numbers and stored credentials (mail, SSO, API keys) are sealed with AES-256-GCM.
- Backups are encrypted (XChaCha20-Poly1305) with a key sealed to the recovery key, which only the security officer holds offline.
- Company laptops use full-disk encryption (BitLocker or FileVault); phones use a passcode and device encryption.

## Keys
- The portal's main key is a file outside the website folder, readable only by the web server account. It is backed up only inside encrypted backups.
- The backup recovery key is printed or stored in a password manager by the security officer and a second administrator; it is never emailed or stored on the server.
- Keys are replaced when someone who had access leaves or when exposure is suspected; the replacement is recorded in the audit log.
MD),
        $P('incident', 'Incident Response Plan', 'How security incidents and data breaches are reported, handled and notified.', ['staff', 'consultants'], <<<'MD'
## What to report
Anything that might put information at risk: a phishing email you clicked, a lost or stolen laptop or phone, a resume sent to the wrong person, a strange sign-in alert, an account you did not create, malware, or a client telling us about a problem.

## How to report
Straight away, with Help > Report a security concern in the portal, or by email to {secEmail}. Do not try to investigate on your own and do not delete evidence.

## Severity
- **Critical**: Restricted data exposed, or the portal or payroll unavailable.
- **High**: Confidential data exposed, or an account taken over.
- **Medium**: a contained threat with no data exposed (a blocked phishing attempt that reached several people).
- **Low**: a single suspicious event with no impact.

## Steps
1. **Record** the incident in the incident register (Governance & SOC 2 > Incidents) with the time it was discovered.
2. **Contain**: pause accounts, end sessions, reset passwords and second steps, block addresses in the firewall, isolate devices.
3. **Assess**: what data, whose, how many people, which states and countries they live in.
4. **Notify** when personal data was breached, within the deadlines the register calculates: New Jersey requires the State Police to be told before residents; the EU and UK supervisory authority within 72 hours; clients as their contracts require; and the cyber insurer.
5. **Recover**: restore from backups if needed, confirm systems are clean (Monitoring > File integrity).
6. **Learn**: within two weeks, a short review of what happened, what worked and what changes; actions go to the risk register.

## Testing
The plan is walked through once a year as a tabletop exercise, recorded in the SOC 2 checklist.
MD),
        $P('continuity', 'Backup and Business Continuity Policy', 'Backups, recovery targets and how the business keeps running during an outage.', ['admins'], <<<'MD'
## Targets
- **Recovery point objective (RPO)**: at most 24 hours of portal data may be lost.
- **Recovery time objective (RTO)**: the portal is back within 48 hours of a major outage.

## Backups
- An encrypted backup of the database and keys is made every night, and a full backup with every document every week; the last {backupKeep} nightly backups are kept.
- A copy is kept off the server (S3-compatible storage) so that losing the hosting account does not lose the data.
- A backup is opened and checked with the recovery key at least every quarter; the check is recorded.

## Continuity
- If the portal is down, timesheets and approvals are collected by email and entered afterwards; payroll runs from the last approved data.
- The hosting provider's contact details, the domain registrar login and the recovery key are kept by two administrators.
- Restoring on new hosting: upload the site, restore the latest backup under Security center > Backups, point the domain, and test sign-in, documents and payroll.

## Testing
A restore test is done at least twice a year, and the plan is reviewed with the incident response plan.
MD),
        $P('vendors', 'Vendor and Third-Party Risk Policy', 'How services that handle company data are chosen, recorded and reviewed.', ['admins'], <<<'MD'
## Inventory
Every service that stores or processes company data is listed in the vendor register (Governance & SOC 2 > Vendors): email, payment and banking, accounting, payroll, job boards and VMS platforms, AI services, hosting, storage and staffing partners that receive candidate data.

## Before using a vendor
- Check what data it gets and why, and classify it (critical, high, medium, low).
- For critical and high vendors: get their SOC 2 Type II or ISO 27001 report, or a completed security questionnaire; sign a data processing agreement where personal data is involved.
- Give the vendor the least access possible (separate API keys, limited scopes).

## While using a vendor
- Review critical vendors every year and others every two years: new reports, incidents, changes in what they do with our data.
- Staffing partners and subcontractors that receive candidate or consultant data are bound by confidentiality and must report breaches to us within 72 hours.

## Leaving a vendor
Revoke its keys and access, retrieve our data and get written confirmation that copies are deleted.
MD),
        $P('change', 'Change Management Policy', 'How changes to the portal and its settings are planned, tested and recorded.', ['admins'], <<<'MD'
## Scope
New versions of the portal, changes to its settings (security, sign-in rules, mail, integrations, payroll and tax settings) and changes to hosting, DNS and email configuration.

## Rules
- Each new portal version comes with release notes (README "What's new") and is tested before upload.
- Uploads are made by an administrator; afterwards System health must show "Up to date and complete" and Monitoring > File integrity must be clean.
- A backup is made before every upload ("Back up now").
- Settings changes are recorded automatically in the audit log with who and when; significant ones are noted in the change log of the SOC 2 checklist.
- Emergency changes (to stop an attack) may be made first and reviewed within two working days.

## Rollback
If an upload causes problems, the previous version's zip is uploaded again; data changes are reversed from the last backup when needed.
MD),
        $P('retention', 'Data Retention and Disposal Policy', 'How long each kind of record is kept and how it is destroyed.', ['staff'], <<<'MD'
## Schedule
- **Candidates never hired** (applications, resumes, notes): {retention} months after the last contact, then deleted automatically - sooner on request.
- **Employees and consultants**: personnel files for the employment plus 7 years; Form I-9 for 3 years after hire or 1 year after the end of employment, whichever is later; immigration documents for the employment plus 3 years.
- **Payroll and tax records**: at least 4 years after the tax is due (7 years kept by default).
- **Timesheets and invoices**: 7 years.
- **Contracts, SOWs and agreements**: 7 years after they end.
- **Audit logs**: at least 1 year.
- **Backups**: the nightly copies kept under the Backup policy; older ones are deleted automatically.

## Legal holds
When a claim, audit or investigation is expected, the security officer places a legal hold: the affected records are not deleted until the hold is lifted.

## Disposal
Records are deleted from the portal (documents included), from backups as they age out, and from devices and email. Paper is shredded. Old devices are wiped or physically destroyed before disposal.
MD),
        $P('privacy', 'Privacy and Candidate Data Policy', 'How personal data of candidates, consultants and contacts is collected, used and shared.', ['staff', 'consultants'], <<<'MD'
## Collection
- Only what recruiting, placement, payroll and compliance need. The privacy notice at {site}#/privacy explains this at every point of collection.
- Candidates confirm consent when they apply or create an account; candidates added from email or job boards are told how we got their details at first contact.

## Use and sharing
- A candidate is submitted to a client or vendor only after they agreed to that specific role (right to represent), with only the information that role needs.
- Personal data is never sold.
- Voluntary self-identification (EEO) answers are kept apart and never used in hiring decisions.

## People's rights
Anyone may ask to see, correct or delete their information through the form at {site}#/privacy or by email. Requests are logged in the portal and answered within the legal deadline (45 days for California residents, one month in the EU and UK), after confirming the requester's identity.

## Transfers
Data stays with the services in the vendor register. Teams working from other countries access it through the portal only, under the same policies.
MD),
        $P('remote', 'Remote Work and Device Security Policy', 'Rules for laptops, phones and home networks used for work.', ['staff', 'consultants'], <<<'MD'
## Devices
- Keep the operating system, browser and apps updated (automatic updates on).
- Use full-disk encryption, a screen lock after 5 minutes or less, and a strong device password or biometrics.
- Run the built-in antivirus (Microsoft Defender, XProtect) or one the company approves.
- Do not let family members or others use a device that has company data on it.

## Networks
- Use a password-protected home Wi-Fi (WPA2 or WPA3) with a changed router password.
- On public Wi-Fi, use your phone's hotspot or a VPN; never use public computers for the portal.

## Lost or stolen devices
Report it at once (Help > Report a security concern). Administrators end your sessions and remove remembered devices; change your password from another device.

## Leaving the company
Return company devices; delete company files from personal devices and confirm in writing.
MD),
        $P('training', 'Security Awareness Training Policy', 'Who takes the security course, how often, and what it covers.', ['staff'], <<<'MD'
## Requirement
- Everyone completes "Security awareness at StratEdge" in the learning platform within 30 days of joining and every 12 months after.
- People who handle Restricted data (HR, payroll, accounting, administrators) also review the Data Classification and Incident Response policies each year.

## Content
Phishing and fake candidates, passwords and two-step sign-in, handling candidate and immigration data, safe email and file sharing, remote work, reporting incidents.

## Records
Completion is recorded in the portal; the security officer follows up with anyone overdue, and the record is used as SOC 2 evidence.
MD),
        $P('risk', 'Risk Management Policy', 'How security risks are identified, scored, treated and reviewed.', ['admins'], <<<'MD'
## Assessment
- Once a year, and after major changes, the security officer and management review the risk register (Governance & SOC 2 > Risks).
- Each risk is scored for likelihood and impact from 1 to 5; the score is their product.

## Treatment
- Scores of 15 and above are treated first, with an owner and a date.
- Options: reduce (add controls), transfer (insurance, contracts), avoid (stop the activity) or accept (management signs off, recorded with a review date).

## Monitoring
Owners update their risks at least quarterly; incidents and audit findings add new risks.
MD),
        $P('logging', 'Logging and Monitoring Policy', 'What is logged, how logs are protected and who reviews them.', ['admins'], <<<'MD'
## What is logged
Sign-ins and failures, two-step sign-in changes, password resets, account and access changes, settings changes, data exports and deletions, backups and checks, firewall blocks and security alerts.

## Protection
The audit log is sealed: each entry carries a code computed over the entry before it, so edits, deletions and reordering are detected by "Verify the chain". Logs are kept at least one year.

## Review
- Alerts (unusual sign-ins, lockouts, integrity problems) are emailed to the security contacts as they happen.
- The daily security check runs automatically; the security officer reviews the Monitoring page and the audit log at least weekly and records findings.
MD),
        $P('vulnerability', 'Vulnerability Management and Responsible Disclosure Policy', 'Keeping software patched, and how outside researchers can report problems.', ['admins'], <<<'MD'
## Patching
- Portal updates are applied within 30 days of release (within 7 days when they fix a security problem).
- PHP is kept on a version that still receives security fixes; the security check warns six months before the end of support.
- Devices follow the Remote Work policy.

## Finding problems
- The daily security check covers HTTPS, the certificate, security headers, exposed files, the server, encryption, backups, sign-in and email records.
- An outside penetration test is done before a SOC 2 audit and after major changes.

## Responsible disclosure
Researchers can report security problems at {site}#/security or to {secEmail}. We acknowledge reports within 3 business days, keep them confidential, fix confirmed problems as quickly as their severity requires, and do not take legal action against good-faith research that avoids privacy violations, data destruction and service disruption.
MD),
    ];
}

/** SOC 2 Trust Services Criteria controls with what an auditor looks for; 'auto' names a built-in check. */
function govSocControls(): array
{
    $C = fn(string $id, string $tsc, string $t, string $d, string $auto = '') => ['id' => $id, 'tsc' => $tsc, 't' => $t, 'd' => $d, 'auto' => $auto];
    return [
        $C('cc1-officer', 'CC1.3', 'A security officer is named', 'Responsibility for security is assigned to a named person with authority.', 'officer'),
        $C('cc1-aup', 'CC1.1', 'Staff accepted the acceptable use rules', 'Everyone acknowledged the Acceptable Use Policy (code of conduct for systems).', 'ack:aup'),
        $C('cc1-training', 'CC1.4', 'Security training completed in the last 12 months', 'Annual security awareness training with completion records.', 'training'),
        $C('cc1-background', 'CC1.4', 'Background checks for people with access to Restricted data', 'Pre-employment screening for HR, payroll, accounting and administrators.'),
        $C('cc2-policies', 'CC2.1', 'Security policies are published and reviewed within a year', 'Written policies, approved, communicated and reviewed annually.', 'policies'),
        $C('cc2-acks', 'CC2.2', 'Staff acknowledged the current policies', 'Evidence that people read the current versions.', 'acks'),
        $C('cc2-report', 'CC2.2', 'Staff can report security concerns', 'An internal channel to report incidents and concerns.', 'concern'),
        $C('cc2-external', 'CC2.3', 'Security and privacy commitments are published', 'A public security page, security.txt and a privacy notice.', 'public'),
        $C('cc3-risk', 'CC3.1', 'A risk assessment was done in the last 12 months', 'Risks identified, scored and reviewed at least yearly.', 'risk'),
        $C('cc3-owners', 'CC3.2', 'Every high risk has an owner and a treatment', 'Risk treatment decisions are documented.', 'riskowners'),
        $C('cc3-fraud', 'CC3.3', 'Fraud risks are considered', 'Fraud scenarios (fake candidates, payroll diversion, invoice fraud) are in the risk register.', 'fraud'),
        $C('cc3-payroll', 'CC3.3', 'Payroll bank changes are held and confirmed', 'A new or changed bank account waits before pay goes there; the employee and payroll are told.', 'ddhold'),
        $C('cc4-monitor', 'CC4.1', 'Controls are monitored continuously', 'The daily security check runs and its findings are reviewed.', 'scan'),
        $C('cc4-findings', 'CC4.2', 'No open critical findings', 'Deficiencies are tracked and fixed.', 'nofail'),
        $C('cc5-headers', 'CC5.2', 'Technical controls on the web application', 'HTTPS, security headers, Content-Security-Policy, firewall.', 'web'),
        $C('cc6-mfa', 'CC6.1', 'Two-step sign-in for privileged roles', 'Multi-factor authentication enforced for administrators and finance/HR.', 'mfa'),
        $C('cc6-passwords', 'CC6.1', 'Password rules meet NIST SP 800-63B', 'Length, breached-password checks, lockout.', 'pwpolicy'),
        $C('cc6-encryption', 'CC6.1', 'Sensitive data is encrypted at rest', 'Documents, bank details and secrets encrypted; key kept apart.', 'encryption'),
        $C('cc6-provision', 'CC6.2', 'Access is granted and changed by administrators, with an audit trail', 'Provisioning and changes are authorized and logged.', 'audit'),
        $C('cc6-stepup', 'CC6.1', 'Sensitive actions need a fresh confirmation', 'Step-up authentication before access changes, key changes, payroll files, exports and deletions.', 'stepup'),
        $C('cc6-review', 'CC6.3', 'Access reviewed in the last quarter', 'Periodic user access reviews with documented results.', 'review'),
        $C('cc6-dormant', 'CC6.3', 'No dormant privileged accounts', 'Accounts of leavers and unused accounts are removed promptly.', 'dormant'),
        $C('cc6-network', 'CC6.6', 'Protection against outside threats', 'Firewall, rate limits, scanner blocking, lockouts.', 'firewall'),
        $C('cc6-transit', 'CC6.7', 'Data is encrypted in transit', 'TLS for every connection, HSTS.', 'tls'),
        $C('cc6-dlp', 'CC6.7', 'Unusual downloads and exports are detected', 'Bulk downloads, exports and profile scraping alert the security contacts and pause automatically.', 'dlp'),
        $C('cc6-malware', 'CC6.8', 'Unauthorized code is detected', 'File integrity monitoring of the application.', 'integrity'),
        $C('cc6-uploads', 'CC6.8', 'Uploaded files are screened for malicious content', 'Type checks, macro and program blocking, optional virus scanning.', 'uploads'),
        $C('cc6-devices', 'CC6.8', 'Work devices are encrypted and patched', 'Endpoint controls per the Remote Work policy (attest or MDM report).'),
        $C('cc7-vuln', 'CC7.1', 'Vulnerabilities are found and fixed', 'Self-check, supported PHP version, patching cadence, responsible disclosure.', 'vuln'),
        $C('cc7-alerts', 'CC7.2', 'Security events raise alerts', 'Unusual sign-ins, lockouts and integrity problems alert the security contacts; the audit log is sealed.', 'alerts'),
        $C('cc7-incidents', 'CC7.3', 'Incidents are recorded and evaluated', 'An incident register with owners and timelines.', 'incidents'),
        $C('cc7-tabletop', 'CC7.4', 'The incident response plan was tested in the last 12 months', 'A tabletop exercise or real incident review, documented.'),
        $C('cc8-change', 'CC8.1', 'Changes are controlled and recorded', 'Versioned releases, upload check, settings changes in the audit log.', 'change'),
        $C('cc9-continuity', 'CC9.1', 'Backups run and are kept off the server', 'Daily encrypted backups with an off-site copy.', 'backups'),
        $C('cc9-vendors', 'CC9.2', 'Vendors are assessed and reviewed', 'Vendor register with risk tiers, reports and review dates.', 'vendors'),
        $C('a1-restore', 'A1.3', 'A backup was test-restored in the last 6 months', 'Recovery tested and documented.', 'restore'),
        $C('a1-capacity', 'A1.1', 'Capacity is monitored', 'Disk space and performance are watched (System health, the self-check).', 'capacity'),
        $C('c1-classify', 'C1.1', 'Confidential information is identified', 'A data classification policy that people acknowledged.', 'ack:classification'),
        $C('c1-dispose', 'C1.2', 'Confidential information is disposed of on schedule', 'Retention rules applied automatically (candidates, verification documents, logs, backups).', 'retention'),
        $C('p1-notice', 'P1.1', 'A privacy notice is published', 'Notice at collection describing uses, sharing and rights.', 'notice'),
        $C('p2-consent', 'P2.1', 'Consent is captured when candidates apply', 'Recorded consent with time and version.', 'consent'),
        $C('p5-requests', 'P5.1', 'Privacy requests are answered on time', 'Access and deletion requests logged and closed within deadlines.', 'dsr'),
    ];
}

/** Starter risks for a US IT staffing firm (scores are a starting point for the yearly assessment). */
function govStarterRisks(): array
{
    $R = fn(string $t, string $cat, int $l, int $i, string $plan) => ['t' => $t, 'cat' => $cat, 'l' => $l, 'i' => $i, 'treat' => 'mitigate', 'plan' => $plan, 'st' => 'open'];
    return [
        $R('Phishing leads to a staff account takeover', 'People', 4, 4, 'Two-step sign-in for staff; annual security course; new-device and unusual sign-in alerts.'),
        $R('Payroll diversion: a fake request changes a consultant\'s bank account', 'Fraud', 3, 4, 'Bank changes only in the portal by the person (audited); call-back on any emailed request; payroll reviews changes before each run.'),
        $R('Fake candidates or identity fraud in submissions to clients', 'Fraud', 4, 3, 'Screening agent fake-profile checks; ID and work-authorization verification; references.'),
        $R('Resumes or immigration documents emailed to the wrong person', 'Data', 3, 4, 'Documents shared through the portal, not email; classification training; incident reporting.'),
        $R('Ransomware or malware on a staff laptop', 'Devices', 3, 4, 'Disk encryption, updates, antivirus; data kept in the portal, not on laptops; backups.'),
        $R('Loss of the hosting account or server', 'Availability', 2, 5, 'Nightly encrypted backups with an off-site copy; restore tested quarterly; recovery key held by two people.'),
        $R('A vendor holding our data is breached (email, AI, payroll, job boards)', 'Vendors', 3, 3, 'Vendor register with reports and DPAs; least-privilege API keys; breach notice clauses.'),
        $R('An insider downloads candidate data before leaving', 'People', 2, 4, 'Least privilege; audit log of exports; offboarding checklist; access reviews.'),
        $R('A web vulnerability in the portal is exploited', 'Application', 2, 5, 'Content-Security-Policy, headers, firewall, file integrity monitoring, prompt updates, responsible disclosure.'),
        $R('Missed breach-notification deadline after an incident', 'Compliance', 2, 4, 'Incident register calculates deadlines; incident response plan tested yearly.'),
        $R('Bulk email marks the domain as spam and blocks business email', 'Operations', 3, 3, 'Separate sending domain or subdomain, SPF/DKIM/DMARC, list hygiene, complaint and bounce limits with auto-pause.'),
    ];
}

/** Vendors detected from the site's own settings, with what they receive. */
function govVendorCatalog(): array
{
    return [
        'mail' => ['n' => 'Email sending service', 'svc' => 'Outgoing email (portal notices, campaigns)', 'data' => 'Names, email addresses, message content', 'tier' => 'high'],
        'ai' => ['n' => 'AI language model provider', 'svc' => 'StratEdge AI, resume tailoring, screening agent', 'data' => 'Resumes, job descriptions, candidate answers', 'tier' => 'high'],
        'stripe' => ['n' => 'Stripe', 'svc' => 'Card payments for plans', 'data' => 'Names, emails, payment details (held by Stripe)', 'tier' => 'high'],
        'plaid' => ['n' => 'Plaid', 'svc' => 'Bank feed for the books', 'data' => 'Bank transactions and balances', 'tier' => 'critical'],
        'qbo' => ['n' => 'Intuit QuickBooks Online', 'svc' => 'Accounting sync', 'data' => 'Customers, invoices, payments, bills', 'tier' => 'high'],
        'google' => ['n' => 'Google (sign-in)', 'svc' => 'Sign in with Google', 'data' => 'Name and email at sign-in', 'tier' => 'medium'],
        'linkedin' => ['n' => 'LinkedIn (sign-in)', 'svc' => 'Sign in with LinkedIn', 'data' => 'Name and email at sign-in', 'tier' => 'low'],
        'microsoft' => ['n' => 'Microsoft (sign-in)', 'svc' => 'Sign in with Microsoft', 'data' => 'Name and email at sign-in', 'tier' => 'medium'],
        'geo' => ['n' => 'ip-api.com', 'svc' => 'Approximate city of each sign-in', 'data' => 'Network addresses of sign-ins', 'tier' => 'low'],
        'hibp' => ['n' => 'Have I Been Pwned (Pwned Passwords)', 'svc' => 'Breached-password check', 'data' => 'First 5 characters of a password fingerprint (k-anonymity)', 'tier' => 'low'],
        'dice' => ['n' => 'Dice', 'svc' => 'Candidate sourcing and job postings', 'data' => 'Job postings; candidate profiles retrieved', 'tier' => 'medium'],
        'ilabor' => ['n' => 'iLabor360', 'svc' => 'VMS requisitions and submissions', 'data' => 'Requisitions; candidates submitted', 'tier' => 'high'],
        's3' => ['n' => 'Off-site backup storage', 'svc' => 'Encrypted backup copies', 'data' => 'Encrypted backups (unreadable without the recovery key)', 'tier' => 'medium'],
        'host' => ['n' => 'Web hosting provider', 'svc' => 'Runs the portal and stores its database', 'data' => 'Everything in the portal', 'tier' => 'critical'],
    ];
}

/**
 * Breach-notification quick reference for states with a fixed deadline or a regulator notice (reviewed October 2026).
 * [name, days to notify residents (0 = "without unreasonable delay"), regulator notice]. Not legal advice; laws change.
 */
function govBreachStates(): array
{
    return [
        'AL' => ['Alabama', 45, 'Attorney General within 45 days if more than 1,000 residents'],
        'AZ' => ['Arizona', 45, 'Attorney General and the three credit bureaus within 45 days if more than 1,000 residents'],
        'CA' => ['California', 30, 'Attorney General within 15 days of notifying residents if more than 500 residents'],
        'CO' => ['Colorado', 30, 'Attorney General within 30 days if 500 or more residents'],
        'CT' => ['Connecticut', 60, 'Attorney General no later than when residents are notified'],
        'DE' => ['Delaware', 60, 'Attorney General if more than 500 residents'],
        'FL' => ['Florida', 30, 'Department of Legal Affairs within 30 days if 500 or more residents'],
        'IN' => ['Indiana', 45, 'Attorney General'],
        'LA' => ['Louisiana', 60, 'Attorney General within 10 days of notifying residents'],
        'ME' => ['Maine', 30, 'Attorney General'],
        'MD' => ['Maryland', 45, 'Attorney General before notifying residents'],
        'MA' => ['Massachusetts', 0, 'Attorney General and the Office of Consumer Affairs'],
        'NJ' => ['New Jersey', 0, 'Division of State Police BEFORE notifying residents; credit bureaus if more than 1,000 residents'],
        'NM' => ['New Mexico', 45, 'Attorney General and credit bureaus within 45 days if more than 1,000 residents'],
        'NY' => ['New York', 30, 'Attorney General, Department of State, Division of State Police (and DFS for regulated companies)'],
        'NC' => ['North Carolina', 0, 'Attorney General'],
        'OH' => ['Ohio', 45, ''],
        'OK' => ['Oklahoma', 0, 'Attorney General within 60 days of notifying residents if 500 or more residents'],
        'OR' => ['Oregon', 45, 'Attorney General if more than 250 residents'],
        'PA' => ['Pennsylvania', 0, 'Attorney General at the same time as residents if more than 500 residents'],
        'RI' => ['Rhode Island', 45, 'Attorney General and credit bureaus if more than 500 residents'],
        'SD' => ['South Dakota', 60, 'Attorney General if more than 250 residents'],
        'TN' => ['Tennessee', 45, ''],
        'TX' => ['Texas', 60, 'Attorney General within 30 days if 250 or more residents'],
        'VT' => ['Vermont', 45, 'Attorney General preliminary notice within 14 business days'],
        'VA' => ['Virginia', 0, 'Attorney General'],
        'WA' => ['Washington', 30, 'Attorney General within 30 days if more than 500 residents'],
        'WI' => ['Wisconsin', 45, ''],
    ];
}
