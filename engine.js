/* ============================================================
   MYCELIA — mushroom RTS engine (v6). A base-builder in the vein of
   Warcraft / C&C / Total Annihilation / SimCity, as a fungal colony:
   decompose substrate for NUTRIENTS, spend them to expand hyphae and
   build structures (fruiting bodies, toxin glands, symbionts), tech up
   your genome, and out-grow a rival colony for the forest floor.
   Real-time economy tick; no unit micro.

   Single source of truth for the UI (index.html) and sim (sim.js).
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Mycelia = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

// substrates: a mostly-poor floor with SPARSE rich nodes you fight to control.
const SUB = {
  soil:    {name:'Soil',        color:'#37472e', rich:1},
  litter:  {name:'Leaf litter', color:'#4a3f2a', rich:2},
  dung:    {name:'Dung pile',   color:'#8a7a44', rich:3},
  log:     {name:'Old log',     color:'#6b4a2a', rich:4},
  carrion: {name:'Carcass',     color:'#6e3a48', rich:6},
  barren:  {name:'Bare rock',   color:'#20241c', rich:0},
};
// buildable structures — you only ever place these (mycelium spreads on its own)
const BUILD = {
  fruit:    {name:'Fruiting', cost:16, desc:'Bursts spores — rapidly colonises the area around it'},
  toxin:    {name:'Toxin',    cost:14, desc:'Poisons adjacent rival ground — pushes the front'},
  symbiont: {name:'Symbiont', cost:14, desc:'+income to surrounding tiles (mycorrhiza)'},
};
const TECH = {
  diet:     {name:'Diet',      desc:'+income from every tile'},
  mycelium: {name:'Mycelium',  desc:'Mycelium spreads faster, tiles hold denser'},
  virulence:{name:'Virulence', desc:'Toxins hit harder'},
  fecundity:{name:'Fecundity', desc:'Fruiting bodies emit spores faster'},
};
const techCost = lvl => 20 + lvl*18;

const FACTIONS = {
  boletus:{ name:'Boletus', color:'#e8c34a' },
  amanita:{ name:'Amanita', color:'#e0524d' },
};

function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; };}

// odd-r offset hex neighbours (big hex board — the stage that felt closest to a game)
const HEX=[[[1,0],[0,-1],[-1,-1],[-1,0],[-1,1],[0,1]],[[1,0],[1,-1],[0,-1],[-1,0],[0,1],[1,1]]];
function createGame(opts={}){
  const COLS=opts.cols||28, ROWS=opts.rows||20;
  const rng=opts.rng||Math.random;
  const logfn=opts.log||(()=>{});
  const g={ COLS, ROWS, rng, tick:0, over:false, winner:null, reason:null, grid:[], colonies:[] };
  const idx=(x,y)=>y*COLS+x;
  const inB=(x,y)=>x>=0&&y>=0&&x<COLS&&y<ROWS;
  const gv=(c,k)=>c.tech[k]||0;

  function mkColony(i,key,you){ return { i, faction:key, isYou:you, nutrients:40,
    tech:{diet:0,mycelium:0,virulence:0,fecundity:0} }; }

  function genMap(){
    g.grid=[];
    // base floor: mostly poor soil, some leaf-litter patches, a little bare rock
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
      const n=(Math.sin(x*0.5)+Math.cos(y*0.7)+Math.sin((x+y)*0.4));
      let sub = n>0.9 ? 'litter' : 'soil';
      if(rng()<0.05) sub='barren';
      g.grid.push({x,y,sub,owner:null,struct:null,hp:0});
    }
    // scatter SPARSE rich nodes — the resource hotspots to fight over
    const area=COLS*ROWS;
    const scatter=(type,count,cluster)=>{ for(let i=0;i<count;i++){
      const c=g.grid[Math.floor(rng()*g.grid.length)]; if(c.sub==='barren') continue; c.sub=type;
      if(cluster) for(const nb of neighbors(c)) if(rng()<0.5 && nb.sub!=='barren') nb.sub=type; } };
    scatter('dung', Math.round(area/38), true);    // dung piles (small clusters)
    scatter('log',  Math.round(area/48), true);    // fallen logs
    scatter('carrion', Math.round(area/150), false); // rare carcasses
    g.colonies=[ mkColony(0,'boletus',true), mkColony(1,'amanita',false) ];
    const s0=g.grid[idx(2,ROWS>>1)], s1=g.grid[idx(COLS-3,ROWS>>1)];
    if(s0.sub==='barren')s0.sub='soil'; if(s1.sub==='barren')s1.sub='soil';
    claim(g.colonies[0],s0,3); claim(g.colonies[1],s1,3);
  }
  function claim(col,t,hp){ if(t.sub==='barren') return false; t.owner=col; t.hp=hp||2; return true; }

  const owned=c=>g.grid.filter(t=>t.owner===c);
  const tilesOf=c=>owned(c).length;
  const viable=()=>g.grid.filter(t=>t.sub!=='barren').length;
  const share=c=>tilesOf(c)/(viable()||1);
  function neighbors(t){ const o=[]; for(const [dx,dy] of HEX[t.y&1]) if(inB(t.x+dx,t.y+dy)) o.push(g.grid[idx(t.x+dx,t.y+dy)]); return o; }
  const frontier=c=>{ const s=new Set(); for(const t of owned(c)) for(const n of neighbors(t)) if(!n.owner&&n.sub!=='barren') s.add(n); return [...s]; };

  // ---- economy ----
  function tileIncome(col,t){ let v=SUB[t.sub].rich*(1+gv(col,'diet')*0.25);
    if(neighbors(t).some(n=>n.owner===col&&n.struct==='symbiont')) v+=2; return v; }
  function income(col){ return owned(col).reduce((s,t)=>s+tileIncome(col,t),0); }

  // ---- costs / build ----
  function cost(col,type){ let c=BUILD[type].cost; if(type==='hyphae') c=Math.max(1,c-gv(col,'mycelium')); return c; }
  function canPlace(col,type,t){
    if(!t||t.sub==='barren') return false;
    if(type==='hyphae') return !t.owner && neighbors(t).some(n=>n.owner===col);
    return t.owner===col && !t.struct;   // structures go on your own bare tiles
  }
  function build(col,type,t){ if(!canPlace(col,type,t)) return false; const c=cost(col,type);
    if(col.nutrients<c) return false; col.nutrients-=c;
    if(type==='hyphae'){ claim(col,t,2+gv(col,'mycelium')); }
    else { t.struct=type; }
    return true; }
  function evolve(col,key){ const lvl=gv(col,key); if(lvl>=5) return false; const c=techCost(lvl);
    if(col.nutrients<c) return false; col.nutrients-=c; col.tech[key]=lvl+1; return true; }

  // ---- world tick ----
  function fruitEmit(col){
    for(const t of owned(col)){ if(t.struct!=='fruit') continue;
      const period=Math.max(2,6-gv(col,'fecundity'));
      if(g.tick % period !== (t.x+t.y)%period) continue;      // stagger emissions
      const open=[]; for(const n of neighbors(t)) if(!n.owner&&n.sub!=='barren') open.push(n);
      // reach 2 for spores
      for(const n of neighbors(t)) for(const m of neighbors(n)) if(!m.owner&&m.sub!=='barren') open.push(m);
      if(open.length && rng()<0.8) claim(col, open[Math.floor(rng()*open.length)], 1);
    }
  }
  function toxinPush(col){
    for(const t of owned(col)){ if(t.struct!=='toxin') continue;
      for(const n of neighbors(t)){ if(n.owner && n.owner!==col){
        n.hp -= 1 + gv(col,'virulence')*0.5;
        if(n.hp<=0){ const prev=n.owner; n.owner=null; n.struct=null; n.hp=0;
          if(col.isYou||prev.isYou) logfn(`${FACTIONS[col.faction].name} toxin cleared ${FACTIONS[prev.faction].name}'s ground`); } } }
    }
  }
  const NCAP=260;   // bank cap — spend your economy, don't hoard it
  function tickEconomy(){ for(const c of g.colonies) c.nutrients=Math.min(NCAP, c.nutrients+income(c)*0.1); }

  // mycelium spreads on its OWN, economy-gated — no tile micro. Prefers rich ground.
  function autoExpand(col){
    col._buf=(col._buf||0) + 0.4 + gv(col,'mycelium')*0.18;
    while(col._buf>=1){ col._buf-=1; const f=frontier(col); if(!f.length) break;
      const cst=Math.max(1, 2-gv(col,'mycelium')*0.2); if(col.nutrients<cst) break;
      const t=f.sort((a,b)=>SUB[b.sub].rich-SUB[a.sub].rich)[0]; col.nutrients-=cst; claim(col,t,2+gv(col,'mycelium')); }
  }
  function tick(){
    if(g.over) return; g.tick++;
    tickEconomy();
    for(const c of g.colonies) autoExpand(c);
    for(const c of g.colonies) fruitEmit(c);
    for(const c of g.colonies) toxinPush(c);
    if(g.tick%4===0) aiAct(g.colonies[1]);          // rival makes a move now and then — not a blur
    checkWin();
  }
  function aiAct(col){
    if(col.isYou && opts.playerControlled) return;
    if(col.nutrients>techCost(gv(col,'diet'))+24 && rng()<0.5){ evolve(col, ['diet','mycelium','fecundity','virulence'][Math.floor(rng()*4)]); return; }
    const foe=g.colonies[col.i^1];
    const contact=owned(col).filter(t=>!t.struct && neighbors(t).some(n=>n.owner===foe));
    if(contact.length && col.nutrients>=cost(col,'toxin') && rng()<0.5) return void build(col,'toxin',contact[0]);
    const rich=owned(col).filter(t=>!t.struct && SUB[t.sub].rich>=3);
    if(rich.length && col.nutrients>=cost(col,'fruit') && rng()<0.5) return void build(col,'fruit',rich[Math.floor(rng()*rich.length)]);
    const any=owned(col).filter(t=>!t.struct);
    if(any.length && col.nutrients>=cost(col,'symbiont') && rng()<0.25) build(col,'symbiont',any[Math.floor(rng()*any.length)]);
  }

  function checkWin(){
    const v=viable(); const alive=g.colonies.filter(c=>tilesOf(c)>0);
    if(alive.length===1) return finish(alive[0],'domination');
    for(const c of g.colonies) if(tilesOf(c)>v*0.6) return finish(c,'majority');
  }
  function finish(col,reason){ g.over=true; g.winner=col?col.faction:null; g.winnerCol=col; g.reason=reason; }

  const api={ state:g, SUB, BUILD, TECH, FACTIONS, techCost, idx, inBounds:inB, neighbors,
    owned, tilesOf, viable, share, frontier, income, tileIncome, cost, canPlace, build, evolve, tick,
    nutrientCap:NCAP, you:()=>g.colonies[0], foe:()=>g.colonies[1], who:c=>FACTIONS[c.faction].name };
  genMap();
  return api;
}
function autoplay(api,maxT=1500){ const s=api.state; let n=0; while(!s.over&&n++<maxT) api.tick(); return {ticks:s.tick,winner:s.winner,reason:s.reason}; }
return { createGame, FACTIONS, SUB, BUILD, TECH, mulberry32, autoplay };
});
