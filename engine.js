/* ============================================================
   MYCELIA — ecology engine (v2). No combat. Shared tiles.
   You steer a chaotic multi-species web toward HOMEOSTASIS: the
   goal is to reach a stable, self-sustaining equilibrium (the
   "stability lock") before the season ends, without boom-busting.
   Dominance (who is the biggest node of the stable web) is an
   OPTIONAL competitive lens over the same simulation.

   Single source of truth for the UI (index.html) and the homeostasis
   simulator (sim.js). Instance-based + seedable RNG.
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Mycelia = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

// ---- tunables (the dials we move to hit "moderate tension") ----
const T = {
  EXTRACT:   0.28,  // max fraction of a pool harvestable per cycle
  MAINT:     0.17,  // upkeep per unit biomass (starvation lever)
  GROWTH:    0.55,  // how fast net energy becomes biomass
  ENERGY_TAX:0.30,  // fraction of gross harvest banked as spendable energy
  REGEN:     1.0,   // global multiplier on per-resource regen
  SEED_BIO:  1.6,   // biomass a new seed establishes
  MIN_ALIVE: 1.5,   // below this total biomass a colony is functionally dead
  SIZE_MIN:  18,    // a biostasis must be a real web this big — you must GROW to win
  VOL_REF:   0.20,  // volatility (stdev/mean) that scores as "unstable"
  WIN_WINDOW:5,     // cycles of history used for volatility
  LOCK:      0.80,  // homeostasis-meter level that counts as "in balance"
  LOCK_HOLD: 4,     // cycles you must hold it to achieve biostasis
  SEASON:    45,    // hard cycle cap (≈ match length budget)
  METER_EASE:0.28,  // how fast the meter tracks current health
  CRASH_DROP:0.14,  // a biomass drop this large (fraction) snaps the meter down
};

// ---- resources: the pools colonies decompose. tough = Diet gate. ----
// regen is now an INTRINSIC (logistic) growth rate: a pool regrows fastest at
// half-capacity and not at all near zero — so over-extraction can collapse it for good.
const RES = {
  wood:  {name:'Wood',   color:'#6b4a2a', regen:0.55, tough:3},
  dung:  {name:'Dung',   color:'#7a6a3a', regen:0.95, tough:1},
  litter:{name:'Litter', color:'#4a3f2a', regen:0.80, tough:1},
  soil:  {name:'Soil',   color:'#3f5233', regen:0.60, tough:0},   // shared, weak, contested
};
const RES_KEYS = Object.keys(RES);

// ---- ten traits (0..5), grouped by the route they serve ----
const TRAITS = [
  {key:'mycelium',    label:'Mycelium',    desc:'Seed reach & more seeds per cycle', tag:'grow'},
  {key:'diet',        label:'Diet',        desc:'Extraction efficiency + eat beyond your niche', tag:'grow'},
  {key:'toxicity',    label:'Toxicity',    desc:'Repels grazers; but keeps foragers away', tag:'def'},
  {key:'edibility',   label:'Edibility',   desc:'Foragers seek & disperse you (grazed harder)', tag:'def'},
  {key:'mimicry',     label:'Mimicry',     desc:'Hijack a RIVAL faction’s foragers to spread', tag:'trick'},
  {key:'psychotropic',label:'Psychotropics',desc:'Manipulated dispersers; cultivation appeal', tag:'trick'},
  {key:'symbiosis',   label:'Symbiosis',   desc:'Build allied web: stable food, anti-crash', tag:'sym'},
  {key:'gills',       label:'Gills',       desc:'More spores per fruiting', tag:'repro'},
  {key:'spores',      label:'Spores',      desc:'Dispersal range & germination', tag:'repro'},
  {key:'restraint',   label:'Restraint',   desc:'Lower upkeep & smoother growth (stability)', tag:'sym'},
];
const upCost = lvl => 6 + lvl*5;

// ---- factions: a keystone fungus + its niche + allied web ----
const FACTIONS = {
  boletus:{ name:'Boletus', tag:'The Feast', color:'#e8c34a', niche:'wood',
    effect:'Choice edible — foragers carry you far.', allies:'foragers, forest hosts' },
  psilocybe:{ name:'Psilocybe', tag:'The Prophet', color:'#c47cff', niche:'dung',
    effect:'Psychedelic — humans cultivate & protect you.', allies:'cultivators, grazers' },
  amanita:{ name:'Amanita', tag:'The Deceiver', color:'#e0524d', niche:'litter',
    effect:'Iconic & toxic — admired, mimicked, feared.', allies:'host trees, deceived foragers' },
};
const FKEYS = Object.keys(FACTIONS);

function mulberry32(a){ return function(){
  a|=0; a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t;
  return ((t^t>>>14)>>>0)/4294967296;
};}
const clamp01=x=>x<0?0:x>1?1:x;
const mean=a=>a.reduce((s,v)=>s+v,0)/(a.length||1);
function stdev(a){ if(a.length<2) return 0; const m=mean(a);
  return Math.sqrt(mean(a.map(v=>(v-m)*(v-m)))); }

// ============================================================
//  GAME INSTANCE
// ============================================================
function createGame(opts={}){
  const COLS=opts.cols||14, ROWS=opts.rows||11;
  const rng=opts.rng||Math.random;
  const logfn=opts.log||(()=>{});
  const scoreMode=opts.scoreMode!==false;          // dominance lens on by default
  // which factions are in play (default all three, one colony each)
  const facs=opts.factions||FKEYS.slice();
  const playerFaction=opts.playerFaction||facs[0];

  const g={ COLS, ROWS, rng, turn:1, over:false, winner:null, reason:null,
            season:T.SEASON, grid:[], colonies:[], scoreMode };
  const idx=(x,y)=>y*COLS+x;
  const inB=(x,y)=>x>=0&&y>=0&&x<COLS&&y<ROWS;

  function mkColony(i,key){
    return { i, faction:key, niche:FACTIONS[key].niche, isYou:key===playerFaction,
      genome:{mycelium:1,diet:1,toxicity:0,edibility:0,mimicry:0,psychotropic:0,
              symbiosis:0,gills:1,spores:1,restraint:0},
      energy:10, growthLeft:0, hist:[], meter:0, hold:0, biostasis:false, alive:true };
  }

  function genMap(){
    g.grid=[];
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
      // a dominant substrate per tile, clustered by cheap noise
      const n=(Math.sin(x*0.6)+Math.cos(y*0.8)+Math.sin((x+y)*0.5))*1.2+2;
      const kinds=['soil','litter','dung','wood','soil','litter'];
      const dom=kinds[Math.max(0,Math.min(kinds.length-1,Math.round(n)))];
      const cap={}, pool={};
      for(const r of RES_KEYS){ const base = r===dom?9:(r==='soil'?3:1);
        cap[r]=base; pool[r]=base*(0.7+rng()*0.3); }
      g.grid.push({x,y,dom,cap,pool,bio:facs.map(()=>0)});
    }
    g.colonies=facs.map((k,i)=>mkColony(i,k));
    // seed each colony onto a tile rich in its niche, spread apart
    const spots={wood:[2,ROWS-2],dung:[COLS-3,ROWS-3],litter:[Math.floor(COLS/2),1],soil:[2,2]};
    g.colonies.forEach(c=>{ const [sx,sy]=spots[c.niche]||[2,2];
      const t=bestNearby(sx,sy,c.niche); t.bio[c.i]=T.SEED_BIO*2; });
    beginTurn();
  }
  function bestNearby(x,y,res){ let best=g.grid[idx(clampX(x),clampY(y))], bv=-1;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){ const nx=clampX(x+dx),ny=clampY(y+dy);
      const t=g.grid[idx(nx,ny)]; if(t.cap[res]>bv){bv=t.cap[res];best=t;} } return best; }
  const clampX=x=>Math.max(0,Math.min(COLS-1,x)), clampY=y=>Math.max(0,Math.min(ROWS-1,y));

  // ---- niche / diet ----
  // efficiency at extracting a resource: strong in your niche, weak on shared soil,
  // and only able to touch other niches if Diet is high enough (generalist).
  function dietEff(col,res){
    const g_=col.genome;
    if(res===col.niche) return 0.5 + g_.diet*0.09 + g_.symbiosis*0.04;
    if(res==='soil')    return 0.22 + g_.diet*0.05;
    if(g_.diet >= RES[res].tough) return 0.10 + g_.diet*0.04;   // generalist reach
    return 0;                                                    // can't digest it
  }

  // ---- geometry ----
  const presence=col=>g.grid.filter(t=>t.bio[col.i]>0);
  const totalBio=col=>g.grid.reduce((s,t)=>s+t.bio[col.i],0);
  function neighbors(t){ const out=[];
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) if(inB(t.x+dx,t.y+dy)) out.push(g.grid[idx(t.x+dx,t.y+dy)]);
    return out; }
  function reachable(col){
    const range=1, set=new Set();
    for(const t of presence(col)) for(const n of neighbors(t))
      if(n.bio[col.i]<=0 && edible(col,n)) set.add(n);
    return [...set];
  }
  const edible=(col,t)=> RES_KEYS.some(r=>t.pool[r]>0.5 && dietEff(col,r)>0);
  function maxSeeds(col){ return 1+Math.floor(col.genome.mycelium*0.8); }
  function seedCost(col,t){ return Math.max(2, Math.round(4 - col.genome.mycelium*0.4)); }

  // ---- actions ----
  function seed(col,t){
    if(t.bio[col.i]>0 || col.growthLeft<=0 || !edible(col,t)) return false;
    const c=seedCost(col,t); if(col.energy<c) return false;
    col.energy-=c; col.growthLeft--;
    t.bio[col.i]=T.SEED_BIO; return true;
  }
  function upgrade(col,key){
    const lvl=col.genome[key]; if(lvl>=5) return false;
    const c=upCost(lvl); if(col.energy<c) return false;
    col.energy-=c; col.genome[key]++; return true;
  }

  // ---- the ecology: order-independent resource competition + growth ----
  function ecology(){
    const gainTile=g.grid.map(()=>g.colonies.map(()=>0));
    for(let ti=0;ti<g.grid.length;ti++){
      const t=g.grid[ti];
      for(const r of RES_KEYS){
        if(t.pool[r]<=0) continue;
        const w=g.colonies.map(c=> t.bio[c.i]>0 ? t.bio[c.i]*dietEff(c,r) : 0);
        const sw=w.reduce((s,v)=>s+v,0); if(sw<=0) continue;
        const take=Math.min(t.pool[r], t.pool[r]*T.EXTRACT + sw*0.05);
        for(const c of g.colonies){ if(w[c.i]<=0) continue;
          gainTile[ti][c.i]+= take*w[c.i]/sw; }
        t.pool[r]-=take;
      }
      // LOGISTIC regrowth: fast at mid-stock, ~zero near empty (overexploitation collapse).
      // A tiny floor lets a fully-crashed pool slowly reseed, so collapse is punishing, not permanent.
      for(const r of RES_KEYS){ const p=t.pool[r], k=t.cap[r];
        t.pool[r]=Math.min(k, p + RES[r].regen*T.REGEN*p*(1-p/k) + k*0.004); }
    }
    // grow / starve biomass; bank spendable energy
    for(let ti=0;ti<g.grid.length;ti++){ const t=g.grid[ti];
      for(const c of g.colonies){ let gross=gainTile[ti][c.i]; if(t.bio[c.i]<=0&&gross<=0) continue;
        // SYMBIOSIS: mycorrhizal partnership on your niche's host tiles yields extra food
        // that does NOT deplete the pool — so an allied web can sustainably grow bigger.
        if(c.genome.symbiosis>0 && t.dom===c.niche && t.bio[c.i]>0) gross += c.genome.symbiosis*0.13;
        const maint=t.bio[c.i]*(T.MAINT - c.genome.restraint*0.012);
        const net=gross*(1-T.ENERGY_TAX) - maint;
        c.energy += gross*T.ENERGY_TAX;
        t.bio[c.i]=Math.max(0, t.bio[c.i] + net*(T.GROWTH + c.genome.restraint*0.03));
        if(t.bio[c.i]<0.05) t.bio[c.i]=0;
      }
    }
  }

  // grazers: stochastic biomass loss, softened by Toxicity, worsened by Edibility
  function grazers(){
    for(const c of g.colonies){ const tiles=presence(c); if(tiles.length<2) continue;
      const hits=1+Math.floor(tiles.length/12);
      const risk=Math.max(0, 0.5 + c.genome.edibility*0.12 - c.genome.toxicity*0.15);
      for(let i=0;i<hits;i++){ if(rng()>risk) continue;
        const t=tiles[Math.floor(rng()*tiles.length)]; if(t) t.bio[c.i]*=0.7; }
    }
  }

  // dispersal: desirable/allied colonies get carried to distant edible tiles.
  // Mimicry lets you ride a RIVAL faction's foragers (extra long reach into their web).
  function dispersal(){
    for(const c of g.colonies){ const g_=c.genome;
      const appeal=g_.edibility+g_.psychotropic+g_.mimicry;
      if(appeal<=0) continue;
      if(g_.toxicity>g_.mimicry && g_.edibility===0) continue;   // obvious poison, not carried
      if(rng()>0.2+appeal*0.08) continue;
      const anchors=presence(c); if(!anchors.length) continue;
      const reach=3+g_.spores*2+(g_.mimicry>0?3:0);
      const shots=1+Math.floor((g_.gills+g_.spores)/2);
      for(let s=0;s<shots;s++){ const a=anchors[Math.floor(rng()*anchors.length)];
        const nx=clampX(a.x+Math.round((rng()*2-1)*reach)), ny=clampY(a.y+Math.round((rng()*2-1)*reach));
        const t=g.grid[idx(nx,ny)];
        if(t.bio[c.i]<=0 && edible(c,t) && rng()<0.4+g_.spores*0.1) t.bio[c.i]=T.SEED_BIO*0.6;
      }
    }
  }

  // ---- homeostasis health & meter (the visible endpoint) ----
  // sustainability: pools held at their harvest=regen equilibrium (~REF of cap) are
  // HEALTHY; "healthy" means "not crashing toward zero", not "full". Over-extraction
  // pushes a pool below REF and the score falls off — that's the overshoot signal.
  function poolHealth(col){ const tiles=presence(col); if(!tiles.length) return 0;
    let s=0,n=0; const REF=0.30;
    for(const t of tiles){ for(const r of RES_KEYS){ if(dietEff(col,r)>0.1){
      s+=clamp01((t.pool[r]/t.cap[r])/REF); n++; } } }
    return n? s/n : 0; }
  function volatility(col){ if(col.hist.length<3) return 1;
    const w=col.hist.slice(-T.WIN_WINDOW); const m=mean(w); return m>0? stdev(w)/m : 1; }
  function health(col){ const bio=totalBio(col);
    if(bio<T.MIN_ALIVE) return 0;
    const vScore=clamp01(1 - volatility(col)/T.VOL_REF);  // stability = flat biomass
    const ph=clamp01(poolHealth(col));                    // sustainability = healthy pools
    const grown=clamp01(bio/10);                          // must be a real web, not a speck
    return clamp01(0.50*vScore + 0.40*ph + 0.10*grown);
  }
  function updateMeters(){
    for(const c of g.colonies){ if(!c.alive) continue;
      const prev=c.hist.length?c.hist[c.hist.length-1]:0;
      const bio=totalBio(c); c.hist.push(bio);
      if(bio<T.MIN_ALIVE){ c.alive=false; c.meter=0; c.hold=0;
        if(c.isYou) logfn('💀 Your web collapsed.'); continue; }
      const h=health(c);
      c.meter += (h-c.meter)*T.METER_EASE;
      if(prev>0 && (prev-bio)/prev > T.CRASH_DROP){ c.meter*=0.6;        // boom-bust snaps it down
        if(c.isYou) logfn('⚠️ Overshoot — biomass crashed, stability lost'); }
      // must be BOTH stable (meter) and a real, substantial web (size) — no tiny hermit lock
      if(c.meter>=T.LOCK && bio>=T.SIZE_MIN){ c.hold++;
        if(c.hold>=T.LOCK_HOLD && !c.biostasis){ c.biostasis=true;
          if(c.isYou) logfn('🌿 Biostasis achieved — a stable, self-sustaining web!'); } }
      else c.hold=0;
    }
  }

  // dominance = share of *sustainable* production. The discount is STEEP: an unstable
  // giant (low meter) scores far below a stable medium web — healthiest equilibrium wins.
  function sustainableBio(col){ return totalBio(col) * clamp01((col.meter-0.25)/0.6); }
  function dominance(col){ const tot=g.colonies.reduce((s,c)=>s+sustainableBio(c),0);
    return tot>0? sustainableBio(col)/tot : 0; }

  // ---- end conditions ----
  function checkEnd(){
    const alive=g.colonies.filter(c=>c.alive);
    if(alive.length===0){ return finish(null,'collapse'); }
    if(alive.length===1 && g.colonies.length>1){ return finish(alive[0],'last-web'); }
    // biostasis reached: if scoring, the most dominant stable web wins; else first to lock.
    const locked=g.colonies.filter(c=>c.biostasis);
    if(locked.length){
      // let a couple cycles pass so ties/dominance settle, then call it
      g._lockAge=(g._lockAge||0)+1;
      if(g._lockAge>=3 || locked.length===alive.length){
        const win = scoreMode ? locked.slice().sort((a,b)=>dominance(b)-dominance(a))[0] : locked[0];
        return finish(win,'biostasis');
      }
    }
    if(g.turn>g.season){
      // reaching biostasis is the point: a stable web beats any unstable one, however big.
      // Dominance only breaks ties among those who actually stabilised.
      const rank=alive.slice().sort((a,b)=>
        (b.biostasis-a.biostasis) || (scoreMode?dominance(b)-dominance(a):b.meter-a.meter));
      return finish(rank[0], rank[0].biostasis?'biostasis':'unsettled');
    }
  }
  function finish(col,reason){ g.over=true; g.winner=col?col.faction:null; g.winnerCol=col||null; g.reason=reason; }

  // ---- turn flow (simultaneous; co-occupation ⇒ order-independent, inherently fair) ----
  function beginTurn(){
    for(const c of g.colonies) c.growthLeft=maxSeeds(c);
  }
  function endTurn(){
    if(g.over) return {};
    // AI colonies plan (the player/policy for "you" has already acted this cycle)
    for(const c of g.colonies){ if(c.isYou && opts.playerControlled) continue;
      (opts.policyFor?opts.policyFor(c):POLICIES.tender)(api,c); }
    ecology(); dispersal(); grazers();
    updateMeters();
    g.turn++;
    checkEnd();
    if(!g.over) beginTurn();
    return {};
  }

  const api={ state:g, RES, RES_KEYS, TRAITS, FACTIONS, upCost, T,
    idx, inBounds:inB, neighbors, presence, totalBio, reachable, edible,
    dietEff, maxSeeds, seedCost, seed, upgrade, endTurn, beginTurn,
    health, volatility, poolHealth, meterOf:c=>c.meter, dominance, sustainableBio,
    who:c=>FACTIONS[c.faction].name };

  genMap();
  return api;
}

// ============================================================
//  POLICIES — how an AI colony plays a cycle (also the sim's "builds").
//  A policy chooses how AGGRESSIVELY to seed (overshoot risk) and what to evolve.
// ============================================================
function plan(api, col, {build, aggro, valueRes, homeostatic}){
  // evolve: earliest not-maxed priority trait we can afford (keep a seed reserve)
  for(const key of build){ if(col.genome[key]>=5) continue;
    if(col.energy - api.upCost(col.genome[key]) < 6) continue;
    if(api.upgrade(col,key)) break; }
  // how many tiles to seed this cycle. A HOMEOSTATIC player brakes: when its pools
  // are stressed it stops adding load (lets them recover), and once its web is a
  // sustainable size it only grows a trickle. Knowing when to STOP is the skill.
  let cap=Math.max(0,Math.round(col.growthLeft*aggro));
  if(homeostatic){ const ph=api.poolHealth(col), bio=api.totalBio(col);
    // a bigger web is only sustainable if you invested in traits that hold it up
    const target=14 + col.genome.symbiosis*4 + col.genome.restraint*3 + col.genome.diet*1.5;
    if(ph<0.5) cap=0;                    // pools stressed → stop, let them recover
    else if(bio>=target) cap=0;          // reached YOUR sustainable size → stabilise
  }
  const opts=api.reachable(col)
    .map(t=>({t,c:api.seedCost(col,t),v:valueRes(t,col,api)}))
    .sort((a,b)=>(b.v/b.c)-(a.v/a.c));
  let used=0;
  for(const o of opts){ if(used>=cap) break; if(col.energy<o.c) continue;
    if(api.seed(col,o.t)){ used++; } }
}
const nicheVal=(t,col,api)=> (t.pool[col.niche]||0) + t.pool.soil*0.3;
const richVal =(t,col,api)=> api.RES_KEYS.reduce((s,r)=>s+(api.dietEff(col,r)>0?t.pool[r]:0),0);

const POLICIES = {
  // tender = plays for homeostasis: slow, niche-focused, invests in stability/symbiosis
  tender:  (api,col)=>plan(api,col,{build:['diet','symbiosis','restraint','mycelium','toxicity'],
                                    aggro:0.5, valueRes:nicheVal, homeostatic:true}),
  // boomer = naive greedy expansion → overshoot → boom-bust (the skill-gradient baseline)
  boomer:  (api,col)=>plan(api,col,{build:['mycelium','diet','gills','spores'],
                                    aggro:1.0, valueRes:richVal, homeostatic:false}),
  // specialist = deep niche + symbiosis, minimal spread
  specialist:(api,col)=>plan(api,col,{build:['diet','symbiosis','restraint','toxicity'],
                                    aggro:0.35, valueRes:nicheVal, homeostatic:true}),
  // generalist = broad diet, moderate spread, mild brake
  generalist:(api,col)=>plan(api,col,{build:['diet','mycelium','restraint','gills','symbiosis'],
                                    aggro:0.7, valueRes:richVal, homeostatic:true}),
  // trickster = dispersal/mimicry web-builder, no brake (rides foragers, risks overshoot)
  trickster:(api,col)=>plan(api,col,{build:['edibility','mimicry','spores','symbiosis','diet'],
                                    aggro:0.8, valueRes:richVal, homeostatic:false}),
};

return { createGame, POLICIES, FACTIONS, TRAITS, RES, upCost, mulberry32 };
});
