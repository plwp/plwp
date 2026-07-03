/* ============================================================
   MYCELIA — domination engine (v3). Turn-based area control you can
   SEE on the board. Each turn you EXPAND, FRUIT, or UPGRADE, spending
   energy earned from the tiles you control. Win by controlling the
   majority of the forest floor.

   Single source of truth for the UI (index.html) and the balance
   simulator (sim.js). Instance-based + seedable RNG.
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Mycelia = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

// ---- substrates: income per turn + how hard to grow into. Barren = ungrowable. ----
const SUB = {
  soil:   {name:'Soil',   color:'#3f5233', income:1, cost:2, tough:0},
  litter: {name:'Litter', color:'#4a3f2a', income:2, cost:2, tough:1},
  dung:   {name:'Dung',   color:'#7a6a3a', income:3, cost:3, tough:1},
  wood:   {name:'Wood',   color:'#6b4a2a', income:4, cost:4, tough:2},
  barren: {name:'Barren', color:'#20241c', income:0, cost:99,tough:9},
};

// ---- traits (0..5), each clearly tied to a verb ----
const TRAITS = [
  {key:'mycelium', label:'Mycelium', desc:'Expand for less energy', verb:'expand'},
  {key:'diet',     label:'Diet',     desc:'More income from every tile', verb:'income'},
  {key:'toxicity', label:'Toxicity', desc:'Your tiles are harder to encroach', verb:'defend'},
  {key:'mimicry',  label:'Mimicry',  desc:'Encroach on rivals for less', verb:'expand'},
  {key:'symbiosis',label:'Symbiosis',desc:'Bonus income on your niche substrate', verb:'income'},
  {key:'gills',    label:'Gills',    desc:'Fruit flings more spores', verb:'fruit'},
  {key:'spores',   label:'Spores',   desc:'Fruit reaches farther, lands better', verb:'fruit'},
];
const upCost = lvl => 4 + lvl*4;

// ---- factions: niche substrate + a signature edge ----
const FACTIONS = {
  boletus:{ name:'Boletus', tag:'The Feast', color:'#e8c34a', niche:'wood',
    effect:'Expands cheaply on wood — a fast, sprawling decomposer.', sig:'cheap-wood' },
  psilocybe:{ name:'Psilocybe', tag:'The Prophet', color:'#c47cff', niche:'dung',
    effect:'Fruits farthest — leaps across the map to open new fronts.', sig:'far-fruit' },
  amanita:{ name:'Amanita', tag:'The Deceiver', color:'#e0524d', niche:'litter',
    effect:'Holds ground hardest — its tiles resist encroachment.', sig:'tough-hold' },
};
const FKEYS = Object.keys(FACTIONS);

function mulberry32(a){ return function(){
  a|=0; a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t;
  return ((t^t>>>14)>>>0)/4294967296;
};}

// ============================================================
//  GAME INSTANCE
// ============================================================
function createGame(opts={}){
  const COLS=opts.cols||15, ROWS=opts.rows||11;
  const rng=opts.rng||Math.random;
  const logfn=opts.log||(()=>{});
  const facs=opts.factions||FKEYS.slice();
  const playerFaction=opts.playerFaction||facs[0];

  const g={ COLS, ROWS, rng, turn:1, over:false, winner:null, winnerCol:null, reason:null,
            season:opts.season||40, grid:[], colonies:[], mercy:0 };
  const idx=(x,y)=>y*COLS+x;
  const inB=(x,y)=>x>=0&&y>=0&&x<COLS&&y<ROWS;

  const ACTIONS_PER_TURN = opts.actions||3;   // board-game rhythm: 3 actions each turn
  function mkColony(i,key){
    return { i, faction:key, niche:FACTIONS[key].niche, isYou:key===playerFaction,
      genome:{mycelium:0,diet:0,toxicity:0,mimicry:0,symbiosis:0,gills:1,spores:1},
      energy:9, actions:ACTIONS_PER_TURN };
  }
  function genMap(){
    g.grid=[];
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
      const n=(Math.sin(x*0.6)+Math.cos(y*0.85)+Math.sin((x+y)*0.5))*1.25+2.2;
      const kinds=['soil','litter','dung','wood','soil','litter'];
      let sub=kinds[Math.max(0,Math.min(kinds.length-1,Math.round(n)))];
      if(rng()<0.08) sub='barren';
      g.grid.push({x,y,sub,owner:null,str:0});
    }
    g.colonies=facs.map((k,i)=>mkColony(i,k));
    const spots={wood:[1,ROWS-2],dung:[COLS-2,1],litter:[1,1],soil:[COLS-2,ROWS-2]};
    g.colonies.forEach(c=>{ let [sx,sy]=spots[c.niche]||[1,1];
      const t=g.grid[idx(sx,sy)]; if(t.sub==='barren'){t.sub='soil';} t.owner=c; t.str=3; });
    beginTurn();
  }

  // ---- geometry / territory ----
  const owned=col=>g.grid.filter(t=>t.owner===col);
  const tilesOf=col=>owned(col).length;
  const viable=()=>g.grid.filter(t=>t.sub!=='barren').length;
  function share(col){ return owned(col).length/(viable()||1); }
  function neighbors(t){ const out=[];
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) if(inB(t.x+dx,t.y+dy)) out.push(g.grid[idx(t.x+dx,t.y+dy)]);
    return out; }
  function frontier(col){ const set=new Set();
    for(const t of owned(col)) for(const n of neighbors(t)) if(n.owner!==col && n.sub!=='barren') set.add(n);
    return [...set]; }

  // ---- costs ----
  function expandCost(col,t){
    let c=SUB[t.sub].cost - col.genome.mycelium;
    if(col.faction && FACTIONS[col.faction].sig==='cheap-wood' && t.sub==='wood') c-=2; // Boletus edge
    if(t.owner && t.owner!==col){                 // encroaching on a rival costs their defence
      c += 1 + t.owner.genome.toxicity - col.genome.mimicry;   // (str is siege HP, not cost)
      if(FACTIONS[t.owner.faction].sig==='tough-hold') c+=1;   // Amanita edge
    }
    return Math.max(1, Math.round(c));
  }
  function income(col){ let sum=0;
    for(const t of owned(col)){ let v=SUB[t.sub].income + col.genome.diet*0.5;
      if(col.genome.symbiosis>0 && t.sub===col.niche) v+=col.genome.symbiosis*0.6;
      sum+=v; }
    return sum;
  }
  function fruitReach(col){ return 3 + col.genome.spores*2 + (FACTIONS[col.faction].sig==='far-fruit'?4:0); }
  function fruitCost(col){ return 4; }

  // ---- the three verbs — each spends 1 ACTION + energy (return true on success) ----
  function expand(col,t){
    if(col.actions<=0 || t.owner===col || t.sub==='barren') return false;
    if(!frontier(col).includes(t)) return false;
    // a tile that just changed hands is locked for the rest of the turn — no ping-pong
    if(t.owner && t.owner!==col && t.takenTurn===g.turn) return false;
    const c=expandCost(col,t); if(col.energy<c) return false;
    col.energy-=c; col.actions--;
    if(t.owner && t.owner!==col){                 // SIEGE: wear the tile's strength down over turns
      t.str-=1;
      if(t.str<=0){ flip(col,t); }
      else { logfn(`${who(col)} besieged ${who(t.owner)}'s tile — ${t.str} to break`); }
    } else { flip(col,t); }
    return true;
  }
  // claimed tiles get real strength so they can't be snatched straight back
  function flip(col,t){ const prev=t.owner; t.owner=col;
    t.str=(prev?3:2)+Math.floor(col.genome.toxicity/2); t.takenTurn=g.turn;
    if(prev) logfn(`${who(col)} broke through and took a tile from ${who(prev)}`); }
  function fruit(col){
    if(col.actions<=0) return false;
    const c=fruitCost(col); if(col.energy<c) return false;
    col.energy-=c; col.actions--;
    const anchors=owned(col); if(!anchors.length) return false;
    const reach=fruitReach(col), shots=col.genome.gills+col.genome.spores;
    let landed=0;
    for(let s=0;s<shots;s++){ const a=anchors[Math.floor(rng()*anchors.length)];
      const nx=Math.max(0,Math.min(COLS-1,a.x+Math.round((rng()*2-1)*reach)));
      const ny=Math.max(0,Math.min(ROWS-1,a.y+Math.round((rng()*2-1)*reach)));
      const t=g.grid[idx(nx,ny)];
      if(!t.owner && t.sub!=='barren' && rng()<0.45+col.genome.spores*0.08){ t.owner=col; t.str=1; landed++; }
    }
    logfn(`${who(col)} fruited — mushrooms drew foragers; ${landed} new colonies took hold far off`);
    return true;
  }
  function upgrade(col,key){ if(col.actions<=0) return false;
    const lvl=col.genome[key]; if(lvl>=5) return false;
    const c=upCost(lvl); if(col.energy<c) return false;
    col.energy-=c; col.actions--; col.genome[key]++; return true; }

  const who=c=>FACTIONS[c.faction].name;

  // ---- turn flow ----
  function beginTurn(){ for(const c of g.colonies){ c.energy+=Math.round(income(c)); c.actions=ACTIONS_PER_TURN; } }
  function endTurn(){
    if(g.over) return;
    // AI colonies take their turn
    for(const c of g.colonies){ if(c.isYou && opts.playerControlled) continue;
      (opts.policyFor?opts.policyFor(c):POLICIES.balanced)(api,c); }
    g.turn++;
    checkWin();
    if(!g.over) beginTurn();
  }

  function checkWin(){
    const v=viable(); const alive=g.colonies.filter(c=>tilesOf(c)>0);
    if(alive.length===1 && g.colonies.length>1) return finish(alive[0],'domination');
    // majority control wins
    for(const c of g.colonies) if(tilesOf(c)>v*0.5) return finish(c,'majority');
    // mercy: a big, sustained lead ends it (no slog)
    const rank=g.colonies.slice().sort((a,b)=>tilesOf(b)-tilesOf(a));
    const lead=(tilesOf(rank[0])-tilesOf(rank[1]))/v;
    if(lead>0.30){ g.mercy++; if(g.mercy>=3) return finish(rank[0],'decisive'); } else g.mercy=0;
    if(g.turn>g.season) return finish(rank[0],'season');
  }
  function finish(col,reason){ g.over=true; g.winnerCol=col; g.winner=col?col.faction:null; g.reason=reason; }

  const api={ state:g, SUB, TRAITS, FACTIONS, upCost, idx, inBounds:inB, neighbors,
    owned, tilesOf, viable, share, frontier, expandCost, income, fruitReach, fruitCost,
    expand, fruit, upgrade, endTurn, beginTurn, who:c=>FACTIONS[c.faction].name,
    actionsPerTurn:ACTIONS_PER_TURN,
    canFruit:col=>col.actions>0 && col.energy>=fruitCost(col) };
  genMap();
  return api;
}

// ============================================================
//  POLICIES — how an AI faction plays a turn (also the sim's strategies)
// ============================================================
function play(api, col, {expandBias, fruitBias, build}){
  const s=api.state;
  // upgrade first if flush
  for(const key of build){ if(col.genome[key]>=5) continue;
    if(col.energy > api.upCost(col.genome[key]) + 6){ if(api.upgrade(col,key)) break; } }
  // fruit to open fronts when affordable and inclined
  if(api.canFruit(col) && s.rng() < fruitBias) api.fruit(col);
  // expand along cheapest valuable frontier while energy lasts
  let guard=0;
  while(guard++<40){
    const opts=api.frontier(col).map(t=>{ const enemy=t.owner&&t.owner!==col;
        let v=api.SUB[t.sub].income + (t.sub===col.niche?1:0);
        v += enemy ? -2 : 2;                     // strongly prefer open ground; siege only if boxed in
        return {t,c:api.expandCost(col,t),v}; })
      .filter(o=>col.energy>=o.c && o.v>0).sort((a,b)=>(b.v/b.c)-(a.v/a.c));
    if(!opts.length) break;
    if(s.rng()>expandBias && col.energy<10) break;   // sometimes bank energy
    if(!api.expand(col,opts[0].t)) break;
  }
}
const POLICIES = {
  balanced: (api,col)=>play(api,col,{expandBias:0.9,fruitBias:0.4,build:['diet','mycelium','toxicity','spores','gills']}),
  blitz:    (api,col)=>play(api,col,{expandBias:1.0,fruitBias:0.2,build:['mycelium','diet','mimicry','gills']}),
  spreader: (api,col)=>play(api,col,{expandBias:0.7,fruitBias:0.9,build:['spores','gills','diet','mycelium']}),
  turtle:   (api,col)=>play(api,col,{expandBias:0.6,fruitBias:0.3,build:['toxicity','diet','symbiosis','mycelium']}),
};

return { createGame, POLICIES, FACTIONS, TRAITS, SUB, upCost, mulberry32 };
});
