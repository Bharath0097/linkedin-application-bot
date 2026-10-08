<?php
declare(strict_types=1);
/* v68 Intelligence & Operations: cross-system command center, universal search, Candidate 360,
 * data quality, integration health and executive analytics. It reads the same records the specialist
 * modules use; it does not create a second source of truth. */

function intelStaff(): array
{
    $u = requireUser();
    if (hasRole($u, 'admin')) return $u;
    if (featureMode((string) $u['id'], 'ops_intel') === 'allow') return $u;
    fail(403, 'forbidden', 'Intelligence & Operations is not part of your access. An administrator can enable it under Roles & access.');
}
function intelA($x): array { return $x instanceof stdClass ? (array) $x : (is_array($x) ? $x : []); }
function intelS($x, int $n = 220): string { return is_scalar($x) ? mb_substr(trim((string) $x), 0, $n) : ''; }
function intelHref(string $page, array $q = []): string
{
    $h = '#/portal/admin/' . ltrim($page, '/');
    if ($q) $h .= '?' . http_build_query($q);
    return $h;
}
function intelUsers(): array
{
    return db()->query("SELECT id,email,name,role,status,created,access FROM users ORDER BY created DESC")->fetchAll() ?: [];
}
function intelCandidates(): array
{
    $out=[];
    foreach (colAll('ats') as [$id,$c]) {
        if ((string)$id === 'x') continue;
        $a=intelA($c); $a['id']=(string)$id; $out[]=$a;
    }
    return $out;
}
function intelReqs(): array
{
    require_once __DIR__ . '/vms.php';
    $out=[];
    foreach (colAll(VMS_REQ) as [$id,$q]) { $a=intelA($q); $a['id']=(string)$id; $out[]=$a; }
    return $out;
}
function intelMail(): array
{
    require_once __DIR__ . '/mail.php';
    $pdo=mdb();
    $x=['contacts'=>0,'suppressed'=>0,'campaigns'=>0,'activeCampaigns'=>0,'sent30'=>0,'delivered30'=>0,'bounced30'=>0,'complained30'=>0,'failed30'=>0];
    try { $x['contacts']=(int)$pdo->query('SELECT COUNT(*) FROM mail_contacts')->fetchColumn(); } catch(Throwable $e){}
    try { $x['suppressed']=(int)$pdo->query('SELECT COUNT(*) FROM mail_suppress')->fetchColumn(); } catch(Throwable $e){}
    try { $x['campaigns']=(int)$pdo->query('SELECT COUNT(*) FROM mail_campaigns')->fetchColumn(); } catch(Throwable $e){}
    try { $x['activeCampaigns']=(int)$pdo->query("SELECT COUNT(*) FROM mail_campaigns WHERE status IN ('queued','sending','paused')")->fetchColumn(); } catch(Throwable $e){}
    try {
        $st=$pdo->prepare('SELECT status,COUNT(*) n FROM mail_log WHERE at>? GROUP BY status'); $st->execute([now()-30*86400000]);
        foreach($st->fetchAll() as $r){$k=strtolower((string)$r['status']);$n=(int)$r['n'];if(isset($x[$k.'30']))$x[$k.'30']+=$n;}
    } catch(Throwable $e){}
    return $x;
}
function intelDesk(): array
{
    try {
        require_once __DIR__ . '/desk.php'; ddb();
        $open=(int)ddb()->query("SELECT COUNT(*) FROM desk_tickets WHERE st IN ('new','assigned','working','hold','approval')")->fetchColumn();
        $breach=(int)ddb()->query("SELECT COUNT(*) FROM desk_tickets WHERE st IN ('new','assigned','working','approval') AND ((due_resp>0 AND first_resp=0 AND due_resp<".(int)now().") OR (due_res>0 AND due_res<".(int)now()."))")->fetchColumn();
        return ['open'=>$open,'breached'=>$breach];
    } catch(Throwable $e){ return ['open'=>0,'breached'=>0]; }
}
function intelQuality(array $cands, array $reqs): array
{
    $issues=[];$missingEmail=0;$dupeEmails=0;$stale=0;$by=[];$cut=now()-90*86400000;
    foreach($cands as $c){
        $e=mb_strtolower(trim((string)($c['e']??'')));
        if($e===''||!filter_var($e,FILTER_VALIDATE_EMAIL)){$missingEmail++;if(count($issues)<40)$issues[]=['kind'=>'candidate','sev'=>'high','title'=>'Candidate missing a valid email','name'=>intelS($c['n']??'Unnamed'), 'href'=>intelHref('ats',['c'=>$c['id']])];}
        elseif(isset($by[$e])){$dupeEmails++;if(count($issues)<40)$issues[]=['kind'=>'candidate','sev'=>'medium','title'=>'Duplicate candidate email','name'=>$e,'href'=>intelHref('ats',['c'=>$c['id']])];} else $by[$e]=1;
        if((int)($c['u']??$c['at']??0)>0 && (int)($c['u']??$c['at'])<$cut && !in_array((string)($c['st']??''),['hired','rejected'],true))$stale++;
    }
    $badReq=0;$staleReq=0;$reqCut=now()-45*86400000;
    foreach($reqs as $r){$st=(string)($r['st']??'new');if(trim((string)($r['ti']??''))===''||trim((string)($r['cl']??$r['ec']??''))===''){$badReq++;if(count($issues)<40)$issues[]=['kind'=>'requirement','sev'=>'medium','title'=>'Requirement has incomplete core fields','name'=>intelS($r['ti']??'Untitled requirement'),'href'=>intelHref('vreqs')];} if(in_array($st,['new','open','working'],true)&&(int)($r['u']??$r['at']??0)>0&&(int)($r['u']??$r['at'])<$reqCut)$staleReq++;}
    $contact=['n'=>0,'dupes'=>0,'bad'=>0];
    try { require_once __DIR__ . '/tools.php'; $p=mailContactCleanup(false,currentUser()?:[]); $contact=['n'=>(int)($p['n']??0),'dupes'=>(int)($p['duplicates']??$p['dupes']??0),'bad'=>(int)($p['bad']??$p['n']??0)]; } catch(Throwable $e){}
    return ['candidateMissingEmail'=>$missingEmail,'candidateDuplicateEmail'=>$dupeEmails,'candidateStale'=>$stale,'requirementIncomplete'=>$badReq,'requirementStale'=>$staleReq,'contact'=>$contact,'issues'=>$issues];
}
function intelIntegrations(): array
{
    $out=[];
    try { require_once __DIR__.'/sources.php'; $s=srcSecrets(); $out[]=['name'=>'Dice','ok'=>!empty($s['dice']['secret']),'state'=>!empty($s['dice']['secret'])?'Connected / feed ready':'Needs setup','href'=>intelHref('sources')]; $out[]=['name'=>'iLabor360','ok'=>!empty($s['ilabor']['pass'])||!empty($s['ilabor']['key']),'state'=>(!empty($s['ilabor']['pass'])||!empty($s['ilabor']['key']))?'Credentials saved':'Needs setup','href'=>intelHref('sources')]; } catch(Throwable $e){}
    try { require_once __DIR__.'/oorwin.php'; $o=owCfg(); $out[]=['name'=>'Oorwin','ok'=>!empty($o['token']),'state'=>!empty($o['token'])?'Connected':'Needs setup','href'=>intelHref('sources')]; } catch(Throwable $e){}
    try { require_once __DIR__.'/mail.php'; $m=mailSettings(); $provider=(string)($m['provider']??''); $out[]=['name'=>'Email delivery','ok'=>$provider!=='','state'=>$provider!==''?ucfirst($provider).' configured':'Needs setup','href'=>intelHref('mail')]; } catch(Throwable $e){}
    try {
        require_once __DIR__.'/phone.php';
        $p=phCfg(false); $provider=(string)($p['provider']??'twilio'); $ok=phReady();
        $name=$provider==='vitel'?'VitelGlobal':($provider==='custom'?((string)($p['providerLabel']??'')?:'Phone provider'):'Twilio');
        $out[]=['name'=>$name,'ok'=>$ok,'state'=>$ok?'Configured':'Needs setup','href'=>intelHref('phone')];
    } catch(Throwable $e){}
    try { $ai=aiCfg(); $out[]=['name'=>'StratEdge AI','ok'=>!empty($ai['key'])||!empty($ai['base']),'state'=>(!empty($ai['key'])||!empty($ai['base']))?'Configured':'Needs setup','href'=>intelHref('website')]; } catch(Throwable $e){}
    return $out;
}
function intelSummary(array $u): array
{
    $users=intelUsers();$cands=intelCandidates();$reqs=intelReqs();$mail=intelMail();$desk=intelDesk();$quality=intelQuality($cands,$reqs);
    $people=['active'=>0,'employees'=>0,'students'=>0,'consultants'=>0,'admins'=>0];
    foreach($users as $r){if(($r['status']??'')!=='active')continue;$people['active']++;$role=(string)($r['role']??'');if($role==='student')$people['students']++;elseif($role==='consultant')$people['consultants']++;elseif($role==='admin')$people['admins']++;else $people['employees']++;}
    $stage=[];$source=[];foreach($cands as $c){$st=(string)($c['st']??'new');$stage[$st]=($stage[$st]??0)+1;$so=(string)($c['src']??'Unknown');$source[$so]=($source[$so]??0)+1;}
    arsort($source);$source=array_slice($source,0,8,true);
    $reqSt=[];$openReq=0;foreach($reqs as $r){$st=(string)($r['st']??'new');$reqSt[$st]=($reqSt[$st]??0)+1;if(in_array($st,['new','open','working','submitted','interview'],true))$openReq++;}
    $crm=['accounts'=>count(colAll('crm/main/acc')),'contacts'=>count(colAll('crm/main/con')),'deals'=>count(colAll('crm/main/deal'))];
    $alerts=[];
    $add=function($sev,$title,$detail,$href)use(&$alerts){$alerts[]=['sev'=>$sev,'title'=>$title,'detail'=>$detail,'href'=>$href];};
    if($quality['candidateMissingEmail'])$add('high','Candidate records need email cleanup',$quality['candidateMissingEmail'].' candidate record(s) do not have a valid email.',intelHref('ats'));
    if($quality['candidateDuplicateEmail'])$add('medium','Possible duplicate candidates',$quality['candidateDuplicateEmail'].' duplicate email occurrence(s) were found.',intelHref('ats'));
    if($quality['contact']['n'])$add('high','Contact list needs refinement',$quality['contact']['n'].' bounced/rejected/duplicate contact issue(s) are ready for review.',intelHref('mail-cleanup'));
    if($quality['requirementStale'])$add('medium','Requirements are aging',$quality['requirementStale'].' open requirement(s) have not changed in 45+ days.',intelHref('vreqs'));
    if($desk['breached'])$add('high','Service-desk SLA attention',$desk['breached'].' open ticket(s) appear past a response/resolution target.',intelHref('desk'));
    if($mail['bounced30']+$mail['failed30']>0)$add('medium','Recent email delivery failures',($mail['bounced30']+$mail['failed30']).' bounced/failed message(s) in the last 30 days.',intelHref('mail-cleanup'));
    $integrations=intelIntegrations();foreach($integrations as $x)if(!$x['ok'])$add('medium',$x['name'].' needs setup',$x['state'],$x['href']);
    $metrics=[
      ['k'=>'candidates','n'=>'Candidates','v'=>count($cands),'href'=>intelHref('ats')],['k'=>'reqs','n'=>'Open requirements','v'=>$openReq,'href'=>intelHref('vreqs')],['k'=>'clients','n'=>'CRM accounts','v'=>$crm['accounts'],'href'=>intelHref('crm')],['k'=>'contacts','n'=>'Email contacts','v'=>$mail['contacts'],'href'=>intelHref('mail')],['k'=>'people','n'=>'Active people','v'=>$people['active'],'href'=>intelHref('team')],['k'=>'tickets','n'=>'Open tickets','v'=>$desk['open'],'href'=>intelHref('desk')],['k'=>'campaigns','n'=>'Active campaigns','v'=>$mail['activeCampaigns'],'href'=>intelHref('mail-campaigns')],['k'=>'alerts','n'=>'Attention items','v'=>count($alerts),'href'=>'#intel-alerts']
    ];
    $capabilities=[
      ['id'=>1,'n'=>'AI Action Agent with Approval','state'=>'live','d'=>'Prepare candidate/requirement actions, then approve or reject them before records change.','href'=>intelHref('intel',['tab'=>'actions'])],
      ['id'=>2,'n'=>'Submission Readiness Gate','state'=>'live','d'=>'Checks contact health, resume, authorization, match score and duplicate submission history.','href'=>intelHref('intel',['tab'=>'readiness'])],
      ['id'=>3,'n'=>'Requirement SLA Center','state'=>'live','d'=>'Tracks requirement age, first-submission timing and SLA risk.','href'=>intelHref('intel',['tab'=>'sla'])],
      ['id'=>4,'n'=>'Client 360','state'=>'live','d'=>'Client/account view across contacts, requirements, submissions, deals and activity.','href'=>intelHref('intel',['tab'=>'client'])],
      ['id'=>5,'n'=>'Smart Rate & Margin Calculator','state'=>'live','d'=>'Existing requirement/submission rate data stays linked to Accounting and placement workflows.','href'=>intelHref('vreqs')],
      ['id'=>6,'n'=>'Submission Conflict Detection','state'=>'live','d'=>'Readiness checks flag earlier submissions before another send.','href'=>intelHref('intel',['tab'=>'readiness'])],
      ['id'=>7,'n'=>'Recruiter Work Queue','state'=>'live','d'=>'Exception-first daily queue from aging requirements, candidates and communication health.','href'=>intelHref('intel',['tab'=>'work'])],
      ['id'=>8,'n'=>'Deliverability Control Center','state'=>'live','d'=>'SPF, DKIM, DMARC, warm-up, bounce and complaint health in one view.','href'=>intelHref('intel',['tab'=>'deliverability'])],
      ['id'=>9,'n'=>'Webhook & Integration Replay Center','state'=>'live','d'=>'Recent integration events with controlled replay for supported inbound/sync actions.','href'=>intelHref('intel',['tab'=>'replay'])],
      ['id'=>10,'n'=>'AI Requirement Normalizer','state'=>'live','d'=>'Existing requirement parsers normalize vendor/iLabor/email intake into the Requirements desk.','href'=>intelHref('vreqs')],
      ['id'=>11,'n'=>'Resume Master Profile','state'=>'live','d'=>'ATS resume/profile data and tailoring versions stay attached to one candidate record.','href'=>intelHref('tailor')],
      ['id'=>12,'n'=>'Consent & Communication Preferences','state'=>'live','d'=>'Suppression, unsubscribe and contact-health controls protect campaign sending.','href'=>intelHref('mail-cleanup')],
      ['id'=>13,'n'=>'Temporary Access & Delegation','state'=>'live','d'=>'Existing role/feature controls and approval delegation remain the access control plane.','href'=>intelHref('access')],
      ['id'=>14,'n'=>'Operational Event Timeline','state'=>'live','d'=>'Candidate 360 and Client 360 combine cross-module activity into operational timelines.','href'=>intelHref('intel',['tab'=>'candidate'])],
      ['id'=>15,'n'=>'Executive Forecasting','state'=>'live','d'=>'Directional 90-day placement forecast from the live recruiting pipeline.','href'=>intelHref('intel',['tab'=>'forecast'])],
      ['id'=>16,'n'=>'Data Recovery Center','state'=>'live','d'=>'Encrypted backups, restore preview and recovery remain in the Security center.','href'=>intelHref('trust')],
      ['id'=>17,'n'=>'PWA / Mobile Operations','state'=>'live','d'=>'Existing service worker and responsive portal support installable mobile operations.','href'=>'#/portal/admin'],
      ['id'=>18,'n'=>'AI Audit & Explainability','state'=>'live','d'=>'AI action proposals record source target, reviewer, decision and result.','href'=>intelHref('intel',['tab'=>'actions'])],
      ['id'=>19,'n'=>'Recruiter Performance Intelligence','state'=>'live','d'=>'Executive Analytics and SLA metrics expose recruiter response and funnel quality.','href'=>intelHref('intel',['tab'=>'analytics'])],
      ['id'=>20,'n'=>'Global Command Search + Actions','state'=>'live','d'=>'Universal search opens records and related permitted workflows from one place.','href'=>intelHref('intel',['tab'=>'search'])],
    ];    return ['at'=>now(),'metrics'=>$metrics,'alerts'=>array_slice($alerts,0,30),'people'=>$people,'candidateStages'=>$stage,'candidateSources'=>$source,'requirements'=>$reqSt,'crm'=>$crm,'mail'=>$mail,'desk'=>$desk,'quality'=>$quality,'integrations'=>$integrations,'capabilities'=>$capabilities];
}
function intelSearch(string $q): array
{
    $q=mb_strtolower(trim($q)); if(mb_strlen($q)<2)return [];$out=[];$push=function($type,$name,$sub,$href,$id='')use(&$out){if(count($out)<80)$out[]=['type'=>$type,'name'=>$name,'sub'=>$sub,'href'=>$href,'id'=>$id];};
    foreach(intelUsers() as $r){$hay=mb_strtolower(($r['name']??'').' '.($r['email']??'').' '.($r['role']??''));if(str_contains($hay,$q))$push('Person',intelS($r['name']??''),intelS(($r['email']??'').' · '.($r['role']??'')),intelHref('team',['u'=>$r['id']]),(string)$r['id']);}
    foreach(intelCandidates() as $c){$hay=mb_strtolower(($c['n']??'').' '.($c['e']??'').' '.($c['ti']??'').' '.($c['sk']??''));if(str_contains($hay,$q))$push('Candidate',intelS($c['n']??'Unnamed'),intelS(($c['e']??'').' · '.($c['ti']??'')),intelHref('intel',['tab'=>'candidate','candidate'=>$c['id']]),(string)$c['id']);}
    foreach(intelReqs() as $r){$hay=mb_strtolower(($r['ti']??'').' '.($r['cl']??'').' '.($r['ec']??'').' '.($r['sk']??''));if(str_contains($hay,$q))$push('Requirement',intelS($r['ti']??'Untitled'),intelS(($r['cl']??$r['ec']??'').' · '.($r['loc']??'')),intelHref('vreqs'),(string)$r['id']);}
    foreach(colAll('crm/main/acc') as [$id,$a]){$x=intelA($a);$hay=mb_strtolower(($x['n']??$x['name']??'').' '.($x['web']??'').' '.($x['loc']??''));if(str_contains($hay,$q))$push('CRM account',intelS($x['n']??$x['name']??'Account'),intelS(($x['loc']??'').' '.($x['web']??'')),intelHref('crm'),(string)$id);}
    try{require_once __DIR__.'/mail.php';$st=mdb()->prepare("SELECT id,email,name,company,title FROM mail_contacts WHERE LOWER(email) LIKE ? OR LOWER(name) LIKE ? OR LOWER(company) LIKE ? LIMIT 30");$like='%'.$q.'%';$st->execute([$like,$like,$like]);foreach($st->fetchAll() as $r)$push('Contact',intelS($r['name']?:$r['email']),intelS($r['email'].' · '.$r['company']),intelHref('mail'),(string)$r['id']);}catch(Throwable $e){}
    return array_slice($out,0,60);
}
function intelCandidate(string $id): array
{
    if(!preg_match('/^[A-Za-z0-9_-]{1,60}$/',$id))fail(400,'invalid_argument','Choose a candidate.');
    $c=docGet('ats/'.$id);if(!$c)fail(404,'not_found','That candidate was not found.');$a=intelA($c);$a['id']=$id;
    $health=['state'=>'unknown','why'=>'No validation result is stored.'];
    $e=mb_strtolower(trim((string)($a['e']??'')));
    if($e!=='')try{require_once __DIR__.'/tools.php';$st=mailCheckDb()->prepare('SELECT st,why,fix,bounced_at,bounce_why FROM mail_addr WHERE email=?');$st->execute([$e]);if($r=$st->fetch())$health=['state'=>(string)$r['st'],'why'=>(string)($r['bounce_why']?:$r['why']),'fix'=>(string)$r['fix'],'bouncedAt'=>(int)$r['bounced_at']];$ss=mailCheckDb()->prepare('SELECT why,at FROM mail_suppress WHERE email=?');$ss->execute([$e]);if($s=$ss->fetch())$health=['state'=>'suppressed','why'=>(string)$s['why'],'at'=>(int)$s['at']];}catch(Throwable $x){}
    $matches=[];
    try{require_once __DIR__.'/vms.php';$cand=null;foreach(vmsCandidates(false) as $vc)if($vc['src']==='ats'&&$vc['id']===$id){$cand=$vc;break;}if($cand){foreach(intelReqs() as $r){if(!in_array((string)($r['st']??'new'),['new','open','working','submitted','interview'],true))continue;[$score,$why]=vmsScore(vmsReqProfile($r),$cand);if($score>=25)$matches[]=['id'=>$r['id'],'title'=>(string)($r['ti']??''),'client'=>(string)($r['cl']??$r['ec']??''),'score'=>$score,'why'=>array_slice($why,0,4)];}usort($matches,fn($x,$y)=>$y['score']<=>$x['score']);$matches=array_slice($matches,0,10);}}catch(Throwable $x){}
    return ['candidate'=>$a,'health'=>$health,'matches'=>$matches,'timeline'=>array_values((array)($a['log']??[])),'notes'=>array_values((array)($a['notes']??[])),'interviews'=>array_values((array)($a['intvs']??[])),'scorecards'=>array_values((array)($a['cards']??[]))];
}

/* ================= v76 Enterprise Automation & Control ================= */
function intelReqOne(string $id): array
{
    if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', $id)) fail(400, 'invalid_argument', 'Choose a requirement.');
    require_once __DIR__ . '/vms.php';
    $d = docGet(VMS_REQ . '/' . $id);
    if (!$d) fail(404, 'not_found', 'That requirement was not found.');
    $a = intelA($d); $a['id'] = $id; return $a;
}
function intelCandidateOne(string $id): array
{
    if (!preg_match('/^[A-Za-z0-9_-]{1,60}$/', $id)) fail(400, 'invalid_argument', 'Choose a candidate.');
    $d = docGet('ats/' . $id);
    if (!$d) fail(404, 'not_found', 'That candidate was not found.');
    $a = intelA($d); $a['id'] = $id; return $a;
}
function intelCandidateMailHealth(array $c): array
{
    $e = mb_strtolower(trim((string)($c['e'] ?? '')));
    if (!filter_var($e, FILTER_VALIDATE_EMAIL)) return ['state'=>'invalid','why'=>'No valid email address.'];
    try {
        require_once __DIR__ . '/tools.php';
        $p = mailCheckDb();
        $s = $p->prepare('SELECT why,at FROM mail_suppress WHERE email=?'); $s->execute([$e]);
        if ($r = $s->fetch()) return ['state'=>'suppressed','why'=>(string)$r['why'],'at'=>(int)$r['at']];
        $q = $p->prepare('SELECT st,why,bounced_at,bounce_why FROM mail_addr WHERE email=?'); $q->execute([$e]);
        if ($r = $q->fetch()) return ['state'=>(string)$r['st'],'why'=>(string)($r['bounce_why'] ?: $r['why']),'bouncedAt'=>(int)$r['bounced_at']];
    } catch(Throwable $e2) {}
    return ['state'=>'unknown','why'=>'No stored validation result.'];
}
function intelReadiness(string $cid, string $rid): array
{
    $c = intelCandidateOne($cid); $r = intelReqOne($rid);
    $health = intelCandidateMailHealth($c);
    $checks = [];
    $put = function(string $k,string $n,bool $ok,string $detail,bool $critical=false) use (&$checks){$checks[]=['k'=>$k,'n'=>$n,'ok'=>$ok,'detail'=>$detail,'critical'=>$critical];};
    $emailOk = filter_var((string)($c['e']??''), FILTER_VALIDATE_EMAIL) && !in_array($health['state'], ['suppressed','bounced','invalid','bad'], true);
    $put('email','Deliverable email',$emailOk,$emailOk?'Email is usable.':($health['why']?:'Email needs attention.'),true);
    $phoneOk = trim((string)($c['ph']??'')) !== ''; $put('phone','Phone number',$phoneOk,$phoneOk?'Phone is present.':'Add a phone number.');
    $resumeOk = trim((string)($c['rid']??'')) !== ''; $put('resume','Resume attached',$resumeOk,$resumeOk?'Resume is attached.':'Attach a current resume.',true);
    $authOk = trim((string)($c['auth']??'')) !== ''; $put('auth','Work authorization',$authOk,$authOk?(string)$c['auth']:'Work authorization is not recorded.');
    $locOk = trim((string)($c['loc']??'')) !== ''; $put('location','Location',$locOk,$locOk?(string)$c['loc']:'Location is not recorded.');
    $skillOk = trim((string)($c['sk']??'')) !== ''; $put('skills','Skills',$skillOk,$skillOk?'Skills are present.':'Add skills before submission.');
    $score=0;$why=[];
    try {
        require_once __DIR__ . '/vms.php'; $cand=null;
        foreach(vmsCandidates(false) as $vc) if(($vc['src']??'')==='ats' && ($vc['id']??'')===$cid){$cand=$vc;break;}
        if($cand){[$score,$why]=vmsScore(vmsReqProfile($r),$cand);}
    } catch(Throwable $e) {}
    $matchOk=$score>=70; $put('match','Requirement match',$matchOk,$score.'% match'.($why?' · '.implode(' · ',array_slice($why,0,3)):''),true);
    $prior=[];
    foreach(colAll('rec/sub/items') as [$sid,$s]){
        $a=intelA($s); if((string)($a['vreq']??'')===$rid && ((string)($a['cid']??'')===$cid || (mb_strtolower((string)($a['ce']??''))!=='' && mb_strtolower((string)($a['ce']??''))===mb_strtolower((string)($c['e']??''))))) $prior[]=['id'=>(string)$sid,'date'=>(string)($a['d']??''),'status'=>(string)($a['st']??''),'vendor'=>(string)($a['vn']??'')];
    }
    $dupOk=!$prior; $put('duplicate','Duplicate submission check',$dupOk,$dupOk?'No earlier submission to this requirement was found.':count($prior).' earlier submission(s) found.',true);
    $criticalFail=count(array_filter($checks,fn($x)=>$x['critical']&&!$x['ok'])); $missing=count(array_filter($checks,fn($x)=>!$x['ok']));
    $status=$criticalFail?'blocked':($missing?'attention':'ready');
    $score2=(int)round(100*count(array_filter($checks,fn($x)=>$x['ok']))/max(1,count($checks)));
    return ['candidate'=>['id'=>$cid,'name'=>(string)($c['n']??'Unnamed'),'email'=>(string)($c['e']??'')],'requirement'=>['id'=>$rid,'title'=>(string)($r['ti']??'Untitled'),'client'=>(string)($r['cl']??$r['ec']??'')],'status'=>$status,'readiness'=>$score2,'match'=>$score,'checks'=>$checks,'prior'=>$prior,'href'=>intelHref('vreqs')];
}
function intelClientSearch(string $q): array
{
    $q=mb_strtolower(trim($q)); if(mb_strlen($q)<2)return [];$out=[];
    foreach(colAll('crm/main/acc') as [$id,$o]){$a=intelA($o);$hay=mb_strtolower(implode(' ',[(string)($a['n']??''),(string)($a['web']??''),(string)($a['loc']??''),(string)($a['ty']??'')]));if(str_contains($hay,$q))$out[]=['id'=>(string)$id,'name'=>(string)($a['n']??'Account'),'sub'=>trim((string)($a['ty']??'').' · '.(string)($a['loc']??''))];if(count($out)>=30)break;}
    return $out;
}
function intelClient360(string $id): array
{
    if(!preg_match('/^[A-Za-z0-9_-]{1,60}$/',$id))fail(400,'invalid_argument','Choose a client.');
    $o=docGet('crm/main/acc/'.$id); if(!$o)fail(404,'not_found','That client was not found.'); $a=intelA($o);$a['id']=$id;
    $contacts=[];foreach(colAll('crm/main/con') as [$cid,$c]){$x=intelA($c);if((string)($x['acc']??'')===$id){$x['id']=(string)$cid;$contacts[]=$x;}}
    $deals=[];foreach(colAll('crm/main/deal') as [$did,$d]){$x=intelA($d);if((string)($x['acc']??'')===$id){$x['id']=(string)$did;$deals[]=$x;}}
    $acts=[];foreach(colAll('crm/main/act') as [$aid,$d]){$x=intelA($d);if((string)($x['acc']??'')===$id){$x['id']=(string)$aid;$acts[]=$x;}}
    $name=mb_strtolower(trim((string)($a['n']??'')));$reqs=[];
    foreach(intelReqs() as $r){$hit=((string)($a['vid']??'')!==''&&(string)($r['vid']??'')===(string)$a['vid'])||((string)($a['cid']??'')!==''&&(string)($r['cid']??'')===(string)$a['cid'])||($name!==''&&(mb_strtolower(trim((string)($r['cl']??'')))===$name||mb_strtolower(trim((string)($r['ec']??'')))===$name||mb_strtolower(trim((string)($r['vn']??'')))===$name));if($hit)$reqs[]=['id'=>$r['id'],'title'=>(string)($r['ti']??'Untitled'),'status'=>(string)($r['st']??''),'location'=>(string)($r['loc']??''),'rate'=>(string)($r['rate']??''),'at'=>(int)($r['at']??0)];}
    $subs=[];$reqIds=array_fill_keys(array_column($reqs,'id'),1);foreach(colAll('rec/sub/items') as [$sid,$s]){$x=intelA($s);if(isset($reqIds[(string)($x['vreq']??'')])||($name!==''&&(mb_strtolower(trim((string)($x['vn']??'')))===$name||mb_strtolower(trim((string)($x['ec']??'')))===$name))){$subs[]=['id'=>(string)$sid,'candidate'=>(string)($x['cn']??''),'req'=>(string)($x['req']??''),'status'=>(string)($x['st']??''),'date'=>(string)($x['d']??''),'score'=>(int)($x['score']??0)];}}
    usort($reqs,fn($x,$y)=>($y['at']??0)<=>($x['at']??0));
    usort($acts,fn($x,$y)=>(int)($y['at']??$y['u']??0)<=>(int)($x['at']??$x['u']??0));
    return ['account'=>$a,'contacts'=>array_slice($contacts,0,100),'deals'=>array_slice($deals,0,100),'requirements'=>array_slice($reqs,0,100),'submissions'=>array_slice($subs,0,200),'activities'=>array_slice($acts,0,100),'stats'=>['contacts'=>count($contacts),'deals'=>count($deals),'requirements'=>count($reqs),'submissions'=>count($subs)]];
}
function intelReqSla(): array
{
    $now=now();$rows=[];$first=[];
    foreach(colAll('rec/sub/items') as [$sid,$s]){$x=intelA($s);$rid=(string)($x['vreq']??'');if($rid==='')continue;$t=(int)($x['at']??0);if($t>0&&(!isset($first[$rid])||$t<$first[$rid]))$first[$rid]=$t;}
    foreach(intelReqs() as $r){$st=(string)($r['st']??'new');if(!in_array($st,['new','open','working','submitted','interview'],true))continue;$at=(int)($r['at']??$r['u']??0);$age=$at>0?(int)floor(($now-$at)/86400000):0;$firstHours=isset($first[$r['id']])&&$at>0?round(($first[$r['id']]-$at)/3600000,1):null;$pri=strtolower((string)($r['priority']??''));$target=$pri==='urgent'||$pri==='high'?1:3;$risk=$firstHours===null?($age>$target?'breach':($age===$target?'risk':'ok')):'ok';$rows[]=['id'=>$r['id'],'title'=>(string)($r['ti']??'Untitled'),'client'=>(string)($r['cl']??$r['ec']??$r['vn']??''),'status'=>$st,'priority'=>$pri?:'normal','ageDays'=>$age,'firstSubmissionHours'=>$firstHours,'risk'=>$risk,'lastChange'=>(int)($r['u']??0),'href'=>intelHref('vreqs')];}
    usort($rows,fn($a,$b)=>['breach'=>0,'risk'=>1,'ok'=>2][$a['risk']]<=>['breach'=>0,'risk'=>1,'ok'=>2][$b['risk']]?:$b['ageDays']<=>$a['ageDays']);
    return ['rows'=>array_slice($rows,0,200),'breach'=>count(array_filter($rows,fn($x)=>$x['risk']==='breach')),'risk'=>count(array_filter($rows,fn($x)=>$x['risk']==='risk')),'open'=>count($rows)];
}
function intelWorkQueue(array $u): array
{
    $sla=intelReqSla();$out=[];$push=function($sev,$kind,$title,$detail,$href)use(&$out){$out[]=['sev'=>$sev,'kind'=>$kind,'title'=>$title,'detail'=>$detail,'href'=>$href];};
    foreach(array_slice($sla['rows'],0,30) as $x){if($x['risk']==='breach')$push('high','Requirement SLA',$x['title'],$x['ageDays'].' days open · no first submission inside target',$x['href']);elseif($x['risk']==='risk')$push('medium','Requirement SLA',$x['title'],'Approaching first-submission target',$x['href']);}
    foreach(intelCandidates() as $c){$st=(string)($c['st']??'new');$uAt=(int)($c['u']??$c['at']??0);if(in_array($st,['new','screen','interview','offer'],true)&&$uAt>0&&$uAt<now()-7*86400000)$push('medium','Candidate follow-up',(string)($c['n']??'Candidate'),$st.' · no change for '.(int)floor((now()-$uAt)/86400000).' days',intelHref('ats',['c'=>$c['id']]));if(count($out)>80)break;}
    try{$m=intelMail();if($m['bounced30']+$m['failed30']>0)$push('medium','Deliverability','Email failures need review',($m['bounced30']+$m['failed30']).' bounced/failed in 30 days',intelHref('mail-cleanup'));}catch(Throwable $e){}
    $rank=['high'=>0,'medium'=>1,'low'=>2];usort($out,fn($a,$b)=>$rank[$a['sev']]<=>$rank[$b['sev']]);return ['rows'=>array_slice($out,0,80),'n'=>count($out),'generatedAt'=>now()];
}
function intelDeliverability(bool $live=false): array
{
    require_once __DIR__ . '/mailbulk.php';
    $d=$live?mailDelivCheck(''):(mkvGet('deliv_check',[])?:mailDelivCheck(''));
    $rep=mailRepStats(30);$warm=mailWarmCap();$mail=intelMail();
    return ['check'=>$d,'rep'=>$rep,'warm'=>$warm,'mail'=>$mail,'href'=>intelHref('mail')];
}
function intelIntegrationEvents(): array
{
    $rows=[];try{$q=secdb()->query("SELECT seq,at,who,act,target,detail FROM audit_log WHERE (act LIKE '%iLabor%' OR act LIKE '%Oorwin%' OR act LIKE '%Mailgun%' OR act LIKE '%bounce%' OR act LIKE '%Vendor auto-reply%' OR act LIKE '%integration%') ORDER BY seq DESC LIMIT 120");foreach($q->fetchAll() as $r){$act=(string)$r['act'];$replay='';if(stripos($act,'iLabor')!==false)$replay='ilabor';elseif(stripos($act,'bounce')!==false||stripos($act,'Mailgun')!==false)$replay='bounce';elseif(stripos($act,'Vendor auto-reply')!==false)$replay='vendor-agent';$rows[]=['seq'=>(int)$r['seq'],'at'=>(int)$r['at'],'who'=>(string)$r['who'],'act'=>$act,'target'=>(string)$r['target'],'detail'=>(string)$r['detail'],'replay'=>$replay];}}catch(Throwable $e){}
    return $rows;
}
function intelReplay(string $kind,array $u): array
{
    if(!hasRole($u,'admin'))fail(403,'forbidden','Only an administrator can replay an integration action.'); requireRecentAuth(); @set_time_limit(360);
    if($kind==='ilabor'){require_once __DIR__.'/connectors.php';$res=cxPull('replayed by '.$u['name']);audit('data','Integration replay: iLabor pull','ilabor',$res,$u);return ['kind'=>$kind,'result'=>$res];}
    if($kind==='bounce'){require_once __DIR__.'/tools.php';$res=mailBounceSync(true);audit('data','Integration replay: bounce sync','mail',$res,$u);return ['kind'=>$kind,'result'=>$res];}
    if($kind==='vendor-agent'){require_once __DIR__.'/vmsagent.php';$res=vmaCron();audit('data','Integration replay: vendor auto-reply agent','vms_agent',$res,$u);return ['kind'=>$kind,'result'=>$res];}
    fail(400,'invalid_argument','That integration action cannot be replayed here.');
}
function intelForecast(): array
{
    $stageProb=['new'=>0.05,'applied'=>0.06,'screen'=>0.12,'submitted'=>0.22,'interview'=>0.45,'offer'=>0.75,'hired'=>1.0];$expected=0.0;$by=[];
    foreach(intelCandidates() as $c){$st=strtolower((string)($c['st']??'new'));$p=$stageProb[$st]??0.08;$expected+=$p;$by[$st]=($by[$st]??0)+$p;}
    $reqs=intelReqs();$open=count(array_filter($reqs,fn($r)=>in_array((string)($r['st']??'new'),['new','open','working','submitted','interview'],true)));
    return ['expectedPlacements90'=>round($expected,1),'openRequirements'=>$open,'stageExpected'=>array_map(fn($v)=>round($v,1),$by),'note'=>'Directional pipeline estimate based on current stage weights; it is not a guaranteed forecast.','at'=>now()];
}
function intelActions(): array
{
    $rows=[];foreach(colAll('intel/actions') as [$id,$o]){$a=intelA($o);$a['id']=(string)$id;$rows[]=$a;}usort($rows,fn($x,$y)=>(int)($y['at']??0)<=>(int)($x['at']??0));return array_slice($rows,0,100);
}
function intelActionPropose(array $b,array $u): array
{
    $type=in_array((string)($b['type']??''),['candidate_tag','candidate_note','requirement_note'],true)?(string)$b['type']:'';$target=intelS($b['target']??'',60);$text=intelS($b['text']??'',500);
    if($type===''||$target===''||$text==='')fail(400,'invalid_argument','Choose an action, target record and proposed value.');
    if($type!=='requirement_note')intelCandidateOne($target);else intelReqOne($target);
    $id=rid(18);$x=(object)['type'=>$type,'target'=>$target,'text'=>$text,'st'=>'pending','at'=>now(),'by'=>(string)$u['id'],'byn'=>(string)$u['name'],'decAt'=>0,'decn'=>'','result'=>''];docSet('intel/actions/'.$id,$x);audit('data','AI action proposed',$id,['type'=>$type,'target'=>$target],$u);return ['id'=>$id]+intelA($x);
}
function intelActionDecide(string $id,string $decision,array $u): array
{
    if(!hasRole($u,'admin'))fail(403,'forbidden','Only an administrator can approve operational AI actions.');requireRecentAuth();if(!preg_match('/^[A-Za-z0-9_-]{1,40}$/',$id))fail(400,'invalid_argument','Choose an action.');$x=docGet('intel/actions/'.$id);if(!$x)fail(404,'not_found','That action was not found.');if((string)($x->st??'')!=='pending')fail(409,'invalid_argument','That action was already decided.');
    if($decision==='reject'){$x->st='rejected';$x->decAt=now();$x->decn=(string)$u['name'];docSet('intel/actions/'.$id,$x);audit('data','AI action rejected',$id,[], $u);return intelA($x)+['id'=>$id];}
    if($decision!=='approve')fail(400,'invalid_argument','Choose approve or reject.');$type=(string)$x->type;$target=(string)$x->target;$text=(string)$x->text;$result='';
    if($type==='candidate_tag'){$c=docGet('ats/'.$target);if(!$c)fail(404,'not_found','Candidate is gone.');$tags=array_values(array_unique(array_filter(array_merge(array_map('strval',(array)($c->tags??[])),[$text]))));$c->tags=array_slice($tags,0,40);$c->u=now();docSet('ats/'.$target,$c);$result='Candidate tag added.';}
    elseif($type==='candidate_note'){$c=docGet('ats/'.$target);if(!$c)fail(404,'not_found','Candidate is gone.');$notes=array_values((array)($c->notes??[]));$notes[]=(object)['x'=>$text,'at'=>now(),'by'=>(string)$u['name']];$c->notes=array_slice($notes,-100);$c->u=now();docSet('ats/'.$target,$c);$result='Candidate note added.';}
    elseif($type==='requirement_note'){require_once __DIR__.'/vms.php';$c=docGet(VMS_REQ.'/'.$target);if(!$c)fail(404,'not_found','Requirement is gone.');$log=array_values((array)($c->vlog??[]));$log[]=(object)['t'=>now(),'ev'=>'Approved AI note: '.$text,'by'=>(string)$u['name']];$c->vlog=array_slice($log,-80);$c->u=now();docSet(VMS_REQ.'/'.$target,$c);$result='Requirement note added to its update history.';}
    $x->st='approved';$x->decAt=now();$x->decn=(string)$u['name'];$x->result=$result;docSet('intel/actions/'.$id,$x);audit('data','AI action approved',$id,['type'=>$type,'target'=>$target],$u);return intelA($x)+['id'=>$id];
}

function intelRoute(string $r,array $b): never
{
    $u=intelStaff();
    switch($r){
      case 'intel_summary': ok(intelSummary($u));
      case 'intel_search': ok(['rows'=>intelSearch(intelS($b['q']??'',120))]);
      case 'intel_candidate': ok(intelCandidate(intelS($b['id']??'',60)));
      case 'intel_readiness': ok(intelReadiness(intelS($b['candidate']??'',60),intelS($b['requirement']??'',80)));
      case 'intel_client_search': ok(['rows'=>intelClientSearch(intelS($b['q']??'',120))]);
      case 'intel_client': ok(intelClient360(intelS($b['id']??'',60)));
      case 'intel_sla': ok(intelReqSla());
      case 'intel_work_queue': ok(intelWorkQueue($u));
      case 'intel_deliverability': ok(intelDeliverability(!empty($b['refresh'])));
      case 'intel_events': ok(['rows'=>intelIntegrationEvents()]);
      case 'intel_replay': ok(intelReplay(intelS($b['kind']??'',30),$u));
      case 'intel_forecast': ok(intelForecast());
      case 'intel_actions': ok(['rows'=>intelActions()]);
      case 'intel_action_propose': ok(intelActionPropose($b,$u));
      case 'intel_action_decide': ok(intelActionDecide(intelS($b['id']??'',40),intelS($b['decision']??'',20),$u));
      case 'intel_refresh': requireRecentAuth(); ok(intelSummary($u));
    }
    fail(404,'not_found','Unknown intelligence action.');
}
