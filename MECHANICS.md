# Mycelia — Mechanics Design

A turn-based area-of-control strategy game where you play a fungal colony
min-maxing its biology — mycelium, diet, toxicity, psychotropics, symbiosis,
gills, spores, fruiting — to dominate a patch of forest floor.

> **Status:** lofi mechanics prototype. We are proving the *systems* first.
> Procedural beauty and the final engine (Godot/Unity/etc.) come later — none
> of the decisions here are married to JavaScript. `engine.js` is the canonical
> ruleset; `index.html` is a throwaway test skin; `sim.js` is the balance lab.

---

## 1. The core fantasy

You are not a general — you are an organism. You don't command units, you
*evolve* and *spread*. Winning isn't only conquest: mushrooms have ways to
propagate that a tank column doesn't — they get **eaten**, **mistaken for
something else**, and **partnered with**. That's the design's whole reason to
exist. Area-of-control on its own is a wargame; the non-conquest vectors are
what make it a *mushroom* game.

## 2. Three routes to victory

Every faction and build is really choosing a mix of three ways to take ground:

| Route | Fantasy | Key traits | Vector |
|---|---|---|---|
| **Conquest** | Creep over everything | Mycelium, Diet | Your own hyphae |
| **Deception** | Trick foragers into carrying you | Mimicry, Edibility, Psychotropics | Animals & humans |
| **Symbiosis** | Partner instead of fight | Symbiosis | Host trees |

These are deliberately in tension. **Toxicity and Edibility oppose each
other** (poison keeps foragers away; being tasty invites them). **Mimicry is
the cheat that bridges them** — look edible while staying toxic, and you get
dispersal *without* being eaten. That triangle is the heart of the min-max.

## 3. Factions — defined by their *effect on people*

The three major real-world types map cleanly onto the three routes. Each is
defined by what it does to the humans/animals that encounter it:

- **Amanita — "The Deceiver."** Beautiful, iconic, toxic-yet-psychoactive.
  Effect: delirium & poison. People pick it anyway because it's striking →
  **deception** route. Bias: Toxicity, Mimicry.
- **Psilocybe — "The Prophet."** Psychedelic. Effect: humans *deliberately
  cultivate and protect* it and plant it far and wide → the strongest
  human-dispersal vector. Bias: Psychotropics, Spores.
- **Boletus — "The Feast."** Choice edible. Effect: eaten and carried
  everywhere → huge reach, but you lose fruiting bodies → **edibility** route.
  Bias: Edibility, Diet, Gills.

## 4. The genome (ten traits, 0–5)

Grouped by route. Upgrading spends biomass; cost rises per level (`8 + 7·lvl`).

- **Conquest** — *Mycelium* (cheaper spread + more growth/cycle), *Diet*
  (nutrient extraction; unlocks tough substrates like wood).
- **Defense ⇄ Edibility** — *Toxicity* (repels grazers, but foragers avoid
  you), *Edibility* (foragers spread you far, but you're grazed harder).
- **Deception** — *Mimicry* (get picked while toxic; cheaper to overtake a
  rival by blending in), *Psychotropics* (manipulated grazers become
  long-range spore carriers).
- **Symbiosis** — *Symbiosis* (bond with wood/host tiles: passive food,
  ungrazable).
- **Reproduction** — *Gills* (spores per fruiting), *Spores* (germination
  range & success), *Fruit cycle* (fruit sooner).

## 5. Dispersal vectors — the spectrum of "who moves you"

Mushrooms spread three ways, and the game models a spectrum from *pure damage*
to *pure help*:

1. **Insects & slugs (grazers)** — just eat you, no dispersal. Damage tiles.
   Countered by **Toxicity**; worsened by **Edibility**; nullified by
   **Symbiosis** (host protection).
2. **Animals — non-human foragers** (squirrels, deer, boar) — eat you *and*
   carry you a medium distance. The middle of the spectrum: you lose the fruit
   body but gain reach. Driven by **Edibility**.
3. **Humans** — the long-range vector, and the most interesting because it's
   *manipulable*:
   - Edible → picked, eaten, carried far (Boletus).
   - Mimic/iconic → picked *despite* being toxic; you keep the tile (Amanita).
   - Psychoactive → *cultivated*: deliberately propagated and protected, the
     best dispersal of all, and you're never "eaten" (Psilocybe).

This is the axis that keeps the game from being Risk-with-spores.

## 6. Economy & the two budgets (RTS feel, no macro)

Two resources gate everything, and they're deliberately *both* scarce so no
single stat runs away:

- **Biomass** — the spendable pool. Earned by metabolising owned tiles (Diet ×
  substrate nutrient, minus depletion). Spent on spreading and evolving.
- **Growth budget** — how many new tiles the mycelium can claim *per cycle*
  (`2 + 1.3·Mycelium`), regardless of how rich you are. This is the key
  anti-macro lever: you can't dump a war chest into a turn-one land grab, so
  turns stay deliberate and Mycelium is meaningful.
- **Territory upkeep** — every held tile costs biomass each turn (`0.28/tile`).
  Sprawl you can't feed starves. Forces "quality vs quantity."

## 7. Turn model — simultaneous WeGo ("seems real-time, is turn-based")

**No first mover.** Both colonies plan *blind* to each other during the same
planning phase, then all orders resolve **simultaneously**:

1. `beginTurn` refills both growth budgets (plus any rubber-band catch-up).
2. Planning — the player queues spread claims and evolves traits. Claims are
   *provisional* (they show as intent and spend budget, but don't finalise).
3. `endTurn` — the AI plans blind, then **`resolveOrders`** settles every
   claim together. Two colonies claiming the same tile → resolved by a fair
   *push* (Mycelium + local mass + a little randomness), not by who clicked
   first. Then the world (metabolism, grazers, foragers, fruiting) resolves for
   both in a randomised order.
4. The UI plays this back as a ~0.7s animated **bloom** — it *looks* real-time
   (creeping, growing), but there's zero APM pressure.

Why it matters: the simulator proved a plain "you-resolve-first" model gave the
first seat a real edge. Simultaneous resolution is both the *fairness* fix and
the *"feels alive"* feature — the same mechanic.

## 8. Emotional arc — engineering the comeback (the Rocket League problem)

Goal: matches should **feel close, allow real comebacks, never let you see the
ending coming — and once decided, end quickly and mercifully.** We treat this as
measurable, not vibes (see `sim.js`).

**Two-phase momentum** (the core of the arc):
- **Contested phase** (margin < ~18% of held tiles) — the *trailer* gets a
  +1 growth/cycle catch-up. This is the comeback window: a fair leg-up (the
  leader still leads) that gives a *real, skill-driven chance* to turn it
  around. The leader must actively **defend** the lead — hold tiles with
  Toxicity/Symbiosis, counter-contest with Mimicry — to keep it.
- **Decided phase** (margin ≥ ~28%) — the momentum *flips to the leader*
  (+2–3 growth), so a genuinely-won game closes out fast instead of the loser
  slogging through a lost position. It's fair because the trailer had the whole
  contested window, with help, to convert — and failed.
- **Mercy win** — a decisive margin (>42%) that *holds for 3 turns* ends the
  match outright. It must persist, so it reflects real control, not a spike.

Plus organic pressures: **depletion + upkeep** mean a land-rush lead decays if
it isn't consolidated (another built-in comeback lever).

**Latest simulated numbers** (150 games/matchup): ~14 turns ≈ 13 min; blowout
rate **19%** (down from 41% pre-mercy); loser-slog **4.0** turns; **37%** of
turns neck-and-neck; comeback rate **20%**. The live tension: a punchier,
merciful game leaves *less* runway for comebacks — **the width of the contested
window is the master dial** we tune between "dramatic" and "decisive."

**Metrics tracked:** lead-changes/game, % neck-and-neck, comeback rate (winner
was down 3+ tiles), blowout rate, loser-slog turns, season-timeouts.

## 9. The adversarial AI — challenging but fair

The opponent (`POLICIES.adaptive`) **cheats nothing** — identical economy,
growth budget, and actions the player has. It's "hard" purely by *reading the
board*: it counters a toxic turtle with mimicry, races an over-expander,
consolidates when ahead, and pressures the leader's frontier when behind.
Difficulty tiers are just *policies*, not resource bonuses:
Easy = greedy, Normal = generalist, Hard = adaptive.

Simulated over both seats vs every archetype it averages **~64%** — it beats
weak builds decisively but *loses* to a well-played deceiver (~37%). That's the
target: tough, learnable, beatable.

## 10. Mechanics mined from the RTS/4X canon

What we borrowed, and how it's reshaped for an organism with no unit micro:

- **Dune II** — the *spice economy on contested ground*. Ours: rich substrates
  (wood/dung) are the "spice" — high payoff but tough to digest (need Diet) and
  worth fighting over. Harvest-vs-hold tension without harvesters.
- **Warcraft** — *factions with distinct identities* and *upkeep*. Ours: the
  three mushroom types play genuinely differently (deception vs cultivation vs
  feast), and territory upkeep echoes WC3's upkeep tax on over-expansion.
- **Civilization** — *tile improvement, borders, and terrain*. Ours: substrate
  type and nutrient depletion make *where* you grow matter; symbiosis is a
  "tile improvement" that upgrades a wood tile into a passive engine.
- **Total Annihilation** — *flow economy & streaming production* (energy/metal
  as rates, not stockpiles). Ours: biomass is a flow (metabolise → spend), and
  the growth budget is a per-cycle *rate* cap — you optimise throughput, not a
  bank. TA's "reclaim the battlefield" ≈ our depletion/dispersal recycling.
- **Space 4X (Master of Orion / Sins of a Solar Empire / Spore)** — *tech trees
  as identity* and *colonisation by seeding distant worlds*. Ours: the genome
  **is** the tech tree, and spore dispersal / human cultivation is literally
  "colonise a distant tile you can't reach by land" — the 4X expansion phase,
  compressed.
- **Modern touchstones** — auto-battler "set-up then watch" (TFT) and Rocket
  League's comeback engineering directly shape §7–8: plan quietly, watch it
  resolve, and never let a match feel decided too early.

## 11. Open balance questions (what the sim is telling us)

Current findings from `node sim.js` (see output for live numbers):

- ❌ **Edibility/Boletus is underpowered** (~16% build win rate). The
  eaten-and-lose-a-tile cost outweighs the reach. *Fix ideas:* dispersal from
  being eaten should be much larger, or eaten tiles should leave a spore
  deposit instead of vanishing.
- ❌ **Psychotropics/psychonaut is weak** (~35%). The manipulated-grazer payoff
  is too situational. *Fix ideas:* make psychotropics also convert adjacent
  enemy grazing pressure, or guarantee a dispersal on deterral.
- ⚠️ **Raw expansion (rusher/generalist) is still strongest.** Conquest slightly
  over-rewarded vs the exotic routes — we want all three routes viable.
- ⚠️ **Blowouts ~39%, lead-changes ~0.6/game.** Comeback tension is present but
  thin; the rubber-band is currently gentle and can be strengthened.

## 12. Roadmap

1. **Now:** lock the mechanics in `engine.js`; use `sim.js` to balance the
   three routes until each is viable and blowouts drop.
2. **Next:** richer board (biomes, seasons/weather affecting fruiting, more
   substrates), more factions, biomass *sinks* (defensive structures, big
   fruitings) so biomass stops pooling.
3. **Later:** port `engine.js` to the real engine; invest in **procedurally
   generated beauty** — organic mycelium growth, fruiting animations,
   generated forest floors — now that the systems are proven.
