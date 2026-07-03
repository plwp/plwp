/* ============================================================
   MYCELIA — canonical game engine (no DOM).
   Single source of truth for both the playable UI (index.html)
   and the headless meta simulator (sim.js).
   Instance-based: createGame() returns an isolated match, so the
   simulator can run thousands concurrently with seeded RNG.
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Mycelia = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

// ---- Substrates: nutrient richness + how tough they are to digest (needs Diet) ----
const SUB = {
  soil:   {name:'Soil',   color:'#3f5233', nutrient:3, tough:0},
  litter: {name:'Litter', color:'#4a3f2a', nutrient:4, tough:1},
  dung:   {name:'Dung',   color:'#7a6a3a', nutrient:6, tough:1},
  wood:   {name:'Wood',   color:'#6b4a2a', nutrient:8, tough:3},
  barren: {name:'Barren', color:'#222222', nutrient:0, tough:0},
};

// ---- Genome: ten traits (0..5), grouped by the strategic route they serve ----
const TRAITS = [
  {key:'mycelium',    label:'Mycelium',    desc:'Cheaper spread + more growth per cycle', tag:'war'},
  {key:'diet',        label:'Diet',        desc:'Extract more nutrient; digest tough wood', tag:'war'},
  {key:'toxicity',    label:'Toxicity',    desc:'Defends tiles; but foragers avoid you', tag:'def'},
  {key:'edibility',   label:'Edibility',   desc:'Foragers eat & spread you far — grazed harder', tag:'def'},
  {key:'mimicry',     label:'Mimicry',     desc:'Lookalike: picked while toxic; cheaper to overtake', tag:'trick'},
  {key:'psychotropic',label:'Psychotropics',desc:'Manipulated grazers become spore carriers', tag:'trick'},
  {key:'symbiosis',   label:'Symbiosis',   desc:'Bond with wood hosts: passive food, ungrazable', tag:'sym'},
  {key:'gills',       label:'Gills',       desc:'More spores per fruiting', tag:'repro'},
  {key:'spores',      label:'Spores',      desc:'Spore germination range & success', tag:'repro'},
  {key:'fruitcycle',  label:'Fruit cycle', desc:'Fruit sooner (shorter interval)', tag:'repro'},
];
const upCost = lvl => 8 + lvl*7;

// ---- Factions: the three major types, defined by their EFFECT ON PEOPLE ----
const FACTIONS = {
  amanita:{ name:'Amanita', tag:'The Deceiver', color:'#e0524d',
    effect:'Delirium & poison — beautiful and iconic, so admirers still pick you.',
    bias:{toxicity:2,mimicry:2,gills:1}, sig:'deceiver' },
  psilocybe:{ name:'Psilocybe', tag:'The Prophet', color:'#c47cff',
    effect:'Psychedelic — humans cultivate and protect you, planting you far and wide.',
    bias:{psychotropic:2,spores:2,mycelium:1}, sig:'cultivated' },
  boletus:{ name:'Boletus', tag:'The Feast', color:'#e8c34a',
    effect:'Choice edible — foragers eat and carry you everywhere, but you lose fruit bodies.',
    bias:{edibility:2,diet:2,gills:1}, sig:'choice' },
};

// ---- seedable RNG (mulberry32) so the simulator is reproducible ----
function mulberry32(a){ return function(){
  a|=0; a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t;
  return ((t^t>>>14)>>>0)/4294967296;
};}

// ============================================================
//  GAME INSTANCE
// ============================================================
function createGame(opts={}){
  const COLS=opts.cols||16, ROWS=opts.rows||12;
  const rng = opts.rng || Math.random;
  const logfn = opts.log || (()=>{});
  const factions = opts.factions || {you:'boletus', rival:'amanita'};

  const g = { COLS, ROWS, rng, turn:1, over:false, winner:null, grid:[], you:null, rival:null, orders:[] };
  const idx=(x,y)=>y*COLS+x;
  const inB=(x,y)=>x>=0&&y>=0&&x<COLS&&y<ROWS;

  function mkColony(isYou, key){
    const c={ isYou, faction:key, biomass:12, fruitTimer:0, growthLeft:0,
      genome:{mycelium:1,diet:1,toxicity:0,edibility:0,mimicry:0,psychotropic:0,
              symbiosis:0,gills:1,spores:1,fruitcycle:0} };
    const bias=FACTIONS[key].bias; for(const k in bias) c.genome[k]+=bias[k];
    return c;
  }
  function seed(col,x,y){ const c=g.grid[idx(x,y)];
    if(c.sub==='barren'){c.sub='soil';c.nutrient=SUB.soil.nutrient;}
    c.owner=col; c.mass=3; }

  function genMap(){
    g.grid=[];
    const types=['soil','soil','litter','dung','wood','barren'];
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
      const n=(Math.sin(x*0.7)+Math.cos(y*0.9)+Math.sin((x+y)*0.5))*1.3+3;
      let t=types[Math.max(0,Math.min(types.length-1,Math.round(n)))];
      if(rng()<0.10) t='barren';
      g.grid.push({x,y,sub:t,owner:null,mass:0,nutrient:SUB[t].nutrient,symbiotic:false});
    }
    g.you=mkColony(true,factions.you); g.rival=mkColony(false,factions.rival);
    seed(g.you,1,ROWS-2); seed(g.rival,COLS-2,1);
    beginTurn();
  }

  // ---- geometry ----
  const ownedTiles=col=>g.grid.filter(t=>t.owner===col);
  // during planning a colony may chain-grow off tiles it has provisionally CLAIMED this turn
  const heldBy=col=>g.grid.filter(t=>t.owner===col||t.claim===col);
  function neighbors(t,range){ const out=[];
    for(let dy=-range;dy<=range;dy++)for(let dx=-range;dx<=range;dx++){
      if(!dx&&!dy)continue; if(Math.abs(dx)+Math.abs(dy)>range)continue;
      if(inB(t.x+dx,t.y+dy)) out.push(g.grid[idx(t.x+dx,t.y+dy)]); }
    return out; }
  function frontier(col){
    const range=1+Math.floor(col.genome.mycelium/3), set=new Set();
    for(const t of heldBy(col)) for(const n of neighbors(t,range))
      if(n.owner!==col && n.claim!==col) set.add(n);
    return [...set];
  }
  function spreadCost(col,t){
    const base=2+SUB[t.sub].tough;
    const contested=t.owner&&t.owner!==col ? Math.max(0,4-col.genome.mimicry) : 0;
    return Math.max(1, Math.round(base+contested-col.genome.mycelium*0.4));
  }
  const canDigest=(col,t)=>col.genome.diet>=SUB[t.sub].tough-1;
  function maxGrowth(col){return 2+Math.floor(col.genome.mycelium*1.3)}

  // ---- actions (identical for human and AI) ----
  // trySpread now QUEUES a provisional claim; ownership is decided simultaneously at
  // resolve time, so neither side sees the other's moves — no first-mover advantage.
  function trySpread(col,t){
    if(t.owner===col||t.claim===col) return false;
    if(col.growthLeft<=0||!canDigest(col,t)) return false;
    const cost=spreadCost(col,t); if(col.biomass<cost) return false;
    col.biomass-=cost; col.growthLeft--;
    t.claim=col; g.orders.push({t,col,cost}); return true;   // provisional — resolved later
  }
  // push strength when two colonies claim the same tile in the same cycle
  const pushForce=(col,t)=> col.genome.mycelium + t.mass*0.5 + g.rng()*1.5
                          + (t.owner===col?2:0);
  function resolveOrders(){
    const byTile=new Map();
    for(const o of g.orders){ const k=idx(o.t.x,o.t.y);
      if(!byTile.has(k)) byTile.set(k,[]); byTile.get(k).push(o); }
    for(const [,claims] of byTile){
      const t=claims[0].t;
      let win=claims[0].col;
      if(claims.length>1){                       // contested: strongest push takes it (rest wasted)
        win=claims.reduce((a,b)=> pushForce(b.col,t)>pushForce(a.col,t)?b:a).col;
        logfn(`${who(win)} won a contested tile`);
      } else if(t.owner&&t.owner!==win){
        logfn(`${who(win)} overtook ${who(t.owner)}'s tile`);
      }
      t.owner=win; t.mass=Math.max(t.mass,2);
    }
    for(const t of g.grid) t.claim=null;
    g.orders=[];
  }
  function upgrade(col,key){
    const lvl=col.genome[key]; if(lvl>=5) return false;
    const c=upCost(lvl); if(col.biomass<c) return false;
    col.biomass-=c; col.genome[key]++; return true;
  }
  const who=c=>FACTIONS[c.faction].name;
  const sigOf=c=>FACTIONS[c.faction].sig;

  // ---- world resolution ----
  function symbiose(col){ if(col.genome.symbiosis<1) return;
    for(const t of ownedTiles(col)) if(t.sub==='wood'&&!t.symbiotic){ t.symbiotic=true;
      if(col.isYou) logfn('🌳 Mycorrhizal bond formed — passive food, ungrazable'); } }

  function metabolize(col){
    let gain=0;
    for(const t of ownedTiles(col)){
      if(t.symbiotic){ gain+=2+col.genome.symbiosis*0.8; t.mass=Math.min(5,t.mass+0.4); continue; }
      const ex=t.nutrient>0?Math.min(t.nutrient,1+col.genome.diet*0.6):0;
      t.nutrient=Math.max(0,+(t.nutrient-ex*0.15).toFixed(2));
      gain+=ex*(t.nutrient>0?1:0.2); t.mass=Math.min(5,t.mass+0.3);
    }
    const chem=(col.genome.toxicity+col.genome.psychotropic)*0.5;
    const territory=ownedTiles(col).length*0.28;
    col.biomass=Math.max(0,+(col.biomass+gain-chem-territory).toFixed(1));
  }

  function grazers(col){
    const tiles=ownedTiles(col); if(tiles.length<3) return;
    const attacks=1+Math.floor(tiles.length/10);
    for(let i=0;i<attacks;i++){
      const t=tiles[Math.floor(rng()*tiles.length)];
      if(!t||t.owner!==col||t.symbiotic) continue;
      const defend=Math.max(0,col.genome.toxicity*0.22-col.genome.edibility*0.15);
      if(rng()<defend){
        if(col.genome.psychotropic>0&&rng()<col.genome.psychotropic*0.25){ disperse(col,1,true);
          if(col.isYou) logfn('🦋 A tripping grazer flew off carrying your spores'); }
        else if(col.isYou) logfn('☠️ Toxins repelled a grazer');
      } else { t.mass-=2; if(t.mass<=0){ t.owner=null; t.mass=0;
        if(col.isYou) logfn('🐛 Grazers cleared one of your tiles'); } }
    }
  }

  // Foragers = the animal/human dispersal vector (edibility + deception).
  function foragers(col){
    const gm=col.genome, s=sigOf(col);
    const disguise=gm.mimicry+(s==='deceiver'?1:0);
    const draw=s==='cultivated'?gm.psychotropic:0;
    const appeal=gm.edibility+disguise+draw;
    if(appeal<=0) return;
    if(gm.toxicity>0&&disguise<gm.toxicity&&s!=='cultivated') return; // obvious poison, avoided
    if(rng()>0.22+appeal*0.12) return;
    const tiles=ownedTiles(col).filter(t=>!t.symbiotic); if(!tiles.length) return;
    const t=tiles[Math.floor(rng()*tiles.length)];
    const carried=2+Math.round(gm.spores*0.8)+(s==='choice'?1:0);
    disperse(col,carried,true);
    const kept=s==='cultivated'||(gm.toxicity>0&&disguise>=gm.toxicity);
    if(kept){ if(col.isYou) logfn(`${s==='cultivated'?'🧑‍🌾 Cultivated':'🎭 Lookalike taken'} — ${carried} spores planted far`); }
    else { t.owner=null; t.mass=0; if(col.isYou) logfn(`🧺 Eaten & carried — ${carried} spores flung, 1 tile lost`); }
  }

  function fruiting(col){
    col.fruitTimer++;
    const interval=Math.max(2,6-col.genome.fruitcycle);
    if(col.fruitTimer<interval) return;
    col.fruitTimer=0;
    const spores=col.genome.gills+col.genome.spores; if(spores<=0) return;
    disperse(col,Math.max(1,Math.round(spores/2)));
    if(col.isYou) logfn(`🍄 Fruited — flung ${Math.max(1,Math.round(spores/2))} spores`);
  }

  function disperse(col,n,fromGrazer=false){
    const anchors=ownedTiles(col); if(!anchors.length) return;
    const range=3+col.genome.spores*2+(fromGrazer?6:0);
    for(let i=0;i<n;i++){
      const a=anchors[Math.floor(rng()*anchors.length)];
      const nx=a.x+Math.round((rng()*2-1)*range), ny=a.y+Math.round((rng()*2-1)*range);
      if(!inB(nx,ny)) continue;
      const t=g.grid[idx(nx,ny)];
      if(t.owner||t.sub==='barren'||!canDigest(col,t)) continue;
      if(rng()<0.35+col.genome.spores*0.1){ t.owner=col; t.mass=2; }
    }
  }

  // ---- win / lose ----
  const viable=()=>g.grid.filter(t=>t.sub!=='barren').length;
  function checkWin(){
    const y=ownedTiles(g.you).length, r=ownedTiles(g.rival).length, v=viable();
    if(y===0)      return finish('rival','collapse');
    if(r===0)      return finish('you','dominance');
    if(y>v*0.5)    return finish('you','bloom');
    if(r>v*0.5)    return finish('rival','overgrown');
    // MERCY: a sustained, decisive lead ends the game — don't make the loser slog
    // through a decided match. Needs to HOLD for a few turns, so it's earned, not a spike.
    const margin=(y-r)/((y+r)||1);
    if(Math.abs(margin)>0.42){ g.mercy=(g.mercy||0)+1;
      if(g.mercy>=3) return finish(margin>0?'you':'rival','decisive'); }
    else g.mercy=0;
    if(g.turn>60)  return finish(y>r?'you':(r>y?'rival':'draw'),'season');
  }
  function finish(winner,reason){ g.over=true; g.winner=winner; g.reason=reason; }

  // ---- turn flow (simultaneous WeGo — no first mover) ----
  // beginTurn refills both growth budgets and clears the order book; the player (UI or
  // sim policy) queues claims during planning; endTurn lets the rival plan BLIND, then
  // resolves everyone's orders together and runs the world for both sides interleaved.
  function beginTurn(){
    for(const t of g.grid) t.claim=null;
    g.orders=[];
    // TWO-PHASE MOMENTUM. While the game is close, the TRAILER gets a catch-up
    // boost (comebacks, no runaway — you can't see the ending coming). Once a
    // decisive margin is crossed, the LEADER snowballs instead, for a quick and
    // merciful finish — no slogging through a lost game. Fair because the trailer
    // had every chance while it was contestable.
    const yT=ownedTiles(g.you).length, rT=ownedTiles(g.rival).length;
    const diff=yT-rT, ad=Math.abs(diff)/((yT+rT)||1);   // margin vs occupied territory
    let yB=0, rB=0;
    if(ad < 0.18){                         // CONTESTED — help the trailer (comeback window)
      const b = ad>0.08 ? 1 : 0;
      if(diff<0) yB=b; else if(diff>0) rB=b;
    } else if(ad >= 0.28){                 // DECIDED — leader snowballs to a quick, merciful end
      const b = ad>0.45 ? 3 : 2;
      if(diff>0) yB=b; else rB=b;
    }
    g.you.growthLeft  = maxGrowth(g.you)  + yB;
    g.rival.growthLeft= maxGrowth(g.rival)+ rB;
  }
  function endTurn(){
    if(g.over) return {changed:[]};
    const before=g.grid.map(t=>t.owner);
    (opts.rivalPolicy||POLICIES.greedy)(api, g.rival);   // rival plans, blind to player's claims
    resolveOrders();                                     // ← both sides' claims decided together
    // resolve the world for both, but RANDOMISE who goes first each turn so dispersal
    // races have no fixed winner (kills the last of the first-mover advantage).
    const pair = g.rng()<0.5 ? [g.you,g.rival] : [g.rival,g.you];
    for(const c of pair) symbiose(c);
    for(const c of pair) metabolize(c);
    for(const c of pair) grazers(c);
    for(const c of pair) foragers(c);
    for(const c of pair) fruiting(c);
    g.turn++;
    checkWin();
    const changed=[]; g.grid.forEach((t,i)=>{ if(t.owner!==before[i]) changed.push(i); });
    if(!g.over) beginTurn();
    return {changed};
  }

  // public surface used by UI, policies and sim
  const api={ state:g, SUB, TRAITS, FACTIONS, upCost,
    idx, inBounds:inB, ownedTiles, frontier, spreadCost, canDigest, maxGrowth,
    trySpread, upgrade, endTurn, who, viable,
    tilesOf:col=>ownedTiles(col).length };

  genMap();
  return api;
}

// ============================================================
//  STRATEGY POLICIES (the "builds" the simulator pits together)
//  A policy spends one planning phase for a colony: upgrades + spreads.
// ============================================================
function plan(api, col, build, valueTile){
  // (growth budget is set by the engine's beginTurn, incl. any rubber-band catch-up)
  // invest: raise the earliest not-maxed trait we can afford, keeping a spread reserve
  const upgraded=new Set();
  for(let n=0;n<3;n++){
    for(const key of build){
      if(upgraded.has(key)) continue;
      if(col.genome[key]>=5) continue;
      if(col.biomass - api.upCost(col.genome[key]) < 6) continue;
      if(api.upgrade(col,key)){ upgraded.add(key); break; }
    }
  }
  // expand: best value-per-cost frontier tiles until growth or biomass runs out
  const opts=api.frontier(col).filter(t=>api.canDigest(col,t))
    .map(t=>({t,c:api.spreadCost(col,t),v:valueTile(t,col,api)}))
    .sort((a,b)=>(b.v/b.c)-(a.v/a.c));
  for(const o of opts){ if(col.growthLeft<=0) break; if(col.biomass<o.c) continue; api.trySpread(col,o.t); }
}
const nutrientVal = (t,col,api)=> api.SUB[t.sub].nutrient - (t.owner?-2:0);
const woodLoveVal = (t,col,api)=> (t.sub==='wood'?12:api.SUB[t.sub].nutrient);
const overtakeVal = (t,col,api)=> api.SUB[t.sub].nutrient + (t.owner&&t.owner!==col?6:0);

// ADAPTIVE — the "challenging but fair" opponent. It CHEATS NOTHING (same economy,
// same growth budget, same actions the player has); it just reads the board and the
// player's genome each turn and counters. That's what makes it fair.
function adaptive(api, col){
  const foe = col===api.state.you ? api.state.rival : api.state.you;
  const myT = api.tilesOf(col), foeT = api.tilesOf(foe);
  const fg = foe.genome;
  let build;
  if(fg.toxicity>=2 && fg.mimicry===0){         // foe is a toxic turtle → slip past with mimicry
    build=['mimicry','diet','mycelium','spores','gills'];
  } else if(fg.mycelium>=3 || foeT>myT+4){       // foe is out-expanding → race + hold with toxins
    build=['diet','mycelium','toxicity','fruitcycle','gills'];
  } else if(myT>foeT+4){                          // we're ahead → consolidate & cash in via spores
    build=['diet','symbiosis','gills','spores','fruitcycle'];
  } else {                                        // even → efficient generalist
    build=['diet','mycelium','gills','toxicity','spores','fruitcycle'];
  }
  // when behind, bias tile value toward contesting the leader's frontier (pressure, not turtling)
  const val = foeT>myT+3 ? overtakeVal : nutrientVal;
  plan(api, col, build, val);
}

const POLICIES = {
  adaptive,
  // greedy = the default in-game rival: expand cheaply, shore up basics
  greedy:  (api,col)=>plan(api,col,['diet','mycelium','toxicity','fruitcycle','spores','symbiosis'], nutrientVal),
  rusher:  (api,col)=>plan(api,col,['mycelium','diet','fruitcycle','gills'], nutrientVal),
  turtle:  (api,col)=>plan(api,col,['toxicity','diet','mycelium','symbiosis'], nutrientVal),
  deceiver:(api,col)=>plan(api,col,['mimicry','edibility','spores','gills','mycelium'], overtakeVal),
  symbiont:(api,col)=>plan(api,col,['diet','symbiosis','mycelium','gills'], woodLoveVal),
  psychonaut:(api,col)=>plan(api,col,['psychotropic','spores','gills','fruitcycle','mycelium'], nutrientVal),
  glutton: (api,col)=>plan(api,col,['edibility','diet','gills','spores','fruitcycle'], nutrientVal),
  generalist:(api,col)=>plan(api,col,['diet','mycelium','gills','toxicity','spores','fruitcycle'], nutrientVal),
};

return { createGame, POLICIES, FACTIONS, TRAITS, SUB, upCost, mulberry32 };
});
