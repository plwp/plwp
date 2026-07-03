# Mycelia — Mechanics Design (v2: Ecology of Dominance)

A turn-based **ecology** game. You are a fungal faction competing — never by
attacking — to grow the largest **self-sustaining web** of your fungus and its
allies on a shared forest floor. You win by building the healthiest, most
dominant equilibrium: **homeostasis is the means, dominance is the score.**

> This supersedes the v1 conquest model. No tile ownership, no overtaking, no
> combat. Fungi don't fight — they out-decompose, out-partner, and out-disperse.
> `engine.js` / `sim.js` / `index.html` are being rebuilt to this spec; the v1
> conquest code is superseded.

---

## 1. The core loop

The forest floor is **shared ground**. Every tile holds finite, slowly
regenerating **resource pools** (wood/lignin, dung, leaf litter, soil humus).
Any number of colonies can occupy the same tile — occupation is graded biomass,
not exclusive ownership. Each cycle you:

1. **Extract** — your biomass on a tile consumes the resources your Diet can
   digest, growing your local biomass.
2. **Direct growth** — spend energy to seed presence into new tiles, or evolve
   traits (the min-max).
3. **Disperse** — desirable/allied fungi get carried to distant tiles by
   foragers.
4. The world regenerates pools, grazers nibble, seasons turn — and everyone's
   **Dominance** is recomputed and shown.

There is no attack action. The only pressure on a rival is **ecological**:
competing for a resource you both eat, or out-growing them into a niche.

## 2. Niche partitioning — why peace is the default

The central idea, in your words: *a wood-eater and a shit-eater can share a
tile.* They eat different resource pools, so they don't compete — they coexist.
Competition only happens when two colonies want the **same** resource (or the
shared **soil** pool everyone can weakly use).

- **Diet** is now a *niche* stat. A **specialist** (high efficiency on one
  resource) dominates its niche but is fragile if that resource crashes. A
  **generalist** (broad Diet) eats many pools inefficiently — flexible, but
  competes with everyone and masters nothing.
- Coexistence is the resting state; scarcity is what creates conflict. This is
  what makes it *not* a wargame.

## 3. Factions = a keystone + its allied web

A faction is not just a mushroom — it's the center of a network of symbiotic
**people, animals, and plants**. Growing that web *is* the game.

| Faction | Niche | Effect on people | Allied web |
|---|---|---|---|
| **Amanita — Deceiver** | Litter / mycorrhizal | Delirium, iconic → admired & picked | Host trees (mycorrhiza), deceived foragers |
| **Psilocybe — Prophet** | **Dung** (coprophilic) | Psychedelic → humans cultivate & protect | Human cultivators, grazing animals |
| **Boletus — Feast** | **Wood** (saprobic) | Choice edible → foraged & carried far | Foragers, forest hosts |

Each faction naturally sits in a **different niche**, so three factions on one
board coexist by default — and the game becomes about who grows their web
biggest, not who kills whom.

## 4. Dispersal — desirability is pull, and it's steal-able

Spread happens by being *wanted*, not by pushing hyphae alone:

- **Edibility / Psychotropics → foraging → spread.** A choice edible or a
  psychoactive fungus makes foragers seek it out; being carried off plants you
  in distant tiles. Reach comes from being desirable.
- **Foragers are faction-affiliated.** Each faction has its own dispersers
  (its people/animals). They spread *their* faction.
- **Mimicry hijacks the enemy's forager.** *This is the signature mechanic.* A
  convincing lookalike gets picked up by a **rival faction's** forager and
  rides *their* dispersal network — you parasitize their people/animals to
  spread yourself, for free, into their territory. Deception as logistics.
- **Toxicity** is the counter-pressure: it keeps *your* dispersers away
  (bad for spread) but protects you from grazers. It also makes a mimic's life
  hard — a toxic lookalike that gets eaten poisons the disperser, training them
  off you. Toxicity ⇄ Edibility remains the core tension; Mimicry still bridges.

## 5. Symbiosis — building the web

Symbiosis is the engine of dominance, not a side stat:

- **Plants** — mycorrhizal bonds with host trees: a stable resource supply that
  doesn't deplete, buffering you against boom-bust (the strongest homeostasis
  tool).
- **Animals** — partnered grazers/insects that disperse you and don't eat you.
- **People** — cultivators (Psilocybe's edge) who plant and protect you.

Every ally you add both **feeds** your web (more sustainable production) and
**spreads** it (more dispersal). That compounding is what eventually makes a
faction dominant — and what the Dominance meter tracks.

## 6. Homeostasis, Dominance, and legibility

The tension to solve: an ecosystem has no scoreboard, but the game must make it
**clear who's winning**, allow comebacks, and end decisively. The resolution:

- **Dominance meter** (always on screen, per faction) = the share of the
  ecosystem's **sustainable** production your web captures. Your biomass + allied
  biomass, **discounted when you overshoot** (extracting faster than pools
  regenerate). A big-but-crashing web scores *less* than a smaller stable one.
- **Homeostasis is the means:** only a balanced web keeps compounding; an
  overshooting web depletes its pools, dies back, and its Dominance visibly
  falls. So "healthiest equilibrium wins" and "most dominant faction wins" are
  the *same number*.
- **Comeback window:** while niches are still contestable, a trailing faction
  can specialize into an unclaimed niche or hijack a rival's foragers to surge.
- **Decisive / merciful end:** once a web's allies feed its spread which grows
  more allies, it self-reinforces past a threshold and snowballs — Dominance
  runs away and the season is called. No slog: the meter makes the outcome
  legible before the map is fully saturated.

## 7. Turn model (unchanged from v1)

Simultaneous **WeGo**: everyone plans blind, then the world resolves together —
and here it's *automatically* fair, because shared-tile resource competition
splits proportionally regardless of order (co-occupation means there's nothing
to "grab first"). Plays back as an animated resolution: creeping mycelium,
foragers moving, webs lighting up. Feels real-time, zero APM.

## 8. What the simulator must now prove

The sim (`sim.js`) pivots from win-rates to **ecosystem health**:

- **Skill gradient** — do smarter niche/web choices reliably beat naive ones?
  (If not, there's no game.)
- **Coexistence vs. competition** — do differently-niched factions actually
  coexist, and same-niche ones actually clash?
- **Legibility** — does the Dominance meter predict the winner well before the
  end? (It should — that's "clear who's winning.")
- **Boom-bust rate** — how often do webs overshoot and crash? Some is dramatic;
  too much is random.
- **Decisiveness / pacing** — seasons resolve in a bounded, ≤30-min number of
  cycles without a slog.

## 9. Traits (reframed for the ecology)

- **Diet** — niche breadth & extraction efficiency (specialist ⇄ generalist).
- **Mycelium** — seeding reach & cost; how fast the network grows across tiles.
- **Toxicity** — grazer defense; repels your own dispersers.
- **Edibility** — desirability to foragers → dispersal (and grazing risk).
- **Mimicry** — hijack rival factions' foragers; pass as a prized species.
- **Psychotropics** — manipulate dispersers; cultivation appeal.
- **Symbiosis** — build the allied web (plants/animals/people); anti-crash.
- **Gills / Spores / Fruit cycle** — spore output, dispersal range/success,
  fruiting cadence.

## 10. Mechanics mined from the canon (still relevant)

- **Civ / SimCity / ecology sims** — carrying capacity, tile resources,
  boom-bust; the new north star.
- **Dune II** — resource richness on shared ground drives where you invest.
- **Total Annihilation** — flow economy: production as a *rate* (regen vs.
  extraction), not a stockpile.
- **Space 4X (MoO / Spore / Sins)** — tech-tree-as-identity (the genome) and
  seeding distant tiles (dispersal) as the expansion phase.
- **Rocket League** — the legibility + decisive-comeback discipline applied to
  the Dominance meter.

## 11. Roadmap

1. **Now:** rebuild `engine.js` to the ecology/dominance model; rebuild `sim.js`
   to measure §8; confirm a skill gradient and legibility exist.
2. **Next:** tune niches so all three factions are viable; add the allied-web
   layer (plants/animals/people as trackable entities); rebuild the UI around
   the Dominance meter.
3. **Later:** port to the real engine; invest in procedurally generated beauty
   — organic mycelial growth, fruiting, generated forest floors and their webs.
