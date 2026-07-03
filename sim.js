/* ============================================================
   MYCELIA — homeostasis simulator (v2).
   The question this answers: is reaching BIOSTASIS a moderate-tension
   knife-edge? i.e.
     • can a careful play-style reach a stable lock MOST of the time,
     • does a greedy play-style boom-bust and fail (a real skill gradient),
     • do differently-niched factions COEXIST,
     • is the outcome LEGIBLE early, and the pacing bounded (no slog)?
   Usage:  node sim.js [gamesPer]
   ============================================================ */
const M = require('./engine.js');
const { createGame, POLICIES, FACTIONS, mulberry32 } = M;
const FKEYS = Object.keys(FACTIONS);
const N = parseInt(process.argv[2]||'300',10);
const SEC_PER_TURN = 35;

// Play one full game. policyMap: {faction: policyName}. Records per-colony series.
function runGame(policyMap, seed){
  const rng=mulberry32(seed);
  const api=createGame({ rng, factions:FKEYS.slice(),
    policyFor:(col)=>POLICIES[policyMap[col.faction]], scoreMode:true });
  const s=api.state;
  const recs={}; for(const c of s.colonies) recs[c.faction]={faction:c.faction,
    policy:policyMap[c.faction], series:[], lockCycle:null, collapsed:false};
  let guard=0;
  while(!s.over && guard++<200){
    api.endTurn();
    for(const c of s.colonies){ const r=recs[c.faction];
      r.series.push({bio:api.totalBio(c), meter:c.meter, dom:api.dominance(c)});
      if(c.biostasis && r.lockCycle===null) r.lockCycle=s.turn;
      if(!c.alive) r.collapsed=true;
    }
  }
  return { recs:Object.values(recs), turns:s.turn, winner:s.winner, reason:s.reason };
}

function pct(x){return (100*x).toFixed(0).padStart(4)+'%'}
function pad(s,n){return String(s).padEnd(n)}
function bar(w){const n=Math.max(0,Math.min(24,Math.round(w*24)));return ' '+'█'.repeat(n)+'░'.repeat(24-n);}

// crashes = times the meter dropped hard cycle-to-cycle (boom-bust events)
function crashes(series){ let n=0; for(let i=1;i<series.length;i++)
  if(series[i-1].meter>0.2 && series[i].meter < series[i-1].meter-0.15) n++; return n; }

// ============================================================
//  A. TENSION — each play-style against itself (all 3 colonies same policy)
// ============================================================
function tension(){
  console.log('\n══════════ A. TENSION / DIFFICULTY (mirror games) ══════════');
  console.log('   Is biostasis a knife-edge? careful = locks often, greedy = boom-busts.\n');
  console.log('   '+pad('policy',12)+pad('biostasis',11)+pad('collapse',10)+pad('crashes',9)+pad('cyc→lock',9));
  for(const P of Object.keys(POLICIES)){
    let lock=0,coll=0,crash=0,cyc=0,cycN=0,cols=0;
    for(let i=0;i<N;i++){
      const map={}; FKEYS.forEach(f=>map[f]=P);
      const gme=runGame(map, (i*2654435761)>>>0 ^ hash(P));
      for(const r of gme.recs){ cols++;
        if(r.lockCycle!==null){ lock++; cyc+=r.lockCycle; cycN++; }
        if(r.collapsed) coll++;
        crash+=crashes(r.series);
      }
    }
    console.log('   '+pad(P,12)+bar(lock/cols).slice(0,0)
      +pad(pct(lock/cols),11)+pad(pct(coll/cols),10)
      +pad((crash/cols).toFixed(1),9)+pad(cycN?(cyc/cycN).toFixed(0):'—',9));
  }
}

// ============================================================
//  B. SKILL GRADIENT & COEXISTENCE (mixed games, rotated assignments)
// ============================================================
function gradient(){
  console.log('\n══════════ B. SKILL GRADIENT & COEXISTENCE (mixed games) ══════════');
  const styles=Object.keys(POLICIES);
  const lock={},dom={},play={}; styles.forEach(p=>{lock[p]=0;dom[p]=0;play[p]=0;});
  let coexist=0, soloWin=0, games=0;
  for(let i=0;i<N;i++){
    // rotate a different policy onto each faction so每 style sees every niche
    const perm=styles.slice().sort(()=> (hash(i+'x')%2? 1:-1)).slice(0,3);
    while(perm.length<3) perm.push(styles[perm.length%styles.length]);
    const map={}; FKEYS.forEach((f,k)=>map[f]=perm[k%perm.length]);
    const gme=runGame(map,(i*40503+7)>>>0); games++;
    let locked=0;
    for(const r of gme.recs){ play[r.policy]++;
      if(r.lockCycle!==null){ lock[r.policy]++; locked++; }
      dom[r.policy]+= r.series.length? r.series[r.series.length-1].dom : 0;
    }
    if(locked>=2) coexist++; else if(locked===1) soloWin++;
  }
  console.log('\n   Biostasis rate & avg final dominance by play-style:');
  console.log('   '+pad('policy',12)+pad('biostasis',12)+'avg dominance');
  for(const p of styles) console.log('   '+pad(p,12)+pad(pct(lock[p]/(play[p]||1)),12)+pct(dom[p]/(play[p]||1)));
  console.log(`\n   Coexistence (≥2 webs locked): ${pct(coexist/games)}`);
  console.log(`   Single stable web:            ${pct(soloWin/games)}`);
}

// ============================================================
//  C. LEGIBILITY & PACING
// ============================================================
function legibility(){
  console.log('\n══════════ C. LEGIBILITY & PACING ══════════');
  let earlyRight=0, games=0, turns=0, seasonEnd=0, lockEnd=0, collapseEnd=0;
  const styles=Object.keys(POLICIES);
  for(let i=0;i<N;i++){
    const map={}; FKEYS.forEach((f,k)=>map[f]=styles[(i+k)%styles.length]);
    const gme=runGame(map,(i*2246822519)>>>0); games++; turns+=gme.turns;
    if(gme.reason==='season') seasonEnd++;
    else if(gme.reason==='biostasis') lockEnd++;
    else if(gme.reason==='collapse'||gme.reason==='last-web') collapseEnd++;
    // who led dominance at ~40% of the game?
    const mid=Math.max(1,Math.floor(gme.turns*0.4));
    let lead=null,lv=-1;
    for(const r of gme.recs){ const pt=r.series[Math.min(mid,r.series.length-1)];
      if(pt && pt.dom>lv){lv=pt.dom;lead=r.faction;} }
    if(lead && lead===gme.winner) earlyRight++;
  }
  const avgT=turns/games;
  console.log(`   Avg game length      ${avgT.toFixed(1)} cycles  ≈ ${(avgT*SEC_PER_TURN/60).toFixed(1)} min`);
  console.log(`   Ended by biostasis   ${pct(lockEnd/games)}   (someone reached a stable lock)`);
  console.log(`   Ended by season cap  ${pct(seasonEnd/games)}   (chaos never settled — want LOW-ish)`);
  console.log(`   Ended by collapse    ${pct(collapseEnd/games)}`);
  console.log(`   Early leader → winner ${pct(earlyRight/games)}  (mid-game dominance predicts result → legible)`);
}

function hash(s){s=''+s;let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}

console.log(`\nMYCELIA homeostasis sim — ${N} games per cell, factions: ${FKEYS.join(', ')}`);
tension();
gradient();
legibility();
console.log('');
