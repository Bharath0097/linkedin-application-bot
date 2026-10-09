<?php
/* USCIS compliance hub (v30): the rule library consultants read in their portal, the per-person status and dates
   they keep current, and the deadline checklist the server derives from those dates (STEM OPT validation reports,
   evaluations, unemployment days, extensions, address changes, I-9 reverification...). HR sees every person's
   deadlines; the cron job e-mails reminders. Rules are editable under Admin > Compliance and can be reset to the
   built-in text, which was last reviewed in October 2026 - every rule links to its primary source. */
declare(strict_types=1);

const COMP_STATUSES = [
    'f1opt' => 'F-1 student on post-completion OPT',
    'f1stem' => 'F-1 student on the 24-month STEM OPT extension',
    'f1cpt' => 'F-1 student (CPT or still enrolled)',
    'h1b' => 'H-1B specialty occupation worker',
    'h4ead' => 'H-4 dependent with an EAD',
    'l1' => 'L-1 intracompany transferee',
    'tn' => 'TN (USMCA) professional',
    'e3' => 'E-3 (Australia) specialty worker',
    'o1' => 'O-1 extraordinary ability',
    'gcpend' => 'Adjustment of status pending (I-485, EAD/AP)',
    'lpr' => 'Lawful permanent resident (green card holder)',
    'citizen' => 'U.S. citizen',
    'other' => 'Other status',
];
const COMP_CATS = ['stem' => 'STEM OPT', 'opt' => 'F-1 & OPT', 'h1b' => 'H-1B', 'gc' => 'Green card', 'all' => 'Everyone', 'emp' => 'What StratEdge does'];
const COMP_REVIEWED = '2026-10-06';

function compStaff(bool $write = false): array
{
    $u = requireUser();
    // HR and administrators, and (v83) a person given the "HR pages" or "USCIS compliance" feature, as the comp scope says
    $granted = grantOf((string) $u['id'], 'hr') || grantOf((string) $u['id'], 'compliance');
    if (!can('comp/x/rules', $write ? 'w' : 'r') || (userLevel($u) < 2 && !$granted)) {
        fail(403, 'invalid_argument', 'Compliance pages are for HR and administrators.');
    }
    return $u;
}
function compDateAdd(string $d, int $days): string
{
    $t = strtotime($d . ' 12:00:00');
    return $t ? date('Y-m-d', $t + $days * 86400) : '';
}
function compMonthAdd(string $d, int $months): string
{
    $t = strtotime($d . ' 12:00:00');
    if (!$t) {
        return '';
    }
    $dt = new DateTime('@' . $t);
    $dt->setTimezone(new DateTimeZone(date_default_timezone_get()));
    $day = (int) $dt->format('j');
    $dt->modify('first day of +' . $months . ' month');
    $dt->setDate((int) $dt->format('Y'), (int) $dt->format('n'), min($day, (int) $dt->format('t')));
    return $dt->format('Y-m-d');
}
function compValidDate(?string $d): bool
{
    return is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) === 1 && strtotime($d) !== false;
}
function compDays(string $from, string $to): int
{
    return (int) round((strtotime($to . ' 12:00:00') - strtotime($from . ' 12:00:00')) / 86400);
}

/** The built-in rule library. Keep the text short and factual; every entry names its source. */
function compDefaultRules(): array
{
    $src = fn(string $l, string $u) => ['l' => $l, 'u' => $u];
    $sits = 'https://studyinthestates.dhs.gov/stem-opt-hub';
    $ice = 'https://www.ice.gov/sevis/practical-training';
    $uscisOpt = 'https://www.uscis.gov/working-in-the-united-states/students-and-exchange-visitors/optional-practical-training-extension-for-stem-students-stem-opt';
    $uscisH1b = 'https://www.uscis.gov/working-in-the-united-states/h-1b-specialty-occupations';
    $dolH1b = 'https://www.dol.gov/agencies/whd/immigration/h1b';
    $ar11 = 'https://www.uscis.gov/addresschange';
    return [
        // ---- STEM OPT ----
        ['id' => 'stem-10day', 'cat' => 'stem', 'who' => ['f1stem'], 't' => 'Report every change within 10 days', 'dl' => '10 days', 's' => 'Your name, address, e-mail or phone, your employer\'s name or address, your job title, duties, supervisor, hours or pay, and the end of a job must all reach your DSO (or the SEVP Portal) within 10 days.', 'd' => "- Address, e-mail and phone changes: SEVP Portal or your DSO, plus Form AR-11 to USCIS.\n- A change of employer, employer address or EIN, job title, duties, supervisor, a pay cut not tied to fewer hours, a significant cut in hours, or new learning objectives is a *material change*: your employer signs a new or amended Form I-983 and you give it to your DSO within 10 days.\n- When a job ends, your employer reports it within 5 business days and you file the final evaluation (I-983 page 5) within 10 days.\n- Each new employer needs its own Form I-983 before you start.", 'risk' => 'Unreported changes are status violations; SEVP can terminate your SEVIS record, which ends your work authorization.', 'src' => [$src('Study in the States: STEM OPT reporting requirements', $sits . '/for-students/students-reporting-requirements'), $src('8 CFR 214.2(f)(10)(ii)(C)', 'https://www.ecfr.gov/current/title-8/section-214.2')]],
        ['id' => 'stem-6mo', 'cat' => 'stem', 'who' => ['f1stem'], 't' => 'Validation report every 6 months', 'dl' => '6, 12, 18 and 24 months after the STEM OPT start date', 's' => 'Confirm to your DSO that your name, address, employer name and address are current and that you are still employed. Each report is due within 10 days of the 6-month mark (schools usually open the window 30 days before).', 'd' => "- Due at 6, 12, 18 and 24 months counted from the start date printed on your STEM OPT EAD.\n- Send it even when nothing changed; the DSO records it in SEVIS.\n- At 12 and 24 months the validation goes together with the evaluation on Form I-983 (next rule).", 'risk' => 'A missed validation is a reporting failure; after 90 days without reported employer information SEVP terminates the record automatically.', 'src' => [$src('Study in the States: STEM OPT reporting requirements', $sits . '/for-students/students-reporting-requirements')]],
        ['id' => 'stem-eval', 'cat' => 'stem', 'who' => ['f1stem'], 't' => 'Self-evaluations on Form I-983 (12 and 24 months)', 'dl' => '12 months after the start date; final evaluation at 24 months or within 10 days of leaving the employer', 's' => 'Page 5 of your Form I-983 holds two evaluations: one at the 12-month mark and the final one when the STEM period or the job ends. You write them, your employer signs them, your DSO files them.', 'd' => "- Describe the training you received against the learning objectives on the plan.\n- The final evaluation is due within 10 days of the end of the 24 months *or* of the day you leave that employer - whichever comes first - and again for each employer you had.\n- Keep signed copies; DHS asks for them at site visits and in later petitions.", 'risk' => 'Missing evaluations count against you at the 24-month mark and in later immigration filings.', 'src' => [$src('Form I-983 and instructions (ICE)', 'https://www.ice.gov/doclib/sevis/pdf/i983.pdf'), $src('Study in the States: STEM OPT hub', $sits)]],
        ['id' => 'stem-unemp', 'cat' => 'stem', 'who' => ['f1stem', 'f1opt'], 't' => 'Unemployment: 90 days on OPT, 150 days in total with the STEM extension', 'dl' => 'Counted day by day, weekends included', 's' => 'You may be without a qualifying job for at most 90 days during post-completion OPT, and 150 days in aggregate once you are on the STEM extension (the 90 plus 60 more). Every calendar day without employment counts.', 'd' => "- The clock runs from the start date on your EAD, not from graduation.\n- A qualifying STEM job is paid, at least 20 hours a week, with an E-Verify employer and a signed I-983; on standard OPT unpaid work related to your degree of 20+ hours can count (keep proof).\n- Log every gap in this portal; the tracker shows days used and days left.\n- Travel outside the U.S. while unemployed still counts as unemployment.", 'risk' => 'At 150 days (90 on OPT) SEVP terminates your SEVIS record automatically within 15 days; you would be out of status.', 'src' => [$src('Study in the States: Unemployment on STEM OPT', $sits . '/for-students/students-reporting-requirements'), $src('USCIS: STEM OPT extension', $uscisOpt)]],
        ['id' => 'stem-emp', 'cat' => 'stem', 'who' => ['f1stem'], 't' => 'What a STEM OPT job must look like', 'dl' => 'Before day one with each employer', 's' => 'A paid position of at least 20 hours a week with an employer enrolled in E-Verify, a bona fide employer-employee relationship, and a Form I-983 training plan with a named supervisor and learning objectives.', 'd' => "- Your employer trains and supervises you; a staffing company may employ you only if it - not the client alone - provides the training and supervision described on the I-983.\n- Pay and duties must be commensurate with similarly situated U.S. workers.\n- DHS may visit the worksite (normally with 48 hours' notice) to check the plan is real: know your objectives, supervisor and duties.\n- Volunteer or 1099 work does not qualify on the STEM extension.", 'risk' => 'A job that does not meet the rule is unauthorized employment and counts as unemployment days.', 'src' => [$src('Study in the States: Employer responsibilities', $sits . '/for-employers'), $src('USCIS: STEM OPT extension', $uscisOpt)]],
        ['id' => 'stem-i765', 'cat' => 'stem', 'who' => ['f1opt'], 't' => 'Applying for the 24-month STEM extension', 'dl' => 'File Form I-765 up to 90 days before your OPT EAD expires - and before it expires', 's' => 'Get the STEM I-20 from your DSO (with the employer-signed I-983), then file I-765 with USCIS within 60 days of the DSO recommendation and before the current EAD ends. If USCIS has not decided by the expiry date, you may keep working for up to 180 days while it is pending.', 'd' => "- Eligible: a qualifying STEM degree (CIP code on the DHS list) from an accredited, SEVP-certified school, and an E-Verify employer.\n- Under the fixed-admission rule in force since 15 September 2026, students whose I-94 end date does not cover the extension also file Form I-539 (extension of stay); students admitted for duration of status who file the I-765 by 18 March 2027 are exempt. Ask your DSO which applies to you.\n- Premium processing is available for the I-765 in this category.", 'risk' => 'Filing after the EAD expires is not possible; a late STEM filing ends your work authorization and starts the grace period.', 'src' => [$src('USCIS: STEM OPT extension', $uscisOpt), $src('USCIS: Form I-765', 'https://www.uscis.gov/i-765'), $src('Morgan Lewis: New F-1 rule (July 2026)', 'https://www.morganlewis.com/pubs/2026/07/new-f-1-rule-could-delay-opt-hiring-and-interrupt-employment')]],
        ['id' => 'stem-travel', 'cat' => 'stem', 'who' => ['f1stem', 'f1opt'], 't' => 'Travelling on OPT or STEM OPT', 'dl' => 'Before each trip', 's' => 'Carry a valid passport, a valid F-1 visa, your EAD, an I-20 with a travel signature less than 6 months old, and proof of your job (offer or employment letter and recent pay stubs).', 'd' => "- No job offer and no EAD in hand: re-entry can be refused.\n- Travelling while the STEM extension or a change of status is pending is risky; ask your DSO first.\n- Print your new I-94 after every entry and check the class and the end date.", 'risk' => 'Refused entry ends OPT and cannot be appealed at the border.', 'src' => [$src('Study in the States: Travel', 'https://studyinthestates.dhs.gov/students/travel'), $src('CBP I-94', 'https://i94.cbp.dhs.gov/')]],
        // ---- F-1 / OPT ----
        ['id' => 'opt-90', 'cat' => 'opt', 'who' => ['f1opt'], 't' => 'Post-completion OPT: report your job within 10 days, 90 days of unemployment at most', 'dl' => '10 days per change; 90 unemployment days in total', 's' => 'Report each employer (name, address, start and end date, supervisor, how the job relates to your degree) and your own address in the SEVP Portal or to your DSO within 10 days. You may not exceed 90 days without qualifying work.', 'd' => "- Work must relate directly to your major and be at least 20 hours a week.\n- Several concurrent jobs are fine if each one is reported.\n- Keep offer letters, pay stubs and a written explanation of how each job relates to your degree.", 'risk' => 'More than 90 unemployment days or unreported work is a status violation and blocks the STEM extension and future petitions.', 'src' => [$src('USCIS: Optional Practical Training', 'https://www.uscis.gov/working-in-the-united-states/students-and-exchange-visitors/optional-practical-training-opt-for-f-1-students'), $src('SEVP Portal help', 'https://studyinthestates.dhs.gov/sevp-portal-help')]],
        ['id' => 'opt-grace', 'cat' => 'opt', 'who' => ['f1opt', 'f1stem'], 't' => 'Grace period after OPT ends', 'dl' => '60 days (admitted for duration of status) or 30 days (fixed-date admission)', 's' => 'After your OPT or STEM OPT end date you have a grace period to leave, transfer to a new program, or change status. You may not work during it.', 'd' => "- Students admitted for \"duration of status\" (D/S) before 15 September 2026 keep the 60-day grace period.\n- Students admitted with a fixed I-94 end date under the 2026 rule get 30 days.\n- A timely filed change of status (for example H-1B) lets you stay while it is pending; the cap-gap rule covers H-1B registrants (see below).", 'risk' => 'Overstaying the grace period starts unlawful presence; 180+ days triggers a 3-year bar on re-entry.', 'src' => [$src('8 CFR 214.2(f)(5)', 'https://www.ecfr.gov/current/title-8/section-214.2'), $src('Chicago Immigration Lawyer: fixed admission periods (July 2026)', 'https://www.theusimmigrationlawyer.com/optional-practical-training-under-dhss-final-rule-part-ii-the-four-year-admission-cap-form-i-539-and-the-new-30-day-deadlines/')]],
        ['id' => 'opt-ds', 'cat' => 'opt', 'who' => ['f1opt', 'f1stem', 'f1cpt'], 't' => '2026 rule: F-1 admission now has a fixed end date', 'dl' => 'In force since 15 September 2026', 's' => 'New F-1 entrants are admitted until the program end date on the I-20 (at most 4 years) plus 30 days, instead of "duration of status". Staying longer - including for OPT - needs an extension of stay on Form I-539.', 'd' => "- Post-completion OPT: file Form I-765 no later than 30 days after your program end date, and the requested OPT start cannot be more than 30 days after it. If your I-94 does not cover the OPT period you also file Form I-539; work may begin only when both are approved.\n- STEM OPT keeps the 180-day automatic extension while the I-765 is pending, but may also need the I-539.\n- Transition relief: students admitted under D/S who file the I-765 by 18 March 2027 need no I-539 and keep the EAD-plus-60-days period. Leaving the U.S. before filing can forfeit this.\n- Check your I-94 end date after every entry; it - not the I-20 - now controls your stay.", 'risk' => 'Working or staying past the I-94 end date without a pending extension is a status violation and accrues unlawful presence.', 'src' => [$src('Morgan Lewis: New F-1 rule could delay OPT hiring (July 2026)', 'https://www.morganlewis.com/pubs/2026/07/new-f-1-rule-could-delay-opt-hiring-and-interrupt-employment'), $src('Chicago Immigration Lawyer: the four-year cap, I-539 and 30-day deadlines (July 2026)', 'https://www.theusimmigrationlawyer.com/optional-practical-training-under-dhss-final-rule-part-ii-the-four-year-admission-cap-form-i-539-and-the-new-30-day-deadlines/')]],
        ['id' => 'opt-capgap', 'cat' => 'opt', 'who' => ['f1opt', 'f1stem'], 't' => 'Cap-gap: from OPT to H-1B', 'dl' => 'Automatic once a timely H-1B change-of-status petition is filed', 's' => 'If StratEdge files your H-1B change-of-status petition while your OPT or STEM OPT is valid and it is selected, your F-1 status and work authorization extend automatically until 1 April of the fiscal year, or until the petition is decided.', 'd' => "- The extension comes from the H-1B modernization rule in force since 17 January 2025 (previously 1 October).\n- Ask your DSO for the cap-gap I-20 as proof for your employer's I-9.\n- If the petition is denied or withdrawn, the 60-day grace period starts from the denial.", 'risk' => 'A petition filed after your OPT expired gives no cap-gap; you would have to wait abroad.', 'src' => [$src('USCIS: Cap-gap extension', 'https://www.uscis.gov/working-in-the-united-states/temporary-workers/h-1b-specialty-occupations/extension-of-post-completion-optional-practical-training-opt-and-f-1-status-for-eligible-students'), $src('USCIS: H-1B modernization final rule', $uscisH1b)]],
        ['id' => 'opt-cpt', 'cat' => 'opt', 'who' => ['f1cpt'], 't' => 'CPT and on-campus work while enrolled', 'dl' => 'Authorization before the first day', 's' => 'Curricular Practical Training must be authorized by your DSO on page 2 of your I-20 for a specific employer and dates, as part of your curriculum. Twelve months or more of full-time CPT cancels your OPT eligibility.', 'd' => "- Part-time CPT (20 hours or fewer a week) does not affect OPT.\n- \"Day-1 CPT\" programs attract scrutiny in H-1B and green card cases; keep course records and transcripts.\n- Keep a full course load unless your DSO approves a reduced load.", 'risk' => 'Work outside the CPT dates or employer is unauthorized employment.', 'src' => [$src('Study in the States: Training opportunities', 'https://studyinthestates.dhs.gov/students/training-opportunities-in-the-united-states')]],
        // ---- H-1B ----
        ['id' => 'h1b-lca', 'cat' => 'h1b', 'who' => ['h1b', 'e3'], 't' => 'You may only work where your LCA says', 'dl' => 'New LCA and amended petition filed before you start at a new location', 's' => 'Your H-1B is tied to the worksites on the certified Labor Condition Application. A new client site, or regular work from a home address outside the metropolitan area of your LCA, needs a new LCA and an amended petition filed before you start there.', 'd' => "- Short-term placements of up to 30 days (60 in some cases) at another site are allowed under the DOL rules; anything longer needs the new LCA.\n- Moving within the same metropolitan statistical area needs a posted notice at the new site, not a new petition.\n- Tell HR before you accept a new project, change office, or move home - even for remote work.\n- The rule comes from Matter of Simeio Solutions (2015); third-party placements are reviewed against the end client's requirements under the 2025 modernization rule.", 'risk' => 'Working at an unapproved location is a status violation for you and a wage-and-hour case for the employer.', 'src' => [$src('USCIS Policy Memorandum: Matter of Simeio Solutions', 'https://www.uscis.gov/sites/default/files/document/memos/2015-0714_Simeio_Solutions_PM_Effective_07-21-2015.pdf'), $src('DOL: H-1B worksite and LCA rules (20 CFR 655)', 'https://www.ecfr.gov/current/title-20/part-655/subpart-H')]],
        ['id' => 'h1b-wage', 'cat' => 'h1b', 'who' => ['h1b', 'e3'], 't' => 'Your pay and your rights', 'dl' => 'Every pay period', 's' => 'You must receive the wage on the LCA for all time, including time between projects decided by the employer ("benching" is not allowed). The employer pays the petition fees; penalties for leaving early are not allowed; if dismissed early the employer owes your return transportation.', 'd' => "- The required wage is the higher of the prevailing wage and the actual wage paid to similar workers.\n- You may not be charged the filing fee, the ACWIA training fee, the fraud fee or the employer's attorney fees; H-4 costs and premium processing you request yourself are different.\n- Deductions that bring you under the required wage are unlawful.\n- Complaints go to the Department of Labor (Form WH-4); the law protects you from retaliation.", 'risk' => 'Unpaid wages are owed back with penalties; for you, long unpaid benching can be treated as a lapse in status.', 'src' => [$src('DOL Wage and Hour: H-1B program', $dolH1b), $src('20 CFR 655.731 required wage', 'https://www.ecfr.gov/current/title-20/section-655.731')]],
        ['id' => 'h1b-ext', 'cat' => 'h1b', 'who' => ['h1b', 'l1', 'tn', 'e3', 'o1'], 't' => 'Extensions and the 240-day rule', 'dl' => 'File up to 6 months before your I-94 or I-797 end date', 's' => 'USCIS accepts an extension petition up to 6 months before expiry. When it is filed before your current period ends, you may keep working for the same employer for up to 240 days past the expiry while it is pending.', 'd' => "- Premium processing (15 business days) is available for H-1B, L-1, O-1 and TN petitions.\n- H-1B time is capped at 6 years, minus days spent outside the U.S. (which you can recapture with travel records). Beyond that you need AC21: an approved I-140 (3-year extensions) or a PERM or I-140 filed at least 365 days earlier (1-year extensions).\n- The 240 days protect work authorization, not your right to travel: re-entry needs an approved extension or a valid period.", 'risk' => 'A petition filed after expiry leaves you out of status and without work authorization until approved.', 'src' => [$src('USCIS: H-1B specialty occupations', $uscisH1b), $src('8 CFR 274a.12(b)(20) - the 240-day rule', 'https://www.ecfr.gov/current/title-8/section-274a.12')]],
        ['id' => 'h1b-grace', 'cat' => 'h1b', 'who' => ['h1b', 'l1', 'tn', 'e3', 'o1', 'h4ead'], 't' => 'If your job ends: the 60-day grace period', 'dl' => 'Up to 60 consecutive days, or until your I-94 expires, whichever is first', 's' => 'After employment ends you are considered to keep your status for up to 60 days to have a new employer file a petition, to file a change of status, or to leave. You may not work in the grace period unless a new petition is received by USCIS (portability).', 'd' => "- One grace period per authorized validity period.\n- Day 1 is the day after your last paid day; a severance period does not extend it.\n- Options: new H-1B employer (start on receipt), change to B-2 to look for work, F-1 for a new program, H-4 through a spouse, or a compelling-circumstances EAD if your I-140 is approved and no visa number is available.", 'risk' => 'After day 60 you are out of status; departure and consular processing become the only route.', 'src' => [$src('USCIS: Options for nonimmigrant workers following termination', 'https://www.uscis.gov/newsroom/alerts/options-for-nonimmigrant-workers-following-termination-of-employment'), $src('8 CFR 214.1(l)(2)', 'https://www.ecfr.gov/current/title-8/section-214.1')]],
        ['id' => 'h1b-port', 'cat' => 'h1b', 'who' => ['h1b'], 't' => 'Changing employers (portability)', 'dl' => 'Start work when USCIS receives the new petition', 's' => 'Under AC21 §105 you may begin working for a new employer as soon as USCIS receives its non-frivolous H-1B petition, provided you were lawfully admitted, have not worked without authorization, and the petition was filed before your I-94 expired.', 'd' => "- Keep the receipt notice (I-797C) for your I-9 at the new employer.\n- Cap-exempt: a petition for someone already counted against the cap is not a new lottery entry.\n- Leaving StratEdge mid-project: review your agreement for notice terms; liquidated-damage clauses are enforceable only if they are not penalties.", 'risk' => 'Starting before USCIS receives the petition is unauthorized employment.', 'src' => [$src('USCIS: H-1B portability', $uscisH1b), $src('INA 214(n)', 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title8-section1184&num=0&edition=prelim')]],
        ['id' => 'h1b-travel', 'cat' => 'h1b', 'who' => ['h1b', 'l1', 'tn', 'e3', 'o1'], 't' => 'Travel and visa stamping', 'dl' => 'Before each trip', 's' => 'Carry your passport (valid 6+ months), a valid visa stamp or a consular appointment, the original I-797 approval, a copy of the LCA, three recent pay stubs and an employment verification letter from StratEdge.', 'd' => "- The I-94 you get on re-entry controls your status; if it is shorter than your I-797, your stay ends earlier.\n- Consular appointments can take months and \"221(g) administrative processing\" can hold your passport; do not travel during critical project dates without a plan.\n- The $100,000 payment required by the proclamation of 21 September 2025 (extended to 21 September 2027) applies to new petitions for workers outside the U.S.; it does not apply to extensions, to changes of status inside the U.S., or to holders of a valid H-1B visa, and federal courts have blocked its collection (Massachusetts, June 2026, left in place on appeal in July; California, 30 September 2026, covering the September 2026 renewal until a notice-and-comment rule is made) - confirm the current state with HR before you travel.\n- The executive order of 18 September 2026 has agencies weigh an employer's recent or planned layoffs of similar U.S. workers and review staffing arrangements more closely: keep your client letter and statement of work current.", 'risk' => 'A refused visa means waiting abroad; project continuity and pay stop.', 'src' => [$src('U.S. Department of State: Visa appointment wait times', 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/global-visa-wait-times.html'), $src('Greenberg Traurig: September 2026 H-1B changes', 'https://www.gtlaw-insidebusinessimmigration.com/h-1b/september-2026-h-1b-changes-new-compliance-scrutiny-and-extension-of-the-100000-entry-restriction/'), $src('The White House: proclamation of September 2026 (restriction on entry)', 'https://www.whitehouse.gov/presidential-actions/2026/09/restriction-on-entry-of-certain-nonimmigrant-workers-faad/'), $src('The White House: executive order of 18 September 2026 (H-1B program integrity)', 'https://www.whitehouse.gov/presidential-actions/2026/09/enhancing-program-integrity-and-integrity-and-interagency-coordination-in-the-administration-of-the-h-1b-nonimmigrant-visa-program/')]],
        ['id' => 'h1b-cap', 'cat' => 'h1b', 'who' => ['f1opt', 'f1stem', 'f1cpt', 'h4ead'], 't' => 'The H-1B lottery is now weighted by wage level', 'dl' => 'Registration each March; start 1 October', 's' => 'Since 27 February 2026 each registration gets entries according to the offered wage level: Level IV four entries, Level III three, Level II two, Level I one. Selection is per person, not per registration.', 'd' => "- FY 2027 registration ran 4-19 March 2026; expect a similar window each year.\n- A selected registration must be followed by a full petition within the filing window; change of status from F-1 avoids the overseas $100,000 payment.\n- Not selected: cap-exempt employers (universities, non-profit research), O-1, or another year on STEM OPT are the usual routes.", 'risk' => 'Missing the registration window means waiting a full year.', 'src' => [$src('USCIS: H-1B electronic registration process', 'https://www.uscis.gov/working-in-the-united-states/temporary-workers/h-1b-specialty-occupations/h-1b-electronic-registration-process'), $src('de Wit Law: What changed for the H-1B lottery in 2026', 'https://www.dewit.law/what-changed-for-the-h-1b-lottery-in-2026-and-what-employers-need-to-know/')]],
        ['id' => 'h1b-i94', 'cat' => 'h1b', 'who' => ['h1b', 'l1', 'tn', 'e3', 'o1', 'h4ead', 'f1opt', 'f1stem', 'f1cpt'], 't' => 'Your I-94 controls your status', 'dl' => 'Check it after every entry', 's' => 'The I-94 record issued by CBP - not the visa stamp and not the approval notice - sets when your permission to stay ends. Download it after each entry and compare it with your I-797 or I-20.', 'd' => "- Passport expiring before your petition end date: CBP admits you only to the passport date. Renew the passport and ask HR about a new I-94.\n- Wrong class or date on the I-94: it can be corrected at a CBP deferred inspection site.", 'risk' => 'Staying past the I-94 date accrues unlawful presence even with a valid approval notice.', 'src' => [$src('CBP: Get your I-94', 'https://i94.cbp.dhs.gov/')]],
        ['id' => 'h4', 'cat' => 'h1b', 'who' => ['h1b', 'h4ead'], 't' => 'Dependents: H-4 and the H-4 EAD', 'dl' => 'Extend together with the principal; renew EADs 180 days early', 's' => 'Your spouse\'s and children\'s H-4 status ends with yours, so extensions are filed together (Form I-539). An H-4 spouse may apply for an EAD once you have an approved I-140 or an AC21 extension beyond 6 years.', 'd' => "- EAD renewals filed after 30 October 2025 no longer get an automatic extension: file as early as 180 days before expiry and plan for a possible gap.\n- Children age out of H-4 at 21.", 'risk' => 'An H-4 spouse working on an expired EAD is unauthorized employment.', 'src' => [$src('USCIS: Employment authorization for certain H-4 spouses', 'https://www.uscis.gov/working-in-the-united-states/temporary-workers/h-1b-specialty-occupations/employment-authorization-for-certain-h-4-dependent-spouses'), $src('Cozen O\'Connor: End to automatic EAD extensions (Oct 2025)', 'https://www.cozen.com/news-resources/publications/2025/end-to-automatic-employment-authorization-document-extensions')]],
        // ---- Green card ----
        ['id' => 'gc-steps', 'cat' => 'gc', 'who' => ['h1b', 'l1', 'e3', 'o1', 'gcpend'], 't' => 'The employment-based green card in three steps', 'dl' => 'Start 18 months or more before your 6-year H-1B limit', 's' => 'PERM labor certification (prevailing wage, recruitment, Form ETA-9089) → Form I-140 immigrant petition (your priority date is the PERM filing date) → Form I-485 adjustment of status when the Visa Bulletin shows your date is current (or consular processing).', 'd' => "- Check the monthly Visa Bulletin for your category (EB-2, EB-3) and country of chargeability; USCIS announces each month whether \"Dates for Filing\" or \"Final Action Dates\" apply.\n- Premium processing exists for the I-140, not for PERM.\n- Keep every job description, degree, transcript and experience letter: the PERM job must match them.", 'risk' => 'Starting late can leave you without H-1B time; a gap in status can also stop the I-485.', 'src' => [$src('USCIS: Employment-based immigration', 'https://www.uscis.gov/working-in-the-united-states/permanent-workers'), $src('Department of State: Visa Bulletin', 'https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html')]],
        ['id' => 'gc-180', 'cat' => 'gc', 'who' => ['h1b', 'gcpend'], 't' => 'What 180 days buys you', 'dl' => 'Counted from the I-140 approval or the I-485 receipt', 's' => 'An I-140 approved for 180 days keeps your priority date even if the employer withdraws, and supports 3-year H-1B extensions beyond the 6-year limit. An I-485 pending for 180 days lets you move to a same-or-similar job with a new employer (Supplement J).', 'd' => "- File Form I-485 Supplement J when you change employers or positions after 180 days; the new job must be in the same or a similar occupational classification.\n- Before 180 days a job change can require a new PERM and I-140.", 'risk' => 'A job change too early or too different restarts the process.', 'src' => [$src('USCIS: Form I-485 Supplement J', 'https://www.uscis.gov/i-485supj'), $src('AC21 §104(c), §106(c)', 'https://www.uscis.gov/policy-manual/volume-7-part-e-chapter-5')]],
        ['id' => 'gc-ead', 'cat' => 'gc', 'who' => ['gcpend', 'h4ead'], 't' => 'EAD and Advance Parole renewals no longer extend automatically', 'dl' => 'File up to 180 days before expiry', 's' => 'For renewal applications received after 30 October 2025 the automatic extension of work authorization ended (TPS-related documents excepted). File early: USCIS accepts renewals 180 days before expiry and processing often takes 4 to 12 months.', 'd' => "- Keep your H-1B valid as a safety net while the I-485 is pending; an EAD gap then does not stop your work.\n- Do not travel without Advance Parole unless you hold a valid H-1B or L-1 visa and status; leaving with a pending I-485 and no parole abandons the application.\n- Tell HR the expiry dates so I-9 reverification is done on time.", 'risk' => 'Working after the EAD expires is unauthorized employment; the employer must stop you that day.', 'src' => [$src('Cozen O\'Connor: End to automatic EAD extensions (Oct 2025)', 'https://www.cozen.com/news-resources/publications/2025/end-to-automatic-employment-authorization-document-extensions'), $src('USCIS: Employment authorization document', 'https://www.uscis.gov/green-card/green-card-processes-and-procedures/employment-authorization-document')]],
        ['id' => 'gc-stay', 'cat' => 'gc', 'who' => ['h1b', 'gcpend'], 't' => 'Keep status and records clean until the card arrives', 'dl' => 'Throughout', 's' => 'Adjustment of status requires continuous lawful status and no unauthorized work since your last entry (INA 245(k) forgives up to 180 days in total for employment-based cases). Keep copies of every I-797, I-94, pay stub and tax return.', 'd' => "- Report address changes within 10 days (Form AR-11 updates pending cases).\n- Attend the biometrics appointment; reschedule only through USCIS.\n- Expect a Request for Evidence on experience letters or the medical exam (I-693, now filed with the I-485).", 'risk' => 'More than 180 days out of status or unauthorized work makes you ineligible to adjust in the U.S.', 'src' => [$src('USCIS Policy Manual Vol. 7 Part B (245(k))', 'https://www.uscis.gov/policy-manual/volume-7-part-b-chapter-8')]],
        // ---- Everyone ----
        ['id' => 'all-ar11', 'cat' => 'all', 'who' => 'nonciz', 't' => 'Change of address: Form AR-11 within 10 days', 'dl' => '10 days after moving', 's' => 'Every non-citizen must tell USCIS about a new address within 10 days of moving (Form AR-11, free, online). Tell HR the same day: payroll, I-9, state tax and - for H-1B - the LCA worksite check all depend on it.', 'd' => "- The online AR-11 can also update pending applications; otherwise notices go to the old address and cases are denied for non-response.\n- F-1 students also update the SEVP Portal or DSO within 10 days.\n- Update your driver's licence and bank within the state deadline.", 'risk' => 'Failing to report is a misdemeanour under INA §265 and is checked at every later benefit.', 'src' => [$src('USCIS: Change of address', $ar11)]],
        ['id' => 'all-i9', 'cat' => 'all', 'who' => 'all', 't' => 'Form I-9 and reverification', 'dl' => 'Section 1 on day one; Section 2 within 3 business days; reverify before authorization expires', 's' => 'You complete Section 1 by your first day and show documents from the List of Acceptable Documents within 3 business days. HR must reverify (Supplement B) before an EAD or I-94 expires - U.S. citizens and permanent residents are never reverified.', 'd' => "- Receipt notices count only in the specific cases the rules allow (for example a timely H-1B extension - 240 days, or the STEM OPT 180-day extension with the I-20).\n- E-Verify: a Tentative Nonconfirmation must be contested within 10 federal working days; the employer may not take action against you in the meantime.\n- Never present documents that are not yours; keep your own copies.", 'risk' => 'An expired authorization on file means you must stop working that day.', 'src' => [$src('USCIS: I-9 Central', 'https://www.uscis.gov/i-9-central'), $src('E-Verify: Employee rights', 'https://www.e-verify.gov/employees')]],
        ['id' => 'all-docs', 'cat' => 'all', 'who' => 'nonciz', 't' => 'Keep an immigration file', 'dl' => 'Always current', 's' => 'Passport pages, every visa, every I-94, I-20s and DS-2019s, EADs, I-797 approvals and receipts, LCAs, offer and client letters, the last 3 months of pay stubs, W-2s and tax returns. Scan them into the compliance documents here with their expiry dates.', 'd' => "- Petitions, extensions, green cards and naturalization all ask for this history.\n- Pay stubs prove you were paid the LCA wage and that you maintained status.", 'risk' => 'Missing proof of status is the most common reason for Requests for Evidence.', 'src' => [$src('USCIS: Forms and documents', 'https://www.uscis.gov/forms')]],
        ['id' => 'all-tax', 'cat' => 'all', 'who' => 'nonciz', 't' => 'Taxes: file every year, and FICA on F-1', 'dl' => 'Return due mid-April (Form 8843 for nonresident students even without income)', 's' => 'File a federal return every year (Form 1040 or 1040-NR) plus the state return where you lived and worked. F-1 students who are nonresident aliens for tax purposes - generally the first 5 calendar years - are exempt from Social Security and Medicare (FICA) withholding; H-1B workers pay it.', 'd' => "- The Substantial Presence Test decides resident or nonresident status; tell payroll when it changes so the W-4 and FICA are right.\n- Remote work from another state can create a state tax filing there.\n- Unfiled taxes surface in green card and naturalization reviews.", 'risk' => 'Wrong FICA withholding costs you 7.65% of pay; unfiled returns hurt later applications.', 'src' => [$src('IRS: Foreign student FICA exemption', 'https://www.irs.gov/individuals/international-taxpayers/foreign-student-liability-for-social-security-and-medicare-taxes'), $src('IRS: Substantial Presence Test', 'https://www.irs.gov/individuals/international-taxpayers/substantial-presence-test')]],
        ['id' => 'all-unauth', 'cat' => 'all', 'who' => 'nonciz', 't' => 'No work outside your authorization', 'dl' => 'Always', 's' => 'No side gigs on a 1099, no second employer without its own petition (concurrent H-1B), no work during a grace period, and no work for a new employer before the rule that allows it (portability receipt, STEM 180 days, the 240-day rule).', 'd' => "- Passive income (dividends, rent) is fine; running a business or freelancing is not.\n- Volunteering is allowed only where the work is genuinely unpaid for everyone.", 'risk' => 'Unauthorized employment bars adjustment of status beyond 245(k) and is a ground of inadmissibility.', 'src' => [$src('USCIS: Working in the United States', 'https://www.uscis.gov/working-in-the-united-states')]],
        ['id' => 'all-scam', 'cat' => 'all', 'who' => 'all', 't' => 'Scams, notarios and fake credentials', 'dl' => 'Always', 's' => 'USCIS does not call to demand money or threaten arrest; only attorneys and DOJ-accredited representatives may give immigration advice. Degrees from unaccredited schools and evaluations from unrecognized evaluators are refused in petitions.', 'd' => "- Verify callers through the USCIS Contact Center (800-375-5283) and report fraud at uscis.gov/report-fraud.\n- Use schools accredited by a CHEA- or USDE-recognized accreditor and credential evaluators that are NACES or AICE members (see the Credentials & accreditation course).", 'risk' => 'Fraudulent documents, even unknowingly bought, lead to denials and permanent bars.', 'src' => [$src('USCIS: Avoid scams', 'https://www.uscis.gov/scams-fraud-and-misconduct/avoid-scams'), $src('CHEA: Degree and accreditation mills', 'https://www.chea.org/degree-accreditation-mills')]],
        // ---- The employer's side ----
        ['id' => 'emp-lca', 'cat' => 'emp', 'who' => 'all', 't' => 'What StratEdge does for H-1B compliance', 'dl' => 'Per worksite and petition', 's' => 'A certified LCA for each worksite, the notice posted for 10 business days (or electronically), a Public Access File kept for a year after the last H-1B worker leaves, the required wage paid in full, amended petitions for new areas, and no fees passed to you.', 'd' => "- Site visits (USCIS FDNS) check that you work where, for whom, and at the pay the petition states: know your title, duties, supervisor, worksite and salary.\n- Benching is not used; between projects the LCA wage continues.\n- Client letters and statements of work are kept current for third-party placements.", 'risk' => 'Employer violations lead to back wages, fines and debarment; your petitions depend on a compliant employer.', 'src' => [$src('DOL Wage and Hour: H-1B employer obligations', $dolH1b)]],
        ['id' => 'emp-stem', 'cat' => 'emp', 'who' => ['f1opt', 'f1stem'], 't' => 'What StratEdge does for STEM OPT', 'dl' => 'Per trainee', 's' => 'E-Verify enrolment, a signed Form I-983 with a named supervisor and learning objectives, 20+ paid hours a week, a report to your DSO within 5 business days when employment ends, and the 12- and 24-month evaluations signed on time.', 'd' => "- Material changes to your role trigger an amended I-983 from us.\n- We keep the training plan and your evaluations in your HR file for DHS site visits.", 'risk' => 'An employer that cannot show the plan puts your STEM OPT at risk.', 'src' => [$src('Study in the States: Employer responsibilities', $sits . '/for-employers')]],
        ['id' => 'emp-i9', 'cat' => 'emp', 'who' => 'all', 't' => 'What StratEdge does for I-9 and E-Verify', 'dl' => 'Day one, day three, and before every expiry', 's' => 'Section 2 within 3 business days, E-Verify queries for STEM OPT and where required, reverification before any EAD or I-94 end date, and retention for 3 years after hire or 1 year after separation, whichever is later.', 'd' => "- This portal's compliance dashboard lists every reverification date for HR.\n- Remote verification uses the DHS alternative procedure where allowed.", 'risk' => 'Paperwork violations are fined per form; knowingly continuing an unauthorized worker is a separate offence.', 'src' => [$src('USCIS: I-9 Central - employers', 'https://www.uscis.gov/i-9-central')]],
    ];
}
function compRules(): array
{
    $d = docGet('comp/x/rules');
    $items = $d && isset($d->items) && is_array($d->items) ? array_values(array_filter(array_map(fn($x) => $x instanceof stdClass ? (array) $x : null, $d->items))) : [];
    // v45: rules nobody has edited (still the seeded built-in text) follow a newer review of the built-in library;
    // edited rules stay as the administrator left them (Admin › Compliance › Reset brings the new text)
    if (!$items || (!empty($d->seeded) && (string) ($d->rev ?? '') !== COMP_REVIEWED)) {
        $items = compDefaultRules();
        docSet('comp/x/rules', (object) ['items' => $items, 'rev' => COMP_REVIEWED, 'u' => now(), 'seeded' => true]);
    }
    return $items;
}
function compRuleApplies(array $r, string $st): bool
{
    $who = $r['who'] ?? 'all';
    if ($who === 'all') {
        return true;
    }
    if ($who === 'nonciz') {
        return !in_array($st, ['citizen', ''], true);
    }
    return is_array($who) && in_array($st, $who, true);
}

/** The person's own status record (comp/{uid}/profile) with defaults. */
function compProfile(string $uid): array
{
    $d = docGet("comp/$uid/profile");
    $p = $d ? (array) $d : [];
    $p['st'] = isset(COMP_STATUSES[$p['st'] ?? '']) ? $p['st'] : '';
    foreach (['optStart', 'optEnd', 'stemStart', 'stemEnd', 'eadExp', 'i94Exp', 'visaExp', 'passExp', 'h1bFirst', 'h1bExp', 'addrAt', 'pd', 'i140At', 'i485At', 'apExp', 'gcExp'] as $k) {
        $p[$k] = compValidDate($p[$k] ?? null) ? $p[$k] : '';
    }
    $p['ds'] = !empty($p['ds']);
    $p['stem'] = !empty($p['stem']);
    $p['h1bReg'] = !empty($p['h1bReg']);
    $p['deps'] = !empty($p['deps']);
    $p['moved'] = !empty($p['moved']);
    $p['working'] = !isset($p['working']) || !empty($p['working']);
    $p['gc'] = in_array($p['gc'] ?? '', ['none', 'perm', 'i140', 'i485'], true) ? $p['gc'] : 'none';
    $p['abroad'] = max(0, (int) ($p['abroad'] ?? 0));
    $p['unemp'] = array_values(array_filter(array_map(fn($x) => $x instanceof stdClass ? (array) $x : (is_array($x) ? $x : null), (array) ($p['unemp'] ?? [])), fn($x) => $x && compValidDate($x['from'] ?? null)));
    $p['evals'] = $p['evals'] ?? [];
    $p['evals'] = $p['evals'] instanceof stdClass ? (array) $p['evals'] : (array) $p['evals'];
    return $p;
}
/** Unemployment days used so far on OPT + STEM OPT: logged gaps plus the open gap when "not working now" is ticked. */
function compUnemployment(array $p, string $today): array
{
    $start = $p['optStart'] ?: ($p['stemStart'] ?: '');
    $end = $p['stemEnd'] ?: ($p['optEnd'] ?: '');
    $used = 0;
    $ranges = $p['unemp'];
    if (!$p['working'] && ($p['st'] === 'f1opt' || $p['st'] === 'f1stem')) {
        $open = $p['notWorkingSince'] ?? '';
        if (compValidDate($open)) {
            $ranges[] = ['from' => $open, 'to' => '', 'open' => true];
        }
    }
    foreach ($ranges as $r) {
        $f = $r['from'];
        $t = compValidDate($r['to'] ?? null) ? $r['to'] : $today;
        if ($start && $f < $start) {
            $f = $start;
        }
        if ($end && $t > $end) {
            $t = $end;
        }
        if ($t >= $f) {
            $used += compDays($f, $t) + 1;
        }
    }
    $limit = $p['st'] === 'f1stem' ? 150 : 90;
    return ['used' => $used, 'limit' => $limit, 'left' => max(0, $limit - $used)];
}
/** The checklist derived from the status and dates. Items are stable by id so "done" survives recomputation. */
function compTasks(string $uid, ?array $p = null, ?string $today = null): array
{
    $p = $p ?? compProfile($uid);
    $today = $today ?? date('Y-m-d');
    $st = $p['st'];
    $out = [];
    $add = function (string $id, string $ti, string $d, ?string $due, string $rule = '', string $kind = 'task', ?string $from = null) use (&$out) {
        $out[] = ['id' => $id, 'ti' => $ti, 'd' => $d, 'due' => $due ?: null, 'from' => $from, 'rule' => $rule, 'kind' => $kind];
    };
    if ($st === '' || $st === 'citizen') {
        if ($st === '') {
            $add('setup', 'Set your immigration status and dates', 'Pick your status and enter the dates from your documents; your checklist is built from them.', null, '', 'task');
        }
        return $out;
    }
    // everyone who is not a citizen
    if ($p['passExp']) {
        $add('pass-' . $p['passExp'], 'Renew your passport', 'Your passport expires on ' . $p['passExp'] . '. Consulates and petitions need 6 months of validity; CBP admits you only until the passport date.', compDateAdd($p['passExp'], -180), 'h1b-i94');
    }
    if ($p['moved'] && $p['addrAt']) {
        $add('ar11-' . $p['addrAt'], 'File Form AR-11 for your new address', 'You moved on ' . $p['addrAt'] . '. USCIS must have the new address within 10 days (online, free). Also tell HR' . (in_array($st, ['f1opt', 'f1stem', 'f1cpt'], true) ? ' and update the SEVP Portal or your DSO' : '') . '.', compDateAdd($p['addrAt'], 10), 'all-ar11');
        if (in_array($st, ['h1b', 'e3'], true)) {
            $add('lca-move-' . $p['addrAt'], 'Confirm your new address is inside your LCA area', 'If your new home is outside the metropolitan area of your LCA and you work from home, a new LCA and amended petition are needed before you work from there. Tell HR.', compDateAdd($p['addrAt'], 3), 'h1b-lca');
        }
    }
    $workExp = in_array($st, ['f1opt', 'f1stem', 'h4ead', 'gcpend'], true) ? ($p['eadExp'] ?: $p['i94Exp']) : ($p['i94Exp'] ?: $p['h1bExp']);
    if ($workExp && $st !== 'lpr') {
        $add('i9-' . $workExp, 'HR reverifies your work authorization', 'Your work authorization on file ends on ' . $workExp . '. Give HR the new document (EAD, I-94, I-797 receipt or I-20) before that day so Form I-9 can be reverified.', compDateAdd($workExp, -14), 'all-i9', 'hr');
    }
    if ($p['visaExp'] && $p['visaExp'] <= compDateAdd($today, 90)) {
        $add('visa-' . $p['visaExp'], 'Your visa stamp expires ' . $p['visaExp'], 'An expired stamp does not affect your status inside the U.S., but you need a valid one to re-enter after travel. Plan consular appointments early.', null, 'h1b-travel', 'info');
    }
    // F-1 on OPT
    if ($st === 'f1opt') {
        $un = compUnemployment($p, $today);
        $add('unemp', 'Unemployment used: ' . $un['used'] . ' of 90 days', 'Log every gap between jobs. Report each new employer in the SEVP Portal within 10 days.', null, 'opt-90', $un['used'] >= 75 ? 'task' : 'info');
        if ($p['stem'] && $p['optEnd']) {
            $add('stem-apply-' . $p['optEnd'], 'Apply for the 24-month STEM OPT extension', 'File Form I-765 between ' . compDateAdd($p['optEnd'], -90) . ' and ' . $p['optEnd'] . ' with the STEM I-20 from your DSO (employer-signed Form I-983 first). Filed on time, you may keep working up to 180 days past the EAD while it is pending.', compDateAdd($p['optEnd'], -30), 'stem-i765', 'task', compDateAdd($p['optEnd'], -90));
            $add('i983-' . $p['optEnd'], 'Get Form I-983 signed and the STEM I-20 issued', 'Ask HR for the training plan (I-983) at least 100 days before your OPT ends; the DSO needs it to issue the STEM OPT I-20, and the I-765 must be filed within 60 days of that I-20.', compDateAdd($p['optEnd'], -100), 'stem-i765');
        }
        if ($p['optEnd']) {
            $grace = $p['ds'] ? 60 : 30;
            $add('optend-' . $p['optEnd'], 'OPT ends ' . $p['optEnd'] . ' - grace period of ' . $grace . ' days', 'After that date you have ' . $grace . ' days to leave, start a new program or have a change of status filed. No work in the grace period unless cap-gap applies.', $p['optEnd'], 'opt-grace', 'info');
        }
        if ($p['h1bReg'] && $p['optEnd']) {
            $add('capgap-' . $p['optEnd'], 'Cap-gap: ask your DSO for the cap-gap I-20', 'Once StratEdge files the H-1B change-of-status petition, your status and work authorization continue automatically until 1 April; the cap-gap I-20 is your proof for the I-9.', compDateAdd($p['optEnd'], -30), 'opt-capgap');
        }
        if (!$p['ds'] && $p['i94Exp']) {
            $add('i539-' . $p['i94Exp'], 'Fixed I-94 end date ' . $p['i94Exp'] . ': extension of stay needed to stay longer', 'Under the 2026 rule your admission ends on the I-94 date. Any OPT, STEM OPT or change of status beyond it needs Form I-539 filed before that date (together with the I-765 where applicable).', compDateAdd($p['i94Exp'], -60), 'opt-ds');
        }
    }
    // STEM OPT
    if ($st === 'f1stem') {
        $un = compUnemployment($p, $today);
        $add('unemp', 'Unemployment used: ' . $un['used'] . ' of 150 days', 'The 150 days include the days used on post-completion OPT. Log every gap; a new employer needs a new Form I-983 within 10 days.', null, 'stem-unemp', $un['used'] >= 120 ? 'task' : 'info');
        if ($p['stemStart']) {
            foreach ([6, 12, 18, 24] as $m) {
                $due = compMonthAdd($p['stemStart'], $m);
                $key = 'v' . $m;
                if (!empty($p['evals'][$key])) {
                    continue;
                }
                $add('val-' . $m . '-' . $due, $m . '-month validation report to your DSO', 'Confirm name, address, employer and that you are still working. Window: ' . compDateAdd($due, -30) . ' to ' . compDateAdd($due, 10) . '.' . ($m === 12 || $m === 24 ? ' Send the Form I-983 evaluation with it.' : ''), compDateAdd($due, 10), 'stem-6mo', 'task', compDateAdd($due, -30));
            }
            if (empty($p['evals']['e12'])) {
                $d12 = compMonthAdd($p['stemStart'], 12);
                $add('eval-12-' . $d12, '12-month self-evaluation (Form I-983 page 5)', 'Write the evaluation against your training objectives, have your supervisor sign, give it to your DSO within 10 days of ' . $d12 . '.', compDateAdd($d12, 10), 'stem-eval', 'task', compDateAdd($d12, -30));
            }
            if (empty($p['evals']['e24'])) {
                $d24 = $p['stemEnd'] ?: compMonthAdd($p['stemStart'], 24);
                $add('eval-24-' . $d24, 'Final evaluation (Form I-983 page 5)', 'Due within 10 days of the end of your STEM OPT (' . $d24 . ') or of leaving this employer, whichever is first.', compDateAdd($d24, 10), 'stem-eval', 'task', compDateAdd($d24, -30));
            }
        }
        if ($p['stemEnd']) {
            $grace = $p['ds'] ? 60 : 30;
            $add('stemend-' . $p['stemEnd'], 'STEM OPT ends ' . $p['stemEnd'] . ' - what comes next', 'H-1B (cap registration in March, cap-gap protects you once the petition is filed), a new degree program, or departure within the ' . $grace . '-day grace period. Talk to HR about the H-1B plan a year ahead.', compDateAdd($p['stemEnd'], -365), 'opt-grace', 'task');
            if ($p['h1bReg']) {
                $add('capgap-' . $p['stemEnd'], 'Cap-gap: ask your DSO for the cap-gap I-20', 'Once the H-1B change-of-status petition is filed, status and work authorization continue automatically until 1 April.', compDateAdd($p['stemEnd'], -30), 'opt-capgap');
            }
        }
        if (!$p['ds'] && $p['i94Exp']) {
            $add('i539-' . $p['i94Exp'], 'Fixed I-94 end date ' . $p['i94Exp'] . ': extension of stay needed to stay longer', 'Any time beyond the I-94 date needs Form I-539 filed before it.', compDateAdd($p['i94Exp'], -60), 'opt-ds');
        }
        $add('stem-changes', 'Report changes within 10 days', 'New employer, employer address, title, duties, supervisor, hours, pay or your own address: tell your DSO within 10 days (new or amended I-983 for job changes).', null, 'stem-10day', 'info');
    }
    if ($st === 'f1cpt') {
        if ($p['i94Exp']) {
            $add('i94-' . $p['i94Exp'], 'Program end / I-94 date ' . $p['i94Exp'], 'Apply for OPT no later than 30 days after your program end date (and up to 90 days before). Under the 2026 rule, file Form I-539 with the I-765 if your I-94 does not cover the OPT period.', compDateAdd($p['i94Exp'], -90), 'opt-ds');
        }
        $add('cpt-auth', 'CPT must be on your I-20 before you start', 'Each employer and date range needs DSO authorization on page 2 of the I-20; 12 months of full-time CPT cancels OPT.', null, 'opt-cpt', 'info');
    }
    // H-1B and the other work statuses
    if (in_array($st, ['h1b', 'l1', 'tn', 'e3', 'o1'], true)) {
        $exp = $p['h1bExp'] ?: $p['i94Exp'];
        if ($exp) {
            $add('ext-' . $exp, 'Start your extension: status ends ' . $exp, 'HR can file up to 6 months before. Filed before expiry, you may keep working up to 240 days while it is pending. Send HR your passport, I-94, pay stubs and the client letter.', compDateAdd($exp, -180), 'h1b-ext', 'task', compDateAdd($exp, -210));
        }
        if ($p['i94Exp'] && $p['h1bExp'] && $p['i94Exp'] < $p['h1bExp']) {
            $add('i94short-' . $p['i94Exp'], 'Your I-94 (' . $p['i94Exp'] . ') ends before your approval (' . $p['h1bExp'] . ')', 'CBP admitted you for a shorter period - usually because of the passport expiry. Status ends on the I-94 date unless corrected or extended.', compDateAdd($p['i94Exp'], -120), 'h1b-i94');
        }
        if ($st === 'h1b' && $p['h1bFirst']) {
            $max = compDateAdd(compMonthAdd($p['h1bFirst'], 72), $p['abroad']);
            $add('max-' . $max, 'Six-year H-1B limit: about ' . $max, 'Extensions beyond it need an approved I-140 or a PERM/I-140 filed 365+ days earlier. ' . ($p['gc'] === 'none' ? 'No green card step is recorded yet - raise it with HR now.' : 'Keep the green card process moving.'), $p['gc'] === 'none' ? compDateAdd($max, -540) : compDateAdd($max, -365), 'gc-steps', $p['gc'] === 'none' ? 'task' : 'info');
        }
        if ($st === 'h1b' || $st === 'e3') {
            $add('lca', 'Worksite check before any project change', 'Tell HR before you start at a new client site or work from a new address outside your LCA area (' . ($p['lcaArea'] ?? 'your LCA area') . '): a new LCA and amended petition must be filed first.', null, 'h1b-lca', 'info');
        }
        if ($p['deps']) {
            $add('h4-' . ($exp ?: 'x'), 'Extend your dependents with you', 'H-4 (or L-2/TD) status ends with yours; file Form I-539 together with your extension. H-4 EAD renewals: 180 days early, no automatic extension.', $exp ? compDateAdd($exp, -180) : null, 'h4');
        }
        if ($p['gc'] === 'none' && $st === 'h1b') {
            $add('gc-start', 'Plan the green card timeline with HR', 'PERM, I-140 and I-485 take years; start at least 18 months before your six-year limit.', null, 'gc-steps', 'info');
        }
    }
    if ($st === 'h4ead') {
        if ($p['eadExp']) {
            $add('ead-' . $p['eadExp'], 'Renew your H-4 EAD: expires ' . $p['eadExp'], 'File Form I-765 up to 180 days before expiry. Renewals no longer extend automatically, so a late filing means a gap in work authorization.', compDateAdd($p['eadExp'], -180), 'gc-ead', 'task', compDateAdd($p['eadExp'], -200));
        }
        if ($p['i94Exp']) {
            $add('h4ext-' . $p['i94Exp'], 'H-4 status ends ' . $p['i94Exp'], 'Extend together with the principal H-1B (Form I-539).', compDateAdd($p['i94Exp'], -180), 'h4');
        }
    }
    // green card
    if ($p['gc'] === 'perm') {
        $add('gc-perm', 'PERM in progress' . ($p['pd'] ? ' - priority date ' . $p['pd'] : ''), 'Keep your job description, degree and experience letters ready for the I-140; check the Visa Bulletin monthly.', null, 'gc-steps', 'info');
    }
    if ($p['gc'] === 'i140') {
        if ($p['i140At']) {
            $d180 = compDateAdd($p['i140At'], 180);
            $add('i140-180-' . $d180, 'I-140 approved ' . $p['i140At'] . ': 180-day mark ' . $d180, 'From then your priority date is yours to keep and 3-year H-1B extensions beyond 6 years are available.', $d180, 'gc-180', 'info');
        }
        $add('gc-vb', 'Watch the Visa Bulletin for your priority date' . ($p['pd'] ? ' (' . $p['pd'] . ')' : ''), 'When "Dates for Filing" (or Final Action, as USCIS announces monthly) passes your date, the I-485 can be filed. Keep your medical exam and documents ready.', null, 'gc-steps', 'info');
    }
    if ($p['gc'] === 'i485' || $st === 'gcpend') {
        if ($p['eadExp']) {
            $add('ead-' . $p['eadExp'], 'Renew your EAD/Advance Parole: expires ' . $p['eadExp'], 'File Forms I-765 and I-131 up to 180 days before expiry. No automatic extension for renewals filed after 30 October 2025; keep your H-1B valid as a backup.', compDateAdd($p['eadExp'], -180), 'gc-ead', 'task', compDateAdd($p['eadExp'], -200));
        }
        if ($p['apExp'] && $p['apExp'] !== $p['eadExp']) {
            $add('ap-' . $p['apExp'], 'Advance Parole expires ' . $p['apExp'], 'Do not leave the U.S. without valid parole unless you hold valid H-1B/L-1 status and visa.', compDateAdd($p['apExp'], -180), 'gc-ead');
        }
        if ($p['i485At']) {
            $d180 = compDateAdd($p['i485At'], 180);
            $add('i485-180-' . $d180, 'I-485 pending since ' . $p['i485At'] . ': portability from ' . $d180, 'After 180 days you may change to a same-or-similar job with Supplement J. Before that, keep the sponsoring job.', $d180, 'gc-180', 'info');
        }
        $add('gc-addr', 'Keep USCIS informed while the case is pending', 'AR-11 within 10 days of moving (it updates the pending case), attend biometrics, answer RFEs by their deadline.', null, 'gc-stay', 'info');
    }
    if ($st === 'lpr' && $p['gcExp']) {
        $add('i90-' . $p['gcExp'], 'Green card expires ' . $p['gcExp'] . ': file Form I-90', 'File up to 6 months before expiry; the receipt extends the card for I-9 and travel.', compDateAdd($p['gcExp'], -180), 'all-i9');
    }
    return $out;
}
/** Tasks with their done state, sorted: overdue, due soon, dated, undated, info. */
function compChecklist(string $uid, ?string $today = null): array
{
    $today = $today ?? date('Y-m-d');
    $p = compProfile($uid);
    $state = docGet("comp/$uid/state");
    $done = $state && isset($state->done) && $state->done instanceof stdClass ? (array) $state->done : [];
    $tasks = compTasks($uid, $p, $today);
    foreach ($tasks as &$t) {
        $t['done'] = isset($done[$t['id']]) ? (int) $done[$t['id']] : null;
        $t['days'] = $t['due'] ? compDays($today, $t['due']) : null;
        $t['sev'] = $t['done'] ? 'done' : ($t['kind'] === 'info' ? 'info' : ($t['due'] === null ? 'open' : ($t['days'] < 0 ? 'late' : ($t['days'] <= 30 ? 'soon' : 'later'))));
    }
    unset($t);
    $rank = ['late' => 0, 'soon' => 1, 'later' => 2, 'open' => 3, 'info' => 4, 'done' => 5];
    usort($tasks, fn($a, $b) => [$rank[$a['sev']], $a['due'] ?? '9999'] <=> [$rank[$b['sev']], $b['due'] ?? '9999']);
    return ['profile' => $p, 'tasks' => $tasks, 'unemp' => in_array($p['st'], ['f1opt', 'f1stem'], true) ? compUnemployment($p, $today) : null, 'today' => $today];
}
/** Every person with a compliance profile (for HR) - consultants and employees who filled in their status. */
function compPeople(): array
{
    $s = db()->query("SELECT path, data FROM docs WHERE path LIKE 'comp/%/profile' AND path NOT LIKE 'comp/x/%'");
    $out = [];
    while ($r = $s->fetch()) {
        $uid = explode('/', $r['path'])[1];
        $out[$uid] = compProfile($uid);
    }
    return $out;
}
function compSummary(string $uid, string $today): array
{
    $c = compChecklist($uid, $today);
    $open = array_filter($c['tasks'], fn($t) => !$t['done'] && $t['kind'] !== 'info');
    $late = array_filter($open, fn($t) => $t['sev'] === 'late');
    $soon = array_filter($open, fn($t) => $t['sev'] === 'soon');
    $next = null;
    foreach ($c['tasks'] as $t) {
        if (!$t['done'] && $t['due'] && $t['kind'] !== 'info' && $t['due'] >= $today) {
            if ($next === null || $t['due'] < $next['due']) {
                $next = ['due' => $t['due'], 'ti' => $t['ti']];
            }
        }
    }
    $p = $c['profile'];
    $workExp = in_array($p['st'], ['f1opt', 'f1stem', 'h4ead', 'gcpend'], true) ? ($p['eadExp'] ?: $p['i94Exp']) : ($p['i94Exp'] ?: $p['h1bExp']);
    return ['uid' => $uid, 'st' => $p['st'], 'stName' => COMP_STATUSES[$p['st']] ?? '', 'late' => count($late), 'soon' => count($soon), 'open' => count($open), 'next' => $next, 'workExp' => $workExp ?: null, 'passExp' => $p['passExp'] ?: null, 'unemp' => $c['unemp'], 'gc' => $p['gc'], 'u' => (int) ($p['u'] ?? 0)];
}
/** Daily reminders: 14 and 3 days before a due date and the day after; each sent once per task. */
function compCron(): array
{
    $today = date('Y-m-d');
    $n = 0;
    $people = 0;
    foreach (compPeople() as $uid => $p) {
        $people++;
        $u = userRow($uid);
        if (!$u || ($u['status'] ?? 'active') !== 'active' || !filter_var($u['email'] ?? '', FILTER_VALIDATE_EMAIL)) {
            continue;
        }
        $c = compChecklist($uid, $today);
        $state = docGet("comp/$uid/state") ?? new stdClass();
        $sent = isset($state->sent) && $state->sent instanceof stdClass ? $state->sent : new stdClass();
        $tried = isset($state->tried) && $state->tried instanceof stdClass ? $state->tried : new stdClass();
        $changed = false;
        foreach ($c['tasks'] as $t) {
            if ($t['done'] || !$t['due'] || $t['kind'] === 'info') {
                continue;
            }
            $mark = $t['days'] === 14 ? '14' : ($t['days'] === 3 ? '3' : ($t['days'] === -1 ? 'late' : null));
            if ($mark === null) {
                continue;
            }
            $k = $t['id'];
            $had = isset($sent->$k) && is_array($sent->$k) ? $sent->$k : [];
            if (in_array($mark, $had, true) || ($tried->$k ?? '') === $today . ':' . $mark) {
                continue;
            }
            // one attempt per task and day: a mail server that is down does not fill the sent log every few minutes
            $tried->$k = $today . ':' . $mark;
            $changed = true;
            $subject = ($mark === 'late' ? 'Overdue: ' : ($mark === '3' ? 'Due in 3 days: ' : 'Due in 2 weeks: ')) . $t['ti'];
            $link = siteUrl() . '/#/portal/compliance';
            $paras = [$t['ti'] . ' - due ' . $t['due'] . '.', $t['d'], 'Open your compliance checklist to tick it off, see the rule behind it and the documents to keep.'];
            if (sendMail((string) $u['email'], (string) ($u['name'] ?? ''), $subject, implode("\n\n", $paras) . "\n\n$link", emailHtml($subject, $paras, ['Open my checklist', $link], 'Reminders come from your status and dates in the StratEdge portal. This is not legal advice; confirm deadlines with your DSO or attorney.'))) {
                $had[] = $mark;
                $sent->$k = $had;
                $n++;
            }
        }
        if ($changed) {
            $state->sent = $sent;
            $state->tried = $tried;
            docSet("comp/$uid/state", $state);
        }
    }
    return ['people' => $people, 'sent' => $n];
}

function compRoute(string $r, array $b): void
{
    switch ($r) {
        case 'comp_rules':
            requireUser();
            ok(['items' => compRules(), 'statuses' => COMP_STATUSES, 'cats' => COMP_CATS, 'rev' => COMP_REVIEWED]);
        case 'comp_rules_save':
            compStaff(true);
            $items = [];
            foreach ((array) ($b['items'] ?? []) as $x) {
                $x = (array) $x;
                $id = preg_replace('/[^a-z0-9\-]/', '', strtolower((string) ($x['id'] ?? '')));
                if ($id === '' || trim((string) ($x['t'] ?? '')) === '') {
                    continue;
                }
                $who = $x['who'] ?? 'all';
                if (is_array($who)) {
                    $who = array_values(array_filter(array_map('strval', $who), fn($w) => isset(COMP_STATUSES[$w])));
                } elseif (!in_array($who, ['all', 'nonciz'], true)) {
                    $who = 'all';
                }
                $items[] = ['id' => $id, 'cat' => isset(COMP_CATS[$x['cat'] ?? '']) ? $x['cat'] : 'all', 'who' => $who, 't' => mb_substr(trim((string) $x['t']), 0, 160), 'dl' => mb_substr((string) ($x['dl'] ?? ''), 0, 200), 's' => mb_substr((string) ($x['s'] ?? ''), 0, 1200), 'd' => mb_substr((string) ($x['d'] ?? ''), 0, 4000), 'risk' => mb_substr((string) ($x['risk'] ?? ''), 0, 600), 'src' => array_values(array_filter(array_map(fn($s) => is_array($s) || $s instanceof stdClass ? ['l' => mb_substr((string) (((array) $s)['l'] ?? ''), 0, 160), 'u' => mb_substr((string) (((array) $s)['u'] ?? ''), 0, 400)] : null, (array) ($x['src'] ?? [])), fn($s) => $s && $s['u'] !== '' && preg_match('#^https?://#', $s['u'])))];
            }
            if (count($items) > 200) {
                fail(400, 'invalid_argument', 'At most 200 rules.');
            }
            docSet('comp/x/rules', (object) ['items' => $items, 'rev' => COMP_REVIEWED, 'u' => now(), 'by' => currentUser()['id'] ?? '']);
            ok(['items' => $items]);
        case 'comp_rules_reset':
            compStaff(true);
            $items = compDefaultRules();
            docSet('comp/x/rules', (object) ['items' => $items, 'rev' => COMP_REVIEWED, 'u' => now(), 'seeded' => true]);
            ok(['items' => $items]);
        case 'comp_me':
            $u = requireUser();
            $uid = (string) ($b['uid'] ?? ($_GET['uid'] ?? ''));
            if ($uid !== '' && $uid !== $u['id']) {
                compStaff(false);
            } else {
                $uid = $u['id'];
            }
            ok(compChecklist($uid));
        case 'comp_profile_save':
            $u = requireUser();
            $uid = (string) ($b['uid'] ?? '');
            if ($uid !== '' && $uid !== $u['id']) {
                compStaff(true);
            } else {
                $uid = $u['id'];
            }
            $in = (array) ($b['profile'] ?? []);
            $p = new stdClass();
            $p->st = isset(COMP_STATUSES[$in['st'] ?? '']) ? $in['st'] : '';
            foreach (['optStart', 'optEnd', 'stemStart', 'stemEnd', 'eadExp', 'i94Exp', 'visaExp', 'passExp', 'h1bFirst', 'h1bExp', 'addrAt', 'pd', 'i140At', 'i485At', 'apExp', 'gcExp', 'notWorkingSince'] as $k) {
                $p->$k = compValidDate($in[$k] ?? null) ? $in[$k] : '';
            }
            foreach (['ds', 'stem', 'h1bReg', 'deps', 'moved'] as $k) {
                $p->$k = !empty($in[$k]);
            }
            $p->working = !isset($in['working']) || !empty($in['working']);
            $p->gc = in_array($in['gc'] ?? '', ['none', 'perm', 'i140', 'i485'], true) ? $in['gc'] : 'none';
            $p->abroad = max(0, min(2000, (int) ($in['abroad'] ?? 0)));
            foreach (['lcaArea', 'school', 'dso', 'dsoEmail', 'attorney', 'attorneyEmail', 'sevis', 'receipt', 'notes', 'cat'] as $k) {
                $p->$k = mb_substr(trim((string) ($in[$k] ?? '')), 0, $k === 'notes' ? 2000 : 160);
            }
            $un = [];
            foreach ((array) ($in['unemp'] ?? []) as $x) {
                $x = (array) $x;
                if (compValidDate($x['from'] ?? null)) {
                    $un[] = ['from' => $x['from'], 'to' => compValidDate($x['to'] ?? null) ? $x['to'] : '', 'note' => mb_substr((string) ($x['note'] ?? ''), 0, 160)];
                }
                if (count($un) >= 40) {
                    break;
                }
            }
            $p->unemp = $un;
            $ev = new stdClass();
            foreach ((array) ($in['evals'] ?? []) as $k => $v) {
                if (preg_match('/^(v6|v12|v18|v24|e12|e24)$/', (string) $k) && compValidDate(is_string($v) ? $v : null)) {
                    $ev->$k = $v;
                }
            }
            $p->evals = $ev;
            $p->u = now();
            $p->by = $u['id'];
            docSet("comp/$uid/profile", $p);
            ok(compChecklist($uid));
        case 'comp_task_done':
            $u = requireUser();
            $uid = (string) ($b['uid'] ?? '');
            if ($uid !== '' && $uid !== $u['id']) {
                compStaff(true);
            } else {
                $uid = $u['id'];
            }
            $id = preg_replace('/[^A-Za-z0-9\-_.]/', '', (string) ($b['id'] ?? ''));
            if ($id === '') {
                fail(400, 'invalid_argument', 'Which task?');
            }
            $state = docGet("comp/$uid/state") ?? new stdClass();
            if (!isset($state->done) || !($state->done instanceof stdClass)) {
                $state->done = new stdClass();
            }
            if (!empty($b['undo'])) {
                unset($state->done->$id);
            } else {
                $state->done->$id = now();
            }
            $log = isset($state->log) && is_array($state->log) ? $state->log : [];
            $log[] = ['at' => now(), 'id' => $id, 'by' => $u['id'], 'x' => !empty($b['undo'])];
            $state->log = array_slice($log, -200);
            docSet("comp/$uid/state", $state);
            ok(compChecklist($uid));
        case 'comp_overview':
            compStaff(false);
            $today = date('Y-m-d');
            $rows = [];
            foreach (array_keys(compPeople()) as $uid) {
                $u = userRow($uid);
                if (!$u) {
                    continue;
                }
                $rows[] = compSummary($uid, $today) + ['n' => (string) ($u['name'] ?? ''), 'e' => (string) ($u['email'] ?? ''), 'role' => (string) ($u['role'] ?? ''), 'status' => (string) ($u['status'] ?? '')];
            }
            usort($rows, fn($a, $b) => [$b['late'], $b['soon'], $a['next']['due'] ?? '9999'] <=> [$a['late'], $a['soon'], $b['next']['due'] ?? '9999']);
            // people without a profile yet
            $missing = [];
            $have = array_column($rows, 'uid');
            foreach (colAll('u') as [$id, $d]) {
                $role = (string) ($d->p->role ?? '');
                if (in_array($role, ['consultant', 'employee'], true) && !in_array($id, $have, true)) {
                    $ur = userRow((string) $id);
                    if ($ur && ($ur['status'] ?? 'active') === 'active') {
                        $missing[] = ['uid' => (string) $id, 'n' => (string) ($d->p->n ?? $ur['name'] ?? ''), 'role' => $role];
                    }
                }
            }
            ok(['rows' => $rows, 'missing' => $missing, 'today' => $today]);
        case 'comp_cron':
            compStaff(true);
            ok(compCron());
    }
    fail(404, 'not_found', 'Unknown action.');
}
