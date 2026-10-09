<?php
declare(strict_types=1);
/*
  CRM extras: importing companies and contacts from the email contact list, the vendors list and the client
  workspaces, and a company's whole history (deals, contacts, follow-ups, requirements, invoices and emails) as one
  timeline. Records live in crm/main/acc, crm/main/con, crm/main/deal and crm/main/act; the pick-lists (stages with a
  win probability, company types, sources, lost reasons and so on) in crm/main/x/settings.
*/
function crmStaff(string $mode = 'w'): array
{
    $u = requireUser();
    if (!can('crm', $mode)) {
        fail(403, 'forbidden', 'The CRM is for StratEdge staff with CRM access.');
    }
    return $u;
}
/** Every record of a collection as [id => data], without the permission filter (the caller has checked). */
function crmCol(string $col): array
{
    $s = db()->prepare('SELECT path, data FROM docs WHERE col = ?');
    $s->execute([$col]);
    $out = [];
    foreach ($s->fetchAll() as $row) {
        $d = json_decode($row['data']);
        if ($d instanceof stdClass) {
            $out[substr($row['path'], strrpos($row['path'], '/') + 1)] = $d;
        }
    }
    return $out;
}
function crmTypeFromTags(string $tags): string
{
    $t = strtolower($tags);
    if (str_contains($t, 'client')) {
        return 'End client';
    }
    if (str_contains($t, 'prime')) {
        return 'Prime vendor';
    }
    if (str_contains($t, 'vendor') || str_contains($t, 'agency') || str_contains($t, 'recruiter')) {
        return 'Vendor';
    }
    if (str_contains($t, 'partner')) {
        return 'Implementation partner';
    }
    return '';
}
function crmVendorType(string $t): string
{
    return match ($t) {
        'Prime vendor' => 'Prime vendor',
        'Direct client' => 'End client',
        'Implementation partner' => 'Implementation partner',
        'Staffing agency' => 'Vendor',
        'MSP / VMS' => 'Vendor',
        default => 'Vendor',
    };
}
/** Addresses on a company's contacts, plus the company's own address, lower-cased and unique. */
function crmEmailsOf(string $acc, stdClass $a, array $cons): array
{
    $out = [];
    foreach ($cons as $c) {
        if ((string) ($c->acc ?? '') === $acc) {
            $e = strtolower(trim((string) ($c->e ?? '')));
            if ($e !== '') {
                $out[$e] = true;
            }
        }
    }
    foreach (['e', 'ec'] as $k) {
        $e = strtolower(trim((string) ($a->$k ?? '')));
        if ($e !== '') {
            $out[$e] = true;
        }
    }
    return array_keys($out);
}
function crmRoute(string $r, string $method, array $b): never
{
    switch ($r) {
        /* Bring companies and contacts in from the other lists on the site. Existing contacts (same email) and
           companies (same name) are kept as they are; nothing is overwritten. */
        case 'crm_import':
            $u = crmStaff('w');
            $src = str($b, 'src', 20);
            if (!in_array($src, ['mail', 'vendors', 'clients'], true)) {
                fail(400, 'invalid_argument', 'Choose where to import from.');
            }
            // v83: each source needs the caller's own right to read it, as on its own page
            if ($src === 'mail' && !mailCanUse($u)) {
                fail(403, 'forbidden', 'Email contacts are not switched on for your account.');
            }
            if ($src === 'vendors' && !can('vms/vendor/items', 'r')) {
                fail(403, 'forbidden', 'The vendors list is not open to your account.');
            }
            $now = now();
            $cons = crmCol('crm/main/con');
            $accs = crmCol('crm/main/acc');
            $byEmail = [];
            foreach ($cons as $id => $c) {
                $e = strtolower(trim((string) ($c->e ?? '')));
                if ($e !== '') {
                    $byEmail[$e] = $id;
                }
            }
            $byName = [];
            foreach ($accs as $id => $a) {
                $n = mb_strtolower(trim((string) ($a->n ?? '')));
                if ($n !== '') {
                    $byName[$n] = $id;
                }
            }
            $rows = []; // ['n','e','ph','ti','co','ty','web','loc','notes','rel','vid','cid','terms','msa']
            if ($src === 'mail') {
                require_once __DIR__ . '/mail.php';
                foreach (mdb()->query('SELECT email, name, company, title, phone, city, tags, notes FROM mail_contacts ORDER BY created') as $c) {
                    $rows[] = ['n' => $c['name'], 'e' => $c['email'], 'ph' => $c['phone'], 'ti' => $c['title'], 'co' => $c['company'], 'loc' => $c['city'], 'notes' => $c['notes'], 'ty' => crmTypeFromTags($c['tags']), 'src' => 'Email contacts'];
                }
            } elseif ($src === 'vendors') {
                require_once __DIR__ . '/vms.php';
                foreach (vmsVendorsRaw() as [$vid, $v]) {
                    $co = trim((string) ($v->n ?? ''));
                    if ($co === '') {
                        continue;
                    }
                    $base = ['co' => $co, 'ty' => crmVendorType((string) ($v->type ?? '')), 'web' => (string) ($v->site ?? ''), 'loc' => (string) ($v->loc ?? ''), 'vid' => (string) $vid, 'terms' => (string) ($v->terms ?? ''), 'msa' => (string) ($v->msaSt ?? '') === 'signed' || !empty($v->msa), 'notes' => (string) ($v->notes ?? ''), 'src' => 'Vendors'];
                    $contacts = array_values(array_filter((array) ($v->contacts ?? []), fn($c) => $c instanceof stdClass));
                    if (!$contacts) {
                        $rows[] = $base + ['n' => '', 'e' => ''];
                    }
                    foreach ($contacts as $c) {
                        $rows[] = $base + ['n' => (string) ($c->n ?? ''), 'e' => (string) ($c->e ?? ''), 'ph' => (string) ($c->ph ?? ''), 'ti' => (string) ($c->ti ?? '')];
                    }
                }
            } else {
                $clients = crmCol('org/admin/clients');
                $contactsOf = [];
                foreach (db()->query("SELECT id, email, name FROM users WHERE role = 'employer' AND status = 'active'")->fetchAll() as $usr) {
                    foreach (myCids($usr['id']) as $cid) {
                        $contactsOf[$cid][] = $usr;
                    }
                }
                // v83: client names and contact logins are shared with the CRM; the private notes only for those who may read client records
                $seeNotes = can('org/admin/clients', 'r');
                foreach ($clients as $cid => $c) {
                    $co = trim((string) ($c->n ?? ''));
                    if ($co === '') {
                        continue;
                    }
                    $base = ['co' => $co, 'ty' => 'End client', 'loc' => (string) ($c->loc ?? ''), 'cid' => (string) $cid, 'notes' => $seeNotes ? (string) ($c->notes ?? '') : '', 'st' => 'Active', 'src' => 'Clients'];
                    $list = $contactsOf[$cid] ?? [];
                    $ec = strtolower(trim((string) ($c->ec ?? '')));
                    if (!$list && $ec !== '') {
                        $list[] = ['id' => '', 'email' => $ec, 'name' => ''];
                    }
                    if (!$list) {
                        $rows[] = $base + ['n' => '', 'e' => ''];
                    }
                    foreach ($list as $usr) {
                        $rows[] = $base + ['n' => (string) $usr['name'], 'e' => (string) $usr['email'], 'rel' => 'Hiring manager'];
                    }
                }
            }
            $added = 0;
            $skipped = 0;
            $companies = 0;
            foreach ($rows as $row) {
                $co = trim((string) ($row['co'] ?? ''));
                $accId = '';
                if ($co !== '') {
                    $key = mb_strtolower($co);
                    if (isset($byName[$key])) {
                        $accId = $byName[$key];
                        // remember the link to the vendor or client workspace when the company already existed without it
                        $a = $accs[$accId];
                        $patch = [];
                        foreach (['vid', 'cid'] as $lk) {
                            if (!empty($row[$lk]) && empty($a->$lk)) {
                                $patch[$lk] = $row[$lk];
                            }
                        }
                        if ($patch) {
                            foreach ($patch as $k => $v) {
                                $a->$k = $v;
                            }
                            $a->u = $now;
                            docSet('crm/main/acc/' . $accId, $a);
                        }
                    } else {
                        $accId = rid(10);
                        $a = (object) [
                            'n' => $co,
                            'ty' => (string) ($row['ty'] ?? ''),
                            'st' => (string) ($row['st'] ?? 'Prospect'),
                            'own' => $u['id'],
                            'web' => (string) ($row['web'] ?? ''),
                            'loc' => (string) ($row['loc'] ?? ''),
                            'terms' => (string) ($row['terms'] ?? ''),
                            'msa' => !empty($row['msa']),
                            'notes' => (string) ($row['notes'] ?? ''),
                            'src' => (string) ($row['src'] ?? ''),
                            'at' => $now,
                            'by' => $u['id'],
                            'u' => $now,
                        ];
                        foreach (['vid', 'cid'] as $lk) {
                            if (!empty($row[$lk])) {
                                $a->$lk = $row[$lk];
                            }
                        }
                        docSet('crm/main/acc/' . $accId, $a);
                        $accs[$accId] = $a;
                        $byName[$key] = $accId;
                        $companies++;
                    }
                }
                $e = strtolower(trim((string) ($row['e'] ?? '')));
                $n = trim((string) ($row['n'] ?? ''));
                if ($e === '' && $n === '') {
                    continue;
                }
                if ($e !== '' && isset($byEmail[$e])) {
                    $skipped++;
                    // a contact that had no company yet gets the one it came with
                    $c = $cons[$byEmail[$e]];
                    if ($accId !== '' && empty($c->acc)) {
                        $c->acc = $accId;
                        $c->u = $now;
                        docSet('crm/main/con/' . $byEmail[$e], $c);
                    }
                    continue;
                }
                $id = rid(10);
                $c = (object) [
                    'n' => $n !== '' ? $n : $e,
                    'acc' => $accId,
                    'ti' => (string) ($row['ti'] ?? ''),
                    'e' => $e,
                    'ph' => (string) ($row['ph'] ?? ''),
                    'rel' => (string) ($row['rel'] ?? ''),
                    'notes' => $src === 'mail' ? (string) ($row['notes'] ?? '') : '',
                    'src' => (string) ($row['src'] ?? ''),
                    'at' => $now,
                    'by' => $u['id'],
                    'u' => $now,
                ];
                docSet('crm/main/con/' . $id, $c);
                $cons[$id] = $c;
                if ($e !== '') {
                    $byEmail[$e] = $id;
                }
                $added++;
            }
            ok(['added' => $added, 'skipped' => $skipped, 'companies' => $companies, 'rows' => count($rows)]);

        /* Everything that happened with one company, newest first: invoices, requirements and emails come from the
           other modules; deals, contacts and follow-ups the page already has. */
        case 'crm_timeline':
            $u = crmStaff('r');
            $acc = str($b, 'acc', 40);
            $a = docGet('crm/main/acc/' . $acc);
            if (!$a) {
                fail(404, 'not_found', 'No such company.');
            }
            $cons = crmCol('crm/main/con');
            $emails = crmEmailsOf($acc, $a, $cons);
            $name = mb_strtolower(trim((string) ($a->n ?? '')));
            $items = [];
            // invoices: linked client workspace, same billed company name, or billed to one of the contacts
            if (can('inv', 'r')) {
                foreach (crmCol('inv') as $id => $d) {
                    $bill = $d->bill instanceof stdClass ? $d->bill : new stdClass();
                    $hit = (!empty($a->cid) && (string) ($d->cid ?? '') === (string) $a->cid) || ($name !== '' && mb_strtolower(trim((string) ($bill->co ?? ''))) === $name) || in_array(strtolower(trim((string) ($bill->e ?? ''))), $emails, true);
                    if (!$hit) {
                        continue;
                    }
                    $items[] = ['k' => 'inv', 'id' => (string) $id, 'at' => (int) ($d->at ?? $d->u ?? 0), 't' => (string) ($d->num ?? 'Invoice'), 'st' => (string) ($d->st ?? ''), 'v' => (float) ($d->total ?? 0), 'paid' => (float) ($d->paid ?? 0), 'cur' => (string) ($d->cur ?? 'USD'), 'due' => (string) ($d->due ?? ''), 'issue' => (string) ($d->issue ?? '')];
                }
            }
            // requirements from the desk, for a vendor or client linked to this company or emailed by its contacts
            if (can('vms', 'r')) {
                foreach (crmCol('vms/req/items') as $id => $d) {
                    $hit = (!empty($a->vid) && (string) ($d->vid ?? '') === (string) $a->vid) || in_array(strtolower(trim((string) ($d->ce ?? ''))), $emails, true) || ($name !== '' && (mb_strtolower(trim((string) ($d->vn ?? ''))) === $name || mb_strtolower(trim((string) ($d->cl ?? ''))) === $name));
                    if (!$hit) {
                        continue;
                    }
                    $items[] = ['k' => 'req', 'id' => (string) $id, 'at' => (int) ($d->at ?? 0), 't' => (string) ($d->ti ?? 'Requirement'), 'st' => (string) ($d->st ?? ''), 'loc' => (string) ($d->loc ?? ''), 'rate' => (string) ($d->rate ?? '')];
                }
            }
            if ($emails) {
                $in = implode(',', array_fill(0, count($emails), '?'));
                require_once __DIR__ . '/mail.php';
                try {
                    // v83: the site mail log is staff-only (as on its own page); anyone else sees only what they sent themselves
                    $staffLog = userLevel($u) >= 2;
                    $s = mdb()->prepare("SELECT id, at, to_email, to_name, subject, kind, status FROM mail_log WHERE to_email IN ($in)" . ($staffLog ? '' : ' AND by_uid = ?') . ' ORDER BY at DESC LIMIT 100');
                    $s->execute($staffLog ? $emails : array_merge($emails, [$u['id']]));
                    foreach ($s->fetchAll() as $m) {
                        $items[] = ['k' => 'mail', 'id' => (string) $m['id'], 'at' => (int) $m['at'], 'dir' => 'out', 't' => (string) $m['subject'], 'who' => (string) ($m['to_name'] !== '' ? $m['to_name'] : $m['to_email']), 'e' => (string) $m['to_email'], 'st' => (string) $m['status'], 'via' => $m['kind'] === 'campaign' ? 'Campaign' : 'Site email'];
                    }
                    // v83: the shared inbox only for those who may use Email, inbox & campaigns
                    if (mailCanUse($u)) {
                        $s = mdb()->prepare("SELECT id, at, from_email, from_name, subject, folder FROM mail_inbox WHERE from_email IN ($in) ORDER BY at DESC LIMIT 100");
                        $s->execute($emails);
                        foreach ($s->fetchAll() as $m) {
                            $items[] = ['k' => 'mail', 'id' => (string) $m['id'], 'at' => (int) $m['at'], 'dir' => 'in', 't' => (string) $m['subject'], 'who' => (string) ($m['from_name'] !== '' ? $m['from_name'] : $m['from_email']), 'e' => (string) $m['from_email'], 'st' => '', 'via' => 'Shared inbox'];
                        }
                    }
                } catch (Throwable $e) {
                    /* the mail tables may not exist yet */
                }
                // personal mailboxes: the signed-in person's own; administrators also see what colleagues exchanged
                require_once __DIR__ . '/sso.php';
                try {
                    $p = mymailDb();
                    $like = [];
                    $args = [];
                    foreach ($emails as $e) {
                        $like[] = 'from_email = ? OR to_email LIKE ? OR cc LIKE ?';
                        array_push($args, $e, '%' . $e . '%', '%' . $e . '%');
                    }
                    $where = '(' . implode(' OR ', $like) . ')';
                    if (!hasRole($u, 'admin')) {
                        $where .= ' AND uid = ?';
                        $args[] = $u['id'];
                    }
                    $s = $p->prepare("SELECT id, uid, dir, at, from_email, from_name, to_email, subject, snippet, err FROM mail_user_msgs WHERE $where ORDER BY at DESC LIMIT 150");
                    $s->execute($args);
                    $names = [];
                    foreach ($s->fetchAll() as $m) {
                        if (!isset($names[$m['uid']])) {
                            $q = db()->prepare('SELECT name FROM users WHERE id = ?');
                            $q->execute([$m['uid']]);
                            $names[$m['uid']] = (string) ($q->fetchColumn() ?: '');
                        }
                        $items[] = ['k' => 'mail', 'id' => (string) $m['id'], 'at' => (int) $m['at'], 'dir' => $m['dir'] === 'in' ? 'in' : 'out', 't' => (string) $m['subject'], 'who' => (string) ($m['dir'] === 'in' ? ($m['from_name'] !== '' ? $m['from_name'] : $m['from_email']) : $m['to_email']), 'e' => (string) ($m['dir'] === 'in' ? $m['from_email'] : $m['to_email']), 'st' => $m['err'] !== null && $m['err'] !== '' ? 'bounced' : '', 'via' => ($m['uid'] === $u['id'] ? 'My email' : 'Email of ' . ($names[$m['uid']] ?: 'a colleague')), 'snippet' => (string) $m['snippet']];
                    }
                } catch (Throwable $e) {
                    /* no personal mailboxes yet */
                }
            }
            usort($items, fn($x, $y) => $y['at'] <=> $x['at']);
            ok(['items' => array_slice($items, 0, 300), 'emails' => $emails]);
        default:
            fail(404, 'not_found', 'Unknown action.');
    }
}
