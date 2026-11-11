// Sample content for /demo/ — shows the site with essays, reviews and cover images.
// Not stored in the database. Cover images are public-domain paintings hosted on
// Wikimedia Commons.

const commons = (file, width = 1600) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
const fn = (id, n) => `<sup class="fn" data-id="${id}">${n}</sup>`;
const dc = (frame = 'orn-double', lines = 3) => ({ on: true, lines, weight: 400, color: 'var(--ink)', frame });


const IMG = {
  pantheon: 'Giovanni Paolo Panini - Interior of the Pantheon, Rome - Google Art Project.jpg',
  hagia: 'Aya Sofia, Constantinople (BM 1889,0603.120).jpg',
  bavo: 'Interieur van de Sint-Bavokerk in Haarlem Rijksmuseum SK-A-359.jpeg',
  bavoChoir: 'Interior of the Choir of St Bavo at Haarlem 1660 Pieter Jansz Saenredam.jpg',
  ideal: 'Ideal City - Urbino.jpg',
  stpauls: "Canaletto - St. Paul's Cathedral - Google Art Project.jpg",
  schinkel: '1813 Schinkel Gotischer Dom am Wasser anagoria.JPG',
  sanmarco: 'Canaletto - The Piazza San Marco in Venice - Google Art Project.jpg',
};
const img = (k, w) => commons(IMG[k], w);

const panel = (label, years, k, caption, title, when, text, feats) => `<div class="ex-panel" data-label="${label}" data-years="${years}">
<figure><img src="${img(k, 1200)}" alt="${caption}"><figcaption>${caption}</figcaption></figure>
<div><h3>${title}</h3><p class="when">${when}</p><p>${text}</p><ul>${feats.map(([a, b]) => `<li><b>${a}.</b> ${b}</li>`).join('')}</ul></div></div>`;

const ARCH = {
  id: 'd0', slug: 'six-ways-to-hold-up-a-roof', kind: 'essay', section: 'Architecture & Aesthetics',
  title: 'Six Ways to Hold Up a Roof',
  subtitle: 'A walk through the great styles of Western architecture, and what each one believed about the people standing underneath.',
  published_at: '2026-11-10T15:00:00Z', paragraph_style: 'book', align: 'ragged', drop_cap: { on: true, lines: 3, weight: 400, color: 'var(--ink)', frame: 'orn-double' },
  cover_url: img('ideal', 2400),
  cover_caption: 'The Ideal City, central Italian painter, c. 1480–90. Galleria Nazionale delle Marche, Urbino.',
  body_html: `<p>Every building is an argument about gravity. Stone wants to fall; a roof wants to come down on the heads of the people beneath it. A style is a settled answer to that problem, refined over generations until it became a way of seeing. Learn to read the answer, and an old building starts to talk.${fn('a', 1)}</p>
<p>What follows is a short tour. Click any picture to see it large; tap the numbers on the Pantheon; and at the end, test your eye.</p>
<h2>The Explorer</h2>
<p>Six styles, roughly in order. Use the tabs or the arrows.</p>
<div class="explorer"><div class="ex-stage">
${panel('Classical', '27 BC–AD 400', 'pantheon', 'Interior of the Pantheon, Rome, Giovanni Paolo Panini, c. 1734. National Gallery of Art, Washington.', 'Classical', 'Rome · the Pantheon, c. AD 113–125',
  'The Romans inherited the Greek orders and added the arch, the vault and concrete. The result was a new kind of interior: not a forest of columns but a single, unbroken volume.',
  [['Look for', 'columns with capitals, pediments, coffered ceilings, symmetry about a central axis'], ['The idea', 'order you can measure; the human body as the module of the whole']])}
${panel('Byzantine', '330–1453', 'hagia', 'Interior of Hagia Sophia, lithograph by Louis Haghe after Gaspare Fossati, 1852. British Museum.', 'Byzantine', 'Constantinople · Hagia Sophia, 532–537',
  'Justinian’s architects set a vast dome on four arches, with pendentives carrying the circle down onto the square. Ringed with windows at its base, the dome seems to float on light.',
  [['Look for', 'domes on pendentives, mosaics in gold, low-relief carving, centralized plans'], ['The idea', 'heaven brought down; the interior as a vision rather than a structure']])}
${panel('Gothic', '1140–1500', 'bavo', 'Interior of the Church of St Bavo in Haarlem, Pieter Jansz. Saenredam, 1636. Rijksmuseum, Amsterdam.', 'Gothic', 'Haarlem · St Bavo, 15th century',
  'The pointed arch sends thrust down more steeply; the rib vault gathers it into slender piers; flying buttresses take the rest outside. The wall all but disappears into glass.',
  [['Look for', 'pointed arches, ribbed vaults, clustered piers, tall windows'], ['The idea', 'height and light as signs of the transcendent']])}
${panel('Renaissance', '1400–1600', 'ideal', 'The Ideal City, central Italian painter, c. 1480–90. Galleria Nazionale delle Marche, Urbino.', 'Renaissance', 'Italy · the Ideal City, c. 1480',
  'Florence recovered the classical orders and married them to a new science: linear perspective. Buildings were drawn before they were built, and proportion became a matter of number.',
  [['Look for', 'round arches, domes on drums, pilasters, perfect geometric plans'], ['The idea', 'the city as a rational composition; man as the measure']])}
${panel('Baroque', '1600–1750', 'stpauls', "St. Paul’s Cathedral, Canaletto, 1754. Yale Center for British Art.", 'Baroque', 'London · St Paul’s Cathedral, 1675–1710',
  'After the Great Fire, Christopher Wren gave London a dome to rival St Peter’s. Baroque takes the classical vocabulary and sets it in motion: curves, layered planes, dramatic light.',
  [['Look for', 'giant orders, paired columns, oval and curved plans, theatrical light'], ['The idea', 'architecture that persuades: the building as rhetoric']])}
${panel('Gothic Revival', '1740–1900', 'schinkel', 'Gothic Cathedral by the Water, Karl Friedrich Schinkel, 1813. Alte Nationalgalerie, Berlin.', 'Gothic Revival', 'Europe & America · 19th century',
  'Romantics looked back past the Renaissance to the medieval cathedral as a symbol of faith and nation. Schinkel painted this one before building anything like it.',
  [['Look for', 'pointed arches in new materials, picturesque massing, towers and spires'], ['The idea', 'memory as a design principle; the past as a moral standard']])}
</div></div>
<h2>Reading the Pantheon</h2>
<p>Panini painted the Pantheon from the doorway, so that we stand where an eighteenth-century visitor would have stood. Tap the numbers.</p>
<figure class="hotspots"><div class="hs-img"><img src="${img('pantheon', 1600)}" alt="Interior of the Pantheon in Rome: a coffered dome with a round opening at the top, columns and niches around the drum, visitors on a patterned marble floor.">
<button class="hs" style="left:56%;top:10%" aria-label="Detail 1">1</button>
<button class="hs" style="left:28%;top:18%" aria-label="Detail 2">2</button>
<button class="hs" style="left:8%;top:64%" aria-label="Detail 3">3</button>
<button class="hs" style="left:73%;top:74%" aria-label="Detail 4">4</button>
<button class="hs" style="left:52%;top:90%" aria-label="Detail 5">5</button>
</div><figcaption>Interior of the Pantheon, Rome, Giovanni Paolo Panini, c. 1734. National Gallery of Art, Washington.</figcaption>
<ol class="hs-notes">
<li><b>The oculus.</b> The only window: about 8 m across, open to the sky. Sunlight moves across the interior like the hand of a clock.</li>
<li><b>Coffers.</b> Recessed panels that lighten the dome and step smaller as they rise, exaggerating its height.</li>
<li><b>Columns and entablature.</b> The classical orders, here carrying a continuous horizontal band around the drum.</li>
<li><b>Aedicules.</b> Small temple-fronts framing niches: a building within the building, at human scale.</li>
<li><b>The floor.</b> Squares and circles of colored marble, slightly domed so rainwater drains away.</li>
</ol></figure>
<p>The dome is unreinforced concrete, made lighter toward the top with pumice in the mix.${fn('b', 2)} Nearly two thousand years later it remains the largest of its kind in the world.</p>
<figure class="bleed"><img src="${img('ideal', 2400)}" alt="A wide painted piazza with a round temple at the center and symmetrical palaces on either side."><figcaption>The Ideal City, c. 1480–90. A city drawn before it was built: one vanishing point, one temple, no clutter.</figcaption></figure>
<h2>Two Ways to Light a Church</h2>
<p>Put a Byzantine interior beside a Gothic one and the difference in ambition is immediate. One gathers light into a dome; the other dissolves the wall into windows.</p>
<div class="pair">
<figure><img src="${img('hagia', 1000)}" alt="Interior of Hagia Sophia: a huge dome above arcades, lamps hanging on chains."><figcaption><b>Light from above</b>Hagia Sophia, Louis Haghe after Gaspare Fossati, 1852. British Museum.</figcaption></figure>
<figure><img src="${img('bavoChoir', 1000)}" alt="Whitewashed Gothic church choir with tall pointed arches and clear windows."><figcaption><b>Light from the sides</b>Choir of St Bavo, Haarlem, Pieter Saenredam, 1660. Worcester Art Museum.</figcaption></figure>
</div>
<p>Saenredam’s churches are Reformed: the images gone, the walls whitewashed, the windows clear.${fn('c', 3)} What remains is the Gothic structure itself, and a light that falls equally on everyone in the room.</p>
<div class="quiz"><h3>Test Your Eye</h3><p>Name the style of each building.</p><div class="qs">
<div class="q" data-answer="byzantine"><img src="${img('sanmarco', 900)}" alt="A domed basilica with arched portals and golden mosaics at the end of a long piazza."><div class="opts"><button data-v="classical">Classical</button><button data-v="byzantine">Byzantine</button><button data-v="gothic">Gothic</button><button data-v="renaissance">Renaissance</button></div><p class="reveal">San Marco, Venice: domes, round arches and gold mosaic. Byzantine, by way of Venice’s trade with Constantinople.</p></div>
<div class="q" data-answer="gothic"><img src="${img('schinkel', 900)}" alt="A great cathedral with pointed spires rising over a town by the water."><div class="opts"><button data-v="classical">Classical</button><button data-v="byzantine">Byzantine</button><button data-v="gothic">Gothic</button><button data-v="renaissance">Renaissance</button></div><p class="reveal">Pointed arches, spires, flying buttresses: Gothic, as the Romantics imagined it.</p></div>
<div class="q" data-answer="renaissance"><img src="${img('ideal', 900)}" alt="A symmetrical piazza with a round temple and palaces with pilasters."><div class="opts"><button data-v="classical">Classical</button><button data-v="byzantine">Byzantine</button><button data-v="gothic">Gothic</button><button data-v="renaissance">Renaissance</button></div><p class="reveal">Perfect symmetry and a single vanishing point: the Renaissance ideal city.</p></div>
</div></div>
<h2>Coda</h2>
<p>None of these styles was merely a fashion. Each was a confession of what its builders thought a person is, and what a person is for. That is why the question of how we build now is never only technical.</p>`,
  notes: [
    { id: 'a', body: 'Sample text for the demonstration site.' },
    { id: 'b', body: 'The aggregate grows lighter toward the crown, from heavy stone near the base to pumice near the oculus.' },
    { id: 'c', body: 'St Bavo became a Protestant church in 1578.' },
  ],
};

const EXTRA = [
  {
    id: 'd6', slug: 'the-whitewashed-church', kind: 'essay', section: 'Theology & Philosophy',
    title: 'The Whitewashed Church',
    subtitle: 'What Saenredam saw in the plain walls of the Reformation, and why plainness is not the same as poverty.',
    published_at: '2026-11-05T15:00:00Z', paragraph_style: 'book', align: 'ragged', drop_cap: { on: true, lines: 3, weight: 400, color: 'var(--ink)', frame: '' },
    cover_url: img('bavoChoir', 1600),
    cover_caption: 'Interior of the Choir of St Bavo at Haarlem, Pieter Jansz. Saenredam, 1660. Worcester Art Museum.',
    body_html: `<p>Pieter Saenredam painted the same few churches over and over: whitewashed, nearly empty, filled with an even, silvery light. A careless viewer might call them bare. They are not. They are cleared.</p>
<p>The Reformation stripped images from the walls, but it left the architecture standing, and in doing so it revealed it. Without the side altars and the painted saints, a Gothic nave becomes what its builders drew: a structure of astonishing clarity, and a room in which a preached word can be heard.</p>
<p>Plainness, rightly understood, is a discipline of attention. It is the decision to let one thing speak.</p>`,
    notes: [],
  },
  {
    id: 'd7', slug: 'wrens-second-chance', kind: 'essay', section: 'Architecture & Aesthetics',
    title: 'Wren’s Second Chance',
    subtitle: 'London burned in 1666. What its rebuilding teaches about plans, patience and the cathedral that got built anyway.',
    published_at: '2026-10-30T15:00:00Z', paragraph_style: 'book', align: 'ragged', drop_cap: { on: true, lines: 2, weight: 400, color: 'var(--ink)', frame: 'orn-box' },
    cover_url: img('stpauls', 1600),
    cover_caption: "St. Paul’s Cathedral, Canaletto, 1754. Yale Center for British Art.",
    body_html: `<p>Within days of the Great Fire, Christopher Wren presented the king with a plan for a new London: broad avenues, piazzas, a rational grid. It was never built. Property lines, debts and the sheer urgency of rebuilding won out, and the old street pattern returned almost exactly.</p>
<p>And yet Wren got his cathedral. It took thirty-five years and several designs, each compromised, each argued over. The dome that rose over the rebuilt city was not the one he first drew. It was, arguably, better.</p>`,
    notes: [],
  },
];

export const DEMO_POSTS = [ARCH, ...EXTRA.slice(0,1), 
  {
    id: 'd1', slug: 'on-the-uses-of-the-margin', section: 'Architecture & Aesthetics', kind: 'review',
    title: 'On the Uses of the Margin',
    subtitle: "Ruskin, the Gothic, and why a writer's asides deserve a place beside the text.",
    published_at: '2026-11-09T14:00:00Z', paragraph_style: 'book', align: 'ragged', drop_cap: dc('orn-double', 3),
    cover_url: commons('Rembrandt - The Philosopher in Meditation.jpg'),
    cover_caption: 'Philosopher in Meditation, attributed to Rembrandt, 1632. Musée du Louvre.',
    books: [{ title: 'The Stones of Venice', author: 'John Ruskin', publisher: 'Smith, Elder & Co.', year: '1851–53', pages: null, price: null, buy_url: null, cover_path: null }],
    body_html: `<h2>Introduction</h2>
<p>Every serious book once had two voices on the page: the text, set large in the center, and the gloss, crowded into the margins around it.${fn('a', 1)} The reader moved between them freely. The commentary did not interrupt the argument; it stood beside it, available when wanted and ignorable when not.</p>
<p>Modern publishing pushed those asides to the bottom of the page, and the web pushed them further still, to the end of the document, where they are reached only by a jump and a scroll back. The cost is small for any single note. Across an essay it changes how one reads: the reader abandons either the notes or the thread.</p>
<p>Ruskin would have understood the complaint. His chapter on the nature of the Gothic praises the carver who was permitted his own small invention at the edge of the great design — the leaf, the grotesque, the irregular finial.${fn('b', 2)} The building was better for the liberty it gave its margins.</p>
<h2>The Architecture of a Page</h2>
<p>A page is a plan. It has a primary axis, secondary spaces, and thresholds between them. The main column is the nave; the margin is the aisle, narrower and lower, but part of the same building and lit by the same light. To delete the aisle is to make the building simpler, not better.</p>
<blockquote><p>The margin is not where the argument goes to die. It is where the argument shows its work.</p></blockquote>
<p>That, finally, is the case for the side note: not ornament, but honesty about how thought is actually made — a main line, and the qualifications that keep it true.${fn('c', 3)}</p>`,
    notes: [
      { id: 'a', body: 'Medieval glossed Bibles set the scriptural text in a central block, with commentary written in the surrounding margins and between the lines.' },
      { id: 'b', body: '“The Nature of Gothic” appears in the second volume of <i>The Stones of Venice</i> (1853).' },
      { id: 'c', body: 'Sample text for the demonstration site.' },
    ],
  },
  {
    id: 'd2', slug: 'the-oculus', section: 'Architecture & Aesthetics', kind: 'essay',
    title: 'The Oculus',
    subtitle: 'On a building that keeps its roof open to the weather, and what it teaches about attention.',
    published_at: '2026-11-02T14:00:00Z', paragraph_style: 'book', align: 'ragged', drop_cap: dc('', 3),
    cover_url: commons('Giovanni Paolo Panini - Interior of the Pantheon, Rome - Google Art Project.jpg'),
    cover_caption: 'Interior of the Pantheon, Rome, Giovanni Paolo Panini, c. 1734. National Gallery of Art, Washington.',
    body_html: `<p>The Pantheon has a hole in its roof. Nearly two thousand years on, the opening at the crown of the dome is still uncovered, and when it rains, it rains inside. The floor is pitched, and drains carry the water away.${fn('a', 1)}</p>
<p>An architect learns to fear water above almost anything else. Every detail in a set of construction documents is, at some level, an argument with the weather. And yet here is the most admired room in the West, conceding the argument at its very center.</p>
<p>The concession is the point. The oculus is the only window. All the light in the room enters through it, and as the day turns, a disc of sun moves across the coffers and down the walls like the hand of a clock. The building does not merely admit the sky; it measures it.</p>
<h2>Attention</h2>
<p>There is a lesson here about attention. We tend to think of focus as closing things off. The Pantheon suggests the opposite: a single, deliberate opening, around which everything else is ordered and toward which everything else is turned.</p>`,
    notes: [{ id: 'a', body: 'The oculus is roughly 8.2 metres (27 ft) across. Sample text for the demonstration site.' }],
  },
  {
    id: 'd3', slug: 'above-the-fog', section: 'Architecture & Aesthetics', kind: 'essay',
    title: 'Above the Fog',
    subtitle: 'The sublime and the beautiful are not the same thing, and confusing them has consequences.',
    published_at: '2026-10-26T14:00:00Z', paragraph_style: 'book', align: 'ragged', drop_cap: dc('orn-box', 2),
    cover_url: commons('Caspar David Friedrich - Wanderer above the sea of fog.jpg'),
    cover_caption: 'Wanderer above the Sea of Fog, Caspar David Friedrich, c. 1818. Hamburger Kunsthalle.',
    body_html: `<p>Friedrich's wanderer stands with his back to us. We do not see his face, only what he sees: ridges dissolving into cloud, and beyond them nothing that can be measured. It is one of the most reproduced images of the last two centuries, and it is not, strictly speaking, beautiful.</p>
<p>The eighteenth century drew a careful line here. The beautiful is proportioned, finite, and lovable; it invites us closer. The sublime is vast, obscure, and faintly threatening; it holds us at a distance and leaves us small.${fn('a', 1)}</p>
<p>Both are real goods. But a culture that prizes only the sublime will build for awe and forget to build for love — monuments instead of houses, spectacle instead of rooms one is glad to come home to.</p>`,
    notes: [{ id: 'a', body: 'The classic statement is Edmund Burke, <i>A Philosophical Enquiry into the Origin of Our Ideas of the Sublime and Beautiful</i> (1757).' }],
  },
  {
    id: 'd4', slug: 'measuring-the-world', section: 'Theology & Philosophy', kind: 'essay',
    title: 'Measuring the World',
    subtitle: 'A note on vocation, from a painting of a man with a pair of dividers.',
    published_at: '2026-10-19T14:00:00Z', paragraph_style: 'book', align: 'ragged', drop_cap: dc('', 3),
    cover_url: commons('Johannes Vermeer - The Geographer - Google Art Project.jpg'),
    cover_caption: 'The Geographer, Johannes Vermeer, 1669. Städel Museum, Frankfurt.',
    body_html: `<p>Vermeer's geographer has looked up from his work. The dividers are still in his hand; the chart is still spread on the table; but his eyes have gone to the window, and the light has found his face.</p>
<p>It is a picture of work interrupted — or perhaps of work completed in the only way it can be, by lifting the eyes from the instrument to the thing the instrument was for. Measurement serves the world; it does not replace it.</p>
<p>Anyone who draws for a living knows the temptation to mistake the drawing for the building. The geographer is a gentle rebuke. The map is good. The window is better.</p>`,
    notes: [],
  },
  {
    id: 'd5', slug: 'aristotle-on-poetry', section: 'Architecture & Aesthetics', kind: 'review',
    title: 'What the Philosopher Saw in Homer',
    subtitle: "Rereading the Poetics: plot, character, and why stories need endings.",
    published_at: '2026-10-12T14:00:00Z', paragraph_style: 'book', align: 'ragged', drop_cap: dc('orn-double', 3),
    cover_url: commons('Rembrandt - Aristotle with a Bust of Homer - Google Art Project.jpg'),
    cover_caption: 'Aristotle with a Bust of Homer, Rembrandt, 1653. The Metropolitan Museum of Art.',
    books: [{ title: 'Poetics', author: 'Aristotle', publisher: 'trans. S. H. Butcher, Macmillan', year: '1895', pages: null, price: null, buy_url: null, cover_path: null }],
    body_html: `<p>Aristotle's little treatise on poetry is a lecture-notebook, compressed and occasionally cryptic, and it has outlived nearly every other book of literary theory ever written. Its central claim is simple: the soul of a tragedy is its plot.${fn('a', 1)}</p>
<p>Not character, not spectacle, not fine language — the ordered sequence of actions, with a beginning, a middle, and an end. A beginning is what does not follow from anything else; an end is what follows from something and is followed by nothing.</p>
<p>It is a definition that sounds obvious until one notices how many modern stories refuse it. Serial forms are built to defer the end indefinitely. Aristotle's insistence on completion is quietly radical: a story is a whole, and a whole must be finished to be understood.</p>`,
    notes: [{ id: 'a', body: '<i>Poetics</i> 1450a38. Sample text for the demonstration site.' }],
  },
];

DEMO_POSTS.splice(3, 0, EXTRA[1]);
DEMO_POSTS.sort((a, b) => b.published_at.localeCompare(a.published_at));

export const demoBySlug = (slug) => DEMO_POSTS.find((p) => p.slug === slug);
export const demoListRows = () => DEMO_POSTS.map((p) => ({ ...p, post_books: (p.books || []).map((b, i) => ({ position: i, books: b })) }));
export const commonsImage = commons;
