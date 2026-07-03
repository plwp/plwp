/* ============================================================
   MYCELIA — tactical duel engine (v5). A small hex board, two rival
   fungi, alternating turns, near-full information. Neutral FORAGERS
   wander toward anything that looks edible; luring one to your fruit
   spreads your mycelium. Your verbs are mushroom tricks:
     • Edible — lure a forager; it harvests & spreads you (+ a point)
     • Toxic  — visible poison; kills foragers that enter (a wall)
     • Mimic  — looks edible to your foe, but it's a trap: kills the lured forager
   Grow slow & safe, or fruit to lure & gamble. Most ground wins.

   Single source of truth for the UI (index.html) and sim (sim.js).
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Mycelia = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const DIRS=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
const FACTIONS = {
  boletus:{ name:'Boletus', color:'#e8c34a', tag:'The Feast' },
  amanita:{ name:'Amanita', color:'#e0524d', tag:'The Deceiver' },
};
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; };}

function createGame(opts={}){
  const R=opts.radius||3;
  const rng=opts.rng||Math.random;
  const logfn=opts.log||(()=>{});
  const g={ R, rng, tiles:[], map:{}, players:[], foragers:[], turn:0, round:1,
            over:false, winner:null, reason:null, maxRounds:opts.maxRounds||22, log:logfn };
  const key=(q,r)=>q+','+r;
  const get=(q,r)=>g.map[key(q,r)];
  const dist=(a,b)=>(Math.abs(a.q-b.q)+Math.abs(a.r-b.r)+Math.abs(a.q+a.r-b.q-b.r))/2;
  function neighbors(t){ const o=[]; for(const [dq,dr] of DIRS){ const n=get(t.q+dq,t.r+dr); if(n)o.push(n);} return o; }

  function build(){
    for(let q=-R;q<=R;q++) for(let r=Math.max(-R,-q-R); r<=Math.min(R,-q+R); r++){
      const t={q,r,owner:null,mush:null}; g.tiles.push(t); g.map[key(q,r)]=t; }
    g.players=[ {i:0,faction:'boletus',isYou:true, score:0},
                {i:1,faction:'amanita',isYou:false,score:0} ];
    get(-R, R).owner=g.players[0]; get(R,-R).owner=g.players[1];   // opposite corners
    // three foragers, dropped on neutral ground away from the starts
    const spots=[get(0,-R),get(R,0),get(-R,0)].filter(Boolean);
    for(const s of spots) if(!s.owner) g.foragers.push({q:s.q,r:s.r,alive:true});
  }

  const tilesOf=p=>g.tiles.filter(t=>t.owner===p);
  const count=p=>tilesOf(p).length;
  const empty=t=>!t.owner && !t.mush;
  const attractive=m=> m && (m.type==='edible'||m.type==='mimic');   // what a forager smells as food

  // ---- actions (one per turn) ----
  function canGrow(p){ return growTargets(p).length>0; }
  function growTargets(p){ const set=new Set();
    for(const t of tilesOf(p)) for(const n of neighbors(t)) if(!n.owner && !n.mush) set.add(n);
    return [...set]; }
  function grow(p,t){ if(t.owner||t.mush) return false; if(!growTargets(p).includes(t)) return false;
    t.owner=p; logfn(`${who(p)} grew mycelium`); return true; }
  function fruit(p,t,type){ if(t.owner!==p||t.mush) return false;
    t.mush={owner:p,type}; logfn(`${who(p)} grew a ${type} mushroom`); return true; }
  const fruitTargets=p=>tilesOf(p).filter(t=>!t.mush);

  const who=p=>FACTIONS[p.faction].name;

  // ---- forager phase: move each, then resolve what they land on ----
  function stepForagers(){
    for(const f of g.foragers){ if(!f.alive) continue;
      const here=get(f.q,f.r);
      // find nearest attractive mushroom
      let target=null,bd=1e9;
      for(const t of g.tiles){ if(attractive(t.mush)){ const d=dist(here,t); if(d<bd){bd=d;target=t;} } }
      if(target && bd>0){ // step one hex closer, avoiding visible toxin if possible
        const opts=neighbors(here).filter(n=>!(n.mush&&n.mush.type==='toxic'));
        const pool=opts.length?opts:neighbors(here);
        const nx=pool.reduce((a,b)=> dist(b,target)<dist(a,target)?b:a, here);
        f.q=nx.q; f.r=nx.r;
      } else if(!target){ const ns=neighbors(here); const nx=ns[Math.floor(rng()*ns.length)]||here; f.q=nx.q; f.r=nx.r; }
      // resolve the tile it now stands on
      const cur=get(f.q,f.r);
      if(cur.mush){ const m=cur.mush;
        if(m.type==='toxic'){ f.alive=false; logfn(`☠️ A forager died on ${who(m.owner)}'s toxin`); }
        else if(m.type==='mimic'){ f.alive=false; cur.mush=null; logfn(`🎭 ${who(m.owner)}'s lookalike killed a forager!`); }
        else if(m.type==='edible'){ // harvest: owner scores and the spore spreads to an empty neighbour
          m.owner.score++; const openN=neighbors(cur).filter(empty);
          if(openN.length){ openN[Math.floor(rng()*openN.length)].owner=m.owner; }
          cur.mush=null; logfn(`🍄 A forager ate ${who(m.owner)}'s fruit — spores spread`);
          // move the sated forager off to a random neighbour
          const ns=neighbors(cur); const nx=ns[Math.floor(rng()*ns.length)]||cur; f.q=nx.q; f.r=nx.r;
        }
      }
    }
    g.foragers=g.foragers.filter(f=>f.alive);
  }

  // ---- simple tactical AI ----
  function aiTurn(p){
    const foe=g.players[0];
    // 1) if a live forager is 1-2 tiles from a tile I own, fruit EDIBLE there to harvest it
    const mine=fruitTargets(p);
    let best=null,bd=1e9;
    for(const t of mine) for(const f of g.foragers){ const d=dist(t,{q:f.q,r:f.r}); if(d<bd){bd=d;best=t;} }
    if(best && bd<=2 && g.rng()<0.8) return fruit(p,best,'edible');
    // 2) if a forager is heading for the foe's edible, drop a mimic near it to trap
    const foeBait=g.tiles.find(t=>t.mush&&t.mush.owner===foe&&attractive(t.mush));
    if(foeBait){ const near=mine.filter(t=>dist(t,foeBait)<=2).sort((a,b)=>dist(a,foeBait)-dist(b,foeBait))[0];
      if(near && g.rng()<0.5) return fruit(p,near,'mimic'); }
    // 3) otherwise grow toward the middle
    if(canGrow(p)){ const t=growTargets(p).sort((a,b)=>dist(a,{q:0,r:0})-dist(b,{q:0,r:0}))[0]; return grow(p,t); }
    if(mine.length) return fruit(p,mine[0],'edible');
    return false;
  }

  // ---- turn flow ----
  // player (turn 0) acts via the API; endTurn runs the AI then the forager phase.
  function endTurn(){
    if(g.over) return;
    aiTurn(g.players[1]);
    stepForagers();
    g.round++;
    checkWin();
  }
  function checkWin(){
    const a=count(g.players[0]), b=count(g.players[1]), total=g.tiles.length;
    if(a>total*0.5) return finish(g.players[0],'majority');
    if(b>total*0.5) return finish(g.players[1],'majority');
    if(g.foragers.length===0 || g.round>g.maxRounds){
      const w = a>b?g.players[0] : b>a?g.players[1] : null; return finish(w, w?'ground':'draw'); }
  }
  function finish(p,reason){ g.over=true; g.winner=p?p.faction:null; g.winnerP=p||null; g.reason=reason; }

  const api={ state:g, FACTIONS, neighbors, dist, get, tilesOf, count,
    growTargets, canGrow, grow, fruit, fruitTargets, endTurn, who,
    you:()=>g.players[0], foe:()=>g.players[1] };
  build();
  return api;
}

// headless sim helper: random-ish self-play for balance checks
function autoplay(api,maxR=40){ const s=api.state; let n=0;
  while(!s.over && n++<maxR){ const you=s.players[0];
    // greedy: fruit edible near nearest forager, else grow
    let acted=false, best=null,bd=1e9;
    for(const t of api.fruitTargets(you)) for(const f of s.foragers){ const d=api.dist(t,{q:f.q,r:f.r}); if(d<bd){bd=d;best=t;} }
    if(best&&bd<=2) acted=api.fruit(you,best,'edible');
    if(!acted && api.canGrow(you)) acted=api.grow(you, api.growTargets(you)[0]);
    if(!acted && api.fruitTargets(you)[0]) api.fruit(you,api.fruitTargets(you)[0],'edible');
    api.endTurn();
  }
  return {rounds:s.round, winner:s.winner, reason:s.reason}; }

return { createGame, FACTIONS, mulberry32, autoplay };
});
