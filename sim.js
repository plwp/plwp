/* ============================================================
   MYCELIA — headless meta & drama simulator.
   Runs thousands of AI-vs-AI matches on the canonical engine to:
     1. discover the META  — which builds / factions win, and matchups
     2. measure the DRAMA  — match length, closeness, comebacks, blowouts
   Usage:  node sim.js [gamesPerMatchup]
   ============================================================ */
const M = require('./engine.js');
const { createGame, POLICIES, FACTIONS, mulberry32 } = M;

const N = parseInt(process.argv[2]||'200',10);   // games per matchup
const BUILDS = Object.keys(POLICIES).filter(k=>k!=='greedy'&&k!=='adaptive');
const FACS = Object.keys(FACTIONS);
// "natural" build each faction leans into, for the faction tournament
const NATIVE = { amanita:'deceiver', psilocybe:'psychonaut', boletus:'glutton' };
const SEC_PER_TURN = 55;   // assumed human planning time → maps turns to a ~30min budget

// Play one match: policyA drives "you", policyB drives "rival". Returns a record.
function playMatch(policyA, policyB, facA, facB, seed){
  const rng = mulberry32(seed);
  const api = createGame({ rng, factions:{you:facA, rival:facB},
                           rivalPolicy: POLICIES[policyB] });
  const s = api.state;
  const series=[];   // [youTiles, rivalTiles] per turn
  let guard=0;
  while(!s.over && guard++<200){
    POLICIES[policyA](api, s.you);      // "you" plans its turn
    api.endTurn();                      // resolve world + rival plans + resolve
    series.push([api.tilesOf(s.you), api.tilesOf(s.rival)]);
  }
  return { winner:s.winner, reason:s.reason, turns:s.turn, series };
}

// ---- drama metrics from a single match's tile series ----
function drama(rec){
  const S=rec.series; if(!S.length) return null;
  let leadChanges=0, closeTurns=0, prevSign=0, slogTurns=0;
  let winnerMaxDeficit=0;                       // biggest hole the winner climbed out of
  const winIsYou = rec.winner==='you';
  for(const [y,r] of S){
    const diff=y-r, tot=y+r||1;
    const sign=Math.sign(diff);
    if(sign!==0 && prevSign!==0 && sign!==prevSign) leadChanges++;
    if(sign!==0) prevSign=sign;
    if(Math.abs(diff)/tot < 0.15) closeTurns++;   // neck-and-neck this turn
    const winnerDiff = winIsYou ? diff : -diff;   // winner's margin at this point
    if(winnerDiff < 0) winnerMaxDeficit=Math.max(winnerMaxDeficit,-winnerDiff);
    if(winnerDiff/tot > 0.28) slogTurns++;        // turns the loser spent clearly behind
  }
  const closeFrac = closeTurns/S.length;
  const comeback = winnerMaxDeficit>=3;           // winner was behind by 3+ tiles and recovered
  // blowout = winner led the entire back half by a wide margin
  const half=Math.floor(S.length/2);
  const backHalf=S.slice(half);
  const blowout = rec.reason!=='season' && backHalf.every(([y,r])=>{
    const d=winIsYou?y-r:r-y, tot=y+r||1; return d/tot>0.35; });
  return { leadChanges, closeFrac, comeback, blowout, winnerMaxDeficit, slogTurns };
}

function pct(x){return (100*x).toFixed(0).padStart(3)+'%'}
function pad(s,n){return String(s).padEnd(n)}

// ============================================================
//  1. BUILD TOURNAMENT — round-robin, factions randomized per game
// ============================================================
function buildTournament(){
  const wins={}, plays={}; BUILDS.forEach(b=>{wins[b]=0;plays[b]=0;});
  const matrix={}; BUILDS.forEach(a=>{matrix[a]={}; BUILDS.forEach(b=>matrix[a][b]=0);});
  const dramaAgg={leadChanges:0,closeFrac:0,comebacks:0,blowouts:0,turns:0,decided:0,games:0,seasonTimeouts:0,slog:0};

  for(const A of BUILDS) for(const B of BUILDS){
    if(A===B) continue;
    let aWins=0;
    for(let i=0;i<N;i++){
      const seed=(hash(A)*31+hash(B)*7+i*97)>>>0;
      const facA=FACS[i%3], facB=FACS[(i+1)%3];       // rotate factions to average them out
      const rec=playMatch(A,B,facA,facB,seed);
      const d=drama(rec);
      if(rec.winner==='you'){aWins++; wins[A]++;} else if(rec.winner==='rival') wins[B]++;
      plays[A]++; plays[B]++;
      if(d){ dramaAgg.leadChanges+=d.leadChanges; dramaAgg.closeFrac+=d.closeFrac;
        dramaAgg.comebacks+=d.comeback?1:0; dramaAgg.blowouts+=d.blowout?1:0;
        dramaAgg.turns+=rec.turns; dramaAgg.slog+=d.slogTurns; dramaAgg.games++;
        if(rec.reason==='season') dramaAgg.seasonTimeouts++; }
    }
    matrix[A][B]=aWins/N;
  }

  console.log('\n══════════ BUILD META (win rate as the "you" seat, vs each build) ══════════');
  const ranked=BUILDS.map(b=>[b, wins[b]/plays[b]]).sort((a,b)=>b[1]-a[1]);
  console.log('\n  Overall win rate (higher = stronger in the current meta):');
  for(const [b,w] of ranked) console.log('   '+pad(b,11)+bar(w)+' '+pct(w));

  console.log('\n  Matchup matrix — row beats column (%):');
  console.log('   '+pad('',11)+BUILDS.map(b=>pad(b.slice(0,5),6)).join(''));
  for(const A of BUILDS){
    let row='   '+pad(A,11);
    for(const B of BUILDS){ row += A===B ? pad('·',6) : pad((matrix[A][B]*100).toFixed(0),6); }
    console.log(row);
  }
  return dramaAgg;
}

// ============================================================
//  2. FACTION TOURNAMENT — each faction plays its native build
// ============================================================
function factionTournament(){
  const wins={}; FACS.forEach(f=>wins[f]=0);
  const matrix={}; FACS.forEach(a=>{matrix[a]={}; FACS.forEach(b=>matrix[a][b]=0);});
  for(const A of FACS) for(const B of FACS){
    if(A===B) continue; let aWins=0;
    for(let i=0;i<N;i++){
      const seed=(hash(A)*53+hash(B)*11+i*131)>>>0;
      const rec=playMatch(NATIVE[A],NATIVE[B],A,B,seed);
      if(rec.winner==='you') aWins++;
    }
    matrix[A][B]=aWins/N; wins[A]+=aWins;
  }
  console.log('\n══════════ FACTION META (each running its native build) ══════════');
  console.log('\n  Matchup matrix — row faction beats column (%):');
  console.log('   '+pad('',11)+FACS.map(f=>pad(f.slice(0,6),8)).join(''));
  for(const A of FACS){
    let row='   '+pad(A,11);
    for(const B of FACS){ row += A===B ? pad('·',8) : pad((matrix[A][B]*100).toFixed(0),8); }
    console.log(row);
  }
}

function reportDrama(d){
  const g=d.games||1;
  const avgTurns=d.turns/g, mins=avgTurns*SEC_PER_TURN/60;
  console.log('\n══════════ DRAMA / EMOTIONAL ARC ══════════');
  console.log(`   Avg match length     ${avgTurns.toFixed(1)} turns  ≈ ${mins.toFixed(1)} min  (target ≤ 30)`);
  console.log(`   Lead changes / game  ${(d.leadChanges/g).toFixed(2)}   (comebacks depend on this being > 0)`);
  console.log(`   Close-game feel      ${pct(d.closeFrac/g)} of turns neck-and-neck (<15% margin)`);
  console.log(`   Comeback rate        ${pct(d.comebacks/g)} of games (winner was down 3+ tiles)`);
  console.log(`   Blowout rate         ${pct(d.blowouts/g)} of games (one-sided back half)  ← want LOW`);
  console.log(`   Loser slog / game    ${(d.slog/g).toFixed(1)} turns spent clearly behind before the end  ← want LOW (merciful)`);
  console.log(`   Season timeouts      ${pct(d.seasonTimeouts/g)} (hit 60-turn cap → too slow/stally)`);
}

// ============================================================
//  3. AI FAIRNESS — is the adaptive opponent challenging but beatable?
//  Play it in BOTH seats vs every build to net out the first-mover edge.
// ============================================================
function aiFairness(){
  console.log('\n══════════ ADAPTIVE AI — challenging but fair? ══════════');
  console.log('   (win% averaged over both seats vs each build; ~45–60% = fair-but-tough)');
  let total=0,cnt=0;
  for(const B of BUILDS){
    let w=0,n2=0;
    for(let i=0;i<N;i++){
      const facA=FACS[i%3], facB=FACS[(i+1)%3];
      // adaptive as "you"
      let r=playMatch('adaptive',B,facA,facB,(hash('ai'+B)+i*17)>>>0);
      if(r.winner==='you')w++; n2++;
      // adaptive as "rival"
      r=playMatch(B,'adaptive',facB,facA,(hash('ia'+B)+i*29)>>>0);
      if(r.winner==='rival')w++; n2++;
    }
    const wr=w/n2; total+=wr; cnt++;
    console.log('   vs '+pad(B,11)+bar(wr)+' '+pct(wr));
  }
  console.log('   '+pad('AVERAGE',14)+bar(total/cnt)+' '+pct(total/cnt));
}

function bar(w){const n=Math.round(w*24);return ' '+'█'.repeat(n)+'░'.repeat(24-n);}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}

console.log(`\nMYCELIA simulator — ${N} games per matchup, ${BUILDS.length} builds, ${FACS.length} factions`);
console.log(`(${BUILDS.length*(BUILDS.length-1)*N + FACS.length*(FACS.length-1)*N} total matches)`);
const dramaAgg=buildTournament();
factionTournament();
aiFairness();
reportDrama(dramaAgg);
console.log('');
