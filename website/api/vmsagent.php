<?php
declare(strict_types=1);
/* v73/v74 vendor requirement auto-reply agent.
 * Off by default. New vendor-email requirements are queued. The configured owner account performs matching/tailoring.
 * Nothing is sent below the configured ATS gate; those items go to recruiter review. Three follow-ups may be sent at
 * configured America/New_York slots, with a hard maximum of three per submission. */

const VMA_COL = 'vms/agent/items';

function vmaCfg(): array
{
    $d = docGet('org/vms/x/settings');
    return [
        'on' => (bool) ($d->agentOn ?? false),
        'threshold' => max(70, min(100, (int) ($d->agentThreshold ?? 86))),
        'owner' => (string) ($d->agentOwner ?? ''),
        'follow' => (bool) ($d->agentFollow ?? false),
        'tz' => 'America/New_York',
        'slots' => ['09:00','10:00','15:00'],
    ];
}
function vmaId(): string { return 'va_' . rid(8); }
/** v83: the saved vendor a reply address belongs to: one of its contacts' emails exactly, or the exact domain (or a
 *  subdomain) of the vendor's website. Free-mail domains only match as an exact saved contact. '' = not a known vendor.
 *  (Not vgVendorFor's str_contains test: 'staffing.com' would match 'bigvendorstaffing.com'.) */
function vmaVendorOf(string $email): string
{
    require_once __DIR__ . '/vms.php';
    $email = strtolower(trim($email)); $dom = strtolower(substr(strrchr($email, '@') ?: '', 1)); if ($dom === '') return '';
    $free = in_array($dom, ['gmail.com','yahoo.com','outlook.com','hotmail.com','live.com','aol.com','icloud.com','msn.com','protonmail.com','yahoo.co.in','rediffmail.com'], true);
    foreach (vmsVendorsRaw() as [$vid, $v]) {
        foreach ((array) ($v->contacts ?? []) as $c) if (strtolower(trim((string) ($c->e ?? ''))) === $email) return (string) $vid;
        if ($free) continue;
        foreach (preg_split('/[\s,;]+/', strtolower(trim((string) ($v->site ?? '')))) ?: [] as $site) {
            $site = ltrim($site, '@'); if ($site === '') continue;
            $host = (string) (parse_url(str_contains($site, '://') ? $site : 'https://' . $site, PHP_URL_HOST) ?? ''); $host = (string) preg_replace('/^www\./', '', $host);
            if ($host !== '' && ($dom === $host || str_ends_with($dom, '.' . $host))) return (string) $vid;
        }
    }
    return '';
}
function vmaQueue(string $reqId, string $source = 'vendor email'): void
{
    $cfg = vmaCfg();
    if (!$cfg['on']) return;
    $r = vmsReqGet($reqId);
    if (!$r || !filter_var((string) ($r['ce'] ?? ''), FILTER_VALIDATE_EMAIL)) return;
    foreach (colAll(VMA_COL) as [$id, $x]) if ((string) ($x->req ?? '') === $reqId && !in_array((string) ($x->st ?? ''), ['done','cancelled'], true)) return;
    docSet(VMA_COL . '/' . vmaId(), (object) [
        'req'=>$reqId,'source'=>$source,'st'=>'queued','at'=>now(),'u'=>now(),'score'=>0,'finalScore'=>0,'cand'=>'','candName'=>'',
        'tailored'=>false,'sentAt'=>0,'followN'=>0,'nextFollow'=>0,'log'=>[(object)['t'=>now(),'ev'=>'Queued from '.$source]],
    ]);
}
function vmaOwner(): ?array
{
    $cfg = vmaCfg();
    if ($cfg['owner'] === '') return null;
    require_once __DIR__ . '/tailor.php';
    return userById($cfg['owner']);
}
function vmaLog(stdClass $x, string $ev): void
{
    $l = (array) ($x->log ?? []); $l[] = (object)['t'=>now(),'ev'=>mb_substr($ev,0,500)]; $x->log=array_slice($l,-60); $x->u=now();
}
function vmaNextSlot(int $after): int
{
    $tz = new DateTimeZone('America/New_York');
    $d = (new DateTimeImmutable('@'.max(time(), (int)floor($after/1000))))->setTimezone($tz);
    $slots = ['09:00','10:00','15:00'];
    for ($days=0;$days<8;$days++) {
        $day=$d->modify('+'.$days.' day');
        if ((int)$day->format('N')>5) continue;
        foreach ($slots as $s) {
            [$h,$m]=array_map('intval',explode(':',$s));
            $c=$day->setTime($h,$m,0);
            if ($c->getTimestamp() > max(time(),(int)floor($after/1000))+300) return $c->getTimestamp()*1000;
        }
    }
    return ($d->modify('+1 day')->setTime(9,0))->getTimestamp()*1000;
}
function vmaMessage(array $r, array $cand, int $score, bool $tailored): string
{
    return "Hi " . (((string)($r['cn']??'')) !== '' ? (string)$r['cn'] : 'there') . ",\n\n" .
        "Please find " . (string)$cand['n'] . " for the " . (string)$r['ti'] . " requirement. " .
        "Our ATS match is " . $score . "%" . ($tailored ? ' after tailoring the resume to the requirement.' : '.') . "\n\n" .
        implode(' · ', array_filter([(string)($cand['ti']??''), ($cand['loc']??'')!==''?'Location: '.$cand['loc']:'', ($cand['auth']??'')!==''?'Work authorization: '.$cand['auth']:''])) .
        "\n\nPlease let us know the next step or interview availability.\n\nRegards,\nStratEdge IT Consulting";
}
function vmaProcessOne(string $id, stdClass $x, array $owner): array
{
    $cfg=vmaCfg(); $r=vmsReqGet((string)$x->req);
    if (!$r) { $x->st='cancelled'; vmaLog($x,'Requirement no longer exists.'); docSet(VMA_COL.'/'.$id,$x); return ['review'=>1]; }
    if (!filter_var((string)($r['ce']??''), FILTER_VALIDATE_EMAIL)) { $x->st='review'; vmaLog($x,'Vendor email is missing or invalid.'); docSet(VMA_COL.'/'.$id,$x); return ['review'=>1]; }
    // v83: the reply address comes from an unauthenticated email; only saved vendor contacts/domains get automatic submissions.
    if (vmaVendorOf((string)$r['ce'])==='') { $x->st='review'; vmaLog($x,'Reply address '.(string)$r['ce'].' is not a saved vendor contact or vendor domain; no email sent. Add the vendor (Vendors > Contacts) and retry, or submit by hand.'); docSet(VMA_COL.'/'.$id,$x); return ['review'=>1]; }
    $m=vmsMatch((string)$x->req); $cand=null;
    foreach ((array)$m['matches'] as $c) if (empty($c['sub']) && !empty($c['resume']) && in_array((string)$c['src'],['db','ats'],true)) { $cand=$c; break; }
    if (!$cand) { $x->st='review'; vmaLog($x,'No unsent candidate with a readable resume matched the requirement.'); docSet(VMA_COL.'/'.$id,$x); return ['review'=>1]; }
    $score=(int)$cand['score']; $final=$score; $tailored=false; $tailDoc=null; $tailPath='';
    $x->score=$score; $x->cand=(string)$cand['src'].':'.(string)$cand['id']; $x->candName=(string)$cand['n'];
    if ($score < $cfg['threshold']) {
        require_once __DIR__ . '/tailor.php';
        $jd=trim((string)($r['d']??'')."\n\nRole: ".(string)$r['ti']."\nSkills: ".(string)($r['sk']??''));
        if (mb_strlen($jd)<80) { $x->st='review'; vmaLog($x,'Match '.$score.'% is below the gate and the requirement has too little text to tailor safely.'); docSet(VMA_COL.'/'.$id,$x); return ['review'=>1]; }
        try {
            $src=['kind'=>$cand['src']==='db'?'cand':'ats','id'=>(string)$cand['id']];
            $ti=tailorRun($owner,['jd'=>$jd,'title'=>(string)$r['ti'],'company'=>(string)($r['ec']??$r['cl']??''),'vendor'=>(string)($r['vn']??''),'loc'=>(string)($r['loc']??''),'src'=>$src,'pages'=>0,'jdKind'=>'req','jdId'=>(string)$x->req],'rec/tl/items',true);
            $final=(int)($ti['after']['score']??0); $tailored=true;
            if (!empty($ti['id'])) { [$tailDoc,$tailPath]=tailorLoad('rec/tl/items',(string)$ti['id']); }
            vmaLog($x,'Initial ATS '.$score.'%; tailored and re-scored to '.$final.'%.');
        } catch (Throwable $e) {
            $x->st='review'; vmaLog($x,'Tailoring failed: '.$e->getMessage()); docSet(VMA_COL.'/'.$id,$x); return ['review'=>1];
        }
    }
    $x->finalScore=$final; $x->tailored=$tailored;
    if ($final < $cfg['threshold']) { $x->st='review'; vmaLog($x,'Final ATS '.$final.'% is below the '.$cfg['threshold'].'% gate; no email sent.'); docSet(VMA_COL.'/'.$id,$x); return ['review'=>1]; }
    $body=vmaMessage($r,$cand,$final,$tailored); $mailed=false;
    if ($tailored && $tailDoc) {
        try { $z=tailorEmail($owner,$tailDoc,$tailPath,['to'=>(string)$r['ce'],'cc'=>'','subject'=>'Submission: '.$cand['n'].' for '.$r['ti'],'text'=>$body,'which'=>'both']); $mailed=!empty($z['ok']); } catch(Throwable $e) { vmaLog($x,'Tailored email failed: '.$e->getMessage()); }
    } else {
        try {
            // vmsSubmit attaches the original resume and records the submission.
            $z=vmsSubmit($owner,['id'=>(string)$x->req,'src'=>(string)$cand['src'],'cid'=>(string)$cand['id'],'rate'=>(string)($r['rate']??''),'note'=>'ATS match '.$final.'%.','email'=>true,'to'=>(string)$r['ce'],'rtr'=>false,'score'=>$final,'ack'=>'1']);
            $mailed=!empty($z['mailed']);
        } catch(Throwable $e) { vmaLog($x,'Submission failed: '.$e->getMessage()); }
    }
    if ($tailored && $mailed) {
        // Record the submission without sending the original resume a second time.
        try { vmsSubmit($owner,['id'=>(string)$x->req,'src'=>(string)$cand['src'],'cid'=>(string)$cand['id'],'rate'=>(string)($r['rate']??''),'note'=>'Tailored resume emailed by vendor agent. ATS '.$final.'%.','email'=>false,'rtr'=>false,'score'=>$final,'ack'=>'1']); } catch(Throwable $e) {}
    }
    if (!$mailed) { $x->st='review'; vmaLog($x,'Email was not accepted by the configured mail service; recruiter review required.'); docSet(VMA_COL.'/'.$id,$x); return ['review'=>1]; }
    $x->st='sent'; $x->sentAt=now(); $x->followN=0; $x->nextFollow=$cfg['follow']?vmaNextSlot(now()):0; vmaLog($x,'Sent to '.$r['ce'].' at ATS '.$final.'%.'); docSet(VMA_COL.'/'.$id,$x);
    return ['sent'=>1,'tailored'=>$tailored?1:0];
}
function vmaFollow(string $id, stdClass $x): array
{
    $cfg=vmaCfg(); if(!$cfg['on']||!$cfg['follow']||(int)($x->followN??0)>=3) return [];
    $r=vmsReqGet((string)$x->req); if(!$r||!filter_var((string)($r['ce']??''),FILTER_VALIDATE_EMAIL)) return [];
    if(vmaVendorOf((string)$r['ce'])==='') return []; // v83: no follow-ups to an address that is not a saved vendor
    $n=(int)($x->followN??0)+1; $sub='Follow-up: '.$r['ti'].' submission';
    $body="Hi ".(((string)($r['cn']??''))!==''?$r['cn']:'there').",\n\nFollowing up on our submission of ".(string)($x->candName??'our candidate')." for ".(string)$r['ti'].". Please let us know if you would like to schedule an interview or need anything else.\n\nRegards,\nStratEdge IT Consulting";
    $ok=false; try{$ok=sendMail((string)$r['ce'],(string)($r['cn']??''),$sub,$body,emailHtml($sub,array_map('nl2br',array_map('htmlspecialchars',explode("\n\n",$body)))));}catch(Throwable $e){}
    if($ok){$x->followN=$n;$x->nextFollow=$n>=3?0:vmaNextSlot(now());vmaLog($x,'Follow-up '.$n.' sent at scheduled ET slot.');docSet(VMA_COL.'/'.$id,$x);return ['follow'=>1];}
    vmaLog($x,'Follow-up '.$n.' failed; will require review.');$x->st='review';$x->nextFollow=0;docSet(VMA_COL.'/'.$id,$x);return ['review'=>1];
}
function vmaCron(): array
{
    $cfg=vmaCfg(); $out=['sent'=>0,'tailored'=>0,'follow'=>0,'review'=>0]; if(!$cfg['on']) return $out;
    $owner=vmaOwner(); if(!$owner){return $out+['error'=>'Vendor agent owner is not configured or active.'];}
    // v83: one run at a time (cron, replay); a second run would email a second consultant for the same requirement.
    $lock=@fopen(storeDir().'/vma.lock','c');
    if(!$lock||!flock($lock,LOCK_EX|LOCK_NB)){if($lock)fclose($lock);return $out+['busy'=>true,'error'=>'Another vendor-agent run is still working.'];}
    // v83: a refusal (404/409) from vmsMatch/vmsSubmit sends that one item to review instead of ending the whole run.
    $prev=$GLOBALS['SE_FAIL_THROWS']??null; $GLOBALS['SE_FAIL_THROWS']=true;
    try{
        foreach(colAll(VMA_COL) as [$id,$x0]){
            $x=docGet(VMA_COL.'/'.(string)$id); if(!$x instanceof stdClass) continue; // the list snapshot can be stale
            try{
                if((string)($x->st??'')==='queued'){$r=vmaProcessOne((string)$id,$x,$owner);}
                elseif((string)($x->st??'')==='sent'&&(int)($x->nextFollow??0)>0&&(int)$x->nextFollow<=now()){$r=vmaFollow((string)$id,$x);}else continue;
                foreach($r as $k=>$v)if(isset($out[$k]))$out[$k]+=(int)$v;
            }catch(Throwable $e){$x->st='review';vmaLog($x,'Agent error: '.$e->getMessage());docSet(VMA_COL.'/'.(string)$id,$x);$out['review']++;}
        }
    }finally{
        if($prev===null)unset($GLOBALS['SE_FAIL_THROWS']);else $GLOBALS['SE_FAIL_THROWS']=$prev;
        flock($lock,LOCK_UN); fclose($lock);
    }
    return $out;
}
function vmaPublic(): array
{
    $rows=[];$counts=[];foreach(colAll(VMA_COL) as [$id,$x]){$st=(string)($x->st??'queued');$counts[$st]=($counts[$st]??0)+1;$rows[]=['id'=>(string)$id,'req'=>(string)($x->req??''),'st'=>$st,'score'=>(int)($x->score??0),'finalScore'=>(int)($x->finalScore??0),'cand'=>(string)($x->candName??''),'tailored'=>!empty($x->tailored),'sentAt'=>(int)($x->sentAt??0),'followN'=>(int)($x->followN??0),'nextFollow'=>(int)($x->nextFollow??0),'log'=>array_map(fn($z)=>(array)$z,(array)($x->log??[])),'at'=>(int)($x->at??0)];}
    usort($rows,fn($a,$b)=>$b['at']<=>$a['at']);return ['cfg'=>vmaCfg(),'counts'=>$counts,'rows'=>array_slice($rows,0,200)];
}
