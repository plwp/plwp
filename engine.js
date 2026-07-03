/* ============================================================
   MYCELIA — living-forest engine (v4). A hex forest floor. Your
   mycelium BLOOMS outward on its own; you grow FRUITING BODIES that
   attract roaming FORAGERS, who physically carry your spores across
   the map and seed new blooms. No tile-clicking growth, no turns —
   it's alive and ticking; you fruit and upgrade, and steer.

   Single source of truth for the UI (index.html) and sim (sim.js).
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Mycelia = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const SUB = {
  soil:   {name:'Soil',   color:'#3f5233', vigor:1.0},
  litter: {name:'Litter', color:'#4a3f2a', vigor:1.2},
  dung:   {name:'Dung',   color:'#7a6a3a', vigor:1.6},
  wood:   {name:'Wood',   color:'#6b4a2a', vigor:1.4},
  barren: {name:'Barren', color:'#20241c', vigor:0},
};
const TRAITS = [
  {key:'mycelium', label:'Mycelium', desc:'Blooms faster and denser'},
  {key:'fruiting', label:'Fruiting', desc:'Fruiting bodies are riper — foragers visit more'},
  {key:'spores',   label:'Spores',   desc:'Foragers carry your spores much farther'},
];
const upCost = lvl => 10 + lvl*8;
const FRUIT_COST = 10;

const FACTIONS = {
  boletus:{ name:'Boletus', tag:'The Feast', color:'#e8c34a', niche:'wood',
    bonus:{key:'taste', label:'Taste', desc:'Foragers flock to your fruit — most dispersal of all'},
    effect:'Choice edible. Foragers can’t resist it.' },
  psilocybe:{ name:'Psilocybe', tag:'The Prophet', color:'#c47cff', niche:'dung',
    bonus:{key:'psychotropic', label:'Psychotropics', desc:'Tripping foragers wander far before dropping your spores'},
    effect:'Psychedelic. Its spores end up everywhere.' },
  amanita:{ name:'Amanita', tag:'The Deceiver', color:'#e0524d', niche:'litter',
    bonus:{key:'lethality', label:'Lethality', desc:'Toxic — resists being overgrown; poisons greedy foragers'},
    effect:'Deadly. Holds its ground; kills careless foragers.' },
};
const FKEYS = Object.keys(FACTIONS);
const bonusKey=f=>FACTIONS[f].bonus.key;

function mulberry32(a){ return function(){
  a|=0; a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t;
  return ((t^t>>>14)>>>0)/4294967296;
};}

// odd-r offset hex neighbours
const HEX=[
  [[1,0],[0,-1],[-1,-1],[-1,0],[-1,1],[0,1]],   // even rows
  [[1,0],[1,-1],[0,-1],[-1,0],[0,1],[1,1]],     // odd rows
];

function createGame(opts={}){
  const COLS=opts.cols||30, ROWS=opts.rows||22;
  const rng=opts.rng||Math.random;
  const logfn=opts.log||(()=>{});
  const facs=opts.factions||FKEYS.slice();
  const playerFaction=opts.playerFaction||facs[0];
  const SPORE_CAP=40, N_FORAGERS=Math.round(COLS*ROWS/44);

  const g={ COLS, ROWS, rng, tick:0, over:false, winner:null, winnerCol:null, reason:null,
            grid:[], colonies:[], foragers:[] };
  const idx=(x,y)=>y*COLS+x;
  const inB=(x,y)=>x>=0&&y>=0&&x<COLS&&y<ROWS;
  const gv=(c,k)=>c.genome[k]||0;

  function mkColony(i,key){ const genome={mycelium:0,fruiting:0,spores:0}; genome[bonusKey(key)]=0;
    return { i, faction:key, niche:FACTIONS[key].niche, isYou:key===playerFaction, genome, spore:FRUIT_COST, buf:0 }; }

  function offToCube(x,y){ const q=x-((y-(y&1))>>1); return [q,-q-y,y]; }
  function hexDist(a,b){ const A=offToCube(a.x,a.y),B=offToCube(b.x,b.y);
    return (Math.abs(A[0]-B[0])+Math.abs(A[1]-B[1])+Math.abs(A[2]-B[2]))/2; }
  function neighbors(t){ const o=[]; for(const [dx,dy] of HEX[t.y&1]) if(inB(t.x+dx,t.y+dy)) o.push(g.grid[idx(t.x+dx,t.y+dy)]); return o; }

  function genMap(){
    g.grid=[];
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
      const n=(Math.sin(x*0.45)+Math.cos(y*0.55)+Math.sin((x+y)*0.35))*1.2+2.2;
      const kinds=['soil','litter','dung','wood','soil','litter'];
      let sub=kinds[Math.max(0,Math.min(kinds.length-1,Math.round(n)))];
      if(rng()<0.06) sub='barren';
      g.grid.push({x,y,sub,owner:null,lvl:0,tt:-9,fruit:null});
    }
    g.colonies=facs.map((k,i)=>mkColony(i,k));
    const spots={wood:[4,ROWS-4],dung:[COLS-5,4],litter:[4,4],soil:[COLS-5,ROWS-4]};
    g.colonies.forEach(c=>{ const [sx,sy]=spots[c.niche]||[4,4]; const t=g.grid[idx(sx,sy)];
      if(t.sub==='barren')t.sub='soil'; t.owner=c; t.lvl=3; });
    for(let i=0;i<N_FORAGERS;i++) g.foragers.push({ x:Math.floor(rng()*COLS), y:Math.floor(rng()*ROWS), load:null, carry:0 });
  }

  const owned=c=>g.grid.filter(t=>t.owner===c);
  const tilesOf=c=>owned(c).length;
  const viable=()=>g.grid.filter(t=>t.sub!=='barren').length;
  const share=c=>tilesOf(c)/(viable()||1);
  const open=()=>g.grid.filter(t=>!t.owner && t.sub!=='barren').length;
  const MAXLVL=c=>3+gv(c,'mycelium');

  // ---- bloom: organic local spread ----
  function bloom(col){
    const mine=owned(col); if(!mine.length) return;
    col.buf += 1.2 + gv(col,'mycelium')*0.8 + gv(col,'taste')*0.4;
    let budget=Math.floor(col.buf); col.buf-=budget;
    for(const t of mine){ const mx=MAXLVL(col); if(t.lvl<mx && rng()<0.10) t.lvl++; }
    let guard=0;
    while(budget>0 && guard++<600){
      const src=mine[Math.floor(rng()*mine.length)];
      const ns=neighbors(src).filter(n=>n.sub!=='barren' && n.owner!==col);
      if(!ns.length){ budget--; continue; }
      const openN=ns.filter(n=>!n.owner);
      const t=openN.length ? openN[Math.floor(rng()*openN.length)] : ns[Math.floor(rng()*ns.length)];
      if(!t.owner){ t.owner=col; t.lvl=1; t.tt=g.tick; }
      else if(t.tt!==g.tick){ const resist=t.lvl+gv(t.owner,'lethality'), force=src.lvl+gv(col,'mycelium');
        if(force>resist && rng()<0.55){ t.lvl--; if(t.lvl<=0){ t.owner=col; t.lvl=1; t.tt=g.tick; } } }
      budget--;
    }
  }

  // ---- foragers: visible agents that carry spores between fruiting bodies and open ground ----
  function ripeFruits(){ return g.grid.filter(t=>t.fruit && t.fruit.ripe>0); }
  function moveForager(f){
    const here=g.grid[idx(f.x,f.y)];
    if(f.load){                                   // carrying spores → wander, then drop
      f.carry--;
      const step=neighbors(here); const t=step[Math.floor(rng()*step.length)]||here;
      f.x=t.x; f.y=t.y;
      const cur=g.grid[idx(f.x,f.y)];
      if(f.carry<=0){                             // deposit a new bloom of the carried faction
        if(!cur.owner && cur.sub!=='barren'){ cur.owner=f.load; cur.lvl=1; cur.tt=g.tick;
          if(f.load.isYou) logfn('🐿️ A forager dropped your spores far off — a new bloom!'); }
        f.load=null;
      }
      return;
    }
    // unladen: drift toward the most attractive nearby fruit (Taste pulls harder)
    const fr=ripeFruits(); let target=null,best=1e9;
    for(const t of fr){ const d=hexDist(here,t) - gv(t.fruit.owner,'taste')*0.8;
      if(d<best && hexDist(here,t)<8){ best=d; target=t; } }
    let nx=here;
    if(target){ const step=neighbors(here).concat(here);
      nx=step.reduce((a,b)=> hexDist(b,target)<hexDist(a,target)?b:a, here); }
    else { const step=neighbors(here); nx=step[Math.floor(rng()*step.length)]||here; }
    f.x=nx.x; f.y=nx.y;
    const cur=g.grid[idx(f.x,f.y)];
    if(cur.fruit && cur.fruit.ripe>0){            // pick up spores from the fruiting body
      const own=cur.fruit.owner;
      if(gv(own,'lethality')>0 && rng()<0.25+gv(own,'lethality')*0.12){  // toxic fruit poisons it
        respawnForager(f); return; }
      f.load=own; f.carry=3 + gv(own,'spores')*2 + gv(own,'psychotropic')*3;
      cur.fruit.ripe--; if(cur.fruit.ripe<=0) cur.fruit=null;
    }
  }
  function respawnForager(f){ f.load=null; f.carry=0; f.x=Math.floor(rng()*COLS); f.y=Math.floor(rng()*ROWS); }

  function accrue(col){ col.spore=Math.min(SPORE_CAP, col.spore + 1 + tilesOf(col)*0.12); }

  // ---- actions ----
  function fruit(col,t){                          // grow a fruiting body on one of your tiles
    if(!t||t.owner!==col||t.fruit||col.spore<FRUIT_COST) return false;
    col.spore-=FRUIT_COST; t.fruit={owner:col, ripe:2+gv(col,'fruiting')};
    if(col.isYou) logfn('🍄 A fruiting body erupts — foragers will come');
    return true;
  }
  function upgrade(col,key){ const lvl=col.genome[key]||0; if(lvl>=5) return false;
    const c=upCost(lvl); if(col.spore<c) return false; col.spore-=c; col.genome[key]=lvl+1; return true; }

  function aiAct(col){
    const build=['mycelium', bonusKey(col.faction), 'fruiting', 'spores'];
    for(const k of build){ if((col.genome[k]||0)>=5) continue; if(col.spore>upCost(col.genome[k]||0)+FRUIT_COST){ if(upgrade(col,k))break; } }
    if(col.spore>=FRUIT_COST && rng()<0.4){       // fruit on an edge tile beside open ground
      const edge=owned(col).filter(t=>!t.fruit && neighbors(t).some(n=>!n.owner&&n.sub!=='barren'));
      if(edge.length) fruit(col, edge[Math.floor(rng()*edge.length)]);
    }
  }

  // ---- the tick ----
  function tick(){
    if(g.over) return; g.tick++;
    for(const c of g.colonies) bloom(c);
    for(const f of g.foragers) moveForager(f);
    for(const c of g.colonies){ accrue(c); if(!(c.isYou&&opts.playerControlled)) aiAct(c); }
    checkWin();
  }
  function checkWin(){
    const v=viable(), alive=g.colonies.filter(c=>tilesOf(c)>0);
    if(alive.length<=1 && g.colonies.length>1) return finish(alive[0],'domination');
    for(const c of g.colonies) if(tilesOf(c)>v*0.5) return finish(c,'majority');
    if(open()===0){ const r=g.colonies.slice().sort((a,b)=>tilesOf(b)-tilesOf(a)); return finish(r[0],'full'); }
  }
  function finish(col,reason){ g.over=true; g.winnerCol=col||null; g.winner=col?col.faction:null; g.reason=reason; }

  const api={ state:g, SUB, TRAITS, FACTIONS, upCost, FRUIT_COST, idx, inBounds:inB, neighbors, hexDist,
    owned, tilesOf, viable, share, open, tick, fruit, upgrade,
    who:c=>FACTIONS[c.faction].name, traitsFor:c=>TRAITS.concat([Object.assign({faction:true},FACTIONS[c.faction].bonus)]),
    canFruit:c=>c.spore>=FRUIT_COST, sporeCap:SPORE_CAP };
  genMap();
  return api;
}

function autoplay(api,maxTicks=800){ const s=api.state; let n=0; while(!s.over&&n++<maxTicks) api.tick(); return {ticks:s.tick,winner:s.winner,reason:s.reason}; }

return { createGame, FACTIONS, TRAITS, SUB, upCost, mulberry32, autoplay };
});
