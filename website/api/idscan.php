<?php
declare(strict_types=1);
/*
  v36.1: ID checks (routes ids_*). Spots fake or altered US driver's licenses, state ID cards and Permanent Resident
  Cards (green cards) that candidates, consultants and vendors send.

   - Driver's licenses and state IDs: the PDF417 barcode on the back (read in the browser) is checked against the
     AAMVA standard (header, issuer number = state, required fields, dates, codes) and against the front.
   - Green cards: the three machine-readable lines on the back (ICAO 9303 TD1: C1/C2 + USA + A-number, dates, country
     of birth, name) are checked digit by digit (7-3-1 check digits, composite) and against the front.
   - Both: the picture's metadata (editing software, screenshots, size), the same picture or the same document number
     already checked for someone else, and the name on the ID against the person it is linked to.
   - Optional (an administrator switches it on): StratEdge AI reads the front and the back from the pictures.
   v36.3: the browser reads the green card's lines itself (js/idread.js: OCR-B, check digits) from a picture, a PDF or
   the camera, and reads the front (Tesseract, js/vendor/tesseract) to find the back's name, birth date, number and
   expiry on it; nothing is sent to an outside service. ID links (sec/idreq/items): a one-time, expiring link a person
   opens to scan or upload their ID; their pictures arrive as a pending check that the checker's browser reads again
   (what the person's phone claimed to read is compared, never trusted) before the result is recorded.
  Verdicts: ok ("Looks genuine": every check passed), fake ("Looks fake": a check that a genuine document passes failed),
  unsure ("Can't tell": something needed could not be read or compared). A person records the decision.

  What is kept: the result of each check (no values read from the document), the pictures (encrypted at rest, deleted
  after the retention period), a masked number (last 4) and a one-way fingerprint of the document number to spot reuse.
  Nothing read from a license barcode is stored (several states restrict keeping that data).
  Not a Form I-9 tool: the page and README say so (DOJ IER: no different scrutiny by document type or citizenship).
  Data: sec/idscan/items/{id} (scans; pictures under sec/idscan/{id}/f), sec/x/idscan (settings, acknowledgements).
*/

const IDS_IIN = [
    '636000' => ['VA', 'Virginia'], '636001' => ['NY', 'New York'], '636002' => ['MA', 'Massachusetts'], '636003' => ['MD', 'Maryland'],
    '636004' => ['NC', 'North Carolina'], '636005' => ['SC', 'South Carolina'], '636006' => ['CT', 'Connecticut'], '636007' => ['LA', 'Louisiana'],
    '636008' => ['MT', 'Montana'], '636009' => ['NM', 'New Mexico'], '636010' => ['FL', 'Florida'], '636011' => ['DE', 'Delaware'],
    '636014' => ['CA', 'California'], '636015' => ['TX', 'Texas'], '636018' => ['IA', 'Iowa'], '636019' => ['GU', 'Guam'],
    '636020' => ['CO', 'Colorado'], '636021' => ['AR', 'Arkansas'], '636022' => ['KS', 'Kansas'], '636023' => ['OH', 'Ohio'],
    '636024' => ['VT', 'Vermont'], '636025' => ['PA', 'Pennsylvania'], '636026' => ['AZ', 'Arizona'], '636027' => ['US', 'U.S. State Department'],
    '636029' => ['OR', 'Oregon'], '636030' => ['MO', 'Missouri'], '636031' => ['WI', 'Wisconsin'], '636032' => ['MI', 'Michigan'],
    '636033' => ['AL', 'Alabama'], '636034' => ['ND', 'North Dakota'], '636035' => ['IL', 'Illinois'], '636036' => ['NJ', 'New Jersey'],
    '636037' => ['IN', 'Indiana'], '636038' => ['MN', 'Minnesota'], '636039' => ['NH', 'New Hampshire'], '636040' => ['UT', 'Utah'],
    '636041' => ['ME', 'Maine'], '636042' => ['SD', 'South Dakota'], '636043' => ['DC', 'District of Columbia'], '636045' => ['WA', 'Washington'],
    '636046' => ['KY', 'Kentucky'], '636047' => ['HI', 'Hawaii'], '636049' => ['NV', 'Nevada'], '636050' => ['ID', 'Idaho'],
    '636051' => ['MS', 'Mississippi'], '636052' => ['RI', 'Rhode Island'], '636053' => ['TN', 'Tennessee'], '636054' => ['NE', 'Nebraska'],
    '636055' => ['GA', 'Georgia'], '636058' => ['OK', 'Oklahoma'], '636059' => ['AK', 'Alaska'], '636060' => ['WY', 'Wyoming'],
    '636061' => ['WV', 'West Virginia'], '636062' => ['VI', 'U.S. Virgin Islands'], '604427' => ['AS', 'American Samoa'], '604430' => ['MP', 'Northern Mariana Islands'],
    '604431' => ['PR', 'Puerto Rico'],
    // Canada (accepted, named)
    '604426' => ['PE', 'Prince Edward Island'], '604428' => ['QC', 'Quebec'], '604429' => ['YT', 'Yukon'], '604432' => ['AB', 'Alberta'],
    '604433' => ['NU', 'Nunavut'], '604434' => ['NT', 'Northwest Territories'], '636012' => ['ON', 'Ontario'], '636013' => ['NS', 'Nova Scotia'],
    '636016' => ['NL', 'Newfoundland and Labrador'], '636017' => ['NB', 'New Brunswick'], '636028' => ['BC', 'British Columbia'], '636044' => ['SK', 'Saskatchewan'],
    '636048' => ['MB', 'Manitoba'],
];
const IDS_CANADA = ['PE', 'QC', 'YT', 'AB', 'NU', 'NT', 'ON', 'NS', 'NL', 'NB', 'BC', 'SK', 'MB'];
// the usual shapes of license numbers (a hint only: shapes change and some states have several)
const IDS_DL_SHAPE = [
    'AL' => '^\d{1,8}$', 'AK' => '^\d{1,7}$', 'AZ' => '^([A-Z]\d{8}|\d{9})$', 'AR' => '^\d{4,9}$', 'CA' => '^[A-Z]\d{7}$',
    'CO' => '^(\d{9}|[A-Z]\d{3,6}|[A-Z]{2}\d{2,5})$', 'CT' => '^\d{9}$', 'DE' => '^\d{1,7}$', 'DC' => '^(\d{7}|\d{9})$', 'FL' => '^[A-Z]\d{12}$',
    'GA' => '^\d{7,9}$', 'HI' => '^([A-Z]\d{8}|\d{9})$', 'ID' => '^([A-Z]{2}\d{6}[A-Z]|\d{9})$', 'IL' => '^[A-Z]\d{11,12}$', 'IN' => '^([A-Z]\d{9}|\d{9,10})$',
    'IA' => '^(\d{9}|\d{3}[A-Z]{2}\d{4})$', 'KS' => '^([A-Z]\d[A-Z]\d[A-Z]|[A-Z]\d{8}|\d{9})$', 'KY' => '^([A-Z]\d{8,9}|\d{9})$', 'LA' => '^\d{1,9}$',
    'ME' => '^(\d{7,8}|\d{7}[A-Z])$', 'MD' => '^([A-Z]\d{12}|MD\d{11})$', 'MA' => '^([A-Z]\d{8}|\d{9})$', 'MI' => '^([A-Z]\d{10}|[A-Z]\d{12})$',
    'MN' => '^[A-Z]\d{12}$', 'MS' => '^\d{9}$', 'MO' => '^([A-Z]\d{5,9}|[A-Z]\d{6}R|\d{8}[A-Z]{2}|\d{9}[A-Z]|\d{9})$', 'MT' => '^([A-Z]\d{8}|\d{9}|\d{13,14})$',
    'NE' => '^[A-Z]\d{6,8}$', 'NV' => '^(\d{9,10}|\d{12}|X\d{8})$', 'NH' => '^(\d{2}[A-Z]{3}\d{5}|NHL\d{8})$', 'NJ' => '^[A-Z]\d{14}$', 'NM' => '^\d{8,9}$',
    'NY' => '^([A-Z]\d{7}|[A-Z]\d{18}|\d{8,9}|\d{16}|[A-Z]{8})$', 'NC' => '^\d{1,12}$', 'ND' => '^([A-Z]{3}\d{6}|\d{9})$', 'OH' => '^([A-Z]\d{4,8}|[A-Z]{2}\d{3,7}|\d{8})$',
    'OK' => '^([A-Z]\d{9}|\d{9})$', 'OR' => '^(\d{1,9}|[A-Z]\d{6}|[A-Z]{2}\d{5})$', 'PA' => '^\d{8}$', 'RI' => '^(\d{7}|[A-Z]\d{6})$', 'SC' => '^\d{5,11}$',
    'SD' => '^(\d{6,10}|\d{12})$', 'TN' => '^\d{7,9}$', 'TX' => '^\d{7,8}$', 'UT' => '^\d{4,10}$', 'VT' => '^(\d{8}|\d{7}A)$', 'VA' => '^([A-Z]\d{8,11}|\d{9})$',
    'WA' => '^([A-Z*]{7}\d{3}[A-Z0-9]{2}|WDL[A-Z0-9]{9})$', 'WV' => '^(\d{7}|[A-Z]{1,2}\d{5,6})$', 'WI' => '^[A-Z]\d{13}$', 'WY' => '^\d{9,10}$',
];
const IDS_EYES = ['BLK', 'BLU', 'BRO', 'GRY', 'GRN', 'HAZ', 'MAR', 'PNK', 'DIC', 'UNK'];
// the AAMVA elements every card from the 2005 standard on carries (driver's licenses also have DCA, DCB, DCD)
const IDS_REQ = ['DAQ' => 'license number', 'DCS' => 'family name', 'DBB' => 'date of birth', 'DBA' => 'expiry date', 'DBD' => 'issue date', 'DBC' => 'sex', 'DAG' => 'street address', 'DAI' => 'city', 'DAJ' => 'state', 'DAK' => 'postal code', 'DCF' => 'document discriminator', 'DCG' => 'country'];
// USCIS service centers and offices seen at the start of green card numbers
const IDS_SC = ['EAC', 'WAC', 'LIN', 'SRC', 'NBC', 'MSC', 'IOE', 'YSC', 'ESC', 'CSC', 'NSC', 'TSC', 'VSC', 'LSC', 'ZLA', 'ZNY', 'ZSF', 'ZHN', 'ZMI'];
const IDS_ISO3 = 'AFG ALA ALB DZA ASM AND AGO AIA ATA ATG ARG ARM ABW AUS AUT AZE BHS BHR BGD BRB BLR BEL BLZ BEN BMU BTN BOL BES BIH BWA BVT BRA IOT BRN BGR BFA BDI CPV KHM CMR CAN CYM CAF TCD CHL CHN CXR CCK COL COM COD COG COK CRI CIV HRV CUB CUW CYP CZE DNK DJI DMA DOM ECU EGY SLV GNQ ERI EST SWZ ETH FLK FRO FJI FIN FRA GUF PYF ATF GAB GMB GEO DEU GHA GIB GRC GRL GRD GLP GUM GTM GGY GIN GNB GUY HTI HMD VAT HND HKG HUN ISL IND IDN IRN IRQ IRL IMN ISR ITA JAM JPN JEY JOR KAZ KEN KIR PRK KOR KWT KGZ LAO LVA LBN LSO LBR LBY LIE LTU LUX MAC MDG MWI MYS MDV MLI MLT MHL MTQ MRT MUS MYT MEX FSM MDA MCO MNG MNE MSR MAR MOZ MMR NAM NRU NPL NLD NCL NZL NIC NER NGA NIU NFK MKD MNP NOR OMN PAK PLW PSE PAN PNG PRY PER PHL PCN POL PRT PRI QAT REU ROU RUS RWA BLM SHN KNA LCA MAF SPM VCT WSM SMR STP SAU SEN SRB SYC SLE SGP SXM SVK SVN SLB SOM ZAF SGS SSD ESP LKA SDN SUR SJM SWE CHE SYR TWN TJK TZA THA TLS TGO TKL TON TTO TUN TUR TKM TCA TUV UGA UKR ARE GBR USA UMI URY UZB VUT VEN VNM VGB VIR WLF ESH YEM ZMB ZWE '
    // ICAO and historical codes still printed as a country of birth
    . 'GBD GBN GBO GBP GBS UNO UNA UNK XXA XXB XXC XXX RKS XKX ANT BUR CSK DDR SCG SUN YUG ZAR TMP YMD ROM';

/* ---------- settings and access ---------- */
function idsSettings(): array
{
    $d = docGet('sec/x/idscan');
    return [
        'ai' => !empty($d->ai),
        'rec' => !isset($d->rec) || !empty($d->rec),
        'keep' => max(7, min(3650, (int) ($d->keep ?? 180))),
    ];
}
/** Who checks IDs: administrators and HR, and (unless switched off) recruiters and recruiting team. */
function idsCan(?array $u): bool
{
    if (!$u) {
        return false;
    }
    if (hasRole($u, 'admin') || hasRole($u, 'hr')) {
        return true;
    }
    // v83: outside bookkeepers get the accounting portal only, never the ID checks
    $r = myR((string) $u['id']);
    if ($r && (!empty($r->ext) || ($r->role ?? '') === 'ext')) {
        return false;
    }
    return idsSettings()['rec'] && (isRecruiter((string) $u['id']) || isBench((string) $u['id']));
}
function idsStaff(): array
{
    $u = requireUser();
    if (!idsCan($u)) {
        fail(403, 'forbidden', 'ID checks are for HR and administrators' . (idsSettings()['rec'] ? ', recruiters and recruiting team' : '') . '.');
    }
    return $u;
}
function idsAcked(array $u): bool
{
    $d = docGet('sec/x/idscan');
    return isset($d->ack) && $d->ack instanceof stdClass && !empty($d->ack->{(string) $u['id']});
}
function idsAllOf(): array
{
    $out = [];
    foreach (colAll('sec/idscan/items') as [$id, $s]) {
        $out[(string) $id] = $s;
    }
    return $out;
}

/* ---------- small helpers ---------- */
function idsCheck(array &$list, string $k, string $st, string $t, string $grp): void
{
    $list[] = ['k' => $k, 'st' => $st, 't' => $t, 'g' => $grp];
}
function idsYmd(int $y, int $m, int $d): ?string
{
    return checkdate($m, $d, $y) ? sprintf('%04d-%02d-%02d', $y, $m, $d) : null;
}
/** An AAMVA date: MMDDCCYY in the USA, CCYYMMDD in Canada (both tried; the expected one first). */
function idsAamvaDate(string $v, bool $canada): ?string
{
    $v = preg_replace('/\D/', '', $v) ?? '';
    if (strlen($v) !== 8) {
        return null;
    }
    $us = idsYmd((int) substr($v, 4, 4), (int) substr($v, 0, 2), (int) substr($v, 2, 2));
    $ca = idsYmd((int) substr($v, 0, 4), (int) substr($v, 4, 2), (int) substr($v, 6, 2));
    return $canada ? ($ca ?? $us) : ($us ?? $ca);
}
function idsAge(string $ymd): float
{
    return (time() - strtotime($ymd . ' 12:00:00')) / (365.2425 * 86400);
}
function idsYears(string $a, string $b): float
{
    return (strtotime($b . ' 12:00:00') - strtotime($a . ' 12:00:00')) / (365.2425 * 86400);
}
function idsNameTokens(string $n): array
{
    $n = mb_strtoupper(trim($n));
    $n = preg_replace('/[^A-Z\s\'-]/u', ' ', strtr($n, ['<' => ' ', ',' => ' '])) ?? $n;
    $t = preg_split('/[\s\'-]+/', $n) ?: [];
    return array_values(array_filter($t, fn($x) => strlen($x) > 1 && !in_array($x, ['JR', 'SR', 'II', 'III', 'IV', 'MR', 'MRS', 'MS', 'DR'], true)));
}
/** How two names compare: 2 = family and first name the same, 1 = family name the same (or the first two letters of
 *  every part), 0 = different. Order and middle names do not matter. */
function idsNameSim(string $a, string $b): int
{
    $x = idsNameTokens($a);
    $y = idsNameTokens($b);
    if (!$x || !$y) {
        return 0;
    }
    $common = array_intersect($x, $y);
    if (count($common) >= 2 || (count($common) === 1 && (count($x) === 1 || count($y) === 1))) {
        return 2;
    }
    if (count($common) === 1) {
        return 1;
    }
    return 0;
}
function idsMask(string $num): string
{
    $n = preg_replace('/[^A-Za-z0-9]/', '', $num) ?? '';
    return $n === '' ? '' : '…' . substr($n, -4);
}
function idsNumKey(string $kind, string $jur, string $num): string
{
    $n = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $num) ?? '');
    return $n === '' ? '' : substr(hash_hmac('sha256', $kind . '|' . strtoupper($jur) . '|' . $n, (string) cfg('app_secret') . '|idscan'), 0, 32);
}

/* ---------- the license barcode (AAMVA PDF417) ---------- */
/** Parses the text of a license barcode. Returns null when it is not an AAMVA barcode at all. */
function idsAamva(string $raw): ?array
{
    $raw = str_replace("\r\n", "\n", $raw);
    $at = strpos($raw, 'ANSI ');
    $at2 = strpos($raw, 'AAMVA');
    if ($at === false && $at2 === false) {
        return null;
    }
    $issues = [];
    $p = $at !== false ? $at + 5 : $at2 + 5;
    $head = substr($raw, 0, $at !== false ? $at : $at2);
    if (!str_starts_with(ltrim($head, "\x00 "), '@')) {
        $issues[] = 'the barcode does not start with the "@" every AAMVA barcode starts with';
    }
    $iin = substr($raw, $p, 6);
    $ver = (int) substr($raw, $p + 6, 2);
    $jver = (int) substr($raw, $p + 8, 2);
    $n = (int) substr($raw, $p + 10, 2);
    $subs = [];
    $q = $p + 12;
    for ($i = 0; $i < min($n, 6); $i++) {
        $t = substr($raw, $q, 2);
        if (!preg_match('/^[A-Z]{2}$/', $t)) {
            break;
        }
        $subs[] = ['t' => $t, 'off' => (int) substr($raw, $q + 2, 4), 'len' => (int) substr($raw, $q + 6, 4)];
        $q += 10;
    }
    if ($ver < 1 || $ver > 12) {
        $issues[] = 'the version number (' . $ver . ') is not one AAMVA has issued';
    }
    if (!$subs) {
        $issues[] = 'the list of subfiles after the header is missing';
    }
    // the elements: three capital letters followed by the value, one per line
    $f = [];
    $type = '';
    foreach (preg_split('/[\n\x1e\r]+/', $raw) ?: [] as $line) {
        $line = ltrim($line);
        if (preg_match('/^(DL|ID)(D[A-Z]{2})(.*)$/', $line, $m) && !str_contains($line, 'ANSI ')) {
            $type = $type ?: $m[1];
            $line = $m[2] . $m[3];
        } elseif (preg_match('/ANSI \d{6}\d{4}\d{2}(?:[A-Z]{2}\d{8})+(DL|ID)(D[A-Z]{2})(.*)$/', $line, $m)) {
            $type = $type ?: $m[1];
            $line = $m[2] . $m[3];
        }
        if (preg_match('/^(D[A-Z]{2})(.*)$/', $line, $m) && !isset($f[$m[1]])) {
            $f[$m[1]] = trim($m[2]);
        }
    }
    if ($type === '' && $subs) {
        $type = in_array($subs[0]['t'], ['DL', 'ID'], true) ? $subs[0]['t'] : '';
    }
    // offsets: where the header says the first subfile starts
    if ($subs && in_array($subs[0]['t'], ['DL', 'ID'], true)) {
        $s0 = strpos($raw, $subs[0]['t'] . 'D', $q);
        if ($s0 !== false && abs($s0 - $subs[0]['off']) > 2) {
            $issues[] = 'the header says the data starts at character ' . $subs[0]['off'] . ' but it starts at ' . $s0;
        }
    }
    return ['iin' => $iin, 'ver' => $ver, 'jver' => $jver, 'subs' => $subs, 'type' => $type ?: 'DL', 'f' => $f, 'issues' => $issues];
}
/** The checks a license or state ID barcode passes or fails on its own. Returns [checks, values shown to the person]. */
function idsDlChecks(array $a, array &$c): array
{
    $f = $a['f'];
    $iin = $a['iin'];
    $jur = IDS_IIN[$iin] ?? null;
    $state = strtoupper((string) ($f['DAJ'] ?? ''));
    $canada = ($f['DCG'] ?? '') === 'CAN' || ($jur && in_array($jur[0], IDS_CANADA, true));
    $shown = [];
    if ($jur) {
        idsCheck($c, 'iin', 'pass', 'Issuer number ' . $iin . ' belongs to ' . $jur[1] . '.', 'barcode');
    } else {
        idsCheck($c, 'iin', 'fail', 'Issuer number "' . $iin . '" in the barcode is not one any US state or Canadian province uses.', 'barcode');
    }
    foreach ($a['issues'] as $i) {
        idsCheck($c, 'hdr', 'warn', 'Barcode header: ' . $i . '.', 'barcode');
    }
    if (!$a['issues'] && $a['ver']) {
        idsCheck($c, 'hdr', 'pass', 'The barcode header follows the AAMVA standard (version ' . $a['ver'] . ').', 'barcode');
    }
    $missing = [];
    foreach (IDS_REQ as $k => $label) {
        if (($f[$k] ?? '') === '' && !($k === 'DCS' && (($f['DAB'] ?? '') !== '' || ($f['DAA'] ?? '') !== ''))) {
            $missing[] = $label;
        }
    }
    $given = (string) ($f['DAC'] ?? ($f['DCT'] ?? ''));
    if ($given === '' && ($f['DAA'] ?? '') === '') {
        $missing[] = 'first name';
    }
    if ($a['ver'] >= 3 && count($missing) >= 3) {
        idsCheck($c, 'req', 'fail', 'The barcode lacks fields every license carries: ' . implode(', ', $missing) . '.', 'barcode');
    } elseif ($missing) {
        idsCheck($c, 'req', 'warn', 'The barcode lacks: ' . implode(', ', $missing) . '.', 'barcode');
    } else {
        idsCheck($c, 'req', 'pass', 'Every field the standard requires is in the barcode.', 'barcode');
    }
    if ($jur && $state !== '' && $state !== $jur[0] && !in_array($state, ['APO', 'FPO', 'AA', 'AE', 'AP'], true)) {
        idsCheck($c, 'jur', 'warn', 'The address state (' . $state . ') is not the issuing state (' . $jur[0] . '). Licenses normally carry an address in the state that issued them.', 'barcode');
    }
    // dates
    $dob = idsAamvaDate((string) ($f['DBB'] ?? ''), $canada);
    $exp = idsAamvaDate((string) ($f['DBA'] ?? ''), $canada);
    $iss = idsAamvaDate((string) ($f['DBD'] ?? ''), $canada);
    $bad = [];
    if (($f['DBB'] ?? '') !== '' && !$dob) {
        $bad[] = 'the date of birth is not a real date';
    }
    if (($f['DBA'] ?? '') !== '' && !$exp) {
        $bad[] = 'the expiry date is not a real date';
    }
    if (($f['DBD'] ?? '') !== '' && !$iss) {
        $bad[] = 'the issue date is not a real date';
    }
    if ($dob && (idsAge($dob) < 14 || idsAge($dob) > 110)) {
        $bad[] = 'the date of birth makes the holder ' . (int) floor(idsAge($dob)) . ' years old';
    }
    if ($iss && strtotime($iss) > time() + 2 * 86400) {
        $bad[] = 'the issue date is in the future';
    }
    if ($iss && $exp && $exp <= $iss) {
        $bad[] = 'it expires before it was issued';
    }
    if ($iss && $exp && idsYears($iss, $exp) > 13) {
        $bad[] = 'it is valid for ' . (int) round(idsYears($iss, $exp)) . ' years (no state issues licenses that long)';
    }
    if ($dob && $iss && idsYears($dob, $iss) < 13.5) {
        $bad[] = 'it was issued before the holder was 14';
    }
    if ($bad) {
        idsCheck($c, 'dates', 'fail', 'Dates in the barcode do not add up: ' . implode('; ', $bad) . '.', 'barcode');
    } elseif ($dob && $exp && $iss) {
        idsCheck($c, 'dates', 'pass', 'Birth, issue and expiry dates are real dates in a possible order.', 'barcode');
    }
    if ($exp && strtotime($exp . ' 23:59:59') < time()) {
        idsCheck($c, 'expired', 'warn', 'The license expired on ' . date('M j, Y', strtotime($exp)) . '.', 'document');
    } elseif ($exp) {
        idsCheck($c, 'expired', 'pass', 'Not expired (valid until ' . date('M j, Y', strtotime($exp)) . ').', 'document');
    }
    // codes
    $codes = [];
    $sex = strtoupper((string) ($f['DBC'] ?? ''));
    if ($sex !== '' && !in_array($sex, ['1', '2', '9', 'X', 'M', 'F'], true)) {
        $codes[] = 'sex "' . $sex . '" (the standard uses 1, 2 or 9)';
    }
    $eye = strtoupper((string) ($f['DAY'] ?? ''));
    if ($eye !== '' && !in_array($eye, IDS_EYES, true)) {
        $codes[] = 'eye color "' . $eye . '"';
    }
    $ht = (string) ($f['DAU'] ?? '');
    if ($ht !== '' && !preg_match('/^\d{2,3}\s*(IN|CM|in|cm)$/', $ht) && !preg_match('/^\d-\d{2}$/', $ht)) {
        $codes[] = 'height "' . $ht . '"';
    }
    $zip = preg_replace('/\s+/', '', (string) ($f['DAK'] ?? '')) ?? '';
    if ($zip !== '' && !$canada && !preg_match('/^\d{5}(\d{4}|-\d{4})?(0{0,4})?$/', $zip)) {
        $codes[] = 'postal code "' . $zip . '"';
    }
    if ($codes) {
        idsCheck($c, 'codes', 'warn', 'Values written in a way the standard does not use: ' . implode(', ', $codes) . '.', 'barcode');
    }
    // the number's usual shape
    $num = strtoupper(preg_replace('/[\s-]/', '', (string) ($f['DAQ'] ?? '')) ?? '');
    $st = $jur[0] ?? $state;
    if ($num !== '' && isset(IDS_DL_SHAPE[$st])) {
        if (preg_match('/' . IDS_DL_SHAPE[$st] . '/', $num)) {
            idsCheck($c, 'shape', 'pass', 'The license number has a shape ' . (IDS_IIN[$iin][1] ?? $st) . ' uses.', 'barcode');
        } else {
            idsCheck($c, 'shape', 'warn', 'The license number\'s shape is unusual for ' . (IDS_IIN[$iin][1] ?? $st) . ' (a hint only; check it on the front).', 'barcode');
        }
    }
    $given = (string) ($f['DAC'] ?? ($f['DCT'] ?? ''));
    $family = (string) ($f['DCS'] ?? ($f['DAB'] ?? ''));
    if ($family === '' && ($f['DAA'] ?? '') !== '') {
        $parts = array_map('trim', explode(',', (string) $f['DAA']));
        $family = $parts[0] ?? '';
        $given = $given ?: ($parts[1] ?? '');
    }
    $shown = [
        'kind' => ($a['type'] === 'ID' ? 'State ID card' : 'Driver\'s license') . ($jur ? ' · ' . $jur[1] : ''),
        'name' => trim($given . ' ' . (string) ($f['DAD'] ?? '') . ' ' . $family),
        'family' => $family, 'given' => $given,
        'dob' => $dob ?? '', 'number' => $num, 'expiry' => $exp ?? '', 'issue' => $iss ?? '',
        'sex' => ['1' => 'M', '2' => 'F', '9' => 'X'][$sex] ?? $sex, 'state' => $jur[0] ?? $state,
        'address' => trim(((string) ($f['DAI'] ?? '')) . ($state !== '' ? ', ' . $state : '')),
        'real' => ($f['DDA'] ?? '') === 'F' ? 'REAL ID' : '',
    ];
    return $shown;
}

/* ---------- the green card's machine-readable lines (ICAO 9303, TD1) ---------- */
function idsMrzVal(string $ch): int
{
    if ($ch === '<') {
        return 0;
    }
    if (ctype_digit($ch)) {
        return (int) $ch;
    }
    $o = ord($ch);
    return $o >= 65 && $o <= 90 ? $o - 55 : -1;
}
function idsCd(string $s): int
{
    $w = [7, 3, 1];
    $sum = 0;
    for ($i = 0, $n = strlen($s); $i < $n; $i++) {
        $v = idsMrzVal($s[$i]);
        if ($v < 0) {
            return -1;
        }
        $sum += $v * $w[$i % 3];
    }
    return $sum % 10;
}
/** Cleans three typed or read lines: upper case, spaces out, padded or cut to 30. */
function idsMrzLines(array $lines): array
{
    $out = [];
    foreach (array_slice(array_values(array_filter(array_map(fn($l) => strtoupper(preg_replace('/\s+/', '', (string) $l) ?? ''), $lines), fn($l) => $l !== '')), 0, 3) as $l) {
        $l = strtr($l, ['«' => '<<', '‹' => '<', '(' => '<', '[' => '<', '{' => '<']);
        $out[] = $l;
    }
    return $out;
}
/** One field that fails its check digit: letters read in a digits-only field turned back into the digits they look
 *  like, then single look-alike swaps; accepted only when exactly one repair makes the check digit right. */
function idsMrzFix(string $field, string $cd, bool $digits): ?string
{
    $look = ['O' => '0', 'Q' => '0', 'D' => '0', 'U' => '0', 'I' => '1', 'L' => '1', 'Z' => '2', 'S' => '5', 'G' => '6', 'B' => '8', 'T' => '7'];
    $cd = strtr($cd, $look);
    if (!ctype_digit($cd)) {
        return null;
    }
    if ($digits) {
        $norm = strtr($field, $look);
        if ($norm !== $field && ctype_digit($norm) && idsCd($norm) === (int) $cd) {
            return $norm;
        }
        $field = $norm;
        $swap = ['0' => '8', '8' => '0', '1' => '7', '7' => '1', '5' => '6', '6' => '5', '3' => '8'];
    } else {
        $swap = ['0' => 'O', 'O' => '0', '1' => 'I', 'I' => '1', '5' => 'S', 'S' => '5', '8' => 'B', 'B' => '8', '2' => 'Z', 'Z' => '2'];
    }
    $found = [];
    for ($i = 0, $n = strlen($field); $i < $n; $i++) {
        if (!isset($swap[$field[$i]])) {
            continue;
        }
        $try = substr_replace($field, $swap[$field[$i]], $i, 1);
        if (idsCd($try) === (int) $cd) {
            $found[$try] = true;
        }
    }
    return count($found) === 1 ? (string) array_key_first($found) : null;
}
function idsMrzDate(string $yymmdd, bool $future): ?string
{
    if (!preg_match('/^\d{6}$/', $yymmdd)) {
        return null;
    }
    $yy = (int) substr($yymmdd, 0, 2);
    $now = (int) date('y');
    $y = $future ? ($yy < 70 ? 2000 + $yy : 1900 + $yy) : ($yy > $now ? 1900 + $yy : 2000 + $yy);
    return idsYmd($y, (int) substr($yymmdd, 2, 2), (int) substr($yymmdd, 4, 2));
}
/** Checks the three lines of a green card. $read: how they were obtained (typed | ai). Returns the values shown. */
function idsGcChecks(array $lines, string $read, array &$c): array
{
    $lines = idsMrzLines($lines);
    if (count($lines) < 3) {
        idsCheck($c, 'mrz', 'unsure', 'The three machine-readable lines on the back are needed (' . count($lines) . ' found).', 'mrz');
        return [];
    }
    [$l1, $l2, $l3] = $lines;
    $len = [strlen($l1), strlen($l2), strlen($l3)];
    if ($len !== [30, 30, 30]) {
        if ($read === 'typed') {
            idsCheck($c, 'mrz', 'unsure', 'Each line has 30 characters (these have ' . implode(', ', $len) . '): check what was typed, with every < counted.', 'mrz');
            return [];
        }
        $l1 = str_pad(substr($l1, 0, 30), 30, '<');
        $l2 = str_pad(substr($l2, 0, 30), 30, '<');
        $l3 = str_pad(substr($l3, 0, 30), 30, '<');
    }
    if (preg_match('/[^A-Z0-9<]/', $l1 . $l2 . $l3)) {
        idsCheck($c, 'chars', 'fail', 'The machine-readable lines contain characters the standard does not allow (only A–Z, 0–9 and <).', 'mrz');
    }
    $code = substr($l1, 0, 2);
    if (!in_array($code, ['C1', 'C2'], true)) {
        idsCheck($c, 'code', 'fail', 'A green card\'s lines start with C1 (resident) or C2 (commuter); these start with "' . $code . '".', 'mrz');
    }
    if (substr($l1, 2, 3) !== 'USA') {
        idsCheck($c, 'usa', 'fail', 'The issuing country should be USA; it reads "' . substr($l1, 2, 3) . '".', 'mrz');
    }
    $fixed = [];
    $field = function (string $label, string $val, string $cd, bool $digits) use (&$c, &$fixed, $read) {
        $calc = idsCd($val);
        if ($calc === (int) $cd && ctype_digit($cd)) {
            return [$val, true];
        }
        if ($read !== 'typed' && $digits && ctype_digit(strtr($cd, ['O' => '0', 'D' => '0', 'I' => '1', 'L' => '1', 'Z' => '2', 'S' => '5', 'G' => '6', 'B' => '8'])) && $calc === (int) strtr($cd, ['O' => '0', 'D' => '0', 'I' => '1', 'L' => '1', 'Z' => '2', 'S' => '5', 'G' => '6', 'B' => '8'])) {
            $fixed[] = $label . ' check digit';
            return [$val, true];
        }
        if ($read !== 'typed') {
            $fx = idsMrzFix($val, $cd, $digits);
            if ($fx !== null) {
                $fixed[] = $label;
                return [$fx, true];
            }
        }
        return [$val, false];
    };
    [$anum, $okA] = $field('USCIS number', substr($l1, 5, 9), $l1[14], true);
    [$dobR, $okB] = $field('date of birth', substr($l2, 0, 6), $l2[6], true);
    [$expR, $okE] = $field('expiry date', substr($l2, 8, 6), $l2[14], true);
    $compStr = substr($l1, 5, 25) . substr($l2, 0, 7) . substr($l2, 8, 7) . substr($l2, 18, 11);
    $compStr = substr_replace($compStr, $anum, 0, 9);
    $compStr = substr_replace($compStr, $dobR, 25, 6);
    $compStr = substr_replace($compStr, $expR, 32, 6);
    $okC = idsCd($compStr) === (int) $l2[29] && ctype_digit($l2[29]);
    $failed = array_keys(array_filter(['the USCIS number' => !$okA, 'the date of birth' => !$okB, 'the expiry date' => !$okE, 'the whole line (composite)' => !$okC]));
    if (!$failed) {
        idsCheck($c, 'cd', 'pass', 'All four check digits are right (USCIS number, birth date, expiry date, composite).' . ($fixed ? ' A misread in the ' . implode(' and ', $fixed) . ' was corrected.' : ''), 'mrz');
    } elseif (count($failed) === 1 && $read !== 'typed' && $failed[0] === 'the whole line (composite)') {
        idsCheck($c, 'cd', 'unsure', 'Three check digits are right but the composite one is not: probably a misread character. Compare the lines with the card.', 'mrz');
    } else {
        idsCheck($c, 'cd', 'fail', 'Check digits do not match for ' . implode(', ', $failed) . ($read === 'typed' ? ' (if the lines were typed exactly as printed, the card fails this check)' : '') . '. Genuine cards always pass.', 'mrz');
    }
    if (!preg_match('/^\d{9}$/', $anum)) {
        idsCheck($c, 'anum', 'fail', 'The USCIS number in the lines is not 9 digits.', 'mrz');
    }
    $card = rtrim(substr($l1, 15, 15), '<');
    if ($card !== '') {
        if (preg_match('/^([A-Z]{3})(\d{10})$/', $card, $m)) {
            idsCheck($c, 'card', in_array($m[1], IDS_SC, true) ? 'pass' : 'warn', in_array($m[1], IDS_SC, true) ? 'The card number has the right shape (office ' . $m[1] . ' + 10 digits).' : 'The card number starts with "' . $m[1] . '", not an office code we know (a hint only).', 'mrz');
        } else {
            idsCheck($c, 'card', 'fail', 'The card number in the lines is not 3 letters and 10 digits.', 'mrz');
        }
    }
    $dob = idsMrzDate($dobR, false);
    $exp = idsMrzDate($expR, true);
    $sex = $l2[7];
    $cob = substr($l2, 15, 3);
    $bad = [];
    if (!$dob) {
        $bad[] = 'the date of birth is not a real date';
    } elseif (idsAge($dob) > 110) {
        $bad[] = 'the date of birth is more than 110 years ago';
    }
    if (!$exp) {
        $bad[] = 'the expiry date is not a real date';
    } elseif ($dob && $exp <= $dob) {
        $bad[] = 'it expires before the holder was born';
    } elseif (idsYears(date('Y-m-d'), $exp) > 10.5) {
        $bad[] = 'it is valid for more than 10 years from today (cards last 10 years at most)';
    }
    if (!in_array($sex, ['M', 'F', 'X', '<'], true)) {
        $bad[] = 'the sex is "' . $sex . '"';
    }
    if ($bad) {
        idsCheck($c, 'dates', 'fail', 'The lines do not add up: ' . implode('; ', $bad) . '.', 'mrz');
    }
    if (!in_array($cob, explode(' ', IDS_ISO3), true)) {
        idsCheck($c, 'cob', 'warn', 'The country of birth code "' . $cob . '" is not a country code we know (a hint only).', 'mrz');
    }
    if ($exp && strtotime($exp . ' 23:59:59') < time()) {
        idsCheck($c, 'expired', 'warn', 'The card expired on ' . date('M j, Y', strtotime($exp)) . '.', 'document');
    } elseif ($exp) {
        idsCheck($c, 'expired', 'pass', 'Not expired (valid until ' . date('M j, Y', strtotime($exp)) . ').', 'document');
    }
    $nm = explode('<<', $l3, 2);
    $family = trim(str_replace('<', ' ', $nm[0] ?? ''));
    $given = trim(preg_replace('/\s+/', ' ', str_replace('<', ' ', $nm[1] ?? '')) ?? '');
    if ($family === '') {
        idsCheck($c, 'name', 'fail', 'The third line carries no family name.', 'mrz');
    }
    return [
        'kind' => 'Permanent Resident Card (green card)' . ($code === 'C2' ? ' · commuter' : ''),
        'name' => trim($given . ' ' . $family), 'family' => $family, 'given' => $given,
        'dob' => $dob ?? '', 'number' => $card, 'uscis' => $anum, 'expiry' => $exp ?? '', 'sex' => $sex === '<' ? '' : $sex, 'cob' => $cob,
        'lines' => [$l1, $l2, $l3],
    ];
}

/* ---------- comparisons: the front, the person, other checks ---------- */
function idsDateEq(string $a, string $b): bool
{
    $ta = strtotime($a);
    $tb = strtotime($b);
    return $ta !== false && $tb !== false && date('Y-m-d', $ta) === date('Y-m-d', $tb);
}
/** The front (read by StratEdge AI) against the barcode or the lines. */
function idsFrontAi(array $front, array $back, string $kind, array &$c): void
{
    $diff = [];
    $same = [];
    $cmp = function (string $label, string $a, string $b, callable $eq) use (&$diff, &$same) {
        if ($a === '' || $b === '') {
            return;
        }
        $eq($a, $b) ? $same[] = $label : $diff[] = $label;
    };
    $norm = fn($s) => strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $s) ?? '');
    $cmp('name', trim(($front['given'] ?? '') . ' ' . ($front['family'] ?? '')), (string) ($back['name'] ?? ''), fn($a, $b) => idsNameSim($a, $b) === 2);
    $cmp('date of birth', (string) ($front['dob'] ?? ''), (string) ($back['dob'] ?? ''), 'idsDateEq');
    $cmp($kind === 'gc' ? 'card number' : 'license number', (string) ($front['number'] ?? ''), (string) ($back['number'] ?? ''), fn($a, $b) => $norm($a) === $norm($b));
    $cmp('expiry date', (string) ($front['expiry'] ?? ''), (string) ($back['expiry'] ?? ''), 'idsDateEq');
    if ($kind === 'gc') {
        $cmp('USCIS number', (string) ($front['uscis'] ?? ''), (string) ($back['uscis'] ?? ''), fn($a, $b) => ltrim($norm($a), 'A0') === ltrim($norm($b), 'A0'));
    }
    if ($diff) {
        idsCheck($c, 'front', 'fail', 'The front does not match the ' . ($kind === 'gc' ? 'machine-readable lines' : 'barcode') . ': ' . implode(', ', $diff) . ' differ' . (count($diff) === 1 ? 's' : '') . '.', 'front');
    } elseif (count($same) >= 2) {
        idsCheck($c, 'front', 'pass', 'The front matches the ' . ($kind === 'gc' ? 'machine-readable lines' : 'barcode') . ' (' . implode(', ', $same) . ').', 'front');
    } else {
        idsCheck($c, 'front', 'unsure', 'Too little of the front could be read to compare it with the back.', 'front');
    }
}
/** v36.3: the front read in the browser. $f: {found: {name, dob, exp, num}, diff: [{f, front, back, sure}], n, readable}.
 *  A difference confirmed by a second, closer reading fails; one seen once waits for a person (one click); enough of
 *  the back found on the front passes. Returns whether the front counts as compared. */
function idsFrontAuto(array $f, array $back, string $kind, array &$c): bool
{
    $label = ['name' => 'name', 'dob' => 'date of birth', 'exp' => 'expiry date', 'num' => $kind === 'gc' ? 'USCIS number' : 'license number'];
    $found = [];
    foreach ((array) ($f['found'] ?? []) as $k => $v) {
        if (isset($label[$k]) && $v === true) {
            $found[] = $k;
        }
    }
    $sure = [];
    $maybe = [];
    foreach (array_slice((array) ($f['diff'] ?? []), 0, 6) as $d) {
        $k = (string) ($d['f'] ?? '');
        $fv = mb_substr(trim((string) ($d['front'] ?? '')), 0, 40);
        $bv = mb_substr(trim((string) ($d['back'] ?? '')), 0, 40);
        if (!isset($label[$k]) || $fv === '' || in_array($k, $found, true)) {
            continue;
        }
        $line = 'the ' . $label[$k] . ' on the front reads ' . $fv . ($bv !== '' ? ' (the back: ' . $bv . ')' : '');
        if (!empty($d['sure'])) {
            $sure[$k] = $line;
        } else {
            $maybe[$k] = $line;
        }
    }
    $names = fn(array $ks) => implode(', ', array_map(fn($k) => $label[$k], $ks));
    if ($sure) {
        idsCheck($c, 'front', 'fail', 'The front does not match the back: ' . implode('; ', $sure) . '. Read twice, the second time closer up.', 'front');
        return true;
    }
    if ($maybe) {
        idsCheck($c, 'frontdiff', 'warn', 'The front may not match the back: ' . implode('; ', $maybe) . '. Compare them by eye (a blurred picture can be misread).', 'front');
        return true;
    }
    // three of the four found (a name and a birth date alone are easy to copy onto a card; a number or date with them is not)
    $enough = count($found) >= 3;
    if ($enough) {
        idsCheck($c, 'front', 'pass', 'The front matches the back (' . $names($found) . '), read automatically.', 'front');
        return true;
    }
    $missing = array_values(array_diff(['name', 'dob', 'num', 'exp'], $found));
    idsCheck($c, 'front', 'unsure', empty($f['readable'])
        ? 'The front could not be read well enough (glare, blur or a small picture): compare it by eye, or add a sharper picture of the front.'
        : ($found ? 'Only the ' . $names($found) . ' could be found on the front, not the ' . $names($missing) . ': compare the front by eye.' : 'None of the back\'s details could be found on the front: compare it by eye.'), 'front');
    return false;
}
/** The person the ID was checked for: their name (and birth date when the record has one). */
function idsPerson(array $who): ?array
{
    $k = (string) ($who['kind'] ?? '');
    $id = (string) ($who['id'] ?? '');
    if (!preg_match('/^[A-Za-z0-9_\-]{1,40}$/', $id)) {
        return $k === 'name' && trim((string) ($who['n'] ?? '')) !== '' ? ['kind' => 'name', 'id' => '', 'n' => mb_substr(trim((string) $who['n']), 0, 120), 'dob' => ''] : null;
    }
    if ($k === 'cand' && ($d = docGet('rec/cand/items/' . $id))) {
        return ['kind' => 'cand', 'id' => $id, 'n' => (string) ($d->n ?? ''), 'dob' => (string) ($d->dob ?? '')];
    }
    if ($k === 'ats' && ($d = docGet('ats/' . $id))) {
        return ['kind' => 'ats', 'id' => $id, 'n' => (string) ($d->n ?? ''), 'dob' => ''];
    }
    if ($k === 'user' && preg_match('/^u_[a-f0-9]{8,32}$/', $id) && ($d = docGet('u/' . $id))) {
        return ['kind' => 'user', 'id' => $id, 'n' => (string) ($d->p->n ?? ''), 'dob' => (string) ($d->p->dob ?? '')];
    }
    return null;
}
/** What the pictures say about themselves: size, editing software, screenshots; and a fingerprint to spot reuse. */
function idsPicture(string $bytes): array
{
    $out = ['w' => 0, 'h' => 0, 'soft' => '', 'cam' => '', 'ph' => '', 'sha' => substr(hash('sha256', $bytes), 0, 32), 'png' => str_starts_with($bytes, "\x89PNG"), 'pdf' => str_starts_with($bytes, '%PDF')];
    if ($out['pdf']) {
        if (preg_match('/\/(?:Producer|Creator)\s*\(([^)]{1,80})\)/', $bytes, $m)) {
            $out['soft'] = $m[1];
        }
        return $out;
    }
    if (!function_exists('imagecreatefromstring')) {
        return $out;
    }
    $im = @imagecreatefromstring($bytes);
    if (!$im) {
        return $out;
    }
    $out['w'] = imagesx($im);
    $out['h'] = imagesy($im);
    // the editing software and the camera, from the EXIF block (JPEG) or the XMP/text chunks
    if (preg_match('/(Adobe Photoshop[^\x00]{0,30}|GIMP[^\x00]{0,12}|Pixelmator[^\x00]{0,12}|Canva|PicsArt|Affinity Photo|Paint\.NET|Snapseed|Fotor|Photopea)/i', substr($bytes, 0, 200000), $m)) {
        $out['soft'] = trim($m[1]);
    }
    if (function_exists('exif_read_data') && str_starts_with($bytes, "\xFF\xD8")) {
        $e = @exif_read_data('data://image/jpeg;base64,' . base64_encode($bytes));
        if (is_array($e)) {
            $out['soft'] = $out['soft'] ?: trim((string) ($e['Software'] ?? ''));
            $out['cam'] = trim((string) ($e['Make'] ?? '') . ' ' . (string) ($e['Model'] ?? ''));
        }
    }
    // a 576-bit difference hash (25x24 grey): the same picture resized or recompressed stays within a few bits, while
    // two cards of the same design with different people and text differ by many more
    $n = 24;
    $g = imagecreatetruecolor($n + 1, $n);
    imagecopyresampled($g, $im, 0, 0, 0, 0, $n + 1, $n, $out['w'], $out['h']);
    $hex = '';
    $nib = 0;
    $cnt = 0;
    for ($y = 0; $y < $n; $y++) {
        for ($x = 0; $x < $n; $x++) {
            $a = imagecolorat($g, $x, $y);
            $b = imagecolorat($g, $x + 1, $y);
            $la = (($a >> 16) & 255) * 299 + (($a >> 8) & 255) * 587 + ($a & 255) * 114;
            $lb = (($b >> 16) & 255) * 299 + (($b >> 8) & 255) * 587 + ($b & 255) * 114;
            $nib = ($nib << 1) | ($la > $lb ? 1 : 0);
            if (++$cnt === 4) {
                $hex .= dechex($nib);
                $nib = 0;
                $cnt = 0;
            }
        }
    }
    $out['ph'] = $hex;
    imagedestroy($g);
    imagedestroy($im);
    return $out;
}
function idsHam(string $a, string $b): int
{
    $len = strlen($a);
    if ($len === 0 || $len !== strlen($b)) {
        return PHP_INT_MAX;
    }
    $n = 0;
    for ($i = 0; $i < $len; $i += 7) {
        $x = hexdec(substr($a, $i, 7)) ^ hexdec(substr($b, $i, 7));
        while ($x) {
            $n += $x & 1;
            $x >>= 1;
        }
    }
    return $n;
}
/** Another person: both checks are linked to someone, and not to the same one (the same record, or the same name). */
function idsOtherPerson(?array $p, stdClass $s): bool
{
    $w = $s->who ?? null;
    if (!$p || !$w || trim((string) ($w->n ?? '')) === '' || trim((string) ($p['n'] ?? '')) === '') {
        return false;
    }
    if (($p['id'] ?? '') !== '' && (string) ($w->id ?? '') === $p['id'] && (string) ($w->kind ?? '') === $p['kind']) {
        return false;
    }
    return idsNameSim((string) $p['n'], (string) $w->n) < 2;
}

/* ---------- StratEdge AI reading the pictures (an administrator switches it on) ---------- */
function idsAiRead(array $pics): ?array
{
    if (!aiReady() || !$pics) {
        return null;
    }
    $parts = [['type' => 'text', 'text' => 'These pictures show the front and/or the back of one document: a US driver\'s license or state ID card, or a US Permanent Resident Card (green card). Read exactly what is printed; never guess or complete anything. Return JSON only: {"type":"dl|id|gc|other|unreadable","state":"two-letter issuing state for a license or ID card, else empty","front":{"family":"","given":"","dob":"YYYY-MM-DD","number":"the license number, or the green card number (3 letters and 10 digits), exactly as printed","uscis":"the USCIS number / A-number digits","category":"","country_of_birth":"","sex":"M|F|X","issue":"YYYY-MM-DD","expiry":"YYYY-MM-DD"},"mrz":["the three 30-character lines on the back of a green card exactly as printed, with every < character; an empty list when there are none"],"specimen":true if the words SAMPLE, SPECIMEN, VOID or TEST appear,"screen":true if this is a photo of a screen or of a photocopy,"edits":["visible signs of tampering: text in a different font, size or alignment, a photo pasted over, retouched or smudged areas, mismatched backgrounds"],"quality":"good|blurry|cropped|glare"}. Use empty strings for anything you cannot read.']];
    foreach (array_slice($pics, 0, 3) as $b) {
        $jpg = idsJpeg($b, 1600);
        if ($jpg !== null) {
            $parts[] = ['type' => 'image_url', 'image_url' => ['url' => 'data:image/jpeg;base64,' . base64_encode($jpg)]];
        }
    }
    if (count($parts) < 2) {
        return null;
    }
    $payload = ['max_tokens' => 1500, 'temperature' => 0, 'messages' => [['role' => 'system', 'content' => 'You read pictures of US identity documents for an employer\'s fraud-screening tool. You report only what is printed and what you see. You answer with one JSON object.'], ['role' => 'user', 'content' => $parts]], 'response_format' => ['type' => 'json_object']];
    [$code, $j] = aiPost($payload, 120);
    if ((!is_array($j) || empty($j['choices'])) && $code >= 400) {
        unset($payload['response_format']);
        [$code, $j] = aiPost($payload, 120);
    }
    $t = is_array($j) ? trim((string) ($j['choices'][0]['message']['content'] ?? '')) : '';
    $t = preg_replace('/^```(?:json)?\s*|\s*```$/m', '', $t) ?? $t;
    $d = json_decode($t, true);
    if (!is_array($d) && preg_match('/\{.*\}/s', $t, $m)) {
        $d = json_decode($m[0], true);
    }
    return is_array($d) ? $d : null;
}
/** A picture as a JPEG no wider or taller than $max (for the assistant), or null. */
function idsJpeg(string $bytes, int $max): ?string
{
    if (!function_exists('imagecreatefromstring') || str_starts_with($bytes, '%PDF')) {
        return null;
    }
    $im = @imagecreatefromstring($bytes);
    if (!$im) {
        return null;
    }
    $w = imagesx($im);
    $h = imagesy($im);
    $k = min(1, $max / max($w, $h));
    if ($k < 1) {
        $r = imagecreatetruecolor((int) round($w * $k), (int) round($h * $k));
        imagecopyresampled($r, $im, 0, 0, 0, 0, imagesx($r), imagesy($r), $w, $h);
        imagedestroy($im);
        $im = $r;
    }
    ob_start();
    imagejpeg($im, null, 88);
    imagedestroy($im);
    return (string) ob_get_clean();
}

/* ---------- the verdict ---------- */
// warnings that keep a check from saying "Looks genuine": the ID may belong to someone else, or the picture was edited
const IDS_HOLD = ['person', 'pdob', 'soft', 'screen', 'edits', 'frontdiff'];
function idsVerdict(array $c, string $kind, bool $backRead, bool $frontDone): string
{
    foreach ($c as $x) {
        if ($x['st'] === 'fail') {
            return 'fake';
        }
    }
    if (!$backRead || !$frontDone) {
        return 'unsure';
    }
    foreach ($c as $x) {
        if ($x['st'] === 'unsure' || ($x['st'] === 'warn' && in_array($x['k'], IDS_HOLD, true))) {
            return 'unsure';
        }
    }
    return 'ok';
}
const IDS_VERDICT = ['ok' => 'Looks genuine', 'fake' => 'Looks fake', 'unsure' => 'Can\'t tell'];

/* ---------- the pictures of a check ---------- */
/** Reads the pictures of a check: the uploaded ones (stored under sec/idscan/{id}) and files already in the portal. */
function idsLoadPics(string $id, array $u, array $b): array
{
    $pics = [];
    $sides = (array) ($_POST['side'] ?? []);
    if (isset($_FILES['img']) && is_array($_FILES['img']['name'] ?? null)) {
        foreach ($_FILES['img']['name'] as $i => $nm) {
            if (count($pics) >= 4) {
                break;
            }
            $f = ['name' => $nm, 'type' => $_FILES['img']['type'][$i] ?? '', 'tmp_name' => $_FILES['img']['tmp_name'][$i] ?? '', 'error' => $_FILES['img']['error'][$i] ?? 4, 'size' => $_FILES['img']['size'][$i] ?? 0];
            if (($f['error'] ?? 4) === UPLOAD_ERR_NO_FILE) {
                continue;
            }
            $side = in_array($sides[$i] ?? '', ['front', 'back'], true) ? $sides[$i] : 'page';
            $r = storeUpload($f, 'sec/idscan/' . $id, ['c' => $side]);
            $pics[] = ['base' => 'sec/idscan/' . $id, 'fid' => (string) $r['id'], 'side' => $side, 'n' => (string) $r['n']];
        }
    }
    // files already in the portal (a consultant's record, an ATS candidate, an email attachment): read where allowed
    foreach (array_slice((array) json_decode((string) ($b['refs'] ?? '[]'), true), 0, 4) as $ref) {
        $base = (string) ($ref['base'] ?? '');
        $fid = (string) ($ref['fid'] ?? '');
        if (!validPath($base, true) || !preg_match('/^[a-f0-9]{32}$/', $fid) || !can("$base/f/$fid", 'r') || !docGet("$base/f/$fid")) {
            fail(404, 'not_found', 'One of the files could not be opened (it may have been deleted, or you cannot open it).');
        }
        $pics[] = ['base' => $base, 'fid' => $fid, 'side' => in_array($ref['side'] ?? '', ['front', 'back'], true) ? $ref['side'] : 'page', 'n' => (string) (docGet("$base/f/$fid")->n ?? 'file'), 'ref' => true];
    }
    return $pics;
}

/* ---------- routes ---------- */
function idsRoute(string $r, array $b): never
{
    if ($r === 'ids_img') {
        // a picture of a check, for the people who may see checks
        $u = idsStaff();
        $id = (string) ($_GET['id'] ?? '');
        $fid = (string) ($_GET['f'] ?? '');
        $s = preg_match('/^[a-f0-9]{16}$/', $id) ? docGet('sec/idscan/items/' . $id) : null;
        if (!$s || !idsMaySee($s, $u) || !preg_match('/^[a-f0-9]{32}$/', $fid)) {
            http_response_code(404);
            exit('Not found');
        }
        foreach ((array) ($s->img ?? []) as $p) {
            if ((string) ($p->fid ?? '') === $fid && empty($p->gone)) {
                $data = fileRead($fid);
                $meta = docGet((string) $p->base . '/f/' . $fid);
                if ($data === null || !$meta) {
                    break;
                }
                header('Content-Type: ' . (string) ($meta->ty ?? 'application/octet-stream'));
                header("Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
                header('Cache-Control: private, no-store');
                echo $data;
                exit();
            }
        }
        http_response_code(404);
        exit('Not found');
    }
    $u = idsStaff();
    if ($_POST) {
        // a check sends its pictures as a form: the fields come with them
        $b = array_merge($b, array_map(fn($v) => is_string($v) ? $v : '', array_diff_key($_POST, ['side' => 1])));
    }
    $set = idsSettings();
    idsSweep();
    switch ($r) {
        case 'ids_boot':
            $mine = [];
            foreach (idsAllOf() as $id => $s) {
                if (($s->st ?? '') === 'done' && idsMaySee($s, $u)) {
                    $mine[] = idsRow($id, $s);
                }
            }
            usort($mine, fn($a, $c) => $c['at'] <=> $a['at']);
            ok(['set' => $set, 'ai' => aiReady(), 'ack' => idsAcked($u), 'admin' => hasRole($u, 'admin'), 'hr' => hasRole($u, 'hr') || hasRole($u, 'admin'), 'list' => array_slice($mine, 0, 300), 'reqs' => idsReqRows($u), 'waiting' => idsWaiting($u), 'org' => (string) cfg('mail_from_name')]);
        case 'ids_ack':
            $d = docGet('sec/x/idscan') ?? new stdClass();
            if (!isset($d->ack) || !($d->ack instanceof stdClass)) {
                $d->ack = new stdClass();
            }
            $d->ack->{(string) $u['id']} = now();
            docSet('sec/x/idscan', $d);
            audit('idscan', 'Read the ID check rules', '', [], $u);
            ok(['ok' => true]);
        case 'ids_settings_save':
            if (!hasRole($u, 'admin')) {
                fail(403, 'forbidden', 'Administrators change these.');
            }
            $d = docGet('sec/x/idscan') ?? new stdClass();
            $d->ai = !empty($b['ai']);
            $d->rec = !empty($b['rec']);
            $d->keep = max(7, min(3650, (int) ($b['keep'] ?? 180)));
            docSet('sec/x/idscan', $d);
            audit('settings', 'ID check settings changed', 'idscan', ['ai' => $d->ai, 'rec' => $d->rec, 'keep' => $d->keep], $u);
            ok(['set' => idsSettings()]);
        case 'ids_check':
            if (!idsAcked($u)) {
                fail(400, 'needs_ack', 'Read the rules for ID checks first.');
            }
            if (throttleHit('ids:' . $u['id'], 120, 3600)) {
                fail(429, 'rate_limited', 'That is a lot of ID checks for one hour. Try again later.');
            }
            $final = ($b['final'] ?? '') === '1';
            $id = preg_match('/^[a-f0-9]{16}$/', (string) ($b['id'] ?? '')) ? (string) $b['id'] : '';
            $s = $id !== '' ? docGet('sec/idscan/items/' . $id) : null;
            if ($s && (($s->st ?? '') !== 'pending' || !((string) ($s->by ?? '') === (string) $u['id'] || (($s->src ?? '') === 'link' && idsMaySee($s, $u))))) {
                fail(409, 'done', 'This check was already finished. Open it from the list.');
            }
            if (!$s) {
                $id = rid(8);
                $s = (object) ['st' => 'pending', 'at' => now(), 'by' => (string) $u['id'], 'byn' => (string) $u['name'], 'img' => []];
                // v36.3: "Check again" (the pictures of an earlier check, read again)
                if (preg_match('/^[a-f0-9]{16}$/', (string) ($b['prev'] ?? ''))) {
                    $s->prev = (string) $b['prev'];
                }
                // v36.3: a check started again with other pictures replaces this person's unfinished one
                $drop = preg_match('/^[a-f0-9]{16}$/', (string) ($b['drop'] ?? '')) ? docGet('sec/idscan/items/' . $b['drop']) : null;
                if ($drop && ($drop->st ?? '') === 'pending' && (string) ($drop->by ?? '') === (string) $u['id'] && ($drop->src ?? '') !== 'link') {
                    idsDropPics((string) $b['drop'], $drop);
                    docDelete('sec/idscan/items/' . $b['drop']);
                }
                $pics = idsLoadPics($id, $u, $b);
                if (!$pics) {
                    fail(400, 'invalid_argument', 'Add a picture of the front and of the back of the ID.');
                }
                $s->img = array_map(fn($p) => (object) $p, $pics);
                // what the pictures say about themselves
                foreach ($s->img as $p) {
                    $data = fileRead((string) $p->fid);
                    if ($data !== null) {
                        $info = idsPicture($data);
                        $p->w = $info['w'];
                        $p->h = $info['h'];
                        $p->ph = $info['ph'];
                        $p->sha = $info['sha'];
                        $p->soft = mb_substr($info['soft'], 0, 60);
                        $p->cam = mb_substr($info['cam'], 0, 60);
                        $p->png = $info['png'];
                        $p->pdf = $info['pdf'];
                    }
                }
                // the assistant reads the pictures once (when an administrator switched it on); kept only until finished
                if ($set['ai'] && ($b['ai'] ?? '') === '1' && aiReady()) {
                    $bytes = [];
                    foreach ($s->img as $p) {
                        $d0 = fileRead((string) $p->fid);
                        if ($d0 !== null) {
                            $bytes[] = $d0;
                        }
                    }
                    $s->tmp = (object) ['ai' => idsAiRead($bytes) ?? ['type' => 'error']];
                }
                docSet('sec/idscan/items/' . $id, $s);
            }
            $out = idsRun($id, $s, $u, $b, $final);
            ok($out);
        case 'ids_front':
            // v36.3: after a check, the front compared by eye (the one-click fix of "Can't tell" and "may not match")
            $id = (string) ($b['id'] ?? '');
            $s = preg_match('/^[a-f0-9]{16}$/', $id) ? docGet('sec/idscan/items/' . $id) : null;
            if (!$s || ($s->st ?? '') !== 'done' || !idsMaySee($s, $u)) {
                fail(404, 'not_found', 'That check is not there.');
            }
            if (empty($s->bk)) {
                fail(400, 'invalid_argument', 'The back was not read, so there is nothing to compare the front with. Check the ID again.');
            }
            $mode = (string) ($b['mode'] ?? '');
            if (!in_array($mode, ['same', 'differs'], true)) {
                fail(400, 'invalid_argument', 'Say whether the front matches.');
            }
            $what = array_values(array_intersect(array_map('strval', (array) json_decode((string) ($b['diff'] ?? '[]'), true)), ['name', 'date of birth', 'number', 'expiry date', 'photo', 'other']));
            $checks = array_values(array_filter(array_map(fn($x) => (array) $x, (array) ($s->checks ?? [])), fn($x) => !in_array($x['k'], ['front', 'frontdiff'], true)));
            $what0 = ($s->kind ?? '') === 'gc' ? 'machine-readable lines' : 'barcode';
            $checks[] = $mode === 'same'
                ? ['k' => 'front', 'st' => 'pass', 't' => (string) $u['name'] . ' compared the front with the ' . $what0 . ': the same.', 'g' => 'front']
                : ['k' => 'front', 'st' => 'fail', 't' => (string) $u['name'] . ' compared the front with the ' . $what0 . ': it differs' . ($what ? ' (' . implode(', ', $what) . ')' : '') . '.', 'g' => 'front'];
            $was = (string) ($s->v ?? '');
            $s->checks = array_map(fn($x) => (object) $x, $checks);
            $s->fd = true;
            $s->v = idsVerdict($checks, (string) ($s->kind ?? ''), true, true);
            docSet('sec/idscan/items/' . $id, $s);
            idsStamp($s, $id);
            audit('idscan', 'ID check: front compared by eye (' . IDS_VERDICT[$s->v] . ')', (string) ($s->who->n ?? ''), ['was' => $was], $u);
            ok(idsRow($id, $s) + ['checks' => $checks]);
        case 'ids_req_new':
            // v36.3: a link for a person to scan or upload their ID
            if (!idsAcked($u)) {
                fail(400, 'needs_ack', 'Read the rules for ID checks first.');
            }
            if (throttleHit('idsreq:' . $u['id'], 60, 3600)) {
                fail(429, 'rate_limited', 'That is a lot of links for one hour. Try again later.');
            }
            $who = idsPerson((array) json_decode((string) ($b['who'] ?? '{}'), true));
            if (!$who) {
                fail(400, 'invalid_argument', 'Say whose ID it is: pick the person, or type their name.');
            }
            $email = strtolower(trim(str($b, 'email', 190)));
            $send = ($b['send'] ?? '') === '1';
            if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                fail(400, 'invalid_argument', 'That email address does not look right.');
            }
            if ($send && $email === '') {
                fail(400, 'invalid_argument', 'Add their email address to send the link, or copy the link instead.');
            }
            $id = rid(8);
            $raw = rid(12);
            $days = max(1, min(30, (int) ($b['days'] ?? 7)));
            $q = (object) [
                'at' => now(), 'by' => (string) $u['id'], 'byn' => (string) $u['name'], 'who' => (object) ['kind' => $who['kind'], 'id' => $who['id'], 'n' => $who['n']],
                'email' => $email, 'kind' => in_array($b['kind'] ?? '', ['gc', 'dl'], true) ? (string) $b['kind'] : 'any', 'exp' => now() + $days * 86400000, 'days' => $days,
                'note' => str($b, 'note', 400), 'h' => hash('sha256', $raw), 'tok' => mailSealIds($id . '.' . $raw), 'st' => 'open', 'sent' => [],
            ];
            docSet('sec/idreq/items/' . $id, $q);
            if ($send) {
                idsReqMail($q, $id . '.' . $raw, $u);
                $q->sent = [now()];
                docSet('sec/idreq/items/' . $id, $q);
            }
            audit('idscan', 'ID link created' . ($send ? ' and emailed' : ''), $who['n'], ['kind' => $q->kind, 'days' => $days], $u);
            ok(['id' => $id, 'url' => idsReqUrl($id . '.' . $raw), 'reqs' => idsReqRows($u)]);
        case 'ids_req_send':
        case 'ids_req_cancel':
            $id = (string) ($b['id'] ?? '');
            $q = preg_match('/^[a-f0-9]{16}$/', $id) ? docGet('sec/idreq/items/' . $id) : null;
            if (!$q || !idsMaySee($q, $u)) {
                fail(404, 'not_found', 'That link is not there.');
            }
            if (($q->st ?? '') !== 'open') {
                fail(409, 'done', ($q->st ?? '') === 'done' ? 'They already sent their ID.' : 'That link was cancelled.');
            }
            if ($r === 'ids_req_cancel') {
                $q->st = 'cancelled';
                $q->end = now();
                docSet('sec/idreq/items/' . $id, $q);
                audit('idscan', 'ID link cancelled', (string) ($q->who->n ?? ''), [], $u);
                ok(['reqs' => idsReqRows($u)]);
            }
            if ((string) ($q->email ?? '') === '') {
                $email = strtolower(trim(str($b, 'email', 190)));
                if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                    fail(400, 'invalid_argument', 'Add their email address.');
                }
                $q->email = $email;
            }
            if (count((array) ($q->sent ?? [])) >= 5) {
                fail(429, 'rate_limited', 'This link was emailed five times already. Copy it and send it another way.');
            }
            // an expired link is opened again for as many days as at first
            if ((int) $q->exp < now()) {
                $q->exp = now() + max(1, (int) ($q->days ?? 7)) * 86400000;
            }
            idsReqMail($q, mailUnsealIds((string) $q->tok), $u);
            $q->sent = array_merge((array) ($q->sent ?? []), [now()]);
            docSet('sec/idreq/items/' . $id, $q);
            audit('idscan', 'ID link emailed again', (string) ($q->who->n ?? ''), [], $u);
            ok(['reqs' => idsReqRows($u)]);
        case 'ids_get':
            $id = (string) ($b['id'] ?? '');
            $s = preg_match('/^[a-f0-9]{16}$/', $id) ? docGet('sec/idscan/items/' . $id) : null;
            if (!$s || ($s->st ?? '') !== 'done' || !idsMaySee($s, $u)) {
                fail(404, 'not_found', 'That check is not there.');
            }
            ok(idsRow($id, $s) + ['checks' => (array) ($s->checks ?? []), 'img' => array_values(array_map(fn($p) => ['fid' => (string) $p->fid, 'side' => (string) ($p->side ?? ''), 'n' => (string) ($p->n ?? ''), 'gone' => !empty($p->gone)], (array) ($s->img ?? []))), 'dec' => $s->dec ?? null, 'bk' => !empty($s->bk), 'fd' => !empty($s->fd), 'next' => (string) ($s->next ?? ''), 'prev' => (string) ($s->prev ?? ''), 'src' => (string) ($s->src ?? '')]);
        case 'ids_decide':
            $id = (string) ($b['id'] ?? '');
            $s = preg_match('/^[a-f0-9]{16}$/', $id) ? docGet('sec/idscan/items/' . $id) : null;
            if (!$s || ($s->st ?? '') !== 'done' || !idsMaySee($s, $u)) {
                fail(404, 'not_found', 'That check is not there.');
            }
            $st = (string) ($b['st'] ?? '');
            if (!in_array($st, ['verified', 'not', 'more'], true)) {
                fail(400, 'invalid_argument', 'Pick a decision.');
            }
            $note = str($b, 'note', 500);
            if ($st === 'not' && mb_strlen($note) < 5) {
                fail(400, 'invalid_argument', 'Say why it was not accepted (kept with the check).');
            }
            $s->dec = (object) ['st' => $st, 'note' => $note, 'by' => (string) $u['name'], 'at' => now()];
            docSet('sec/idscan/items/' . $id, $s);
            idsStamp($s, $id);
            audit('idscan', 'ID check decision: ' . ['verified' => 'accepted', 'not' => 'not accepted', 'more' => 'asked for more'][$st], (string) ($s->who->n ?? ''), ['verdict' => (string) ($s->v ?? '')], $u);
            ok(['ok' => true]);
        case 'ids_delete':
            if (!hasRole($u, 'admin')) {
                fail(403, 'forbidden', 'Administrators delete ID checks.');
            }
            $id = (string) ($b['id'] ?? '');
            $s = preg_match('/^[a-f0-9]{16}$/', $id) ? docGet('sec/idscan/items/' . $id) : null;
            if ($s) {
                idsDropPics($id, $s);
                docDelete('sec/idscan/items/' . $id);
                audit('idscan', 'ID check deleted', (string) ($s->who->n ?? ''), [], $u);
            }
            ok(['ok' => true]);
    }
    fail(404, 'not_found', 'Unknown action.');
}
/* ---------- v36.3: ID links (a person scans or uploads their ID; the result lands here) ---------- */
function mailSealIds(string $v): string
{
    require_once __DIR__ . '/mail.php';
    return mailSeal($v);
}
function mailUnsealIds(string $v): string
{
    require_once __DIR__ . '/mail.php';
    return mailUnseal($v);
}
function idsReqUrl(string $tok): string
{
    return siteUrl() . '#/id?t=' . rawurlencode($tok);
}
/** The links this person may see: HR and administrators all, everyone else their own (newest first). */
function idsReqRows(array $u): array
{
    $out = [];
    foreach (colAll('sec/idreq/items') as [$id, $q]) {
        if (!idsMaySee($q, $u)) {
            continue;
        }
        $st = (string) ($q->st ?? 'open');
        if ($st === 'open' && (int) ($q->exp ?? 0) < now()) {
            $st = 'expired';
        }
        $out[] = [
            'id' => (string) $id, 'at' => (int) ($q->at ?? 0), 'byn' => (string) ($q->byn ?? ''), 'who' => (array) ($q->who ?? []), 'email' => (string) ($q->email ?? ''),
            'kind' => (string) ($q->kind ?? 'any'), 'exp' => (int) ($q->exp ?? 0), 'st' => $st, 'opened' => (int) ($q->opened ?? 0), 'sent' => count((array) ($q->sent ?? [])),
            'check' => (string) ($q->check ?? ''), 'done' => (int) ($q->done ?? 0),
            'url' => $st === 'open' || $st === 'expired' ? idsReqUrl(mailUnsealIds((string) ($q->tok ?? ''))) : '',
        ];
    }
    usort($out, fn($a, $b) => $b['at'] <=> $a['at']);
    return array_slice($out, 0, 200);
}
/** Checks that arrived from links and wait for this browser to read them. */
function idsWaiting(array $u): array
{
    $out = [];
    foreach (idsAllOf() as $id => $s) {
        if (($s->st ?? '') === 'pending' && ($s->src ?? '') === 'link' && idsMaySee($s, $u)) {
            $out[] = ['id' => (string) $id, 'at' => (int) ($s->at ?? 0), 'who' => (array) ($s->who ?? []), 'kind' => (string) ($s->tmp->claim->kind ?? ''), 'img' => array_values(array_map(fn($p) => ['fid' => (string) $p->fid, 'side' => (string) ($p->side ?? '')], (array) ($s->img ?? [])))];
        }
    }
    usort($out, fn($a, $b) => $a['at'] <=> $b['at']);
    return array_slice($out, 0, 20);
}
function idsReqMail(stdClass $q, string $tok, array $u): void
{
    $org = (string) cfg('mail_from_name');
    $first = explode(' ', trim((string) ($q->who->n ?? '')))[0] ?? '';
    $what = ['gc' => 'your green card (Permanent Resident Card)', 'dl' => 'your driver\'s license or state ID'][(string) ($q->kind ?? '')] ?? 'a photo ID (a US driver\'s license, state ID or green card)';
    $subject = $org . ' asks you to verify your ID';
    $paras = [
        'Hello' . ($first !== '' ? ' ' . $first : '') . ',',
        (string) $u['name'] . ' at ' . $org . ' asks you to verify ' . $what . '. It takes about a minute on your phone: scan the card with the camera, or upload clear pictures of the front and the back.',
    ];
    if (trim((string) ($q->note ?? '')) !== '') {
        $paras[] = 'Their note: ' . trim((string) $q->note);
    }
    $paras[] = 'The link works until ' . date('F j, Y', (int) ((int) $q->exp / 1000)) . ' and only once. If you did not expect this email, you can ignore it.';
    $url = idsReqUrl($tok);
    sendMail((string) $q->email, (string) ($q->who->n ?? ''), $subject, implode("\n\n", $paras) . "\n\n" . $url, emailHtml($subject, $paras, ['Verify my ID', $url]), [], (string) ($u['email'] ?? ''));
}
/** The link's page (no account needed): what is asked, then the pictures and what the phone read from them. */
function idqRoute(string $r, array $b): never
{
    if (throttleHit('idq:' . clientIp(), 120, 3600)) {
        fail(429, 'rate_limited', 'Too many tries from this network. Try again later.');
    }
    if ($_POST) {
        $b = array_merge($b, array_map(fn($v) => is_string($v) ? $v : '', array_diff_key($_POST, ['side' => 1])));
    }
    $t = str($b, 't', 80);
    if (!preg_match('/^([a-f0-9]{16})\.([a-f0-9]{24})$/', $t, $m)) {
        fail(400, 'invalid_argument', 'This link is not complete. Open it from the email again.');
    }
    $id = $m[1];
    $q = docGet('sec/idreq/items/' . $id);
    if (!$q || !hash_equals((string) ($q->h ?? ''), hash('sha256', $m[2]))) {
        fail(404, 'not_found', 'This link is not valid. Ask the person who sent it for a new one.');
    }
    $org = (string) cfg('mail_from_name');
    $st = (string) ($q->st ?? 'open');
    if ($st === 'done') {
        fail(409, 'done', 'Your ID was already sent to ' . $org . '. Thank you. You can close this page.');
    }
    if ($st !== 'open') {
        fail(410, 'expired', 'This link was cancelled. Ask ' . $org . ' for a new one if you still need it.');
    }
    if ((int) ($q->exp ?? 0) < now()) {
        fail(410, 'expired', 'This link has expired. Ask ' . $org . ' to send a new one.');
    }
    $keep = idsSettings()['keep'];
    if ($r === 'idq_get') {
        if (empty($q->opened)) {
            $q->opened = now();
            docSet('sec/idreq/items/' . $id, $q);
        }
        ok(['org' => $org, 'first' => explode(' ', trim((string) ($q->who->n ?? '')))[0] ?? '', 'by' => (string) ($q->byn ?? ''), 'kind' => (string) ($q->kind ?? 'any'), 'exp' => (int) $q->exp, 'keep' => $keep, 'note' => (string) ($q->note ?? '')]);
    }
    if ($r !== 'idq_send') {
        fail(404, 'not_found', 'Unknown action.');
    }
    if (throttleHit('idqs:' . $id, 12, 3600)) {
        fail(429, 'rate_limited', 'Too many tries with this link. Wait a while and try again.');
    }
    if (($b['consent'] ?? '') !== '1') {
        fail(400, 'invalid_argument', 'Tick the box to agree before sending your ID.');
    }
    $kind = in_array($b['kind'] ?? '', ['gc', 'dl'], true) ? (string) $b['kind'] : '';
    if ($kind === '' || (($q->kind ?? 'any') !== 'any' && $q->kind !== $kind)) {
        fail(400, 'invalid_argument', 'Choose the ID you are sending.');
    }
    // the pictures: the front and the back, as photos (the page sends JPEG pictures it made itself)
    $cid = rid(8);
    $sides = (array) ($_POST['side'] ?? []);
    $pics = [];
    $names = (array) ($_FILES['img']['name'] ?? []);
    if (!$names || !is_array($_FILES['img']['name'] ?? null)) {
        fail(400, 'invalid_argument', 'Add the front and the back of your ID.');
    }
    foreach ($names as $i => $nm) {
        if (count($pics) >= 4) {
            break;
        }
        $side = in_array($sides[$i] ?? '', ['front', 'back'], true) ? $sides[$i] : '';
        $tmp = (string) ($_FILES['img']['tmp_name'][$i] ?? '');
        $head = $tmp !== '' && is_file($tmp) ? (string) file_get_contents($tmp, false, null, 0, 8) : '';
        // pictures only (the page sends JPEG; a PNG is taken too), named by what they are
        $ext = str_starts_with($head, "\xFF\xD8") ? 'jpg' : (str_starts_with($head, "\x89PNG") ? 'png' : '');
        if ($side === '' || $ext === '') {
            continue;
        }
        $f = ['name' => $side . '.' . $ext, 'type' => $ext === 'png' ? 'image/png' : 'image/jpeg', 'tmp_name' => $tmp, 'error' => $_FILES['img']['error'][$i] ?? 4, 'size' => $_FILES['img']['size'][$i] ?? 0];
        $up = storeUpload($f, 'sec/idscan/' . $cid, ['c' => $side]);
        $pics[] = (object) ['base' => 'sec/idscan/' . $cid, 'fid' => (string) $up['id'], 'side' => $side, 'n' => $side . '.' . $ext];
    }
    $have = array_map(fn($p) => $p->side, $pics);
    if (!in_array('front', $have, true) || !in_array('back', $have, true)) {
        foreach ($pics as $p) {
            @unlink(filePathOf($p->fid));
            docDelete('sec/idscan/' . $cid . '/f/' . $p->fid);
        }
        fail(400, 'invalid_argument', 'Both sides are needed: the front and the back of your ID.');
    }
    foreach ($pics as $p) {
        $data = fileRead($p->fid);
        if ($data !== null) {
            $info = idsPicture($data);
            foreach (['w', 'h', 'ph', 'sha', 'png', 'pdf'] as $k) {
                $p->$k = $info[$k];
            }
            $p->soft = mb_substr($info['soft'], 0, 60);
            $p->cam = mb_substr($info['cam'], 0, 60);
        }
    }
    // what the person's phone read: compared with what the checker's browser reads, never used for the result
    $claim = (array) json_decode((string) ($b['claim'] ?? '{}'), true);
    $mrz = array_slice(array_map(fn($l) => strtoupper(preg_replace('/[^A-Z0-9<]/i', '', (string) $l) ?? ''), (array) ($claim['mrz'] ?? [])), 0, 3);
    $s = (object) [
        'st' => 'pending', 'src' => 'link', 'req' => $id, 'at' => now(), 'by' => (string) $q->by, 'byn' => (string) ($q->byn ?? ''),
        'who' => $q->who, 'img' => $pics,
        'tmp' => (object) ['claim' => (object) ['kind' => $kind, 'mrz' => $mrz, 'bar' => preg_match('/^[a-f0-9]{64}$/', (string) ($claim['bar'] ?? '')) ? (string) $claim['bar'] : '', 'how' => in_array($claim['how'] ?? '', ['camera', 'upload'], true) ? (string) $claim['how'] : '']],
    ];
    docSet('sec/idscan/items/' . $cid, $s);
    $q->st = 'done';
    $q->done = now();
    $q->check = $cid;
    docSet('sec/idreq/items/' . $id, $q);
    audit('idscan', 'ID sent through a link', (string) ($q->who->n ?? ''), ['kind' => $kind, 'how' => (string) $s->tmp->claim->how], null);
    // the person who sent the link hears about it
    try {
        $ur = userRow((string) $q->by);
        if ($ur && filter_var((string) $ur['email'], FILTER_VALIDATE_EMAIL)) {
            $n = (string) ($q->who->n ?? 'The person');
            $subject = $n . ' sent their ID';
            $paras = [$n . ' sent the ' . ($kind === 'gc' ? 'green card' : 'driver\'s license or state ID') . ' you asked for through the ID link.', 'Open ID checks: the pictures are read in your browser and the result (Looks genuine, Looks fake or Can\'t tell) is recorded with the check.'];
            sendMail((string) $ur['email'], (string) $ur['name'], $subject, implode("\n\n", $paras), emailHtml($subject, $paras, ['Open ID checks', siteUrl() . '#/portal/admin/idscan?open=' . $cid]));
        }
    } catch (Throwable $e) {
        // the ID is saved either way
    }
    ok(['ok' => true, 'org' => $org]);
}
/** HR and administrators see every check; recruiters see the checks they made. */
function idsMaySee(stdClass $s, array $u): bool
{
    return hasRole($u, 'admin') || hasRole($u, 'hr') || (string) ($s->by ?? '') === (string) $u['id'];
}
function idsRow(string $id, stdClass $s): array
{
    return ['id' => $id, 'at' => (int) ($s->at ?? 0), 'byn' => (string) ($s->byn ?? ''), 'kind' => (string) ($s->kind ?? ''), 'jur' => (string) ($s->jur ?? ''), 'num4' => (string) ($s->num4 ?? ''), 'v' => (string) ($s->v ?? ''), 'who' => isset($s->who) ? (array) $s->who : null, 'dec' => isset($s->dec) ? (array) $s->dec : null, 'fails' => count(array_filter((array) ($s->checks ?? []), fn($x) => ($x->st ?? ($x['st'] ?? '')) === 'fail'))];
}
/** Runs every check of a check (pending or final). Final: the verdict is saved and the person's record stamped. */
function idsRun(string $id, stdClass $s, array $u, array $b, bool $final): array
{
    $c = [];
    $shown = [];
    $kind = in_array((string) ($b['kind'] ?? ''), ['dl', 'gc'], true) ? (string) $b['kind'] : '';
    $ai = isset($s->tmp->ai) ? (array) json_decode((string) json_encode($s->tmp->ai), true) : null;
    if ($ai && ($ai['type'] ?? '') === 'error') {
        idsCheck($c, 'ai', 'info', 'StratEdge AI could not read the pictures; compare the front by eye.', 'document');
        $ai = null;
    }
    // the back: the license barcode (read in the browser) or the green card's lines (typed or read)
    $bar = (string) ($b['bar'] ?? '');
    $mrz = (array) json_decode((string) ($b['mrz'] ?? '[]'), true);
    $backRead = false;
    $aam = $bar !== '' ? idsAamva($bar) : null;
    if ($aam) {
        $kind = 'dl';
        $shown = idsDlChecks($aam, $c);
        $backRead = true;
        array_unshift($c, ['k' => 'bar', 'st' => 'pass', 't' => 'The barcode on the back was read.', 'g' => 'barcode']);
    } elseif ($bar !== '') {
        idsCheck($c, 'bar', 'fail', 'The barcode on the back holds no license data (it is not an AAMVA license barcode).', 'barcode');
    }
    if (!$aam && $kind !== 'dl') {
        $lines = array_filter(array_map('strval', $mrz));
        // v36.3: lines read in the browser from the picture ('scan') or typed by the person
        $read = ($b['mrzRead'] ?? '') === 'scan' ? 'scan' : 'typed';
        if (!$lines && $ai && !empty($ai['mrz'])) {
            $lines = array_map('strval', (array) $ai['mrz']);
            $read = 'ai';
        }
        if ($lines) {
            $kind = 'gc';
            $shown = idsGcChecks($lines, $read, $c);
            $backRead = (bool) $shown && !array_filter($c, fn($x) => $x['k'] === 'mrz');
        }
    }
    if ($kind === '' && $ai) {
        $kind = in_array($ai['type'] ?? '', ['gc'], true) ? 'gc' : (in_array($ai['type'] ?? '', ['dl', 'id'], true) ? 'dl' : '');
    }
    if (!$backRead) {
        idsCheck($c, 'back', 'unsure', $kind === 'gc' ? 'The three lines at the bottom of the back could not be read: scan the back with the camera, add a sharper picture of it, or type the lines.' : ($kind === 'dl' ? 'The barcode on the back could not be read: scan the back with the camera, or add a sharper, flat picture of it.' : 'The back of the ID is missing: the barcode of a license, or the three lines of a green card.'), 'document');
    }
    // the front: read by StratEdge AI, or compared by the person
    $front = (array) json_decode((string) ($b['front'] ?? '{}'), true);
    $frontDone = false;
    if ($ai && !empty($ai['front']) && $backRead) {
        idsFrontAi((array) $ai['front'], $shown, $kind, $c);
        $frontDone = (bool) array_filter($c, fn($x) => $x['k'] === 'front' && $x['st'] !== 'unsure');
    } elseif (($front['mode'] ?? '') === 'auto' && $backRead) {
        // v36.3: the front read in the browser; the back's values looked for on it (js/idread.js frontMatch)
        $frontDone = idsFrontAuto($front, $shown, $kind, $c);
    } elseif (($front['mode'] ?? '') === 'same' && $backRead) {
        idsCheck($c, 'front', 'pass', (string) $u['name'] . ' compared the front with the ' . ($kind === 'gc' ? 'machine-readable lines' : 'barcode') . ': the same.', 'front');
        $frontDone = true;
    } elseif (($front['mode'] ?? '') === 'differs' && $backRead) {
        $what = array_values(array_intersect(array_map('strval', (array) ($front['diff'] ?? [])), ['name', 'date of birth', 'number', 'expiry date', 'photo', 'other']));
        idsCheck($c, 'front', 'fail', (string) $u['name'] . ' compared the front with the ' . ($kind === 'gc' ? 'machine-readable lines' : 'barcode') . ': it differs' . ($what ? ' (' . implode(', ', $what) . ')' : '') . '.', 'front');
        $frontDone = true;
    } elseif ($backRead && $final) {
        idsCheck($c, 'front', 'unsure', 'The front was not compared with the back: add a picture of the front, or compare it by eye.', 'front');
    }
    // v36.3: a check from an ID link: what the person's phone said it read must be what this browser read now
    $claim = isset($s->tmp->claim) ? (array) json_decode((string) json_encode($s->tmp->claim), true) : null;
    if ($claim && $backRead) {
        $mine = $kind === 'gc' ? implode('|', (array) ($shown['lines'] ?? [])) : hash('sha256', $bar);
        $theirs = $kind === 'gc' ? implode('|', array_map('strval', (array) ($claim['mrz'] ?? []))) : (string) ($claim['bar'] ?? '');
        if ($theirs !== '' && $theirs !== $mine && ($kind !== 'gc' || count(array_diff_assoc(str_split($mine), str_split($theirs))) > 2)) {
            idsCheck($c, 'claim', 'fail', 'What the person\'s phone sent as read from the back is not what is on the picture they sent. The request was changed on the way: treat it as fake.', 'pictures');
        }
    }
    if ($ai) {
        if (!empty($ai['specimen'])) {
            idsCheck($c, 'specimen', 'fail', 'The picture says SAMPLE, SPECIMEN, VOID or TEST.', 'pictures');
        }
        if (!empty($ai['screen'])) {
            idsCheck($c, 'screen', 'warn', 'It looks like a photo of a screen or of a photocopy, not of the card.', 'pictures');
        }
        $edits = array_slice(array_values(array_filter(array_map('strval', (array) ($ai['edits'] ?? [])))), 0, 4);
        if ($edits) {
            idsCheck($c, 'edits', 'warn', 'StratEdge AI noticed: ' . implode('; ', array_map(fn($x) => mb_substr($x, 0, 160), $edits)) . '. Look at these spots.', 'pictures');
        }
        if (in_array($ai['quality'] ?? '', ['blurry', 'cropped', 'glare'], true)) {
            idsCheck($c, 'quality', 'info', 'The picture is ' . $ai['quality'] . '; a clearer one reads better.', 'pictures');
        }
    }
    // the pictures
    foreach ((array) $s->img as $p) {
        $label = ucfirst((string) ($p->side ?? 'page') === 'page' ? 'A picture' : 'The ' . $p->side . ' picture');
        if (($p->soft ?? '') !== '' && preg_match('/photoshop|gimp|pixelmator|canva|picsart|affinity|paint\.net|snapseed|fotor|photopea/i', (string) $p->soft)) {
            idsCheck($c, 'soft', 'warn', $label . ' was saved by ' . $p->soft . ' (an image editor). Ask for a fresh photo of the card.', 'pictures');
        }
        if (!empty($p->png) && ($p->cam ?? '') === '' && (int) ($p->w ?? 0) > 0) {
            idsCheck($c, 'shot', 'info', $label . ' is a screenshot or an edited file, not a camera photo.', 'pictures');
        }
        if ((int) ($p->w ?? 0) > 0 && max((int) $p->w, (int) $p->h) < 700) {
            idsCheck($c, 'small', 'info', $label . ' is small (' . $p->w . '×' . $p->h . '); details may not be readable.', 'pictures');
        }
    }
    // the person
    $who = idsPerson(($s->src ?? '') === 'link' && isset($s->who) ? (array) $s->who : (array) json_decode((string) ($b['who'] ?? '{}'), true));
    if ($who && ($shown['name'] ?? '') !== '') {
        $sim = idsNameSim((string) $shown['name'], $who['n']);
        if ($sim === 2) {
            idsCheck($c, 'person', 'pass', 'The name on the ID is ' . $who['n'] . '\'s name.', 'person');
        } else {
            idsCheck($c, 'person', 'warn', 'The name on the ID is not ' . $who['n'] . '\'s name' . ($sim === 1 ? ' (only the family name is the same)' : '') . '. Make sure the ID belongs to this person.', 'person');
        }
        if ($who['dob'] !== '' && ($shown['dob'] ?? '') !== '' && !idsDateEq($who['dob'], (string) $shown['dob'])) {
            idsCheck($c, 'pdob', 'warn', 'The date of birth on the ID is not the one on ' . $who['n'] . '\'s record.', 'person');
        }
    }
    // reuse: the same document number or the same picture already checked for someone else
    $numKey = $backRead && ($shown['number'] ?? '') !== '' ? idsNumKey($kind, (string) ($shown['state'] ?? 'US'), (string) $shown['number']) : '';
    foreach (idsAllOf() as $oid => $o) {
        if ($oid === $id || ($o->st ?? '') !== 'done') {
            continue;
        }
        $other = (string) ($o->who->n ?? 'someone else');
        if ($numKey !== '' && (string) ($o->numh ?? '') === $numKey && idsOtherPerson($who, $o)) {
            idsCheck($c, 'reuse', 'fail', 'This document number was already checked for ' . $other . ' on ' . date('M j, Y', (int) ($o->at / 1000)) . '.', 'person');
        }
        foreach ((array) ($o->img ?? []) as $op) {
            foreach ((array) $s->img as $p) {
                // the very same file, or (fronts only: the backs of one state's cards look alike) nearly the same picture
                $same = (($p->sha ?? '') !== '' && ($p->sha ?? '') === ($op->sha ?? ''))
                    || (($p->side ?? '') !== 'back' && ($op->side ?? '') !== 'back' && ($p->ph ?? '') !== '' && idsHam((string) $p->ph, (string) ($op->ph ?? '')) <= 10);
                if ($same && idsOtherPerson($who, $o)) {
                    idsCheck($c, 'samepic', 'fail', 'The same picture was checked for ' . $other . ' on ' . date('M j, Y', (int) ($o->at / 1000)) . '.', 'pictures');
                    break 2;
                }
            }
        }
    }
    // one line per kind of finding (the first of each key)
    $seen = [];
    $c = array_values(array_filter($c, function ($x) use (&$seen) {
        $k = $x['k'] . ':' . $x['st'];
        if (isset($seen[$k]) && in_array($x['k'], ['reuse', 'samepic', 'shot', 'small'], true)) {
            return false;
        }
        $seen[$k] = true;
        return true;
    }));
    $v = idsVerdict($c, $kind, $backRead, $frontDone);
    // v36.3: what would turn "Can't tell" into an answer, for the one-click fixes on the page
    $need = [];
    if (!$backRead) {
        $need[] = $kind === 'dl' ? 'barcode' : 'lines';
    }
    if ($backRead && !$frontDone) {
        $need[] = 'front';
    }
    foreach ($c as $x) {
        if ($x['k'] === 'frontdiff') {
            $need[] = 'frontdiff';
        } elseif ($x['k'] === 'cd' && $x['st'] === 'unsure') {
            $need[] = 'lines';
        }
    }
    $out = ['id' => $id, 'kind' => $kind, 'shown' => $shown, 'checks' => $c, 'v' => $v, 'label' => IDS_VERDICT[$v], 'final' => $final, 'needFront' => $backRead && !$frontDone && !$ai, 'need' => array_values(array_unique($need)), 'ai' => (bool) $ai, 'img' => array_values(array_map(fn($p) => ['fid' => (string) $p->fid, 'side' => (string) ($p->side ?? ''), 'n' => (string) ($p->n ?? '')], (array) $s->img))];
    if ($final) {
        // kept: the result of each check, the masked number and its fingerprint; nothing read from the document itself
        $s->st = 'done';
        $s->kind = $kind;
        $s->jur = $kind === 'gc' ? 'USA' : (string) ($shown['state'] ?? '');
        $s->num4 = idsMask((string) ($shown['number'] ?? ''));
        $s->numh = $numKey;
        $s->v = $v;
        $s->checks = array_map(fn($x) => (object) $x, $c);
        $s->who = $who ? (object) ['kind' => $who['kind'], 'id' => $who['id'], 'n' => $who['n']] : null;
        if (($s->src ?? '') !== 'link') {
            $s->src = mb_substr((string) ($b['src'] ?? ''), 0, 80);
        }
        $s->ai = (bool) $ai;
        $s->bk = $backRead;
        $s->fd = $frontDone;
        if (!empty($s->prev) && preg_match('/^[a-f0-9]{16}$/', (string) $s->prev) && ($o = docGet('sec/idscan/items/' . $s->prev)) && idsMaySee($o, $u)) {
            $o->next = $id;
            docSet('sec/idscan/items/' . $s->prev, $o);
        }
        unset($s->tmp);
        $s->u = now();
        docSet('sec/idscan/items/' . $id, $s);
        idsStamp($s, $id);
        audit('idscan', 'ID checked: ' . IDS_VERDICT[$v], (string) ($who['n'] ?? ''), ['kind' => $kind], $u);
    }
    return $out;
}
/** The latest check on the person's record (consultant database or ATS), for their card and the bench desk. */
function idsStamp(stdClass $s, string $id): void
{
    $w = $s->who ?? null;
    if (!$w || (string) ($w->id ?? '') === '') {
        return;
    }
    $path = ['cand' => 'rec/cand/items/', 'ats' => 'ats/'][(string) ($w->kind ?? '')] ?? '';
    if ($path === '' || !($d = docGet($path . $w->id))) {
        return;
    }
    $d->idchk = (object) ['id' => $id, 'v' => (string) ($s->v ?? ''), 'kind' => (string) ($s->kind ?? ''), 'at' => (int) ($s->at ?? 0), 'dec' => isset($s->dec) ? (string) $s->dec->st : ''];
    docSet($path . $w->id, $d);
}
function idsDropPics(string $id, stdClass $s): void
{
    foreach ((array) ($s->img ?? []) as $p) {
        if (empty($p->ref) && (string) ($p->base ?? '') === 'sec/idscan/' . $id) {
            @unlink(filePathOf((string) $p->fid));
            docDelete('sec/idscan/' . $id . '/f/' . $p->fid);
        }
    }
}
/** Pending checks left behind for a day are removed; pictures older than the retention period are deleted. */
function idsSweep(): void
{
    if (secKv('ids_sweep', 0) > now() - 3600000) {
        return;
    }
    secKvSet('ids_sweep', now());
    $keep = idsSettings()['keep'];
    foreach (idsAllOf() as $id => $s) {
        if (($s->st ?? '') === 'pending' && (int) ($s->at ?? 0) < now() - (($s->src ?? '') === 'link' ? $keep * 86400000 : 86400000)) {
            idsDropPics($id, $s);
            docDelete('sec/idscan/items/' . $id);
        } elseif (($s->st ?? '') === 'done' && (int) ($s->at ?? 0) < now() - $keep * 86400000) {
            $changed = false;
            foreach ((array) ($s->img ?? []) as $p) {
                if (empty($p->gone) && empty($p->ref)) {
                    @unlink(filePathOf((string) $p->fid));
                    docDelete('sec/idscan/' . $id . '/f/' . $p->fid);
                    $p->gone = true;
                    $changed = true;
                }
            }
            if ($changed) {
                docSet('sec/idscan/items/' . $id, $s);
            }
        }
    }
    foreach (colAll('sec/idreq/items') as [$id, $q]) {
        if ((int) ($q->at ?? 0) < now() - max($keep, 30) * 86400000 && (int) ($q->exp ?? 0) < now()) {
            docDelete('sec/idreq/items/' . $id);
        }
    }
}
